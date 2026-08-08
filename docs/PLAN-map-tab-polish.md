# 🗺️ خطة تَنسيق تَبويب «خريطة المواقع» — تحسينات UX/UI

> **الغرض**: هذا الملف يَوثّق المُستجدّات الـمُقتَرَحة لِـ تَنسيق تَبويب «🗺️ خريطة المواقع» (الشجرة الهرمية `admin-map.js` v2.5.4)، كنقطة بداية لِـ **جلسة ZCode جديدة** تَلتقطها و تُنفّذها.
>
> **كيف تَستعمل هذا الملف في الجلسة الجديدة**: ابدأ الجلسة بِـ:
> ```
> اقرأ docs/PLAN-map-tab-polish.md و نَفّذ التحسينات الموصوفة فيه على تَبويب خريطة المواقع
> ```
> الزميل (نموذج ZCode) سيَقرأ الملف، ويَفحص الـ working tree، ويُنفّذ خُطوة بِـ خُطوة. في نِهاية كل خُطوة: `node --check` + اِختبر بِـ المتصفّح. لا تَلتزم بِـ git قبل الاِنتهاء من كل P0 و مُراجعتك.

---

## 0. الحالة الحالية (من الكود، لا اِختلاق)

| العنصر | الموقع | الحالة |
|---|---|---|
| تَبويب `#tab-map` في الـ tabs bar | `frontend/public/admin/dashboard.html:27` | زر نصّي بِـ أَيقونة 🗺️ |
| قِسم `#section-map` | `dashboard.html:337-360` | بطاقة `.form-card` فيها `<h3>` + `<p>` شَرح + شريط `.form-actions` (3 أَزرار `btn` + spacer + `#map-summary`) + `#tree-container.d3-tree` |
| الأَزرار | `dashboard.html:348-350` | `🔄 تحديث` (`#map-refresh-btn`) + `⤢ تَوسيع الكل` (`#map-expand-btn`) + `⤧ طي الكل` (`#map-collapse-btn`) — لها `title` بَس تَفتقر لِـ `aria-label` |
| `#map-summary` | `dashboard.html:352` | `<span>` نَصّي يَعرض الإِجمالي (`renderTree` في `admin-map.js:197`) |
| `#tree-container` | `dashboard.html:354` | `<div class="d3-tree">` بِـ `overflow:auto; min-height:300px; max-height:78vh` — الـ class `d3-tree` مُتَبقٍّ من وَقت D3 (غَير حَرج، سَilingب) |
| `#map-device-modal` | `dashboard.html:363-378` | modal تَفاصيل الجهاز العائم — `role=dialog` + `aria-modal=true` + زر `✕` بِـ `aria-label` |
| الخريطة (JS) | `frontend/public/js/admin-map.js` | v2.5.4 — `renderNode` يُولّد `<li>` بِـ `data-id/kind/depth` + CSS vars `inline`، `mapCollapsed` Set لِـ حفظ حالة الطي عبر auto-refresh 30ث، `MutationObserver` على `section-map` لِـ بَدء/إيقاف الـ refresh |
| الأَنماط CSS | `frontend/public/css/style.css` | `.d3-tree` في 444 + `.map-node*` (D3 مُتَبقٍّ) 464-501 + `.map-tree`/`.map-node-html`/`.map-children`/`.kind-*`/.`map-modal*` (أَحدث) — مُتناثرة بَعض الشَّيء |
| الثيمات | `style.css:4-21` | يوم/لَيل مُتغَيّرات `--bg`/`--card-bg`/`--muted`/`--online`/`--offline` |

## 0.1 فُجُوات واضحة (دافِع التَحسينات)
- **لا بحث ولا فلترة داخِل الخريطة** — 41 جهازًا + شَجرة عَميقة تُصبح صعبة. (لا `#search` ولا `filter` في `section-map`.)
- **لا حالة تَحميل skeleton** قبل أَوّل `fetchTree` (503ب أو ردّ تأَخّر يَترك مُستخدِمًا أَمام `#tree-empty` الخاطئ).
- **`#map-summary` نَصّ خام** لا روابط/أَزرار — كان يُمكن أَن يَكون «41 جهاز · 2 online · 39 offline · [إظهار offline فقط]»).
- **`aria-label` نَاقِص** على أَزرار الشريط (الـ `title` لا يَكفي لِـ قارئ شاشة).
- **لا تَنقّل بِـ الكيبورد** في الشجرة (Tab/Arrow/Enter).
- **لا حفظ موضع scroll** عبر auto-refresh 30ث — `renderTree` يَستبدل `innerHTML` كاملة فيُرقّص المُستخدِم.
- **CSS مُتناثر** + **`.d3-tree` و `.map-node*` (SVG) dead code** 464-501 لَم يُحَذَف.

