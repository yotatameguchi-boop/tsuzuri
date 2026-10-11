/* 書く人の画面（/write）。ログイン → 記事一覧 → 編集 の3つだけ。 */
import { esc, renderBody, liveKinds, excerpt } from './render.js';
import { hydrate, hideTip } from './live.js';

const $ = id => document.getElementById(id);
const root = $('root');
const S = { data: null, view: 'list', editSlug: null, dirty: false, pending: {}, pane: 'src', saving: false };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = d => (d || '').replace(/-/g, '.');
const readMin = body => Math.max(1, Math.round(String(body || '').replace(/\s/g, '').length / 500));

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3000);
}

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  let body = null;
  try { body = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, body: body || {} };
}

/* ---- ログイン ---- */
function renderLogin(msg = '') {
  $('nav').innerHTML = '';
  root.innerHTML = `<form class="login" id="login"><h1>書く人のログイン</h1><p>このサイトの合言葉を入れてください。</p>
    <input type="password" id="pw" autocomplete="current-password" aria-label="合言葉" placeholder="合言葉" required>
    <div class="err" id="err">${esc(msg)}</div><button class="btn primary" type="submit">ログイン</button>
    <p><a href="/">← 読者のページへ</a></p></form>`;
  $('pw').focus();
  $('login').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) });
    btn.disabled = false;
    if (r.ok) start();
    else { $('err').textContent = r.body.message || 'ログインできませんでした'; $('pw').select(); }
  });
}

/* ---- 一覧 ---- */
function renderNav() {
  const nav = $('nav');
  nav.innerHTML = S.view === 'list'
    ? `<a class="btn ghost" href="/" target="_blank" rel="noopener">サイトを見る ↗</a><button class="btn ghost" type="button" id="logout">ログアウト</button><button class="btn primary" type="button" id="new-post">＋ 新しい記事</button>`
    : '';
  $('new-post')?.addEventListener('click', newPost);
  $('logout')?.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); renderLogin('ログアウトしました'); });
}

function renderList() {
  document.title = '記事の管理 | ' + (S.data.site.name || 'Tsuzuri');
  const site = S.data.site;
  const posts = [...S.data.posts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  root.innerHTML = `<section class="home-head"><h1>${esc(site.name || '無題のサイト')}</h1>${site.tagline ? `<p>${esc(site.tagline)}</p>` : ''}` +
    `<button class="btn ghost" type="button" id="site-open" style="margin-top:10px;margin-left:-10px">サイト名と説明を変える</button>` +
    `<form class="site-edit" id="site-form" hidden><input id="site-name" aria-label="サイト名" placeholder="サイト名" value="${esc(site.name || '')}">` +
    `<input id="site-tag" aria-label="サイトの説明" placeholder="サイトの説明（1行）" value="${esc(site.tagline || '')}">` +
    `<div class="row"><button class="btn primary" type="submit">保存</button><button class="btn ghost" type="button" id="site-cancel">やめる</button></div></form></section>` +
    `<section class="posts" aria-label="記事一覧">${posts.length ? posts.map(p => {
      const kinds = liveKinds(p.body);
      const chips = [...(p.draft ? ['<span class="chip draft">下書き（読者には見えません）</span>'] : []), ...kinds.map(k => `<span class="chip">${k}</span>`)];
      return `<div class="pr w"><a class="post-row" href="/write#${esc(p.slug)}" data-edit="${esc(p.slug)}"><time>${fmtDate(p.date)}</time><div><h2 class="t">${esc(p.title || '無題')}</h2></div>` +
        `<p class="x">${esc(excerpt(p.body))}</p>${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}</a>` +
        `<button class="btn row-edit" type="button" data-edit="${esc(p.slug)}">編集</button></div>`;
    }).join('') : `<div class="empty-note"><p>まだ記事がありません</p><button class="btn primary" type="button" id="first-post">最初の記事を書く</button></div>`}</section>`;
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); openEditor(b.dataset.edit); }));
  $('first-post')?.addEventListener('click', newPost);
  const form = $('site-form');
  $('site-open').addEventListener('click', () => { form.hidden = false; $('site-open').hidden = true; $('site-name').focus(); });
  $('site-cancel').addEventListener('click', renderList);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    site.name = $('site-name').value.trim() || site.name;
    site.tagline = $('site-tag').value.trim();
    S.dirty = true;
    if (await save()) { toast('サイト名と説明を保存しました'); renderList(); }
  });
}

function route() {
  hideTip();
  renderNav();
  if (S.view === 'edit') return renderEditor();
  renderList();
}

