// server.js: نقطة بدء الخادم — Express + session + static + routes + محرك المراقبة.
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const db = require('./db');
const { startMonitoring } = require('./services/monitor.service');

const authRoutes = require('./routes/auth.routes');
const devicesRoutes = require('./routes/devices.routes');
const locationsRoutes = require('./routes/locations.routes');
const deviceTypesRoutes = require('./routes/deviceTypes.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const toolsRoutes = require('./routes/tools.routes');
const scanRoutes = require('./routes/scan.routes');
const backupRoutes = require('./routes/backup.routes');
const updateRoutes = require('./routes/update.routes');

const app = express();
const PORT = process.env.PORT || 4000;

// إعداد multer لتخزين الملفات في الذاكرة (للتعامل مع ملفات Excel)
const upload = multer({ storage: multer.memoryStorage() });

// جعل upload متاحاً للـ routes
app.use((req, res, next) => {
  req.upload = upload;
  next();
});

// JSON body parser.
app.use(express.json());

// جلسات تسجيل الدخول (memory store — كافية لحجم هذا المشروع).
app.use(
  session({
    name: 'nm.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12, // 12 ساعة
    },
  })
);

// خدمة ملفات الواجهة (frontend/public) من نفس الخادم — قبل الـ API.
const publicDir = path.join(__dirname, '../../frontend/public');
app.use(express.static(publicDir));

// health check.
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: 'ok' });
});

// API routes.
app.use('/api/auth', authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/device-types', deviceTypesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/update', updateRoutes);

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

// التحقق من الاتصال بقاعدة البيانات قبل بدء الخادم.
try {
  db.prepare('SELECT 1').get();
  console.log('Database connection OK.');
} catch (e) {
  console.error('Database connection FAILED:', e.message);
  console.error('تأكد من تنفيذ database/schema.sql وتعيين DB_PATH في .env');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // بدء محرك المراقبة بعد نجاح تشغيل الخادم.
  startMonitoring();
});