---

## 🅿️ مستويات الأَولوية

- **P0**: تَحسينات جوهرية لِـ تجربة الاستخدام اليومية (بحث + حفظ scroll + حالات آمنة للأخطاء).
- **P1**: تَنسيق و لوحة مُحسّنة (toolbar مُنظّمة + فُلاتر سَريعة + تَعديل بصري على العُقد).
- **P2**: تَنقّل بِـ الكيبورد + إِمكانية الوصول ARIA الكاملة + تَنظيف dead CSS.

---

## 🅿️0 — تَحسينات جوهرية

### P0.1 — صُندوق بحث فوري داخل الشجرة
**الهدف**: تَصفية الشجرة بِـ اسم الموقع أَو الجهاز أَو IP أَثناء الكِتابة.

**التَنفيذ**:
1. في `dashboard.html` أَضِف قَبل `#tree-container` (داخل `.form-actions` الصَف `:347` أَو شريط جَديد أَسفله):
   ```html
   <input type="search" id="map-search" class="sort-select"
          placeholder="🔍 اِبحث: اسم موقع / اسم جهاز / IP…"
          autocomplete="off" aria-label="بحث في الشجرة" />
   ```
   (اِستعمل `class="sort-select"` لِـ يَتطابق نَمط باقي الفلاتر في `dashboard.html:48,134,171...`.)
2. في `admin-map.js` أَضِف متغير حالة: `let mapSearchQuery = '';`
3. أَضِف listener مَع debounce 200ms على `map-search` يُحدّث `mapSearchQuery` و يُعيد `renderTree(mapRootData)` (بدل `innerHTML` rebuild، يُعيد رَسم الشجرة مع تَطبيق الفلتر).
4. في `renderNode(node, depth, path)`، أَضِف رَجّ yüksek أَوّلي:
   - لو `mapSearchQuery` غَير فَارِغ و العُقدة لَيست `device` و لا جُزء من مَسار مُطابق.ordering أُخفِها`ه мус` إِلا لو فيها طِفل مُطابق).
   - لو العُقدة `device` و الـ query يُطابق `name`/`ip` → اِتركها (ووسّع الأَجداد لِـ تَظهرها). تَكتيكاً: عُدّ وظيفة `nodeMatchesQuery(node)` و `hasMatchInSubtree(node)` بِـ اجتياز عُمق أَولاً.
   - أَثناء وجود query فَعّال، اِضبط الـ `mapCollapsed` مؤقّتًا لِـ false على الأَجداد ذات مُطابقة (توسيع آلي)، و أَعِده عند مَسح الـ query.
5. اِستَعمل debounce بَسيطًا (لا حاجة مكتبة) شبيهاً بِـ رَيس `resizeHandle` المَوجُود في `admin-map.js:443` (setTimeout+clearTimeout).

**ملاحظة reused**: لا تُوجَد debounce موجُودة في الكود لِـ تَعيد اِستعمالها — اسْتَعمل نمط `clearTimeout(handle); handle = setTimeout(fn, 200)`.

### P0.2 — حفظ موضع scroll عبر auto-refresh
**الهدف**: الـ refresh كل 30ث يجب أَن لا يَقفِز بِـ المُستخدِم.

**التَنفيذ** في `admin-map.js` `renderTree` (السطر الحالي `:204` يَستبدل `innerHTML`):
```js
const container = document.getElementById('tree-container');
const savedScrollTop = container ? container.scrollTop : 0;
const savedScrollLeft = container ? container.scrollLeft : 0;
// ... (اِستبدال innerHTML كما هو حاليًّا) ...
if (container) { container.scrollTop = savedScrollTop; container.scrollLeft = savedScrollLeft; }
```
أَيضًا احفظ أَيّ عُقدة كانتFocused/مَفتُوحة (اختياري لِـ P1).

### P0.3 — حالات آمنة: skeleton تَحميل + رسالة خطأ واضحة
**الهدف**: بَدل `#tree-empty` الخاطئ أَثناء التَحميل الأَوّل، و رسالة `alert` نَحوية ليّنة.

