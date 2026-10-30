import { describe, test, assert } from './harness.mjs';
import { CONFIG } from '../src/config.js';
import * as C from '../src/calc.js';

describe('날짜 유틸', () => {
  test('addDays / daysBetween 가 월 경계를 넘어도 맞는다', () => {
    assert.equal(C.addDays('2026-10-27', 30), '2026-11-26');
    assert.equal(C.daysBetween('2026-10-27', '2026-11-26'), 30);
    assert.equal(C.daysBetween('2026-11-26', '2026-10-27'), -30);
  });
  test('토·일 판정', () => {
    assert.ok(C.isWeekend('2026-10-31'), '토요일');
    assert.ok(C.isWeekend('2026-11-01'), '일요일');
    assert.ok(!C.isWeekend('2026-10-27'), '화요일');
  });
});

describe('R-3 롤링 30일 목표와 목표 경로', () => {
  const goal = C.makeGoal('2026-10-27', 78.0);
  test('목표 기한은 설정일 + 30일, 목표 체중 기본 73.0', () => {
    assert.equal(goal.endDate, '2026-11-26');
    assert.equal(goal.targetWeight, 73.0);
  });
  test('78.0→73.0 선형 경로: 10일째 목표 76.3kg', () => {
    assert.equal(C.targetWeightOn(goal, '2026-11-06'), 76.3);
    assert.equal(C.targetWeightOn(goal, '2026-10-27'), 78.0);
  });
  test('기한(30일째)에 목표 체중, 그 이후에도 목표 체중으로 고정', () => {
    assert.equal(C.targetWeightOn(goal, '2026-11-26'), 73.0);
    assert.equal(C.targetWeightOn(goal, '2026-12-25'), 73.0);
  });
  test('시작일 이전 날짜는 시작 체중', () => {
    assert.equal(C.targetWeightOn(goal, '2026-10-20'), 78.0);
  });
  test('시작 체중 ≤ 목표 체중이면 유지 모드: 일별 목표 = 목표 체중', () => {
    const g = C.makeGoal('2026-10-27', 72.5);
    assert.equal(C.targetWeightOn(g, '2026-11-06'), 73.0);
  });
  test('남은 일수는 음수가 되지 않는다', () => {
    assert.equal(C.daysRemaining(goal, '2026-11-06'), 20);
    assert.equal(C.daysRemaining(goal, '2026-12-25'), 0);
  });
});

describe('R-2 아침 체중 등록 — 검증·추세', () => {
  test('입력 범위 30.0~250.0kg 밖이면 거부', () => {
    assert.equal(C.validateWeight(7.8).ok, false);
    assert.equal(C.validateWeight(7.8).reason, 'range');
    assert.equal(C.validateWeight(780).reason, 'range');
    assert.equal(C.validateWeight(NaN).reason, 'invalid');
    assert.equal(C.validateWeight(30).ok, true);
    assert.equal(C.validateWeight(250).ok, true);
  });
  test('직전 기록 대비 ±5kg 초과면 확인을 요구한다', () => {
    assert.equal(C.validateWeight(84.1, 78).confirm, 'delta');
    assert.equal(C.validateWeight(83, 78).confirm, undefined);
  });
  test('추세 체중 = 기록이 있는 날 기준 최근 7일 평균', () => {
    const w = { '2026-10-27': 78.0, '2026-10-26': 78.4, '2026-10-24': 78.8, '2026-10-19': 90 };
    assert.equal(C.trendWeight(w, '2026-10-27'), 78.4);
  });
  test('기록이 없으면 추세 체중 null', () => {
    assert.equal(C.trendWeight({}, '2026-10-27'), null);
  });
  test('lastWeightBefore 는 당일을 제외한 가장 최근 기록', () => {
    const w = { '2026-10-27': 78.0, '2026-10-25': 78.5 };
    assert.equal(C.lastWeightBefore(w, '2026-10-27'), 78.5);
    assert.equal(C.lastWeightBefore(w, '2026-10-25'), null);
  });
});

