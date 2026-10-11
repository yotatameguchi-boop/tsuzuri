/* 読者向けのページをサーバーで組み立てる。検索エンジンとSNSのプレビューが本文とタイトルを読めるように、
   記事はHTMLとして完成した状態で返し、動く部分だけをブラウザの live.js が動かす。 */
import { esc, renderBody, excerpt } from '../public/assets/render.js';

const FONTS = 'https://fonts.googleapis.com/css2?family=M+PLUS+1+Code:wght@400;500&family=Shippori+Mincho+B1:wght@600;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap';

export const published = data => data.posts.filter(p => !p.draft).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const fmtDate = d => (d || '').replace(/-/g, '.');
const readMin = body => Math.max(1, Math.round(String(body || '').replace(/\s/g, '').length / 500));
const firstImage = (body, origin) => {
  const m = String(body || '').match(/^!\[[^\]]*\]\(([^)\s]+\.(?:jpe?g|png|webp|gif))/mi);
  if (!m) return '';
  return /^https?:/.test(m[1]) ? m[1] : origin + '/' + m[1].replace(/^\//, '');
};

function layout({ title, desc, url, image, type = 'website', body, slug = '', author = '', site, jsonld }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:site_name" content="${esc(site.name || 'Tsuzuri')}">
<meta property="og:locale" content="ja_JP">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="alternate" type="application/rss+xml" title="${esc(site.name || 'Tsuzuri')}" href="/feed.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/assets/style.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<div id="progress" aria-hidden="true"></div>
<header class="bar"><div class="bar-in">
  <a class="logo" href="/" aria-label="${esc(site.name || 'ホーム')}へ"><span class="k">綴</span><span class="w">${esc(site.name || 'TSUZURI')}</span></a>
  <nav id="nav" data-slug="${esc(slug)}" data-author="${esc(author)}"></nav>
</div></header>
<main>${body}</main>
<footer class="site-foot"><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(site.name || '')}</span><span><a href="/feed.xml">RSS</a>　Tsuzuri で作成</span></div></footer>
<div id="tip" role="tooltip" hidden></div>
<script type="module" src="/assets/live.js"></script>
</body>
</html>`;
}

export function homePage(data, origin) {
  const site = data.site;
  const posts = published(data);
  const rows = posts.map(p => {
    return `<div class="pr"><a class="post-row" href="/${esc(p.slug)}"><time datetime="${esc(p.date)}">${fmtDate(p.date)}</time><div><h2 class="t">${esc(p.title)}</h2></div>` +
      `<p class="x">${esc(excerpt(p.body))}</p></a></div>`;
  }).join('');
  const body = `<section class="home-head"><h1>${esc(site.name || 'Tsuzuri')}</h1>${site.tagline ? `<p>${esc(site.tagline)}</p>` : ''}</section>` +
    `<section class="posts" aria-label="記事一覧">${rows || '<p class="empty-note">まだ記事がありません</p>'}</section>`;
  return layout({
    title: site.name || 'Tsuzuri', desc: site.tagline || excerpt(posts[0]?.body || ''), url: origin + '/', site, body,
    jsonld: { '@context': 'https://schema.org', '@type': 'Blog', name: site.name, description: site.tagline, url: origin + '/' },
  });
}

export function postPage(data, p, origin) {
  const site = data.site;
  const r = renderBody(p.body, data.posts, u => u, slug => '/' + slug);
  const back = published(data).filter(o => o !== p && o.body.includes(`[[${p.title}]]`));
  const others = published(data).filter(o => o !== p).slice(0, 3);
  const toc = r.headings.length > 1 ? `<nav class="toc" aria-label="目次"><h2>目次</h2><ol>${r.headings.filter(h => h.lv <= 3).map(h =>
    `<li class="l${h.lv}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>` : '';
  const list = (h, arr) => arr.length ? `<div><h2>${h}</h2><ul>${arr.map(o => `<li><a href="/${esc(o.slug)}">${esc(o.title)}</a></li>`).join('')}</ul></div>` : '';
  const body = `<div class="post-layout"><article class="article"><header class="article-head"><h1>${esc(p.title)}</h1>` +
    `<div class="meta"><time datetime="${esc(p.date)}">${fmtDate(p.date)}</time>${p.authorName ? `<span>${esc(p.authorName)}</span>` : ''}<span>約${readMin(p.body)}分で読めます</span></div></header>` +
    `<div class="prose">${r.html}</div>` +
    `<footer class="post-foot">${list('この記事にリンクしている記事', back)}${list('ほかの記事', others)}<div><a class="btn" href="/">← 記事一覧へ</a></div></footer></article>${toc}</div>`;
  const url = `${origin}/${p.slug}`;
  const desc = excerpt(p.body, 110);
  const image = firstImage(p.body, origin);
  return layout({
    title: `${p.title} | ${site.name || 'Tsuzuri'}`, desc, url, image, type: 'article', slug: p.slug, author: p.author || '', site, body,
    jsonld: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, ...(p.authorName ? { author: { '@type': 'Person', name: p.authorName } } : {}), datePublished: p.date, dateModified: p.updated || p.date, description: desc, url, ...(image ? { image } : {}) },
  });
}

export function notFoundPage(data, origin) {
  return layout({
    title: `ページが見つかりません | ${data.site.name || 'Tsuzuri'}`, desc: '', url: origin + '/', site: data.site,
    body: `<section class="notfound"><h1>ページが見つかりません</h1><p>記事が削除されたか、URLが変わった可能性があります。</p><p><a class="btn" href="/">記事一覧へ</a></p></section>`,
  });
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sitemap(data, origin) {
  const urls = [`<url><loc>${xml(origin)}/</loc></url>`, ...published(data).map(p =>
    `<url><loc>${xml(`${origin}/${p.slug}`)}</loc>${p.date ? `<lastmod>${xml(p.updated || p.date)}</lastmod>` : ''}</url>`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function feed(data, origin) {
  const items = published(data).slice(0, 30).map(p => `<item><title>${xml(p.title)}</title><link>${xml(`${origin}/${p.slug}`)}</link>` +
    `<guid>${xml(`${origin}/${p.slug}`)}</guid>${p.date ? `<pubDate>${new Date(p.date + 'T09:00:00+09:00').toUTCString()}</pubDate>` : ''}<description>${xml(excerpt(p.body, 200))}</description></item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${xml(data.site.name || 'Tsuzuri')}</title><link>${xml(origin)}/</link>` +
    `<description>${xml(data.site.tagline || '')}</description><language>ja</language>\n${items.join('\n')}\n</channel></rss>\n`;
}