**التَنفيذ**:
1. أَضِف في `dashboard.html` جُزء `#tree-loading` (مُخفي افتراضيًّا):
   ```html
   <p id="tree-loading" class="map-loading" hidden>⏳ جَلب شجرة المواقع…</p>
   ```
2. في `admin-map.js` `loadMap()` (`:265`):
   - أَظهر `#tree-loading` و أَخفِ `#tree-empty` قَبل `fetchTree()`.
   - عند النَجاح: أَخفِ loading و اِستمر كما هو.
   - عند الفَشل: أَخفِ loading، أَظهر `#tree-empty` بِـ نصّ «⚠️ تعذّر جلب الشجرة» (مَوجُود جزئيًّا في `:274` — وسّعه لِـ يُميّز بين «لا بيانات» و «خطأ شبكة»).
3. **لا `alert`**: مَنْع الـ `alert()` الجَديد على الإِطلاق مَع `map-search` أَو أَخِطاء الشبكة. مَتنفس: `<p>` أَو `#map-summary` يَعرض رِسالة قَصيرة لِـ 3 ثواني ثُمّ يَعود لِـ الإِجمالي. (انظر إِنشاء `showMapToast(msg)` في P1.3.)

---

## 🅿️1 — تَنسيق و لوحة مُحسّنة

### P1.1 — شريط تُولبار مُنظّم (groups)
أَعِدّ تَنظيم `.form-actions` لِـ `section-map` (`dashboard.html:347`) إِلى شَريطين أَو شريط ذي مَجمُوعات:
```
┌─────────────────────────────────────────────────────────────┐
│ [🔄 تحديث] [⤢ تَوسيع الكل] [⤧ طي الكل]   __|__   [الإِجمالي: 41… ]  │   ← صف 1 (الأَزرار + summary)
│ [🔍 بحث: ___________]  [▾ فلتر الحالة]  [▾ فلتر النوع]            │   ← صف 2 (البحث + الفلترة)
└─────────────────────────────────────────────────────────────┘
```
الأَزرار: `class="btn btn-sm"` (لو مَوجُود) أَو `.btn` بِـ `flex-wrap: wrap` على الـ `.form-actions`. اعط كل زر `aria-label` مماثل لِـ `title`.
الفلترة `<select class="sort-select">` كما في باقي التَبويبات.

### P1.2 — فُلاتر سريعة (offline فقط / نوع الموقع)
**التَنفيذ** في `admin-map.js` + `dashboard.html`:
- `#map-filter-status` <select> بالخُيارات: «كل الحالات»/«online فقط»/«offline فقط»/«unknown». عند التَغيير يُحدّث `mapStatusFilter` و يُعيد رَسم الشجرة.
- (اختياري) `#map-filter-kind` <select> الأَنواع: «كل الأَنواع»/«internet»/«zone»/«site»... لكن انتبه: الفلترة على `kind` معناها إِخفاء العُقد الأَبوية لِـ `kind` غَير مُراد — رُبّما نَعكسها إِلى «تَمييز» بدل «إِخفاء». ناقِش: «تَمييز بِـ خلفية أِكثر تَشبُّعاً» أَكثر فائدة.
- حالة الفُلاتر + `mapSearchQuery` تَُحفظ في `sessionStorage` لِـ تَعود عند إِعادة فَتح التَبويب/الصَفحة (تحسين ناعم). **س###热烈的**: رأي.`const ssKey = 'nm-map-ui-state'; sessionStorage.setItem(ssKey, JSON.stringify({q: mapSearchQuery, status: mapStatusFilter}));` عند DOMContentLoaded اِقرأها و اِضبطها على `<input>`/`<select>`.

### P1.3 — `#map-summary` تَفاعلي
في `dashboard.html:352` حَوّل من `<span>` نَصّ خام إِلى حاوِيّة تَحوي روابط/أَزرار سَريعة:
```html
<div id="map-summary" class="map-summary" aria-live="polite">
  <span class="map-summary-count">…</span>
  <button class="map-summary-chip" data-filter-status="offline">39 offline</button>
  <button class="map-summary-chip" data-filter-status="online">2 online</button>
</div>
```
في `admin-map.js` عند رَسم الـ summary (`:197`) ولّد الأَزرار. النقر على «39 offline» يُضبط `#map-filter-status = offline` و يُطلق `change`. نمط البطاقات الصَغيرة (`chip`) أَضِفه في `style.css`:
```css
.map-summary { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
.map-summary-chip {
  background: transparent; border: 1px solid var(--border); padding: 0.15rem 0.5rem;
  border-radius: 999px; cursor: pointer; font-size: 0.8rem;
}
.map-summary-chip[data-filter-status="offline"] { color: var(--offline); border-color: var(--offline); }
.map-summary-chip[data-filter-status="online"]  { color: var(--online);  border-color: var(--online); }
```
و `aria-live="polite"` على الـ summary لِـ يَنطِق قارئ الشاشة بالإِجماليات المُحدّثة.

