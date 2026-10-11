/* メディアのデザイン。ひな形（プリセット）と、色・書体・見出しの形などの細かい調整から CSS を作る。
   サーバー（読者のページ）と、書く画面の見本の両方で使う。
   重ねる順番：style.css → ひな形の CSS → 細かい調整 → 追加の CSS（管理者が手で書いたもの） */

/* ---- ひな形 ---- */
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
.prose{font-family:"Noto Serif JP","Hiragino Mincho ProN",serif;font-size:calc(var(--fs,16px) + 1px);line-height:2.05}
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

/* ---- 色のひな形（今までの「色」） ---- */
export const COLORS = {
  blue: { name: '青', hex: '#1f56e0' }, red: { name: '赤', hex: '#c8332f' }, green: { name: '緑', hex: '#12804e' },
  orange: { name: '橙', hex: '#b9520c' }, purple: { name: '紫', hex: '#6847b8' }, teal: { name: '青緑', hex: '#0d7680' }, ink: { name: '黒', hex: '#0b0d12' },
};

/* ---- 書体（Google Fonts）。stack は読み込めなかったときの代わり ---- */
export const FONTS = {
  shippori: { name: '明朝（しっぽり）', family: 'Shippori+Mincho+B1:wght@600;800', stack: '"Shippori Mincho B1","Hiragino Mincho ProN","Yu Mincho",serif' },
  notoserif: { name: '明朝（本格）', family: 'Noto+Serif+JP:wght@400;700;900', stack: '"Noto Serif JP","Hiragino Mincho ProN",serif' },
  oldmincho: { name: '明朝（やわらか）', family: 'Zen+Old+Mincho:wght@400;700;900', stack: '"Zen Old Mincho","Hiragino Mincho ProN",serif' },
  decol: { name: '明朝（装飾）', family: 'Kaisei+Decol:wght@400;700', stack: '"Kaisei Decol","Hiragino Mincho ProN",serif' },
  kaku: { name: 'ゴシック', family: 'Zen+Kaku+Gothic+New:wght@400;500;700', stack: '"Zen Kaku Gothic New","Hiragino Sans","Noto Sans JP",sans-serif' },
  notosans: { name: 'ゴシック（標準）', family: 'Noto+Sans+JP:wght@400;500;700;900', stack: '"Noto Sans JP","Hiragino Sans",sans-serif' },
  ud: { name: 'UDゴシック（読みやすさ重視）', family: 'BIZ+UDPGothic:wght@400;700', stack: '"BIZ UDPGothic","Hiragino Sans",sans-serif' },
  maru: { name: '丸ゴシック', family: 'Zen+Maru+Gothic:wght@500;700;900', stack: '"Zen Maru Gothic","Hiragino Maru Gothic ProN",sans-serif' },
  rounded: { name: '丸ゴシック（くっきり）', family: 'M+PLUS+Rounded+1c:wght@400;700;800', stack: '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN",sans-serif' },
  kiwi: { name: '手書き風（丸）', family: 'Kiwi+Maru:wght@400;500', stack: '"Kiwi Maru","Hiragino Maru Gothic ProN",serif' },
  klee: { name: '教科書体', family: 'Klee+One:wght@400;600', stack: '"Klee One","Hiragino Mincho ProN",serif' },
  yusei: { name: 'マジック手書き', family: 'Yusei+Magic', stack: '"Yusei Magic","Hiragino Maru Gothic ProN",sans-serif' },
  dela: { name: '極太ゴシック', family: 'Dela+Gothic+One', stack: '"Dela Gothic One","Hiragino Sans",sans-serif' },
  rocknroll: { name: 'ポップ体', family: 'RocknRoll+One', stack: '"RocknRoll One","Hiragino Maru Gothic ProN",sans-serif' },
  code: { name: '等幅', family: 'M+PLUS+1+Code:wght@400;500', stack: '"M PLUS 1 Code",ui-monospace,monospace' },
};

/* ---- 細かい調整の選択肢（画面に並べる順番もこのとおり） ---- */
export const OPTIONS = {
  headingFont: { label: '見出しの書体', choices: { '': 'ひな形のまま', ...Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.name])) } },
  bodyFont: { label: '本文の書体', choices: { '': 'ひな形のまま', ...Object.fromEntries(Object.entries(FONTS).filter(([k]) => !['dela', 'decol', 'yusei'].includes(k)).map(([k, v]) => [k, v.name])) } },
  fontSize: { label: '文字の大きさ', choices: { '': '中', small: '小', large: '大', xlarge: '特大' } },
  width: { label: '本文の幅', choices: { '': '標準', narrow: '狭い', wide: '広い' } },
  radius: { label: '角の丸さ', choices: { '': 'ひな形のまま', square: '四角', soft: '少し丸', round: '丸' } },
  h2: { label: '大見出しの形', choices: { '': 'ひな形のまま', rule: '上に太線', band: '色の帯', underline: '下線', bar: '左に棒', box: '枠で囲む', number: '番号つき', plain: '飾りなし' } },
  h3: { label: '小見出しの形', choices: { '': 'ひな形のまま', bar: '左に棒', underline: '下線', dot: '丸印', plain: '飾りなし' } },
  header: { label: '上のバー', choices: { '': '標準', center: 'ロゴを中央に', band: '色の帯', large: '大きなタイトル' } },
  list: { label: '記事一覧の並べ方', choices: { '': 'リスト', cards: '画像つきカード', grid: '2列' } },
  background: { label: '背景', choices: { '': 'ひな形のまま', plain: '無地', paper: '紙', grid: '方眼', dots: 'ドット' } },
  links: { label: 'リンク', choices: { '': '色だけ', underline: '下線あり' } },
};
const FREE = { accent: 'color', logo: 'url', cover: 'url', footer: 'text' };

