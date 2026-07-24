# سجل تقدم بناء مشروع "نظام مراقبة أجهزة الشبكة المحلية"

> **الغرض من هذا الملف:** توثيق كل خطوة تم تنفيذها، والخطوة الحالية الجارية، والخطوات المتبقية، بحيث يمكن **أي نموذج ذكاء اصطناعي آخر** أو مطور بشري متابعة بناء المشروع من النقطة التي توقفت عندها دون فقدان أي سياق.

---

## 📋 معلومات المشروع العامة

- **اسم المشروع:** نظام مراقبة أجهزة الشبكة المحلية (LAN Devices Monitoring System)
- **الإصدار:** 1.0
- **تاريخ بدء التنفيذ:** 2026-07-18
- **المجلد الجذر للمشروع:** `network-monitor/`

### حزمة التقنيات (Fixed Tech Stack — لا يجوز تغييرها)
| الطبقة | التقنية |
|---|---|
| اللغة | JavaScript (Node.js) — بدون TypeScript |
| Backend | Express.js 4.x |
| قاعدة البيانات | SQLite عبر `better-sqlite3` (ملف `database/monitoring.db`) |
| Frontend | HTML + CSS + Vanilla JavaScript (بدون React/Vue — بدون build step) |
| الرسوم البيانية | Chart.js عبر CDN |
| الجدولة | `node-cron` |
| فحص الشبكة | `ping` (ICMP) + `net` (TCP Port) |
| HTTP خارجي | `axios` |
| المصادقة | `express-session` + `bcryptjs` |
| الإنتاج | `pm2` |

### المراجع الأساسية (في جذر `E:/New claude/`)
- `01-constitution.md` — القواعد الصارمة (الدستور) — **يجب إرفاقه كاملاً مع أي طلب لموديل آخر**
- `02-technical-plan.md` — الخطة التقنية وعقد الـ API
- `03-database-schema.sql` — مخطط قاعدة البيانات (SQL جاهز)
- `04-tasks.md` — تفصيل المهام (~40 مهمة T0.1 → T8.2)
- `متطلبات_نظام_مراقبة_الشبكة.md` — مستند المتطلبات (SRS)

---

## 📂 هيكل المشروع المنشأ فعلياً

```
network-monitor/
├── backend/
│   ├── src/
│   │   ├── server.js              ✅ (Express + session + static + monitoring)
│   │   ├── db.js                   ✅ (better-sqlite3 + foreign_keys)
│   │   ├── seedAdmin.js            ✅
│   │   ├── middleware/
│   │   │   └── requireAuth.js     ✅
│   │   ├── routes/
│   │   │   ├── auth.routes.js      ✅ (login/logout/me)
│   │   │   ├── devices.routes.js   ✅ (GET/POST/PUT/DELETE/history)
│   │   │   ├── locations.routes.js ✅
│   │   │   ├── deviceTypes.routes.js ✅
│   │   │   └── notifications.routes.js ✅
│   │   └── services/
│   │       ├── checkers.js        ✅ (ping + port)
│   │       ├── downtime.service.js ✅
│   │       ├── monitor.service.js ✅ (cron + notifications مدمجة)
│   │       └── notifier.service.js ✅ (telegram + whatsapp + logs)
│   ├── package.json               ✅
│   ├── .env.example               ✅
│   └── node_modules/              ✅ (مثبتة عبر --ignore-scripts)
├── frontend/
│   └── public/
│       ├── index.html             ✅
│       ├── admin/
│       │   ├── login.html          ✅
│       │   └── dashboard.html     ✅
│       ├── css/style.css          ✅
│       └── js/
│           ├── public-dashboard.js ✅
│           ├── charts.js          ✅
│           ├── admin-login.js     ✅
│           ├── admin-devices.js   ✅
│           ├── admin-locations-types.js ✅
│           ├── admin-notifications.js ✅
│           └── admin-tabs.js      ✅
├── database/
│   ├── schema.sql                 ✅ (منسوخ من SpecKit)
│   └── monitoring.db              ✅ (تم إنشاؤه فارغاً للتجربة)
├── ecosystem.config.js            ✅ (PM2)
├── README.md                      ✅
├── .gitignore                     ✅
└── PROGRESS.md                    ← هذا الملف
```

---

## 🚦 مفتاح الحالات

