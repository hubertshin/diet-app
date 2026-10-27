// UI 조립. 상태·계산은 state.js/calc.js, 그래프는 chart.js. 여기는 렌더링과 이벤트만.
import { CONFIG } from './config.js';
import { createApp } from './state.js';
import { createStorage } from './storage.js';
import { searchFoods } from './foods.js';
import { weightChart, kcalChart, workoutChart, accuracyChart } from './chart.js';
import { addDays, parseDate, toDateStr, simulate, estimateTdee } from './calc.js';

const DEBUG = location.search.includes('debug');
const app = createApp({ storage: createStorage(), onEvent: ev => { if (DEBUG) console.log('[event]', ev); } });

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt1 = v => (typeof v === 'number' ? v.toFixed(1) : '—');
const signed = v => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const kdate = d => { const p = parseDate(d); return `${p.getMonth() + 1}월 ${p.getDate()}일 (${DOW[p.getDay()]})`; };

const TABS = ['home', 'log', 'graph', 'cal', 'settings'];
const ui = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home', logDate: app.today(), calMonth: app.today().slice(0, 7), calSel: app.today(),
  range: 30, sim: null, query: '', notices: [], tip: '', lastSticker: null, weightDraft: '',
};
const STATUS_LABEL = { pass: '합격 ✅', fail: '미달', fasting: '23시간 단식', reset: '경로 재설정 권고', cheat: '치팅데이 🎉', missing: '미측정' };

