// admin-discovered.js — إدارة تبويب "الأجهزة المُكتشَفة" (discovered_devices).
//   - جَلب القائمة من GET /api/discovered (تصفية source + is_approved + بحث + فرز + ترقيم).
//   - اعتماد/رفض/حذف فردي + اعتماد جماعي، ونافذة «اعتماد كامل» (نوع/موقع/فحص) مع «⚡ اعتماد سريع».
//   - مُزامنة مع المسح الدوري (auto-refresh كل 30 ثانية عندما التبويب ظاهر).
// v2.11.7: بحث على الخادم + فرز بالنقر على الرأس + ترقيم 50/صفحة + نافذة الاعتماد الكاملة.

let discoveredAutoRefreshHandle = null;
const discoveredView = { q: '', sort: 'last_seen_at', order: 'desc', offset: 0, limit: 50, total: 0 };
let discoveredApproveId = null;
let discoveredApproveDetected = '';
let discoveredFormData = null;

async function loadDiscovered() {
  const source = document.getElementById('discovered-filter-source')?.value || '';
  const isApproved = document.getElementById('discovered-filter-status')?.value ?? '';
  let url = `/api/discovered?limit=${discoveredView.limit}&offset=${discoveredView.offset}` +
    `&sort=${encodeURIComponent(discoveredView.sort)}&order=${encodeURIComponent(discoveredView.order)}`;
  if (source) url += `&source=${encodeURIComponent(source)}`;
  if (isApproved !== '') url += `&is_approved=${encodeURIComponent(isApproved)}`;
  if (discoveredView.q) url += `&q=${encodeURIComponent(discoveredView.q)}`;

  const r = await api(url);
  if (Number(r && r.total) >= 0) updateDiscoveredBadge();
  const tbody = document.getElementById('discovered-table-body');
  const emptyMsg = document.getElementById('discovered-empty');
  if (!r || !r.success) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="color:#b00;">⚠️ ${esc((r && r.error) || 'تعذّر الجلب')}</td></tr>`;
    updateDiscoveredPager(0);
    return;
  }
  const rows = r.data || [];
  // توافق رجعي: خادم أقدم لا يُرسل total ⇒ نعتمد عدد الصفوف.
  discoveredView.total = (typeof r.total === 'number') ? r.total : rows.length;

  if (tbody) tbody.innerHTML = '';
  if (emptyMsg) emptyMsg.classList.toggle('hidden', rows.length > 0);
  for (const d of rows) {
    const tr = document.createElement('tr');
    const statusText = d.is_approved === 1 ? T('tail.approved_2', '✅ معتمد') : (d.is_approved === -1 ? T('tail.rejected_2', '❌ مرفوض') : T('tail.pending', '⏳ بانتظار'));
    tr.innerHTML = `
      <td class="col-center"><input type="checkbox" class="discovered-row-check" data-id="${esc(d.id)}" /></td>
      <td class="col-ltr">${esc(d.ip)}</td>
      <td class="col-ltr">${esc(d.mac || '—')}</td>
      <td>${esc(d.hostname || '—')}</td>
      <td>${esc(d.vendor || '—')}</td>
      <td>${esc(d.detected_type || '—')}</td>
      <td class="col-center">${esc(d.source || '—')}</td>
      <td class="col-ltr">${esc(d.last_seen_at ? NMFormat.dateTime(d.last_seen_at) : '—')}</td>
      <td class="col-center">${esc(d.seen_count || 0)}</td>
      <td class="col-status">${statusText}</td>
      <td class="col-actions">
        <button class="btn btn-sm btn-approve" data-id="${esc(d.id)}" data-detected="${esc(d.detected_type || '')}" title="اعتماد ونقل إلى الأجهزة (مع اختيار النوع/الموقع)">✅ اعتماد</button>
        <button class="btn btn-sm btn-reject" data-id="${esc(d.id)}" title="رفض">❌ رفض</button>
        <button class="btn btn-sm btn-delete" data-id="${esc(d.id)}" title="حذف نهائي">${T('common.delete', '🗑️ حذف')}</button>
      </td>`;
    tbody.appendChild(tr);
  }
  updateDiscoveredPager(rows.length);
}

function updateDiscoveredPager(shownRows) {
  const info = document.getElementById('discovered-page-info');
  const prev = document.getElementById('discovered-prev-btn');
  const next = document.getElementById('discovered-next-btn');
  const limit = discoveredView.limit;
  const from = discoveredView.total === 0 ? 0 : discoveredView.offset + 1;
  const to = Math.min(discoveredView.offset + (typeof shownRows === 'number' ? shownRows : limit), discoveredView.total);
  if (info) info.textContent = `${from}–${to} من ${discoveredView.total}`;
  if (prev) prev.disabled = discoveredView.offset <= 0;
  if (next) next.disabled = (discoveredView.offset + limit) >= discoveredView.total;
}

// ── v2.11.7 — نافذة «الاعتماد الكامل» (3.1) ─────────────────────────────
function ensureApproveModal() {
  let el = document.getElementById('discovered-approve-modal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'discovered-approve-modal';
  el.className = 'modal hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="modal-content">
      <button type="button" class="modal-close" id="dsc-close" aria-label="إغلاق" title="إلغاء">✕</button>
      <h3>✅ اعتماد جهاز مُكتشَف</h3>
      <p style="color:var(--muted); font-size:0.85rem;">الجهاز: <b id="dsc-ip"></b> <span id="dsc-meta"></span></p>
      <div class="form-grid">
        <label>${T('s2.name', 'الاسم')} <input type="text" id="dsc-name" /></label>
        <label>${T('s2.type', 'النوع')} <select id="dsc-type"><option value="">${T('device.field.noLocation', '— بدون —')}</option></select></label>
        <label>${T('devices.th.location', 'الموقع')} <select id="dsc-loc"><option value="">${T('device.field.noLocation', '— بدون —')}</option></select></label>
        <label>${T('device.field.protocol', 'طريقة الفحص')}
          <select id="dsc-proto">
            <option value="ping">Ping</option>
            <option value="port">Port (TCP)</option>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </label>
        <label>المنفذ (للفحص) <input type="number" id="dsc-port" min="1" max="65535" placeholder="443" /></label>
        <label>منفذ الواجهة (web_port) <input type="number" id="dsc-webport" min="1" max="65535" placeholder="443" /></label>
      </div>
      <div style="display:flex; gap:0.5rem; justify-content:flex-end; margin-top:1rem; flex-wrap:wrap;">
        <button type="button" class="btn" id="dsc-quick" title="اعتماد فوري بالسلوك الافتراضي (بلا تفاصيل)">⚡ اعتماد سريع</button>
        <button type="button" class="btn btn-primary" id="dsc-ok">✅ اعتماد بالتفاصيل</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#dsc-close').addEventListener('click', () => closeEditModal(el));
  el.querySelector('#dsc-quick').addEventListener('click', () => submitApprove(true));
  el.querySelector('#dsc-ok').addEventListener('click', () => submitApprove(false));
  el.addEventListener('click', (e) => { if (e.target === el) closeEditModal(el); });
  return el;
}

async function loadDiscoveredFormData() {
  if (discoveredFormData) return discoveredFormData;
  try {
    const r = await api('/api/scan/types');
    discoveredFormData = (r && r.success) ? r.data : { types: [], locations: [] };
  } catch (e) {
    discoveredFormData = { types: [], locations: [] };
  }
  return discoveredFormData;
}

// مطابقة اسم نوع مع detected_type (تطابق كامل أو احتواء — بلا حساسية لحالة الأحرف).
function detectedLowerMatch(typeName, detected) {
  const a = String(typeName || '').toLowerCase().trim();
  const b = String(detected || '').toLowerCase().trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function openApproveModal(id, detectedType) {
  const el = ensureApproveModal();
  discoveredApproveDetected = detectedType || '';
  let row = null;
  try {
    const r = await api('/api/discovered/' + encodeURIComponent(id));
    row = (r && r.success) ? r.data : null;
  } catch (e) { /* fallback: تُعرض النافذة بقيم افتراضية */ }
  if (!row) {
    showToast(T('s2j.could_not_fetch_the_log_details_try_quick_ap', 'تعذّر جلب تفاصيل السجل — جرّب «⚡ اعتماد سريع» من القائمة.'), { type: 'error' });
    return;
  }
  discoveredApproveId = id;

  const data = await loadDiscoveredFormData();
  const typeSel = el.querySelector('#dsc-type');
  const locSel = el.querySelector('#dsc-loc');
  typeSel.innerHTML = '<option value="">— بدون —</option>';
  (data.types || []).forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    typeSel.appendChild(o);
  });
  locSel.innerHTML = '<option value="">— بدون —</option>';
  (data.locations || []).forEach((l) => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.name;
    locSel.appendChild(o);
  });

  // تعبئة مسبقة من بيانات الكشف (الاسم/النوع/الصانع)
  el.querySelector('#dsc-ip').textContent = row.ip || '';
  el.querySelector('#dsc-meta').textContent = [row.vendor, row.detected_type, row.last_seen_at].filter(Boolean).join(' · ');
  el.querySelector('#dsc-name').value = row.hostname || row.vendor || (T('s2x.device', 'جهاز') + ' ' + (row.ip || ''));
  if (row.detected_type) {
    const match = Array.from(typeSel.options).find((o) => o.textContent.toLowerCase() === String(row.detected_type).toLowerCase());
    if (match) typeSel.value = match.value;
  }
  el.querySelector('#dsc-port').value = '';
  el.querySelector('#dsc-webport').value = '';
  el.querySelector('#dsc-proto').value = 'ping';

  openEditModal(el, { focusSelector: '#dsc-name', onClose: () => { discoveredApproveId = null; } });
}

async function submitApprove(quick) {
  const id = discoveredApproveId;
  if (!id) return;
  const el = document.getElementById('discovered-approve-modal');
  let body = {};
  if (quick) {
    // v2.11.7 — «الاعتماد السريع» يُرسل نوعًا مشتقًّا من detected_type إن أمكن
    // (devices.device_type_id إلزامي — بدونه كان الاعتماد يفشل بـ500).
    const data = await loadDiscoveredFormData();
    const match = (data.types || []).find((t) => detectedLowerMatch(t.name, discoveredApproveDetected));
    if (match) body.device_type_id = match.id;
  } else {
    const protocol = (el.querySelector('#dsc-proto').value || 'ping');
    const portRaw = el.querySelector('#dsc-port').value;
    const webRaw = el.querySelector('#dsc-webport').value;
    const port = portRaw ? Number(portRaw) : null;
    const webPort = webRaw ? Number(webRaw) : null;
    if (protocol !== 'ping' && !port) {
      showToast(T('s2j.enter_the_port_for_the_selected_check_method', 'حدّد المنفذ لطريقة الفحص المختارة.'), { type: 'warning' });
      return;
    }
    body = {
      name: el.querySelector('#dsc-name').value.trim(),
      device_type_id: el.querySelector('#dsc-type').value || null,
      location_id: el.querySelector('#dsc-loc').value || null,
      check_protocol: protocol,
      port: protocol === 'ping' ? null : port,
      web_port: (protocol === 'http' || protocol === 'https') ? (webPort || port) : webPort,
    };
  }
  const r = await api('/api/discovered/' + encodeURIComponent(id) + '/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r && r.success) {
    showToast(r.message || T('tail.approved', 'تم الاعتماد.'), { type: 'success' });
    closeEditModal(el);
    await loadDiscovered();
    if (typeof window.loadDevices === 'function') await window.loadDevices();
  } else {
    showToast(T('s2j.approval_failed', 'فشل الاعتماد:') + ' ' + ((r && r.error) || T('tail.unknown_error', 'خطأ غير معروف')), { type: 'error' });
  }
}

async function rejectDiscovered(id) {
  const r = await api(`/api/discovered/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (r && r.success) {
    showToast(r.message || T('tail.rejected', 'تم الرفض.'), { type: 'success' });
    await loadDiscovered();
  } else {
    showToast(T('s2j.rejection_failed', 'فشل الرفض:') + ' ' + ((r && r.error) || 'خطأ غير معروف'), { type: 'error' });
  }
}

