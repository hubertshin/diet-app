import { describe, test, assert } from './harness.mjs';
import { createApp } from '../src/state.js';
import { createSync, GIST_FILE } from '../src/sync.js';
import { memoryBacking } from './storage.test.mjs';

// GitHub API 흉내: 토큰 'good' 만 유효. gists 는 메모리.
function fakeGithub({ gists = {}, offline = false, log = [] } = {}) {
  let seq = 1;
  const fetchFn = async (url, opts = {}) => {
    log.push({ url, method: opts.method || 'GET' });
    if (offline) throw new TypeError('Failed to fetch');
    const token = (opts.headers?.Authorization || '').replace('Bearer ', '');
    const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
    if (token !== 'good') return json(401, { message: 'Bad credentials' });
    const path = url.replace('https://api.github.com', '');
    if (path === '/user') return json(200, { login: 'hubertshin' });
    if (path.startsWith('/gists?')) return json(200, Object.values(gists));
    if (path === '/gists' && opts.method === 'POST') { const id = `g${seq++}`; const body = JSON.parse(opts.body); gists[id] = { id, files: { [GIST_FILE]: { content: body.files[GIST_FILE].content } } }; return json(201, gists[id]); }
    const m = path.match(/^\/gists\/(\w+)$/);
    if (m) {
      const g = gists[m[1]];
      if (!g) return json(404, {});
      if (opts.method === 'PATCH') { const body = JSON.parse(opts.body); g.files[GIST_FILE].content = body.files[GIST_FILE].content; return json(200, g); }
      return json(200, g);
    }
    return json(500, {});
  };
  return { fetchFn, gists, log, setOffline(v) { offline = v; } };
}
function remoteData(gh, id) { return JSON.parse(gh.gists[id].files[GIST_FILE].content).data; }

function mkApp(t = 1000) {
  let clock = t;
  const app = createApp({ storage: null, now: () => new Date(2026, 9, 27, 8, 0, 0, clock) });
  return { app, tick: n => { clock += n; } };
}
function mkSync(app, gh, opts = {}) {
  const timers = [];
  const sync = createSync({ app, backing: memoryBacking(), fetchFn: gh.fetchFn, now: () => 5000, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: id => { timers[id - 1].cleared = true; }, ...opts });
  return { sync, timers };
}

describe('R-15 기기 간 동기화 — 연결', () => {
  test('유효하지 않은 토큰이면 연결 실패하고 "토큰을 다시 확인하세요" 메시지', async () => {
    const { app } = mkApp(); const gh = fakeGithub(); const { sync } = mkSync(app, gh);
    const r = await sync.connect('bad');
    assert.equal(r.ok, false); assert.equal(r.reason, 'auth'); assert.ok(r.message.includes('토큰'));
    assert.equal(sync.connected(), false);
  });
  test('빈 토큰은 거부한다', async () => {
    const { app } = mkApp(); const gh = fakeGithub(); const { sync } = mkSync(app, gh);
    assert.equal((await sync.connect('  ')).reason, 'empty');
  });
  test('Gist 가 없으면 비공개 Gist 를 만들고 현재 데이터를 올린다', async () => {
    const { app } = mkApp(); app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    const gh = fakeGithub(); const { sync } = mkSync(app, gh);
    const r = await sync.connect('good');
    assert.ok(r.ok); assert.equal(r.login, 'hubertshin'); assert.equal(r.existing, false);
    const post = gh.log.find(l => l.method === 'POST');
    assert.ok(post, 'POST /gists 호출');
    assert.equal(Object.keys(gh.gists).length, 1);
    assert.equal(remoteData(gh, 'g1').weights['2026-10-27'], 78);
    assert.equal(sync.status().connected, true); assert.equal(sync.status().status, 'ok');
  });
  test('두 번째 기기: 기존 Gist 를 찾아 내려받고 온보딩을 건너뛴다', async () => {
    const a = mkApp(); a.app.completeOnboarding({ baseline: 78, targetWeight: 73 }); a.app.addMeal('2026-10-27', { name: '김밥', kcal: 480 });
    const gh = fakeGithub(); const s1 = mkSync(a.app, gh); await s1.sync.connect('good');
    const b = mkApp(); const s2 = mkSync(b.app, gh);
    const r = await s2.sync.connect('good');
    assert.ok(r.ok); assert.equal(r.existing, true);
    assert.equal(b.app.state.onboarded, true);
    assert.equal(b.app.state.meals['2026-10-27'].length, 1);
    assert.equal(Object.keys(gh.gists).length, 1, 'Gist 를 새로 만들지 않는다');
  });
  test('연결 해제는 토큰·Gist id 만 지우고 로컬 데이터와 Gist 는 남긴다', async () => {
    const { app } = mkApp(); app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    const gh = fakeGithub(); const { sync } = mkSync(app, gh); await sync.connect('good');
    sync.disconnect();
    assert.equal(sync.connected(), false); assert.equal(sync.status().login, null);
    assert.equal(app.state.onboarded, true); assert.equal(Object.keys(gh.gists).length, 1);
  });
  test('토큰은 동기화 데이터(Gist 내용)에 포함되지 않는다', async () => {
    const { app } = mkApp(); app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    const gh = fakeGithub(); const { sync } = mkSync(app, gh); await sync.connect('good');
    assert.equal(gh.gists.g1.files[GIST_FILE].content.includes('good'), false);
  });
});

