// Tiny dependency-free SVG charts with hover tooltips.
import { compact, num, hourLabel, esc } from './fmt.js';

const W = 360, H = 176, P = { l: 34, r: 34, t: 14, b: 24 };

function niceMax(v) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}

function attachHover(host, svg, columns, render) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  host.appendChild(tip);
  const cursor = svg.querySelector('.cursor');
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
    const step = (W - P.l - P.r) / columns;
    const i = Math.max(0, Math.min(columns - 1, Math.floor((x - P.l) / step)));
    tip.innerHTML = render(i);
    tip.style.opacity = 1;
    const cx = P.l + step * (i + 0.5);
    cursor.setAttribute('x', P.l + step * i); cursor.setAttribute('width', step); cursor.style.opacity = 1;
    const px = cx / W * r.width;
    tip.style.left = Math.max(4, Math.min(r.width - tip.offsetWidth - 4, px - tip.offsetWidth / 2)) + 'px';
  };
  const leave = () => { tip.style.opacity = 0; cursor.style.opacity = 0; };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('touchstart', move, { passive: true });
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', leave);
}

/** Bars = impressions per hour, line = average speed. */
export function hourlyChart(host, hourly, { color = 'var(--accent)', nowHour = null, peak = [] } = {}) {
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxI = niceMax(Math.max(...hourly.map(h => h.impressions)));
  const maxS = niceMax(Math.max(...hourly.map(h => h.speed)) * 1.05);
  const step = iw / 24, bw = step * 0.68;
  const y = v => P.t + ih - (v / maxI) * ih;
  const ys = v => P.t + ih - (v / maxS) * ih;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const yy = P.t + ih * k / 4;
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" class="grid"/>`;
    g += `<text x="${P.l - 6}" y="${yy + 3}" class="ax" text-anchor="end">${compact(maxI * (1 - k / 4)).replace(' هزار', 'K').replace(' میلیون', 'M')}</text>`;
    g += `<text x="${W - P.r + 6}" y="${yy + 3}" class="ax ax-s">${Math.round(maxS * (1 - k / 4))}</text>`;
  }
  let bars = '';
  hourly.forEach((h, i) => {
    const x = P.l + step * i + (step - bw) / 2;
    const isPeak = peak.includes(i);
    bars += `<rect x="${x}" y="${y(h.impressions)}" width="${bw}" height="${Math.max(0.5, P.t + ih - y(h.impressions))}" rx="2" fill="${color}" opacity="${isPeak ? 1 : 0.55}"/>`;
  });
  const pts = hourly.map((h, i) => `${P.l + step * (i + 0.5)},${ys(h.speed)}`).join(' ');
  let xt = '';
  for (let i = 0; i < 24; i += 3) xt += `<text x="${P.l + step * (i + 0.5)}" y="${H - 6}" class="ax" text-anchor="middle">${i}</text>`;
  const now = nowHour != null ? `<line x1="${P.l + step * (nowHour + 0.5)}" x2="${P.l + step * (nowHour + 0.5)}" y1="${P.t}" y2="${P.t + ih}" class="now"/><text x="${P.l + step * (nowHour + 0.5)}" y="${P.t - 3}" class="ax now-t" text-anchor="middle">الان</text>` : '';
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" dir="ltr" role="img" aria-label="نمودار ساعتی ایمپرشن و سرعت">
    ${g}<rect class="cursor" y="${P.t}" height="${ih}" x="0" width="0"/>${bars}
    <polyline points="${pts}" class="speed-line"/>${now}${xt}</svg>`;
  attachHover(host, host.querySelector('svg'), 24, i => {
    const h = hourly[i];
    return `<b>${hourLabel(i)}</b><span>ایمپرشن <em>${num(h.impressions)}</em></span><span>تردد <em>${num(h.vehicles)}</em> خودرو</span><span>سرعت <bdi dir="ltr"><em>${Math.round(h.speed)}</em> km/h</bdi> · مواجهه <em>${h.exposure.toFixed(1)}</em> ثانیه</span>`;
  });
}

/** Multi-series hourly impressions (comparison). series: [{name,color,values[24]}] */
export function multiLine(host, series) {
  const iw = W - P.l - 12, ih = H - P.t - P.b;
  const R = 12;
  const maxV = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const step = iw / 24;
  const y = v => P.t + ih - (v / maxV) * ih;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const yy = P.t + ih * k / 4;
    g += `<line x1="${P.l}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${P.l - 6}" y="${yy + 3}" class="ax" text-anchor="end">${compact(maxV * (1 - k / 4)).replace(' هزار', 'K').replace(' میلیون', 'M')}</text>`;
  }
  let lines = '';
  series.forEach(s => {
    const pts = s.values.map((v, i) => `${P.l + step * (i + 0.5)},${y(v)}`).join(' ');
    lines += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  let xt = '';
  for (let i = 0; i < 24; i += 3) xt += `<text x="${P.l + step * (i + 0.5)}" y="${H - 6}" class="ax" text-anchor="middle">${i}</text>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" dir="ltr">${g}<rect class="cursor" y="${P.t}" height="${ih}" x="0" width="0"/>${lines}${xt}</svg>`;
  // hover uses the same geometry but with a different right padding
  const svg = host.querySelector('svg');
  const tip = document.createElement('div'); tip.className = 'chart-tip'; host.appendChild(tip);
  const cursor = svg.querySelector('.cursor');
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
    const i = Math.max(0, Math.min(23, Math.floor((x - P.l) / step)));
    const rows = series.map(s => ({ s, v: s.values[i] })).sort((a, b) => b.v - a.v)
      .map(({ s, v }) => `<span><i style="background:${s.color}"></i>${esc(s.name)} <em>${num(v)}</em></span>`).join('');
    tip.innerHTML = `<b>${hourLabel(i)}</b>${rows}`;
    tip.style.opacity = 1;
    cursor.setAttribute('x', P.l + step * i); cursor.setAttribute('width', step); cursor.style.opacity = 1;
    const px = (P.l + step * (i + 0.5)) / W * r.width;
    tip.style.left = Math.max(4, Math.min(r.width - tip.offsetWidth - 4, px - tip.offsetWidth / 2)) + 'px';
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', () => { tip.style.opacity = 0; cursor.style.opacity = 0; });
}

