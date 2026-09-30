// admin-map.js (v2.6.0 — عرض «بطاقات المُربّعات Zones-Grid»: مُسطّح بَسيط)
// ─────────────────────────────────────────────────────────────
// تَبويب «🗺️ خريطة المواقع»: zones كبطاقات مُرتّبة في شَبكة grid (auto-fill 280px).
//   - جَلب الشجرة من GET /api/map/tree (JSON مُتداخل؛ الجذر = internet لو وُجد واحد،
//     وإلا «كل المواقع»).
//   - v2.6.0: اِستبدال الشَجِرة المُتداخِلة (ul/li)بِـ «بطاقات مُربّعة» لِـ zones
//     الرئيسية (internet/zone/unassigned/…). كُلّ بطاقة <article class="map-zone-card">
//     تَعرض تَرويسة (أَيَقونة + اسم + إِحصائيات 🟢N·🔴N·⚪N (total) + سَهم ▼) و جِسمًا
//     يَحوي الأَجهزة + sub-zones (building/floor/room/rack) كـ sub-headers صَغيرة.
//   - طي/تَوسيع: نَقر التَرويسة يُبَدّل class `collapsed` على <article> (transition
//     max-height على .map-zone-body بِـ CSS). لا إِعادة بناء innerHTML (delegation ثابت).
//   - إِطار البطاقة = تَلخيص أَجهزتها (أَحمر لو وُجد offline، أَخضر لو كلها online)
//     عبر متغيّرات inline `--node-bg/--node-border/--node-border-w` (نَفس مَيكانيكية
//     v2.5.5). الأَجهزة chips مُلوّنة بِنُقطة الحالة (online/offline/unknown).
//   - تَفاعل: نقر تَرويسة بطاقة ↔ طي/تَوسيع (toggle class)؛ نَقر مزدوج على تَرويسة
//     موقع ↔ اِنتقال لِـ تَبويب «الأَجهزة» مُصفّى بِـ location_id (حدث map:filter-location)؛
//     نقر device chip ↔ فتح modal تَفاصيل عائم (showDeviceDetails ← GET /api/devices/:id).
//   - v2.5.5 المُحافَظ عليها في v2.6.0: بحث فوري + فلتر الحالة + chips تفاعلية في
//     #map-summary + حفظ scroll عبر إِعادة الرَسم + حالات (لا بيانات/خطأ شبكة/لا
//     مُطابِقات) — كُلّها عَبر نفس ميكانيكية client-side filtering المَوجُودة.
//   - auto-refresh كل 30 ثانية عندما التبويب ظاهر.
//   - modal: زِر × + مفتاح ESC + نقر على الخلفية يُغلقونه.
// ─────────────────────────────────────────────────────────────

let mapAutoRefreshHandle = null;
let mapRootData = null;
const mapCollapsed = new Set();
let mapHasInitialized = false;
let mapNodeEventsBound = false;   // وِقاية تَسرّيب listeners في bindNodeEvents (يُربط مَرّة واحدة)
// v2.5.5 — حالة البحث + فلتر الحالة (client-side، لا تَغيير على API).
let mapSearchQuery = '';
let mapStatusFilter = '';
// مُؤقّتات debounce: search + toast.
let mapSearchHandle = null;
let mapToastHandle = null;
// v2.7.4 — حالة السَحب والإِفلات لإعادة تَرتيب بطاقات zones.
// mapDragging: true أَثناء جلسة سَحب جارية (يَتعطّل auto-refresh فيها).
// mapDraggedId: id البطاقة المَسحُوبة. mapDragOverId: id البطاقة المستهدفة (لِـ feedback).
let mapDragging = false;
let mapDraggedId = null;
let mapDragOverId = null;

// أيقونات أنواع المواقع (هرم الشبكة المُدمَج).
const KIND_ICON = {
  root: '🌐', internet: '🌐', zone: '📍', site: '🏛️', building: '🏢',
  floor: '📐', room: '🚪', rack: '🗄️', unassigned: '📦', device: '🖥️',
};

// أَلوان عُقد الجهاز من متغيرات CSS (تَتلاءم مع الثيم الليلي) مع fallback.
// ملاحظة: cssVar() تُرجِع القيمة المَحلولة لحظياً (مَلائمة لِـ canvas/svg أَو قِراءة
// عابرة)، لكن لا تَصلح لِـ تَخزينها inline على عُقدة ما زالت في الـ DOM — لو تَغيّر
// الثيم لاحقاً تَبقى القيمة القديمة. لِذلك تَستعمل renderZoneCard() مراجع var()
// الثابتة من kindColorRef()/locationBorderColorRef() بالأسفل لِـ inline styles.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function deviceColor(status) {
  if (status === 'online') return cssVar('--online', '#22c55e');
  if (status === 'offline') return cssVar('--offline', '#ef4444');
  return cssVar('--unknown', '#9ca3af');
}

// لون خلفية عُقدة موقع بحسب kind.
// v2.7.3: تُعيد مَرجع var() النصّي (لا القيمة المَحلولة) حتى لو تَغيّر الثيم
// لاحقاً (نهاري↔ليلي) تَتَكيّف البطاقة آلياً. fallback يُمرَّر داخل var() لِـ ثيم بلا
// المتغيّر. (سابقاً cssVar() كان يَحل القيمة عند الرَسم فتَثبت خلفية #ffffff على
// بطاقات site/building حتى في الوَضع الليلي — كان سَبب تَناقُق الأَلوان في الـ grid.)
function kindColor(kind) {
  switch (kind) {
    case 'internet':   return 'var(--zone-internet-bg, rgba(37, 99, 235, 0.18))';
    case 'zone':       return 'var(--zone-bg, rgba(234, 179, 8, 0.18))';
    case 'unassigned': return 'var(--zone-unassigned-bg, rgba(156, 163, 175, 0.18))';
    default:           return 'var(--card-bg, #ffffff)';   // site/building/floor/room/rack
  }
}

// لون إطار عُقدة موقع بحسب تَلخيص أَجهزته (مَرجع var() لِـ تَكيّف الثيم).
function locationBorderColor(node) {
  if (!node) return 'var(--border, #ccc)';
  if (node.offline > 0) return 'var(--offline, #ef4444)';
  if (node.device_count > 0 && node.online === node.device_count) return 'var(--online, #22c55e)';
  return 'var(--border, #9e9e9e)';
}

// جَلب الشجرة من الـ API.
async function fetchTree() {
  const r = await api('/api/map/tree');
  if (!r || !r.success) {
    console.warn('[MAP] fetchTree failed:', r?.error);
    return null;
  }
  return r.data;
}

