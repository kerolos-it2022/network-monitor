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
    -- نوع الموقع لِـ هرم الشبكة المُدمَج. القيم المَسمُوحة (يُتحقَّق منها في
    -- locations.routes عبر VALID_KINDS): 'internet' (قمة الهرم = مصدر الإنترنت/الراوتر)،
    -- 'zone' (منطقة وَسَطية، تَدعم تَداخل أَي نوع)، ثم الأَنواع الورقية: 'site' | 'building'
    -- | 'floor' | 'room' | 'rack'. الافتراضي 'zone' لِيَدخل الموقع الجديد في الهرم آليًّا.
    -- يُضاف أيضًا عبر migration آمنة في db.js على DB قائمة من v2.4.0.
    kind TEXT NOT NULL DEFAULT 'zone',
    -- v2.7.1 — تَرتيب العرض في خريطة المواقع: يُتيح للمستخدم تَرتيب البطاقات بحيث تَظهر
    -- المنطبيق/المواقع متَّصلة على التَوالي (منطقة ← منطقة). الافتراضي 0 (يُكمل ORDER BY id).
    -- يُضاف آمنًا عبر migration في db.js على DB قائمة.
    sort_order INTEGER NOT NULL DEFAULT 0,
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
    fcm_server_key TEXT,                          -- Firebase Cloud Messaging Server Key
    webhook_url TEXT                              -- v2.5.0 — webhook خارجي لأي تنبيه (مثل: جهاز جديد)
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

-- ─────────────────────────────────────────────────────────────
-- v2.5.0 — المسح الدوري + الأَجهزة المُكتشَفة + Webhook
-- ─────────────────────────────────────────────────────────────

-- إعدادات المسح الدوري (صف واحد فقط — CHECK id=1 مثل notification_settings)
CREATE TABLE IF NOT EXISTS scan_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,           -- 0=متوقف، 1=مُفعّل
    interval_minutes INTEGER NOT NULL DEFAULT 15, -- كل كم دقيقة يُعاد المسح
    subnets TEXT NOT NULL DEFAULT '',             -- قائمة CIDR مفصولة بفواصل: 192.168.1.0/24,10.0.0.0/24
    scan_ports_enabled INTEGER NOT NULL DEFAULT 0,
    scan_snmp_enabled INTEGER NOT NULL DEFAULT 0,
    snmp_community TEXT NOT NULL DEFAULT 'public',
    new_device_alert INTEGER NOT NULL DEFAULT 1,  -- تنبيه عند ظهور جهاز جديد
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- سجل المسحات الدورية (أي مسح تلقائي يُسجَّل هنا)
CREATE TABLE IF NOT EXISTS scan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subnet TEXT NOT NULL,                         -- CIDR المَمسُوح (أو 'multi' لو أَكثر من واحد)
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    devices_found INTEGER NOT NULL DEFAULT 0,     -- إجمالي الأَجهزة المَكتشَفة في هذا المسح
    devices_added INTEGER NOT NULL DEFAULT 0,    -- أَجهزة جديدة لم تَكن معروفة
    devices_lost INTEGER NOT NULL DEFAULT 0,     -- أَجهزة معروفة اختفت عن هذا المسح (منذ آخر مسح ناجح)
    status TEXT NOT NULL DEFAULT 'running',      -- 'running' | 'completed' | 'failed'
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at);

-- الأَجهزة المُكتشَفة (غير معروفة في جدول devices بعد) — من المسح الدوري أَو المَصادر الخارجية
CREATE TABLE IF NOT EXISTS discovered_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    mac TEXT,
    hostname TEXT,
    vendor TEXT,                                  -- من OUI lookup
    detected_type TEXT,                           -- 'Camera' | 'Printer' | 'Router' | ...
    source TEXT NOT NULL DEFAULT 'scan',          -- 'scan' | 'mikrotik' | 'sophos' | 'snmp' | 'lldp' | 'manual'
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    seen_count INTEGER NOT NULL DEFAULT 1,        -- كم مرة اكتُشِف (لِـ ترتيب عرض التكرار)
    is_approved INTEGER NOT NULL DEFAULT 0,       -- 0=بانتظار الاعتماد، 1=تم اعتماده (وبالتالي يُنقل لِـ devices)، -1=مرفوض
    approved_at TEXT,
    UNIQUE(ip, mac, source)                       -- لا تكرار لنفس الجهاز من نفس المصدر
);
CREATE INDEX IF NOT EXISTS idx_discovered_seen ON discovered_devices(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_discovered_approved ON discovered_devices(is_approved);

-- v2.5.0 — إضافة عمود webhook_url لِـ notification_settings (لو لم يَكُن موجُودًا — آمن عبر IF NOT EXISTS غير متوفر في ALTER، لِذا SID نظامي عبر migrate فيها).
-- ملاحظة: better-sqlite3 لا يَدعم ALTER TABLE ADD COLUMN IF NOT EXISTS. لِذا نَنفّذها يدويًّا من migrateWebhook() في db.js (لا هنا).
-- بعد migrate: notification_settings يَ gaining webhook_url TEXT NULL.

-- بيانات ابتدائية لأنواع الأجهزة الشائعة
INSERT OR IGNORE INTO device_types (name, icon) VALUES
    ('Firewall', 'shield'),
    ('Printer', 'printer'),
    ('NVR/DVR', 'camera'),
    ('Switch', 'network'),
    ('Router', 'router'),
    ('Server', 'server'),
    ('Access Point', 'wifi');
