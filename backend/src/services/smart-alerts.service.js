// smart-alerts.service.js (v2.14.1) — الذكاء في الإشعارات (المرحلة 1):
//   1) تجميع العواصف (Alert Digest): أول انقطاع يُرسل فورًا بشرفه اللازم؛ أي
//      انقطاعات إضافية خلال 90 ثانية تُجمَّع وترسل رسالة واحدة «⚠️ انقطاع جماعي»
//      مع تحليل **السبب المشترك المحتمل** من سلسلة الشبكة (أعمق جدّ مشترك للأجهزة).
//   2) التقرير اليومي المجدول: رسالة كل صباح (ساعة قابلة للضبط من اللوحة) تلخص
//      آخر 24 ساعة: عدد الانقطاعات، إجمالي دقائق الانقطاع، الأكثر انقطاعًا، والوضع الآن.
// لا مكتبات جديدة؛ الإرسال عبر notifier (يُطلب بتكاسل لتفادي الدوران الدائري) والأزرار
// عبر telegram-bot.service.
const db = require('../db');
const { isMaintenanceNow } = require('./maintenance.service');
// قرار المالك (2026-10-18): رسائل العاصفة والتقرير اليومي **المُرسَلة** تُبنى بلغة الإشعارات (عربي/إنجليزي).
const { msg, pick, isEn } = require('./message-i18n.service');

// enCount(n, word): صياغة إنجليزية سليمة للعدد (1 minute · 15 minutes) — والعربية كما هي حرفيًّا.
function enCount(n, word) { return n + ' ' + word + (Number(n) === 1 ? '' : 's'); }

// v2.14.2 — إعدادات العاصفة من قاعدة البيانات (مفتاح + المدة بالثواني، افتراضي 1/90).
function stormSettings() {
  try {
    const r = db.prepare('SELECT storm_digest_enabled e, storm_window_seconds w FROM notification_settings WHERE id = 1').get();
    if (r) return { enabled: !!Number(r.e), ms: Math.min(600, Math.max(15, Number(r.w) || 90)) * 1000 };
  } catch (e) { /* أعمدة غير مرحّلة بعد ⇒ الافتراضي */ }
  return { enabled: true, ms: 90 * 1000 };
}

// حالة نافذة العاصفة الجارية.
let storm = { active: false, timer: null, buffered: [] };

// esc(s): ترميز HTML (رسائل تلجرام بصيغة HTML).
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// deepestCommonAncestor(deviceIds): أعمق جدّ مشترك في سلسلة الشبكة للأجهزة المجمعة.
// يعيد {name, ip} أو null. يمنع الحلقات بمجموعة مزار.
function deepestCommonAncestor(deviceIds) {
  const chainOf = (id) => {
    const chain = [];
    let cur = id;
    const seen = new Set();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const row = db.prepare('SELECT id, parent_id, name, ip FROM devices WHERE id = ?').get(cur);
      if (!row) break;
      chain.push(row);
      cur = row.parent_id;
    }
    return chain;
  };
  let common = null;
  for (const id of deviceIds) {
    const chain = chainOf(id);
    const keySet = new Set(chain.map((c) => c.id));
    if (common === null) { common = keySet; continue; }
    common = new Set([...common].filter((x) => keySet.has(x)));
    if (common.size === 0) return null;
  }
  if (!common || common.size === 0) return null;
  // أعمق واحد = الأب الأقرب المشترك: أول id مشترك في سلسلة أول جهاز بالترتيب من الأقرب.
  const first = chainOf(deviceIds[0]).find((c) => common.has(c.id));
  return first || null;
}

// consumeDownEvent(device): قرار إنقطاع جهاز داخل العاصفة.
//   'send'   ⇒ أرسل فرديًّا (أول حدث — يستحق السرعة الكاملة)
//   'buffer' ⇒ انقطاع متلاحق داخل النافذة — يُجمَّع (لا رسالة فردية)
function consumeDownEvent(device) {
  const cfg = stormSettings();
  if (!cfg.enabled) return 'send';   // v2.14.2 — مفتاح الإيقاف ⇒ رسائل فردية زي السابق
  if (!storm.active) {
    storm.active = true;
    storm.buffered = [{ name: device.name, ip: device.ip, id: device.id, at: Date.now() }];
    storm.timer = setTimeout(() => { flushStorm().catch(() => {}); }, (stormSettings().ms));
    if (storm.timer && storm.timer.unref) storm.timer.unref();
    return 'send';
  }
  storm.buffered.push({ name: device.name, ip: device.ip, id: device.id, at: Date.now() });
  return 'buffer';
}