// هل العُقدة مطوية حاليًّا؟
function isCollapsed(node) {
  return mapCollapsed.has(node.id);
}

// هل لِـ العُقدة أَبناء (شاملة المطوية)؟
function hasChildren(node) {
  return Array.isArray(node.children) && node.children.length > 0;
}

// ═══ v2.5.5: فِلترة client-side للشَجرة (بحث + فلتر الحالة) ═══

// هل تُطابِق العُقدة الـ query (اسم موقع/اسم جهاز/IP)؟ case-insensitive، substring.
function nodeMatchesQuery(node, q) {
  if (!q) return true;
  const hay = [node.name, node.ip, node.device_type].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

// هل أَيّ سُلالة (device أَو location) تُطابِق الـ query؟ (اجتياز عُمق-أَوّلًا wide)
function hasMatchInSubtree(node, q) {
  if (!q) return true;
  if (nodeMatchesQuery(node, q)) return true;
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      if (hasMatchInSubtree(c, q)) return true;
    }
  }
  return false;
}

// هل تُطابِق العُقدة فلتر الحالة؟ device → نَطابِق status مباشرة؛ الموقع يَمُرّ دائمًا
// (الأَب يُحفظ لو لَديه جهاز بِـ الحالة المطلوبة — تَتحقّق hasDeviceInSubtree).
function nodePassesStatusFilter(node) {
  if (!mapStatusFilter) return true;
  if (node.kind === 'device') return node.status === mapStatusFilter;
  return true; // المواقع تُحفظ بِـ hasDeviceInSubtree
}

// أ‌ي‌ contiene عُقدة موقع جهازًا بِـ الحالة المطلوبة في سُلالتها؟
function hasDeviceInSubtree(node, status) {
  if (!status) return true;
  if (node.kind === 'device') return node.status === status;
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      if (hasDeviceInSubtree(c, status)) return true;
    }
  }
  return false;
}

// هل تُمرّ العُقدة الكاملة (search + status filter)؟
// للأَجهزة: كِلا الفِلترين مُعتمدان على العُقدة نفسها.
// للمواقع: تُحفظ لو لَديها سُلالة تُطابِق الـ query و (لو statusFilter مُفعّل) سُلالة device
// بالحالة المطلوبة. هذا يَحفظ سَلسلة الأَجداد المُؤدّية لِـ المُطابِقات.
function nodeKeptByFilters(node) {
  const passesStatus = !mapStatusFilter
    || (node.kind === 'device' ? node.status === mapStatusFilter : hasDeviceInSubtree(node, mapStatusFilter));
  if (!mapSearchQuery) return passesStatus;
  // query فعّال: العُقدة نفسها أَو سُلالتها تُطابِق.
  if (!hasMatchInSubtree(node, mapSearchQuery)) return false;
  return passesStatus;
}

// عَدّ الأ‌جهزة الباقية بعد الفلترة (لِـ summary في وضع البحث/الفِلتر).
function countVisibleDevices(node) {
  if (!node) return 0;
  if (node.kind === 'device') return nodeKeptByFilters(node) ? 1 : 0;
  if (Array.isArray(node.children)) {
    return node.children.reduce((sum, c) => sum + countVisibleDevices(c), 0);
  }
  return 0;
}

// هل الفِلترة فعّالة حاليًّا؟ (search أَو status)
function hasActiveFilters() {
  return !!(mapSearchQuery || mapStatusFilter);
}

// إِيجاد عقدة جهاز بِـ id داخل الشجرة (اجتياز عمق-أَولاً). يُستعمل عند نقر جهاز
// لِـ جلب ip/name/status التي كانت على العقدة الأَصلية (ليست دومًا في data-id).
function findDeviceNode(node, id) {
  if (!node) return null;
  if (node.kind === 'device' && String(node.id) === String(id)) return node;
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      const found = findDeviceNode(c, id);
      if (found) return found;
    }
  }
  return null;
}

// ═══ v2.6.0 — Zones-Grid renderer (خِيار A مُسطّح) ═══
// بناء HTML لِـ شَبكة البطاقات من جذر الشَجِرة (rootData). يَمشي عَلى أَبناء الجذر
// المُباشِرين (zones/internet/unassigned) — الجذر نفسه (root/internet المُصطَنَع which
// يَتَراص أَبناؤه) لا نُولّد له بطاقة مستَقِلّة، إِنّما نَكشِف أَبناءه. هذا ما يُحوّل
// الشَجِرة المُتداخِلة (ul/li) إِلى grid مُسطّح لِـ zones الرئيسية.
function renderZonesGrid(rootData) {
  if (!rootData) return '';
  // الجذر يَحوي أَبناءً (zones/internet/unassigned) — نُولّد بطاقة لِـ كُلّ وَاحد.
  const kids = Array.isArray(rootData.children) ? rootData.children : [];
  // v2.6.0 — فصل الأَجهزة المُباشِرة في الجذر (kind=device) عَن zones الحَقيقية:
  // router/sophos/DNS في جذر internet تَظهَر في JSON كـ children مُباشِرة للجذر،
  // نُجمِعها في بطاقة وَاحِدة مَخصَّصة «أَجهزة مَدخل الإنترنت» لِـ تَجنّب بَطاقات فَارِغة.
  const zoneKids = [];
  const orphanDevices = [];
  for (const c of kids) {
    if (c.kind === 'device') orphanDevices.push(c);
    else zoneKids.push(c);
  }
  // v2.5.5 — فلترة client-side على zoneKids: اِسكِت الـ ones بِلا مُطابِقات في سُلالتها.
  // للأَجهزة المُيَتِّمَة نُطبِّق nodeKeptByFilters مُباشِرة (filters device-level).
  // v2.7.0 — تَمرير aria-posinset/aria-setsize للـ a11y (P)D.
  const keptZoneKids = zoneKids.filter((c) => !hasActiveFilters() || nodeKeptByFilters(c));
  let orphanCardCount = 0;
  if (orphanDevices.length > 0) {
    const kept = orphanDevices.filter((d) => !hasActiveFilters() || nodeKeptByFilters(d));
    if (kept.length > 0) orphanCardCount = 1;
  }
  const setSize = keptZoneKids.length + orphanCardCount;
  // v2.7.5 — بطاقة «أَجهزة مَدخل الإنترنت» ثابتة في الأَول دائماً (لا تُحرَّك).
  // نَبنيها قَبل zones لِـ تُدرَج في أَول cards، ونُحدّث posinset للـ zones لِـ تَبقى
  // مُتسلسلة بَعدَها (start=2) أَمام a11y.
  let orphanHtml = '';
  let orphanCount = 0;
  if (orphanDevices.length > 0) {
    const kept = orphanDevices.filter((d) => !hasActiveFilters() || nodeKeptByFilters(d));
    if (kept.length > 0) {
      const orphanNode = {
        id: 'orphan-internet-devices',
        name: 'أَجهزة مَدخل الإنترنت',
        kind: 'unassigned',
        device_count: kept.length,
        online: kept.filter((d) => d.status === 'online').length,
        offline: kept.filter((d) => d.status === 'offline').length,
        unknown: kept.filter((d) => d.status === 'unknown').length,
        children: kept,
        _orphan: true,
      };
      orphanHtml = renderZoneCard(orphanNode, { posinset: 1, setsize: setSize });
      orphanCount = 1;
    }
  }
  // zones تُعرَض بَعْد البطاقة الصِناعيّة (posinset يَبدأ من 2 لو وُجدت).
  const start = orphanCount > 0 ? 2 : 1;
  let cards = keptZoneKids
    .map((c, i) => renderZoneCard(c, { posinset: start + i, setsize: setSize }))
    .join('');
  // نُدرِج البطاقة الصِناعيّة في الأَول (قَبل zones).
  cards = orphanHtml + cards;
  return cards;
}