| الرمز | المعنى |
|---|---|
| ✅ | مكتملة ومتحقق منها |
| 🔄 | قيد التنفيذ حالياً |
| ⏳ | لم تبدأ بعد |
| ❌ | مكتملة لكن بها مشكلة تحتاج مراجعة |
| ⏭️ | مؤجلة لمرحلة لاحقة (خارج نطاق هذا الـ SpecKit) |

---

## 📊 جدول تتبع المهام

| المهمة | الوصف | الحالة | ملاحظات |
|---|---|---|---|
| **المرحلة 0: التهيئة** | | | |
| T0.0 | نسخ schema.sql إلى network-monitor/database/schema.sql | ✅ | |
| T0.1 | package.json + .env.example + server.js أساسي | ✅ | server.js النهائي يضم session + static + monitoring |
| T0.2 | الاتصال بقاعدة البيانات (db.js) | ✅ | تم التحقق من JOINs مع Python sqlite3 |
| T0.3 | سكريبت seedAdmin.js | ✅ | |
| **المرحلة 1: المصادقة** | | | |
| T1.1 | middleware requireAuth.js | ✅ | |
| T1.2 | routes auth.routes.js (login/logout/me) + session في server.js | ✅ | |
| **المرحلة 2: الأجهزة** | | | |
| T2.1 | GET /api/devices و GET /api/devices/:id | ✅ | JOIN مع device_types + locations كما في الخطة |
| T2.2 | GET /api/devices/:id/history | ✅ | تم اختبار Uptime % = 66.67 لـ 2/3 online |
| T2.3 | POST/PUT/DELETE للأجهزة (محمية) | ✅ | |
| **المرحلة 3: المواقع والأنواع** | | | |
| T3.1 | CRUD المواقع (locations.routes.js) | ✅ | |
| T3.2 | CRUD أنواع الأجهزة (deviceTypes.routes.js) | ✅ | |
| **المرحلة 4: محرك المراقبة** | | | |
| T4.1 | services/checkers.js (ping + port) | ✅ | |
| T4.2 | services/downtime.service.js | ✅ | يرجع duration_seconds (مطلوب في T5.2) |
| T4.3 | services/monitor.service.js (Scheduler) + ربط في server.js | ✅ | مدمجة مع الإشعارات من البداية |
| **المرحلة 5: الإشعارات** | | | |
| T5.1 | services/notifier.service.js | ✅ | Telegram + WhatsApp + logging |
| T5.2 | ربط الإشعارات بمحرك المراقبة | ✅ | مدمجة مباشرة في monitor.service.js |
| T5.3 | notifications.routes.js (settings + logs) | ✅ | توكنات مقنّعة (آخر 4 خانات) |
| **المرحلة 6: الواجهة العامة** | | | |
| T6.1 | index.html + css/style.css | ✅ | دعم RTL، وضع ليلي/نهاري، شبكة Grid متجاوبة |
| T6.2 | public-dashboard.js | ✅ | فلترة، polling 10s، ملخص شريط علوي |
| T6.3 | charts.js + modal | ✅ | Chart.js + إتلاف الرسم القديم |
| **المرحلة 7: لوحة التحكم** | | | |
| T7.1 | admin/login.html + admin-login.js | ✅ | |
| T7.2 | admin/dashboard.html | ✅ | تبويبات + نماذج لكل قسم |
| T7.3 | admin-devices.js | ✅ | + window.__reloadFormOptions لتحديث selects |
| T7.4 | admin-locations-types.js | ✅ | |
| T7.5 | admin-notifications.js | ✅ | تحميل تلقائي للسجل عند فتح التبويب |
| T7.6 | admin-tabs.js + ربط في dashboard.html | ✅ | قسم الأجهزة ظاهر افتراضياً |
| **المرحلة 8: التشغيل والنشر** | | | |
| T8.1 | README.md | ✅ | شامل بالعربية + خطوات تلجرام + PM2 |
| T8.2 | express.static + ecosystem.config.js (PM2) | ✅ | static مدمج في server.js منذ البداية |
| **تحقق تقني** | | | |
| V1 | node --check لكل ملفات الـ backend (13 ملف) | ✅ كلها OK | |
| V2 | node --check لكل ملفات الـ frontend JS (7 ملفات) | ✅ كلها OK | |
| V3 | تنفيذ schema.sql في SQLite | ✅ 8 جداول + 7 أنواع افتراضية | |
| V4 | اختبار JOINs و Uptime% | ✅ | |
| V5 | npm install | ⚠️ جزئي | الحزم الـ JS مُثبّتة عبر `--ignore-scripts`، لكن `better-sqlite3` لم يُبنَ (انظر القسم التالي) |
| V6 | اختبار HTTP حي (إقلاع server.js) | ❌ محجوب | بسبب V5 — انظر أدناه |
| **مهام مؤجلة** | | | |
| D1 | WebSocket بدل Polling | ⏭️ | خارج نطاق الإصدار الأول |
| D2 | تقارير PDF/Excel | ⏭️ | خارج نطاق الإصدار الأول |
| D3 | صلاحيات متعددة المستويات | ⏭️ | خارج نطاق الإصدار الأول |
| D4 | دعم SNMP | ⏭️ | خارج نطاق الإصدار الأول |
| D5 | استيراد/تصدير Excel | ⏭️ | خارج نطاق الإصدار الأول |
| D6 | PostgreSQL بدل SQLite | ⏭️ | خارج نطاق الإصدار الأول |

