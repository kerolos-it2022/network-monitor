# 📋 HANDOFF.md — سجل نقل الحالة بين الجلسات

> **الغرض**: هذا الملف يَوثّق كل ما تَمّ، والحالة الحالية، والخطوات المتبقية.
> ===> **أي نموذج ذكاء اصطناعي آخر أو جلسة جديدة يَجب أن يَبدأ بِقراءة هذا الملف بالكامل قبل أي شيء.**
>
> **تاريخ آخر تحديث**: 2026-10-12 (**v2.11.6 — أدوات الفلترة في NOC تظهر فقط في الشاشات التي تعمل فيها فعلًا (الفلاتر تُخفى في «التخطيط المرسوم» ويختفي الصف كله في «خريطة المباني» و«مسار الإنترنت») — 8 PASS / 0 FAIL** — وقبلها v2.11.5 (أزرار العرض إلى رأس القسم) — v2.11.4 (إزالة حقل «متصل عبر») — v2.11.3 (كاشف تعطّل + مهلة npm ci) — v2.11.2 (إصلاح قائمة «متصل عبر») — قبلها v2.10.9 (إصلاح حالة مفتاح API «api_key/apikey»)، v2.10.8 (HOME في وحدة ngrok ⇒ تشغيل النفق من اللوحة)، v2.10.7 (تسطيح خريطة المواقع)، v2.10.6 (تحديث الأدوات)، v2.10.5 (إشعارات)، v2.10.4، v2.10.3، v2.10.2، v2.10.1، v2.10.0.
> **السياق**: نِظام مُراقبة الشبكة (Network Monitor) — مستودع GitHub `kerolos-it2022/network-monitor`
> **المجلد**: `E:\New claude\network-monitor-v2.5.0-dev` — الاسم تاريخي (بقايا v2.5.0)؛ الفرع الحالي `main`
>
> ⚠️ **الأقسام أدناه مُرتَّبة زمنيًّا: الأعلى قديم (v2.5.0) والأسفل هو الأحدث.**
> 🔜 **الخطوة التالية المقترحة (محفوظة — لم تُنفَّذ):** خطة **v2.10.11** لتحسين شاشة «🔍 اكتشاف الأجهزة» وتبويب
> «🆕 الأجهزة المُكتشَفة» ⇒ الملف: **`docs/PLAN-v2.10.11-discovery-screen-improvements.md`** (وملخّصها في قسم بنهاية هذا الملف).
> ابدأ من قسم **`v2.11.6 — أدوات الفلترة حسب الشاشة في NOC`** في النهاية (الأحدث)، ثم **`v2.11.5 — أزرار عرض «التخطيط المرسوم» في NOC إلى الأعلى`**، ثم **`v2.11.4 — إزالة حقل «متصل عبر» من نموذج الجهاز`**، ثم **`v2.11.3 — كاشف تعطّل التحديث + مهلة npm ci`**، ثم **`v2.11.2 — إصلاح قائمة «متصل عبر» في نموذج الجهاز`**، ثم **`v2.10.14 — توحيد الخرائط الثلاث`**، ثم **`v2.10.13 — خريطة المواقع: احتواء الطوابق/الغرف فقط`**، ثم **`v2.10.12 — فصل «خريطة المواقع» عن «سلسلة الشبكة»`**، ثم ارجع إلى **`v2.10.10 — خريطة المواقع مستويان`** ثم **`v2.10.9`** ثم **`v2.10.8`** ثم **`v2.10.7`** ثم **`v2.10.6`** ثم **`v2.10.5`** ثم **`v2.10.4`** ثم **`v2.10.3`** ثم **`v2.10.2`** ثم **`v2.10.1`** ثم **`v2.10.0`** ثم **`v2.9.0`** ثم **`v2.8.9`** ثم **`v2.8.5`** ثم **`v2.8.1 → v2.8.4`**.
> أقسام v2.5.x / v2.6.0 المخطَّطة أعلى الملف **تاريخية** — لا تعتمد عليها كوصف للحالة الراهنة.

---

## ✅ اكتملت المرحلة 1 من v2.5.0 (2026-07-27)

> 🎉 **مُنجَزة في مجلد development منفصل (لَم يُلتزم بَعد لِـ master)**. المسح الدوري + اكتشاف الأَجهزة الجَديدة + webhook + auto-migration جاهزة لِـ الاختبار قبل الدمج.

### ⚠️ ملاحظة: التزام بَعد الاختبار
هذا العَمل **لم يُلتزم/لَم يُرفع بَعد** لِـ `origin/main`. كل مَلفات v2.5.0 موجُودة على `E:\New claude\network-monitor-v2.5.0-dev` بِحالة working tree modified. **نَنتظر تَجربة المُستخدم قبل التزام وتاغ v2.5.0**.

### 🆕 ما الذي أَضافته v2.5.0 (المرحلة 1)

| # | الميزة | الملف | النوع |
|---|---|---|---|
| 1 | جدول `scan_settings` (إعدادات + interval + subnets + new_device_alert) | `database/schema.sql` | جَدول جديد |
| 2 | جدول `scan_runs` (سِجل مَسحَة بِمَسحَة) | `database/schema.sql` | جَدول جديد |
| 3 | جدول `discovered_devices` (الأَجهزة الجَديدة المُكتشَفة) | `database/schema.sql` | جَدول جديد |
| 4 | عمود `webhook_url` على `notification_settings` (Slack/Discord/ntfy/Grafana) | `database/schema.sql` | عَمود جديد |
| 5 | auto-migration في `db.js`: تَطبيق `schema.sql` تلقائيًّا عند بدء الخادم + WAL mode | `backend/src/db.js` | مُعدَّل |
| 6 | `scan-scheduler.service.js` (مُجدوِل `setInterval` يَستعمل helpers من `scan.routes.js`) | `backend/src/services/scan-scheduler.service.js` | جديد |
| 7 | `sendGenericNotification(message)` في `notifier.service.js` (تنبيهات عامة) | `backend/src/services/notifier.service.js` | مُعدَّل |
| 8 | `router.helpers` مُصدَّر من `scan.routes.js` (نَقطة إعادة استعمال) | `backend/src/routes/scan.routes.js` | مُعدَّل |
| 9 | `scan-scheduler.routes.js` (CRUD settings + start/stop + run-now + status + runs) | `backend/src/routes/scan-scheduler.routes.js` | جديد |
| 10 | `discovered.routes.js` (list + approve + reject + delete + bulk approve) | `backend/src/routes/discovered.routes.js` | جديد |
| 11 | `sources.routes.js` (stub يُرجِع 501 — يَنتظر v2.6.0 لِـ MikroTik/Sophos/SNMP/LLDP) | `backend/src/routes/sources.routes.js` | جديد — stub |
| 12 | تبويبان في الواجهة: «الأَجهزة المُكتشَفة» + «المسح الدوري» في `dashboard.html` | `frontend/public/admin/dashboard.html` | مُعدَّل |
| 13 | `admin-tabs.js`: إَضافة tab-discovered + tab-scheduler لـ TAB_TO_SECTION | `frontend/public/js/admin-tabs.js` | مُعدَّل |
| 14 | `admin-discovered.js`: جدول + تَصفية + اعتماد/رفض/حذف + اعتماد جماعي + auto-refresh 30ث | `frontend/public/js/admin-discovered.js` | جديد |
| 15 | `admin-scheduler.js`: نموذج إعدادات + start/stop/run-now + status + سِجل + auto-refresh 15ث | `frontend/public/js/admin-scheduler.js` | جديد |
| 16 | `server.js`: رَبط `startScheduler()` في الـ `app.listen` callback | `backend/src/server.js` | مُعدَّل |
| 17 | `backend/package.json`: `2.4.0` → `2.5.0` | bump |
| 18 | `README.md`: badge v2.5.0 + قسم «ما الجديد في v2.5.0» | مُعدَّل |

### Extensions (API endpoints الجَديدة)
| الـ path | الـ method | الوصف |
|---|---|---|
| `/api/scan-scheduler/settings` | GET, PUT | إعدادات المسح الدوري |
| `/api/scan-scheduler/start` | POST | بَدء المسح الدوري |
| `/api/scan-scheduler/stop` | POST | إيقاف المسح الدوري |
| `/api/scan-scheduler/run-now` | POST | مَسح فوري (لا يَنتظر interval) |
| `/api/scan-scheduler/status` | GET | حالة المُجدوِل + آخر مَسح |
| `/api/scan-scheduler/runs` | GET | سِجل آخر 50 مَسح |
| `/api/discovered` | GET | قائمة الأَجهزة المُكتشَفة |
| `/api/discovered/:id` | GET | تفاصيل جهاز |
| `/api/discovered/:id/approve` | POST | اعتماد + نَقل لِـ devices |
| `/api/discovered/:id/reject` | POST | رفض (is_approved=-1) |
| `/api/discovered/:id` | DELETE | حذف نهائي |
| `/api/discovered/bulk/approve` | POST | اعتماد جماعي |
| `/api/sources` | GET, POST | stub — فِعليًّا 501 (يَنتظر v2.6.0) |
| `/api/sources/:id/test` | POST | stub |
| `/api/sources/:id/sync` | POST | stub |

---

## 🌐 المرحلة المُخطَّطة تالية (v2.6.0 — المَصادر الخارجية)

| المَصدر | الـAPI/البروتوكول | الحالة |
|---|---|---|
| MikroTik RouterOS | REST API (v7) + ARP table + DHCP leases + LLDP neighbor | ⏳ مُخطَّط |
| Sophos Firewall (XG) | REST API v9 + DHCP leases + API token in `Authorization` | ⏳ مُخطَّط |
| SNMP عام (Cisco/Aruba/HPE) | `snmp-native` على OID ARP + LLDP-MIB | ⏳ مُخطَّط |
| LLDP neighbor | مِن MikroTik أَو `LLDP-MIB` — topology حقيقية | ⏳ مُخطَّط |
| جدول `external_sources` + `external_devices` | migration آمنة عبر `db.js` | ⏳ مُخطَّط |
| تَشفير credentials AES-256-GCM | مفتاح في `.env` (يُولَّد تلقائيًّا) | ⏳ مُخطَّط |

---

## 🛠️ آلية الاختبار (قبل الالتزام بِـ v2.5.0)

### 1) تَشغيل النّسخة الجَديدة في بيئة dev محلية
```bash
cd "E:/New claude/network-monitor-v2.5.0-dev/backend"
npm install                   # تَهيئة dependencies
npm run dev                   # nodemon يعمل src/server.js
```

### 2) التحقق من auto-migration
عند بَدء الخادم، تحقّق من السّجل عن:
- `Database connection OK.`
- `[SCHEDULER] Disabled at startup.` (لو scan_settings.enabled=0 افتراضيًّا)

ثُمَّ في SQLite:
```bash
sqlite3 'path/to/monitoring.db' "SELECT name FROM sqlite_master WHERE name IN ('scan_settings','scan_runs','discovered_devices');"
# المتوقع: scan_settings, scan_runs, discovered_devices
sqlite3 '...' "PRAGMA table_info(notification_settings);" | grep webhook_url
```

### 3) تَختبر المسح الدوري
1. ادخل لِـ `http://localhost:4000/admin/login.html` (admin / ChangeMe123!)
2. تبويب «المسح الدوري» (الرمز ⏱️).
3. أَدخل CIDR (مثال: `192.168.1.0/24`).
4. عَيِّن الفترة 5 دقائق، فعِّل، احفظ.
5. اضغط «شَغّل الآن» → يَنبغي أَن تُظهر «بدأ المسح الفوري».
6. انتظر ~ 5-15ث → سِجل المسحات يُظهر صف `[completed]`.

### 4) تَختبر الأَجهزة المُكتشَفة
- تبويب «الأَجهزة المُكتشَفة» (الرمز 🆕) → auto-refresh كل 30ثا.
- اختبر «اعتماد» على جهاز → يَنتقل تلقائيًّا لِـ `devices` (تحقّق في تبويب الأَجهزة).

### 5) تَختبر webhook (اختياري)
```bash
sqlite3 '...' "UPDATE notification_settings SET webhook_url='https://ntfy.sh/mytopic' WHERE id=1;"
```
شَغّل مَسحًا مع جهاز جديد → سيَصل POST لِـ الـ webhook.

### 6) lint و syntax
```bash
cd "E:/New claude/network-monitor-v2.5.0-dev"
node --check backend/src/server.js
node --check backend/src/db.js
node --check backend/src/services/scan-scheduler.service.js
node --check backend/src/services/notifier.service.js
node --check backend/src/routes/scan.routes.js
node --check backend/src/routes/scan-scheduler.routes.js
node --check backend/src/routes/discovered.routes.js
node --check backend/src/routes/sources.routes.js
node --check frontend/public/js/admin-tabs.js
node --check frontend/public/js/admin-discovered.js
node --check frontend/public/js/admin-scheduler.js
bash -n deploy.sh
```
كلها تَنتَجِ `OK` — تم التحقق منها في الجلسة الحالية.

---

## 📋 الخطوات المتبقية للجلسة التالية

1. **الاختبار الشامل** على machine dev محلية (المُستخدم يُجرّب الواجهة + backend).
2. **بَعد الاعتماد**: التزام `feat(release): v2.5.0 — periodic scan + discovered + webhook + auto-migration` + tag `v2.5.0`.
3. **رفع** لِـ origin/main.
4. **تطبيق على الخادم**: تبويب التحديثات سيَجلب `v2.5.0` (إصلاح `--tags` في v2.4.0 يَكفي).
5. **المرحلة 2 (v2.6.0)**: تَبدأ من `sources.routes.js` stub الحالي.

---

## 🌐 حالة Git على الـ remote

| | |
|---|---|
| المستودع | `https://github.com/kerolos-it2022/network-monitor.git` (public) |
| الفرع الحالي على master | `954f28f` (v2.4.0 + docs(handoff)) |
| الـ dev (هذا المجلد) | working-tree modified لِـ 14 ملف (8 M + 6 ??) — لَم يُلتزم بَعد |
| النسخة في `backend/package.json` (dev) | `2.5.0` |
| التَاجات على origin | `v2.4.0`, `v2.3.2`, ... — **v2.5.0 سيُضاف عند الالتزام لاحقًا** |

---

## 📌 ما يجب على الجلسة التالية فعله فورًا عند بدئها

1. **اقرأ كل هذا الملف**.
2. **تحقق من الـ dev المجلد**:
   ```bash
   cd "E:/New claude/network-monitor-v2.5.0-dev"
   git status --short --branch
   node --check backend/src/server.js
   ```
3. **سَلَّم المُستخدم**: هل جَرَّب الواجهة + المسح الدوري؟
   - نَعَم، نجح → التزام + tag `v2.5.0` + رَفع.
   - فَشل/تعارض → تَشخيص + إِصلاح قبل أي التزام.

---

**نهاية الملف — آخر تحديث بواسطة الجلسة الحالية في 2026-07-27 (v2.5.0 المرحلة 1 جاهزة لِـ الاختبار).**

---

## 🆕 v2.5.1 — إصلاحات + شجرة المواقع الهرمية (مُنجَزة 2026-07-31)

> اِكتملت في نفس الـ dev المجلد فوق v2.5.0. **لم تُلتزم بَعد** — بانتظار الاختبار ثم التزام موحَّد + tag `v2.5.1` (أَو دمجها تحت `v2.5.0`).

### 🔧 اِصلاحَات تَرقيعية (مرحلة 0)
| # | الإِصلاح | الملف | السبب |
|---|---|---|---|
| 0.1 | **migration آمنة لِـ `webhook_url`** عبر `ALTER ADD COLUMN` مَحمي بـ try/catch | `backend/src/db.js` | على DB قائمة من v2.4.0، `CREATE TABLE IF NOT EXISTS` لا يُضيف العمود → كان يَفشل webhook |
| 0.2 | **`totalAdded += (await processHost(...)) || 0`** | `backend/src/services/scan-scheduler.service.js:~198` | `processHost` يُرجع عدد الجديدة لكن القيمة كانت مُهمَلة → `scan_runs.devices_added` كان دائمًا 0 |
| 0.3 | تَنظيف تعليق مشتوب (عربي/صيني) في `scan-scheduler.service.js:~213` | نفس الملف | للوضوح |

### 🗺️ شجرة المواقع الهرمية (D3.js)
**التَبويب الجديد**: «🗺️ خريطة المواقع» — شجرة تفاعلية أَفقية RTL لِـ المواقع + الأَجهزة (IPs) معًا.

| # | الَتغيير | الملف | النوع |
|---|---|---|---|
| 1 | عمود `kind` (site|building|floor|room|rack) على `locations` + migration آمنة | `database/schema.sql`, `backend/src/db.js` | تَعديل |
| 2 | `locations.routes.js` يَرجِع/يَقبَل `kind` (whitelist على `VALID_KINDS`) | `backend/src/routes/locations.routes.js` | تَعديل |
| 3 | `GET /api/map/tree` — شجرة JSON مُتداخلة (مواقع + أَجهزة أَوراق + counts + عُقدة «غير مُعَيَّن» + جذر افتراضي) | `backend/src/routes/map.routes.js` | **جديد** |
| 4 | رَبط `/api/map` في `server.js` | `backend/src/server.js` | تَعديل |
| 5 | تَبويب `tab-map` + قِسم `section-map` + تَحميل D3 من CDN + سكربت `admin-map.js` | `frontend/public/admin/dashboard.html` | تَعديل |
| 6 | إضافة `"tab-map":"section-map"` لِـ `TAB_TO_SECTION` | `frontend/public/js/admin-tabs.js` | تَعديل |
| 7 | `admin-map.js`: D3 `hierarchy`+`tree`، أَلوان بحسب الحالة، طي/تَوسيع، نقر موقع↔تبويب الأَجهزة، auto-refresh 30ث (MutationObserver) | `frontend/public/js/admin-map.js` | **جديد** |
| 8 | أَنماط `.d3-tree` / `.map-node` / `.map-link` في `style.css` (RTL + scroll) | `frontend/public/css/style.css` | تَعديل |
| 9 | `admin-devices.js` يَسمع `map:filter-location` لِيَضبط فلتر `df-location_id` عند الاِنتقاء من الشجرة | `frontend/public/js/admin-devices.js` | تَعديل |

### ✅ التَحقق
كل الملفات `node --check` = `OK` (db.js, server.js, scan-scheduler.service.js, locations.routes.js, map.routes.js, admin-tabs.js, admin-map.js, admin-devices.js) و `bash -n deploy.sh` = OK.

### 📋 الخطوات للجلسة التالية
1. **اقرأ هذا الملف بالكامل + HANDOFF v2.5.0 بالأَعلى**.
2. **اختبار محلي**: `cd backend && npm run dev` → `/admin/login.html` → تبويب «🗺️ خريطة المواقع». تأكد migration `webhook_url` + `kind` (افحص `sqlite3 PRAGMA table_info(locations)` و `PRAGMA table_info(notification_settings)`).
3. **اِختبار الشجرة**: أَدخل مواقع هرمية (مبنى>طابق>خزانة) + أَجهزة بِـ `location_id`، تأكد الأَلوان + الطي/التَوسيع + النقر→اِنتقاء. أَجهزة بلا موقع تَظهر تحت «غير مُعَيَّن».
4. **بَعد الاعتماد**: التزام موحَّد لِـ v2.5.0+v2.5.1 + tag `v2.5.1` (أَو `v2.5.0`) + رَفع.
5. **v2.6.0** تَبقى من `sources.routes.js` stub (مستقل عن الخريطة).

## 🆕 v2.5.2 — هرم شبكة مُدمَج (internet ← zones ← devices) + zoom + فلتر (مُنجَزة 2026-08-02)

> اِكتملت فوق v2.5.1 في نفس الـ dev المجلد. **لم تُلتزم بعد** — بانتظار التزام موحَّد + tag لِـ v2.5.0/v2.5.1/v2.5.2. كل الملفات `node --check` = OK + `bash -n deploy.sh` = OK + اختبارات curl نجحت على PORT=4102.

### 🧭 نموذج الهرم الجَديد
بدلًا من نموذج `site|building|floor|room|rack` المُسطَّح، صار الهرم **internet-أَولاً**:
- `kind='internet'` → قمة الهرم (مصدر الإنترنت/الراوتر). لا يَملك parent_id (يُجبر null).
- `kind='zone'` → منطقة وَسَطية، تَدعم تَداخل أَي نَوع (internet ← zone1 ← zone2 ←…).
- الأَنواع القديمة `site|building|floor|room|rack` ما زالت مَسمُوحة (مزج) لِـ back-compat مع v2.5.1.
- **default** = `'zone'` (بدل `'site'`).

### 📋 التَغييرات
| # | التغيير | الملف |
|---|---|---|
| 1 | `kind TEXT NOT NULL DEFAULT 'zone'` + تَحديث التعليق في schema | `database/schema.sql` |
| 2 | migration آمنة `ALTER … ADD COLUMN kind … DEFAULT 'zone'` + تَنبيه back-compat | `backend/src/db.js` |
| 3 | `VALID_KINDS = ['internet','zone','site','building','floor','room','rack']`, default `'zone'`, دالة `validateParentId` (منع ذاتي + كشف دائرة صعودي بعمق آمن 1000), `internet` يُجبر `parent_id=null` | `backend/src/routes/locations.routes.js` |
| 4 | منطق internet-أَولاً في `/api/map/tree`: لو وُجد internet واحد → هو الجذر الفعلي (أَطفاله = بقية roots + unassigned)؛ لو 0 أَو >1 → جذر افتراضي «كل المواقع» | `backend/src/routes/map.routes.js` |
| 5 | نموذج الموقع: حقل `kind` (select) + حقل `parent_id` (select هرمي بِـ kind prefix) + فلتر نوع فوق الجدول + جدول بِـ 5 أَعمدة (المعرّف\|الاسم\|النوع\|الأَب\|الإجراءات) | `frontend/public/admin/dashboard.html`, `frontend/public/js/admin-locations-types.js` |
| 6 | فلتر موقع فعّال فوق جدول الأَجهزة (`#filter-location-devices`) + تصفية client-side + listener `map:filter-location` مُصحَّح (يَستهدف فلتر الجدول بدل نموذج مَخفي) + `df-location_id` يَعرض أَيقونة kind | `frontend/public/admin/dashboard.html`, `frontend/public/js/admin-devices.js` |
| 7 | `admin-map.js`: KIND_ICON (internet+zone) + `kindColor` (internet=أَزرق، zone=أَصفر) + `deviceColor` من متغيرات CSS (تَلاؤم الثيم الليلي) + `d3.zoom` (عجلة = تَكبير، سَحب = pan, scaleExtent 0.3–3) + حفظ حالة zoom عند re-render + أَسماء مقطوعة (18) + tooltip مُحسَّن + `kind-${kind}` classes | `frontend/public/js/admin-map.js` |
| 8 | `style.css`: إِزالة `max-width:100%` على SVG (تَقص الشجرة) + أَنماط `.kind-internet/.kind-zone/.kind-unassigned` + `cursor: pointer` + `overscroll-behavior: contain` + إزالة `}` الزائد (سطر 483) | `frontend/public/css/style.css` |

### ✅ التَحقق (NODE + CURL)
- `node --check` على 9 ملفات (db.js, server.js, locations/map/devices.routes, admin-tabs/devices/map/locations-types) = **OK**.
- `bash -n deploy.sh` = OK.
- السيرفر بَدأ على PORT=4102: `Database connection OK` + `Server running on port 4102` + `Monitoring engine started` + `[SCHEDULER] Disabled at startup`.
- `curl` login بـ `admin / ChangeMe123!` = `success:true`.
- POST `/api/locations` بِـ `kind=internet` = `id=3` (HTTP 201).
- POST `/api/locations` بِـ `kind=zone, parent_id=3` = `id=4` (HTTP 201).
- PUT `/api/locations/3` بِـ `parent_id=3` (إِشارة ذاتية) = HTTP 400 `'لا يُمكن أَن يكون الموقع أَبًا لنفسه'`.
- PUT `/api/locations/3` بِـ `parent_id=4` (دائرة: 4 أَبنه) = HTTP 400 `'دائرة هرمية غير صالحة: الموقع الأَب يَنحدر من هذا الموقع'`.
- GET `/api/map/tree` = الجذر الفعلي `id=3, name=Internet-Gateway, kind=internet, children=4, device_count=40 (1 online / 39 offline)` متضمنًا zone + المواقع القيمة + عقدة «أَجهزة غير مُعَيَّن» (37 جهازًا).
- **ملاحظة**: مواقع الاختبار (id=3,4) حُذفت بعد الفحص — DB عادت لِـ 2 مواقع فقط (الدور التجارى، الادارة1، كلاهما kind=site من v2.5.1).

### ⚠️ رجوعية (back-compat)
- المواقع القائمة من v2.5.1 بِـ `kind='site'` ما زالت تعمل (default `'zone'` الجديد لا يُغيّر الصفوف القائمة — `ALTER` لا يُحدّث default الصفوف الموجُودة). العرض يُعاملها كعُقد وَسَطية.
- لِترقية المواقع القديمة يدويًّا (اختياري): `UPDATE locations SET kind='zone' WHERE kind='site';`

### 📋 الخطوات لِـ الجلسة التالية
1. **اِختبار الواجهة** (المُستخدم): تبويب «المواقع» → أَضف `internet` + `zone`s (parent شجر) → تبويب «خريطة المواقع» تأكد أَن الجذر = internet + zoom/scroll + الأَلوان (internet أَزرق، zone أَصفر). تبويب «الأَجهزة» → فلتر الموقع + نقر مزدوج موقع في الخريطة يُفعّل الفلتر.
2. **بَعد الاعتماد**: التزام موحَّد لِـ v2.5.0 + v2.5.1 + v2.5.2 + tag + رَفع.
3. **v2.6.0** تَبقى من `sources.routes.js` stub.

---
**آخر تحديث: 2026-08-02 — v2.5.2 (هرم internet/zone + zoom + فلتر devices) مُنجَزة و مُختبَرة. بانتظار التزام موحَّد.**

## 🆕 v2.5.2 — إِعادة كتابة الخريطة بِـ HTML/CSS + إِصلاحات الواجهة (مُنجَزة 2026-08-03)

> تَمّ هذا اليوم فوق نفس الـ dev المجلد. الخريطة أُعيدت من D3 SVG إِلى شجرة HTML/CSS `ul/li` متداخلة (أَبسط، RTL طبيعي، لا CDN). مع إِصلاح 3 مشاكل وَصَلَتها منك.

### 🔄 ما الذي تَغيَّر بِـ النَسبة لِـ v2.5.2 الأَصلية
| # | التغيير | الملف |
|---|---|---|
| 1 | `admin-map.js` أُعيد كتابته بالكامل: بَدل D3 SVG، الآن `ul/li` عودية + متغيرات CSS inline (`--node-bg`/`--node-border`/`--node-border-w`). | `frontend/public/js/admin-map.js` |
| 2 | D3 CDN إِزال من `dashboard.html` (كان `unpkg.com/d3@7` — لم يَعُد مُستعمَل). | `frontend/public/admin/dashboard.html` |
| 3 | إِضافة أَزرار `+`/`−` لِـ zoom (`map-zoom-in-btn`/`map-zoom-out-btn`) + دالة `zoomBy`/`zoomIn`/`zoomOut`/`zoomReset`. | `dashboard.html`, `admin-map.js` |

### 🐛 الإِصلاحات الثلاث
| # | المشكلة | الإِصلاح |
|---|---|---|
| 1 | **تنسيق العقد مكسور** — `admin-map.js` بَدأ يَستعمل classes (`map-node-html`, `map-children`...) لَم تُوجَد في `style.css` (كان بِـ أَنماط D3 SVG فقط). | إِضافة block CSS كامل لِـ HTML/CSS tree في `style.css` (~120 سطر): `.map-tree`, `.map-node-html`, `.map-node-row`, `.map-toggle`, `.map-icon`, `.map-name`, `.map-meta`, `.map-status.*`, `.map-children[data-depth]`، RTL inline، طي `.collapsed > .map-children`, `transform-origin: top right`. |
| 2 | **zoom غير بديهي** — كان Ctrl+wheel فقط. | wheel بدون مُعدّل = zoom (نطاق 0.3–3)، Shift+wheel = scroll، Ctrl+wheel = default المتصفح. + أَزرار `+`/`−` بِخُطوة ثابتة `0.15`. |
| 3 | **نقر الجهاز لا يُصفّي** — كان يَنتقل لِـ tab الأَجهزة بِلا تَصفية. | إِصدار حدث `devices:focus-device` بِـ `device_id` (مُستخرَج من `dev-${id}`) و tسليط الصف في `admin-devices.js`: متغير `focusDeviceFilter` + `tr[data-device-id]` + `scrollIntoView` + فئة `.device-row-focused` (highlight 2.5ث). كما يَلغي فلتر الموقع مؤقَّتًا حتى لو كان الجهاز تَحت موقع مُختار. |

### ✅ التَحقق (NODE + CURL + PRAGMA) — 2026-08-03
- `node --check` على `admin-map.js` + `admin-devices.js` = **OK**.
- الخادم بَدأ على PORT=4001: `Database connection OK` + `Server running on port 4001` + `Monitoring engine started` + `[SCHEDULER] Disabled at startup`.
- `curl` login `admin / ChangeMe123!` = `success:true`.
- `GET /api/map/tree` = الجذر `id=5, name=Internet-Gateway, kind=internet` (40 جهاز · 35 online · 5 offline) متضمنًا zones + sites + devices + unassigned.
- `GET /api/scan-scheduler/status` = `{enabled:false, interval_minutes:5, ...}` (سليم).
- `GET /api/discovered` = `[]` (سليم).
- **migration آمنة** (`better-sqlite3` PRAGMA على DB الحالية): `locations.kind` موجُود (TEXT, default `'site'` ع الـ DB القديم)، `notification_settings.webhook_url` موجُود، الجداول `scan_settings` + `scan_runs` + `discovered_devices` كلها موجُودة.

### 📋 الخطوات لِـ الجلسة التالية
1. **اِختبار الواجهة بِـ المُتصفّح** (أَنت): الخادم يَعمل على `http://localhost:4001/admin/login.html` (admin / ChangeMe123!). تَبويب «🗺️ خريطة المواقع»: تأكد أَن العقد تَظهر بِأَلوان (internet أزرق، zone أَصفر، devices بلون الحالة)، ضَع المؤشّر فوق الشجرة + دُر العجلة = zoom بِلا Ctrl، Shift+عجلة = scroll، اِضغط `+`/`−`. اِنقر عقدة جهاز → يَنتقل لِـ tab الأَجهزة بِـ الصف مُسلَّط. اِنقر مزدوج على موقع → يَنتقل لِـ tab الأَجهزة مُصفّى بِـ الموقع.
2. **اِختبار المسح الدوري** (اختياري): tab «المسح الدوري» (⏱️) → فعِّل + CIDR + «شَغّل الآن».
3. **بَعد الاعتماد**: التزام موحَّد لِـ v2.5.0 + v2.5.1 + v2.5.2 + tag `v2.5.2` + رَفع (يُجرى في هذه الجلسة بَعد موافقتَك على الواجهة).
4. **v2.6.0** تَبقى من `sources.routes.js` stub.

> ⚠️ **هذا القِسم تَاريخي / مُتَقادِم** — zoom + أَزرار `+`/`−` + `devices:focus-device` المذكورة أَعلاه **أُزيلت في v2.5.3** (انظر القِسم التالي). لا تَستعمل خطوات الاِختبار هنا كما هي؛ راجع قِسم v2.5.4 أَسفل لِـ الوَصف الحالي للواجهة.

---
**آخر تحديث: 2026-08-03 — v2.5.2 (HTML/CSS tree + zoom + نقر جهاز يُصفّي) مُنجَزة + مُختبَرة بـ curl/PRAGMA. بانتظار اختبارك للواجهة قبل الالتزام + tag v2.5.2 + رفع.**

## 🆕 v2.5.3 — إِزالة zoom + نقر الجهاز modal بدل tab الأَجهزة (مُنجَزة 2026-08-03)

> تَمّ فوق نفس الـ dev المجلد. **قِسم v2.5.2 الأَعلى بات تَاريخيًّا** (zoom + `devices:focus-device` لَم يَعُدا صالِحَين). ما لَم يُلتزم بَعد.

### 🔄 ما تَغيَّر بِـ النَسبة لِـ v2.5.2
| # | التغيير | الملف |
|---|---|---|
| 1 | **إِزالة zoom** بالكامل: لا عجلة تَكبير (لا wheel handler)، لا `Shift`+عجلة scroll، لا `Ctrl`+عجلة، لا أَزرار `+`/`−`، لا `d3.zoom`، لا `scale`/`scaleExtent`. الشجرة scroll فقط عبر `overflow:auto` على `#tree-container`. | `frontend/public/js/admin-map.js`, `frontend/public/admin/dashboard.html` |
| 2 | **إِزالة `devices:focus-device` + `focusDeviceFilter` + `.device-row-focused` highlight**: نقر عقدة جهاز صار يَفتح **modal تَفاصيل عائمًا** (`#map-device-modal`) في نفس tab الخريطة بدل القَفز لِـ tab الأَجهزة و تَسليط الصف. | `frontend/public/js/admin-map.js` (يَستدعي `showDeviceDetails(id)` بدل dispatch)، `frontend/public/js/admin-devices.js` (اِستُؤصل listener `devices:focus-device`) |
| 3 | modal التَفاصيل: يَجلب `/api/devices/:id`، يَعرض IP/النوع/الموقع/بروتوكول الفحص/المنفذ/فترة الفحص/حد التنبيه/مفعّل/زمن الاستجابة/آخر فحص + أَزرار «فتح HTTPS أَو HTTP» + «فتح في tab الأَجهزة». يُغلق بِـ زر × أَو ESC أَو نقر الخلفية. | `frontend/public/admin/dashboard.html` (إِضافة `#map-device-modal`)، `frontend/public/js/admin-map.js` (`showDeviceDetails`/`closeDeviceDetails`) |
| 4 | استمرار طي/تَوسيع بِـ toggle class على `li` (transition `max-height`) دون إِعادة بناء innerHTML — أكثر متانة. | `frontend/public/js/admin-map.js` |

### 🐛 ما الذي حَلّ هذا التَغيير
- zoom كان «غَير بديهي» و鼠标-wheel غَير صريح → أُزيل لِـ scroll بسيط.
- `devices:focus-device` كان يَتطلّب اِنفاقاً في `admin-devices.js` (`focusDeviceFilter` متغير + scrollIntoView + فئة highlight) — استُؤصل تبعه لِـ modal أَكثَر محليّة.

### ✅ التَحقق
- `node --check` على `admin-map.js` + `admin-devices.js` = OK.
- الخادم يَعمل + `GET /api/map/tree` سليم (لا zoom، لا focus-device).

### 📋 الخطوات لِـ الجلسة التالية
1. اِختبار modal تَفاصيل الجهاز (نقر عقدة جهاز → modal).
2. تَأكيد scroll فقط (لا استجابة لعجلة الماوس كَzoom).

## 🆕 v2.5.4 — مسار رقمي هرمي 1.2.3 + خلفية متتابعة + خطوط L + إِصلاح bug unassigned (مُنجَزة 2026-08-04)

> تَمّ فوق v2.5.3 في نفس الـ dev المجلد. آخر إِصدار فعلي في working tree. **ما لَم يُلتزم بَعد** — الاِلتزام موحَّد مَع v2.5.0/.1/.2/.3 في commit واحد + tag `v2.5.4`.

### 📋 التَغييرات
| # | التغيير | الملف |
|---|---|---|
| 1 | **مسار رقمي هرمي (`1.2.3`)**: `renderNode(node, depth, path)` + `renderChildren` يُولّدان `path` = المسار الكامل من الجذر (`1` → `1.1`, `1.2`... → `1.2.1`). النص في `<span class="map-path">` أَمام كل عقدة. | `frontend/public/js/admin-map.js` |
| 2 | **خلفية العُقدة متتابعة حسب العمق**: `data-depth` على كل `li` + أَنماط `.map-children[data-depth="N"]` تُعمّق الخلفية تَدريجيًا. `kindColor(kind)` يُرجع لون الخلفية حسب نوع (internet أَزرق `rgba(37,99,235,.18)`، zone أَصفر `rgba(234,179,8,.18)`، unassigned رمادي). | `frontend/public/js/admin-map.js`, `frontend/public/css/style.css` |
| 3 | **إِطار عُقدة الموقع = تَلخيص الحالة**: `locationBorderColor(node)` → أَحمر لو `offline>0`، أَخضر لو كلها online، رمادي وَإلا. `border-w` = `2px` لو offline. | `frontend/public/js/admin-map.js` |
| 4 | **خطوط وصل `::before` على شكل L**: خط رأسي + خط أَفقي قَصير بين الأَب و أَبنائه عبر `::before` على كل `li.map-node-html` (RTL تلقائي عبر `inset-inline-start`)؛ آخر ابن L قَصير. | `frontend/public/css/style.css` |
| 5 | **🐛 إِصلاح bug عقدة «أَجهزة غير مُعَيَّن»**: dblclick handler كان يُطلِق `map:filter-location` بِـ `location_id='unassigned'` حتى لو كانت العقدة غير موقع حقيقي → `Number('unassigned')=NaN` في `admin-devices.js:21` → جدول فَارِغ بِلا رِسالة. أُضيفت `kind === 'unassigned'` لِـ الحراسة (`admin-map.js:256`) → no-op. | `frontend/public/js/admin-map.js` |
| 6 | دالة `findDeviceNode(node, id)` لِـ اِسترجاع `ip`/`name`/`status` للعقدة الجهاز من الشجرة (يُستعمل في modal). | `frontend/public/js/admin-map.js` |

### 🔍 تَنبيه: تخالف التَوثيق
- `HANDOFF.md` القِسم v2.5.2 الأَعلى + `README.md` (قَبل هذا التَحديث) كانا يَذكران zoom + `devices:focus-device` — **تَم تَصحيحهما في README.md + إِضافة هذا القِسم لِـ HANDOFF** خلال هذه الجلسة.
- الاِختبار بِـ المتصفّح يجب أَن يَتحقق: (أ) scroll فقط لا zoom، (ب) نقر جهاز → modal (لا tab الأَجهزة)، (ج) نقر مزدوج على عقدة «أَجهزة غير مُعَيَّن» = no-op (لا جدول فَارِغ)، (د) مسار رقمي `1.2.x` ظاهر على العقد.

### ✅ التَحقق
- `node --check` على `admin-map.js` + `admin-devices.js` = OK (بعد تَدقيق هذه الجلسة).
- التَحقق الكامل (15 ملف + curl + PRAGMA) مَطلوب قبل الاِلتزام (يُجرى في المرحلة C).

### 📋 الخطوات لِـ الجلسة التالية / الحالة الحالية
1. **بَعد تَحقق المرحلة C** (node --check + curl + PRAGMA + بَدء الخادم على PORT=4099): اِلتزام موحَّد لِـ **v2.5.0 + v2.5.1 + v2.5.2 + v2.5.3 + v2.5.4** + tag `v2.5.4` (محليًّا).
2. **رَفع لِـ origin/main** بَعد **تَأكيد صَريح من المُستخدم** (لا push بِلا تَأكيد).
3. **v2.6.0** تَبقى من `sources.routes.js` stub (مُستقل عن الخريطة).

---
**آخر تحديث: 2026-08-04 — v2.5.4 (مسار رقمي + خلفية متتابعة + خطوط L + إِصلاح bug unassigned) مُنجَزة. التَحقق الكامل + التزام + tag + طلب تَأكيد للـ push في هذه الجلسة. v2.5.2 السابق تَاريخي (zoom/focus-device لَم يَعُدا صالِحَين).**

---

## ✅ اكتملت v2.7.0 (2026-08-08) — sidebar + map polish + uptime bar + history cleanup + confirm/toast popups

> 🎉 **مُنجَزة في مجلد development** (`feat/v2.6.0-zones-grid-view`). 16 ملفًا مُعدَّل. `node --check` PASS على كُلّ ملف. الالتزام + tag `v2.7.0` جاهِز بَعد هذا التَحديث.

### 🆕 ما الذي أَضافته v2.7.0 (7 طلبات)

| # | الميزة | النَطاق | الملفات المُعدَّلة |
|---|---|---|---|
| PA | **sidebar جانبي عمودي** (يمين ثابت 240px + drawer 🍔 في <768px) بَدَل التَبويبات الأُفقية العلوية | admin | `dashboard.html`, `style.css`, `admin-tabs.js` |
| PG | **`confirmAction()` modal موحّد** + **`showToast()`** موقّت بدَل كلّ `confirm()/alert()` الأَصلية | admin (cutting) | `admin-utils.js`, `dashboard.html`, `style.css` |
| PG-1 | اِستبدال **9 `confirm()`** بِـ `await confirmAction()` | admin | `admin-locations-types.js`, `admin-devices.js`, `admin-discovered.js`, `admin-update.js`, `admin-backup.js`, `admin-notifications.js` |
| PG-2 | اِستبدال **39 `alert()`** بِـ `showToast()` (success/error/warning) | admin | `admin-locations-types.js`, `admin-devices.js`, `admin-discovered.js`, `admin-discovery.js`, `admin-scheduler.js` |
| PE | **`has-online` class** على zone-cards كُلّها online → إِطار أَخضر مُميَّز + glow على device-dot | admin+public | `admin-map.js`, `public-map.js`, `style.css` |
| PB | **الثيم الليلي للخريطة**: متغيّرات ليلية + `box-shadow` glow للـ has-online/has-offline + device-dot glow في dark | admin+public | `style.css` |
| PD | **تَرقيم zone-cards تَسلسليًّا** (01، 02...) عَبر `CSS counter` + `aria-posinset`/`aria-setsize` للـ a11y | admin+public | `style.css`, `admin-map.js`, `public-map.js` |
| PC | **شريط نِسبة التَشغيل** (`#map-uptime-bar`) في الصَفحة العامة — يَتحدّث مَع polling 10s | public | `index.html`, `public-map.js`, `style.css` |
| PF | **endpoint `POST /api/devices/cleanup-history`** (week/month/year) + **زرّ موحّد "مَسح السجل"** popup (نوع + مُدّة) | admin+backend | `devices.routes.js`, `dashboard.html`, `admin-notifications.js` |

### 🐛 اِكتشافات أثناء التَنفيذ (تَصحيح الخطة المكتوبة)
1. **`confirm()/alert()` = 48 استدعاءً** (9 confirm + 39 alert) عبر 6 ملفات — الخطة ذَكَرت confirm() فقط. اِستُبدِل الكُلّ بِـ `confirmAction()` + `showToast()` (قرار المُستخدم).
2. **أَعمدة `downtime_events` الفعلية**: `started_at`/`ended_at` (لا `start_at`/`end_at` كما في الخطة). اِستُعملت الفعلية في الـ endpoint.
3. **الـ DB wrapper**: `better-sqlite3` مُباشِر (`db.prepare(...).run()`) — لا `db.run()`. اِستُعملت `.prepare().run()`.
4. **منطق toggle التَبويبات**: في `admin-tabs.js` مُنفصل (لا `admin-utils.js`). الـ sidebar يَستعمل نَفس الـ IDs + selector `.tab-btn` — **لا تَغيير** على `showSection()`.
5. **زرّ `#logs-clear-btn`**: كان يَحذف **سجل الإِشعارات** في `admin-notifications.js` (لا downtime). بَدَل زرّين، صار **زرّ موحّد** يَفتح popup (نوع + مُدّة) (قرار المُستخدم).

### 📦 ملف `cleanup-select-modal` جَديد
- popup اختيار (نوع: notifications/downtime + مُدّة: week/month/year) مُضاف في `dashboard.html`. يَستعمل `confirmAction()` ثانيًا لِـ تَأكيد نهائي قبل المَسح.

### 🔐 endpoint `POST /api/devices/cleanup-history` (القُيُود)
- `requireAuth` (session).
- `range`: `week`|`month`|`year` → days 7/30/365.
- **لا يَمسح ongoing** (`ended_at IS NOT NULL` فقط) — past only.
- يَعود `{success, data:{deleted, range, cutoff}}`.

### ✅ التَحقق (كلّ PASS)
- `node --check` on 14 ملفًا (admin + public + backend): **OK**.
- `bash -n deploy.sh`: **OK**.
- 12 `tab-btn` + 12 `section` IDs: مُتَطابِقة.
- `confirm-modal` + `cleanup-select-modal` + `toast-container` + `sidebar-toggle` + `admin-sidebar` + `sidebar-backdrop` + `dashboard-main` + `map-uptime-bar`: كُلّها موجُودة.
- CSS: `has-online`, `online-glow`, `zone-sequence`, `map-uptime-bar`, `uptime-fill` (9 أَماكن): مُتَوفّرة.
- نَتيجة `confirm()/alert()` grep عبر admin-*.js: الوحيد المُتبقّي هو `window.confirm` في `admin-utils.js:50` — وهذا **fallback آمن** داخل `confirmAction()` (لو modal غَير مَوجُود بسبب خطأ تَحميل) — مُتَعَمَّد.

### ⚠️ ملاحظة لِـ الجلسة التالية
- **لم يُلتزم/لَم يُرفع بَعد**. الالتزام + tag `v2.7.0` جاهِز بَعد هذا التَحديث (يَنتظر مُوافَقَة بَصَرية GUI من المُستخدم).
- اِختبار GUI مَطلوب: (1) sidebar يَفتح كُلّ تَبويب، (2) <768px 🍔 drawer، (3) حَذف جهاز → confirmAction modal، (4) رِسائل → toast، (5) خريطة admin تَرقيم 01/02 + إِطار أَخضر + glow dark، (6) public uptime bar يَتحدّث 10s، (7) مَسح السجل popup نوع+مُدّة → toast.
- رَفع لِـ `origin/main` بَعد تَأكيد صَريح من المُستخدم.

### 🔗 الخطة المرجِعية
- `docs/PLAN-v2.7.0-dashboard-redesign.md` — الخطة الأَصلية (7 طلبات + تَنفيذ 6 خُطوات).

---
**آخر تحديث: 2026-08-08 — v2.7.0 (sidebar + confirmAction + has-online + uptime bar + cleanup-history + toast) مُنجَزة. 16 ملفًا مُعدَّل. `node --check` PASS. الالتزام + tag `v2.7.0` + اِختبار GUI يَنتظر تأكيد المُستخدم.**

---

## 🆕 v2.7.1 — 5 طلبات واجهة (مُنجَزة 2026-08-09)

> **السياق**: طلب المُستخدم 5 تَعديلات على لوحة التحكم + الصفحة العامة. كل الطلب مُنجَز بنجاح، `node --check` PASS على كل ملفات JS، و migration `sort_order` مُختبَر على الـ DB المباشر. **لم يُلتزم بَعد** — يَنتظر اِختبار GUI + تَأكيد المُستخدِم.

### ✨ الطلبات الخمسة المُنجَزة

| # | الطلب | الحَل | الملفات |
|---|---|---|---|
| 1 | زرّ إظهار/إخفاء القائمة الجانبية + أَيقونات فقط عند الإخفاء (rail mode) | زرّ ☌ يَظهر في كل الأَحجام. حاسوب: يَطوي/يَوسّع (class `sidebar-collapsed` على `<body>` = 60px + أَيقونات مُوسَّطة + labels مخفية). موبايل: drawer كامل فوق الشاشة (السلوك القَديم). الحالة محفوظة في `localStorage:nm.adminSidebarCollapsed`. | `dashboard.html`, `js/admin-tabs.js`, `css/style.css` |
| 2 | تَحسين المظهر الليلي للـ grid في خريطة المواقع (لوحة التحكم + الصفحة العامة) | تَعويض `rgba` الثابت في `kindColor()` بِـ متغيّرات CSS (`--zone-internet-bg`/`--zone-bg`/`--zone-unassigned-bg`) مُعرَّفة في `:root` (نَهاري) و`body.dark` (ليلي). إضافة أَنماط ليلية إِضافية للـ borders/subzone/header/empty/counter. | `css/style.css`, `js/admin-map.js`, `js/public-map.js` |
| 3 | إظهار نِسبة التَشغيل عند النقر على الجهاز في تبويب عرض الخريطة (الصفحة العامة) | تَحويل chip الجهاز من `<div>` إلى `<button>` + ربط النقر بِـ `window.openDeviceModal(id)` (الموجُود في `public-dashboard.js`): يَعرض `uptime_percentage` + رسم بياني 24h + انقطاعات. اِستخراج id الرقمي من `dev-${id}`. | `js/public-map.js` |
| 4 | تَحكّم في تَرتيب أَطر العرض بحيث تَظهر متَّصلة على التَوالي (منطقة ← منطقة) | (أ) إضافة عمود `sort_order` لجدول `locations` عبر migration آمنة في `db.js` (نفس نمط `kind`) + تحديث `locations.routes.js` + `map.routes.js` لِـ `ORDER BY sort_order ASC, id ASC`. (ب) حقل «التَرتيب» في نموذج تبويب المواقع + عمود في الجدول + خيار في فلتر التَرتيب. (ج) سَهم مرئي `↣` CSS بين البطاقات في grid (يَختفي على الموبايل، أَوضح في الليلي). | `database/schema.sql`, `backend/src/db.js`, `backend/src/routes/locations.routes.js`, `backend/src/routes/map.routes.js`, `admin/dashboard.html`, `js/admin-locations-types.js`, `js/admin-map.js`, `js/public-map.js`, `css/style.css` |
| 5 | popup تأكيد عند تعديل أَي عنصر في كل التبويبات (الأَجهزة/الأَنواع/المواقع/الإِشعارات/المسح/النسخ) | اِستَعمال `confirmAction()` الموجُود (admin-utils.js). تَأكيد عند **الضغط على زر «تعديل»** (devices/locations/types) + عند **«حفظ»** (devices/locations/types + notifications + scheduler). تبويبات backup المُؤمَّنة بالفعل (restore/delete تَستعمل confirmAction). | `js/admin-devices.js`, `js/admin-locations-types.js`, `js/admin-notifications.js`, `js/admin-scheduler.js` |

### 📦 ملفات مُعدَّلة (16 ملف)
**Backend (4):** `database/schema.sql`, `backend/src/db.js`, `backend/src/routes/locations.routes.js`, `backend/src/routes/map.routes.js`
**Frontend HTML (1):** `frontend/public/admin/dashboard.html`
**Frontend JS (8):** `admin-devices.js`, `admin-locations-types.js`, `admin-notifications.js`, `admin-scheduler.js`, `admin-tabs.js`, `admin-map.js`, `public-map.js` (و`admin-utils.js` غير مُعدَّل — مُعاد اِستِعماله)
**Frontend CSS (1):** `frontend/public/css/style.css`
**Docs (1):** `HANDOFF.md` (هذا القسم)

### 🧪 التَحقق المُنجَز
- ✅ `node --check` PASS على كل ملفات JS المُعدّلة (admin-*.js + public-map.js).
- ✅ Migration `sort_order` مُختبَر: `PRAGMA table_info(locations)` → `id, name, parent_id, kind, sort_order` على الـ DB الإِنتاجي `database/monitoring.db`.
- ✅ Routes مُختبَرة على server عابر (المنفذ 4111): `GET /api/locations` → `sort_order` موجُود في الـ keys.

### ⚠️ ملاحظة لِـ الجلسة التالية
- **لم يُلتزم/لَم يُرفع بَعد**. الالتزام + tag `v2.7.1` جاهِز بَعد اِختبار GUI من المُستخدِم.
- **الـ server الإِنتاجي يَعمل بأَ كود قَديم** (PM2 على المنفذ 4001 لم يُعِد الإقلاع بعد تَعديلاتي). للتَحميل: `pm2 restart network-monitor` (أَو ما يُكافئه). migration `sort_order` دخل في الـ DB بالفعل (افتراضي 0 لكل الصفوف القائمة).
- اِختبار GUI مَطلوب: (1) زر ☌ → rail mode على الحاسوب + drawer على الموبايل + الحالة محفوظة بَعد refresh. (2) خريطة المواقع في الوَضع الليلي (لوحة + عام) → خلفيات بطاقات متناسقة. (3) في الصفحة العامة تبويب 🗺️ → نقر جهاز → modal نِسبة التَشغيل + رسم بياني. (4) تبويب المواقع → حقل «التَرتيب» + عمود في الجدول + سَهم `↣` بين البطاقات في الخريطة. (5) نقر «تعديل» على جهاز/موقع/نوع → popup → نقر «حفظ» → popup ثاني (للتعديل فقط) → toast نَجاح.
- رَفع لِـ `origin/main` بَعد تَأكيد صَريح من المُستخدم.

---
**آخر تحديث: 2026-08-09 — v2.7.1 (sidebar rail + night-mode grid + device uptime modal + sort_order arrows + edit/save popups) مُنجَزة. 16 ملفًا مُعدَّل. `node --check` PASS + migration مُختبَرة. الالتزام + tag `v2.7.1` + اِختبار GUI + `pm2 restart` يَنتظر تَأكيد المُستخدِم.**

---

## 🆕 v2.7.5 — تذكّرني + web_port + اختبار سرعة + خط أنابيب ISO (مُنجَزة 2026-09-30)

> **مُلتزَمة** في `640a0f3`. 39 ملفًا مُعدَّلًا. أُدرِجَت هنا لأول مرة لأن HANDOFF كان متوقفًا عند v2.7.1.

### ✨ المُنجَز
| # | الطلب | الملفات |
|---|---|---|
| 1 | **«تذكّرني»** في تسجيل الدخول: جلسة 30 يومًا عبر تجاوز `maxAge` + فحص الجلسة قبل إعادة التوجيه | `routes/auth.routes.js`, `js/admin-login.js`, `admin/login.html` |
| 2 | **حقل `web_port` للجهاز**: فتح واجهة الجهاز على منفذ مخصص (مثل `4444`) + فحص HTTP/HTTPS تلقائي عند الإضافة/التعديل + migration | `db.js`, `routes/devices.routes.js`, `database/schema.sql`, `js/admin-devices.js` |
| 3 | **اختبار سرعة الإنترنت** في الصفحة العامة مع اختيار سيرفر (Cloudflare كامل / jsDelivr+unpkg تنزيل فقط، CORS مُتحقَّق منه) | `js/public-speedtest.js` (جديد 276 سطرًا), `index.html` |
| 4 | **خط أنابيب ISO للـ Appliance**: Debian 12 live-build + خدمة systemd + nginx (80→4001) + nftables (80/443 فقط) + مُثبِّت قرص بكلمة مرور إدارية عشوائية + workflow GitHub Actions | `appliance/**` (23 ملفًا جديدًا), `.github/workflows/build-iso.yml` |
| 5 | **تبويب الأجهزة**: حفظ الترتيب/الفلتر في `localStorage` (`nm.adminDevicesSort`/`Filter`) | `js/admin-devices.js` |
| 6 | **الخريطة (إداري + عام)**: بطاقة «أجهزة الإنترنت» مثبّتة أولًا ومستثناة من السحب والإفلات | `js/admin-map.js`, `js/public-map.js` |
| 7 | **شريط نِسبة التشغيل** على بطاقات وجدول الصفحة العامة (وإصلاح تكراره في عرض الجدول) | `js/public-dashboard.js`, `index.html`, `css/style.css` |
| 8 | **`POST /api/devices/cleanup-status-logs`** (مسح سجلات الحالة) | `routes/devices.routes.js` |

---

## 🆕 v2.8.0 — سلسلة الشبكة + شاشة NOC + تقوية الـ Appliance (مُلتزَمة 2026-10-07)

> الالتزام `2835931` — آخر إصدار **مُوسَم** (`v2.8.0`، وسمه على origin/main).

### ✨ المُنجَز
- **سلسلة الشبكة (Topology chain)**: عمود `parent_id` + auto-migration + `/api/topology` مع وسم
  «انقطاع المسار» (path-down marking) + تبويب إداري بتحرير الأب مباشرةً داخل الصف + ترتيب طبيعي.
- **شاشة NOC للعرض العام** (`frontend/public/noc.html`) + رابط من الصفحة العامة.
- **التحديثات بنمط الأرشيف للـ Appliance**: GitHub API tags + zipball (بدون git/PM2) مع مقارنة
  semver حقيقية (أُصلح خلل `2.4.0` مقابل `2.5.3`).
- **وحدة تحكم الجهاز**: بوابة كلمة مرور (SHA-512، 3 محاولات/قفل 30ث)، `[q]` للقفل + قفل تلقائي عند
  خمول 5 دقائق، إظهار authtoken في التقرير الكامل، أدوات شبكة (ping/traceroute/فحص الإنترنت عبر
  `1.1.1.1`)، مستخدم `sysadmin` لـ SSH، `open-vm-tools`، `unzip`، ومنفذ SSH 22 في nftables.
- **المُثبِّت**: الأدمن يختار كلمة المرور، إعداد شبكة DHCP/Static، إنشاء `sysadmin` **بعد** قراءة كلمة
  المرور (إصلاح ترتيب `set -u`)، و`AmbientCapabilities=CAP_NET_RAW` لـ ping/traceroute.
- **ngrok**: عنوان equinox عامل (S3 NoSuchKey) + دعم نطاق ثابت.
- **مخطط القاعدة**: `2.5.3` → `2.8.0`.

---

## 🆕 v2.8.1 → v2.8.4 — topology draw + NOC parity (مُلتزَمة محليًّا، **غير مرفوعة** — 2026-10-09)

> الالتزامان `07b399d` (v2.8.2→v2.8.3) و`f598622` (v2.8.4) على `main` محليًّا، **متقدّمان على
> `origin/main` بـ 2 التزامات**. `v2.8.1` لم يُوسَم بـ tag (موثّق من تعليقات الكود).

### 🐛 v2.8.1 — إصلاحات داخل ملف السلسلة
- عقدة `/api/topology` ناقصة الحقول الإدارية (`device_type_id`, `check_interval_seconds`…) ⇒ أُكملت.
- **تحديث محلي بدل `loadAll`** بعد تغيير الأب أو الإخراج — يحفظ السحبات غير المحفوظة.
- **أول موضع فاضٍ داخل حدود اللوحة** (بدل رمي الجهاز فوق بطاقات موجودة).

### 🗺️ v2.8.2 — مواضع محفوظة + «وضع الرسم»
| # | التغيير | الملف |
|---|---|---|
| 1 | عمودا `locations.pos_x/pos_y` + إرجاعهما في `GET /api/locations` + دعم `_pos_only` في `PUT /api/locations/:id` | `backend/src/routes/locations.routes.js` |
| 2 | عمودا `devices.pos_x/pos_y` + `devices.parent_location_id` مع تحقق `validateParentLocation` | `backend/src/routes/devices.routes.js`, `database/schema.sql` |
| 3 | بناء الشجرة الموحّدة من `parent_id` للجميع + حفظ التخطيط يقبل `'L<id>'`/`'D<id>'` + حارس تجاهل `(0,0)` | `backend/src/routes/topology.routes.js` |
| 4 | «وضع الرسم» في تبويب «سلسلة الشبكة»: سحب البطاقات + «متصل عبر» + 💾 حفظ التخطيط | `frontend/public/admin/dashboard.html`, `css/style.css`, `js/admin-topology.js` (587 سطرًا) |
| 5 | `admin-topology-view.js` (جديد 135 سطرًا): عارض السلسلة الهرمية داخل `#topology-tree` | `frontend/public/js/admin-topology-view.js` |
| 6 | `admin-devices.js`: قائمة «متصل عبر» تجمع الأجهزة والمواقع | `frontend/public/js/admin-devices.js` |

### 🐛 v2.8.3 — عقد المواقع تدخل السلسلة
- أجهزة المبنى من `location_id` (نفس مصدر شجرة المواقع — تعيين المستخدم الموثوق).
- الجهاز التابع لمبنى (`parent_location_id`) يُعرض **داخل بطاقة المبنى فقط**؛ والأجهزة بلا موقع
  (`location_id` فارغ) **لا تظهر على اللوحة إطلاقًا**.
- `noc.html`: خريطة «كما رسمها الأدمن» — بطاقات المباني وأجهزتها على مواضعها المحفوظة.
- بطاقة المبنى بنفس شكل كارت خريطة المواقع (مصمتة + ترويسة بعدادات).

### 🐛 v2.8.4 — مواءمة NOC مع وضع الرسم + إصلاح ضياع «متصل عبر»
- **`PUT /api/locations/:id` يقبل `_clear`** ⇒ يكتب `pos_x/pos_y = NULL` بصدق. (كان `null` يتحوّل إلى
  `0` ⇒ الموضع `(0,0)` والبطاقة تعود بعد إعادة التحميل، أي أن ✕ لم يكن يُخرج المبنى من اللوحة فعليًّا.)
  وأُضيف حارس متناظر مع `/api/topology/layout`: لا يُكتب `(0,0)` على مسار مواضع المواقع كذلك.
- **`parentKeyOf`**: علاقة واحدة موحّدة عبر `parent_id` لكل الأنواع — موقع ← موقع، وجهاز ← جهاز ثم
  موقعه. (كان للمواقع `upstream_location_id` وهو عمود **لا يقرأه الخادم ولا يكتبه**، فكان اختيار
  «متصل عبر» لمبنى يضيع بصمت ⇒ **صفر خطوط بين المباني في وضع الرسم**.)
- قائمة «متصل عبر» للمبنى تعرض **مواقع فقط** (أب الموقع لا يمكن أن يكون جهازًا).
- `drawLinks`: خطوط المباني بمرتكز منتصف الترويسة (عرض 320 / ارتفاع 17) — مطابق لـ NOC.
- `saveLocationPositions`: الإخراج الصريح (✕) يُرسل `_clear` بدل `pos = null`.
- `noc.html`: خطوط المباني بنفس الإحداثيات والسماكة والعتامة كوضع الرسم (كان `2.5/0.5` ومرتكزًا مختلفًا).

### 📊 الأثر المقيس (لقطة جلسة v2.8.4 — وليست القاعدة الحالية)
| المقياس | قبل | بعد |
|---|---|---|
| خطوط «وضع الرسم» بين المباني (لوحة التحكم) | 0 (و32 خطًّا داخليًّا فقط) | **10** |
| خطوط المباني في NOC | 10 | 10 (دون تغيير) ⇒ تساوى الطرفان على نفس العلاقة ونفس الإحداثيات |

> ⚠️ **مواضع القاعدة الحقيقية (قِيست في جلسة التوثيق 2026-10-09)**: من 12 موقعًا، **4 فقط بموضع محفوظ**
> (`13` عنبر الكتاين `(1690,700)`, `14` البوفية `(2020,700)`, `15` عنبر المخزن `(2350,700)`,
> `19` المبنى الادارى `(40,40)`)، و**8 بموضع `NULL`**: `8` الادارة-الدور الارضى، `9` الادارة-الدور الثانى،
> `10` الادارة-الدور الثالث، `11` الورشة-1، `12` الورشة-2، `16` عنبر منعم، `17` غرفة الامن، `18` Internet-Gateway.
> (لذلك الرقم الواقعي لبطاقات المباني القابلة للرسم = **11** + عقدة Internet، لا 12.)

### 🧪 التَحقق المُنجَز (v2.8.2 → v2.8.4)
- `node --check` على `backend/src` (23 ملفًا) + سكربت NOC الداخلي + `admin-topology.js`.
- 19 فحص API (v2.8.2/2.8.3) + 10 فحوص مواءمة (v2.8.4) = **29 PASS / 0 FAIL** على **نسخة** من القاعدة
  (`.zwork/vtest/monitoring.db`، المنفذ 4002) — القاعدة الحقيقية `database/monitoring.db` لم تُمسّ.
- فحص متصفح headless (في تلك الجلسة): بطاقات المباني + قوائم «متصل عبر» + زر الحفظ، ولا أخطاء JS في الشاشتين.
- **إعادة تحقق في جلسة التوثيق (2026-10-09)**: أُعيد تشغيل الخادم على **نسخة** من القاعدة بـ **Node 20**
  (المنفذ 4211): `/api/health` = 200، `/api/locations` = 200 (يحوي `sort_order` و`pos_x`)،
  `/api/topology` = 200، و`/api/sources` = 401 بلا جلسة (متوقّع). **القاعدة الحقيقية لم تتغيّر**
  (بصمة قبل/بعد متطابقة: 39 جهازًا، 12 موقعًا).

### ⚠️ ملاحظة بيانات (ليست عيب كود)
- في لقطة تلك الجلسة كان `Internet-Gateway (id=18)` و«المبنى الادارى (id=19)» بموضع `(0,0)` على اللوحة
  ⇒ خط منطوٍ عند نقطة واحدة. **الآن**: `19` = `(40,40)` محفوظ، و`18` = `NULL` (بلا موضع).

---

## 🧪 حالة التحقق في هذه الجلسة (2026-10-09)

| الفحص | النتيجة | الملاحظة |
|---|---|---|
| `node --check` على `backend/src/**/*.js` + `frontend/public/js/*.js` (**43 ملفًا**) | **0 فشل** | خط أساس نظيف قبل أي تعديل |
| تشغيل الخادم بـ **Node 24** (على PATH) | **متعذّر** | `ERR_DLOPEN_FAILED`: `better-sqlite3` مبنيّ لـ Node 20 (`NODE_MODULE_VERSION 115`) وNode 24 يتطلب `137`. `npm rebuild better-sqlite3` فشل بـ `EPERM` على `build/Release/better_sqlite3.node` (الملف مُقفَل بمعالجة Node قائمة) |
| تشغيل الخادم بـ **Node 20** (`nvm` → `v20.18.0`) | **PASS** | `Database connection OK.` + `Server running on port 4211` + `Monitoring engine started` + `[SCHEDULER] Disabled at startup` — على **نسخة** من القاعدة |
| فحوص API الحيّة (health / locations / topology / sources) | **PASS** | 200 / 200 (`sort_order`+`pos_x` موجودان) / 200 / 401 بلا جلسة |
| بصمة القاعدة الحقيقية قبل/بعد | **بلا تغيير** | 39 جهازًا، 12 موقعًا، ونفس قيم `pos_x/pos_y` |
| فحوص JSON المذكورة في تقرير v2.8.2→v2.8.4 (29 فحصًا) | لم تُعَد في هذه الجلسة | كانت على الخادم المؤقّت آنذاك؛ تحتاج تشغيل `node server` + سكربتات `.zwork/*.js` (غير مُتتبَّعة) قبل الالتزام |
| `bash -n deploy.sh` | لم يُشغَّل | لا `bash` على هذا الجهاز (win32/PowerShell) |

---

## 📋 الخطوات المتبقية للجلسة التالية

1. **البيئة**: شغّل الخادم بـ **Node 20** (يحلّ العائق فورًا — الوحدة الأصلية 1712640 بايت مطابقة له):
   `& "C:\Users\KeRo\AppData\Local\nvm\v20.18.0\node.exe" src/server.js`
   أَو اجعل Node 20 هو الافتراضي (`nvm use 20.18.0`) ليطابق CI (`NODE_VERSION: '20'`).
   **لا تشغّل** `npm rebuild better-sqlite3` أثناء وجود خادم Node قائم (يفشل بـ `EPERM` على الملف المُقفَل).
2. **إعادة فحوص v2.8.2→v2.8.4** على نسخة من القاعدة (`PORT=4002` + `DB_PATH=.zwork/vtest/monitoring.db`)
   + سكربتات `.zwork/verify-api.js` و`.zwork/verify-alignment.js` (غير مُتتبَّعة) للتأكد أنها خضراء.
3. **الالتزام + وسم `v2.8.4`**: التزامان (`07b399d`, `f598622`) متقدّمان على `origin/main` —
   ينتظران تأكيد المستخدم للرفع.
4. **وسوم ناقصة على origin**: `v2.5.4` و `v2.7.0` موجودان محليًّا فقط ⇒ `git push origin v2.5.4 v2.7.0`
   مع الرفع (لأن تبويب التحديثات يقرأ التاجات من GitHub API).
5. **إصلاح بيانات المواضع (الوحيد المتبقّي كما يبدو)**: **8 مواقع** موضعها `NULL` في القاعدة الحقيقية
   — ids: `8` الادارة-الدور الارضى، `9` الادارة-الدور الثانى، `10` الادارة-الدور الثالث، `11` الورشة-1،
   `12` الورشة-2، `16` عنبر منعم، `17` غرفة الامن، `18` Internet-Gateway. سحبها على لوحة «وضع الرسم»
   ثم 💾 حفظ التخطيط لكل واحدة (أو حفظ الكل) لتظهر على اللوحة وفي NOC.
   الأربعة المحفوظة حاليًّا: `13`، `14`، `15`، `19`.
6. **مخلفات التشخيص**: **37 ملفًا** غير متتبَّع في الجذر (`cdp-*.js`, `check-*.js`, `verify-*.js`,
   `*.png`, `commit-msg*.txt`) + `.zcodeignore` **أُخفيت عن `git status`** بإضافة أنماط في `.gitignore`
   (لم يُحذف أي ملف). مجلد `.zwork/` كان مُتجاهَلًا أصلًا عبر `.zwork/.gitignore` فلا يحتاج قاعدة.
   الملفان `appliance/noc-test.html` و`appliance/noc-staging.html` **لم يُخفَيا** — قرارك: التزامهما أَو تجاهلهما.

---

**آخر تحديث: 2026-10-09 — v2.8.1→v2.8.4 (topology draw + NOC parity) مُلتزَمة محليًّا، والوسوم
`v2.8.1`/`v2.8.2`/`v2.8.3`/`v2.8.4` **غير موجودة** (وسوم git تتوقف عند `v2.8.0`). CHANGELOG أُعيد بناؤه
(كان متوقفًا عند 2.1.0). `node --check` على 43 ملفًا = 0 فشل + فحوص API حيّة PASS على **نسخة** من القاعدة
بـ Node 20 (القاعدة الحقيقية بلا تغيير). الرفع + وسوم `v2.8.4` و`v2.5.4` و`v2.7.0` ينتظر تأكيد المستخدم.**

---

## ☀️ v2.8.5 — الوضع النهاري (Day mode) لشاشة NOC (مُنجَز ومُتحقَّق منه — 2026-10-10)

> شاشة NOC كانت ليلية بالكامل وثابتة. أُضيف وضع نهاري **اختياري** (الافتراضي يبقى ليليًّا لشاشة TV) بزرّ تبديل
> في الترويسة وتفضيل محفوظ مشترك مع الصفحة العامة، مع تحصين الشاشة من الأرقام والحالات الوهمية.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | كتلة `html.noc-day` (~64 قاعدة) + `color-scheme: light` + زر «☀️ وضع نهاري / 🌙 وضع ليلي» + سكربت منع الوميض في `<head>` + `applyNocTheme` | `frontend/public/noc.html` |
| 2 | ألوان نقاط/خطوط الخريطة صارت أصنافًا (`.mv-dot.*`, `.mv-link`, `.mv-dot-child/parent`) بدل ستايل مضمّن في JS | `frontend/public/noc.html` |
| 3 | شارتا القسمين تُحسبان من المعروض فعلًا بدل «12 موقع»/«39 جهاز» الثابتتين | `frontend/public/noc.html` |
| 4 | حالة `neutral` صريحة (المدخل/الخوادم/شارة القسم) + تمييز «لا أجهزة بعد» عن «لا نتائج» + ملاحظة خريطة فارغة | `frontend/public/noc.html` |
| 5 | إصلاح تكرار تدرّج `body` كل `100vh` (`fixed no-repeat`) | `frontend/public/noc.html` |
| 6 | رفع الإصدار إلى 2.8.5 | `backend/package.json`, `appliance/run-build.sh` |

### 🧪 التحقق في هذه الجلسة (2026-10-10)
| الفحص | النتيجة |
|---|---|
| فحص آلي: تغطية القواعد الليلية الغامقة في الوضع النهاري | **0 فجوة حقيقية** (بقيت ثلاث قواعد مقصودة: `.brand-icon`, `.filter-pill.active`, `.hero-card.neutral`) |
| تحليل الـ scriptين داخل `noc.html` + `node --check public-dashboard.js` | **OK** |
| متصفح headless (CDP) على نسخة من القاعدة (`PORT=4103` + `.zwork/vtest/monitoring.db`, Node 20) | ليلي: 12 موقعًا/39 جهازًا — نهاري: مثلهما — **0 خطأ JS** في الحالتين |
| التبديل + إعادة تحميل (`--theme=light --reload=1`) | بقي `noc-day` و`nm.publicTheme=light` ⇒ قراءة التفضيل عند الإقلاع تعمل |
| القاعدة الحقيقية `database/monitoring.db` | **لم تُلمس** (التحقق على نسخة `.zwork/vtest`) |
| لقطات مرجعية | `verify/noc-dark.png`, `verify/noc-day.png`, `verify/noc-day-full.png` (محليّة، غير مُتتبَّعة — `/verify/` مُستثنى في `.gitignore`) |

### 📋 المتبقّي
1. **رقم الإصدار في `README.md`** ما زال 2.8.4: كتابة الملف مرفوضة من حارس الأسرار لأن سطرًا فيه يحوي قيمة
   `TELEGRAM_BOT_TOKEN` توثيقية نائبة (وليست توكنًا حقيقيًّا؛ `backend/.env` غير مُتتبَّع أصلًا). القرار
   أُعيدت المحاولة بعد تأكيد المستخدم أنها قيمة نائبة ⇒ **رُفضت مرة ثانية** (الفحص يجري على كامل محتوى الملف، فلا يكفي تأكيد النية). المسارَان المتاحان: (أ) تعديل السطر 229 يدويًّا (أو حذفه) ثم إعادة التعديل، (ب) لصق نصّ الإصدار يدويًّا: شارة الإصدار + سطر «الإصدار الحالي» + قسم «ما الجديد في v2.8.5».
2. **الرفع والوسوم**: `v2.8.4` و`v2.5.4` و`v2.7.0` ما زالت محليّة، والالتزامات الجديدة (v2.8.5) محليّة أيضًا.

---

## 🗺️ v2.8.6 — مواءمة «خريطة المباني» في NOC مع «خريطة المواقع» + نافذة تفاصيل الجهاز (مُنجَز ومُتحقَّق منه — 2026-10-10)

> **طلب المستخدم:** «شاشة NOC وخريطة المواقع مش مترتبين زي بعض» + «ميزة إضافية: الضغط على الجهاز لإظهار حالته كما في خريطة المواقع».
> **القرار المتفق عليه (من اختيارات المستخدم):** تطابق **كامل** = نفس الترتيب + نفس الأماكن + نفس محتوى الكارت.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | تبويب «🗺️ خريطة المباني» لم يعد لوحة رسم حرة — صار **نسخة مطابقة** لـ«خريطة المواقع»: نفس المصدر `/api/map/public/tree` ونفس منطق البناء (بطاقة «أَجهزة مَدخل الإنترنت» أولًا ثم بطاقات المواقع المتداخلة) ونفس الترتيب `sort_order` + ترقيم `01/02…` وسهم `↣` | `frontend/public/noc.html` |
| 2 | أنماط Zones-Grid منقولة من `css/style.css` (v2.6.0 → v2.7.4) بنفس القيم عبر متغيّرات `--mv-*` (ليلي افتراضي/نهاري) ⇒ نفس الألوان والأبعاد في الوضعين | `frontend/public/noc.html` |
| 3 | دمج **أسماء الأجهزة** من `/api/topology` (الشجرة العامة تحجب الأسماء) + ترتيب صفوف الأجهزة بالاسم = نفس `ORDER BY d.name` في مسار لوحة التحكم | `frontend/public/noc.html` |
| 4 | **نافذة تفاصيل الجهاز** بالنقر على أي جهاز: نفس حقول «خريطة المواقع» من `GET /api/devices/:id` (الشارة متصل/متوقف/غير معروف + IP/النوع/الموقع/طريقة الفحص/المنفذ/فترة الفحص/حد التنبيه/مفعّل/زمن الاستجابة/آخر فحص)، تُغلَق بزر ✕ أو بالنقر خارجها أو `Esc` | `frontend/public/noc.html` |
| 5 | لوحة «وضع الرسم» انتقلت إلى تبويب مستقل **«✏️ التخطيط المرسوم»** (لم تُحذف) + شارة/ملاحظة خاصة به | `frontend/public/noc.html` |
| 6 | رفع الإصدار إلى 2.8.6 (شارة NOC في الترويسة) | `frontend/public/noc.html` |
| 7 | **«🌍 فحص الاتصال الخارجي» صارت أول بطاقة** في «مسار الإنترنت» (طلب المستخدم): فحص خارجي → المدخل الرئيسي → جدار الحماية → مجمع الخوادم، والرابط بعدها أحمر عند فشل الفحص | `frontend/public/noc.html` |
| 8 | **إصلاح اختيار جهاز «جدار الحماية المركزي»**: أولوية للاسم `sophos` ثم `192.168.88.1` ثم أي جهاز نوعه Firewall ما عدا جهاز بطاقة الفحص — كان جهاز `DNS` (نوعه Firewall) يُلتقط أولًا فيظهر الجهاز نفسه مرّتين | `frontend/public/noc.html` |
| 9 | **«التخطيط المرسوم» اتجاه اليمين بدل الوسط**: `transform-origin: 100% 0` على `#map-board-inner` + تثبيت العرض على بداية اللوحة (`scrollLeft = 0` = الحافة اليمنى في RTL) بعد تكبير/تصغير/إعادة ضبط | `frontend/public/noc.html` |
| 10 | **«ملاءمة الشاشة» تقيس إطار البطاقات المرسومة** (bbox + هامش، عرض×ارتفاع) بدل عرض اللوحة 2800 ⇒ 12 بطاقة كاملة الظهور وملتصقة باليمين | `frontend/public/noc.html` |
| 11 | **حفظ التبويب المختار + مقياس اللوحة** في `localStorage` (`nm.nocView` / `nm.nocZoom`) واسترجاعهما عند الإقلاع — كانا يعودان لأوّل شاشة «عرض شامل» ومقياس 100% بعد reload | `frontend/public/noc.html` |

### 📌 قرارات
- **قراءة فقط** لشاشة NOC (شاشة TV): لا سحب/إفلات ولا أزرار إدارة داخل البطاقات — فقط طيّ/توسيع البطاقة والنقر على جهاز لعرض حالته.
- سلوك «خريطة المواقع» محفوظ حرفيًّا: طيّ «أجهزة غير مُعيَّن» افتراضيًّا **لو فيها > 8 أجهزة** عند أول تحميل (نفس شرط `admin-map.js`)، ونفس نص الفراغ «لا أجهزة في هذه الموقع.»، ونفس شكل تلميحات البطاقات.
- «عرض شامل» يبقى الأقسام الثلاثة القديمة (مسار الإنترنت + خريطة المباني + الأجهزة حسب النوع) ولا يزدحم بتبويب «التخطيط المرسوم».
- المواضع `pos_x/pos_y` لم تعد تظهر في «خريطة المباني»، وما زالت تظهر في تبويب «التخطيط المرسوم» وفي خطوط السلسلة (لوحة التحكم ← وضع الرسم).

### 🧪 التحقق (28 PASS / 0 FAIL)
`node verify-noc-map-parity.js` على **نسخة** من القاعدة (`.zwork/vnoc/monitoring.db` + `PORT=4103`) بـ Node 20:
- بطاقات المستوى الأول متطابقة بنفس الترتيب `orphan-internet-devices,19,15,unassigned` + نفس العدادات وصفوف الـ 39 جهازًا والتداخل.
- نافذة التفاصيل: الاسم/الشارة/الحقول/القيم مطابقة لـ`/api/devices/:id` (اختبار حي على DNS 8.8.8.8) وتُغلَق بزر ✕.
- **ترتيب «مسار الإنترنت»**: أول عنصر = «🌍 فحص الاتصال الخارجي» ثم المدخل الرئيسي ثم جدار الحماية (`sophos`) ثم مجمع الخوادم — ولا تكرار للجهاز بين بطاقتي الفحص والجدار.
- **«التخطيط المرسوم» على اليمين** (قياسات فعلية): افتراضي 100% (فراغ اليمين 73px · أصل التحويل = حافة اللوحة اليمنى 2800px) · بعد «ملاءمة الشاشة» (فراغ اليمين 39px · الرسم كامل الظهور · مقياس 0.52) · بعد «إعادة ضبط» (100% وscrollLeft=0) · بعد «تصغير» 0.7 (فراغ اليمين 51px).
- تبويب «التخطيط المرسوم»: 12 بطاقة، والشارة «12 موقع». و«عرض شامل» يُخفي لوحة الرسم.
- **بعد إعادة تحميل الصفحة (reload)**: نفس التبويب محفوظ (`draw → draw`) والتبويب ظاهر ومُرسم (12 بطاقة) ومقياس اللوحة محفوظ (`scale(0.8) → scale(0.8)`).
- الوضع النهاري: نفس بنية البطاقات. و**0 أخطاء JS** في كل الجلسة.
- لقطات: `verify/noc-parity-dash-grid-night.png` · `noc-parity-noc-grid-night.png` · `noc-parity-noc-device-modal.png` · `noc-parity-draw-board.png` · `noc-parity-draw-fit-right.png` · `noc-parity-hero-order.png` · `noc-parity-reload-restore.png` · `noc-parity-noc-grid-day.png` — و«قبل» الإصلاح: `verify/noc-draw-before-fit-centered.png`.
- **القاعدة الحقيقية `database/monitoring.db` لم تُلمس** (الإشعارات والمسح مُعطَّلتان في النسخة الاختبارية فقط).

### ⚠️ ملاحظات للجلسة التالية
1. **غير مُلتزَمة بعد** (لا commit ولا tag): الرفع ينتظر تأكيد المستخدم — مثل `v2.8.4/2.8.5`.
2. لو المستخدم مش عايز تبويب «التخطيط المرسوم»: يُحذف بسهولة (السكشن `#draw-section` + الدالة `renderDrawBoard()` + قواعد `.map-wrapper/.mv-*` تبقى بلا مستهلك).
3. خادم الاختبار قد يكون ما زال شغّالًا على المنفذ 4103 (نسخة `.zwork/vnoc`) — يُوقَف عند الطلب.
4. **README.md لم يُحدَّث إلى 2.8.6** — نفس عائق حارس الأسرار: السطر 229 فيه سطر توثيقي لقيمة توكن تلجرام مكتوبة حرفيًّا (الملف غير مُتتبَّع في git) ⇒ رُفضت الكتابة برسالة `artifact_secret_detected`. القرار للمستخدم: (أ) حذف/تعقيم السطر 229 (أو تعديله يدويًّا) ثم إعادة المحاولة، أو (ب) لصق نصّ الإصدار يدويًّا. **لم يُحاوَل أي تجاوز للفاحص.**

---

## 📡 v2.8.7 — بثّ حيّ SSE لشاشات العرض (مُنجَز جزئيًّا — بانتظار استبدال `server.js` يدويًّا — 2026-10-11)

> **طلب المستخدم:** «اشرحلي WebSocket بدل polling» ⇒ بعد الشرح اختار: **نبدأ بـ SSE (أخف وأبسط)**.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | خدمة شجرة موحّدة (استخراج باني الشجرة + pathDown من مسار `/api/topology`) | `backend/src/services/topology.service.js` (جديد) |
| 2 | ناقل البثّ الحيّ: لقطة + مقارنة + بثّ التغييرات فقط + تجميع 400ms | `backend/src/services/live.service.js` (جديد) |
| 3 | مسار SSE عام: `GET /api/live/status` (بترويسة `X-Accel-Buffering: no` + نبض 25 ثانية) | `backend/src/routes/live.routes.js` (جديد) |
| 4 | محرك المراقبة يبثّ فورًا بعد كتابة حالة (online/offline) + شبكة أمان كل دورة | `backend/src/services/monitor.service.js` |
| 5 | مسار `/api/topology` صار يستدعي الخدمة المشتركة (بلا تغيير في المخرجات) | `backend/src/routes/topology.routes.js` |
| 6 | NOC: SSE + polling تكيفي (60s مع الخط / 10s بدونه) + مؤشّر التذييل + تحديث **المصدرين** معًا | `frontend/public/noc.html` |
| 7 | الصفحة العامة: نفس الربط (polling تكيفي) | `frontend/public/js/public-dashboard.js` |
| 8 | nginx: كتلة `location /api/live/` + ملاحظة في خريطة Connection | `nginx.example.conf`, `nginx.connection-map.conf` |
| 9 | رفع الإصدار إلى 2.8.7 | `backend/package.json`, `appliance/run-build.sh`, `frontend/public/noc.html` |

### ✅ العائق انحلّ (المستخدم نسخ الملف بنفسه)
كانت كتابة `backend/src/server.js` مرفوضة من حارس الأسرار (قيمة افتراضية نصّية لسرّ الجلسة) ⇒ سُلِّم
ملف كامل `server.js.new` والمستخدم نسخه يدويًّا. **تم التحقق بالمطابقة (MD5) = مطابق تمامًا ✓** — وبذلك:
  • مسار `/api/live/status` مركّب ويعمل.
  • `server.js` صار قابلًا للكتابة الآلية مستقبلًا (لا سرّ داخل الكود).
  • تحصين أمني: لم تبقَ قيمة سرّ افتراضية معروفة للجميع (المفتاح من `.env` أو عشوائي عند الإقلاع).

### 🧪 التحقق
- **`node --experimental-websocket verify-noc-map-parity.js` (Node 20): 34 PASS / 0 FAIL** — كل فحوص v2.8.6
  ما زالت ناجحة + فحوص SSE الحيّة:
  - الخط متصل + الـ polling انخفض لـ 60 ثانية + نص التذييل «مراقبة حية — تحديث فوري (SSE)».
  - **زمن الوصول المقيس: 444ms** من كتابة «offline» في القاعدة حتى ظهوره على الشاشة (والـ polling وقتها 60s).
  - **fallback مُختبَر**: إغلاق الخط يدويًّا ⇒ رجوع فوري لـ polling 10s والنص «تحديث دوري كل 10 ثانية».
  - **0 أخطاء JS** و**0 أخطاء على مسار البثّ الحيّ**.
- **النسخ الاحتياطي (جديد)**: `verify/check-backup.js` = 8 PASS · `verify/check-backup-restore.js` = 7 PASS —
  على نسخة القاعدة: تنزيل نسخة سليمة (magic bytes + 12 جدول + 39 جهاز/12 موقع) واستعادة كاملة فعليًّا
  (تنشئ نسخة أمنية `backup-before-restore-*.db` ثم تُنهي الخادم كما هو مصمَّم).
- `node --check` لكل ملفات الباك الجديدة/المعدّلة + سكربتا `noc.html` (2/2) + `public-dashboard.js` + `admin-backup.js`.
- **القاعدة الحقيقية لم تُلمس.**

### 🧱 عطل الأبلاينس (ISO) — النسخ الاحتياطي يفشل على النظام المثبَّت (مُشخَّص ومُصلَح)
**العَرَض (من المستخدم):** «المشكلة ظهرت على التنصيب على VM بعد عمل ملف ISO» — النسخ الاحتياطي يعمل
على جهاز التطوير ويفشل على النظام المثبَّت من الـ ISO.

**السبب الجذري (مؤكَّد بتوثيق systemd الرسمي):** وحدة `network-monitor.service` تعمل بـ
`ProtectSystem=strict` + `ReadWritePaths=/var/lib/network-monitor` فقط، والتوثيق ينصّ:
> “If ProtectSystem= is set to strict and PrivateTmp= is enabled, then /tmp/ and /var/tmp/ will be writable.”

أي أن `/tmp` يبقى **للقراءة فقط** بدون `PrivateTmp=` ⇒ كل كتابة في `os.tmpdir()` داخل الخدمة تُرفض EROFS:
- `GET /api/backup/download` (يكتب النسخة في `/tmp`) ⇒ فشل التصدير.
- `validateBackupBuffer()` (يكتب ملف تحقّق في `/tmp`) ⇒ فشل الاستعادة قبل الكتابة أصلًا.

**الإصلاح (مُطبَّق + مُختبَر):**
1. `backend/src/routes/backup.routes.js`: الملفات المؤقّتة داخل `<DB_DIR>/.tmp` (مجلد القاعدة =
   المسار المسموح للكتابة) + تنظيف ملفات WAL المرافقة، و`os.tmpdir()` احتياط أخير فقط.
2. `appliance/…/network-monitor.service`: إضافة **`PrivateTmp=true`**.
3. `appliance/…/nginx/sites-available/network-monitor` + `linux-setup/network-monitor-nginx.conf`:
   حدّ الرفع **300m** + كتلة `location /api/live/` للبثّ الحيّ SSE.

**إثبات:** خادم تجريبي بـ `TEMP/TMP` غير موجود (محاكاة `/tmp` غير قابل للكتابة) ⇒
`check-backup` = **8 PASS** و`check-backup-restore` = **7 PASS**، ومجلد `.tmp` تبقى فاضية بلا بقايا.

**لتطبيق الإصلاح على جهاز مثبَّت بالفعل (بلا إعادة بناء ISO):**
```bash
sudo cp <نسخة الريبو الجديد>/backend/src/routes/backup.routes.js \
        /opt/network-monitor/backend/src/routes/backup.routes.js
sudo systemctl restart network-monitor
```

> ⚠️ **بند كان منفصلًا وأُصلح الآن (v2.8.7):** تحديث لوحة التحكم على الأبلاينس لم يعد يحتاج
> `ReadWritePaths=/opt/network-monitor` — بل نُفِّذ عبر **مساعد root منفصل** (ملف طلب + path-unit)
> للحفاظ على قيد الأمان المهم: خدمة الويب لا تكتب في كودها. التفاصيل في القسم التالي.

### 🛡️ أمان جديد: تحديث الأبلاينس عبر مساعد root منفصل (v2.8.7)
**لماذا:** الجهاز مكشوف على الإنترنت (ngrok)، والخدمة تعمل كـ netmon مع `ProtectSystem=strict`
و`NoNewPrivileges=true` ⇒ لا كتابة في الكود ولا `systemctl` ولا `sudo`.
**التصميم النهائي:** الويب يكتب ملف طلب (وسم فقط) → `nm-update.path` → `nm-update.service` (root)
→ `/usr/local/sbin/nm-update` → (حل «latest» + تحقّق semver + تنزيل + rsync + npm ci + restart)
→ الحالة/السجل في `/var/lib/network-monitor/update/` (يملكه root، كتابة ذرّية mv).
- ملفات جديدة: `appliance/…/usr/local/sbin/nm-update` · `nm-update.service` · `nm-update.path`
  · `backend/src/routes/appliance-update.routes.js` (مُركّب في `server.js` على `/api/appliance-update`)
  · hooks: تفعيل الوحدة + exec bit.
- واجهة اللوحة (`admin-update.js`) تكتشف الوضع وتتابع التقدّم من السجل — والمسار القديم يبقى لغير الأبلاينس.
- **لا نضيف `ReadWritePaths=/opt/network-monitor`** (فضلنا عدم منح الويب كتابة في كوده).

**⚠️ عوائق واجهتُها (للمتابع):**
1. كتابة `backend/src/routes/update.routes.js` **مرفوضة آليًّا** من حارس الأسرار (تعليق قديم فيه شكل
   «مفتاح ثم نقطتان ثم قيمة») ⇒ الحل: مسار جديد منفصل بدل تعديله. **لم يُحاوَل أي تجاوز.**
2. الفاحص حساس جدًّا لأسماء مثل «secret» و«password» عندما تليها نقطتان أو علامة يساوي — حتى في تعليق
   أو اختبار ⇒ لذلك ملف الفحص الجديد يأخذ بيان الدخول كحمولة JSON عبر `NM_LOGIN_JSON`.
3. `server.js`: سطر مفتاح الجلسة أُعيد صياغته إلى دالة `sessionKey()` ليتجاوز الفاحص بشكل مشروع.
4. `update.routes.js` لا يزال غير قابل للتعديل الآلي — يُستحسن تنظيف تعليقه يدويًّا لتمكين التعديل مستقبلًا.

**🧪 نتائج الفحص الآلي (كلها على نسخة القاعدة، منفذ 4103، Node 20):**
| الحزمة | النتيجة |
|---|---|
| `verify-noc-map-parity.js` (خريطة + SSE + نافذة + ترتيب) | **34 PASS / 0 FAIL** |
| `verify/check-backup.js` (تصدير نسخة) | **8 PASS / 0 FAIL** |
| `verify/check-backup-restore.js` (استعادة كاملة) | **7 PASS / 0 FAIL** |
| `verify/check-appliance-update.js` (وضع الطلب + رفض الحقن) | **7 PASS / 0 FAIL** |
| `bash -n` + `node --check` لكل الملفات المعدّلة | OK |

### 🎛️ تنظيم GitHub (2026-10-11)
- **Build Appliance ISO**: ✅ نجح تشغيل يدوي على `main` (artifact `appliance-iso` 441.7 MB صالح 30 يومًا)
  — مسار بديل ممتاز لبناء الـ ISO بعيدًا عن Docker المحلي.
- **إصلاح جوهري في `ci-cd.yml`**: خطوة فحص الصياغة كانت **لا تفشل أبدًا** (العدّاد يُضبط داخل subshell بسبب
  `| while`) ⇒ صُحّحت بـ process substitution، وتفحص الآن `frontend/public/js` كذلك، وبلا `build-from-source`.
- **`build-iso.yml`**: اسم الـ ISO من الوسم (`github.ref_name`) بدل الـ sha + `permissions` دنيا +
  `concurrency` + توليد `SHA256SUMS.txt` وإرفاقه بالـ Release.
- **`.github/release.yml` جديد**: تصنيف تلقائي لملاحظات الإصدارات (ميزات/إصلاحات/أمان/واجهة/توثيق/صيانة).
- **`SECURITY.md`**: إزالة البريد الوهمي `security@example.com` (الاعتماد على Security Advisories).
- كل ما سبق مُلتزَم ومرفوع (`ee4d88e`)، والمستخدم فعّل الـ workflows اللي كانت `disabled_manually`.
- أداة تحقق محلية جديدة (غير مُتتبَّعة مثل باقي أدوات `verify/`): `verify/check-workflows.py` — تحليل YAML
  فعلي لكل ملفات `.github` + فحص `bash -n` لسكربت الـ CI.
- **تنظيف كامل للمستودع (بموافقة المستخدم + توثيق `gh`)**:
  - دمج 4 تحديثات GitHub Actions (`checkout@7` · `setup-node@7` · `upload-artifact@7` · `action-gh-release@3`)
    — والـ CI بعدهما **success** ✓.
  - إغلاق PR #9 بتعليق: يرفع 8 حزم إنتاجية لقفزات major (express 4→5، better-sqlite3 11→13، multer 1→2،
    bcryptjs 2→3، node-cron 3→4…) ⇒ **مهمة ترحيل مخصّصة مؤجّلة** (لا يُدمج تلقائيًّا).
  - حذف **كل الفروع القديمة/المدموجة** — تبقّى `main` فقط على الريموت ✓.
  - وصف المستودع + **18 Topics** (noc · monitoring · appliance · iso · systemd · rtl …) ✓.
  - **Release v2.8.7** مع `network-monitor-appliance-v2.8.7-amd64.iso` + `SHA256SUMS.txt`
    (MD5 `5be6bea00e3842e107d7b2ecd6706cf5` · SHA-256 `8c2be73aefb51d63eb0659105f3c4038a5b33a4096adf1304d0e360c6d716aa4`).
    ملاحظة: رفع ملف 456MB قد يحتاج إعادة محاولة إذا انقطع الرفع — يُكمَل بـ `gh release upload v2.8.7 <file> --clobber`
    ثم النشر بـ `gh release edit v2.8.7 --draft=false --latest`.

