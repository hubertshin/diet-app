import { describe, test, assert } from './harness.mjs';
import { CONFIG } from '../src/config.js';
import { createApp, emptyState, migrate } from '../src/state.js';
import { createStorage } from '../src/storage.js';
import { memoryBacking } from './storage.test.mjs';
import { addDays } from '../src/calc.js';

// 기준 시각: 2026-10-27(화) 08:00. 체중을 넣으면 그날이 목표 시작일(78.0 → 73.0, 기한 11-26)이 된다.
const T0 = '2026-10-27';
function at(date, hh = 8, mm = 0) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}
function makeApp({ date = T0, time = [8, 0], backing = memoryBacking() } = {}) {
  let cur = { date, time };
  const app = createApp({ storage: createStorage(backing, 'test'), now: () => at(cur.date, ...cur.time) });
  app._travel = (d, t = [8, 0]) => { cur = { date: d, time: t }; };
  app._backing = backing;
  return app;
}
function onboard(app, baseline = 78.0) {
  app.completeOnboarding({ baseline, targetWeight: 73.0 });
  return app;
}

describe('온보딩·목표 (R-3)', () => {
  test('온보딩: baseline 78.0 → 목표 73.0, 기한 +30일, TDEE 기본 2300', () => {
    const app = onboard(makeApp());
    const g = app.state.goal;
    assert.equal(g.startWeight, 78.0); assert.equal(g.targetWeight, 73.0); assert.equal(g.endDate, '2026-11-26');
    assert.equal(app.state.settings.tdee, 2300);
    assert.equal(app.state.weights[T0], 78.0);
    assert.ok(app.state.onboarded);
  });
  test('키·나이·성별을 주면 TDEE 를 공식으로 추정한다', () => {
    const app = makeApp();
    app.completeOnboarding({ baseline: 78, targetWeight: 73, profile: { sex: 'male', height: 175, age: 40 } });
    assert.equal(app.state.settings.tdee, 2350);
  });
  test('홈 뷰: 오늘 목표 체중과 차이, 남은 일수', () => {
    const app = onboard(makeApp());
    app._travel('2026-11-06'); // 10일째
    const v = app.dayView();
    assert.equal(v.target, 76.3); assert.equal(v.remaining, 20);
  });
  test('기한 도달·미달성이면 mode=expired, 재시작하면 현재 추세가 새 시작점이고 이전 목표는 이력에 남는다', () => {
    const app = onboard(makeApp());
    app._travel('2026-11-26');
    app.setWeight('2026-11-26', 75.2);
    assert.equal(app.dayView().mode, 'expired');
    app.restartGoal();
    assert.equal(app.state.goal.startDate, '2026-11-26');
    assert.equal(app.state.goal.startWeight, 75.2);
    assert.equal(app.state.goal.endDate, '2026-12-26');
    assert.equal(app.state.goalHistory.length, 1);
    assert.equal(app.state.goalHistory[0].startWeight, 78.0);
    assert.equal(app.state.weights[T0], 78.0, '이전 기록 보존');
  });
  test('추세 체중 ≤ 목표면 mode=maintain, 예산 적자 0', () => {
    const app = onboard(makeApp(), 72.8);
    const v = app.dayView();
    assert.equal(v.mode, 'maintain');
    assert.equal(v.budget.deficit, 0);
    assert.equal(v.budget.budget, 2300);
  });
  test('목표 변경 시 이력이 남는다', () => {
    const app = onboard(makeApp());
    app.setGoal({ targetWeight: 72 });
    assert.equal(app.state.goalHistory.length, 1);
    assert.equal(app.state.goal.targetWeight, 72);
  });
});

describe('R-2 아침 체중 등록', () => {
  test('0.1kg 단위로 반올림해 저장하고 저장소에 남는다', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-28');
    const r = app.setWeight('2026-10-28', 77.44);
    assert.ok(r.ok); assert.equal(app.state.weights['2026-10-28'], 77.4);
    assert.ok(app._backing.getItem('test').includes('77.4'));
  });
  test('범위 밖(7.8)은 거부된다', () => {
    const app = onboard(makeApp());
    const r = app.setWeight(T0, 7.8);
    assert.equal(r.ok, false); assert.equal(r.reason, 'range');
  });
  test('직전 대비 ±5kg 초과면 confirm 을 요구하고, confirmed 면 저장된다', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-28');
    const r = app.setWeight('2026-10-28', 84);
    assert.equal(r.ok, false); assert.equal(r.reason, 'confirm');
    assert.ok(app.setWeight('2026-10-28', 84, { confirmed: true }).ok);
  });
  test('같은 날 다시 입력하면 덮어쓰고(replaced) 판정이 재계산된다', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-28');
    app.setWeight('2026-10-28', 79.0);
    assert.equal(app.dayView().judge.status, 'fasting');
    const r = app.setWeight('2026-10-28', 77.5);
    assert.ok(r.replaced);
    assert.equal(app.dayView().judge.status, 'pass');
  });
  test('7일보다 오래된 날짜는 입력·수정할 수 없다', () => {
    const app = onboard(makeApp());
    app._travel('2026-11-10');
    assert.equal(app.setWeight('2026-11-03', 77).ok, true, '7일 전은 가능');
    assert.equal(app.setWeight('2026-11-02', 77).reason, 'not-editable');
    assert.equal(app.setWeight('2026-11-11', 77).reason, 'not-editable', '미래 불가');
  });
  test('미등록일은 judge=missing, 스티커·단식 없음', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-28');
    const v = app.dayView();
    assert.equal(v.weight, null); assert.equal(v.judge.status, 'missing'); assert.equal(v.fasting, null);
  });
  test('추세 체중은 기록된 날의 7일 평균', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-29');
    app.setWeight('2026-10-29', 77.0);
    assert.equal(app.dayView().trend, 77.5);
  });
  test('deleteWeight 로 기록을 지울 수 있다', () => {
    const app = onboard(makeApp());
    app.deleteWeight(T0);
    assert.equal(app.state.weights[T0], undefined);
  });
});

