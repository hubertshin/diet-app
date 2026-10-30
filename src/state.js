// 앱 상태와 파생값. 저장 형식(스키마 v1)과 모든 변경(mutation)이 여기 모인다. UI는 dayView()/graphData()만 읽는다.
import { CONFIG } from './config.js';
import * as C from './calc.js';
import { findFood } from './foods.js';
import { findExercise, exerciseKcal } from './exercises.js';

export function emptyState() {
  return {
    version: CONFIG.schemaVersion,
    updatedAt: 0,
    onboarded: false,
    settings: {
      tdee: CONFIG.defaultTdee,
      tdeeHistory: [],
      profile: { sex: null, height: null, age: null },
      floor: CONFIG.budget.floor,
      fastingThreshold: CONFIG.judge.fastingThreshold,
      stickerTolerance: CONFIG.judge.stickerTolerance,
      fastingWindowStart: CONFIG.fasting.defaultWindowStart,
      workoutVersions: [{ from: '0000-01-01', items: CONFIG.workouts.map(w => ({ ...w })) }],
      reminders: { weight: { on: true, at: CONFIG.reminders.weightAt }, workout: { on: true, at: CONFIG.reminders.workoutAt } },
      lastCalibration: null,
      lastPlateauPrompt: null,
    },
    goal: null,
    goalHistory: [],
    weights: {},
    meals: {},
    workouts: {},
    exercises: {},       // date -> [{ id, exerciseId, name, unit, amount, kcalPerUnit, kcal, time }] 자유 운동 기록 (R-16)
    customExercises: [], // 사용자 직접 입력 운동 종류
    exerciseFavorites: [],
    fastingWindow: {},   // date -> 'HH:MM' (단식일 창 시작)
    customs: [],
    favorites: [],
    cheat: { scheduled: {}, vouchersIssued: 0, vouchersUsed: 0 },
    snapshots: {},
    pendingSuggestion: null,
  };
}

let seq = 0;
function uid() { return `${Date.now().toString(36)}-${(seq++).toString(36)}`; }

