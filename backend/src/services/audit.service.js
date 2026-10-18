// audit.service.js ( SEC-03) — سجل تدقيق للأحداث الحساسة.
// ═══════════════════════════════════════════════════════════════════════════
// يُسجِّل: نجاح/فشل تسجيل الدخول، القفل، الخروج، تغيير كلمة المرور، إدارة المستخدمين،
// تشغيل أدوات التشخيص، بدء/إلغاء/إضافة نتائج المسح، النسخ الاحتياطي، التحديثات، الوصول
// عن بُعد، وتغيير الإعدادات. لا يُسجِّل أبدًا كلمات مرور/توكنات (تنقية تلقائية للمفاتيح).
// الاستدعاء لا يرمي أبدًا — فشل التدقيق لا يجوز أن يكسر الطلب الأصلي.
'use strict';
const db = require('../db');

const SENSITIVE_KEY_PARTS = ['password', 'passwd', 'token', 'secret', 'authorization', 'cookie', 'apikey', 'api_key', 'private_key', 'vapid', 'credential', 'otp'];

function scrub(value, depth = 0) {
  if (depth > 4) return '[deep]';
  if (value == null) return null;
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const kl = String(k).toLowerCase();
    out[k] = SENSITIVE_KEY_PARTS.some((s) => kl.includes(s)) ? '[REDACTED]' : scrub(v, depth + 1);
  }
  return out;
}

function clientIp(req) {
  if (!req) return null;
  return req.ip || (req.socket && req.socket.remoteAddress) || null;
}

// record(event, req, { target, details, actor, role })
function record(event, req, opts = {}) {
  try {
    const user = req && req.session && req.session.user;
    const actor = user ? user.username : (opts.actor != null ? String(opts.actor).slice(0, 120) : null);
    const role = user ? user.role : (opts.role != null ? String(opts.role).slice(0, 40) : null);
    db.prepare(
      `INSERT INTO audit_log (at, actor, role, event, target, details, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      new Date().toISOString(),
      actor,
      role,
      String(event || 'unknown').slice(0, 80),
      opts.target == null ? null : String(opts.target).slice(0, 200),
      opts.details == null ? null : JSON.stringify(scrub(opts.details)),
      clientIp(req)
    );
  } catch (e) {
    console.error('[audit] record failed:', e.message);
  }
}

module.exports = { record, scrub, clientIp, SENSITIVE_KEY_PARTS };
