/* 読者のページで動く部分：クイズ・計算・グラフなどの動き、用語の吹き出し、目次、読み進み具合 */
import { esc, evaluate } from './render.js';

/* ========== 動く要素を有効にする ========== */
export function hydrate(root) {
  root.querySelectorAll('[data-live="quiz"]').forEach(el => {
    const opts = [...el.querySelectorAll('.quiz-opt')];
    const res = el.querySelector('.quiz-res');
    opts.forEach(b => b.addEventListener('click', () => {
      const ok = b.dataset.ok === '1';
      opts.forEach(o => { o.disabled = true; if (o.dataset.ok === '1') o.classList.add('ok'); });
      if (!ok) b.classList.add('ng');
      res.querySelector('.msg').innerHTML = ok ? '<strong class="ok">正解です。</strong>' : '<strong class="ng">ちがいます。</strong>正解は緑の選択肢です。';
      res.hidden = false;
    }));
    res.querySelector('.again').addEventListener('click', () => {
      opts.forEach(o => { o.disabled = false; o.classList.remove('ok', 'ng'); });
      res.hidden = true;
    });
  });

  root.querySelectorAll('[data-live="calc"]').forEach(el => {
    let spec;
    try { spec = JSON.parse(el.dataset.spec); } catch { return; }
    const nums = [...el.querySelectorAll('input[type=number]')];
    const outs = [...el.querySelectorAll('.calc-o')];
    const fmt = v => Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ja-JP') : v.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
    const run = () => {
      const vars = {};
      spec.ins.forEach((n, i) => { vars[n] = parseFloat(nums[i].value) || 0; });
      spec.outs.forEach((o, i) => {
        const r = outs[i].querySelector('.r');
        try {
          const v = evaluate(o.expr, vars);
          vars[o.name] = v;
          outs[i].classList.remove('err');
          r.innerHTML = isFinite(v) ? `${fmt(v)}<small>${esc(o.unit)}</small>` : '計算できません';
        } catch (e) { outs[i].classList.add('err'); r.textContent = e.message; }
      });
    };
    el.addEventListener('input', e => {
      const i = e.target.dataset.i;
      if (i == null) return;
      const pair = el.querySelectorAll(`[data-i="${i}"]`);
      pair.forEach(x => { if (x !== e.target) x.value = e.target.value; });
      run();
    });
    run();
  });

  root.querySelectorAll('[data-live="chart"]').forEach(el => {
    const bars = el.querySelector('.bars'), note = el.querySelector('.bars-note');
    const rows = [...el.querySelectorAll('.row-hit')];
    const fmt = v => v.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
    const pick = r => {
      rows.forEach(x => x.classList.toggle('on', x === r));
      bars.classList.add('focus');
      const i = +r.dataset.i, v = +r.dataset.v;
      if (i === 0) { note.innerHTML = `<strong>${esc(r.dataset.l)}</strong>：${fmt(v)}（最初の項目）`; return; }
      const prev = +rows[i - 1].dataset.v, d = v - prev;
      const pct = prev ? `（${d >= 0 ? '+' : ''}${fmt(d / prev * 100)}%）` : '';
      note.innerHTML = `<strong>${esc(r.dataset.l)}</strong>：${fmt(v)}　${esc(rows[i - 1].dataset.l)}から ${d >= 0 ? '+' : ''}${fmt(d)} ${pct}`;
    };
    rows.forEach(r => {
      r.addEventListener('click', () => pick(r));
      r.addEventListener('mouseenter', () => pick(r));
      r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r); } });
    });
  });

  root.querySelectorAll('[data-live="tabs"]').forEach(el => {
    const tabs = [...el.querySelectorAll('[role=tab]')], pnls = [...el.querySelectorAll('.pnl')];
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.setAttribute('aria-selected', String(x === t)));
      pnls.forEach(p => { p.hidden = p.dataset.i !== t.dataset.i; });
    }));
  });

  root.querySelectorAll('[data-live="steps"]').forEach(el => {
    const pnls = [...el.querySelectorAll('.pnl')];
    const dots = el.querySelector('.steps-dots');
    let names = [];
    try { names = JSON.parse(dots.dataset.names); } catch {}
    const prev = el.querySelector('.prev'), next = el.querySelector('.next');
    let cur = 0;
    const show = n => {
      cur = Math.max(0, Math.min(pnls.length - 1, n));
      pnls.forEach((p, i) => { p.hidden = i !== cur; });
      dots.innerHTML = pnls.map((_, i) => `<button type="button" data-i="${i}" class="${i === cur ? 'cur' : i < cur ? 'done' : ''}" aria-label="ステップ${i + 1}">${i + 1}</button>`).join('') +
        `<span class="lbl">${esc(names[cur] || '')}</span>`;
      prev.disabled = cur === 0;
      next.textContent = cur === pnls.length - 1 ? '最初に戻る' : '次へ →';
    };
    dots.addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); });
    prev.addEventListener('click', () => show(cur - 1));
    next.addEventListener('click', () => show(cur === pnls.length - 1 ? 0 : cur + 1));
    show(0);
  });

  root.querySelectorAll('.cmp').forEach(el => {
    const r = el.querySelector('input');
    r.addEventListener('input', () => el.style.setProperty('--x', r.value + '%'));
  });
}

