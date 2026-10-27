// 순수 계산. DOM·저장소 의존 없음. 날짜는 'YYYY-MM-DD' 문자열(기기 로컬 날짜).
import { CONFIG } from './config.js';

// ---------- 날짜 ----------
export function toDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
export function daysBetween(a, b) {
  // b - a (일). 서머타임 경계를 무시하기 위해 정오 기준으로 계산
  const da = parseDate(a), db = parseDate(b);
  return Math.round((db.setHours(12) - da.setHours(12)) / 86400000);
}
export function isWeekend(s) {
  const d = parseDate(s).getDay();
  return d === 0 || d === 6;
}
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------- 목표 경로 (R-3) ----------
// goal = { startDate, startWeight, targetWeight, endDate }
export function makeGoal(startDate, startWeight, targetWeight = CONFIG.goal.targetWeight, periodDays = CONFIG.goal.periodDays) {
  return { startDate, startWeight, targetWeight, endDate: addDays(startDate, periodDays) };
}

export function targetWeightOn(goal, date) {
  if (!goal) return null;
  if (goal.startWeight <= goal.targetWeight) return goal.targetWeight; // 유지 모드
  const total = daysBetween(goal.startDate, goal.endDate);
  const elapsed = daysBetween(goal.startDate, date);
  if (elapsed <= 0) return goal.startWeight;
  if (elapsed >= total) return goal.targetWeight;
  return round1(goal.startWeight - (goal.startWeight - goal.targetWeight) * (elapsed / total));
}

export function daysRemaining(goal, date) {
  return Math.max(0, daysBetween(date, goal.endDate));
}

export function round1(x) { return Math.round(x * 10) / 10; }