window.addEventListener('hashchange', () => {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'new') return newPost();
  if (h && S.data.posts.some(p => p.slug === h)) { if (S.editSlug !== h || S.view !== 'edit') openEditor(h); }
  else if (!h && S.view === 'edit') closeEditor();
});

/* ---- 編集 ---- */
function backup() { try { localStorage.setItem('tsuzuri-backup', JSON.stringify({ at: Date.now(), data: S.data })); } catch {} }
function markDirty() { S.dirty = true; backup(); updateState(); }

function newPost() {
  const slug = 'p-' + Date.now().toString(36);
  S.data.posts.push({ slug, title: '', date: today(), draft: true, body: '' });
  S.dirty = true;
  openEditor(slug);
}
function openEditor(slug) {
  S.view = 'edit'; S.editSlug = slug;
  if (location.hash !== '#' + slug) history.replaceState(null, '', '/write#' + slug);
  route(); window.scrollTo(0, 0);
}
function closeEditor() {
  const p = S.data.posts.find(x => x.slug === S.editSlug);
  const back = $('ed-back');
  const empty = p && !p.title.trim() && !p.body.trim();
  if (!empty && S.dirty && back && !back.classList.contains('armed')) {
    back.classList.add('armed'); back.textContent = '保存せずに戻る';
    toast('保存していない変更があります。戻るならもう一度押してください');
    setTimeout(() => { back.classList.remove('armed'); back.textContent = '← 戻る'; }, 4000);
    return;
  }
  if (empty) { S.data.posts = S.data.posts.filter(x => x !== p); S.dirty = false; }
  S.view = 'list';
  history.replaceState(null, '', '/write');
  route();
}

/* ---- 保存：記事データ全体をサーバーへ ---- */
async function save() {
  if (S.saving) return false;
  S.saving = true;
  const btns = [...document.querySelectorAll('#ed-pub, #ed-draft, #ed-unpub')];
  btns.forEach(b => { b.disabled = true; });
  const p = S.data.posts.find(x => x.slug === S.editSlug);
  if (p) p.updated = today();
  const { rev, ...data } = S.data;
  const r = await api('/api/content', { method: 'PUT', body: JSON.stringify({ rev, data }) });
  S.saving = false;
  btns.forEach(b => { b.disabled = false; });
  if (r.ok) {
    S.data.rev = r.body.rev; S.dirty = false;
    try { localStorage.removeItem('tsuzuri-backup'); } catch {}
    return true;
  }
  if (r.status === 401) { toast('ログインが切れました。もう一度ログインしてください'); backup(); renderLogin('ログインが切れました。書いた内容はこのブラウザに控えてあります'); }
  else if (r.status === 409) toast('ほかの画面で先に保存されています。ページを読み込み直してから、もう一度書いてください');
  else toast(r.body.message || '保存できませんでした。通信を確かめて、もう一度押してください');
  return false;
}
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---- 画像・動画：選んだらすぐサーバーに置いて、そのURLを原稿に入れる ---- */
$('file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) addMedia(f); });

async function addMedia(file) {
  const src = $('src');
  if (!src) return;
  let blob = file;
  if (/^image\//.test(file.type) && !/svg|gif/.test(file.type)) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const png = file.type === 'image/png' && file.size < 400000;
      blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.86));
    } catch {}
  } else if (/^video\//.test(file.type)) {
    if (file.size > 4 * 1024 * 1024) { toast('動画は4MBまでです。長い動画は YouTube に上げて、URLを1行で貼ってください'); return; }
  } else if (!/^image\//.test(file.type)) { toast('画像か動画（mp4・webm）を選んでください'); return; }
  toast('アップロード中…');
  const r = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type }, body: blob });
  let body = {};
  try { body = await r.json(); } catch {}
  if (!r.ok) { toast(body.message || 'アップロードできませんでした'); return; }
  const alt = file.name.replace(/\.[^.]+$/, '');
  insertBlock(src, `![${alt}](${body.url})`);
  src.dispatchEvent(new Event('input'));
  toast('入れました');
}

