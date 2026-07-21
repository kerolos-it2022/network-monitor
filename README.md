# نظام مراقبة أجهزة الشبكة المحلية

تطبيق ويب لمراقبة حالة أجهزة الشبكة المحلية (فايروول، طابعات، NVR/DVR، سويتشات، راوترات، سيرفرات…)
بشكل لحظي، مع إدارة كاملة لبيانات الأجهزة ومواقعها، وإشعارات فورية عبر **تلجرام** و**واتساب**
و**تطبيق الموبايل (PWA)** عند انقطاع أو عودة أي جهاز.

> ✨ **جديد في الإصدار 1.1**: تطبيق ويب تدريجي (PWA) قابل للتثبيت على الهاتف مع إشعارات Web Push فورية
> عبر VAPID — تعمل حتى وإذا كان المتصفح/التطبيق مغلقاً.

---

## ✨ المزايا

- 📊 مراقبة لحظية لأي بروتوكول (Ping / HTTP / HTTPS / TCP Port)
- 📱 **تطبيق PWA قابل للتثبيت** على أندروند/iOS/سطح المكتب
- 🔔 **إشعارات Web Push فورية** عبر VAPID (تعمل حتى والتطبيق مغلق)
- 🤖 إشعارات متوازية عبر تلجرام وواتساب
- 🛠️ أدوات شبكة مباشرة (Ping + Tracert) ببث SSE خط بخط
- 🌓 وضع ليلي/نهاري + واجهة عربية RTL كاملة
- 🔒 فحص تلقائي لـ HTTP/HTTPS عند إضافة كل جهاز + زر فتح فوري للواجهة
- 📈 رسوم بيانية للاستجابة و Uptime% + سجل الانقطاعات

---

## 🧰 المتطلبات

- **Node.js 18+** (موصى به 20 LTS).
- **Python 3** + مكتبة `sqlite3` (مع أداة `sqlite3` CLI لتنفيذ مخطط قاعدة البيانات).
- **pm2** (للإنتاج): `npm install -g pm2`.
- **متصفح حديث** يدعم Service Workers و Web Push (Chrome 90+, Firefox 90+, Safari 16.4+, Edge 90+) — للاستفادة من PWA وإشعارات الموبايل.
- **أدوات البناء** (لترجمة better-sqlite3):
  - Debian/Ubuntu: `sudo apt install -y python3 make g++ build-essential`
  - RHEL/CentOS/Fedora: `sudo dnf install -y python3 make gcc gcc-c++`
  - Arch: `sudo pacman -S python make gcc`
  - Alpine: `sudo apk add python3 make g++ build-base`
  - openSUSE: `sudo zypper install python3 make gcc gcc-c++`

---

## 🚀 خطوات التشغيل المحلي

### 1) تثبيت Node.js
نزّل Node.js 18+ من https://nodejs.org ثم تأكد من التثبيت:
```bash
node -v   # يجب أن يطبع v18.x أو أعلى
```

### 2) إنشاء قاعدة البيانات
من جذر المشروع (`network-monitor/`):
```bash
mkdir -p database
sqlite3 database/monitoring.db < database/schema.sql
```
> على ويندوز إن لم تتوفر `sqlite3`: افتح ملف `database/monitoring.db` الجديد (ملف فارغ)
> في "DB Browser for SQLite" ثم نفّذ محتوى `database/schema.sql` عبر تبويب "Execute SQL".

### 3) إعداد متغيرات البيئة
انسخ ملف المثال وعدّله:
```bash
cp backend/.env.example backend/.env
```
افتح `backend/.env` وعدّل:
- `SESSION_SECRET`: سلسلة عشوائية طويلة (مهم للأمان).
- `DEFAULT_ADMIN_USERNAME` و `DEFAULT_ADMIN_PASSWORD`: حساب المدير الأول.
- (اختياري) `TELEGRAM_BOT_TOKEN` و `TELEGRAM_CHAT_ID` (انظر القسم التالي).
- (اختياري) إعدادات واتساب إن وُجد مزود.

### 4) تثبيت حزم الخادم
```bash
cd backend
npm install
```