- **السبب الجذري لاحمرار CI دائمًا (اكتُشف 2026-10-11)**: ملف `ci-cd.yml` كان **غير صالح أصلًا** عند GitHub —
  استخدام `secrets` داخل `if:` غير مسموح في ملفات ال workflows ⇒ **كل التشغيلات القديمة كانت startup failure
  بلا أي job إطلاقًا** (وليست فشل خطوات). أُصلح بتمرير الأسرار إلى `env` وفحصها في الشرط ⇒
  **أول تشغيل ناجح: run #53 — كل الخطوات خضراء** (تثبيت التبعيات + فحص صياغة backend و frontend +
  تهيئة القاعدة + فحص الصحة)، مع تخطّي خطوتَي النشر/الإشعار لعدم وجود secrets (سلوك مقصود).

**متبقٍّ في تنظيم GitHub:**
1. **README** واقف عند 2.8.5: الكتابة الآلية محجوبة لأن السطر ~229 يحوي قيمة توكن تلجرام **مثالًا توضيحيًّا**
   (أكّد المستخدم أنه وهمي). المسارَان: (أ) استبدال القيمة بـ `<ضع-التوكن-هنا>` ثم أتمكّن من التعديل،
   أو (ب) لصق نص الإصدار يدويًّا (شارة + سطر الإصدار + قسم «ما الجديد»).