describe('R-9 칭찬 스티커 판정', () => {
  test('오늘 체중 ≤ 목표 + 0.5kg 이면 스티커', () => {
    const j = C.judgeDay({ weight: 77.5, prevWeight: 77.4, target: 77.0 });
    assert.equal(j.status, 'pass'); assert.equal(j.sticker, true);
  });
  test('목표 + 0.5 초과여도 어제보다 줄었으면 스티커', () => {
    const j = C.judgeDay({ weight: 77.8, prevWeight: 77.9, target: 77.0 });
    assert.equal(j.sticker, true);
  });
  test('목표 + 0.5 초과이고 어제보다 줄지 않았으면 스티커 없음(fail)', () => {
    const j = C.judgeDay({ weight: 77.8, prevWeight: 77.8, target: 77.0 });
    assert.equal(j.status, 'fail'); assert.equal(j.sticker, false);
  });
  test('체중 미등록일은 판정 보류(missing), 스티커 없음', () => {
    const j = C.judgeDay({ weight: null, prevWeight: 77, target: 77 });
    assert.equal(j.status, 'missing'); assert.equal(j.sticker, false);
  });
  test('치팅데이 당일은 status=cheat, 체중 기준 스티커 판정은 그대로', () => {
    assert.equal(C.judgeDay({ weight: 77.2, prevWeight: 77.5, target: 77, cheat: true }).sticker, true);
    assert.equal(C.judgeDay({ weight: 78.5, prevWeight: 77.5, target: 77, cheat: true }).status, 'cheat');
  });
});

describe('R-10 23시간 단식 트리거', () => {
  test('오늘 체중 ≥ 목표 + 1.0kg 이면 단식일, 스티커 없음', () => {
    const j = C.judgeDay({ weight: 78.0, prevWeight: 77, target: 77.0 });
    assert.equal(j.status, 'fasting'); assert.equal(j.sticker, false);
  });
  test('목표 + 0.9kg 은 단식이 아니다', () => {
    assert.equal(C.judgeDay({ weight: 77.9, prevWeight: 77.9, target: 77.0 }).status, 'fail');
  });
  test('치팅데이 다음 날은 단식 판정 면제', () => {
    const j = C.judgeDay({ weight: 78.5, prevWeight: 77, target: 77.0, prevCheat: true });
    assert.notEqual(j.status, 'fasting');
    assert.equal(j.status, 'fail');
  });
  test('연속 단식 2일 뒤 3일째도 조건이면 단식 대신 reset 제안', () => {
    assert.equal(C.judgeDay({ weight: 78.5, prevWeight: 78.5, target: 77, consecutiveFasting: 1 }).status, 'fasting');
    assert.equal(C.judgeDay({ weight: 78.5, prevWeight: 78.5, target: 77, consecutiveFasting: 2 }).status, 'reset');
  });
  test('단식 창은 시작 시각부터 1시간 (기본 19:00~20:00)', () => {
    assert.deepEqual(C.fastingWindow(), { start: '19:00', end: '20:00' });
    assert.deepEqual(C.fastingWindow('23:30'), { start: '23:30', end: '00:30' });
    assert.ok(C.inFastingWindow('19:30', '19:00'));
    assert.ok(!C.inFastingWindow('20:00', '19:00'));
    assert.ok(!C.inFastingWindow('12:00', '19:00'));
  });
  test('단식일 예산은 800kcal 고정', () => {
    const b = C.dailyBudget({ tdee: 2300, trend: 78, targetWeight: 73, remaining: 30, status: 'fasting' });
    assert.equal(b.budget, 800);
    assert.equal(b.shortfall, 0);
  });
});

