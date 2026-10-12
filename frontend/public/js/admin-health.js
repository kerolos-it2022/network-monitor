// admin-health.js (v2.11.9) — شريط تحذير أعلى لوحة التحكم عند تعطّل محرك المراقبة.
// يفحص /api/health كل 30 ثانية: نبضة متوقفة (stalled) أو فحوصات عالقة (stuckChecks)
// ⇒ شريط أحمر واضح أعلى المحتوى. تعذّر الاتصال بالخادم مرتين ⇒ تحذير اتصال.
(function () {
  const CHECK_MS = 30000;
  let fetchFails = 0;

  function strip() {
    let el = document.getElementById('engine-health-strip');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'engine-health-strip';
    el.style.cssText = 'display:none; background:#7f1d1d; color:#fecaca; border:1px solid #ef4444;'
      + 'border-radius:10px; padding:10px 14px; margin:12px 18px 0; font-weight:700; text-align:center;';
    const host = document.querySelector('.dashboard-main') || document.body;
    host.prepend(el);
    return el;
  }
  function show(text) { const el = strip(); el.textContent = text; el.style.display = 'block'; }
  function hide() { const el = strip(); el.style.display = 'none'; }

  async function check() {
    let r;
    try {
      r = await fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      fetchFails += 1;
      if (fetchFails >= 2) show('⚠️ تعذر الاتصال بخادم المراقبة — تحقّق من حالة الجهاز.');
      return;
    }
    fetchFails = 0;
    let eng = null;
    try { eng = (await r.json()).engine; } catch (e) { eng = null; }
    if (!eng || eng.notStarted) { hide(); return; }
    const sec = Math.round((eng.lastTickAgeMs || 0) / 1000);
    const fmt = sec >= 60 ? Math.round(sec / 60) + ' دقيقة' : sec + ' ثانية';
    if (eng.stalled) {
      show('⚠️ محرك المراقبة متوقف منذ ' + fmt + ' — البيانات المعروضة قد تكون قديمة!');
    } else if (eng.stuckChecks > 0) {
      show('⚠️ يوجد ' + eng.stuckChecks + ' فحص عالق — بعض الأجهزة قد لا تتحدّث حالتها.');
    } else {
      hide();
    }
  }

  document.addEventListener('DOMContentLoaded', () => { check(); setInterval(check, CHECK_MS); });
})();
