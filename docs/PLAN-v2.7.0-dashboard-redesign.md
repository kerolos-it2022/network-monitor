# 🎨 خطة الجلسة التالية (v2.7.0) — إِعادة تَصميم لوحة الإِدارة (sidebar) + تَحسينات الخريطة + مسح التاريخ + popups

> **أَنشأَت هذه الجلسة**: 2026-08-08 (بَعد اِنتهاء v2.6.0 — Zones-Grid view + public map view).
>
> **Master వర్షion**: نَقل قوائم لوحة الإِدارة الإِدارية من تَبويبات علوية أَفقيّة إِلى **شريط جانبي vertical sidebar**، مع تَحسينات بَصرية و تَفاعلية على «خريطة المواقع» (admin + عامّ)، و إِضافة «نِسبة التَشغيل»، و تَرتيب البطاقات بِـ تَوصيل بَصري (متصلة على التَوالي)، و تَقوية لون إِطار الأَجهزة online، و إِضافة تَفوّق "مسح حالة الأَجهزة" (أُسبوع/شهر/سنة عامّ، بلا تَفصيل جهاز-ب-جهاز)، و إِضافة **popup تأكيد** لِـ كُلّ عَمَليّات التَعديل في جَميع تَبويبات لوحة الإِدارة.

---

## 📋 مُلَخّص نِقاط الجلسة (7 طلبات)

| # | الطلب | النَطاق | الملفات المُتَأَثرة الرئيسية |
|---|---|---|---|
| ✅1 | قوائم لوحة الإِدارة **بمظهر جانبي** بدَل العلوي | admin | `dashboard.html`, `style.css`, (كرّة كل `admin-*.js` لو يَعتَمِدون عَلى `data-section`) |
| ✅2 | تَحسين **المظهر اللَيلي** في تَبويب خريطة المواقع (admin) + الواجهة العامة | admin+public | `style.css` `.map-grid*` + `.dark` المُتغيّرات |
| ✅3 | إِظهار **نِسبة التشغيل** (%) في الصَفحة العامة في تَبويب عرض الخريطة | public | `public-map.js`, `index.html` |
| ✅4 | **ترتيب إِطارات العَرض** في خريطة المواقع بِـ شَكل "متصلة على التَوالي" (مُترابطة منطقة-ب-منطقة) | admin+public | `admin-map.js`, `public-map.js`, `style.css` (connector) |
| ✅5 | **تَحسين لون إِطار الأَجهزة المُتصلة** (online) — أَضعف من offline حاليًّا | admin+public | `style.css` `.map-device-dot[data-status=online]` `.map-zone-device[data-status=online]` |
| ✅6 | **خِيار مسح حالة الأَجهزة** (أُسبوع / شهر / سنة) عامّ — بلا لِكلّ جهاز على حِدَة | admin+backend | `dashboard.html` (زرّ جديد في tab logs/profile), `backend/src/routes/<new-history-cleanup>.routes.js`, `schema.sql` (لا لَزوم للتَغيير) |
| ✅7 | **popup تأكيد** لأَيّ تَعديل في جَميع تَبويبات لوحة الإِدارة | admin (cross-cutting) | مُرَكَّز: `admin-utils.js` مُرَفَع `confirmAction()` + اِستِدعاء في كلّ مُعدِّل حالي |

---

## 0. الوَضع الحالي (snapshot من الكود)

### 0.1 لوحة الإِدارة — `dashboard.html` (T ملّم عَمُودي حاليًّا)
- `<header class="topbar">` (سطر 11): رَأْس الصَفحة عَلوي.
- `<nav class="filters-bar">` (سطر 20-32): **شريط تَبويبات أُفقي** بِـ أَزرار `class="tab-btn"` للأَقسام (`tab-devices`, `tab-locations`, `tab-types`, `tab-discovery`, `tab-discovered`, `tab-scheduler`, `tab-map`, `tab-notifications`, `tab-logs`, `tab-profile`, `tab-backup`, `tab-updates`) — 12 زرًّا مُتراصّة أُفقيًّا. اِزدِحام شَديد على شاشات ضيّقة.
- أَقسام مَتَتالية `<section class="hidden" id="section-X">…` (devices/locations/types/discovery/discovered/scheduler/map/notifications/logs/profile/backup/updates). **آلية التَبديل**: التَبديل عَبر class `hidden` عَلى `<section>` (لو يَعمَل `tab` و في `admin-utils.js` أَو في مَوْضِع عام — تَحقَّق مِن رَبط الأَزرار في `admin-utils.js`).

