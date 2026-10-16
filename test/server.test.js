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

test('整理：カテゴリ・親の記事・並び順。棚・パンくず・この中の記事・前後の記事が出る', async () => {
  const put = (id, post, baseRev) => call('PUT', `/api/posts/${id}`, { cookie: S.admin, body: { baseRev, post: { draft: false, body: '本文', ...post } } });
  assert.equal((await put('m0', { slug: 'manual', title: '使い方マニュアル', category: 'マニュアル', order: 1 })).status, 200);
  assert.equal((await put('m1', { slug: 'manual-login', title: 'ログインのしかた', category: 'マニュアル', parent: 'm0', order: 1 })).status, 200);
  assert.equal((await put('m2', { slug: 'manual-write', title: '記事の書き方', category: 'マニュアル', parent: 'm0', order: 2 })).status, 200);
  const cyc = await put('m0', { slug: 'manual', title: '使い方マニュアル', category: 'マニュアル', parent: 'm2' }, 1);
  assert.equal(cyc.status, 400, '自分の下の記事を親にはできない');

  const home = await call('GET', '/');
  assert.match(home.text, /<section class="shelf"><h2><a href="\/c\/%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB">マニュアル<\/a>/);
  const cat = await call('GET', '/c/' + encodeURIComponent('マニュアル'));
  assert.equal(cat.status, 200);
  assert.ok(cat.text.indexOf('ログインのしかた') < cat.text.indexOf('記事の書き方'), '並び順のとおり');
  const parent = await call('GET', '/manual');
  assert.match(parent.text, /この中の記事[\s\S]*ログインのしかた[\s\S]*記事の書き方/);
  const child = await call('GET', '/manual-login');
  assert.match(child.text, /class="crumbs"><a href="\/">インターン日誌<\/a>.*マニュアル.*使い方マニュアル/);
  assert.match(child.text, /class="next" href="\/manual-write"/);
  assert.equal((await call('GET', '/c/' + encodeURIComponent('ない棚'))).status, 404);
});

test('検索：全角半角・大文字小文字・カタカナひらがなのちがいを気にしない', async () => {
  const r = await call('GET', '/search?q=' + encodeURIComponent('議事録 型'));
  assert.equal(r.status, 200);
  assert.match(r.text, /インターン3か月目で身についた/);
  assert.match(r.text, /<mark>議事録<\/mark>/);
  assert.match((await call('GET', '/search?q=' + encodeURIComponent('ＴＳＵＺＵＲＩ'))).text, /Tsuzuri の書き方/);
  await call('PUT', '/api/posts/k1', { cookie: S.admin, body: { post: { slug: 'kana', title: 'ひらがなの記事', body: 'ツヅリで書いた', draft: false } } });
  assert.match((await call('GET', '/search?q=' + encodeURIComponent('つづり'))).text, /ひらがなの記事/);
  assert.match((await call('GET', '/search?q=' + encodeURIComponent('存在しない言葉xyz'))).text, /見つかりませんでした/);
});

