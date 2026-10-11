/* Tsuzuri のサーバー。Vercel ではすべてのURLがここに来て（静的ファイルを除く）、中で振り分ける。 */
import { load, save, putMedia, allowedType, readLocalMedia } from '../lib/store.js';
import { isWriter, checkPassword, passwordConfigured, issueCookie, clearCookie } from '../lib/auth.js';
import { homePage, postPage, notFoundPage, sitemap, feed, published } from '../lib/pages.js';

const MAX_JSON = 2 * 1024 * 1024;
const MAX_MEDIA = 4 * 1024 * 1024; // Vercel の関数が受け取れる本文の上限（約4.5MB）に合わせる

function origin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}
const json = (res, status, obj, extra) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...extra });
const html = (res, status, body) => send(res, status, body, 'text/html; charset=utf-8', {
  'Cache-Control': status === 200 ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=600' : 'public, max-age=0, s-maxage=10',
});

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* 書く人だけが送れる要求か（別サイトからの送信を防ぐ） */
function sameSite(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}

const SLUG = /^[A-Za-z0-9._~-]+$/;

function validData(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.posts) || typeof d.site !== 'object') return false;
  const seen = new Set();
  for (const p of d.posts) {
    if (!p || typeof p.slug !== 'string' || !SLUG.test(p.slug) || seen.has(p.slug)) return false;
    if (typeof p.title !== 'string' || typeof p.body !== 'string') return false;
    seen.add(p.slug);
  }
  return true;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = url.searchParams.get('__p') ?? url.pathname;
  const method = req.method;
  try {
    /* ---- API ---- */
    if (pathname === '/api/me') return json(res, 200, { writer: isWriter(req), passwordConfigured: passwordConfigured() });

    if (pathname === '/api/login' && method === 'POST') {
      if (!sameSite(req)) return json(res, 403, { error: 'forbidden' });
      if (!passwordConfigured()) return json(res, 503, { error: 'no_password', message: 'サーバーに合言葉が設定されていません' });
      const body = JSON.parse((await readBody(req, 4096)).toString() || '{}');
      if (!checkPassword(body.password)) {
        await new Promise(r => setTimeout(r, 800));
        return json(res, 401, { error: 'wrong', message: '合言葉がちがいます' });
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': issueCookie() });
    }
    if (pathname === '/api/logout' && method === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });

    if (pathname === '/api/content') {
      if (!isWriter(req)) return json(res, 401, { error: 'login_required' });
      if (method === 'GET') return json(res, 200, await load({ fresh: true }));
      if (method === 'PUT') {
        if (!sameSite(req)) return json(res, 403, { error: 'forbidden' });
        const body = JSON.parse((await readBody(req, MAX_JSON)).toString());
        if (!validData(body.data)) return json(res, 400, { error: 'invalid', message: '記事データの形が正しくありません' });
        const cur = await load({ fresh: true });
        if ((body.rev ?? -1) !== cur.rev) return json(res, 409, { error: 'conflict', message: 'ほかの画面で先に保存されています', rev: cur.rev });
        const next = { ...body.data, rev: cur.rev + 1, savedAt: new Date().toISOString() };
        await save(next);
        return json(res, 200, { ok: true, rev: next.rev });
      }
      return json(res, 405, { error: 'method' });
    }

    if (pathname === '/api/upload' && method === 'POST') {
      if (!isWriter(req)) return json(res, 401, { error: 'login_required' });
      if (!sameSite(req)) return json(res, 403, { error: 'forbidden' });
      const type = (req.headers['content-type'] || '').split(';')[0];
      if (!allowedType(type)) return json(res, 415, { error: 'type', message: '画像（jpg・png・webp・gif）か動画（mp4・webm）を選んでください' });
      const buf = await readBody(req, MAX_MEDIA);
      return json(res, 200, { url: await putMedia(buf, type) });
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });

    /* 手元で動かすときの画像置き場（本番は Blob のURLを直接使う） */
    if (pathname.startsWith('/media/')) {
      const buf = await readLocalMedia(pathname.slice(7));
      if (!buf) return send(res, 404, 'not found', 'text/plain');
      const ext = pathname.split('.').pop();
      const t = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' }[ext] || 'application/octet-stream';
      return send(res, 200, buf, t, { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }

    /* ---- 読者のページ ---- */
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
    const data = await load();
    const o = origin(req);
    if (pathname === '/' || pathname === '') return html(res, 200, homePage(data, o));
    if (pathname === '/sitemap.xml') return send(res, 200, sitemap(data, o), 'application/xml; charset=utf-8', { 'Cache-Control': 'public, s-maxage=300' });
    if (pathname === '/feed.xml') return send(res, 200, feed(data, o), 'application/rss+xml; charset=utf-8', { 'Cache-Control': 'public, s-maxage=300' });
    if (pathname === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /write\nDisallow: /api/\nSitemap: ${o}/sitemap.xml\n`, 'text/plain; charset=utf-8');

    const slug = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, ''));
    const p = SLUG.test(slug) && published(data).find(x => x.slug === slug);
    if (p) return html(res, 200, postPage(data, p, o));
    return html(res, 404, notFoundPage(data, o));
  } catch (e) {
    console.error(e);
    if (e.status === 413) return json(res, 413, { error: 'too_large', message: 'ファイルが大きすぎます（4MBまで）' });
    if (e instanceof SyntaxError) return json(res, 400, { error: 'bad_json' });
    return json(res, 500, { error: 'server', message: 'サーバーでエラーが起きました' });
  }
}
