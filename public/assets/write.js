/* 書く人の画面（/write）。ログイン → 記事一覧 → 編集。管理者はメンバーも管理できる。 */
import { esc, renderBody, liveKinds, excerpt, frontMatter, resolveMeta } from './render.js';
import { hydrate, hideTip } from './live.js';
import { THEMES, COLORS, OPTIONS, DESIGN_KEYS, cleanDesign, designCss, fontFamilies, palette, accentOf } from './design.js';

const $ = id => document.getElementById(id);
const root = $('root');
const S = { me: null, data: null, view: 'list', editId: null, dirty: false, pending: {}, pane: 'src', saving: false };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = d => (d || '').replace(/-/g, '.');
const readMin = body => Math.max(1, Math.round(String(body || '').replace(/\s/g, '').length / 500));
const isAdmin = () => S.me && S.me.role === 'admin';
const canEdit = p => isAdmin() || !p.rev || p.author === S.me.id;
const ROLE = { admin: '管理者', writer: '書き手', reader: '閲覧者' };
const POST_FIELDS = ['slug', 'title', 'body', 'date', 'draft', 'category', 'parent', 'order', 'visibility', 'media', 'theme', 'color', 'kind'];
const pick = p => Object.fromEntries(POST_FIELDS.map(k => [k, p[k] ?? null]));
const nextPath = () => { const n = new URLSearchParams(location.search).get('next'); return n && /^\/(?!\/)/.test(n) ? n : null; };

function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...(typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  let body = null;
  try { body = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, body: body || {} };
}
const post = (path, data, method = 'POST') => api(path, { method, body: JSON.stringify(data || {}) });

/* フォームの共通処理：送信中はボタンを止め、エラーは下に出す */
function bindForm(form, handler) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('.err');
    if (btn) btn.disabled = true;
    if (err) err.textContent = '';
    try {
      const msg = await handler(Object.fromEntries(new FormData(form)));
      if (msg && err) err.textContent = msg;
    } finally { if (btn) btn.disabled = false; }
  });
}

/* ---- 入口：ログイン・最初の管理者づくり・招待の受け取り ---- */
function renderGate(kind, note = '') {
  $('nav').innerHTML = '';
  document.title = '書く | Tsuzuri';
  const pw = (name, label, ac) => `<label class="field">${label}<input type="password" name="${name}" autocomplete="${ac}" required minlength="${ac === 'new-password' ? 8 : 1}"></label>`;
  const acct = `<label class="field">名前（記事に表示されます）<input name="name" autocomplete="name" required maxlength="40"></label>
    <label class="field">ログインID（半角英小文字・数字、3文字以上）<input name="loginId" autocomplete="username" required pattern="[a-z0-9][a-z0-9._\\-]{2,31}" autocapitalize="none"></label>
    ${pw('password', 'パスワード（8文字以上）', 'new-password')}`;
  const forms = {
    login: `<h1>ログイン</h1><p>${esc(note) || 'ログインIDとパスワードを入れてください。'}</p>
      <label class="field">ログインID<input name="loginId" autocomplete="username" required autocapitalize="none"></label>
      ${pw('password', 'パスワード', 'current-password')}
      <div class="err" role="alert"></div><button class="btn primary" type="submit">ログイン</button>
      <p>アカウントは、管理者から届く招待リンクで作れます。</p>`,
    setup: `<h1>はじめに、管理者を作ります</h1><p>このサイトを最初に設定する人だけの手順です。サイトの合言葉（Vercel の TSUZURI_PASSWORD）を入れてください。</p>
      ${pw('setupKey', 'サイトの合言葉', 'off')}${acct}
      <div class="err" role="alert"></div><button class="btn primary" type="submit">管理者を作って始める</button>`,
    invite: `<h1>招待されました</h1><p>名前とログインIDとパスワードを決めると、すぐに書き始められます。</p>${acct}
      <div class="err" role="alert"></div><button class="btn primary" type="submit">参加する</button>`,
    reset: `<h1>パスワードを決め直す</h1><p>${esc(note)}</p>${pw('password', '新しいパスワード（8文字以上）', 'new-password')}
      <div class="err" role="alert"></div><button class="btn primary" type="submit">決め直してログイン</button>`,
  };
  root.innerHTML = `<form class="login" id="gate">${forms[kind]}<p><a href="/">← 読者のページへ</a></p></form>`;
  root.querySelector('input').focus();
  bindForm($('gate'), async f => {
    let r;
    if (kind === 'login') r = await post('/api/login', f);
    if (kind === 'setup') r = await post('/api/setup', f);
    if (kind === 'invite') r = await post('/api/accept', { ...f, loginId: f.loginId.toLowerCase(), token: inviteToken() });
    if (kind === 'reset') r = await post('/api/accept', { ...f, token: inviteToken() });
    if (!r.ok) return r.body.message || 'うまくいきませんでした。もう一度試してください';
    if (kind === 'invite' || kind === 'reset') history.replaceState(null, '', '/write' + location.search);
    if (nextPath()) { location.href = nextPath(); return; }
    start();
  });
}
const inviteToken = () => (location.hash.match(/^#invite=([\w-]+)/) || [])[1];

/* ---- 上のバー ---- */
function renderNav() {
  const nav = $('nav');
  if (S.view === 'edit') { nav.innerHTML = ''; return; }
  nav.innerHTML = `<a class="btn ghost" href="/" target="_blank" rel="noopener">サイトを見る ↗</a>
    <details class="menu"><summary class="btn ghost">${esc(S.me.name)} ▾</summary><div class="menu-list">
      <a href="/write">記事の一覧</a>
      ${isAdmin() ? `<a href="/write#inbox">受信箱${S.unread ? `（${S.unread}）` : ''}</a><a href="/write#media">メディアの設定</a><a href="/write#members">メンバー</a>` : ''}
      <a href="/write#account">自分の設定</a>
      <button type="button" id="logout">ログアウト</button>
    </div></details>
    <button class="btn" type="button" id="new-page">＋ ページ</button>
    <button class="btn primary" type="button" id="new-post">＋ 新しい記事</button>`;
  $('new-post').addEventListener('click', () => newPost('post'));
  $('new-page').addEventListener('click', () => newPost('page'));
  $('logout').addEventListener('click', async () => { await post('/api/logout'); S.me = null; renderGate('login', 'ログアウトしました。'); });
  nav.querySelectorAll('.menu-list a').forEach(a => a.addEventListener('click', () => nav.querySelector('details').removeAttribute('open')));
}

/* ---- メディアとURL（読者のページと同じ決まり） ---- */
const COLOR_NAMES = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, v.name]));
const THEME_NAMES = Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, [v.name, v.note]]));
const multiMedia = () => S.data.media.length > 1;
const mediaById = id => S.data.media.find(m => m.id === id) || S.data.media[0];
const readerHref = p => `${multiMedia() ? '/' + mediaById(p.media).slug : ''}/${p.slug}`;
const markHtml = m => `<span class="k${[...(m.mark || '綴')].length > 1 ? ' two' : ''}" style="background:${palette(accentOf(m)).light.a}">${esc(m.mark || '綴')}</span>`;

