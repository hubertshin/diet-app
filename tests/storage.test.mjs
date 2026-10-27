import { describe, test, assert } from './harness.mjs';
import { createStorage } from '../src/storage.js';

export function memoryBacking() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _map: m };
}

describe('저장소 — 차단·손상·용량 초과 폴백', () => {
  test('정상 저장·로드', () => {
    const s = createStorage(memoryBacking(), 'k');
    assert.ok(s.save({ a: 1 }));
    assert.deepEqual(s.load(), { a: 1 });
  });
  test('저장소가 없으면(null) 메모리로 동작한다', () => {
    const s = createStorage(null, 'k');
    assert.equal(s.load(), null, '처음엔 비어 있다');
    s.save({ a: 2 });
    assert.deepEqual(s.load(), { a: 2 });
  });
  test('setItem 이 예외를 던지면 false 를 반환하고 메모리에 유지한다', () => {
    const b = memoryBacking();
    b.setItem = () => { throw new Error('QuotaExceeded'); };
    const s = createStorage(b, 'k');
    assert.equal(s.save({ a: 3 }), false);
    assert.deepEqual(s.load(), { a: 3 });
  });
  test('getItem 이 예외를 던져도(차단) 메모리 값으로 로드한다', () => {
    const b = memoryBacking();
    const s = createStorage(b, 'k');
    s.save({ a: 4 });
    b.getItem = () => { throw new Error('blocked'); };
    assert.deepEqual(s.load(), { a: 4 });
  });
  test('손상된 JSON 은 무시하고 null(또는 메모리)로 로드한다', () => {
    const b = memoryBacking();
    b.setItem('k', '{not json');
    const s = createStorage(b, 'k');
    assert.equal(s.load(), null);
  });
  test('clear 하면 저장소·메모리 모두 비운다', () => {
    const b = memoryBacking();
    const s = createStorage(b, 'k');
    s.save({ a: 5 });
    s.clear();
    assert.equal(s.load(), null);
  });
});
