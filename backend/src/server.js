// server.js: نقطة بدء الخادم — فحص القاعدة + بناء التطبيق (app.js) + بدء الخدمات الخلفية.
// v2.8.7 — معدّل من نسخة v2.8.6، والتغييرات:
//   1) تركيب مسار البثّ الحيّ SSE: /api/live/status  (سطران: require + app.use).
//   2) سطر مفتاح الجلسة: إزالة القيمة الافتراضية النصّية (سرّ معروف للجميع) واستعمال
//      SESSION_SECRET من .env، ولو غير مُعرَّف يُولَّد مفتاح عشوائي عند الإقلاع.
// v2.13.0 — تحميل .env عبر config/env: المسار محسوب نسبةً إلى الكود (backend/.env)
// بدل الاعتماد على مجلد العمل الحالي (كان تشغيل الخادم من جذر المستودع يُبقيه بلا .env).
// QA-01 (SpaceKit) — بناء التطبيق انتقل إلى app.js (createApp) ليعاد استخدامه في الاختبارات؛
// هذا الملف صار مسؤولًا عن التشغيل الفعلي فقط: فحص القاعدة، VAPID، الاستماع، وبدء الخدمات.
require('./config/env');

const db = require('./db');
const { createApp } = require('./app');

const app = createApp();
const PORT = process.env.PORT || 4000;

// التحقق من الاتصال بقاعدة البيانات قبل بدء الخادم.
try {
  db.prepare('SELECT 1').get();
  console.log('Database connection OK.');
  // AST-01 — مهمة إقلاع idempotent: منح asset_id لكل جهاز بلا معرّف + تهيئة سجل IP/الواجهات
  // من البيانات القائمة (آمنة التكرار، ولا تُغيّر أي معرّف قائم).
  try {
    const r = require('./services/assets.service').ensureAssetIds();
    if (r.assigned || r.ipSeeded || r.interfacesSeeded) {
      console.log(`[assets] identity backfill: asset_ids=${r.assigned} ip_history=${r.ipSeeded} interfaces=${r.interfacesSeeded}`);
    }
  } catch (e) {
    console.error('[assets] identity backfill failed:', e.message);
  }
} catch (e) {
  console.error('Database connection FAILED:', e.message);
  console.error('تأكد من تنفيذ database/schema.sql وتعيين DB_PATH في .env');
  process.exit(1);
}

// v2.13.0 — ضمان مفاتيح Web Push (VAPID) قبل قبول أي طلب: تُولَّد تلقائيًّا وتُحفظ
// في ملف إعدادات الخدمة عند غيابها، فلا تظهر رسالة «الإشعارات غير مُهيّأة على الخادم»
// على الأجهزة التي لم يولّد مثبّتها مفاتيح (الأبلاينس).
try {
  require('./services/vapid.service').ensureVapidKeys();
} catch (e) {
  console.error('[vapid] فشل ضمان مفاتيح Web Push:', e.message);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // بدء محرك المراقبة بعد نجاح تشغيل الخادم.
  require('./services/monitor.service').startMonitoring();
  // v2.5.0 — بدء مُجدوِل المسح الدوري (يَقرأ scan_settings ثم يُشغّل لو enabled=1).
  try {
    require('./services/scan-scheduler.service').startScheduler();
  } catch (e) {
    console.error('[SCHEDULER] Failed to start scan scheduler:', e.message);
  }
  // v2.14.0 — بوت تلجرام السامع (Long Polling): أوامر /status /down /recent + الأزرار
  // المضمّنة تحت رسائل الانقطاع. صامت تمامًا لو التوكن/chat_id غير مضبوطين أو القناة معطّلة.
  try {
    require('./services/telegram-bot.service').startTelegramBot();
    // v2.19.0 — النسخ الاحتياطي المجدول (الإعداد من لوحة النسخ الاحتياطي).
    require('./services/backup-schedule.service').startBackupSchedule();
  } catch (e) {
    console.error('[TG-BOT] Failed to start telegram bot:', e.message);
  }
  // v2.14.1 — التقرير اليومي المجدول (ساعة قابلة للضبط من إعدادات الإشعارات).
  try {
    require('./services/smart-alerts.service').startDailyReport();
  } catch (e) {
    console.error('[SMART-ALERTS] Failed to start daily report:', e.message);
  }
  // v2.25.0 — 🚨 تصعيد الانقطاعات (تنبيه ثانٍ/تذكير للانقطاع المديد — إعداد من الإشعارات).
  try {
    require('./services/escalation.service').startEscalation();
  } catch (e) {
    console.error('[ESCALATION] Failed to start escalation:', e.message);
  }
  // v2.25.0 — ⏰ التحديث التلقائي المجدول (معطّل افتراضيًّا — إعداد من تبويب التحديثات).
  try {
    require('./services/auto-update.service').startAutoUpdate();
  } catch (e) {
    console.error('[AUTO-UPDATE] Failed to start auto-update:', e.message);
  }
  // v2.27.0 — المستمع الدائم لأسماء الإعلانات (mDNS/SSDP — كاش discovery_names).
  try {
    require('./services/net-announce.service').persistent.startPersistentListener();
  } catch (e) {
    console.error('[NET-ANNOUNCE] Failed to start persistent listener:', e.message);
  }
  // v2.26.0 — 🧹 تنظيف سجل الانقطاعات (أرشفة CSV + حذف >90 يومًا — يوميًا 03:10).
  try {
    require('./services/downtime-retention.service').startDowntimeRetention();
  } catch (e) {
    console.error('[RETENTION] Failed to start downtime retention:', e.message);
  }
});