/* ---- 記事の一覧 ---- */
function renderList() {
  document.title = '記事の一覧 | ' + (S.data.site.name || 'Tsuzuri');
  const site = S.data.site;
  const filter = S.mediaFilter && S.data.media.some(m => m.id === S.mediaFilter) ? S.mediaFilter : null;
  const kind = S.kindFilter === 'page' ? 'page' : 'post';
  const posts = S.data.posts.filter(p => (canEdit(p) || !p.draft) && (!filter || p.media === filter) && (p.kind === 'page' ? 'page' : 'post') === kind)
    .sort((a, b) => kind === 'page' ? (a.order ?? 1e9) - (b.order ?? 1e9) || a.title.localeCompare(b.title) : (b.date || '').localeCompare(a.date || ''));
  const counts = { post: S.data.posts.filter(p => p.kind !== 'page').length, page: S.data.posts.filter(p => p.kind === 'page').length };
  const kindTabs = `<div class="media-tabs kind-tabs" role="tablist"><button type="button" role="tab" data-kind="post" aria-selected="${kind === 'post'}">記事 ${counts.post}</button><button type="button" role="tab" data-kind="page" aria-selected="${kind === 'page'}">固定ページ ${counts.page}</button></div>`;
  const title = multiMedia() ? (filter ? mediaById(filter).name : site.name || 'すべてのメディア') : S.data.media[0].name;
  const tabs = multiMedia() ? `<div class="media-tabs" role="tablist"><button type="button" role="tab" data-filter="" aria-selected="${!filter}">すべて</button>${S.data.media.map(m =>
    `<button type="button" role="tab" data-filter="${esc(m.id)}" aria-selected="${filter === m.id}">${markHtml(m)}${esc(m.name)}</button>`).join('')}</div>` : '';
  root.innerHTML = `<section class="home-head"><h1>${esc(title)}</h1>${tabs}${kindTabs}${kind === 'page' ? '<p class="sub" style="margin-top:10px">固定ページは「会社概要」「料金」「お問い合わせ」のような、記事の一覧に混ざらないページです。メニューに並べたり、メディアのトップにしたりできます（メディアの設定から）。</p>' : ''}` +
    (isAdmin() ? `<div class="row" style="margin-top:10px;margin-left:-10px;display:flex;gap:4px;flex-wrap:wrap"><a class="btn ghost" href="/write#media">メディアの設定</a><a class="btn ghost" href="/api/export" download>全記事を書き出す（JSON）</a></div>` : '') +
    `</section><section class="posts" aria-label="記事一覧">${posts.length ? posts.map(p => {
      const kinds = liveKinds(p.body);
      const mine = canEdit(p);
      const chips = [
        ...(p.draft ? ['<span class="chip draft">下書き（読者には見えません）</span>'] : []),
        ...(S.data.media.some(m => m.home === p.id) ? ['<span class="chip">トップページ</span>'] : []),
        ...(multiMedia() && !filter ? [`<span class="chip draft">${esc(mediaById(p.media).name)}</span>`] : []),
        ...(p.visibility === 'members' ? ['<span class="chip draft">メンバー限定</span>'] : []),
        ...(p.category ? [`<span class="chip draft">${esc(p.category)}</span>`] : []),
        ...(p.authorName ? [`<span class="chip draft">${esc(p.authorName)}</span>`] : []),
        ...kinds.map(k => `<span class="chip">${k}</span>`),
      ];
      const href = mine ? `/write#${esc(p.slug)}` : esc(readerHref(p));
      return `<div class="pr w"><a class="post-row" href="${href}"${mine ? ` data-edit="${esc(p.id)}"` : ' target="_blank" rel="noopener"'}><time>${fmtDate(p.date)}</time><div><h2 class="t">${esc(p.title || '無題')}</h2></div>` +
        `<p class="x">${esc(excerpt(p.body, 100))}</p><div class="chips">${chips.join('')}</div></a>` +
        (mine ? `<button class="btn row-edit" type="button" data-edit="${esc(p.id)}">編集</button>` : `<a class="btn row-edit" href="${esc(readerHref(p))}" target="_blank" rel="noopener">読む</a>`) + `</div>`;
    }).join('') : `<div class="empty-note"><p>${kind === 'page' ? 'まだ固定ページがありません' : 'まだ記事がありません'}</p><button class="btn primary" type="button" id="first-post">${kind === 'page' ? '最初のページを作る' : '最初の記事を書く'}</button></div>`}</section>`;
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); openEditor(b.dataset.edit); }));
  root.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { S.mediaFilter = b.dataset.filter || null; renderList(); }));
  root.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { S.kindFilter = b.dataset.kind; renderList(); }));
  $('first-post')?.addEventListener('click', () => newPost(kind));
}

/* ---- メディアの設定（管理者） ---- */
function mediaForm(m, isNew) {
  const id = isNew ? 'new' : m.id;
  const d = m.design || {};
  const custom = !!d.accent;
  const opt = (name, cur) => `<label class="field">${OPTIONS[name].label}<select name="d_${name}">${Object.entries(OPTIONS[name].choices).map(([k, v]) => `<option value="${k}"${(cur || '') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`;
  const img = (name, label, note) => `<div class="field img-field"><span>${label}</span><input type="hidden" name="d_${name}" value="${esc(d[name] || '')}">
    <div class="img-row"><span class="img-prev">${d[name] ? `<img src="${esc(d[name])}" alt="">` : 'なし'}</span><button class="btn" type="button" data-upload="${name}">画像を選ぶ</button><button class="btn ghost" type="button" data-clear="${name}"${d[name] ? '' : ' hidden'}>外す</button></div><span class="sub">${note}</span></div>`;
  return `<form class="media-form" data-id="${esc(id)}">
    <div class="mf-head">${isNew ? '<strong>新しいメディア</strong>' : `${markHtml(m)}<strong>${esc(m.name)}</strong><span class="sub">${multiMedia() ? `/${esc(m.slug)}/` : 'サイトの直下（メディアが1つのとき）'}</span>`}</div>
    <div class="set-grid">
      <label class="field">名前<input name="name" value="${esc(m.name || '')}" required maxlength="40" placeholder="例：まちのたより"></label>
      <label class="field" style="flex:0 0 120px;min-width:0">ロゴの文字（1〜2字）<input name="mark" value="${esc(m.mark || '')}" maxlength="2" placeholder="例：あ"></label>
      <label class="field">URL（半角英小文字・数字・ハイフン）<input name="slug" value="${esc(m.slug || '')}" required pattern="[a-z0-9][a-z0-9\\-]{1,29}" placeholder="例：machi" autocapitalize="none"></label>
    </div>
    <div class="set-grid">
      <label class="field">説明（1行）<input name="tagline" value="${esc(m.tagline || '')}" maxlength="200" placeholder="例：地元の話を地元の人が書く"></label>
      <label class="field">読める人<select name="visibility"><option value="public"${m.visibility !== 'members' ? ' selected' : ''}>誰でも</option><option value="members"${m.visibility === 'members' ? ' selected' : ''}>ログインしたメンバーだけ</option></select></label>
    </div>
    <div class="design-area">
      <div class="design-controls">
        <fieldset class="theme-pick"><legend>デザインのひな形（ここから細かく変えられます）</legend>${Object.entries(THEMES).map(([k, t]) =>
          `<label class="theme-opt"><input type="radio" name="theme" value="${k}"${(m.theme || 'standard') === k ? ' checked' : ''}><span class="tp-sample tp-${k}">あア</span><span><strong>${t.name}</strong><span class="sub">${t.note}</span></span></label>`).join('')}</fieldset>
        <div class="set-grid">
          <label class="field">色<select name="color">${Object.entries(COLORS).map(([k, c]) => `<option value="${k}"${!custom && (m.color || 'blue') === k ? ' selected' : ''}>${c.name}</option>`).join('')}<option value="custom"${custom ? ' selected' : ''}>好きな色を選ぶ…</option></select></label>
          <label class="field accent-field"${custom ? '' : ' hidden'}>好きな色<input type="color" name="accent" value="${esc(d.accent || accentOf(m))}"></label>
        </div>
        <details class="fine"${Object.keys(d).length ? ' open' : ''}><summary>デザインを細かく変える</summary>
          <h3 class="fine-h">文字</h3><div class="set-grid">${opt('headingFont', d.headingFont)}${opt('bodyFont', d.bodyFont)}${opt('fontSize', d.fontSize)}</div>
          <h3 class="fine-h">見出しと形</h3><div class="set-grid">${opt('h2', d.h2)}${opt('h3', d.h3)}${opt('radius', d.radius)}</div>
          <h3 class="fine-h">ページの作り</h3><div class="set-grid">${opt('header', d.header)}${opt('list', d.list)}${opt('width', d.width)}</div>
          <div class="set-grid">${opt('background', d.background)}${opt('links', d.links)}</div>
          <h3 class="fine-h">画像と文字</h3>
          ${img('logo', 'ロゴ画像', 'ロゴの文字の代わりに、上のバーに出ます（横長でも大丈夫）')}
          ${img('cover', '表紙の画像', 'メディアのトップに大きく出ます。横長の写真が向いています')}
          <label class="field">フッターの一文<input name="d_footer" value="${esc(d.footer || '')}" maxlength="200" placeholder="例：© 2026 まちのたより編集部"></label>
        </details>
        <details class="fine"${m.menu || m.home ? ' open' : ''}><summary>メニューとトップページ</summary>
          <label class="field">トップページ<select name="home"><option value="">記事の一覧（新着とカテゴリ）</option>${S.data.posts.filter(x => x.kind === 'page' && x.rev && (isNew || x.media === m.id)).map(x => `<option value="${esc(x.id)}"${m.home === x.id ? ' selected' : ''}>固定ページ「${esc(x.title || '無題')}」</option>`).join('')}</select></label>
          <p class="sub">固定ページをトップにすると、記事の一覧は <code>${multiMedia() && !isNew ? '/' + esc(m.slug) : ''}/articles</code> に移ります。</p>
          <label class="field">メニュー（上のバーに並ぶリンク）<textarea name="menu" rows="6" spellcheck="false" placeholder="- [ホーム](/)&#10;- [サービス](services)&#10;  - [料金](pricing)&#10;- [記事](articles)&#10;- [お問い合わせ](contact)">${esc(m.menu || '')}</textarea></label>
          <p class="sub">1行に1つ、<code>- [表示する文字](行き先)</code> と書きます。字下げした行は、その上の項目の中（ドロップダウン）に入ります。行き先は、固定ページや記事のURL（<code>about</code> など）、トップは <code>/</code>、記事の一覧は <code>articles</code>、ほかのサイトは <code>https://…</code> です。</p>
        </details>
        <details class="css-more"${m.css ? ' open' : ''}><summary>追加のCSS（上級者向け）</summary>
          <p class="sub">このメディアのページにだけ効く CSS を書けます。例：<code>.prose h2{color:var(--blue)}</code>　色は <code>var(--blue)</code>、背景は <code>var(--bg)</code> で指定すると、暗い画面でも読みやすくなります。</p>
          <textarea name="css" rows="6" spellcheck="false" placeholder="/* 例 */&#10;.home-head h1 { letter-spacing: .1em; }">${esc(m.css || '')}</textarea></details>
      </div>
      <div class="design-preview"><div class="dp-h">見本（保存前の見た目）</div><iframe title="デザインの見本" loading="lazy"></iframe></div>
    </div>
    <div class="err" role="alert"></div>
    <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="submit">${isNew ? 'メディアを作る' : '保存'}</button>
      ${isNew ? '' : `<a class="btn ghost" href="${multiMedia() ? '/' + esc(m.slug) + '/' : '/'}" target="_blank" rel="noopener">見る ↗</a>${S.data.media.length > 1 ? `<button class="btn ghost" type="button" data-del="${esc(m.id)}">このメディアを削除</button>` : ''}`}</div>
  </form>`;
}

/* フォームの中身から、保存する形のメディアを作る */
function mediaFromForm(form) {
  const f = Object.fromEntries(new FormData(form));
  const design = {};
  for (const k of DESIGN_KEYS) if (f['d_' + k]) design[k] = f['d_' + k];
  if (f.color === 'custom' && f.accent) design.accent = f.accent;
  return { name: f.name, mark: f.mark, slug: (f.slug || '').toLowerCase(), tagline: f.tagline, visibility: f.visibility, theme: f.theme, menu: f.menu || '', home: f.home || '',
    color: f.color === 'custom' ? 'blue' : f.color, design: cleanDesign(design), css: f.css || '' };
}

/* ---- 見本：保存前のデザインを、小さなページで見せる ---- */
let baseCss = null;
async function drawPreview(form) {
  const frame = form.querySelector('.design-preview iframe');
  if (!frame) return;
  if (baseCss === null) { try { baseCss = await (await fetch('/assets/style.css')).text(); } catch { baseCss = ''; } }
  const m = mediaFromForm(form);
  const d = m.design;
  const fonts = 'https://fonts.googleapis.com/css2?' + [...new Set(['M+PLUS+1+Code:wght@400;500', 'Shippori+Mincho+B1:wght@600;800', 'Zen+Kaku+Gothic+New:wght@400;500;700', ...fontFamilies(m)])].map(x => 'family=' + x).join('&') + '&display=swap';
  const name = esc(m.name || 'メディアの名前'), mark = esc(m.mark || [...(m.name || '綴')][0]);
  const logo = d.logo ? `<span class="k img"><img src="${esc(d.logo)}" alt=""></span>` : `<span class="k${[...mark].length > 1 ? ' two' : ''}">${mark}</span>`;
  const sample = [
    { t: '地元のパン屋を5軒めぐった', x: '朝7時に開くお店から順番にまわりました。', img: '' },
    { t: '川沿いの朝さんぽコース', x: '駅から歩いて10分、静かな道をまとめました。', img: '' },
  ];
  const list = d.list === 'cards' || d.list === 'grid'
    ? `<div class="post-${d.list}">${sample.map(s => `<a class="post-card" href="#">${d.list === 'cards' ? `<span class="thumb none"><span>${mark}</span></span>` : ''}<span class="pc-body"><span class="pc-title">${s.t}</span><span class="pc-x">${s.x}</span><time>2026.10.11</time></span></a>`).join('')}</div>`
    : sample.map(s => `<div class="pr"><a class="post-row" href="#"><time>2026.10.11</time><div><h2 class="t">${s.t}</h2></div><p class="x">${s.x}</p></a></div>`).join('');
  const head = d.cover
    ? `<section class="cover" style="background-image:url('${esc(d.cover)}')"><div class="cover-in"><h1>${name}</h1>${m.tagline ? `<p>${esc(m.tagline)}</p>` : ''}</div></section>`
    : `<section class="home-head"><h1>${name}</h1>${m.tagline ? `<p>${esc(m.tagline)}</p>` : ''}</section>`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${fonts}"><style>${baseCss}</style><style>${designCss(m)}${m.css ? String(m.css).replace(/</g, '') : ''}
body{pointer-events:none}main{padding-bottom:20px}.home-head{padding-block:28px 18px}.post-layout{padding-block:20px 30px}.toc{display:none}</style></head><body>
<header class="bar"><div class="bar-in"><a class="logo" href="#">${logo}<span class="w">${name}</span></a><form class="search-mini"><input type="search" placeholder="検索"></form></div></header>
<main>${head}<section class="posts">${list}</section>
<div class="post-layout"><article class="article"><header class="article-head"><p class="crumbs"><a href="#">${name}</a></p><h1>記事のタイトルはこう見えます</h1><div class="meta"><time>2026.10.11</time><span>書いた人</span></div></header>
<div class="prose"><p>本文はこの書体と大きさで読まれます。<a href="#">リンク</a>はこう見えます。</p><h2>大見出しの形</h2><p>見出しの下の文章です。</p><h3>小見出しの形</h3><div class="box point"><p class="bx-t">ポイント</p><p>枠の角の丸さも変わります。</p></div><div class="btns"><a class="cta" href="#">ボタン</a></div></div></article></div></main>
<footer class="site-foot"><div class="wrap"><span>${d.footer ? esc(d.footer) : '© 2026 ' + name}</span></div></footer></body></html>`;
  frame.srcdoc = html;
}

function renderMedia() {
  document.title = 'メディアの設定 | ' + (S.data.site.name || 'Tsuzuri');
  const site = S.data.site;
  const blank = { name: '', slug: '', mark: '', tagline: '', color: Object.keys(COLORS)[S.data.media.length % 7], theme: 'standard', design: {}, css: '', visibility: 'public' };
  root.innerHTML = `<section class="manage wide"><h1>メディアの設定</h1>
    <p class="sub">1つの Tsuzuri から、名前のちがう複数のメディアを出せます。メディアが2つ以上になると、それぞれ <code>/URL/</code> の下に置かれ、サイトのいちばん上は全メディアの入口になります（前のURLは自動で新しい場所へ案内します）。</p>
    ${S.data.media.map(m => mediaForm(m, false)).join('')}
    <h2 class="sec">メディアを増やす</h2>${mediaForm(blank, true)}
    <h2 class="sec">全体の名前</h2>
    <form class="stack" id="site-form"><p class="sub">メディアが2つ以上のとき、サイトのいちばん上（全メディアの入口）に出る名前です。</p>
      <label class="field">名前<input name="name" value="${esc(site.name || '')}" required maxlength="60"></label>
      <label class="field">説明（1行）<input name="tagline" value="${esc(site.tagline || '')}" maxlength="200"></label>
      <label class="field">問い合わせが届いたときの通知先（任意）<input name="formWebhook" type="url" value="${esc(site.formWebhook || '')}" placeholder="https://hooks.slack.com/services/…"></label>
      <p class="sub">Slack や Discord の「Incoming Webhook」のURLを入れると、問い合わせが届くたびに中身が送られます。空なら受信箱にだけ入ります。</p>
      <div class="err" role="alert"></div><button class="btn primary" type="submit">保存</button></form>
  </section>`;
  root.querySelectorAll('.media-form').forEach(form => {
    let t;
    const redraw = () => { clearTimeout(t); t = setTimeout(() => drawPreview(form), 120); };
    form.addEventListener('input', redraw);
    form.addEventListener('change', e => {
      if (e.target.name === 'color') form.querySelector('.accent-field').hidden = e.target.value !== 'custom';
      redraw();
    });
    /* 表示されたときに見本を描く（たくさんのメディアがあっても重くならないように） */
    new IntersectionObserver((es, ob) => { if (es.some(x => x.isIntersecting)) { drawPreview(form); ob.disconnect(); } }).observe(form.querySelector('.design-preview'));
    form.querySelectorAll('[data-upload]').forEach(b => b.addEventListener('click', () => pickImage(async file => {
      const url = await uploadFile(file, b.dataset.upload === 'logo' ? 600 : 2400);
      if (!url) return;
      form.querySelector(`[name="d_${b.dataset.upload}"]`).value = url;
      b.parentElement.querySelector('.img-prev').innerHTML = `<img src="${esc(url)}" alt="">`;
      b.parentElement.querySelector('[data-clear]').hidden = false;
      redraw();
    })));
    form.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => {
      form.querySelector(`[name="d_${b.dataset.clear}"]`).value = '';
      b.parentElement.querySelector('.img-prev').textContent = 'なし';
      b.hidden = true; redraw();
    }));
    bindForm(form, async () => {
      const isNew = form.dataset.id === 'new';
      const id = isNew ? 'm' + Date.now().toString(36) : form.dataset.id;
      const body = mediaFromForm(form);
      const r = await post(`/api/media/${id}`, body, 'PUT');
      if (!r.ok) return r.body.message || '保存できませんでした';
      await reloadContent();
      toast(isNew ? `「${body.name}」を作りました` : '保存しました。読者のページにもすぐ反映されます');
      renderMedia();
    });
  });
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'もう一度押すと削除します'; setTimeout(() => { b.classList.remove('armed'); b.textContent = 'このメディアを削除'; }, 3000); return; }
    const r = await api(`/api/media/${b.dataset.del}`, { method: 'DELETE', body: '{}' });
    if (!r.ok) { toast(r.body.message || '削除できませんでした'); return; }
    await reloadContent(); toast('メディアを削除しました'); renderMedia();
  }));
  bindForm($('site-form'), async f => {
    const r = await post('/api/site', { ...site, ...f }, 'PUT');
    if (!r.ok) return r.body.message || '保存できませんでした';
    S.data.site = { ...site, name: f.name.trim(), tagline: f.tagline.trim(), formWebhook: (f.formWebhook || '').trim() };
    toast('保存しました');
  });
}

/* 画像を1枚選んでアップロードし、URLを返す（ロゴ・表紙用） */
function pickImage(cb) {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
  inp.addEventListener('change', () => { if (inp.files[0]) cb(inp.files[0]); });
  inp.click();
}
async function uploadFile(file, maxSide) {
  let blob = file, type = file.type;
  if (/^image\/(png|jpeg|webp)$/.test(type)) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const keepPng = type === 'image/png';
      blob = await new Promise(r => c.toBlob(r, keepPng ? 'image/png' : 'image/jpeg', 0.88));
      type = blob.type;
    } catch {}
  }
  toast('アップロード中…', 0);
  const r = await post('/api/upload-url', { type, size: blob.size });
  if (!r.ok) { toast(r.body.message || 'アップロードできませんでした'); return null; }
  try {
    if (r.body.direct) {
      const up = await fetch(r.body.direct, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type }, body: blob });
      const j = await up.json();
      if (!up.ok) throw new Error(j.message);
      toast('入れました');
      return j.url;
    }
    await putWithProgress(r.body.putUrl, blob, type, pct => toast(`アップロード中… ${pct}%`, 0));
    toast('入れました');
    return r.body.url;
  } catch { toast('アップロードできませんでした。もう一度試してください'); return null; }
}

async function reloadContent() {
  const r = await api('/api/content');
  if (r.ok) S.data = { ...r.body, posts: [...r.body.posts, ...S.data.posts.filter(p => !p.rev)] };
}

/* ---- 受信箱（問い合わせフォームに届いたもの。管理者だけ） ---- */
async function renderInbox() {
  document.title = '受信箱 | ' + (S.data.site.name || 'Tsuzuri');
  root.innerHTML = '<p class="empty-note">読み込み中…</p>';
  const r = await api('/api/inbox');
  if (!r.ok) { root.innerHTML = `<p class="empty-note">${esc(r.body.message || '読み込めませんでした')}</p>`; return; }
  const list = r.body.messages || [];
  S.unread = list.filter(x => !x.read).length;
  const when = at => new Date(at).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  root.innerHTML = `<section class="manage"><h1>受信箱</h1>
    <p class="sub">固定ページや記事に置いた問い合わせフォーム（<code>:::contact</code>）に届いたものです。${r.body.webhook ? '通知先にも送っています。' : '通知先（Slack など）は「メディアの設定」のいちばん下で決められます。'}</p>
    ${list.length ? `<div class="row" style="display:flex;gap:8px;margin-bottom:12px"><button class="btn" type="button" id="inbox-csv">CSV で書き出す</button></div>` : ''}
    <div class="inbox">${list.map(m => `<article class="msg${m.read ? '' : ' unread'}" data-id="${esc(m.id)}">
      <header><strong>${esc(m.form)}</strong><time>${when(m.at)}</time>${m.page ? `<a href="${esc(m.page)}" target="_blank" rel="noopener">${esc(m.page)}</a>` : ''}${m.read ? '' : '<span class="chip">未読</span>'}</header>
      <dl>${m.fields.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value).replace(/\n/g, '<br>') || '—'}</dd>`).join('')}</dl>
      <div class="row"><button class="btn" type="button" data-read="${m.read ? 0 : 1}">${m.read ? '未読に戻す' : '読んだ'}</button><button class="btn ghost" type="button" data-del>削除</button></div>
    </article>`).join('') || '<p class="empty-note">まだ何も届いていません</p>'}</div></section>`;
  renderNav();
  root.querySelectorAll('.msg').forEach(el => {
    el.querySelector('[data-read]').addEventListener('click', async e => {
      await post(`/api/inbox/${el.dataset.id}`, { read: e.target.dataset.read === '1' }, 'PATCH');
      renderInbox();
    });
    const del = el.querySelector('[data-del]');
    del.addEventListener('click', async () => {
      if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'もう一度押すと削除'; setTimeout(() => { del.classList.remove('armed'); del.textContent = '削除'; }, 3000); return; }
      await api(`/api/inbox/${el.dataset.id}`, { method: 'DELETE', body: '{}' });
      toast('削除しました'); renderInbox();
    });
  });
  $('inbox-csv')?.addEventListener('click', () => {
    const labels = [...new Set(list.flatMap(m => m.fields.map(f => f.label)))];
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['受け付けた日時', 'フォーム', 'ページ', ...labels], ...list.map(m => [when(m.at), m.form, m.page, ...labels.map(l => (m.fields.find(f => f.label === l) || {}).value || '')])];
    const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: `inbox-${new Date().toISOString().slice(0, 10)}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/* ---- メンバー（管理者） ---- */
async function renderMembers() {
  document.title = 'メンバー | ' + (S.data.site.name || 'Tsuzuri');
  root.innerHTML = '<p class="empty-note">読み込み中…</p>';
  const r = await api('/api/users');
  if (!r.ok) { root.innerHTML = `<p class="empty-note">${esc(r.body.message || '読み込めませんでした')}</p>`; return; }
  const { users, invites } = r.body;
  root.innerHTML = `<section class="manage">
    <h1>メンバー</h1><p class="sub">管理者はすべての記事・サイト設定・メンバーを扱えます。書き手は自分の記事だけを書けます。閲覧者は「メンバーだけ」の記事を読めます（書けません）。</p>
    <div class="mlist">${users.map(u => `<div class="mrow">
      <span class="t">${esc(u.name)}<span class="id">${esc(u.loginId)}${u.id === S.me.id ? '（あなた）' : ''}</span></span>
      ${u.disabled ? '<span class="chip draft">利用停止中</span>' : ''}
      <select data-role="${esc(u.id)}" aria-label="${esc(u.name)}の役割">${['reader', 'writer', 'admin'].map(x => `<option value="${x}"${u.role === x ? ' selected' : ''}>${ROLE[x]}</option>`).join('')}</select>
      ${u.id === S.me.id ? '' : `<button class="btn" type="button" data-reset="${esc(u.id)}" data-name="${esc(u.name)}">パスワード再設定リンク</button><button class="btn" type="button" data-disable="${esc(u.id)}" data-on="${u.disabled ? 0 : 1}">${u.disabled ? '利用を再開' : '利用を止める'}</button>`}
    </div>`).join('')}</div>
    <h2 class="sec">人を招待する</h2>
    <form class="invite-form" id="invite-form"><select name="role" aria-label="招待する人の役割"><option value="writer">書き手として</option><option value="reader">閲覧者として（読むだけ）</option><option value="admin">管理者として</option></select>
      <button class="btn primary" type="submit">招待リンクを作る</button><div class="err" role="alert"></div></form>
    <div id="invite-out"></div>
    ${invites.length ? `<h2 class="sec">まだ使われていない招待</h2><div class="mlist">${invites.map(i => `<div class="mrow"><span class="t">${ROLE[i.role]}として</span><time>${new Date(i.exp).toLocaleDateString('ja-JP')} まで</time><button class="btn" type="button" data-revoke="${esc(i.id)}">取り消す</button></div>`).join('')}</div>` : ''}
  </section>`;
  root.querySelectorAll('[data-role]').forEach(sel => sel.addEventListener('change', async () => {
    const r = await post(`/api/users/${sel.dataset.role}`, { role: sel.value }, 'PATCH');
    toast(r.ok ? '役割を変えました' : r.body.message || '変えられませんでした');
    renderMembers();
  }));
  root.querySelectorAll('[data-disable]').forEach(b => b.addEventListener('click', async () => {
    const r = await post(`/api/users/${b.dataset.disable}`, { disabled: b.dataset.on === '1' }, 'PATCH');
    toast(r.ok ? (b.dataset.on === '1' ? '利用を止めました。その人はログインできなくなります' : '利用を再開しました') : r.body.message || '変えられませんでした');
    renderMembers();
  }));
  root.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', async () => {
    const r = await post(`/api/users/${b.dataset.reset}/reset`);
    if (!r.ok) { toast(r.body.message || '作れませんでした'); return; }
    showLink(`${location.origin}/write#invite=${r.body.token}`, `${b.dataset.name}さんに送ってください。開くと新しいパスワードを決められます（24時間有効・1回だけ使えます）。`);
  }));
  root.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    await api(`/api/invites/${b.dataset.revoke}`, { method: 'DELETE' });
    toast('招待を取り消しました'); renderMembers();
  }));
  bindForm($('invite-form'), async f => {
    const r = await post('/api/invites', f);
    if (!r.ok) return r.body.message || '作れませんでした';
    showLink(`${location.origin}/write#invite=${r.body.token}`, `このリンクを招待する人に送ってください（${ROLE[r.body.role]}・7日間有効・1回だけ使えます）。`);
  });
}

