-- ============================================================
-- قاعدة بيانات نظام مراقبة أجهزة الشبكة المحلية (SQLite)
-- ينفَّذ هذا الملف مباشرة لإنشاء قاعدة البيانات، لا يحتاج تدخل AI
-- تشغيل: sqlite3 database/monitoring.db < database/schema.sql
-- ============================================================

PRAGMA foreign_keys = ON;

-- أنواع الأجهزة (فايروول، طابعة، NVR، ...)
CREATE TABLE IF NOT EXISTS device_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT 'server'
);

-- المواقع (فرع / طابق / قسم) - تدعم التداخل عبر parent_id
CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    FOREIGN KEY (parent_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- المستخدمون (مديرو النظام)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الأجهزة
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    device_type_id INTEGER NOT NULL,
    location_id INTEGER,
    check_protocol TEXT NOT NULL DEFAULT 'ping', -- 'ping' | 'port' | 'http' | 'https'
    port INTEGER,                                 -- مطلوب فقط إذا check_protocol = 'port'
    check_interval_seconds INTEGER NOT NULL DEFAULT 30,
    failure_threshold INTEGER NOT NULL DEFAULT 3,
    is_active INTEGER NOT NULL DEFAULT 1,          -- 1 = مفعّل للمراقبة، 0 = موقوف مؤقتاً
    current_status TEXT NOT NULL DEFAULT 'unknown', -- 'online' | 'offline' | 'unknown'
    http_accessible INTEGER NOT NULL DEFAULT 0,    -- 1 = الجهاز له واجهة HTTP (يُفحص تلقائياً)
    https_accessible INTEGER NOT NULL DEFAULT 0,   -- 1 = الجهاز له واجهة HTTPS (يُفحص تلقائياً)
    last_response_time_ms INTEGER,
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_type_id) REFERENCES device_types(id),
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- سجل كل عملية فحص (يُستخدم للرسوم البيانية وحساب Uptime)
CREATE TABLE IF NOT EXISTS status_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    status TEXT NOT NULL,              -- 'online' | 'offline'
    response_time_ms INTEGER,          -- NULL إذا كانت الحالة offline
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_status_logs_device_time ON status_logs(device_id, checked_at);

-- أحداث الانقطاع (فترة كاملة من بداية الانقطاع حتى العودة)
CREATE TABLE IF NOT EXISTS downtime_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,                      -- NULL يعني الانقطاع لا يزال مستمراً
    duration_seconds INTEGER,           -- يُحسب ويُخزَّن عند الإغلاق فقط
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_downtime_device ON downtime_events(device_id);

-- إعدادات قنوات الإشعار (صف واحد ثابت لكل قناة، يُحدَّث بدلاً من التكرار)
CREATE TABLE IF NOT EXISTS notification_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- صف واحد فقط
    telegram_enabled INTEGER NOT NULL DEFAULT 0,
    telegram_bot_token TEXT,
    telegram_chat_id TEXT,
    whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
    whatsapp_api_url TEXT,
    whatsapp_api_token TEXT,
    whatsapp_to_number TEXT,
    mobile_enabled INTEGER NOT NULL DEFAULT 0,   -- تفعيل إشعارات الهاتف (PWA/Web Push عبر FCM)
    fcm_server_key TEXT                           -- Firebase Cloud Messaging Server Key
);
INSERT OR IGNORE INTO notification_settings (id) VALUES (1);

-- تسجيلات تطبيق الموبايل (PWA) — كل متصفح/هاتف يُسجّل مرة واحدة
CREATE TABLE IF NOT EXISTS mobile_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,   -- توكن FCM الكامل (يُستخدم كـ registration_id)
    platform TEXT,                    -- 'web' | 'android' | 'ios' (اختياري)
    device_info TEXT,                 -- معلومات الجهاز (User-Agent، الخ)
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_notified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mobile_active ON mobile_registrations(is_active);

-- سجل الإشعارات المُرسلة فعلياً
CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER,
    channel TEXT NOT NULL,        -- 'telegram' | 'whatsapp' | 'mobile'
    message TEXT NOT NULL,
    status TEXT NOT NULL,         -- 'sent' | 'failed'
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_logs_sent ON notification_logs(sent_at);

-- بيانات ابتدائية لأنواع الأجهزة الشائعة
INSERT OR IGNORE INTO device_types (name, icon) VALUES
    ('Firewall', 'shield'),
    ('Printer', 'printer'),
    ('NVR/DVR', 'camera'),
    ('Switch', 'network'),
    ('Router', 'router'),
    ('Server', 'server'),
    ('Access Point', 'wifi');
