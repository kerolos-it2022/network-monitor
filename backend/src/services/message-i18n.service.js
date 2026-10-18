// message-i18n.service.js — نصوص الرسائل **المُرسَلة** بلغتين (عربي / إنجليزي).
// ═══════════════════════════════════════════════════════════════════════════
// قرار المالك (2026-10-18): لغة الرسائل التي تُرسَل فعلًا (تلجرام · واتساب · إشعار الموبايل · ردود
// بوت تلجرام · التصعيد · التقرير اليومي · تنبيه العواصف · الإشعار التجريبي) تتبع **إعداد لغة
// الإشعارات** (app_settings.notification_language) — رسالة واحدة بلغة واحدة، وكل القنوات بنفس اللغة.
//
// قاعدتان لا تُخرَقان:
//   ١) **النصّ العربي يبقى حرفيًّا كما كان** — هو أصل محتوى notification_logs، وعليه يقوم عقد
//      nm-log-i18n.js واختبار backend/test/log-i18n.test.js (مِسلات عربية توجد نصًّا في ملفات السيرفر).
//      أي تعديل في صياغة العربية يُوجب تحديث قاعدة الترجمة المقابلة.
//   ٢) **بيانات المستخدم لا تُترجم أبدًا**: أسماء الأجهزة والمواقع والصانع والـIP/MAC تُنسخ كما هي،
//      وكذلك أسماء الخدمات. المتغيّرات `{name}` تُعبَّأ بالقيمة الحرفية.
//
// الاستعمال:
//   msg('🔴 انقطع الجهاز: {name}', '🔴 Device down: {name}', { name: device.name })
//   pick('غير معروف', 'unknown')                 // نصّ ثابت بلا متغيّرات
//   both('انقطع', 'down')                        // الاثنان معًا (تحليل AI في التقرير اليومي)
'use strict';
const ntfLang = require('./notification-language.service');

/** اللغة الحالية للرسائل — 'ar' | 'en'. */
function currentLang() { return ntfLang.getLang() === 'ar' ? 'ar' : 'en'; }

/** هل الإنجليزية هي لغة الرسائل الحالية؟ */
function isEn() { return currentLang() === 'en'; }

/** pick(ar, en) — النصّ الثابت باللغة الحالية. */
function pick(ar, en) { return isEn() ? en : ar; }

/** both(ar, en) — النصّان معًا (يُستعمل حيث تحتاج الرسالة الواحدة اللغتين، مثل تحليل AI). */
function both(ar, en) { return { ar: ar, en: en }; }

/**
 * fill(text, vars) — تعبئة `{token}` بقيمة المتغيّر. المتغيّر المجهول يبقى كما هو (لا نصّ فارغ ولا
 * «undefined» يظهران للمستخدم — نفس فلسفة t() في nm-i18n.js).
 */
function fill(text, vars) {
  if (!vars || typeof vars !== 'object' || typeof text !== 'string') return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined || vars[name] === null ? m : String(vars[name])));
}

/** msg(ar, en, vars) — النصّ المُرسَل باللغة الحالية مع تعبئة المتغيّرات. */
function msg(ar, en, vars) { return fill(pick(ar, en), vars); }

/**
 * now() — ختم زمني للرسائل بلغة الرسائل الحالية.
 * العربية: `toLocaleString('ar')` كما كانت حرفيًّا (لا تغيير في أي رسالة عربية قائمة).
 * الإنجليزية: نفس ما ينتجه مترجم السجل في الواجهة من الطابع العربي نفسه (nm-log-i18n.dt):
 * dd/mm/yyyy, h:mm:ss AM/PM — الساعة بلا صفر بادئ تمامًا كـ«4:40:00 م»، فيتطابق ما يُرسَل بما يُعرَض.
 */
function now(date) {
  const d = date instanceof Date ? date : new Date();
  if (!isEn()) return d.toLocaleString('ar');
  const p2 = (n) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}, ` +
    `${h12}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${h24 < 12 ? 'AM' : 'PM'}`;
}

module.exports = { currentLang, isEn, pick, both, fill, msg, now };
