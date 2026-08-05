# 📋 HANDOFF.md — سجل نقل الحالة بين الجلسات

> **الغرض**: هذا الملف يَوثّق كل ما تَمّ، والحالة الحالية، والخطوات المتبقية.
> ===> **أي نموذج ذكاء اصطناعي آخر أو جلسة جديدة يَجب أن يَبدأ بِقراءة هذا الملف بالكامل قبل أي شيء.**
>
> **تاريخ آخر تحديث**: 2026-07-27 (الجلسة الحالية — **v2.5.0 المرحلة 1 جاهزة لِـ الاختبار. المجلد مطوّر منفصل عن master**)
> **السياق**: نِظام مُراقبة الشبكة (Network Monitor) — مستودع GitHub `kerolos-it2022/network-monitor`
> **المجلد**: `E:\New claude\network-monitor-v2.5.0-dev` (نسخة احتياطية من v2.4.0 من master + إِضافات v2.5.0)

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
