// 의존성 없는 inline SVG 차트 (R-14). 모든 함수는 SVG 문자열을 돌려주고, 상호작용(툴팁)은 main.js가 data-* 속성으로 붙인다.
// 색은 CSS 변수(--viz-*)만 쓴다. 텍스트는 ink 색만, 시리즈 색은 마크에만.

const PAD = { l: 38, r: 14, t: 14, b: 26 };

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function mmdd(d) { return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; }
function niceTicks(min, max, n = 4) {
  const span = max - min || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function frame({ width, height, xCount, yMin, yMax, xLabels }) {
  const W = width - PAD.l - PAD.r, H = height - PAD.t - PAD.b;
  const x = i => PAD.l + (xCount <= 1 ? W / 2 : (i / (xCount - 1)) * W);
  const y = v => PAD.t + H - ((v - yMin) / (yMax - yMin || 1)) * H;
  const ticks = niceTicks(yMin, yMax);
  let g = '';
  for (const t of ticks) {
    g += `<line class="viz-grid" x1="${PAD.l}" x2="${width - PAD.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    g += `<text class="viz-tick" x="${PAD.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  }
  g += `<line class="viz-axis" x1="${PAD.l}" x2="${width - PAD.r}" y1="${PAD.t + H}" y2="${PAD.t + H}"/>`;
  const every = Math.max(1, Math.ceil(xCount / Math.max(2, Math.floor(W / 46))));
  xLabels.forEach((lab, i) => {
    if (i % every === 0 || i === xLabels.length - 1) g += `<text class="viz-tick" x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(lab)}</text>`;
  });
  return { x, y, W, H, grid: g };
}

function linePath(pts) {
  let d = '', pen = false;
  for (const p of pts) {
    if (p === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

function legend(items) {
  return `<div class="viz-legend">${items.map(i => `<span class="viz-key"><i class="viz-swatch ${i.cls}"></i>${esc(i.label)}</span>`).join('')}</div>`;
}

// ① 체중: rows(과거) + forecast(오늘부터) + sim(선택) + targetWeight
export function weightChart({ rows, forecast = [], sim = null, targetWeight, width = 360, height = 220 }) {
  const n = rows.length, fn = Math.max(0, forecast.length - 1);
  const xCount = n + fn;
  const vals = [
    ...rows.flatMap(r => [r.weight, r.trend, r.target]),
    ...forecast.map(f => f.weight), ...(sim ? sim.map(s => s.weight) : []), targetWeight,
  ].filter(v => typeof v === 'number');
  if (rows.every(r => r.weight === null) && forecast.length === 0) {
    return `<div class="viz-empty">기록이 쌓이면 추세가 보입니다</div>`;
  }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const yMin = Math.floor((lo - 0.5) * 2) / 2, yMax = Math.ceil((hi + 0.5) * 2) / 2;
  const labels = [...rows.map(r => mmdd(r.date)), ...forecast.slice(1).map(f => mmdd(f.date))];
  const f = frame({ width, height, xCount, yMin, yMax, xLabels: labels });
  const fx = i => f.x(n - 1 + i);
  let s = '';
  s += `<line class="viz-target-line" x1="${PAD.l}" x2="${width - PAD.r}" y1="${f.y(targetWeight)}" y2="${f.y(targetWeight)}"/>`;
  s += `<text class="viz-tick" x="${PAD.l + 4}" y="${f.y(targetWeight) - 4}" text-anchor="start">목표 ${targetWeight}</text>`;
  s += `<path class="viz-path-target" d="${linePath(rows.map((r, i) => r.target === null ? null : [f.x(i), f.y(r.target)]))}"/>`;
  s += `<path class="viz-path-trend" d="${linePath(rows.map((r, i) => r.trend === null ? null : [f.x(i), f.y(r.trend)]))}"/>`;
  if (forecast.length > 1) {
    s += `<path class="viz-path-forecast" d="${linePath(forecast.map((p, i) => [fx(i), f.y(p.weight)]))}"/>`;
    const last = forecast[forecast.length - 1];
    s += `<text class="viz-label" x="${fx(fn) - 2}" y="${f.y(last.weight) - 8}" text-anchor="end">예상 ${last.weight}</text>`;
  }
  if (sim && sim.length > 1) {
    const up = sim[sim.length - 1].weight > sim[0].weight;
    s += `<path class="viz-path-sim${up ? ' warn' : ''}" d="${linePath(sim.map((p, i) => [fx(i), f.y(p.weight)]))}"/>`;
    s += `<text class="viz-label${up ? ' warn' : ''}" x="${fx(fn) - 2}" y="${f.y(sim[sim.length - 1].weight) + 14}" text-anchor="end">시뮬 ${sim[sim.length - 1].weight}</text>`;
  }
  if (n > 0) s += `<line class="viz-today" x1="${f.x(n - 1)}" x2="${f.x(n - 1)}" y1="${PAD.t}" y2="${PAD.t + f.H}"/>`;
  rows.forEach((r, i) => {
    const icon = r.cheat ? '🎉' : r.status === 'fasting' ? '⛔' : r.sticker ? '⭐' : '';
    if (icon) s += `<text class="viz-icon" x="${f.x(i)}" y="${PAD.t + f.H - 3}" text-anchor="middle">${icon}</text>`;
    if (r.weight !== null) {
      s += `<circle class="viz-dot" data-i="${i}" cx="${f.x(i)}" cy="${f.y(r.weight)}" r="4.5"/>`;
      s += `<circle class="viz-hit" data-i="${i}" cx="${f.x(i)}" cy="${f.y(r.weight)}" r="14"/>`;
    }
  });
  const svg = `<svg class="viz" viewBox="0 0 ${width} ${height}" role="img" aria-label="체중 그래프">${f.grid}${s}</svg>`;
  const keys = [{ cls: 'dot', label: '실측' }, { cls: 'trend', label: '7일 추세' }, { cls: 'target', label: '목표 경로' }, { cls: 'forecast', label: '30일 예상' }];
  if (sim) keys.push({ cls: 'sim', label: '시뮬레이션' });
  return svg + legend(keys);
}

// ② kcal: 섭취 막대 + 예산 선
export function kcalChart({ rows, width = 360, height = 180 }) {
  const n = rows.length;
  const vals = rows.flatMap(r => [r.intake, r.budget]).filter(v => typeof v === 'number');
  if (!rows.some(r => r.logged)) return `<div class="viz-empty">식사를 기록하면 kcal 그래프가 보입니다</div>`;
  const yMax = Math.max(500, Math.ceil((Math.max(...vals) + 100) / 250) * 250);
  const f = frame({ width, height, xCount: n, yMin: 0, yMax, xLabels: rows.map(r => mmdd(r.date)) });
  const bw = Math.max(3, (f.W / n) - 2);
  let s = '';
  rows.forEach((r, i) => {
    if (!r.logged) return;
    const over = r.budget !== null && r.intake > r.budget;
    const h = f.H - (f.y(r.intake) - PAD.t);
    s += `<rect class="viz-bar${over ? ' over' : ''}" data-i="${i}" x="${f.x(i) - bw / 2}" y="${f.y(r.intake)}" width="${bw}" height="${Math.max(0, h)}" rx="2"/>`;
  });
  s += `<path class="viz-path-budget" d="${linePath(rows.map((r, i) => r.budget === null ? null : [f.x(i), f.y(r.budget)]))}"/>`;
  const svg = `<svg class="viz" viewBox="0 0 ${width} ${height}" role="img" aria-label="섭취 kcal 그래프">${f.grid}${s}</svg>`;
  return svg + legend([{ cls: 'bar', label: '섭취' }, { cls: 'over', label: '예산 초과' }, { cls: 'budget', label: '예산' }]);
}

// ③ 운동: 완료율 막대 + 주말 달리기 표시
export function workoutChart({ rows, width = 360, height = 150 }) {
  const n = rows.length;
  const f = frame({ width, height, xCount: n, yMin: 0, yMax: 100, xLabels: rows.map(r => mmdd(r.date)) });
  const bw = Math.max(3, (f.W / n) - 2);
  let s = '';
  rows.forEach((r, i) => {
    const pct = Math.round(r.workoutRate * 100);
    s += `<rect class="viz-bar${pct >= 100 ? ' full' : ''}" data-i="${i}" x="${f.x(i) - bw / 2}" y="${f.y(pct)}" width="${bw}" height="${Math.max(0, f.H - (f.y(pct) - PAD.t))}" rx="2"/>`;
    if (r.run) s += `<text class="viz-icon" x="${f.x(i)}" y="${PAD.t + 10}" text-anchor="middle">🏃</text>`;
  });
  const svg = `<svg class="viz" viewBox="0 0 ${width} ${height}" role="img" aria-label="운동 완료율 그래프">${f.grid}${s}</svg>`;
  return svg + legend([{ cls: 'bar', label: '완료율 %' }, { cls: 'full', label: '100%' }, { cls: 'run', label: '🏃 5km' }]);
}

// ④ 예측 정확도: 14일 전 스냅샷 vs 실제 추세
export function accuracyChart({ rows, meanErr, width = 360, height = 170 }) {
  const pairs = rows.map((r, i) => {
    const back = rows[i - 14];
    return { date: r.date, actual: r.trend, predicted: back && back.snapshot !== null && back.snapshot !== undefined ? back.snapshot : null };
  });
  if (!pairs.some(p => p.predicted !== null)) return `<div class="viz-empty">14일 이상 기록되면 예측 정확도가 보입니다</div>`;
  const vals = pairs.flatMap(p => [p.actual, p.predicted]).filter(v => typeof v === 'number');
  const yMin = Math.floor(Math.min(...vals) - 0.5), yMax = Math.ceil(Math.max(...vals) + 0.5);
  const f = frame({ width, height, xCount: pairs.length, yMin, yMax, xLabels: pairs.map(p => mmdd(p.date)) });
  let s = `<path class="viz-path-trend" d="${linePath(pairs.map((p, i) => p.actual === null ? null : [f.x(i), f.y(p.actual)]))}"/>`;
  s += `<path class="viz-path-forecast" d="${linePath(pairs.map((p, i) => p.predicted === null ? null : [f.x(i), f.y(p.predicted)]))}"/>`;
  const svg = `<svg class="viz" viewBox="0 0 ${width} ${height}" role="img" aria-label="예측 정확도 그래프">${f.grid}${s}</svg>`;
  return svg + legend([{ cls: 'trend', label: '실제 추세' }, { cls: 'forecast', label: '14일 전 예측' }]) + (meanErr !== null ? `<p class="viz-note">평균 오차 ${meanErr}kg</p>` : '');
}
