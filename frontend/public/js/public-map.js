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

  // اِستِخراج زب متغيّر CSS (متوافِق مَع الثيم اللَيلي) مَع fallback.
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // لون خلفية بطاقة zone بحسب kind (نَفس منطق admin).
  // v2.7.1: نَستَعمل متغيّرات CSS (تَتكيّف مع الثيم الليلي) بدَل rgba ثابت لِـ تَناسُق
  // الوَضع الليلي في الـ grid. fallback لِـ قيم واضحة لو الـ var غَاب.
  function kindColor(kind) {
    switch (kind) {
      case 'internet': return cssVar('--zone-internet-bg', 'rgba(37, 99, 235, 0.18)');
      case 'zone':     return cssVar('--zone-bg', 'rgba(234, 179, 8, 0.18)');
      case 'unassigned': return cssVar('--zone-unassigned-bg', 'rgba(156, 163, 175, 0.18)');
      default: return cssVar('--card-bg', '#ffffff');
    }
  }
  // لون إِطار بطاقة zone بِحسب تَلخيص أَجهزتها (نَفس منطق admin locationBorderColor).
  function locationBorderColor(node) {
    if (!node) return '#ccc';
    if (node.offline > 0) return cssVar('--offline', '#ef4444');
    if (node.device_count > 0 && node.online === node.device_count) return cssVar('--online', '#22c55e');
    return '#9e9e9e';
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
    let cards = zoneKids
      .map((c, i) => renderZoneCard(c, { posinset: i + 1, setsize: setSize }))
      .join('');
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
      cards += renderZoneCard(orphanNode, { posinset: setSize, setsize: setSize });
    }
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
    if (kind === 'internet') border = '#2563eb';
    if (kind === 'zone') border = '#eab308';

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

    return `
    <article class="${cls}" data-id="${esc(String(node.id))}" data-kind="${esc(kind)}" role="listitem"${ariaSet}
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