/* 「/」で呼び出す部品。name と keys で絞り込める */
const PARTS = [
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
  { g: '画像・ボタン', ic: '▦', name: '表', ds: '縦横に整理した情報', keys: 'hyou table', text: '| 項目 | 内容 |\n| --- | --- |\n| A | 説明 |\n| B | 説明 |', sel: '項目' },
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
  const p = S.data.posts.find(x => x.slug === S.editSlug);
  if (!p) { S.view = 'list'; return route(); }
  root.innerHTML = `<section class="editor" data-pane="${S.pane}">
    <div class="ed-bar">
      <button class="btn ghost" type="button" id="ed-back">← 戻る</button>
      <span class="state" id="ed-state"></span>
      <a class="btn view" id="ed-view" href="/${esc(p.slug)}" target="_blank" rel="noopener"${p.draft ? ' hidden' : ''}>記事を見る ↗</a>
      <button class="btn" type="button" id="ed-draft">下書き保存</button>
      <button class="btn primary" type="button" id="ed-pub">公開する</button>
    </div>
    <details class="settings"><summary>記事の設定（URL・日付・削除）</summary><div class="set-grid">
      <label class="field">記事のURLの末尾（半角英数とハイフン）<input id="ed-slug" value="${esc(p.slug)}"></label>
      <label class="field" style="flex:0 0 160px;min-width:0">日付<input id="ed-date" type="date" value="${esc(p.date || today())}"></label>
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
  if (!p.title) $('ed-title').focus(); else src.focus();

  src.addEventListener('input', () => {
    p.body = src.value;
    markDirty();
    clearTimeout(t); t = setTimeout(refresh, 150);
    slashCheck();
  });
  $('ed-title').addEventListener('input', e => {
    const old = p.title;
    p.title = e.target.value;
    for (const o of S.data.posts) if (o !== p && old && o.body.includes(`[[${old}]]`)) o.body = o.body.split(`[[${old}]]`).join(`[[${p.title}]]`);
    markDirty(); refresh();
  });
  $('ed-title').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); src.focus(); } });
  $('ed-slug').addEventListener('change', e => {
    const v = e.target.value.trim().replace(/[^A-Za-z0-9._~-]/g, '-');
    if (!v || S.data.posts.some(o => o !== p && o.slug === v)) { e.target.value = p.slug; toast('そのURLは使えません（空か、ほかの記事と同じです）'); return; }
    e.target.value = v; p.slug = v; S.editSlug = v; history.replaceState(null, '', '/write#' + v); markDirty();
  });
  $('ed-date').addEventListener('change', e => { p.date = e.target.value; markDirty(); });
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
    S.data.posts = S.data.posts.filter(o => o !== p);
    S.dirty = true;
    if (await save()) { toast('記事を削除しました'); S.view = 'list'; history.replaceState(null, '', '/write'); route(); }
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
  const p = S.data.posts.find(x => x.slug === S.editSlug);
  if (!p) return;
  const status = p.draft ? '<strong>下書き</strong>（読者には見えません）' : '<strong>公開中</strong>';
  el.innerHTML = status + (S.dirty || Object.keys(S.pending).length ? '・保存していない変更があります' : '・保存済み');
  const pub = $('ed-pub');
  if (pub) pub.textContent = p.draft ? '公開する' : '更新を公開する';
  const vw = $('ed-view');
  if (vw) { vw.hidden = p.draft; vw.href = '/' + p.slug; }
  const dr = $('ed-draft');
  if (dr) dr.hidden = !p.draft;
  const un = $('ed-unpub');
  if (un) un.hidden = p.draft;
}


function insertBlock(src, text) {
  const s = src.selectionStart, v = src.value;
  const before = v.slice(0, s);
  const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  src.setRangeText(pre + text + '\n', s, src.selectionEnd, 'end');
}

/* ---- 起動 ---- */
async function start() {
  const r = await api('/api/content');
  if (r.status === 401) {
    const me = await api('/api/me');
    return renderLogin(me.body.passwordConfigured === false ? 'このサイトにはまだ合言葉が設定されていません（Vercel の環境変数 TSUZURI_PASSWORD）' : '');
  }
  if (!r.ok) { root.innerHTML = `<p class="empty-note">読み込めませんでした。少し待ってから再読み込みしてください。</p>`; return; }
  S.data = r.body;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('tsuzuri-backup') || 'null'); } catch {}
  if (saved && saved.data && saved.data.rev === S.data.rev) {
    $('notice-slot').innerHTML = `<div class="notice" style="margin-inline:16px"><span>保存していない変更がこのブラウザに残っています。</span><button class="btn primary" type="button" id="rs-yes">その変更を保存する</button><button class="btn ghost" type="button" id="rs-no">捨てる</button></div>`;
    $('rs-yes').addEventListener('click', async () => { S.data = saved.data; S.dirty = true; if (await save()) { $('notice-slot').innerHTML = ''; toast('残っていた変更を保存しました'); route(); } });
    $('rs-no').addEventListener('click', () => { try { localStorage.removeItem('tsuzuri-backup'); } catch {} $('notice-slot').innerHTML = ''; });
  }
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'new') return newPost();
  if (h && S.data.posts.some(p => p.slug === h)) return openEditor(h);
  S.view = 'list';
  route();
}
start();
