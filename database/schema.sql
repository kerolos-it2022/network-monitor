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
    -- v2.11.0 — «يتبع (خريطة المواقع)»: ربط **مستقل تمامًا** عن parent_id (الذي يخصّ
    -- «سلسلة الشبكة» = «متصل عبر»). يُستعمل في «خريطة المواقع» فقط لإدخال الطوابق/الغرف
    -- داخل بطاقة المبنى/الموقع الأب. NULL = بطاقة مستقلة في الخريطة.
    -- يُضاف آمنًا عبر migration في db.js على DB قائمة.
    map_parent_id INTEGER,
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
    parent_id INTEGER,                             -- Topology chain: الأب في مسار الشبكة (NULL = مدخل إنترنت/جذر السلسلة)
    pos_x INTEGER,                                 -- Topology draw: موضع البطاقة الأفقي (وضع الرسم — يُحفظ ويُعرض في NOC كما رسمه الأدمن)
    pos_y INTEGER,                                 -- Topology draw: موضع البطاقة الرأسي
    check_protocol TEXT NOT NULL DEFAULT 'ping', -- 'ping' | 'port' | 'http' | 'https'
    port INTEGER,                                 -- مطلوب فقط إذا check_protocol = 'port'
    web_port INTEGER,                             -- بورت واجهة الويب المخصص (اختياري — مثل 4444) لزر «فتح»
    check_interval_seconds INTEGER NOT NULL DEFAULT 10,
    failure_threshold INTEGER NOT NULL DEFAULT 2,
    is_active INTEGER NOT NULL DEFAULT 1,          -- 1 = مفعّل للمراقبة، 0 = موقوف مؤقتاً
    current_status TEXT NOT NULL DEFAULT 'unknown', -- 'online' | 'offline' | 'unknown'
    http_accessible INTEGER NOT NULL DEFAULT 0,    -- 1 = الجهاز له واجهة HTTP (يُفحص تلقائياً)
    https_accessible INTEGER NOT NULL DEFAULT 0,   -- 1 = الجهاز له واجهة HTTPS (يُفحص تلقائياً)
    last_response_time_ms INTEGER,
    last_checked_at TEXT,
    -- SpaceKit MON-01 — حالات المراقبة المفصولة (المضيف مقابل الحالة العامة):
    host_status TEXT,                              -- 'online' | 'offline' | 'unknown' (من بروتوكول الفحص الأساسي)
    overall_health TEXT,                           -- online | degraded | offline | unknown (degraded تُفعَّل مع خدمات MON-02)
    last_probe_protocol TEXT,                      -- ping | port | http | https (آخر فحص أساسي نُفِّذ)
    host_last_ok_at TEXT,                          -- آخر لحظة نجاح للفحص الأساسي
    host_state_changed_at TEXT,                    -- آخر تغيّر فعلي في حالة المضيف
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_type_id) REFERENCES device_types(id),
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES devices(id) ON DELETE SET NULL
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

-- v2.27.0 — كاش أسماء الإعلانات (المستمع الدائم): كل اسم يُسمَع من الشبكة
-- (mDNS/SSDP) يُخزَّن بعنوانه — يُقرأ أولًا قبل أي استعلام عند مسح الاكتشاف.
CREATE TABLE IF NOT EXISTS discovery_names (
    ip TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v2.21.0 — إعدادات شات AI (صف واحد فقط). api_key سري (يُقنَّع عند القراءة).
-- base_url: أي endpoint متوافق مع OpenAI Chat Completions (افتراضي z.ai / GLM).
-- بلا مفتاح = الشات معطّل والنظام يبقى يعمل كالمعتاد.
CREATE TABLE IF NOT EXISTS ai_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    api_key TEXT,
    base_url TEXT NOT NULL DEFAULT 'https://api.z.ai/api/paas/v4',
    model TEXT NOT NULL DEFAULT 'glm-4-flash'
);
INSERT OR IGNORE INTO ai_settings (id) VALUES (1);

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
    error TEXT,                   -- v2.13.0 — سبب الفشل كما ردّه المزوّد (NULL عند النجاح)
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
    status TEXT NOT NULL DEFAULT 'running',      -- 'running' | 'completed' | 'cancelled' | 'failed'
    error_message TEXT,
    source TEXT NOT NULL DEFAULT 'scheduled'     -- v2.11.7: 'scheduled' (المجدول) | 'manual' (من شاشة اكتشاف الأجهزة)
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

-- SpaceKit Phase 0 (SEC-02) — إعدادات عامة (key/value) يملكها المدير.
-- أول استخدام: public_display_mode (lan | minimal | off) لوضع العرض العام للزوار.
-- آمنة على القواعد القائمة: CREATE TABLE IF NOT EXISTS تُطبَّق عند كل إقلاع (db.js).
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SpaceKit Phase 2 (RCA-01/02) — أعطال مرتبطة بالشجرة: عطل جهاز أعلى يجمّع أبناءه.
-- الانقطاع الأصلي لكل جهاز يبقى في downtime_events كما هو؛ هذا الجدول يضيف «العطل المركزي»
-- وقائمة المتأثرين + مستوى الثقة، ويُستعمل لكتم الإشعارات المكررة فقط (لا تُخفى حالات الشاشات).
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_device_id INTEGER,                        -- الجهاز الجذري المرشَّح (الأب الأعلى المتأثر)
    kind TEXT NOT NULL DEFAULT 'single',           -- 'single' | 'root_cause'
    status TEXT NOT NULL DEFAULT 'open',           -- 'open' | 'closed'
    confidence TEXT,                               -- 'high' | 'medium' | 'low' (قوة الأدلة الطوبولوجية)
    started_at TEXT NOT NULL,
    ended_at TEXT,
    affected_json TEXT,                            -- [{device_id, name, started_at}] أبناء تأثروا بالعطل
    notified_at TEXT,                              -- وقت الإشعار المرسل (لمنع التكرار)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (root_device_id) REFERENCES devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_root ON incidents(root_device_id);