function showLink(link, text) {
  $('invite-out').innerHTML = `<div class="notice"><span>${esc(text)}</span>
    <input class="link" readonly value="${esc(link)}" aria-label="リンク"><button class="btn primary" type="button" id="copy-link">コピー</button></div>`;
  const inp = $('invite-out').querySelector('input');
  inp.select();
  $('invite-out').scrollIntoView({ block: 'nearest' });
  $('copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('リンクをコピーしました'); } catch { inp.select(); toast('選択された文字をコピーしてください'); }
  });
}

/* ---- 自分の設定 ---- */
function renderAccount() {
  document.title = '自分の設定 | ' + (S.data.site.name || 'Tsuzuri');
  root.innerHTML = `<section class="manage"><h1>自分の設定</h1><p class="sub">ログインID：${esc(S.me.loginId)}（${ROLE[S.me.role]}）</p>
    <form class="stack" id="name-form"><h2 class="sec">名前</h2><label class="field">記事に表示される名前<input name="name" value="${esc(S.me.name)}" required maxlength="40"></label>
      <div class="err" role="alert"></div><button class="btn primary" type="submit">名前を保存</button></form>
    <form class="stack" id="pw-form"><h2 class="sec">パスワード</h2>
      <label class="field">今のパスワード<input type="password" name="currentPassword" autocomplete="current-password" required></label>
      <label class="field">新しいパスワード（8文字以上）<input type="password" name="newPassword" autocomplete="new-password" required minlength="8"></label>
      <div class="err" role="alert"></div><button class="btn primary" type="submit">パスワードを変える</button>
      <p class="sub">変えると、ほかの端末でのログインは切れます。</p></form></section>`;
  bindForm($('name-form'), async f => {
    const r = await post('/api/account', { name: f.name });
    if (!r.ok) return r.body.message;
    S.me = r.body.user;
    S.data.posts.forEach(p => { if (p.author === S.me.id) p.authorName = S.me.name; });
    toast('名前を保存しました。あなたの記事の署名も変わりました'); renderNav();
  });
  bindForm($('pw-form'), async f => {
    const r = await post('/api/account', f);
    if (!r.ok) return r.body.message;
    $('pw-form').reset(); toast('パスワードを変えました');
  });
}