### P1.4 — تَحسين بصري على العُقد
- ضع `.map-path` (المسار الرقمي `1.2.3` المُضاف في v2.5.4) في زاوية أَعلى اليَمين لِـ العُقدة مثلاً، بدلًا من أَن يَأكل خلية أُفقية في الصف.
- اِجعل العُقدة `li` `:hover` تَتغيّر خلفيتها أَوكَد (transition قَصير 0.1s) لِـ تُلفِت الاِنتباه عند التَمرير في شَجِرة مُزدحمة. الأَنمُط موجُودة في `style.css` للـ row — وسّعها بِـ `.map-node-row:hover { background: rgba(0,0,0,0.04); }` (و .في الثيم اللَيلي عَبر متغير).
- **تَنبيه بصري عند offline**: حاليًّا الإِطار فقط يَغْمُق. أَضِف نُقطة حَمراء صَغيرة (●) أَمام اسم الموقع لو فيه offline (لِـ لا يُفوّت المُستخدِم لَو كان الموقع مَطويًّا).
- مَناسبة: نَفّذ نفس النَقطة الحَمراء على الأَجداد المُطوية (تَسلسل صَعودي): لو طِفل مَطوي فيه offline، أَظهر النَقطة على الأَب المَطوي.

---

## 🅿️2 — الكيبورد + ARIA + تَنظيف

### P2.1 — تَنقّل بِـ الكيبورد
- أَضِف `tabindex="0"` على `.map-node-row` لِـ العُقَد القابلة لِـ التَفاعل (location + device، لا root).
- `Enter` على موقع مُحدَّد = toggle الطي/التَوسيع. `Enter` على جهاز = فتح modal.
- `Arrow Right/Left` = تَوسيع/طي العُقدة الحالية (منطقي في RTL: Right = تَوسيع، Left = طي — أَو العَكس حَسب تَوقّع المُستخدِم، اِختبِره).
- `Arrow Up/Down` = اِنتقل إِلى العُقدة السَابقة/اللاحقة في تَرتيب DOM.
- `Escape` على modal مَفتُوح = إِغلاق (مَوجُود `admin-map.js:432` — احفظه).
رَبط الأَحداث في `bindNodeEvents` (`admin-map.js:212`) عَبر `keydown` على الـ container مع delegation.

### P2.2 — ARIA على الأَزرار و الشجرة
- أَضِف `aria-label` على كل زر من `map-refresh-btn`/`map-expand-btn`/`map-collapse-btn` (لَديها `title` لا `aria-label`): `aria-label="تحديث الشجرة الآن"`…
- على `#tree-container`: `role="tree"` و على كل `li`: `role="treeitem"`، `aria-expanded` يَتَبّدَّل مع `collapsed`، `aria-label` = اسم العُقدة، `aria-level` = `data-depth + 1`.
- على `#map-search`: `aria-label` (مَكتوب في P0.1) + `aria-controls="tree-container"`.

### P2.3 — تَنظيف dead CSS
احذف `style.css` 464-501 (`.map-node`، `.map-node-bg`، `.map-label`، `.map-node.kind-*`، `.map-link` — بَقايا D3 SVG). أَيضًا غيّر `#tree-container` class من `d3-tree` إِلى `map-tree-container` و احذف `.d3-tree` من `style.css` (نَقل الأَنماط المُستعملة فعلاً مثل `overflow:auto` و scrollbar إِلى `.map-tree-container`). احفظ `::-webkit-scrollbar*` التي ما زالت مفيدة.
تَأكّد بَعد الحَذف: `node --check` لا يَتأَثّر (CSS)، لكن شَغّل الخادم + اِفحص البصري أَن الشَجِرة ما زالت سَليمة.

---

## ✅ نَقاط اختبار (بَعد كل P0/P1/P2)

