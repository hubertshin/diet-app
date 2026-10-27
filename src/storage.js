// 브라우저 저장소 래퍼. 차단·손상·용량 초과여도 앱은 메모리로 계속 동작한다. 스키마는 버전 번호를 가진다 (R-13).
import { CONFIG } from './config.js';

function defaultBacking() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

export function createStorage(backing = defaultBacking(), key = CONFIG.storageKey) {
  let memory = null;
  return {
    load() {
      let raw = null;
      try { raw = backing ? backing.getItem(key) : null; } catch (_) { /* 차단 → 메모리 */ }
      if (raw === null || raw === undefined) return memory;
      try { return JSON.parse(raw); } catch (_) { return memory; } // 손상 → 메모리(없으면 null)
    },
    save(data) {
      memory = data;
      try { if (backing) backing.setItem(key, JSON.stringify(data)); return true; } catch (_) { return false; }
    },
    clear() {
      memory = null;
      try { if (backing) backing.removeItem(key); } catch (_) { /* ignore */ }
    },
  };
}