function route() {
  hideTip();
  renderNav();
  if (S.view === 'edit') return renderEditor();
  if (S.view === 'members' && isAdmin()) return renderMembers();
  if (S.view === 'media' && isAdmin()) return renderMedia();
  if (S.view === 'inbox' && isAdmin()) return renderInbox();
  if (S.view === 'account') return renderAccount();
  renderList();
}

function applyHash() {
  if (inviteToken()) { toast('すでにログインしています。招待リンクは、招待する人に渡してください'); history.replaceState(null, '', '/write'); }
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'new') return newPost();
  if (h === 'new-page') return newPost('page');
  if (h === 'members' || h === 'account' || h === 'media' || h === 'inbox') { S.view = h; return route(); }
  const p = h && S.data.posts.find(x => x.slug === h || x.id === h);
  if (p && canEdit(p)) { S.editId = p.id; S.view = 'edit'; return route(); }
  S.view = 'list'; route();
}
window.addEventListener('hashchange', () => {
  if (!S.me || /^#(fn|fnref)-\d+$/.test(location.hash)) return;
  if (S.view === 'edit' && S.dirty) { toast('保存していない変更があります。先に保存するか「← 戻る」を押してください'); return; }
  applyHash();
});

/* ---- 編集：控え・保存・削除 ---- */
const draftKey = id => 'tsuzuri-draft-' + id;
let backupTimer;
function backup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    const p = S.data.posts.find(x => x.id === S.editId);
    if (!p) return;
    try { localStorage.setItem(draftKey(p.id), JSON.stringify({ at: Date.now(), baseRev: p.rev || 0, post: pick(p) })); } catch {}
  }, 400);
}
const dropBackup = id => { try { localStorage.removeItem(draftKey(id)); } catch {} };
function markDirty() { S.dirty = true; backup(); updateState(); }

