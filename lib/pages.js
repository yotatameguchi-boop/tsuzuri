/* 読者向けのページをサーバーで組み立てる。検索エンジンとSNSのプレビューが本文とタイトルを読めるように、
   記事はHTMLとして完成した状態で返し、動く部分だけをブラウザの live.js が動かす。

   1つの Tsuzuri で、名前のちがう複数のメディア（例：「あしかもメディア」「じもころ」）を出せる。
   - メディアが1つのときは、これまでどおりサイトの直下（/記事のURL）
   - 2つ以上になったら、メディアごとに /メディアのURL/ の下に置き、/ は全体のトップページになる
   記事の整理は3つ：カテゴリ（棚）、親の記事（章立て）、並び順（数字が小さいほど前。無ければ新しい順）。 */
import { esc, renderBody, excerpt, plainText } from '../public/assets/render.js';

const BASE_FONTS = ['M+PLUS+1+Code:wght@400;500', 'Shippori+Mincho+B1:wght@600;800', 'Zen+Kaku+Gothic+New:wght@400;500;700'];
const fontsUrl = extra => 'https://fonts.googleapis.com/css2?' + [...BASE_FONTS, ...(extra || [])].map(f => 'family=' + f).join('&') + '&display=swap';

/* メディアのデザイン（ひな形）。色とは別に選べる。どれも明るい画面・暗い画面の両方で読めるようにしてある */
export const THEMES = {
  standard: { name: '標準', note: '明朝の見出しと黒い線。落ち着いた読みもの向け', fonts: [], css: '' },
  pop: {
    name: 'ポップ', note: '丸ゴシック・丸い角・色つきの見出し。親しみやすいメディア向け', fonts: ['Zen+Maru+Gothic:wght@500;700;900'],
    css: `:root{--serif:"Zen Maru Gothic","Hiragino Maru Gothic ProN",sans-serif;--sans:"Zen Maru Gothic","Hiragino Maru Gothic ProN",sans-serif}
body{background:var(--bg-2)}.bar{background:var(--bg-2);border-bottom-color:transparent}
.logo .k{border-radius:50%}
.home-head h1,.article-head h1,.post-row .t,.shelf h2,.prose h2,.mc-name{font-weight:900}
.posts{border-top:0;display:grid;gap:12px}
.post-row{background:var(--bg);border:0;border-radius:18px;padding:18px 22px;box-shadow:0 2px 0 var(--line)}
.article{background:var(--bg);border-radius:24px;padding:28px clamp(16px,4vw,40px)}
.prose h2{border-top:0;background:var(--blue-soft);padding:.45em .9em;border-radius:14px}
.prose h3{border-left:0;padding-left:0;text-decoration:underline wavy var(--blue);text-decoration-thickness:2px;text-underline-offset:7px}
.box,.live,.card,.pager a,.chapter,.media-card,.result{border-radius:18px}
.btn{border-radius:999px}.shelf h2{border-bottom-style:dashed}.post-foot{border-top-style:dashed}`,
  },
  magazine: {
    name: 'マガジン', note: '大きな明朝のタイトル・二重線・最初の文字を大きく。雑誌のような読みもの向け', fonts: ['Noto+Serif+JP:wght@400;700;900'],
    css: `:root{--serif:"Noto Serif JP","Hiragino Mincho ProN",serif}
.prose{font-family:"Noto Serif JP","Hiragino Mincho ProN",serif;font-size:17px;line-height:2.05}
.home-head{text-align:center}.home-head h1{font-size:clamp(36px,6vw,60px);letter-spacing:.06em;font-weight:900}
.article-head{text-align:center}.article-head .meta,.article-head .crumbs{justify-content:center}
.article-head h1{font-size:clamp(30px,5vw,46px);letter-spacing:.04em;font-weight:900}
.posts,.post-foot{border-top:3px double var(--ink)}
.prose h2{border-top:3px double var(--ink);text-align:center;padding-top:1em;letter-spacing:.06em}
.prose h3{border-left:0;padding-left:0;border-bottom:1px solid var(--ink);padding-bottom:.25em}
.prose > p:first-of-type::first-letter{font-family:var(--serif);font-size:3.2em;float:left;line-height:1;margin:.06em .12em 0 0;color:var(--blue);font-weight:900}
.logo .k,.box,.live,.card{border-radius:0}.shelf h2{border-bottom:3px double var(--ink)}`,
  },
  natural: {
    name: 'ナチュラル', note: 'やわらかい手書き風の書体・生成りの背景・点線。暮らしや地域のメディア向け', fonts: ['Kiwi+Maru:wght@400;500'],
    vars: { light: '--bg:#f7f4ec;--bg-2:#efeadf;--line:#e2dccd;--ink-2:#4a463c', dark: '--bg:#18170f;--bg-2:#22201a;--line:#38342a;--ink-2:#cfc9b8' },
    css: `:root{--serif:"Kiwi Maru",serif;--sans:"Kiwi Maru","Zen Kaku Gothic New",sans-serif}
.logo .k{border-radius:42% 58% 55% 45% / 52% 44% 56% 48%}
.prose h2{border-top:0;padding-top:0;border-bottom:2px dotted var(--blue);padding-bottom:.3em}
.prose h3{border-left:0;padding-left:1.5em;position:relative}
.prose h3::before{content:"";position:absolute;left:0;top:.5em;width:.8em;height:.8em;border-radius:50%;background:var(--blue-soft);border:2px solid var(--blue)}
.posts,.post-foot{border-top:2px dotted var(--ink)}.shelf h2{border-bottom:2px dotted var(--ink)}
.box,.live,.card,.media-card{border-radius:14px}.btn{border-radius:999px}`,
  },
  simple: {
    name: 'シンプル', note: '線を減らしたゴシック。情報を早く読ませたいマニュアルやお知らせ向け', fonts: [],
    css: `:root{--serif:"Zen Kaku Gothic New","Hiragino Sans",sans-serif}
.home-head h1,.article-head h1,.post-row .t,.shelf h2,.prose h2,.mc-name{font-weight:700}
.posts,.post-foot{border-top:1px solid var(--line)}.shelf h2{border-bottom:1px solid var(--line)}
.prose h2{border-top:0;padding-top:0;font-size:22px}
.prose h3{border-left:0;padding-left:0}
.logo .k{border-radius:8px}
.box{border-width:0 0 0 3px;border-radius:0}`,
  },
  tech: {
    name: 'テック', note: '等幅の書体と「#」つきの見出し。技術ブログや開発メモ向け', fonts: [],
    css: `:root{--serif:"M PLUS 1 Code",ui-monospace,monospace}
.home-head h1::before{content:"> ";color:var(--blue)}
.prose h2{border-top:1px dashed var(--line)}
.prose h2::before{content:"## ";color:var(--blue)}
.prose h3{border-left:0;padding-left:0}
.prose h3::before{content:"### ";color:var(--blue)}
.logo .k{border-radius:3px;font-family:var(--mono)}
.box,.live,.card,.btn,.media-card{border-radius:4px}
.post-row time,.meta{font-family:var(--mono)}`,
  },
};
const themeCss = (key, custom) => {
  const t = THEMES[key] || THEMES.standard;
  const vars = t.vars ? `:root{${t.vars.light}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${t.vars.dark}}}:root[data-theme="dark"]{${t.vars.dark}}` : '';
  /* 追加のCSSは管理者だけが書ける。<style> から抜け出せないよう「<」を外す */
  return vars + t.css + (custom ? '\n/* このメディアの追加のCSS */\n' + String(custom).replace(/</g, '') : '');
};

