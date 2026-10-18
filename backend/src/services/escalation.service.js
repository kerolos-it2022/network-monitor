// escalation.service.js (v2.25.0) — 🚨 تصعيد الانقطاعات: إشعار واحد قد يُقرأ ويُنسى؛
// جهاز ما زال واقعًا بعد X دقيقة يستحق تنبيهًا ثانيًا (وتذكيرًا دوريًّا اختياريًّا
// كل M دقيقة) حتى يُحلَّ. حلقة دقيقة واحدة قراءة downtime_events المفتوحة.
// الإعدادات من notification_settings: escalation_enabled · escalation_after_minutes
// (افتراضي 30) · escalation_repeat_minutes (0 = تصعيد واحد فقط).
// الإرسال عبر notifier (يحترم نافذة الصيانة وقنوات التفعيل بنفسه). تتبّع التصعيد
// في الذاكرة فقط — بعد إعادة تشغيل الخدمة يُعيد التذكير مرة واحدة للانقطاعات
// المزمنة (مقبول والتقاطه يبدأ من لحظة الإقلاع).
const db = require('../db');
// قرار المالك (2026-10-18): رسائل التصعيد والتذكير الدور **المُرسَلة** تُبنى بلغة الإشعارات (عربي/إنجليزي).
const { msg, pick, isEn } = require('./message-i18n.service');

// enCount(n, word): صياغة إنجليزية سليمة للعدد (1 minute · 30 minutes) — والعربية كما هي حرفيًّا.
function enCount(n, word) { return n + ' ' + word + (Number(n) === 1 ? '' : 's'); }

// eventId → طابع آخر تصعيد بالميلي ثانية (في الذاكرة فقط — انظر الرأس).
const lastEscalated = new Map();
let seeded = false; // أول دورة: الانقطاعات المزمنة القائمة تُحسب مُصفَّرة من لحظة الإقلاع.

function escSettings() {
  try {
    const r = db.prepare(
      'SELECT escalation_enabled e, escalation_after_minutes a, escalation_repeat_minutes r FROM notification_settings WHERE id = 1'
    ).get();
    if (r) return {
      enabled: !!Number(r.e),
      afterMin: Math.max(1, Number(r.a) || 30),
      repeatMin: Math.max(0, Number(r.r) || 0),
    };
  } catch (e) { /* أعمدة غير مرحّلة ⇒ الافتراضي */ }
  return { enabled: false, afterMin: 30, repeatMin: 0 };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function tickEscalation() {
  const cfg = escSettings();
  if (!cfg.enabled) { lastEscalated.clear(); seeded = false; return; }
  const now = Date.now();
  let open = [];
  try {
    open = db.prepare(`
      SELECT de.id, de.device_id, de.started_at, d.name, d.ip
      FROM downtime_events de
      JOIN devices d ON d.id = de.device_id
      WHERE de.ended_at IS NULL AND d.is_active = 1
    `).all();
  } catch (e) { return; }

  for (const ev of open) {
    const started = Date.parse(ev.started_at);
    if (!Number.isFinite(started)) continue;
    const downMin = (now - started) / 60000;
    // أول دورة بعد الإقلاع: الانقطاعات المزمنة القائمة لا تُصعَّد فورًا (تُصفَّر) —
    // الإقلاع نفسه هو بداية المحاسبة الجديدة.
    if (!seeded) { lastEscalated.set(ev.id, now); continue; }
    if (downMin < cfg.afterMin) continue;
    const last = lastEscalated.get(ev.id) || 0;
    const repeatDue = cfg.repeatMin > 0 && (now - last) >= cfg.repeatMin * 60000;
    if (last > 0 && !repeatDue) continue;
    lastEscalated.set(ev.id, now);
    // تنظيف القديم حتى لا ينمو الخريطة بلا نهاية.
    if (lastEscalated.size > 500) {
      for (const [k, v] of lastEscalated) { if (now - v > 1000 * 60 * 60 * 6) lastEscalated.delete(k); }
    }
    const min = Math.round(downMin);
    const repeatNote = last > 0 && repeatDue
      ? msg(' (تذكير دوري كل {m} دقيقة)', ' (periodic reminder every {mUnit})',
        { m: cfg.repeatMin, mUnit: enCount(cfg.repeatMin, 'minute') })
      : '';
    const text = msg(
      '🚨 <b>تصعيد انقطاع</b>{note}\n' +
      '🔴 <b>{name}</b> — <code>{ip}</code>\n' +
      '⏱️ ما زال واقعًا منذ <b>{min} دقيقة</b> (العتبة: {after} دقيقة) — تحرّك الآن أو أكّد العمل.',
      '🚨 <b>Outage escalation</b>{note}\n' +
      '🔴 <b>{name}</b> — <code>{ip}</code>\n' +
      '⏱️ Still down for <b>{minUnit}</b> (threshold: {afterUnit}) — act now or acknowledge.',
      {
        note: repeatNote, name: esc(ev.name), ip: esc(ev.ip || '?'),
        min, minUnit: enCount(min, 'minute'), after: cfg.afterMin, afterUnit: enCount(cfg.afterMin, 'minute'),
      }
    );
    try {
      const notifier = require('./notifier.service');
      const { tgButtons } = require('./telegram-bot.service');
      await notifier.sendTelegram(text, ev.device_id, tgButtons(), 'HTML');
      await notifier.sendWhatsapp(text.replace(/<\/?(b|code)>/g, ''), ev.device_id);
      await notifier.sendMobile(text.replace(/<\/?(b|code)>/g, ''), ev.device_id);
      console.log('[escalation] تصعيد أُرسل لـ', ev.name, '(' + Math.round(downMin) + ' دقيقة)');
    } catch (e) {
      console.error('[escalation] فشل إرسال التصعيد:', e.message);
    }
  }
  seeded = true;
}

function startEscalation() {
  setInterval(() => { tickEscalation().catch(() => {}); }, 60000).unref();
  setTimeout(() => { tickEscalation().catch(() => {}); }, 15000).unref();
}

module.exports = { startEscalation, tickEscalation, escSettings };
