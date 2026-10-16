// اختبارات T08 / QA-01 — ترحيل قاعدة من مخطط **قبل الترقية** + نسخ احتياطي واسترجاع (Gate B).
// القاعدة: 1) لا فقدان بيانات · 2) الأرقام التعريفية كما هي · 3) تكرار الترحيل آمن ·
//         4) integrity_check سليم · 5) النسخة الاحتياطية تُسترجَع بنفس المحتوى والعلاقات.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(BACKEND_DIR, '..', 'database', 'schema.sql');

// قائمة ALTER التي يطبّقها db.js على القواعد القائمة (هي نفسها في النسخة القديمة —
// لم تُعدَّل في هذا العمل) ⇒ نطبّقها على القاعدة التجريبية لتحاكي قاعدة حقيقية مُرقّاة.
function legacyAlterStatements() {
  const src = fs.readFileSync(path.join(BACKEND_DIR, 'src', 'db.js'), 'utf8');
  const out = [];
  const re = /"(ALTER TABLE[^"]+)"/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  assert.ok(out.length >= 15, 'يجب استخراج قائمة ALTER من db.js (تغيّر شكلها؟)');
  return out;
}

// مخطط "قبل الترقية" = مخطط المشروع الحالي بعد إزالة جداول SpaceKit الجديدة.
function preUpgradeSchemaSql() {
  let sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  sql = sql.replace(
    /CREATE TABLE IF NOT EXISTS (app_settings|audit_log|sessions|monitored_services|service_status_logs) \([\s\S]*?\n\);/g,
    ''
  );
  sql = sql.replace(
    /CREATE INDEX IF NOT EXISTS (idx_audit_at|idx_audit_event|idx_sessions_expires|idx_services_device|idx_services_enabled|idx_service_logs_service)[^\n]*\n/g,
    ''
  );
  for (const t of ['app_settings', 'audit_log', 'monitored_services', 'service_status_logs']) {
    assert.ok(!sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `المخطط القديم يجب ألا يحتوي ${t}`);
  }
  assert.ok(!/CREATE TABLE IF NOT EXISTS sessions/.test(sql), 'المخطط القديم يجب ألا يحتوي sessions');
  return sql;
}

// بيانات واقعية: مواقع + أجهزة (أب/ابن) + سجلات + انقطاع + مستخدم + إعدادات إشعارات.
function seedLegacyData(db) {
  for (const sql of legacyAlterStatements()) {
    try { db.exec(sql); } catch (_) { /* العمود موجود */ }
  }
  const loc = db.prepare(
    "INSERT INTO locations (name, kind, sort_order, pos_x, pos_y) VALUES ('مبنى قديم', 'building', 3, 40, 50)"
  ).run().lastInsertRowid;
  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  const parent = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, location_id, check_protocol, port, web_port, pos_x, pos_y, is_active, current_status)
     VALUES ('سويتش رئيسي', '192.168.88.2', ?, ?, 'ping', NULL, 4444, 11, 22, 1, 'online')`
  ).run(typeId, loc).lastInsertRowid;
  const child = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, location_id, parent_id, check_protocol, port, is_active, current_status)
     VALUES ('خادم Odoo', '192.168.88.20', ?, ?, ?, 'port', 8069, 1, 'offline')`
  ).run(typeId, loc, parent).lastInsertRowid;
  const now = new Date().toISOString();
  for (let i = 0; i < 5; i++) {
    db.prepare('INSERT INTO status_logs (device_id, status, response_time_ms, checked_at) VALUES (?, ?, ?, ?)')
      .run(parent, 'online', 10 + i, now);
  }
  db.prepare('INSERT INTO downtime_events (device_id, started_at) VALUES (?, ?)')
    .run(child, new Date(Date.now() - 7200e3).toISOString());
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('legacy_admin', '$2a$04$abcdefghijklmnopqrstuv', 'admin')").run();
  // الصف 1 موجود من schema.sql (INSERT OR IGNORE) ⇒ نحدّثه بدل إدراجه.
  db.prepare('UPDATE notification_settings SET telegram_enabled = 1 WHERE id = 1').run();
  return { loc, parent, child };
}

function createLegacyDb(dbPath) {
  const db = new Database(dbPath);
  try {
    db.exec(preUpgradeSchemaSql());
    return seedLegacyData(db);
  } finally {
    db.close();
  }
}

function snapshot(db) {
  return {
    locations: db.prepare('SELECT * FROM locations ORDER BY id').all(),
    devices: db.prepare('SELECT * FROM devices ORDER BY id').all(),
    status_logs: db.prepare('SELECT COUNT(*) AS c FROM status_logs').get().c,
    downtime: db.prepare('SELECT id, device_id, started_at, ended_at FROM downtime_events ORDER BY id').all(),
    users: db.prepare('SELECT username, password_hash, role FROM users ORDER BY id').all(),
    settings: db.prepare('SELECT * FROM notification_settings WHERE id = 1').get(),
  };
}