/* メディアの色。明るい画面と暗い画面で、読みやすい組み合わせを選んである */
export const COLORS = {
  blue: { name: '青', light: ['#1f56e0', '#eaf0fe', '#c7d6fb'], dark: ['#5b8cff', '#16213d', '#2a3d70'] },
  red: { name: '赤', light: ['#c8332f', '#fdecec', '#f5c4c2'], dark: ['#ff7a72', '#341716', '#6b2c29'] },
  green: { name: '緑', light: ['#12804e', '#e6f4ec', '#b9e0c9'], dark: ['#4cc78a', '#11261b', '#24503a'] },
  orange: { name: '橙', light: ['#b9520c', '#fdf0e5', '#f3cfb1'], dark: ['#ff9a4d', '#33200f', '#6b4220'] },
  purple: { name: '紫', light: ['#6847b8', '#f0ebfb', '#d6c9f3'], dark: ['#a98cff', '#231a3d', '#46377a'] },
  teal: { name: '青緑', light: ['#0d7680', '#e3f3f4', '#b3dde0'], dark: ['#47c6d0', '#0f2a2c', '#22545a'] },
  ink: { name: '黒', light: ['#0b0d12', '#eef0f3', '#cfd3da'], dark: ['#f2f4f8', '#1d2027', '#3a3f4a'] },
};
const colorVars = key => {
  const c = COLORS[key] || COLORS.blue;
  const v = ([a, s, l], ink) => `--blue:${a};--blue-soft:${s};--blue-line:${l};--blue-ink:${ink};--point-bg:${s};--point-bd:${a}`;
  return `:root{${v(c.light, key === 'ink' ? '#ffffff' : '#ffffff')}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${v(c.dark, '#0a0b0e')}}}:root[data-theme="dark"]{${v(c.dark, '#0a0b0e')}}`;
};

