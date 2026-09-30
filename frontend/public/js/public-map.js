// public-map.js (v2.6.0 — عرض «خريطة المواقع» في الصَفحة العامة: zones grid)
// ─────────────────────────────────────────────────────────────
// الصَفحة العامة index.html: زرّ 🗺️ الثالث في .view-toggle يُبَدّل إِلى هذا العَرض.
//   - جَلب الشجرة مِن GET /api/map/public/tree (مَسار عام بِلا auth؛ أَسماء الأَجهزة
//     مَحذُوفة في الـ API لِـ سِرّيَة البيانات، فقط IP/status/device_type/counts).
//   - نَفس شَكل Zones-Grid admin (.map-grid/.map-zone-card) لكن بِلا modal تَفاصيل
//     (لا detail view في الصَفحة العامة) و بِلا dblclick filter-location (admin only).
//   - polling كل 10 ثوانٍ (نَفس قَاع public-dashboard.js) لِـ التَحديث اللَحظي.
//   - lazy load: لا يَحمِل الشجرة إِلّا عند مرّة أُولى when switchView('map').
//   - RTL مُتوارَث dir="rtl" عَلى <html>؛ الثيم اللَيلي عبر متغيّرات CSS —
//     لا كود خَاص لِـ ذلك.
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ═══ حالة public-map ═══
  let publicMapRootData = null;
  let publicMapLoaded = false;       // lazy: هل حَمَلنا الشجرة مَرّةً واحدة على الأَقّل؟
  let publicMapPollHandle = null;    // setInterval id لِـ polling 10s.
  const publicCollapsed = new Set(); // ids zone المَطوية (نَفس منطق admin).
  // v2.7.4 — حالة السَحب والإِفلات لإعادة تَرتيب البطاقات (نَفس منطق admin-map.js).
  // في الصَفحة العامة قد لا يكون الزائر مُسجّل دخول → POST /reorder قد يُرفض بـ 401/403؛
  // عندئذٍ نَترك DOM بالتَرتيب الجَديد لِـ هذه الجلسة فقط (يُلغى عند polling 10s).
  let publicMapDragging = false;
  let publicMapDraggedId = null;
  let publicMapDragOverId = null;
  // هل السَحب متاح فعلياً (لو HB أَو LoggedIn)? نَحدّده عند نجاح reorder فقط، لا هنا.

  // أَيَقونات zones — نَفس KIND_ICON admin.
  const KIND_ICON = {
    root: '🌐', internet: '🌐', zone: '📍', site: '🏛️', building: '🏢',
    floor: '📐', room: '🚪', rack: '🗄️', unassigned: '📦', device: '🖥️',
  };
  // أَيَقونات أَنواع الأَجهزة (نَفس deviceIcon admin — لا access إِلى admin-utils.js).
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

  // تَهريب HTML بَسيط — الصَفحة العامة لا تُحمّل admin-utils.js، لِـ ذلك نُعرّف esc محليًّا.
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, String.fromCharCode(38)+'amp;')
      .replace(/</g, String.fromCharCode(38)+'lt;')
      .replace(/>/g, String.fromCharCode(38)+'gt;')
      .replace(/"/g, String.fromCharCode(38)+'quot;')
      .replace(/'/g, String.fromCharCode(38)+'#39;');
  }

  // اِستِخراج قيم متغيّر CSS (متوافِق مَع الثيم اللَيلي) مَع fallback.
  // ملاحظة: cssVar() تُرجِع القيمة المَحلولة لحظياً (مَلائمة لِـ canvas/svg أَو قِراءة
  // عابرة)، لكن لا تَصلح لِـ تَخزينها inline على عُقدة ما زالت في الـ DOM — لو تَغيّر
  // الثيم لاحقاً تَبقى القيمة القديمة. لِذلك تَستعمل renderZoneCard() مراجع var()
  // الثابتة من kindColor()/locationBorderColor() بالأسفل لِـ inline styles.
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // لون خلفية بطاقة zone بحسب kind (نَفس منطق admin).
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
  // لون إِطار بطاقة zone بِحسب تَلخيص أَجهزتها (نَفس منطق admin locationBorderColor).
  // v2.7.3: مراجع var() لِـ تَكيّف الثيم.
  function locationBorderColor(node) {
    if (!node) return 'var(--border, #ccc)';
    if (node.offline > 0) return 'var(--offline, #ef4444)';
    if (node.device_count > 0 && node.online === node.device_count) return 'var(--online, #22c55e)';
    return 'var(--border, #9e9e9e)';
  }
  // tooltip مُختَصَر لِـ zone/جهاز (نَفس شَكل admin، لكن لاحِظ أَنّ public API يَحذف device name).
  function nodeTooltip(node) {
    if (node.kind === 'device') {
      // public: لا name → IP فقط.
      return `IP: ${node.ip}\nالنوع: ${node.device_type || '—'}\nالحالة: ${node.status}`;
    }
    return `${node.name}\nأَجهزة: ${node.device_count} (🟢${node.online} 🔴${node.offline} ⚪${node.unknown})`;
  }

  // ═══ API ═══
  // جلب الشجرة مِن مَسار public (بِلا auth). يُرجِع null عند الفَشل.
  async function fetchPublicTree() {
    try {
      const r = await fetch('/api/map/public/tree');
      if (!r.ok) { console.warn('[PUBLIC-MAP] HTTP', r.status); return null; }
      const j = await r.json();
      if (!j || !j.success) { console.warn('[PUBLIC-MAP] bad payload'); return null; }
      return j.data;
    } catch (e) {
      console.warn('[PUBLIC-MAP] fetch error:', e);
      return null;
    }
  }

  // ═══ render markers ═══
  // بناء HTML لِـ شَبكة البطاقات مِن الجذر (نَفس منطق admin renderZonesGrid، بِلا فلترة
  // search/status لِـ أَنّ الصَفحة العامة لا تَملِك toolbar فِلترة map مُستقِلّة).
  // v2.6.0 — فصل الأَجهزة المُباشِرة في الجذر (devices في جذر internet بِلا zone) في
  // بطاقة مَخصَّصة «أَجهزة مَدخل الإنترنت» لِـ تَجنّب بَطاقات فَارِغة.
  function renderZonesGridPublic(rootData) {
    if (!rootData) return '';
    const kids = Array.isArray(rootData.children) ? rootData.children : [];
    const zoneKids = [];
    const orphanDevices = [];
    for (const c of kids) {
      if (c.kind === 'device') orphanDevices.push(c);
      else zoneKids.push(c);
    }
    // v2.7.0 (PD) — aria-posinset/aria-setsize للـ a11y.
    const orphanCardCount = orphanDevices.length > 0 ? 1 : 0;
    const setSize = zoneKids.length + orphanCardCount;
    // v2.7.5 — بطاقة «أَجهزة مَدخل الإنترنت» ثابتة في الأَول دائماً (نَفس منطق admin-map).
    let orphanHtml = '';
    if (orphanDevices.length > 0) {
      const orphanNode = {
        id: 'orphan-internet-devices',
        name: 'أَجهزة مَدخل الإنترنت',
        kind: 'unassigned',
        device_count: orphanDevices.length,
        online: orphanDevices.filter((d) => d.status === 'online').length,
        offline: orphanDevices.filter((d) => d.status === 'offline').length,
        unknown: orphanDevices.filter((d) => d.status === 'unknown').length,
        children: orphanDevices,
        _orphan: true,
      };
      orphanHtml = renderZoneCard(orphanNode, { posinset: 1, setsize: setSize });
    }
    // zones بَعْد البطاقة الصِناعيّة (posinset يَبدأ من 2 لو وُجدت).
    const start = orphanHtml ? 2 : 1;
    const cards = orphanHtml + zoneKids
      .map((c, i) => renderZoneCard(c, { posinset: start + i, setsize: setSize }))
      .join('');
    return cards;
  }

  function renderZoneCard(node, opts) {
    opts = opts || {};
    const kind = node.kind || 'zone';
    const icon = KIND_ICON[kind] || '📍';
    const collapsedNow = publicCollapsed.has(node.id);

    const bg = kindColor(kind);
    let border = locationBorderColor(node);
    let borderW = (node.offline > 0) ? '2px' : '1px';
    // v2.7.3: مراجع var() على الأَلوان الثيم (تَتكيّف مع نهاري/ليلي) بدَل أَلوان
    // ثابتة #2563eb/#eab308 التي لا تَتَكيّف في الوَضع الليلي.
    if (kind === 'internet') border = 'var(--accent, #2563eb)';
    if (kind === 'zone')     border = 'var(--warning, #eab308)';

    const dc = node.device_count || 0;
    const on = node.online || 0;
    const off = node.offline || 0;
    const unk = node.unknown || 0;
    const stats = dc > 0
      ? `🟢 ${on} · 🔴 ${off} · ⚪ ${unk} <span class="map-count">(${dc})</span>`
      : '—';

    // v2.7.0 — has-online: zone بأَجهزة كلها online (offline=0, online>0) → إِطار أَخضر مُميَّز.
    const cls = `map-zone-card kind-${kind}${off > 0 ? ' has-offline' : ''}${(on > 0 && off === 0) ? ' has-online' : ''}${collapsedNow ? ' collapsed' : ''}`;
    const body = renderZoneBody(node);

    // v2.7.0 (PD) — aria-posinset/aria-setsize من opts للـ a11y (اِختياري).
    const ariaSet = opts.posinset != null && opts.setsize != null
      ? ` aria-posinset="${opts.posinset}" aria-setsize="${opts.setsize}"`
      : '';

    // v2.7.4 — السَحب والإِفلات: البطاقات الحقيقية قابِلة للسَحب (draggable="true")؛
    // البطاقات الصِناعيّة (kind-unassigned مثل «أَجهزة مَدخل الإِترنت» أَو id رقمي مَفقود)
    // لا تُسحَب — لا row تَحدّثه في DB. (نَفس منطق admin-map.js.)
    const isUnassignedPub = kind === 'unassigned';
    const draggablePub = !isUnassignedPub && node.id != null && typeof node.id === 'number' ? 'true' : 'false';

    return `
    <article class="${cls}" data-id="${esc(String(node.id))}" data-kind="${esc(kind)}" role="listitem"${ariaSet} draggable="${draggablePub}"
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

  // مُتكرّرة: devices + sub-zones (نَفس نَمط admin، بِلا فلترة client-side).
  function renderZoneBody(node) {
    const kids = Array.isArray(node.children) ? node.children : [];
    if (kids.length === 0) {
      const dc = node.device_count || 0;
      if (dc === 0) return '<p class="map-zone-empty">لا أَجهزة في هذا الموقع.</p>';
      return '';
    }
    const devices = [];
    const subzones = [];
    for (const c of kids) {
      if (c.kind === 'device') devices.push(c);
      else subzones.push(c);
    }
    let html = '';

    if (devices.length > 0) {
      html += devices.map((d) => renderZoneDevice(d)).join('');
    }

    for (const sz of subzones) {
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
    return html || '<p class="map-zone-empty">لا مُحتَوى.</p>';
  }

  // device chip (public) — v2.7.1: مكشوف <button> بِـ type=button، يَفتح modal تَفاصيل الجهاز
  // (window.openDeviceModal من public-dashboard.js) عند النقر → يَعرض نِسبة التَشغيل + الرسم
  // البياني + الانقطاعات. data-id بِـ صيغة "dev-X" (نَستخرج الرقمي). public API يَحذف device name.
  function renderZoneDevice(node) {
    const status = node.status || 'unknown';
    const icon = deviceIcon(node.device_type) || DEVICE_TYPE_ICONS_FALLBACK;
    // public API يَحذف device name — نَعرض IP بدَلًا منه (لو وُجد name استَعمِله).
    const label = node.name ? esc(node.name) : esc(node.ip || 'جهاز');
    const meta = esc(node.device_type || 'جهاز');
    const idAttr = node.id ? ` data-id="${esc(String(node.id))}"` : '';
    return `
    <button type="button" class="map-zone-device" data-status="${esc(status)}"${idAttr} title="${esc(nodeTooltip(node))}\n— اِنقر لعرض نِسبة التَشغيل و التَفاصيل">
      <span class="map-device-dot" aria-hidden="true"></span>
      <span class="map-device-ic">${icon}</span>
      <span class="map-device-name">${label}</span>
      <span class="map-device-meta">${meta}</span>
    </button>`;
  }
  // ملاحظة: في الصَفحة العامة جعلنا `.map-zone-device` <div> سابقاً (لا تَفاصيلي تفاعُل).
  // v2.7.1: غَيّرناه إِلى <button> لِـ تَفعِيل openDeviceModal عند النقر (نِسبة التَشغيل).

// ═══ تَحميل + رَسم ═══
async function loadPublicMap() {
  const grid = document.getElementById('public-map-grid');
  const emptyEl = document.getElementById('public-map-empty');
  if (!grid) return;

  const data = await fetchPublicTree();
  if (!data) {
    // خطأ شبكة/AP I: إِظهار رِسالة. لا alert.
    if (emptyEl) {
      emptyEl.textContent = '⚠️ تعذّر جلب خريطة المواقع. تَحقّق من الاتّصال.';
      emptyEl.classList.remove('hidden');
    }
    grid.innerHTML = '';
    return;
  }
  publicMapRootData = data;

  // v2.7.0 (PC) — تَحديث شريط نِسبة التَشغيل (#map-uptime-bar) من جذر الشَجِرة.
  updateUptimeBar(data);

    const hasAny = data.device_count > 0 ||
      (Array.isArray(data.children) && data.children.length > 0);
    if (!hasAny) {
      if (emptyEl) {
        emptyEl.textContent = 'لا توجد مواقع/أَجهزة بعد.';
        emptyEl.classList.remove('hidden');
      }
      grid.innerHTML = '';
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
  // بناء + إِدراج البطاقات. نُحافِظ عَلى أَي scroll حالي (لو كان).
  const html = renderZonesGridPublic(data);
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    grid.querySelectorAll(':scope > .map-zone-card').forEach((c) => c.remove());
    grid.insertBefore(tpl.content, grid.firstChild);

    publicMapLoaded = true;
    bindEvents(grid);
  }

  // ═══ delegation (نقر header → toggle, نقر device → openDeviceModal) ═══
  let eventsBound = false;
  function bindEvents(grid) {
    if (eventsBound) return;
    eventsBound = true;
    grid.addEventListener('click', (event) => {
      // v2.7.1 — نقر device chip له الأَولوية: اِفتح modal التَفاصيل (نِسبة التَشغيل).
      // نُعالِجه قَبل lookup بطاقة zone لِـ أَنّ chip الجهاز داخل جِسم البطاقة.
      const deviceChip = event.target.closest('.map-zone-device');
      if (deviceChip && deviceChip.dataset.id) {
        // data-id بِـ صيغة "dev-X" (public API). نَستخرج الرقمي.
        const rawId = String(deviceChip.dataset.id);
        const m = /^dev-(\d+)$/.exec(rawId);
        const deviceId = m ? m[1] : rawId;
        if (typeof window.openDeviceModal === 'function') {
          window.openDeviceModal(deviceId);
        }
        return;
      }
      const card = event.target.closest('.map-zone-card');
      if (!card) return;
      const id = card.dataset.id;
      const kind = card.dataset.kind;
      if (kind === 'device' || kind === 'root') return;
      // السَهم أَو التَرويسة → toggle.
      const toggleClicked = event.target.closest('.map-zone-toggle');
      const headerClicked = event.target.closest('.map-zone-header');
      if (toggleClicked || headerClicked) {
        if (publicCollapsed.has(id)) {
          publicCollapsed.delete(id);
          card.classList.remove('collapsed');
        } else {
          publicCollapsed.add(id);
          card.classList.add('collapsed');
        }
        const toggleEl = card.querySelector(':scope > .map-zone-header > .map-zone-toggle');
        if (toggleEl) toggleEl.setAttribute('aria-expanded', !card.classList.contains('collapsed'));
      }
    });

    // ═══ v2.7.4 — السَحب والإِفلات لإعادة تَرتيب بطاقات zones (public) ═══
    // نَفس منطق admin-map.js لكن public لا تَملِك toolbar فِلترة (لا hasActiveFilters()).
    // public لا تَملِك api() مَع auth → نَستدعِي fetch مُباشِرة و نَتعامَل مَع 401/403:
    // عند فَشل auth نَترك DOM بالتَرتيب الجَديد لِـ هذه الجلسة فقط + toast تَنبيه.
    grid.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.map-zone-card');
      if (!card) { event.preventDefault(); return; }
      const kind = card.dataset.kind;
      const id = String(card.dataset.id);
      // البطاقات غير القابِلة للسَحب: الصِناعيّة (لا id رقمي ولا row تَحدّثه في DB).
      if (kind === 'unassigned' || id === 'orphan-internet-devices' || !/^\d+$/.test(id)) {
        event.preventDefault();
        return;
      }
      publicMapDragging = true;
      publicMapDraggedId = id;
      card.classList.add('dragging');
      grid.classList.add('reordering');
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData('text/plain', id); } catch (_) {}
      // إِيقاف polling 10s مؤقّتًا أَثناء السَحب (إِلى حين dragend).
      stopPolling();
    });

    grid.addEventListener('dragover', (event) => {
      if (!publicMapDragging) return;
      const card = event.target.closest('.map-zone-card');
      if (!card) return;
      const kind = card.dataset.kind;
      const id = String(card.dataset.id);
      if (id === publicMapDraggedId || kind === 'unassigned' || id === 'orphan-internet-devices' || !/^\d+$/.test(id)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (publicMapDragOverId && publicMapDragOverId !== id) {
        const prev = grid.querySelector(`:scope > .map-zone-card[data-id="${publicMapDragOverId}"]`);
        if (prev) prev.classList.remove('drag-over');
      }
      card.classList.add('drag-over');
      publicMapDragOverId = id;
    });

    grid.addEventListener('dragleave', (event) => {
      const card = event.target.closest('.map-zone-card');
      if (!card) return;
      if (publicMapDragOverId && card.dataset.id === publicMapDragOverId && !card.contains(event.relatedTarget)) {
        card.classList.remove('drag-over');
        if (publicMapDragOverId === card.dataset.id) publicMapDragOverId = null;
      }
    });

    grid.addEventListener('drop', async (event) => {
      if (!publicMapDragging) return;
      event.preventDefault();
      const dropCard = event.target.closest('.map-zone-card');
      if (!dropCard) return;
      const dropId = String(dropCard.dataset.id);
      if (dropId === publicMapDraggedId) return;
      // v2.7.5 — البطاقة الصِناعيّة (أَجهزة مَدخل الإنترنت) ثابتة في الأَول؛ لا إِفلات
      // عَلَيها ولا إِدخال أَمامها (insertBefore قَبلها = إِزاحتها من المركز الأول).
      if (dropId === 'orphan-internet-devices' || !/^\d+$/.test(dropId)) return;
      const dragCard = grid.querySelector(`:scope > .map-zone-card[data-id="${publicMapDraggedId}"]`);
      if (!dragCard) return;
      grid.insertBefore(dragCard, dropCard);
      await savePublicReorder(grid);
    });

    grid.addEventListener('dragend', () => {
      grid.querySelectorAll(':scope > .map-zone-card').forEach((c) => {
        c.classList.remove('dragging');
        c.classList.remove('drag-over');
      });
      grid.classList.remove('reordering');
      publicMapDragging = false;
      publicMapDraggedId = null;
      publicMapDragOverId = null;
      // إِعادة polling 10s بَعد انتهاء السَحب (نَفس activate).
      startPolling();
    });
  }

  // ═══ v2.7.4 — toast بَسيط لِـ الصَفحة العامة (بَديل لطيف لِـ alert) ═══
  // يَعرض رسالة قَصيرة في #public-map-empty (مُؤقّتًا) ثُمّ يُعيد حالته. لو وُجد عنصر
  // مَخصَّص #public-map-toast نَستعمله (أَفضل لكنّه اِختياري). لا يتَدخّل في polling.
  let publicToastHandle = null;
  let publicEmptyWasHidden = true;   // هل emptyEl كان مَخفياً قَبل الـ toast (نُعيده).
  function showPublicToast(msg, ms) {
    const emptyEl = document.getElementById('public-map-empty');
    if (!emptyEl) return;
    if (publicToastHandle) clearTimeout(publicToastHandle);
    publicEmptyWasHidden = emptyEl.classList.contains('hidden');
    emptyEl.textContent = msg;
    emptyEl.classList.remove('hidden');
    publicToastHandle = setTimeout(() => {
      // نُعيد emptyEl إِلى مَخفياً (لِـ لا يَ阻碍 preview). polling سيُحدّثه لاحقاً.
      emptyEl.classList.add('hidden');
      emptyEl.textContent = '';
    }, ms || 2500);
  }

  // ═══ v2.7.4 — حفظ التَرتيب الجَديد بَعد السَحب (public) ═══
  // public لا تَملِك api() مَع auth → نَستدعِي fetch بِـ credentials include. عند 401/403:
  // نَترك DOM بالتَرتيب الجَديد (ترتيب جَلسة)، و نُنبيه بأَنّ الحفظ يَتطلّب صلاحية المشرف.
  // عند النجاح: نُعيد جَلب الشَجِرة (لِـ تَحديث التَرقيم 01/02… و السَهم ↣ آلياً).
  async function savePublicReorder(grid) {
    const cards = grid.querySelectorAll(
      ':scope > .map-zone-card:not([data-kind="unassigned"]):not([data-id="orphan-internet-devices"])'
    );
    const updates = [...cards]
      .map((card, i) => {
        const id = Number(card.dataset.id);
        if (!Number.isFinite(id)) return null;
        return { id, sort_order: i };
      })
      .filter(Boolean);
    if (updates.length === 0) return;

    showPublicToast('⏳ جاري حفظ التَرتيب الجَديد…', 2000);

    let ok = false;
    let status = 0;
    try {
      const r = await fetch('/api/locations/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updates }),
      });
      status = r.status;
      if (r.ok) {
        const j = await r.json();
        ok = !!(j && j.success);
      } else if (status === 401 || status === 403) {
        // غير مسجّل/لا صلاحية: نَترك DOM بالتَرتيب الجَديد لِـ هذه الجلسة فقط.
        ok = false;
      }
    } catch (e) {
      ok = false;
      status = 0;
    }

    if (ok) {
      const fresh = await fetchPublicTree();
      if (fresh) {
        publicMapRootData = fresh;
        loadPublicMap();   // يُعيد الرَسم بِـ助攻 التَرقيم و السَهم الجَديد عبر renderZonesGridPublic.
        showPublicToast('✅ تم حفظ التَرتيب الجَديد', 2000);
      } else {
        showPublicToast('✅ تم حفظ التَرتيب', 2000);
      }
    } else if (status === 401 || status === 403) {
      // التَرتيب البَصري للجلسة فقط — سيُلغى عند polling 10s التالي.
      showPublicToast('⚠️ التَرتيب يَتطلّب صلاحية المُشرف — حُفِظ مؤقّتًا لهذه الجلسة فقط', 4000);
    } else {
      // فَشل غَير auth (شبكة/خادم): نُعيد جَلب الشَجِرة لِـ rollback بَصري.
      showPublicToast('❌ فَشل حفظ التَرتيب', 3000);
      await loadPublicMap();
    }
  }

  // ═══ polling 10s ═══
  function startPolling() {
    if (publicMapPollHandle) return;
    publicMapPollHandle = setInterval(loadPublicMap, 10000);
  }
  function stopPolling() {
    if (publicMapPollHandle) {
      clearInterval(publicMapPollHandle);
      publicMapPollHandle = null;
    }
  }

  // v2.7.0 (PC) — تَحديث شريط نِسبة التَشغيل في #map-uptime-bar من بيانات الجذر.
  // online/total → نِسبة % → شريط مُتدرّج + نَصّ "نِسبة التَشغيل: 🟢 40% (16/41 متصل)"
  function updateUptimeBar(rootData) {
    const bar = document.getElementById('map-uptime-bar');
    if (!bar || !rootData) return;
    const total = rootData.device_count || 0;
    const online = rootData.online || 0;
    const offline = rootData.offline || 0;
    const unknown = rootData.unknown || 0;
    if (total <= 0) {
      bar.innerHTML = '<span class="uptime-text">لا أَجهزة لِـ حِساب النِسبة.</span>';
      return;
    }
    const pct = Math.round((online / total) * 1000) / 10;   // رقم عشري واحد
    const pctClass = pct >= 90 ? '' : (pct >= 50 ? 'mid' : 'low');
    bar.innerHTML =
      '<div class="uptime-bar"><div class="uptime-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="uptime-text">نِسبة التَشغيل: 🟢 <span class="uptime-pct ' + pctClass + '">' + pct + '%</span> ' +
      '(' + online + '/' + total + ' متصل' +
      (offline > 0 ? ' — 🔴 ' + offline + ' متوقف' : '') +
      (unknown > 0 ? ' — ⚪ ' + unknown + ' غير معروف' : '') +
      ')</span>';
  }

  // ═══ API خارجي لِـ public-dashboard.js (lazy + start/stop polling) ═══
  // يَستدعيه switchView('map'): يَحمِل الشجرة مَرّةً واحدة (لو لم تُحمَل)، و يَبدأ polling
  // بينما لِـ العَرض. switchVي('cards')/'table' يُوقِف polling.
  window.PublicMapView = {
    activate: function () {
      if (!publicMapLoaded) {
        loadPublicMap();
      }
      startPolling();
    },
    deactivate: function () {
      stopPolling();
    },
  };

  // ═══ safety: لَو فُتِح رابط مُباشِر بِـ view=map (localStorage) قبل التَبديل مَرّة،
  // لَن يَتَمّ activate. سَنَترُكها لِـ public-dashboard.js لِـ يَستَدعِي activate عند init.
})();