async function deleteDiscovered(id) {
  const ok = await confirmAction({
    title: T('s2j.confirm_deletion', 'تَأكيد الحذف'),
    message: T('s2j.delete_this_record_permanently', 'هل أَنت متأَكّد من حذف هذا السجل نهائيًّا؟'),
    confirmText: T('common.delete', '🗑️ حذف'),
    danger: true,
  });
  if (!ok) return;
  const r = await api(`/api/discovered/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (r && r.success) {
    showToast(T('s2j.deleted', '✅ تَم الحذف'), { type: 'success' });
    await loadDiscovered();
  } else {
    showToast(T('s2j.delete_failed', 'فشل الحذف:') + ' ' + ((r && r.error) || 'خطأ غير معروف'), { type: 'error' });
  }
}

async function bulkApproveDiscovered() {
  const boxes = Array.from(document.querySelectorAll('.discovered-row-check:checked'));
  if (boxes.length === 0) {
    showToast(T('s2j.select_at_least_one_device', 'حدّد جهازًا واحدًا على الأقل.'), { type: 'warning' });
    return;
  }
  const ids = boxes.map((b) => parseInt(b.getAttribute('data-id'), 10)).filter(Boolean);
  if (!ids.length) return;
  const r = await api('/api/discovered/bulk/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (r && r.success) {
    showToast(r.message || 'تم الاعتماد.', { type: 'success' });
    await loadDiscovered();
  } else {
    showToast(T('s2j.bulk_approval_failed', 'فشل الاعتماد الجماعي:') + ' ' + ((r && r.error) || 'خطأ غير معروف'), { type: 'error' });
  }
}

// bind events once on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('discovered-table-body');
  if (tbody) {
    tbody.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (btn.classList.contains('btn-approve')) openApproveModal(id, btn.getAttribute('data-detected') || '');
      else if (btn.classList.contains('btn-reject')) rejectDiscovered(id);
      else if (btn.classList.contains('btn-delete')) deleteDiscovered(id);
    });
  }
  document.getElementById('discovered-refresh-btn')?.addEventListener('click', loadDiscovered);
  document.getElementById('discovered-filter-source')?.addEventListener('change', () => {
    discoveredView.offset = 0;
    loadDiscovered();
  });
  document.getElementById('discovered-filter-status')?.addEventListener('change', () => {
    discoveredView.offset = 0;
    loadDiscovered();
  });
  document.getElementById('discovered-bulk-approve-btn')?.addEventListener('click', bulkApproveDiscovered);
  document.getElementById('discovered-select-all')?.addEventListener('change', (ev) => {
    document.querySelectorAll('.discovered-row-check').forEach((c) => { c.checked = ev.target.checked; });
  });

  // v2.11.7 — بحث (مع تأجيل) + ترقيم (3.2)
  const searchBox = document.getElementById('discovered-search');
  if (searchBox) {
    let t = null;
    searchBox.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        discoveredView.q = searchBox.value.trim();
        discoveredView.offset = 0;
        loadDiscovered();
      }, 350);
    });
  }
  document.getElementById('discovered-prev-btn')?.addEventListener('click', () => {
    discoveredView.offset = Math.max(0, discoveredView.offset - discoveredView.limit);
    loadDiscovered();
  });
  document.getElementById('discovered-next-btn')?.addEventListener('click', () => {
    discoveredView.offset = discoveredView.offset + discoveredView.limit;
    loadDiscovered();
  });

  // فرز بالنقر على رأس العمود
  document.querySelectorAll('#section-discovered th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (discoveredView.sort === key) {
        discoveredView.order = discoveredView.order === 'asc' ? 'desc' : 'asc';
      } else {
        discoveredView.sort = key;
        discoveredView.order = 'asc';
      }
      document.querySelectorAll('#section-discovered th.sortable').forEach((t) => {
        const base = t.getAttribute('data-label') || t.textContent.replace(/[↕▲▼]/g, '').trim();
        t.textContent = base + (t === th ? (discoveredView.order === 'asc' ? ' ▲' : ' ▼') : ' ↕');
      });
      discoveredView.offset = 0;
      loadDiscovered();
    });
  });

  // start auto-refresh when tab shown, stop otherwise
  const observer = new MutationObserver(() => {
    const section = document.getElementById('section-discovered');
    if (!section) return;
    const visible = !section.classList.contains('hidden');
    if (visible) {
      loadDiscovered().catch(() => {});
      if (!discoveredAutoRefreshHandle) {
        discoveredAutoRefreshHandle = setInterval(() => loadDiscovered().catch(() => {}), 30000);
      }
    } else {
      if (discoveredAutoRefreshHandle) {
        clearInterval(discoveredAutoRefreshHandle);
        discoveredAutoRefreshHandle = null;
      }
    }
  });
  const s = document.getElementById('section-discovered');
  if (s) observer.observe(s, { attributes: true, attributeFilter: ['class'] });
});

// ═══ v2.27.0 — شارة «بانتظار اعتمادك» على تبويب الأجهزة المكتشفة ═══
async function updateDiscoveredBadge() {
  try {
    const r = await api('/api/discovered?is_approved=0&limit=1');
    const total = r && r.success ? Number(r.total || 0) : 0;
    const badge = (document.getElementById('seg-disc-count') || document.getElementById('disc-tab-badge'));
    if (!badge) return;
    if (total > 0) { badge.textContent = String(total); badge.style.display = 'inline-block'; }
    else badge.style.display = 'none';
  } catch (e) { /* صامت */ }
}
document.addEventListener('DOMContentLoaded', updateDiscoveredBadge);