// بطاقة zone واحدة: <article class="map-zone-card kind-X"> مع تَرويسة + جِسم.
// isCollapsed: عند وجود فِلتر فعّال نَوسّع آليًّا (collapsed=false) لِـ تَظهر المُطابِقات.
// v2.7.0 — opts.posinset/opts.setsize تُضاف كـ aria-posinset/aria-setsize للـ a11y.
function renderZoneCard(node, opts) {
  opts = opts || {};
  const kind = node.kind || 'zone';
  const icon = KIND_ICON[kind] || '📍';
  const isUnassigned = kind === 'unassigned';
  const collapsedNow = !hasActiveFilters() && isCollapsed(node);

  // لون الخلفية/الإِطار (نَفس منطق v2.5.5 عَلى عُقد الشَجِرة).
  // v2.7.3: تُعَيد now مراجع var() تَتَكيّف عِند تَبديل الثيم (نهاري/ليلي) دون
  // إِعادة رَسم — كان السَبب الجذري لتَناقُق خلفية #ffffff الثابتة في الوَضع الليلي.
  const bg = kindColor(kind);
  let border = locationBorderColor(node);
  let borderW = (node.offline > 0) ? '2px' : '1px';
  // الأَنواع ذات الإِطار المُميَّز: نَستَعمل مراجع var() على الأَلوان الثيم (تَتَكيّف
  // مع نهاري/ليلي) بدَل أَلوان ثابتة #2563eb/#eab308 التي لا تُقِلّ في الوَضع الليلي.
  if (kind === 'internet') border = 'var(--accent, #2563eb)';
  if (kind === 'zone')     border = 'var(--warning, #eab308)';

  // الإِحصائيات في التَرويسة.
  const dc = node.device_count || 0;
  const on = node.online || 0;
  const off = node.offline || 0;
  const unk = node.unknown || 0;
  const stats = dc > 0
    ? `🟢 ${on} · 🔴 ${off} · ⚪ ${unk} <span class="map-count">(${dc})</span>`
    : '—';

  // v2.7.0 — has-online: zone بأَجهزة كلها online (offline=0, online>0) → إِطار أَخضر مُميَّز.
  const cls = `map-zone-card kind-${kind}${off > 0 ? ' has-offline' : ''}${(on > 0 && off === 0) ? ' has-online' : ''}${collapsedNow ? ' collapsed' : ''}${isUnassigned ? ' kind-unassigned' : ''}`;
  const body = renderZoneBody(node);

  // v2.7.0 (PD) — aria-posinset/aria-setsize من opts للـ a11y (اِختياري).
  const ariaSet = opts.posinset != null && opts.setsize != null
    ? ` aria-posinset="${opts.posinset}" aria-setsize="${opts.setsize}"`
    : '';

  // v2.7.4 — السَحب والإِفلات: البطاقات الحقيقية قابِلة للسَحب (draggable="true")؛
  // البطاقات الصِناعيّة (kind-unassigned مثل «أَجهزة مَدخل الإنترنت» أَو id رقمي مَفقود)
  // لا تُسحَب — لا row تَحدّثه في DB (لا id رقمي). draggable="false" يَمنع الـ DnD.
  const draggable = !isUnassigned && node.id != null && typeof node.id === 'number' ? 'true' : 'false';

  return `
    <article class="${cls}" data-id="${esc(String(node.id))}" data-kind="${esc(kind)}" role="listitem"${ariaSet} draggable="${draggable}"
             style="--node-bg:${bg}; --node-border:${border}; --node-border-w:${borderW};">
      <div class="map-zone-header" title="${esc(nodeTooltip(node))}">
        <span class="map-zone-icon">${icon}</span>
        <span class="map-zone-name">${esc(node.name || '')}</span>
        <span class="map-zone-stats">${stats}</span>
        <button type="button" class="map-zone-toggle" aria-label="تَوسيع/طي" aria-expanded="${!collapsedNow}">▼</button>
      </div>
      <div class="map-zone-body">${body}</div>
    </article>`;
}

// جِسم البطاقة: قَائمِة أَجهزة الموقع + sub-zones (building/floor/room/rack) كـ sub-headers.
// مُتكرّرة: لو child هو location آخَر (/site/building/…) نَعرض sub-zone داخل نَفس البطاقة
// (إِدخال عميق كـ sub-headers قَابلة للطي بالـ toggle الرئيسي). لو child جهاز → device chip.
function renderZoneBody(node) {
  const kids = Array.isArray(node.children) ? node.children : [];
  if (kids.length === 0) {
    // لا أَبناء — إِما فارِغة أو عقدة leaf; رِسالة hint قَد لا تَلزم لأَنّ reveal عبر
    // has-offline / stats يُكفي. نُعيد سَلسلة فَارِغة فقط.
    const dc = node.device_count || 0;
    if (dc === 0) return '<p class="map-zone-empty">لا أَجهزة في هذه الموقع.</p>';
    return '';
  }
  // نَفصل الأَبناء location عَن device.
  const devices = [];
  const subzones = [];
  for (const c of kids) {
    if (c.kind === 'device') devices.push(c);
    else subzones.push(c);
  }
  let html = '';

  // الأَجهزة المُباشِرة لهذه العُقدة (لو وُجدت).
  if (devices.length > 0) {
    html += devices
      .filter((d) => !hasActiveFilters() || nodeKeptByFilters(d))
      .map((d) => renderZoneDevice(d))
      .join('');
  }

  // sub-zones داخل نَفس البطاقة (تَسلسل عميق بِلا grid مُنفَصِل — خِيار A مُسطّح).
  for (const sz of subzones) {
    // v2.5.5 فلترة: اِسكِت sub-zone التي لا تَملِك مُطابِقات في سُلالتها.
    if (hasActiveFilters() && !nodeKeptByFilters(sz)) continue;
    const szIcon = KIND_ICON[sz.kind] || '📍';
    const szDc = sz.device_count || 0;
    const szOn = sz.online || 0;
    const szOff = sz.offline || 0;
    const szUnk = sz.unknown || 0;
    html += `
      <div class="map-subzone" data-id="${esc(String(sz.id))}" data-kind="${esc(sz.kind)}">
        <div class="map-subzone-title">
          <span>${szIcon}</span>
          <span class="map-subzone-name">${esc(sz.name || '')}</span>
          <span class="map-subzone-stats">🟢${szOn} · 🔴${szOff} · ⚪${szUnk} (${szDc})</span>
        </div>
        ${renderZoneBody(sz)}
      </div>`;
  }
  return html || '<p class="map-zone-empty">لا مُطابِقات.</p>';
}

