/* 読者向けのページをサーバーで組み立てる。検索エンジンとSNSのプレビューが本文とタイトルを読めるように、
   記事はHTMLとして完成した状態で返し、動く部分だけをブラウザの live.js が動かす。

   記事の整理は3つ：カテゴリ（棚）、親の記事（章立て）、並び順（数字が小さいほど前。無ければ新しい順）。 */
import { esc, renderBody, excerpt, plainText } from '../public/assets/render.js';

const FONTS = 'https://fonts.googleapis.com/css2?family=M+PLUS+1+Code:wght@400;500&family=Shippori+Mincho+B1:wght@600;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap';

const fmtDate = d => (d || '').replace(/-/g, '.');
const readMin = body => Math.max(1, Math.round(String(body || '').replace(/\s/g, '').length / 500));
const firstImage = (body, origin) => {
  const m = String(body || '').match(/^!\[[^\]]*\]\(([^)\s]+\.(?:jpe?g|png|webp|gif))/mi);
  if (!m) return '';
  return /^https?:/.test(m[1]) ? m[1] : origin + '/' + m[1].replace(/^\//, '');
};
const catHref = c => '/c/' + encodeURIComponent(c);

/* ---- 誰に何を見せるか ---- */
export const siteIsPrivate = data => data.site.visibility === 'members';
export const hasMembersPosts = data => data.posts.some(p => !p.draft && p.visibility === 'members');
export function visiblePosts(data, viewer) {
  if (siteIsPrivate(data) && !viewer) return [];
  return data.posts.filter(p => !p.draft && (p.visibility !== 'members' || viewer));
}
/* 誰でも読める記事（サイトマップ・RSS 用） */
export const publicPosts = data => siteIsPrivate(data) ? [] : data.posts.filter(p => !p.draft && p.visibility !== 'members');

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
function treeHtml(posts, kids, parent = null, depth = 0) {
  const list = kids.get(parent) || [];
  if (!list.length || depth > 6) return '';
  return `<ul class="tree${depth ? ' sub' : ''}">${list.map(p =>
    `<li><a href="/${esc(p.slug)}">${esc(p.title)}</a>${p.visibility === 'members' ? '<span class="lock">メンバー限定</span>' : ''}${treeHtml(posts, kids, p.id, depth + 1)}</li>`).join('')}</ul>`;
}

function layout({ title, desc = '', url, image, type = 'website', body, slug = '', author = '', site, jsonld, noindex = false, q = '' }) {
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
<meta property="og:site_name" content="${esc(site.name || 'Tsuzuri')}">
<meta property="og:locale" content="ja_JP">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="alternate" type="application/rss+xml" title="${esc(site.name || 'Tsuzuri')}" href="/feed.xml">`}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/assets/style.css">
${jsonld && !noindex ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<div id="progress" aria-hidden="true"></div>
<header class="bar"><div class="bar-in">
  <a class="logo" href="/" aria-label="${esc(site.name || 'ホーム')}へ"><span class="k">綴</span><span class="w">${esc(site.name || 'TSUZURI')}</span></a>
  <form class="search-mini" action="/search" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="サイト内を検索" aria-label="サイト内を検索"></form>
  <nav id="nav" data-slug="${esc(slug)}" data-author="${esc(author)}"></nav>
</div></header>
<main>${body}</main>
<footer class="site-foot"><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(site.name || '')}</span><span>${noindex ? '' : '<a href="/feed.xml">RSS</a>　'}Tsuzuri で作成</span></div></footer>
<div id="tip" role="tooltip" hidden></div>
<script type="module" src="/assets/live.js"></script>
</body>
</html>`;
}

const postRow = p => `<div class="pr"><a class="post-row" href="/${esc(p.slug)}"><time datetime="${esc(p.date)}">${fmtDate(p.date)}</time><div><h2 class="t">${esc(p.title)}</h2></div>` +
  `<p class="x">${esc(excerpt(p.body))}</p></a></div>`;

