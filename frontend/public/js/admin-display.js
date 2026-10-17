// admin-display.js (SpaceKit SEC-01/SEC-02 + قرار المالك) — إعدادات العرض والأدوات.
//   • ما يراه الزائر (وضع العرض العام)      → GET/PUT /api/settings/public-display
//   • ما يراه المستخدم المسجَّل (العناوين)     → GET/PUT /api/settings/noc-display
//   • أدوات التشخيص (مَن يستخدمها + الأهداف) → GET/PUT /api/settings/tools-policy
//   • زر «👁️ معاينة ما يراه الزائر»            → يعرض نفس ما يصل للزائر حرفيًّا (بلا عناوين)
// يعتمد على api() و showToast() من admin-utils.js. كل الحفظ للأدمن ومُسجَّل في التدقيق (على الخادم).
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

  const MODE_AR = { lan: 'الحالة + الخريطة (بلا عناوين)', minimal: 'الحالة فقط (بلا خريطة/عناوين)', off: 'ممنوع تمامًا (الزائر يُرفض)' };
  const SRC_AR = { database: 'محفوظ من اللوحة', env: 'من متغيرات السيرفر', default: 'الافتراضي' };

  async function load() {
    // 1) وضع الزوار
    const pub = await api('/api/settings/public-display');
    if (pub && pub.success) {
      if (el('disp-public-mode')) el('disp-public-mode').value = pub.data.mode;
      if (el('disp-status')) el('disp-status').textContent = T('s2j.status_now', 'الحالة الآن:') + ' ' + (MODE_AR[pub.data.mode] || pub.data.mode) + ' · المصدر: ' + (SRC_AR[pub.data.source] || pub.data.source || '—');
    }
    // 2) ما يراه المستخدم المسجَّل
    const noc = await api('/api/settings/noc-display');
    if (noc && noc.success && el('disp-noc-internal')) el('disp-noc-internal').checked = noc.data.mode !== 'off';
    // 3) أدوات التشخيص
    const tools = await api('/api/settings/tools-policy');
    if (tools && tools.success) {
      const d = tools.data;
      if (el('tools-min-role')) el('tools-min-role').value = d.min_role;
      if (el('tools-allow-public')) el('tools-allow-public').checked = !!d.allow_public;
      if (el('tools-allowed-cidrs')) el('tools-allowed-cidrs').value = d.allowed_cidrs || '';
      if (el('tools-effective')) {
        el('tools-effective').textContent = T('s2j.in_effect_now_users', 'الساري الآن — المستخدمون:') + ' ' + d.effective.who_can_use + ' · الأهداف: ' + d.effective.targets + ' · المجهول: ' + d.effective.anonymous;
      }
    }
  }

  async function save() {
    // (1) وضع الزوار
    const pubMode = el('disp-public-mode').value;
    const r1 = await jsonApi('/api/settings/public-display', 'PUT', { mode: pubMode });
    if (!r1 || !r1.success) { showToast((r1 && r1.error) || 'تعذّر حفظ وضع العرض العام', { type: 'error' }); return; }

    // (2) ما يراه المستخدم المسجَّل
    const nocMode = el('disp-noc-internal').checked ? 'full' : 'off';
    const r2 = await jsonApi('/api/settings/noc-display', 'PUT', { mode: nocMode });
    if (!r2 || !r2.success) { showToast((r2 && r2.error) || 'تعذّر حفظ إعداد العناوين', { type: 'error' }); return; }

    // (3) أدوات التشخيص
    const r3 = await jsonApi('/api/settings/tools-policy', 'PUT', {
      min_role: el('tools-min-role').value,
      allow_public: el('tools-allow-public').checked ? 1 : 0,
      allowed_cidrs: (el('tools-allowed-cidrs').value || '').trim(),
    });
    if (!r3 || !r3.success) { showToast((r3 && r3.error) || 'تعذّر حفظ سياسة الأدوات', { type: 'error' }); return; }

    showToast(T('s2j.display_and_tools_settings_saved_applied_ins', '✅ تم حفظ إعدادات العرض والأدوات — تُطبَّق فورًا ومُسجَّلة في التدقيق'));
    load();
  }

  // معاينة الزائر: نطلب **نفس** ما يصل للزائر حرفيًّا (المسار العام لا يحمل عناوين إطلاقًا).
  async function previewGuest() {
    const out = el('guest-preview-out');
    if (!out) return;
    out.classList.remove('hidden');
    out.textContent = T('s2j.preparing', '…جارٍ التجهيز');
    const mode = await api('/api/settings/public-display');
    const st = await api('/api/public/status');
    const modeNow = (mode && mode.success && mode.data.mode) || 'lan';
    if (modeNow === 'off') {
      out.textContent = '⛔ العرض العام موقوف الآن — الزائر لا يرى أي شيء (يُرفض طلبه) — «إيقاف تام».';
      return;
    }
    const devs = (st && st.success && Array.isArray(st.data)) ? st.data : [];
    const hasIp = JSON.stringify(devs).includes('"ip"') || JSON.stringify(devs).match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    const stAr = { online: T('s2x.online', 'متصل'), offline: T('s2x.offline', 'متوقف'), unknown: 'غير معروف', paused: 'موقوف' };
    const sample = devs.slice(0, 5).map((d) => {
      const extra = d.overall_health === 'degraded' ? ' · خدمة متوقفة' : '';
      return '• ' + d.name + ' — ' + (stAr[d.status] || d.status || '؟') + extra;
    }).join('\n');
    out.textContent = T('s2j.as_a_visitor_sees_it_right_now', '👁️ كما يراها الزائر الآن:') + ' ' + (MODE_AR[modeNow] || modeNow) + '\n'
      + 'عدد الأجهزة الظاهرة: ' + devs.length + '   |   هل تحوي عناوين؟ ' + (hasIp ? '⚠️ نعم (راجع!)' : 'لا ✓ — العناوين محجوبة تمامًا') + '\n\n'
      + (sample || 'لا أجهزة للعرض.\n')
      + '\n(للتجربة الفعلية بالكامل: افتح الصفحة العامة في نافذة متخفّية)';
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (el('disp-save')) el('disp-save').addEventListener('click', save);
    if (el('guest-preview-btn')) el('guest-preview-btn').addEventListener('click', previewGuest);
    // تحميل القيم عند فتح التبويب (وإن كان مفتوحًا افتراضيًّا نادرًا)
    if (el('tab-display')) el('tab-display').addEventListener('click', load);
    if (el('section-display') && !el('section-display').classList.contains('hidden')) load();
  });

  window.AdminDisplay = { load, save, previewGuest };
})();