// device chip داخل بطاقة zone/sub-zone.
// data-id بِـ صيغة "dev-X" (نَفس تَوقّع v2.5.5 في bindNodeEvents لِـ استِخراج id الرقمي).
function renderZoneDevice(node) {
  const status = node.status || 'unknown';
  const icon = deviceIcon(node.device_type) || DEVICE_TYPE_ICONS_FALLBACK;
  const name = esc(node.name || '');
  const meta = esc(`${node.device_type || 'جهاز'}`);
  return `
    <button type="button" class="map-zone-device" data-id="${esc(String(node.id))}" data-kind="device" data-status="${esc(status)}" title="${esc(nodeTooltip(node))}">
      <span class="map-device-dot" aria-hidden="true"></span>
      <span class="map-device-ic">${icon}</span>
      <span class="map-device-name">${name}</span>
      <span class="map-device-meta">${meta}</span>
    </button>`;
}

// tooltip النصّي.
function nodeTooltip(node) {
  if (node.kind === 'device') {
    return `${node.name}\nIP: ${node.ip}\nالنوع: ${node.device_type || '—'}\nالحالة: ${node.status}`;
  }
  return `${node.name}\nأَجهزة: ${node.device_count} (🟢${node.online} 🔴${node.offline} ⚪${node.unknown})`;
}

// رَسم الشَبكة كاملة في container (#map-grid — v2.6.0).
function renderTree(rootData) {
  const container = document.getElementById('map-grid');
  const emptyEl = document.getElementById('tree-empty');
  const loadingEl = document.getElementById('tree-loading');
  const summaryEl = document.getElementById('map-summary');
  if (!container) return;

  // P0.2 — حفظ موضع scroll عبر إِعادة الرَسم (auto-refresh / بحث / resize).
  const savedScrollTop = container.scrollTop;
  const savedScrollLeft = container.scrollLeft;

  // حالة فَراغ: لا بيانات أَصلًا.
  const hasAny =
    rootData &&
    (rootData.device_count > 0 ||
      (Array.isArray(rootData.children) && rootData.children.length > 0));
  if (!hasAny) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (loadingEl) loadingEl.hidden = true;
    if (summaryEl) summaryEl.innerHTML = '';
    // نَزيل أَيّ بطاقات zone سابِقة دون مَسّ #tree-empty/#tree-loading.
    container.querySelectorAll(':scope > .map-zone-card').forEach((c) => c.remove());
    restoreScroll(container, savedScrollTop, savedScrollLeft);
    return;
  }

  // P1.3 — عدّ الأَجهزة الباقية بعد الفِلترة (0 لو فلتر لا يَملِك مُطابِقات).
  const visibleCount = hasActiveFilters() ? countVisibleDevices(rootData) : rootData.device_count;

  if (loadingEl) loadingEl.hidden = true;

  if (hasActiveFilters() && visibleCount === 0) {
    // لا مُطابِقات للفِلتر الحالي.
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.classList.add('map-empty-error');
      const qPart = mapSearchQuery ? ` لِـ «<b>${esc(mapSearchQuery)}</b>»` : '';
      const sPart = mapStatusFilter ? (mapSearchQuery ? ' و' : ' لِـ') + ` فلتر «${esc(mapStatusFilter)}»` : '';
      emptyEl.innerHTML = `⚠️ لا توجد نَتائج${qPart}${sPart}.<br><button type="button" class="btn map-clear-btn" id="map-empty-clear" style="margin-top:0.6rem;">✖ مَسح الفِلترة</button>`;
    }
    if (summaryEl) summaryEl.innerHTML = `<span class="map-summary-count">لا مُطابِقات</span>`;
    container.querySelectorAll(':scope > .map-zone-card').forEach((c) => c.remove());
    bindNodeEvents(container);   // لِـ ربط زر #map-empty-clear عبر delegation على summary/container
    restoreScroll(container, savedScrollTop, savedScrollLeft);
    return;
  }

  // تَفعيل عادي: أَخفِ empty، أَزِل class error، اِعرض الـ summary (chips لو لا فلتر).
  if (emptyEl) {
    emptyEl.style.display = 'none';
    emptyEl.classList.remove('map-empty-error');
    emptyEl.textContent = 'لا توجد بيانات. أَضف مواقع وأَجهزة أَوّلًا.';
  }

  // P1.3 — ملخص تفاعلي: chips (offline/online/unknown) عند عدم وجود فلتر، أَو عدّ المُطابِقات عند الفِلتر.
  renderMapSummary(summaryEl, rootData, visibleCount);

  // v2.6.0 — بناء HTML بطاقات zones (renderZonesGrid) و وَضعها في #map-grid.
  const gridHtml = renderZonesGrid(rootData);
  // نَستبدل البطاقات القَديمة فقط دون مَسّ #tree-loading/#tree-empty (يَحفظهم في DOM).
  container.querySelectorAll(':scope > .map-zone-card').forEach((c) => c.remove());
  // اِستِعمال Range لِـ إِدراج HTML بِـ شَكل آمن بَين loading/empty:
  const tpl = document.createElement('template');
  tpl.innerHTML = gridHtml;
  // نُدرِج البطاقات قَبل #tree-loading (في بِداية container) لِـ نَضَمَن أَن تَظهَر قَبلها أَو بعد حِذف loading.
  container.insertBefore(tpl.content, container.firstChild);

  restoreScroll(container, savedScrollTop, savedScrollLeft);

  // رَبط الأَحداث (delegation) — bindNodeEvents يَتولّى عدم التَكرار.
  bindNodeEvents(container);
}