/* 保存できる形にそろえる（知らない値は捨てる） */
export function cleanDesign(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  for (const [k, o] of Object.entries(OPTIONS)) if (d[k] && Object.prototype.hasOwnProperty.call(o.choices, d[k])) out[k] = d[k];
  if (/^#[0-9a-f]{6}$/i.test(d.accent || '')) out.accent = d.accent.toLowerCase();
  for (const k of ['logo', 'cover']) if (typeof d[k] === 'string' && /^(https:\/\/[^\s"'()<>\\]+|\/media\/[\w.-]+)$/.test(d[k])) out[k] = d[k];
  if (typeof d.footer === 'string' && d.footer.trim()) out.footer = d.footer.trim().slice(0, 200);
  return out;
}
export const DESIGN_KEYS = [...Object.keys(OPTIONS), ...Object.keys(FREE)];

/* ---- 色の計算：好きな色から、暗い画面用・薄い背景用・文字色を作る ---- */
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function lum(rgb) { const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export function palette(hex) {
  const c = hexToRgb(hex), W = [255, 255, 255], K = [10, 11, 14];
  /* 明るい画面：白地で読める濃さまで暗くする */
  let light = c;
  for (let i = 0; i < 12 && contrast(light, W) < 4.5; i++) light = mix(light, [0, 0, 0], 0.12);
  /* 暗い画面：黒地で読める明るさまで明るくする */
  let dark = c;
  for (let i = 0; i < 12 && contrast(dark, K) < 5; i++) dark = mix(dark, W, 0.15);
  const inkOn = rgb => contrast(rgb, W) >= contrast(rgb, K) ? '#ffffff' : '#0a0b0e';
  return {
    light: { a: toHex(light), soft: toHex(mix(light, W, 0.9)), line: toHex(mix(light, W, 0.7)), ink: inkOn(light) },
    dark: { a: toHex(dark), soft: toHex(mix(dark, K, 0.82)), line: toHex(mix(dark, K, 0.6)), ink: inkOn(dark) },
  };
}
export const accentOf = media => (media.design && media.design.accent) || (COLORS[media.color] || COLORS.blue).hex;

/* ---- CSS を組み立てる ---- */
const R = { square: '0', soft: '8px', round: '18px' };
export function designCss(media) {
  const d = media.design || {};
  const t = THEMES[media.theme] || THEMES.standard;
  const p = palette(accentOf(media));
  const v = x => `--blue:${x.a};--blue-soft:${x.soft};--blue-line:${x.line};--blue-ink:${x.ink};--point-bg:${x.soft};--point-bd:${x.a}`;
  const dark = css => `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${css}}}:root[data-theme="dark"]{${css}}`;
  let css = `:root{${v(p.light)}}` + dark(v(p.dark));
  if (t.vars) css += `:root{${t.vars.light}}` + dark(t.vars.dark);
  css += t.css + '\n';

  if (d.headingFont && FONTS[d.headingFont]) css += `:root{--serif:${FONTS[d.headingFont].stack}}`;
  if (d.bodyFont && FONTS[d.bodyFont]) css += `:root{--sans:${FONTS[d.bodyFont].stack}}.prose{font-family:var(--sans)}`;
  const fs = { small: 15, large: 17.5, xlarge: 19 }[d.fontSize];
  if (fs) css += `.prose{font-size:${fs}px}body{font-size:${fs - 1}px}`;
  if (d.width === 'narrow') css += `.article{max-width:600px}@media (min-width:1100px){.post-layout{grid-template-columns:minmax(0,1fr) 600px 220px}}.posts,.home-head{max-width:640px}`;
  if (d.width === 'wide') css += `.article{max-width:820px}@media (min-width:1100px){.post-layout{grid-template-columns:minmax(0,1fr) 820px 220px}}.posts,.home-head,.shelves{max-width:960px}`;
  if (R[d.radius] !== undefined) css += `.box,.live,.card,.pager a,.chapter,.media-card,.result,.post-row.card-row,figure img,figure video,.cover{border-radius:${R[d.radius]}}.btn,.cta,.search-mini input{border-radius:${d.radius === 'square' ? '0' : '999px'}}.logo .k{border-radius:${d.radius === 'round' ? '50%' : R[d.radius]}}`;

  const h2 = {
    rule: '.prose h2{border:0;border-top:3px solid var(--ink);padding:.7em 0 0;background:none;border-radius:0;text-align:left}',
    band: '.prose h2{border:0;background:var(--blue);color:var(--blue-ink);padding:.45em .8em;border-radius:6px;text-align:left}',
    underline: '.prose h2{border:0;border-bottom:3px solid var(--blue);padding:0 0 .3em;background:none;border-radius:0;text-align:left}',
    bar: '.prose h2{border:0;border-left:6px solid var(--blue);padding:.1em 0 .1em .7em;background:none;border-radius:0;text-align:left}',
    box: '.prose h2{border:2px solid var(--blue);padding:.45em .8em;background:var(--blue-soft);border-radius:8px;text-align:left}',
    number: '.prose{counter-reset:h2n}.prose h2{border:0;border-bottom:1px solid var(--line);padding:0 0 .3em;background:none;border-radius:0;text-align:left;counter-increment:h2n}.prose h2::before{content:counter(h2n,decimal-leading-zero);display:inline-block;margin-right:.6em;color:var(--blue);font-family:var(--mono);font-size:.8em}',
    plain: '.prose h2{border:0;padding:0;background:none;border-radius:0;text-align:left}',
  }[d.h2];
  if (h2) css += `.prose h2::before{content:none}` + h2;
  const h3 = {
    bar: '.prose h3{border:0;border-left:4px solid var(--blue);padding:0 0 0 .7em;text-decoration:none}',
    underline: '.prose h3{border:0;border-bottom:2px solid var(--blue-line);padding:0 0 .25em;text-decoration:none}',
    dot: '.prose h3{border:0;padding:0 0 0 1.3em;position:relative;text-decoration:none}.prose h3::before{content:"";position:absolute;left:0;top:.55em;width:.7em;height:.7em;border-radius:50%;background:var(--blue)}',
    plain: '.prose h3{border:0;padding:0;text-decoration:none}',
  }[d.h3];
  if (h3) css += (d.h3 === 'dot' ? '' : '.prose h3::before{content:none}') + h3;

  if (d.header === 'center') css += '.bar-in{flex-wrap:wrap;justify-content:center}.logo{margin:0 auto}.search-mini{order:3;flex-basis:100%;max-width:360px;margin:0 auto}.bar nav{position:absolute;right:16px;top:10px}.bar{position:relative}';
  if (d.header === 'band') css += '.bar{background:var(--blue);border-bottom:0}.bar .logo,.bar .logo .w{color:var(--blue-ink)}.bar .logo .k{background:var(--blue-ink);color:var(--blue)}.bar .search-mini input{background:color-mix(in srgb,var(--blue-ink) 18%,transparent);border-color:transparent;color:var(--blue-ink)}.bar .search-mini input::placeholder{color:var(--blue-ink);opacity:.75}.bar .btn.ghost{color:var(--blue-ink)}.bar .btn.primary{background:var(--blue-ink);border-color:var(--blue-ink);color:var(--blue)}';
  if (d.header === 'large') css += '.bar-in{padding-block:18px}.logo .k{width:52px;height:52px;font-size:30px}.logo .w{font-size:22px;letter-spacing:.08em;font-family:var(--serif);font-weight:800}';

  if (d.background === 'plain') css += 'body{background:var(--bg);background-image:none}.bar{background:var(--bg)}';
  if (d.background === 'paper') css += ':root{--bg:#faf8f3;--bg-2:#f1eee6}' + dark('--bg:#16150f;--bg-2:#1f1d17') + 'body{background:var(--bg)}.bar{background:var(--bg)}';
  if (d.background === 'grid') css += 'body{background-color:var(--bg);background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:24px 24px}.article,.posts,.home-head,.post-row{background:var(--bg)}';
  if (d.background === 'dots') css += 'body{background-color:var(--bg);background-image:radial-gradient(var(--line) 1.2px,transparent 1.2px);background-size:18px 18px}.article,.posts .post-row,.home-head{background:var(--bg)}';
  if (d.links === 'underline') css += '.prose a:not(.cta):not(.card){text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}';
  if (d.logo) css += '.logo .k.img{background:none;width:auto;max-width:180px;padding:0}.logo .k.img img{height:38px;width:auto;display:block}';
  return css;
}

/* 読み込む書体（ひな形と、細かい調整で選んだもの） */
export function fontFamilies(media) {
  const d = media.design || {};
  const t = THEMES[media.theme] || THEMES.standard;
  return [...new Set([...t.fonts, ...[d.headingFont, d.bodyFont].filter(k => k && FONTS[k]).map(k => FONTS[k].family)])];
}
