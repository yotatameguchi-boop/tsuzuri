/* Tsuzuri の記法 → HTML。サーバー（記事ページの生成）とブラウザ（編集画面のプレビュー）の両方で使う */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = u => /^\s*(javascript|data|vbscript):/i.test(u) ? '#' : u;

const BOX_ALIAS = {
  point: 'point', ポイント: 'point',
  memo: 'memo', note: 'memo', info: 'memo', メモ: 'memo', 補足: 'memo',
  warn: 'warn', warning: 'warn', 注意: 'warn',
  summary: 'summary', まとめ: 'summary',
};
const BOX_LABEL = { point: 'ポイント', memo: 'メモ', warn: '注意', summary: 'まとめ' };
const LIVE_ALIAS = {
  quiz: 'quiz', クイズ: 'quiz',
  calc: 'calc', 計算: 'calc',
  chart: 'chart', グラフ: 'chart',
  tabs: 'tabs', タブ: 'tabs',
  steps: 'steps', 手順: 'steps', ステップ: 'steps',
  details: 'details', 折りたたみ: 'details', 開閉: 'details',
  compare: 'compare', 比較: 'compare',
};
const LIVE_LABEL = { quiz: 'クイズ', calc: '計算', chart: 'グラフ', tabs: 'タブ', steps: '手順', details: '折りたたみ', compare: '比較' };

/* ページを組み立てる部品（固定ページで使う。記事の中でも使える） */
const SECTION_ALIAS = {
  hero: 'hero', ヒーロー: 'hero', 大見出し: 'hero',
  cards: 'cards', columns: 'cards', カード: 'cards', 特徴: 'cards',
  band: 'band', 帯: 'band', 色の帯: 'band', section: 'band',
  faq: 'faq', よくある質問: 'faq', 質問: 'faq',
  cta: 'cta', 行動: 'cta', 呼びかけ: 'cta',
  gallery: 'gallery', ギャラリー: 'gallery', 写真: 'gallery',
  posts: 'posts', 記事一覧: 'posts', 新着: 'posts',
  contact: 'contact', form: 'contact', 問い合わせ: 'contact', お問い合わせ: 'contact', フォーム: 'contact',
  embed: 'embed', 埋め込み: 'embed',
};

function makeCtx(posts, resolve, href, opts = {}) {
  return { posts: posts || [], resolve: resolve || (u => u), href: href || (slug => '/' + slug), headings: [], links: new Set(), uid: 0, notes: new Map(), noteOrder: [], heroes: 0, forms: 0, mediaId: opts.mediaId || null };
}

