# Changelog

جميع التغييرات المهمة لهذا المشروع موثقة في هذا الملف.

التنسيق مستند إلى [Keep a Changelog](https://keepachangelog.com/ar/1.0.0/)،
وهذا المشروع يتبع [Semantic Versioning](https://semver.org/lang/ar/).

> **ملاحظة نطاق (2026-10-09):** أُعيد بناء هذا السجل للإصدارات `2.1.1` → `2.8.4` من تاريخ الـ commits
> الفعلي (رسالة + إحصاء ملفات)، لأن الملف كان متوقفًا عند `2.1.0` بينما الكود وصل `v2.8.4`.
> الإصدار `2.6.0` (المصادر الخارجية: MikroTik/Sophos/SNMP/LLDP) **لم يُنفَّذ بعد** — لا قسم له.
> الإصداران `2.8.1` و `2.8.2/2.8.3` لم يُوسَما بـ git tag؛ توثيقهما من رسائل الـ commits وتعليقات الكود.

## [2.8.5] - 2026-10-10

### ✨ ميزات جديدة
- **الوضع النهاري/الليلي في شاشة NOC** (`frontend/public/noc.html`): زر «☀️ وضع نهاري / 🌙 وضع ليلي»
  في الترويسة، والتفضيل محفوظ في `localStorage:nm.publicTheme` وهو **نفس مفتاح الصفحة العامة** ⇒ اختيار
  واحد يسري على الشاشتين. يُضاف الصنف `noc-day` على `<html>` من `<head>` **قبل أول رسم** (بلا وميض)،
  والافتراضي في NOC يبقى **ليليًّا** (شاشة TV). التنفيذ **تجاوز ألوان فقط** (`html.noc-day …`) — لم تُعدَّل
  أي قاعدة ليلية، وأُضيف `color-scheme: light` لترسم عناصر النظام (أشرطة التمرير/الحقول) بنمط فاتح.
- **ألوان نقاط وخطوط الخريطة صارت أصنافًا** (`.mv-dot.up/.down/.path/.paused` + `.mv-link`/
  `.mv-dot-child`/`.mv-dot-parent`) بدل ألوان مضمّنة في JS ⇒ تتبدّل مع الوضع.

### 🐛 إصلاحات الأخطاء
- **أرقام وهمية في NOC**: شارتا «12 موقع» و«39 جهاز» كانتا نصًّا ثابتًا في HTML لا يحدّثه أي كود؛ صارتا
  تُحسبان من المعروض فعلًا (المواقع المرسومة على الخريطة، والأجهزة بعد الفلاتر).
- **حالات غير صادقة على تثبيت جديد**: بطاقة المدخل الرئيسي كانت مبنية على كائن وهمي فتظهر «🟢 بوابة متصلة»
  بلا أي مدخل إنترنت مُعرَّف، وبطاقة الخوادم تقول «🟢 جميع الخوادم تعمل» بصفر خوادم ⇒ حالة `neutral`
  صريحة («⚪ غير مُهيَّأ» / «⚪ لا توجد خوادم مُعرَّفة») وشارة القسم «غير مُهيَّأ» بدل «نشط».
- **رسالة «لا توجد أجهزة»**: فُصلت عن «لا نتائج للفلاتر» كي لا تُوهم بصفر نتائج على قاعدة فارغة.
- **ملاحظة الخريطة الفارغة**: تُعرَض داخل إطار الخريطة عند عدم رسم أي موقع وتختفي فور رسمها.
- **تكرار خلفية الصفحة**: تدرّج `body` كان يتكرّر كل `100vh` ⇒ وصلات قطع وتغيّر ألوان أثناء التمرير
  على الصفحات الطويلة؛ صار `fixed no-repeat` (تدرّج واحد ثابت).

### 🧪 التحقق
- فحص آلي لمطابقة كل قاعدة ليلية غامقة بتغطيتها النهارية = **0 فجوة حقيقية** (بقي مقصودان: `.brand-icon`
  و`.filter-pill.active`).
- تحليل الـ scriptين داخل `noc.html` (2/2 سليمان) + `node --check frontend/public/js/public-dashboard.js` = OK.
- متصفح headless (CDP) على **نسخة** من القاعدة (`PORT=4103` + `DB_PATH=.zwork/vtest/monitoring.db`):
  ليلي ونهاري = **12 بطاقة موقع + 39 بطاقة جهاز**، وبعد التبديل للنهاري + إعادة تحميل بقي `noc-day`
  و`nm.publicTheme=light` ⇒ قراءة التفضيل عند الإقلاع تعمل، و**0 أخطاء JS** في الحالتين. القاعدة
  الحقيقية `database/monitoring.db` لم تُلمس.

## [2.8.4] - 2026-10-09

### 🐛 إصلاحات الأخطاء
- **إصلاح ضياع «متصل عبر» للمباني** (`frontend/public/js/admin-topology.js`): كان للمواقع مسار أب
  `upstream_location_id` وهو عمود لا يقرأه الخادم ولا يكتبه، فكان اختيار «متصل عبر» لمبنى يضيع بصمت
  ⇒ **صفر خطوط بين المباني في وضع الرسم**. الآن علاقة واحدة موحّدة عبر `parent_id` لكل الأنواع
  (موقع ← موقع، وجهاز ← جهاز ثم موقعه) — نفس العلاقة التي يقرأها `/api/topology` و NOC.
- **`PUT /api/locations/:id` يقبل `_clear`** (`backend/src/routes/locations.routes.js`): يكتب
  `pos_x/pos_y = NULL` بصدق. كان `null` يتحوّل إلى `0` ⇒ الموضع `(0,0)` والبطاقة تعود بعد إعادة
  التحميل، أي أن زر ✕ لم يكن يُخرج المبنى من اللوحة فعليًّا. وأُضيف حارس متناظر مع `/api/topology/layout`:
  لا يُكتب `(0,0)` على مسار مواضع المواقع كذلك (نتيجة تحميل ناقص كانت تلصق كل الكروت فوق بعضها).
- **`saveLocationPositions`**: الإخراج الصريح (✕) يُرسل `_clear` بدل `pos = null`.
- **قائمة «متصل عبر» للمبنى تعرض مواقع فقط** — أب الموقع لا يمكن أن يكون جهازًا.

### 🎨 تحسينات الواجهة
- **مواءمة خطوط NOC مع «وضع الرسم»** (`frontend/public/noc.html`): خطوط المباني بنفس الإحداثيات
  والسماكة والعتامة (كانت `2.5/0.5` ومرتكزًا مختلفًا)، ومرتكز منتصف الترويسة (عرض 320 / ارتفاع 17)
  مطابق للوحة التحكم.
- **الأثر المقيس في تلك الجلسة** (على لقطة قاعدة تلك الجلسة، لا على القاعدة الحالية): خطوط وضع الرسم في
  لوحة التحكم `0 → 10` خطًا بين المباني (كان صفرًا بين المباني و32 خطًا داخليًّا فقط)؛ وخطوط NOC بقيت `10`
  دون تغيير ⇒ تساوى الطرفان على نفس العلاقة ونفس الإحداثيات.
- **إعادة تحقق (جلسة 2026-10-09، توثيق)**: على `database/monitoring.db` الحقيقية: 12 موقعًا، منها
  **4 بموضع محفوظ** (13/14/15/19) و**8 بموضع `NULL`** (8, 9, 10, 11, 12, 16, 17, 18) ⇒ 11 بطاقة مبنى
  + عقدة Internet قابلة للرسم. المواقع الثمانية لا تظهر على لوحة «وضع الرسم» حتى تُسحَب وتُحفَظ.

### 🧪 التحقق
- `node --check` على `backend/src` (23 ملفًا) + سكربت NOC الداخلي + `admin-topology.js`.
- 19 فحص API (v2.8.2/2.8.3) + 10 فحوص مواءمة (v2.8.4) = **29 PASS / 0 FAIL** على نسخة من القاعدة.
- فحص متصفح headless (في تلك الجلسة): بطاقات المباني + قوائم «متصل عبر» + زر الحفظ، **ولا أخطاء JS**
  في الشاشتين.

### ⚠️ ملاحظة بيانات (ليست عيب كود)
- في لقطة تلك الجلسة كان `Internet-Gateway (id=18)` و«المبنى الادارى (id=19)» بموضع `(0,0)` على اللوحة
  ⇒ خط منطوٍ عند نقطة واحدة.
- **الحالة في القاعدة الحقيقية الآن (تحقّق 2026-10-09)**: `المبنى الادارى (id=19)` صار `(40,40)` محفوظًا،
  و`Internet-Gateway (id=18)` صار `pos_x/pos_y = NULL` (لا موضع) — أُصلح الاستيعاب أعلاه.

## [2.8.3] - 2026-10-09

### 🚀 الميزات الجديدة
- **عقد المواقع تدخل السلسلة** (`backend/src/routes/topology.routes.js`): بناء الشجرة الموحّدة من
  `parent_id` للجميع (مواقع + أجهزة) بدل قصرها على الأجهزة.
- **حفظ التخطيط يقبل `'L<id>'` للمواقع** ورقم/`'D<id>'` للأجهزة، مع حارس تجاهل `(0,0)`.
- **`admin-topology-view.js` عارض جديد** (135 سطرًا) للسلسلة الهرمية داخل `#topology-tree`.
- **`noc.html`: خريطة «كما رسمها الأدمن»** — بطاقات المباني وأجهزتها على مواضعها المحفوظة.

### 🐛 إصلاحات الأخطاء
- **جهاز تابع لمبنى (`parent_location_id`) يُعرض داخل بطاقة المبنى فقط** — والأجهزة بلا موقع
  (`location_id` فارغ) لا تظهر على اللوحة إطلاقًا.

## [2.8.2] - 2026-10-09

### 🚀 الميزات الجديدة
- **مواضع بطاقات محفوظة**: عمودا `locations.pos_x/pos_y` (رسم المباني) وإرجاعهما في `GET /api/locations`،
  ودعم `_pos_only` في `PUT /api/locations/:id` لحفظ الموضع وحده دون باقي حقول الموقع.
- **عمودا `devices.pos_x/pos_y`** (`database/schema.sql`) وربط جهاز ← موقع عبر `devices.parent_location_id`
  مع تحقق `validateParentLocation` (رفض موقع غير موجود)، و`PUT` بحيث `undefined` = إبقاء القيمة و`""` = فكّ الربط.
- **«وضع الرسم» في تبويب «سلسلة الشبكة»** (`frontend/public/admin/dashboard.html`): سحب البطاقات +
  قائمة «متصل عبر» + 💾 حفظ التخطيط.
- **`admin-devices.js`**: قائمة «متصل عبر» تجمع الأجهزة والمواقع (`'D<id>'` / `'L<id>'`).

### 🧪 التحقق
- `node --check` على كل ملفات `backend/src` (23 ملفًا) وملفات الواجهة المعدّلة.
- تشغيل الخادم على نسخة من قاعدة البيانات + **19 فحص API** (layout save/guard، `_pos_only`،
  `parent_location_id`: إبقاء/فكّ/رفض) = **19 PASS / 0 FAIL**.
- فحص متصفح (headless): 12 بطاقة مبنى + 12 قائمة «متصل عبر» + زر الحفظ، ولا أخطاء JS غير ملتقطة.

## [2.8.1] - 2026-10-09

> لم يُوسَم بـ git tag — موثّق من تعليقات الكود في `frontend/public/js/admin-topology.js`.

### 🐛 إصلاحات الأخطاء
- **عقدة `/api/topology` ناقصة الحقول الإدارية** (`device_type_id`, `check_interval_seconds`…) ⇒
  أُكملت الحقول قبل العرض.
- **تحديث محلي بدل `loadAll`** بعد تغيير الأب أو الإخراج — يحفظ السحبات غير المحفوظة.
- **أول موضع فاضٍ داخل حدود اللوحة** (بدل رمي الجهاز فوق بطاقات موجودة).

## [2.8.0] - 2026-10-07

### 🚀 الميزات الجديدة
- **سلسلة الشبكة (Topology chain)**: عمود `parent_id` + auto-migration + `/api/topology` مع وسم
  «انقطاع المسار» (path-down marking) + تبويب إداري بتحرير الأب مباشرةً داخل الصف + ترتيب طبيعي.
- **شاشة NOC للعرض العام** (`/noc.html`) + رابط من الصفحة العامة.
- **نمط التحديثات القائم على الأرشيف للـ Appliance**: GitHub API tags + zipball (بدون git/PM2)
  مع مقارنة semver حقيقية (أُصلح خلل `2.4.0` مقابل `2.5.3`).
- **وحدة تحكم الجهاز**: بوابة كلمة مرور (SHA-512، 3 محاولات/قفل 30ث)، `[q]` للقفل + قفل تلقائي
  عند خمول 5 دقائق، إظهار authtoken في التقرير الكامل، أدوات شبكة (ping/traceroute/فحص الإنترنت
  عبر `1.1.1.1`)، مستخدم `sysadmin` لـ SSH، `open-vm-tools`، `unzip`، ومنفذ SSH 22 في nftables.
- **المُثبِّت**: الأدمن يختار كلمة المرور، إعداد شبكة DHCP/Static، إنشاء `sysadmin` **بعد** قراءة
  كلمة المرور (إصلاح ترتيب `set -u`)، و`AmbientCapabilities=CAP_NET_RAW` لـ ping/traceroute.
- **ngrok**: عنوان equinox عامل (S3 NoSuchKey) + دعم نطاق ثابت.

### 🔧 التحسينات التقنية
- ترقية رقم مخطط القاعدة `2.5.3` → `2.8.0`.

## [2.7.5] - 2026-09-30

### 🚀 الميزات الجديدة
- **«تذكّرني» في تسجيل الدخول**: جلسة 30 يومًا عبر تجاوز `maxAge` + فحص الجلسة قبل إعادة التوجيه.
- **حقل `web_port` للجهاز**: فتح واجهة الجهاز على منفذ مخصص (مثل `4444`) مع فحص HTTP/HTTPS تلقائي
  عند الإضافة/التعديل + migration.
- **اختبار سرعة الإنترنت** في الصفحة العامة (`public-speedtest.js`، 276 سطرًا) مع اختيار سيرفر
  (Cloudflare كامل / jsDelivr+unpkg للتنزيل فقط، CORS متحقق منه).
- **خط أنابيب ISO للـ Appliance**: Debian 12 live-build + خدمة systemd + nginx (80→4001) +
  nftables (80/443 فقط) + مُثبِّت قرص بكلمة مرور إدارية عشوائية + workflow GitHub Actions.
- **تبويب الأجهزة**: حفظ الترتيب/الفلتر في `localStorage` (`nm.adminDevicesSort`/`Filter`).
- **الخريطة (إداري + عام)**: بطاقة «أجهزة الإنترنت» مثبّتة أولًا ومستثناة من السحب والإفلات.
- **شريط نِسبة التشغيل** على بطاقات وجدول الصفحة العامة (وإصلاح تكراره في عرض الجدول).

### 🐛 إصلاحات الأخطاء
- مسح سجلات الحالة `POST /api/devices/cleanup-status-logs`.

## [2.7.1] - 2026-08-10

### 🚀 الميزات الجديدة (5 طلبات واجهة)
- **زر إظهار/إخفاء القائمة الجانبية + أيقونات فقط عند الإخفاء (rail mode)**: الحاسوب يطوي/يوسّع
  (class `sidebar-collapsed` على `<body>` = 60px + أيقونات موسّطة + labels مخفية)، والموبايل drawer
  كامل فوق الشاشة. الحالة محفوظة في `localStorage:nm.adminSidebarCollapsed`.
- **تحسين المظهر الليلي لـ grid خريطة المواقع** (لوحة التحكم + الصفحة العامة): تعويض `rgba` الثابت
  في `kindColor()` بمتغيّرات CSS (`--zone-internet-bg`/`--zone-bg`/`--zone-unassigned-bg`) في `:root`
  و`body.dark`، مع أنماط ليلية إضافية للـ borders/subzone/header/empty/counter.
- **إظهار نِسبة التشغيل عند النقر على الجهاز** في تبويب عرض الخريطة (الصفحة العامة): تحويل chip الجهاز
  من `<div>` إلى `<button>` + ربط النقر بـ `window.openDeviceModal(id)` — يعرض `uptime_percentage`
  ورسمًا بيانيًّا 24h وانقطاعات.
- **التحكم في ترتيب أطر العرض** بحيث تظهر متّصلة على التوالي (منطقة ← منطقة): عمود `sort_order` على
  `locations` عبر migration آمنة في `db.js` + تحديث `locations.routes.js` و`map.routes.js`
  (`ORDER BY sort_order ASC, id ASC`) + حقل «الترتيب» في نموذج المواقع وعمود في الجدول وخيار في
  فلتر الترتيب + سهم مرئي `↤` بين البطاقات (يختفي على الموبايل).
- **popup تأكيد عند تعديل أي عنصر** في كل التبويبات (الأجهزة/الأنواع/المواقع/الإشعارات/المسح/النسخ)
  باستعمال `confirmAction()` الموجود في `admin-utils.js` — تأكيد عند «تعديل» وعند «حفظ».

### 🧪 التحقق
- `node --check` PASS على كل ملفات JS المعدّلة (`admin-*.js` + `public-map.js`).
- Migration `sort_order` مُختبرة: `PRAGMA table_info(locations)` → `id, name, parent_id, kind, sort_order`.
- Routes مُختبرة على server عابر (المنفذ 4111): `GET /api/locations` → `sort_order` موجود في الـ keys.

## [2.7.0] - 2026-08-09

### 🚀 الميزات الجديدة
- **PA — قائمة جانبية عمودية**: sidebar يمين ثابت 240px + drawer 🍔 في `<768px` بدل التبويبات الأفقية.
- **PG — modal تأكيد موحّد**: `confirmAction()` + `showToast()` — استبدال كل 48 `confirm()`/`alert()` الأصلية.
- **PE — `has-online` class**: على zone-cards كلّها online ⇒ إطار أخضر + glow على `device-dot`.
- **PB — الثيم الليلي للخريطة**: متغيّرات ليلية + `box-shadow` glow للـ `has-online`/`has-offline`.
- **PD — ترقيم zone-cards تسلسليًّا** (01، 02…) عبر CSS counter + `aria-posinset`/`aria-setsize`.
- **PC — شريط نِسبة التشغيل** (`#map-uptime-bar`) في الصفحة العامة — polling 10s.
- **PF — `POST /api/devices/cleanup-history`** (week/month/year) + زر موحّد «مسح السجل» popup (نوع + مدّة).

### 🧪 التحقق
- 16 ملفًا معدّلًا. `node --check` PASS على 14 ملفًا. `bash -n deploy.sh` OK.
- لا تدخّل على `/api/map/tree` ولا `/api/map/public/tree`. لا CDN جديد.

## [2.5.4] - 2026-08-05

> يجمع هذا الإصدار المُلتزَم كل عمل `v2.5.0 → v2.5.4` الذي كان في مجلد dev منفصل.

### 🚀 الميزات الجديدة
- **v2.5.0 — المسح الدوري**: جدولا `scan_settings` (إعدادات + interval + subnets + `new_device_alert`)
  و`scan_runs` (سجل مسحة بمسحة) و`discovered_devices` + مُجدوِل `setInterval` في
  `scan-scheduler.service.js` + `sendGenericNotification` (webhook) + WAL mode + auto-migration عند بدء الخادم.
- **v2.5.1 — نوع الموقع `kind`**: `site|building|floor|room|rack` + `GET /api/map/tree` (D3) +
  `admin-map.js` + فلتر الموقع في تبويب الأجهزة + migrations آمنة.
- **v2.5.2 — إعادة كتابة الخريطة بـ HTML/CSS**: من D3 SVG إلى شجرة `ul/li` متداخلة (RTL طبيعي،
  لا dependency على CDN).
- **v2.5.3 — إزالة zoom**: scroll فقط (لا عجلة تكبير، لا أزرار `+`/`−`)، ونقر الجهاز يفتح modal
  تفاصيل عائمًا بدل القفز لتبويب الأجهزة.
- **v2.5.4 — مسار رقمي هرمي (`1.2.3`)** + خلفية عقدة متتابعة حسب العمق (`data-depth`: internet أزرق /
  zone أصفر-برتقالي / الأجهزة بلون الحالة) + خطوط وصل `::before` على شكل L + إطار عقدة الموقع
  يعكس الحالة المُجمَّعة (أحمر لو وُجد offline، أخضر لو كلّها online).

### 🐛 إصلاحات الأخطاء
- **النقر المزدوج على «أجهزة غير مُعيَّن»** أصبح no-op بدل إطلاق فلتر `location_id='unassigned'`
  الذي كان يترك جدول الأجهزة فارغًا بلا رسالة (`Number('unassigned')=NaN`).
- **migration آمنة لـ `webhook_url`** عبر `ALTER ADD COLUMN` محمي بـ try/catch (على DB قائمة من v2.4.0،
  `CREATE TABLE IF NOT EXISTS` لا يضيف العمود ⇒ كان webhook يفشل).
- **`totalAdded += (await processHost(...)) || 0`**: `processHost` يُرجع عدد الجديدة لكن القيمة كانت
  مُهمَلة ⇒ `scan_runs.devices_added` كان دائمًا 0.

### 🔧 التحسينات التقنية
- `.gitignore`: استثناء `database/_corrupt_backup_*/` و `database/corrupt_*/` (كانت untracked، ~74MB).

### 🧪 التحقق
- `node --check` (16 ملفًا) OK + `bash -n deploy.sh` OK.
- تشغيل الخادم على `PORT=4099` (DB OK / engine / scheduler-disabled).
- 11 فحص curl: health/login/session/map-tree/scheduler/discovered/locations/public-tree/self-ref/cycle — كلّها نجحت.
- PRAGMA: تأكيد migrations (`scan_settings`/`scan_runs`/`discovered_devices` + `webhook_url` + `locations.kind`).

## [2.4.0] - 2026-07-27

### 🐛 إصلاحات الأخطاء (جذرية لتفادي الأوامر اليدوية على الخادم)
- `update.routes.js`: `git fetch --tags --force origin ${branch}` بدل `git fetch origin ${branch}` —
  يجلب التاجات صراحةً لتفادي «أحدث إصدار: <قديم>» رغم التحديث الفعلي.
- `update.routes.js`: `classifyGitError()` جديد + رسالة error صريحة بدل «الفرع main غير موجود»
  المُضلِّلة — يُميّز: صلاحيات `.git/` / شبكة / مصادقة / غير مُصنّف، مع `hint` لكل فئة.
- `deploy.sh`: تصدير `PM2_HOME=${APP_HOME}/.pm2` صراحةً + تغليف كل استدعاء `pm2` بـ
  `env PM2_HOME=...` + `APP_HOME` ديناميكي بدل `--hp '/root'` الثابت ⇒ تفادي نشوء daemon root عابر.
- **فصل nginx لملفين**: `nginx.example.conf` (server block فقط) + `nginx.connection-map.conf` جديد
  (map فقط — سياق `http{}` الصحيح)، وإعادة كتابة `linux-setup/network-monitor-nginx.conf` بنفس البنية
  ⇒ تفادي فشل `nginx -t` عند النسخ المباشر.

### 📝 التوثيق
- `backend/package.json`: `2.3.2` → `2.4.0`. `DEPLOY.md` + `RUN-ON-LINUX.md`: تعليمات النسخ حُدِّثت لملفين.
- `HANDOFF.md`: إعادة كتابة ببنية نظيفة مختزَلة.

## [2.3.2] - 2026-07-26

### 🐛 إصلاحات الأخطاء
- **`fix(scan/SSE)`**: حدث `done` لا يصل عبر proxy/ngrok في ظل buffering ⇒ `sendDone(deviceCount)`
  يُرسل `data: {"deviceCount": N}` ليعرف المتصفح عدد الأجهزة فورًا دون الاعتماد على `/results/:scanId`.
- **`fix(ui/discovery)`**: `fetchResults` لم يعد يكرّر نفسه إلى ما لا نهاية لو كانت `scanResults`
  فارغة أو انتهت صلاحيتها عبر ngrok — أُضيف `MAX_FETCH_ATTEMPTS=8` يُظهر رسالة خطأ عقلانية بعدها.

### 📝 التوثيق
- `HANDOFF.md` جديد يوثّق حالة المشروع (تشخيص PM2 root + إصلاح الصلاحيات على الخادم + الخطوات المتبقية).

## [2.3.1] - 2026-07-26

### 🐛 إصلاحات الأخطاء
- **`fix(deploy/VAPID)`**: crypto fallback كان يحذف بادئة `0x04` (`slice(1)`) فيُنتج مفتاحًا 64-بايت
  يفشل في المتصفح: `Vapid public key should be 65 bytes long when decoded` ⇒ أُبقيت الـ 65 بايت كاملة
  (مطابق لـ `web-push.generateVAPIDKeys()`).
- **`fix(deploy/VAPID)`**: حارس التوليد يتحقق الآن من *طول* المفتاح (`>=86` char public / `>=43` private)
  لا مجرد وجود حرف، فيُعيد توليد المفاتيح العاطلة المختصرة المُتبقية من `2.2.0` تلقائيًّا.
- **`fix(nginx/SSE)`**: إضافة `location /api/scan/stream/` مخصص بـ `proxy_buffering off` +
  `proxy_cache off` + `chunked_transfer_encoding on` + `map Connection_upgrade` ⇒ إصلاح
  «انقطع الاتصال بالخادم» عبر reverse proxy.
- **`fix(ui/SSE)`**: `admin-discovery.js` لم يعد يُغلق `EventSource` ويُظهر «انقطع الاتصال» فور أول خطأ
  عابر — يتحقق من `readyState==CLOSED` ويسمح بمحاولات إعادة الاتصال قبل الإعلان بالخطأ (`MAX_SSE_ERRORS=5`).

### 📝 التوثيق
- `docs(DEPLOY)`: قسم «ملاحظات الانتقال 2.2.0 → 2.3.0» يدل المستخدم على كيفية إعادة توليد VAPID العاطل.

## [2.3.0] - 2026-07-26

### 🐛 إصلاحات الأخطاء (المشاكل الخمس بعد التشغيل)
- **`fix(deploy)`**: توليد مفاتيح VAPID تلقائيًّا في `deploy.sh` (شروط `grep` غير فارغة + `cd backend`)،
  ومقتطف يدوي يطبع القيم جاهزة للّصق.
- **`fix(scan)`**: حذف `ReferenceError` في `lastScanResults`؛ fire-and-forget فعلي لـ `/subnet`؛
  heartbeat كل 15ث لمنع idle-drop؛ `sendError` يُرسل الرسالة الحقيقية.
- **`fix(ui)`**: تغليف كتلتَي Telegram/WhatsApp في `<fieldset>` بدل `<label>` متداخل (HTML صالح).

### 🚀 الميزات الجديدة
- **`feat(updates)`**: إزالة اختيار الفرع من تبويب التحديثات — التحديث يُسحب تلقائيًّا من `main`.

### 📝 التوثيق
- إضافة بيانات الدخول الافتراضية (`admin`/`ChangeMe123!`) في README/DEPLOY/RUN-ON-LINUX + رسالة نجاح
  `deploy.sh` + `seedAdmin` يطبع كلمة المرور مع تحذير التغيير.

## [2.2.0] - 2026-07-25

### 🚀 الميزات الجديدة
- **ميزة النسخ الاحتياطي واستعادة قاعدة البيانات (SQLite)**.
- **ملف `admin-utils.js` مركزي** + إصلاح ثغرة XSS في `esc` وإزالة التكرار.
- **CI/CD**: توسيع triggers لتشغيل CI/CD على فروع `fix/feat` + `workflow_dispatch`.

### 🔧 التحسينات التقنية
- **إزالة Docker نهائيًّا** (`refactor`) + تهيئة GitHub للنشر المباشر على Linux
  (حذف `Dockerfile` و`docker-compose.yml` و`.dockerignore`).
- `fix: حماية endpoints /api/update/* بـ requireAuth` + تحسين متانة الـ collect.
- `fix(ci)`: إزالة `environment: production` لتفادي ظهور Environment فارغ في تبويب Deployments.

### 📝 التوثيق
- تحديث شامل لـ `README.md` — دليل احترافي كامل مع CI/CD وGitHub Updates وNetwork Discovery.

## [2.1.1] - 2026-07-23

### 🐛 إصلاحات الأخطاء
- **`fix: Dockerfile`**: إزالة `COPY database` وإنشاء مجلد database داخل الحاوية.
- مزامنة الإصدار لـ `v2.1.1` وإصلاح صلاحيات Dockerfile.

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