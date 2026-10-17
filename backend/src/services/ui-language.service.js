// ui-language.service.js — لغة واجهة النظام (عربي / إنجليزي) كـ**إعداد واحد لكل الحاجات**.
// ═══════════════════════════════════════════════════════════════════════════
// قرار المالك (2026-10-17): زر اللغة في لوحة التحكم يغيّر اللوحة والصفحة العامة وشاشة NOC معًا،
// فوُضع الإعداد هنا (app_settings) لا في متصفح كل زائر — وأي جهاز يُظهر الرابط يرى نفس اللغة.
//
// الأولوية: إعداد قاعدة البيانات (app_settings.ui_language) ← متغير البيئة NM_UI_LANGUAGE ← 'ar'.
// ملاحظة: القيمة هنا **للغة الواجهة فقط**؛ لا علاقة لها بلغة بيانات المستخدم (أسماء الأجهزة/المواقع)
// ولا بقيم التشغيل البرمجية (lan · ping · zone) — تلك لا تُترجم بتصميم النظام.
'use strict';
const db = require('../db');

const LANGS = ['ar', 'en'];
const DEFAULT_LANG = 'ar';
const SETTING_KEY = 'ui_language';

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

function normalize(value) {
  // مطابقة تامة بعد التنظيف (لا قبول لأي شيء آخر مثل 'english' أو 'ar-EG')
  const v = String(value || '').trim().toLowerCase();
  return LANGS.includes(v) ? v : null;
}

function getLang() {
  return normalize(readSetting(SETTING_KEY)) || normalize(process.env.NM_UI_LANGUAGE) || DEFAULT_LANG;
}

function getLangSource() {
  if (normalize(readSetting(SETTING_KEY))) return 'database';
  if (normalize(process.env.NM_UI_LANGUAGE)) return 'env';
  return 'default';
}

function setLang(lang) {
  const l = normalize(lang);
  if (!l) return { ok: false, error: 'قيمة غير صالحة — المسموح: ar | en' };
  writeSetting(SETTING_KEY, l);
  return { ok: true, ui_language: l };
}

module.exports = { LANGS, DEFAULT_LANG, SETTING_KEY, getLang, getLangSource, setLang, normalize };
