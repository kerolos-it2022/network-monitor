// admin-notifications.js: تحميل وحفظ إعدادات الإشعارات + عرض سجل الإشعارات عند فتح التبويب.
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
let currentLogsSort = 'sent_at_desc'; // متغير عام لتخزين الترتيب الحالي للسجلات

async function loadNotificationSettings() {
  const r = await api('/api/notifications/settings');
  if (!r.success) return;
  const d = r.data;
  document.getElementById('ntf-telegram_enabled').checked = !!d.telegram_enabled;
  // نعرض المفتاح المقنّع فقط كـ placeholder؛ المستخدم يمكنه إدخال قيمة جديدة.
  document.getElementById('ntf-telegram_bot_token').placeholder = d.telegram_bot_token || 'غير مضبوط';
  document.getElementById('ntf-telegram_bot_token').value = '';
  document.getElementById('ntf-telegram_chat_id').value = d.telegram_chat_id || '';
  document.getElementById('ntf-whatsapp_enabled').checked = !!d.whatsapp_enabled;
  document.getElementById('ntf-whatsapp_api_url').value = d.whatsapp_api_url || '';
  document.getElementById('ntf-whatsapp_api_token').placeholder = d.whatsapp_api_token || 'غير مضبوط';
  document.getElementById('ntf-whatsapp_api_token').value = '';
  document.getElementById('ntf-whatsapp_to_number').value = d.whatsapp_to_number || '';
  // إعدادات الموبايل/FCM
  document.getElementById('ntf-mobile_enabled').checked = !!d.mobile_enabled;
  document.getElementById('ntf-fcm_server_key').placeholder = d.fcm_server_key || 'غير مضبوط';
  document.getElementById('ntf-fcm_server_key').value = '';
}

async function saveNotificationSettings() {
  const statusEl = document.getElementById('ntf-status');
  statusEl.style.color = 'var(--online)';
  statusEl.textContent = 'جارٍ الحفظ…';
  const body = {
    telegram_enabled: document.getElementById('ntf-telegram_enabled').checked,
    telegram_bot_token: document.getElementById('ntf-telegram_bot_token').value.trim(),
    telegram_chat_id: document.getElementById('ntf-telegram_chat_id').value.trim(),
    whatsapp_enabled: document.getElementById('ntf-whatsapp_enabled').checked,
    whatsapp_api_url: document.getElementById('ntf-whatsapp_api_url').value.trim(),
    whatsapp_api_token: document.getElementById('ntf-whatsapp_api_token').value.trim(),
    whatsapp_to_number: document.getElementById('ntf-whatsapp_to_number').value.trim(),
    mobile_enabled: document.getElementById('ntf-mobile_enabled').checked,
    fcm_server_key: document.getElementById('ntf-fcm_server_key').value.trim(),
  };
  const r = await api('/api/notifications/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.success) {
    statusEl.textContent = '✅ تم الحفظ';
    await loadNotificationSettings();
  } else {
    statusEl.style.color = 'var(--offline)';
    statusEl.textContent = '❌ ' + (r.error || 'فشل الحفظ');
  }
}

// إرسال إشعار تجريبي للتسجيلات النشطة
async function testNotification() {
  const statusEl = document.getElementById('ntf-status');
  statusEl.style.color = 'var(--online)';
  statusEl.textContent = '🔔 جارٍ إرسال إشعار تجريبي…';
  try {
    const r = await fetch('/api/notifications/test', {
      method: 'POST',
      credentials: 'include',
    });
    const data = await r.json();
    if (data.success) {
      statusEl.textContent = '✅ تم الإرسال (افتح هاتفك للتأكد)';
    } else {
      statusEl.style.color = 'var(--offline)';
      statusEl.textContent = '❌ ' + (data.error || 'فشل الإرسال — تأكد من FCM Key و وجود تسجيلات نشطة');
    }
  } catch (e) {
    statusEl.style.color = 'var(--offline)';
    statusEl.textContent = '❌ خطأ في الاتصال بالخادم';
  }
}