describe('R-1 식사 기록', () => {
  test('음식 1건 저장 → 당일 섭취 합계와 남은 예산이 바로 반영된다', () => {
    const app = onboard(makeApp());
    const before = app.dayView().remainingKcal;
    const r = app.addMeal(T0, { foodId: 'kimchi-jjigae', name: '김치찌개', kcal: 450, portion: 1, time: '12:10' });
    assert.ok(r.ok);
    const v = app.dayView();
    assert.equal(v.intake, 450);
    assert.equal(v.remainingKcal, before - 450);
    assert.equal(v.meals.length, 1);
  });
  test('분량 0.5/1.5/2 는 kcal 비례', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 450, portion: 0.5 });
    app.addMeal(T0, { name: 'b', kcal: 450, portion: 2 });
    assert.equal(app.dayView().intake, 225 + 900);
  });
  test('분량 수정 후 합계 반영, 0 이하 분량은 거부', () => {
    const app = onboard(makeApp());
    const { meal } = app.addMeal(T0, { name: 'a', kcal: 100, portion: 1 });
    assert.ok(app.updateMeal(T0, meal.id, { portion: 1.5 }).ok);
    assert.equal(app.dayView().intake, 150);
    assert.equal(app.updateMeal(T0, meal.id, { portion: 0 }).ok, false);
    assert.equal(app.updateMeal(T0, 'nope', { portion: 1 }).reason, 'not-found');
  });
  test('삭제 후 되돌리기(restore)가 같은 자리에 복구한다', () => {
    const app = onboard(makeApp());
    const a = app.addMeal(T0, { name: 'a', kcal: 100, time: '08:00' }).meal;
    const b = app.addMeal(T0, { name: 'b', kcal: 200, time: '09:00' }).meal;
    app.addMeal(T0, { name: 'c', kcal: 300, time: '10:00' });
    const r = app.removeMeal(T0, b.id);
    assert.ok(r.ok); assert.equal(app.dayView().intake, 400);
    r.restore();
    assert.equal(app.dayView().intake, 600);
    assert.deepEqual(app.state.meals[T0].map(m => m.name), ['a', 'b', 'c']);
    assert.equal(app.removeMeal(T0, 'nope').ok, false);
    void a;
  });
  test('마지막 1건을 지우면 그날은 미기록(logged=false)이 된다', () => {
    const app = onboard(makeApp());
    const { meal } = app.addMeal(T0, { name: 'a', kcal: 100 });
    app.removeMeal(T0, meal.id);
    assert.equal(app.state.meals[T0], undefined);
    assert.equal(app.dayView().prediction.loggedDays, 0);
  });
  test('하루 50건 상한', () => {
    const app = onboard(makeApp());
    for (let i = 0; i < 50; i++) assert.ok(app.addMeal(T0, { name: `m${i}`, kcal: 10 }).ok);
    assert.equal(app.addMeal(T0, { name: 'over', kcal: 10 }).reason, 'limit');
  });
  test('과거 7일까지만 기록 가능, 미래·8일 전은 거부', () => {
    const app = onboard(makeApp());
    app._travel('2026-11-10');
    assert.ok(app.addMeal('2026-11-03', { name: 'a', kcal: 10 }).ok);
    assert.equal(app.addMeal('2026-11-02', { name: 'a', kcal: 10 }).reason, 'not-editable');
    assert.equal(app.addMeal('2026-11-11', { name: 'a', kcal: 10 }).reason, 'not-editable');
  });
  test('kcal 0·음수·이름 없음은 거부', () => {
    const app = onboard(makeApp());
    assert.equal(app.addMeal(T0, { name: 'a', kcal: 0 }).reason, 'invalid');
    assert.equal(app.addMeal(T0, { name: 'a', kcal: -5 }).reason, 'invalid');
    assert.equal(app.addMeal(T0, { name: '', kcal: 100 }).reason, 'invalid');
  });
  test('직접 입력 음식은 사용자 DB에 저장돼 이후 검색(findFood)된다; kcal 정수 필수', () => {
    const app = onboard(makeApp());
    const r = app.addCustomFood({ name: ' 엄마김치볶음 ', kcal: 300 });
    assert.ok(r.ok); assert.equal(r.food.name, '엄마김치볶음'); assert.ok(r.food.custom);
    assert.equal(app.findFood(r.food.id).kcal, 300);
    assert.equal(app.addCustomFood({ name: 'x', kcal: 10.5 }).ok, false);
    assert.equal(app.addCustomFood({ name: 'x', kcal: 0 }).ok, false);
  });
  test('즐겨찾기 토글, 최근 7일 음식 id 집합', () => {
    const app = onboard(makeApp());
    assert.equal(app.toggleFavorite('rice'), true);
    assert.equal(app.toggleFavorite('rice'), false);
    app.addMeal(T0, { foodId: 'rice', name: '밥', kcal: 310 });
    app._travel('2026-11-02');
    assert.ok(app.recentFoodIds().has('rice'));
    app._travel('2026-11-05');
    assert.ok(!app.recentFoodIds().has('rice'), '8일 지나면 최근에서 빠진다');
  });
  test('식사 목록은 시각순으로 정렬된다', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'late', kcal: 1, time: '20:00' });
    app.addMeal(T0, { name: 'early', kcal: 1, time: '07:00' });
    assert.deepEqual(app.dayView().meals.map(m => m.name), ['early', 'late']);
  });
});

