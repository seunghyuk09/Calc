/**
 * store.js
 * localStorage 래퍼. 사생활 보호 모드나 용량 초과로 접근이 실패해도 앱이 죽지 않도록 방어합니다.
 */

const PREFIX = 'daily-kit:';
// localStorage 가 막힌 환경(시크릿 모드 등)을 위한 메모리 대체 저장소
const memoryFallback = new Map();
let storageAvailable = null;

function checkStorage() {
  if (storageAvailable !== null) return storageAvailable;
  try {
    const probe = `${PREFIX}__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  return storageAvailable;
}

/** 저장된 값을 읽습니다. 없거나 파싱 실패 시 fallback 을 반환합니다. */
export function load(key, fallback) {
  const fullKey = PREFIX + key;
  try {
    const raw = checkStorage() ? window.localStorage.getItem(fullKey) : memoryFallback.get(fullKey);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** 값을 저장합니다. 성공 여부를 boolean 으로 반환합니다. */
export function save(key, value) {
  const fullKey = PREFIX + key;
  try {
    const raw = JSON.stringify(value);
    if (checkStorage()) window.localStorage.setItem(fullKey, raw);
    else memoryFallback.set(fullKey, raw);
    return true;
  } catch (err) {
    // 용량 초과(QuotaExceededError) 등은 조용히 실패시키되 콘솔에 남깁니다.
    console.warn('[store] 저장 실패:', key, err?.name || err);
    return false;
  }
}

/** 키를 삭제합니다. */
export function remove(key) {
  const fullKey = PREFIX + key;
  try {
    if (checkStorage()) window.localStorage.removeItem(fullKey);
    else memoryFallback.delete(fullKey);
  } catch { /* 무시 */ }
}

/** 이 앱이 저장한 모든 키를 삭제합니다. */
export function clearAll() {
  try {
    if (checkStorage()) {
      const keys = Object.keys(window.localStorage).filter((k) => k.startsWith(PREFIX));
      keys.forEach((k) => window.localStorage.removeItem(k));
    }
    memoryFallback.clear();
    return true;
  } catch {
    return false;
  }
}

/** 이 앱이 저장한 데이터 전체를 객체로 내보냅니다. (백업용) */
export function exportAll() {
  const result = {};
  try {
    if (checkStorage()) {
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => { result[k.slice(PREFIX.length)] = JSON.parse(window.localStorage.getItem(k)); });
    } else {
      memoryFallback.forEach((v, k) => { result[k.slice(PREFIX.length)] = JSON.parse(v); });
    }
  } catch { /* 무시 */ }
  return result;
}

/** 백업 객체를 복원합니다. */
export function importAll(data) {
  if (!data || typeof data !== 'object') return false;
  let ok = true;
  Object.entries(data).forEach(([k, v]) => { if (!save(k, v)) ok = false; });
  return ok;
}

/** localStorage 사용 가능 여부 */
export function isPersistent() { return checkStorage(); }