-- SpaceKit Phase 1 (HIST-02) — تجميعات ساعية/يومية تُبنى **قبل** تقليم السجلات الخام.
-- تسمح بتقارير 7/30/90 يومًا بعد حذف raw (>7 أيام) بدلالة تغطية صريحة وبلا نسب مُختلَقة.
CREATE TABLE IF NOT EXISTS status_rollups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    bucket TEXT NOT NULL,                            -- 'hour' | 'day'
    bucket_start TEXT NOT NULL,                      -- بداية الدلو (ISO UTC)
    online_seconds INTEGER NOT NULL DEFAULT 0,
    offline_seconds INTEGER NOT NULL DEFAULT 0,
    unknown_seconds INTEGER NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    min_response_ms INTEGER,
    avg_response_ms REAL,
    max_response_ms INTEGER,
    p95_response_ms INTEGER,
    computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(device_id, bucket, bucket_start),         -- يجعل البناء idempotent (upsert)
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rollups_lookup ON status_rollups(device_id, bucket, bucket_start);

-- SpaceKit Phase 1 (MON-02) — الخدمات المراقَبة لكل جهاز (اختيارية بالكامل، يعرّفها المالك).
-- مضيف متصل + هذه الخدمة متوقفة ⇒ overall_health = degraded (وليس أخضر كاذبًا).
CREATE TABLE IF NOT EXISTS monitored_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    name TEXT NOT NULL,                              -- اسم الخدمة (مثل: Odoo ERP)
    kind TEXT NOT NULL,                              -- 'tcp' | 'http' | 'https'
    port INTEGER,                                    -- مطلوب لـ tcp؛ اختياري للويب (80/443 افتراضيًا)
    url_path TEXT,                                   -- مسار للـ http/https (افتراضي '/')
    expect_status TEXT NOT NULL DEFAULT '2xx',       -- '2xx' | '200' | '200-299' | '200,204,301'
    verify_tls INTEGER NOT NULL DEFAULT 1,           -- https: التحقق من الشهادة (آمن افتراضيًا)
    interval_seconds INTEGER NOT NULL DEFAULT 60,    -- فاصل الخدمة الخاص (لا يتبع دورة الـ 10 ثوانٍ)
    timeout_ms INTEGER NOT NULL DEFAULT 5000,
    failure_threshold INTEGER NOT NULL DEFAULT 2,
    is_critical INTEGER NOT NULL DEFAULT 0,          -- خدمة حرجة (تُبرَز في التنبيهات/الواجهات)
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- الحالة الحالية (يُحدّثها المحرك — MON-02)
    status TEXT NOT NULL DEFAULT 'unknown',          -- online | offline | unknown
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_checked_at TEXT,
    last_ok_at TEXT,
    last_response_ms INTEGER,
    last_error TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_services_device ON monitored_services(device_id);
CREATE INDEX IF NOT EXISTS idx_services_enabled ON monitored_services(is_enabled);

-- سجل حالات الخدمات (تاريخ الخدمة يُحفظ مستقلًّا عن سجل الجهاز).
CREATE TABLE IF NOT EXISTS service_status_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL,
    device_id INTEGER NOT NULL,
    status TEXT NOT NULL,                            -- online | offline (المجهول لا يُسجَّل = فجوة صريحة)
    response_ms INTEGER,
    error TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (service_id) REFERENCES monitored_services(id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_service_logs_service ON service_status_logs(service_id, checked_at);

-- SpaceKit Phase 0 (SEC-03) — سجل تدقيق للأحداث الحساسة (دخول/فشل دخول/تغييرات/مسح/تحديث...).
-- لا يحوي أسرارًا: التنقية تتم في services/audit.service.js قبل الكتابة.
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT,                                    -- اسم المستخدم (أو null للفشل قبل المصادقة)
    role TEXT,                                     -- admin | viewer | null
    event TEXT NOT NULL,                           -- login_success | login_failed | tool_run | ...
    target TEXT,                                   -- الهدف/الكيان المتأثر (جهاز، مستخدم، وضع...)
    details TEXT,                                  -- JSON منقّى (بلا أي سرّ)
    ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event);

-- SpaceKit Phase 0 (SEC-03) — جلسات تسجيل الدخول الدائمة (بديل MemoryStore).
-- تُنشأ أيضًا تلقائيًّا من services/session-store.service.js إن غابت (توثيق + تثبيت نظيف).
CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- بيانات ابتدائية لأنواع الأجهزة الشائعة
INSERT OR IGNORE INTO device_types (name, icon) VALUES
    ('Firewall', 'shield'),
    ('Printer', 'printer'),
    ('NVR/DVR', 'camera'),
    ('Switch', 'network'),
    ('Router', 'router'),
    ('Server', 'server'),
    ('Access Point', 'wifi');
