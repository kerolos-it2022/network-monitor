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
  let msg = `⚠️ <b>انقطاع جماعي — ${buf.length} جهازًا خلال دقيقتين:</b>\n` +
    buf.map((b) => `🔴 <b>${esc(b.name)}</b> — <code>${esc(b.ip)}</code>`).join('\n');
  try {
    const anc = deepestCommonAncestor(buf.map((b) => b.id));
    if (anc) msg += `\n\n💡 <b>السبب المشترك المحتمل:</b> الجهاز الأب في السلسلة: <b>${esc(anc.name)}</b> (<code>${esc(anc.ip || '?')}</code>) — افحصه أولًا.`;
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
      msg += "\n🌐 <b>الخط الخارجي واقع أيضًا</b> (" + esc(downA.map((a) => a.ip).join(', ')) + ")" +
             " — الأرجح: عطل من مزود الإنترنت/الراوتر الرئيسي وليس داخل شبكتك";
    } else if (anchors.length > 0) {
      msg += "\n✅ خط الإنترنت الخارجي يعمل — الانقطاع <b>داخلي</b> (سويتش/كابل/توصيلات)";
    }
  } catch (e) { /* فشل التصنيف لا يمنع الرسالة */ }
  try {
    const { tgButtons } = require('./telegram-bot.service');
    await notifier.sendTelegram(msg, null, tgButtons(), 'HTML');
    await notifier.sendWhatsapp(msg.replace(/<\/?(b|code)>/g, ''), null);
    await notifier.sendMobile(msg.replace(/<\/?(b|code)>/g, ''), null);
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
    const name = e.name || 'جهاز محذوف';
    if (!perDevice[name]) perDevice[name] = { min: 0, count: 0 };
    perDevice[name].min += Math.max(0, (new Date(e.ended_at) - new Date(e.started_at)) / 60000);
    perDevice[name].count++;
  }
  const worst = Object.entries(perDevice).sort((a, b) => b[1].min - a[1].min)[0];
  const d = db.prepare("SELECT current_status s, COUNT(*) n FROM devices WHERE is_active = 1 GROUP BY current_status").all();
  const m = Object.fromEntries(d.map((r) => [r.s, r.n]));
  const up = m.online || 0, down = m.offline || 0;
  const day = now.toLocaleDateString('ar');
  let msg = `📊 <b>التقرير اليومي — ${esc(day)}</b>\n`;
  if (events.length === 0) {
    msg += '✅ يوم نظيف: لا انقطاعات في آخر 24 ساعة 🎉';
  } else {
    msg += `انقطاعات آخر 24 ساعة: <b>${events.length}</b> · إجمالي <b>${Math.round(totalMin)}</b> دقيقة\n`;
    if (worst) {
      msg += `الأكثر انقطاعًا: <b>${esc(worst[0])}</b> — ${Math.round(worst[1].min)} دقيقة (${worst[1].count} مرة)\n`;
    }
    msg += `الوضع الآن: 🟢 ${up} متصل · 🔴 ${down} متوقف`;
  }
  return msg;
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
      const msg = buildDailyReport();
      let markup = null;
      try { markup = require('./telegram-bot.service').tgButtons(); } catch (e) {}
      await notifier.sendTelegram(msg, null, markup, 'HTML');
      await notifier.sendWhatsapp(msg.replace(/<\/?(b|code)>/g, ''), null);
      await notifier.sendMobile(msg.replace(/<\/?(b|code)>/g, ''), null);
      console.log('[smart-alerts] التقرير اليومي أُرسل');
    } catch (e) {
      console.error('[smart-alerts] فشل إرسال التقرير اليومي:', e.message);
    }
  };
  setInterval(tick, 60000).unref();
  // فحص أول مبكر بعد 10 ثوانٍ من الإقلاع (لو أُقلع في دقيقة التقرير نفسها).
  setTimeout(tick, 10000).unref();
}

module.exports = { consumeDownEvent, flushStorm, buildDailyReport, startDailyReport, deepestCommonAncestor };