describe('R-4 예산 (상태 통합)', () => {
  test('78→73 시작일: 예산 = 하한 1400, 부족 383kcal', () => {
    const v = onboard(makeApp()).dayView();
    assert.equal(v.budget.budget, 1400); assert.equal(v.budget.shortfall, 383); assert.equal(v.budget.deficit, 1283);
  });
  test('운동 체크 시 예산이 늘고 부족분이 준다', () => {
    const app = onboard(makeApp());
    app.setWorkout(T0, 'pushup', { done: true });
    const v = app.dayView();
    assert.equal(v.workout.kcal, 80);
    assert.equal(v.budget.shortfall, 303);
  });
  test('7일 뒤 runMaintenance 가 TDEE 를 보정하고 이력·알림을 남긴다 (±150 제한)', () => {
    const app = onboard(makeApp());
    // 7일간 매일 1500 섭취 기록, 체중은 거의 안 빠짐 → 실제 TDEE 가 낮다 → -150
    for (let i = 0; i <= 7; i++) {
      const d = addDays(T0, i);
      app._travel(d);
      if (i > 0) app.setWeight(d, 78.0);
      app.addMeal(d, { name: 'm', kcal: 1500 });
    }
    const notices = app.runMaintenance();
    const n = notices.find(x => x.type === 'tdee');
    assert.ok(n, '보정 알림');
    assert.equal(n.from, 2300); assert.equal(n.to, 2150);
    assert.equal(app.state.settings.tdee, 2150);
    assert.equal(app.state.settings.lastCalibration, '2026-11-03');
    assert.equal(app.state.settings.tdeeHistory.at(-1).reason, 'auto');
    // 바로 다시 돌려도 중복 보정 없음
    assert.equal(app.runMaintenance().some(x => x.type === 'tdee'), false);
  });
  test('7일이 안 됐거나 기록이 5일 미만이면 보정하지 않는다', () => {
    const app = onboard(makeApp());
    app._travel('2026-11-03');
    app.setWeight('2026-11-03', 78);
    app.addMeal('2026-11-03', { name: 'm', kcal: 1500 });
    app.runMaintenance();
    assert.equal(app.state.settings.tdee, 2300);
    assert.equal(app.state.settings.lastCalibration, null);
  });
  test('수동 TDEE 변경도 이력에 남는다', () => {
    const app = onboard(makeApp());
    app.setSettings({ tdee: 2500 });
    assert.equal(app.state.settings.tdeeHistory.at(-1).reason, 'manual');
    assert.equal(app.dayView().budget.raw, 2500 - 1283);
  });
});

describe('R-5 운동 체크리스트 (상태 통합)', () => {
  test('토요일 뷰에는 5km 항목이 있고 slot 을 저장한다', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-31');
    app.setWorkout('2026-10-31', 'run5k', { done: true, slot: 'night' });
    const v = app.dayView();
    assert.equal(v.workout.total, 5);
    assert.equal(v.workout.rows.find(r => r.id === 'run5k').slot, 'night');
  });
  test('전부 완료하면 workout_completed 이벤트, 완료율 1', () => {
    const app = onboard(makeApp());
    for (const id of ['pushup', 'situp', 'chest', 'shoulder']) app.setWorkout(T0, id, { done: true });
    assert.equal(app.dayView().workout.rate, 1);
    assert.ok(app.events.some(e => e.name === 'workout_completed'));
  });
  test('부분 수행 개수 입력은 비례 kcal', () => {
    const app = onboard(makeApp());
    app.setWorkout(T0, 'pushup', { count: 100 });
    assert.equal(app.dayView().workout.rows.find(r => r.id === 'pushup').kcal, 40);
  });
  test('항목 변경은 내일부터 적용되고 지난 기록의 목표는 바뀌지 않는다', () => {
    const app = onboard(makeApp());
    const items = app.workoutItemsOn(T0).map(w => (w.id === 'pushup' ? { ...w, target: 300 } : w));
    app.updateWorkoutItems(items);
    assert.equal(app.workoutItemsOn(T0).find(w => w.id === 'pushup').target, 200, '오늘은 그대로');
    assert.equal(app.workoutItemsOn('2026-10-28').find(w => w.id === 'pushup').target, 300, '내일부터');
  });
  test('과거 7일 넘은 날의 운동은 수정 불가', () => {
    const app = onboard(makeApp());
    app._travel('2026-11-10');
    assert.equal(app.setWorkout('2026-11-02', 'pushup', { done: true }).reason, 'not-editable');
  });
});

