// language-setting.service.js — مصنع إعدادات اللغة (ar | en) المخزَّنة في app_settings.
// ═══════════════════════════════════════════════════════════════════════════
// إعدادان في النظام يحتاجان **نفس المنطق بالحرف**، فكُتب مرّة واحدة هنا:
//   • ui_language           — لغة الواجهة (اللوحة + الصفحة العامة + شاشة NOC).
//   • notification_language — لغة الإشعارات المُرسَلة ولغة عرض سجل الإشعارات.
// كل خدمة تلفّ هذا المصنع بإعدادها (المفتاح + الافتراضي + متغير البيئة) فتبقى أسماء التصدير نفسها.
//
// الأولوية في كل إعداد: صفّ قاعدة البيانات ← متغير البيئة ← الافتراضي (en لكليهما).
// ملاحظة: القيمة **للغة النصوص فقط**؛ لا علاقة لها ببيانات المستخدم (أسماء الأجهزة/المواقع) ولا بالقيم
// البرمجية (lan · ping · zone) — تلك لا تُترجم بتصميم النظام.
'use strict';
const db = require('../db');

const LANGS = ['ar', 'en'];

function readSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (_) {
    return null; // قاعدة قديمة قبل إنشاء الجدول — نكمل بالافتراضي
  }
}

function writeSetting(key, value) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

/**
 * createLanguageSetting({ key, defaultLang, envVar, label }) — كائن إعداد لغة كامل.
 * التصدير متطابق مع ما كانت تُصدّره ui-language.service.js قبل التوحيد.
 */
function createLanguageSetting(opts) {
  const o = opts || {};
  const SETTING_KEY = String(o.key || '');
  const DEFAULT_LANG = o.defaultLang === 'ar' ? 'ar' : 'en';
  const ENV_VAR = String(o.envVar || '');
  const LABEL = String(o.label || SETTING_KEY);
  if (!SETTING_KEY || !ENV_VAR) throw new Error('createLanguageSetting: key and envVar are required');

  function normalize(value) {
    // مطابقة تامة بعد التنظيف (لا قبول لأي شيء آخر مثل 'english' أو 'ar-EG')
    const v = String(value || '').trim().toLowerCase();
    return LANGS.includes(v) ? v : null;
  }

  function getLang() {
    return normalize(readSetting(SETTING_KEY)) || normalize(process.env[ENV_VAR]) || DEFAULT_LANG;
  }

  function getLangSource() {
    if (normalize(readSetting(SETTING_KEY))) return 'database';
    if (normalize(process.env[ENV_VAR])) return 'env';
    return 'default';
  }

  function setLang(lang) {
    const l = normalize(lang);
    if (!l) {
      // require كسول داخل الدالة: يتجنّب دورة تحميل (ui-text ← ui-language ← هذا المصنع)
      const { uiText } = require('./ui-text.service');
      return { ok: false, error: uiText('قيمة غير صالحة — المسموح: ar | en', 'Invalid value — allowed: ar | en') };
    }
    writeSetting(SETTING_KEY, l);
    return { ok: true, lang: l };
  }

  return {
    LANGS, DEFAULT_LANG, SETTING_KEY, ENV_VAR, LABEL,
    getLang, getLangSource, setLang, normalize,
  };
}

module.exports = { createLanguageSetting, LANGS };
