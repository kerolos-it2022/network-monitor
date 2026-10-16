// db.js: يفتح اتصال better-sqlite3 ويُفعّل مفاتيح أجنبية، ويُصدّره لباقي الوحدات.
// v2.13.0 — تحميل .env عبر config/env (مسار محدَّد نسبةً للكود لا لمجلد العمل).
require('./config/env');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || '../database/monitoring.db';
const db = new Database(dbPath);

// تفعيل المفاتيح الأجنبية (ON DELETE CASCADE وغيرها تعتمد على هذا).
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────────────────────
// Auto-migration: نُطبِّق database/schema.sql عند بدء التشغيل.
// schema.sql يَستخدم `CREATE TABLE IF NOT EXISTS` لِذا آمن على DB موجُودة أَصلًا.
// يَضمن أَن أَيّ جداول جديدة (مثل scan_settings في v2.5.0) تُنشَأ تلقائيًّا
// بدون الحاجة لإِعادة تَنفيذ `deploy.sh install/init_database` يدويًّا.
// ─────────────────────────────────────────────────────────────
try {
  // schema.sql موجود في `database/schema.sql` نسبةً لِـ backend/src/ → ../../database/schema.sql
  const schemaPath = path.join(__dirname, '../../database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);

    // ─────────────────────────────────────────────────────────────
    // اِنتقالات آمنة (safe migrations) على DB موجُودة أَصلًا (من v2.4.0).
    // schema.sql يَستعمل `CREATE TABLE IF NOT EXISTS` ولِذا لا يُضيف أَعمدةً على
    // جداول قائمة. هنا نُضيف الأَعمدة الجديدة عبر `ALTER ADD COLUMN` مَحميًا بـ
    // try/catch — SQLite يَرمي `duplicate column name` لو العمود موجُود، فنَتجاهله.
    // ─────────────────────────────────────────────────────────────
    const migrations = [
      // v2.5.0: webhook خارجي (Slack/Discord/ntfy/Grafana) لِـ notification_settings.
      "ALTER TABLE notification_settings ADD COLUMN webhook_url TEXT",
      // v2.5.1: نوع الموقع لِـ هرم الشبكة المُدمَج (internet|zone|site|building|floor|room|rack).
      // NOTE: لو هاجرت سابقًا بـ DEFAULT 'site' بَقِيَت الصفوف القائمة على 'site' (ALTER لا يُغيّر
      // default الصفوف الموجُودة) — وهذا آمن؛ المواقع القيمة تَعرض كعقد وَسَطية. الصفوف الجديدة تَحصل
      // على 'zone'. لو أَردت ترقية القديمة نفّذ يدويًّا:
      //   UPDATE locations SET kind='zone' WHERE kind='site';
      "ALTER TABLE locations ADD COLUMN kind TEXT NOT NULL DEFAULT 'zone'",
      // v2.7.1: تَرتيب العرض (sort_order) لِـ بطاقات المواقع في خريطة المواقع — يَتيح
      // تَرتيبها «متَّصلة على التَوالي» (منطقة ← منطقة). الافتراضي 0 (يَكمل ORDER BY id ASC).
      // آمن: SQLite يَرمي duplicate-column لو موجود فنَتجاهله (نَفس نمط migrations الأُخرى).
      "ALTER TABLE locations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
      // v2.7.5: بورت واجهة الويب المخصص (web_port) لِـ زر «فتح HTTP/HTTPS» — أَجهزة
      // واجهتُها على بورت غير 80/443 (مثل 4444). NULL = السلوك الافتراضي (80/443).
      "ALTER TABLE devices ADD COLUMN web_port INTEGER",
      // v2.8.0: Topology chain — الأب في سلسلة الشبكة (parent_id): الجهاز المتصل عبر
      // جهاز آخر. NULL = مدخل إنترنت (جذر السلسلة). الحلقات تُمنع في devices.routes.
      "ALTER TABLE devices ADD COLUMN parent_id INTEGER",
      // v2.8.0: Topology draw — موضع البطاقة (x/y) الذي رسمه الأدمن ويُعرض كما هو في NOC.
      "ALTER TABLE devices ADD COLUMN pos_x INTEGER",
      "ALTER TABLE devices ADD COLUMN pos_y INTEGER",
      // v2.8.2: ربط مباني ← مباني (upstream_location_id في locations) — الموقع يتصل بموقع آخر
      // (مثال: الورشة-1 تتصل بالمبنى الإداري). NULL = موقع مستقل. الحلقات تُمنع في locations.routes.
      "ALTER TABLE locations ADD COLUMN upstream_location_id INTEGER",
      // v2.8.2: جهاز يتصل بموقع/مبنى (parent_location_id في devices) — لو مش محدد جهاز أب،
      // الجهاز يتعلق تحت المبنى مباشرة في السلسلة الموحدة (مثال: الكاميرا ← عنبر الكتاين).
      "ALTER TABLE devices ADD COLUMN parent_location_id INTEGER",
      // v2.8.2: مواضع بطاقات المواقع في وضع الرسم (تُعرض كما رسمها الأدمن في NOC).
      "ALTER TABLE locations ADD COLUMN pos_x INTEGER",
      "ALTER TABLE locations ADD COLUMN pos_y INTEGER",
      // v2.11.0: ربط «خريطة المواقع» المستقل (map_parent_id) — «يتبع (خريطة المواقع)».
      // منفصل تمامًا عن parent_id («متصل عبر» في سلسلة الشبكة): يحدّد فقط أي طابق/غرفة
      // يدخل داخل بطاقة أي مبنى/موقع في الخريطة. NULL = بطاقة مستقلة.
      "ALTER TABLE locations ADD COLUMN map_parent_id INTEGER",
      // v2.11.7: مصدر المسح (source) في scan_runs — 'scheduled' (المجدول، الافتراضي) أو 'manual'
      // (المسح اليدوي من شاشة «🔍 اكتشاف الأجهزة») ⇒ يَظهر تاريخ المسحات اليدوية في «⏱️ المسح الدوري».
      "ALTER TABLE scan_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'scheduled'",
      // v2.13.0: سبب فشل الإرسال في notification_logs — بدونه كان الفشل يظهر في
      // السجل كـ «فشل» بلا تفسير (مثال تلجرام: «chat not found» / «bot was blocked»).
      "ALTER TABLE notification_logs ADD COLUMN error TEXT",
      // v2.14.1: نافذة الصيانة + التقرير اليومي (سمات إعدادات الإشعارات).
      "ALTER TABLE notification_settings ADD COLUMN maintenance_enabled INTEGER DEFAULT 0",
      "ALTER TABLE notification_settings ADD COLUMN maintenance_window TEXT DEFAULT ''",
      "ALTER TABLE notification_settings ADD COLUMN daily_report_enabled INTEGER DEFAULT 1",
      "ALTER TABLE notification_settings ADD COLUMN daily_report_hour TEXT DEFAULT '08:00'",
      // v2.14.2: مفاتيح تحكم ذكاء الإشعارات (البوت التفاعلي · تجميع العواصف · مدتها).
      "ALTER TABLE notification_settings ADD COLUMN bot_commands_enabled INTEGER DEFAULT 1",
      "ALTER TABLE notification_settings ADD COLUMN storm_digest_enabled INTEGER DEFAULT 1",
      "ALTER TABLE notification_settings ADD COLUMN storm_window_seconds INTEGER DEFAULT 90",
      // v2.25.0: تصعيد الانقطاعات (تنبيه ثانٍ للانقطاع المديد + تكرار اختياري).
      "ALTER TABLE notification_settings ADD COLUMN escalation_enabled INTEGER DEFAULT 0",
      "ALTER TABLE notification_settings ADD COLUMN escalation_after_minutes INTEGER DEFAULT 30",
      "ALTER TABLE notification_settings ADD COLUMN escalation_repeat_minutes INTEGER DEFAULT 0",
      // v2.29.1: مفتاح غطاء الإنذار الأحمر في شاشة NOC (تشغيل/إيقاف من الإشعارات).
      "ALTER TABLE notification_settings ADD COLUMN noc_alert_screen_enabled INTEGER DEFAULT 1",
      // AI-02 (SpaceKit Phase 4) — تنقيح السياق المُرسل لمزوّد AI (مفعّل افتراضيًّا).
      "ALTER TABLE ai_settings ADD COLUMN redact_internal INTEGER NOT NULL DEFAULT 1",
      // AST-01 (SpaceKit Phase 2) — المعرّف الثابت للأصول على القواعد القائمة.
      "ALTER TABLE devices ADD COLUMN asset_id TEXT",
      // الفهرس يُنشأ هنا (بعد ALTER) لا في schema.sql — تفصيل الأمان في تعليق schema.sql.
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_asset_id ON devices(asset_id)",
      // MON-01 (SpaceKit Phase 1) — حالات المراقبة المفصولة على القواعد القائمة.
      "ALTER TABLE devices ADD COLUMN host_status TEXT",
      "ALTER TABLE devices ADD COLUMN overall_health TEXT",
      "ALTER TABLE devices ADD COLUMN last_probe_protocol TEXT",
      "ALTER TABLE devices ADD COLUMN host_last_ok_at TEXT",
      "ALTER TABLE devices ADD COLUMN host_state_changed_at TEXT",
    ];
    for (const sql of migrations) {
      try { db.exec(sql); } catch (_) { /* العمود موجُود بالفعل */ }
    }

    // ─────────────────────────────────────────────────────────────
    // v2.13.4: تسريع الفحص للمشروع كله (شكوى: «الجهاز الجديد بيُفحص كل 30 ثانية
    // وتغيّر الحالة بياخد وقت أوي»). الأجهزة ما زالت على الافتراضات القديمة
    // (فحص 30 ثانية / حد فشل 3 ⇒ «متوقف» قد يتأخر ≤90 ثانية) تُرقّى إلى
    // (10 ثوانٍ / 2 ⇒ ≤20 ثانية). القيم المخصّصة لأجهزة بعينها (أي قيمة غير
    // القديم تمامًا) لا تُمَسّ — الهجرة لا تعيد ضبط الاختيارات اليدوية.
    // ─────────────────────────────────────────────────────────────
    try {
      const iv = db.prepare("UPDATE devices SET check_interval_seconds = 10 WHERE check_interval_seconds = 30").run();
      const th = db.prepare("UPDATE devices SET failure_threshold = 2 WHERE failure_threshold = 3").run();
      if (iv.changes || th.changes) {
        console.log(`[db] v2.13.4 migration: check_interval 30→10 on ${iv.changes} device(s), threshold 3→2 on ${th.changes} device(s).`);
      }
    } catch (e) {
      console.warn('[db] interval/threshold migration skipped:', e.message);
    }

    // WAL mode لِأَداء أَفضل + تَزامن آمن لِـ concurrent reads في الـ background scheduler.
    db.pragma('journal_mode = WAL');
    // v2.7.x — busy_timeout لِـ تَفادي SQLITE_BUSY عِند تَزاحُم كِتاَبٍ وَرَاء كَوال (WAL)
    // مَع cron الـ 10 ثَوانٍ (monitor) و VACUUM/DELETE الكَبير على status_logs.
    db.pragma('busy_timeout = 5000');
  }
} catch (e) {
  // لا نَكسر التَشغيل لو فشلت الـ migration — سَجِّل تحذيرًا ودَع server يَكمل (deploy.sh install يَتولى الـ schema كذلك).
  console.warn('[DB] Auto-migration warning:', e.message);
}

module.exports = db;
