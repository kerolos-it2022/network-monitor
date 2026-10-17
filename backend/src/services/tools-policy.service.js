// tools-policy.service.js (SpaceKit SEC-01 + قرار المالك) — سياسة أدوات التشخيص من اللوحة.
// ═══════════════════════════════════════════════════════════════════════════
// الأولوية: إعداد اللوحة (app_settings) ← متغير البيئة ← الافتراضي الآمن.
// القيم: min_role (admin|viewer) · allow_public (0|1) · allowed_cidrs (نصّ CIDR مفصول بفواصل، فارغ = الخاص فقط).
// كل تغيير من المدير يُسجَّل في التدقيق (في مسار الإعدادات)، وأي طلب يقرأ السياسة لحظيًّا
// (بلا إعادة تشغيل) — فلا حاجة لتعديل .env بعد اليوم.
'use strict';
const db = require('../db');
const { parseCidrList } = require('./net/net-utils');

const KEYS = {
  minRole: 'tools_min_role',
  allowPublic: 'tools_allow_public',
  allowedCidrs: 'tools_allowed_cidrs',
};
const DEFAULTS = { minRole: 'admin', allowPublic: false, allowedCidrs: '' };

function readSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (_) {
    return null; // جدول غير موجود (قاعدة قديمة قبل التهيئة) ⇒ نكمل بالبيئة/الافتراضي
  }
}

function writeSetting(key, value) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

// هل النطاقات المخصّصة صالحة؟ (نرفض أي مدخل غير قابل للتحليل بدل تجاهله بصمت)
function validateCidrs(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return { ok: true, value: '' };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const parsed = parseCidrList(raw);
  if (parsed.length !== parts.length) {
    return { ok: false, error: 'قائمة النطاقات فيها عنصر غير صالح: ' + parts.filter((p, i) => !parsed[i] || !parseCidrList(p).length).join(' · ') };
  }
  return { ok: true, value: parts.join(',') };
}

// السياسة السارية الآن (تُقرأ في كل طلب ⇒ أي تغيير يطبَّق فورًا).
function getToolsPolicy(env = process.env) {
  const dbMinRole = String(readSetting(KEYS.minRole) || '').toLowerCase();
  const dbAllowPublic = readSetting(KEYS.allowPublic);
  const dbCidrs = readSetting(KEYS.allowedCidrs);

  const envMinRole = String(env.NM_TOOLS_MIN_ROLE || '').toLowerCase();
  const envAllowPublic = String(env.NM_TOOLS_ALLOW_PUBLIC || '') === '1';
  const envCidrs = String(env.NM_TOOLS_ALLOWED_CIDRS || '').trim();

  const minRole = ['admin', 'viewer'].includes(dbMinRole) ? dbMinRole
    : (['admin', 'viewer'].includes(envMinRole) ? envMinRole : DEFAULTS.minRole);
  const allowPublic = dbAllowPublic != null ? String(dbAllowPublic) === '1' : envAllowPublic;
  const allowedCidrs = (dbCidrs != null ? String(dbCidrs) : envCidrs).trim();

  const source = {
    minRole: ['admin', 'viewer'].includes(dbMinRole) ? 'dashboard' : (['admin', 'viewer'].includes(envMinRole) ? 'env' : 'default'),
    allowPublic: dbAllowPublic != null ? 'dashboard' : (envAllowPublic ? 'env' : 'default'),
    allowedCidrs: dbCidrs != null ? 'dashboard' : (envCidrs ? 'env' : 'default'),
  };
  return { minRole, allowPublic, allowedCidrs, source };
}

// نطاقات جاهزة للتمرير إلى authorizeTarget (undefined = الافتراضي الخاص فقط).
function resolveCidrsForPolicy(policy) {
  const text = String(policy && policy.allowedCidrs || '').trim();
  if (!text) return undefined;
  const list = parseCidrList(text);
  return list.length ? list : undefined;
}

// حفظ السياسة من اللوحة (partial: أي حقل غائب يبقى كما هو).
function saveToolsPolicy(body = {}) {
  const current = getToolsPolicy();
  const next = {
    minRole: body.min_role !== undefined ? String(body.min_role).toLowerCase() : current.minRole,
    allowPublic: body.allow_public !== undefined ? !!body.allow_public : current.allowPublic,
    allowedCidrs: body.allowed_cidrs !== undefined ? String(body.allowed_cidrs) : current.allowedCidrs,
  };
  if (!['admin', 'viewer'].includes(next.minRole)) {
    return { ok: false, error: "أدنى رتبة يجب أن تكون 'admin' أو 'viewer'" };
  }
  const cidrsCheck = validateCidrs(next.allowedCidrs);
  if (!cidrsCheck.ok) return cidrsCheck;

  writeSetting(KEYS.minRole, next.minRole);
  writeSetting(KEYS.allowPublic, next.allowPublic ? '1' : '0');
  writeSetting(KEYS.allowedCidrs, cidrsCheck.value);
  return { ok: true, policy: getToolsPolicy() };
}

module.exports = { KEYS, DEFAULTS, getToolsPolicy, saveToolsPolicy, resolveCidrsForPolicy, validateCidrs };