// flushStorm(): إرسال رسالة العاصفة المجمعة إن وُجد مخزون (وإلا فلا شيء).
async function flushStorm() {
  const buf = storm.buffered;
  storm.active = false;
  storm.buffered = [];
  if (storm.timer) { clearTimeout(storm.timer); storm.timer = null; }
  if (buf.length === 0) return;

  const notifier = require('./notifier.service');
  let text = msg(
    '⚠️ <b>انقطاع جماعي — {n} جهازًا خلال دقيقتين:</b>\n',
    '⚠️ <b>Mass outage — {n} devices within two minutes:</b>\n',
    { n: buf.length }
  ) +
    buf.map((b) => `🔴 <b>${esc(b.name)}</b> — <code>${esc(b.ip)}</code>`).join('\n');
  try {
    const anc = deepestCommonAncestor(buf.map((b) => b.id));
    if (anc) text += msg(
      '\n\n💡 <b>السبب المشترك المحتمل:</b> الجهاز الأب في السلسلة: <b>{name}</b> (<code>{ip}</code>) — افحصه أولًا.',
      '\n\n💡 <b>Likely common cause:</b> the parent device in the chain: <b>{name}</b> (<code>{ip}</code>) — check it first.',
      { name: esc(anc.name), ip: esc(anc.ip || '?') }
    );
  } catch (e) { /* فشل تحليل السلسلة لا يمنع الرسالة */ }

  try {
    // v2.19.0 — تصنيف الانقطاع: أجهزة المواقع ذات kind='internet' = خط/مدخل الإنترنت الخارجي.
    const anchors = db.prepare(
      "SELECT d.name, d.ip, d.current_status FROM devices d " +
      "LEFT JOIN locations l ON l.id = d.location_id " +
      "WHERE l.kind = 'internet' AND d.is_active = 1"
    ).all();
    const downA = anchors.filter((a) => a.current_status === 'offline');
    if (anchors.length > 0 && downA.length > 0) {
      text += msg(
        '\n🌐 <b>الخط الخارجي واقع أيضًا</b> ({ips}) — الأرجح: عطل من مزود الإنترنت/الراوتر الرئيسي وليس داخل شبكتك',
        '\n🌐 <b>The external line is down too</b> ({ips}) — most likely an ISP / main-router fault, not inside your network',
        { ips: esc(downA.map((a) => a.ip).join(', ')) }
      );
    } else if (anchors.length > 0) {
      text += pick(
        '\n✅ خط الإنترنت الخارجي يعمل — الانقطاع <b>داخلي</b> (سويتش/كابل/توصيلات)',
        '\n✅ The external internet line is up — the outage is <b>internal</b> (switch/cable/wiring)'
      );
    }
  } catch (e) { /* فشل التصنيف لا يمنع الرسالة */ }
  try {
    const { tgButtons } = require('./telegram-bot.service');
    await notifier.sendTelegram(text, null, tgButtons(), 'HTML');
    await notifier.sendWhatsapp(text.replace(/<\/?(b|code)>/g, ''), null);
    await notifier.sendMobile(text.replace(/<\/?(b|code)>/g, ''), null);
  } catch (e) {
    console.error('[smart-alerts] فشل إرسال رسالة العاصفة:', e.message);
  }
}

// buildDailyReport(): نص التقرير اليومي — آخر 24 ساعة (دالة نقية قابلة للاختبار).
function buildDailyReport(now = new Date()) {
  const cutoff = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const events = db.prepare(`
    SELECT de.device_id, de.started_at, de.ended_at, d.name
    FROM downtime_events de
    LEFT JOIN devices d ON d.id = de.device_id
    WHERE de.ended_at IS NOT NULL AND de.ended_at >= ?
  `).all(cutoff);
  const totalMin = events.reduce((a, e) => a + Math.max(0, (new Date(e.ended_at) - new Date(e.started_at)) / 60000), 0);
  const perDevice = {};
  for (const e of events) {
    const name = e.name || pick('جهاز محذوف', 'deleted device');
    if (!perDevice[name]) perDevice[name] = { min: 0, count: 0 };
    perDevice[name].min += Math.max(0, (new Date(e.ended_at) - new Date(e.started_at)) / 60000);
    perDevice[name].count++;
  }
  const worst = Object.entries(perDevice).sort((a, b) => b[1].min - a[1].min)[0];
  const d = db.prepare("SELECT current_status s, COUNT(*) n FROM devices WHERE is_active = 1 GROUP BY current_status").all();
  const m = Object.fromEntries(d.map((r) => [r.s, r.n]));
  const up = m.online || 0, down = m.offline || 0;
  const day = isEn() ? now.toLocaleDateString('en-GB') : now.toLocaleDateString('ar');
  const totalMinRounded = Math.round(totalMin);
  let text = msg(
    '📊 <b>التقرير اليومي — {day}</b>\n',
    '📊 <b>Daily report — {day}</b>\n',
    { day: esc(day) }
  );
  if (events.length === 0) {
    text += pick('✅ يوم نظيف: لا انقطاعات في آخر 24 ساعة 🎉', '✅ Clean day: no outages in the last 24 hours 🎉');
  } else {
    text += msg(
      'انقطاعات آخر 24 ساعة: <b>{n}</b> · إجمالي <b>{total}</b> دقيقة\n',
      'Outages in the last 24 hours: <b>{n}</b> · total <b>{totalUnit}</b>\n',
      { n: events.length, total: totalMinRounded, totalUnit: enCount(totalMinRounded, 'minute') }
    );
    if (worst) {
      const worstMin = Math.round(worst[1].min);
      text += msg(
        'الأكثر انقطاعًا: <b>{name}</b> — {min} دقيقة ({count} مرة)\n',
        'Most affected: <b>{name}</b> — {minUnit} ({countUnit})\n',
        {
          name: esc(worst[0]), min: worstMin, minUnit: enCount(worstMin, 'minute'),
          count: worst[1].count, countUnit: enCount(worst[1].count, 'time'),
        }
      );
    }
    text += msg('الوضع الآن: 🟢 {up} متصل · 🔴 {down} متوقف', 'Status now: 🟢 {up} online · 🔴 {down} offline', { up, down });
  }
  return text;
}