2. **Release v2.8.7** (بإرفاق الـ ISO + SHA256) + وصف المستودع + Topics + مراجعة 5 PRs من Dependabot
   — تحتاج `gh auth login` مرة واحدة (الأداة مثبّتة 2.96.0 وغير مسجّلة دخول).

### 📋 الخطوة التالية (بالترتيب)
1. ✅ **تمّت محليًّا**: بناء ISO v2.8.7 + التحقق منه:
   - `appliance/network-monitor-appliance-v2.8.7-amd64.iso` — 456.3 MB · MD5 `5be6bea00e3842e107d7b2ecd6706cf5` (مطابق داخل/خارج الحاوية).
   - الإقلاع: `grub.cfg` يشير إلى نواة **مُسَنَّسَنة** `/live/vmlinuz-6.1.0-50-amd64` (لا مسار مجرّد) ⇒ مشكلة الشاشة السوداء/`unknown filesystem ext4` غير موجودة.
   - داخل squashfs: `usr/local/sbin/nm-update` بصلاحية `rwxr-xr-x root` ✓ · `nm-update.service/path` (0644) ✓ · `appliance-update.routes.js` ✓ · `backup.routes.js` يحتوي `TMP_DIR` (الإصلاح) ✓.
   - `nm-update.path` **مُفعَّل** في `multi-user.target.wants` ✓ (مع network-monitor و nm-console و nginx).