---

## ⚠️ الحالة الحالية — **تم الحل للنشر على Linux**

### ما تم إنجازه بالكامل
- **كل ملفات الكود** (Backend + Frontend + قاعدة البيانات + PM2 + README) تم إنشاؤها ومطابقتها لعقد الـ API وللدستور.
- **كل ملفات JavaScript تجتاز فحص الصياغة** `node --check` بنجاح (20 ملف).
- **مخطط قاعدة البيانات valid**: 8 جداول + 7 أنواع افتراضية تنشأ بنجاح في SQLite.
- **JOINs و Uptime% و history endpoint**: تم التحقق منها عملياً بـ Python sqlite3 على بيانات تجريبية.
- **npm install للحزم الـ JS البحتة** (~128 حزمة) نجح.
- **اختبار النشر على Ubuntu 26.04 (WSL)**: نجح بنجاح كامل ✅

### العائق على Windows (بيئة، وليس كود) — **مُحَلّ على Linux**
`better-sqlite3@11.10.0` **لا تملك binary مسبق البناء** (prebuilt binary) لـ **Node.js v26.5.0** على Windows، والمحاولة فشلت بأدوات node-gyp لأن ماكينة التطوير لا تحتوي Visual Studio Build Tools.

**الحل المطبق للنشر على Linux**: `deploy.sh` المحدث يعيد بناء `better-sqlite3` من المصدر تلقائياً على النظام المستهدف، مما يحل المشكلة نهائياً.

### ✅ حلول لأي مطور/موديل يتابع العمل

#### الحل A (للنشر على Linux) — استخدام deploy.sh المحدث ⭐
```bash
# على أي توزيعة Linux مدعومة (Ubuntu/Debian/RHEL/Arch/Alpine/openSUSE):
sudo bash deploy.sh install
# السكريبت يعيد بناء better-sqlite3 للنظام المستهدف تلقائياً
```

#### الحل B (للتطوير على Windows) — تنزيل Node.js 20 LTS
```bash
nvm install 20
nvm use 20
cd network-monitor/backend
rm -rf node_modules package-lock.json
npm install            # ✅ سينجح لأن better-sqlite3 يملك prebuilds لـ Node 20
```

#### الحل C — تثبيت Visual Studio Build Tools على ويندوز
```powershell
# تنزيل من https://visualstudio.microsoft.com/visual-cpp-build-tools/
# اختر: "Desktop development with C++"
cd network-monitor/backend
npm rebuild better-sqlite3
```

#### الحل D — تجربة أحدث better-sqlite3
```bash
cd network-monitor/backend
npm install better-sqlite3@latest --ignore-scripts
npx prebuild-install -r node
```

---

## 🔄 الخطوة الحالية (لمن يتابع)

> **آخر تحديث:** 2026-07-21 — اكتملت **كل المهام البرمجية** (T0 → T8) + **تحديث deploy.sh للنشر على جميع توزيعات Linux**. المشروع جاهز للتشغيل على Linux مباشرة.

**للنشر على Linux:**
```bash
sudo mkdir -p /opt && sudo chown $USER:$USER /opt
cd /opt
git clone https://github.com/kerolos-it2022/network-monitor.git network-monitor
cd network-monitor
sudo bash deploy.sh install
```

**للتطوير على Windows:**
1. طبّق أحد الحلول أعلاه (B موصى به: Node 20 LTS).
2. شغّل:
   ```bash
   cd network-monitor/backend
   cp .env.example .env
   # عدّل .env: SESSION_SECRET و DEFAULT_ADMIN_PASSWORD
   node src/seedAdmin.js
   node src/server.js
   ```
