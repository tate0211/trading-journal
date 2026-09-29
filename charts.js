// Small dependency-free SVG charts with hover tooltips.
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  function niceTicks(min, max, count = 5) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  function fmt(v) { return (v > 0 ? '+' : '') + (Math.round(v * 100) / 100) + 'R'; }

  // points: [{y, tip}] — plotted in sequence along x.
  function line(container, points, { height = 240 } = {}) {
    container.innerHTML = '';
    container.classList.add('chart');
    if (!points.length) { container.innerHTML = '<div class="empty">No trades in this period yet.</div>'; return; }
    const W = Math.max(container.clientWidth, 280), H = height;
    const pad = { l: 44, r: 12, t: 10, b: 24 };
    const ys = [0, ...points.map((p) => p.y)];
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const n = points.length;
    const X = (i) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
    const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Cumulative R by trade' }, container);
    const axis = el('g', { class: 'axis' }, svg);
    for (const t of ticks) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: 'gridline', ...(t === 0 ? { style: 'stroke: var(--muted)' } : {}) }, svg);
      const tx = el('text', { x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, axis);
      tx.textContent = t + 'R';
    }
    const first = el('text', { x: X(0), y: H - 6, 'text-anchor': 'start' }, axis); first.textContent = 'Trade 1';
    if (n > 1) { const last = el('text', { x: X(n - 1), y: H - 6, 'text-anchor': 'end' }, axis); last.textContent = 'Trade ' + n; }

    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
    el('path', { d, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);

    const cross = el('line', { y1: pad.t, y2: H - pad.b, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
    const dot = el('circle', { r: 5, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg);
    const tip = document.createElement('div'); tip.className = 'tip'; container.appendChild(tip);
    const hit = el('rect', { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: 'transparent' }, svg);

    const show = (clientX) => {
      const r = svg.getBoundingClientRect();
      const sx = ((clientX - r.left) / r.width) * W;
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((sx - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
      const p = points[i];
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.y)); dot.setAttribute('visibility', 'visible');
      tip.innerHTML = p.tip; tip.style.display = 'block';
      const px = (X(i) / W) * r.width, py = (Y(p.y) / H) * r.height;
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(0, px + 12), r.width - tw) + 'px';
      tip.style.top = Math.max(0, py - 50) + 'px';
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; };
    hit.addEventListener('mousemove', (e) => show(e.clientX));
    hit.addEventListener('touchstart', (e) => show(e.touches[0].clientX), { passive: true });
    hit.addEventListener('mouseleave', hide);
  }

  // Horizontal bars around a zero baseline. rows: [{label, value, tip}]
  function bars(container, rows) {
    container.innerHTML = '';
    container.classList.add('chart');
    if (!rows.length) { container.innerHTML = '<div class="empty">No tagged mistakes in this period. Keep it that way.</div>'; return; }
    const W = Math.max(container.clientWidth, 280);
    const rowH = 30, pad = { l: Math.min(170, W * 0.38), r: 56, t: 4, b: 4 };
    const H = pad.t + pad.b + rows.length * rowH;
    const vals = rows.map((r) => r.value);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = hi - lo || 1;
    const X = (v) => pad.l + ((v - lo) / span) * (W - pad.l - pad.r);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'R lost per mistake' }, container);
    const tip = document.createElement('div'); tip.className = 'tip'; container.appendChild(tip);
    el('line', { x1: X(0), x2: X(0), y1: 0, y2: H, stroke: 'var(--muted)', 'stroke-width': 1 }, svg);

    rows.forEach((r, i) => {
      const y = pad.t + i * rowH + 6, h = rowH - 12;
      const x0 = X(0), x1 = X(r.value);
      const left = Math.min(x0, x1), w = Math.max(Math.abs(x1 - x0), 1);
      const rad = Math.min(4, w, h / 2);
      // Round only the data end; keep the baseline end square.
      const d = r.value < 0
        ? `M${x0},${y} H${left + rad} Q${left},${y} ${left},${y + rad} V${y + h - rad} Q${left},${y + h} ${left + rad},${y + h} H${x0} Z`
        : `M${x0},${y} H${x1 - rad} Q${x1},${y} ${x1},${y + rad} V${y + h - rad} Q${x1},${y + h} ${x1 - rad},${y + h} H${x0} Z`;
      el('path', { d, fill: r.value < 0 ? 'var(--bad)' : 'var(--series-1)' }, svg);
      const lab = el('text', { x: 0, y: y + h / 2 + 4, style: 'fill: var(--text-2); font-size: 12px' }, svg);
      lab.textContent = r.label.length > 24 ? r.label.slice(0, 23) + '…' : r.label;
      const val = el('text', { x: r.value < 0 ? left - 6 : x1 + 6, y: y + h / 2 + 4, 'text-anchor': r.value < 0 ? 'end' : 'start', style: 'fill: var(--text); font-size: 12px; font-variant-numeric: tabular-nums' }, svg);
      if (r.value < 0 && left - 6 < pad.l + 30) { val.setAttribute('x', x0 + 6); val.setAttribute('text-anchor', 'start'); }
      val.textContent = fmt(r.value);
      const hit = el('rect', { x: 0, y: pad.t + i * rowH, width: W, height: rowH, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (e) => {
        const b = container.getBoundingClientRect();
        tip.innerHTML = r.tip; tip.style.display = 'block';
        tip.style.left = Math.min(e.clientX - b.left + 12, b.width - tip.offsetWidth) + 'px';
        tip.style.top = (e.clientY - b.top - 40) + 'px';
      });
      hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
  }

  return { line, bars };
})();