const fmtDate = d => (d || '').replace(/-/g, '.');
const readMin = body => Math.max(1, Math.round(String(body || '').replace(/\s/g, '').length / 500));
const firstImage = (body, origin) => {
  const m = String(body || '').match(/^!\[[^\]]*\]\(([^)\s]+\.(?:jpe?g|png|webp|gif))/mi);
  if (!m) return '';
  return /^https?:/.test(m[1]) ? m[1] : origin + '/' + m[1].replace(/^\//, '');
};

/* ---- メディアとURL ---- */
export const multi = data => data.media.length > 1;
export const mediaOf = (data, p) => data.media.find(m => m.id === p.media) || data.media[0];
export const mediaBase = (data, m) => multi(data) ? '/' + m.slug : '';
export const postHref = (data, p) => `${mediaBase(data, mediaOf(data, p))}/${p.slug}`;
const catHref = (data, m, c) => `${mediaBase(data, m)}/c/${encodeURIComponent(c)}`;

/* ---- 誰に何を見せるか ---- */
export const siteIsPrivate = data => data.site.visibility === 'members';
export const mediaIsPrivate = (data, m) => siteIsPrivate(data) || m.visibility === 'members';
export const hasMembersPosts = data => siteIsPrivate(data) || data.media.some(m => m.visibility === 'members') || data.posts.some(p => !p.draft && p.visibility === 'members');
export const visibleMedia = (data, viewer) => data.media.filter(m => viewer || !mediaIsPrivate(data, m));
export function visiblePosts(data, viewer, media = null) {
  const ok = new Set(visibleMedia(data, viewer).map(m => m.id));
  return data.posts.filter(p => !p.draft && ok.has(mediaOf(data, p).id) && (p.visibility !== 'members' || viewer) && (!media || mediaOf(data, p).id === media.id));
}
/* 誰でも読める記事（サイトマップ・RSS 用） */
export const publicPosts = (data, media = null) => visiblePosts(data, null, media);

/* ---- 並べ方 ---- */
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
function byOrder(a, b) {
  const x = Number.isFinite(a.order), y = Number.isFinite(b.order);
  if (x && y && a.order !== b.order) return a.order - b.order;
  if (x !== y) return x ? -1 : 1;
  return byDateDesc(a, b);
}
export function categories(posts) {
  const seen = new Map();
  for (const p of [...posts].sort(byOrder)) if (p.category && !seen.has(p.category)) seen.set(p.category, true);
  return [...seen.keys()];
}
function childrenOf(posts) {
  const ids = new Set(posts.map(p => p.id));
  const kids = new Map();
  for (const p of posts) {
    const parent = p.parent && ids.has(p.parent) ? p.parent : null;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(p);
  }
  for (const arr of kids.values()) arr.sort(byOrder);
  return kids;
}
function treeHtml(data, posts, kids, parent = null, depth = 0) {
  const list = kids.get(parent) || [];
  if (!list.length || depth > 6) return '';
  return `<ul class="tree${depth ? ' sub' : ''}">${list.map(p =>
    `<li><a href="${esc(postHref(data, p))}">${esc(p.title)}</a>${p.visibility === 'members' ? '<span class="lock">メンバー限定</span>' : ''}${treeHtml(data, posts, kids, p.id, depth + 1)}</li>`).join('')}</ul>`;
}

