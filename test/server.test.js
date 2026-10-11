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

function call(method, url, { body, headers = {}, cookie } = {}) {
  const buf = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from(buf.length ? [buf] : []);
  Object.assign(req, { method, url, headers: { host: 'example.test', ...(cookie ? { cookie } : {}), ...headers } });
  return new Promise(resolve => {
    const res = {
      headersSent: false,
      writeHead(s, h) { this.status = s; this.headers = h; this.headersSent = true; },
      end(b) {
        const raw = Buffer.isBuffer(b) ? b : Buffer.from(b || '');
        let j = null;
        try { j = JSON.parse(raw.toString()); } catch {}
        resolve({ status: this.status, headers: this.headers, text: raw.toString(), raw, json: j, cookie: (this.headers['Set-Cookie'] || '').split(';')[0] });
      },
    };
    handler(req, res);
  });
}

const S = {};

test('読者のページ：一覧・記事・404・サイトマップ・RSS', async () => {
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>インターン日誌<\/title>/);
  assert.equal(home.headers['Vercel-Cache-Tag'], 'tsuzuri-pages');
  const post = await call('GET', '/minutes-in-10-minutes');
  assert.equal(post.status, 200);
  assert.match(post.text, /data-live="quiz"/, 'クイズそのものは動く');
  assert.doesNotMatch(post.text, /class="chip"|class="kind"/, '「クイズ」「グラフ」などの種類のラベルは読者に出さない');
  assert.doesNotMatch(home.text, /class="chip"/);
  assert.match(post.text, /href="\/how-to-write"/);
  assert.equal((await call('GET', '/no-such-post')).status, 404);
  assert.match((await call('GET', '/sitemap.xml')).text, /how-to-write/);
  assert.match((await call('GET', '/feed.xml')).text, /<rss version="2.0">/);
});

