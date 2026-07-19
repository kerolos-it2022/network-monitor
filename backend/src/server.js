// server.js: نقطة بدء الخادم — Express + session + static + routes + محرك المراقبة.
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./db');
const { startMonitoring } = require('./services/monitor.service');

const authRoutes = require('./routes/auth.routes');
const devicesRoutes = require('./routes/devices.routes');
const locationsRoutes = require('./routes/locations.routes');
const deviceTypesRoutes = require('./routes/deviceTypes.routes');
const notificationsRoutes = require('./routes/notifications.routes');

const app = express();
const PORT = process.env.PORT || 4000;

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

// خدمة ملفات الواجهة (frontend/public) من نفس الخادم.
const publicDir = path.join(__dirname, '../../frontend/public');
app.use(express.static(publicDir));

// معالج عام للأخطاء غير المعالجة.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'خطأ داخلي في الخادم' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // بدء محرك المراقبة بعد نجاح تشغيل الخادم.
  startMonitoring();
});

// التحقق من الاتصال بقاعدة البيانات عند الإقلاع.
try {
  db.prepare('SELECT 1').get();
  console.log('Database connection OK.');
} catch (e) {
  console.error('Database connection FAILED:', e.message);
  console.error('تأكد من تنفيذ database/schema.sql وتعيين DB_PATH في .env');
}
