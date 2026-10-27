// 기기 간 동기화 (R-15). 사용자 본인의 GitHub 비공개 Gist 한 개에 상태 전체를 JSON 으로 올리고 내려받는다. 서버 없음.
// 토큰·Gist id·마지막 동기화 시각은 이 기기의 별도 키에만 저장하고, 동기화 데이터에는 넣지 않는다.
// 충돌 규칙: 원격만 바뀜 → 원격으로 교체 / 양쪽 바뀜 → 병합 후 올림 / 로컬만 바뀜 → 올림.

export const SYNC_KEY = 'diet.sync.v1';
export const GIST_FILE = 'diet-app.json';
export const GIST_DESC = 'diet-app sync (다이어트 코치 자동 백업)';
const API = 'https://api.github.com';
export const PUSH_DEBOUNCE_MS = 3000;

function defaultBacking() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

export function createSync({ app, backing = defaultBacking(), fetchFn = (typeof fetch === 'function' ? fetch.bind(globalThis) : null), now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), debounceMs = PUSH_DEBOUNCE_MS } = {}) {
  let cfg = load();
  let timer = null;
  let inflight = null;   // 진행 중인 pull/push Promise (직렬화)
  const listeners = [];

  function load() {
    try { const raw = backing && backing.getItem(SYNC_KEY); if (raw) return { ...blank(), ...JSON.parse(raw) }; } catch (_) { /* 손상 → 초기화 */ }
    return blank();
  }
  function blank() { return { token: null, gistId: null, login: null, lastSyncedAt: 0, lastSyncAt: null, status: 'off', error: null }; }
  function save() { try { if (backing) backing.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch (_) { /* 저장 차단 → 메모리 */ } notify(); }
  function notify() { for (const fn of listeners) fn(status()); }
  function set(patch) { Object.assign(cfg, patch); save(); }

  function connected() { return !!(cfg.token && cfg.gistId); }
  function status() { return { connected: connected(), login: cfg.login, status: cfg.status, error: cfg.error, lastSyncAt: cfg.lastSyncAt, gistId: cfg.gistId }; }
  function onStatus(fn) { listeners.push(fn); }

  async function api(method, path, body, token = cfg.token) {
    if (!fetchFn) throw Object.assign(new Error('fetch 사용 불가'), { kind: 'offline' });
    let res;
    try {
      res = await fetchFn(`${API}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) { throw Object.assign(new Error('네트워크 오류'), { kind: 'offline' }); }
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('토큰을 다시 확인하세요 (권한 없음)'), { kind: 'auth', http: res.status });
    if (res.status === 404) throw Object.assign(new Error('Gist 를 찾을 수 없습니다'), { kind: 'notfound', http: 404 });
    if (!res.ok) throw Object.assign(new Error(`GitHub 오류 ${res.status}`), { kind: 'http', http: res.status });
    return res.status === 204 ? null : res.json();
  }

  function payload() { return JSON.stringify({ app: 'diet', exportedAt: new Date(now()).toISOString(), data: app.state }); }

  // ---------- 연결 ----------
  async function connect(token) {
    token = (token || '').trim();
    if (!token) return { ok: false, reason: 'empty', message: '토큰을 입력하세요' };
    try {
      const user = await api('GET', '/user', undefined, token);
      let gistId = null;
      const list = await api('GET', '/gists?per_page=100', undefined, token);
      const found = (list || []).find(g => g.files && g.files[GIST_FILE]);
      if (found) gistId = found.id;
      else {
        const created = await api('POST', '/gists', { description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: payload() } } }, token);
        gistId = created.id;
      }
      set({ token, gistId, login: user.login, lastSyncedAt: found ? 0 : (app.state.updatedAt || 0), status: 'ok', error: null, lastSyncAt: found ? null : now() });
      if (found) await pull();
      return { ok: true, login: user.login, existing: !!found };
    } catch (e) {
      return { ok: false, reason: e.kind || 'http', message: e.message };
    }
  }
  function disconnect() { if (timer) { clearTimer(timer); timer = null; } cfg = blank(); save(); }

  // ---------- pull / push ----------
  function serialized(fn) {
    const run = () => fn().finally(() => { if (inflight === p) inflight = null; });
    const p = inflight ? inflight.then(run, run) : run();
    inflight = p;
    return p;
  }

  async function readRemote() {
    const g = await api('GET', `/gists/${cfg.gistId}`);
    const f = g.files && g.files[GIST_FILE];
    if (!f) throw Object.assign(new Error('Gist 에 파일이 없습니다'), { kind: 'notfound' });
    let text = f.content;
    if (f.truncated && f.raw_url) { const r = await fetchFn(f.raw_url); text = await r.text(); }
    const obj = JSON.parse(text);
    if (!obj || obj.app !== 'diet' || !obj.data) throw Object.assign(new Error('Gist 내용이 이 앱 형식이 아닙니다'), { kind: 'format' });
    return obj.data;
  }

  function pull() {
    if (!connected() || cfg.status === 'auth') return Promise.resolve({ ok: false, reason: 'not-connected' });
    return serialized(async () => {
      try {
        const remote = await readRemote();
        const remoteUpdated = remote.updatedAt || 0, localUpdated = app.state.updatedAt || 0, last = cfg.lastSyncedAt || 0;
        const remoteChanged = remoteUpdated > last, localChanged = localUpdated > last;
        let action = 'none';
        if (remoteChanged && !localChanged) { app.applyRemote(remote, 'replace'); action = 'replaced'; }
        else if (remoteChanged && localChanged) { app.applyRemote(remote, 'merge'); await writeRemote(); action = 'merged'; }
        else if (localChanged) { await writeRemote(); action = 'pushed'; }
        set({ lastSyncedAt: app.state.updatedAt || 0, lastSyncAt: now(), status: 'ok', error: null });
        return { ok: true, action };
      } catch (e) {
        set({ status: e.kind === 'auth' ? 'auth' : 'error', error: e.message });
        return { ok: false, reason: e.kind || 'http', message: e.message };
      }
    });
  }

  async function writeRemote() {
    await api('PATCH', `/gists/${cfg.gistId}`, { files: { [GIST_FILE]: { content: payload() } } });
  }
  function push() {
    if (!connected() || cfg.status === 'auth') return Promise.resolve({ ok: false, reason: 'not-connected' });
    return serialized(async () => {
      try {
        await writeRemote();
        set({ lastSyncedAt: app.state.updatedAt || 0, lastSyncAt: now(), status: 'ok', error: null });
        return { ok: true, action: 'pushed' };
      } catch (e) {
        set({ status: e.kind === 'auth' ? 'auth' : 'error', error: e.message });
        return { ok: false, reason: e.kind || 'http', message: e.message };
      }
    });
  }
  // 변경 후 debounce 로 올린다. 마지막 변경 기준 3초.
  function schedulePush() {
    if (!connected() || cfg.status === 'auth') return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; push(); }, debounceMs);
  }

  return { connect, disconnect, pull, push, schedulePush, status, connected, onStatus };
}