function withDb(dbPath, fn) {
  const db = new Database(dbPath);
  try { return fn(db); } finally { db.close(); }
}

// إقلاع حقيقي (نفس مسار db.js الذي يطبّق schema.sql + الترحيلات) في عملية منفصلة.
function bootApp(dbPath) {
  return spawnSync(process.execPath, ['-e', "require('./src/db'); console.log('BOOT_OK');"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
}

test('T08: قاعدة "قبل الترقية" تُرحَّل بلا فقدان بيانات، وتكرار الترحيل آمن', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-mig-'));
  const dbPath = path.join(dir, 'legacy.db');
  try {
    createLegacyDb(dbPath);
    const before = withDb(dbPath, snapshot);

    // الإقلاع الأول (ترحيل) ثم الثاني (تكرار الترحيل — يجب ألا يرمي أو يُضاعف)
    const boot1 = bootApp(dbPath);
    assert.equal(boot1.status, 0, 'الإقلاع يجب أن ينجح: ' + boot1.stderr);
    assert.match(boot1.stdout, /BOOT_OK/);
    const boot2 = bootApp(dbPath);
    assert.equal(boot2.status, 0, 'تكرار الترحيل يجب أن ينجح: ' + boot2.stderr);

    const after = withDb(dbPath, (db) => {
      const s = snapshot(db);
      // الجداول الجديدة أُنشئت
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      for (const t of ['app_settings', 'audit_log', 'sessions']) {
        assert.ok(tables.includes(t), `يجب إنشاء جدول ${t}`);
      }
      // سلامة القاعدة والعلاقات
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(db.pragma('foreign_key_check'), []);
      return s;
    });

    // البيانات كما هي بالحرف: صفوف كاملة (تتضمن الأرقام التعريفية والعلاقات والإحداثيات)
    assert.deepEqual(after.locations, before.locations);
    assert.deepEqual(after.devices, before.devices);
    assert.deepEqual(after.users, before.users);
    assert.deepEqual(after.downtime, before.downtime);
    assert.equal(after.status_logs, before.status_logs);
    assert.equal(after.settings.telegram_enabled, 1);
    assert.ok(after.devices.find((x) => x.name === 'خادم Odoo').parent_id, 'علاقة الأب/الابن محفوظة');
    assert.equal(after.devices.find((x) => x.name === 'سويتش رئيسي').pos_x, 11, 'إحداثيات الخريطة محفوظة');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T08: نسخة احتياطية متسقة مع WAL + استرجاع يعيد نفس المحتوى والعلاقات', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-bak-'));
  const dbPath = path.join(dir, 'live.db');
  const backupPath = path.join(dir, 'backup.db');
  const src = new Database(dbPath);
  try {
    src.exec(preUpgradeSchemaSql());
    seedLegacyData(src);
    src.close();

    assert.equal(bootApp(dbPath).status, 0); // ترحيل أولًا

    const live = new Database(dbPath);
    let before;
    try {
      live.pragma('journal_mode = WAL'); // نفس نمط التشغيل الحقيقي
      before = snapshot(live);
      // نفس ما يفعله /api/backup/create: db.backup() من SQLite (متسق مع WAL بلا تعطيل الخدمة)
      await live.backup(backupPath);
      // كتابة بعد النسخ — لا يجوز أن تظهر في النسخة
      live.prepare("INSERT INTO locations (name, kind) VALUES ('موقع لاحق', 'zone')").run();
    } finally {
      live.close();
    }

    const restored = withDb(backupPath, (b) => {
      assert.equal(b.pragma('integrity_check', { simple: true }), 'ok');
      return snapshot(b);
    });
    assert.deepEqual(restored, before, 'النسخة يجب أن تطابق حالة ما قبل الكتابة اللاحقة');

    // الاسترجاع: استبدال ملف التشغيل بالنسخة (الخدمة متوقفة) — نفس المحتوى والعلاقات
    fs.copyFileSync(backupPath, dbPath);
    const afterRestore = withDb(dbPath, (d) => {
      assert.deepEqual(d.pragma('foreign_key_check'), []);
      assert.equal(d.pragma('integrity_check', { simple: true }), 'ok');
      return snapshot(d);
    });
    assert.deepEqual(afterRestore, before, 'بعد الاسترجاع يجب أن يعود المحتوى كما كان بالحرف');
  } finally {
    try { src.close(); } catch (_) { /* مُغلق */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
