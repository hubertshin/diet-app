import { describe, test, assert } from './harness.mjs';
import { SEED_FOODS, searchFoods, matches, toChosung, findFood } from '../src/foods.js';

describe('R-1 음식 DB·검색', () => {
  test('내장 DB 항목은 이름·제공량·kcal 를 가지고 id 가 고유하다', () => {
    assert.atLeast(SEED_FOODS.length, 100, '1단계 시드 100건 이상');
    const ids = new Set(SEED_FOODS.map(f => f.id));
    assert.equal(ids.size, SEED_FOODS.length, 'id 중복 없음');
    for (const f of SEED_FOODS) {
      assert.ok(f.name && f.serving, `${f.id} 이름·제공량`);
      assert.ok(Number.isInteger(f.kcal) && f.kcal >= 0, `${f.id} kcal 정수`);
    }
  });
  test('이름 부분 일치 (공백·대소문자 무시)', () => {
    assert.ok(matches('김치찌개', '찌개'));
    assert.ok(matches('김치 찌개', '김치찌'));
    assert.ok(!matches('김치찌개', ''));
  });
  test('초성 검색: ㄱㅊ → 김치…', () => {
    assert.equal(toChosung('김치찌개'), 'ㄱㅊㅉㄱ');
    const hits = searchFoods('ㄱㅊ');
    assert.above(hits.length, 0);
    assert.ok(hits.every(f => toChosung(f.name).includes('ㄱㅊ')));
  });
  test('검색 결과는 즐겨찾기 → 최근 7일 → DB 순으로 정렬된다', () => {
    const favorites = new Set(['kimchi-bokkeumbap']);
    const recent = new Set(['kimchi-jjigae']);
    const names = searchFoods('김치', { favorites, recent }).map(f => f.id);
    assert.equal(names[0], 'kimchi-bokkeumbap', '즐겨찾기 먼저');
    assert.equal(names[1], 'kimchi-jjigae', '그 다음 최근');
    assert.above(names.length, 2);
  });
  test('사용자 직접 입력 항목도 검색에 뜬다', () => {
    const customs = [{ id: 'custom-1', name: '엄마표 김치볶음', serving: '1인분', kcal: 300, custom: true }];
    const hits = searchFoods('김치볶음', { customs });
    assert.ok(hits.some(f => f.id === 'custom-1'));
  });
  test('검색 결과가 없으면 빈 배열', () => {
    assert.deepEqual(searchFoods('zzzz없는음식'), []);
    assert.deepEqual(searchFoods(''), []);
  });
  test('결과 상한(limit)', () => {
    assert.ok(searchFoods('ㄱ', { limit: 5 }).length <= 5);
  });
  test('findFood 는 사용자 항목을 DB보다 먼저 찾고 없으면 null', () => {
    const customs = [{ id: 'rice', name: '내 밥', serving: '1', kcal: 1 }];
    assert.equal(findFood('rice', customs).name, '내 밥');
    assert.equal(findFood('rice').name, '흰쌀밥 1공기');
    assert.equal(findFood('nope'), null);
  });

  test('동의어: "스시"로 검색하면 "초밥" 항목이, "사시미"로 검색하면 "회" 항목이 나온다', () => {
    const sushi = searchFoods('스시', { limit: 100 });
    assert.above(sushi.length, 10, '스시 검색 결과');
    assert.ok(sushi.some(f => f.name.includes('초밥')), '초밥 항목 포함');
    assert.ok(sushi.some(f => f.name.includes('스시')), '스시 항목 포함');
    const sashimi = searchFoods('사시미', { limit: 100 });
    assert.ok(sashimi.some(f => f.name.includes('회')), '회 항목 포함');
    assert.ok(searchFoods('연어 스시', { limit: 100 }).some(f => f.name === '연어초밥 2개'), '복합어도 동의어 치환');
  });
});