describe('R-6 예측 (상태 통합)', () => {
  test('기록 0일이면 예측 null, loggedDays 0', () => {
    const p = onboard(makeApp()).dayView().prediction;
    assert.equal(p.predicted, null); assert.equal(p.loggedDays, 0); assert.deepEqual(p.path, []);
  });
  test('식사 기록이 바뀌면 예측이 바뀐다 (많이 먹으면 올라간다)', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 1400 });
    const p1 = app.dayView().prediction.predicted;
    app.addMeal(T0, { name: 'b', kcal: 2000 });
    const p2 = app.dayView().prediction.predicted;
    assert.above(p2, p1);
    assert.above(p2, 78, '순잉여면 시작 체중보다 올라간다');
  });
  test('운동 체크는 예측을 내린다', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 2300 });
    const before = app.dayView().prediction.predicted;
    app.setWorkout(T0, 'pushup', { done: true });
    assert.below(app.dayView().prediction.predicted, before);
  });
  test('예상이 목표보다 높으면 gapKcal > 0', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 2300 });
    const p = app.dayView().prediction;
    assert.equal(p.predicted, 78.0);
    assert.equal(p.gapKcal, Math.round(5 * 7700 / 30));
  });
  test('runMaintenance 가 하루 1회 예측 스냅샷을 남기고 덮어쓰지 않는다', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 1400 });
    app.runMaintenance();
    const snap = app.state.snapshots[T0];
    assert.ok(typeof snap === 'number');
    app.addMeal(T0, { name: 'b', kcal: 2000 });
    app.runMaintenance();
    assert.equal(app.state.snapshots[T0], snap);
  });
});

describe('R-8 정체 제안 (상태 통합)', () => {
  function week(app, { intake, weightEach }) {
    for (let i = 1; i <= 7; i++) {
      const d = addDays(T0, i);
      app._travel(d);
      app.setWeight(d, weightEach(i));
      app.addMeal(d, { name: 'm', kcal: intake });
    }
  }
  test('예산을 지켰는데 안 빠지면 정체 → 구체 운동 제안이 pendingSuggestion 에 뜬다', () => {
    const app = onboard(makeApp());
    week(app, { intake: 1300, weightEach: () => 78.0 });
    const notices = app.runMaintenance();
    assert.ok(notices.some(n => n.type === 'plateau'));
    assert.ok(app.state.pendingSuggestion);
    assert.equal(app.state.pendingSuggestion.workout.id, 'run20');
    assert.equal(app.dayView().suggestion.workout.id, 'run20');
  });
  test('제안 수락 시 내일부터 체크리스트에 항목이 생긴다', () => {
    const app = onboard(makeApp());
    week(app, { intake: 1300, weightEach: () => 78.0 });
    app.runMaintenance();
    assert.ok(app.acceptSuggestion());
    assert.equal(app.state.pendingSuggestion, null);
    assert.ok(!app.workoutItemsOn('2026-11-03').some(w => w.id === 'run20'), '오늘은 없음');
    assert.ok(app.workoutItemsOn('2026-11-04').some(w => w.id === 'run20'), '내일(수)부터');
    assert.ok(!app.workoutItemsOn('2026-11-07').some(w => w.id === 'run20'), '평일 전용이라 토요일엔 없음');
  });
  test('같은 제안은 7일 내 다시 뜨지 않는다', () => {
    const app = onboard(makeApp());
    week(app, { intake: 1300, weightEach: () => 78.0 });
    app.runMaintenance();
    app.dismissSuggestion();
    assert.equal(app.state.pendingSuggestion, null);
    app._travel('2026-11-05');
    app.runMaintenance();
    assert.equal(app.state.pendingSuggestion, null);
  });
  test('예산을 못 지킨 주(5일 미만)에는 운동 제안 대신 준수율 안내만', () => {
    const app = onboard(makeApp());
    week(app, { intake: 2500, weightEach: () => 78.0 });
    const notices = app.runMaintenance();
    assert.ok(!notices.some(n => n.type === 'plateau'));
    assert.equal(app.state.pendingSuggestion, null);
    assert.ok(notices.some(n => n.type === 'adherence'));
  });
  test('경로대로 빠지고 있으면 제안 없음', () => {
    const app = onboard(makeApp());
    week(app, { intake: 1300, weightEach: i => 78 - 0.17 * i });
    const notices = app.runMaintenance();
    assert.ok(!notices.some(n => n.type === 'plateau'));
  });
});

