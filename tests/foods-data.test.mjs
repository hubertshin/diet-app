// R-1 내장 음식 DB (foods-data.js + SEED_FOODS) 무결성. 단독 실행: jsc -m tests/foods-data.test.mjs
import { describe, test, assert } from './harness.mjs';
import { SEED_FOODS } from '../src/foods.js';
import { EXTRA_FOODS } from '../src/foods-data.js';

const ALL = [...SEED_FOODS, ...EXTRA_FOODS];
const normName = s => s.replace(/\s+/g, '');

describe('R-1 음식 DB 내장 (SEED_FOODS + EXTRA_FOODS)', () => {
  test('음식 DB 확장분은 최소 500건이다 (조정된 분담 기준)', () => {
    assert.atLeast(EXTRA_FOODS.length, 850, `확장분 ${EXTRA_FOODS.length}건`);
    assert.atLeast(ALL.length, 1000, `총 ${ALL.length}건`);
  });

  test('id가 중복되지 않는다 (SEED_FOODS 포함)', () => {
    const seen = new Set();
    for (const f of ALL) {
      assert.ok(!seen.has(f.id), `중복 id: ${f.id}`);
      seen.add(f.id);
    }
  });

  test('이름이 중복되지 않는다 (공백 제거 비교, SEED_FOODS 포함)', () => {
    const seen = new Map();
    for (const f of ALL) {
      const n = normName(f.name);
      assert.ok(!seen.has(n), `중복 이름: "${f.name}" (${f.id} vs ${seen.get(n)})`);
      seen.set(n, f.id);
    }
  });

  test('각 항목은 이름·1회 제공량·kcal(0~5,000 정수)를 가진다', () => {
    for (const f of ALL) {
      assert.ok(typeof f.name === 'string' && f.name.trim().length > 0, `${f.id}: name 비어 있음`);
      assert.ok(typeof f.serving === 'string' && f.serving.trim().length > 0, `${f.id}: serving 비어 있음`);
      assert.ok(Number.isInteger(f.kcal), `${f.id}: kcal 정수 아님 (${f.kcal})`);
      assert.atLeast(f.kcal, 0, `${f.id}: kcal 음수`);
      assert.ok(f.kcal <= 5000, `${f.id}: kcal 5,000 초과 (${f.kcal})`);
    }
  });

  test('확장분 id는 모두 x- 접두사의 영문 슬러그다 (^x-[a-z0-9-]+$)', () => {
    for (const f of EXTRA_FOODS) assert.ok(/^x-[a-z0-9-]+$/.test(f.id), `잘못된 id: ${f.id}`);
  });

  test('항목 객체는 동결(freeze)되어 있다', () => {
    assert.ok(Object.isFrozen(EXTRA_FOODS), '배열 동결');
    assert.ok(Object.isFrozen(EXTRA_FOODS[0]), '항목 동결');
  });
});