function newPost(kind = 'post') {
  if (kind !== 'page') kind = 'post';
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  S.data.posts.push({ id, slug: (kind === 'page' ? 'page-' : 'p-') + Date.now().toString(36), title: '', date: today(), draft: true, body: '', author: S.me.id, authorName: S.me.name, rev: 0, media: S.mediaFilter || S.data.media[0].id, kind });
  S.dirty = false;
  openEditor(id);
}
function openEditor(id) {
  const p = S.data.posts.find(x => x.id === id);
  if (!p) return;
  S.view = 'edit'; S.editId = id; S.dirty = false;
  history.replaceState(null, '', '/write#' + (p.rev ? p.slug : 'new'));
  route(); window.scrollTo(0, 0);
}
function closeEditor() {
  const p = S.data.posts.find(x => x.id === S.editId);
  const back = $('ed-back');
  const empty = p && !p.rev && !p.title.trim() && !p.body.trim();
  if (!empty && S.dirty && back && !back.classList.contains('armed')) {
    back.classList.add('armed'); back.textContent = '保存せずに戻る';
    toast('保存していない変更があります。戻るならもう一度押してください（内容はこのブラウザに控えてあります）');
    setTimeout(() => { back.classList.remove('armed'); back.textContent = '← 戻る'; }, 4000);
    return;
  }
  if (p && !p.rev) { S.data.posts = S.data.posts.filter(x => x !== p); if (empty) dropBackup(p.id); }
  S.dirty = false;
  S.view = 'list';
  history.replaceState(null, '', '/write');
  route();
}

/* 今開いている記事を保存する（ほかの人の記事・サイト設定には触れない） */
async function save() {
  if (S.saving) return false;
  const p = S.data.posts.find(x => x.id === S.editId);
  if (!p) return false;
  S.saving = true;
  const btns = [...document.querySelectorAll('#ed-pub, #ed-draft, #ed-unpub')];
  btns.forEach(b => { b.disabled = true; });
  const r = await post(`/api/posts/${p.id}`, { baseRev: p.rev || undefined, post: pick(p) }, 'PUT');
  S.saving = false;
  btns.forEach(b => { b.disabled = false; });
  if (r.ok) {
    Object.assign(p, r.body.post);
    S.dirty = false; dropBackup(p.id);
    history.replaceState(null, '', '/write#' + p.slug);
    return true;
  }
  backup();
  if (r.status === 401) { toast('ログインが切れました。書いた内容はこのブラウザに控えてあります'); S.me = null; renderGate('login', 'ログインが切れました。もう一度ログインすると、控えから戻せます。'); }
  else if (r.status === 409) showConflict(p, r.body.post);
  else toast(r.body.message || '保存できませんでした。通信を確かめて、もう一度押してください');
  return false;
}

async function deletePost(p) {
  if (!p.rev) { S.data.posts = S.data.posts.filter(x => x !== p); dropBackup(p.id); return true; }
  const r = await api(`/api/posts/${p.id}`, { method: 'DELETE', body: JSON.stringify({ baseRev: p.rev }) });
  if (r.ok || r.status === 404) { S.data.posts = S.data.posts.filter(x => x !== p); dropBackup(p.id); S.dirty = false; return true; }
  if (r.status === 409) showConflict(p, r.body.post);
  else toast(r.body.message || '削除できませんでした');
  return false;
}

function showConflict(p, latest) {
  const note = $('ed-note');
  if (!note || !latest) { toast('ほかの画面で先に保存されています'); return; }
  note.innerHTML = `<div class="notice warn"><span>この記事は、ほかの画面で先に保存されています。あなたの変更はこのブラウザに控えてあります。</span>
    <button class="btn" type="button" id="cf-open">最新の版を開く</button><button class="btn primary" type="button" id="cf-mine">自分の変更で上書きする</button></div>`;
  $('cf-open').addEventListener('click', () => { Object.assign(p, latest); S.dirty = false; renderEditor(); });
  $('cf-mine').addEventListener('click', async () => { p.rev = latest.rev; note.innerHTML = ''; if (await save()) { toast('あなたの変更で保存しました'); updateState(); } });
}

/* 親の記事の候補：自分と、自分の下にある記事は選べない */
function parentOptions(p) {
  const posts = S.data.posts.filter(x => x.rev);
  const below = new Set([p.id]);
  for (let grew = true; grew;) { grew = false; for (const x of posts) if (x.parent && below.has(x.parent) && !below.has(x.id)) { below.add(x.id); grew = true; } }
  const kids = new Map();
  for (const x of posts) { const k = posts.some(y => y.id === x.parent) ? x.parent : null; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(x); }
  const out = [];
  const walk = (parent, depth) => (kids.get(parent) || []).sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.order ?? 1e9) - (b.order ?? 1e9) || a.title.localeCompare(b.title)).forEach(x => {
    if (!below.has(x.id)) out.push(`<option value="${esc(x.id)}"${p.parent === x.id ? ' selected' : ''}>${'　'.repeat(depth)}${x.category && !depth ? `［${esc(x.category)}］` : ''}${esc(x.title || '無題')}</option>`);
    if (depth < 6) walk(x.id, depth + 1);
  });
  walk(null, 0);
  return out.join('');
}

/* ---- 書き出し：Markdown（前書きつき）と、単体で開ける HTML ---- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportPost(p, kind) {
  const meta = { title: p.title, date: p.date, updated: p.updated, author: p.authorName, category: p.category, slug: p.slug };
  if (kind === 'md') {
    const fm = Object.entries(meta).filter(([, v]) => v).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
    download(`${p.slug}.md`, `---\n${fm}\n---\n\n# ${p.title}\n\n${p.body}\n`, 'text/markdown;charset=utf-8');
    return toast('Markdown で書き出しました');
  }
  toast('書き出しの準備中…', 0);
  try {
    const [css, renderJs, liveJs] = await Promise.all(['/assets/style.css', '/assets/render.js', '/assets/live.js'].map(u => fetch(u).then(r => r.text())));
    const script = renderJs.replace(/^export \{[^}]*\};?\s*$/m, '') + '\n' +
      liveJs.replace(/^import .*$/m, '').replace(/^export \{[^}]*\};?\s*$/m, '').replace(/^export function/m, 'function');
    const r = renderBody(p.body, S.data.posts, u => u, slug => `${location.origin}/${slug}`);
    const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+1+Code:wght@400;500&family=Shippori+Mincho+B1:wght@600;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap">
<style>${css}</style></head><body>
<div id="progress" aria-hidden="true"></div>
<main><div class="post-layout"><article class="article"><header class="article-head"><h1>${esc(p.title)}</h1>
<div class="meta"><time>${fmtDate(p.date)}</time>${p.authorName ? `<span>${esc(p.authorName)}</span>` : ''}<span>${esc(S.data.site.name || '')}</span></div></header>
<div class="prose">${r.html}</div></article></div></main>
<div id="tip" role="tooltip" hidden></div>
<script>${script.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
    download(`${p.slug}.html`, html, 'text/html;charset=utf-8');
    toast('HTML で書き出しました。ブラウザで開くと、クイズや計算もそのまま動きます');
  } catch { toast('書き出せませんでした。もう一度試してください'); }
}

/* 読むだけの記事・控えの復元 */
function setupEditorExtras(p, src, refresh) {
  const note = $('ed-note');
  if (!canEdit(p)) {
    note.innerHTML = `<div class="notice"><span>この記事は${esc(p.authorName || 'ほかの人')}さんの記事です。直せるのは書いた本人と管理者だけです。</span></div>`;
    $('ed-title').readOnly = true; src.readOnly = true;
    ['ed-pub', 'ed-draft', 'ed-unpub'].forEach(id => { const b = $(id); if (b) b.hidden = true; });
    root.querySelector('details.settings').hidden = true;
    $('tools').hidden = true;
    return;
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(draftKey(p.id)) || 'null'); } catch {}
  if (!saved || !saved.post) return;
  const same = POST_FIELDS.every(k => (saved.post[k] ?? null) === (p[k] ?? null));
  if (same) { dropBackup(p.id); return; }
  const when = new Date(saved.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  note.innerHTML = `<div class="notice"><span>${when} に書いた、保存していない変更が残っています。</span>
    <button class="btn primary" type="button" id="bk-yes">その変更に戻す</button><button class="btn ghost" type="button" id="bk-no">捨てる</button></div>`;
  $('bk-yes').addEventListener('click', () => {
    Object.assign(p, saved.post);
    note.innerHTML = '';
    renderEditor();
    S.dirty = true; updateState();
    toast('戻しました。「公開する」か「下書き保存」で保存されます');
  });
  $('bk-no').addEventListener('click', () => { dropBackup(p.id); note.innerHTML = ''; });
}
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---- 画像・動画：ブラウザからストレージへ直接送る（100MBまで） ---- */
$('file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) addMedia(f); });

const DOC_TYPES = {
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function putWithProgress(url, blob, type, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', type);
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error('status ' + x.status)));
    x.onerror = () => reject(new Error('network'));
    x.send(blob);
  });
}