### 0.2 scripts النَشِطة (Dashboard)
- `admin-utils.js` → `esc`, `api()`. **يَنبَغِي أَن يَكُون هُنا منطق تَبديل التَبويبات** (Toggle `.hidden` عَلى `section`s + `active` عَلى `tab-btn`) — تَحقَّق قَبل تَغيير layout.
- `admin-devices.js`, `admin-locations-types.js`, `admin-notifications.js`, `admin-profile.js`, `admin-discovery.js`, `admin-discovered.js`, `admin-scheduler.js`, `admin-map.js`, `admin-backup.js`, (admin-updates لو وُجد).

### 0.3 خريطة المواقع (admin) — `#map-grid`
- v2.6.0 Zones-Grid: `<article class="map-zone-card kind-X has-offline">`، `kind`: `floor/zone/building/site/internet/unassigned`.
- **mapping**: الصَفحة الفعليّة الفِعلية في خِدمة الإِنتاج تُعطي الشكرة `internet → floor → zone → floor → device` (تَداخل غَير منتظِم!). انظر `/api/map/public/tree` مُخرَّج.
- **`data-depth`** POT لم يَعُد يَُستَعمَل في v2.6.0 (هو من v2.5.5). لِـ نَقطة الـ #4، نَحتاج إِلى مَفهوم أَفضَل للـ "ترتيب التَوالي".

### 0.4 الصَفحة العاِمّة — `_index.html`
- v2.6.0 أَضاف `.view-toggle` زرّ ثالث 🗺️ → `#map-view` → `#public-map-grid` (Zones-Grid مُختَصَر بِـ `public-map.js`).
- polling chunk 10s يَتصل بِـ `/api/map/public/tree` (API مَوجُود).

### 0.5 أَلوان الـ status في `style.css`
```css
--online: #22c55e;  /* أَخضر — في وضع فاتح */
--offline: #ef4444; /* أَحمر */
--unknown: #9ca3af; /* رمادي */
```
`.map-device-dot[data-status="online"]  { background: var(--online); }`
`.map-zone-card.has-offline { border-color: var(--offline); border-width: 2px; }`
— **مُلاحظة**: online في `.map-zone-card` يُمَثَّل فقط بِـ **عَدَم** `has-offline` (يَبقى الإطار الافتراضي `var(--node-border)` = `#9e9e9e` رمادي خافت). لِـ تَقوية هذا: يجب إِضافة `.has-online` class + class في JS. نَقطة #5.

### 0.6 backend — Downtime events
- `downtime_events` table في `schema.sql` (كلّ جهاز: `device_id`, `start_at`, `end_at`, `reason`...).
- `GET /api/devices/:id/history?range=24h|7d|30d` مَوجُود (devices.routes.js:46).
- **لا يَوجَد** delete للـ history بشكل عامّ — يَلزَم إِضافة endpoint جَديد.

---

## 🎯 نَطاق v2.7.0 المُقَترَح

### PA — تَحويل قوائم لوحة الإِدارة إِلى **sidebar جانبي**

**التَنفيذ**:
1. اِستبدِل `<header class="topbar">` + `<nav class="filters-bar">` بِـ:
   - `<aside class="sidebar" role="navigation" aria-label="أَقسام لوحة الإِدارة">` → قائمة `vertical` (`<ul>` / أَزرار `tab-btn` vertical) لِـ 12 زرّ.
   - `<main class="dashboard-main">` → يَحوي `<section>` الأَقسام و يَأخذ `margin-inline-start` بِـ عَرض الـ sidebar (مثلاً `240px`).