// إِعادة scroll بعد reflow (rAF يَضمن تَطبيق القيم لبعض المتصفّحات).
function restoreScroll(container, top, left) {
  requestAnimationFrame(() => {
    container.scrollTop = top;
    container.scrollLeft = left;
  });
}

// P1.3 — تَوليد HTML الملخّص (#map-summary).
// لو الفِلترة فعّالة: «المُطابِقات: N جهاز». والا: chips offline/online/unknown.
function renderMapSummary(summaryEl, rootData, visibleCount) {
  if (!summaryEl) return;
  if (hasActiveFilters()) {
    summaryEl.innerHTML = `<span class="map-summary-count">المُطابِقات: ${visibleCount} جهاز</span>`;
    return;
  }
  const chips =
    (rootData.offline > 0 ? `<button type="button" class="map-summary-chip" data-filter-status="offline" aria-label="فلترة أَجهزة offline">🔴 ${rootData.offline} offline</button>` : '') +
    (rootData.online  > 0 ? `<button type="button" class="map-summary-chip" data-filter-status="online"  aria-label="فلترة أَجهزة online">🟢 ${rootData.online} online</button>` : '') +
    (rootData.unknown > 0 ? `<button type="button" class="map-summary-chip" data-filter-status="unknown" aria-label="فلترة أَجهزة unknown">⚪ ${rootData.unknown} unknown</button>` : '');
  summaryEl.innerHTML = `<span class="map-summary-count">الإِجمالي: ${rootData.device_count} جهاز</span>${chips}`;
}

// رَبط نقر/طي على كل العُقد عبر delegation.
// رَبط نقر/طي على كل العُقد عبر delegation.
// v2.5.5 — ربط مَرّة واحدة فقط (علم mapNodeEventsBound) لِـ منع تَسرّيب listeners
// عبر auto-refresh / resize / بحث (renderTree يُستدعى كثيرًا). delegation على container
// الثابت (نفس #map-grid) يَكفي حتى لو اِستُبدل innerHTML.
function bindNodeEvents(container) {
  if (mapNodeEventsBound) return;
  mapNodeEventsBound = true;

  container.addEventListener('click', (event) => {
    // v2.5.5 — زرّ مَسح الفِلترة داخل رسالة «لا نَتائج بحث».
    const clearBtn = event.target.closest('#map-empty-clear');
    if (clearBtn) {
      clearMapFilters();
      return;
    }

    // v2.6.0 — نقر device chip (.map-zone-device) له الأَولوية: اِفتح modal التَفاصيل.
    // (نُعالِجه قَبل lookup البطاقة لِـ أَنّ chip الجهاز داخِل جِسم البطاقة، فلا يُريد toggle.)
    const deviceChip = event.target.closest('.map-zone-device');
    if (deviceChip) {
      const id = deviceChip.dataset.id;
      const m = /^dev-(\d+)$/.exec(String(id));
      showDeviceDetails(m ? m[1] : id);
      return;
    }

    // lookup بطاقة zone. <article data-id data-kind>.
    const card = event.target.closest('.map-zone-card');
    if (!card) return;
    const id = card.dataset.id;
    const kind = card.dataset.kind;

    // النقر على تَرويسة البطاقة (سَهم أَو header) لِـ الـ zones (غير device) → طي/تَوسيع.
    if (kind !== 'device' && kind !== 'root') {
      const toggleClicked = event.target.closest('.map-zone-toggle');
      const headerClicked = event.target.closest('.map-zone-header');
      if (toggleClicked || headerClicked) {
        // toggle class فقط على <article> (لا إِعادة بناء innerHTML) — transition
        // max-height على .map-zone-body بِـ CSS و يَحفظ التَدَفّق و الـ delegation.
        if (mapCollapsed.has(id)) {
          mapCollapsed.delete(id);
          card.classList.remove('collapsed');
        } else {
          mapCollapsed.add(id);
          card.classList.add('collapsed');
        }
        // تَحديث aria-expanded + السّهم (عَبر CSS rotate على .collapsed حاليًّا،
        // لكنّنا نُحدّث aria-expanded لِـ الـ ARIA correctness).
        const toggleEl = card.querySelector(':scope > .map-zone-header > .map-zone-toggle');
        if (toggleEl) toggleEl.setAttribute('aria-expanded', !card.classList.contains('collapsed'));
        return;
      }
    }
  });

  // نقر مزدوج على موقع → اِنتقال لِـ تَبويب «الأَجهزة» مُصفّى بِـ location_id.
  // وِقاية: عقدة «أَجهزة غير مُعَيَّن» (kind='unassigned', id='unassigned') لَيست موقعًا
  // حقيقيًّا — لا يُمكن تَصفية tab الأَجهزة بِـ location_id مَنه. كان قَبل هذا الإِصلاح
  // يُطلِق حدثًا بِـ location_id='unassigned' فيَنتُج Number('unassigned')=NaN في
  // admin-devices.js و يَترك الجدول فَارِغًا بِلا رِسالة. الآن no-op (شبيه بِـ root/device).
  container.addEventListener('dblclick', (event) => {
    const card = event.target.closest('.map-zone-card');
    if (!card) return;
    const kind = card.dataset.kind;
    const id = card.dataset.id;
    if (kind === 'device' || kind === 'root' || kind === 'unassigned') return;
    // نَنقر على زر التَبويب مباشرة (أَكثر متانة من showSection التي قد لا تكون مُعرّفة).
    const tabBtn = document.getElementById('tab-devices');
    if (tabBtn) tabBtn.click();
    window.dispatchEvent(new CustomEvent('map:filter-location', { detail: { location_id: id } }));
  });

  // ═══ v2.7.4 — السَحب والإِفلات لإعادة تَرتيب بطاقات zones ═══
  // تَعطيل السَحب عند وجود فلتر بحث/حالة فعّال (إِبقاء DOM متّسقاً مَع nodeKeptByFilters).
  // البطاقات الصِناعيّة (kind-unassigned / orphan-internet-devices) غير قابِلة للسَحب.
  container.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.map-zone-card');
    if (!card) { event.preventDefault(); return; }
    // فلتر فعّال → لا سَحب (إِبقاء DOM متّسقاً مع الفلترة).
    if (hasActiveFilters()) {
      event.preventDefault();
      showMapToast('⚠️ اِمسح الفلترة أَولاً لإِعادة التَرتيب', 3000);
      return;
    }
    // البطاقات غير القابِلة للسَحب: الصِناعيّة (لا id رقمي).
    const kind = card.dataset.kind;
    const id = String(card.dataset.id);
    if (kind === 'unassigned' || id === 'orphan-internet-devices' || !/^\d+$/.test(id)) {
      event.preventDefault();
      return;
    }
    mapDragging = true;
    mapDraggedId = id;
    card.classList.add('dragging');
    container.classList.add('reordering');
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', id); } catch (_) { /* بعض المتصفّحات لا تَسمَح */ }
    // إِيقاف auto-refresh مؤقّتًا أَثناء السَحب.
    if (mapAutoRefreshHandle) { clearInterval(mapAutoRefreshHandle); mapAutoRefreshHandle = null; }
  });

  container.addEventListener('dragover', (event) => {
    if (!mapDragging) return;
    const card = event.target.closest('.map-zone-card');
    if (!card) return;
    const kind = card.dataset.kind;
    const id = String(card.dataset.id);
    // لا يُسمَح بالإِفلات على البطاقة نفسها أَو الصِناعيّة.
    if (id === mapDraggedId || kind === 'unassigned' || id === 'orphan-internet-devices' || !/^\d+$/.test(id)) return;
    event.preventDefault();   // سَماح بالإِفلات.
    event.dataTransfer.dropEffect = 'move';
    // رَفع drag-over القَديم قبل وَضع الجَديد (بَطاقة وَاحِدة فقط highlight).
    if (mapDragOverId && mapDragOverId !== id) {
      const prev = container.querySelector(`:scope > .map-zone-card[data-id="${mapDragOverId}"]`);
      if (prev) prev.classList.remove('drag-over');
    }
    card.classList.add('drag-over');
    mapDragOverId = id;
  });

  container.addEventListener('dragleave', (event) => {
    const card = event.target.closest('.map-zone-card');
    if (!card) return;
    // نَرفع drag-over فقط لو غادَرنا البطاقة المُسجّلة (تَجنّب الوميض بَين أَبناء البطاقة).
    if (mapDragOverId && card.dataset.id === mapDragOverId && !card.contains(event.relatedTarget)) {
      card.classList.remove('drag-over');
      if (mapDragOverId === card.dataset.id) mapDragOverId = null;
    }
  });

  container.addEventListener('drop', async (event) => {
    if (!mapDragging) return;
    event.preventDefault();
    const dropCard = event.target.closest('.map-zone-card');
    if (!dropCard) return;
    const dropId = String(dropCard.dataset.id);
    if (dropId === mapDraggedId) return;   // لا تَغيير.
    // v2.7.5 — البطاقة الصِناعيّة (أَجهزة مَدخل الإنترنت) ثابتة في الأَول؛ لا إِفلات عَلَيها
    // ولا إِدخال أَمامها (dropCard المرجع = البطاقة الصِناعيّة يَعني إِدراج dragCard قَبلها).
    if (dropId === 'orphan-internet-devices' || !/^\d+$/.test(dropId)) return;
    const dragCard = container.querySelector(`:scope > .map-zone-card[data-id="${mapDraggedId}"]`);
    if (!dragCard) return;
    // إِعادة تَرتيب DOM: إِدراج dragCard قَبل dropCard (أَو appendChild لو هي الأَخيرة
    // إِلّا أَنّ insertBefore(null) يُكافئ appendChild — نُمرِّر dropCard كـ reference).
    container.insertBefore(dragCard, dropCard);
    await saveMapReorder(container);
  });

  container.addEventListener('dragend', () => {
    // تَنظيف بَطاقيّ (dragging/drag-over) من كُلّ البطاقات.
    container.querySelectorAll(':scope > .map-zone-card').forEach((c) => {
      c.classList.remove('dragging');
      c.classList.remove('drag-over');
    });
    container.classList.remove('reordering');
    mapDragging = false;
    mapDraggedId = null;
    mapDragOverId = null;
    // إِعادة تَفعيل auto-refresh (نُعيد جَدوَلته كَما في MutationObserver).
    const section = document.getElementById('section-map');
    if (section && !section.classList.contains('hidden') && !mapAutoRefreshHandle) {
      // loadMap مَرّةً واحدة الآن (لِـ جَلب أَحدث شَجِرة بَعد التَرتيب الجَديد) ثُمّ polling.
      loadMap().catch(() => {});
      mapAutoRefreshHandle = setInterval(() => loadMap().catch(() => {}), 30000);
    }
  });
}