async function addMedia(file) {
  const src = $('src');
  if (!src) return;
  let blob = file, type = file.type;
  if (/^image\//.test(type) && !/svg|gif/.test(type)) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const png = type === 'image/png' && file.size < 600000;
      blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.86));
      type = blob.type;
    } catch {}
  } else if (!/^(image|video)\//.test(type)) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    type = DOC_TYPES[ext] || '';
    if (!type) { toast('画像・動画・PDF・Word・Excel・PowerPoint・CSV・テキスト・ZIP のどれかを選んでください'); return; }
  }
  if (blob.size > 100 * 1024 * 1024) { toast('ファイルは100MBまでです。長い動画は YouTube に上げて、URLを1行で貼ってください'); return; }
  toast('アップロードの準備中…', 0);
  const r = await post('/api/upload-url', { type, size: blob.size });
  if (!r.ok) { toast(r.body.message || 'アップロードできませんでした'); return; }
  let url = r.body.url;
  try {
    if (r.body.direct) {
      const up = await fetch(r.body.direct, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type }, body: blob });
      const j = await up.json();
      if (!up.ok) throw new Error(j.message);
      url = j.url;
    } else {
      await putWithProgress(r.body.putUrl, blob, type, pct => toast(`アップロード中… ${pct}%`, 0));
    }
  } catch { toast('アップロードできませんでした。通信を確かめて、もう一度試してください'); return; }
  const alt = file.name.replace(/\.[^.]+$/, '');
  if (/^(image|video)\//.test(type)) insertBlock(src, `![${alt}](${url})`);
  else insertBlock(src, `[${file.name.replace(/[\[\]]/g, '')}](${url})`);
  src.dispatchEvent(new Event('input'));
  toast('入れました');
}

/* 「/」で呼び出す部品。name と keys で絞り込める */
const PARTS = [
  { g: '文章', ic: '⚙', name: '記事の設定（メディア・デザイン）', ds: '原稿の先頭に書くと、メディアやデザイン・色・カテゴリを切り替えられる', keys: 'settei media design theme color frontmatter meta medhia dezain', action: 'front' },
  { g: '文章', ic: 'H', name: '見出し', ds: '話の区切りに付ける大きな見出し', keys: 'midashi heading h2', text: '## 見出し', sel: '見出し' },
  { g: '文章', ic: 'h', name: '小見出し', ds: '見出しの中をさらに分ける', keys: 'komidashi h3', text: '### 小見出し', sel: '小見出し' },
  { g: '文章', ic: '・', name: '箇条書き', ds: '項目を並べる', keys: 'kajougaki list', text: '- 項目\n- 項目\n- 項目', sel: '項目' },
  { g: '文章', ic: '1.', name: '番号付きリスト', ds: '順番がある項目を並べる', keys: 'bangou list ol', text: '1. 最初にやること\n2. 次にやること', sel: '最初にやること' },
  { g: '文章', ic: '❝', name: '引用', ds: 'ほかの人の言葉を引く', keys: 'inyou quote', text: '> 引用する文', sel: '引用する文' },
  { g: '文章', ic: '—', name: '区切り線', ds: '話題を大きく変えるときの線', keys: 'kugiri hr line', text: '---' },
  { g: '文章', ic: '→', name: 'ほかの記事へのリンク', ds: 'このサイトの記事のタイトルを書く', keys: 'link kiji wiki', text: '[[記事のタイトル]]', sel: '記事のタイトル' },
  { g: '文章', ic: '?', name: '用語の説明', ds: '押すと説明が出る言葉。{言葉|説明} の形', keys: 'yougo term tooltip', text: '{用語|ここに説明}', sel: '用語' },
  { g: '枠', ic: '!', name: 'ポイント', ds: '大事なことを青い枠で囲む', keys: 'point pointo box', text: ':::ポイント\nここに大事なこと\n:::', sel: 'ここに大事なこと' },
  { g: '枠', ic: '✎', name: 'メモ', ds: '補足をグレーの枠で囲む', keys: 'memo note box', text: ':::メモ\nここに補足\n:::', sel: 'ここに補足' },
  { g: '枠', ic: '⚠', name: '注意', ds: '気をつけることをオレンジの枠で', keys: 'chuui warn box', text: ':::注意\nここに注意すること\n:::', sel: 'ここに注意すること' },
  { g: '枠', ic: '■', name: 'まとめ', ds: '記事の結論を黒い枠で', keys: 'matome summary box', text: ':::まとめ\nここにまとめ\n:::', sel: 'ここにまとめ' },
  { g: '画像・ボタン', ic: '▣', name: '画像・動画', ds: 'パソコンから選ぶ。原稿にドラッグしても入ります', keys: 'gazou image douga video photo', action: 'file' },
  { g: '画像・ボタン', ic: '⎙', name: '添付ファイル', ds: 'PDF・Word・Excel・PowerPoint・CSV・ZIP など（100MBまで）', keys: 'tenpu file pdf word excel attach', action: 'file' },
  { g: '文章', ic: '※', name: '脚注', ds: '文の後ろに小さな番号を付け、注を記事の最後にまとめる', keys: 'kyakuchu footnote chu', text: '注を付けたい文[^1]\n\n[^1]: ここに注の中身', sel: 'ここに注の中身' },
  { g: '文章', ic: '∑', name: '数式', ds: '$$ で囲むと数式。文中なら $a^2$ のように書く', keys: 'suushiki math tex katex', text: '$$\nE = mc^2\n$$', sel: 'E = mc^2' },
  { g: '文章', ic: '{}', name: 'コード', ds: '```の後ろに言語名を書くと色分けされる', keys: 'code koodo program', text: '```js\nconsole.log("こんにちは")\n```', sel: 'console.log("こんにちは")' },
  { g: '画像・ボタン', ic: '▦', name: '表', ds: '縦横に整理した情報', keys: 'hyou table', text: '| 項目 | 内容 |\n| --- | --- |\n| A | 説明 |\n| B | 説明 |', sel: '項目' },
  { g: 'ページの部品', ic: '★', name: 'ヒーロー（大きな見出し）', ds: 'ページのいちばん上に置く大きな見出し。画像を入れると背景になる', keys: 'hero hiroo midashi top', text: ':::hero 大きな見出し\nひとことの説明をここに書きます。\n![](背景の画像のURL)\n[[行動してほしいこと]](contact)\n:::', sel: '大きな見出し' },
  { g: 'ページの部品', ic: '▦', name: '特徴カード', ds: '@ で区切った項目をカードで並べる。画像も入れられる', keys: 'cards kaado tokuchou feature service', text: ':::cards 3つの特徴\n@ 特徴1\n説明\n@ 特徴2\n説明\n@ 特徴3\n説明\n:::', sel: '3つの特徴' },
  { g: 'ページの部品', ic: '▬', name: '色の帯', ds: '背景に色をつけて、話のまとまりを分ける', keys: 'band obi section', text: ':::band 見出し\n本文\n:::', sel: '見出し' },
  { g: 'ページの部品', ic: 'Q', name: 'よくある質問', ds: '@ で区切った質問を、押すと答えが開く形で並べる', keys: 'faq yokuaru shitsumon', text: ':::faq よくある質問\n@ 質問1\n答え\n@ 質問2\n答え\n:::', sel: '質問1' },
  { g: 'ページの部品', ic: '➜', name: '行動を促す帯', ds: '申し込み・問い合わせへ誘う、目立つ帯とボタン', keys: 'cta koudou button', text: ':::cta まずはお気軽にご相談ください\n[[お問い合わせ]](contact)\n:::', sel: 'まずはお気軽にご相談ください' },
  { g: 'ページの部品', ic: '▣', name: '写真ギャラリー', ds: '画像を並べる。押すと大きく開く', keys: 'gallery shashin photo', text: ':::gallery 写真\n![説明](画像のURL)\n![説明](画像のURL)\n:::', sel: '写真' },
  { g: 'ページの部品', ic: '≡', name: '記事の一覧', ds: '新しい記事をカードで並べる。「見出し | 件数 | カテゴリ」', keys: 'posts kiji ichiran shinchaku', text: ':::posts 新着記事 | 6\n:::', sel: '新着記事' },
  { g: 'ページの部品', ic: '✉', name: '問い合わせフォーム', ds: '項目を - で書く。* で必須、（メール）（電話）（長文）（選択：A、B）', keys: 'contact form toiawase foomu', text: ':::contact お問い合わせ\n- お名前*\n- メールアドレス*（メール）\n- 電話番号（電話）\n- ご用件（選択：見積もり、取材、その他）\n- 内容*（長文）\nボタン: 送信する\n:::', sel: 'お問い合わせ' },
  { g: 'ページの部品', ic: '▶', name: '埋め込み（YouTube・地図）', ds: 'YouTube・Vimeo の URL、Google マップの「地図を埋め込む」の URL', keys: 'embed umekomi youtube map chizu', text: ':::embed https://www.youtube.com/watch?v=\n:::', sel: 'https://www.youtube.com/watch?v=' },
  { g: '画像・ボタン', ic: '◉', name: 'ボタン', ds: '申し込みページなどへの大きなボタン', keys: 'botan button cta', text: '[[ボタンの文字]](https://)', sel: 'ボタンの文字' },
  { g: '動く要素', live: 1, ic: 'Q', name: 'クイズ', ds: '選んで答え合わせ。正解の先頭に * を付けます', keys: 'quiz kuizu', text: ':::quiz 問題文\n- 選択肢\n- *正解の選択肢\n- 選択肢\n> 答えたあとに出る解説\n:::', sel: '問題文' },
  { g: '動く要素', live: 1, ic: '＝', name: '計算', ds: '数字を動かすと答えが変わる。--- の下が答え', keys: 'calc keisan', text: ':::calc 計算のタイトル\n単価 = 1200 円 (500〜3000)\n数量 = 10 個 (1〜50)\n---\n合計 = 単価 * 数量 | 円\n:::', sel: '計算のタイトル' },
  { g: '動く要素', live: 1, ic: '▮', name: 'グラフ', ds: '「項目 | 数値」を並べると棒グラフに', keys: 'chart graph gurafu', text: ':::chart グラフのタイトル\n4月 | 30\n5月 | 45\n6月 | 60\n:::', sel: 'グラフのタイトル' },
  { g: '動く要素', live: 1, ic: '⇥', name: 'タブ', ds: '@ で区切った内容を切り替えて見せる', keys: 'tabs tabu', text: ':::tabs\n@ タブ1\n内容\n@ タブ2\n内容\n:::', sel: 'タブ1' },
  { g: '動く要素', live: 1, ic: '①', name: '手順', ds: '@ で区切った手順を1つずつ進める', keys: 'steps tejun', text: ':::steps\n@ 手順1\n内容\n@ 手順2\n内容\n:::', sel: '手順1' },
  { g: '動く要素', live: 1, ic: '＋', name: '折りたたみ', ds: '押すと開く。補足や長い説明に', keys: 'details oritatami', text: ':::details 開くと読める見出し\n内容\n:::', sel: '開くと読める見出し' },
  { g: '動く要素', live: 1, ic: '⇆', name: '比較', ds: '2枚の画像を境目をずらして比べる', keys: 'compare hikaku before after', text: ':::compare\n![前](画像のURL)\n![後](画像のURL)\n:::' },
];