describe('R-4 오늘의 식사 kcal 예산', () => {
  test('필요 감량 = (추세 − 목표) × 7700 ÷ 남은 일수 (78→73, 30일 = 1283)', () => {
    assert.equal(C.requiredDeficit(78, 73, 30), 1283);
    assert.equal(C.requiredDeficit(73, 73, 30), 0, '목표 도달이면 0');
    assert.equal(C.requiredDeficit(null, 73, 30), 0);
  });
  test('예산 = TDEE + 운동 − 필요 감량, 하한 1400 아래로 내려가지 않고 부족분을 알려 준다', () => {
    const b = C.dailyBudget({ tdee: 2300, trend: 78, targetWeight: 73, remaining: 30 });
    assert.equal(b.raw, 1017);
    assert.equal(b.budget, 1400);
    assert.equal(b.shortfall, 383);
  });
  test('운동을 체크하면 그 kcal만큼 예산이 늘고 부족분이 줄어든다', () => {
    const b = C.dailyBudget({ tdee: 2300, trend: 78, targetWeight: 73, remaining: 30, workoutKcal: 220 });
    assert.equal(b.raw, 1237);
    assert.equal(b.shortfall, 163);
    const b2 = C.dailyBudget({ tdee: 2300, trend: 78, targetWeight: 73, remaining: 30, workoutKcal: 600 });
    assert.equal(b2.budget, 1617);
    assert.equal(b2.shortfall, 0);
  });
  test('하한 위에서는 예산이 raw 값 그대로', () => {
    const b = C.dailyBudget({ tdee: 2600, trend: 75, targetWeight: 73, remaining: 20 });
    assert.equal(b.deficit, 770);
    assert.equal(b.budget, 1830);
  });
  test('치팅데이에는 예산을 제시하지 않는다(null)', () => {
    assert.equal(C.dailyBudget({ tdee: 2300, trend: 78, targetWeight: 73, remaining: 30, status: 'cheat' }).budget, null);
  });
  test('유지 모드(추세 ≤ 목표)에서는 필요 감량 0, 예산 = TDEE + 운동', () => {
    const b = C.dailyBudget({ tdee: 2300, trend: 72.8, targetWeight: 73, remaining: 10, workoutKcal: 100 });
    assert.equal(b.deficit, 0);
    assert.equal(b.budget, 2400);
  });
  test('TDEE 보정: 실제 소비를 역산하되 1회 ±150 제한', () => {
    // 7일간 추세 78.0 → 77.5 (-0.5kg = 550kcal/일), 평균 섭취 1500, 운동 100 → 실제 TDEE = 550+1500-100 = 1950
    const r = C.calibrateTdee({ tdee: 2300, trendStart: 78.0, trendEnd: 77.5, days: 7, avgIntake: 1500, avgWorkout: 100 });
    assert.equal(r.actual, 1950);
    assert.equal(r.tdee, 2150, '−150 제한');
    assert.ok(r.changed);
    const up = C.calibrateTdee({ tdee: 2300, trendStart: 78.0, trendEnd: 76.0, days: 7, avgIntake: 2000, avgWorkout: 0 });
    assert.equal(up.tdee, 2450, '+150 제한');
  });
  test('TDEE 보정: 추세 기록이 없으면 변경 없음', () => {
    const r = C.calibrateTdee({ tdee: 2300, trendStart: null, trendEnd: 77, days: 7, avgIntake: 1500, avgWorkout: 0 });
    assert.equal(r.changed, false); assert.equal(r.tdee, 2300);
  });
  test('TDEE 초기 추정: Mifflin-St Jeor × 1.4, 입력 생략 시 2300', () => {
    assert.equal(C.estimateTdee({}), 2300);
    // 남 78kg 175cm 40세: BMR = 780 + 1093.75 - 200 + 5 = 1678.75 → ×1.4 = 2350
    assert.equal(C.estimateTdee({ sex: 'male', weight: 78, height: 175, age: 40 }), 2350);
    assert.equal(C.estimateTdee({ sex: 'female', weight: 60, height: 160, age: 30 }), Math.round((600 + 1000 - 150 - 161) * 1.4));
  });
});

