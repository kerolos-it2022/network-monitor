// scheduler-time.service.js — المصدر الوحيد لِتوقيت الجدولة (طلب المالك 2026-10-18:
// «ينفع نخلى ظبط التوقيت من لوحة التحكم» + «ضيف كمان ان فى توقيت صيفى و شتوى»).
// ─────────────────────────────────────────────────────────────
// القصة: التقرير اليومي كان يُقارَن بـ now.getHours() — أي**توقيت الخادم** — والأبلاينس يبقى
// على UTC بلا منطقة مضبوطة، فمالك UTC+3 يسجّل 10:30 ويصل التقرير 13:30 بتوقيته.
// الحل هنا: نقرأ المنطقة من notification_settings.timezone (اسم IANA مثل Africa/Cairo)،
// ونمرّرها إلى node-cron كخيار timezone، ونستعملها في المجدولات التي تفحص الدقيقة.
//
// قاعدة ثابتة: **لا نُخزّن ولا نمرّر إزاحة ثابتة أبدًا** (+03:00 …). اسم المنطقة وحده هو ما
// يجعل node-cron/Intl يحسبان التوقيت الصيفي والشتوي تلقائيًّا (مصر: +3 صيفًا و+2 شتاءً)
// فيبقى تقرير 10:30 في 10:30 طوال السنة بلا أي تعديل يدوي مرتين سنويًّا.
//
// NULL / '' في القاعدة = «توقيت الخادم المحلي» — نفس سلوك ما قبل الإضافة حرفيًّا (لا Intl إطلاقًا).
'use strict';
const db = require('../db');

// isIanaTimeZone(value): هل النصّ اسم منطقة IANA صالح؟ نبني Intl.DateTimeFormat داخل try/catch
// (نفس طريقة التحقق المعتمدة في مسار الحفظ). ونرفض إزاحات UTC الثابتة (+03:00 …) لأنها
// تُجمّد التوقيت الصيفي، ونرفض أي شيء آخر يرميه Intl.
function isIanaTimeZone(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || v.startsWith('+') || v.startsWith('-')) return false;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone || '';
    // بعض إصدارات ICU تقبل '+03:00' كـ timeZone وتعيدها كما هي في resolvedOptions ⇒ نرفضها.
    return !!resolved && !resolved.startsWith('+') && !resolved.startsWith('-');
  } catch (e) {
    return false;
  }
}

// canonicalTimeZone(value): الاسم القانوني للمنطقة ('Africa/Cairo') أو null لو غير صالح.
// ما يُخزَّن هو الناتج — فلا تدخل القاعدة صيغة عشوائية.
function canonicalTimeZone(value) {
  if (!isIanaTimeZone(value)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: String(value).trim() }).resolvedOptions().timeZone || null;
  } catch (e) {
    return null;
  }
}

// schedulerTimezone(): المنطقة المضبوطة في اللوحة أو null (= توقيت الخادم المحلي).
// قراءة واحدة مباشرة من صف إعدادات الإشعارات (id=1) — المرجع الوحيد لكل المجدولات.
function schedulerTimezone() {
  try {
    const r = db.prepare('SELECT timezone FROM notification_settings WHERE id = 1').get();
    const v = r && r.timezone != null ? String(r.timezone).trim() : '';
    return v && isIanaTimeZone(v) ? v : null;
  } catch (e) {
    return null; // عمود غير مرحَّل بعد (قاعدة قديمة) ⇒ السلوك القديم بلا كسر
  }
}

// cronSchedulerOptions(): خيارات cron.schedule — { timezone } عند الضبط، وundefined عند null
// (نمرّر undefined فلا يتغيّر سلوك أي تثبيت قائم لم يضبط منطقة).
function cronSchedulerOptions() {
  const tz = schedulerTimezone();
  return tz ? { timezone: tz } : undefined;
}

// wallClockParts(zone, date): أجزاء التقويم (سنة/شهر/يوم/ساعة/دقيقة/ثانية) في المنطقة المطلوبة.
function wallClockParts(zone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
  };
}

