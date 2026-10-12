# خطة: السحب والإفلات لإعادة ترتيب بطاقات المواقع في خريطة المواقع

## الهدف

إضافة إمكانية **السحب والإفلات (drag-and-drop)** لإعادة ترتيب بطاقات المناطق في خريطة المواقع، بحيث ينعكس الترتيب بصرياً (الترقيم `01/02…` + السهم `↣` يتحدث آلياً)، ويُحفظ في قاعدة البيانات عبر `sort_order`. يُطبق في **لوحة التحكم (admin-map.js)** و**الصفحة العامة (public-map.js)** معاً.

البنية التحتية موجودة مسبقاً:
- `POST /api/locations/reorder` (v2.7.3) يحدث `sort_order` في معاملة واحدة (transaction).
- `GET /api/map/tree` و`GET /api/map/public/tree` يرتبان بـ `ORDER BY sort_order ASC, id ASC`.
- CSS: `counter-reset: zone-sequence` على `.map-grid` + `counter-increment` على `.map-zone-header::before` = ترقيم `01/02…` آلي. سهم `↣` بين البطاقات المتجاورة.

## الحد (scope)

- السحب يعمل على **البطاقات عالية المستوى فقط** (أبناء الجذر المباشرون: internet/zone/site/building… — تلك التي تُولد لها `renderZonesGrid` بطاقة `.map-zone-card`). الترتيب بينها محكوم بـ `sort_order` وينعكس فوراً على الشبكة.
- البطاقات الصناعية (`kind-unassigned`, `orphan-internet-devices`) **غير قابلة للسحب** (لا يوجد لها `id` رقمي في DB ولا row تحدثه).
- السحب **يتعطل آلياً** عند وجود فلتر بحث/حالة فعال (لإبقاء DOM متسقاً مع `nodeKeptByFilters`).
- auto-refresh (30s) **يتوقف مؤقتاً** أثناء السحب ويعود بعده.

---

## المرحلة 1 — admin-map.js (drag-and-drop كامل)

في `bindNodeEvents(container)` (الذي يُربط مرة واحدة عبر delegation على `#map-grid`):

### 1. جعل البطاقات قابلة للسحب
في `renderZoneCard` أضف `draggable="true"` على `<article>` — إلا للبطاقات الصناعية (`kind === 'unassigned'` أو `id === 'orphan-internet-devices'`) فتبقى `draggable="false"`.

### 2. متغيرات حالة جديدة (module-level)
```js
let mapDragging = false;      // يتعطل auto-refresh أثناءها
let mapDraggedId = null;      // id البطاقة المسحوبة
let mapDragOverId = null;     // id البطاقة المستهدفة (للـ feedback بصري)
```

### 3. معالجات الأحداث (delegation على `#map-grid`)

- **dragstart**:
  - إذا `hasActiveFilters()` → `e.preventDefault()` + toast «امسح الفلترة أولاً لإعادة الترتيب».
  - خلاف ذلك: `mapDragging=true; mapDraggedId=e.target.dataset.id; e.target.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', mapDraggedId);`
  - أوقف auto-refresh (`clearTimeout(mapAutoRefreshHandle)`).

- **dragover**:
  - `e.preventDefault()` (للسماح بالdrop).
  - `closest('.map-zone-card')`; لو `id !== mapDraggedId` وليست صناعية → `classList.add('drag-over')` + `mapDragOverId=that.id`.

- **dragleave**: ارفع `drag-over` من البطاقة.

- **drop**:
  - `e.preventDefault()`.
  - استخرج `dropId` من `e.target.closest('.map-zone-card').dataset.id`.
  - لو `dropId === mapDraggedId` أو صناعي → رجوع.
  - خلاف ذلك: **إعادة ترتيب DOM** (`#map-grid.insertBefore(draggedCard, dropCard)` أو `appendChild` لو هي آخر بطاقة).
  - ثم استخرج الترتيب الجديد + أرسله للـ API (راجع الخطوة 4).

- **dragend**:
  - ارفع `dragging`/`drag-over` من كل البطاقات.
  - `mapDragging=false; mapDraggedId=null; mapDragOverId=null;`.
  - أعد تفعيل auto-refresh (scheduleNext).

### 4. حفظ الترتيب الجديد (دالة جديدة `saveMapReorder()`)

```js
const cards = container.querySelectorAll(
  ':scope > .map-zone-card:not(.kind-unassigned):not([data-id="orphan-internet-devices"])'
);
const updates = [...cards].map((card, i) => ({
  id: Number(card.dataset.id),
  sort_order: i
}));
const r = await api('/api/locations/reorder', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ updates })
});
```

- عند نجاح: أعد جلب الشجرة + إعادة الرسم (`mapRootData = await fetchTree(); renderTree(mapRootData)`). هذا يحدث الترقيم `01/02…` والأسهم `↣` آلياً (لأن sort_order في الخادم تغير، والـAPI يرتب بـ `ORDER BY sort_order`). toast: «✅ تم حفظ الترتيب الجديد».
- عند فشل: toast «❌ فشل حفظ الترتيب» + أعد `renderTree(mapRootData)` لـ rollback الترتيب البصري لما هو مخزون.
- في كلا الحالتين: أعد تفعيل auto-refresh (scheduleNext).

### 5. تعطيل السحب أثناء الفلترة
في `dragstart`, تحقق `hasActiveFilters()` (راجع أعلاه).

---

## المرحلة 2 — public-map.js (السحب للزائر المسجل دخولاً)