/* ---- ページの外枠：メディアごとに名前・ロゴ・色が変わる ---- */
function layout({ data, media, title, desc = '', url, image, type = 'website', body, slug = '', author = '', jsonld, noindex = false, q = '' }) {
  const brand = media || { name: data.site.name || 'Tsuzuri', mark: '綴', color: 'blue', slug: '' };
  const home = media ? (mediaBase(data, media) || '/') : '/';
  const searchAction = media ? `${mediaBase(data, media)}/search` : '/search';
  const feedHref = media ? `${mediaBase(data, media)}/feed.xml` : '/feed.xml';
  const network = multi(data) && media ? `<a href="/">${esc(data.site.name || 'Tsuzuri')}</a> のメディア　` : '';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:site_name" content="${esc(brand.name)}">
<meta property="og:locale" content="ja_JP">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="alternate" type="application/rss+xml" title="${esc(brand.name)}" href="${feedHref}">`}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontsUrl((THEMES[brand.theme] || THEMES.standard).fonts)}">
<link rel="stylesheet" href="/assets/style.css">
<style>${colorVars(brand.color)}${themeCss(brand.theme, brand.css)}</style>
${jsonld && !noindex ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<div id="progress" aria-hidden="true"></div>
<header class="bar"><div class="bar-in">
  <a class="logo" href="${home}" aria-label="${esc(brand.name)}のトップへ"><span class="k${[...(brand.mark || '綴')].length > 1 ? ' two' : ''}">${esc(brand.mark || '綴')}</span><span class="w">${esc(brand.name)}</span></a>
  <form class="search-mini" action="${searchAction}" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="${media && multi(data) ? esc(brand.name) + 'の中を検索' : 'サイト内を検索'}" aria-label="検索"></form>
  <nav id="nav" data-slug="${esc(slug)}" data-author="${esc(author)}"></nav>
</div></header>
<main>${body}</main>
<footer class="site-foot"><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(brand.name)}</span><span>${network}${noindex ? '' : `<a href="${feedHref}">RSS</a>　`}Tsuzuri で作成</span></div></footer>
<div id="tip" role="tooltip" hidden></div>
<script type="module" src="/assets/live.js"></script>
</body>
</html>`;
}

const postRow = (data, p, showMedia) => `<div class="pr"><a class="post-row" href="${esc(postHref(data, p))}"><time datetime="${esc(p.date)}">${fmtDate(p.date)}</time><div>${showMedia ? `<span class="media-tag">${esc(mediaOf(data, p).name)}</span>` : ''}<h2 class="t">${esc(p.title)}</h2></div>` +
  `<p class="x">${esc(excerpt(p.body))}</p></a></div>`;

/* ---- 全体のトップ（メディアが2つ以上のとき） ---- */
export function portalPage(data, origin, viewer) {
  const site = data.site;
  const cards = visibleMedia(data, viewer).map(m => {
    const latest = visiblePosts(data, viewer, m).sort(byDateDesc).slice(0, 3);
    const c = COLORS[m.color] || COLORS.blue;
    return `<section class="media-card" style="--mc:${c.light[0]};--mc-soft:${c.light[1]}">
      <a class="mc-head" href="/${esc(m.slug)}/"><span class="k${[...(m.mark || '綴')].length > 1 ? ' two' : ''}">${esc(m.mark || '綴')}</span><span><span class="mc-name">${esc(m.name)}</span>${m.tagline ? `<span class="mc-tag">${esc(m.tagline)}</span>` : ''}</span></a>
      ${latest.length ? `<ul class="mc-list">${latest.map(p => `<li><a href="${esc(postHref(data, p))}"><time>${fmtDate(p.date)}</time>${esc(p.title)}</a></li>`).join('')}</ul>` : '<p class="empty-note">まだ記事がありません</p>'}
      <a class="mc-more" href="/${esc(m.slug)}/">${esc(m.name)}を読む →</a>${mediaIsPrivate(data, m) ? '<span class="lock">メンバー限定</span>' : ''}
    </section>`;
  }).join('');
  const latest = visiblePosts(data, viewer).sort(byDateDesc).slice(0, 8);
  const body = `<section class="home-head"><h1>${esc(site.name || 'Tsuzuri')}</h1>${site.tagline ? `<p>${esc(site.tagline)}</p>` : ''}</section>` +
    `<div class="media-grid">${cards}</div>` +
    (latest.length ? `<section class="posts" aria-label="すべてのメディアの新着"><h2 class="list-h">すべてのメディアの新着</h2>${latest.map(p => postRow(data, p, true)).join('')}</section>` : '');
  return layout({
    data, media: null, title: site.name || 'Tsuzuri', desc: site.tagline || '', url: origin + '/', body, noindex: siteIsPrivate(data),
    jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, description: site.tagline, url: origin + '/' },
  });
}