2. RTL: `direction: rtl` + الـ sidebar على **اليمين** (`inset-inline-start: 0`)، `dashboard-main` `margin-inline-start: 240px`.
3. Responsive: في شاشة < 768px، الـ sidebar يَتحوّل إِلى **`drawer` قابل للطي** بِـ زرّ 🍔 `#sidebar-toggle` يُبَدّل `sidebar.open`.
4. CSS جَديد في `style.css` (قَطعة `.sidebar`, `.sidebar.collapsed`, `.dashboard-main`, `.hamburger-toggle`, `@media` للـ drawer).
5. JS تَعديل بسيط: لو تَبويب التَبديل في `admin-utils.js` يَستعمِل `tab-btn` selector — **يَبقى حتّى لو اِتَّجَه layout**.

**Mockup نَظري**:
```
┌────────────┬─────────────────────────────────────┐
│ 📁 لوحة    │  <main class="dashboard-main">       │
│ ─────────  │    <section id="section-devices">…  │
│ 📱الأَجهزة    │      ...                              │
│ 📍 المواقع  │                                      │
│ 🏷️ الأَنواع   │                                      │
│ 🔍 اكتشاف  │                                      │
│ 🆕 المُكتشَفة│                                      │
│ ⏱️ المسح    │                                      │
│ 🗺️ خريطة     │                                      │
│ 🔔 الإِشعارات│                                      │
│ 📋 السجل     │                                      │
│ 👤 الملف      │                                      │
│ 💾 نَسخ        │                                      │
│ 🔄 تَحديثات     │                                      │
└────────────┴─────────────────────────────────────┘
```

### PB — تَحسين **المظهر اللَيلي** في خريطة المواقع (admin + public)

- إِضافة مُتغيّرات لِـ الث incomes للـ map في `body.dark`:
  ```css
  body.dark {
    --map-zone-bg-offset: rgba(255, 255, 255, 0.04); /* خلفية بطاقة مُجَدَّدة لليلي */
    --map-subzone-border: var(--border);
    --map-device-hover: rgba(255, 255, 255, 0.06);
    --online-glow: rgba(34, 197, 94, 0.40);
    --offline-glow: rgba(239, 68, 68, 0.40);
    --unknown-glow: rgba(156, 163, 175, 0.20);
  }
  ```
- تَطبيق `--map-zone-bg-offset` عَلى `.map-zone-card` (الخلفية inline inline `--node-bg` ينتُج مِن `kindColor()` يَحتاج أَن يُحَدَّث — انظر لاحِقًا).
- إِضافة `box-shadow` glow خفيف للـ dots الـ online (`box-shadow: 0 0 4px var(--online-glow)`).
- تَحسين `border-color` في وضع ليلي للـ has-offline/has-online.

### PC — **نِسبة التَشغيل** في الصَفحة العامة في تَبويب عرض الخريطة

- عِند `loadPublicMap`, اِستِخراج `online/total` من `rootData` (root عَلَوى).
- إِضافة كَتابة داخل `#map-view` (أَعلى الـ `.map-grid`):
  - `<div class="map-uptime-bar">نِسبة التَشغيل: 🟢 40% (2/5 connected — لِـ 41 جهاز)</div>`
- تَحديث نِسبة مع polling (تَكُون مَوضُوعة في `node` = root_meta). نَفس style شريط تقدّم بِـ خَلفية مُتدرّجة أَخضر/أَحمر.

### PD — **ترتيب الإِطارات "متصلة على التَوالي"** في خريطة المواقع

**المُشكلة الحالية**: zone-cards في `.map-grid` تَتدفّق random في auto-fill grid — **لا تَدُلُّ على تَسلسل hierarchi**.

**الحل المُقَترَح (خِيار A: sequential numbers + ربط بَصري داخِلي)**:
- إِضافة **رقم تسلسلي** على كلّ zone-card (مثلاً `#1`, `#2`, ...).
- **اِختِياري B**: إِضافة **`::after` pseudo-element** مع نَقطة-صغيرة → سَهم → نَقطة بَين البطاقات في `order` CSS. صَعب grid layout-flow.
- **اِختِياري C (أَكثر قُوّة bصرِيّة)**: تَحويل `#map-grid` إِلى `flex-direction: column` مَع **خطّ يَصِل بَين البطاقات** عَبر `::after` border-left تَرسُم فِعلِي. لاكن أَقلّ responsive مِن grid.

