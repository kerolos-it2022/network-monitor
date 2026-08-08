# 🗺️ خطة الجلسة التالية (v2.6.0) — تَحويل عرض الخريطة إِلى «مُربّعات Zones» + إِضافتها لِـ الصَفحة العامة

> **أَنشأَت هذه الجلسة**: 2026-08-07 (بَعد اِنتهاء v2.5.5 — تحسينات بحث/فلترة/حفظ scroll على تَبويب خريطة المواقات ذات الشَجرة المُتداخلة).
>
> **دافِع التَحول**: المُستخدِم شَخّص أَنّ الشَجرة `ul/li` المُتداخلة الحالية (حتى بَعد تحسينات v2.5.5) **مظهرها غَير مُنسّج مَع العَيـن** — ستظر المناطق (zones) كقَوائم مُنسدلة متداخلة عُموديًّا. المطلوب: **عرض Zones مُرتّبة على التَوالي في شكل مُربّع** (grid/flex مُريح للعَيـن)، بِدَل القَوائم المُنسدلة.
>
> **الطَلب الثّاني**: **إِضافة «خريطة المواقع» في الصَفحة العامة `index.html`** بِـ جانب الأَيقونات التي تُبَدّل الـ view (`🗂️`/`📋` الموجُودة عند `index.html:51-54`).

---

## 0. الحالة الحالية (من الكود)

### 0.1 تَبويب خريطة المواقع (admin) — `frontend/public/admin/dashboard.html`
- `#section-map` (نفسه الذي عُدّل في v2.5.5) يَعرِض `<ul class="map-tree">…</ul>` متداخِلة داخل `#tree-container` بِـ class `d3-tree`.
- أَنماط `style.css`: `444-695` (`.d3-tree` + `.map-tree/.map-children` + `.map-node-html/.map-node-row` + connector L-lines + depth-staircase via `data-depth` + `.kind-*` layout).
- بناء الشَجِرة بِـ `frontend/public/js/admin-map.js` (v2.5.5) دالّة `renderNode(node, depth, path)` تَولّد `<li class="map-node-html kind-${kind}">…` recursive عَبر `renderNode → renderChildren → renderNode`.
- أَنواع `kind`: `root|internet|zone|site|building|floor|room|rack|unassigned|device`.
- API `/api/map/tree` يَرجِع جذرًا مُتداخلًا: `internet` → `zones` → `devices` (مع `online/offline/unknown` لِكل عُقدة).
- الـ search + الفِلترة + الـ chips + حفظ scroll (إضافات v2.5.5) — يجب أَن **تَعمل في الوضع الجَديد** أَو تُختزل.

### 0.2 الصَفحة العامة — `frontend/public/index.html` (137 سَطر)
- `<section class="filters-bar">` (سطر 33) فيها: `#search-input`, `#filter-type`, `#filter-location`, `#filter-status`, `#filter-sort`, ثُمّ `.view-toggle` (سطر 51).
- `.view-toggle` يَحوي زرّين: `view-cards-btn` 🗂️ (active default, `display:grid` على `#devices-grid`)، `view-table-btn` 📋 (active → `#devices-table-view`).
- `<main>` (سطر 75) يَحوي `#devices-grid` + `#devices-table-view` (hidden).
- آخر سكريبتات: `Chart.js` (CDN — هذا مَوَلّد حاليًّا حسب قُيُود)، `js/charts.js`، `js/public-dashboard.js` (يَحمّل الأَجهزة و يَبني views).
- لا يَطلب تَسجيل دخول — API عمومي مُقتَطع لِـ حالات الأَجهزة.

### 0.3 API الخلف — `backend/src/routes/map.routes.js` (334 سطر)
- `GET /api/map/tree` (محمِي بِـ auth admin) يَرجِع شَجِرة مُتداخلة (`{success, data}`).
- **لكنّ الصَفحة العامة لا تَستعمله** (الـ admin فقط). للجلسة التالية **يَلزَم**:
  - إِمّا تَغْيير `/api/map/tree` إِلى وَضع public (مُخاطِر)، أَو **إِضافة `/api/public/map/tree`** يُرجِع نَفس الشَجِرة بِدُون حاجة auth (لِـ الصَفحة العامة) — هذا الأَنسب و أَكثر أَمنًا.

### 0.4 أَنماط الشَبكة العامة `frontend/public/css/style.css`
- `.view-toggle` / `.view-btn` (مَوجُودة في 112-127 عند تَنسيق سابق) — **استعمل نفسها بِـ زرّ جَديد `.view-btn#view-map-btn`**.
- `.devices-grid` (display grid بِـ auto-fill minmax بطاقات).

---

## 🎯 نَطاق الجلسة التالية (v2.6.0)

### 🅿️A — إِعادة تَصميم عرض «خريطة المواقع» في لوحة الإِدارة (admin)