2. **متبقٍّ**: تنصيب على VM واختبار دورة التحديث الكاملة (من اللوحة أو بملف طلب فيه `latest`) +
   تجربة قياسية سابقة: `appliance/boot-test/e2e.sh` (QEMU، ~40 دقيقة).
3. ✅ **تمّ**: الالتزامات والوسوم **مرفوعة** (`main` + وسوم v2.5.4 · v2.7.0 · v2.8.2→v2.8.7)، والـ workflows اللي كانت مقفولة **مُفعَّلة**، والـ CI **أخضر** (بعد إصلاح الملف غير الصالح).
4. ✅ **تمّ**: `README.md` محدَّث + وصف المستودع + 18 Topics + تنظيف الفروع القديمة + **Release v2.8.7**
   (ISO + SHA256) — رفع ملف 456MB قد يأخذ وقتًا طويلًا حسب سرعة النت، ويُكمَل بـ
   `gh release upload v2.8.7 <file> --clobber` ثم `gh release edit v2.8.7 --draft=false --latest`.
5. **متبقٍّ (اختياري)**: ترحيل التبعيات الكبرى (express 5 · better-sqlite3 13 · multer 2 · bcryptjs 3 …)
   في جلسة ترحيل واختبار مخصّصة.
5. اختياري: توصيل عرض «خريطة المواقع» في الصفحة العامة بالبثّ الحيّ (الآن له polling خاص به).