/* 用語の説明（全体で1つの吹き出し） */
let tip = document.getElementById('tip');
let tipFor = null;
function showTip(b) {
  tipFor = b;
  tip.textContent = b.dataset.tip;
  tip.hidden = false;
  const r = b.getBoundingClientRect();
  const w = tip.offsetWidth;
  const left = Math.max(16, Math.min(window.scrollX + r.left + r.width / 2 - w / 2, window.scrollX + document.documentElement.clientWidth - w - 16));
  tip.style.left = left + 'px';
  tip.style.top = (window.scrollY + r.bottom + 8) + 'px';
}
function hideTip() { tip.hidden = true; tipFor = null; }
document.addEventListener('click', e => {
  const b = e.target.closest('.gl');
  if (b) { e.preventDefault(); tipFor === b ? hideTip() : showTip(b); }
  else if (!e.target.closest('#tip')) hideTip();
});
document.addEventListener('mouseover', e => { const b = e.target.closest('.gl'); if (b && matchMedia('(hover:hover)').matches) showTip(b); });
document.addEventListener('mouseout', e => { if (e.target.closest('.gl') && matchMedia('(hover:hover)').matches) hideTip(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
window.addEventListener('scroll', () => { if (tipFor) hideTip(); }, { passive: true });


export { hideTip };

/* 記事ページ：目次・進み具合・書き手向けの編集ボタン */
const article = document.querySelector('.article');
if (article) {
  hydrate(article);
  const bar = document.getElementById('progress');
  const onScroll = () => {
    const r = article.getBoundingClientRect();
    const total = r.height - innerHeight + 120;
    if (bar) bar.style.width = Math.max(0, Math.min(1, total > 0 ? -r.top / total : 1)) * 100 + '%';
    let cur = null;
    for (const h of article.querySelectorAll('.prose h2, .prose h3')) if (h.getBoundingClientRect().top < 120) cur = h.id;
    document.querySelectorAll('.toc a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + cur));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

const nav = document.getElementById('nav');
if (nav && nav.dataset.slug !== undefined) {
  fetch('/api/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(me => {
    if (!me || !me.writer) return;
    const slug = nav.dataset.slug;
    nav.innerHTML = slug
      ? `<a class="btn" href="/write#${esc(slug)}">この記事を編集</a><a class="btn primary" href="/write#new">＋ 新しい記事</a>`
      : `<a class="btn" href="/write">記事の管理</a><a class="btn primary" href="/write#new">＋ 新しい記事</a>`;
  }).catch(() => {});
}
