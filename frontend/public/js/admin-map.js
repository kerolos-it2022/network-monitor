// admin-map.js (v2.5.4 — خريطة تسلسلية هرمية: خطوط L + مسار رقمي + خلفية متتابعة)
// ─────────────────────────────────────────────────────────────
// تَبويب «🗺️ خريطة المواقع»: هرم مُدمَج (internet ← zones ← devices).
//   - جَلب الشجرة من GET /api/map/tree (JSON مُتداخل؛ الجذر = internet لو وُجد واحد،
//     وإلا «كل المواقع»).
//   - تَنسيق (v2.5.4): شجرة HTML/CSS متداخلة (ul/li) بدلًا من D3 — RTL طبيعي، لا تَراص،
//     النصوص داخل العُقد، scroll فقط (بلا zoom — أُزيل في v2.5.3).
//   - خلفية العُقدة الموقع = لون حسب kind (internet=أَزرق، zone=أَصفر/برتقالي…)
//     مُعمَّق تَدريجيًا حسب العمق (data-depth) لِـ تَمييز بَصري أَوضح بين المستويات.
//     الأَجهزة مَلؤوة بلون الحالة (online/ offline/ unknown).
//     إطار عُقدة الموقع = تَلخيص أَجهزته (أَحمر لو وُجد offline، أَخضر لو كلها online).
//   - مسار رقمي هرمي (1.2.3) أمام كل عقدة (v2.5.4) يُولَّد باجتياز الشجرة ويمثّل
//     المسار الكامل من الجذر بَدل id مجرّد.
//   - خطوط وصل بصرية (L) بين الأَب وأَبنائه عبر ::before على كل li — تَرسم خط رأسي
//     + خط أَفقي قَصير (RTL تلقائي عبر inset-inline-start)، آخر ابن يَحصل على L قَصير.
//   - تَفاعل: نقر موقع ↔ طي/تَوسيع (toggle class بلا إِعادة بناء، transitions سلسة على
//     max-height)؛ نَقر مزدوج على موقع ↔ اِنتقال لِـ تَبويب «الأَجهزة» مُصفّى بِـ
//     location_id (حدث map:filter-location)؛ نقر جهاز ↔ فتح modal تَفاصيل عائم
//     (showDeviceDetails ← GET /api/devices/:id).
//   - auto-refresh كل 30 ثانية عندما التبويب ظاهر.
//   - modal: زِر × + مفتاح ESC + نقر على الخلفية يُغلقونه.
// ─────────────────────────────────────────────────────────────

let mapAutoRefreshHandle = null;
let mapRootData = null;
const mapCollapsed = new Set();
let mapHasInitialized = false;

// أيقونات أنواع المواقع (هرم الشبكة المُدمَج).
const KIND_ICON = {
  root: '🌐', internet: '🌐', zone: '📍', site: '🏛️', building: '🏢',
  floor: '📐', room: '🚪', rack: '🗄️', unassigned: '📦', device: '🖥️',
};

// أَلوان عُقد الجهاز من متغيرات CSS (تَتلاءم مع الثيم الليلي) مع fallback.
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
function kindColor(kind) {
  switch (kind) {
    case 'internet': return 'rgba(37, 99, 235, 0.18)'; // أَزرق
    case 'zone': return 'rgba(234, 179, 8, 0.18)';      // أَصفر/برتقالي
    case 'unassigned': return 'rgba(156, 163, 175, 0.18)';
    default: return cssVar('--bg', '#ffffff');          // site/building/... → خلفية عادية
  }
}