**الهدف**: اِستبدال الشَجِرة المتداخلة `ul.map-tree` بِـ **عرض مُربّع (grid)** لِـ **zones** مُرتّبة على التَوالي — كل zone بطاقة قابلة لِـ طي/تَوسيع بِـ شَكـل مُريح بَصريًّا، مع أَجهزتها بداخلها (cards أَو chips).

**خياران للتصميم (ناقِش المُستخدِم)**:

#### 🅰️ خِيار A: Zones-Grid مُسطّح (بَساطة قُصوى)
```
┌─────────────────────────────────────────────────────────────┐
│ [🔄 تحديث] [🔍 بحث…] [فلتر الحالة] [✖ مَسح]  الإجمالي: 41  │
├─────────────────────────────────────────────────────────────┤
│ 📍 الادارة-الدور الثالث     📍 الادارة-الدور الثانى          │
│ ┌─────────────────────┐    ┌─────────────────────┐         │
│ │ 🟢0 · 🔴33 · ⚪0   (33)│    │ 🟢0 · 🔴13 · ⚪0   (13)│         │
│ │ ─────────────────────│    │ ─────────────────────│         │
│ │ ▼ الأَجهزة (33):    │    │ ▼ الأَجهزة (13):    │         │
│ │ • DVR OFFICE...     │    │ • ACCESS POINT...   │         │
│ │ • ESXi SERVER...    │    │ • ماكينه طباعه...   │         │
│ │ … (scrollable)      │    │ …                   │         │
│ └─────────────────────┘    └─────────────────────┘         │
│                                                             │
│ 🏛️ الورشة-1   🏛️ الورشة-2  🏛️ عنبر الكتاين  🏛️ البوفية   │
│ …                                                           │
└─────────────────────────────────────────────────────────────┘
```

#### 🅱️ خِيار B: خريطة شَبكية Grid Hierarchy (حِفاظ بَصري على التَسلسل)
- كل zone kard بِـ header مُصغَّر + nodes الأَبناء مُرتّبين داخله (buildings/floors…) كـ sub-cards.

**اِستِنتاج مُقترَح**: نَبدأ بِـ **الخِيار A** (بَساطة و سُرعة تَنفيذ) و نَحتفظ بِـ الكود لِـ التَوسّع لِـ B لاحقًا.

---

### 🅿️B — إِضافة «خريطة المواقع» في الصَفحة العامة `index.html`

**التَنفيذ**:
1. إِضافة زرّ ثالث إِلى `.view-toggle` (سطر 51) في `index.html`:
   ```html
   <button type="button" id="view-map-btn" class="view-btn" title="عرض الخريطة">🗺️</button>
   ```
2. إِضافة عُنصر `<div id="map-view" class="hidden">…</div>` في `<main>` بِـ جِوار `#devices-grid` و `#devices-table-view`.
3. **API جَديد**: `GET /api/public/map/tree` في `backend/src/routes/map.routes.js` يَرجِع نفس الشَجرة بِـ auth يُساوي `false` (أَو guest/public middleware). **لا مَسّ `/api/map/tree`**.
4. JS جَديد: `frontend/public/js/public-map.js` يَحمّل الشَجرة من `/api/public/map/tree` و يَبني نفس Zones-Grid (مُشاركة المظهر مَع admin بِـ CSS مُشترك في `style.css`).
5. listener على `#view-map-btn.click` يَخفي `#devices-grid` + `#devices-table-view` و يُظهِر `#map-view`. (نفس نمط `view-cards-btn`/`view-table-btn`.)
6. **auto-refresh**: ESG نفس صيغة `public-dashboard.js` (poll كل X ثانية).

---

## 🔧 تَنفيذ الخِيار A (Zones-Grid) — مُقترَح تَقني

### A.1 HTML جديد / تَعديل `dashboard.html` (`#section-map`)
اِستبدِل `<div id="tree-container">…</div>` بِـ `<div id="map-grid" class="map-grid"></div>` (**لا حاجة لِـ UL المُتداخل**). اِحفظ `#map-summary`, `#map-search`, `#map-filter-status`, `#map-clear-filters` من v2.5.5 (toolbar يَبقى).

### A.2 JS تَغيير جَوهري في `admin-map.js`
- دالة `renderTree(rootData)` تُعاد كِتابتها لِـ تَستدعي `renderZonesGrid(rootData)` بدل `renderNode(rootData, 0, '1')`.
- دالة جديدة `renderZonesGrid(rootData)`: تَمشي الأَبناء المباشرة لِـ `rootData.children` (zones/sites/internet)، و لِـ كُل وَاحِد تَولِّد kard:
  ```html
  <article class="map-zone-card kind-${kind} ${offline>0?'has-offline':''} ${collapsed?'collapsed':''}"
           data-id="${id}" data-kind="${kind}">
    <header class="map-zone-header">
      <span class="map-zone-icon">${icon}</span>
      <span class="map-zone-name">${name}</span>
      <span class="map-zone-stats">🟢${online} · 🔴${offline} · ⚪${unknown} (${device_count})</span>
      <button type="button" class="map-zone-toggle" aria-label="توسيع/طي" aria-expanded="${!collapsed}">▼</button>
    </header>
    <div class="map-zone-body">
      <!-- أَجهزة الـ zone مُدرَجة (chips أَو list-item مُصغَّرة) أَو zone فرعية لو التسلسل عميق -->
    </div>
  </article>
  ```