describe('R-9 스티커·치팅데이 (상태 통합)', () => {
  // 매일 목표 경로보다 살짝 아래로 기록 → 매일 스티커
  function goodDays(app, n, from = 1) {
    for (let i = from; i < from + n; i++) {
      const d = addDays(T0, i);
      app._travel(d);
      app.setWeight(d, 78 - 0.2 * i);
    }
  }
  test('시작일은 체중 = 목표라 스티커 1개부터 시작한다', () => {
    const v = onboard(makeApp()).dayView();
    assert.ok(v.judge.sticker); assert.equal(v.sticker.count, 1);
  });
  test('스티커 10개가 되면 치팅데이 1장 발급, 카운트는 0으로', () => {
    const app = onboard(makeApp());
    goodDays(app, 9);
    const v = app.dayView();
    assert.equal(v.sticker.total, 10); assert.equal(v.sticker.count, 0); assert.equal(v.sticker.vouchers, 1);
    assert.ok(app.events.some(e => e.name === 'voucher_issued'));
  });
  test('치팅데이는 최대 3장까지 보유', () => {
    const app = onboard(makeApp());
    // 목표 경로를 따라 내려가고(단식 없음) 도달 후에도 매일 조금씩 줄어든다 → 매일 스티커
    for (let i = 1; i <= 45; i++) {
      const d = addDays(T0, i); app._travel(d);
      app.setWeight(d, i <= 29 ? 78 - 0.17 * i : 72.9 - 0.1 * (i - 29), { confirmed: true });
    }
    assert.atLeast(app.dayView().sticker.total, 40);
    assert.equal(app.dayView().sticker.vouchers, 3);
  });
  test('치팅데이 사용: 당일·미래만, 과거·중복·잔여 0 은 거부', () => {
    const app = onboard(makeApp());
    assert.equal(app.useCheat().reason, 'no-voucher');
    goodDays(app, 9);
    assert.equal(app.useCheat('2026-11-01').reason, 'past');
    assert.ok(app.useCheat('2026-11-07').ok);
    assert.equal(app.useCheat('2026-11-07').reason, 'already');
    assert.equal(app.useCheat('2026-11-08').reason, 'no-voucher');
    assert.equal(app.dayView().sticker.vouchers, 0);
  });
  test('치팅데이 당일: 예산·단식 판정 없음, 식사는 기록되고 예측에 반영된다', () => {
    const app = onboard(makeApp());
    goodDays(app, 9);
    app.useCheat('2026-11-05');
    app.setWeight('2026-11-05', 80, { confirmed: true }); // 목표 76.5 보다 +3.5 지만
    const v = app.dayView();
    assert.ok(v.cheat); assert.equal(v.judge.status, 'cheat'); assert.equal(v.fasting, null);
    assert.equal(v.budget.budget, null); assert.equal(v.remainingKcal, null);
    app.addMeal('2026-11-05', { name: 'party', kcal: 3000 });
    assert.equal(v.cheat, true);
    assert.ok(app.dayView().prediction.loggedDays >= 1);
  });
  test('치팅데이 취소: 사용 전(식사 기록 전)은 장수가 복구되고, 식사 기록 후·과거는 불가', () => {
    const app = onboard(makeApp());
    goodDays(app, 9);
    app.useCheat('2026-11-06');
    assert.ok(app.cancelCheat('2026-11-06').ok);
    assert.equal(app.dayView().sticker.vouchers, 1);
    app.useCheat('2026-11-05');
    app.addMeal('2026-11-05', { name: 'x', kcal: 100 });
    assert.equal(app.cancelCheat('2026-11-05').reason, 'consumed');
    assert.equal(app.cancelCheat('2026-11-01').reason, 'none');
  });
  test('과거 체중 수정으로 스티커는 회수되지만 발급된 치팅데이는 회수되지 않는다', () => {
    const app = onboard(makeApp());
    goodDays(app, 9);
    assert.equal(app.dayView().sticker.vouchers, 1);
    // 어제 체중을 크게 올려 스티커 취소 (목표 +1 이상 → 단식 → 스티커 없음)
    app.setWeight('2026-11-04', 79.5, { confirmed: true });
    const v = app.dayView();
    assert.equal(v.sticker.total, 9);
    assert.equal(v.sticker.count, 9);
    assert.equal(v.sticker.vouchers, 1, '발급 유지');
  });
  test('단식 판정일·미등록일에는 스티커를 주지 않는다', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-28');
    app.setWeight('2026-10-28', 79.0);
    assert.equal(app.dayView().judge.sticker, false);
    app._travel('2026-10-29');
    assert.equal(app.dayView().judge.sticker, false);
    assert.equal(app.dayView().sticker.total, 1);
  });
});

describe('R-10 단식 (상태 통합)', () => {
  test('목표 +1.0 이상이면 단식 모드: 창 19:00~20:00, 창 밖 식사는 미이행', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-28');
    app.setWeight('2026-10-28', 79.0);
    let v = app.dayView();
    assert.equal(v.judge.status, 'fasting');
    assert.deepEqual([v.fasting.start, v.fasting.end, v.fasting.broken], ['19:00', '20:00', false]);
    assert.equal(v.budget.budget, 800);
    app.addMeal('2026-10-28', { name: 'dinner', kcal: 500, time: '19:20' });
    assert.equal(app.dayView().fasting.broken, false);
    app.addMeal('2026-10-28', { name: 'snack', kcal: 100, time: '15:00' });
    assert.equal(app.dayView().fasting.broken, true);
  });
  test('단식 창 시작 시각을 그날만 바꿀 수 있다', () => {
    const app = onboard(makeApp());
    app._travel('2026-10-28');
    app.setWeight('2026-10-28', 79.0);
    app.setFastingWindow('2026-10-28', '12:00');
    assert.equal(app.dayView().fasting.start, '12:00');
    assert.equal(app.state.settings.fastingWindowStart, '19:00', '기본값은 유지');
  });
  test('치팅데이 다음 날은 단식 면제', () => {
    const app = onboard(makeApp());
    for (let i = 1; i <= 9; i++) { const d = addDays(T0, i); app._travel(d); app.setWeight(d, 78 - 0.2 * i); }
    app.useCheat('2026-11-05');
    app._travel('2026-11-06');
    app.setWeight('2026-11-06', 79.0, { confirmed: true });
    assert.notEqual(app.dayView().judge.status, 'fasting');
  });
  test('연속 단식 3일째는 reset 제안 (단식 아님)', () => {
    const app = onboard(makeApp());
    for (const d of ['2026-10-28', '2026-10-29', '2026-10-30']) { app._travel(d); app.setWeight(d, 79.5); }
    assert.equal(app.judgeUpTo('2026-10-30')['2026-10-28'].status, 'fasting');
    assert.equal(app.judgeUpTo('2026-10-30')['2026-10-29'].status, 'fasting');
    assert.equal(app.dayView().judge.status, 'reset');
    assert.equal(app.dayView().fasting, null);
  });
});