describe('R-5 운동 체크리스트', () => {
  test('평일은 4종, 토·일에는 5km 달리기가 추가된다', () => {
    assert.equal(C.workoutItemsFor('2026-10-27').length, 4);
    const sat = C.workoutItemsFor('2026-10-31');
    assert.equal(sat.length, 5);
    assert.ok(sat.some(w => w.id === 'run5k'));
  });
  test('수행 개수 ≥ 목표면 완료, 부분 수행은 kcal 비례', () => {
    const s = C.workoutSummary('2026-10-27', { pushup: { count: 200 }, situp: { count: 100 } });
    const pushup = s.rows.find(r => r.id === 'pushup'), situp = s.rows.find(r => r.id === 'situp');
    assert.ok(pushup.complete); assert.equal(pushup.kcal, 80);
    assert.ok(!situp.complete); assert.equal(situp.kcal, 30);
    assert.equal(s.done, 1); assert.equal(s.total, 4); assert.equal(s.rate, 0.375, '완료율 = (1 + 0.5 + 0 + 0) / 4');
  });
  test('부분 수행도 완료율에 비례 반영: 200개 중 50개면 그 항목은 1/4 (하루 4항목이면 1/16)', () => {
    const s = C.workoutSummary('2026-10-27', { pushup: { count: 50 } });
    assert.equal(s.rows.find(r => r.id === 'pushup').ratio, 0.25);
    assert.equal(s.rate, 0.0625); assert.equal(s.done, 0);
    const half = C.workoutSummary('2026-10-27', { pushup: { count: 100 }, situp: { count: 100 }, chest: { count: 50 }, shoulder: { count: 50 } });
    assert.equal(half.rate, 0.5, '전부 절반씩이면 50%');
    assert.equal(C.workoutSummary('2026-10-27', { pushup: { count: 400 } }).rate, 0.25, '초과 수행은 1배 상한');
  });
  test('done 체크는 목표 개수로 간주한다', () => {
    const s = C.workoutSummary('2026-10-27', { chest: { done: true } });
    assert.equal(s.rows.find(r => r.id === 'chest').kcal, 40);
  });
  test('목표 초과 수행은 kcal 비례 상한 1배', () => {
    const s = C.workoutSummary('2026-10-27', { pushup: { count: 400 } });
    assert.equal(s.rows.find(r => r.id === 'pushup').kcal, 80);
  });
  test('아무것도 체크하지 않은 날은 완료율 0', () => {
    const s = C.workoutSummary('2026-10-27', {});
    assert.equal(s.rate, 0); assert.equal(s.kcal, 0);
    assert.equal(s.fullKcal, 220, '평일 전체 kcal');
  });
  test('주말 전체 완료 시 kcal = 220 + 390', () => {
    const s = C.workoutSummary('2026-10-31', { pushup: { done: true }, situp: { done: true }, chest: { done: true }, shoulder: { done: true }, run5k: { done: true, slot: 'morning' } });
    assert.equal(s.kcal, 610); assert.equal(s.rate, 1);
    assert.equal(s.rows.find(r => r.id === 'run5k').slot, 'morning');
  });
  test('운동 kcal는 체중 비례로 환산된다 (78kg 기준)', () => {
    assert.equal(C.scaleKcal(390, 78), 390);
    assert.equal(C.scaleKcal(390, 39), 195);
    assert.equal(C.scaleKcal(390, null), 390);
  });
});

describe('R-6 30일 뒤 예상 체중', () => {
  test('예상 = 추세 − (평균 순적자 × 30) ÷ 7700', () => {
    assert.equal(C.predictWeight(78, 770), 75.0);
    assert.equal(C.predictWeight(78, -770), 81.0, '잉여면 올라간다');
  });
  test('기록이 0일이면 평균 null → 예측 null', () => {
    assert.deepEqual(C.avgNetDeficit(2300, []), { avg: null, n: 0 });
    assert.equal(C.predictWeight(78, null), null);
    assert.equal(C.predictWeight(null, 500), null);
    assert.deepEqual(C.predictPath(null, 500), []);
  });
  test('7일 미만이면 기록된 날만으로 평균 (logged=false 제외)', () => {
    const days = [
      { intake: 1500, workoutKcal: 200, logged: true },
      { intake: 0, workoutKcal: 0, logged: false },
      { intake: 1700, workoutKcal: 0, logged: true },
    ];
    const r = C.avgNetDeficit(2300, days);
    assert.equal(r.n, 2);
    assert.equal(r.avg, ((2300 + 200 - 1500) + (2300 - 1700)) / 2);
  });
  test('예상 경로는 0일(추세)부터 30일까지 31개 점', () => {
    const p = C.predictPath(78, 770);
    assert.equal(p.length, 31); assert.equal(p[0], 78); assert.equal(p[30], 75.0);
  });
  test('경로 복귀 필요 kcal = (예상 − 목표) × 7700 ÷ 30, 목표 아래면 0', () => {
    assert.equal(C.gapToTarget(74.2, 73), Math.round(1.2 * 7700 / 30));
    assert.equal(C.gapToTarget(72, 73), 0);
    assert.equal(C.gapToTarget(null, 73), 0);
  });
});

