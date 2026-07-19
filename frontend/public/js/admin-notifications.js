// admin-notifications.js: تحميل وحفظ إعدادات الإشعارات + عرض سجل الإشعارات عند فتح التبويب.
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
}

async function saveNotificationSettings() {
  const statusEl = document.getElementById('ntf-status');
  statusEl.textContent = 'جارٍ الحفظ…';
  const body = {
    telegram_enabled: document.getElementById('ntf-telegram_enabled').checked,
    telegram_bot_token: document.getElementById('ntf-telegram_bot_token').value.trim(),
    telegram_chat_id: document.getElementById('ntf-telegram_chat_id').value.trim(),
    whatsapp_enabled: document.getElementById('ntf-whatsapp_enabled').checked,
    whatsapp_api_url: document.getElementById('ntf-whatsapp_api_url').value.trim(),
    whatsapp_api_token: document.getElementById('ntf-whatsapp_api_token').value.trim(),
    whatsapp_to_number: document.getElementById('ntf-whatsapp_to_number').value.trim(),
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

async function loadNotificationLogs() {
  const r = await api('/api/notifications/logs');
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '';
  if (!r.success) return;
  for (const l of r.data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(l.sent_at ? new Date(l.sent_at).toLocaleString('ar') : '-')}</td>
      <td>${esc(l.device_name || '-')}</td>
      <td>${esc(l.channel)}</td>
      <td>${esc(l.status === 'sent' ? 'تم الإرسال' : 'فشل')}</td>
      <td>${esc(l.message)}</td>
    `;
    tbody.appendChild(tr);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadNotificationSettings();
  document.getElementById('ntf-save-btn').addEventListener('click', saveNotificationSettings);
  // عند فتح تبويب السجل: تحميل السجل تلقائياً.
  document.getElementById('tab-logs').addEventListener('click', loadNotificationLogs);
});