function renderEditor() {
  const p = S.data.posts.find(x => x.id === S.editId);
  if (!p) { S.view = 'list'; return route(); }
  root.innerHTML = `<section class="editor" data-pane="${S.pane}">
    <div class="ed-bar">
      <button class="btn ghost" type="button" id="ed-back">← 戻る</button>
      <span class="state" id="ed-state"></span>
      <a class="btn view" id="ed-view" href="${esc(readerHref(p))}" target="_blank" rel="noopener"${p.draft ? ' hidden' : ''}>記事を見る ↗</a>
      <button class="btn" type="button" id="ed-draft">下書き保存</button>
      <button class="btn primary" type="button" id="ed-pub">公開する</button>
    </div>
    <div id="ed-note"></div>
    <details class="settings"><summary>記事の設定（整理・読める人・URL・書き出し・削除）</summary><div class="set-grid">
      ${multiMedia() ? `<label class="field">メディア<select id="ed-media">${S.data.media.map(m => `<option value="${esc(m.id)}"${p.media === m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field" style="flex:0 0 150px;min-width:0">種類<select id="ed-kind"><option value="post"${p.kind !== 'page' ? ' selected' : ''}>記事</option><option value="page"${p.kind === 'page' ? ' selected' : ''}>固定ページ</option></select></label>
      <label class="field">カテゴリ（棚）<input id="ed-cat" list="cat-list" value="${esc(p.category || '')}" placeholder="例：マニュアル" maxlength="40">
        <datalist id="cat-list">${[...new Set(S.data.posts.map(x => x.category).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field">親の記事（章立て）<select id="ed-parent"><option value="">なし（いちばん上）</option>${parentOptions(p)}</select></label>
      <label class="field" style="flex:0 0 130px;min-width:0">並び順（小さいほど前）<input id="ed-order" type="number" step="any" value="${p.order ?? ''}" placeholder="空なら日付順"></label>
      <label class="field">読める人<select id="ed-vis"><option value="public"${p.visibility !== 'members' ? ' selected' : ''}>誰でも</option><option value="members"${p.visibility === 'members' ? ' selected' : ''}>ログインしたメンバーだけ</option></select></label>
    </div><p class="sub" id="fm-note" hidden>原稿の先頭（--- で挟んだ部分）にも設定が書かれています。保存するときは、原稿の先頭の設定が優先されます。</p><div class="set-grid">
      <label class="field">記事のURLの末尾（半角英数とハイフン）<input id="ed-slug" value="${esc(p.slug)}"></label>
      <label class="field" style="flex:0 0 160px;min-width:0">日付<input id="ed-date" type="date" value="${esc(p.date || today())}"></label>
    </div><div class="set-grid">
      <button class="btn" type="button" id="ed-md">Markdown で書き出す</button>
      <button class="btn" type="button" id="ed-html">HTML で書き出す</button>
      <span style="flex:1"></span>
      <button class="btn" type="button" id="ed-unpub"${p.draft ? ' hidden' : ''}>非公開に戻す</button>
      <button class="btn" type="button" id="ed-del">この記事を削除</button>
    </div></details>
    <div class="ed-tabs" role="tablist"><button type="button" data-pane="src" aria-selected="${S.pane === 'src'}">書く</button><button type="button" data-pane="prev" aria-selected="${S.pane === 'prev'}">読者に見える形</button></div>
    <div class="ed-panes">
      <div class="ed-src">
        <input id="ed-title" placeholder="タイトル" value="${esc(p.title)}" aria-label="タイトル">
        <div class="tools" id="tools">
          <button type="button" data-w="**" title="太字（⌘B / Ctrl+B）"><b>太字</b></button>
          <button type="button" data-w="==" title="マーカー（⌘M / Ctrl+M）">マーカー</button>
          <button type="button" data-link title="リンク（⌘K / Ctrl+K）">リンク</button>
          <button type="button" class="add" id="open-parts">＋ 部品を入れる</button>
        </div>
        <textarea id="src" spellcheck="false" aria-label="本文" placeholder="ここに本文を書きます。&#10;&#10;行の先頭で「/」を押すと、見出し・画像・クイズなどの部品を選べます。"></textarea>
        <div class="ed-stat" id="ed-stat"></div>
        <div class="palette" id="palette" hidden role="listbox" aria-label="部品"></div>
      </div>
      <div class="ed-prev"><div class="pane-h">読者に見える形</div><div class="pv" id="pv"></div></div>
    </div>
  </section>`;
  const src = $('src');
  src.value = p.body;
  let t;
  const refresh = () => {
    const r = renderBody(src.value, S.data.posts, u => u, slug => '/' + slug);
    $('pv').innerHTML = `<h1 class="pt${p.title ? '' : ' empty'}">${esc(p.title || 'タイトル')}</h1><div class="prose">${r.html}</div>`;
    hydrate($('pv'));
    $('ed-stat').innerHTML = `<span>${src.value.replace(/\s/g, '').length.toLocaleString()} 字</span><span>約${readMin(src.value)}分で読めます</span>` +
      `<span class="hint">行の先頭で <kbd>/</kbd> を押すと部品を選べます</span>`;
  };
  refresh();
  updateState();
  setupEditorExtras(p, src, refresh);
  if (!p.title) $('ed-title').focus(); else src.focus();

  /* 原稿の先頭の設定を読み、記事の項目と「記事の設定」欄に反映する */
  const applyFront = () => {
    const meta = frontMatter(src.value).meta;
    const keys = Object.keys(meta);
    Object.assign(p, resolveMeta(meta, { media: S.data.media, posts: S.data.posts, selfId: p.id }));
    const set = (id, v) => { const el = $(id); if (el && v !== undefined && el.value !== String(v ?? '')) el.value = v ?? ''; };
    set('ed-media', p.media); set('ed-kind', p.kind || 'post'); set('ed-cat', p.category); set('ed-order', p.order); set('ed-vis', p.visibility); set('ed-date', p.date); set('ed-slug', p.slug); set('ed-parent', p.parent || '');
    const note = $('fm-note');
    if (note) note.hidden = !keys.length;
  };
  applyFront();
  src.addEventListener('input', () => {
    p.body = src.value;
    applyFront();
    markDirty();
    clearTimeout(t); t = setTimeout(refresh, 150);
    slashCheck();
  });
  $('ed-title').addEventListener('input', e => {
    p.title = e.target.value;
    markDirty(); refresh();
  });
  $('ed-title').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); src.focus(); } });
  $('ed-slug').addEventListener('change', e => {
    const v = e.target.value.trim().replace(/[^A-Za-z0-9._~-]/g, '-');
    if (!v || S.data.posts.some(o => o !== p && o.slug === v)) { e.target.value = p.slug; toast('そのURLは使えません（空か、ほかの記事と同じです）'); return; }
    e.target.value = v; p.slug = v; history.replaceState(null, '', '/write#' + v); markDirty();
  });
  $('ed-date').addEventListener('change', e => { p.date = e.target.value; markDirty(); });
  $('ed-cat').addEventListener('input', e => { p.category = e.target.value.trim(); markDirty(); });
  $('ed-media')?.addEventListener('change', e => { p.media = e.target.value; markDirty(); });
  $('ed-kind').addEventListener('change', e => { p.kind = e.target.value; markDirty(); });
  $('ed-parent').addEventListener('change', e => { p.parent = e.target.value || null; markDirty(); });
  $('ed-order').addEventListener('input', e => { p.order = e.target.value === '' ? null : Number(e.target.value); markDirty(); });
  $('ed-vis').addEventListener('change', e => { p.visibility = e.target.value; markDirty(); });
  $('ed-md').addEventListener('click', () => exportPost(p, 'md'));
  $('ed-html').addEventListener('click', () => exportPost(p, 'html'));
  $('ed-back').addEventListener('click', closeEditor);
  $('ed-draft').addEventListener('click', async () => { p.draft = true; S.dirty = true; if (await save()) toast('下書きを保存しました。読者には見えません'); updateState(); });
  $('ed-pub').addEventListener('click', async () => {
    if (!p.title.trim()) { toast('タイトルを入れてください'); $('ed-title').focus(); return; }
    const first = p.draft;
    p.draft = false; S.dirty = true;
    if (await save()) { toast(first ? '公開しました。数十秒で読者のページに出ます' : '更新しました。数十秒で読者のページに反映されます'); updateState(); }
  });
  $('ed-unpub').addEventListener('click', async () => { p.draft = true; S.dirty = true; if (await save()) toast('非公開にしました。読者には見えません'); updateState(); });
  const del = $('ed-del');
  del.addEventListener('click', async () => {
    if (!del.classList.contains('armed')) {
      del.classList.add('armed'); del.textContent = 'もう一度押すと削除します';
      setTimeout(() => { del.classList.remove('armed'); del.textContent = 'この記事を削除'; }, 3000);
      return;
    }
    if (await deletePost(p)) { toast('記事を削除しました'); S.view = 'list'; history.replaceState(null, '', '/write'); route(); }
  });
  root.querySelectorAll('.ed-tabs button').forEach(b => b.addEventListener('click', () => {
    S.pane = b.dataset.pane;
    root.querySelector('.editor').dataset.pane = S.pane;
    root.querySelectorAll('.ed-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  }));

  const wrap = (pre, ph, post) => {
    const s = src.selectionStart, en = src.selectionEnd;
    const sel = src.value.slice(s, en) || ph;
    src.setRangeText(pre + sel + post, s, en, 'end');
    src.setSelectionRange(s + pre.length, s + pre.length + sel.length);
    src.dispatchEvent(new Event('input'));
  };
  const link = () => wrap('[', 'リンクの文字', '](https://)');
  $('tools').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'open-parts') { openPalette(null); return; }
    src.focus();
    if (b.dataset.w) wrap(b.dataset.w, b.dataset.w === '**' ? '太字' : 'マーカー', b.dataset.w);
    else if ('link' in b.dataset) link();
  });

  /* 部品パレット */
  const pal = $('palette');
  let palItems = [], palSel = 0, palSlash = null;
  function openPalette(slash) {
    palSlash = slash;
    const tools = $('tools');
    pal.style.top = (tools.offsetTop + tools.offsetHeight + 6) + 'px';
    pal.hidden = false;
    drawPalette(slash ? slash.q : '');
  }
  function closePalette() { pal.hidden = true; palSlash = null; }
  function drawPalette(q) {
    const k = q.trim().toLowerCase();
    palItems = PARTS.filter(x => !k || x.name.includes(k) || x.keys.includes(k) || x.ds.includes(k));
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    if (!palItems.length) { pal.innerHTML = `<div class="none">「${esc(q)}」に合う部品がありません。Esc で閉じます</div>`; return; }
    const groups = [...new Set(palItems.map(x => x.g))];
    let n = 0;
    pal.innerHTML = groups.map(g => `<div class="grp">${g}</div><div class="items">${palItems.filter(x => x.g === g).map(x => {
      const i = palItems.indexOf(x); n++;
      return `<button type="button" role="option" class="part${x.live ? ' live' : ''}${i === palSel ? ' sel' : ''}" data-i="${i}"><span class="ic">${x.ic}</span><span><span class="nm">${x.name}</span><span class="ds">${esc(x.ds)}</span></span></button>`;
    }).join('')}</div>`).join('');
    pal.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const part = palItems[i];
    if (!part) return;
    if (palSlash) {
      src.setRangeText('', palSlash.start, palSlash.end, 'start');
    }
    closePalette();
    src.focus();
    if (part.action === 'file') { $('file').click(); return; }
    if (part.action === 'front') { insertFront(src); src.dispatchEvent(new Event('input')); return; }
    insertBlock(src, part.text);
    if (part.sel) {
      const at = src.value.lastIndexOf(part.text, src.selectionStart);
      const off = part.text.indexOf(part.sel);
      if (at >= 0 && off >= 0) src.setSelectionRange(at + off, at + off + part.sel.length);
    }
    src.dispatchEvent(new Event('input'));
    if (part.live) toast(part.ds);
  }
  pal.addEventListener('mousedown', e => e.preventDefault());
  pal.addEventListener('click', e => { const b = e.target.closest('.part'); if (b) choose(+b.dataset.i); });
  function slashCheck() {
    const s = src.selectionStart;
    const ls = src.value.lastIndexOf('\n', s - 1) + 1;
    const m = src.value.slice(ls, s).match(/^\/(\S*)$/);
    if (m) { palSel = palSlash && palSlash.q === m[1] ? palSel : 0; openPalette({ start: ls, end: s, q: m[1] }); }
    else if (palSlash) closePalette();
  }
  src.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== src && !pal.contains(document.activeElement)) closePalette(); }, 120));

  src.addEventListener('keydown', e => {
    if (!pal.hidden) {
      const cols = Math.max(1, Math.round(pal.querySelector('.items')?.clientWidth / 212) || 1);
      if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + cols); drawPalette(palSlash ? palSlash.q : ''); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - cols); drawPalette(palSlash ? palSlash.q : ''); return; }
      if (e.key === 'ArrowRight' && palSlash) { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); drawPalette(palSlash.q); return; }
      if (e.key === 'ArrowLeft' && palSlash) { e.preventDefault(); palSel = Math.max(0, palSel - 1); drawPalette(palSlash.q); return; }
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); choose(palSel); return; }
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrap('**', '太字', '**'); return; }
      if (k === 'm') { e.preventDefault(); wrap('==', 'マーカー', '=='); return; }
      if (k === 'k') { e.preventDefault(); link(); return; }
      if (k === 's') { e.preventDefault(); (p.draft ? $('ed-draft') : $('ed-pub')).click(); return; }
    }
    if (e.key === 'Tab' && !e.isComposing) {
      e.preventDefault();
      const s = src.selectionStart, ls = src.value.lastIndexOf('\n', s - 1) + 1;
      if (e.shiftKey) { if (src.value.startsWith('  ', ls)) { src.setRangeText('', ls, ls + 2, 'preserve'); src.setSelectionRange(Math.max(ls, s - 2), Math.max(ls, s - 2)); } }
      else { src.setRangeText('  ', ls, ls, 'preserve'); src.setSelectionRange(s + 2, s + 2); }
      src.dispatchEvent(new Event('input'));
    }
  });
  document.addEventListener('keydown', function esc_(e) {
    if (!document.body.contains(pal)) { document.removeEventListener('keydown', esc_); return; }
    if (e.key === 'Escape' && !pal.hidden) closePalette();
  });
  src.addEventListener('paste', e => {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f && /^image\//.test(f.type)) { e.preventDefault(); addMedia(f); }
  });
  src.addEventListener('dragover', e => e.preventDefault());
  src.addEventListener('drop', e => {
    const f = [...(e.dataTransfer?.files || [])][0];
    if (f) { e.preventDefault(); addMedia(f); }
  });
}

