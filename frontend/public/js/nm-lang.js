// nm-lang.js — زر تبديل اللغة في لوحة التحكم + مزامنة الإعداد مع الخادم.
//
// قرار المالك: **إعداد واحد** لكل الحاجات — الزر في اللوحة يغيّر اللغة للوحة والصفحة العامة وشاشة NOC
// جميعًا (محفوظ في الخادم)، ومع ذلك تُحفظ نسخة في المتصفح (nm.lang) ليظهر الاتجاه الصحيح قبل الرسم
// (سكربت <head> صغير في كل صفحة) وليعمل تسجيل الدخول والصفحة العامة بلغتهم فورًا.
//
// سلوك الزر: يبدّل فورًا في هذه الصفحة (بلا انتظار الخادم) ثم يرسل الإعداد للخادم في الخلفية؛
// ولو فشل الإرسال تظل الصفحة بلغتها الجديدة (لا نُربك المستخدم) ويُسجَّل تحذير في الطرفية.
(function () {
  'use strict';

  const API = '/api/settings/ui-language';
  const OTHER = { ar: 'en', en: 'ar' };

  function i18n() { return window.NMI18N; }
  function lang() { const n = i18n(); return n ? n.getLang() : 'ar'; }

  /** نصّ الزر = اللغة التي ستُفعّل عند الضغط (من القاموس نفسه). */
  function paintButton() {
    const btn = document.getElementById('lang-toggle');
    if (!btn || !i18n()) return;
    btn.textContent = i18n().t('topbar.lang');
    btn.title = i18n().t('lang.switchTitle');
    btn.setAttribute('aria-label', i18n().t('lang.switchTitle'));
    btn.setAttribute('data-lang', lang());
  }

  function apply(code, opts) {
    const n = i18n();
    if (!n) return 'ar';
    const before = n.getLang();
    const next = n.setLang(code, opts);
    paintButton();
    // صفوف الجداول المبنية بالجافاسكربت تُرسم بلغة لحظة الرسم ⇒ نُعيد رسم القسم المفتوح حتى تصير
    // الإنجليزية كاملة (إعادة نقر التبويب النشط تُشغّل مُحمِّل القسم نفسه — بلا منطق مكرّر).
    if (before !== next) {
      try {
        const active = document.querySelector('.sidebar .tab-btn.active');
        if (active) setTimeout(() => { try { active.click(); } catch (e) {} }, 30);
      } catch (e) {}
    }
    return next;
  }

  /** إرسال الإعداد للخادم (أفضل جهد) — لتحصل الصفحة العامة وNOC على نفس اللغة. */
  function pushToServer(code) {
    try {
      fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ui_language: code }),
      }).then((r) => { if (!r.ok) console.warn('[lang] server refused the language setting:', r.status); })
        .catch((e) => console.warn('[lang] could not save the language setting:', e.message));
    } catch (e) { console.warn('[lang] save failed:', e.message); }
  }

  /**
   * قراءة لغة النظام من الخادم. الأولوية للخادم (إعداد واحد للجميع) لكن لا نُعيد رسم
   * الصفحة إلا لو اختلفت فعلًا — فتغيير المستخدم المحلي لا يُلغى بلا داعٍ.
   */
  function syncFromServer() {
    try {
      fetch(API, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const srv = data && data.success && data.data ? data.data.ui_language : null;
          if (!srv || srv === lang()) return;
          apply(srv, { persist: true });
        })
        .catch(() => {});
    } catch (e) {}
  }

  function toggle() {
    const next = OTHER[lang()] || 'en';
    apply(next, { persist: true });
    pushToServer(next);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.addEventListener('click', toggle);
    paintButton();
    syncFromServer();
  });

  // أي تغيير لغة (من الزر أو من الخادم) يُعيد ضبط نصّ الزر
  document.addEventListener('nm:lang', paintButton);

  window.NMLang = { toggle, apply, lang, paintButton, syncFromServer, API };
})();