### 5) إنشاء حساب المدير الافتراضي (مرة واحدة فقط)
```bash
node src/seedAdmin.js
```
> تشغيله مرّتين لن يُنشئ مستخدماً مكرراً — السكريبت يتحقق من وجود مستخدم قبل الإدراج.

### 6) تشغيل الخادم
```bash
node src/server.js
```
سينتج عنه رسالة مثل:
```
Server running on port 4000
Database connection OK.
Monitoring engine started (every 10s tick).
```

### 7) فتح الواجهة
بعد تشغيل الخادم:

| الصفحة | الرابط |
|---|---|
| الصفحة العامة (عرض حالة الأجهزة) | http://localhost:4000/ |
| تسجيل الدخول للوحة التحكم | http://localhost:4000/admin/login.html |
| لوحة التحكم (بعد تسجيل الدخول) | http://localhost:4000/admin/dashboard.html |

> قبل تفعيل T8.2 (الموجود في `server.js`)، كان الفرونت إند يُفتح مباشرة كملفات HTML —
> الآن يُخدَم الموقعان معًا من نفس خادم Express على المنفذ `4000`.

---

## 🤖 إعداد بوت تلجرام (للإشعارات)

1. من تلجرام، ابحث عن **@BotFather** وابدأ محادثة.
2. أرسل `/newbot` واتبع التعليمات لإنشاء بوت جديد.
3. ستحصل على **Bot Token** بالشكل `123456789:ABC-DEF…`. 
   ضعه في `backend/.env` تحت `TELEGRAM_BOT_TOKEN`.
4. لإيجاد **Chat ID**:
   - أرسل أي رسالة إلى البوت الذي أنشأته.
   - افتح في المتصفح: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - ابحث في الاستجابة عن `"chat":{"id":<رقم>}` — هذا الرقم هو `TELEGRAM_CHAT_ID`.
   - للقنوات/المجموعات: أضف البوت كمسؤول ثم استخدم الـ Chat ID بالسالب (`-100123…`).
5. من لوحة تحكم المدير (تبويب "الإشعارات")، فعّل تلجرام وضع الـ Token و Chat ID واحفظ.

> ملاحظة: النظام يعمل بالكامل حتى لو كانت متغيرات تلجرام/واتساب فارغة —
> تحدّث الإعدادات جملة في `.env` أو من لوحة التحكم وتُحفظ في الجدول `notification_settings`.

---

## 📱 إعداد إشعارات الموبايل (PWA + Web Push)

النظام الآن **PWA قابل للتثبيت** على أي جهاز (أندرويد/iOS/سطح المكتب)، مع إشعارات Web Push فورية
عبر **VAPID** (بدون الحاجة لـ Firebase SDK أو حساب Google).

### 1) توليد مفاتيح VAPID (مرة واحدة على الخادم)

```bash
cd backend
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

سيُطبع:
```
{
  publicKey: 'BHTp...qpY',
  privateKey: 'u2vn...wS4'
}
```

### 2) أضفها إلى `backend/.env`

```env
VAPID_PUBLIC_KEY=BHTp...qpY
VAPID_PRIVATE_KEY=u2vn...wS4
VAPID_SUBJECT=mailto:you@example.com
MOBILE_ENABLED=1
```

> 💡 `deploy.sh install` يقوم بكل ذلك تلقائياً على سيرفر Linux.

### 3) فعّلها من لوحة التحكم

1. سجّل الدخول → تبويب **الإشعارات**
2. فعّل **"إشعارات الهاتف مفعّلة"**
3. احفظ، واضغط **🔔 اختبار إشعار الهاتف** للتأكد

### 4) على هاتفك

1. افتح **`http://<IP-الخادم>:4000`** من متصفح Chrome على الهاتف
2. اضغط زر **🔔 تفعيل الإشعارات** أعلى الصفحة
3. اسمح بالإشعارات → سيظهر إشعار تجريبي للتأكيد
4. اضغط قائمة Chrome (⋮) → **Add to Home Screen** لتثبيت التطبيق

🎉 الآن ستصل الإشعارات حتى والتطبيق مغلق.

> ⚠️ **iOS**: متاح على iOS 16.4+ عبر Safari فقط. الأجهزة الأقدم لا تدعم Web Push لكن التطبيق يعمل كـ PWA.