test('最初の管理者は、サイトの合言葉を知っている人だけが作れる', async () => {
  assert.equal((await call('GET', '/api/me')).json.setupNeeded, true);
  const acct = { name: '為口', loginId: 'yota', password: 'correct-horse-1' };
  assert.equal((await call('POST', '/api/setup', { body: { ...acct, setupKey: 'nope' } })).status, 401);
  assert.equal((await call('POST', '/api/setup', { body: { ...acct, loginId: 'A!', setupKey: 'tsuzuri' } })).status, 400);
  const ok = await call('POST', '/api/setup', { body: { ...acct, setupKey: 'tsuzuri' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.role, 'admin');
  S.admin = ok.cookie;
  assert.equal((await call('POST', '/api/setup', { body: { ...acct, loginId: 'other', setupKey: 'tsuzuri' } })).status, 409);
  const content = (await call('GET', '/api/content', { cookie: S.admin })).json;
  assert.ok(content.posts.every(p => p.authorName === '為口'), 'それまでの記事は最初の管理者のものになる');
  assert.match((await call('GET', '/minutes-in-10-minutes')).text, /<span>為口<\/span>/);
});

test('ログイン：IDかパスワードがちがうと入れない。別サイトからの送信は断る', async () => {
  assert.equal((await call('POST', '/api/login', { body: { loginId: 'yota', password: 'wrong-pass' } })).status, 401);
  assert.equal((await call('POST', '/api/login', { body: { loginId: 'yota', password: 'correct-horse-1' }, headers: { origin: 'https://evil.example' } })).status, 403);
  const ok = await call('POST', '/api/login', { body: { loginId: 'YOTA', password: 'correct-horse-1' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/me', { cookie: ok.cookie })).json.user.name, '為口');
  assert.equal((await call('GET', '/api/me', { cookie: ok.cookie + 'x' })).json.user, null);
});

test('招待リンクで書き手が参加できる。リンクは1回しか使えない', async () => {
  assert.equal((await call('POST', '/api/invites', { body: { role: 'writer' } })).status, 401);
  const inv = await call('POST', '/api/invites', { body: { role: 'writer' }, cookie: S.admin });
  assert.equal(inv.status, 200);
  const acc = await call('POST', '/api/accept', { body: { token: inv.json.token, name: '佐藤', loginId: 'sato', password: 'sato-pass-123' } });
  assert.equal(acc.status, 200);
  assert.equal(acc.json.user.role, 'writer');
  S.writer = acc.cookie;
  S.writerId = acc.json.user.id;
  assert.equal((await call('POST', '/api/accept', { body: { token: inv.json.token, name: '鈴木', loginId: 'suzuki', password: 'suzuki-pass-1' } })).status, 400);
  assert.equal((await call('POST', '/api/accept', { body: { token: 'made-up', name: '鈴木', loginId: 'suzuki', password: 'suzuki-pass-1' } })).status, 400);
});

test('書き手は自分の記事だけ書ける。サイト設定とメンバー管理はできない', async () => {
  const mine = await call('PUT', '/api/posts/w1', { cookie: S.writer, body: { post: { slug: 'sato-first', title: '佐藤の記事', body: 'こんにちは', draft: false } } });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.post.authorName, '佐藤');
  assert.equal(mine.json.post.rev, 1);
  const edit = await call('PUT', '/api/posts/w1', { cookie: S.writer, body: { baseRev: 1, post: { slug: 'sato-first', title: '佐藤の記事（直した）', body: 'こんにちは', draft: false } } });
  assert.equal(edit.status, 200);
  assert.equal(edit.json.post.rev, 2);

  const others = await call('PUT', '/api/posts/minutes-in-10-minutes', { cookie: S.writer, body: { baseRev: 1, post: { slug: 'minutes-in-10-minutes', title: '乗っ取り', body: '' } } });
  assert.equal(others.status, 403);
  assert.equal((await call('DELETE', '/api/posts/minutes-in-10-minutes', { cookie: S.writer, body: { baseRev: 1 } })).status, 403);
  assert.equal((await call('PUT', '/api/site', { cookie: S.writer, body: { name: 'x' } })).status, 403);
  assert.equal((await call('GET', '/api/users', { cookie: S.writer })).status, 403);
  assert.equal((await call('POST', '/api/invites', { cookie: S.writer, body: {} })).status, 403);

  const adminEdit = await call('PUT', '/api/posts/w1', { cookie: S.admin, body: { baseRev: 2, post: { slug: 'sato-first', title: '管理者が直した', body: 'こんにちは', draft: false } } });
  assert.equal(adminEdit.status, 200, '管理者はほかの人の記事も直せる');
  assert.equal(adminEdit.json.post.authorName, '佐藤', '書いた人は変わらない');
  assert.match((await call('GET', '/sato-first')).text, /管理者が直した/, '公開した瞬間に読者のページに出る');
});

test('古い版からの上書きは止まり、別々の記事の同時保存はどちらも残る', async () => {
  const stale = await call('PUT', '/api/posts/w1', { cookie: S.writer, body: { baseRev: 2, post: { slug: 'sato-first', title: '古い版から', body: '', draft: false } } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.post.title, '管理者が直した');
  const [a, b] = await Promise.all([
    call('PUT', '/api/posts/c1', { cookie: S.admin, body: { post: { slug: 'same-time-a', title: 'A', body: 'a' } } }),
    call('PUT', '/api/posts/c2', { cookie: S.writer, body: { post: { slug: 'same-time-b', title: 'B', body: 'b' } } }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const slugs = (await call('GET', '/api/content', { cookie: S.admin })).json.posts.map(p => p.slug);
  assert.ok(slugs.includes('same-time-a') && slugs.includes('same-time-b'));
  assert.equal((await call('PUT', '/api/posts/c3', { cookie: S.admin, body: { post: { slug: 'same-time-a', title: 'dup', body: '' } } })).status, 400, 'URLの重複は断る');
});

test('下書きは読者に見えない', async () => {
  await call('PUT', '/api/posts/d1', { cookie: S.admin, body: { post: { slug: 'secret-draft', title: '下書きの記事', body: 'まだ秘密', draft: true } } });
  assert.doesNotMatch((await call('GET', '/')).text, /下書きの記事/);
  assert.equal((await call('GET', '/secret-draft')).status, 404);
  assert.doesNotMatch((await call('GET', '/sitemap.xml')).text, /secret-draft/);
});

test('パスワードを変えると、ほかの端末のログインは切れる', async () => {
  const other = (await call('POST', '/api/login', { body: { loginId: 'sato', password: 'sato-pass-123' } })).cookie;
  assert.equal((await call('POST', '/api/account', { cookie: S.writer, body: { currentPassword: 'wrong', newPassword: 'sato-new-456' } })).status, 401);
  const ch = await call('POST', '/api/account', { cookie: S.writer, body: { currentPassword: 'sato-pass-123', newPassword: 'sato-new-456' } });
  assert.equal(ch.status, 200);
  S.writer = ch.cookie;
  assert.equal((await call('GET', '/api/me', { cookie: other })).json.user, null);
  assert.equal((await call('GET', '/api/me', { cookie: S.writer })).json.user.loginId, 'sato');
  const rn = await call('POST', '/api/account', { cookie: S.writer, body: { name: '佐藤花子' } });
  assert.equal(rn.status, 200);
  assert.match((await call('GET', '/sato-first')).text, /佐藤花子/, '名前を変えると記事の署名も変わる');
});

test('利用停止と、最後の管理者を守る決まり', async () => {
  const list = (await call('GET', '/api/users', { cookie: S.admin })).json.users;
  const admin = list.find(u => u.role === 'admin');
  assert.equal((await call('PATCH', `/api/users/${admin.id}`, { cookie: S.admin, body: { role: 'writer' } })).status, 400);
  assert.equal((await call('PATCH', `/api/users/${S.writerId}`, { cookie: S.admin, body: { disabled: true } })).status, 200);
  assert.equal((await call('GET', '/api/me', { cookie: S.writer })).json.user, null);
  assert.equal((await call('POST', '/api/login', { body: { loginId: 'sato', password: 'sato-new-456' } })).status, 401);
});

test('画像・動画：ログインした人だけ。形式を確かめる', async () => {
  assert.equal((await call('POST', '/api/upload-url', { body: { type: 'image/png', size: 10 } })).status, 401);
  assert.equal((await call('POST', '/api/upload-url', { cookie: S.admin, body: { type: 'image/svg+xml', size: 10 } })).status, 415);
  assert.equal((await call('POST', '/api/upload-url', { cookie: S.admin, body: { type: 'video/mp4', size: 200 * 1024 * 1024 } })).status, 413);
  assert.equal((await call('POST', '/api/upload-url', { cookie: S.admin, body: { type: 'image/png', size: 8 } })).json.direct, '/api/upload');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const up = await call('POST', '/api/upload', { cookie: S.admin, body: png, headers: { 'content-type': 'image/png' } });
  assert.equal(up.status, 200);
  assert.deepEqual((await call('GET', up.json.url)).raw, png);
});

test('パスワードを忘れた人には、管理者が再設定リンクを出せる。記事はそのまま本人のもの', async () => {
  assert.equal((await call('POST', `/api/users/${S.writerId}/reset`, { cookie: S.writer })).status, 401);
  const r = await call('POST', `/api/users/${S.writerId}/reset`, { cookie: S.admin });
  assert.equal(r.status, 200);
  const info = await call('GET', `/api/invite-info?token=${r.json.token}`);
  assert.equal(info.json.kind, 'reset');
  assert.equal(info.json.loginId, 'sato');
  const ok = await call('POST', '/api/accept', { body: { token: r.json.token, password: 'sato-reset-789' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.id, S.writerId, '同じアカウントのまま');
  assert.equal(ok.json.user.disabled, false, '止めていた利用も再開する');
  const edit = await call('PUT', '/api/posts/w1', { cookie: ok.cookie, body: { baseRev: 3, post: { slug: 'sato-first', title: '戻ってきた', body: '', draft: false } } });
  assert.equal(edit.status, 200, '自分の記事をまた直せる');
  assert.equal((await call('POST', '/api/accept', { body: { token: r.json.token, password: 'again-again-1' } })).status, 400, '1回だけ使える');
});