// ---------- 토스트 ----------
let toastTimer = null;
function toast(msg, { action, onAction, ms = 5000 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-action="toast-action">${esc(action)}</button>` : ''}`;
  el.classList.add('show');
  el._onAction = onAction;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- 시트 ----------
function openSheet(html) { $('#sheet').innerHTML = html; $('#sheet-backdrop').classList.add('open'); }
function closeSheet() { $('#sheet-backdrop').classList.remove('open'); $('#sheet').innerHTML = ''; ui.sim = null; }

// ---------- 렌더 ----------
function render() {
  $('#top-date').textContent = kdate(app.today());
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${ui.tab}`));
  ({ home: renderHome, log: renderLog, graph: renderGraph, cal: renderCal, settings: renderSettings })[ui.tab]();
  renderSide();
}

function weightBlock(v) {
  if (v.weight === null || ui.weightDraft === 'edit') {
    return `<div class="row weight-input">
      <input id="weight-in" type="number" inputmode="decimal" step="0.1" min="${CONFIG.weight.min}" max="${CONFIG.weight.max}" placeholder="오늘 아침 체중 (kg)" value="${v.weight ?? ''}" aria-label="오늘 체중">
      <button class="primary" data-action="weight-save">저장</button>
      ${v.weight !== null ? '<button data-action="weight-cancel">취소</button>' : ''}
    </div>
    ${v.weight === null ? `<p class="faint" style="margin:6px 0 0">오늘 목표 ${fmt1(v.target)}kg · 어제 ${fmt1(v.prevWeight)}kg</p>` : ''}`;
  }
  const diff = v.target !== null ? v.weight - v.target : null;
  return `<div class="row between">
    <div><span class="big num">${fmt1(v.weight)}</span><span class="muted"> kg</span>
      <div class="small muted">오늘 목표 ${fmt1(v.target)} · <span class="${diff > 0 ? 'bad' : 'good'} num">${diff === null ? '' : signed(diff)}</span> · 추세 ${fmt1(v.trend)}</div></div>
    <button class="small" data-action="weight-edit" aria-label="체중 수정">수정</button>
  </div>`;
}

function stickerRow(v) {
  const dots = Array.from({ length: CONFIG.judge.stickersPerVoucher }, (_, i) => i < v.sticker.count ? '⭐' : '☆').join('');
  const anim = ui.lastSticker === v.date ? 'sticker-anim' : '';
  return `<div class="row between wrap" style="margin-top:8px">
    <span class="chip ${v.judge.status}">${STATUS_LABEL[v.judge.status]}</span>
    <span class="stickers ${anim}" title="스티커 ${v.sticker.count}/10">${dots} <b class="num">${v.sticker.count}/10</b></span>
    ${v.sticker.vouchers > 0 ? `<button class="small" data-action="cheat-use" ${v.cheat ? 'disabled' : ''}>🎉 치팅권 ${v.sticker.vouchers}장${v.cheat ? ' · 사용 중' : ' 쓰기'}</button>` : ''}
  </div>`;
}

function budgetBlock(v) {
  if (v.fasting) {
    return `<div class="card tight notice bad"><h2>오늘은 23시간 단식</h2>
      <div class="row between"><div><span class="mid num">${v.fasting.start}~${v.fasting.end}</span> <span class="small muted">식사 창</span><div class="small muted" id="fast-countdown"></div></div>
      <input type="time" style="width:auto" value="${v.fasting.start}" data-action="fasting-window" aria-label="식사 창 시작 시각"></div>
      <div class="row between" style="margin-top:6px"><span class="small">예산 <b class="num">${v.budget.budget}</b> kcal · 섭취 <b class="num">${v.intake}</b></span>${v.fasting.broken ? '<span class="chip fasting">창 밖 식사 · 미이행</span>' : ''}</div></div>`;
  }
  if (v.budget.budget === null) {
    return `<div class="card tight notice" style="border-left-color:var(--cheat)"><h2>치팅데이 🎉</h2><div class="row between"><span>오늘은 예산·단식 판정 없음</span><span class="small muted">섭취 <b class="num">${v.intake}</b> kcal</span></div>
      ${(v.meals.length === 0) ? '<button class="small" data-action="cheat-cancel" style="margin-top:6px">치팅데이 취소</button>' : ''}</div>`;
  }
  const over = v.remainingKcal < 0;
  const pct = Math.min(100, Math.round((v.intake / v.budget.budget) * 100));
  return `<div class="card tight"><div class="row between"><h2 style="margin:0">오늘 먹을 수 있는 양</h2><button class="small" data-action="goto-log">+ 식사 기록</button></div>
    <div class="row between" style="margin-top:4px">
      <div><span class="big num ${over ? 'bad' : ''}">${v.remainingKcal}</span><span class="muted"> kcal 남음</span></div>
      <div class="small muted num" style="text-align:right">예산 ${v.budget.budget}<br>섭취 ${v.intake}</div>
    </div>
    <div class="bar" style="margin-top:6px"><i class="${over ? 'over' : ''}" style="width:${pct}%"></i></div>
    ${v.budget.shortfall > 0 ? `<p class="small warn" style="margin:6px 0 0">식사만으로는 부족 · 운동으로 <b class="num">${v.budget.shortfall}</b> kcal 더 필요</p>` : ''}
  </div>`;
}

function workoutBlock(v) {
  const w = v.workout;
  const rows = w.rows.map(r => `<div class="wk">
    <span class="name ${r.complete ? 'done' : ''}">${r.complete ? '✅ ' : ''}${esc(r.name)} <span class="faint">${r.target}${r.unit} · ${r.kcal}kcal</span></span>
    ${r.slot !== undefined && r.id === 'run5k' ? `<span class="slot"><button class="small ${r.slot === 'am' ? 'primary' : ''}" data-action="wk-slot" data-id="${r.id}" data-slot="am">아침</button><button class="small ${r.slot === 'pm' ? 'primary' : ''}" data-action="wk-slot" data-id="${r.id}" data-slot="pm">밤</button></span>`
      : `<input type="number" inputmode="numeric" min="0" value="${r.count || ''}" placeholder="0" data-action="wk-count" data-id="${r.id}" aria-label="${esc(r.name)} 수행 ${r.unit}">`}
    <button class="small ${r.complete ? 'primary' : ''}" data-action="wk-done" data-id="${r.id}" aria-pressed="${r.complete}">${r.complete ? '완료' : '체크'}</button>
  </div>`).join('');
  return `<div class="card tight"><div class="row between"><h2 style="margin:0">운동 체크리스트 <span class="num">${w.done}/${w.total}</span></h2><span class="small muted num">+${w.kcal} kcal</span></div>${rows}</div>`;
}

function predictionBlock(v) {
  const p = v.prediction;
  if (p.predicted === null) return `<div class="card tight"><h2>30일 뒤 예상</h2><p class="muted small" style="margin:0">기록이 쌓이면 예측이 시작됩니다 (${p.loggedDays}/7일 기록됨)</p></div>`;
  const diff = p.predicted - v.targetWeight;
  return `<div class="card tight"><div class="row between"><h2 style="margin:0">30일 뒤 예상</h2><button class="small" data-action="sim-open">이대로 가면?</button></div>
    <div class="row between"><div><span class="big num ${diff > 0 ? 'warn' : 'good'}">${fmt1(p.predicted)}</span><span class="muted"> kg</span> <span class="small muted">목표보다 <b class="num">${signed(diff)}</b></span></div>
    <span class="faint">${p.loggedDays}/7일 기준</span></div>
    ${diff > 0 ? `<p class="small muted" style="margin:4px 0 0">경로 복귀: 하루 <b class="num">${p.gapKcal}</b> kcal 덜 먹거나 운동 추가</p>` : ''}</div>`;
}

function noticeBlocks(v) {
  let s = '';
  if (v.mode === 'expired') s += `<div class="card tight notice"><b>30일 결과: ${fmt1(v.goal.startWeight)} → ${fmt1(v.trend)}kg (${signed((v.trend ?? v.goal.startWeight) - v.goal.startWeight)})</b><div class="row" style="margin-top:6px"><button class="primary small" data-action="goal-restart">다음 30일 시작</button></div></div>`;
  if (v.mode === 'maintain') s += `<div class="card tight notice"><b>목표 달성 🎯 유지 모드</b> <span class="small muted">추세 ${fmt1(v.trend)}kg ≤ 목표 ${v.targetWeight}kg</span></div>`;
  if (v.judge.status === 'reset') s += `<div class="card tight notice bad"><b>3일째 경로 이탈</b><div class="small muted">연속 단식은 2일까지입니다. 목표 경로를 다시 설정하세요.</div><button class="small" data-action="goal-restart" style="margin-top:6px">경로 재설정</button></div>`;
  if (v.suggestion) {
    const w = v.suggestion.workout;
    s += `<div class="card tight notice"><b>예상보다 덜 빠졌습니다</b><div class="small muted">예산을 지켰는데 체중이 정체 중. <b>${esc(w.name.replace(/\s*\d+분$/, ''))} ${w.target}${w.unit}</b>(약 ${w.kcal}kcal/일)을 추가하면 경로로 복귀합니다.</div>
      <div class="row" style="margin-top:6px"><button class="primary small" data-action="suggest-accept">추가</button><button class="small" data-action="suggest-dismiss">다음에</button></div></div>`;
  }
  for (const n of ui.notices) {
    if (n.type === 'tdee') s += `<div class="card tight notice"><b>소비 kcal 보정</b> <span class="small muted">${n.from} → ${n.to} kcal (지난 7일 실측 기준)</span></div>`;
    if (n.type === 'adherence') s += `<div class="card tight notice"><b>이번 주 예산 준수율 ${n.rate}%</b> <span class="small muted">식사부터 맞추면 운동 제안이 열립니다</span></div>`;
  }
  return s;
}

function renderHome() {
  const v = app.dayView();
  $('#view-home').innerHTML = `
    <div class="card">${weightBlock(v)}${stickerRow(v)}</div>
    ${noticeBlocks(v)}
    ${budgetBlock(v)}
    ${workoutBlock(v)}
    ${predictionBlock(v)}`;
  tickCountdown();
}

// ---------- 기록 ----------
function renderLog() {
  const v = app.dayView(ui.logDate);
  const st = app.state;
  const results = ui.query ? searchFoods(ui.query, { customs: st.customs, favorites: new Set(st.favorites), recent: app.recentFoodIds() }) : [];
  const fav = new Set(st.favorites);
  const quick = !ui.query ? searchFoods('', {}) : [];
  const recentList = !ui.query ? [...app.recentFoodIds()].map(id => app.findFood(id)).filter(Boolean).slice(0, 8) : [];
  const favList = !ui.query ? st.favorites.map(id => app.findFood(id)).filter(Boolean) : [];
  const resultRow = f => `<div class="result" data-action="result-add" data-id="${esc(f.id)}" role="button" tabindex="0">
    <button class="ghost star" data-action="fav-toggle" data-id="${esc(f.id)}" aria-label="즐겨찾기">${fav.has(f.id) ? '★' : '☆'}</button>
    <div><div class="name">${esc(f.name)}</div><div class="sub">${esc(f.serving)}${f.custom ? ' · 직접 입력' : ''}</div></div>
    <div class="kcal num">${f.kcal} <span class="faint">kcal</span></div></div>`;
  const meals = v.meals.map(m => `<div class="meal">
    <div><div class="name">${esc(m.name)}</div><div class="sub"><input type="time" value="${m.time}" data-action="meal-time" data-id="${m.id}" style="width:auto;min-height:28px;padding:0 4px;font-size:12px"> · ${Math.round(m.kcal * m.portion)} kcal</div></div>
    <select data-action="meal-portion" data-id="${m.id}" aria-label="분량">${[0.5, 1, 1.5, 2].map(p => `<option value="${p}" ${p === m.portion ? 'selected' : ''}>${p}인분</option>`).join('')}${[0.5, 1, 1.5, 2].includes(m.portion) ? '' : `<option value="${m.portion}" selected>${m.portion}인분</option>`}<option value="custom">직접…</option></select>
    <button class="small" data-action="meal-del" data-id="${m.id}" aria-label="삭제">🗑</button></div>`).join('');
  const canNext = ui.logDate < app.today();
  $('#view-log').innerHTML = `
    <div class="day-nav"><button class="small" data-action="day-prev">‹</button><b>${kdate(ui.logDate)}</b><button class="small" data-action="day-next" ${canNext ? '' : 'disabled'}>›</button></div>
    <input id="food-q" type="search" placeholder="음식 검색 (초성 가능: ㄱㅊㅉㄱ)" value="${esc(ui.query)}" autocomplete="off" aria-label="음식 검색">
    <div class="card tight">
      ${ui.query ? (results.length ? results.map(resultRow).join('') : `<p class="muted small">검색 결과 없음</p><button class="primary" data-action="custom-open">“${esc(ui.query)}” 직접 입력</button>`)
        : `${favList.length ? `<h2>즐겨찾기</h2>${favList.map(resultRow).join('')}` : ''}${recentList.length ? `<h2>최근 7일</h2>${recentList.map(resultRow).join('')}` : ''}${!favList.length && !recentList.length ? '<p class="muted small" style="margin:4px 0">검색해서 탭 한 번으로 기록합니다. 기본 1인분, 목록에서 분량을 바꿀 수 있어요.</p>' : ''}<button class="small" data-action="custom-open" style="margin-top:6px">직접 입력</button>`}
    </div>
    <div class="card tight"><div class="row between"><h2 style="margin:0">오늘 먹은 것</h2><span class="num"><b>${v.intake}</b> <span class="faint">/ ${v.budget.budget === null ? '치팅' : v.budget.budget} kcal</span></span></div>
      ${meals || '<p class="muted small" style="margin:6px 0 0">아직 기록이 없습니다</p>'}</div>`;
  if (ui.query) { const q = $('#food-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

function customSheet(name = '') {
  openSheet(`<h3>직접 입력</h3>
    <div class="field"><label>이름</label><input id="c-name" type="text" value="${esc(name)}" maxlength="40"></div>
    <div class="field"><label>kcal (1회 분량)</label><input id="c-kcal" type="number" inputmode="numeric" min="1" step="1" placeholder="예: 450"></div>
    <div class="field"><label>분량 표기 (선택)</label><input id="c-serving" type="text" placeholder="예: 1인분, 200g"></div>
    <p class="small bad hidden" id="c-err"></p>
    <div class="row"><button class="primary grow" data-action="custom-save">저장하고 기록</button><button data-action="sheet-close">취소</button></div>`);
  $('#c-kcal').focus();
}

// ---------- 그래프 ----------
function chartsHtml(target) {
  const days = ui.range === 'all' && app.state.goal ? Math.max(30, (new Date(app.today()) - new Date(app.state.goal.startDate)) / 86400000 + 1) : ui.range;
  const g = app.graphData(app.today(), Math.round(days));
  const gs = app.state.goal?.startDate;
  if (gs) for (const r of g.rows) if (r.date < gs) r.budget = null;
  let simPath = null;
  if (ui.sim) simPath = ui.sim.path.map((w, i) => ({ date: addDays(app.today(), i), weight: w }));
  const rangeBtns = [[14, '2주'], [30, '30일'], ['all', '전체']].map(([r, l]) => `<button class="small ${ui.range === r ? 'active' : ''}" data-action="range" data-range="${r}">${l}</button>`).join('');
  return `
    <div class="card"><div class="row between"><h2 style="margin:0">체중</h2><div class="range">${rangeBtns}</div></div>
      <div id="${target}-w">${weightChart({ rows: g.rows, forecast: g.forecast, sim: simPath, targetWeight: g.targetWeight })}</div>
      <div class="viz-tip" id="${target}-tip">${esc(ui.tip || '점을 탭하면 그날 상세가 보입니다')}</div></div>
    <div class="charts">
      <div class="card"><h2>섭취 kcal · 예산</h2>${kcalChart({ rows: g.rows })}</div>
      <div class="card"><h2>운동 완료율</h2>${workoutChart({ rows: g.rows })}</div>
      <div class="card"><h2>예측 정확도</h2>${accuracyChart({ rows: g.rows, meanErr: g.meanErr })}</div>
    </div>`;
}
function renderGraph() { $('#view-graph').innerHTML = chartsHtml('g'); }
function renderSide() { if (window.innerWidth >= 1024) $('#col-side').innerHTML = chartsHtml('s'); }

function showTip(i) {
  const days = ui.range === 'all' && app.state.goal ? Math.max(30, (new Date(app.today()) - new Date(app.state.goal.startDate)) / 86400000 + 1) : ui.range;
  const r = app.graphData(app.today(), Math.round(days)).rows[i];
  if (!r) return;
  ui.tip = `${kdate(r.date)} · 체중 ${fmt1(r.weight)} · 목표 ${fmt1(r.target)} · 섭취 ${r.logged ? r.intake + 'kcal' : '미기록'}${r.budget !== null ? ' / 예산 ' + r.budget : ''} · 운동 ${Math.round(r.workoutRate * 100)}% · ${STATUS_LABEL[r.status]}${r.sticker ? ' ⭐' : ''}`;
  document.querySelectorAll('[id$="-tip"]').forEach(el => { el.textContent = ui.tip; });
}

// ---------- 시뮬레이션 ----------
function simSheet() {
  const v = app.dayView();
  const p = v.prediction;
  const days = app.graphData(app.today(), 7).rows.filter(r => r.logged);
  const avgIntake = days.length ? Math.round(days.reduce((a, r) => a + r.intake, 0) / days.length) : v.budget.budget || CONFIG.defaultTdee;
  const avgRate = Math.round((app.graphData(app.today(), 7).rows.reduce((a, r) => a + r.workoutRate, 0) / 7) * 100);
  ui.sim = { intake: avgIntake, rate: avgRate, base: { intake: avgIntake, rate: avgRate } };
  openSheet(`<h3>이대로 한 달 가면?</h3>
    <div class="row wrap" style="gap:6px"><button class="small" data-action="sim-preset" data-p="now">오늘처럼</button><button class="small" data-action="sim-preset" data-p="binge">폭식+운동 안 함</button><button class="small" data-action="sim-preset" data-p="perfect">완벽 수행</button></div>
    <div class="field"><label>하루 섭취 <b id="sim-intake-v" class="num"></b> kcal</label><input id="sim-intake" type="range" min="${CONFIG.simulation.intakeMin}" max="${CONFIG.simulation.intakeMax}" step="50"></div>
    <div class="field"><label>운동 완료율 <b id="sim-rate-v" class="num"></b>%</label><input id="sim-rate" type="range" min="0" max="100" step="5"></div>
    <div class="row between"><div>30일 뒤 <span class="big num" id="sim-out"></span><span class="muted"> kg</span></div><span class="small muted" id="sim-note"></span></div>
    <div id="sim-chart" style="margin-top:8px"></div>
    <button data-action="sheet-close" style="width:100%;margin-top:10px">닫기</button>`);
  applySim();
}
function applySim() {
  if (!ui.sim) return;
  const v = app.dayView();
  $('#sim-intake').value = ui.sim.intake; $('#sim-rate').value = ui.sim.rate;
  $('#sim-intake-v').textContent = ui.sim.intake; $('#sim-rate-v').textContent = ui.sim.rate;
  const r = simulate({ trend: v.trend ?? v.goal?.startWeight ?? CONFIG.goal.baselineWeight, tdee: app.state.settings.tdee, intake: ui.sim.intake, completionRate: ui.sim.rate / 100, fullWorkoutKcal: v.workout.fullKcal });
  ui.sim.path = r.path;
  const start = r.path[0];
  const up = r.predicted > start;
  $('#sim-out').textContent = fmt1(r.predicted); $('#sim-out').className = `big num ${up ? 'bad' : r.predicted <= v.targetWeight ? 'good' : ''}`;
  $('#sim-note').textContent = up ? `⚠️ 지금보다 ${signed(r.predicted - start)}kg` : `목표보다 ${signed(r.predicted - v.targetWeight)}kg`;
  const g = app.graphData(app.today(), 30);
  $('#sim-chart').innerHTML = weightChart({ rows: g.rows, forecast: g.forecast, sim: r.path.map((w, i) => ({ date: addDays(app.today(), i), weight: w })), targetWeight: g.targetWeight, height: 180 });
}

// ---------- 달력 ----------
function renderCal() {
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  const graph = app.graphData(toDateStr(last), last.getDate() + 7);
  const byDate = Object.fromEntries(graph.rows.map(r => [r.date, r]));
  let cells = DOW.map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="day empty"></div>';
  for (let d = 1; d <= last.getDate(); d++) {
    const ds = toDateStr(new Date(y, m - 1, d));
    const r = byDate[ds] || {};
    const future = ds > app.today();
    const ic = r.cheat || app.state.cheat.scheduled[ds] ? '🎉' : r.status === 'fasting' ? (r.broken ? '⛔' : '⛔') : r.sticker ? '⭐' : '';
    cells += `<button class="day ${ds === app.today() ? 'today' : ''} ${ds === ui.calSel ? 'sel' : ''}" data-action="cal-sel" data-date="${ds}"><span>${d}</span><span class="ic">${ic}</span><span class="w num">${future ? '' : fmt1(r.weight ?? null).replace('—', '')}</span></button>`;
  }
  const sel = ui.calSel;
  const v = sel ? app.dayView(sel) : null;
  const future = sel > app.today();
  const detail = !v ? '' : `<div class="card"><b>${kdate(sel)}</b> ${future ? '' : `<span class="chip ${v.judge.status}">${STATUS_LABEL[v.judge.status]}</span>`}
    ${future ? `<p class="small muted">미래 날짜. 치팅데이를 예약할 수 있습니다.</p>` : `<table class="stats"><tr><td>체중</td><td class="num">${fmt1(v.weight)} kg (목표 ${fmt1(v.target)})</td></tr><tr><td>섭취 / 예산</td><td class="num">${v.intake} / ${v.budget.budget ?? '치팅'} kcal</td></tr><tr><td>운동</td><td class="num">${Math.round(v.workout.rate * 100)}%</td></tr></table>`}
    ${v.editable.weight ? `<div class="row weight-input" style="margin-top:8px"><input id="cal-weight" type="number" inputmode="decimal" step="0.1" placeholder="체중 입력·수정" value="${v.weight ?? ''}"><button class="small primary" data-action="cal-weight-save">저장</button>${v.weight !== null ? '<button class="small" data-action="cal-weight-del">삭제</button>' : ''}</div>` : ''}
    ${(future || sel === app.today()) ? (v.cheat ? `<button class="small" data-action="cal-cheat-cancel" style="margin-top:8px">치팅데이 취소</button>` : `<button class="small" data-action="cal-cheat" style="margin-top:8px" ${v.sticker.vouchers > 0 ? '' : 'disabled'}>🎉 치팅데이 예약 (${v.sticker.vouchers}장)</button>`) : ''}
    ${!future ? `<button class="small" data-action="cal-goto-log" style="margin-top:8px">이날 식사 보기</button>` : ''}</div>`;
  $('#view-cal').innerHTML = `<div class="day-nav"><button class="small" data-action="cal-prev">‹</button><b>${y}년 ${m}월</b><button class="small" data-action="cal-next">›</button></div>
    <div class="cal">${cells}</div><p class="faint" style="margin:6px 2px">⭐ 스티커 · ⛔ 단식 · 🎉 치팅데이</p>${detail}`;
}

// ---------- 설정 ----------
function renderSettings() {
  const s = app.state.settings, g = app.state.goal;
  const st = app.stats();
  const allItems = (s.workoutVersions.filter(v => v.from <= addDays(app.today(), 1)).at(-1) || s.workoutVersions[0]).items;
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  $('#view-settings').innerHTML = `
    <div class="card"><h2>목표</h2>
      <div class="field"><label>목표 체중 (kg)</label><input id="s-target" type="number" inputmode="decimal" step="0.1" value="${g ? g.targetWeight : CONFIG.goal.targetWeight}"></div>
      <div class="field"><label>기간 (일)</label><input id="s-period" type="number" inputmode="numeric" value="${CONFIG.goal.periodDays}"></div>
      <p class="small muted">${g ? `현재: ${g.startDate} ${fmt1(g.startWeight)}kg → ${g.endDate} ${fmt1(g.targetWeight)}kg` : '목표 없음'}</p>
      <button class="small" data-action="goal-save">오늘부터 새 목표 경로 시작</button>
      ${app.state.goalHistory.length ? `<p class="faint">변경 이력 ${app.state.goalHistory.length}건: ${app.state.goalHistory.map(h => `${h.startDate} ${fmt1(h.startWeight)}→${fmt1(h.targetWeight)}`).join(', ')}</p>` : ''}</div>
    <div class="card"><h2>소비 kcal (TDEE)</h2>
      <div class="field"><label>현재 TDEE</label><input id="s-tdee" type="number" inputmode="numeric" value="${s.tdee}"></div>
      <div class="row wrap" style="gap:6px"><div class="field grow"><label>성별</label><select id="s-sex"><option value="">—</option><option value="male" ${s.profile.sex === 'male' ? 'selected' : ''}>남</option><option value="female" ${s.profile.sex === 'female' ? 'selected' : ''}>여</option></select></div>
        <div class="field grow"><label>키 cm</label><input id="s-height" type="number" inputmode="numeric" value="${s.profile.height ?? ''}"></div><div class="field grow"><label>나이</label><input id="s-age" type="number" inputmode="numeric" value="${s.profile.age ?? ''}"></div></div>
      <button class="small" data-action="tdee-estimate">프로필로 다시 추정</button>
      ${s.tdeeHistory.length ? `<p class="faint">이력: ${s.tdeeHistory.slice(-5).map(h => `${h.date} ${h.from}→${h.to}(${h.reason === 'auto' ? '자동' : '수동'})`).join(' · ')}</p>` : '<p class="faint">7일마다 실측 체중으로 자동 보정됩니다 (±150kcal)</p>'}</div>
    <div class="card"><h2>판정 기준</h2>
      <div class="row wrap" style="gap:6px">
        <div class="field grow"><label>안전 하한 kcal</label><input id="s-floor" type="number" inputmode="numeric" value="${s.floor}"></div>
        <div class="field grow"><label>단식 창 시작</label><input id="s-fwin" type="time" value="${s.fastingWindowStart}"></div></div>
      <p class="faint">스티커 허용 오차 ${s.stickerTolerance}kg · 단식 기준 +${s.fastingThreshold}kg · 단식일 ${CONFIG.budget.fastingDay}kcal</p></div>
    <div class="card"><h2>운동 체크리스트 (내일부터 적용)</h2>
      ${allItems.map(w => `<div class="row" style="margin:4px 0"><span class="grow">${esc(w.name)} <span class="faint">${w.days === 'weekend' ? '주말' : w.days === 'weekday' ? '평일' : '매일'} · ${w.kcal}kcal</span></span><input type="number" inputmode="numeric" style="width:90px" data-wk-target="${w.id}" value="${w.target}" aria-label="${esc(w.name)} 목표"><span class="faint">${w.unit}</span>${CONFIG.workouts.some(c => c.id === w.id) ? '' : `<button class="small" data-action="wk-remove" data-id="${w.id}">삭제</button>`}</div>`).join('')}
      <button class="small" data-action="wk-save" style="margin-top:6px">저장</button></div>
    <div class="card"><h2>알림</h2>
      ${perm === 'unsupported' ? '<p class="small muted">이 브라우저는 알림을 지원하지 않습니다. 앱은 알림 없이 모두 동작합니다.</p>' : perm === 'denied' ? '<p class="small warn">알림 꺼짐 · 기기 설정에서 이 사이트의 알림을 허용하세요.</p>' : perm === 'default' ? '<button class="small" data-action="notify-enable">알림 켜기</button>' : '<p class="small good">알림 허용됨 (앱이 열려 있을 때 울립니다)</p>'}
      <div class="row wrap" style="gap:6px;margin-top:6px"><label class="row small"><input type="checkbox" id="s-rem-w" ${s.reminders.weight.on ? 'checked' : ''}> 아침 체중</label><input type="time" id="s-rem-w-at" style="width:auto" value="${s.reminders.weight.at}">
        <label class="row small"><input type="checkbox" id="s-rem-k" ${s.reminders.workout.on ? 'checked' : ''}> 저녁 운동</label><input type="time" id="s-rem-k-at" style="width:auto" value="${s.reminders.workout.at}"></div>
      <button class="small" data-action="rem-save" style="margin-top:6px">저장</button></div>
    <div class="card"><h2>백업</h2>
      <div class="row wrap" style="gap:6px"><button class="small" data-action="export">내보내기 (JSON)</button><label class="small" style="display:inline-flex"><input type="file" id="import-file" accept="application/json,.json" class="hidden"><button class="small" data-action="import-pick">가져오기</button></label></div>
      <p class="faint">모든 데이터는 <b>이 주소(${esc(location.host)})를 연 이 브라우저</b>에만 저장됩니다. 다른 브라우저·메신저 안의 브라우저·홈 화면 앱은 각각 별도 저장소라 서로 보이지 않습니다. 한 가지 방법(홈 화면 앱 권장)으로만 열고, 주 1회 백업을 권합니다.${ui.persisted === false ? ' <span class="warn">브라우저가 용량 부족 시 이 데이터를 지울 수 있습니다. 홈 화면에 추가하면 보호됩니다.</span>' : ''}</p></div>
    ${st ? `<div class="card"><h2>통계 (목표 시작 후 ${st.days}일)</h2><table class="stats">
      <tr><td>체중 기록률</td><td>${Math.round(st.weightRate * 100)}%</td></tr><tr><td>식사 기록률</td><td>${Math.round(st.mealRate * 100)}%</td></tr>
      <tr><td>예산 준수율</td><td>${Math.round(st.budgetRate * 100)}%</td></tr><tr><td>운동 완료율</td><td>${Math.round(st.workoutRate * 100)}%</td></tr>
      <tr><td>체중</td><td>${fmt1(st.startWeight)} → ${fmt1(st.trend)} kg</td></tr><tr><td>스티커 누적</td><td>${st.stickers}</td></tr>
      <tr><td>예측 오차</td><td>${st.meanErr === null ? '—' : st.meanErr + ' kg'}</td></tr><tr><td>하한 위반</td><td>${st.floorViolations}건</td></tr></table></div>` : ''}
    <div class="card"><button class="small danger" data-action="reset">모든 데이터 삭제</button><p class="faint">이 앱은 의학적 조언이 아닙니다. 예산은 안전 하한 아래로 내려가지 않습니다.</p></div>`;
}

// ---------- 온보딩 ----------
function onboarding() {
  openSheet(`<h3>시작하기</h3>
    <div class="ob-step active" data-step="1"><div class="field"><label>1/3 · 지금 체중 (kg)</label><input id="ob-base" type="number" inputmode="decimal" step="0.1" value="${CONFIG.goal.baselineWeight}"></div><button class="primary" style="width:100%" data-action="ob-next" data-step="2">다음</button></div>
    <div class="ob-step" data-step="2"><div class="field"><label>2/3 · 목표 체중 (kg) — 기한은 오늘 + ${CONFIG.goal.periodDays}일</label><input id="ob-target" type="number" inputmode="decimal" step="0.1" value="${CONFIG.goal.targetWeight}"></div><button class="primary" style="width:100%" data-action="ob-next" data-step="3">다음</button></div>
    <div class="ob-step" data-step="3"><p class="small muted">3/3 · 소비 kcal 추정용 (건너뛰면 ${CONFIG.defaultTdee}kcal에서 시작해 자동 보정)</p>
      <div class="row wrap" style="gap:6px"><div class="field grow"><label>성별</label><select id="ob-sex"><option value="">—</option><option value="male">남</option><option value="female">여</option></select></div><div class="field grow"><label>키 cm</label><input id="ob-height" type="number" inputmode="numeric"></div><div class="field grow"><label>나이</label><input id="ob-age" type="number" inputmode="numeric"></div></div>
      <div class="row"><button class="primary grow" data-action="ob-done">시작</button><button data-action="ob-done" data-skip="1">건너뛰기</button></div></div>
    <p class="faint" style="margin-top:10px">이 앱은 의학적 조언이 아닙니다. 데이터는 이 기기에만 저장됩니다.</p>`);
}

// ---------- 이벤트 ----------
function saveWeight(date, inputSel, after) {
  const kg = parseFloat($(inputSel)?.value);
  let r = app.setWeight(date, kg);
  if (!r.ok && r.reason === 'confirm') {
    if (!confirm(`직전 기록과 ${CONFIG.weight.confirmDelta}kg 이상 차이 납니다. ${kg}kg로 저장할까요?`)) return;
    r = app.setWeight(date, kg, { confirmed: true });
  }
  if (!r.ok) { toast(r.reason === 'range' ? `${CONFIG.weight.min}~${CONFIG.weight.max}kg 사이로 입력하세요` : r.reason === 'not-editable' ? '7일 이내 날짜만 수정할 수 있습니다' : '숫자를 입력하세요'); return; }
  const v = app.dayView(date);
  if (v.judge.sticker && date === app.today()) { ui.lastSticker = date; toast('⭐ 칭찬 스티커 획득!'); }
  else if (v.judge.status === 'fasting') toast('목표보다 1kg 이상 높습니다. 오늘은 23시간 단식.');
  if (after) after();
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (!t) { if (e.target.id === 'sheet-backdrop') closeSheet(); return; }
  const a = t.dataset.action, id = t.dataset.id, today = app.today();
  const tipHit = e.target.closest('.viz-hit, .viz-bar');
  if (tipHit) { showTip(Number(tipHit.dataset.i)); return; }
  switch (a) {
    case 'toast-action': $('#toast')._onAction?.(); $('#toast').classList.remove('show'); break;
    case 'sheet-close': closeSheet(); render(); break;
    case 'weight-save': saveWeight(today, '#weight-in', () => { ui.weightDraft = ''; render(); }); break;
    case 'weight-edit': ui.weightDraft = 'edit'; render(); $('#weight-in')?.focus(); break;
    case 'weight-cancel': ui.weightDraft = ''; render(); break;
    case 'goto-log': ui.tab = 'log'; ui.logDate = today; ui.query = ''; render(); $('#food-q')?.focus(); break;
    case 'wk-done': { const v = app.dayView(today); const row = v.workout.rows.find(r => r.id === id); app.setWorkout(today, id, { done: !row.complete, count: row.complete ? 0 : row.target }); render(); break; }
    case 'wk-slot': app.setWorkout(today, id, { done: true, slot: t.dataset.slot }); render(); break;
    case 'cheat-use': { const r = app.useCheat(today); toast(r.ok ? '오늘은 치팅데이 🎉 예산·단식 판정 없음' : '치팅권이 없습니다'); render(); break; }
    case 'cheat-cancel': { const r = app.cancelCheat(today); toast(r.ok ? '치팅데이를 취소했습니다' : '첫 식사 기록 후에는 취소할 수 없습니다'); render(); break; }
    case 'sim-open': simSheet(); break;
    case 'sim-preset': { const v = app.dayView(); const p = t.dataset.p; if (p === 'now') ui.sim = { ...ui.sim, ...ui.sim.base }; if (p === 'binge') ui.sim = { ...ui.sim, intake: Math.min(CONFIG.simulation.intakeMax, ui.sim.base.intake + CONFIG.simulation.bingeExtra), rate: 0 }; if (p === 'perfect') ui.sim = { ...ui.sim, intake: v.budget.budget ?? v.budget.raw ?? 1400, rate: 100 }; applySim(); break; }
    case 'suggest-accept': app.acceptSuggestion(); toast('내일부터 체크리스트에 추가됩니다'); render(); break;
    case 'suggest-dismiss': app.dismissSuggestion(); render(); break;
    case 'goal-restart': app.restartGoal(); toast('새 30일 목표 경로를 시작했습니다'); render(); break;
    // 기록
    case 'day-prev': ui.logDate = addDays(ui.logDate, -1); ui.query = ''; render(); break;
    case 'day-next': ui.logDate = addDays(ui.logDate, 1); ui.query = ''; render(); break;
    case 'fav-toggle': e.stopPropagation(); app.toggleFavorite(id); render(); break;
    case 'result-add': { const f = app.findFood(id); if (!f) break; const r = app.addMeal(ui.logDate, { foodId: f.id, name: f.name, kcal: f.kcal, serving: f.serving, portion: 1, time: ui.logDate === today ? app.nowTime() : '12:00' });
      if (!r.ok) { toast(r.reason === 'limit' ? '하루 50건까지 기록할 수 있습니다' : '7일 이내 날짜만 기록할 수 있습니다'); break; }
      ui.query = ''; toast(`${f.name} ${f.kcal}kcal 기록`); render(); break; }
    case 'custom-open': customSheet(ui.query); break;
    case 'custom-save': { const name = $('#c-name').value.trim(), kcal = parseInt($('#c-kcal').value, 10), serving = $('#c-serving').value.trim() || '1회';
      if (!name || !(kcal > 0)) { const er = $('#c-err'); er.textContent = !name ? '이름을 입력하세요' : 'kcal는 1 이상의 정수여야 합니다'; er.classList.remove('hidden'); break; }
      const r = app.addCustomFood({ name, kcal, serving }); if (!r.ok) break;
      app.addMeal(ui.logDate, { foodId: r.food.id, name, kcal, serving, portion: 1, time: ui.logDate === today ? app.nowTime() : '12:00' });
      ui.query = ''; closeSheet(); toast(`${name} ${kcal}kcal 기록`); render(); break; }
    case 'meal-del': { const r = app.removeMeal(ui.logDate, id); if (r.ok) { render(); toast('삭제됨', { action: '되돌리기', onAction: () => { r.restore(); render(); } }); } break; }
    // 그래프
    case 'range': ui.range = t.dataset.range === 'all' ? 'all' : Number(t.dataset.range); ui.tip = ''; render(); break;
    // 달력
    case 'cal-prev': case 'cal-next': { const [y, m] = ui.calMonth.split('-').map(Number); const d = new Date(y, m - 1 + (a === 'cal-next' ? 1 : -1), 1); ui.calMonth = toDateStr(d).slice(0, 7); render(); break; }
    case 'cal-sel': ui.calSel = t.dataset.date; render(); break;
    case 'cal-weight-save': saveWeight(ui.calSel, '#cal-weight', render); break;
    case 'cal-weight-del': app.deleteWeight(ui.calSel); render(); break;
    case 'cal-cheat': { const r = app.useCheat(ui.calSel); toast(r.ok ? '치팅데이 예약 완료 🎉' : '치팅권이 없습니다'); render(); break; }
    case 'cal-cheat-cancel': { const r = app.cancelCheat(ui.calSel); toast(r.ok ? '예약을 취소했습니다' : '이미 사용된 치팅데이입니다'); render(); break; }
    case 'cal-goto-log': ui.tab = 'log'; ui.logDate = ui.calSel; ui.query = ''; render(); break;
    // 설정
    case 'goal-save': { const tw = parseFloat($('#s-target').value), pd = parseInt($('#s-period').value, 10); if (!(tw > 0) || !(pd > 0)) { toast('값을 확인하세요'); break; } app.setGoal({ targetWeight: tw, periodDays: pd }); toast('새 목표 경로를 시작했습니다'); render(); break; }
    case 'tdee-estimate': { const profile = { sex: $('#s-sex').value || null, height: parseFloat($('#s-height').value) || null, age: parseInt($('#s-age').value, 10) || null }; app.setSettings({ profile }); const v = app.dayView(); app.setSettings({ tdee: estimateTdee({ ...profile, weight: v.trend ?? CONFIG.goal.baselineWeight }) }); render(); break; }
    case 'wk-save': { const inputs = [...document.querySelectorAll('[data-wk-target]')]; const cur = (app.state.settings.workoutVersions.filter(v => v.from <= addDays(today, 1)).at(-1) || app.state.settings.workoutVersions[0]).items; const items = cur.map(w => { const i = inputs.find(x => x.dataset.wkTarget === w.id); return { ...w, target: Math.max(0, parseInt(i?.value, 10) || 0) }; }); app.updateWorkoutItems(items); toast('내일부터 적용됩니다'); render(); break; }
    case 'wk-remove': { const cur = (app.state.settings.workoutVersions.filter(v => v.from <= addDays(today, 1)).at(-1) || app.state.settings.workoutVersions[0]).items; app.updateWorkoutItems(cur.filter(w => w.id !== id)); render(); break; }
    case 'notify-enable': Notification.requestPermission().then(() => render()); break;
    case 'rem-save': app.setSettings({ reminders: { weight: { on: $('#s-rem-w').checked, at: $('#s-rem-w-at').value || CONFIG.reminders.weightAt }, workout: { on: $('#s-rem-k').checked, at: $('#s-rem-k-at').value || CONFIG.reminders.workoutAt } } }); toast('알림 설정 저장'); break;
    case 'export': { const blob = new Blob([app.exportJson()], { type: 'application/json' }); const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = `diet-backup-${today}.json`; a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 1000); break; }
    case 'import-pick': $('#import-file').click(); break;
    case 'reset': if (confirm('모든 데이터를 삭제할까요? 먼저 내보내기를 권합니다.') && confirm('정말 삭제합니다. 되돌릴 수 없습니다.')) { app.reset(); location.reload(); } break;
    // 온보딩
    case 'ob-next': { const step = t.dataset.step; if (step === '2') { const b = parseFloat($('#ob-base').value); if (!(b >= CONFIG.weight.min && b <= CONFIG.weight.max)) { toast('체중을 확인하세요'); break; } } document.querySelectorAll('.ob-step').forEach(s => s.classList.toggle('active', s.dataset.step === step)); break; }
    case 'ob-done': { const baseline = parseFloat($('#ob-base').value), targetWeight = parseFloat($('#ob-target').value); if (!(targetWeight > 0)) { toast('목표 체중을 확인하세요'); break; }
      const profile = t.dataset.skip ? {} : { sex: $('#ob-sex').value || null, height: parseFloat($('#ob-height').value) || null, age: parseInt($('#ob-age').value, 10) || null };
      app.completeOnboarding({ baseline, targetWeight, profile }); closeSheet(); ui.notices = app.runMaintenance(); render(); break; }
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'weight-in') $('[data-action="weight-save"]')?.click(); if (e.key === 'Enter' && e.target.id === 'cal-weight') $('[data-action="cal-weight-save"]')?.click(); if (e.key === 'Enter' && e.target.closest('.result')) e.target.closest('.result').click(); });
document.addEventListener('input', e => {
  if (e.target.id === 'food-q') { ui.query = e.target.value; renderLog(); }
  if (e.target.id === 'sim-intake') { ui.sim.intake = Number(e.target.value); applySim(); }
  if (e.target.id === 'sim-rate') { ui.sim.rate = Number(e.target.value); applySim(); }
});
document.addEventListener('change', e => {
  const t = e.target, a = t.dataset.action, today = app.today();
  if (a === 'wk-count') { app.setWorkout(today, t.dataset.id, { count: Math.max(0, parseInt(t.value, 10) || 0), done: false }); render(); }
  if (a === 'fasting-window') { app.setFastingWindow(today, t.value); render(); }
  if (a === 'meal-portion') { let p = t.value === 'custom' ? parseFloat(prompt('분량 (예: 0.7)', '1')) : parseFloat(t.value); if (!(p > 0)) { render(); return; } p = Math.round(p * 10) / 10; app.updateMeal(ui.logDate, t.dataset.id, { portion: p }); render(); }
  if (a === 'meal-time') { app.updateMeal(ui.logDate, t.dataset.id, { time: t.value }); render(); }
  if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then(text => {
      const r = app.parseImport(text);
      if (!r.ok) { toast(r.reason === 'parse' ? '파일을 읽을 수 없습니다 (JSON 아님)' : '이 앱의 백업 파일이 아닙니다'); return; }
      const s = r.summary;
      const mode = confirm(`체중 ${s.weights}건, 식사 ${s.meals}건, 운동 ${s.workouts}일, 사용자 음식 ${s.customs}건.\n확인 = 기존 데이터 덮어쓰기, 취소 = 병합`) ? 'replace' : 'merge';
      const res = app.importJson(text, mode); toast(res.ok ? `가져오기 완료 (${mode === 'replace' ? '덮어쓰기' : '병합'})` : '가져오기 실패'); render();
    });
    t.value = '';
  }
  if (t.id === 's-tdee') { const v = parseInt(t.value, 10); if (v > 0) app.setSettings({ tdee: v }); }
  if (t.id === 's-floor') { const v = parseInt(t.value, 10); if (v > 0) { app.setSettings({ floor: v }); render(); } }
  if (t.id === 's-fwin') app.setSettings({ fastingWindowStart: t.value });
});
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { ui.tab = b.dataset.tab; ui.tip = ''; history.replaceState(null, '', `#${ui.tab}`); render(); }));

// ---------- 단식 카운트다운 ----------
function tickCountdown() {
  const el = $('#fast-countdown'); if (!el) return;
  const v = app.dayView(); if (!v.fasting) return;
  const now = new Date(); const [h, m] = v.fasting.start.split(':').map(Number);
  const start = new Date(now); start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + CONFIG.fasting.windowHours * 3600000);
  const f = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`; };
  el.textContent = now < start ? `식사 창까지 ${f(start - now)}` : now < end ? `식사 창 종료까지 ${f(end - now)}` : '오늘 식사 창이 끝났습니다';
}
setInterval(tickCountdown, 30000);

// ---------- 알림 (R-12): 앱이 열려 있을 때 시각이 되면 1회 ----------
const fired = new Set();
function checkReminders() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const s = app.state.settings.reminders, v = app.dayView(), t = app.nowTime(), key = app.today();
  const fire = (kind, title, body, tab) => {
    if (fired.has(`${key}-${kind}`)) return;
    fired.add(`${key}-${kind}`);
    const n = new Notification(title, { body, icon: './public/icon-192.png' });
    n.onclick = () => { window.focus(); ui.tab = tab; render(); };
  };
  if (s.weight.on && t === s.weight.at && v.weight === null) fire('w', '아침 체중을 등록하세요', `오늘 목표 ${fmt1(v.target)}kg`, 'home');
  if (s.workout.on && t === s.workout.at && v.workout.rate < 1) fire('k', '운동 체크리스트', `${v.workout.done}/${v.workout.total} 완료`, 'home');
}
setInterval(checkReminders, 30000);

// ---------- 날짜 변경·창 크기 ----------
let lastDay = app.today();
setInterval(() => { if (app.today() !== lastDay) { lastDay = app.today(); ui.logDate = lastDay; ui.notices = app.runMaintenance(); render(); } }, 60000);
window.addEventListener('resize', renderSide);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { ui.notices = app.runMaintenance(); render(); } });

// ---------- 시작 ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
// 브라우저가 저장 공간 부족 시 이 사이트 데이터를 지우지 않도록 요청 (지원 브라우저만; 거부돼도 앱은 그대로 동작)
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(ok => { ui.persisted = ok; }).catch(() => {});
if (!app.state.onboarded) onboarding(); else ui.notices = app.runMaintenance();
render();
