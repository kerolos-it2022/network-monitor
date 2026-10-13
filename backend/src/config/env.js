// config/env.js — تحميل متغيّرات البيئة من مسار محدَّد (مرة واحدة لكل عملية).
// ─────────────────────────────────────────────────────────────────────────────
// v2.13.0 — كان الاستدعاء `require('dotenv').config()` بلا مسار، فيقرأ dotenv
// `./.env` **نسبةً إلى مجلد العمل**. تشغيل الخادم من جذر المستودع
// (`node backend/src/server.js`) كان يجعل الملف غير موجود من الأصل ⇒ متغيّرات
// مثل VAPID_PUBLIC_KEY تبقى غير معرَّفة والواجهة تقول «الإشعارات غير مُهيّأة».
// الآن المسار محسوب نسبةً إلى الكود (backend/.env دائمًا)، ويمكن تجاوزه بـ
// NM_ENV_FILE — تستعمله الفحوصات على نسخ معزولة.
const path = require('path');

// ملف الأسرار الفعلي: نسبةً إلى backend/ لا إلى مجلد العمل.
const ENV_FILE = process.env.NM_ENV_FILE || path.join(__dirname, '..', '..', '.env');

// ملف إعدادات خدمة الأبلاينس: هو EnvironmentFile في network-monitor.service
// (يُكتب وقت التثبيت بـ SESSION_SECRET + DB_PATH، وهو المسار الوحيد القابل
// للكتابة من مستخدم الخدمة netmon بسبب ProtectSystem=strict).
const APPLIANCE_ENV_FILE = '/var/lib/network-monitor/env';

require('dotenv').config({ path: ENV_FILE });

module.exports = { ENV_FILE, APPLIANCE_ENV_FILE };
