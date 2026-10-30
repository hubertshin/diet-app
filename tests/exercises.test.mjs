import { describe, test, assert } from './harness.mjs';
import { EXERCISES, EXERCISE_CATEGORIES, EXERCISE_UNITS, searchExercises, findExercise, exerciseKcal, matchesExercise } from '../src/exercises.js';

describe('R-16 운동 종류 DB·검색', () => {
  test('DB 는 150종 이상, id 고유, 이름·분류·단위·kcal·기본 수량을 갖는다', () => {
    assert.atLeast(EXERCISES.length, 150);
    const ids = new Set(EXERCISES.map(e => e.id));
    assert.equal(ids.size, EXERCISES.length, 'id 중복 없음');
    const names = new Set(EXERCISES.map(e => e.name));
    assert.equal(names.size, EXERCISES.length, '이름 중복 없음');
    for (const e of EXERCISES) {
      assert.ok(e.name && e.category, `${e.id} 이름·분류`);
      assert.ok(EXERCISE_UNITS.includes(e.unit), `${e.id} 단위`);
      assert.ok(e.kcal > 0, `${e.id} kcal > 0`);
      assert.ok(e.amount > 0, `${e.id} 기본 수량`);
    }
    assert.atLeast(EXERCISE_CATEGORIES.length, 8);
  });
  test('분류별로 유산소·맨몸·웨이트·구기·격투·요가·야외·생활이 모두 있다', () => {
    for (const c of ['유산소', '맨몸운동', '웨이트', '구기·라켓', '격투·무술', '요가·댄스', '야외·레저', '생활활동', '수영·수상']) assert.ok(EXERCISE_CATEGORIES.includes(c), c);
  });
  test('이름 부분 일치·초성·동의어(러닝→달리기, 헬스→웨이트, 턱걸이→풀업)로 찾는다', () => {
    assert.ok(searchExercises('달리기').length >= 5);
    assert.ok(searchExercises('ㄷㄹㄱ').some(e => e.name.startsWith('달리기')));
    assert.ok(searchExercises('러닝').some(e => e.name.startsWith('달리기')), '러닝 → 달리기');
    assert.ok(searchExercises('헬스').some(e => e.name.includes('웨이트')), '헬스 → 웨이트');
    assert.ok(searchExercises('턱걸이').some(e => e.id === 'pullup'), '턱걸이 → 풀업');
    assert.ok(searchExercises('hiit').some(e => e.id === 'hiit'), '대소문자 무시');
    assert.ok(matchesExercise('반려견 산책', '강아지'));
  });
  test('정렬: 즐겨찾기 → 최근 → DB, 사용자 직접 입력 항목 포함, 빈 질의는 빈 배열', () => {
    const customs = [{ id: 'cex-1', name: '우리동네 달리기 코스', category: '직접 입력', unit: '회', kcal: 300, amount: 1, custom: true }];
    const hits = searchExercises('달리기', { customs, favorites: new Set(['run-km']), recent: new Set(['jog']) });
    assert.equal(hits[0].id, 'run-km', '즐겨찾기 먼저');
    assert.ok(hits.some(e => e.id === 'cex-1'), '직접 입력 포함');
    assert.deepEqual(searchExercises(''), []);
    assert.ok(searchExercises('ㅇ', { limit: 3 }).length <= 3);
  });
  test('findExercise 는 사용자 항목을 먼저, 없으면 null', () => {
    assert.equal(findExercise('pushup').name, '팔굽혀펴기');
    assert.equal(findExercise('pushup', [{ id: 'pushup', name: '내 팔굽' }]).name, '내 팔굽');
    assert.equal(findExercise('nope'), null);
  });
  test('kcal = 단위당 kcal × 수량, 체중 비례 (78kg 기준), 반올림', () => {
    assert.equal(exerciseKcal({ kcal: 0.4, amount: 200 }), 80, '팔굽혀펴기 200회 = 부록 B 80kcal');
    assert.equal(exerciseKcal({ kcal: 78, amount: 5 }), 390, '5km 달리기 = 부록 B 390kcal');
    assert.equal(exerciseKcal({ kcal: 11.3, amount: 30, weight: 39 }), 170, '체중 절반이면 절반');
    assert.equal(exerciseKcal({ kcal: 0.15, amount: 1 }), 0, '0 이하로 내려가지 않음');
  });
});
