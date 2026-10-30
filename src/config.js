// 튠 값. PRD 부록 A/B/D의 [가정] 수치가 모두 여기에 모여 있다. 설정 화면에서 바꿀 수 있는 값은 state.settings가 덮어쓴다.

export const CONFIG = Object.freeze({
  schemaVersion: 2,           // v2: 운동 기록(exercises)·운동 즐겨찾기 추가. 저장 키는 그대로 — 기존 데이터는 그대로 읽고 새 필드만 채운다.
  storageKey: 'diet.v1',

  goal: Object.freeze({
    baselineWeight: 78.0,
    targetWeight: 73.0,
    periodDays: 30,
  }),

  kcalPerKg: 7700,
  defaultTdee: 2300,
  activityFactor: 1.4,
  tdeeCalibration: Object.freeze({ everyDays: 7, maxStep: 150 }),

  budget: Object.freeze({
    floor: 1400,        // 안전 하한 (R-4)
    fastingDay: 800,    // 단식일 고정 예산 (R-10)
  }),

  judge: Object.freeze({
    stickerTolerance: 0.5,   // 오늘 체중 <= 목표 + 0.5 → 스티커 (R-9)
    fastingThreshold: 1.0,   // 오늘 체중 >= 목표 + 1.0 → 단식 (R-10)
    maxConsecutiveFasting: 2,
    stickersPerVoucher: 10,
    maxVouchers: 3,
    maintenanceReentry: 1.0, // 유지 모드에서 목표 + 1.0 초과 → 감량 재진입 제안
  }),

  fasting: Object.freeze({ defaultWindowStart: '19:00', windowHours: 1 }),

  plateau: Object.freeze({ minAdherenceDays: 5, dropRatio: 0.5, cooldownDays: 7 }),

  weight: Object.freeze({ min: 30, max: 250, confirmDelta: 5, editableDays: 7, trendDays: 7 }),
  meals: Object.freeze({ maxPerDay: 50, editableDays: 7 }),
  exercises: Object.freeze({ maxPerDay: 30, editableDays: 7 }),   // 자유 운동 기록 (R-16)

  simulation: Object.freeze({ intakeMin: 800, intakeMax: 4000, bingeExtra: 800 }),

  // 운동 kcal 기본값은 체중 78kg 기준 (부록 B). 체중 비례 환산.
  workoutRefWeight: 78,
  workouts: Object.freeze([
    { id: 'pushup', name: '팔굽혀펴기', target: 200, unit: '개', kcal: 80, days: 'all' },
    { id: 'situp', name: '윗몸일으키기', target: 200, unit: '개', kcal: 60, days: 'all' },
    { id: 'chest', name: '가슴운동', target: 100, unit: '개', kcal: 40, days: 'all' },
    { id: 'shoulder', name: '어깨운동', target: 100, unit: '개', kcal: 40, days: 'all' },
    { id: 'run5k', name: '5km 달리기', target: 5, unit: 'km', kcal: 390, days: 'weekend', slot: true },
  ]),
  suggestedWorkout: Object.freeze({ id: 'run20', name: '달리기', target: 20, unit: '분', kcal: 250, days: 'weekday', maxSessions: 3 }),

  reminders: Object.freeze({ weightAt: '07:00', workoutAt: '21:00' }),
});