function inline(src, ctx) {
  const codes = [], maths = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  /* 数式 $...$（「$100」のような金額と取り違えないよう、中身の両端に空白がなく、閉じの後ろに数字が来ないものだけ） */
  s = s.replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre, t) => { maths.push(t); return `${pre}\u0002${maths.length - 1}\u0002`; });
  s = esc(s);
  s = s.replace(/\[\^([^\]\s]+)\]/g, (_, id) => {
    if (!ctx.notes.has(id)) return `[^${id}]`;
    if (!ctx.noteOrder.includes(id)) ctx.noteOrder.push(id);
    const n = ctx.noteOrder.indexOf(id) + 1;
    return `<sup class="fn"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`;
  });
  s = s.replace(/\{([^{}|\n]+)\|([^{}\n]+)\}/g, (_, t, d) => `<button type="button" class="gl" data-tip="${d}">${t}</button>`);
  s = s.replace(/\[\[([^\]]+)\]\](?!\()/g, (_, t) => {
    const title = t.trim();
    ctx.links.add(title);
    const p = ctx.posts.find(x => x.title === title.replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
    return p && !p.draft ? `<a class="wl" href="${esc(ctx.href(p.slug))}">${title}</a>` : `<span class="wl missing" title="まだない記事">${title}</span>`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const ext = /^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${safeUrl(u)}"${ext}>${t}</a>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
  s = s.replace(/==(.+?)==/g, '<mark>$1</mark>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  s = s.replace(/\u0002(\d+)\u0002/g, (_, i) => `<span class="math" data-tex="${esc(maths[+i])}">${esc(maths[+i])}</span>`);
  return s.replace(/\n/g, '<br>');
}

const RE = {
  fence: /^```/,
  open: /^:::\s*([^\s:]+)\s*(.*)$/,
  close: /^:::\s*$/,
  heading: /^(#{1,4})\s+(.+)$/,
  hr: /^\s*(-{3,}|\*{3,}|_{3,})\s*$/,
  tableRow: /^\s*\|/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
  quote: /^>\s?/,
  li: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
  media: /^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)\s*$/,
  button: /^\[\[(.+?)\]\]\((\S+?)\)\s*$/,
  url: /^(https?:\/\/\S+)\s*$/,
  file: /^\[([^\]]+)\]\((\S+\.(pdf|docx?|xlsx?|pptx?|zip|csv|txt))\)\s*$/i,
  mathBlock: /^\$\$/,
  note: /^\[\^([^\]\s]+)\]:\s*(.*)$/,
};
const FILE_KIND = { pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', ppt: 'PowerPoint', pptx: 'PowerPoint', zip: 'ZIP', csv: 'CSV', txt: 'テキスト' };

function startsBlock(lines, i) {
  const l = lines[i];
  return RE.fence.test(l) || RE.open.test(l) || RE.close.test(l) || RE.heading.test(l) || RE.hr.test(l) ||
    RE.quote.test(l) || RE.li.test(l) || RE.media.test(l) || RE.button.test(l) || RE.url.test(l) || RE.file.test(l) || RE.mathBlock.test(l) ||
    (RE.tableRow.test(l) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]));
}

const splitRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

function renderList(items, ctx) {
  const root = { ordered: items[0].ordered, children: [] };
  const stack = [{ indent: -1, node: root }];
  for (const it of items) {
    while (stack.length > 1 && it.indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const target = parent === root ? root : (parent.sub || (parent.sub = { ordered: it.ordered, children: [] }));
    const item = { text: it.text };
    target.children.push(item);
    stack.push({ indent: it.indent, node: item });
  }
  const out = l => {
    const tag = l.ordered ? 'ol' : 'ul';
    return `<${tag}>${l.children.map(c => `<li>${inline(c.text, ctx)}${c.sub ? out(c.sub) : ''}</li>`).join('')}</${tag}>`;
  };
  return out(root);
}

function media(alt, url, cap, ctx) {
  const c = cap ? `<figcaption>${inline(cap, ctx)}</figcaption>` : '';
  if (!url) return `<figure><div class="card"><span class="play">＋</span><span><span class="h">画像</span><br><span class="u">${esc(alt) || '画像が未設定です'}</span></span></div>${c}</figure>`;
  const src = esc(safeUrl(ctx.resolve(url)));
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return `<figure><video src="${src}" controls playsinline preload="metadata"></video>${c}</figure>`;
  return `<figure><img src="${src}" alt="${esc(alt)}" loading="lazy">${c}</figure>`;
}

/* 埋め込めるのは、決まったサービスだけ（それ以外はリンクのカードにする） */
function embedSrc(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  let id;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (/(^|\.)youtube\.com$/.test(host)) id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1];
  if (id && /^[\w-]{6,20}$/.test(id)) return { src: `https://www.youtube-nocookie.com/embed/${id}`, kind: 'video' };
  if (host === 'vimeo.com' && /^\/\d+$/.test(u.pathname)) return { src: `https://player.vimeo.com/video${u.pathname}`, kind: 'video' };
  if (host === 'player.vimeo.com') return { src: u.href, kind: 'video' };
  if (host === 'google.com' && u.pathname.startsWith('/maps/embed')) return { src: u.href, kind: 'map' };
  return null;
}
function embedHtml(url, title = '') {
  const e = embedSrc(url);
  if (!e) return linkCard(url);
  return `<figure class="embed ${e.kind}"><iframe src="${esc(e.src)}" title="${esc(title || (e.kind === 'map' ? '地図' : '動画'))}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"${e.kind === 'video' ? ' allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"' : ''}></iframe></figure>`;
}

function linkCard(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = url; }
  const yt = /(^|\.)youtube\.com$|^youtu\.be$/.test(host);
  const vm = /(^|\.)vimeo\.com$/.test(host);
  const label = yt ? 'YouTube で見る' : vm ? 'Vimeo で見る' : 'リンク';
  const icon = yt || vm ? '▶' : '↗';
  return `<a class="card" href="${esc(safeUrl(url))}" target="_blank" rel="noopener"><span class="play">${icon}</span><span><span class="h">${label}</span><br><span class="u">${esc(url)}</span></span></a>`;
}

function fileCard(name, url, ext) {
  const kind = FILE_KIND[ext.toLowerCase()] || 'ファイル';
  return `<a class="card file" href="${esc(safeUrl(url))}" target="_blank" rel="noopener"><span class="play">${esc(kind.slice(0, 3))}</span><span><span class="h">${kind}・添付ファイル</span><br><span class="u">${esc(name)}</span></span></a>`;
}

function sections(lines) {
  const out = [];
  for (const l of lines) {
    const m = l.match(/^@\s+(.+)$/);
    if (m) out.push({ name: m[1].trim(), lines: [] });
    else if (out.length) out[out.length - 1].lines.push(l);
    else if (l.trim()) out.push({ name: '', lines: [l] });
  }
  return out;
}

const liveFrame = (kind, title, body, extra = '') =>
  `<div class="live" data-live="${kind}"${extra}><div class="live-h"><span class="ttl">${title}</span></div>${body}</div>`;

function renderLive(kind, arg, inner, ctx) {
  const id = 'lv' + (++ctx.uid);
  const title = inline(arg, ctx);
  if (kind === 'details') {
    return `<details class="fold"><summary>${title || '詳しく'}</summary><div class="fold-b">${parse(inner, ctx)}</div></details>`;
  }
  if (kind === 'quiz') {
    const opts = [], expl = [];
    for (const l of inner) {
      let m;
      if ((m = l.match(RE.li))) { const ok = /^\*/.test(m[3]); opts.push({ ok, text: m[3].replace(/^\*\s*/, '') }); }
      else if (RE.quote.test(l)) expl.push(l.replace(RE.quote, ''));
    }
    const body = `<div class="live-b"><div class="quiz-opts">${opts.map((o, i) =>
      `<button type="button" class="quiz-opt" data-ok="${o.ok ? 1 : 0}"><span class="n">${i + 1}</span><span>${inline(o.text, ctx)}</span></button>`).join('')}</div>` +
      `<div class="quiz-res" hidden><div class="msg"></div>${expl.length ? `<div class="ex">${inline(expl.join('\n'), ctx)}</div>` : ''}<button type="button" class="btn ghost again">もう一度</button></div></div>`;
    return liveFrame('quiz', title || 'クイズ', body);
  }
  if (kind === 'calc') {
    const ins = [], outs = [];
    let after = false;
    for (const raw of inner) {
      const l = raw.trim();
      if (!l) continue;
      if (/^-{3,}$/.test(l)) { after = true; continue; }
      if (!after) {
        const m = l.match(/^(.+?)\s*=\s*(-?[\d.,]+)\s*([^(（]*?)\s*(?:[(（]\s*(-?[\d.]+)\s*[〜~～]\s*(-?[\d.]+)\s*[)）])?$/);
        if (m) ins.push({ name: m[1].trim(), value: parseFloat(m[2].replace(/,/g, '')), unit: m[3].trim(), min: m[4], max: m[5] });
      } else {
        const m = l.match(/^(.+?)\s*=\s*(.+?)(?:\s*\|\s*(.*))?$/);
        if (m) outs.push({ name: m[1].trim(), expr: m[2].trim(), unit: (m[3] || '').trim() });
      }
    }
    const body = `<div class="live-b"><div class="calc-in">${ins.map((v, i) => {
      const range = v.min != null ? `<input type="range" id="${id}-r${i}" min="${v.min}" max="${v.max}" step="${stepOf(v)}" value="${v.value}" data-i="${i}" aria-label="${esc(v.name)}">` : '';
      return `<div class="calc-row"><label for="${id}-n${i}"><span>${esc(v.name)}</span><span class="v"><input type="number" id="${id}-n${i}" value="${v.value}" step="any" data-i="${i}">${esc(v.unit)}</span></label>${range}</div>`;
    }).join('')}</div><div class="calc-out">${outs.map(o =>
      `<div class="calc-o"><span class="l">${esc(o.name)}</span><span class="r">–</span></div>`).join('')}</div></div>`;
    const spec = esc(JSON.stringify({ ins: ins.map(v => v.name), outs }));
    return liveFrame('calc', title || '計算', body, ` data-spec="${spec}"`);
  }
  if (kind === 'chart') {
    const rows = [];
    for (const l of inner) {
      if (!l.trim() || RE.tableSep.test(l)) continue;
      const cells = l.includes('|') ? splitRow(l) : l.trim().split(/\s+/);
      if (cells.length < 2) continue;
      const v = parseFloat(cells[cells.length - 1].replace(/,/g, ''));
      if (!isNaN(v)) rows.push({ label: cells.slice(0, -1).join(' '), value: v });
    }
    const max = Math.max(...rows.map(r => r.value), 0) || 1;
    const fmt = v => v.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
    const body = `<div class="live-b"><div class="bars" role="list">${rows.map((r, i) =>
      `<div class="row-hit" role="listitem" tabindex="0" data-i="${i}" data-v="${r.value}" data-l="${esc(r.label)}"><span class="lb">${esc(r.label)}</span><span class="tr"><span class="fill" style="width:${Math.max(0, r.value / max * 100).toFixed(2)}%"></span></span><span class="vl">${fmt(r.value)}</span></div>`).join('')}</div>` +
      `<div class="bars-note">項目を選ぶと、前の項目との差が出ます</div></div>`;
    return liveFrame('chart', title || 'グラフ', body);
  }
  if (kind === 'tabs' || kind === 'steps') {
    const secs = sections(inner);
    const panels = secs.map((s, i) => `<div class="pnl" data-i="${i}"${i ? ' hidden' : ''}>${parse(s.lines, ctx)}</div>`).join('');
    if (kind === 'tabs') {
      const bar = `<div class="tabbar" role="tablist">${secs.map((s, i) => `<button type="button" role="tab" data-i="${i}" aria-selected="${i === 0}">${esc(s.name || 'タブ' + (i + 1))}</button>`).join('')}</div>`;
      return liveFrame('tabs', title || '切り替えて読む', bar + `<div class="live-b">${panels}</div>`);
    }
    const names = esc(JSON.stringify(secs.map(s => s.name)));
    const body = `<div class="live-b"><div class="steps-dots" data-names="${names}"></div><div style="margin-top:14px">${panels}</div>` +
      `<div class="steps-nav"><button type="button" class="btn prev">← 前へ</button><button type="button" class="btn primary next">次へ →</button></div></div>`;
    return liveFrame('steps', title || '手順', body);
  }
  if (kind === 'compare') {
    const imgs = inner.map(l => l.match(RE.media)).filter(Boolean);
    if (imgs.length < 2) return `<p>（比較には画像が2枚必要です）</p>`;
    const [a, b] = imgs;
    const body = `<div class="live-b"><div class="cmp" style="--x:50%"><img src="${esc(safeUrl(ctx.resolve(b[2])))}" alt="${esc(b[1])}">` +
      `<div class="top"><img src="${esc(safeUrl(ctx.resolve(a[2])))}" alt="${esc(a[1])}"></div><div class="handle"></div>` +
      `<input type="range" min="0" max="100" value="50" aria-label="左右の画像の境目"></div>` +
      `<div class="cmp-l"><span>← ${esc(a[1] || '前')}</span><span>${esc(b[1] || '後')} →</span></div></div>`;
    return liveFrame('compare', title || 'ドラッグして比べる', body);
  }
  return '';
}

/* ---- ページの部品 ---- */
const isMedia = l => RE.media.test(l);
const pickImage = lines => { const k = lines.findIndex(isMedia); if (k < 0) return [null, lines]; const m = lines[k].match(RE.media); return [{ alt: m[1], url: m[2] }, lines.filter((_, j) => j !== k)]; };
const FIELD_TYPE = { メール: 'email', email: 'email', 電話: 'tel', tel: 'tel', 長文: 'textarea', textarea: 'textarea', 数字: 'number', number: 'number', 日付: 'date', date: 'date', 選択: 'select', select: 'select', チェック: 'checkbox', checkbox: 'checkbox' };

function renderSection(kind, arg, inner, ctx) {
  if (kind === 'hero') {
    const [img, rest] = pickImage(inner);
    const tag = ctx.heroes++ === 0 ? 'h1' : 'h2';
    const style = img && img.url ? ` style="--hero-img:url('${esc(safeUrl(ctx.resolve(img.url))).replace(/'/g, '%27')}')"` : '';
    return `<section class="sec hero${img && img.url ? ' with-img' : ''}"${style}><div class="sec-in">${arg ? `<${tag}>${inline(arg, ctx)}</${tag}>` : ''}${parse(rest, ctx)}</div></section>`;
  }
  if (kind === 'band') return `<section class="sec band"><div class="sec-in">${arg ? `<h2 class="sec-h">${inline(arg, ctx)}</h2>` : ''}${parse(inner, ctx)}</div></section>`;
  if (kind === 'cta') return `<section class="sec cta-band"><div class="sec-in">${arg ? `<h2 class="sec-h">${inline(arg, ctx)}</h2>` : ''}${parse(inner, ctx)}</div></section>`;
  if (kind === 'cards') {
    const items = sections(inner).map(sct => {
      const [img, rest] = pickImage(sct.lines);
      return `<div class="sec-card">${img && img.url ? `<img src="${esc(safeUrl(ctx.resolve(img.url)))}" alt="${esc(img.alt)}" loading="lazy">` : ''}<div class="sc-body">${sct.name ? `<h3>${inline(sct.name, ctx)}</h3>` : ''}${parse(rest, ctx)}</div></div>`;
    });
    return `<section class="sec cards"><div class="sec-in">${arg ? `<h2 class="sec-h">${inline(arg, ctx)}</h2>` : ''}<div class="sec-grid n${Math.min(items.length, 4)}">${items.join('')}</div></div></section>`;
  }
  if (kind === 'faq') {
    const qs = sections(inner).map(q => `<details class="faq-q"><summary>${inline(q.name || '質問', ctx)}</summary><div class="faq-a">${parse(q.lines, ctx)}</div></details>`);
    return `<section class="sec faq"><div class="sec-in">${arg ? `<h2 class="sec-h">${inline(arg, ctx)}</h2>` : ''}${qs.join('')}</div></section>`;
  }
  if (kind === 'gallery') {
    const imgs = inner.map(l => l.match(RE.media)).filter(Boolean);
    return `<section class="sec gallery"><div class="sec-in">${arg ? `<h2 class="sec-h">${inline(arg, ctx)}</h2>` : ''}<div class="gal">${imgs.map(m => {
      const src = esc(safeUrl(ctx.resolve(m[2])));
      return `<a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(m[1])}" loading="lazy">${m[3] ? `<span>${inline(m[3], ctx)}</span>` : ''}</a>`;
    }).join('')}</div></div></section>`;
  }
  if (kind === 'embed') {
    const url = (arg.match(/https?:\/\/\S+/) || inner.join(' ').match(/https?:\/\/\S+/) || [])[0];
    return url ? embedHtml(url) : '';
  }
  if (kind === 'posts') {
    const [title, count, category] = arg.split(/[|｜]/).map(x => x.trim());
    const n = Math.max(1, Math.min(30, parseInt((count || '').normalize('NFKC'), 10) || 6));
    const list = ctx.posts.filter(p => p.kind !== 'page' && (!ctx.mediaId || !p.media || p.media === ctx.mediaId) && (!category || p.category === category))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, n);
    return `<section class="sec posts-sec"><div class="sec-in">${title ? `<h2 class="sec-h">${inline(title, ctx)}</h2>` : ''}${list.length ? `<div class="post-cards">${list.map(p => {
      const img = (String(p.body || '').match(/^!\[[^\]]*\]\(([^)\s]+\.(?:jpe?g|png|webp|gif|svg))/mi) || [])[1];
      return `<a class="post-card" href="${esc(ctx.href(p.slug))}">${img ? `<span class="thumb"><img src="${esc(safeUrl(ctx.resolve(img)))}" alt="" loading="lazy"></span>` : ''}<span class="pc-body"><span class="pc-title">${esc(p.title)}</span><time>${esc((p.date || '').replace(/-/g, '.'))}</time></span></a>`;
    }).join('')}</div>` : '<p class="empty-note">まだ記事がありません</p>'}</div></section>`;
  }
  if (kind === 'contact') {
    const id = 'f' + (++ctx.forms);
    let button = '送信する';
    const fields = [];
    for (const l of inner) {
      const b = l.match(/^\s*(?:ボタン|button)\s*[:：]\s*(.+)$/i);
      if (b) { button = b[1].trim(); continue; }
      const m = l.match(RE.li);
      if (!m) continue;
      let text = m[3].trim(), type = 'text', options = [];
      const t = text.match(/[（(]([^）)]+)[）)]\s*$/);
      if (t) {
        const [k, opts] = t[1].split(/[:：]/);
        if (FIELD_TYPE[k.trim()] || FIELD_TYPE[k.trim().toLowerCase()]) { type = FIELD_TYPE[k.trim()] || FIELD_TYPE[k.trim().toLowerCase()]; options = (opts || '').split(/[、,，]/).map(x => x.trim()).filter(Boolean); text = text.slice(0, t.index).trim(); }
      }
      const required = /[*＊]$/.test(text);
      const label = text.replace(/[*＊]$/, '').trim().slice(0, 60);
      if (label) fields.push({ label, type, options, required });
    }
    const field = (f, k) => {
      const fid = `${id}-${k}`, req = f.required ? ' required' : '', name = esc(f.label);
      const lab = `<label for="${fid}">${esc(f.label)}${f.required ? '<span class="req">必須</span>' : ''}</label>`;
      if (f.type === 'textarea') return `<div class="ff">${lab}<textarea id="${fid}" name="${name}" rows="5" maxlength="5000"${req}></textarea></div>`;
      if (f.type === 'select') return `<div class="ff">${lab}<select id="${fid}" name="${name}"${req}><option value="">選んでください</option>${f.options.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>`;
      if (f.type === 'checkbox') return `<div class="ff check"><label><input type="checkbox" id="${fid}" name="${name}" value="はい"${req}> ${esc(f.label)}${f.required ? '<span class="req">必須</span>' : ''}</label></div>`;
      const ac = f.type === 'email' ? ' autocomplete="email"' : f.type === 'tel' ? ' autocomplete="tel"' : /名前/.test(f.label) ? ' autocomplete="name"' : '';
      return `<div class="ff">${lab}<input id="${fid}" type="${f.type}" name="${name}" maxlength="500"${ac}${req}></div>`;
    };
    return `<section class="sec contact"><div class="sec-in">${arg ? `<h2 class="sec-h">${inline(arg, ctx)}</h2>` : ''}<form class="contact-form" method="post" action="/api/forms" data-form="${esc(arg || 'お問い合わせ')}">
<input type="hidden" name="_form" value="${esc(arg || 'お問い合わせ')}"><input type="hidden" name="_page" value=""><input type="hidden" name="_t" value="">
<div class="hp" aria-hidden="true"><label>この欄は空のままにしてください<input type="text" name="_hp" tabindex="-1" autocomplete="off"></label></div>
${fields.map(field).join('')}<div class="ff-actions"><button class="btn primary" type="submit">${esc(button)}</button></div><p class="form-msg" role="status"></p></form></div></section>`;
  }
  return '';
}

function stepOf(v) {
  const span = Math.abs(v.max - v.min);
  const dec = Math.max(...[v.min, v.max, String(v.value)].map(x => (String(x).split('.')[1] || '').length));
  if (dec) return Math.pow(10, -dec);
  return span > 1000 ? 10 : 1;
}

function parse(lines, ctx) {
  const out = [];
  let i = 0, m;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (RE.fence.test(line)) {
      const lang = (line.match(/^```\s*([\w+#.-]+)/) || [])[1];
      const buf = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="language-${esc(lang.toLowerCase())}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (RE.mathBlock.test(line)) {
      let tex;
      const one = line.match(/^\$\$(.+)\$\$\s*$/);
      if (one) { tex = one[1]; i++; }
      else {
        const buf = [line.replace(/^\$\$/, '')]; i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
        if (i < lines.length) buf.push(lines[i++].replace(/\$\$\s*$/, ''));
        tex = buf.join('\n').trim();
      }
      out.push(`<div class="math math-block" data-tex="${esc(tex)}">${esc(tex)}</div>`);
      continue;
    }
    if ((m = line.match(RE.open))) {
      const buf = []; let depth = 1; i++;
      while (i < lines.length) {
        if (RE.close.test(lines[i])) { if (--depth === 0) break; }
        else if (RE.open.test(lines[i])) depth++;
        buf.push(lines[i++]);
      }
      i++;
      const name = m[1], low = name.toLowerCase(), arg = m[2].trim();
      const live = LIVE_ALIAS[name] || LIVE_ALIAS[low];
      if (live) { out.push(renderLive(live, arg, buf, ctx)); continue; }
      const sec = SECTION_ALIAS[name] || SECTION_ALIAS[low];
      if (sec) { out.push(renderSection(sec, arg, buf, ctx)); continue; }
      const kind = BOX_ALIAS[name] || BOX_ALIAS[low];
      const label = arg || (kind ? BOX_LABEL[kind] : name);
      out.push(`<div class="box ${kind || 'memo'}"><p class="bx-t">${inline(label, ctx)}</p>${parse(buf, ctx)}</div>`);
      continue;
    }
    if (RE.close.test(line)) { i++; continue; }
    if ((m = line.match(RE.heading))) {
      const lv = Math.max(2, m[1].length);
      const id = 'h' + (ctx.headings.length + 1);
      const html = inline(m[2].trim(), ctx);
      ctx.headings.push({ id, lv, text: m[2].trim().replace(/[*=~`]/g, '') });
      out.push(`<h${lv} id="${id}">${html}</h${lv}>`);
      i++; continue;
    }
    if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }
    if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      const head = splitRow(line); i += 2;
      const rows = [];
      while (i < lines.length && RE.tableRow.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${head.map(c => `<th>${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '', ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (RE.quote.test(line)) {
      const buf = [];
      while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].replace(RE.quote, ''));
      out.push(`<blockquote>${parse(buf, ctx)}</blockquote>`);
      continue;
    }
    if (RE.li.test(line)) {
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(RE.li);
        if (lm) items.push({ indent: lm[1].replace(/\t/g, '  ').length, ordered: /\d/.test(lm[2]), text: lm[3] });
        else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1].text += '\n' + lines[i].trim();
        else break;
        i++;
      }
      out.push(renderList(items, ctx));
      continue;
    }
    if ((m = line.match(RE.media))) { out.push(media(m[1], m[2], m[3], ctx)); i++; continue; }
    if (RE.button.test(line)) {
      const btns = [];
      while (i < lines.length && (m = lines[i].match(RE.button))) {
        const ext = /^https?:/i.test(m[2]) ? ' target="_blank" rel="noopener"' : '';
        btns.push(`<a class="cta" href="${esc(safeUrl(m[2]))}"${ext}>${inline(m[1], ctx)}</a>`); i++;
      }
      out.push(`<div class="btns">${btns.join('')}</div>`);
      continue;
    }
    if ((m = line.match(RE.url))) { out.push(embedHtml(m[1])); i++; continue; }
    if ((m = line.match(RE.file))) { out.push(fileCard(m[1], m[2], m[3])); i++; continue; }
    const buf = [line]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines, i)) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join('\n'), ctx)}</p>`);
  }
  return out.join('\n');
}


/* ---- 原稿の先頭の設定（--- で挟む）。メディア・デザイン・色・カテゴリなどを原稿の中で切り替えられる ----
   ---
   メディア: まちのたより
   デザイン: ポップ
   色: 緑
   ---                                                                                       */
const FM_KEYS = {
  media: 'media', メディア: 'media', theme: 'theme', design: 'theme', デザイン: 'theme', color: 'color', 色: 'color',
  category: 'category', カテゴリ: 'category', カテゴリー: 'category', parent: 'parent', 親: 'parent', 親の記事: 'parent',
  order: 'order', 並び順: 'order', visibility: 'visibility', 読める人: 'visibility', 公開範囲: 'visibility',
  date: 'date', 日付: 'date', slug: 'slug', url: 'slug', URL: 'slug',
  type: 'kind', kind: 'kind', 種類: 'kind',
};
export const THEME_KEYS = { standard: 'standard', 標準: 'standard', pop: 'pop', ポップ: 'pop', magazine: 'magazine', マガジン: 'magazine', natural: 'natural', ナチュラル: 'natural', simple: 'simple', シンプル: 'simple', tech: 'tech', テック: 'tech' };
export const COLOR_KEYS = { blue: 'blue', 青: 'blue', red: 'red', 赤: 'red', green: 'green', 緑: 'green', orange: 'orange', 橙: 'orange', オレンジ: 'orange', purple: 'purple', 紫: 'purple', teal: 'teal', 青緑: 'teal', ink: 'ink', black: 'ink', 黒: 'ink' };

function frontMatter(body) {
  const text = String(body || '');
  const m = text.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: {}, body: text, raw: '' };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([^:：#]+?)\s*[:：]\s*(.*?)\s*$/);
    if (!kv) continue;
    const k = FM_KEYS[kv[1]] || FM_KEYS[kv[1].toLowerCase()];
    if (k) meta[k] = kv[2].replace(/^["'「]|["'」]$/g, '');
  }
  /* 設定の言葉が1つも無ければ、ただの区切り線として扱う */
  if (!Object.keys(meta).length) return { meta: {}, body: text, raw: '' };
  return { meta, body: text.slice(m[0].length), raw: m[0] };
}

/* 先頭の設定を、記事の項目の値に直す（書けなかった値は無視する） */
function resolveMeta(meta, { media = [], posts = [], selfId = null } = {}) {
  const out = {};
  const low = v => String(v || '').trim().toLowerCase();
  if (meta.media) { const m = media.find(x => low(x.slug) === low(meta.media) || low(x.name) === low(meta.media) || x.id === meta.media); if (m) out.media = m.id; }
  if (meta.theme !== undefined) out.theme = THEME_KEYS[meta.theme] || THEME_KEYS[low(meta.theme)] || null;
  if (meta.color !== undefined) out.color = COLOR_KEYS[meta.color] || COLOR_KEYS[low(meta.color)] || null;
  if (meta.category !== undefined) out.category = meta.category.slice(0, 40);
  if (meta.visibility !== undefined) out.visibility = /^(members|メンバー|メンバーだけ|メンバー限定|限定|社内)/i.test(meta.visibility.trim()) ? 'members' : 'public';
  if (meta.order !== undefined) { const n = Number(meta.order.normalize('NFKC')); out.order = meta.order.trim() === '' ? null : Number.isFinite(n) ? n : undefined; if (out.order === undefined) delete out.order; }
  if (meta.parent !== undefined) {
    const v = meta.parent.trim();
    const p = v && posts.find(x => x.id !== selfId && (x.title === v || x.slug === v));
    out.parent = p ? p.id : null;
  }
  if (meta.date) { const d = meta.date.normalize('NFKC').match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/); if (d) out.date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`; }
  if (meta.slug && /^[A-Za-z0-9._~-]{1,80}$/.test(meta.slug.trim())) out.slug = meta.slug.trim();
  if (meta.kind !== undefined) out.kind = /^(page|ページ|固定ページ|固定)/i.test(meta.kind.trim()) ? 'page' : 'post';
  return out;
}