// ═══ v2.7.4 — حفظ التَرتيب الجَديد بَعد السَحب والإِفلات ═══
// يَستَخرج التَرتيب الحالي من DOM (cards عالية المستوى، باستثناء الصِناعيّة)، يُرسله
// إِلى POST /api/locations/reorder، ثُمّ يُعيد جَلب الشَجِرة و رَسمها (لِـ تَحديث التَرقيم
// 01/02… و السَهم ↣ آلياً). عند الفَشل يَعمل rollback بَصري عبر renderTree(mapRootData).
async function saveMapReorder(container) {
  const cards = container.querySelectorAll(
    ':scope > .map-zone-card:not(.kind-unassigned):not([data-id="orphan-internet-devices"])'
  );
  const updates = [...cards]
    .map((card, i) => {
      const id = Number(card.dataset.id);
      if (!Number.isFinite(id)) return null;   // تَخطّي غَير الرقميّة (أَمان).
      return { id, sort_order: i };
    })
    .filter(Boolean);

  if (updates.length === 0) return;   // لا شيء لِـ حفظه.

  showMapToast('⏳ جاري حفظ التَرتيب الجَديد…', 2000);

  let ok = false;
  let errCode = null;
  try {
    const r = await api('/api/locations/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    ok = !!(r && r.success);
    if (!ok) errCode = r && r.code;
  } catch (e) {
    ok = false;
  }

  if (ok) {
    // نجاح: إِعادة جَلب الشَجِرة + رَسم (يُحدِّث التَرقيم و السَهم آلياً).
    const fresh = await fetchTree();
    if (fresh) {
      mapRootData = fresh;
      renderTree(mapRootData);
      showMapToast('✅ تم حفظ التَرتيب الجَديد', 2000);
    } else {
      // جَلب الأَحدث فَشل، لكن الحفظ نجح — نَكتفي بالأَمر الحاليّ.
      showMapToast('✅ تم حفظ التَرتيب', 2000);
    }
  } else {
    // فَشل الحفظ: rollback بَصري إِلى التَرتيب المَخزُون server-side.
    showMapToast('❌ فَشل حفظ التَرتيب', 3000);
    const fresh = await fetchTree();
    if (fresh) { mapRootData = fresh; renderTree(mapRootData); }
    else if (mapRootData) renderTree(mapRootData);   // rollback لِـ ما في الذاكرة.
    if (errCode) console.warn('[MAP] reorder failed:', errCode);
  }
}

// تَحميل + رَسم.
// v2.5.5 — حالات آمنة: skeleton #tree-loading قَبل fetch، رسالة خطأ ليّنة بَعد الفَشل
// (لا alert)، تَمييز «لا بيانات» عن «خطأ شبكة». scroll محفوظ عبر renderTree.
async function loadMap() {
  const container = document.getElementById('map-grid');
  const loadingEl = document.getElementById('tree-loading');
  const emptyEl = document.getElementById('tree-empty');

  // قَبل fetch: أَظهر skeleton، أَخفِ empty.
  if (loadingEl) loadingEl.hidden = false;
  if (emptyEl) { emptyEl.style.display = 'none'; emptyEl.classList.remove('map-empty-error'); }

  const data = await fetchTree();

  // مَنجَز fetch (نجاح أَو فَشل): أَخفِ skeleton.
  if (loadingEl) loadingEl.hidden = true;

  if (!data) {
    // فَشل الشبكة / API: رسالة ليّنة + toast قَصير. لا alert، لا مَسح container فجأَة.
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.classList.add('map-empty-error');
      emptyEl.textContent = '⚠️ تعذّر جلب شجرة المواقع. تَحقّق من الاتّصال و حاول مَرّةً أُخرى.';
    }
    // إِزالة أَيّ بطاقة zone قَديمة (لو كان هناك عَرض سابق).
    if (container) container.querySelectorAll(':scope > .map-zone-card').forEach((c) => c.remove());
    showMapToast('⚠️ تعذّر جلب الشَجرة', 3000);
    return;
  }
  mapRootData = data;
  // أَول load فقط: طي عقدة «أَجهزة غير مُعَيَّن» لو فيها > 8 أَجهزة (لِـ تَجنّب فتح عشرات
  // الأَجهزة فجأة). نَعيدها نَحدّد أَنّها لم تُلطَّ من قبل.
  if (!mapHasInitialized && data.children) {
    const unassigned = data.children.find((c) => c.kind === 'unassigned');
    if (unassigned && unassigned.id === 'unassigned' && (unassigned.device_count || 0) > 8) {
      mapCollapsed.add('unassigned');
    }
    mapHasInitialized = true;
  }
  renderTree(data);
}