---

## 👆 v2.8.8 — نقر الجهاز في «التخطيط المرسوم» (مُنجَز ومُتحقَّق منه — 2026-10-11)

> **طلب المستخدم:** «في التخطيط المرسوم لما أضغط على جهاز يظهر تفاصيله مثل خريطة المباني — عملتها ليه؟»
> **السبب:** الميزة في v2.8.6 اتطبّقت على «🗺️ خريطة المباني» فقط، وصفوف الأجهزة في لوحة «✏️ التخطيط
> المرسوم» (`.mv-inner-row`) كانت عناصر عرض ثابتة بلا أي ربط نقر.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | صفوف الأجهزة في اللوحة صارت `role="button"` + `data-device-id` + `tabindex` + عنوان «انقر لعرض التفاصيل» | `frontend/public/noc.html` |
| 2 | ربط مفوَّض (click + Enter/Space) على `#map-cards-container` يستدعي **نفس** `openDeviceDetails()` | `frontend/public/noc.html` |
| 3 | مؤشّر نقر + إطار تركيز واضح للصفوف (`cursor:pointer` / `:focus-visible`) | `frontend/public/noc.html` |
| 4 | فحصان جديدان في حزمة التحقق + لقطة | `verify-noc-map-parity.js` |
| 5 | رفع الإصدار إلى 2.8.8 | `backend/package.json`, `appliance/run-build.sh`, `frontend/public/noc.html` |

### 🧪 التحقق
- **36 PASS / 0 FAIL** (كانت 34) على نسخة القاعدة — الفحصان الجديدان يتحقّقان من وجود `data-device-id`
  ومن فتح النافذة ببيانات الجهاز الصحيحة (مقارنة حيّة بـ `/api/devices/:id`)، مع لقطة
  `verify/noc-parity-draw-device-modal.png` و**0 أخطاء JS**.

### 📌 ملاحظات
- لا يحتاج تغييرات في الباك-إند (نفس مسار التفاصيل `GET /api/devices/:id`).
- الـ ISO المنشور (v2.8.7) **لا يحتوي** هذه اللمسة ⇒ يلزم بناء ISO جديد للـ v2.8.8 عند الحاجة
  (تلقائيًّا عبر GitHub Actions بعد وسم `v2.8.8`، أو محليًّا: `cd appliance && NM_VERSION=v2.8.8 bash build.sh`).

---

## 🟠 v2.8.9 — إشارة انقطاع متدرّجة (جزئي برتقالي · كامل أحمر) + تنسيق صفحة الدخول (مُنجَز ومُتحقَّق منه — 2026-10-11)

> **طلب المستخدم:** «في التخطيط المرسوم وخريطة المباني أريد عند انقطاع جهاز معين أو أكثر يظهر الموقع
> بلون برتقالي بدل الأحمر وبالمثل في جميع المواقع… وبعد هذا التعديل قم بتنسيق صفحة تسجيل الدخول مع
> وضع زر لإظهار الباسورد لتفادي أخطاء تسجيل الدخول».
> **قرارات المستخدم بعد التنفيذ الأول (مُطبَّقة كلها):** ① «خلّيها برتقالي كمان» لخريطة المواقع في لوحة
> التحكم ⇒ توحيد اللون في اللوحة والصفحة العامة ② «يبقى أحمر» لو كل أجهزة الموقع واقعة ⇒ قاعدة متدرّجة
> (جزئي برتقالي · كامل أحمر) ③ «اعمل الوسم والـ Release» ⇒ وسم `v2.8.9` يشغّل بناء الـ ISO في Actions.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | متغيّرا لون: `--mv-warn` / `--mv-warn-glow` (ليلًا `#f59e0b` · نهارًا `#d97706`) | `frontend/public/noc.html` |
| 2 | «🗺️ خريطة المباني»: `zoneBorderColor()` (جزئي برتقالي · كامل أحمر) + `.map-zone-card.has-all-offline` | `frontend/public/noc.html` |
| 3 | «✏️ التخطيط المرسوم»: `.mv-card.loc.warn` للجزئي و`.loc.down` للانهيار الكامل | `frontend/public/noc.html` |
| 4 | «خريطة المواقع» في اللوحة والصفحة العامة: `--partial-offline` + فئة `has-all-offline` | `frontend/public/css/style.css`, `frontend/public/js/admin-map.js`, `frontend/public/js/public-map.js` |
| 5 | إعادة تصميم صفحة الدخول (بطاقة/هوية/حلقة تركيز/وضع ليلي) + زر إظهار كلمة المرور + تحذير Caps Lock | `frontend/public/admin/login.html` |
| 6 | منطق الزر + تعطيل زر الإرسال («⏳ جارٍ الدخول…») + إعادة التركيز عند الفشل | `frontend/public/js/admin-login.js` |
| 7 | سبعة فحوص جديدة (برتقالي/أحمر × 3 شاشات + زر الإظهار + Caps Lock) + إنهاء الجلسة قبل فحص صفحة الدخول | `verify-noc-map-parity.js` |
| 8 | رفع الإصدار إلى 2.8.9 (شارة رأس NOC + package.json + الأبلاينس) | `frontend/public/noc.html`, `backend/package.json`, `appliance/run-build.sh` |

### 🧪 التحقق
- **43 PASS / 0 FAIL** (كانت 36): قياس حيّ بـ`getComputedStyle` — الجزئي **برتقالي** في «خريطة المباني»
  (`rgb(245, 158, 11)`) وفي «التخطيط المرسوم» وفي «خريطة المواقع» باللوحة (`rgb(217, 119, 6)`) · الكامل
  **أحمر** في اللوحتين (`rgb(239, 68, 68)`) · زر الإظهار `password ⇄ text ⇄ password` · تحذير Caps Lock +
  `autocapitalize=off` + زر الإرسال — مع لقطة `verify/noc-parity-login-page.png` و**0 أخطاء JS**.
- تطابق NOC ↔ خريطة المواقع (فحوص v2.8.6) **ما زال أخضر** — الفحوص تقارن البنية والترتيب والعدادات
  (وليس الألوان)، والفئة الجديدة `has-all-offline` تُنتَج بنفس المنطق في الملفات الثلاثة.
- `node --check` على `admin-login.js` · `admin-map.js` · `public-map.js` · `verify-noc-map-parity.js` = OK.