**اِستِنتاج مُقَترَح**: خِيار **A + A'**:
1. نُرقِّم zone-cards بِـ تَسلسل (`aria-label="منطقة 1 من N"`)، وأيقونة `#❶❷❸` أَو نَصّ `#1` على header.
2. نَضِيف CSS connector بين بطاقات متجاورة (`::before` خَطّ متقطع يَرسم عَمودي إِلى البطاقة التالية):
   - في `#map-grid`, البطاقة غير الأَخيرة تَحصل على `class="linked-next"` + `::after` خَطّ رمادي رأسي مُتقطع.
3. **في الواقع**: `display:grid` لَا يُمكن رَسم خَطّ بَين نِقاط grid مُنفصلة بسهولة CSS فقط. لذلك نَحوّل layout للزر:
   - **أَفضَل**: نَبقِي grid و نَكتفي **بِـ تَرقيم ❶❷❸ + أيقونة `↻` أَو `↪` "متصل بِـ التالي" في جِسم البطاقة. a11y يَكُون عبر `aria-posinset`/`aria-setsize`.
4. الإِضافة المرنة: `.map-zone-card .map-zone-header::before` بِـ `content: counter(zone-sequence)` ← counter CSS.

**تفيل رمز مُختَصر** (Auto-generate Counter):
```css
.map-grid { counter-reset: zone-sequence; }
.map-zone-card .map-zone-header::before {
  content: counter(zone-sequence, decimal-leading-zero);
  counter-increment: zone-sequence;
  font-size: 0.7rem; color: var(--muted);
  padding: 0 0.3rem; opacity: 0.7;
}
```
يَظهر الرّقم (01، 02، 03...) تَلقائيًّا في بِداية header كلّ بطاقة يَفي دلالة "متصلة على التَوالي". أَضِف aria-posinset من JS للتأكُّد من accessibility.

### PE — **تَحسين لون إِطار الأَجهزة المُتصلة** (online)

المُشكلة: `.map-zone-card.has-offline` → border أَحمر واضح. لا يُوجَد `.has-online`، لِـ zones كلّها online الـ border هو الافتراضي (`#9e9e9e`) → لا يَكُون مُمَيَّز.