export function createApp({ storage, now = () => new Date(), onEvent = () => {} } = {}) {
  let state = (storage && storage.load()) || emptyState();
  state = migrate(state);
  const events = [];
  const changeListeners = [];

  function emit(name, data = {}) {
    const ev = { name, at: now().toISOString(), ...data };
    events.push(ev);
    onEvent(ev);
  }
  // touch=false 는 동기화로 받은 데이터 적용 등 "사용자 변경이 아닌" 저장 — updatedAt 을 올리지 않고 변경 리스너도 부르지 않는다
  function persist({ touch = true } = {}) {
    if (touch) state.updatedAt = now().getTime();
    const ok = storage ? storage.save(state) : true;
    if (!ok) emit('save_failed');
    if (touch) for (const fn of changeListeners) fn(state);
    return ok;
  }
  function onChange(fn) { changeListeners.push(fn); return () => { const i = changeListeners.indexOf(fn); if (i >= 0) changeListeners.splice(i, 1); }; }
  function today() { return C.toDateStr(now()); }
  function nowTime() { const d = now(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  function editable(date, days) {
    const diff = C.daysBetween(date, today());
    return diff >= 0 && diff <= days;
  }

  // ---------- 운동 항목 버전 (변경은 내일부터) ----------
  function workoutItemsOn(date) {
    const versions = state.settings.workoutVersions.filter(v => v.from <= date);
    const v = versions[versions.length - 1] || state.settings.workoutVersions[0];
    return C.workoutItemsFor(date, v.items);
  }
  function allItemsOn(date) {
    const versions = state.settings.workoutVersions.filter(v => v.from <= date);
    return (versions[versions.length - 1] || state.settings.workoutVersions[0]).items;
  }

  // ---------- 파생값 ----------
  function intakeOn(date) {
    return (state.meals[date] || []).reduce((a, m) => a + Math.round(m.kcal * m.portion), 0);
  }
  function exerciseLogsOn(date) { return (state.exercises[date] || []).slice().reverse(); } // 최근에 추가한 것이 위
  function exerciseKcalOn(date) { return (state.exercises[date] || []).reduce((a, e) => a + (Number(e.kcal) || 0), 0); }
  // 운동 kcal = 체크리스트(R-5) + 자유 기록(R-16). rows/rate 는 체크리스트만, kcal 는 합계 (예산·예측·보정이 모두 이 값을 쓴다).
  function workoutOn(date) {
    const s = C.workoutSummary(date, state.workouts[date] || {}, allItemsOn(date), C.trendWeight(state.weights, date));
    const extraKcal = exerciseKcalOn(date);
    return { ...s, checklistKcal: s.kcal, extraKcal, kcal: s.kcal + extraKcal, logs: exerciseLogsOn(date) };
  }
  function targetOn(date) { return state.goal ? C.targetWeightOn(state.goal, date) : null; }

  // 목표 시작일부터 date까지 순서대로 판정 (연속 단식·치팅 익일 면제 때문에 순차 계산)
  function judgeUpTo(date) {
    const out = {};
    if (!state.goal) return out;
    let consecutive = 0;
    for (const d of C.dateRange(state.goal.startDate, date)) {
      const prev = C.addDays(d, -1);
      const j = C.judgeDay({
        weight: state.weights[d] ?? null,
        prevWeight: C.lastWeightBefore(state.weights, d),
        target: targetOn(d),
        cheat: !!state.cheat.scheduled[d],
        prevCheat: !!state.cheat.scheduled[prev],
        consecutiveFasting: consecutive,
      });
      consecutive = j.status === 'fasting' ? consecutive + 1 : 0;
      out[d] = j;
    }
    return out;
  }
  function stickerStats(date) {
    const judged = judgeUpTo(date);
    const total = Object.values(judged).filter(j => j.sticker).length;
    const earned = Math.floor(total / CONFIG.judge.stickersPerVoucher);
    if (earned > state.cheat.vouchersIssued) {
      const add = Math.min(earned - state.cheat.vouchersIssued, CONFIG.judge.maxVouchers - available());
      if (add > 0) { state.cheat.vouchersIssued += add; emit('voucher_issued', { count: add }); }
    }
    return { total, count: total % CONFIG.judge.stickersPerVoucher, available: available(), judged };
  }
  function available() { return Math.max(0, state.cheat.vouchersIssued - state.cheat.vouchersUsed); }

  function recentDays(date, n = 7) {
    return Array.from({ length: n }, (_, i) => {
      const d = C.addDays(date, -(n - 1 - i));
      return { date: d, intake: intakeOn(d), workoutKcal: workoutOn(d).kcal, logged: (state.meals[d] || []).length > 0 };
    });
  }
  function prediction(date) {
    const trend = C.trendWeight(state.weights, date);
    const { avg, n } = C.avgNetDeficit(state.settings.tdee, recentDays(date));
    const predicted = C.predictWeight(trend, avg);
    const target = state.goal ? state.goal.targetWeight : CONFIG.goal.targetWeight;
    return { trend, predicted, loggedDays: n, avgDeficit: avg, path: C.predictPath(trend, avg), gapKcal: C.gapToTarget(predicted, target) };
  }
  function goalMode(date) {
    if (!state.goal) return 'none';
    const trend = C.trendWeight(state.weights, date);
    if (trend !== null && trend <= state.goal.targetWeight) return 'maintain';
    if (date >= state.goal.endDate) return 'expired';
    return 'loss';
  }

  function dayView(date = today()) {
    const g = state.goal;
    const mode = goalMode(date);
    const stats = stickerStats(date);
    const judge = stats.judged[date] || { status: 'missing', sticker: false };
    const trend = C.trendWeight(state.weights, date);
    const workout = workoutOn(date);
    const targetWeight = g ? g.targetWeight : CONFIG.goal.targetWeight;
    const remaining = g ? C.daysRemaining(g, date) : CONFIG.goal.periodDays;
    const budget = C.dailyBudget({
      tdee: state.settings.tdee, trend: mode === 'maintain' ? targetWeight : trend, targetWeight,
      remaining: mode === 'expired' ? 1 : remaining, workoutKcal: workout.kcal, status: judge.status, floor: state.settings.floor,
    });
    if (mode === 'maintain' || mode === 'expired') { budget.deficit = 0; budget.shortfall = 0; if (budget.budget !== null && judge.status !== 'fasting') budget.budget = Math.round(state.settings.tdee + workout.kcal); }
    const intake = intakeOn(date);
    const meals = (state.meals[date] || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    const win = C.fastingWindow(state.fastingWindow[date] || state.settings.fastingWindowStart);
    const fastingBroken = judge.status === 'fasting' && meals.some(m => !C.inFastingWindow(m.time, win.start));
    return {
      date, weekend: C.isWeekend(date), mode, goal: g,
      weight: state.weights[date] ?? null, prevWeight: C.lastWeightBefore(state.weights, date), trend,
      target: targetOn(date), targetWeight, remaining,
      judge, sticker: { count: stats.count, total: stats.total, vouchers: stats.available },
      cheat: !!state.cheat.scheduled[date],
      budget, intake, remainingKcal: budget.budget === null ? null : budget.budget - intake,
      meals, workout, prediction: prediction(date),
      fasting: judge.status === 'fasting' ? { ...win, broken: fastingBroken } : null,
      suggestion: state.pendingSuggestion,
      editable: { weight: editable(date, CONFIG.weight.editableDays), meals: editable(date, CONFIG.meals.editableDays), exercises: editable(date, CONFIG.exercises.editableDays) },
    };
  }

  // ---------- 변경 ----------
  function setWeight(date, kg, { confirmed = false } = {}) {
    if (!editable(date, CONFIG.weight.editableDays)) return { ok: false, reason: 'not-editable' };
    const v = C.validateWeight(kg, C.lastWeightBefore(state.weights, date));
    if (!v.ok) return v;
    if (v.confirm && !confirmed) return { ok: false, reason: 'confirm', confirm: v.confirm };
    const replaced = typeof state.weights[date] === 'number';
    state.weights[date] = C.round1(kg);
    if (!state.goal) setGoal({ startDate: date, startWeight: state.weights[date] });
    emit('weight_logged', { date, kg: state.weights[date], replaced });
    stickerStats(today()); // 스티커·치팅데이 발급은 등록 시점에 확정
    persist();
    return { ok: true, replaced };
  }
  function deleteWeight(date) {
    if (!editable(date, CONFIG.weight.editableDays)) return { ok: false, reason: 'not-editable' };
    delete state.weights[date];
    persist();
    return { ok: true };
  }

  function addMeal(date, { foodId = null, name, kcal, serving = '', portion = 1, time = nowTime() }) {
    if (!editable(date, CONFIG.meals.editableDays)) return { ok: false, reason: 'not-editable' };
    if (!name || !(kcal > 0) || !(portion > 0)) return { ok: false, reason: 'invalid' };
    const list = (state.meals[date] ||= []);
    if (list.length >= CONFIG.meals.maxPerDay) return { ok: false, reason: 'limit' };
    const meal = { id: uid(), foodId, name, kcal: Math.round(kcal), serving, portion, time };
    list.push(meal);
    emit('food_logged', { date, foodId, kcal: Math.round(kcal * portion) });
    persist();
    return { ok: true, meal };
  }
  function updateMeal(date, id, patch) {
    const m = (state.meals[date] || []).find(x => x.id === id);
    if (!m) return { ok: false, reason: 'not-found' };
    if (patch.portion !== undefined && !(patch.portion > 0)) return { ok: false, reason: 'invalid' };
    Object.assign(m, patch);
    persist();
    return { ok: true, meal: m };
  }
  function removeMeal(date, id) {
    const list = state.meals[date] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return { ok: false, reason: 'not-found' };
    const [removed] = list.splice(idx, 1);
    if (list.length === 0) delete state.meals[date];
    persist();
    return { ok: true, restore: () => { (state.meals[date] ||= []).splice(Math.min(idx, (state.meals[date] || []).length), 0, removed); persist(); } };
  }
  function addCustomFood({ name, kcal, serving = '1회' }) {
    if (!name || !Number.isInteger(kcal) || kcal <= 0) return { ok: false, reason: 'invalid' };
    const food = { id: `custom-${uid()}`, name: name.trim(), kcal, serving, custom: true };
    state.customs.unshift(food);
    persist();
    return { ok: true, food };
  }
  function toggleFavorite(foodId) {
    const i = state.favorites.indexOf(foodId);
    if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(foodId);
    persist();
    return i < 0;
  }
  function recentFoodIds(date = today(), days = 7) {
    const ids = new Set();
    for (const d of C.dateRange(C.addDays(date, -days), date)) for (const m of state.meals[d] || []) if (m.foodId) ids.add(m.foodId);
    return ids;
  }

  function setWorkout(date, id, patch) {
    if (!editable(date, CONFIG.meals.editableDays)) return { ok: false, reason: 'not-editable' };
    const day = (state.workouts[date] ||= {});
    const prev = day[id] || {};
    day[id] = { ...prev, ...patch };
    const summary = workoutOn(date);
    if (summary.rate >= 1) emit('workout_completed', { date });
    persist();
    return { ok: true, summary };
  }
  function updateWorkoutItems(items, from = C.addDays(today(), 1)) {
    const versions = state.settings.workoutVersions.filter(v => v.from !== from);
    versions.push({ from, items: items.map(w => ({ ...w })) });
    versions.sort((a, b) => a.from.localeCompare(b.from));
    state.settings.workoutVersions = versions;
    persist();
  }

  // ---------- 자유 운동 기록 (R-16) ----------
  function addExercise(date, { exerciseId = null, name, unit = '회', amount = 1, kcalPerUnit = null, kcal = null, time = nowTime() }) {
    if (!editable(date, CONFIG.exercises.editableDays)) return { ok: false, reason: 'not-editable' };
    if (!name || !(amount > 0) || !((kcalPerUnit > 0) || (kcal >= 0 && kcal !== null))) return { ok: false, reason: 'invalid' };
    const list = (state.exercises[date] ||= []);
    if (list.length >= CONFIG.exercises.maxPerDay) return { ok: false, reason: 'limit' };
    const computed = kcal !== null && kcalPerUnit === null ? Math.round(kcal) : exerciseKcal({ kcal: kcalPerUnit, amount, weight: C.trendWeight(state.weights, date), refWeight: CONFIG.workoutRefWeight });
    const entry = { id: uid(), exerciseId, name, unit, amount, kcalPerUnit, kcal: computed, time };
    list.push(entry);
    emit('exercise_logged', { date, exerciseId, kcal: computed });
    persist();
    return { ok: true, entry };
  }
  function updateExercise(date, id, patch) {
    const e = (state.exercises[date] || []).find(x => x.id === id);
    if (!e) return { ok: false, reason: 'not-found' };
    if (patch.amount !== undefined && !(patch.amount > 0)) return { ok: false, reason: 'invalid' };
    Object.assign(e, patch);
    if (patch.amount !== undefined && e.kcalPerUnit > 0 && patch.kcal === undefined) e.kcal = exerciseKcal({ kcal: e.kcalPerUnit, amount: e.amount, weight: C.trendWeight(state.weights, date), refWeight: CONFIG.workoutRefWeight });
    persist();
    return { ok: true, entry: e };
  }
  function removeExercise(date, id) {
    const list = state.exercises[date] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return { ok: false, reason: 'not-found' };
    const [removed] = list.splice(idx, 1);
    if (list.length === 0) delete state.exercises[date];
    persist();
    return { ok: true, restore: () => { (state.exercises[date] ||= []).splice(Math.min(idx, (state.exercises[date] || []).length), 0, removed); persist(); } };
  }
  function addCustomExercise({ name, unit = '회', kcal, amount }) {
    if (!name || !['분', '회', 'km'].includes(unit) || !(kcal > 0)) return { ok: false, reason: 'invalid' };
    const ex = { id: `cex-${uid()}`, name: name.trim(), category: '직접 입력', unit, kcal: Math.round(kcal * 100) / 100, amount: amount > 0 ? amount : (unit === '분' ? 30 : unit === 'km' ? 5 : 20), custom: true };
    state.customExercises.unshift(ex);
    persist();
    return { ok: true, exercise: ex };
  }
  // 직접 입력한 운동 종류 삭제. 이미 기록된 운동(이름·kcal 를 자체 보관)은 그대로 남는다.
  function removeCustomExercise(id) {
    const idx = state.customExercises.findIndex(e => e.id === id);
    if (idx < 0) return { ok: false, reason: 'not-found' };
    const [removed] = state.customExercises.splice(idx, 1);
    state.exerciseFavorites = state.exerciseFavorites.filter(f => f !== id);
    persist();
    return { ok: true, restore: () => { state.customExercises.splice(Math.min(idx, state.customExercises.length), 0, removed); persist(); } };
  }
  function toggleExerciseFavorite(id) {
    const i = state.exerciseFavorites.indexOf(id);
    if (i >= 0) state.exerciseFavorites.splice(i, 1); else state.exerciseFavorites.push(id);
    persist();
    return i < 0;
  }
  function recentExerciseIds(date = today(), days = 14) {
    const ids = new Set();
    for (const d of C.dateRange(C.addDays(date, -days), date)) for (const e of state.exercises[d] || []) if (e.exerciseId) ids.add(e.exerciseId);
    return ids;
  }

  function setGoal({ startDate = today(), startWeight, targetWeight = CONFIG.goal.targetWeight, periodDays = CONFIG.goal.periodDays }) {
    const sw = startWeight ?? C.trendWeight(state.weights, startDate) ?? CONFIG.goal.baselineWeight;
    if (state.goal) state.goalHistory.push({ ...state.goal, endedAt: today() });
    state.goal = C.makeGoal(startDate, sw, targetWeight, periodDays);
    emit('goal_set', { ...state.goal });
    persist();
    return state.goal;
  }
  function restartGoal() {
    const t = today();
    return setGoal({ startDate: t, startWeight: C.trendWeight(state.weights, t) ?? state.goal?.targetWeight, targetWeight: state.goal?.targetWeight });
  }

  function useCheat(date = today()) {
    stickerStats(today());
    if (state.cheat.scheduled[date]) return { ok: false, reason: 'already' };
    if (date < today()) return { ok: false, reason: 'past' };
    if (available() <= 0) return { ok: false, reason: 'no-voucher' };
    state.cheat.scheduled[date] = true;
    state.cheat.vouchersUsed += 1;
    emit('cheat_used', { date });
    persist();
    return { ok: true };
  }
  function cancelCheat(date) {
    if (!state.cheat.scheduled[date]) return { ok: false, reason: 'none' };
    if (date < today() || (date === today() && (state.meals[date] || []).length > 0)) return { ok: false, reason: 'consumed' };
    delete state.cheat.scheduled[date];
    state.cheat.vouchersUsed -= 1;
    persist();
    return { ok: true };
  }
  function setFastingWindow(date, startHHMM) { state.fastingWindow[date] = startHHMM; persist(); }

  function setSettings(patch) {
    if (patch.tdee !== undefined && patch.tdee !== state.settings.tdee) {
      state.settings.tdeeHistory.push({ date: today(), from: state.settings.tdee, to: patch.tdee, reason: 'manual' });
    }
    Object.assign(state.settings, patch);
    persist();
  }
  function completeOnboarding({ baseline, targetWeight, profile }) {
    const t = today();
    state.settings.profile = { ...state.settings.profile, ...(profile || {}) };
    state.settings.tdee = C.estimateTdee({ ...state.settings.profile, weight: baseline });
    state.weights[t] = C.round1(baseline);
    setGoal({ startDate: t, startWeight: C.round1(baseline), targetWeight });
    state.onboarded = true;
    persist();
  }

  // ---------- 주기 작업: 앱 열 때 1회 (스냅샷·TDEE 보정·정체 판정) ----------
  function runMaintenance() {
    const t = today();
    const notices = [];
    if (!state.goal) return notices;
    const p = prediction(t);
    if (p.predicted !== null && state.snapshots[t] === undefined) state.snapshots[t] = p.predicted;

    const since = state.settings.lastCalibration || state.goal.startDate;
    if (C.daysBetween(since, t) >= CONFIG.tdeeCalibration.everyDays) {
      const start = C.addDays(t, -CONFIG.tdeeCalibration.everyDays);
      const days = recentDays(t).filter(d => d.logged);
      if (days.length >= CONFIG.plateau.minAdherenceDays) {
        const r = C.calibrateTdee({
          tdee: state.settings.tdee, trendStart: C.trendWeight(state.weights, start), trendEnd: C.trendWeight(state.weights, t),
          days: CONFIG.tdeeCalibration.everyDays,
          avgIntake: days.reduce((a, d) => a + d.intake, 0) / days.length,
          avgWorkout: days.reduce((a, d) => a + d.workoutKcal, 0) / days.length,
        });
        if (r.changed) {
          state.settings.tdeeHistory.push({ date: t, from: state.settings.tdee, to: r.tdee, reason: 'auto' });
          state.settings.tdee = r.tdee;
          notices.push({ type: 'tdee', from: state.settings.tdeeHistory.at(-1).from, to: r.tdee });
        }
        state.settings.lastCalibration = t;
      }
      // 정체 판정 (R-8)
      const lastPrompt = state.settings.lastPlateauPrompt;
      if (!lastPrompt || C.daysBetween(lastPrompt, t) >= CONFIG.plateau.cooldownDays) {
        const adherence = recentDays(t).filter(d => d.logged && !state.cheat.scheduled[d.date] && d.intake <= (dayView(d.date).budget.budget ?? Infinity)).length;
        const trendDrop = (C.trendWeight(state.weights, start) ?? 0) - (C.trendWeight(state.weights, t) ?? 0);
        const expectedDrop = (targetOn(start) ?? 0) - (targetOn(t) ?? 0);
        const pc = C.plateauCheck({ adherenceDays: adherence, trendDrop, expectedDrop });
        if (pc.plateau) {
          state.pendingSuggestion = { date: t, kcalPerDay: pc.kcalPerDay, workout: pc.suggestion };
          state.settings.lastPlateauPrompt = t;
          notices.push({ type: 'plateau', ...pc });
        } else if (adherence < CONFIG.plateau.minAdherenceDays && days.length > 0) {
          notices.push({ type: 'adherence', rate: Math.round((adherence / 7) * 100) });
        }
      }
    }
    persist();
    return notices;
  }
  function acceptSuggestion() {
    const s = state.pendingSuggestion;
    if (!s) return false;
    const items = allItemsOn(C.addDays(today(), 1)).filter(w => w.id !== s.workout.id);
    updateWorkoutItems([...items, s.workout]);
    state.pendingSuggestion = null;
    emit('suggestion_accepted', { workout: s.workout.id });
    persist();
    return true;
  }
  function dismissSuggestion() { state.pendingSuggestion = null; persist(); }

  // ---------- 그래프 데이터 (R-14) ----------
  function graphData(date = today(), days = 30) {
    const from = C.addDays(date, -(days - 1));
    const judged = judgeUpTo(date);
    const rows = C.dateRange(from, date).map(d => {
      const v = state.weights[d] ?? null;
      const b = dayView(d);
      return {
        date: d, weight: v, trend: C.trendWeight(state.weights, d), target: targetOn(d),
        intake: intakeOn(d), budget: d < state.goal.startDate ? null : b.budget.budget, logged: (state.meals[d] || []).length > 0,
        workoutRate: workoutOn(d).rate, workoutKcal: workoutOn(d).kcal, exerciseKcal: exerciseKcalOn(d), run: !!(state.workouts[d]?.run5k?.done || (state.workouts[d]?.run5k?.count >= 5)),
        status: (judged[d] || {}).status || 'missing', sticker: !!(judged[d] || {}).sticker, cheat: !!state.cheat.scheduled[d],
        snapshot: state.snapshots[d] ?? null,
      };
    });
    const p = prediction(date);
    const forecast = p.path.map((w, i) => ({ date: C.addDays(date, i), weight: w }));
    // 예측 정확도: 14일 전 스냅샷 vs 오늘 추세
    const errs = [];
    for (const r of rows) {
      const back = C.addDays(r.date, -14);
      if (state.snapshots[back] !== undefined && r.trend !== null) errs.push(Math.abs(state.snapshots[back] - r.trend));
    }
    const meanErr = errs.length ? C.round1(errs.reduce((a, b) => a + b, 0) / errs.length) : null;
    return { rows, forecast, targetWeight: state.goal ? state.goal.targetWeight : CONFIG.goal.targetWeight, meanErr, snapshotsN: errs.length };
  }

  // ---------- 백업·복원 (R-13) ----------
  function exportJson() { return JSON.stringify({ app: 'diet', exportedAt: now().toISOString(), data: state }, null, 2); }
  function summarize(data) {
    return { weights: Object.keys(data.weights || {}).length, meals: Object.values(data.meals || {}).reduce((a, l) => a + l.length, 0), workouts: Object.keys(data.workouts || {}).length, exercises: Object.values(data.exercises || {}).reduce((a, l) => a + l.length, 0), customs: (data.customs || []).length };
  }
  function parseImport(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (_) { return { ok: false, reason: 'parse' }; }
    if (!obj || obj.app !== 'diet' || !obj.data || typeof obj.data !== 'object' || !obj.data.version) return { ok: false, reason: 'format' };
    return { ok: true, data: migrate(obj.data), summary: summarize(obj.data) };
  }
  function mergeInto(d) {
      Object.assign(state.weights, d.weights);
      for (const [k, list] of Object.entries(d.meals)) { const cur = (state.meals[k] ||= []); const ids = new Set(cur.map(m => m.id)); for (const m of list) if (!ids.has(m.id)) cur.push(m); }
      for (const [k, v] of Object.entries(d.workouts)) state.workouts[k] = { ...(state.workouts[k] || {}), ...v };
      for (const [k, list] of Object.entries(d.exercises || {})) { const cur = (state.exercises[k] ||= []); const ids = new Set(cur.map(e => e.id)); for (const e of list) if (!ids.has(e.id)) cur.push(e); }
      const xids = new Set(state.customExercises.map(c => c.id));
      for (const c of d.customExercises || []) if (!xids.has(c.id)) state.customExercises.push(c);
      state.exerciseFavorites = [...new Set([...state.exerciseFavorites, ...(d.exerciseFavorites || [])])];
      const cids = new Set(state.customs.map(c => c.id));
      for (const c of d.customs) if (!cids.has(c.id)) state.customs.push(c);
      state.favorites = [...new Set([...state.favorites, ...d.favorites])];
      Object.assign(state.snapshots, d.snapshots);
      Object.assign(state.cheat.scheduled, d.cheat.scheduled);
      if (!state.goal) state.goal = d.goal;
      if (!state.settings.profile.sex && d.settings && d.settings.profile) state.settings.profile = d.settings.profile;
      state.onboarded = state.onboarded || d.onboarded;
  }
  function importJson(text, mode = 'replace') {
    const r = parseImport(text);
    if (!r.ok) return r;
    if (mode === 'replace') state = r.data; else mergeInto(r.data);
    persist();
    return { ok: true, summary: r.summary };
  }
  // 동기화(R-15)로 받은 원격 상태 적용. replace 는 삭제까지 그대로 반영, merge 는 합집합(체중은 원격 우선).
  // 사용자 변경이 아니므로 updatedAt 은 양쪽 중 큰 값으로 두고 변경 리스너를 부르지 않는다.
  function applyRemote(remote, mode = 'replace') {
    const d = migrate(remote);
    const newest = Math.max(state.updatedAt || 0, d.updatedAt || 0);
    if (mode === 'replace') state = d; else mergeInto(d);
    state.updatedAt = newest;
    persist({ touch: false });
    emit('sync_applied', { mode });
    return state;
  }
  function reset() { state = emptyState(); if (storage) storage.clear(); persist(); }

  // ---------- 통계 (5절 지표) ----------
  function stats(date = today()) {
    if (!state.goal) return null;
    const range = C.dateRange(state.goal.startDate, date);
    const n = range.length;
    const weightDays = range.filter(d => typeof state.weights[d] === 'number').length;
    const mealDays = range.filter(d => (state.meals[d] || []).length > 0).length;
    const views = range.map(d => dayView(d));
    const budgetEligible = views.filter(v => v.budget.budget !== null && (state.meals[v.date] || []).length > 0);
    const budgetKept = budgetEligible.filter(v => v.intake <= v.budget.budget).length;
    const workoutDone = views.filter(v => v.workout.rate >= 1).length;
    const g = graphData(date, n);
    return {
      days: n, weightRate: weightDays / n, mealRate: mealDays / n,
      budgetRate: budgetEligible.length ? budgetKept / budgetEligible.length : 0, workoutRate: workoutDone / n,
      startWeight: state.goal.startWeight, trend: C.trendWeight(state.weights, date), targetWeight: state.goal.targetWeight,
      stickers: stickerStats(date).total, meanErr: g.meanErr, floorViolations: views.filter(v => v.budget.budget !== null && v.judge.status !== 'fasting' && v.budget.budget < state.settings.floor).length,
    };
  }

  return {
    get state() { return state; }, events, today, nowTime,
    dayView, graphData, stats, prediction, judgeUpTo, workoutItemsOn, recentFoodIds,
    setWeight, deleteWeight, addMeal, updateMeal, removeMeal, addCustomFood, toggleFavorite,
    setWorkout, updateWorkoutItems, addExercise, updateExercise, removeExercise, addCustomExercise, removeCustomExercise, toggleExerciseFavorite, recentExerciseIds, setGoal, restartGoal, useCheat, cancelCheat, setFastingWindow,
    setSettings, completeOnboarding, runMaintenance, acceptSuggestion, dismissSuggestion,
    exportJson, parseImport, importJson, applyRemote, onChange, reset, findFood: id => findFood(id, state.customs), findExercise: id => findExercise(id, state.customExercises),
  };
}

// 스키마 마이그레이션. 새 필드는 기본값으로 채운다 (구버전 백업도 가져올 수 있다).
export function migrate(data) {
  const base = emptyState();
  const out = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) }, cheat: { ...base.cheat, ...(data.cheat || {}) } };
  out.settings.reminders = { ...base.settings.reminders, ...(out.settings.reminders || {}) };
  if (!Array.isArray(out.settings.workoutVersions) || out.settings.workoutVersions.length === 0) out.settings.workoutVersions = base.settings.workoutVersions;
  // v1 → v2: 운동 기록 필드 추가. 기존 체중·식사·체크리스트 기록은 손대지 않는다.
  if (!out.exercises || typeof out.exercises !== 'object') out.exercises = {};
  if (!Array.isArray(out.customExercises)) out.customExercises = [];
  if (!Array.isArray(out.exerciseFavorites)) out.exerciseFavorites = [];
  out.version = CONFIG.schemaVersion;
  return out;
}
