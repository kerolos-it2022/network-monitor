// admin-display.js (SpaceKit SEC-02/MON-02) — إعدادات العرض: وضع العرض العام + شاشة NOC الداخلية.
// يعتمد على api() و showToast() من admin-utils.js.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function jsonApi(url, method, body) {
    return api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
  }

  async function load() {
    const pub = await api('/api/settings/public-display');
    if (pub && pub.success && el('disp-public-mode')) {
      el('disp-public-mode').value = pub.data.mode;
      if (el('disp-status')) {
        const srcAr = { database: 'محفوظ من اللوحة', env: 'من متغير البيئة NM_PUBLIC_DISPLAY', default: 'الافتراضي' };
        el('disp-status').textContent = 'مصدر وضع العرض العام الحالي: ' + (srcAr[pub.data.source] || pub.data.source || '—');
      }
    }
    const noc = await api('/api/settings/noc-display');
    if (noc && noc.success && el('disp-noc-internal')) {
      el('disp-noc-internal').checked = noc.data.mode === 'full';
    }
  }

  async function save() {
    const mode = el('disp-public-mode').value;
    const r1 = await jsonApi('/api/settings/public-display', 'PUT', { mode });
    if (!r1 || !r1.success) { showToast((r1 && r1.error) || 'تعذّر حفظ وضع العرض العام', { type: 'error' }); return; }

    const nocMode = el('disp-noc-internal').checked ? 'full' : 'off';
    const r2 = await jsonApi('/api/settings/noc-display', 'PUT', { mode: nocMode });
    if (!r2 || !r2.success) { showToast((r2 && r2.error) || 'تعذّر حفظ إعداد شاشة NOC', { type: 'error' }); return; }

    showToast('✅ تم حفظ إعدادات العرض — تُطبَّق فورًا على الزوار وشاشة NOC');
    load();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = el('disp-save');
    if (btn) btn.addEventListener('click', save);
    // تحميل القيم الحالية عند أول فتح للتبويب.
    const tab = el('tab-display');
    if (tab) tab.addEventListener('click', load);
    // وعلى الإقلاع أيضًا لو كان التبويب هو المفتوح (نادرًا) — لضمان عدم ظهور قيم فارغة.
    if (el('section-display') && !el('section-display').classList.contains('hidden')) load();
  });
})();
