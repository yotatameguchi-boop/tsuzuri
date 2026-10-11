/* Tsuzuri のサーバー。Vercel ではすべてのURLがここに来て（静的ファイルを除く）、中で振り分ける。 */
import { frontMatter, resolveMeta } from '../public/assets/render.js';
import { cleanDesign } from '../public/assets/design.js';
import { getDoc, mutate, allowedType, presignMedia, putLocalMedia, readLocalMedia, useBlob, MEDIA_MAX } from '../lib/store.js';
import {
  currentUser, issueCookie, clearCookie, hashPassword, verifyPassword, checkNewAccount, checkPassword,
  setupKeyConfigured, checkSetupKey, makeInvite, findInvite, newId, publicUser,
} from '../lib/auth.js';
import { portalPage, homePage, postPage, categoryPage, searchPage, gatePage, notFoundPage, sitemap, feed, visiblePosts, siteIsPrivate, mediaIsPrivate, hasMembersPosts, multi, mediaOf, postHref, COLORS, THEMES } from '../lib/pages.js';

const PAGE_TAG = 'tsuzuri-pages';
const SLUG = /^[A-Za-z0-9._~-]{1,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEDIA_SLUG = /^[a-z0-9][a-z0-9-]{1,29}$/;
/* メディアのURLに使えない名前（サイトの仕組みで使っている場所） */
const RESERVED = new Set(['write', 'api', 'assets', 'img', 'media', 'search', 'c', 'feed.xml', 'sitemap.xml', 'robots.txt', 'favicon.svg', 'login', 'admin']);

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
const fail = (status, error, message) => ({ abort: true, status, body: { error, message } });

/* 読者向けのページは CDN に長く置き、記事が変わったら消す（だから公開した瞬間に反映される）。
   メンバー限定の記事があるサイトは、見る人によって中身が変わるので CDN に置かない */
async function page(res, status, body, type = 'text/html; charset=utf-8', cacheable = true) {
  if (!cacheable) return send(res, status, body, type, { 'Cache-Control': 'private, no-store' });
  if (process.env.VERCEL) {
    try { const { addCacheTag } = await import('@vercel/functions'); await addCacheTag(PAGE_TAG); } catch {}
  }
  /* ブラウザには毎回確かめさせ（古いページを見せない）、CDN にだけ長く置く */
  send(res, status, body, type, {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': status === 200 ? 's-maxage=86400, stale-while-revalidate=604800' : 's-maxage=60',
    'Vercel-Cache-Tag': PAGE_TAG,
  });
}
async function purgePages() {
  if (!process.env.VERCEL) return;
  try { const { dangerouslyDeleteByTag } = await import('@vercel/functions'); await dangerouslyDeleteByTag(PAGE_TAG); }
  catch (e) { console.error('purge failed', e); }
}

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
const readJson = async (req, limit = 64 * 1024) => JSON.parse((await readBody(req, limit)).toString() || '{}');

/* ほかのサイトから送られてきた書き込みを断る */
function sameSite(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}
const slowFail = () => new Promise(r => setTimeout(r, 800));
const ROLES = ['admin', 'writer', 'reader'];
const canWrite = user => user.role === 'admin' || user.role === 'writer';
const canEdit = (user, post) => user.role === 'admin' || (user.role === 'writer' && post.author && post.author === user.id);
const activeAdmins = doc => doc.users.filter(u => u.role === 'admin' && !u.disabled);

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = url.searchParams.get('__p') ?? url.pathname;
  const method = req.method;
  try {
    if (pathname.startsWith('/api/')) {
      if (method !== 'GET' && !sameSite(req)) return json(res, 403, { error: 'forbidden' });
      const { data: users } = await getDoc('users');
      const me = currentUser(req, users);
      const run = async (doc, fn) => {
        const r = await mutate(doc, fn);
        if (r && r.abort) return json(res, r.status, r.body);
        if (doc === 'content') await purgePages();
        return r;
      };

      /* ---- 自分 ---- */
      if (pathname === '/api/me') {
        return json(res, 200, { user: me ? publicUser(me) : null, setupNeeded: users.users.length === 0, setupKeyConfigured: setupKeyConfigured() });
      }

      if (pathname === '/api/setup' && method === 'POST') {
        const b = await readJson(req);
        if (!checkSetupKey(b.setupKey)) { await slowFail(); return json(res, 401, { error: 'wrong', message: 'サイトの合言葉がちがいます' }); }
        let created;
        await run('users', doc => {
          if (doc.users.length) return fail(409, 'exists', '管理者はもう作られています。ログインしてください');
          const err = checkNewAccount(b, doc.users);
          if (err) return fail(400, 'invalid', err);
          created = { id: newId('u'), loginId: b.loginId, name: b.name.trim(), role: 'admin', hash: hashPassword(b.password), ses: 0, created: new Date().toISOString() };
          doc.users.push(created);
        });
        if (res.headersSent) return;
        /* それまでの記事（書いた人が決まっていない記事）は、最初の管理者のものにする */
        await run('content', doc => { for (const p of doc.posts) if (!p.author) { p.author = created.id; p.authorName = created.name; } });
        if (res.headersSent) return;
        return json(res, 200, { user: publicUser(created) }, { 'Set-Cookie': issueCookie(created) });
      }

      if (pathname === '/api/login' && method === 'POST') {
        const b = await readJson(req);
        const u = users.users.find(x => x.loginId === String(b.loginId || '').trim().toLowerCase());
        if (!u || u.disabled || !verifyPassword(b.password, u.hash)) {
          await slowFail();
          return json(res, 401, { error: 'wrong', message: 'ログインIDかパスワードがちがいます' });
        }
        return json(res, 200, { user: publicUser(u) }, { 'Set-Cookie': issueCookie(u) });
      }
      if (pathname === '/api/logout' && method === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });

      if (pathname === '/api/invite-info' && method === 'GET') {
        const inv = findInvite(users, url.searchParams.get('token'));
        if (!inv) return json(res, 404, { error: 'invite', message: 'このリンクは使えません（期限切れか、使用済みです）' });
        const u = inv.resetFor && users.users.find(x => x.id === inv.resetFor);
        return json(res, 200, inv.resetFor ? { kind: 'reset', name: u ? u.name : '', loginId: u ? u.loginId : '' } : { kind: 'join', role: inv.role });
      }

      if (pathname === '/api/accept' && method === 'POST') {
        const b = await readJson(req);
        let created;
        await run('users', doc => {
          const inv = findInvite(doc, b.token);
          if (!inv) return fail(400, 'invite', 'この招待リンクは使えません（期限切れか、使用済みです）');
          if (inv.resetFor) {
            const u = doc.users.find(x => x.id === inv.resetFor);
            if (!u) return fail(400, 'invite', 'このリンクは使えません');
            const err = checkPassword(b.password);
            if (err) return fail(400, 'invalid', err);
            u.hash = hashPassword(b.password);
            u.ses = (u.ses || 0) + 1;
            u.disabled = false;
            doc.invites = doc.invites.filter(i => i !== inv);
            created = u;
            return;
          }
          const err = checkNewAccount({ ...b, loginId: String(b.loginId || '').trim().toLowerCase() }, doc.users);
          if (err) return fail(400, 'invalid', err);
          created = { id: newId('u'), loginId: String(b.loginId).trim().toLowerCase(), name: b.name.trim(), role: inv.role, hash: hashPassword(b.password), ses: 0, created: new Date().toISOString() };
          doc.users.push(created);
          doc.invites = doc.invites.filter(i => i !== inv);
        });
        if (res.headersSent) return;
        return json(res, 200, { user: publicUser(created) }, { 'Set-Cookie': issueCookie(created) });
      }

      if (!me) return json(res, 401, { error: 'login_required', message: 'ログインしてください' });

      if (pathname === '/api/account' && method === 'POST') {
        const b = await readJson(req);
        let updated;
        await run('users', doc => {
          const u = doc.users.find(x => x.id === me.id);
          if (b.name !== undefined) {
            if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 40) return fail(400, 'invalid', '名前を1〜40文字で入れてください');
            u.name = b.name.trim();
          }
          if (b.newPassword !== undefined) {
            if (!verifyPassword(b.currentPassword, u.hash)) return fail(401, 'wrong', '今のパスワードがちがいます');
            const err = checkPassword(b.newPassword);
            if (err) return fail(400, 'invalid', err);
            u.hash = hashPassword(b.newPassword);
            u.ses = (u.ses || 0) + 1;
          }
          updated = u;
        });
        if (res.headersSent) return;
        if (b.name !== undefined) await run('content', doc => { for (const p of doc.posts) if (p.author === me.id) p.authorName = updated.name; });
        if (res.headersSent) return;
        return json(res, 200, { user: publicUser(updated) }, { 'Set-Cookie': issueCookie(updated) });
      }

      /* ---- 記事 ---- */
      const writeApi = pathname === '/api/content' || pathname.startsWith('/api/posts/') || pathname.startsWith('/api/upload') || pathname === '/api/site' || pathname === '/api/export';
      if (writeApi && !canWrite(me)) return json(res, 403, { error: 'reader', message: '閲覧専用のアカウントでは書けません' });

      if (pathname === '/api/export' && method === 'GET') {
        if (me.role !== 'admin') return json(res, 403, { error: 'forbidden', message: '書き出しは管理者だけができます' });
        const { data } = await getDoc('content');
        const stamp = new Date().toISOString().slice(0, 10);
        return send(res, 200, JSON.stringify({ format: 'tsuzuri', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 1), 'application/json; charset=utf-8',
          { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="tsuzuri-${stamp}.json"` });
      }

      if (pathname === '/api/content' && method === 'GET') {
        const { data } = await getDoc('content');
        return json(res, 200, data);
      }

      const pm = pathname.match(/^\/api\/posts\/([A-Za-z0-9_-]{1,40})$/);
      if (pm && (method === 'PUT' || method === 'DELETE')) {
        const id = pm[1];
        const b = await readJson(req, 2 * 1024 * 1024);
        let saved = null;
        await run('content', doc => {
          const cur = doc.posts.find(p => p.id === id);
          if (cur && !canEdit(me, cur)) return fail(403, 'forbidden', `この記事は${cur.authorName || 'ほかの人'}さんの記事なので、変えられません`);
          if (cur && b.baseRev !== cur.rev) return { abort: true, status: 409, body: { error: 'conflict', message: 'ほかの画面で先に保存されています', post: cur } };
          if (!cur && b.baseRev) return fail(404, 'gone', 'この記事は削除されています');
          if (method === 'DELETE') {
            if (!cur) return fail(404, 'gone', 'この記事は削除されています');
            doc.posts = doc.posts.filter(p => p !== cur);
            return;
          }
          const p = { ...(b.post || {}) };
          /* 原稿の先頭の設定（--- で挟んだ部分）があれば、そちらを優先する */
          if (typeof p.body === 'string') Object.assign(p, resolveMeta(frontMatter(p.body).meta, { media: doc.media, posts: doc.posts, selfId: id }));
          if (!SLUG.test(String(p.slug || ''))) return fail(400, 'invalid', '記事のURLは半角英数とハイフンにしてください');
          if (doc.posts.some(o => o.id !== id && o.slug === p.slug)) return fail(400, 'invalid', 'そのURLはほかの記事で使われています');
          if (doc.media.some(m => m.slug === p.slug) || RESERVED.has(p.slug)) return fail(400, 'invalid', 'そのURLはメディアやサイトの仕組みで使われています');
          const media = doc.media.some(m => m.id === p.media) ? p.media : (cur ? cur.media : doc.media[0].id);
          if (typeof p.title !== 'string' || p.title.length > 200 || typeof p.body !== 'string') return fail(400, 'invalid', 'タイトルか本文の形が正しくありません');
          if (p.date && !DATE.test(p.date)) return fail(400, 'invalid', '日付の形が正しくありません');
          const category = String(p.category || '').trim();
          if (category.length > 40) return fail(400, 'invalid', 'カテゴリは40文字までです');
          const parent = p.parent || null;
          if (parent) {
            if (parent === id) return fail(400, 'invalid', '自分自身を親の記事にはできません');
            const byId = new Map(doc.posts.map(x => [x.id, x]));
            if (!byId.has(parent)) return fail(400, 'invalid', '親の記事が見つかりません');
            for (let c = byId.get(parent), n = 0; c && n < 50; c = byId.get(c.parent), n++) if (c.id === id) return fail(400, 'invalid', 'この記事の下にある記事は、親にできません');
          }
          const order = p.order === '' || p.order == null ? null : Number(p.order);
          if (order !== null && !Number.isFinite(order)) return fail(400, 'invalid', '並び順は数字で入れてください');
          const visibility = p.visibility === 'members' ? 'members' : 'public';
          const next = {
            id, slug: p.slug, title: p.title, body: p.body, date: p.date || new Date().toISOString().slice(0, 10), draft: !!p.draft,
            category, parent, order, visibility, media,
            theme: THEMES[p.theme] ? p.theme : null, color: COLORS[p.color] ? p.color : null,
            author: cur ? cur.author : me.id, authorName: cur ? cur.authorName : me.name,
            rev: (cur ? cur.rev : 0) + 1, updated: new Date().toISOString().slice(0, 10),
          };
          if (cur) Object.assign(cur, next); else doc.posts.push(next);
          saved = next;
        });
        if (res.headersSent) return;
        return json(res, 200, { ok: true, post: saved });
      }

      const mm = pathname.match(/^\/api\/media\/([A-Za-z0-9_-]{1,40})$/);
      if (mm && (method === 'PUT' || method === 'DELETE')) {
        if (me.role !== 'admin') return json(res, 403, { error: 'forbidden', message: 'メディアの設定は管理者だけが変えられます' });
        const id = mm[1];
        const b = await readJson(req);
        await run('content', doc => {
          const cur = doc.media.find(m => m.id === id);
          if (method === 'DELETE') {
            if (!cur) return fail(404, 'not_found', 'そのメディアは見つかりません');
            if (doc.media.length === 1) return fail(400, 'last', 'メディアが1つもなくなるので、削除できません');
            if (doc.posts.some(p => p.media === id)) return fail(400, 'not_empty', 'このメディアには記事があります。先に記事をほかのメディアへ移すか、削除してください');
            doc.media = doc.media.filter(m => m !== cur);
            return;
          }
          const name = String(b.name || '').trim(), tagline = String(b.tagline || '').trim(), slug = String(b.slug || '').trim().toLowerCase();
          const mark = [...String(b.mark || '').trim()].slice(0, 2).join('') || [...name][0] || '綴';
          if (!name || name.length > 40) return fail(400, 'invalid', 'メディアの名前を1〜40文字で入れてください');
          if (tagline.length > 200) return fail(400, 'invalid', '説明は200文字までです');
          if (!MEDIA_SLUG.test(slug) || RESERVED.has(slug)) return fail(400, 'invalid', 'URLは半角の英小文字・数字・ハイフンで2〜30文字にしてください（write・api など一部の名前は使えません）');
          if (doc.media.some(m => m.id !== id && m.slug === slug)) return fail(400, 'invalid', 'そのURLはほかのメディアで使われています');
          if (doc.posts.some(p => p.slug === slug)) return fail(400, 'invalid', 'そのURLは記事で使われています');
          const css = String(b.css || '');
          if (css.length > 20000) return fail(400, 'invalid', '追加のCSSは2万文字までです');
          const next = { id, slug, name, tagline, mark, color: COLORS[b.color] ? b.color : 'blue', theme: THEMES[b.theme] ? b.theme : 'standard', design: cleanDesign(b.design), css, visibility: b.visibility === 'members' ? 'members' : 'public' };
          if (cur) Object.assign(cur, next); else doc.media.push(next);
        });
        if (res.headersSent) return;
        return json(res, 200, { ok: true });
      }

      if (pathname === '/api/site' && method === 'PUT') {
        if (me.role !== 'admin') return json(res, 403, { error: 'forbidden', message: 'サイトの設定は管理者だけが変えられます' });
        const b = await readJson(req);
        const name = String(b.name || '').trim(), tagline = String(b.tagline || '').trim();
        if (!name || name.length > 60 || tagline.length > 200) return json(res, 400, { error: 'invalid', message: 'サイト名は1〜60文字、説明は200文字までです' });
        const visibility = b.visibility === 'members' ? 'members' : 'public';
        await run('content', doc => { doc.site = { ...doc.site, name, tagline, visibility }; });
        if (res.headersSent) return;
        return json(res, 200, { ok: true });
      }

      /* ---- 画像・動画 ---- */
      if (pathname === '/api/upload-url' && method === 'POST') {
        const b = await readJson(req);
        if (!allowedType(b.type)) return json(res, 415, { error: 'type', message: '画像・動画・PDF・Word・Excel・PowerPoint・CSV・テキスト・ZIP のどれかを選んでください' });
        if (!(b.size > 0) || b.size > MEDIA_MAX) return json(res, 413, { error: 'too_large', message: 'ファイルは100MBまでです' });
        if (!useBlob()) return json(res, 200, { direct: '/api/upload' });
        return json(res, 200, await presignMedia(b.type, b.size));
      }
      if (pathname === '/api/upload' && method === 'POST') {
        if (useBlob()) return json(res, 404, { error: 'not_found' });
        const type = (req.headers['content-type'] || '').split(';')[0];
        if (!allowedType(type)) return json(res, 415, { error: 'type', message: '画像か動画を選んでください' });
        return json(res, 200, { url: await putLocalMedia(await readBody(req, MEDIA_MAX), type) });
      }

      /* ---- メンバー（管理者だけ） ---- */
      if (pathname.startsWith('/api/users') || pathname.startsWith('/api/invites')) {
        if (me.role !== 'admin') return json(res, 403, { error: 'forbidden', message: 'メンバーの管理は管理者だけができます' });
        if (pathname === '/api/users' && method === 'GET') {
          return json(res, 200, { users: users.users.map(publicUser), invites: users.invites.filter(i => i.exp > Date.now() && !i.resetFor).map(({ id, role, exp }) => ({ id, role, exp })) });
        }
        const um = pathname.match(/^\/api\/users\/([A-Za-z0-9_-]+)$/);
        if (um && method === 'PATCH') {
          const b = await readJson(req);
          await run('users', doc => {
            const u = doc.users.find(x => x.id === um[1]);
            if (!u) return fail(404, 'not_found', 'そのメンバーは見つかりません');
            if (b.role !== undefined && !ROLES.includes(b.role)) return fail(400, 'invalid', '役割が正しくありません');
            const wasAdmin = u.role === 'admin' && !u.disabled;
            if (b.role !== undefined) u.role = b.role;
            if (b.disabled !== undefined) { u.disabled = !!b.disabled; u.ses = (u.ses || 0) + 1; }
            if (wasAdmin && !activeAdmins(doc).length) return fail(400, 'last_admin', '管理者が1人もいなくなるので、変えられません');
          });
          if (res.headersSent) return;
          return json(res, 200, { ok: true });
        }
        const rm = pathname.match(/^\/api\/users\/([A-Za-z0-9_-]+)\/reset$/);
        if (rm && method === 'POST') {
          const target = users.users.find(x => x.id === rm[1]);
          if (!target) return json(res, 404, { error: 'not_found', message: 'そのメンバーは見つかりません' });
          const { token, invite } = makeInvite(target.role, me.id, target.id);
          await run('users', doc => { doc.invites = doc.invites.filter(i => i.exp > Date.now() && i.resetFor !== target.id); doc.invites.push(invite); });
          if (res.headersSent) return;
          return json(res, 200, { token, exp: invite.exp });
        }
        if (pathname === '/api/invites' && method === 'POST') {
          const b = await readJson(req);
          const role = ROLES.includes(b.role) ? b.role : 'writer';
          const { token, invite } = makeInvite(role, me.id);
          await run('users', doc => { doc.invites = doc.invites.filter(i => i.exp > Date.now()); doc.invites.push(invite); });
          if (res.headersSent) return;
          return json(res, 200, { token, role, exp: invite.exp });
        }
        const im = pathname.match(/^\/api\/invites\/([A-Za-z0-9_-]+)$/);
        if (im && method === 'DELETE') {
          await run('users', doc => { doc.invites = doc.invites.filter(i => i.id !== im[1]); });
          if (res.headersSent) return;
          return json(res, 200, { ok: true });
        }
      }
      return json(res, 404, { error: 'not_found' });
    }

    /* 手元で動かすときの画像置き場（本番は Blob のURLを直接使う） */
    if (pathname.startsWith('/media/')) {
      const buf = await readLocalMedia(pathname.slice(7));
      if (!buf) return send(res, 404, 'not found', 'text/plain');
      const ext = pathname.split('.').pop();
      const t = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf' }[ext] || 'application/octet-stream';
      return send(res, 200, buf, t, { 'Cache-Control': 'public, max-age=31536000, immutable', ...(t === 'application/octet-stream' ? { 'Content-Disposition': 'attachment' } : {}) });
    }

    /* ---- 読者のページ ---- */
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
    const { data } = await getDoc('content');
    const o = origin(req);
    const viewer = /(?:^|;\s*)tz_s=/.test(req.headers.cookie || '') ? currentUser(req, (await getDoc('users')).data) : null;
    const personal = hasMembersPosts(data);
    const html = (status, body) => page(res, status, body, 'text/html; charset=utf-8', !personal && status === 200);
    const q = String(url.searchParams.get('q') || '').slice(0, 100);
    const redirect = to => { res.writeHead(301, { Location: to + (url.search.replace(/[?&]__p=[^&]*/, '').replace(/^&/, '?') || ''), 'Cache-Control': 'public, max-age=3600' }); res.end(); };

    if (pathname === '/robots.txt') {
      return send(res, 200, siteIsPrivate(data) ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /write\nDisallow: /api/\nDisallow: /search\nDisallow: /*/search\nSitemap: ${o}/sitemap.xml\n`, 'text/plain; charset=utf-8');
    }
    if (pathname === '/sitemap.xml') return page(res, 200, sitemap(data, o), 'application/xml; charset=utf-8');
    if (pathname === '/feed.xml') return page(res, 200, feed(data, o, multi(data) ? null : data.media[0]), 'application/rss+xml; charset=utf-8');
    if (siteIsPrivate(data) && !viewer) return page(res, 401, gatePage(data, o, pathname), 'text/html; charset=utf-8', false);

    let segs = [];
    try { segs = pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return html(404, notFoundPage(data, o)); }

    /* メディアが2つ以上なら、1つめの区切りはメディアのURL */
    let media = data.media[0];
    if (multi(data)) {
      if (!segs.length) return html(200, portalPage(data, o, viewer));
      if (segs[0] === 'search' && segs.length === 1) return html(200, searchPage(data, o, viewer, q));
      const m = data.media.find(x => x.slug === segs[0]);
      if (!m) {
        /* メディアの下に移る前のURL（/記事のURL）は、新しい場所へ案内する */
        const old = segs.length === 1 && visiblePosts(data, viewer).find(x => x.slug === segs[0]);
        if (old) return redirect(postHref(data, old));
        return page(res, 404, notFoundPage(data, o), 'text/html; charset=utf-8', !personal);
      }
      media = m;
      segs = segs.slice(1);
      if (!segs.length && !pathname.endsWith('/')) return redirect(`/${m.slug}/`);
    } else if (segs[0] === media.slug && segs.length <= 2) {
      return redirect('/' + segs.slice(1).join('/'));
    }
    if (mediaIsPrivate(data, media) && !viewer) return page(res, 401, gatePage(data, o, pathname, media), 'text/html; charset=utf-8', false);

    if (!segs.length) return html(200, homePage(data, o, viewer, media));
    if (segs.length === 1 && segs[0] === 'search') return html(200, searchPage(data, o, viewer, q, media));
    if (segs.length === 1 && segs[0] === 'feed.xml') return page(res, 200, feed(data, o, media), 'application/rss+xml; charset=utf-8');
    if (segs.length === 2 && segs[0] === 'c') {
      const body = categoryPage(data, o, viewer, media, segs[1]);
      return body ? html(200, body) : page(res, 404, notFoundPage(data, o, media), 'text/html; charset=utf-8', !personal);
    }
    const p = segs.length === 1 && SLUG.test(segs[0]) && visiblePosts(data, viewer).find(x => x.slug === segs[0]);
    if (p && mediaOf(data, p).id !== media.id) return redirect(postHref(data, p));
    if (p) return html(200, postPage(data, p, o, viewer));
    return page(res, 404, notFoundPage(data, o, media), 'text/html; charset=utf-8', !personal);
  } catch (e) {
    console.error(e);
    if (res.headersSent) return;
    if (e.status === 413) return json(res, 413, { error: 'too_large', message: 'データが大きすぎます' });
    if (e instanceof SyntaxError) return json(res, 400, { error: 'bad_json' });
    return json(res, 500, { error: 'server', message: 'サーバーでエラーが起きました' });
  }
}