- نفس منطق admin-map.js مكيّف لـ `renderZonesGridPublic`/`renderZoneCard` و`#public-map-grid`.
- لكن شرط: في `public-map.js` دالة `api()` غير مساعدة بـ auth (لا ترسل token). لذلك `POST /reorder` سيُرفض بـ401 للزائر العام.
- **نهج بسيط وآمن**:
  - في public-map، اجعل السحب متاحاً شكلياً.
  - عند drop لو فشل الـAPI بـ401/403 → toast «⚠ الترتيب يتطلب صلاحية المشرف — يُحفظ مؤقتاً فقط» + اترك DOM بالترتيب الجديد (ترتيب بصري لهذه الجلسة فقط، يُلغى عند auto-refresh).
  - لو نجح (زائر مسجل دخول) → احفظه server-side كما في admin.
- الفرق الوحيد: admin يفترض النجاح دائماً؛ public يتكيف حسب الـresponse.

---

## المرحلة 3 — style.css (feedback بصري أثناء السحب)

أضف (في قسم v2.6.0 Zones-Grid، بعد بلوك `.map-grid`):

```css
.map-zone-card[draggable="true"] { cursor: grab; }
.map-zone-card.dragging { opacity: 0.4; cursor: grabbing; }
.map-zone-card.drag-over { outline: 2px dashed var(--accent, #2563eb); outline-offset: 2px; }
.map-grid.reordering > .map-zone-card { transition: transform 0.15s ease; }
@media (prefers-reduced-motion: reduce) {
  .map-grid.reordering > .map-zone-card { transition: none; }
}
```

---

## المرحلة 4 — التحقق

بعد التطبيق، افتح dashboard خريطة المواقع. اسحب بطاقة على أخرى، تأكد:
1. البطاقات تتبدل في DOM بصرياً.
2. طلب `POST /api/locations/reorder` يظهر عبر DevTools network.
3. الترقيم `01/02…` والسهم `↣` يتحدثان.
4. فتح public-map وإعادة التحميل → يظهر نفس الترتيب الجديد (إثبات الحفظ server-side).
5. تجربة فلتر بحث، محاولة السحب → يُرفض + toast.
6. تجربة auto-refresh أثناء السحب → يتوقف.

---

## الملفات المتأثرة

| الملف | التغييرات |
|------|-----------|
| `frontend/public/js/admin-map.js` | منطق السحب + `saveMapReorder` + `draggable` في `renderZoneCard` + تعديل auto-refresh |
| `frontend/public/js/public-map.js` | نفس المنطق مكيّف + معالجة 401 |
| `frontend/public/css/style.css` | أنماط `dragging`/`drag-over`/`draggable` |
| (الـ Backend) | **لا تعديلات** — الـ API جاهز |

---

## مراجع الكود الحالي (للاطلاع في الجلسة الجديدة)

- `frontend/public/css/style.css:979-1028` — `.map-grid`, `counter-reset`, سهم `↣`, الترقيم `01/02…`.
- `frontend/public/js/admin-map.js:188-234` — `renderZonesGrid` (أبناء الجذر = البطاقات).
- `frontend/public/js/admin-map.js:239-286` — `renderZoneCard` (هنا يُضاف `draggable`).
- `frontend/public/js/admin-map.js:364-429` — `renderTree` (إعادة الرسم بعد الحفظ).
- `backend/src/routes/locations.routes.js:61-93` — `POST /api/locations/reorder` (جاهز).
- `backend/src/routes/map.routes.js:37-39` — `ORDER BY sort_order ASC, id ASC` (جاهز).
- `frontend/public/js/admin-locations-types.js:123-128` — ترتيب client-side بـ `sort_order` (للجدول، غير مطلوب تعديله).

---

## كيف تبدأ جلسة جديدة لتنفيذ هذه الخطة

انسخ هذا الأمر وأعطه للذكاء الاصطناعي في جلسة جديدة (في نفس مجلد المشروع `E:\New claude\network-monitor-v2.5.0-dev`):

```
اقرأ ملف PLAN-drag-drop-zone-reorder.md في جذر المشروع ونفذ خطة السحب والإفلات لإعادة ترتيب بطاقات المواقع في خريطة المواقع (admin-map.js و public-map.js + style.css). الـ API جاهز (POST /api/locations/reorder). ابدأ التنفيذ مباشرة.
```

أو، لو لم يُحفظ الملف لأي سبب، استخدم الأمر الكامل البديل:

```
نفذ خطة السحب والإفلات (drag-and-drop) لإعادة ترتيب بطاقات المواقع في خريطة المواقع.

التفاصيل:
- أضف draggable="true" على .map-zone-card في renderZoneCard (admin-map.js و public-map.js)، ما عدا البطاقات الصناعية (kind-unassigned و orphan-internet-devices).
- عالج dragstart/dragover/dragleave/drop/dragend عبر delegation على #map-grid (admin) و #public-map-grid (public).
- عند drop: أعد ترتيب DOM، استخرج الترتيب الجديد (cards.map: id + sort_order=i)، أرسل POST /api/locations/reorder، ثم أعد fetchTree + renderTree.
- عطل السحب عند hasActiveFilters() + toast.
- أوقف auto-refresh أثناء السحب.
- في public-map: لو فشل الـ API بـ401/403 → toast "الترتيب يتطلب صلاحية المشرف" + اترك DOM بالترتيب الجديد مؤقتاً.
- CSS: .dragging {opacity:.4; cursor:grabbing} و .drag-over {outline:2px dashed var(--accent)} و [draggable="true"] {cursor:grab}.

البنية التحتية جاهزة: POST /api/locations/reorder (v2.7.3) + ORDER BY sort_order ASC في map.routes.js. راجع style.css:979-1028 و admin-map.js:188-286 و 364-429.
```