---

## 🐧 النشر على سيرفر Linux (بدون Docker)

للنشر في بيئة إنتاجية (شركتك)، استخدم السكريبت الجاهز الذي يعمل **بشكل مباشر** عبر Node.js + PM2 و**يدعم أي توزيعة Linux رئيسية**:

| العائلة | التوزيعات المدعومة | مدير الحزم |
|---|---|---|
| Debian | Ubuntu، Mint، Pop!_OS، Kali | `apt` |
| Red Hat | RHEL، CentOS، Rocky، Alma، Fedora | `dnf`/`yum` |
| Arch | Arch Linux، Manjaro | `pacman` |
| Alpine | Alpine Linux | `apk` |
| SUSE | openSUSE، SLES | `zypper` |

```bash
# على أي توزيعة Linux مدعومة:
sudo mkdir -p /opt && sudo chown $USER:$USER /opt
cd /opt
git clone https://github.com/kerolos-it2022/network-monitor.git network-monitor
cd network-monitor
sudo bash deploy.sh install
```

السكريبت يكتشف التوزيعة تلقائياً ويثبّت: الأدوات الأساسية (git, curl, wget) + أدوات البناء (python3, make, g++) + Node.js 20 LTS + PM2 + sqlite3 + حزم الخادم + تهيئة قاعدة البيانات + تشغيل التطبيق.

**المميزات الجديدة في `deploy.sh`:**
- ✅ **بناء نظيف**: يحذف `node_modules` و `package-lock.json` قبل التثبيت لضمان بناء `better-sqlite3` للنظام المستهدف
- ✅ **مسار ديناميكي**: `ecosystem.config.js` يستخدم متغير `PROJECT_DIR` ليعمل من أي مكان
- ✅ **دعم Alpine Linux**: يستخدم `--build-from-source` للـ `better-sqlite3`
- ✅ **تحديث متغيرات البيئة**: `pm2 restart --update-env` عند إعادة التشغيل
- ✅ **توافق Bash واسع**: يعمل على إصدارات Bash القديمة

📖 **دليل كامل بالنشر**: راجع [`DEPLOY.md`](./DEPLOY.md) — يشمل تثبيت Nginx + HTTPS، Firewall، النسخ الاحتياطي، والنشر في عدة شركات.

---