describe('R-15 기기 간 동기화 — 충돌 규칙', () => {
  async function pair() {
    const a = mkApp(); a.app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    const gh = fakeGithub(); const sa = mkSync(a.app, gh); await sa.sync.connect('good');
    const b = mkApp(2000); const sb = mkSync(b.app, gh); await sb.sync.connect('good');
    return { a, b, gh, sa: sa.sync, sb: sb.sync };
  }
  test('원격만 바뀌었으면 원격으로 교체한다 (삭제도 반영)', async () => {
    const { a, b, sa, sb } = await pair();
    a.tick(10); a.app.addMeal('2026-10-27', { name: '김밥', kcal: 480 }); await sa.push();
    let r = await sb.pull(); assert.equal(r.action, 'replaced'); assert.equal(b.app.state.meals['2026-10-27'].length, 1);
    const id = a.app.state.meals['2026-10-27'][0].id; a.tick(10); a.app.removeMeal('2026-10-27', id); await sa.push();
    r = await sb.pull(); assert.equal(r.action, 'replaced'); assert.equal(b.app.state.meals['2026-10-27'], undefined, '삭제가 반영된다');
  });
  test('로컬만 바뀌었으면 올린다', async () => {
    const { b, gh, sb } = await pair();
    b.tick(10); b.app.setWeight('2026-10-27', 77.5);
    const r = await sb.pull(); assert.equal(r.action, 'pushed');
    assert.equal(remoteData(gh, 'g1').weights['2026-10-27'], 77.5);
  });
  test('양쪽 다 바뀌었으면 병합(식사 합집합, 체중 원격 우선)하고 올린다', async () => {
    const { a, b, gh, sa, sb } = await pair();
    a.tick(10); a.app.addMeal('2026-10-27', { name: '김밥', kcal: 480 }); a.app.setWeight('2026-10-27', 77.0); await sa.push();
    b.tick(10); b.app.addMeal('2026-10-27', { name: '라면', kcal: 500 }); b.app.setWeight('2026-10-27', 77.9);
    const r = await sb.pull(); assert.equal(r.action, 'merged');
    assert.equal(b.app.state.meals['2026-10-27'].length, 2);
    assert.equal(b.app.state.weights['2026-10-27'], 77.0, '체중은 원격 우선');
    assert.equal(remoteData(gh, 'g1').meals['2026-10-27'].length, 2, '병합 결과를 올린다');
    const r2 = await sa.pull(); assert.equal(r2.action, 'replaced'); assert.equal(a.app.state.meals['2026-10-27'].length, 2);
  });
  test('아무것도 안 바뀌었으면 호출만 하고 변경 없음', async () => {
    const { sb } = await pair();
    assert.equal((await sb.pull()).action, 'none');
  });
});

