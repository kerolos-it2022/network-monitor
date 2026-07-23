# 📡 نظام مراقبة أجهزة الشبكة المحلية - Network Monitor

[![Version](https://img.shields.io/badge/version-2.1.1-blue.svg)](https://github.com/kerolos-it2022/network-monitor/releases)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-blue.svg)](docker-compose.yml)
[![PWA](https://img.shields.io/badge/PWA-ready-purple.svg)](https://web.dev/progressive-web-apps/)
[![CI/CD](https://github.com/kerolos-it2022/network-monitor/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/kerolos-it2022/network-monitor/actions)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

> **نظام مراقبة احترافي** لأجهزة الشبكة المحلية (فايروول، طابعات، NVR/DVR، سويتشات، راوترات، سيرفرات...) مع مراقبة لحظية، إدارة شاملة، وإشعارات فورية عبر **Telegram** و **WhatsApp** و **تطبيق الموبايل (PWA)**.

> 🌟 **الإصدار الحالي: v2.1.1** - تحديثات GitHub، دعم Docker، CI/CD، Network Discovery، إصلاحات Docker Build.

---

## 📋 **جدول المحتويات**

- [✨ المميزات الرئيسية](#-المميزات-الرئيسية)
- [🎯 المتطلبات](#-المتطلبات)
- [🚀 التثبيت السريع](#-التثبيت-السريع)
- [🐳 النشر عبر Docker](#-النشر-عبر-docker)
- [🔄 نظام التحديثات من GitHub](#-نظام-التحديثات-من-github)
- [🔍 Network Discovery (اكتشاف الشبكة)](#-network-discovery-اكتشاف-الشبكة)
- [🔄 CI/CD Pipeline](#-cicd-pipeline)
- [🤖 إعداد بوت تيليجرام](#-إعداد-بوت-تيليجرام)
- [📱 إشعارات الموبايل (PWA + Web Push)](#-إشعارات-الموبايل-pwa--web-push)
- [🐧 النشر على سيرفر Linux](#-النشر-على-سيرفر-linux)
- [🔧 إعدادات متقدمة](#-إعدادات-متقدمة)
- [📁 هيكل المشروع](#-هيكل-المشروع)
- [🔌 مرجع API](#-مرجع-api)
- [✅ اختبار سريع](#-اختبار-سريع)
- [🛡️ الأمان](#️-الأمان)
- [🗺️ خارطة الطريق](#️-خارطة-الطريق)

---

## ✨ **المميزات الرئيسية**

| الميزة | الوصف |
|----------|---------|
| 📊 **مراقبة لحظية** | Ping / HTTP / HTTPS / TCP Port كل 10 ثوانٍ (قابل للتعديل) |
| 📱 **PWA جاهز** | تثبيت على Android/iOS/Desktop، يعمل أوفلاين |
| 🔔 **إشعارات فورية** | Telegram + WhatsApp + Web Push (VAPID) |
| 🌐 **واجهة عربية RTL** | دعم كامل للغة العربية، وضع ليلي/نهاري |
| 📊 **رسوم بيانية** | زمن الاستجابة، Uptime%، سجل الانقطاعات |
| 🔍 **أدوات الشبكة** | Ping + Tracert مباشر عبر SSE |
| 🔐 **أمان عالي** | bcrypt، Prepared Statements، Sessions آمنة |
| 🐳 **Docker Ready** | صورة محسنة، docker-compose، health checks |
| 🔄 **CI/CD** | GitHub Actions، Docker Hub، Deploy تلقائي |
| 🔄 **تحديثات GitHub** | تحديث بنقرة واحدة من لوحة التحكم |
| 🔍 **Network Discovery** | اكتشاف تلقائي للأجهزة على الشبكة |

---

## 🎯 **المتطلبات**

| المتطلب | الإصدار | ملاحظات |
|-----------|---------|---------|
| **Node.js** | 20 LTS أو أعلى | [تحميل](https://nodejs.org/) |
| **Python 3** | 3.8+ | لبناء `better-sqlite3` |
| **sqlite3 CLI** | - | لإنشاء قاعدة البيانات |
| **pm2** | أحدث إصدار | `npm install -g pm2` |
| **Git** | - | لاستنساخ المشروع |
| **متصفح حديث** | Chrome 90+ / Firefox 90+ / Safari 16.4+ / Edge 90+ | لـ PWA و Web Push |

### أدوات البناء (لبناء `better-sqlite3`):
| النظام | الأمر |
|----------|-------|
| **Debian/Ubuntu/Mint** | `sudo apt install -y python3 make g++ build-essential` |
| **RHEL/CentOS/Fedora/Rocky/Alma** | `sudo dnf install -y python3 make gcc gcc-c++` |
| **Arch/Manjaro** | `sudo pacman -S python make gcc` |
| **Alpine** | `sudo apk add python3 make g++ build-base` |
| **openSUSE** | `sudo zypper install python3 make gcc gcc-c++` |

---

## 🚀 **التثبيت السريع (3 خطوات)**

### **الطريقة الأولى: التثبيت المحلي (للتطوير/الاختبار)**

```bash
# 1. استنساخ المشروع
git clone https://github.com/kerolos-it2022/network-monitor.git
cd network-monitor

# 2. إنشاء قاعدة البيانات
mkdir -p database
sqlite3 database/monitoring.db < database/schema.sql

# 3. إعداد متغيرات البيئة
cp backend/.env.example backend/.env
# عدّل backend/.env بأدواتك المفضلة (nano/vim/code)

# 4. تثبيت التبعيات وتشغيل
cd backend && npm install
node src/seedAdmin.js    # إنشاء مدير افتراضي
npm start                # تشغيل الخادم
```

> **📝 ملاحظة**: على Windows، إذا لم تتوفر `sqlite3`، استخدم [DB Browser for SQLite](https://sqlitebrowser.org/) لاستيراد `database/schema.sql`.

---

### **الوصول للواجهات**

| الواجهة | الرابط |
|----------|--------|
| 🌐 **الصفحة العامة** (عرض حالة الأجهزة) | `http://localhost:4000/` |
| 🔐 **تسجيل الدخول** | `http://localhost:4000/admin/login.html` |
| 📊 **لوحة التحكم** | `http://localhost:4000/admin/dashboard.html` |

---

## 🐳 **النشر عبر Docker (الأسهل والأسرع)**

### 🚀 النشر السريع بـ Docker Compose

```bash
# 1. استنساخ
git clone https://github.com/kerolos-it2022/network-monitor.git
cd network-monitor

# 2. إعداد البيئة
cp backend/.env.example backend/.env
# عدّل backend/.env بالقيم المطلوبة

# 3. بناء وتشغيل
docker-compose up -d --build

# التحقق
docker-compose logs -f
```

### 📋 **الخدمات في docker-compose.yml**
| الخدمة | البورت | الوصف |
|---------|--------|-------|
| `network-monitor` | 4000 | التطبيق الرئيسي |
| (اختياري) `caddy` | 80/443 | Reverse Proxy + HTTPS تلقائي |

### 📋 **Dockerfile (مُحسّن)**
- **Base**: `node:20-alpine` (خفيف، آمن)
- **Build tools**: python3, make, g++ (لبناء better-sqlite3)
- **Non-root user**: `nodejs:1001`
- **Health Check**: كل 30 ثانية على `/api/health`

### Docker Compose (جاهز للإنتاج)
```yaml
services:
  network-monitor:
    build: ./backend
    ports: ["4000:4000"]
    environment:
      - NODE_ENV=production
      - PORT=4000
    volumes:
      - ./database:/app/database
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:4000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
```

### أوامر Docker المفيدة
```bash
# بناء بدون كاش
docker-compose build --no-cache

# عرض السجلات
docker-compose logs -f network-monitor

# إعادة تشغيل
docker-compose restart network-monitor

# تحديث للصورة الجديدة
docker-compose pull && docker-compose up -d --build

# تنظيف الصور القديمة
docker system prune -a
```

---

## 🔄 **نظام التحديثات من GitHub (GitHub Updates)**

### ✨ المميزات
- **فحص التحديثات** - التحقق من وجود إصدارات جديدة عبر GitHub API
- **عرض سجل التغييرات** - عرض Changelog في مودال تفاعلي
- **تحديث بنقرة واحدة** - Git Pull + npm install + PM2 Restart
- **سكريبت التحديث (update.sh)** - حفظ التغييرات المحلية، تحديث التبعيات، إعادة تشغيل PM2

### 🎯 كيفية الاستخدام
1. افتح لوحة التحكم → تبويب **"🔄 التحديثات"**
2. اختر الفرع (main/develop/master)
3. اضغط **"🔍 فحص التحديثات"**
4. إذا وجد تحديث → اضغط **"🚀 تطبيق التحديث"**
4. النظام سينفذ: `git pull` → `npm install` → `pm2 restart`

### 📋 سكريبت التحديث (update.sh)
```bash
# على السيرفر:
cd /opt/network-monitor
./update.sh
```

---

## 🔍 **Network Discovery (اكتشاف الشبكة)**

### 🔍 المميزات
- **Ping Sweep** - مسح نطاق الشبكة بالكامل لاكتشاف الأجهزة المستجيبة
- **Port Scanning** - مسح 24 منفذاً شائعاً (SSH, HTTP, HTTPS, RDP, SMB, RTSP، إلخ)
- **MAC Vendor Lookup** - تحديد الشركة المصنعة من عنوان MAC (50+ بائع معروف)
- **Reverse DNS Lookup** - حل اسم المضيف عبر DNS العكسي
- **SMB/NetBIOS Name Resolution** - استخراج اسم الجهاز الحقيقي عبر nbtstat (Windows) / nmblookup (Linux)
- **Device Type Detection** - تحديد نوع الجهاز تلقائياً (Camera, Printer, Router, Server, NAS، إلخ)

### 🎯 كيفية الاستخدام
1. افتح لوحة التحكم → تبويب **"🔍 اكتشاف الأجهزة"**
2. أدخل نطاق الشبكة (مثال: `192.168.1.0/24`)
3. اختر الخيارات: مسح المنافذ، استعلام SNMP
3. اضغط **"🚀 بدء المسح"**
4. ستظهر الأجهزة المكتشفة مع:
   - IP، اسم مقترح، النوع، الشركة المصنعة (MAC)
   - المنافذ المفتوحة، زمن الاستجابة
4. حدد الأجهزة → اضغط **"➕ إضافة للمراقبة"**

---

## 🔄 **CI/CD Pipeline (GitHub Actions)**

### 🔧 Pipeline Stages
| Job | الوصف |
|-----|-------|
| `lint-and-test` | فحص الكود والاختبارات |
| `build` | بناء Docker Image ورفعه لـ GHCR |
| `deploy` | نشر تلقائي للخادم عبر SSH |
| `release` | تحديث ملاحظات الإصدار تلقائياً |
| `notify` | إشعارات Discord |

### 📋 الملف: `.github/workflows/ci-cd.yml`
```yaml
jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run lint
      - run: npm test

  build:
    needs: lint-and-test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write  # مطلوب لـ GHCR
    steps:
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          script: |
            cd /opt/network-monitor
            git pull origin main
            cd backend && npm ci --production
            pm2 restart network-monitor --update-env
```

---

## 🤖 **إعداد بوت تيليجرام (للإشعارات)**

> **⚡ اختياري** - النظام يعمل بدونه، لكن الإشعارات تتطلبه.

1. افتح **[BotFather](https://t.me/BotFather)** في تيليجرام
2. أرسل `/newbot` واتبع التعليمات
3. احصل على **Bot Token** (مثال: `123456789:ABC-DEF...`)
3. احصل على **Chat ID**:
   - أرسل رسالة للبوت
   - افتح: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - ابحث عن `"chat":{"id":123456789}` → هذا هو Chat ID
4. أضف إلى `backend/.env`:
   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABC-DEF...
   TELEGRAM_CHAT_ID=123456789
   ```

---

## 📱 **إشعارات الموبايل (PWA + Web Push)**

النظام **PWA جاهز** - يعمل على Android/iOS/Desktop مع إشعارات فورية عبر **VAPID** (بدون Firebase).

### 1️⃣ توليد مفاتيح VAPID (مرة واحدة)
```bash
cd backend
node -e "console.log(require('web-push').generateVAPIDKeys())"
```
**النتيجة:**
```json
{
  "publicKey": "BHTp...qpY",
  "privateKey": "u2vn...wS4"
}
```

### 2️⃣ إضافة المفاتيح لـ `.env`
```env
VAPID_PUBLIC_KEY=BHTp...qpY
VAPID_PRIVATE_KEY=u2vn...wS4
VAPID_SUBJECT=mailto:you@example.com
MOBILE_ENABLED=1
```

### 3️⃣ تفعيل من لوحة التحكم
1. تسجيل دخول → تبويب **الإشعارات**
2. تفعيل **"إشعارات الهاتف مفعّلة"**
3. حفظ → اضغط **🔔 اختبار إشعار الهاتف**

### 4️⃣ على هاتفك (Android/iOS)
1. افتح `http://<IP-السيرفر>:4000` من **Chrome** (Android) أو **Safari** (iOS 16.4+)
2. اضغط **🔔 تفعيل الإشعارات** → اسمح
3. اضغط قائمة المتصفح (⋮) → **Add to Home Screen** لتثبيت التطبيق
3. **اختبر**: من لوحة التحكم → 🔔 اختبار إشعار الهاتف

> ⚠️ **iOS**: يتطلب iOS 16.4+ و Safari. الأجهزة الأقدم لا تدعم Web Push لكن التطبيق يعمل كـ PWA.

---

## 🐧 **النشر على سيرفر Linux (Production Ready)**

يدعم **جميع التوزيعات الرئيسية** - السكريبت يكتشف التوزيعة تلقائياً:

| العائلة | التوزيعات | مدير الحزم |
|----------|-----------|------------|
| **Debian** | Ubuntu, Mint, Pop!_OS, Kali, Debian | `apt` |
| **Red Hat** | RHEL, CentOS, Rocky, Alma, Fedora | `dnf` / `yum` |
| **Arch** | Arch, Manjaro, EndeavourOS | `pacman` |
| **Alpine** | Alpine Linux | `apk` |
| **SUSE** | openSUSE, SLES | `zypper` |

### 🚀 النشر السريع (5 دقائق)

```bash
# على جهازك: ادفع الكود لـ GitHub
git remote add origin https://github.com/kerolos-it2022/network-monitor.git
git push -u origin main

# على السيرفر:
sudo mkdir -p /opt && sudo chown $USER:$USER /opt
cd /opt
git clone https://github.com/kerolos-it2022/network-monitor.git network-monitor
cd network-monitor
sudo bash deploy.sh install
```

### 👉 **ما يفعله `deploy.sh install` تلقائياً:**
1. ✅ **يكشف التوزيعة** ومدير الحزم المناسب
2. ✅ **يحدث النظام** ويثبت الأدوات الأساسية (git, curl, traceroute, ...)
3. ✅ يثبّت **أدوات البناء** (python3, make, g++)
4. ✅ يثبّت **Node.js 20 LTS** (عبر NodeSource)
4. ✅ يثبّت **PM2** عالمياً
5. ✅ يثبّت **sqlite3 CLI**
5. ✅ ينشئ `.env` + يولّد `SESSION_SECRET` عشوائي + **مفاتيح VAPID تلقائياً**
6. ✅ `npm install` + بناء `better-sqlite3` للنظام المستهدف
6. ✅ تهيئة قاعدة البيانات + إنشاء مدير افتراضي
6. ✅ تشغيل التطبيق عبر PM2 + تفعيل البدء التلقائي (systemd/OpenRC)
7. ✅ يعرض روابط الوصول + تعليمات الموبايل

> 💡 **مهم**: السكريبت يعيد بناء `better-sqlite3` من المصدر على النظام المستهدف، مما يحل مشكلة عدم التوافق عند النقل من Windows إلى Linux.

---

## 🔧 **إعدادات متقدمة**

### 🔐 متغيرات البيئة الأساسية (`backend/.env`)
```env
# أساسي
PORT=4000
SESSION_SECRET=سلسلة_عشوائية_طويلة_جداً_مهمة_للأمان
DB_PATH=../database/monitoring.db

# المدير الافتراضي
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=كلمة_مرور_قوية_جداً

# جلسة
SESSION_MAX_AGE=43200000  # 12 ساعة

# تيليجرام (اختياري)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# واتساب (اختياري - عبر مزود)
WHATSAPP_API_URL=
WHATSAPP_API_TOKEN=
WHATSAPP_TO_NUMBER=

# موبايل / Web Push
MOBILE_ENABLED=1
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
```

### 🔐 توليد مفاتيح VAPID يدوياً (إذا احتجت)
```bash
cd backend
node -e "
const crypto = require('crypto');
const privateKey = crypto.randomBytes(32);
const publicKey = crypto.createECDH('prime256v1').setPrivateKey(privateKey).getPublicKey('uncompressed');
function toBase64Url(buf) { return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }
console.log('PUBLIC=' + toBase64Url(Buffer.from(publicKey.slice(1))));
console.log('PRIVATE=' + toBase64Url(privateKey));
"
```

---

## 📁 **هيكل المشروع**

```
network-monitor/
├── backend/
│   ├── src/
│   │   ├── server.js         # نقطة البداية + Express + Static
│   │   ├── db.js             # اتصال better-sqlite3
│   │   ├── seedAdmin.js      # إنشاء المدير الافتراضي
│   │   ├── routes/           # مسارات API (auth, devices, locations, deviceTypes, notifications, tools, update)
│   │   ├── services/         # محرك المراقبة + الفاحصون + الإشعارات + إدارة الانقطاع
│   │   └── middleware/       # requireAuth
│   ├── package.json
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   └── public/
│       ├── index.html        # الصفحة العامة
│       ├── admin/            # login.html + dashboard.html
│       ├── css/style.css
│       └── js/               # public-dashboard, charts, admin-*
├── database/
│   └── schema.sql
├── ecosystem.config.js       # إعدادات PM2
├── PROGRESS.md               # سجل تقدم البناء
├── CHANGELOG.md              # سجل التغييرات
├── DEPLOY.md                 # دليل النشر المفصل
├── README.md                 # هذا الملف
├── deploy.sh                 # سكريبت النشر التلقائي
├── update.sh                 # سكريبت التحديث التلقائي
├── .github/workflows/ci-cd.yml  # GitHub Actions CI/CD
├── .github/dependabot.yml    # تحديثات تلقائية للتبعيات
├── docker-compose.yml
├── backend/Dockerfile
└── README.md
```

---

## 🔌 **مرجع API**

**Base URL**: `http://<host>:4000/api`

| المسار | الطريقة | الحماية | الوصف |
|--------|---------|---------|-------|
| `/health` | GET | لا | فحص صحة الخادم |
| `/auth/login` | POST | لا | تسجيل الدخول |
| `/auth/logout` | POST | 🔒 | تسجيل الخروج |
| `/auth/me` | GET | لا | الجلسة الحالية |
| `/devices` | GET | لا | قائمة كل الأجهزة |
| `/devices` | POST | 🔒 | إضافة جهاز |
| `/devices/:id` | PUT/DELETE | 🔒 | تعديل/حذف جهاز |
| `/devices/:id/history?range=24h\|7d\|30d` | GET | لا | سجل الحالة + Uptime |
| `/devices/export/excel` | GET | 🔒 | تصدير Excel |
| `/devices/import/excel` | POST | 🔒 | استيراد Excel |
| `/locations` | GET/POST/PUT/DELETE | الكتابة 🔒 | إدارة المواقع |
| `/device-types` | GET/POST/PUT/DELETE | الكتابة 🔒 | إدارة الأنواع |
| `/notifications/settings` | GET/PUT | 🔒 | إعدادات الإشعارات |
| `/notifications/register` | POST/DELETE | لا | تسجيل/إلغاء موبايل |
| `/notifications/vapid-public` | GET | لا | مفتاح VAPID العام |
| `/notifications/test` | POST | 🔒 | اختبار إشعار |
| `/notifications/logs` | GET | 🔒 | آخر 100 إشعار |
| `/tools/ping` | GET | لا | Ping مباشر (SSE) |
| `/tools/tracert` | GET | لا | Traceroute مباشر (SSE) |
| `/update/check` | POST | 🔒 | فحص التحديثات |
| `/update/perform` | POST | 🔒 | تنفيذ التحديث |
| `/update/history` | GET | لا | سجل الـ 20 commit الأخيرة |

---

## ✅ **اختبار سريع بعد التشغيل**

```bash
# 1. فحص الصحة
curl http://localhost:4000/api/health
# {"success":true,"data":"ok"}

# 2. افتح المتصفح
# http://localhost:4000/          # الصفحة العامة
# http://localhost:4000/admin/login.html  # تسجيل الدخول

# 3. سجل دخول: admin / admin123
# 4. اضغط تبويب "الأنواع" → أضف نوعاً (مثل "Router")
# 5. اضغط تبويب "المواقع" → أضف موقعاً
# 6. اضغط تبويب "الأجهزة" → أضف جهازاً
#    IP: 192.168.1.1، النوع: Router، البروتوكول: ping
# 6. انتظر 30 ثانية → سيظهر الجهاز بحالة "متصل" ✅

# 7. جرّب أدوات الشبكة
# http://localhost:4000/ → قسم "أدوات الشبكة" → Ping / Tracert
```

---

## 🛡️ **الأمان**

| الطبقة | الوصف |
|--------|--------|
| **كلمات المرور** | bcryptjs (10 rounds) |
| **SQL Injection** | Prepared Statements فقط |
| **Sessions** | express-session + سر عشوائي طويل |
| **XSS/CSRF** | Helmet + SameSite Cookies |
| **API Tokens** | مقنعة في الواجهة (آخر 4 خانات) |
| **VAPID Keys** | خاصة في `.env` فقط، عامة في API |
| **Mobile Registrations** | معطلة تلقائياً عند انتهاء الصلاحية (404/410 من FCM) |

---

## 🗺️ **خارطة الطريق**

| الميزة | الحالة | الأولوية |
|---------|--------|----------|
| تحديثات لحظية عبر WebSocket/SSE | 📋 مخطط | عالية |
| تقارير PDF/Excel قابلة للتصدير | 📋 مخطط | متوسطة |
| صلاحيات متعددة (Admin / Operator) | 📋 مخطط | عالية |
| دعم SNMP | 📋 مخطط | متوسطة |
| الانتقال إلى PostgreSQL | 📋 مخطط | عند النمو |
| مهلة هدوء (cooldown) للإشعارات | 📋 مخطط | متوسطة |

> انظر [`PROGRESS.md`](./PROGRESS.md) لتفاصيل ما تم تنفيذه وما تأجل.

---

## 📚 **ملفات التوثيق المرتبطة**

| الملف | الوصف |
|-------|---------|
| [`CHANGELOG.md`](./CHANGELOG.md) | سجل التغييرات الكامل |
| [`DEPLOY.md`](./DEPLOY.md) | دليل النشر المفصل (Nginx، HTTPS، Firewall، Backup) |
| [`PROGRESS.md`](./PROGRESS.md) | سجل تقدم البناء |
| [`RUN-ON-LINUX.md`](./RUN-ON-LINUX.md) | تشغيل على Linux بدون Docker |
| [`deploy.sh`](./deploy.sh) | سكريبت النشر التلقائي |
| [`update.sh`](./update.sh) | سكريبت التحديث التلقائي |
| [`ecosystem.config.js`](./ecosystem.config.js) | إعدادات PM2 |
| [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) | GitHub Actions CI/CD |
| [`.github/dependabot.yml`](.github/dependabot.yml) | تحديثات تلقائية للتبعيات |

---

## 🤝 **المساهمة**

1. Fork المشروع
2. أنشئ فرع: `git checkout -b feature/amazing-feature`
2. Commit: `git commit -m 'Add amazing feature'`
3. Push: `git push origin feature/amazing-feature`
4. افتح Pull Request

---

## 📄 **الترخيص**

هذا المشروع مرخص تحت رخصة **MIT** - راجع ملف [LICENSE](LICENSE) للتفاصيل.

---

## 🙏 **الشكر والتقدير**

- [Express.js](https://expressjs.com/) - إطار العمل
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - قاعدة بيانات سريعة
- [web-push](https://github.com/web-push-libs/web-push) - إشعارات Web Push
- [Chart.js](https://www.chartjs.org/) - الرسوم البيانية
- [PM2](https://pm2.keymetrics.io/) - إدارة العمليات

---

**⭐ إذا أعجبك المشروع، لا تنسَ إضافة نجمة على GitHub!**

[⬆️ العودة للأعلى](#-نظام-مراقبة-أجهزة-الشبكة-المحلية---network-monitor)