// P0.3 — رِسالة قَصيرة على #map-summary (مؤقّتًا بدل الإِجمالي) لِـ 3 ثواني ثُمّ تَعود.
// بَديل لطيف لِـ alert() (مَمنُوع اِستعماله في الخطة).
function showMapToast(msg, ms = 3000) {
  const summaryEl = document.getElementById('map-summary');
  if (!summaryEl) return;
  if (mapToastHandle) clearTimeout(mapToastHandle);
  summaryEl.innerHTML = `<span class="map-summary-count" aria-live="polite">${esc(msg)}</span>`;
  mapToastHandle = setTimeout(() => {
    if (mapRootData && !hasActiveFilters()) renderMapSummary(summaryEl, mapRootData, mapRootData.device_count);
    else if (mapRootData) {
      const visibleCount = countVisibleDevices(mapRootData);
      summaryEl.innerHTML = `<span class="map-summary-count">المُطابِقات: ${visibleCount} جهاز</span>`;
    }
  }, ms);
}

// v2.5.5 — تَطبيق فلتر الحالة (من <select> أَو من chip) و إِعادة الرسم.
function applyStatusFilter(status) {
  mapStatusFilter = status || '';
  const sel = document.getElementById('map-filter-status');
  if (sel) sel.value = mapStatusFilter;
  if (mapRootData) renderTree(mapRootData);
}

// v2.5.5 — مَسح البحث + فلتر الحالة و إِعادة الرسم الكامل.
function clearMapFilters() {
  mapSearchQuery = '';
  mapStatusFilter = '';
  const searchEl = document.getElementById('map-search');
  if (searchEl) searchEl.value = '';
  const sel = document.getElementById('map-filter-status');
  if (sel) sel.value = '';
  if (mapRootData) renderTree(mapRootData);
}

// تَوسيع الكل / طي الكل.
function expandAll() {
  mapCollapsed.clear();
  if (mapRootData) renderTree(mapRootData);
}
function collapseAll() {
  mapCollapsed.clear();
  function walk(node) {
    if (!node) return;
    if (node.kind !== 'root' && node.kind !== 'device' && node.id != null) {
      mapCollapsed.add(node.id);
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }
  walk(mapRootData);
  if (mapRootData) renderTree(mapRootData);
}

// ─── لوحة تَفاصيل الجهاز الجانبية (panel في نفس tab الخريطة) ───────────────
// نقر عقدة جهاز يَستدعي showDeviceDetails(id) ← GET /api/devices/:id ← مَلأ
// #map-device-modal (modal عائم). اِغلاق بِـ زر × أَو مفتاح ESC.

const DEVICE_TYPE_ICONS_FALLBACK = '🖥️';

function deviceIcon(deviceType) {
  if (!deviceType) return DEVICE_TYPE_ICONS_FALLBACK;
  const t = String(deviceType).toLowerCase();
  if (t.includes('router')) return '📶';
  if (t.includes('switch')) return '🔗';
  if (t.includes('firewall')) return '🧱';
  if (t.includes('printer')) return '🖨️';
  if (t.includes('server')) return '🖥️';
  if (t.includes('camera') || t.includes('nvr') || t.includes('dvr')) return '📹';
  if (t.includes('ap') || t.includes('wifi')) return '📡';
  return '🖥️';
}

function statusBadgeHtml(status, idAttr) {
  const text = status === 'online' ? 'متصل' : (status === 'offline' ? 'متوقف' : 'غير معروف');
  const id = idAttr ? `id="${idAttr}" ` : '';
  return `<span ${id}class="details-status-badge ${status || 'unknown'}">${text}</span>`;
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return esc(String(s));
    return esc(d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }));
  } catch (_) { return esc(String(s)); }
}

