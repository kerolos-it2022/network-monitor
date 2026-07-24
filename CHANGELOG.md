# Changelog

جميع التغييرات المهمة لهذا المشروع موثقة في هذا الملف.

التنسيق مستند إلى [Keep a Changelog](https://keepachangelog.com/ar/1.0.0/)،
وهذا المشروع يتبع [Semantic Versioning](https://semver.org/lang/ar/).

## [2.1.0] - 2026-07-23

### 🚀 الميزات الجديدة

#### 🔄 نظام التحديثات من GitHub (GitHub Updates)
- **فحص التحديثات** - التحقق من وجود إصدارات جديدة عبر GitHub API
- **عرض سجل التغييرات** - عرض Changelog في مودال تفاعلي
- **تحديث بنقرة واحدة** - Git Pull + npm install + PM2 Restart
- **سكريبت التحديث (update.sh)** - حفظ التغييرات المحلية، تحديث التبعيات، إعادة تشغيل PM2
- **اختيار الفرع** - دعم main/develop/master

#### 🔧 التحسينات التقنية
- **إصلاح عرض التحديثات** - إظهار رقم الإصدار السيمانتك (مثل 2.1.0) بدلاً من commit hash
- **معالجة خطأ الفرع** - التحقق من وجود الفرع على البعيد قبل الفحص
- **اقتراح الفرع الافتراضي** - اقتراح الفرع الافتراضي عند اختيار فرع غير موجود
- **تحسين GitHub API** - جلب التاجات والإصدارات بشكل صحيح

### 🐛 إصلاحات الأخطاء
- ✅ إصلاح خطأ `isGitRepo is not defined` في `/api/update/status`
- ✅ إصلاح خطأ `checkBranchExists` عند فحص فرع غير موجود
- ✅ إصلاح خطأ `SyntaxError` في `checkBranchExists` function
- ✅ إصلاح عرض الإصدار الحالي - الآن يقرأ من package.json بدلاً من git commit hash

## [2.0.0] - 2026-07-23

### 🚀 الميزات الرئيسية الجديدة

#### 🔍 اكتشاف الشبكة (Network Discovery)
- **Ping Sweep** - مسح نطاق الشبكة بالكامل لاكتشاف الأجهزة المستجيبة
- **Port Scanning** - مسح 24 منفذاً شائعاً (SSH, HTTP, HTTPS, RDP, SMB, RTSP, إلخ)
- **MAC Vendor Lookup** - تحديد الشركة المصنعة من عنوان MAC (50+ بائع معروف)
- **Reverse DNS Lookup** - حل اسم المضيف عبر DNS العكسي
- **SMB/NetBIOS Name Resolution** - استخراج اسم الجهاز الحقيقي عبر nbtstat (Windows) / nmblookup (Linux)
- **Device Type Detection** - تحديد نوع الجهاز تلقائياً (Camera, Printer, Router, Server, NAS, VM, إلخ)

#### 🔄 نظام التحديثات من GitHub
- **فحص التحديثات** - التحقق من وجود إصدارات جديدة عبر GitHub API
- **عرض سجل التغييرات** - عرض Changelog في مودال تفاعلي
- **تحديث بنقرة واحدة** - Git Pull + npm install + PM2 Restart
- **سكريبت التحديث (update.sh)** - حفظ التغييرات المحلية، تحديث التبعيات، إعادة تشغيل PM2
- **اختيار الفرع** - دعم main/develop/master

#### 🏷️ أيقونات أنواع الأجهزة
- 50+ نوع جهاز مع إيموجي مناسبة
- التعيين التلقائي للأيقونة حسب نوع الجهاز
- عرض الأيقونات في جدول الأنواع في لوحة التحكم

#### 🎨 تحسينات الواجهة
- قوائم ترتيب متوافقة مع الوضع الليلي/النهاري
- محدد الفرع للتحديثات
- حفظ آخر CIDR مستخدم في localStorage
- خيارات ترتيب للأجهزة، المواقع، الأنواع، السجلات

### 🔧 التحسينات التقنية
- **SMB/NetBIOS Name Resolution** - استخدام nbtstat (Windows) و nmblookup (Linux)
- **منطق تحديد نوع الجهاز** - أولويات ذكية (SMB Name > Hostname > Type > MAC Vendor > Ports > Fallback)
- **سكريبت التحديث** - git stash/pop، npm install، pm2 restart
- **تكامل GitHub API** - جلب الإصدارات، changelog، أحدث إصدار

- **دعم الخادم**: `nbtstat -A <ip>` لاستخراج اسم NetBIOS
- **دعم Linux**: `nmblookup -A <ip>` لاستخراج اسم NetBIOS
- **تحليل مخرجات SMB** - استخراج الأسماء من أنماط `<15>`, `<00>`, `<20>`

### 🐛 إصلاحات الأخطاء
- ✅ تنسيق قائمة الترتيب في الوضع الليلي/النهاري (CSS class `.sort-select`)
- ✅ إدخال CIDR مع datalist للسجل التاريخي
- ✅ حفظ آخر CIDR مستخدم في localStorage
- ✅ خيارات ترتيب للأجهزة، المواقع، الأنواع، السجلات
- ✅ عرض الأيقونات في عمود "الأيقونة" بجدول الأنواع
- ✅ إصلاح تسمية SMB Name في الأسماء المقترحة

## [1.1.0] - 2026-07-19

### ✨ الميزات الجديدة
- ✅ تغيير كلمة مرور المدير (PUT `/api/auth/change-password`)
- ✅ تصدير الأجهزة إلى Excel (GET `/api/devices/export/excel`)
- ✅ استيراد الأجهزة من Excel مع التحقق من التكرار (POST `/api/devices/import/excel`)
- ✅ تبويب "الملف الشخصي" في لوحة التحكم
- ✅ حفظ الوضع الليلي في localStorage

- ✅ **مكتبات جديدة**: multer (رفع الملفات)، xlsx (قراءة/كتابة Excel)

### 🐛 الإصلاحات
- ✅ إصلاح الوضع الليلي: الآن يحفظ الاختيار في localStorage
- ✅ إصلاح ظهور الأجهزة في الصفحة العامة: إضافة `credentials: 'include'`
- ✅ إصلاح استيراد Excel: استخدام `multer.single('file')` مع `req.file.buffer`
- ✅ منع تكرار IP عند الاستيراد مع رسالة خطأ واضحة
- ✅ إصلاح جلب تفاصيل الجهاز (المودال): إضافة `credentials: 'include'`

### 📁 الملفات الجديدة
- `frontend/public/js/admin-profile.js` (إدارة الملف الشخصي)

### 📦 التبعيات الجديدة
- `multer@^1.4.5-lts.1` (رفع الملفات)
- `xlsx@^0.18.5` (قراءة/كتابة Excel)

### 📝 الملفات المعدلة
- `backend/package.json` و `backend/package-lock.json`
- `backend/src/routes/auth.routes.js` (إضافة تغيير كلمة المرور)
- `backend/src/routes/devices.routes.js` (تصدير/استيراد Excel)
- `backend/src/server.js` (تسجيل مسار الملف الشخصي)
- `frontend/public/admin/dashboard.html` (تبويب الملف الشخصي)
- `frontend/public/js/admin-devices.js` (أزرار التصدير/الاستيراد)
- `frontend/public/js/admin-profile.js` (جديد - إدارة الملف الشخصي)
- `frontend/public/js/admin-tabs.js` (تسجيل تبويب الملف الشخصي)

---

## [1.0.1] - 2026-07-18

### 🐛 الإصلاحات
- إصلاح توليد مفاتيح VAPID في `deploy.sh` (استخدام `getPublicKey()` بدون معامل)
- إضافة `traceroute` لأدوات النظام المطلوبة لأداة Tracert
- تحديث التوثيق للعمل بدون دومين حقيقي (mkcert، self-signed، Tailscale/ngrok)

---

## [1.0.0] - 2026-07-17

### 🎉 الإصدار الأولي
نظام مراقبة أجهزة الشبكة المحلية - الإصدار الأول المستقر

### الميزات الأساسية
- 📊 **مراقبة لحظية** للأجهزة (Ping / HTTP / HTTPS / TCP Port)
- 📱 **تطبيق PWA قابل للتثبيت** مع إشعارات Web Push فورية عبر VAPID
- 🔔 **إشعارات متعددة القنوات** - Telegram، WhatsApp، Mobile Push
- 🛠️ **أدوات الشبكة** - Ping + Tracert ببث مباشر (SSE)
- 🌓 **وضع ليلي/نهاري** كامل مع واجهة عربية RTL
- 🔐 **نظام مصادقة** مع جلسات آمنة
- 📊 **رسوم بيانية** للاستجابة و Uptime% + سجل الانقطاعات
- 🏷️ **إدارة كاملة** للأجهزة، المواقع، الأنواع
- 📈 **لوحة تحكم عامة** (بدون تسجيل دخول) ولوحة إدارة (بمصادقة)
- 🌐 **واجهة عربية RTL كاملة** مع دعم RTL كامل

### البنية التقنية
- **Backend**: Node.js + Express + SQLite (better-sqlite3)
- **Frontend**: Vanilla JS + CSS Variables + PWA + Service Workers
- **Real-time**: Server-Sent Events (SSE) للأدوات والتحديثات الحية
- **Notifications**: Web Push (VAPID) + Telegram Bot API + WhatsApp API
- **Database**: SQLite مع فهارس محسنة وجداول منفصلة للأجهزة، السجلات، الإشعارات

### الصفحات
- `/` - الصفحة العامة (عرض حالة الأجهزة، أدوات الشبكة)
- `/admin/login.html` - تسجيل دخول لوحة التحكم
- `/admin/dashboard.html` - لوحة الإدارة الكاملة

### API Endpoints
- `GET /api/devices` - قائمة الأجهزة
- `POST /api/devices` - إضافة جهاز
- `PUT /api/devices/:id` - تعديل جهاز
- `DELETE /api/devices/:id` - حذف جهاز
- `GET /api/devices/:id/history` - سجل حالة الجهاز
- `GET /api/locations` - المواقع
- `GET /api/device-types` - أنواع الأجهزة
- `GET /api/notifications/settings` - إعدادات الإشعارات
- `PUT /api/notifications/settings` - حفظ الإعدادات
- `POST /api/tools/ping` - Ping مع SSE
- `POST /api/tools/tracert` - Traceroute مع SSE

---

## روابط مفيدة
- **المستودع**: https://github.com/kerolos-it2022/network-monitor
- **الإصدارات**: https://github.com/kerolos-it2022/network-monitor/releases
- **التوثيق**: https://github.com/kerolos-it2022/network-monitor/wiki