3. افتح `http://localhost:4000/` و جرب التصميم.

---

## 📝 ملاحظات قرارات اتُخذت أثناء التنفيذ

| القرار | السبب |
|---|---|
| دمج T8.2 (express.static) في server.js من البداية | تيسير الاختبار؛ لا حاجة لتعديل server.js لاحقاً |
| دمج T5.1+T5.2 في monitor.service.js | تجنب خطوة تعديل لاحقة وتقليل التعقيد |
| إضافة `downtime.service.closeDowntimeEvent` يرجع `duration_seconds` | مطلوب صراحة في تعليمات T5.2 |
| `last_response_time_ms > 500ms` على الواجهة العامة يعرض الحالة كـ "warning" (أصفر) | متطلب جزئي في مستند المتطلبات 5.1 ("تحذير / بطء") لم تغطّه المهام صراحة |
| استخدام `String.fromCharCode(38) + 'amp;'` بدل `&` في دالة `escapeHtml` | لأن محرر الملفات يقوم بإلغاء TEntity؛ تجنّب التل beween الكتابة والقراءة |
| `window.__reloadFormOptions` hook في admin-devices.js | حتى عند إضافة موقع/نوع جديد تُحدَّث قوائم الاختيار في نموذج الجهاز تلقائياً |
| إضافة حد اقتران اسم `(req,res)=>{}` في notifier | التحققات مثبتة، لا يلقى استثناء غير متوقع عند فشل الإرسال |
| استخدام `*.replace(/&/g, '&')` خاطئ في `escapeHtml` الأولى قبل التصحيح | تم اكتشافه وتصحيحه — الآن يستخدم `String.fromCharCode` |

---

## 🧪 كيف يتحقق أي موديل يتابع من جودة عمله

1. **فحص صياغة**: `node --check <file.js>` — يجب أن يكون OK لكل ملف.
2. **فحص قاعدة البيانات**:
   ```bash
   python -c "import sqlite3; c=sqlite3.connect('network-monitor/database/monitoring.db'); print([r[0] for r in c.execute('SELECT name FROM sqlite_master WHERE type=\"table\"')])"
   ```
   يجب أن يرجع 8 جداول.
3. **فحص HTTP حي** (بعد حل `better-sqlite3`):
   ```bash
   curl http://localhost:4000/api/health                 # { "success":true, "data":"ok" }
   curl http://localhost:4000/api/devices                 # قائمة (قد تكون فارغة)
   curl -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"ChangeMe123!"}'
   ```
4. **对照 المعايير**: راجع `04-tasks.md` و"معايير القبول" تحت كل مهمة — كلها منفّذة ما عدا الـ runtime test الذي يحتاج `better-sqlite3`.

---

## 🧾 سجل التغييرات (Changelog)

- **2026-07-18:** ✅ تم إنشاء **كامل بنية المشروع** وكل ملفات الكود (Backend + Frontend + قاعدة البيانات + PM2 + README + .gitignore).
- **2026-07-18:** ✅ كل ملفات JS تمر بفحص `node --check` (20 ملف OK).
- **2026-07-18:** ✅ تم التحقق من مخطط قاعدة البيانات وJOINs وUptime% بـ Python.
- **2026-07-18:** ⚠️ تم تثبيت ~128 حزمة JS عبر `--ignore-scripts`، لكن `better-sqlite3` يحتاج Visual Studio Build Tools أو Node 20 LTS على Windows (مشكلة بيئة وليست مشكلة كود).
- **2026-07-18:** ❌ HTTP smoke test حي محجوب بسبب العائق أعلاه — ويحتاج أحد الحلول في قسم "الحالة الحالية" قبل المتابعة.
- **2026-07-21:** ✅ **تحديث deploy.sh بالكامل** للعمل على جميع توزيعات Linux (Ubuntu/Debian/RHEL/Arch/Alpine/openSUSE).
- **2026-07-21:** ✅ **إصلاح ecosystem.config.js** بمسار ديناميكي (`${PROJECT_DIR}/backend`).
- **2026-07-21:** ✅ **اختبار نشر كامل على Ubuntu 26.04 (WSL)** — نجح بنجاح كامل (APIs، الصفحات، PM2، الإشعارات).
- **2026-07-21:** ✅ **حل مشكلة better-sqlite3** بإعادة بنائه على النظام المستهدف تلقائياً عبر `npm install` في `deploy.sh`.
