/* 読者向けのページをサーバーで組み立てる。検索エンジンとSNSのプレビューが本文とタイトルを読めるように、
   記事はHTMLとして完成した状態で返し、動く部分だけをブラウザの live.js が動かす。

   1つの Tsuzuri で、名前のちがう複数のメディア（例：地域ニュースと暮らしの読みもの）を出せる。
   - メディアが1つのときは、これまでどおりサイトの直下（/記事のURL）
   - 2つ以上になったら、メディアごとに /メディアのURL/ の下に置き、/ は全体のトップページになる
   記事の整理は3つ：カテゴリ（棚）、親の記事（章立て）、並び順（数字が小さいほど前。無ければ新しい順）。 */
import { esc, renderBody, excerpt, plainText } from '../public/assets/render.js';
import { THEMES, COLORS, designCss, fontFamilies, palette, accentOf } from '../public/assets/design.js';
export { THEMES, COLORS };

const BASE_FONTS = ['M+PLUS+1+Code:wght@400;500', 'Shippori+Mincho+B1:wght@600;800', 'Zen+Kaku+Gothic+New:wght@400;500;700'];
const fontsUrl = extra => 'https://fonts.googleapis.com/css2?' + [...new Set([...BASE_FONTS, ...(extra || [])])].map(f => 'family=' + f).join('&') + '&display=swap';
/* 追加のCSSは管理者だけが書ける。<style> から抜け出せないよう「<」を外す */
const customCss = css => css ? '\n/* このメディアの追加のCSS */\n' + String(css).replace(/</g, '') : '';

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
function layout({ data, media, look = null, title, desc = '', url, image, type = 'website', body, slug = '', author = '', jsonld, noindex = false, q = '' }) {
  const base = media || { name: data.site.name || 'Tsuzuri', mark: '綴', color: 'blue', slug: '', design: {} };
  /* 記事ごとにデザインと色を変えられる（原稿の先頭で「デザイン: ポップ」など） */
  const brand = { ...base, theme: (look && look.theme) || base.theme, design: { ...(base.design || {}), ...(look && look.color && COLORS[look.color] ? { accent: COLORS[look.color].hex } : {}) } };
  const d = brand.design;
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
<link rel="stylesheet" href="${fontsUrl(fontFamilies(brand))}">
<link rel="stylesheet" href="/assets/style.css">
<style>${designCss(brand)}${customCss(brand.css)}</style>
${jsonld && !noindex ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<div id="progress" aria-hidden="true"></div>
<header class="bar"><div class="bar-in">
  <a class="logo" href="${home}" aria-label="${esc(brand.name)}のトップへ">${d.logo ? `<span class="k img"><img src="${esc(d.logo)}" alt=""></span>` : `<span class="k${[...(brand.mark || '綴')].length > 1 ? ' two' : ''}">${esc(brand.mark || '綴')}</span>`}<span class="w">${esc(brand.name)}</span></a>
  <form class="search-mini" action="${searchAction}" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="${media && multi(data) ? esc(brand.name) + 'の中を検索' : 'サイト内を検索'}" aria-label="検索"></form>
  <nav id="nav" data-slug="${esc(slug)}" data-author="${esc(author)}"></nav>
</div></header>
<main>${body}</main>
<footer class="site-foot"><div class="wrap"><span>${d.footer ? esc(d.footer) : `© ${new Date().getFullYear()} ${esc(brand.name)}`}</span><span>${network}${noindex ? '' : `<a href="${feedHref}">RSS</a>　`}Tsuzuri で作成</span></div></footer>
<div id="tip" role="tooltip" hidden></div>
<script type="module" src="/assets/live.js"></script>
</body>
</html>`;
}

const firstImg = body => (String(body || '').match(/^!\[[^\]]*\]\(([^)\s]+\.(?:jpe?g|png|webp|gif|svg))/mi) || [])[1] || '';
function postList(data, posts, media, showMedia = false) {
  const style = (media && media.design && media.design.list) || '';
  if (style === 'cards' || style === 'grid') {
    return `<div class="post-${style}">${posts.map(p => {
      const img = style === 'cards' ? firstImg(p.body) : '';
      const m = mediaOf(data, p);
      return `<a class="post-card" href="${esc(postHref(data, p))}">${style === 'cards' ? (img ? `<span class="thumb"><img src="${esc(img)}" alt="" loading="lazy"></span>` : `<span class="thumb none"><span>${esc(m.mark || '綴')}</span></span>`) : ''}` +
        `<span class="pc-body">${showMedia ? `<span class="media-tag">${esc(m.name)}</span>` : ''}<span class="pc-title">${esc(p.title)}</span><span class="pc-x">${esc(excerpt(p.body, 70))}</span><time>${fmtDate(p.date)}</time></span></a>`;
    }).join('')}</div>`;
  }
  return posts.map(p => postRow(data, p, showMedia)).join('');
}
const postRow = (data, p, showMedia) => `<div class="pr"><a class="post-row" href="${esc(postHref(data, p))}"><time datetime="${esc(p.date)}">${fmtDate(p.date)}</time><div>${showMedia ? `<span class="media-tag">${esc(mediaOf(data, p).name)}</span>` : ''}<h2 class="t">${esc(p.title)}</h2></div>` +
  `<p class="x">${esc(excerpt(p.body))}</p></a></div>`;

/* ---- 全体のトップ（メディアが2つ以上のとき） ---- */
export function portalPage(data, origin, viewer) {
  const site = data.site;
  const cards = visibleMedia(data, viewer).map(m => {
    const latest = visiblePosts(data, viewer, m).sort(byDateDesc).slice(0, 3);
    const c = palette(accentOf(m)).light;
    return `<section class="media-card" style="--mc:${c.a};--mc-soft:${c.soft}">
      <a class="mc-head" href="/${esc(m.slug)}/">${m.design && m.design.logo ? `<span class="k img"><img src="${esc(m.design.logo)}" alt=""></span>` : `<span class="k${[...(m.mark || '綴')].length > 1 ? ' two' : ''}">${esc(m.mark || '綴')}</span>`}<span><span class="mc-name">${esc(m.name)}</span>${m.tagline ? `<span class="mc-tag">${esc(m.tagline)}</span>` : ''}</span></a>
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
    main = `<section class="posts" aria-label="新着"><h2 class="list-h">新着</h2>${postList(data, latest, media)}</section><div class="shelves">${shelves}</div>`;
  } else {
    main = `<section class="posts" aria-label="記事一覧">${posts.length ? postList(data, [...posts].sort(byDateDesc), media) : '<p class="empty-note">まだ記事がありません</p>'}</section>`;
  }
  const cover = media.design && media.design.cover;
  const head = cover
    ? `<section class="cover" style="background-image:url('${esc(cover)}')"><div class="cover-in">${multi(data) ? `<p class="crumbs"><a href="/">${esc(data.site.name || 'Tsuzuri')}</a></p>` : ''}<h1>${esc(media.name)}</h1>${media.tagline ? `<p>${esc(media.tagline)}</p>` : ''}</div></section>`
    : `<section class="home-head">${multi(data) ? `<p class="crumbs"><a href="/">${esc(data.site.name || 'Tsuzuri')}</a></p>` : ''}<h1>${esc(media.name)}</h1>${media.tagline ? `<p>${esc(media.tagline)}</p>` : ''}</section>`;
  const body = head + main;
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
    data, media, look: { theme: p.theme, color: p.color }, title: `${p.title} | ${media.name}`, desc, url, image, type: 'article', slug: p.slug, author: p.author || '', body, noindex: members,
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