export function homePage(data, origin, viewer) {
  const site = data.site;
  const posts = visiblePosts(data, viewer);
  const cats = categories(posts);
  let main;
  if (cats.length) {
    const latest = [...posts].sort(byDateDesc).slice(0, 5);
    const shelves = [...cats, null].map(c => {
      const inCat = posts.filter(p => (p.category || null) === c);
      if (!inCat.length) return '';
      return `<section class="shelf"><h2>${c ? `<a href="${catHref(c)}">${esc(c)}</a>` : 'そのほか'}<span class="n">${inCat.length}</span></h2>${treeHtml(inCat, childrenOf(inCat))}</section>`;
    }).join('');
    main = `<section class="posts" aria-label="新着"><h2 class="list-h">新着</h2>${latest.map(postRow).join('')}</section><div class="shelves">${shelves}</div>`;
  } else {
    main = `<section class="posts" aria-label="記事一覧">${[...posts].sort(byDateDesc).map(postRow).join('') || '<p class="empty-note">まだ記事がありません</p>'}</section>`;
  }
  const body = `<section class="home-head"><h1>${esc(site.name || 'Tsuzuri')}</h1>${site.tagline ? `<p>${esc(site.tagline)}</p>` : ''}</section>${main}`;
  return layout({
    title: site.name || 'Tsuzuri', desc: site.tagline || excerpt(posts[0]?.body || ''), url: origin + '/', site, body, noindex: siteIsPrivate(data),
    jsonld: { '@context': 'https://schema.org', '@type': 'Blog', name: site.name, description: site.tagline, url: origin + '/' },
  });
}

export function categoryPage(data, origin, viewer, cat) {
  const posts = visiblePosts(data, viewer).filter(p => p.category === cat);
  if (!posts.length) return null;
  const body = `<section class="home-head"><p class="crumbs"><a href="/">ホーム</a></p><h1>${esc(cat)}</h1><p>${posts.length}本の記事</p></section>` +
    `<section class="posts shelf-page">${treeHtml(posts, childrenOf(posts))}</section>`;
  return layout({ title: `${cat} | ${data.site.name || 'Tsuzuri'}`, desc: `${cat}の記事一覧`, url: origin + catHref(cat), site: data.site, body, noindex: siteIsPrivate(data) });
}

export function postPage(data, p, origin, viewer) {
  const site = data.site;
  const posts = visiblePosts(data, viewer);
  const r = renderBody(p.body, posts, u => u, slug => '/' + slug);
  const byId = new Map(posts.map(x => [x.id, x]));
  const chain = [];
  for (let cur = byId.get(p.parent); cur && chain.length < 8 && !chain.includes(cur); cur = byId.get(cur.parent)) chain.unshift(cur);
  const crumbs = [`<a href="/">ホーム</a>`, ...(p.category ? [`<a href="${catHref(p.category)}">${esc(p.category)}</a>`] : []), ...chain.map(c => `<a href="/${esc(c.slug)}">${esc(c.title)}</a>`)];
  const siblings = posts.filter(x => (x.category || null) === (p.category || null) && (byId.has(x.parent) ? x.parent : null) === (byId.has(p.parent) ? p.parent : null)).sort(byOrder);
  const k = siblings.indexOf(p);
  const prev = k > 0 ? siblings[k - 1] : null, next = k >= 0 && k < siblings.length - 1 ? siblings[k + 1] : null;
  const kids = childrenOf(posts);
  const back = posts.filter(o => o !== p && o.body.includes(`[[${p.title}]]`));
  const toc = r.headings.length > 1 ? `<nav class="toc" aria-label="目次"><h2>目次</h2><ol>${r.headings.filter(h => h.lv <= 3).map(h =>
    `<li class="l${h.lv}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>` : '';
  const list = (h, arr) => arr.length ? `<div><h2>${h}</h2><ul>${arr.map(o => `<li><a href="/${esc(o.slug)}">${esc(o.title)}</a></li>`).join('')}</ul></div>` : '';
  const pager = prev || next ? `<nav class="pager" aria-label="前後の記事">${prev ? `<a class="prev" href="/${esc(prev.slug)}"><span>← 前</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="/${esc(next.slug)}"><span>次 →</span>${esc(next.title)}</a>` : ''}</nav>` : '';
  const children = (kids.get(p.id) || []).length ? `<section class="chapter"><h2>この中の記事</h2>${treeHtml(posts, kids, p.id)}</section>` : '';
  const members = p.visibility === 'members' || siteIsPrivate(data);
  const body = `<div class="post-layout"><article class="article"><header class="article-head">` +
    `<p class="crumbs">${crumbs.join('<span aria-hidden="true">›</span>')}</p><h1>${esc(p.title)}</h1>` +
    `<div class="meta"><time datetime="${esc(p.date)}">${fmtDate(p.date)}</time>${p.updated && p.updated !== p.date ? `<span>更新 ${fmtDate(p.updated)}</span>` : ''}${p.authorName ? `<span>${esc(p.authorName)}</span>` : ''}<span>約${readMin(p.body)}分で読めます</span>${members ? '<span class="lock">メンバー限定</span>' : ''}</div></header>` +
    `<div class="prose">${r.html}</div>${children}${pager}` +
    `<footer class="post-foot">${list('この記事にリンクしている記事', back)}<div><a class="btn" href="${p.category ? catHref(p.category) : '/'}">← ${p.category ? esc(p.category) + 'の一覧へ' : '記事一覧へ'}</a></div></footer></article>${toc}</div>`;
  const url = `${origin}/${p.slug}`;
  const desc = excerpt(p.body, 110);
  const image = firstImage(p.body, origin);
  return layout({
    title: `${p.title} | ${site.name || 'Tsuzuri'}`, desc, url, image, type: 'article', slug: p.slug, author: p.author || '', site, body, noindex: members,
    jsonld: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, ...(p.authorName ? { author: { '@type': 'Person', name: p.authorName } } : {}), datePublished: p.date, dateModified: p.updated || p.date, description: desc, url, ...(image ? { image } : {}) },
  });
}