**الحل**:
1. في `admin-map.js::renderZoneCard` + `public-map.js::renderZoneCard`:
   - إِذا كانت `node.online > 0 && node.offline === 0 → اِضِف `has-online` class.
2. CSS:
   ```css
   .map-zone-card.has-online {
     border-color: var(--online);
     border-width: 2px;
     box-shadow: 0 0 0 1px var(--online-glow, rgba(34,197,94,0.20));
   }
   body.dark .map-zone-card.has-online { box-shadow: 0 0 6px var(--online-glow); }
   ```
3. تَحسين dot للأجهزة الـ online:
   ```css
   .map-zone-device[data-status="online"] .map-device-dot {
     background: var(--online);
     box-shadow: 0 0 4px var(--online-glow);
   }
   ```

### PF — **خِيار "مسح حالة الأَجهزة" (أسبوع/شهر/سنة) عامّ**

**الخلف**:
- إِضافة endpoint جَديد في `backend/src/routes/devices.routes.js` (لو مُناسِب) أَو مَلف نَوعيّ `cleanup.routes.js`:
  ```js
  // POST /api/admin/devices/cleanup-history
  // body: { range: 'week' | 'month' | 'year' }
  // يَحذف downtime_events النَتاج أَكبر من:
  //   week  → older than now - 7 days
  //   month → older than now - 30 days
  //   year  → older than now - 365 days
  router.post('/cleanup-history', requireAuth, async (req, res) => {
    const { range } = req.body;
    const days = range === 'week' ? 7 : (range === 'month' ? 30 : 365);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    // باِستِعمال DB wrapper (db.run / db.query):
    const info = await db.run(
      'DELETE FROM downtime_events WHERE end_at IS NOT NULL AND end_at < ?',
      [cutoff]
    );
    res.json({ success: true, deleted: info.changes, range, cutoff });
  });
  ```
- يَلزَم تأكيد admin (requireAuth). **لا يَمسح دفعة "ongoing"** (`end_at IS NULL`) ولا مُستقبل-داتا سِوى past.

**الوَاجهة**:
- زرّ جديد في تَبويب "📋 السجل" (`section-logs`) أَو "💾 النسخ الاحتياطي":
  - `<button id="clear-history-btn">🗑️ مَسح سجل الأَحداث</button>`
  - يَفتِح popup (نَقطة #7) بِـ خِيارات `[أُسبوع | شهر | سنة | إِلغاء]`.
  - نَتيجة: toast بِعدد الصُّفوف الممحُوّة + تَاريخ cutoff.

### PG — **popup تأكيد لِـ كُلّ تَعديل في جَميع تَبويبات لوحة الإِدارة**

- إِضافة مُرَكَّز في `admin-utils.js` دالّة عاِمة `confirmAction(opts)`:
  ```js
  // opts: { title, message, confirmText='تأكيد', cancelText='إِلغاء', danger=false, onConfirm, onCancel }
  // يَفتِح modal عَ بِشَكل دِيناميكي (لاحِقاً يُضاف modal template في dashboard.html)
  function confirmAction(opts) {
    const modal = document.getElementById('confirm-modal');
    // ... مَلأ العنوان + النَصّ + الأَزرار، يَبَدّل danger class.
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    // trap focus, ESC يُلغي, click outside يُلغي ...
  }
  ```
- مَلف HTML لِـ modal تَأكيد يُضاف في `dashboard.html` (نَفس modal موجود لكن لا بـ المكان كَامل):
  ```html
  <div id="confirm-modal" class="modal-confirm hidden" role="dialog" aria-modal="true" aria-hidden="true">
    <div class="modal-confirm-content">
      <h3 class="modal-confirm-title">—</h3>
      <p class="modal-confirm-message">—</p>
      <div class="modal-confirm-actions">
        <button type="button" id="confirm-cancel-btn" class="btn">إِلغاء</button>
        <button type="button" id="confirm-ok-btn" class="btn btn-danger">تأكيد</button>
      </div>
    </div>
  </div>
  ```
- CSS لـ `.modal-confirm` (similar بـ `.map-modal` أعلاه في `style.css`).
- اِسْتِدعاء `confirmAction` في كلّ `addEventListener` **التَعديل / الحَذف** في:
  - `admin-devices.js`: حَذف جِهاَز، رِست `is_active`، حِفظ تَعديل device، مَسح IP-dupe.
  - `admin-locations-types.js`: مَسح location/type، تَعديل location.
  - `admin-notifications.js`: مَسح/sending test.
  - `admin-profile.js`: حِفظ كلمة السرّ (popup تأكيد أَنّ المُستخدِم يَعرف التَأثير).
  - `admin-backup.js`: اِستِرجاع backup (popup "سَيُكتب عَلى DB فعليّ — مُتأَكّد؟").
  - `admin-discovery.js`: اِ战略 scan.
  - `admin-scheduler.js`: تَفعِيل / إِيقاف.
  - `admin-map.js`: (لا تَعديل في خريطة حاليًّا — لا لَزوم).
- الاستبدال: `if (confirm(...)) → اِستَعمِل await confirmAction(...)`.

---

## 🔧 تَنفيذ (مُقَترَح ترتيب 6 خُطوات)

### 1️⃣ PA: sidebar
- اِستِبدال `<header>` + `<nav>` في `dashboard.html` (سطر 11-32) بِـ sidebar + main.
- CSS جَديد `.sidebar`, `.dashboard-main`, `@media drawer`, زرّ 🍔.
- الاختبار: نَقر أَزرار التَبويبات يَفتح قسم صحيح + scroll يَبقى في main.
- اختبار responsive: < 768px sidebar يَنطوي.

### 2️⃣ PG: popup modal
- إِضافة `#confirm-modal` في `dashboard.html` + دالّة `confirmAction()` في `admin-utils.js`.
- الِمerez أولًا: زرّ "مسح التَاريخ" (PF) يَستَعمِله.
- نَقِل باقي الـ `confirm()` callees في `admin-*.js` في JS بطيّئة (lazy refactoring).

### 3️⃣ PE: تَحسين لون إِطار online
- `admin-map.js::renderZoneCard` + `public-map.js::renderZoneCard`: تَفعِيل `has-online` class.
- CSS `.has-online` (flat + dark) و dot glow.

### 4️⃣ PB: الثيم اللَيلي لِـ map
- مُتغيّرات ليلية في `body.dark` + تَطبيق عَلى `.map-zone-card`, `.map-zone-header`, `.map-device-dot` (glow).

