// tool-limits.js — محدِّدات عمليات التشخيص (SEC-01): نافذة زمنية للتكرار + عدّاد تزامن.
// دوال نقية بحقن الساعة (now) ⇒ قابلة للاختبار بلا انتظار حقيقي.
'use strict';

// محدِّد تكرار بنافذة منزلقة: check(key) ⇒ { ok } أو { ok:false, retryAfterMs }.
function createSlidingWindowLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map(); // key → [timestamps]

  function check(key) {
    const t = now();
    const arr = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
    if (arr.length >= max) {
      const oldest = arr[0];
      return { ok: false, retryAfterMs: Math.max(0, windowMs - (t - oldest)) };
    }
    arr.push(t);
    hits.set(key, arr);
    return { ok: true };
  }

  function reset(key) {
    if (key === undefined) hits.clear();
    else hits.delete(key);
  }

  return { check, reset };
}

// إشارة تزامن بسيطة: tryAcquire() ⇒ release أو null عند بلوغ الحد.
function createSemaphore(max) {
  let active = 0;
  function tryAcquire() {
    if (active >= max) return null;
    active += 1;
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      active -= 1;
    };
  }
  return { tryAcquire, get active() { return active; } };
}

module.exports = { createSlidingWindowLimiter, createSemaphore };