// ---------- 추세 체중 (R-2) ----------
// weights: { 'YYYY-MM-DD': kg }. date 포함 최근 trendDays일의 평균. 기록 없으면 null.
export function trendWeight(weights, date, trendDays = CONFIG.weight.trendDays) {
  const vals = [];
  for (let i = 0; i < trendDays; i++) {
    const w = weights[addDays(date, -i)];
    if (typeof w === 'number') vals.push(w);
  }
  if (vals.length === 0) return null;
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function lastWeightBefore(weights, date, maxBack = 30) {
  for (let i = 1; i <= maxBack; i++) {
    const w = weights[addDays(date, -i)];
    if (typeof w === 'number') return w;
  }
  return null;
}

// ---------- 체중 검증 (R-2) ----------
export function validateWeight(kg, prev) {
  if (typeof kg !== 'number' || Number.isNaN(kg)) return { ok: false, reason: 'invalid' };
  if (kg < CONFIG.weight.min || kg > CONFIG.weight.max) return { ok: false, reason: 'range' };
  if (typeof prev === 'number' && Math.abs(kg - prev) > CONFIG.weight.confirmDelta) return { ok: true, confirm: 'delta' };
  return { ok: true };
}

// ---------- 하루 판정 (R-9, R-10) ----------
// 입력: 오늘 체중(없으면 null), 어제 체중, 오늘 목표, 치팅데이 여부(오늘·어제), 직전 연속 단식일 수
// 출력: { status: 'missing'|'cheat'|'fasting'|'pass'|'fail'|'reset', sticker }
export function judgeDay({ weight, prevWeight, target, cheat = false, prevCheat = false, consecutiveFasting = 0 }) {
  const J = CONFIG.judge;
  if (typeof weight !== 'number' || typeof target !== 'number') return { status: 'missing', sticker: false };
  const stickerByWeight = weight <= target + J.stickerTolerance || (typeof prevWeight === 'number' && weight < prevWeight);
  if (cheat) return { status: 'cheat', sticker: stickerByWeight };
  const overFasting = weight >= target + J.fastingThreshold;
  if (overFasting && !prevCheat) {
    if (consecutiveFasting >= J.maxConsecutiveFasting) return { status: 'reset', sticker: false };
    return { status: 'fasting', sticker: false };
  }
  return { status: stickerByWeight ? 'pass' : 'fail', sticker: stickerByWeight };
}

// ---------- 예산 (R-4) ----------
export function requiredDeficit(trend, targetWeight, remaining) {
  if (trend === null || trend <= targetWeight) return 0;
  return Math.round(((trend - targetWeight) * CONFIG.kcalPerKg) / Math.max(1, remaining));
}

export function dailyBudget({ tdee, trend, targetWeight, remaining, workoutKcal = 0, status = 'pass', floor = CONFIG.budget.floor }) {
  if (status === 'cheat') return { budget: null, deficit: 0, shortfall: 0, raw: null };
  if (status === 'fasting') return { budget: CONFIG.budget.fastingDay, deficit: 0, shortfall: 0, raw: CONFIG.budget.fastingDay };
  const deficit = requiredDeficit(trend, targetWeight, remaining);
  const raw = Math.round(tdee + workoutKcal - deficit);
  const budget = Math.max(raw, floor);
  const shortfall = Math.max(0, floor - raw);
  return { budget, deficit, shortfall, raw };
}

// ---------- 운동 kcal (R-5) ----------
export function workoutItemsFor(date, items = CONFIG.workouts) {
  const weekend = isWeekend(date);
  return items.filter(w => w.days === 'all' || (w.days === 'weekend' && weekend) || (w.days === 'weekday' && !weekend));
}
export function scaleKcal(kcal, weight) {
  if (typeof weight !== 'number') return kcal;
  return Math.round(kcal * (weight / CONFIG.workoutRefWeight));
}
// log: { [id]: { count, done, slot } }
export function workoutSummary(date, log = {}, items = CONFIG.workouts, weight = null) {
  const todays = workoutItemsFor(date, items);
  let kcal = 0, done = 0;
  const rows = todays.map(w => {
    const entry = log[w.id] || {};
    const count = entry.done ? w.target : Math.max(0, Number(entry.count) || 0);
    const ratio = Math.min(1, w.target > 0 ? count / w.target : 0);
    const itemKcal = Math.round(scaleKcal(w.kcal, weight) * ratio);
    kcal += itemKcal;
    if (ratio >= 1) done += 1;
    return { ...w, count, ratio, kcal: itemKcal, complete: ratio >= 1, slot: entry.slot || null };
  });
  const fullKcal = todays.reduce((a, w) => a + scaleKcal(w.kcal, weight), 0);
  return { rows, kcal, fullKcal, done, total: todays.length, rate: todays.length ? done / todays.length : 0 };
}

// ---------- 예측 (R-6) ----------
// days: [{ intake, workoutKcal, logged }] 최근 7일. logged=false인 날은 제외.
export function avgNetDeficit(tdee, days) {
  const used = days.filter(d => d.logged);
  if (used.length === 0) return { avg: null, n: 0 };
  const sum = used.reduce((a, d) => a + (tdee + d.workoutKcal - d.intake), 0);
  return { avg: sum / used.length, n: used.length };
}
export function predictWeight(trend, avgDeficit, days = CONFIG.goal.periodDays) {
  if (trend === null || avgDeficit === null) return null;
  return round1(trend - (avgDeficit * days) / CONFIG.kcalPerKg);
}
export function predictPath(trend, avgDeficit, days = CONFIG.goal.periodDays) {
  if (trend === null || avgDeficit === null) return [];
  return Array.from({ length: days + 1 }, (_, i) => round1(trend - (avgDeficit * i) / CONFIG.kcalPerKg));
}
// 경로 복귀에 필요한 하루 추가 적자
export function gapToTarget(predicted, targetWeight, days = CONFIG.goal.periodDays) {
  if (predicted === null) return 0;
  return Math.max(0, Math.round(((predicted - targetWeight) * CONFIG.kcalPerKg) / days));
}

// ---------- 시뮬레이션 (R-7) ----------
export function simulate({ trend, tdee, intake, completionRate, fullWorkoutKcal }) {
  const deficit = tdee + fullWorkoutKcal * completionRate - intake;
  return { predicted: predictWeight(trend, deficit), path: predictPath(trend, deficit), deficit };
}

// ---------- TDEE 보정 (R-4) ----------
// 지난 N일: 추세 시작·끝, 평균 섭취, 평균 운동 kcal → 실제 소비 역산, 1회 ±maxStep 제한
export function calibrateTdee({ tdee, trendStart, trendEnd, days, avgIntake, avgWorkout }) {
  if (trendStart === null || trendEnd === null || !days) return { tdee, changed: false };
  const observedDeficit = ((trendStart - trendEnd) * CONFIG.kcalPerKg) / days;
  const actual = observedDeficit + avgIntake - avgWorkout;
  const step = Math.max(-CONFIG.tdeeCalibration.maxStep, Math.min(CONFIG.tdeeCalibration.maxStep, actual - tdee));
  const next = Math.round(tdee + step);
  return { tdee: next, changed: next !== tdee, actual: Math.round(actual) };
}

// ---------- 정체 판정 (R-8) ----------
export function plateauCheck({ adherenceDays, trendDrop, expectedDrop }) {
  const P = CONFIG.plateau;
  if (adherenceDays < P.minAdherenceDays) return { plateau: false, reason: 'adherence' };
  if (expectedDrop <= 0) return { plateau: false, reason: 'no-goal' };
  if (trendDrop >= expectedDrop * P.dropRatio) return { plateau: false, reason: 'on-track' };
  const missingKg = expectedDrop - Math.max(0, trendDrop);
  const kcalPerDay = Math.round((missingKg * CONFIG.kcalPerKg) / 7);
  const s = CONFIG.suggestedWorkout;
  const sessions = Math.min(s.maxSessions, Math.max(1, Math.ceil(kcalPerDay / s.kcal))); // 제안 상한: 하루 60분 [가정]
  return { plateau: true, kcalPerDay, suggestion: { ...s, target: s.target * sessions, kcal: s.kcal * sessions } };
}

// ---------- TDEE 초기 추정 (부록 A) ----------
export function estimateTdee({ sex, weight, height, age }) {
  if (!sex || !weight || !height || !age) return CONFIG.defaultTdee;
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161);
  return Math.round(bmr * CONFIG.activityFactor);
}

// ---------- 단식 창 (R-10) ----------
export function fastingWindow(startHHMM = CONFIG.fasting.defaultWindowStart) {
  const [h, m] = startHHMM.split(':').map(Number);
  const endH = (h + CONFIG.fasting.windowHours) % 24;
  const pad = n => String(n).padStart(2, '0');
  return { start: `${pad(h)}:${pad(m)}`, end: `${pad(endH)}:${pad(m)}` };
}
export function inFastingWindow(timeHHMM, startHHMM) {
  const w = fastingWindow(startHHMM);
  return timeHHMM >= w.start && timeHHMM < w.end;
}
