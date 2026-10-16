// health-state.service.js (SpaceKit MON-01) — حالات المراقبة كدوال **نقية** قابلة للاختبار.
// ═══════════════════════════════════════════════════════════════════════════
// الفصل المطلوب في المواصفة: حالة المضيف (reachability ببروتوكول الفحص المختار) منفصلة عن
// حالة الخدمات (MON-02) وعن الحالة العامة overall_health:
//   online   : الفحص الأساسي ناجح.
//   offline  : فشل متتالٍ بلغ العتبة (failure_threshold).
//   unknown  : لا دليل كافٍ (لم يُفحص بعد) أو بيانات قديمة (stale).
//   degraded : المضيف متصل لكن خدمة مراقَبة متوقفة (تُفعَّل مع جدول الخدمات في MON-02).
'use strict';

// انتقال حالة المضيف بناءً على نتيجة الفحص الأساسي والعدّاد السابق.
// يُرجع: { hostStatus, consecutiveFailures, event: null | 'down' | 'recovered' }
function decideHostTransition({ hostStatus, consecutiveFailures = 0, failureThreshold = 2, probeOk }) {
  const prev = hostStatus || 'unknown';
  const threshold = Math.max(1, Number(failureThreshold) || 1);

  if (probeOk) {
    const recovered = prev === 'offline';
    return {
      hostStatus: 'online',
      consecutiveFailures: 0,
      // لا نُطلق «عودة» لجهاز لم يُرَ منقطعًا من قبل (unknown → online ليست عودة).
      event: recovered ? 'recovered' : null,
    };
  }

  const failures = consecutiveFailures + 1;
  if (failures >= threshold) {
    return {
      hostStatus: 'offline',
      consecutiveFailures: failures,
      // «انقطاع» يُطلق عند أول انتقال فعلي إلى offline (وليس مع كل فحص فاشل).
      event: prev === 'offline' ? null : 'down',
    };
  }
  return {
    // دون العتبة: نبقى على الحالة السابقة (unknown تبقى unknown حتى تتضح الأدلة).
    hostStatus: prev,
    consecutiveFailures: failures,
    event: null,
  };
}

// الحالة العامة: العطل في المضيف أولى من الخدمات (لا نقول degraded لجهاز منقطع).
function overallHealth({ hostStatus, servicesDown = 0, servicesCriticalDown = 0 }) {
  if (hostStatus === 'offline') return 'offline';
  if (hostStatus !== 'online') return 'unknown';
  // أي خدمة متوقفة (وخاصة الحرجة) ⇒ DEGRADED وليس أخضر كاذبًا.
  if (servicesDown > 0 || servicesCriticalDown > 0) return 'degraded';
  return 'online';
}

// بيانات قديمة: آخر فحص أقدم من (factor × فترة الفحص) ⇒ الحالة غير موثوقة ⇒ unknown.
function isStale(lastCheckedAt, intervalSeconds, nowMs = Date.now(), factor = 3) {
  if (!lastCheckedAt) return true;
  const last = new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(last)) return true;
  const intervalMs = Math.max(1, Number(intervalSeconds) || 10) * 1000;
  return (nowMs - last) > factor * intervalMs;
}

module.exports = { decideHostTransition, overallHealth, isStale };
