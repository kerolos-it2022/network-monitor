// ui-language.service.js — لغة واجهة النظام (عربي / إنجليزي) كـ**إعداد واحد لكل الحاجات**.
// ═══════════════════════════════════════════════════════════════════════════
// قرار المالك (2026-10-17): زر اللغة في لوحة التحكم يغيّر اللوحة والصفحة العامة وشاشة NOC معًا،
// فوُضع الإعداد هنا (app_settings) لا في متصفح كل زائر — وأي جهاز يُظهر الرابط يرى نفس اللغة.
//
// الأولوية: إعداد قاعدة البيانات (app_settings.ui_language) ← متغير البيئة NM_UI_LANGUAGE ← 'en'.
// قرار المالك (2026-10-18): صارت **الإنجليزية** هي اللغة الافتراضية للنظام كله (كانت العربية).
// ملاحظة: القيمة هنا **للغة الواجهة فقط**؛ لا علاقة لها بلغة بيانات المستخدم (أسماء الأجهزة/المواقع)
// ولا بقيم التشغيل البرمجية (lan · ping · zone) — تلك لا تُترجم بتصميم النظام.
//
// المنطق نفسه مشترك في language-setting.service.js (معه إعداد لغة الإشعارات) — هذا الملف يلفّه باسم
// الإعداد فقط، ويُصدّر ما كان يُصدّره سابقًا: LANGS · DEFAULT_LANG · SETTING_KEY · getLang ·
// getLangSource · setLang · normalize.
'use strict';
const { createLanguageSetting } = require('./language-setting.service');

module.exports = createLanguageSetting({
  key: 'ui_language',
  defaultLang: 'en',
  envVar: 'NM_UI_LANGUAGE',
  label: 'واجهة النظام',
});