describe('R-14 그래프 데이터', () => {
  test('30일 rows 에 실측·추세·목표·섭취·예산·판정이 들어가고 forecast 는 31점', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 1400 });
    const g = app.graphData();
    assert.equal(g.rows.length, 30);
    const last = g.rows[29];
    assert.equal(last.date, T0); assert.equal(last.weight, 78); assert.equal(last.target, 78); assert.equal(last.intake, 1400);
    assert.equal(last.budget, 1400); assert.ok(last.sticker); assert.equal(last.status, 'pass');
    assert.equal(g.forecast.length, 31); assert.equal(g.forecast[0].date, T0);
    assert.equal(g.targetWeight, 73);
    assert.equal(g.rows[0].weight, null, '기록 없는 날은 null');
  });
  test('예측 정확도: 14일 전 스냅샷과 오늘 추세의 평균 오차', () => {
    const app = onboard(makeApp());
    app.state.snapshots[addDays(T0, -14)] = 77.0;
    const g = app.graphData();
    assert.equal(g.snapshotsN, 1);
    assert.equal(g.meanErr, 1.0);
  });
});

describe('R-13 백업·복원', () => {
  test('export → import(replace) 로 동일 상태가 복원된다', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 100 });
    app.toggleFavorite('rice');
    const json = app.exportJson();
    const app2 = makeApp({ backing: memoryBacking() });
    const r = app2.importJson(json, 'replace');
    assert.ok(r.ok);
    assert.deepEqual(r.summary, { weights: 1, meals: 1, workouts: 0, exercises: 0, customs: 0 });
    assert.equal(app2.state.weights[T0], 78);
    assert.deepEqual(app2.state.favorites, ['rice']);
    assert.equal(app2.state.goal.targetWeight, 73);
  });
  test('merge 는 기존 데이터를 지우지 않고 중복 없이 합친다', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 100 });
    const json = app.exportJson();
    const app2 = onboard(makeApp());
    app2.addMeal(T0, { name: 'b', kcal: 200 });
    app2.importJson(json, 'merge');
    assert.equal(app2.state.meals[T0].length, 2);
    app2.importJson(json, 'merge');
    assert.equal(app2.state.meals[T0].length, 2, '같은 id 는 다시 넣지 않는다');
  });
  test('형식이 틀린 파일은 아무것도 바꾸지 않고 오류', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 100 });
    assert.equal(app.importJson('{bad', 'replace').reason, 'parse');
    assert.equal(app.importJson('{"app":"other","data":{}}', 'replace').reason, 'format');
    assert.equal(app.importJson('{"app":"diet","data":{"weights":{}}}', 'replace').reason, 'format', 'version 없음');
    assert.equal(app.state.meals[T0].length, 1);
    assert.equal(app.parseImport('{"app":"diet","data":{"version":1}}').ok, true);
  });
  test('구버전/필드 누락 데이터는 migrate 가 기본값으로 채운다', () => {
    const m = migrate({ version: 1, weights: { [T0]: 78 } });
    assert.equal(m.settings.tdee, 2300);
    assert.ok(Array.isArray(m.settings.workoutVersions));
    assert.deepEqual(m.cheat, { scheduled: {}, vouchersIssued: 0, vouchersUsed: 0 });
    assert.equal(m.weights[T0], 78);
  });
  test('reset 은 저장소까지 비운다', () => {
    const app = onboard(makeApp());
    app.reset();
    assert.equal(app.state.onboarded, false);
    assert.equal(app.state.goal, null);
  });
  test('저장 실패 시 save_failed 이벤트가 난다', () => {
    const b = memoryBacking();
    b.setItem = () => { throw new Error('quota'); };
    const app = createApp({ storage: createStorage(b, 'k'), now: () => at(T0) });
    app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    assert.ok(app.events.some(e => e.name === 'save_failed'));
    assert.equal(app.state.weights[T0], 78, '메모리에서는 계속 동작');
  });
});

describe('통계 (5절 지표)', () => {
  test('기록률·준수율·하한 위반 0건', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: 'a', kcal: 1000 });
    app._travel('2026-10-28');
    app.setWeight('2026-10-28', 77.8);
    app.addMeal('2026-10-28', { name: 'b', kcal: 2000 });
    const s = app.stats();
    assert.equal(s.days, 2); assert.equal(s.weightRate, 1); assert.equal(s.mealRate, 1);
    assert.equal(s.budgetRate, 0.5);
    assert.equal(s.floorViolations, 0);
    assert.equal(s.stickers, 2);
  });
  test('목표가 없으면 null', () => {
    assert.equal(makeApp().stats(), null);
  });
});