describe('R-7 "이대로 가면?" 시뮬레이션', () => {
  test('섭취·운동 완료율로 30일 뒤를 계산한다', () => {
    const r = C.simulate({ trend: 78, tdee: 2300, intake: 1400, completionRate: 1, fullWorkoutKcal: 220 });
    assert.equal(r.deficit, 1120);
    assert.equal(r.predicted, C.predictWeight(78, 1120));
    assert.equal(r.path.length, 31);
  });
  test('폭식+운동 안 함 프리셋(평균 + 800, 운동 0%)이면 예상 체중이 시작보다 올라간다', () => {
    const avg = 2200;
    const r = C.simulate({ trend: 78, tdee: 2300, intake: avg + CONFIG.simulation.bingeExtra, completionRate: 0, fullWorkoutKcal: 220 });
    assert.above(r.predicted, 78);
  });
});

describe('R-8 정체 시 운동 추가 제안', () => {
  test('예산 5일 이상 준수 + 감소량이 경로의 50% 미만이면 정체, 부족 kcal 와 구체 운동 제안', () => {
    const r = C.plateauCheck({ adherenceDays: 5, trendDrop: 0.3, expectedDrop: 1.17 });
    assert.ok(r.plateau);
    assert.equal(r.kcalPerDay, Math.round((1.17 - 0.3) * 7700 / 7));
    assert.equal(r.suggestion.id, 'run20');
    // 제안은 하루 상한(maxSessions)까지만 커진다 — 957kcal 부족이면 3회(60분, 750kcal)로 캡
    assert.equal(r.suggestion.target, CONFIG.suggestedWorkout.target * CONFIG.suggestedWorkout.maxSessions);
    assert.equal(r.suggestion.kcal, CONFIG.suggestedWorkout.kcal * CONFIG.suggestedWorkout.maxSessions);
    const small = C.plateauCheck({ adherenceDays: 5, trendDrop: 0.55, expectedDrop: 1.17 });
    assert.atLeast(small.suggestion.kcal, small.kcalPerDay);
  });
  test('준수일이 5일 미만이면 운동 제안을 하지 않는다', () => {
    const r = C.plateauCheck({ adherenceDays: 4, trendDrop: 0, expectedDrop: 1.17 });
    assert.equal(r.plateau, false); assert.equal(r.reason, 'adherence');
  });
  test('경로의 50% 이상 빠졌으면 정체가 아니다', () => {
    assert.equal(C.plateauCheck({ adherenceDays: 7, trendDrop: 0.6, expectedDrop: 1.17 }).plateau, false);
  });
  test('유지 모드(기대 감량 0)에서는 판정하지 않는다', () => {
    assert.equal(C.plateauCheck({ adherenceDays: 7, trendDrop: 0, expectedDrop: 0 }).reason, 'no-goal');
  });
  test('체중이 늘었을 때(음수 감소)도 부족분은 기대 감량 전체로 계산한다', () => {
    const r = C.plateauCheck({ adherenceDays: 6, trendDrop: -0.4, expectedDrop: 1.17 });
    assert.equal(r.kcalPerDay, Math.round(1.17 * 7700 / 7));
  });
});