- اِفتراض: عرض zone-deep hierarchies (building/floor/room) في نَفس الـ kard أَو sub-kards — يَتِم تَخزين الـ deep tree في الزرّ «▼ تَوسيع الأَبناء».
- اِستدعاء `esc()`, `nodeTooltip()` الحالية من v2.5.5.
- الإبقاء على `mapSearchQuery`, `mapStatusFilter`, `mapCollapsed`, `applyStatusFilter`, `clearMapFilters`, `showMapToast`, `loadMap` (Tweak لـ fetch).
- `bindNodeEvents` تُعاد لِـ delegation على `#map-grid` (نقر kard header → toggle؛ نقر device → modal). لا getrennte نقر مزدوج مضاعفات.

### A.3 CSS جديد `.map-grid`, `.map-zone-card`, `.map-zone-header`, `.map-zone-body`, `.map-zone-toggle`, `.map-zone-stats`, `.map-zone-device`
- `.map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; }` (مُربّعات تَتدفّق على عُرض الشَاشة).
- `.map-zone-card { … }` (بطاقة بِـ `border: var(--node-border)`, `border-width: var(--node-border-w)`, خِلفية `--node-bg`, transition collapse عبر max-height).
- لو `has-offline`: لون `--offline` على الإطار.
- `.map-zone-body.collapsed { max-height: 0; }` (نفس transition ك текущ `.map-children`).
- للجهاز: `.map-zone-device` بِـ chip مُصغَّر مَع لون الحالة.
- RTL تلقائي بِـ `direction: rtl` (يَرث من الجسم).
- الثيم اللَيلي يَعمل عبر متغيرات CSS.
- لا تَمسّ القواعد القَديمة `444-800` (لِـ التَوافق الرّجوع — للرَّغبة، نَحذفها يَوم v2.7.0 ك P2.3 أصلي).

### A.4 اِختبار — نفس سِيناريوهات v2.5.5 مَع `#map-grid` بَدل `#tree-container`.
- بحث/فلتر عبر `#map-search`/`#map-filter-status` يُعيد تَصفية kards.
- نَقر chip «🔴 N offline» يَخفي kards التي لا تَملِك offline + يُوسّع التي لَها.
- الحالة الفَرِغة «لا نَتائج» + خطأ شبكة + scroll بناءً على kards حُددَ.
- الثيم اللَيلي + RTL + keyboard + ARIA.

---

## 🅿️C — تغييرات API (مِقدار صَغير)