describe('emptyState', () => {
  test('초기 상태는 온보딩 전, 기본 운동 5종, 리마인더 기본값', () => {
    const s = emptyState();
    assert.equal(s.onboarded, false);
    assert.equal(s.settings.workoutVersions[0].items.length, CONFIG.workouts.length);
    assert.equal(s.settings.reminders.weight.at, '07:00');
  });
});

describe('R-16 자유 운동 기록', () => {
  test('운동을 기록하면 그날 운동 kcal 에 더해지고 예산이 그만큼 늘어난다', () => {
    const app = onboard(makeApp());
    const before = app.dayView().budget.raw;
    const r = app.addExercise(T0, { exerciseId: 'run-km', name: '달리기 (거리)', unit: 'km', amount: 5, kcalPerUnit: 78, time: '07:30' });
    assert.ok(r.ok); assert.equal(r.entry.kcal, 390);
    const v = app.dayView();
    assert.equal(v.workout.extraKcal, 390); assert.equal(v.workout.kcal, 390); assert.equal(v.workout.checklistKcal, 0);
    assert.equal(v.workout.logs.length, 1);
    assert.equal(v.budget.raw, before + 390, '예산 반영 (하한 적용 전 값)');
    assert.equal(v.workout.rate, 0, '체크리스트 완료율은 그대로');
    assert.ok(app.events.some(e => e.name === 'exercise_logged'));
  });
  test('kcal 는 추세 체중에 비례한다 (78kg 기준 DB 값)', () => {
    const app = onboard(makeApp(), 39);
    const r = app.addExercise(T0, { exerciseId: 'pushup', name: '팔굽혀펴기', unit: '회', amount: 200, kcalPerUnit: 0.4 });
    assert.equal(r.entry.kcal, 40);
  });
  test('수량을 바꾸면 kcal 가 다시 계산되고, 삭제 후 되돌리기가 된다', () => {
    const app = onboard(makeApp());
    const { entry } = app.addExercise(T0, { exerciseId: 'walk', name: '걷기 (보통)', unit: '분', amount: 30, kcalPerUnit: 4.8 });
    assert.equal(entry.kcal, 144);
    app.updateExercise(T0, entry.id, { amount: 60 });
    assert.equal(app.state.exercises[T0][0].kcal, 288);
    const r = app.removeExercise(T0, entry.id);
    assert.ok(r.ok); assert.equal(app.state.exercises[T0], undefined);
    r.restore();
    assert.equal(app.state.exercises[T0].length, 1);
    assert.equal(app.dayView().workout.kcal, 288);
  });
  test('직접 입력 운동: 이름·단위·단위당 kcal 로 등록하고 검색·기록에 쓴다', () => {
    const app = onboard(makeApp());
    assert.ok(!app.addCustomExercise({ name: '', unit: '분', kcal: 5 }).ok);
    assert.ok(!app.addCustomExercise({ name: 'x', unit: '시간', kcal: 5 }).ok);
    const r = app.addCustomExercise({ name: '동네 한 바퀴', unit: '분', kcal: 6 });
    assert.ok(r.ok); assert.ok(r.exercise.custom); assert.equal(r.exercise.amount, 30);
    assert.equal(app.findExercise(r.exercise.id).name, '동네 한 바퀴');
    const e = app.addExercise(T0, { exerciseId: r.exercise.id, name: r.exercise.name, unit: '분', amount: 20, kcalPerUnit: 6 });
    assert.equal(e.entry.kcal, 120);
    assert.ok(app.toggleExerciseFavorite(r.exercise.id)); assert.ok(app.recentExerciseIds().has(r.exercise.id));
  });
  test('기록 목록은 최근에 추가한 것이 위에 오고, 직접 입력 운동 종류는 삭제·되돌리기가 되며 기존 기록은 남는다', () => {
    const app = onboard(makeApp());
    const cx = app.addCustomExercise({ name: '내 운동', unit: '분', kcal: 5 });
    app.toggleExerciseFavorite(cx.exercise.id);
    app.addExercise(T0, { exerciseId: cx.exercise.id, name: '내 운동', unit: '분', amount: 10, kcalPerUnit: 5, time: '09:00' });
    app.addExercise(T0, { name: '둘째', unit: '회', amount: 1, kcal: 10, time: '07:00' });
    assert.deepEqual(app.dayView(T0).workout.logs.map(e => e.name), ['둘째', '내 운동'], '나중에 추가한 것이 먼저');
    const r = app.removeCustomExercise(cx.exercise.id);
    assert.ok(r.ok); assert.equal(app.state.customExercises.length, 0); assert.deepEqual(app.state.exerciseFavorites, []);
    assert.equal(app.state.exercises[T0].length, 2, '기록은 그대로'); assert.equal(app.dayView(T0).workout.kcal, 60);
    r.restore(); assert.equal(app.state.customExercises.length, 1);
    assert.equal(app.removeCustomExercise('nope').ok, false);
  });
  test('총 kcal 만 아는 운동도 기록할 수 있다 (kcalPerUnit 없이)', () => {
    const app = onboard(makeApp());
    const r = app.addExercise(T0, { name: '스마트워치 기록', unit: '회', amount: 1, kcal: 250 });
    assert.ok(r.ok); assert.equal(r.entry.kcal, 250);
    assert.ok(!app.addExercise(T0, { name: '없음', unit: '회', amount: 1 }).ok, 'kcal 도 kcalPerUnit 도 없으면 거부');
    assert.ok(!app.addExercise(T0, { name: 'x', unit: '회', amount: 0, kcalPerUnit: 1 }).ok, '수량 0 거부');
  });
  test('7일 지난 날짜와 하루 30건 초과는 거부한다', () => {
    const app = onboard(makeApp());
    app._travel('2026-11-10');
    assert.equal(app.addExercise('2026-11-01', { name: 'x', unit: '회', amount: 1, kcal: 10 }).reason, 'not-editable');
    for (let i = 0; i < 30; i++) assert.ok(app.addExercise('2026-11-10', { name: 'x', unit: '회', amount: 1, kcal: 10 }).ok);
    assert.equal(app.addExercise('2026-11-10', { name: 'x', unit: '회', amount: 1, kcal: 10 }).reason, 'limit');
  });
  test('운동 기록은 예측(7일 평균 적자)과 그래프 행(workoutKcal)에 반영된다', () => {
    const app = onboard(makeApp());
    app.addMeal(T0, { name: '밥', kcal: 1500 });
    const p0 = app.prediction(T0).avgDeficit;
    app.addExercise(T0, { name: '달리기', unit: '분', amount: 30, kcalPerUnit: 10 });
    assert.equal(app.prediction(T0).avgDeficit, p0 + 300);
    const row = app.graphData(T0, 1).rows[0];
    assert.equal(row.workoutKcal, 300); assert.equal(row.exerciseKcal, 300);
  });
  test('기존 v1 저장 데이터를 열면 체중·식사·체크리스트·설정이 그대로이고 운동 기록 필드만 추가된다 (데이터 보존)', () => {
    const backing = memoryBacking();
    const v1 = { version: 1, updatedAt: 5, onboarded: true, settings: { tdee: 2250, tdeeHistory: [{ date: T0, from: 2300, to: 2250, reason: 'manual' }], profile: { sex: 'male', height: 175, age: 40 }, floor: 1400, fastingThreshold: 1, stickerTolerance: 0.5, fastingWindowStart: '19:00', workoutVersions: [{ from: '0000-01-01', items: CONFIG.workouts.map(w => ({ ...w })) }], reminders: { weight: { on: true, at: '07:00' }, workout: { on: true, at: '21:00' } }, lastCalibration: null, lastPlateauPrompt: null },
      goal: { startDate: T0, startWeight: 78, targetWeight: 73, periodDays: 30, endDate: '2026-11-26' }, goalHistory: [], weights: { [T0]: 78, '2026-10-28': 77.6 },
      meals: { [T0]: [{ id: 'm1', foodId: 'rice', name: '흰쌀밥 1공기', kcal: 310, serving: '210g', portion: 1, time: '08:00' }] }, workouts: { [T0]: { pushup: { done: true } } },
      fastingWindow: {}, customs: [{ id: 'custom-1', name: '엄마표', kcal: 300, serving: '1인분', custom: true }], favorites: ['rice'], cheat: { scheduled: {}, vouchersIssued: 0, vouchersUsed: 0 }, snapshots: { [T0]: 77.9 }, pendingSuggestion: null };
    backing.setItem('test', JSON.stringify(v1));
    const app = makeApp({ date: '2026-10-28', backing });
    const s = app.state;
    assert.equal(s.version, 2);
    assert.deepEqual(s.weights, v1.weights); assert.deepEqual(s.meals, v1.meals); assert.deepEqual(s.workouts, v1.workouts);
    assert.deepEqual(s.customs, v1.customs); assert.deepEqual(s.favorites, v1.favorites); assert.deepEqual(s.snapshots, v1.snapshots);
    assert.equal(s.settings.tdee, 2250); assert.deepEqual(s.settings.profile, v1.settings.profile); assert.deepEqual(s.goal, v1.goal);
    assert.deepEqual(s.exercises, {}); assert.deepEqual(s.customExercises, []); assert.deepEqual(s.exerciseFavorites, []);
    // 기록을 추가해도 기존 값은 그대로
    app.addExercise('2026-10-28', { name: '걷기', unit: '분', amount: 10, kcalPerUnit: 4.8 });
    const saved = JSON.parse(backing.getItem('test'));
    assert.deepEqual(saved.weights, v1.weights); assert.deepEqual(saved.meals, v1.meals); assert.equal(saved.exercises['2026-10-28'].length, 1);
  });
  test('병합(동기화·가져오기)은 운동 기록을 id 기준 합집합으로 합치고 사용자 운동·즐겨찾기도 합친다', () => {
    const a = onboard(makeApp());
    a.addExercise(T0, { name: 'A', unit: '회', amount: 1, kcal: 10 });
    const b = onboard(makeApp());
    b.addExercise(T0, { name: 'B', unit: '회', amount: 1, kcal: 20 });
    const cx = b.addCustomExercise({ name: '커스텀', unit: '분', kcal: 5 }); b.toggleExerciseFavorite(cx.exercise.id);
    const r = a.importJson(b.exportJson(), 'merge');
    assert.ok(r.ok); assert.equal(r.summary.exercises, 1);
    assert.equal(a.state.exercises[T0].length, 2);
    assert.equal(a.state.customExercises.length, 1); assert.deepEqual(a.state.exerciseFavorites, [cx.exercise.id]);
    a.importJson(b.exportJson(), 'merge');
    assert.equal(a.state.exercises[T0].length, 2, '중복 없음');
  });
});