test('読む人を限定：メンバー限定の記事と、サイト全体をメンバーだけにする設定', async () => {
  const inv = await call('POST', '/api/invites', { cookie: S.admin, body: { role: 'reader' } });
  const acc = await call('POST', '/api/accept', { body: { token: inv.json.token, name: '読む人', loginId: 'reader1', password: 'reader-pass-1' } });
  assert.equal(acc.json.user.role, 'reader');
  const reader = acc.cookie;
  assert.equal((await call('GET', '/api/content', { cookie: reader })).status, 403, '閲覧専用は書く画面のデータを読めない');
  assert.equal((await call('PUT', '/api/posts/r1', { cookie: reader, body: { post: { slug: 'r1', title: 'x', body: '' } } })).status, 403);

  await call('PUT', '/api/posts/s1', { cookie: S.admin, body: { post: { slug: 'internal-rule', title: '社内だけの規程', body: '社外秘', draft: false, visibility: 'members' } } });
  assert.equal((await call('GET', '/internal-rule')).status, 404, 'ログインしていない人には無い');
  const asReader = await call('GET', '/internal-rule', { cookie: reader });
  assert.equal(asReader.status, 200);
  assert.match(asReader.text, /メンバー限定/);
  assert.match(asReader.headers['Cache-Control'], /private, no-store/, '人によって中身が変わるので CDN に置かない');
  assert.doesNotMatch((await call('GET', '/')).text, /社内だけの規程/);
  assert.match((await call('GET', '/', { cookie: reader })).text, /社内だけの規程/);
  assert.doesNotMatch((await call('GET', '/sitemap.xml')).text, /internal-rule/);
  assert.doesNotMatch((await call('GET', '/feed.xml')).text, /社内だけの規程/);
  assert.doesNotMatch((await call('GET', '/search?q=' + encodeURIComponent('規程'))).text, /社内だけの規程/);

  const site = (await call('GET', '/api/content', { cookie: S.admin })).json.site;
  assert.equal((await call('PUT', '/api/site', { cookie: S.admin, body: { ...site, visibility: 'members' } })).status, 200);
  const gate = await call('GET', '/minutes-in-10-minutes');
  assert.equal(gate.status, 401);
  assert.match(gate.text, /メンバーだけが読めます/);
  assert.equal((await call('GET', '/minutes-in-10-minutes', { cookie: reader })).status, 200);
  assert.match((await call('GET', '/robots.txt')).text, /Disallow: \/\n/);
  assert.equal((await call('PUT', '/api/site', { cookie: S.admin, body: { ...site, visibility: 'public' } })).status, 200);
  assert.equal((await call('GET', '/minutes-in-10-minutes')).status, 200);
});

test('記法：脚注・数式・コードの言語・添付ファイル', async () => {
  const body = '注のある文[^1]。式 $a^2+b^2=c^2$ と値段 $100。\n\n$$\n\\sum_{i=1}^n i\n$$\n\n```python\nprint("hi")\n```\n\n[規程.pdf](https://example.com/rule.pdf)\n\n[^1]: これが注です。';
  await call('PUT', '/api/posts/n1', { cookie: S.admin, body: { post: { slug: 'notation', title: '記法の確認', body, draft: false } } });
  const t = (await call('GET', '/notation')).text;
  assert.match(t, /<sup class="fn"><a href="#fn-1" id="fnref-1">1<\/a><\/sup>/);
  assert.match(t, /<li id="fn-1">これが注です。/);
  assert.match(t, /<span class="math" data-tex="a\^2\+b\^2=c\^2">/);
  assert.match(t, /値段 \$100/, '金額は数式にしない');
  assert.match(t, /class="math math-block" data-tex="\\sum_\{i=1\}\^n i"/);
  assert.match(t, /<code class="language-python">/);
  assert.match(t, /class="card file" href="https:\/\/example.com\/rule.pdf"[\s\S]*PDF・添付ファイル/);
});