// لون إطار عُقدة موقع بحسب تَلخيص أَجهزته.
function locationBorderColor(node) {
  if (!node) return '#ccc';
  if (node.offline > 0) return cssVar('--offline', '#ef4444');
  if (node.device_count > 0 && node.online === node.device_count) return cssVar('--online', '#22c55e');
  return '#9e9e9e';
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

// بناء HTML لعُقدة واحدة (recursion).
// path = المسار الرقمي الهرمي (v2.5.4) مثل "1.2.3"؛ الجذر يَحصل على "1"، أَبناؤه "1.1", "1.2"...
function renderNode(node, depth, path) {
  const kind = node.kind || 'zone';
  const icon = KIND_ICON[kind] || '📍';
  const isDev = kind === 'device';
  const isRoot = kind === 'root';

  // تَفاصيل العُقدة (counts للأَبوية، status للأَجهزة).
  let meta = '';
  if (isDev) {
    meta = `${esc(node.device_type || 'جهاز')} · <span class="map-status ${node.status}">${esc(node.status)}</span>`;
  } else if (node.device_count > 0) {
    meta = `🟢 ${node.online} · 🔴 ${node.offline} · ⚪ ${node.unknown} <span class="map-count">(${node.device_count})</span>`;
  } else {
    meta = '—';
  }

  // مؤشّر طي/تَوسيع.
  const canCollapse = !isDev && !isRoot && hasChildren(node);
  const collapsedNow = canCollapse && isCollapsed(node);
  const toggleMark = canCollapse ? (collapsedNow ? '▶' : '▼') : '';

  // لون الخلفية/الإِطار.
  let bg = cssVar('--card-bg', '#fff');
  let border = '#9e9e9e';
  let borderW = '1px';
  if (isDev) {
    bg = deviceColor(node.status);
    border = deviceColor(node.status);
    borderW = '2px';
  } else {
    bg = kindColor(kind);
    border = locationBorderColor(node);
    borderW = (node.offline > 0) ? '2px' : '1px';
    if (kind === 'internet') border = '#2563eb';
    if (kind === 'zone') border = '#eab308';
  }

  // الأَبناء: دائمًا نُولّد .map-children (حتى لو مطوية) — طي/تَوسيع يَتم بِـ class
  // `collapsed` على li و الـ CSS يَطوي max-height (transition سلسة). هذا أَكثر متانة
  // من إِعادة بناء innerHTML كاملة عند كل toggle.
  // نَمرّر childPath لكل طفْل = path + '.' + (index+1) لِـ توليد المسار الرقمي الهرمي.
  const kids = hasChildren(node) ? renderChildren(node.children, depth + 1, path) : '';

  // class العُقدة. data-depth يَسمح لِـ CSS بِـ تَغميق تَدريجي حسب المستوى.
  const cls = `map-node-html kind-${kind}${isDev ? ' kind-device' : ''}${canCollapse ? ' has-children' : ''}${collapsedNow ? ' collapsed' : ''}`;

  // تَنسيق العقدة HTML.
  // .map-path = المسار الرقمي الهرمي (v2.5.4) — خافت لِـ لا يُشتت لكنه يُظهر التَسلسل.
  return `
    <li class="${cls}" data-id="${esc(String(node.id))}" data-kind="${esc(kind)}" data-depth="${depth}" style="--node-bg:${bg}; --node-border:${border}; --node-border-w:${borderW};">
      <div class="map-node-row" title="${esc(nodeTooltip(node))}">
        <span class="map-toggle">${toggleMark}</span>
        <span class="map-path" title="المسار الهرمي">${esc(path)}</span>
        <span class="map-icon">${icon}</span>
        <span class="map-name">${esc(node.name || '')}</span>
        <span class="map-meta">${meta}</span>
      </div>
      ${kids}
    </li>`;
}

// renderChildren: يَولّد ul.map-children + li واحد لكل طفْل. نَمرّر childPath = parentPath + '.' + (index+1).
function renderChildren(children, depth, parentPath) {
  if (!Array.isArray(children) || children.length === 0) return '';
  const items = children.map((c, i) => renderNode(c, depth, `${parentPath}.${i + 1}`)).join('');
  return `<ul class="map-children" data-depth="${depth}">${items}</ul>`;
}

// tooltip النصّي.
function nodeTooltip(node) {
  if (node.kind === 'device') {
    return `${node.name}\nIP: ${node.ip}\nالنوع: ${node.device_type || '—'}\nالحالة: ${node.status}`;
  }
  return `${node.name}\nأَجهزة: ${node.device_count} (🟢${node.online} 🔴${node.offline} ⚪${node.unknown})`;
}

// رَسم الشجرة كاملة في container.
function renderTree(rootData) {
  const container = document.getElementById('tree-container');
  const emptyEl = document.getElementById('tree-empty');
  const summaryEl = document.getElementById('map-summary');
  if (!container) return;

  // حالة فارغة.
  const hasAny =
    rootData &&
    (rootData.device_count > 0 ||
      (Array.isArray(rootData.children) && rootData.children.length > 0));
  if (emptyEl) emptyEl.style.display = hasAny ? 'none' : 'block';
  if (!hasAny) {
    container.innerHTML = '<ul class="map-tree"></ul>';
    if (summaryEl) summaryEl.textContent = '';
    return;
  }

  // ملخص.
  if (summaryEl) {
    summaryEl.textContent = `الإِجمالي: ${rootData.device_count} جهاز · 🟢 ${rootData.online} online · 🔴 ${rootData.offline} offline · ⚪ ${rootData.unknown}`;
  }

  // بناء HTML.
  // الجذر (root/internet) يُمَثَّل كـ root node؛ أَبناؤه (zones + sites + unassigned) كـ children.
  // نُلفّ الجذر في ul/li واحدة بأَبنائه. الجذر path = "1" (v2.5.4).
  const rootHtml = renderNode(rootData, 0, '1');
  container.innerHTML = `<ul class="map-tree">${rootHtml}</ul>`;

  // رَبط الأَحداث (delegation).
  bindNodeEvents(container);
}

// رَبط نقر/طي على كل العُقد عبر delegation.
function bindNodeEvents(container) {
  container.addEventListener('click', (event) => {
    const li = event.target.closest('.map-node-html');
    if (!li) return;
    const id = li.dataset.id;
    const kind = li.dataset.kind;

    // النقر على toggle أَو على الصف نفسه لِـ المواقع (غير device/root) → طي/تَوسيع.
    if (kind !== 'device' && kind !== 'root') {
      // لو النقر على toggleMark أَو على الصف → بَدّل الطي.
      const toggleClicked = event.target.closest('.map-toggle');
      const rowClicked = event.target.closest('.map-node-row');
      if (toggleClicked || rowClicked) {
        // toggle class فقط على li موجود (لا إِعادة بناء innerHTML) — هذا يُمكّن
        // transition max-height على .map-children و يَحفظ التَدَفّق و الـ delegation.
        if (mapCollapsed.has(id)) {
          mapCollapsed.delete(id);
          li.classList.remove('collapsed');
        } else {
          mapCollapsed.add(id);
          li.classList.add('collapsed');
        }
        // تَحديث علامة السهم ▼/▶ تَبَعًا للحالة.
        const toggleEl = li.querySelector(':scope > .map-node-row > .map-toggle');
        if (toggleEl) toggleEl.textContent = li.classList.contains('collapsed') ? '▶' : '▼';
        return;
      }
    }

    // نقر جهاز → عرض تَفاصيله في اللوحة الجانبية (same tab) بدل القفز لِـ tab الأَجهزة.
    if (kind === 'device') {
      // الـ API يُرجع id العقدة الجهاز بصيغة "dev-X" (map.routes.js)، لِـ ذلك نَستخرج الرقم
      // الأَصلي للجهاز من البادئة حتى يَتطابق مع devices.id في /api/devices/:id.
      const realDeviceId = (m => (m ? m[1] : id))(/^dev-(\d+)$/.exec(String(id)));
      showDeviceDetails(realDeviceId);
      return;
    }
  });

  // نقر مزدوج على موقع → اِنتقال لِـ تَبويب «الأَجهزة» مُصفّى بِـ location_id.
  // وِقاية: عقدة «أَجهزة غير مُعَيَّن» (kind='unassigned', id='unassigned') لَيست موقعًا
  // حقيقيًّا — لا يُمكن تَصفية tab الأَجهزة بِـ location_id مَنه. كان قَبل هذا الإِصلاح
  // يُطلِق حدثًا بِـ location_id='unassigned' فيَنتُج Number('unassigned')=NaN في
  // admin-devices.js و يَترك الجدول فَارِغًا بِلا رِسالة. الآن no-op (شبيه بِـ root/device).
  container.addEventListener('dblclick', (event) => {
    const li = event.target.closest('.map-node-html');
    if (!li) return;
    const kind = li.dataset.kind;
    const id = li.dataset.id;
    if (kind === 'device' || kind === 'root' || kind === 'unassigned') return;
    // نَنقر على زر التَبويب مباشرة (أَكثر متانة من showSection التي قد لا تكون مُعرّفة).
    const tabBtn = document.getElementById('tab-devices');
    if (tabBtn) tabBtn.click();
    window.dispatchEvent(new CustomEvent('map:filter-location', { detail: { location_id: id } }));
  });
}

// تَحميل + رَسم.
async function loadMap() {
  const data = await fetchTree();
  if (!data) {
    const container = document.getElementById('tree-container');
    if (container) {
      container.innerHTML = '';
      const emptyEl = document.getElementById('tree-empty');
      if (emptyEl) {
        emptyEl.style.display = 'block';
        emptyEl.textContent = '⚠️ تعذّر جلب شجرة المواقع.';
      }
    }
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
