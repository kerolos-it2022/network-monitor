// app.js: بناء تطبيق Express كاملًا (middleware + مسارات) **دون** تشغيل السيرفر.
// ═══ QA-01 (SpaceKit Phase 0) ═══
// فُصل هذا الملف من server.js حتى تستطيع الاختبارات الآلية تشغيل التطبيق على منفذ عشوائي
// (app.listen(0)) داخل نفس العملية، بلا تشغيل محرك المراقبة/تلجرام/المجدولات.
// server.js صار مسؤولًا فقط عن: فحص القاعدة، مفاتيح VAPID، الاستماع، وبدء الخدمات الخلفية.
'use strict';
require('./config/env');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const db = require('./db');
const { getEngineHealth } = require('./services/monitor.service');
const { securityHeaders } = require('./middleware/security-headers');
const { createCsrfGuard } = require('./middleware/csrf-guard');
const { createSqliteSessionStore } = require('./services/session-store.service');

const authRoutes = require('./routes/auth.routes');
const devicesRoutes = require('./routes/devices.routes');
const topologyRoutes = require('./routes/topology.routes');
const locationsRoutes = require('./routes/locations.routes');
const deviceTypesRoutes = require('./routes/deviceTypes.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const toolsRoutes = require('./routes/tools.routes');
const scanRoutes = require('./routes/scan.routes');
const backupRoutes = require('./routes/backup.routes');
const updateRoutes = require('./routes/update.routes');
const scanSchedulerRoutes = require('./routes/scan-scheduler.routes');
const discoveredRoutes = require('./routes/discovered.routes');
const mapRoutes = require('./routes/map.routes');
const liveRoutes = require('./routes/live.routes');
const applianceUpdateRoutes = require('./routes/appliance-update.routes');
const remoteAccessRoutes = require('./routes/remote-access.routes');
const aiRoutes = require('./routes/ai.routes');
const systemRoutes = require('./routes/system.routes');
const reportsRoutes = require('./routes/reports.routes');
const labelsRoutes = require('./routes/labels.routes');
// SEC-02 — المسار العام المنقّى (بديل /api/devices و/api/topology للزوار) + إعداداته.
const publicRoutes = require('./routes/public.routes');
const settingsRoutes = require('./routes/settings.routes');
// MON-02 — إدارة الخدمات المراقَبة لكل جهاز.
const servicesRoutes = require('./routes/services.routes');
// RCA-01/02 — الأعطال المرتبطة بالشجرة (قراءة بجلسة).
const incidentsRoutes = require('./routes/incidents.routes');
// AST-01/02/03 — الأصول ذات الهوية الثابتة (واجهات MAC + سجل IP + تعارضات).
const assetsRoutes = require('./routes/assets.routes');
// Phase 3 — تكاملات اختيارية للقراءة فقط (SNMP معطّل افتراضيًّا).
const integrationsRoutes = require('./routes/integrations.routes');

function createApp() {
  const app = express();

  // SEC-03 — ثقة البروكسي **فقط** عند ضبطها صراحةً (ngrok/nginx عبر NM_TRUST_PROXY).
  // بدونها لا نثق بأي X-Forwarded-* (منع تزوير IP/الأصل في السجلات والقفل).
  if (process.env.NM_TRUST_PROXY) {
    const v = process.env.NM_TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v);
  }

  // SEC-03 — هيدرز أمنية أساسية (nosniff/frame-ancestors/referrer/HSTS على HTTPS).
  app.use(securityHeaders);

  // إعداد multer لتخزين الملفات في الذاكرة (للتعامل مع ملفات Excel).
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  // جعل upload متاحاً للـ routes
  app.use((req, res, next) => {
    req.upload = upload;
    next();
  });

  // JSON body parser.
  app.use(express.json());

  // جلسات تسجيل الدخول (memory store — كافية لحجم هذا المشروع).
  // v2.8.7 — لا قيمة سرّية مكتوبة داخل الكود: المفتاح من .env (SESSION_SECRET).
  // لو غير مُعرَّف (تثبيت جديد بلا .env) يُولَّد مفتاح عشوائي عند الإقلاع ⇒ الجلسات تُقطَع
  // عند إعادة التشغيل بدل استعمال سرّ افتراضي معروف للجميع.
  if (!process.env.SESSION_SECRET) {
    console.warn('[session] SESSION_SECRET غير مُعرَّف في .env — سيُولَّد مفتاح عشوائي مؤقّت (الجلسات ستُقطَع عند إعادة التشغيل).');
  }
  // المفتاح يُحسب هنا: من .env أو عشوائيًّا عند الإقلاع — بلا أي قيمة افتراضية ثابتة داخل الكود.
  function sessionKey() {
    return process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
  }
  app.use(
    session({
      name: 'nm.sid',
      secret: sessionKey(),
      resave: false,
      saveUninitialized: false,
      // SEC-03 — مخزن جلسات دائم على SQLite بدل MemoryStore: الجلسات تبقى صالحة بعد
      // إعادة التشغيل/التحديث (T03: «auth stable after reboot»).
      store: createSqliteSessionStore(db),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 12, // 12 ساعة
      },
    })
  );

  // SEC-03 — حماية CSRF: التحقق من الأصل لكل الطلبات المُغيِّرة (انظر middleware/csrf-guard.js).
  app.use(createCsrfGuard());

  // خدمة ملفات الواجهة (frontend/public) من نفس الخادم — قبل الـ API.
  const publicDir = path.join(__dirname, '../../frontend/public');
  app.use(express.static(publicDir));

  // health check. (v2.11.9 — يضم صحّة محرك المراقبة: النبضة + الفحوصات العالقة.)
  // v2.13.8 — يضم رقم الإصدار (من backend/package.json) — شاشة NOC تعرضه في رأسها
  // بدل نصّ ثابت قديم كان يُسكَت عند كل إصدار جديد (ظهر «v2.13.0» شهورًا بعد رحيله).
  app.get('/api/health', (req, res) => {
    let engine = null;
    try { engine = getEngineHealth(); } catch (e) { engine = { error: e.message }; }
    let version = null;
    try { version = JSON.parse(require('fs').readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version || null; } catch (e) { version = null; }
    res.json({ success: true, data: 'ok', version, engine });
  });

  // API routes.
  app.use('/api/auth', authRoutes);

  // v2.20.0 — فرض الأدوار مركزيًا: حساب «viewer» يقرأ فقط (GET/HEAD/OPTIONS)، مع سماح
  // بمسارات الحساب الشخصي (خروج/تغيير كلمة المرور). كل تعديل آخر ⇒ 403 برسالة عربية.
  app.use((req, res, next) => {
    const user = req.session && req.session.user;
    if (!user || user.role !== 'viewer') return next();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.path.startsWith('/api/auth/')) return next();
    return res.status(403).json({ success: false, error: 'حسابك (عرض فقط) لا يسمح بالتعديلات — تواصل مع المدير' });
  });
  app.use('/api/devices', devicesRoutes);
  app.use('/api/topology', topologyRoutes);
  // SEC-02 — العرض العام المنقّى (بلا IP/MAC/سيريال) + إعداد وضع العرض (المدير فقط).
  app.use('/api/public', publicRoutes);
  app.use('/api/settings', settingsRoutes);
  // MON-02 — خدمات كل جهاز (قراءة بجلسة · تعديل للمدير فقط) + تدقيق تلقائي.
  app.use('/api/devices/:deviceId/services', servicesRoutes);
  // RCA — الأعطال المرتبطة (عطل جهاز أعلى + قائمة الأبناء المتأثرين).
  app.use('/api/incidents', incidentsRoutes);
  // AST — الأصول: asset_id ثابت + واجهات MAC + سجل IP + قائمة مراجعة التعارضات.
  app.use('/api/assets', assetsRoutes);
  // التكاملات الاختيارية (SNMP…) — opt-in صريح وقراءة فقط.
  app.use('/api/integrations', integrationsRoutes);
  app.use('/api/locations', locationsRoutes);
  app.use('/api/device-types', deviceTypesRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/tools', toolsRoutes);
  app.use('/api/scan', scanRoutes);
  app.use('/api/backup', backupRoutes);
  app.use('/api/update', updateRoutes);
  app.use('/api/scan-scheduler', scanSchedulerRoutes);
  app.use('/api/discovered', discoveredRoutes);
  app.use('/api/map', mapRoutes);
  // v2.8.7 — البثّ الحيّ (SSE): قراءة عامة فقط — كل الكتابات تبقى على REST بجلسة الأدمن.
  app.use('/api/live', liveRoutes);
  // v2.8.7 — تحديث الأبلاينس: مسارات محميّة بجلسة الأدمن (طلب + تقدّم).
  app.use('/api/appliance-update', applianceUpdateRoutes);
  // v2.9.0 — الوصول عن بُعد (ngrok): قراءة الحالة + كتابة ملف طلب فقط (التنفيذ بمصدر root).
  app.use('/api/remote-access', remoteAccessRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/system', systemRoutes);
  app.use('/api/reports', reportsRoutes.router);
  // صفحة التقرير الأسبوعي المزوّدة (تفتح في تبويب جديد مع جلسة الأدمن).
  app.get('/reports/weekly', reportsRoutes.weeklyPage);
  app.get('/labels/devices', labelsRoutes);

  // مسارات API غير المعروفة ⇒ 404 بصيغة JSON (لا صفحة HTML)، فلا يبتلعها SPA fallback.
  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: 'المسار غير موجود' });
  });

  // SPA fallback — لو الطلب ليس API ولا ملف موجود، أرجع index.html.
  app.get('*', (req, res, next) => {
    // لا تعترض طلبات API.
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) return next(err);
    });
  });

  // معالج عام للأخطاء غير المعالجة.
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'خطأ داخلي في الخادم' });
  });

  return app;
}

module.exports = { createApp };