// wallClockIn(zone, date): وقت الحائط (ساعة:دقيقة + مفتاح اليوم) في المنطقة المطلوبة.
// zone=null ⇒ getHours/getMinutes/toDateString القديمة بالحرف (بلا Intl) — صفر تغيير سلوك.
function wallClockIn(zone, date = new Date()) {
  if (!zone) {
    return {
      hour: date.getHours(),
      minute: date.getMinutes(),
      hm: String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'),
      dayKey: date.toDateString(),
    };
  }
  const p = wallClockParts(zone, date);
  const p2 = (n) => String(n).padStart(2, '0');
  return {
    hour: p.hour,
    minute: p.minute,
    hm: p2(p.hour) + ':' + p2(p.minute),
    dayKey: p.year + '-' + p2(p.month) + '-' + p2(p.day),
  };
}

// zoneOffsetMinutes(zone, date): إزاحة المنطقة عن UTC بالدقائق في اللحظة المطلوبة.
// تتبع التوقيت الصيفي تلقائيًّا (القاهرة: 180 صيفًا · 120 شتاءً) — تُستعمل في العرض والاختبارات.
function zoneOffsetMinutes(zone, date = new Date()) {
  const p = wallClockParts(zone, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const epochSec = Math.floor(date.getTime() / 1000) * 1000; // تجاهُل أجزاء الثانية
  return Math.round((asUtc - epochSec) / 60000);
}

// zoneOffsetLabel(zone, date): 'UTC+03:00' — للعرض في التلميح (الواجهة تحسبها عندها بنفس الطريقة).
function zoneOffsetLabel(zone, date = new Date()) {
  const m = zoneOffsetMinutes(zone, date);
  const sign = m >= 0 ? '+' : '-';
  const abs = Math.abs(m);
  return 'UTC' + sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
}

// zonedWallToUtc(zone, y, m, d, h, min): أول لحظة UTC يوافق فيها وقت الحائط المطلوب في المنطقة.
// تقريب تدريجي (يعمل مع التوقيت الصيفي لأن Intl نفسه يحسم الإزاحة الفعّالة في كل لحظة).
// يعيد null لو كان الوقت المحلي **غير موجود** (ساعة محذوفة عند تقديم الساعة).
function zonedWallToUtc(zone, year, month, day, hour, minute) {
  let ts = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const targetPseudoUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 4; i++) {
    const p = wallClockParts(zone, new Date(ts));
    // الفرق بين **وقت الحائط المطلوب** و**وقت الحائط الحالي** (كلاهما كطابع زمني رمزي) — لا بينه وبين اللحظة UTC.
    const drift = targetPseudoUtc - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (drift === 0) return new Date(ts);
    ts += drift;
  }
  const p = wallClockParts(zone, new Date(ts));
  return (p.hour === hour && p.minute === minute) ? new Date(ts) : null;
}

// nextReportDates(hhmm, zone, count, from): أوقات الإطلاق التالية (لحظات UTC) لتقرير يومي
// ساعته hh:mm في المنطقة المطلوبة — تُبنى على قواعد المنطقة نفسها التي يستعملها node-cron،
// فالتوقيت الصيفي/الشتوي مُحتسب (القاهرة: 10:30 صيفًا = 07:30 UTC · شتاءً = 08:30 UTC).
// zone=null ⇒ توقيت الخادم المحلي. تُستعمل في الاختبارات للتحقق من سلوك DST.
function nextReportDates(hhmm, zone, count = 1, from = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '08:00'));
  const hour = m ? Math.min(23, Number(m[1])) : 8;
  const minute = m ? Math.min(59, Number(m[2])) : 0;
  const out = [];
  if (!zone) {
    const d = new Date(from.getTime());
    d.setSeconds(0, 0);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
    for (let i = 0; i < count; i++) { out.push(new Date(d.getTime())); d.setDate(d.getDate() + 1); }
    return out;
  }
  const start = wallClockParts(zone, from);
  for (let i = 0; out.length < count && i < 367; i++) {
    // تقويم اليوم التالي في المنطقة (حساب تقويمي صافٍ عبر UTC — لا يتأثّر بتغيّر الساعة)
    const cal = new Date(Date.UTC(start.year, start.month - 1, start.day + i, 0, 0, 0));
    const cand = zonedWallToUtc(zone, cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), hour, minute);
    if (cand && cand.getTime() > from.getTime()) out.push(cand);
  }
  return out;
}

module.exports = {
  isIanaTimeZone,
  canonicalTimeZone,
  schedulerTimezone,
  cronSchedulerOptions,
  wallClockIn,
  wallClockParts,
  zoneOffsetMinutes,
  zoneOffsetLabel,
  nextReportDates,
};