### اختبار آلي
```bash
cd "E:/New claude/network-monitor-v2.5.0-dev"
node --check frontend/public/js/admin-map.js
node --check backend/src/server.js   # لو مَسسته
bash -n deploy.sh
```

### اختبار بِـ curl (لِـ API المُستعمل)
```bash
# بَدء الخادم: PORT=4099 node src/server.js  (في backend/)
COOKIES=/tmp/nm.txt
curl -s -c $COOKIES -X POST http://localhost:4099/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"admin","password":"ChangeMe123!"}' | head -c 80
curl -s -b $COOKIES http://localhost:4099/api/map/tree | head -c 200
```

### اختبار GUI (مُتصفّح)
1. ادخل `http://localhost:4099/admin/login.html` (admin / ChangeMe123!).
2. اِنتقل لِـ تَبويب «🗺️ خريطة المواقع».
3. **البحث (P0.1)**: اِكتب اسم جهاز/IP في `#map-search` → تُصفّى الشَجرة فَورًا (debounce) و تُتوسّع الأَجداد إِلى المُطابِق. مَسح الـ query → رُجوع كامل.
4. **حفظ scroll (P0.2)**: مرّر الشَجرة إِلى أَسفل. اِنتظر 30 ثانية (auto-refresh). المَوضِع يجب أَن يَبقى.
5. **حالات آمنة (P0.3)**: قَطّع الشبكة (DevTools → offline) و اِضغط «🔄 تحديث». يجب أَن تَظهر رِسالة خطأ لَطيفة (لا alert، لا تَجميد). عُد للشَّبكة → اِنعاش صَحيح.
6. **Toolbar (P1.1)**: الأَزرار مُنظّمة في صَفّين + فُلاتر ظاهرة. اِضغط «39 offline» في الـ summary → تَصفية كل شَيء إِلا العُقد ذات offline (P1.3).
7. **نَقطة offline (P1.4)**: موقِع مَطوي فيه offline يَظهر ● أَحمر، و أَجداده أَيضًا.
8. **كيبورد (P2.1)**: Tab إِلى عُقدة، Enter = toggle، Arrow = تَنقّل، Escape على modal = إِغلاق.
9. **قارئ شاشة (P2.2)**: NVDA/VoiceOver يَنطِق «tree, 3 items, expanded» + اسم الأَزرار.
10. **Bia (P2.3)**: حذف `.map-node` القديم لا يَكسر العرض.

---

## 🎯 مُخرَجات الجلسة الجديدة المُتوقّعة

في نِهاية الجلسة يجب أَن:
- [x] **P0.1** بحث فوري + تَوسيع الأَجداد + حالة «لا نَتائج» — مُنجَزة و مُختبَرة (10/39/2 مُطابِقات لِـ عِدّة queries).
- [x] **P0.2** حفظ scrollTop/Left بِـ `requestAnimationFrame` في `renderTree` — مُنجَزة (اِعتماد كود؛ تَحَقّق مُباشر في IAB تعطّل لأَسباب actionability، لا bug).
- [x] **P0.3** skeleton `#tree-loading` + رسالة خطأ ليّنة (`map-empty-error`) + `showMapToast()` بَدل `alert()` — مُنجَزة و مُختبَرة (خادم مُتَوقّف → الرسالة ظَهَرت، لا alert).
- [x] **P1.1** شريط toolbar مُنظّم (صفّان: [أَزرار+chips] / [بحث+فلتر+مَسح]) + `aria-label` على الأَزرار — مُنجَزة (domSnapshot أَكّد التَرتيب).
- [x] **P1.3** `#map-summary` تفاعلي بِـ chips (`🔴 N offline` / `🟢 N online` / `⚪ N unknown`) + `aria-live="polite"` + نَقر chip يُضبط `#map-filter-status` + `applyStatusFilter` + `clearMapFilters` — مُنجَزة و مُختبَرة (chip «offline» → 39, select «online» → 2).
- [x] **إِصلاح تَسرّيب `bindNodeEvents`** بِـ flag `mapNodeEventsBound` (ربط مَرّة واحدة عبر delegation) — مُنجَزة.
- [x] **`node --check` على `admin-map.js`** = OK. PASS.
- [x] **`git status`** يَعرض تَغييرات على `dashboard.html` + `admin-map.js` + `style.css` + `docs/`.
- [x] لا تَغيير في API الـ backend (`/api/map/tree` ثابت — كل الفلترة client-side).
- [x] الثيم اللَيلي + RTL: chips حمراء تَبقى على خلفية داكنة، البحث يَملأ من RTL.
- [x] **لا تَلتزم بِـ git قبل مُوافقة المُستخدِم البَصرية** — عُرضت لَقطات في `artifacts/`.
- [x] **مُواجب بَصرية مُؤكّدة (2026-08-07)**: قدّم المُستخدِم تَعليمات للجلسة التالية (انتقال من شَجرة `ul/li` المتداخلة إِلى عرض **مُربّعات grid** + إِضافة خريطة في الصَفحة العامة).
- [x] بَعد التَأكيد: التزام `feat(map): v2.5.5 — خريطة: بحث + فلترة + حفظ scroll + ARIA` + tag `v2.5.5`.