### C.1 `backend/src/routes/map.routes.js`
- لمس `/api/map/tree` (يَبقى كما هو bِـ auth) + إِِِِِِضافة `/api/public/map/tree` مَع middleware مُختلف (guest ولو `isAuthenticated = false` تَعطي عَم عام يَحدد الكُriteriya:
  - لو eig.Models لا تَملِك سلَّر textes Perdoner, navigation://apiPublicRoute مَع مُصاقبة ` MW` `isAuthenticated = false` يَرد NUll.
- اِرسال نفس JSON المُتداخل — لا تَغيير على shape الـ response.
- لا تَكشِف data حساسة (فقط device name + ip + status + location، لا user tokens).

### C.2 مَنظِّمَة: `database/schema.sql` / `db.js`
- لا تَغيير على الـ schema.

---

## 🅿️D — JS جديد لِـ الصَفحة العامة

### D.1 `frontend/public/js/public-map.js`
- نفخlich replica مُختَصَر من `admin-map.js` (عادةً fetch from `/api/public/map/tree` بِدُون cookies).
- لا modal تفاصيل (الصَفحة العامة بلا detail view — عرض مَختَصَر فقط).
- delegation على `#map-view` لِـ نَقر header toggУe.
- auto-refresh كل 30 ثانية (نفس نمط `public-dashboard.js`).
- RTL + dark theme تِلقائيّة.

### D.2 `frontend/public/index.html` — تَعديل قَليل
- زرّ `.view-btn#view-map-btn` (🗺️) في `.view-toggle` (سطر 51-54).
- `<div id="map-view" class="map-view hidden"></div>` في `<main>` (سطر 75-96).
- سكريبت `<script src="js/public-map.js"></script>` بعد `public-dashboard.js` (سطر 120).

### D.3 CSS تَكميلي في `style.css`
- `.map-view`/`.map-view.hidden` + استعمال نفس `.map-grid`/`.map-zone-card` من A.3.
- زرّ 🗺️: استعمال `.view-btn` (مَوجُود 112-127) — `.active` يَنتقل وفق الاختيار.

---

## ✅ نَقاط اختبار (v2.6.0)

### اختبار آلي
```bash
cd "E:/New claude/network-monitor-v2.5.0-dev"
node --check frontend/public/js/admin-map.js
node --check frontend/public/js/public-map.js   # جديد
node --check backend/src/server.js
bash -n deploy.sh
```

### الـ GUI
1. **admin**: تَبويب خريطة المواقع → zones مُربّعات مُسطّحة (لا ul متداخلة). اِنقر header → طي/تَوسيع الأَجهزة.
2. **admin filter**: بحث + chip offline + select online ك v2.5.5 يَفلتر kards.
3. **admin themes**: ثيم لَيلي + RTL على kards.
4. **public**: `http://localhost:4099/` → اِنقر 🗺️ في `.view-toggle` → `#map-view` يَظهر بِـ نَفس kards (بلا auth).
5. **public refresh**: auto-refresh 30ث على `#map-view`.
6. **public mobile**: responsive — kards تَلفّ على عُرض ضَيّق (grid auto-fill `280px`).

---

## 🚧 قُيُود الجلسة التالية

- **لا تَكشِف data حساسة** في `/api/public/map/tree` (لا credentials/tokens/timestamp مفصّل — فقط name/ip/status/location_digest).
- **لا مَسّ `/api/map/tree`** (admin يَبقى بِـ auth).
- **لا CDN خارجيّة جَديدة** (نفس القَاع: Chart.js موجود — لا تَضِف D3/Leaflet/Mapbox في v2.6.0).
- **حِفاظ على P0/P1 من v2.5.5** في وضع kards (search/filter/chips/scroll/error states Shoulds الغاصة على zone-card).
- **`map:filter-location`** dispatch on admin-map on the admin still has its dbclick-event (a zone-card غير جهاز يُطلِقها via double-tap on header).
- الثيم اللَيلي + RTL (yvariaboth auto works).

---

## 📎 مَوارد سَريعة لِـ الجلسة التالية

| ما تُريد وُجُوده | الموقع |
|---|---|
| تَبعية حَالي المُتداخلة (UL) | `admin-map.js:renderNode` (يُعاد تَصميمها لِـ renderZonesGrid) |
| Search/filter/listeners v2.5.5 | `admin-map.js:DOMContentLoaded` (~635) |
| `.view-toggle` / `.view-btn` | `style.css:112-127`, `index.html:51-54` |
| `.devices-grid` (نمط Public) | `style.css` (اِبحث `.devices-grid`) |
| API map الحالي | `backend/src/routes/map.routes.js:334` |
| Middleware auth | `backend/src/middleware/auth.js` (اِستعملها لِـ `/api/public/map/tree` بـ skip) |
| Public dashboard JS | `frontend/public/js/public-dashboard.js` (نمط fetch + render) |
| الصَفحة العامة | `frontend/public/index.html:137` |
| `style.css` map rules القَديمة | `style.css:444-803` (لا تَحذف في v2.6.0 — تستأذِن في v2.7.0) |

---

## 🎯 مخرجات الجلسة التالية المُتوقّعة

في نِهاية الجلسة يجب أَن:
- [ ] Zones-Grid مُنجَز في `admin-map.js` (خِيار A).
- [ ] `/api/public/map/tree` مُنجَز في `backend` (auth skip).
- [ ] `public-map.js` مُنجَز + مُختبَر في الصَفحة العامة.
- [ ] زرّ 🗺️ يُبَدّل العرض في `index.html`.
- [ ] v2.5.5 (search/filter/chips/error) يَعمل في وضع kards.
- [ ] الثيم اللَيلي + RTL + mobile responsive مُختبَرة.
- [ ] `node --check` PASS على كل JS.
- [ ] الالتزام `feat(map): v2.6.0 — zones grid view + public map view` + tag `v2.6.0`.
- [ ] تَحديث `PLAN-map-tab-polish.md` (نَقل نَقاط v2.6.0) + `HANDOFF.md` بِـ صaison v2.6.0.

---

## 🔗 الجلسة السابِقة

- **v2.5.5**: تَمّ الالتزام بِـ `4a5e0b4` (تحسينات البحث/الفلترة/حفظ scroll/ARIA على شَجعة UL المتداخلة). ها هِيَ الأساس الذي سَيَنتقل الكود مِنه إِلى v2.6.0.
- اِنظُر `docs/PLAN-map-tab-polish.md` لِـ تَفاصيل كاملة لِـ ما في النظام حاليًّا.
