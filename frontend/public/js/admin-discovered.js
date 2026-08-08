// admin-discovered.js (v2.5.0)
// ─────────────────────────────────────────────────────────────
// إدارة تبويب "الأَجهزة المُكتشَفة" (discovered_devices).
//   - جَلب القائمة من GET /api/discovered (مَع تَصفية source + is_approved).
//   - اعتماد/رفض/حذف فردي + اعتماد جماعي.
//   - مُزامنة مع المسح الدوري (auto-refresh كل 30 ثانية عندما التبويب ظاهر).
// ─────────────────────────────────────────────────────────────

let discoveredAutoRefreshHandle = null;

async function loadDiscovered() {
  const source = document.getElementById('discovered-filter-source')?.value || '';
  const isApproved = document.getElementById('discovered-filter-status')?.value ?? '';
  let url = '/api/discovered?limit=200';
  if (source) url += `&source=${encodeURIComponent(source)}`;
  if (isApproved !== '') url += `&is_approved=${encodeURIComponent(isApproved)}`;
  const r = await api(url);
  const tbody = document.getElementById('discovered-table-body');
  const emptyMsg = document.getElementById('discovered-empty');
  if (!r || !r.success) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="color:#b00;">⚠️ ${esc(r?.error || 'تعذّر الجلب')}</td></tr>`;
    return;
  }
  const rows = r.data || [];
  if (tbody) tbody.innerHTML = '';
  if (emptyMsg) emptyMsg.classList.toggle('hidden', rows.length > 0);
  for (const d of rows) {
    const tr = document.createElement('tr');
    const statusText = d.is_approved === 1 ? '✅ معتمد' : (d.is_approved === -1 ? '❌ مرفوض' : '⏳ بانتظار');
    tr.innerHTML = `
      <td><input type="checkbox" class="discovered-row-check" data-id="${esc(d.id)}" /></td>
      <td>${esc(d.ip)}</td>
      <td>${esc(d.mac || '—')}</td>
      <td>${esc(d.hostname || '—')}</td>
      <td>${esc(d.vendor || '—')}</td>
      <td>${esc(d.detected_type || '—')}</td>
      <td>${esc(d.source || '—')}</td>
      <td>${esc(d.last_seen_at || '—')}</td>
      <td>${esc(d.seen_count || 0)}</td>
      <td>${statusText}</td>
      <td>
        <button class="btn btn-sm btn-approve" data-id="${esc(d.id)}" title="اعتماد ونقل إلى الأجهزة">✅ اعتماد</button>
        <button class="btn btn-sm btn-reject" data-id="${esc(d.id)}" title="رفض">❌ رفض</button>
        <button class="btn btn-sm btn-delete" data-id="${esc(d.id)}" title="حذف نهائي">🗑️ حذف</button>
      </td>`;
    tbody.appendChild(tr);
  }
}

async function approveDiscovered(id) {
  const r = await api(`/api/discovered/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (r && r.success) {
    showToast(r.message || 'تم الاعتماد.', { type: 'success' });
    await loadDiscovered();
  } else {
    showToast('فشل الاعتماد: ' + (r?.error || 'خطأ غير معروف'), { type: 'error' });
  }
}

async function rejectDiscovered(id) {
  const r = await api(`/api/discovered/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (r && r.success) {
    showToast(r.message || 'تم الرفض.', { type: 'success' });
    await loadDiscovered();
  } else {
    showToast('فشل الرفض: ' + (r?.error || 'خطأ غير معروف'), { type: 'error' });
  }
}

async function deleteDiscovered(id) {
  const ok = await confirmAction({
    title: 'تَأكيد الحذف',
    message: 'هل أَنت متأَكّد من حذف هذا السجل نهائيًّا؟',
    confirmText: '🗑️ حذف',
    danger: true,
  });
  if (!ok) return;
  const r = await api(`/api/discovered/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (r && r.success) {
    showToast('✅ تَم الحذف', { type: 'success' });
    await loadDiscovered();
  } else {
    showToast('فشل الحذف: ' + (r?.error || 'خطأ غير معروف'), { type: 'error' });
  }
}

async function bulkApproveDiscovered() {
  const boxes = Array.from(document.querySelectorAll('.discovered-row-check:checked'));
  if (boxes.length === 0) {
    showToast('حدّد جهازًا واحدًا على الأقل.', { type: 'warning' });
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
    showToast('فشل الاعتماد الجماعي: ' + (r?.error || 'خطأ غير معروف'), { type: 'error' });
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
      if (btn.classList.contains('btn-approve')) approveDiscovered(id);
      else if (btn.classList.contains('btn-reject')) rejectDiscovered(id);
      else if (btn.classList.contains('btn-delete')) deleteDiscovered(id);
    });
  }
  document.getElementById('discovered-refresh-btn')?.addEventListener('click', loadDiscovered);
  document.getElementById('discovered-filter-source')?.addEventListener('change', loadDiscovered);
  document.getElementById('discovered-filter-status')?.addEventListener('change', loadDiscovered);
  document.getElementById('discovered-bulk-approve-btn')?.addEventListener('click', bulkApproveDiscovered);
  document.getElementById('discovered-select-all')?.addEventListener('change', (ev) => {
    document.querySelectorAll('.discovered-row-check').forEach((c) => { c.checked = ev.target.checked; });
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