function renderBody(body, posts, resolve, href, opts = {}) {
  const ctx = makeCtx(posts, resolve, href, opts);
  body = frontMatter(body).body;
  const lines = [];
  let fence = false;
  for (const l of String(body || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && l.match(RE.note);
    if (m) ctx.notes.set(m[1], m[2]); else lines.push(l);
  }
  let html = parse(lines, ctx);
  if (ctx.noteOrder.length) {
    const items = ctx.noteOrder.map((id, k) => `<li id="fn-${k + 1}">${inline(ctx.notes.get(id), ctx)} <a class="fn-back" href="#fnref-${k + 1}" aria-label="本文に戻る">↩</a></li>`);
    html += `\n<section class="footnotes" aria-label="注"><h2 class="fn-h">注</h2><ol>${items.join('')}</ol></section>`;
  }
  return { html, headings: ctx.headings, links: ctx.links };
}

/* 検索用の地の文（記法を取り除いた全文） */
function plainText(body) {
  return String(frontMatter(body).body).replace(/^```.*$/gm, ' ').replace(/^:::\s*\S*\s*(.*)$/gm, ' $1 ').replace(/^@\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[\[([^\]]+)\]\](\([^)]*\))?/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\{([^{}|]+)\|([^{}]+)\}/g, '$1（$2）').replace(/\[\^[^\]]+\]:?/g, '').replace(/^[#>|\s*-]+|[*=~`|$]/gm, ' ')
    .replace(/\s+/g, ' ').trim();
}