### 5️⃣ PD+PC: تَرقيم + نِسبة تَشغيل
- CSS counter `::before` عَلى `.map-zone-header`.
- `public-map.js`: bar للـ "نِسبة التَشغيل" تَحت `#map-view` (تَحديث من polling).
- a11y: `aria-posinset` + `aria-setsize` عَلى `<article>`.

### 6️⃣ PF: مسح التاريخ + endpoint + UI
- `backend/src/routes/devices.routes.js` الزِّيادَة (endpoint `POST /cleanup-history`).
- لو يُفضَّل تصميم منفصل → `backend/src/routes/cleanup.routes.js` جَديد في `server.js` `app.use('/api/cleanup', cleanupRoutes)`.
- زرّ في `section-logs` → popup (PG) → fetch → toast.

---

## ✅ نَقاط اختبار (v2.7.0)

### اختبار آلي
```bash
cd "E:/New claude/network-monitor-v2.5.0-dev"
node --check frontend/public/js/admin-utils.js
node --check frontend/public/js/admin-map.js
node --check frontend/public/js/public-map.js
node --check frontend/public/js/public-dashboard.js
node --check backend/src/server.js
node --check backend/src/routes/devices.routes.js  # (أو cleanup.routes.js)
bash -n deploy.sh
```

### الـ GUI
1. Admin: القائمة الجانبية → صَحيحة، فتح أَيّ تبويب، تحا جانب المُحتوى.
2. Admin: < 768px → 🍔 يَفتِح drawer.
3. Admin: حَذف جهاز → popup تأكيد (PG).
4. Admin: زرّ مَسح سجل → popup → اختيار شهر → toast 200 deleted.
5. Admin: خريطة المواقع في الوضع اللَيلي → borders واضحة، dots glow أَخضر للأَجهزة online.
6. Admin: خريطة المواقع → البطاقات مُرقَّمة 01, 02... "مرتبطة التالي".
7. Public: تَبويب 🗺️ → bar "نِسبة التَشغيل: 4.9%" (مثلا) في الأَعلى، تَتحدّث في polling.
8. Public: × ساعة، polling يَحدّث bar.
9. Mobile (< 768px): sidebar drawer صحيح في admin, kards map تتدفّق بشكل responsive.

---

## 🚧 قُيُود الجلسة

- **لا تَمسّ `/api/map/tree`** ولا `/api/map/public/tree` شِكلاً — للخَريطة بِـ إِضافة مَعلومات فرعية يتم عن طريق المُواجِهِر، لا تَكسر الـ عقد بين admin/public.
- **لا تَكشِف data حساسة** في `/api/map/public/tree` — الـ listener الموجُود mِني مُدخَر بي المُوجُود.
- **اِستِعمال `confirmAction()`** بدَل `confirm()`windows/`alert()` في كلّ أَزرار التَعديل (نَفس مُحَرَّم v2.6.0 نَفسه — popups styled; native modal ممنُوع).
- **`downtime_events` مَحذُوف بِ군بَة في **past only** (لا يُمسح ongoing دفة الانقطاع ز phoneًا `end_at IS NULL`).
- **لا CDN جَديد** — لا يُمكِن أَن يُؤمِّن layout sidebar بِـ CSS بَسيط grid/flex (لا Vue/React).
- **compatibility**: admin-utils.js يَنبَغِي أَن يَبقى `view`-toggling للقِسام `_ajax` + `.hidden` مُتَجَتَّب (تَفادية بـ controlling CSS هفْق وع م nimi synced).

---

## 📎 مَوارد سَريعة لِـ الجلسة التالية

| ما تُريد وُجُوده | الموقع |
|---|---|
| `<header>` و `<nav>` (admin) | `dashboard.html:11-32` |
| `<section>` الأَقسام (admin) | تَبويب devices/locations/types/discovered/discovery/scheduler/map/notifications/logs/profile/backup/updates |
| تَبديل التَبويبات | `admin-utils.js` (ugno، lookup `tab-btn` / `.hidden`) |
| `confirm()` أَو `alert()` بُدُول أَخْرَى | grep على `window.confirm\|alert(` في `frontend/public/js/admin-*.js` |
| `.map-grid`, `.map-zone-card` CSS | `style.css:698-810` (أَثنَاء v2.6.0) |
| `renderZoneCard` admin | `admin-map.js:200-241` |
| `renderZoneCard` public | `public-map.js:111-145` (تَحقَّق من خطوط) |
| `downtime_events` tَسم | `backend/src/db/schema.sql` |
| `/api/devices/:id/history` مَوجُود | `devices.routes.js:46` |
| Auth middleware | `backend/src/middleware/requireAuth.js` |
| CSS قَطعة ليلية | `style.css:17-30` (`body.dark {…}`) |