/* ---- メディアのトップ ---- */
export function homePage(data, origin, viewer, media) {
  const posts = visiblePosts(data, viewer, media);
  const cats = categories(posts);
  let main;
  if (cats.length) {
    const latest = [...posts].sort(byDateDesc).slice(0, 5);
    const shelves = [...cats, null].map(c => {
      const inCat = posts.filter(p => (p.category || null) === c);
      if (!inCat.length) return '';
      return `<section class="shelf"><h2>${c ? `<a href="${esc(catHref(data, media, c))}">${esc(c)}</a>` : 'そのほか'}<span class="n">${inCat.length}</span></h2>${treeHtml(data, inCat, childrenOf(inCat))}</section>`;
    }).join('');
    main = `<section class="posts" aria-label="新着"><h2 class="list-h">新着</h2>${latest.map(p => postRow(data, p)).join('')}</section><div class="shelves">${shelves}</div>`;
  } else {
    main = `<section class="posts" aria-label="記事一覧">${[...posts].sort(byDateDesc).map(p => postRow(data, p)).join('') || '<p class="empty-note">まだ記事がありません</p>'}</section>`;
  }
  const body = `<section class="home-head">${multi(data) ? `<p class="crumbs"><a href="/">${esc(data.site.name || 'Tsuzuri')}</a></p>` : ''}<h1>${esc(media.name)}</h1>${media.tagline ? `<p>${esc(media.tagline)}</p>` : ''}</section>${main}`;
  return layout({
    data, media, title: media.name, desc: media.tagline || excerpt(posts[0]?.body || ''), url: origin + (mediaBase(data, media) || '') + '/', body, noindex: mediaIsPrivate(data, media),
    jsonld: { '@context': 'https://schema.org', '@type': 'Blog', name: media.name, description: media.tagline, url: origin + (mediaBase(data, media) || '') + '/' },
  });
}

export function categoryPage(data, origin, viewer, media, cat) {
  const posts = visiblePosts(data, viewer, media).filter(p => p.category === cat);
  if (!posts.length) return null;
  const body = `<section class="home-head"><p class="crumbs"><a href="${mediaBase(data, media) || '/'}">${esc(media.name)}</a></p><h1>${esc(cat)}</h1><p>${posts.length}本の記事</p></section>` +
    `<section class="posts shelf-page">${treeHtml(data, posts, childrenOf(posts))}</section>`;
  return layout({ data, media, title: `${cat} | ${media.name}`, desc: `${cat}の記事一覧`, url: origin + catHref(data, media, cat), body, noindex: mediaIsPrivate(data, media) });
}

