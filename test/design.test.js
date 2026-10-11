import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDesign, designCss, palette, fontFamilies } from '../public/assets/design.js';

test('デザインの設定は、決まった値だけを残す', () => {
  const d = cleanDesign({
    h2: 'band', h3: 'nope', headingFont: 'dela', accent: '#E91E63', list: 'cards', bogus: 'x',
    logo: 'javascript:alert(1)', cover: 'https://example.com/a.jpg', footer: '  © 編集部  ',
  });
  assert.deepEqual(d, { h2: 'band', headingFont: 'dela', list: 'cards', accent: '#e91e63', cover: 'https://example.com/a.jpg', footer: '© 編集部' });
  assert.equal(cleanDesign({ cover: 'https://example.com/a.jpg")}body{display:none' }).cover, undefined, 'CSS を壊せるURLは断る');
});

test('好きな色を選んでも、明るい画面・暗い画面の両方で読める濃さにする', () => {
  const lum = h => { const n = parseInt(h.slice(1), 16); const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const hex of ['#ffeb3b', '#00e5ff', '#e91e63', '#0b0d12', '#777777']) {
    const p = palette(hex);
    assert.ok(ratio(p.light.a, '#ffffff') >= 4.5, `${hex} は白地で読める`);
    assert.ok(ratio(p.dark.a, '#0a0b0e') >= 4.5, `${hex} は黒地で読める`);
    assert.ok(ratio(p.light.a, p.light.ink) >= 4.5, `${hex} の上の文字が読める`);
  }
});

test('選んだ書体と見出しの形が CSS になる', () => {
  const m = { theme: 'standard', color: 'blue', design: { headingFont: 'dela', bodyFont: 'ud', h2: 'number', header: 'band', background: 'dots' } };
  const css = designCss(m);
  assert.match(css, /--serif:"Dela Gothic One"/);
  assert.match(css, /--sans:"BIZ UDPGothic"/);
  assert.match(css, /counter-increment:h2n/);
  assert.match(css, /\.bar\{background:var\(--blue\)/);
  assert.match(css, /radial-gradient/);
  assert.deepEqual(fontFamilies(m), ['Dela+Gothic+One', 'BIZ+UDPGothic:wght@400;700']);
  assert.deepEqual(fontFamilies({ theme: 'pop', design: { headingFont: 'maru' } }), ['Zen+Maru+Gothic:wght@500;700;900'], '同じ書体は2回読み込まない');
});