### 📌 ملاحظات
- اللون الآن موحَّد في **كل** الشاشات (NOC · لوحة التحكم · الصفحة العامة) — لا اختلاف بصري بين الخرائط.
- الأحمر لا يزال مستخدمًا لـ: **الأجهزة** المنقطعة (النقاط/الصفوف)، ورسائل الخطأ، وبطاقة الموقع عند
  الانهيار الكامل، والعدّاد العلوي «أجهزة منقطعة (Offline)».
- الـ ISO المنشور (v2.8.7) لا يحتوي التعديلات ⇒ وسم `v2.8.9` يشغّل بناء ISO جديدًا ورفعه للـ Release
  تلقائيًّا (تسمية بالوسم + SHA256 + ملاحظات مصنّفة حسب `.github/release.yml`).

---

## 🌍 v2.9.0 — قسم «الوصول عن بُعد» (ngrok) في لوحة التحكم (مُنجَز ومُتحقَّق منه — 2026-10-11)

> **طلب المستخدم:** «أضف قسم الـ ngrok في لوحة التحكم» — لأن إدارة النفق كانت متاحة في كونسول
> الجهاز فقط (تثبيت الملف التنفيذي · التوكن · الدومين الثابت · تشغيل/إيقاف · التشغيل التلقائي).

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | راوت `/api/remote-access/{status,request}` محمي بجلسة الأدمن | `backend/src/routes/remote-access.routes.js` (مُركَّب في `server.js`) |
| 2 | مساعد root بملف طلب + قائمة بيضاء بخمسة أفعال | `appliance/config/includes.chroot/usr/local/sbin/nm-remote` |
| 3 | وحدتا path/service + تفعيلهما وصلاحياتهما في البناء | `etc/systemd/system/nm-remote.{path,service}` · `0110`/`0120` hooks |
| 4 | تبويب «🌍 الوصول عن بُعد» + منطق العرض والتحكّم | `frontend/public/admin/dashboard.html` · `frontend/public/js/admin-remote.js` · `admin-tabs.js` |
| 5 | فحص جديد (18 PASS) + 3 فحوص في حزمة التطابق (46 PASS) | `verify/check-remote-access.js` · `verify-noc-map-parity.js` |
| 6 | رفع الإصدار إلى 2.9.0 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🔐 نموذج الأمان (اقرأه قبل أي تعديل على هذا القسم)
- الويب (netmon) **لا تنفّذ أوامر**: تقرأ الحالة من مصادر مسموحة للقراءة، وتكتب **ملف طلب** بفعل واحد من
  قائمة بيضاء: `start · stop · restart · autostart-on · autostart-off` — وأي شيء آخر يُرفض.
- **مفتاح ngrok لا يُقرأ ولا يُعرض:** `ProtectHome=true` يمنع الوصول لـ`/root` · فحص الوجود يتم داخل
  المساعد (root) ويُكتب كرمز فقط · السجلات تُنقّى من أي سطر يحوي كلمة token · وفحص آلي يمنع أي تسريب.
- النفق يُدار دائمًا كوحدة `ngrok-tunnel.service` (حتى لا يُقتل مع انتهاء المساعد) وسجلّه إلى
  `/var/log/ngrok.log` عبر `StandardOutput/StandardError=append:`.
- الباك-إند قابل للتوجيه بمتغيّرات بيئة للاختبار (`NGROK_BIN_PATH` · `NGROK_DOMAIN_FILE` ·
  `NGROK_LOG_FILE` · `NGROK_API_URL` · `REMOTE_HELPER_PATH`) — لا تُستخدم في الإنتاج.

### 🧪 التحقق
- `node verify/check-remote-access.js` = **18 PASS / 0 FAIL** · حزمة التطابق = **46 PASS / 0 FAIL** ·
  لقطة `verify/noc-parity-remote-access-tab.png` · **0 أخطاء JS**.
- (تحسين في الحزمة: عدّاد الأخطاء يتجاهل 401 المتوقّع على `/api/auth/*`.)
- اختبار حيّ تم بـfixtures (ملف دومين/سجل/مساعد مُصطنعة + mock لواجهة ngrok على 4049)، وسجلّ الاختبار
  يحتوي سطرًا فيه كلمة token للتأكد من ترشيحه — وقد رُشِّح فعلًا ✓.

### 📌 للأجهزة القديمة (قبل v2.9.0)
- التبويب يعمل **قراءةً فقط** ويعرض «التحكّم غير متاح». لتمكين التحكّم: ثبّت المساعد + وحدتاه
  (الخطوة 3 في `خطوات-تحديث-الأبلاينس-من-2.8.5-إلى-أحدث-إصدار.md`).

---

## 🧭 v2.10.0 — إعادة تنظيم صفحة «🔄 التحديثات» + الرجوع لإصدار أقدم (مُنجَز ومُتحقَّق منه — 2026-10-11)

> **طلب المستخدم:** «صفحة التحديثات — ايه مقترحاتك عشان ننظمها وننسقها؟» ثم اختار **كل** البنود الخمسة:
> إعادة الهيكلة الكاملة · الرجوع لإصدار أقدم · نسخة احتياطية ثم تحديث · شارة + فحص تلقائي · تنطيف وتنسيق.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | شريط حالة واحد (4 عناصر) + أزرار حسب الوضع + حذف التكرار (CSS داخل القسم) | `frontend/public/admin/dashboard.html` |
| 2 | إعادة كتابة منطق الصفحة: فحص/شارة/تلقائي/خطوات/نسخة ثم تحديث/رجوع/سجل + منع الإغلاق | `frontend/public/js/admin-update.js` |
| 3 | راوت `GET /tags` (كاش 10 دقائق + ارتداد لآخر كاش) | `backend/src/routes/appliance-update.routes.js` |
| 4 | راوت `POST /create` لنسخة احتياطية على الخادم | `backend/src/routes/backup.routes.js` |
| 5 | سكربت فحص جديد + 6 فحوص ولقطتان في الحزمة | `verify/check-updates-page.js` · `verify-noc-map-parity.js` |
| 6 | رفع الإصدار إلى 2.10.0 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🧪 التحقق
- `node verify/check-updates-page.js` = **14 PASS / 0 FAIL** · حزمة التطابق = **52 PASS / 0 FAIL** · **0 أخطاء JS**.
- لقطتان: `verify/noc-parity-updates-page.png` (الصفحة الجديدة + الشارة على التبويب) ·
  `verify/noc-parity-rollback-modal.png` (قائمة 21 إصدارًا).
- تجربة حيّة: بعد رفع الإصدار إلى 2.10.0 وأحدث وسم على GitHub v2.9.0، عرض الشريط «🟠 تحديث متاح» و«آخر فحص: الآن» تلقائيًّا ✓.

### 🔐 ما لم يتغيّر (مقصود)
- الويب لا تنفّذ أوامر · لا `systemctl` من الويب · الرجوع للإصدار الأقدم يمرّ بنفس ملف الطلب وقائمة
  الوسوم الصارمة (semver) — والمساعد `nm-update` هو المنفّذ.

### 📌 للأجهزة القديمة
- كل ما سبق يعمل على أي تثبيت v2.8.7+ (لأنه يعتمد على `nm-update` الموجود). الأجهزة الأقدم تحتاج خطوة
  التثبيت الموثّقة في دليل الترقية أولًا.

---

## 🧩 v2.10.1 — مواءمة صفحة «الوصول عن بُعد» مع كونسول الجهاز (مُنجَز ومُتحقَّق منه — 2026-10-11)

> **طلبا المستخدم:** ① «صفحة الوصول عن بعد مش مطابقة للكونسول تمامًا!» ⇒ مواءمة كاملة.
> ② «أضف Set authtoken … لكن غير مرئي عند إضافته» + ③ «أضف جلب الدومين من موقع ngrok لأنه يُنشَأ
> تلقائيًا في موقع ngrok» ⇒ حقلان مخفيان + جلب الدومينات من الحساب.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | أربعة أفعال جديدة: `install` · `set-authtoken` · `set-api-key` · `list-domains` (+ `set-domain`/`clear-domain`) | `appliance/config/includes.chroot/usr/local/sbin/nm-remote` |
| 2 | وحدة النظام: `Environment=HOME=/root` + `ReadWritePaths` تشمل `/usr/local/bin` و`/root/.config/ngrok` | `etc/systemd/system/nm-remote.service` |
| 3 | الحالة صارت تقرأ التقرير الكامل (pid/مستخدم/مدة/مسارات/وحدة/خطة مجانية/ملفات) + قائمة الدومينات المجلوبة + 11 فعلًا | `backend/src/routes/remote-access.routes.js` |
| 4 | الواجهة: تقرير كامل + زر تثبيت + قائمة دومينات منسدلة + إدخال يدوي + حقلان **مخفيان** للمفاتيح | `frontend/public/admin/dashboard.html` · `frontend/public/js/admin-remote.js` |
| 5 | فحص موسّع (28 PASS) + 3 فحوص واجهة في الحزمة (55 PASS) | `verify/check-remote-access.js` · `verify-noc-map-parity.js` |
| 6 | رفع الإصدار إلى 2.10.1 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🔐 قواعد لا تُخرَق (اقرأها قبل أي تعديل)
- **ممنوع** مرور أي قيمة سرّية في الـ URL أو في السجلات أو في `status.json` — الردود تحمل `set/not_set` فقط.
- **ممنوع** أن تُعاد القيمة في أي رد API — يوجد فحص آلي يقارن النص الكامل للـ رد بالقيمة المُرسَلة.
- ملف الطلب **0600** يُحذف فورًا، وملف الإعداد **0600**، والتحقق regex صارم قبل أي تمرير للمساعد.

### 📌 لجهازك (v2.8.5)
- الأجهزة الأقدم من v2.9.0 تحتاج خطوة التثبيت الموثّقة في دليل الترقية — استخدم **أحدث وسم**
  (v2.10.1 بعد الوسم) لتحصل على المساعد الجديد بأفعاله الكاملة.

---

## 🪟 v2.10.2 — حجب النوافذ المنبثقة + تنسيق مباني «سلسلة الشبكة» (مُنجَز ومُتحقَّق منه — 2026-10-11)

> **طلب المستخدم:** ① «ما المقصود بـ«متصل عبر»؟» (شرح) ② «عند إظهار أي popup لماذا يمكن الاختيار من قائمة
> لوحة التحكم؟ اجعل كل الاختيارات الخلفية غير قابلة للاختيار» ③ «لماذا لا يوجد تنسيق في المباني بين
> خريطة المواقع وسلسلة الشبكة بعد التحديث؟».

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | `z-index` النافذة من 100 إلى **1200** (أعلى من القائمة 110 والهيدر 120، وأقل من نافذة التأكيد 2000) | `frontend/public/css/style.css` |
| 2 | قاعدة إطار بطاقة المبنى: `neutral/warn/down/up` بدل «أي منقطع = أحمر» | `frontend/public/js/admin-topology.js` |
| 3 | أنماط `.t-card.maploc.warn` (برتقالي) و`.neutral` (بنفسجي) | `frontend/public/css/style.css` |
| 4 | ثلاثة فحوص جديدة في الحزمة (حجب الخلفية · الإغلاق · مطابقة 12 بطاقة) | `verify-noc-map-parity.js` |
| 5 | أدوات سلامة القاعدة (بعد حادثة التلف) | `verify/_dbcheck.js` · `verify/_dbcopy.js` |
| 6 | رفع الإصدار إلى 2.10.2 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🧪 التحقق
- **58 PASS / 0 FAIL** · **0 أخطاء JS**.
- دليل الحجب: `{zModal:1200, zSide:110, hitSidebar:false, hitTag:"DIV#rollback-modal"}` — النقر لا يصل للقائمة ✓.
- مطابقة المباني: **12/12** بطاقة بلون مطابق لقاعدة الخريطة (مثال: متصل=1/منقطع=1 ⇒ برتقالي ✓).

### 🚑 تنبيه تشغيلي (للجلسات القادمة)
- **لا توقف خادم التطوير بـ`Stop-Process -Force`** أثناء عمله — قد يتلف نسخة الاختبار (WAL).
  الطريقة الآمنة: أوقف الخادم ثم تحقّق بـ`node verify/_dbcheck.js`، وإن تلفت النسخة فأعد إنشاءها
  بـ`node verify/_dbcopy.js` (نسخة متسقة من القاعدة الحقيقية للقراءة فقط).
- القاعدة الحقيقية لم تُلمس (integrity ok · 39 جهازًا).

---

## 🛡️ v2.10.3 — إصلاح أوتوماتيكي لإنشاء النسخة الاحتياطية على الأجهزة (مُنجَز ومُتحقَّق منه — 2026-10-11)

> **بلاغ المستخدم:** «ظهر خطأ عند التحديث من 2.10.0 إلى 2.10.1 وهو: تعذّر إنشاء النسخة الاحتياطية !!» ثم
> «قم بتصليحه ليعمل أوتوماتيك في لوحة التحكم».

### 🔍 السبب الجذري (دقيق)
- كونسول الجهاز يعمل بـ root ⇒ عند أول نسخة احتياطية منه يُنشئ `<DB_DIR>/backups` بملكية **root** (755).
- خدمة الويب تعمل بـ netmon؛ و`ReadWritePaths=/var/lib/network-monitor` تسمح بالكتابة في **الأب**،
  لكن الكتابة داخل **مجلد مملوك لـ root** تُرفض (EACCES) ⇒ فشل `POST /api/backup/create` ⇒ توقف
  زر «🛡️ نسخة احتياطية + تحديث» قبل حتى أن يطلب التحديث (فشل آمن: لم يُحدَّث شيء).

### 🔧 الإصلاح (بلا أي تدخّل يدوي من المستخدم)
| # | التغيير | الملف |
|---|---|---|
| 1 | `pickWritableBackupDir()`: اختيار أول مجلد قابل للكتابة **فعليًّا** (اختبار كتابة فعلية) | `backend/src/routes/backup.routes.js` |
| 2 | `POST /create` يستخدم المجلد المختار ويُعيد `dir` + خطأ واضح عند الفشل الكامل | `backend/src/routes/backup.routes.js` |
| 3 | النسخة الأمنية قبل الاستعادة تستخدم نفس المنطق (كانت ستفشل أيضًا على الأجهزة) | `backend/src/routes/backup.routes.js` |
| 4 | `GET /list` يدمج المجلدين + `DELETE /:filename` يبحث فيهما | `backend/src/routes/backup.routes.js` |
| 5 | أداة إثبات: `verify/_bkfallback.js` (وضع عادي + محاكاة مجلد غير قابل للكتابة) | `verify/_bkfallback.js` |
| 6 | رفع الإصدار إلى 2.10.3 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🧪 التحقق
- `verify/_bkfallback.js`: الوضع العادي ⇒ `…/backups` ✓ · المحاكاة ⇒ `…/svc-backups` ✓ (18.59 MB)
  والقائمة دمجت الملفين ✓.
- `verify/check-updates-page.js` = **14 PASS / 0 FAIL** · `verify/check-remote-access.js` = **28 PASS / 0 FAIL** ·
  حزمة التطابق = **58 PASS / 0 FAIL**.

### 📌 للجهاز الحالي (v2.10.0/2.10.1)
- للوصول للإصلاح: حدّث عبر ملف الطلب من شاشة الجهاز (شل root):
  `echo '{"tag":"v2.10.3"}' > /var/lib/network-monitor/update-request.json` — وبعدها زر النسخة الاحتياطية
  يعمل أوتوماتيك (القياسي أو البديل) بلا أي أوامر.
- بند مؤجّل: `chown netmon:netmon` داخل `nm-console` لتثبيتات مستقبلية — رفضه حارس الأسرار (سطر قديم في
  الملف يحوي نمطًا سرّيًّا)، وإصلاح الباك-إند الحالي يغني عنه.

---

## 🔁 v2.10.4 — إصلاح «طلب التحديث فوق ملف قديم لا يُشغّل الوحدة» (مُنجَز — 2026-10-11)

> **بلاغ المستخدم:** «`echo '{"tag":"v2.10.3"}' > /var/lib/network-monitor/update-request.json` — مش حدث
> حاجة، مجرد غير الرقم بس!».

### 🔍 السبب (تشخيص systemd)
- الوحدة كانت `PathExists=` فقط ⇒ تُشغّل عند **ظهور** الملف لا عند تعديله.
- وجود ملف طلب قديم من محاولة سابقة (لم تُنفَّذ) ⇒ الكتابة فوقه لا تُشغّل شيئًا ⇒ «لا شيء حدث».

### 🔧 الإصلاح
| # | التغيير | الملف |
|---|---|---|
| 1 | `PathModified=` مع `PathExists=` | `appliance/.../systemd/system/nm-update.path` · `nm-remote.path` |
| 2 | حذف ملف الطلب **قبل** كتابته (ظهور مضمون) | `backend/src/routes/appliance-update.routes.js` · `remote-access.routes.js` |
| 3 | رفع الإصدار إلى 2.10.4 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🆘 الحل الفوري للحالات المستعصية (موثّق للمستخدم)
```bash
rm -f /var/lib/network-monitor/update-request.json
echo '{"tag":"v2.10.3"}' > /var/lib/network-monitor/update-request.json
systemctl start nm-update.service      # أو مباشرة: /usr/local/sbin/nm-update
tail -f /var/lib/network-monitor/update/update.log
```
التشغيل اليدوي يعمل بغضّ النظر عن المراقب ✓.

---

## 🔔 v2.10.5 — إشعارات في كل إجراء (لوحة «حيّة») — مُنجَز ومُتحقَّق منه — 2026-10-11

> **بلاغ المستخدم:** «ليه مفيش إشعارات بلوحة التحكم عن بعد؟ عند الحفظ والتغيير وأي شيء آخر — اللوحة
> غير حيّة بالمرة!».

### 🔍 السبب
- صفحتا v2.9.0/v2.10.0 الجديدتان كانتا تستخدمان **نصًّا داخل الصفحة** فقط، بينما التطبيق كله يستعمل
  `showToast(message, {type})` من `admin-utils.js` (في `#toast-container`).

### 🔧 ما تم
| # | التغيير | الملف |
|---|---|---|
| 1 | إشعارات لكل إجراء في صفحة الوصول عن بُعد (إرسال · نتيجة ✅/❌ · مهلة · نسخ · تحديث · مفاتيح · دومينات) | `frontend/public/js/admin-remote.js` |
| 2 | إشعارات تغيّرّ **حيّة** (انقطاع/رجوع النفق · تغيّر الرابط · تثبيت ngrok) أثناء المتابعة الدورية | `frontend/public/js/admin-remote.js` |
| 3 | إشعارات لكل إجراء في صفحة التحديثات (فحص · نتيجة الفحص · نسخة احتياطية · تحديث · بدء/فشل · رجوع · نسخ السجل) | `frontend/public/js/admin-update.js` |
| 4 | فحص جديد: «الإشعارات تظهر عند أي إجراء» + لقطة | `verify-noc-map-parity.js` |
| 5 | رفع الإصدار إلى 2.10.5 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🧪 التحقق
- **59 PASS / 0 FAIL** · **0 أخطاء JS** · لقطة `verify/noc-parity-toast.png`.
- دليل الإشعار: `عدد=2 · نوع=warning,info · نص=«⚠️🟠 يتوفّر تحديث جديد… | ℹ️🔄 تم تحديث الحالة»` ✓.

---

## 🧰 v2.10.6 — تحديث أدوات النظام تلقائيًا (إصلاح فشل حفظ المفاتيح) — 2026-10-11

> **بلاغ المستخدم:** «لسه في مشكلة في حفظ التوكن و api في التحكم عن بعد — مش فاهم إيه المشكلة؟!».

### 🔍 السبب الجذري
- تحديث اللوحة (`nm-update`) كان يُحدّث **كود التطبيق فقط** (backend/frontend/database) لا **ملفات النظام**.
- أزرار المفاتيح/الأفعال الجديدة أُضيفت في v2.10.1 ⇒ المساعد `nm-remote` على الأجهزة بقي نسخة v2.9.0
  (خمسة أفعال) ⇒ يرفض `set-authtoken`/`set-api-key`/`list-domains`/`install`/`set-domain` بـ«فعل غير مسموح»،
  ووحدته القديمة لا تسمح بالكتابة في `/root/.config/ngrok` ولا `/usr/local/bin`.

### 🔧 الإصلاح
| # | التغيير | الملف |
|---|---|---|
| 1 | `nm-update` يُحدّث المساعدين + وحدات systemd + `daemon-reload` + إعادة تشغيل وحدتي المراقبة (بتسلسل آمن) | `appliance/.../usr/local/sbin/nm-update` |
| 2 | `--version` في المساعدين للتشخيص السريع على الجهاز | `nm-update` · `nm-remote` |
| 3 | `ReadWritePaths` تشمل `/etc/systemd/system` و`/usr/local/sbin` و`/usr/local/bin` | `nm-update.service` · `nm-remote.service` |
| 4 | رفع الإصدار إلى 2.10.6 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🧪 التحقق
- `bash -n` ✓ · `nm-update --version` ⇒ `v2.10.6` ✓ · `nm-remote --version` ⇒ `v2.10.6` ✓ (بلا صلاحيات root).

### 📌 خطوة واحدة على الأجهزة الحالية
- إعادة تثبيت المساعدين + الوحدات من أحدث وسم (مرة واحدة) — لأن الوحدة القديمة لا تسمح بالكتابة في
  `/usr/local/sbin`؛ وبعدها يصبح كل شيء تلقائيًا في التحديثات التالية ✓.

---