export function postPage(data, p, origin, viewer) {
  const media = mediaOf(data, p);
  const posts = visiblePosts(data, viewer, media);
  const all = visiblePosts(data, viewer);
  const r = renderBody(p.body, all, u => u, slug => { const x = all.find(y => y.slug === slug); return x ? postHref(data, x) : '/' + slug; });
  const byId = new Map(posts.map(x => [x.id, x]));
  const chain = [];
  for (let cur = byId.get(p.parent); cur && chain.length < 8 && !chain.includes(cur); cur = byId.get(cur.parent)) chain.unshift(cur);
  const crumbs = [`<a href="${mediaBase(data, media) || '/'}">${esc(media.name)}</a>`, ...(p.category ? [`<a href="${esc(catHref(data, media, p.category))}">${esc(p.category)}</a>`] : []),
    ...chain.map(c => `<a href="${esc(postHref(data, c))}">${esc(c.title)}</a>`)];
  const siblings = posts.filter(x => (x.category || null) === (p.category || null) && (byId.has(x.parent) ? x.parent : null) === (byId.has(p.parent) ? p.parent : null)).sort(byOrder);
  const k = siblings.indexOf(p);
  const prev = k > 0 ? siblings[k - 1] : null, next = k >= 0 && k < siblings.length - 1 ? siblings[k + 1] : null;
  const kids = childrenOf(posts);
  const back = all.filter(o => o !== p && o.body.includes(`[[${p.title}]]`));
  const toc = r.headings.length > 1 ? `<nav class="toc" aria-label="目次"><h2>目次</h2><ol>${r.headings.filter(h => h.lv <= 3).map(h =>
    `<li class="l${h.lv}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>` : '';
  const list = (h, arr) => arr.length ? `<div><h2>${h}</h2><ul>${arr.map(o => `<li><a href="${esc(postHref(data, o))}">${esc(o.title)}</a></li>`).join('')}</ul></div>` : '';
  const pager = prev || next ? `<nav class="pager" aria-label="前後の記事">${prev ? `<a class="prev" href="${esc(postHref(data, prev))}"><span>← 前</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${esc(postHref(data, next))}"><span>次 →</span>${esc(next.title)}</a>` : ''}</nav>` : '';
  const children = (kids.get(p.id) || []).length ? `<section class="chapter"><h2>この中の記事</h2>${treeHtml(data, posts, kids, p.id)}</section>` : '';
  const members = p.visibility === 'members' || mediaIsPrivate(data, media);
  const backHref = p.category ? catHref(data, media, p.category) : (mediaBase(data, media) || '/');
  const body = `<div class="post-layout"><article class="article"><header class="article-head">` +
    `<p class="crumbs">${crumbs.join('<span aria-hidden="true">›</span>')}</p><h1>${esc(p.title)}</h1>` +
    `<div class="meta"><time datetime="${esc(p.date)}">${fmtDate(p.date)}</time>${p.updated && p.updated !== p.date ? `<span>更新 ${fmtDate(p.updated)}</span>` : ''}${p.authorName ? `<span>${esc(p.authorName)}</span>` : ''}<span>約${readMin(p.body)}分で読めます</span>${members ? '<span class="lock">メンバー限定</span>' : ''}</div></header>` +
    `<div class="prose">${r.html}</div>${children}${pager}` +
    `<footer class="post-foot">${list('この記事にリンクしている記事', back)}<div><a class="btn" href="${esc(backHref)}">← ${p.category ? esc(p.category) + 'の一覧へ' : esc(media.name) + 'のトップへ'}</a></div></footer></article>${toc}</div>`;
  const url = origin + postHref(data, p);
  const desc = excerpt(p.body, 110);
  const image = firstImage(p.body, origin);
  return layout({
    data, media, title: `${p.title} | ${media.name}`, desc, url, image, type: 'article', slug: p.slug, author: p.author || '', body, noindex: members,
    jsonld: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, ...(p.authorName ? { author: { '@type': 'Person', name: p.authorName } } : {}), publisher: { '@type': 'Organization', name: media.name }, datePublished: p.date, dateModified: p.updated || p.date, description: desc, url, ...(image ? { image } : {}) },
  });
}

/* ---- 検索：ひらがな/カタカナ・全角/半角・大文字/小文字のちがいを気にせず、全部の語を含む記事を探す ---- */
const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
export function search(data, viewer, q, media = null) {
  const terms = fold(q).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const out = [];
  for (const p of visiblePosts(data, viewer, media)) {
    const text = plainText(p.body);
    const ft = fold(p.title), fb = fold(text), fc = fold(p.category);
    if (!terms.every(t => ft.includes(t) || fb.includes(t) || fc.includes(t))) continue;
    let score = 0;
    for (const t of terms) { score += (ft.includes(t) ? 10 : 0) + (fc.includes(t) ? 3 : 0) + Math.min(5, fb.split(t).length - 1); }
    /* 抜粋：最初に見つかった語のまわり。fold しても文字数は変わらないので位置をそのまま使える */
    const at = fb.length === text.length ? Math.min(...terms.map(t => fb.indexOf(t)).filter(i => i >= 0), Infinity) : Infinity;
    const start = at === Infinity ? 0 : Math.max(0, at - 40);
    out.push({ p, score, snippet: (start ? '…' : '') + text.slice(start, start + 120) + (text.length > start + 120 ? '…' : '') });
  }
  return out.sort((a, b) => b.score - a.score || byDateDesc(a.p, b.p));
}
function highlight(text, q) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  const ft = fold(text);
  if (ft.length !== text.length) return esc(text);
  const marks = new Array(text.length).fill(false);
  for (const t of terms) for (let i = ft.indexOf(t); i >= 0; i = ft.indexOf(t, i + 1)) for (let j = i; j < i + t.length; j++) marks[j] = true;
  let html = '', open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] && !open) { html += '<mark>'; open = true; }
    if (!marks[i] && open) { html += '</mark>'; open = false; }
    html += esc(text[i]);
  }
  return html + (open ? '</mark>' : '');
}
export function searchPage(data, origin, viewer, q, media = null) {
  const results = search(data, viewer, q, media);
  const showMedia = multi(data) && !media;
  const where = media && multi(data) ? `${esc(media.name)}の中を検索` : 'サイト内を検索';
  const action = media ? `${mediaBase(data, media)}/search` : '/search';
  const list = q.trim()
    ? (results.length ? `<p class="sub">「${esc(q)}」を含む記事：${results.length}本</p><div class="results">${results.map(r =>
      `<a class="result" href="${esc(postHref(data, r.p))}"><span class="crumb">${[showMedia ? mediaOf(data, r.p).name : '', r.p.category || ''].filter(Boolean).map(esc).join(' › ')}</span><h2>${highlight(r.p.title, q)}</h2><p>${highlight(r.snippet, q)}</p></a>`).join('')}</div>`
      : `<p class="empty-note">「${esc(q)}」を含む記事は見つかりませんでした。言葉を短くするか、別の言い方で探してみてください。</p>`)
    : '<p class="empty-note">探したい言葉を入れてください。</p>';
  const body = `<section class="search-page"><h1>${where}</h1><form action="${action}" role="search" class="search-big"><input type="search" name="q" value="${esc(q)}" aria-label="検索する言葉" autofocus><button class="btn primary" type="submit">検索</button></form>${list}</section>`;
  return layout({ data, media, title: `${q ? q + ' の検索結果' : '検索'} | ${media ? media.name : data.site.name || 'Tsuzuri'}`, url: origin + action, body, noindex: true, q });
}