/* ---- 検索：ひらがな/カタカナ・全角/半角・大文字/小文字のちがいを気にせず、全部の語を含む記事を探す ---- */
const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
export function search(data, viewer, q) {
  const terms = fold(q).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const out = [];
  for (const p of visiblePosts(data, viewer)) {
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
export function searchPage(data, origin, viewer, q) {
  const results = search(data, viewer, q);
  const list = q.trim()
    ? (results.length ? `<p class="sub">「${esc(q)}」を含む記事：${results.length}本</p><div class="results">${results.map(r =>
      `<a class="result" href="/${esc(r.p.slug)}"><span class="crumb">${r.p.category ? esc(r.p.category) : ''}</span><h2>${highlight(r.p.title, q)}</h2><p>${highlight(r.snippet, q)}</p></a>`).join('')}</div>`
      : `<p class="empty-note">「${esc(q)}」を含む記事は見つかりませんでした。言葉を短くするか、別の言い方で探してみてください。</p>`)
    : '<p class="empty-note">探したい言葉を入れてください。</p>';
  const body = `<section class="search-page"><h1>サイト内を検索</h1><form action="/search" role="search" class="search-big"><input type="search" name="q" value="${esc(q)}" aria-label="検索する言葉" autofocus><button class="btn primary" type="submit">検索</button></form>${list}</section>`;
  return layout({ title: `${q ? q + ' の検索結果' : '検索'} | ${data.site.name || 'Tsuzuri'}`, url: origin + '/search', site: data.site, body, noindex: true, q });
}

/* メンバーだけが読めるサイトで、ログインしていない人に出すページ */
export function gatePage(data, origin, path) {
  return layout({
    title: data.site.name || 'Tsuzuri', url: origin + '/', site: data.site, noindex: true,
    body: `<section class="notfound"><h1>このサイトはメンバーだけが読めます</h1><p>読むにはログインしてください。アカウントは管理者からの招待で作れます。</p><p><a class="btn primary" href="/write?next=${encodeURIComponent(path)}">ログイン</a></p></section>`,
  });
}

export function notFoundPage(data, origin) {
  return layout({
    title: `ページが見つかりません | ${data.site.name || 'Tsuzuri'}`, url: origin + '/', site: data.site, noindex: true,
    body: `<section class="notfound"><h1>ページが見つかりません</h1><p>記事が削除されたか、URLが変わったか、メンバーだけが読める記事の可能性があります。</p><p><a class="btn" href="/">記事一覧へ</a> <a class="btn" href="/write?next=${encodeURIComponent('/')}">ログイン</a></p></section>`,
  });
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sitemap(data, origin) {
  const posts = publicPosts(data);
  const cats = categories(posts);
  const urls = siteIsPrivate(data) ? [] : [`<url><loc>${xml(origin)}/</loc></url>`, ...cats.map(c => `<url><loc>${xml(origin + catHref(c))}</loc></url>`), ...posts.map(p =>
    `<url><loc>${xml(`${origin}/${p.slug}`)}</loc>${p.date ? `<lastmod>${xml(p.updated || p.date)}</lastmod>` : ''}</url>`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function feed(data, origin) {
  const items = publicPosts(data).sort(byDateDesc).slice(0, 30).map(p => `<item><title>${xml(p.title)}</title><link>${xml(`${origin}/${p.slug}`)}</link>` +
    `<guid>${xml(`${origin}/${p.slug}`)}</guid>${p.date ? `<pubDate>${new Date(p.date + 'T09:00:00+09:00').toUTCString()}</pubDate>` : ''}${p.category ? `<category>${xml(p.category)}</category>` : ''}<description>${xml(excerpt(p.body, 200))}</description></item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${xml(data.site.name || 'Tsuzuri')}</title><link>${xml(origin)}/</link>` +
    `<description>${xml(data.site.tagline || '')}</description><language>ja</language>\n${items.join('\n')}\n</channel></rss>\n`;
}