function liveKinds(body) {
  const counts = {};
  for (const m of String(body || '').matchAll(/^:::\s*([^\s:]+)/gm)) {
    const k = LIVE_ALIAS[m[1]] || LIVE_ALIAS[m[1].toLowerCase()];
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  return Object.keys(counts).map(k => LIVE_LABEL[k]);
}

/* ========== 計算式 ========== */
function evaluate(expr, vars) {
  const s = expr.normalize('NFKC').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const names = Object.keys(vars).sort((a, b) => b.length - a.length);
  const toks = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    const nm = names.find(n => s.startsWith(n.normalize('NFKC'), i));
    if (nm) { toks.push({ t: 'v', v: vars[nm] }); i += nm.normalize('NFKC').length; continue; }
    const num = s.slice(i).match(/^\d+(?:\.\d+)?/);
    if (num) { toks.push({ t: 'n', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    if ('+-*/^%(),'.includes(s[i])) { toks.push({ t: s[i] }); i++; continue; }
    const id = s.slice(i).match(/^[^\s+\-*/^%(),]+/);
    toks.push({ t: 'id', v: id[0] }); i += id[0].length;
  }
  let p = 0;
  const peek = () => toks[p] && toks[p].t;
  const FN = { round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt, min: Math.min, max: Math.max,
    四捨五入: Math.round, 切り捨て: Math.floor, 切り上げ: Math.ceil };
  function expr_() { let v = term(); while (peek() === '+' || peek() === '-') { const o = toks[p++].t; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  function term() { let v = unary(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = toks[p++].t; const r = unary(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
  function unary() { if (peek() === '-') { p++; return -unary(); } if (peek() === '+') { p++; return unary(); } return power(); }
  function power() { const b = primary(); if (peek() === '^') { p++; return Math.pow(b, unary()); } return b; }
  function primary() {
    const t = toks[p++];
    if (!t) throw new Error('式が途中で終わっています');
    if (t.t === 'n' || t.t === 'v') return t.v;
    if (t.t === '(') { const v = expr_(); if (toks[p++]?.t !== ')') throw new Error('かっこが閉じていません'); return v; }
    if (t.t === 'id') {
      const f = FN[t.v];
      if (f && peek() === '(') {
        p++; const args = [];
        if (peek() !== ')') { args.push(expr_()); while (peek() === ',') { p++; args.push(expr_()); } }
        if (toks[p++]?.t !== ')') throw new Error('かっこが閉じていません');
        return f(...args);
      }
      throw new Error(`「${t.v}」が見つかりません`);
    }
    throw new Error('式を読めません');
  }
  const v = expr_();
  if (p < toks.length) throw new Error('式を読めません');
  return v;
}

/* 一覧や検索結果に出す抜粋。部品（::: 〜 :::）やコードの中身は使わず、地の文だけを拾う */
function excerpt(body, n = 120) {
  body = frontMatter(body).body;
  const out = [];
  let depth = 0, fence = false, mathBlock = false;
  for (const raw of String(body || '').split('\n')) {
    const l = raw.trim();
    if (/^```/.test(l)) { fence = !fence; continue; }
    if (/^\$\$/.test(l)) { if (!/^\$\$.+\$\$$/.test(l)) mathBlock = !mathBlock; continue; }
    if (mathBlock) { if (/\$\$$/.test(l)) mathBlock = false; continue; }
    if (fence) continue;
    if (/^:::\s*\S/.test(l)) { depth++; continue; }
    if (/^:::\s*$/.test(l)) { depth = Math.max(0, depth - 1); continue; }
    if (depth || !l || /^(#|!\[|\||>|[-*+]\s|\d+[.)]\s|@|\[\[|\[\^|https?:)/.test(l)) continue;
    out.push(l);
  }
  return out.join(' ').replace(/\[\^[^\]\s]+\]/g, '').replace(/(^|[^$])\$(?!\s)([^$]+?)(?<!\s)\$(?!\d)/g, '$1$2').replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*=~`]/g, '').slice(0, n);
}

export { SECTION_ALIAS, embedSrc, frontMatter, resolveMeta, plainText, excerpt, esc, safeUrl, inline, parse, renderBody, liveKinds, evaluate, LIVE_LABEL };