async function loadNotificationLogs() {
  const r = await api('/api/notifications/logs');
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '';
  if (!r.success) return;
  
  // تطبيق الترتيب
  const sortBy = currentLogsSort;
  const sortedData = [...r.data].sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'sent_at_desc':
        valA = a.sent_at ? new Date(a.sent_at).getTime() : 0;
        valB = b.sent_at ? new Date(b.sent_at).getTime() : 0;
        return valB - valA; // الأحدث أولاً
      case 'sent_at_asc':
        valA = a.sent_at ? new Date(a.sent_at).getTime() : 0;
        valB = b.sent_at ? new Date(b.sent_at).getTime() : 0;
        return valA - valB; // الأقدم أولاً
      case 'device_name':
        valA = (a.device_name || '').toLowerCase();
        valB = (b.device_name || '').toLowerCase();
        break;
      case 'channel':
        valA = (a.channel || '').toLowerCase();
        valB = (b.channel || '').toLowerCase();
        break;
      case 'status':
        valA = (a.status || '').toLowerCase();
        valB = (b.status || '').toLowerCase();
        break;
      default:
        return 0;
    }
    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
  });
  
  const channelText = (c) => {
    if (c === 'telegram') return 'تلجرام';
    if (c === 'whatsapp') return 'واتساب';
    if (c === 'mobile') return 'هاتف (PWA)';
    return c;
  };
  for (const l of sortedData) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(l.sent_at ? new Date(l.sent_at).toLocaleString('ar') : '-')}</td>
      <td>${esc(l.device_name || '-')}</td>
      <td>${esc(channelText(l.channel))}</td>
      <td>${esc(l.status === 'sent' ? 'تم الإرسال' : 'فشل')}</td>
      <td>${esc(l.message)}</td>
    `;
    tbody.appendChild(tr);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadNotificationSettings();
  document.getElementById('ntf-save-btn').addEventListener('click', saveNotificationSettings);
  const testBtn = document.getElementById('ntf-test-btn');
  if (testBtn) testBtn.addEventListener('click', testNotification);
  // عند فتح تبويب السجل: تحميل السجل تلقائياً.
  document.getElementById('tab-logs').addEventListener('click', loadNotificationLogs);
  // مستمع تغيير الترتيب للسجل
  const sortLogsEl = document.getElementById('filter-sort-logs');
  if (sortLogsEl) {
    sortLogsEl.addEventListener('change', (e) => {
      currentLogsSort = e.target.value;
      loadNotificationLogs();
    });
  }
  // v2.7.0 (PF) — زرّ موحّد "مسح السجل" — يَفتح popup اختِيار (نوع + مُدّة).
  // نوع: notifications (DELETE /api/notifications/logs) | downtime (POST /api/devices/cleanup-history).
  const logsClearBtn = document.getElementById('logs-clear-btn');
  const cleanupModal = document.getElementById('cleanup-select-modal');
  const cleanupTypeSel = document.getElementById('cleanup-type-select');
  const cleanupRangeSel = document.getElementById('cleanup-range-select');
  const cleanupOkBtn = document.getElementById('cleanup-select-ok-btn');
  const cleanupCancelBtn = document.getElementById('cleanup-select-cancel-btn');

  function closeCleanupModal() {
    if (!cleanupModal) return;
    cleanupModal.classList.add('hidden');
    cleanupModal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', cleanupOnKey);
    if (cleanupModal) cleanupModal.removeEventListener('click', cleanupOnBackdrop);
  }
  function cleanupOnKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeCleanupModal(); }
  }
  function cleanupOnBackdrop(e) { if (e.target === cleanupModal) closeCleanupModal(); }

  if (logsClearBtn) logsClearBtn.addEventListener('click', () => {
    if (!cleanupModal) return;
    cleanupModal.classList.remove('hidden');
    cleanupModal.setAttribute('aria-hidden', 'false');
    if (cleanupRangeSel) cleanupRangeSel.value = 'week';
    if (cleanupTypeSel) cleanupTypeSel.value = 'notifications';
    if (cleanupOkBtn) cleanupOkBtn.focus();
    document.addEventListener('keydown', cleanupOnKey);
    cleanupModal.addEventListener('click', cleanupOnBackdrop);
  });
  if (cleanupCancelBtn) cleanupCancelBtn.addEventListener('click', closeCleanupModal);

  // تَنفيذ المَسح بعد الاختيار.
  if (cleanupOkBtn) cleanupOkBtn.addEventListener('click', async () => {
    const type = cleanupTypeSel ? cleanupTypeSel.value : 'notifications';
    const range = cleanupRangeSel ? cleanupRangeSel.value : 'week';
    // تَأكيد ثاني عبر confirmAction لِـ أَنّ المَسح لا يُمكن التَراجُع عنه.
    const days = range === 'week' ? 7 : (range === 'month' ? 30 : 365);
    const typeLabel = type === 'downtime' ? 'سجل الانقطاعات' : 'سجل الإِشعارات';
    const ok = await confirmAction({
      title: 'تَأكيد مَسح ' + typeLabel,
      message: `سيتم مَسح ${typeLabel} الأَقدم من ${days} يوم.\nلا يمكن التَراجُع عن هذا الإِجراء. مُتابعة؟`,
      confirmText: '🗑️ مَسح',
      danger: true,
    });
    if (!ok) return;

    try {
      let data;
      if (type === 'downtime') {
        // downtime: POST /api/devices/cleanup-history { range }
        const r = await api('/api/devices/cleanup-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ range }),
        });
        data = r;
      } else {
        // notifications: DELETE /api/notifications/logs?older_than_days={days}
        const r = await fetch(`/api/notifications/logs?older_than_days=${days}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        data = await r.json();
      }
      if (data && data.success) {
        const deleted = data.data && data.data.deleted != null ? data.data.deleted : 0;
        showToast(`✅ تَم مَسح ${deleted} سجل (${typeLabel} — أَقدم من ${days} يوم)`, { type: 'success' });
        closeCleanupModal();
        // تَحديث جدول السجل لو كان مُحمَّلاً (notifications).
        if (type === 'notifications' && typeof loadNotificationLogs === 'function') {
          await loadNotificationLogs();
        }
      } else {
        showToast('❌ ' + ((data && data.error) || 'فشل المَسح'), { type: 'error' });
      }
    } catch (e) {
      showToast('❌ خطأ في الاتصال بالخادم', { type: 'error' });
    }
  });
});