// فتح modal التَفاصيل + جَلب البيانات.
async function showDeviceDetails(deviceId) {
  const modal = document.getElementById('map-device-modal');
  if (!modal) return;
  const fieldsEl = document.getElementById('map-device-fields');
  if (fieldsEl) fieldsEl.innerHTML = '<p class="details-placeholder">⏳ جَلب التَفاصيل…</p>';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  const r = await api(`/api/devices/${encodeURIComponent(deviceId)}`);
  if (!r || !r.success) {
    if (fieldsEl) fieldsEl.innerHTML = `<p class="details-placeholder">⚠️ تعذّر جلب تَفاصيل الجهاز${r?.error ? ': ' + esc(r.error) : ''}</p>`;
    return;
  }
  const d = r.data;
  // رَأس modal.
  const nameEl = document.getElementById('map-device-name');
  const iconEl = document.getElementById('map-device-icon');
  const statusEl = document.getElementById('map-device-status');
  if (nameEl) nameEl.textContent = d.name || `#${deviceId}`;
  if (iconEl) iconEl.textContent = deviceIcon(d.device_type_name);
  if (statusEl) {
    const wrap = document.createElement('div');
    wrap.innerHTML = statusBadgeHtml(d.current_status, 'map-device-status');
    const neu = wrap.firstChild;
    if (neu) statusEl.replaceWith(neu);
  }

  // الحقول.
  if (fieldsEl) {
    fieldsEl.innerHTML = `
      <div class="details-field"><span class="df-label">IP</span><span class="df-value">${esc(d.ip || '—')}</span></div>
      <div class="details-field"><span class="df-label">النوع</span><span class="df-value">${esc(d.device_type_name || '—')}</span></div>
      <div class="details-field"><span class="df-label">الموقع</span><span class="df-value">${esc(d.location_name || '—')}</span></div>
      <div class="details-field"><span class="df-label">طريقة الفحص</span><span class="df-value">${esc(d.check_protocol || 'ping')}</span></div>
      <div class="details-field"><span class="df-label">المنفذ</span><span class="df-value">${esc(d.port || '—')}</span></div>
      <div class="details-field"><span class="df-label">فترة الفحص</span><span class="df-value">${esc(d.check_interval_seconds ?? '—')} ث</span></div>
      <div class="details-field"><span class="df-label">حد التنبيه</span><span class="df-value">${esc(d.failure_threshold ?? '—')}</span></div>
      <div class="details-field"><span class="df-label">مفعّل</span><span class="df-value">${d.is_active ? 'نعم' : 'لا'}</span></div>
      <div class="details-field"><span class="df-label">زمن الاستجابة</span><span class="df-value">${d.last_response_time_ms != null ? esc(d.last_response_time_ms) + ' ms' : '—'}</span></div>
      <div class="details-field"><span class="df-label">آخر فحص</span><span class="df-value">${fmtDate(d.last_checked_at)}</span></div>
    `;
  }

  // الأَزرار: فتح HTTP/HTTPS + زر اِنتقال لِـ tab الأَجهزة.
  const actionsEl = document.getElementById('map-device-actions');
  if (actionsEl) {
    let html = '';
    if (d.https_accessible == 1) html += `<button class="btn" data-open-url="https://${esc(d.ip)}/">🔒 فتح HTTPS</button>`;
    else if (d.http_accessible == 1) html += `<button class="btn" data-open-url="http://${esc(d.ip)}/">🌐 فتح HTTP</button>`;
    html += `<button class="btn" id="map-device-goto-devices">📋 فتح في تَبويب الأَجهزة</button>`;
    actionsEl.innerHTML = html;
    actionsEl.querySelectorAll('[data-open-url]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(b.dataset.openUrl, '_blank');
      });
    });
    const goto = actionsEl.querySelector('#map-device-goto-devices');
    if (goto) {
      goto.addEventListener('click', () => {
        closeDeviceDetails();
        const btn = document.getElementById('tab-devices');
        if (btn) btn.click();
      });
    }
  }
}

// إِغلاق modal.
function closeDeviceDetails() {
  const modal = document.getElementById('map-device-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('map-refresh-btn')?.addEventListener('click', loadMap);
  document.getElementById('map-expand-btn')?.addEventListener('click', expandAll);
  document.getElementById('map-collapse-btn')?.addEventListener('click', collapseAll);

  // v2.5.5 — بحث فوري بِـ debounce 200ms (نَمط مطابق لِـ resizeHandle).
  const searchEl = document.getElementById('map-search');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      if (mapSearchHandle) clearTimeout(mapSearchHandle);
      mapSearchHandle = setTimeout(() => {
        mapSearchQuery = (e.target.value || '').trim();
        if (mapRootData) renderTree(mapRootData);
      }, 200);
    });
    // مَسح مُباشِر عند ضغط Esc داخل البحث (Utility لَطيفة).
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearMapFilters();
        searchEl.blur();
      }
    });
  }

  // v2.5.5 — فلتر الحالة (select).
  document.getElementById('map-filter-status')?.addEventListener('change', (e) => {
    applyStatusFilter(e.target.value);
  });

  // v2.5.5 — نقر chip (summary) لِـ فلترة سَريعة (delegation على #map-summary).
  document.getElementById('map-summary')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter-status]');
    if (!chip) return;
    applyStatusFilter(chip.dataset.filterStatus);
  });

  // v2.5.5 — زرّ مَسح الفِلترة.
  document.getElementById('map-clear-filters')?.addEventListener('click', clearMapFilters);

  // modal تَفاصيل الجهاز: زر الإِغلاق + مفتاح ESC + نقر على الخلفية (overlay).
  document.getElementById('map-device-close')?.addEventListener('click', closeDeviceDetails);
  document.getElementById('map-device-modal')?.addEventListener('click', (e) => {
    // نقر على الـ backdrop (modal نفسه) يُغلق؛ النقر داخل البطاقة لا.
    if (e.target === e.currentTarget) closeDeviceDetails();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('map-device-modal');
      if (modal && !modal.classList.contains('hidden')) closeDeviceDetails();
    }
  });

  // إعادة الرسم عند تَغيير حجم النافذة.
  let resizeHandle = null;
  window.addEventListener('resize', () => {
    if (resizeHandle) clearTimeout(resizeHandle);
    resizeHandle = setTimeout(() => {
      const section = document.getElementById('section-map');
      if (mapRootData && section && !section.classList.contains('hidden')) {
        renderTree(mapRootData);
      }
    }, 200);
  });

  // auto-refresh عند ظهور التبويب.
  const observer = new MutationObserver(() => {
    const section = document.getElementById('section-map');
    if (!section) return;
    const visible = !section.classList.contains('hidden');
    if (visible) {
      loadMap().catch(() => {});
      if (!mapAutoRefreshHandle) {
        mapAutoRefreshHandle = setInterval(() => loadMap().catch(() => {}), 30000);
      }
    } else {
      if (mapAutoRefreshHandle) {
        clearInterval(mapAutoRefreshHandle);
        mapAutoRefreshHandle = null;
      }
    }
  });
  const s = document.getElementById('section-map');
  if (s) observer.observe(s, { attributes: true, attributeFilter: ['class'] });
});
