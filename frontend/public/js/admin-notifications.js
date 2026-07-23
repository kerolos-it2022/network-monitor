// admin-notifications.js: تحميل وحفظ إعدادات الإشعارات + عرض سجل الإشعارات عند فتح التبويب.
let currentLogsSort = 'sent_at_desc'; // متغير عام لتخزين الترتيب الحالي للسجلات

async function api(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, String.fromCharCode(38) + 'amp;')
    .replace(/</g, String.fromCharCode(38) + 'lt;')
    .replace(/>/g, String.fromCharCode(38) + 'gt;')
    .replace(/"/g, String.fromCharCode(38) + 'quot;')
    .replace(/'/g, String.fromCharCode(38) + '#39;');
}

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
  // زر مسح السجلات
  document.getElementById('logs-clear-btn').addEventListener('click', async () => {
    if (!confirm('تأكيد مسح السجلات الأقدم من الفترة المحددة؟')) return;
    const days = Number(document.getElementById('logs-clear-range').value);
    try {
      const r = await fetch(`/api/notifications/logs?older_than_days=${days}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await r.json();
      if (data.success) {
        alert(`✅ تم مسح ${data.data.deleted} سجل (أقدم من ${data.data.older_than_days} يوم)`);
        await loadNotificationLogs();
      } else {
        alert('❌ ' + (data.error || 'فشل المسح'));
      }
    } catch (e) {
      alert('❌ خطأ في الاتصال بالخادم');
    }
  });
});