function updateState() {
  const el = $('ed-state');
  if (!el) return;
  const p = S.data.posts.find(x => x.id === S.editId);
  if (!p) return;
  const status = p.draft ? '<strong>下書き</strong>（読者には見えません）' : '<strong>公開中</strong>';
  el.innerHTML = status + (S.dirty || Object.keys(S.pending).length ? '・保存していない変更があります' : '・保存済み');
  const pub = $('ed-pub');
  if (pub) pub.textContent = p.draft ? '公開する' : '更新を公開する';
  const vw = $('ed-view');
  if (vw) { vw.hidden = p.draft; vw.href = readerHref(p); }
  const dr = $('ed-draft');
  if (dr) dr.hidden = !p.draft;
  const un = $('ed-unpub');
  if (un) un.hidden = p.draft;
}



/* 原稿の先頭に設定を足す（もうあれば、そこへ移るだけ） */
function insertFront(src) {
  const fm = frontMatter(src.value);
  if (fm.raw) { src.setSelectionRange(4, fm.raw.length - 4); src.focus(); return; }
  const p = S.data.posts.find(x => x.id === S.editId);
  const m = mediaById(p && p.media);
  const lines = ['---', ...(multiMedia() ? [`メディア: ${m.name}`] : []), `デザイン: ${p?.theme ? THEME_NAMES[p.theme][0] : 'メディアと同じ'}`, `色: ${p?.color ? COLOR_NAMES[p.color] : 'メディアと同じ'}`, ...(p && p.category ? [`カテゴリ: ${p.category}`] : []), '---', ''];
  src.value = lines.join('\n') + src.value;
  src.setSelectionRange(4, 4 + lines[1].length);
  src.focus();
  toast('原稿の先頭に設定を入れました。デザインは 標準・ポップ・マガジン・ナチュラル・シンプル・テック、色は 青・赤・緑・橙・紫・青緑・黒 から選べます', 7000);
}

function insertBlock(src, text) {
  const s = src.selectionStart, v = src.value;
  const before = v.slice(0, s);
  const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  src.setRangeText(pre + text + '\n', s, src.selectionEnd, 'end');
}

/* ---- 起動 ---- */
async function start() {
  const me = await api('/api/me');
  if (!me.ok) { root.innerHTML = '<p class="empty-note">読み込めませんでした。少し待ってから再読み込みしてください。</p>'; return; }
  if (me.body.setupNeeded) return renderGate('setup');
  if (!me.body.user && inviteToken()) {
    const info = await api('/api/invite-info?token=' + encodeURIComponent(inviteToken()));
    if (!info.ok) { history.replaceState(null, '', '/write'); return renderGate('login', info.body.message); }
    if (info.body.kind === 'reset') return renderGate('reset', `${info.body.name}さん（ログインID：${info.body.loginId}）の新しいパスワードを決めてください。`);
    return renderGate('invite');
  }
  if (!me.body.user) return renderGate('login');
  S.me = me.body.user;
  if (nextPath()) { location.href = nextPath(); return; }
  if (S.me.role === 'reader') {
    $('nav').innerHTML = '<button class="btn ghost" type="button" id="logout">ログアウト</button>';
    $('logout').addEventListener('click', async () => { await post('/api/logout'); S.me = null; renderGate('login', 'ログアウトしました。'); });
    root.innerHTML = `<section class="notfound"><h1>${esc(S.me.name)}さんは閲覧者です</h1><p>メンバーだけが読める記事も読めます。書くことはできません。</p><p><a class="btn primary" href="/">サイトを読む</a> <a class="btn" href="/write#account">自分の設定</a></p></section>`;
    if (location.hash === '#account') { S.data = { site: {}, posts: [] }; renderAccount(); }
    return;
  }
  const r = await api('/api/content');
  if (!r.ok) { root.innerHTML = '<p class="empty-note">記事を読み込めませんでした。少し待ってから再読み込みしてください。</p>'; return; }
  S.data = r.body;
  if (isAdmin()) api('/api/inbox').then(x => { if (x.ok) { S.unread = x.body.messages.filter(m => !m.read).length; if (S.unread && S.view !== 'edit') renderNav(); } });
  applyHash();
}
start();
