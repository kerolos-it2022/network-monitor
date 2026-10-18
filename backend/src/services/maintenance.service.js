// maintenance.service.js (v2.14.1) — نافذة الصيانة.
// الإعداد من لوحة التحكم: maintenance_enabled (0/1) + maintenance_window 'HH:MM-HH:MM'.
// تدعم النافذة العابرة لمنتصف الليل (مثل '23:00-06:00').
// الاستخدام في notifier: أثناء النافذة تُكتم الإشعارات وتُسجل بحالة 'maintenance'
// (تظهر في سجل الإشعارات) بدل زعزعة الهاتف أثناء عمل صيانة مقصود.
const db = require('../db');
const { getSettings } = require('./notifier.service');

let cache = { at: 0, enabled: false, from: null, to: null }; // كاش 30 ثانية

function parseHm(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  return m ? { h: parseInt(m[1], 10), m: parseInt(m[2], 10) } : null;
}

// minutesOf(t): تحويل HH.MM إلى دقائق من منتصف الليل.
function minutesOf(t) { return t.h * 60 + t.m; }

async function refreshCache(force = false) {
  if (!force && Date.now() - cache.at < 30000) return cache;
  try {
    const s = await getSettings();
    const win = String(s.maintenance_window || '').trim();
    const parts = win.split('-');
    const from = parseHm(parts[0]);
    const to = parseHm(parts[1]);
    cache = {
      at: Date.now(),
      enabled: !!(s.maintenance_enabled && from && to),
      from, to,
    };
  } catch (e) {
    cache = { at: Date.now(), enabled: false, from: null, to: null };
  }
  return cache;
}

// isMaintenanceNow(): true لو داخل نافذة الصيانة المفعّلة (مع دعم عبور منتصف الليل).
async function isMaintenanceNow() {
  const c = await refreshCache();
  if (!c.enabled) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const f = minutesOf(c.from), t = minutesOf(c.to);
  if (f === t) return false;           // نافذة صفرية = معطلة عمليًّا
  if (f < t) return cur >= f && cur < t;        // نافذة داخل اليوم
  return cur >= f || cur < t;          // نافذة عبور منتصف الليل
}

module.exports = { isMaintenanceNow };
