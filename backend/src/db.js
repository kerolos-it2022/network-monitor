// db.js: يفتح اتصال better-sqlite3 ويُفعّل مفاتيح أجنبية، ويُصدّره لباقي الوحدات.
require('dotenv').config();
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
    ];
    for (const sql of migrations) {
      try { db.exec(sql); } catch (_) { /* العمود موجُود بالفعل */ }
    }

    // WAL mode لِأَداء أَفضل + تَزامن آمن لِـ concurrent reads في الـ background scheduler.
    db.pragma('journal_mode = WAL');
  }
} catch (e) {
  // لا نَكسر التَشغيل لو فشلت الـ migration — سَجِّل تحذيرًا ودَع server يَكمل (deploy.sh install يَتولى الـ schema كذلك).
  console.warn('[DB] Auto-migration warning:', e.message);
}

module.exports = db;