/* メンバーだけが読めるメディアで、ログインしていない人に出すページ */
export function gatePage(data, origin, path, media = null) {
  const name = media ? media.name : data.site.name || 'Tsuzuri';
  return layout({
    data, media, title: name, url: origin + '/', noindex: true,
    body: `<section class="notfound"><h1>${esc(name)}はメンバーだけが読めます</h1><p>読むにはログインしてください。アカウントは管理者からの招待で作れます。</p><p><a class="btn primary" href="/write?next=${encodeURIComponent(path)}">ログイン</a></p></section>`,
  });
}

export function notFoundPage(data, origin, media = null) {
  return layout({
    data, media, title: `ページが見つかりません | ${media ? media.name : data.site.name || 'Tsuzuri'}`, url: origin + '/', noindex: true,
    body: `<section class="notfound"><h1>ページが見つかりません</h1><p>記事が削除されたか、URLが変わったか、メンバーだけが読める記事の可能性があります。</p><p><a class="btn" href="${media ? mediaBase(data, media) || '/' : '/'}">トップへ</a> <a class="btn" href="/write?next=${encodeURIComponent('/')}">ログイン</a></p></section>`,
  });
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sitemap(data, origin) {
  const urls = [];
  if (!siteIsPrivate(data)) {
    urls.push(`<url><loc>${xml(origin)}/</loc></url>`);
    for (const m of visibleMedia(data, null)) {
      if (multi(data)) urls.push(`<url><loc>${xml(origin + mediaBase(data, m))}/</loc></url>`);
      const posts = publicPosts(data, m);
      for (const c of categories(posts)) urls.push(`<url><loc>${xml(origin + catHref(data, m, c))}</loc></url>`);
      for (const p of posts) urls.push(`<url><loc>${xml(origin + postHref(data, p))}</loc>${p.date ? `<lastmod>${xml(p.updated || p.date)}</lastmod>` : ''}</url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function feed(data, origin, media = null) {
  const items = publicPosts(data, media).sort(byDateDesc).slice(0, 30).map(p => `<item><title>${xml(p.title)}</title><link>${xml(origin + postHref(data, p))}</link>` +
    `<guid>${xml(origin + postHref(data, p))}</guid>${p.date ? `<pubDate>${new Date(p.date + 'T09:00:00+09:00').toUTCString()}</pubDate>` : ''}${p.category ? `<category>${xml(p.category)}</category>` : ''}<description>${xml(excerpt(p.body, 200))}</description></item>`);
  const name = media ? media.name : data.site.name || 'Tsuzuri';
  const link = origin + (media ? mediaBase(data, media) : '') + '/';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${xml(name)}</title><link>${xml(link)}</link>` +
    `<description>${xml(media ? media.tagline || '' : data.site.tagline || '')}</description><language>ja</language>\n${items.join('\n')}\n</channel></rss>\n`;
}