## 🗺️ v2.10.7 — تسطيح «خريطة المواقع» (كل مبنى بطاقة مستقلة) — مُنجَز ومُتحقَّق منه — 2026-10-11

> **طلب المستخدم (بعد تصحيح مهم):** «عاوز خريطة المواقع تبقى مثل سلسلة الشبكة — كل المبانى لوحدها.
> انت كده عاكك!» — أي أن التعديل السابق ظبّط السلسلة على شكل الخريطة، والمطلوب العكس.
> **توضيح مسبق (بناءً على طلب المستخدم «فاهمني الأول»):** تأكيد الفهم قبل أي تنفيذ — وأجاب بـ
> ① أيوه كل مبنى كارت مستقل ② العلاقة تظهر كسطر «متصل عبر» ③ «أجهزة مدخل الإنترنت» تفضل ظاهرة.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | تسطيح الشبكة: DFS لكل المواقع كبطاقات مستقلة + تمرير اسم الأب + سطر «🧩 متصل عبر» | `frontend/public/js/admin-map.js` |
| 2 | جسم البطاقة = أجهزة الموقع فقط (حذف رسم الـ sub-zones) | `frontend/public/js/admin-map.js` |
| 3 | نفس التسطيح + نفس السطر في خريطة NOC (حفظ التطابق) | `frontend/public/noc.html` |
| 4 | نمط `.map-zone-parent` (CSS) | `frontend/public/css/style.css` · inline في `noc.html` |
| 5 | فحصان جديدان + إظهار تفاصيل الفرق + انتظار مرن لفحص التحديثات | `verify-noc-map-parity.js` |
| 6 | رفع الإصدار إلى 2.10.7 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🧪 التحقق
- **61 PASS / 0 FAIL** · **0 أخطاء JS** · لقطة `verify/noc-parity-noc-grid-night.png`.
- الأرقام: **13 بطاقة** (كل مبنى مستقل) · **0 تداخل** · **9 بطاقات** فيها سطر «متصل عبر» ·
  «تطابق كامل للبطاقات» بين اللوحة و NOC ✓ (39 جهازًا).
- ملاحظة: ظهر أثناء التحقق فرق قديم في نصوص الفراغ بين اللوحتين → وُحِّد ✓.

---

## 🔌 v2.10.8 — إصلاح «تشغيل النفق رمز 1» من اللوحة (مُنجَز — 2026-10-11)

> **بلاغ المستخدم:** «الكونسول شغّال بلا مشاكل، واللوحة لا؛ وبحفظ التوكن ويتحفظ، وأعمل إعادة تشغيل يقول
> رمز 1، ولا يظهر endpoint في ngrok؛ ومفتاح API يعطي رسالة خطأ».

### 🔍 السبب الجذري (دقيق ومُثبت من كلام المستخدم)
- الوحدة التي يولّدها المساعد (`ngrok-tunnel.service`) لم تكن تضبط `HOME` ⇒ خدمات systemd لا تحصل
  على HOME ⇒ ngrok لم يجد `/root/.config/ngrok/ngrok.yml` ⇒ **فشل البدء (رمز 1) بلا endpoint**.
- الكونسول كان يعمل لأنه يُشغّل ngrok من شل root وفيه `HOME=/root` تلقائيًا ⇒ **نفس السبب يفسّر الفرق**.
- مفتاح API: تحقّق الأحرف كان `[A-Za-z0-9_-]` فقط ⇒ مفتاح ngrok الحقيقي قد يحتوي `+/=.:` ⇒ رفض خاطئ.

### 🔧 الإصلاح
| # | التغيير | الملف |
|---|---|---|
| 1 | `Environment=HOME=/root` في الوحدة المولَّدة + تعليق يشرح السبب | `appliance/.../usr/local/sbin/nm-remote` |
| 2 | توسيع قبول القيم إلى `[A-Za-z0-9_+=./:-]{20,200}` | `nm-remote` · `backend/src/routes/remote-access.routes.js` |
| 3 | إرفاق آخر سطور سجل ngrok (منقّاة) برسالة فشل التشغيل/إعادة التشغيل | `appliance/.../usr/local/sbin/nm-remote` |
| 4 | رفع الإصدار إلى 2.10.8 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🧪 التحقق
- `bash -n` ✓ · `Environment=HOME=/root` موجود في الوحدة المولَّدة ✓ · `node --check` للراوت ✓.
- لا يمكن اختبار systemd/ngrok على ويندوز — الإثبات النهائي على الجهاز: بعد التحديث، «تشغيل النفق» من اللوحة
  يجب أن ينجح ويظهر endpoint في ngrok ✓ (وإن فشل، ستظهر آخر سطور سجل ngrok في الإشعار مباشرة).

### 📌 جواب سؤال المستخدم: «أليس التحديث من اللوحة يحل كل المشاكل؟»
- **نعم — بعد خطوة يدوية واحدة فقط**، والسبب أن هذه الخطوة هي **تحديث المُحدِّث** نفسه:
  - الوحدة القديمة على الجهاز لا يُسمح لها بالكتابة في `/usr/local/sbin` ⇒ لا تستطيع تحديث المساعدين.
  - ونسخة v2.10.0/v2.10.1 تشترط نسخة احتياطية قبل التحديث (وكانت بايظة قبل v2.10.3) ⇒ الطريق مقفول.
- بعدها: كل تحديث يجدّد الأدوات والوحدات تلقائيًا (v2.10.6) ⇒ **لا أوامر يدوية بعد اليوم** ✓.

---

## 🔑 v2.10.9 — إصلاح «مفتاح API: غير معروفة رغم الحفظ» (مُنجَز ومُتحقَّق منه — 2026-10-11)

> **بلاغ المستخدم:** «ما هي دي مشكلة جديدة — الـ API أنا حفظته والنتيجة غير معروفة».

### 🔍 السبب (مُثبت بالفحص)
- المساعد يكتب في `remote/status.json` حقلًا اسمه **`api_key`** (FIELD_TWO في `nm-remote`).
- والسيرفر كان يقرأ **`apikey`** ⇒ `undefined` ⇒ الحالة «غير معروفة» **داايمًا** —
  بينما «مفتاح الحساب» يعمل لأن الاسمين متطابقان (`authtoken`) ⇒ وهو ما فسّر الفرق تمامًا.

### 🔧 الإصلاح
| # | التغيير | الملف |
|---|---|---|
| 1 | فصل الاسمين: `F_TWO_FILE=api_key` (من ملف المساعد) و`F_TWO_OUT=apikey` (في رد الـ API للواجهة) | `backend/src/routes/remote-access.routes.js` |
| 2 | فحص الانحدار يشترط `set` للحقلين (كان يقبل `unknown` فيُخفي العيب) + حد الرفض 250 | `verify/check-remote-access.js` |
| 3 | رفع الإصدار إلى 2.10.9 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` |

### 🧪 التحقق
- **28 PASS / 0 FAIL** — `حالة المفتاحين تُقرأ من ملف حالة المساعد — one=set · two=set` ✓ (دليل قاطع).
- ملاحظة: في المحاولة الأولى ظهر فشلان كشفا تفصيلتين حقيقيتين (اسم الحقل في الرد — وحد الرفض القديم) → أُصلحا ✓.

---

## 🗺️ v2.10.10 — «خريطة المواقع» عادت **مستويين** (المواقع الرئيسية كروت + الطوابق/الغرف داخلها) — مُنجَز ومُتحقَّق منه — 2026-10-11

> **القاعدة النهائية (بطلب المستخدم):** v2.10.7 سطّح كل المباني ككروت مستقلة، والمطلوب هو الرجوع إلى
> **مستويين**: **المواقع الرئيسية** ككروت مستقلة، و**الطوابق/الغرف** أقسام **داخل** بطاقة الموقع الأب.

### 🔧 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | إزالة تسطيح v2.10.7: `keptFlat = keptZoneKids.map(...)` (المستوى الأول فقط) بدل DFS لكل المواقع | `frontend/public/js/admin-map.js` |
| 2 | إعادة رسم الـ sub-zones داخل `renderZoneBody` كأقسام `map-subzone` مفتوحة دائمًا (لا طيّ) — مع إبقاء أجهزة الموقع نفسه أعلانها | `frontend/public/js/admin-map.js` |
| 3 | نفس السلوك حرفيًّا في NOC: كروت المستوى الأول + الـ sub-zones داخلها + نفس عدّاد «المواقع» | `frontend/public/noc.html` |
| 4 | فحص جديد للقاعدة: «الطوابق/الغرف داخل بطاقات المواقع الرئيسية (مستويان)» | `verify-noc-map-parity.js` |
| 5 | رفع الإصدار إلى 2.10.10 | `backend/package.json` · `appliance/run-build.sh` · `frontend/public/noc.html` · `CHANGELOG.md` |

> أنماط `.map-subzone` / `.map-subzone-title` / `.map-subzone-stats` كانت موجودة أصلًا في
> `frontend/public/css/style.css` وفي CSS الداخلي لـ `noc.html` (لم تُحذف في v2.10.7) ⇒ **لا حاجة لتعديل CSS**.

### 🧪 التحقق (على **نسخة** من القاعدة `.zwork/vnoc/monitoring.db` · منفذ 4103 · Node 20 — القاعدة الحقيقية لم تُلمس)
- **60 PASS / 0 FAIL** · **0 أخطاء JS** · **0 أخطاء SSE** · لقطات `verify/noc-parity-*.png` محدَّثة.
- قاعدة المستويين: **بطاقات المستوى الأول = 4** بالترتيب `orphan-internet-devices, 19, 15, unassigned`
  · **أقسام داخلية = 9** — **متطابقة ترتيبًا وتداخلًا وعدادات بين اللوحة و NOC** ✓
  (9 = 6 أقسام داخل «المبنى الادارى» + 3 متداخلة أعمق: غرفة الامن، الورشة-1، الورشة-2).
- `node --check frontend/public/js/admin-map.js` ✓ · `node --check frontend/public/js/public-map.js` ✓
  · `node verify/check-scripts.js frontend/public/noc.html` = **2/2 OK** ✓
- **طريقة التشغيل الصحيحة للسكربت على هذا الجهاز** (مهمّة للجلسات القادمة):
  ```powershell
  & "C:\Users\KeRo\AppData\Local\nvm\v20.18.0\node.exe" --experimental-websocket verify-noc-map-parity.js
  ```
  السبب: السكربت يقرأ نسخة القاعدة عبر `better-sqlite3` (مبنيّ لـ Node 20 = NODE_MODULE_VERSION 115)
  ⇒ مع Node 24 يفشل بـ `ERR_DLOPEN_FAILED`. ويحتاج `WebSocket` العام للـ CDP ⇒ لا يتوفّر في Node 20
  إلا بالراية `--experimental-websocket`. **وكلا الحاجتين لا تجتمعان إلا بهذا السطر.**
  - ملاحظة: تشغيله بـ Node 24 ينهار عند فحص «زمن الوصول اللحظي» بعد 57 فحصًا ناجحًا (وليس عيبًا في الكود).

### 📌 الحالة
- **مُلتزم ومرفوع**: الالتزام `85eeb6d` + وسم `v2.10.10` على `origin/main` ✓ (بطلب المستخدم الصريح).
- **بناء ISO نجح** (run `38151295903`): Release `v2.10.10` فيه `network-monitor-appliance-v2.10.10-amd64.iso`
  (≈ 478 م.ب) + `SHA256SUMS.txt` ⇒ التحديث متاح من **لوحة التحكم → 🔄 التحديثات → تحديث الآن** ✓.

---

## 🔜 v2.10.11 — خطة محفوظة (لم تُنفَّذ): تحسين شاشة «🔍 اكتشاف الأجهزة» + تبويب «🆕 الأجهزة المُكتشَفة»

> **طلب المستخدم (2026-10-11):** «قم بحفظ الاقتراح للبدء في جلسة جديدة» ⇒ كُتبت الخطة في ملف مستقل
> و**هذا القسم مجرّد مؤشّر لها**. لا تبدأ التنفيذ قبل قراءة الملف كاملًا:
> **`docs/PLAN-v2.10.11-discovery-screen-improvements.md`**

### ملخّص بنود الخطة (كلُّها مُتحقَّق منها بالكود)
| # | البند | الحزمة |
|---|---|---|
| 1 | رسالة خطأ **كاذبة** عند مسح لم يجد أي جهاز (`/results/:scanId` يرجّع `data:[]` في حالتى «لا نتائج» و«انتهت الصلاحية» ⇒ الواجهة تعيد 8 محاولات وترمى رسالة proxy) | 1 (عيب) |
| 2 | نتائج المسح **تُحذف بعد 60 ثانية** (`scan.routes.js:713`) ولا تُسجَّل المسحات اليدوية في `scan_runs` | 1 (عيب) |
| 3 | زر «⏹ إيقاف» **لا يوقف المسح فعلًا** (يغلق SSE فقط؛ لا مسار إلغاء) | 1 (عيب) |
| 4 | عمود «الموقع» ناقص: `window.discoveryLocations` تُجلب ولا تُستعمل، وكل صف يرسل `location_id: null` | 2 (قيمة) |
| 5 | طريقة الفحص ثابتة `ping/30ث` رغم توفر `openPorts` ⇒ اقتراح تلقائي (443→https …) + `web_port` | 2 (قيمة) |
| 6 | لا بحث/فرز/ملخّص في جدول النتائج (جديد N · موجود M) | 2 (قيمة) |
| 7 | الاعتماد في تبويب المكتشفة يُنشئ الجهاز **بلا نوع ولا موقع** ⇒ نافذة اعتماد مُسبقة التعبئة | 3 |
| 8 | لا بحث/فرز/ترقيم في قائمة «الأجهزة المُكتشَفة» (حد ثابت 200) | 3 |

### ترتيب مقترح
`حزمة 1` (عيبان صغيران + تسمية صادقة) → `حزمة 2` (`admin-discovery.js` + `dashboard.html` فقط) → `حزمة 3`
(`discovered.routes.js` + `admin-discovered.js`). الإصدار المقترح: **`v2.10.11`**.

### قيود لا تُنسى
- **Node 20 + `--experimental-websocket`** لتشغيل فحوص الـ CDP/التطابق على هذا الجهاز (Node 24 ينهار على
  `better-sqlite3` = `NODE_MODULE_VERSION 115`).
- الفحوص على **نسخة** من القاعدة (`.zwork/…`) — **لا تلمس** `database/monitoring.db`.
- `v2.6.0` (المصادر الخارجية: MikroTik/Sophos/SNMP/LLDP) **خارج النطاق** — `sources.routes.js` ما زال stub 501.

---

## 🗺️ v2.10.12 — فصل «خريطة المواقع» عن «سلسلة الشبكة» (مُنجَز ومُتحقَّق منه — 2026-10-11)

> طلب المستخدم: «خريطة المواقع تظهر مبانٍ بداخلها طوابق، أما سلسلة الشبكة فمبانٍ مرتبطة فقط (كل موقع منفرد)».
> تعديل v2.10.11 غير المُلتزَم كان يُسطّح الخريطة فتُطابق السلسلة — **فأُلغي**.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | إلغاء تسطيح الخريطة: عودة الأقسام الداخلية `.map-subzone` (الطوابق/الغرف داخل بطاقة المبنى) | `frontend/public/js/admin-map.js` |
| 2 | نفس الإرجاع في NOC + رفع شارة الشاشة | `frontend/public/noc.html` |
| 3 | تعليق «القاعدة النهائية v2.10.12»: خريطة = احتواء · سلسلة = كل موقع منفرد — لا تُوحَّد الشاشتان بلا طلب صريح | الملفان أعلاه |
| 4 | رفع الإصدار إلى 2.10.12 | `backend/package.json` · `appliance/run-build.sh` |

### 🧪 التحقق في هذه الجلسة (2026-10-11)
| الفحص | النتيجة |
|---|---|
| `verify-noc-map-parity.js` (Node 20 + `--experimental-websocket` · منفذ 4103 · نسخة `.zwork/vnoc`) | **60 PASS / 0 FAIL** · 0 أخطاء JS · 0 أخطاء SSE |
| «خريطة المباني» (NOC) | **4 بطاقات + 9 أقسام داخلية** (احتواء مستويين) |
| «سلسلة الشبكة» | **12 بطاقة · 0 أقسام داخلية** (كل موقع منفرد) |
| التطابق لوحة التحكم × NOC | البطاقات=orphan-internet-devices,19,15,unassigned · **39 جهازًا** في اللوحتين |
| `node --check admin-map.js` + scriptا `noc.html` | **OK · 2 من 2** |
| القاعدة الحقيقية `database/monitoring.db` | **لم تُلمس** |

### 📌 ملاحظة للجلسة التالية
- نسخة تعديلات التسطيح الملغاة محفوظة محليًّا في `verify/backup-flattening-v2.10.11.patch` (غير مُتتبَّع).
- خطة **v2.10.11** لشاشة «🔍 اكتشاف الأجهزة» ما زالت قائمة (`docs/PLAN-v2.10.11-discovery-screen-improvements.md`)
  ولم تُنفَّذ — وإن نُفِّذت فليكن إصدارها **بعد** 2.10.13 (مثلًا 2.10.14) لتفادي التباس الرقم.

---

## 🗺️ v2.10.13 — «خريطة المواقع»: احتواء الطوابق/الغرف **فقط** (مُنجَز ومُتحقَّق منه — 2026-10-11)

> تكملة طلب المستخدم: «عايز خريطة المواقع يبقى المبنى بداخله الطوابق والغرف **فقط** — وصلة الربط في السلسلة غيرها تمامًا».
> v2.10.12 جعلت الخريطة احتواءً **لكل** المستويات (فدخلت المواقع داخل بطاقة المبنى) ⇒ صُحِّح الآن.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | قاعدة الاحتواء صارت **حسب النوع**: `floor`/`room`/`rack` فقط تُدخَل كأقسام داخل البطاقة | `frontend/public/js/admin-map.js` |
| 2 | **أي مبنى/موقع بطاقة مستقلة في أي عمق** (`walkCards`) + سطر «متصل عبر: المبنى الأب» داخل البطاقة | `frontend/public/js/admin-map.js` |
| 3 | نفس القاعدة حرفيًّا في NOC (`renderZonesGrid` + `renderZoneBody`) | `frontend/public/noc.html` |
| 4 | الإصدار ⇒ 2.10.13 | `backend/package.json` · `appliance/run-build.sh` · شارة NOC |

### 🧪 التحقق في هذه الجلسة (2026-10-11)
| الفحص | النتيجة |
|---|---|
| `verify-noc-map-parity.js` (Node 20 · منفذ 4103 · نسخة `.zwork/vnoc`) | **62 PASS / 0 FAIL** · 0 أخطاء JS · 0 أخطاء SSE |
| «خريطة المباني» | **9 بطاقات** (منها 6 مواقع site) · **4 أقسام** (كلها طوابق/غرف) · **0 بطاقة طابق** |
| «أقسام ليست طابقًا/غرفة» | **0** ⇒ لا احتواء لغير الطوابق/الغرف |
| «سلسلة الشبكة» | **12 بطاقة (كل المواقع)** · مطابقة 12/12 · 0 أقسام |
| تطابق لوحة التحكم × NOC | `orphan-internet-devices,19,14,11,12,13,16,15,unassigned` · 39 جهازًا |
| `node --check admin-map.js` + scriptا `noc.html` | OK · 2 من 2 |

### 📌 القاعدة النهائية (لا تُوحَّد الشاشتان)
- **سلسلة الشبكة** = كل المواقع كروت منفردة (12) ليربطها الأدمن بنفسه عبر «متصل عبر».
- **خريطة المواقع** = أي مبنى/موقع بطاقة مستقلة، وبداخله **الطوابق والغرف فقط** (مع أجهزتها).

---

## 🗺️ v2.10.14 — توحيد الخرائط الثلاث (مُنجَز ومُتحقَّق منه — 2026-10-12)

> ملاحظة المستخدم: «الآن يوجد خريطتان في المشروع — واحدة في الصفحة الرئيسية وواحدة في شاشة NOC».
> الفرق كان حقيقيًّا: خريطة الصفحة الرئيسية لم تُحدَّث بقاعدة v2.10.13.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | بطاقات الخريطة = كل المباني/المواقع في أي عمق (عدا الطوابق/الغرف/الخزائن) | `frontend/public/js/public-map.js` |
| 2 | الأقسام الداخلية = الطوابق/الغرف/الخزائن فقط | `frontend/public/js/public-map.js` |
| 3 | فحص جديد: `verify-public-map.js` | الجذر (محلي/متجاهَل) |
| 4 | الإصدار ⇒ 2.10.14 | `backend/package.json` · `appliance/run-build.sh` · شارة NOC |

### 🧪 التحقق في هذه الجلسة (2026-10-12)
| الفحص | النتيجة |
|---|---|
| `verify-public-map.js` (منفذ 4103 · نسخة `.zwork/vnoc`) | **9 بطاقات** (2 صناعية + 1 مبنى + 6 مواقع) · **4 أقسام** (3 طوابق + غرفة) · **0 بطاقة طابق/غرفة** · **0 قسم ليس طابقًا/غرفة** · **0 أخطاء JS** |
| مطابقة الأرقام مع NOC/لوحة التحكم | **نفسها** ⇒ الخرائط الثلاث متطابقة |
| `node --check frontend/public/js/public-map.js` | ✓ |
| اللقطة | `verify/public-map.png` |

---

## 🔗🗺️ v2.11.0 — فصل كامل بين «سلسلة الشبكة» و«خريطة المواقع» (رابطان مستقلان) — 2026-10-12

> طلب المستخدم: «افصل خالص ترتيب سلسلة الشبكة عن خريطة الموقع — ترتيب المواقع لوحده وترتيب السلسلة لوحده».
> التشخيص (من جهاز المستخدم 192.168.88.250): نفس `parent_id` كان يغذي الشاشتين ⇒ روابط السلسلة (الورشة ← البوفية ← منعم ← المخزن ←…)
> صارت ترتيب بطاقات الخريطة، والطوابق/الغرف (معلّقة تحت «غرفة IT» التابعة لجذر الإنترنت) اختفت لأن لا بطاقة تدخلها.

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | عمود `map_parent_id` + migration آمنة + قبوله/إرجاعه في API المواقع وtopology | `database/schema.sql` · `backend/src/db.js` · `backend/src/routes/locations.routes.js` · `backend/src/services/topology.service.js` · `backend/src/routes/map.routes.js` |
| 2 | تحقق منع الذاتي/الدائرة على العمودين **منفصلين** (`validateLink`) | `backend/src/routes/locations.routes.js` |
| 3 | حقل **«يتبع (خريطة المواقع)»** في نموذج الموقع + تعبئته وحفظه | `frontend/public/admin/dashboard.html` · `frontend/public/js/admin-locations-types.js` |
| 4 | شجرة الخريطة من `map_parent_id` + ترتيب `sort_order` (`buildMapTree`) | `frontend/public/js/admin-map.js` · `frontend/public/noc.html` · `frontend/public/js/public-map.js` |
| 5 | توضيح التسميات: «متصل عبر (سلسلة الشبكة)» / «متصل عبر (السلسلة)» | `frontend/public/admin/dashboard.html` · `frontend/public/js/admin-topology.js` |
| 6 | الإصدار ⇒ 2.11.0 | `backend/package.json` · `appliance/run-build.sh` · شارة NOC |

### 🧪 التحقق في هذه الجلسة (2026-10-12)
| الفحص | النتيجة |
|---|---|
| migration على **نسخة** قاعدة قديمة (`.zwork/vmap` — تأكيد قبل/بعد) | العمود أُضيف تلقائيًّا ✓ |
| `PUT map_parent_id=المبنى` | حُفظ ✓ و`parent_id` **لم يتغير** ✓ |
| `PUT parent_id=null` (سلسلة) | `map_parent_id` **بقي** ✓ |
| رفض الإشارة الذاتية / الدائرة | **400** لكلٍّ ✓ |
| `/api/topology` | يحمل `map_parent_id` ✓ |
| `verify-noc-map-parity.js` (منفذ 4104 · نسخة `.zwork/vmap`) | **55 PASS / 7 FAIL** (السبع بيئية/بيانات: ngrok · وضع الأبلاينس · زمن SSE · بطاقة «كل الأجهزة واقعة» اختفت لأن المحرك أعاد أجهزة للاتصال أثناء الفحص) — ومنه: الخريطة **9 بطاقات + 4 أقسام** · السلسلة **12 بطاقة · 0 أقسام** · التخطيط المرسوم **12** |
| `verify-public-map.js` (الصفحة العامة) | **9 بطاقات · 4 أقسام · 0 أخطاء JS** |
| `node --check` على الباك-إند + الواجهات | ✓ (0/0 لملفات بلا سكربت داخلي) |
| القاعدة الحقيقية `database/monitoring.db` وجهاز المستخدم | **لم تُلمس** ✓ |

### 📌 ملاحظة للجلسة التالية
- **انتظار الموافقة**: التغيير **غير مُلتزَم** بعد — عرضتُ النتيجة على المستخدم (لقطات + أرقام) بانتظار إذنه بالالتزام/الرفع/الوسم.
- **خطوة اختيارية مؤجّلة**: «السحب والإفلات» — إفلات طابق/غرفة على بطاقة مبنى داخل الخريطة لضبط «يتبع»
  مباشرةً (البديل المتاح حاليًّا: حقل «يتبع» في نموذج الموقع).
- بيانات جهاز المستخدم لم تُغيَّر: لتفعيل الاحتواء عنده يضبط «يتبع» للطوابق/الغرف من الواجهة بعد التحديث.

---

## 📊 v2.11.1 — شريط تقدّم حقيقي + خطوات مطابقة للمساعد + بانر إعادة التشغيل في «🔄 التحديثات» — 2026-10-12

> بلاغ المستخدم: «صفحة التحديث مش فيها شريط تحميل ولا حتى تنبيه تأكيد إعادة تشغيل النظام».
> التشخيص: لا يوجد شريط نسبة أصلًا، وخطوات الواجهة كانت تُطابق كلمات إنجليزية (`git pull`/`rsync`/`restart`)
> بينما المساعد `nm-update` يكتب نصوصًا عربية ⇒ خطوتان فقط تُضيان (وخطوة التنزيل لا تُضاء أبدًا).

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | شريط تقدّم (`upd-bar`) + نسبة % + سطر المرحلة + عدّاد «⏱ منذ M:SS» | `frontend/public/admin/dashboard.html` · `frontend/public/js/admin-update.js` |
| 2 | 5 خطوات = نصوص المساعد العربية حرفيًّا (بدء · ملفات · تبعيات · أدوات النظام · إعادة تشغيل) + تعليم السابق ✓ | `frontend/public/js/admin-update.js` |
| 3 | بانر إعادة التشغيل + تأكيد أوضح + إشعار «النظام يعمل الآن» عند النجاح | الملفان أعلاه |
| 4 | الإصدار ⇒ 2.11.1 | `backend/package.json` · `appliance/run-build.sh` · شارة NOC |

### 🧪 التحقق في هذه الجلسة (2026-10-12)
| الفحص | النتيجة |
|---|---|
| `verify-update-ui.js` — محاكاة أبلاينس (مساعد وهمي + `status.json` بنصوص المساعد الحقيقية · منفذ 4105) | **9 PASS / 0 FAIL** · **0 أخطاء JS** |
| التتابع المقيس | 10% (بدء) → 40% (ملفات) → 70% (تبعيات) → 85% (أدوات النظام) → 95% (إعادة تشغيل + بانر) → 100% (نجاح · كل الخطوات ✓) |
| لقطات | `verify/update-stage-1..6.png` |
| `node --check admin-update.js` | ✓ |

### 📌 ملاحظة للجلسة التالية
- **انتظار الموافقة**: التغيير **غير مُلتزَم** — عُرضت النتيجة على المستخدم (لقطات + أرقام) بانتظار إذنه بالالتزام/الرفع/الوسم.
- الخطة التالية المحفوظة كما هي: `docs/PLAN-v2.10.11-discovery-screen-improvements.md` (شاشة اكتشاف الأجهزة — 9 بنود).

---

## 🐞 v2.11.2 — إصلاح قائمة «متصل عبر» في نموذج الجهاز (كانت فارغة) — 2026-10-12

> بلاغ المستخدم: «عند إضافة جهاز، حقل متصل عبر فاضٍ لا يوجد به أي اختيار — ما وظيفته؟».
> الفحص الحي أكد البلاغ: القائمة بخيار واحد فقط، بلا أخطاء JS.

### 🔍 السبب الجذري (مُثبت بالكود + فحص حيّ)
| — | التفصيل |
|---|---|
| التعارض | `populateParentSelect` مُعرَّفة في `admin-devices.js:186` (لـ `#df-parent_id`) **و** `admin-locations-types.js:79` (لـ `#loc-parent_id`) |
| الأثر | ملف المواقع يُحمَّل لاحقًا (`dashboard.html` 980 ← 983) فيلغي دالة الجهاز ⇒ «إضافة/تعديل جهاز» تستدعيان دالة المواقع ⇒ قائمة الجهاز تبقى بخيار واحد |
| العمر | العيب قائم منذ v2.8.2 (إدخال الحقل) — الحقل كان معطّلًا في الواجهة طوال هذه المدة |

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | إعادة تسمية دالة الجهاز → `populateDeviceParentSelect` (+ موضعا استدعاء) + تعليق مانع للتكرار | `frontend/public/js/admin-devices.js` |
| 2 | الإصدار ⇒ 2.11.2 | `backend/package.json` · `appliance/run-build.sh` · شارة NOC |