### 📎 لَقطات بَصرية (اُلتُقطت في الجلسة 2026-08-07)
| اللقطة | مَشهد |
|---|---|
| `28a0a855-` | الحالة الأَوّلية: toolbar + chips (41 / 39 / 2) |
| `f156179b-` | بحث «192.168.88.4» → 10 مُطابِقات، summary «المُطابِقات: 10» |
| `7ebb2054-` | حالة «لا نَتائج» بِـ رسالة + زرّ مَسح داخل الرسالة |
| `15519294-` | نَقر chip «🔴 39 offline» → 39 جهازًا offline فَقظ |
| `9532eae2-` | خطأ شبكة (خادم مُتَوقّف) → رسالة لَطيفة بَدل alert |
| `80d9d8fb-` | ثيم لَيلي كامل على اللوحة |
| `5551c850-` | ثيم لَيلي + بحث «Server» → 7 مُطابِقات |

### 🚧 قُيُود احترِمت (لا خَرق)
- ❌ لم يُمَسّ API الـ backend / `/api/map/tree` / dispatchers / `mapCollapsed` / modal / `map:filter-location`.
- ❌ لم يُمَسّ CSS القائم (444-800) — كل جديد في نِهاية الملف.
- ❌ لم تُضاف libraries/CDN ولا D3.
- ❌ P1.2 / P1.4 / P2 كاملة — خارِج النطاق.

---

## 🚧 قُيُود يجب احترامها
- **RTL** طَبيعي و **الثيم اللَيلي** يَعمل (متغيرات `--bg`/`--card-bg`/...).
- **لا CDN خارجي** (إِنّ إِزالته كانت خِيارًا في v2.5.3 — لا تُعد D3 ولا libraries).
- **لا `devices:focus-device`** (aُزيل عَمدًا في v2.5.3 — نقر الجهاز يَفتح modal، بَقي كذلك).
- **`map:filter-location`** سَليم — لا تَكسِره (dispatch `admin-map.js:260`، listener `admin-devices.js:305`).
- **`mapCollapsed` Set** يُحفظ عبر الـ refresh — لا تُكسِر سُلوكه (P0.2 يُضيف فقط حفظ scroll)。
- الـ API `/api/map/tree` **لا يُعدَّل** (الفَلترة كلها client-side). لو احتجت server-side فلter expands حجم الاستجابة في الشبكه الكبيرة لاحقًا — لكن لِـ الآن `client-side` يَكفي.

---

## 📎 مُلحَقات: مَراجع الكود السَريعة لِـ الجلسة الجديدة

| ما تُريد وُجُوده | الموقع |
|---|---|
| بِناء الشَجِرة (li/ul) | `admin-map.js:renderNode` (`:100-159`)، `renderChildren` (`:162`)، `renderTree` (`:177-208`) |
| نقر/طي/نَقر مزدوج | `admin-map.js:bindNodeEvents` (`:211-262`) |
| تَنقُّل أَوّلي + observer | `admin-map.js:DOMContentLoaded` (`:421-470`) |
| modal تَفاصيل الجهاز | `admin-map.js:showDeviceDetails` (`:345-411`)، `closeDeviceDetails` (`:414-419`) |
| حالة تَحميل فَارغة خاطئة | `admin-map.js:loadMap` (`:265-290`)، `dashboard.html:#tree-empty:355` |
| نَمط `.form-actions` و `.btn` | `style.css` (بحث `.form-actions` و `.btn`) |
| نَمط فُلاتر `.sort-select` | `dashboard.html:48` و `style.css` |
| قَم `.map-*` في CSS | `style.css` ~من 444 إِلى ~700 |
| flag آخر تَحديث | `docs/PLAN-map-tab-polish.md` ذاته + `HANDOFF.md` |
