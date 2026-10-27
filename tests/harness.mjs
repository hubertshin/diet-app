// 의존성 없는 최소 테스트 하네스. jsc(-m)와 브라우저 양쪽에서 동작.
// Node가 생기면 describe/test/assert 시그니처가 Vitest와 같아 그대로 옮길 수 있다.

const suites = [];
let current = null;

export function describe(name, fn) {
  const prev = current;
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = prev;
}

export function test(name, fn) {
  if (!current) describe('(root)', () => {});
  const target = current ?? suites[suites.length - 1];
  target.tests.push({ name, fn });
}
export const it = test;

class AssertionError extends Error {}

function fail(msg) {
  throw new AssertionError(msg);
}

function fmt(v) {
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

export const assert = {
  ok(v, msg = 'expected truthy') { if (!v) fail(`${msg}: got ${fmt(v)}`); },
  equal(a, b, msg = 'expected equal') { if (a !== b) fail(`${msg}: ${fmt(a)} !== ${fmt(b)}`); },
  notEqual(a, b, msg = 'expected not equal') { if (a === b) fail(`${msg}: ${fmt(a)}`); },
  deepEqual(a, b, msg = 'expected deep equal') {
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${msg}: ${fmt(a)} !== ${fmt(b)}`);
  },
  closeTo(a, b, eps = 1e-9, msg = 'expected close') {
    if (Math.abs(a - b) > eps) fail(`${msg}: ${a} vs ${b} (eps ${eps})`);
  },
  above(a, b, msg = 'expected greater') { if (!(a > b)) fail(`${msg}: ${a} <= ${b}`); },
  atLeast(a, b, msg = 'expected >=') { if (!(a >= b)) fail(`${msg}: ${a} < ${b}`); },
  below(a, b, msg = 'expected less') { if (!(a < b)) fail(`${msg}: ${a} >= ${b}`); },
};

const out = typeof print === 'function' ? print : (...a) => console.log(...a);

export async function run() {
  let passed = 0;
  const failures = [];
  for (const suite of suites) {
    out(`\n${suite.name}`);
    for (const t of suite.tests) {
      try {
        await t.fn();
        passed += 1;
        out(`  ✓ ${t.name}`);
      } catch (e) {
        failures.push({ suite: suite.name, test: t.name, error: e });
        out(`  ✗ ${t.name}`);
        out(`      ${e && e.message ? e.message : e}`);
      }
    }
  }
  out(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} test(s) failed`);
  }
}