describe('R-15 기기 간 동기화 — 자동 올리기와 오류', () => {
  test('변경 후 3초 debounce 로 한 번만 올린다', async () => {
    const { app } = mkApp(); app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    const gh = fakeGithub(); const { sync, timers } = mkSync(app, gh); await sync.connect('good');
    app.onChange(() => sync.schedulePush());
    app.addMeal('2026-10-27', { name: '김밥', kcal: 480 }); app.addMeal('2026-10-27', { name: '라면', kcal: 500 });
    assert.equal(timers.length, 2); assert.ok(timers[0].cleared, '앞 타이머는 취소'); assert.equal(timers[1].ms, 3000);
    const before = gh.log.filter(l => l.method === 'PATCH').length;
    timers[1].fn(); await new Promise(r => setTimeout(r, 0)); await sync.pull();
    assert.equal(gh.log.filter(l => l.method === 'PATCH').length, before + 1);
    assert.equal(remoteData(gh, 'g1').meals['2026-10-27'].length, 2);
  });
  test('오프라인이면 로컬은 그대로, 상태에 오류를 남기고 다음 호출 때 재시도한다', async () => {
    const { app, tick } = mkApp(); app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    const gh = fakeGithub(); const { sync } = mkSync(app, gh); await sync.connect('good');
    gh.setOffline(true); tick(10); app.addMeal('2026-10-27', { name: '김밥', kcal: 480 });
    const r = await sync.push(); assert.equal(r.ok, false); assert.equal(r.reason, 'offline');
    assert.equal(sync.status().status, 'error'); assert.ok(sync.status().error);
    assert.equal(app.state.meals['2026-10-27'].length, 1);
    gh.setOffline(false);
    const r2 = await sync.pull(); assert.equal(r2.action, 'pushed'); assert.equal(sync.status().status, 'ok');
  });
  test('토큰이 무효해지면(401) 상태 auth 가 되고 자동 올리기를 멈춘다', async () => {
    const { app } = mkApp(); app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    const gh = fakeGithub(); const { sync, timers } = mkSync(app, gh); await sync.connect('good');
    gh.gists.g1.files[GIST_FILE].content = gh.gists.g1.files[GIST_FILE].content; // 유지
    // 토큰 폐기 흉내: fetch 가 401 을 돌려주게 토큰을 바꿔치기할 수 없으므로 상태 저장소에서 직접 token 을 깨뜨린다
    const broken = createSync({ app, backing: { getItem: () => JSON.stringify({ token: 'revoked', gistId: 'g1', lastSyncedAt: app.state.updatedAt }), setItem() {} }, fetchFn: gh.fetchFn, now: () => 5000, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
    const r = await broken.pull(); assert.equal(r.reason, 'auth'); assert.equal(broken.status().status, 'auth');
    const n = timers.length; broken.schedulePush(); assert.equal(timers.length, n, '자동 올리기 예약 안 함');
    assert.equal((await broken.push()).reason, 'not-connected');
  });
  test('Gist 가 지워졌으면(404) 오류를 남기고 로컬은 유지한다', async () => {
    const { app } = mkApp(); app.completeOnboarding({ baseline: 78, targetWeight: 73 });
    const gh = fakeGithub(); const { sync } = mkSync(app, gh); await sync.connect('good');
    delete gh.gists.g1;
    const r = await sync.pull(); assert.equal(r.reason, 'notfound'); assert.equal(app.state.onboarded, true);
  });
  test('연결 전에는 pull/push 가 아무것도 하지 않는다', async () => {
    const { app } = mkApp(); const gh = fakeGithub(); const { sync } = mkSync(app, gh);
    assert.equal((await sync.pull()).reason, 'not-connected'); assert.equal(gh.log.length, 0);
  });
});