// buildDailyReportWithAnalysis(now): التقرير اليومي + قسم تحليل AI **باللغتين معًا** عند توفّر المزوّد.
// يعيد { text, plain }: text بوسوم تلجرام HTML، وplain بلا وسوم (واتساب/الموبايل).
// قرار المالك (2026-10-18): قارئا التقرير مختلفان ⇒ الكتلة العربية أولًا تحت «🧠 تحليل AI:» ثم
// الإنجليزية تحت «🧠 AI analysis:» وبينهما سطر فارغ — مهما كانت لغة الإشعارات. لا فاصل ولا كتلة فارغة.
// أي فشل في التحليل ⇒ التقرير العادي وحده كما كان (السلوك السابق نفسه).
async function buildDailyReportWithAnalysis(now = new Date()) {
  const base = buildDailyReport(now);
  let text = base;
  let plain = base.replace(/<[^>]+>/g, '');
  try {
    const ai = require('./ai.service');
    if (ai.isReady()) {
      // v2.25.0 — تحليل AI مُرفق (اختياري): «ملاحظة + توصية» بلغتين (المزوّد يطلب النصّين معًا،
      // وأي طرف ناقص يُكمَل بنصّ القواعد المحلية بلغته — نسخة 2026-10-18).
      const analysis = await ai.analyzeDailyReport(plain);
      if (analysis) {
        const arText = String(analysis.ar || '').trim();
        const enText = String(analysis.en || '').trim();
        if (arText) {
          text += '\n\n🧠 <b>تحليل AI:</b>\n' + esc(arText);
          plain += '\n\n🧠 تحليل AI:\n' + arText;
        }
        if (enText) {
          text += '\n\n🧠 <b>AI analysis:</b>\n' + esc(enText);
          plain += '\n\n🧠 AI analysis:\n' + enText;
        }
      }
    }
  } catch (e) { /* التحليل لم يجئ — التقرير وحده يكفي */ }
  return { text, plain };
}

// startDailyReport(): حلقة دقيقة واحدة تتحقق من الإعدادات (daily_report_enabled + hour)
// وترسل مرة واحدة يوميًا عند تطابق الساعة:الدقيقة.
function startDailyReport() {
  let lastSentDay = '';
  const tick = async () => {
    let enabled = false, hour = '';
    try {
      const r = db.prepare('SELECT daily_report_enabled, daily_report_hour FROM notification_settings WHERE id = 1').get();
      if (r) { enabled = !!r.daily_report_enabled; hour = String(r.daily_report_hour || '08:00'); }
    } catch (e) { return; }
    if (!enabled) { lastSentDay = ''; return; }
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toDateString();
    if (hm !== hour || lastSentDay === today) return;
    lastSentDay = today;
    try {
      const notifier = require('./notifier.service');
      let markup = null;
      try { markup = require('./telegram-bot.service').tgButtons(); } catch (e) {}
      // تحليل AI (اختياري) يُبنى مع التقرير — بلغتين معًا داخل buildDailyReportWithAnalysis.
      const report = await buildDailyReportWithAnalysis();
      await notifier.sendTelegram(report.text, null, markup, 'HTML');
      await notifier.sendWhatsapp(report.plain, null);
      await notifier.sendMobile(report.plain, null);
      console.log('[smart-alerts] التقرير اليومي أُرسل');
    } catch (e) {
      console.error('[smart-alerts] فشل إرسال التقرير اليومي:', e.message);
    }
  };
  setInterval(tick, 60000).unref();
  // فحص أول مبكر بعد 10 ثوانٍ من الإقلاع (لو أُقلع في دقيقة التقرير نفسها).
  setTimeout(tick, 10000).unref();
}

module.exports = { consumeDownEvent, flushStorm, buildDailyReport, buildDailyReportWithAnalysis, startDailyReport, deepestCommonAncestor };