test('書き出し：管理者は全記事をJSONで持ち出せる。添付ファイルも上げられる', async () => {
  const ex = await call('GET', '/api/export', { cookie: S.admin });
  assert.equal(ex.status, 200);
  assert.match(ex.headers['Content-Disposition'], /attachment; filename="tsuzuri-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(ex.json.format, 'tsuzuri');
  assert.ok(ex.json.posts.length > 5);
  assert.equal(ex.json.users, undefined, 'アカウント情報は含めない');
  const w = (await call('POST', '/api/login', { body: { loginId: 'sato', password: 'sato-reset-789' } })).cookie;
  assert.equal((await call('GET', '/api/export', { cookie: w })).status, 403);
  assert.equal((await call('POST', '/api/upload-url', { cookie: S.admin, body: { type: 'application/pdf', size: 1000 } })).status, 200);
  assert.equal((await call('POST', '/api/upload-url', { cookie: S.admin, body: { type: 'text/html', size: 10 } })).status, 415);
});

test('複数のメディア：名前・色・URLのちがうメディアを1つの Tsuzuri から出せる', async () => {
  assert.equal((await call('PUT', '/api/media/m2', { cookie: S.writer2 || S.admin, body: { name: 'まちのたより', slug: 'write', mark: 'あ' } })).status, 400, 'サイトの仕組みで使う名前はURLにできない');
  const w = (await call('POST', '/api/login', { body: { loginId: 'sato', password: 'sato-reset-789' } })).cookie;
  assert.equal((await call('PUT', '/api/media/m2', { cookie: w, body: { name: 'まちのたより', slug: 'machi' } })).status, 403, '書き手はメディアを作れない');

  const content = (await call('GET', '/api/content', { cookie: S.admin })).json;
  const first = content.media[0];
  assert.equal(first.slug, 'main');
  assert.equal((await call('PUT', `/api/media/${first.id}`, { cookie: S.admin, body: { ...first, slug: 'nisshi' } })).status, 200);
  assert.equal((await call('PUT', '/api/media/m2', { cookie: S.admin, body: { name: 'まちのたより', slug: 'machi', mark: 'まち', color: 'green', tagline: '地元の話を地元の人が書く' } })).status, 200);
  assert.equal((await call('PUT', '/api/media/m3', { cookie: S.admin, body: { name: 'くらしノート', slug: 'kurashi', color: 'orange' } })).status, 200);
  assert.equal((await call('PUT', '/api/media/m4', { cookie: S.admin, body: { name: '重複', slug: 'machi' } })).status, 400, 'URLの重複は断る');
  assert.equal((await call('PUT', '/api/media/m4', { cookie: S.admin, body: { name: '記事と重複', slug: 'manual' } })).status, 400, '記事のURLとも重ならない');

  const put = await call('PUT', '/api/posts/a1', { cookie: S.admin, body: { post: { slug: 'station-cafe', title: '駅前のカフェ巡り', body: '[[使い方マニュアル]] も読んでね', draft: false, media: 'm2' } } });
  assert.equal(put.status, 200);
  assert.equal(put.json.post.media, 'm2');

  const portal = await call('GET', '/');
  assert.match(portal.text, /class="media-card"[\s\S]*まちのたより[\s\S]*くらしノート/);
  assert.match(portal.text, /href="\/machi\/"/);
  const home = await call('GET', '/machi/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>まちのたより<\/title>/);
  assert.match(home.text, /<span class="k two">まち<\/span><span class="w">まちのたより<\/span>/, 'ロゴと名前がメディアごとに変わる');
  assert.match(home.text, /--blue:#12804e/, '色もメディアごと');
  assert.doesNotMatch(home.text, /議事録/, 'ほかのメディアの記事は出ない');
  assert.equal((await call('GET', '/machi')).status, 301);

  const post = await call('GET', '/machi/station-cafe');
  assert.equal(post.status, 200);
  assert.match(post.text, /href="\/nisshi\/manual"/, 'ほかのメディアの記事へのリンクも正しいURLになる');
  const old = await call('GET', '/minutes-in-10-minutes');
  assert.equal(old.status, 301, '前のURLは新しい場所へ案内する');
  assert.equal(old.headers.Location, '/nisshi/minutes-in-10-minutes');
  assert.equal((await call('GET', '/kurashi/minutes-in-10-minutes')).status, 301, '別のメディアの下で開いても正しい場所へ');
  assert.match((await call('GET', '/machi/feed.xml')).text, /<title>まちのたより<\/title>[\s\S]*駅前のカフェ巡り/);
  assert.doesNotMatch((await call('GET', '/machi/search?q=' + encodeURIComponent('議事録'))).text, /class="result"/, 'メディアの中の検索はそのメディアだけ');
  assert.match((await call('GET', '/search?q=' + encodeURIComponent('カフェ'))).text, /まちのたより/, '全体の検索はメディア名つき');
  assert.match((await call('GET', '/sitemap.xml')).text, /\/machi\/station-cafe/);

  /* メディアごとのデザイン（ひな形）と追加のCSS */
  assert.equal((await call('PUT', '/api/media/m2', { cookie: S.admin, body: { name: 'まちのたより', slug: 'machi', mark: 'まち', color: 'green', theme: 'natural', css: '.prose h2{letter-spacing:.2em}</style><script>alert(1)</script>' } })).status, 200);
  const themed = (await call('GET', '/machi/')).text;
  assert.match(themed, /family=Kiwi\+Maru/, 'ひな形の書体を読み込む');
  assert.match(themed, /--bg:#f7f4ec/, 'ひな形の背景');
  assert.match(themed, /\.prose h2\{letter-spacing:\.2em\}/, '追加のCSSが入る');
  assert.doesNotMatch(themed, /<\/style><script>/, '追加のCSSから <style> の外へ抜け出せない');
  assert.doesNotMatch((await call('GET', '/nisshi/')).text, /Kiwi\+Maru|letter-spacing:\.2em/, 'ほかのメディアには効かない');
  assert.equal((await call('PUT', '/api/media/m2', { cookie: S.admin, body: { name: 'まちのたより', slug: 'machi', theme: 'nope' } })).status, 200);
  assert.doesNotMatch((await call('GET', '/machi/')).text, /Kiwi\+Maru/, '知らないひな形は標準になる');

  /* デザインを細かく変える：表紙・一覧の並べ方・ロゴ画像・フッター */
  assert.equal((await call('PUT', '/api/media/m2', { cookie: S.admin, body: { name: 'まちのたより', slug: 'machi', theme: 'natural', design: { cover: 'https://example.com/cover.jpg', list: 'cards', logo: 'https://example.com/logo.png', footer: '© まちかも編集部', accent: '#e91e63', h2: 'band', evil: '<script>' } } })).status, 200);
  const designed = (await call('GET', '/machi/')).text;
  assert.match(designed, /class="cover" style="background-image:url\('https:\/\/example.com\/cover.jpg'\)"/);
  assert.match(designed, /class="post-cards"/);
  assert.match(designed, /<span class="k img"><img src="https:\/\/example.com\/logo.png"/);
  assert.match(designed, /© まちかも編集部/);
  assert.doesNotMatch(designed, /evil|<script>/);
  const saved = (await call('GET', '/api/content', { cookie: S.admin })).json.media.find(m => m.id === 'm2');
  assert.equal(saved.design.evil, undefined, '知らない設定は保存しない');

  /* 原稿の先頭（--- で挟む）で、メディア・デザイン・色・カテゴリを切り替える */
  const fm = '---\nメディア: くらしノート\nデザイン: ポップ\n色: 紫\nカテゴリ: お祭り\n並び順: ３\n---\n秋祭りの準備は2か月前から始まります。\n\n---\n\n区切り線のあと。';
  const fmPut = await call('PUT', '/api/posts/f1', { cookie: S.admin, body: { post: { slug: 'aki-matsuri', title: '秋祭りの準備', body: fm, draft: false, media: 'm2' } } });
  assert.equal(fmPut.status, 200);
  assert.equal(fmPut.json.post.media, 'm3', '原稿の先頭の「メディア」が、記事の設定より優先される');
  assert.equal(fmPut.json.post.category, 'お祭り');
  assert.equal(fmPut.json.post.order, 3, '全角の数字も読める');
  assert.equal(fmPut.json.post.theme, 'pop');
  const fmPage = (await call('GET', '/kurashi/aki-matsuri')).text;
  assert.match(fmPage, /family=Zen\+Maru\+Gothic/, 'この記事だけデザインがポップになる');
  assert.match(fmPage, /--blue:#6847b8/, 'この記事だけ色が紫になる');
  assert.doesNotMatch(fmPage, /メディア: くらしノート/, '先頭の設定は本文には出ない');
  assert.match(fmPage, /<hr>/, '本文の中の --- は区切り線のまま');
  assert.doesNotMatch((await call('GET', '/kurashi/')).text, /Zen\+Maru\+Gothic/, 'メディアのトップはメディアのデザインのまま');
  assert.equal((await call('GET', '/machi/aki-matsuri')).status, 301, '前のメディアのURLは新しい場所へ案内する');

  await call('PUT', '/api/media/m3', { cookie: S.admin, body: { name: 'くらしノート', slug: 'kurashi', color: 'orange', visibility: 'members' } });
  assert.equal((await call('GET', '/kurashi/')).status, 401, 'メンバーだけのメディア');
  assert.doesNotMatch((await call('GET', '/')).text, /くらしノート/);
  assert.equal((await call('DELETE', '/api/media/m2', { cookie: S.admin })).status, 400, '記事があるメディアは消せない');
  assert.equal((await call('DELETE', '/api/media/m3', { cookie: S.admin })).status, 400, '原稿の先頭で移した記事があるので消せない');
  assert.equal((await call('DELETE', '/api/posts/f1', { cookie: S.admin, body: { baseRev: 1 } })).status, 200);
  assert.equal((await call('DELETE', '/api/media/m3', { cookie: S.admin })).status, 200);
});

test('Webサイトとして：固定ページ・トップページ・メニュー・ページの部品', async () => {
  const content = (await call('GET', '/api/content', { cookie: S.admin })).json;
  const main = content.media[0];
  const put = (id, post) => call('PUT', `/api/posts/${id}`, { cookie: S.admin, body: { post: { draft: false, media: main.id, ...post } } });
  const top = '---\n種類: ページ\n---\n:::hero 地域の暮らしを、もっと近くに\n町の店と人を紹介しています。\n[[相談する]](contact)\n:::\n\n:::cards 3つの特徴\n@ 取材\n足で集めた話\n@ 地図\nお店の場所\n:::\n\n:::faq よくある質問\n@ 無料ですか？\nはい。\n:::\n\n:::posts 新着記事 | 3\n:::\n\nhttps://www.youtube.com/watch?v=abcdefghijk';
  const r1 = await put('pg-top', { slug: 'top', title: 'トップ', body: top });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.post.kind, 'page', '原稿の先頭の「種類: ページ」で固定ページになる');
  await put('pg-about', { slug: 'about', title: '会社概要', body: '所在地や連絡先です。', kind: 'page' });

  /* 固定ページは記事の一覧・RSS に出ない */
  const media = (await call('GET', '/api/content', { cookie: S.admin })).json.media;
  const firstMedia = media[0];
  const base = media.length > 1 ? '/' + firstMedia.slug : '';
  assert.doesNotMatch((await call('GET', base + '/')).text, /会社概要/);
  assert.doesNotMatch((await call('GET', base + '/feed.xml')).text, /会社概要/);
  assert.match((await call('GET', '/sitemap.xml')).text, /\/about</, 'サイトマップには入る');
  const about = (await call('GET', base + '/about')).text;
  assert.match(about, /class="page-body"/);
  assert.match(about, /<h1>会社概要<\/h1>/);
  assert.doesNotMatch(about, /分で読めます/, '固定ページには日付や読む時間を出さない');

  /* トップページとメニュー */
  const menu = '- [ホーム](/)\n- [会社概要](about)\n- [サービス](services)\n  - [料金](pricing)\n- [記事](articles)\n- [外のサイト](https://example.com)';
  assert.equal((await call('PUT', `/api/media/${firstMedia.id}`, { cookie: S.admin, body: { ...firstMedia, home: 'pg-top', menu } })).status, 200);
  const home = (await call('GET', base + '/')).text;
  assert.match(home, /class="sec hero"[\s\S]*<h1>地域の暮らしを、もっと近くに<\/h1>/, 'トップが固定ページになり、ヒーローの見出しが h1');
  assert.doesNotMatch(home, /<header class="page-head">/, 'ヒーローで始まるページはタイトルを重ねて出さない');
  assert.match(home, /class="sec cards"[\s\S]*<h3>取材<\/h3>/);
  assert.match(home, /<details class="faq-q"><summary>無料ですか？/);
  assert.match(home, /class="post-cards"/, '記事の一覧を埋め込める');
  assert.match(home, /<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/abcdefghijk"/);
  assert.match(home, new RegExp(`<nav class="site-menu"[\\s\\S]*href="${base}/about">会社概要<\\/a>`));
  assert.match(home, /class="has-sub"><span class="menu-label">サービス|class="has-sub"><a href="[^"]*services">サービス<\/a><ul class="sub"><li><a href="[^"]*pricing">料金/);
  assert.match(home, /href="https:\/\/example.com" target="_blank" rel="noopener">外のサイト/);
  const list = await call('GET', base + '/articles');
  assert.equal(list.status, 200);
  assert.match(list.text, /<h1>記事の一覧<\/h1>/, 'トップを固定ページにしても、記事の一覧は /articles で読める');
  assert.equal((await call('PUT', `/api/media/${firstMedia.id}`, { cookie: S.admin, body: { ...firstMedia, home: 'no-such-page' } })).status, 200);
  assert.equal((await call('GET', '/api/content', { cookie: S.admin })).json.media[0].home, '', '固定ページでないものはトップにできない');
});

test('問い合わせフォーム：受け付け、迷惑な送信を断り、管理者の受信箱に入る', async () => {
  const send = (body, headers = {}) => call('POST', '/api/forms', { body, headers: { 'content-type': 'application/json', ...headers } });
  const ok = await send({ _form: 'お問い合わせ', _page: '/contact', _t: '12', お名前: '山田', メールアドレス: 'y@example.com', 内容: '見積もりをお願いします' });
  assert.equal(ok.status, 200);
  assert.equal((await send({ _t: '0', お名前: 'bot' })).status, 400, '開いてすぐの送信は断る');
  assert.equal((await send({ _t: '9', _hp: 'spam', お名前: 'bot' })).status, 200, '見えない欄に入力があると、受け付けたふりをして捨てる');
  assert.equal((await send({ _t: '9' })).status, 400, '中身が空なら断る');
  assert.equal((await send({ _t: '9', a: 'b' }, { origin: 'https://evil.example' })).status, 403, 'ほかのサイトからの送信は断る');
  const form = await call('POST', '/api/forms', { body: 'お名前=%E4%BD%90%E8%97%A4&_form=%E5%95%8F%E3%81%84%E5%90%88%E3%82%8F%E3%81%9B&_page=%2Fcontact', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 200);
  assert.match(form.text, /送信しました/, 'JavaScript が動かなくても送れる');

  assert.equal((await call('GET', '/api/inbox')).status, 401);
  const w = (await call('POST', '/api/login', { body: { loginId: 'sato', password: 'sato-reset-789' } })).cookie;
  assert.equal((await call('GET', '/api/inbox', { cookie: w })).status, 403, '受信箱は管理者だけ');
  const inbox = (await call('GET', '/api/inbox', { cookie: S.admin })).json.messages;
  assert.equal(inbox.length, 2, 'まともな2件だけが入る');
  assert.equal(inbox[1].fields.find(f => f.label === 'メールアドレス').value, 'y@example.com');
  assert.ok(!inbox.some(m => m.fields.some(f => f.value === 'bot')));
  assert.equal((await call('PATCH', `/api/inbox/${inbox[0].id}`, { cookie: S.admin, body: { read: true } })).status, 200);
  assert.equal((await call('GET', '/api/inbox', { cookie: S.admin })).json.messages[0].read, true);

  const site = (await call('GET', '/api/content', { cookie: S.admin })).json.site;
  assert.equal((await call('PUT', '/api/site', { cookie: S.admin, body: { ...site, formWebhook: 'http://insecure.example' } })).status, 400, '通知先は https だけ');
  assert.equal((await call('PUT', '/api/site', { cookie: S.admin, body: { ...site, formWebhook: 'https://hooks.example.com/abc' } })).status, 200);
  assert.equal((await call('GET', '/api/content', { cookie: w })).json.site.formWebhook, '(設定済み)', '通知先のURLは書き手には見せない');
  await call('PUT', '/api/site', { cookie: S.admin, body: { ...site, formWebhook: '' } });
});