/** Score ring (0–100) */
export function ring(score, color = 'var(--accent)', size = 64) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" class="ring-t">${score}</text></svg>`;
}

/** Week × hour heatmap. grid: 7 rows (Sat→Fri) × 24 values. */
export function heatmap(host, grid, { rows, color = '#5B8CFF' } = {}) {
  const cw = 13.5, ch = 17, L = 54, T = 6, B = 18;
  const w = L + cw * 24 + 4, h = T + ch * 7 + B;
  const max = Math.max(1, ...grid.flat());
  let cells = '';
  grid.forEach((row, r) => {
    cells += `<text x="${L - 6}" y="${T + ch * r + ch / 2 + 3.5}" class="ax" direction="rtl" text-anchor="start">${rows[r]}</text>`;
    row.forEach((v, c) => {
      const a = Math.pow(v / max, 0.85);
      cells += `<rect x="${L + c * cw + 0.75}" y="${T + ch * r + 0.75}" width="${cw - 1.5}" height="${ch - 1.5}" rx="2.5" fill="${color}" fill-opacity="${(0.06 + a * 0.94).toFixed(3)}" data-r="${r}" data-c="${c}"/>`;
    });
  });
  let xt = '';
  for (let c = 0; c < 24; c += 3) xt += `<text x="${L + c * cw + cw / 2}" y="${h - 5}" class="ax" text-anchor="middle">${c}</text>`;
  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" class="chart heat" dir="ltr" role="img" aria-label="نقشه حرارتی ایمپرشن در هفته">${cells}${xt}</svg>`;
  const tip = document.createElement('div'); tip.className = 'chart-tip'; host.appendChild(tip);
  const svg = host.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const t = ev.target.closest('rect'); if (!t) { tip.style.opacity = 0; return; }
    const r = +t.dataset.r, c = +t.dataset.c;
    tip.innerHTML = `<b>${rows[r]} · ${hourLabel(c)}</b><span>ایمپرشن <em>${num(grid[r][c])}</em></span>`;
    tip.style.opacity = 1;
    const hr = host.getBoundingClientRect(), tr = t.getBoundingClientRect();
    tip.style.left = Math.max(4, Math.min(hr.width - tip.offsetWidth - 4, tr.left - hr.left + tr.width / 2 - tip.offsetWidth / 2)) + 'px';
    tip.style.top = (tr.top - hr.top - 4) + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
}

/** Value map: x = daily impressions, y = CPM (lower is better). points: [{name,color,x,y,label}] */
export function valueMap(host, points) {
  const W2 = 420, H2 = 250, l = 58, r = 14, t = 14, b = 34;
  const iw = W2 - l - r, ih = H2 - t - b;
  const maxX = niceMax(Math.max(...points.map(p => p.x)) * 1.1);
  const maxY = niceMax(Math.max(...points.map(p => p.y)) * 1.15);
  const X = v => l + v / maxX * iw, Y = v => t + ih - v / maxY * ih;
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  let g = `<rect x="${X(mx)}" y="${Y(my)}" width="${l + iw - X(mx)}" height="${t + ih - Y(my)}" class="vm-best"/>`;
  g += `<text x="${l + iw - 6}" y="${t + ih - 8}" direction="rtl" text-anchor="start" class="vm-q">ارزش بالا: پربازدید و ارزان</text>`;
  g += `<line x1="${X(mx)}" x2="${X(mx)}" y1="${t}" y2="${t + ih}" class="vm-mid"/><line x1="${l}" x2="${l + iw}" y1="${Y(my)}" y2="${Y(my)}" class="vm-mid"/>`;
  for (let k = 0; k <= 4; k++) {
    const yv = maxY * k / 4, xv = maxX * k / 4;
    g += `<line x1="${l}" x2="${l + iw}" y1="${Y(yv)}" y2="${Y(yv)}" class="grid"/>`;
    g += `<text x="${l - 6}" y="${Y(yv) + 3}" text-anchor="end" class="ax">${compact(yv).replace(' هزار', 'K').replace(' میلیون', 'M')}</text>`;
    g += `<text x="${X(xv)}" y="${t + ih + 14}" text-anchor="middle" class="ax">${compact(xv).replace(' هزار', 'K').replace(' میلیون', 'M')}</text>`;
  }
  g += `<text x="${l + iw / 2}" y="${H2 - 3}" text-anchor="middle" class="ax">ایمپرشن روزانه →</text>`;
  g += `<text x="12" y="${t + ih / 2}" text-anchor="middle" class="ax" transform="rotate(-90 12 ${t + ih / 2})">CPM (تومان)</text>`;
  const dots = points.map(p => `<g class="vm-pt"><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="9" fill="${p.color}" stroke="var(--surface-2)" stroke-width="2.5"/><text x="${X(p.x)}" y="${Y(p.y) + 4}" text-anchor="middle" class="vm-n">${p.label}</text><title>${esc(p.name)} — ${num(p.x)} ایمپرشن، CPM ${num(p.y)}</title></g>`).join('');
  host.innerHTML = `<svg viewBox="0 0 ${W2} ${H2}" class="chart" dir="ltr" role="img" aria-label="نقشه ارزش: ایمپرشن در برابر CPM">${g}${dots}</svg>`;
}