## ▶️ التشغيل عبر PM2 (للإنتاج)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 logs network-monitor      # متابعة السجل
pm2 stop network-monitor      # إيقاف
pm2 restart network-monitor   # إعادة تشغيل
```

لجعله يبدأ تلقائياً مع نظام التشغيل (على لينكس/ماك):
```bash
pm2 startup
pm2 save
```

---

## 📁 هيكل المشروع

```
network-monitor/
├── backend/
│   ├── src/
│   │   ├── server.js         نقطة بدء الخادم + إعداد session + static
│   │   ├── db.js             اتصال better-sqlite3
│   │   ├── seedAdmin.js      إنشاء المدير الافتراضي
│   │   ├── routes/           مسارات API (auth, devices, locations, deviceTypes, notifications)
│   │   ├── services/         محرك المراقبة + الفاحصون + الإشعارات + إدارة الانقطاع
│   │   └── middleware/       requireAuth
│   ├── package.json
│   └── .env.example
├── frontend/
│   └── public/
│       ├── index.html        الصفحة العامة
│       ├── admin/            login.html + dashboard.html
│       ├── css/style.css
│       └── js/               public-dashboard, charts, admin-*
├── database/
│   └── schema.sql
├── ecosystem.config.js       إعدادات PM2
├── PROGRESS.md               سجل تقدم البناء (لمتابعة العمل بأي موديل آخر)
└── README.md                 هذا الملف
```

---

## 🔌 ملخّص عقد الـ API

كل المسارات تبدأ بـ `/api`. المسارات المعلّمة 🔒 تتطلب جلسة تسجيل دخول.

| الطريقة | المسار | الحماية | الوصف |
|---|---|---|---|
| GET | `/api/health` | لا | فحص صحة الخادم |
| POST | `/api/auth/login` | لا | تسجيل الدخول |
| POST | `/api/auth/logout` | 🔒 | تسجيل الخروج |
| GET | `/api/auth/me` | لا | معرفة الجلسة الحالية |
| GET | `/api/devices` | لا | قائمة كل الأجهزة وحالتها |
| GET | `/api/devices/:id` | لا | تفاصيل جهاز واحد |
| GET | `/api/devices/:id/history?range=24h\|7d\|30d` | لا | سجل الحالة + Uptime + الانقطاعات |
| POST | `/api/devices` | 🔒 | إضافة جهاز |
| PUT | `/api/devices/:id` | 🔒 | تعديل جهاز |
| DELETE | `/api/devices/:id` | 🔒 | حذف جهاز |
| GET / POST / PUT / DELETE | `/api/locations` | الكتابة 🔒 | إدارة المواقع |
| GET / POST / PUT / DELETE | `/api/device-types` | الكتابة 🔒 | إدارة أنواع الأجهزة |
| GET / PUT | `/api/notifications/settings` | 🔒 | إعدادات قنوات الإشعار (تلجرام/واتساب/موبايل) |
| POST | `/api/notifications/register` | لا | تسجيل جهاز موبايل لتلقي Web Push |
| DELETE | `/api/notifications/register` | لا | إلغاء تسجيل جهاز موبايل |
| GET | `/api/notifications/vapid-public` | لا | مفتاح VAPID العام للاشتراك في Web Push |
| POST | `/api/notifications/test` | 🔒 | إرسال إشعار تجريبي للموبايل |
| GET | `/api/notifications/logs` | 🔒 | آخر 100 إشعار مُرسل |
| GET | `/api/tools/ping?ip=...` | لا | تنفيذ Ping مع بث SSE مباشر |
| GET | `/api/tools/tracert?ip=...` | لا | تنفيذ Tracert مع بث SSE مباشر |

---

## ✅ اختبار سريع بعد التشغيل

1. افتح `http://localhost:4000/` — يجب أن تظهر الصفحة العامة (قد تكون فارغة).
2. افتح `http://localhost:4000/admin/login.html` وسجّل الدخول ببيانات المدير من `.env`.
3. من تبويب الأنواع أضف نوعاً (مثل "Router")، ومن تبويب المواقع أضف موقعاً.
4. من تبويب الأجهزة أضف جهازاً بـ IP محلي (مثل `127.0.0.1`) وبروتوكول `Ping`.
5. خلال 30 ثانية (حسب فترة الفحص الافتراضية) سيظهر الجهاز بحالة "متصل" في الصفحة العامة.
6. من تبويب الإشعارات فعّل تلجرام وجرّب عبر إيقاف جهاز على الشبكة.

---

## 🛡️ ملاحظات أمان

- كلمات المرور مشفّرة بـ `bcryptjs` (10 rounds).
- كل استعلامات SQL عبر Prepared Statements (لاحقن SQL).
- قنوات الإشعار تُقرأ من `process.env` أو من الجدول فقط — لا شيء مشفّر بـ hardcoded.
- التوكنات في API الإعدادات تُرجع مقنّعة (آخر 4 خانات فقط).
- مفاتيح VAPID الخاصة (`VAPID_PRIVATE_KEY`) محفوظة في `.env` فقط ولا تُرسل لأي عميل.
- تسجيلات الموبايل (`mobile_registrations`) تُعطّل تلقائياً عند انتهاء صلاحيتها (404/410 من FCM).
- فحص تلقائي لـ HTTP/HTTPS عند إضافة أي جهاز جديد (تحديث `http_accessible`/`https_accessible`).

---

## 📌 المهام المؤجلة (خارج الإصدار الحالي)

- التحديث اللحظي عبر WebSocket/SSE لدفع تغييرات الحالة بدل Polling كل 10 ثوانٍ.
- تقارير PDF/Excel قابلة للتصدير.
- صلاحيات متعددة المستويات (Admin / Operator).
- دعم SNMP.
- الانتقال إلى PostgreSQL عند تجاوز بضع مئات من الأجهزة.
- مهلة هدوء (cooldown) لتجنب سبام الإشعارات للأجهزة المتذبذبة (flapping).

انظر `PROGRESS.md` لتفاصيل ما تم تنفيذه وما تأجّل.
