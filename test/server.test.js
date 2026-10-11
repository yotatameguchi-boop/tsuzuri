import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.TSUZURI_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-'));
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
const { default: handler } = await import('../api/index.js');

function call(method, url, { body, headers = {} } = {}) {
  const buf = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from(buf.length ? [buf] : []);
  Object.assign(req, { method, url, headers: { host: 'example.test', ...headers } });
  return new Promise(resolve => {
    const res = {
      status: 0, headers: {},
      writeHead(s, h) { this.status = s; this.headers = h; },
      end(b) { const text = Buffer.isBuffer(b) ? b : Buffer.from(b || ''); resolve({ status: this.status, headers: this.headers, text: text.toString(), raw: text }); },
    };
    handler(req, res);
  });
}

let cookie = '';

test('読者のページ：一覧・記事・404・サイトマップ・RSS', async () => {
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>インターン日誌<\/title>/);
  assert.match(home.text, /href="\/minutes-in-10-minutes"/);

  const post = await call('GET', '/minutes-in-10-minutes');
  assert.equal(post.status, 200);
  assert.match(post.text, /<meta property="og:title" content="インターン3か月目で身についた/);
  assert.match(post.text, /data-live="quiz"/);
  assert.match(post.text, /<link rel="canonical" href="http:\/\/example.test\/minutes-in-10-minutes">/);
  assert.match(post.text, /href="\/how-to-write"/, '記事どうしのリンクが /slug になる');

  assert.equal((await call('GET', '/no-such-post')).status, 404);
  assert.match((await call('GET', '/sitemap.xml')).text, /<loc>http:\/\/example.test\/how-to-write<\/loc>/);
  assert.match((await call('GET', '/feed.xml')).text, /<rss version="2.0">/);
  assert.match((await call('GET', '/robots.txt')).text, /Disallow: \/write/);
});

test('ログインしないと記事データを読めない・書けない', async () => {
  assert.equal((await call('GET', '/api/content')).status, 401);
  assert.equal((await call('PUT', '/api/content', { body: { rev: 0, data: {} } })).status, 401);
  assert.equal((await call('POST', '/api/upload', { body: 'x', headers: { 'content-type': 'image/png' } })).status, 401);
});

test('合言葉がちがうと入れず、合うとクッキーが出る', async () => {
  const bad = await call('POST', '/api/login', { body: { password: 'nope' } });
  assert.equal(bad.status, 401);
  const evil = await call('POST', '/api/login', { body: { password: 'tsuzuri' }, headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const ok = await call('POST', '/api/login', { body: { password: 'tsuzuri' } });
  assert.equal(ok.status, 200);
  cookie = ok.headers['Set-Cookie'].split(';')[0];
  assert.equal(JSON.parse((await call('GET', '/api/me', { headers: { cookie } })).text).writer, true);
  assert.equal(JSON.parse((await call('GET', '/api/me', { headers: { cookie: cookie + 'x' } })).text).writer, false);
});

test('保存：版がそろっていれば保存でき、古い版からは上書きできない。下書きは読者に見えない', async () => {
  const cur = JSON.parse((await call('GET', '/api/content', { headers: { cookie } })).text);
  const { rev, ...data } = cur;
  data.posts.push({ slug: 'secret-draft', title: '下書きの記事', date: '2026-10-12', draft: true, body: 'まだ秘密' });
  data.posts.push({ slug: 'new-one', title: '新しい記事', date: '2026-10-12', draft: false, body: 'こんにちは\n\n:::quiz 問題\n- *正解\n- ちがう\n:::' });
  const r = await call('PUT', '/api/content', { body: { rev, data }, headers: { cookie } });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.text).rev, rev + 1);

  const stale = await call('PUT', '/api/content', { body: { rev, data }, headers: { cookie } });
  assert.equal(stale.status, 409);

  const bad = await call('PUT', '/api/content', { body: { rev: rev + 1, data: { site: {}, posts: [{ slug: '../x', title: 't', body: '' }] } }, headers: { cookie } });
  assert.equal(bad.status, 400);

  const home = await call('GET', '/');
  assert.match(home.text, /新しい記事/);
  assert.doesNotMatch(home.text, /下書きの記事/);
  assert.equal((await call('GET', '/secret-draft')).status, 404);
  assert.equal((await call('GET', '/new-one')).status, 200);
  assert.doesNotMatch((await call('GET', '/sitemap.xml')).text, /secret-draft/);
});

test('画像をアップロードすると、記事に書けるURLが返る', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const r = await call('POST', '/api/upload', { body: png, headers: { cookie, 'content-type': 'image/png' } });
  assert.equal(r.status, 200);
  const url = JSON.parse(r.text).url;
  assert.match(url, /^\/media\/[\w-]+\.png$/);
  const got = await call('GET', url);
  assert.equal(got.status, 200);
  assert.deepEqual(got.raw, png);
  const svg = await call('POST', '/api/upload', { body: '<svg/>', headers: { cookie, 'content-type': 'image/svg+xml' } });
  assert.equal(svg.status, 415, 'SVG はスクリプトを含められるので受け付けない');
});