---

## 🎯 مخرجات الجلسة المُتوقّعة

في نِهاية الجلسة يجب أَن:
- [ ] sidebar مُنجَز في `dashboard.html` + `style.css`، responsive < 768px.
- [ ] 't confirmAction() modal مُنجَز في `admin-utils.js` + dashboard.html.
- [ ] `has-online` class + t styles `online-glow` على `.map-zone-card` admin و public.
- [ ] `body.dark` تَحسِينات للـ map (bg, border, box-shadow, device-dot glow).
- [ ] تَرقيم zone-cards 01, 02... + aria-posinset.
- [ ] bar "نِسبة التَشغيل" في `#map-view` بِـ تَحديث polling 10s.
- [ ] endpoint `POST /api/admin/devices/cleanup-history` (week/month/year) مُنجَز + مُختبَر.
- [ ] زرّ مَسح سجل مَع popup اختيار المُدّة في `section-logs`/`section-backup`.
- [ ] `confirmAction()` مُستَعمِل بدَل `confirm()` في أَيّ popup تَعديل في كلّ `admin-*.js` المُتَأَثر.
- [ ] `node --check` PASS على كلّ JS.
- [ ] الالتزام `feat(ui): v2.7.0 — sidebar + map polish + uptime bar + history cleanup + confirm popups` + tag `v2.7.0`.
- [ ] تَحديث `HANDOFF.md` + `docs/PLAN-map-grid-view.md` (نَقل باقي نَقاط v2.7.0) + هذا الملف.

---

## 🔗 الجلسة السابِقة

- **v2.6.0** (الجِلسة الحالية، غير مُلتَزم بَعد بِـ tag): Zones-Grid view + public map view + toggle pills + polling 10s. اِنظُر `docs/PLAN-map-grid-view.md`.
- **v2.5.5**: تحسينات المسار (search/filter/chips/scroll/ARIA) بِـ النحت `4a5e0b4` (الـJOBB). مُشار إِليه في `PLAN-map-tab-polish.md`.

---

## 💡 ملاحظاتي للمُراجِع

- نَقطة #4 (#ترتيب الإِطارات "متصلة التَوالي"): خِيار CSS counter أَبسط وأكثر بَقاء على responsive grid. أَمّا إِذا أَردت رِباط عمودي مرئي (line بَين cards)، يَلزَم تَحويل `.map-grid` إِلى `flex-direction: column` ولا يَعُد responsive عَلى شاشات عَريضة (تا تَأخَّذ 1 عمود). **a11y-friendly أعلى الأَولوية** — اِنطِلاق بِـ counter + aria-posinset، ثُمّ حُكم بِـ سؤال المُستخدم إِذا أَراد خِطوط أَيقونية.
- نَقطة #3 (#نسبة التَشغيل): polling 10s يَكُون كَافِي لتَحديث bar ; لا حاجة لـ polling أَسرع. طَريقة عرض: شريط تقدّم (progress) بِـ خَلفية متدرّجة (online→offline) + نَص "N% — K mِن 41 متصّل".
- نَقطة #6 (#مسح التاريخ): يَنُصَح يُفصَل `routes/cleanup.routes.js` عن `devices.routes.js` لِـ فَصل المسؤولية. اختِرار تَقنيّ يَفعله المُنفّذ.
- نَقطة #7 (#popups): سيَكُون نَقلاً بَطيئًا و مُراجَعة `confirm()` في عَديد `admin-*.js` — يُمكن تَقسيمها عَبر جلسات: الأَوّلى (modal) + مُعدّلات ذات أَثر عالٍ (Delete أَو Restore Backup) ← ثانية لاحِقًا (low-risk edits).