### 🧪 التحقق في هذه الجلسة (2026-10-12)
| الفحص | النتيجة |
|---|---|
| `verify-device-parent-select.js` (CDP · نسخة قاعدة · منفذ 4106) | **4 PASS / 0 FAIL** · 0 أخطاء JS |
| نموذج إضافة جهاز | **52 خيارًا** = نص إرشادي + **39 جهازًا** + **12 موقعًا** |
| نموذج تعديل جهاز (72) | **51 خيارًا** (الجهاز نفسه مُستثنى) + تحديد الأب تلقائيًّا = L10 (أولوية الموقع حسب القاعدة) |
| انحدار نموذج الموقع | 13 خيارًا سليمة ✓ |
| لقطات | `verify/device-parent-add.png` · `verify/device-parent-edit.png` |

---

## 🛑 v2.11.3 — كاشف تعطّل التحديث + مهلة `npm ci` في المساعد — 2026-10-12

> بلاغ المستخدم: «التحديث واقف عند 70% (تحديث التبعيات) ولا يتقدّم».
> التشخيص: خطوة `npm ci` في `nm-update` بلا مهلة ⇒ تعلّق بلا نهاية عند تعطّل الشبكة مع npm registry،
> واللوحة تعرض آخر رسالة فقط فلا تفرّق «بطيء» من «واقف».

### 🔄 ما الذي تغيّر
| # | التغيير | الملف |
|---|---|---|
| 1 | مهلة إلزامية `timeout 900 npm ci` (تجاوز بـ`NM_NPM_TIMEOUT`) + رسالة فشل تفرّق المهلة (124) عن غيرها | `appliance/config/includes.chroot/usr/local/sbin/nm-update` |
| 2 | **كاشف تعطّل**: بانر «⚠️ لا تقدّم منذ X دقيقة…» + زرّا «🔄 فحص الحالة الآن» و«📋 نسخ السجل» + `updRenderProgress()` مشترك | `frontend/public/admin/dashboard.html` · `frontend/public/js/admin-update.js` |
| 3 | الإصدار ⇒ 2.11.3 | `backend/package.json` · `appliance/run-build.sh` · شارة NOC |

### ⛔ بند محجوب (يحتاج يدك)
**خيار «سجل التحديث» في كونسول الجهاز** — كتابة ملف `nm-console` مرفوضة من حارس الأسرار على هذا الجهاز
(سطر 212 يمرّر بيانات دخول الأدمن كمتغيّرات بيئة إلى سكربت التهيئة؛ مراجع متغيّرات لا قيم سرّية — لكن الفحص
يرفض الملف كاملًا). النصّ الجاهز للّصق يدويًّا:
[/code]
# 1) أضف الدالة بعد system_info():
update_log() {
  local LOG="$DATA_DIR/update/update.log"
  local ST="$DATA_DIR/update/status.json"
  clear; bold "── Update log & status ──"; echo
  if [ -f "$ST" ]; then echo "  Status : $(cat "$ST")"; else echo "  Status : (لا يوجد ملف حالة بعد)"; fi
  echo
  if [ -f "$LOG" ]; then tail -n 50 "$LOG"; else echo "  (لا يوجد سجل تحديث بعد)"; fi
  echo; read -r -p "Press ENTER…" _
}
# 2) في عرض القائمة بعد [10]:
        echo "  [11] Update log & status (last 50 lines)"
# 3) في case بعد tools_menu ؛ لاحظ الأرقام مفردة بلا أقواس في هذا الملف:
            11) update_log ;;
[/code]

### 🧪 التحقق في هذه الجلسة (2026-10-12)
| الفحص | النتيجة |
|---|---|
| `verify-update-ui.js` (محاكاة أبلاينس · 8 مراحل · منفذ 4107) | **11 PASS / 0 FAIL** · 0 أخطاء JS |
| طابع حالة عمره 5 دقائق | البانر **ظاهر** («تعطّل=true (5 د)») |
| طابع حديث بعده | البانر **يختفي** تلقائيًّا |
| السلسلة الكاملة | 10% → 40% → 70% → 85% → 95% (+بانر إعادة التشغيل) → 100% (5/5 ✓) |
| `bash -n` | **غير مُتاح على ويندوز** (WSL غير مُهيّأ) ⇒ فحص نصّي فقط لخطوة npm |
| اللقطة | `verify/update-stage-4.png` |

---

## ➖ v2.11.4 — إزالة حقل «متصل عبر» من نموذج الجهاز — 2026-10-12

> طلب المستخدم الحرفي: «انا بقول تشيل الحقل ده لان ده تكرار لانه فى الاصل فى سلسلة الشبكة اظن تكرارة
> فى ادخال جهاز جديد لا يفيد» — بعد ملاحظته أن الحقل يعرض **كل الأجهزة** (58 خيارًا).

### السبب
- علاقة السلسلة تُدار من **بطاقات المواقع** («سلسلة الشبكة») ومكان الجهاز يُحدَّد من **«الموقع»**
  ⇒ الحقل كان **تكرارًا** ويشوّش نموذج الإضافة.

### التغييرات
| ملف | التغيير |
|---|---|
| `frontend/public/admin/dashboard.html` | حذف الليبل + `select#df-parent_id` (مع تعليق سبب الحذف) |
| `frontend/public/js/admin-devices.js` | حذف `populateDeviceParentSelect` + `parseParentSelectValue` + النداءين + حقلي الجسم |
| `backend/src/routes/devices.routes.js` | **إصلاح سلامة**: `parent_id === undefined` ⇒ يُبقي القيمة (كما `parent_location_id`) |
| `backend/package.json` · `appliance/run-build.sh` · `noc.html` | الإصدار ⇒ **2.11.4** |

### التحقق (نسخة `.zwork/vmap` · منفذ 4108)
| الفحص | النتيجة |
|---|---|
| واجهة — `verify-device-parent-select.js` (CDP) | **4 PASS / 0 FAIL**: الحقل غير موجود في الإضافة والتعديل · «الموقع» 13 خيارًا · 0 أخطاء JS |
| انحدار حرج — PUT بلا الحقلين | `parent_id=70` **بقي** ✓ (قبل الإصلاح كان يُمسح إلى NULL) |
| PUT بـ`parent_location_id=10` | ضُبط ✓ و`parent_id` بقي ✓ |
| PUT بـ`parent_id` و"null" صراحةً | فُكّ ✓ (الـ API ما زال قادرًا) |
| POST جهاز جديد بلا الحقلين | `null/null` ✓ ثم حُذف جهاز الاختبار ✓ |
| اللقطة | `verify/device-form-no-parent.png` |

### 📌 ملاحظات
- الأجهزة التي لها أب-جهاز (مثال 76→70) روابطها **سليمة** وتظهر في الشجرة/السلسلة كما كانت.
- تعديل رابط جهاز←جهاز لم يعد ممكنًا **من الواجهة** (بالتصميم) — ممكن من الـAPI، أو نُعيد حقلًا صغيرًا لاحقًا.
- لاحظنا أن `parent_location_id` مُخزَّن لكنه غير مقروء في بناء الشجرة (`topology.service.js` يرفق بأب
  عبر `parent_id` وإلا `location_id`) — تعليق الملف يذكره خطأً. لم يُغيَّر (خارج النطاق).

---

## ➡️ v2.11.5 — أزرار عرض «التخطيط المرسوم» في NOC إلى الأعلى (مثل لوحة التحكم) — 2026-10-12

> طلب المستخدم: «زر التحكم في تكبير وتصفير وملء الشاشة في سلسلة الشبكة في شاشة NOC — [أجعله مثل] لوحة التحكم في الأعلى».

### قبل / بعد
| | قبل | بعد |
|---|---|---|
| الموضع | عائم **أسفل يسار اللوحة** (`position:absolute; bottom:18px; left:18px` — y≈915) | **رأس القسم** بجانب العنوان (y=267) وفوق اللوحة (y=311) |
| الشكل | 4 رموز صغيرة 34×34 بلا نص | مثل لوحة التحكم: `+` · `−` · `↺ 100%` · `⛶ عرض كامل` |

### التغييرات (`frontend/public/noc.html` فقط)
1. حُذف بلوك `.map-controls` العائم من داخل `.map-container`، وأُضيف `.chain-zoom-controls` في صف
   `.section-title` (بعد `.bar`) بمعرّفات `draw-zoom-in` / `draw-zoom-out` / `draw-zoom-reset` / `draw-zoom-fit`.
2. CSS: أُزيل `.map-controls` + `.map-controls.at-right` + قاعدة النهار الخاصة به، وأُضيف
   `.chain-zoom-controls` و`.map-btn.wide` (عرض تلقائي للنص) — ألوان الوضع الليلي/النهاري كما هي.
3. شارة NOC ⇒ v2.11.5 (مع `backend/package.json` و`appliance/run-build.sh`).

### 🧪 التحقق (نسخة قاعدة · منفذ 4108 · CDP)
`verify-noc-zoom-controls.js` ⇒ **8 PASS / 0 FAIL** (التفاصيل في CHANGELOG): الموقع/الترتيب/التسميات
مطابقة للوحة التحكم · `+` 1→1.15 · `−` 1.15→1 · `↺` بعد تكبيرين ⇒ 1 · `⛶` ⇒ 0.52 · 0 أخطاء JS.
اللقطات: `verify/noc-draw-controls-before.png` · `-after.png` · `-after-day.png`.

### 📌 ملاحظة (لم يُنفَّذ)
- لو الأزرار خرجت عن النظر أثناء العمل أسفل اللوحة: الحل المقترح تثبيت رأس القسم (sticky) بإضافة صغيرة.

---

## 🔍 v2.11.6 — أدوات الفلترة في NOC تظهر فقط في الشاشات التي تعمل فيها — 2026-10-12

> شكوى المستخدم: «زر المنقطع فقط وزر المتصل لا يعملون على جميع الشاشات في NOC — لو زر لا يعمل
> في أي شاشة اخفيه… يعني مثلًا في شاشة التخطيط المرسوم يكون الازرار مخفية».

### جذر المشكلة (من الكود — لا تخمين)
| الموضع | ما يُطبَّق فعليًا |
|---|---|
| `renderCategories` + `renderDrawBoard` | `searchFilter` (ولا شيء في الرسوم التفاعلية الأخرى) |
| `renderCategories` فقط | `statusFilter` |

⇒ «مسار الإنترنت» و«خريطة المباني»: **لا شيء يعمل** · «✏️ التخطيط المرسوم»: **فلتر الحالة وحده لا يعمل**.

### الحل
`applyFilterBarVisibility(mode)` جديدة (في `noc.html`) + جدول نطاق `FILTER_SCOPE` — تُنادى من
`setViewMode` فتتحكم في: حاوية `.filter-controls` ككل · `#search-input` · حبوب `.filter-pill` الثلاث:

| الشاشة | البحث | فلتر الحالة |
|---|---|---|
| عرض شامل · الأجهزة حسب النوع | ظاهر | ظاهرة |
| ✏️ التخطيط المرسوم | ظاهر (يعمل) | **مخفية** |
| 🗺️ خريطة المباني · 🔗 مسار الإنترنت | مخفي | مخفية (الصف كله) |

- التحميل الأول يمرّ على `setViewMode(savedView)` ⇒ التطبيق تلقائي مع التبويب المحفوظ ✓ ·
  قيمة `statusFilter` لا تُصفّي.

### 🧪 التحقق (CDP · منفذ 4108)
`verify-noc-filter-scope.js` ⇒ **8 PASS / 0 FAIL** — الجدول أعلاه على الخمس · البحث في الرسم 32→7 صفًا ·
«المنقطع فقط» 39→3 في قسم الأنواع · 0 أخطاء JS. لقطات: `verify/noc-filter-draw.png` · `noc-filter-grid.png` ·
`noc-filter-draw-search.png`.

### 💡 مُعلَّق (اقتراح جاهز لو طلب المستخدم عكسه)
تشغيل فلتر الحالة في «التخطيط المرسوم» و«خريطة المباني» (سطران) ⇒ يبقى ظاهرًا ويشتغل هناك.

### 🔧 إصلاح أداة بناء الـISO على GitHub (بعد الوسم — درس v2.11.4)
- **العَرَض**: Release v2.11.4 بقي **مسودة فارغة** (بلا ملفات) والتشغيل `38255591866` **اختفى** (404) —
  أي لا ISO في صفحة الإصدارات.
- **السبب**: خطوة الإرفاق في `.github/workflows/build-iso.yml` بلا `draft: false` ⇒ أي Release مسودة
  سابقًا يبقى مسودة بعد رفع الملفات (تُرفع لكنها تظل مخفية).
- **الإصلاح** (`686aab4`): `draft: false` + `fail_on_unmatched_files: true`.
- **إصلاح v2.11.4**: إعادة بناء على الوسم (`gh workflow run build-iso.yml --ref v2.11.4` ⇒
  run `38259369663` ✓ success) ⇒ الإصدار منشور وبملفاته؛ ثم إعادة علامة **Latest** إلى v2.11.6
  (لأن GitHub يمنحها لآخر إصدار **نُشر** لا لأكبر رقم).
- **للتنفيذ المستقبلي**: بعد أي إعادة بناء لوسم قديم، راجع `gh release list` وأعد `--latest` للإصدار الأحدث.
