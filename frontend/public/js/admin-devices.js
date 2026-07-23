// admin-devices.js: إدارة الأجهزة في لوحة التحكم (جلب، إضافة، تعديل، حذف، تسجيل خروج، حماية الجلسة).
let currentDevicesSort = 'name'; // متغير عام لتخزين الترتيب الحالي للأجهزة

const ad = {}; // مساحة أسماء صغيرة لتفادي التضارب.

async function api(url, opts) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok && r.status !== 401 && r.status !== 404) {
      // محاولة قراءة رسالة الخطأ من الرد.
      try {
        const data = await r.json();
        return data || { success: false, error: 'HTTP ' + r.status };
      } catch (e) {
        return { success: false, error: 'HTTP ' + r.status };
      }
    }
    return await r.json();
  } catch (e) {
    return { success: false, error: 'تعذّر الاتصال بالخادم' };
  }
}

// أداة تهريب بسيطة (الحروف الكاملة) لكسر الـ XSS في القيم المُدرجة في innerHTML.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, String.fromCharCode(38) + 'amp;')
    .replace(/</g, String.fromCharCode(38) + 'lt;')
    .replace(/>/g, String.fromCharCode(38) + 'gt;')
    .replace(/"/g, String.fromCharCode(38) + 'quot;')
    .replace(/'/g, String.fromCharCode(38) + '#39;');
}

function statusText(status) {
  if (status === 'online') return 'متصل';
  if (status === 'offline') return 'متوقف';
  return 'غير معروف';
}

async function loadDevices() {
  const r = await api('/api/devices');
  const tbody = document.getElementById('devices-table-body');
  tbody.innerHTML = '';
  if (!r.success) return;
  
  // تطبيق الترتيب
  const sortBy = currentDevicesSort;
  const sortedData = [...r.data].sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'name':
        valA = (a.name || '').toLowerCase();
        valB = (b.name || '').toLowerCase();
        break;
      case 'ip':
        valA = a.ip || '';
        valB = b.ip || '';
        break;
      case 'status':
        valA = a.current_status || '';
        valB = b.current_status || '';
        break;
      case 'type':
        valA = (a.device_type_name || '').toLowerCase();
        valB = (b.device_type_name || '').toLowerCase();
        break;
      case 'location':
        valA = (a.location_name || '').toLowerCase();
        valB = (b.location_name || '').toLowerCase();
        break;
      case 'last_checked':
        valA = a.last_checked ? new Date(a.last_checked).getTime() : 0;
        valB = b.last_checked ? new Date(b.last_checked).getTime() : 0;
        break;
      default:
        return 0;
    }
    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
  });
  
  for (const d of sortedData) {
    // زر الفتح للأجهزة التي تدعم HTTP/HTTPS (فحص تلقائي)
    let openBtn = '';
    if (d.https_accessible == 1) {
      const url = 'https://' + d.ip + '/';
      openBtn = '<button class="btn open-device-btn" data-url="' + esc(url) + '" title="فتح الواجهة (HTTPS)">🔒 فتح HTTPS</button>';
    } else if (d.http_accessible == 1) {
      const url = 'http://' + d.ip + '/';
      openBtn = '<button class="btn open-device-btn" data-url="' + esc(url) + '" title="فتح الواجهة (HTTP)">🌐 فتح HTTP</button>';
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(d.name)}</td>
      <td>${esc(d.ip)}</td>
      <td>${esc(d.device_type_name || '-')}</td>
      <td>${esc(d.location_name || '-')}</td>
      <td>${esc(statusText(d.current_status))}</td>
      <td>
        ${openBtn}
        <button class="btn" data-edit="${d.id}" title="تعديل الجهاز">✏️ تعديل</button>
        <button class="btn btn-danger" data-del="${d.id}" title="حذف الجهاز">🗑️ حذف</button>
      </td>
    `;
    // مستمع زر الفتح
    if (openBtn) {
      tr.querySelector('.open-device-btn').addEventListener('click', function(e) {
        e.stopPropagation();
        window.open(this.dataset.url, '_blank');
      });
    }
    tr.querySelector('[data-edit]').addEventListener('click', () => startEditDevice(d.id));
    tr.querySelector('[data-del]').addEventListener('click', () => deleteDevice(d.id, d.name));
    tbody.appendChild(tr);
  }
}

async function loadFormOptions() {
  const [types, locs] = await Promise.all([
    api('/api/device-types'),
    api('/api/locations'),
  ]);
  const typeSel = document.getElementById('df-device_type_id');
  const locSel = document.getElementById('df-location_id');
  typeSel.innerHTML = '';
  locSel.innerHTML = '<option value="">— بدون —</option>';
  for (const t of types.success ? types.data : []) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    typeSel.appendChild(o);
  }
  for (const l of locs.success ? locs.data : []) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.name;
    locSel.appendChild(o);
  }
}

// إتاحة إعادة التحميل من ملف المواقع/الأنواع (يُستدعى تلقائياً بعد تغييرهما).
window.__reloadFormOptions = loadFormOptions;

function resetDeviceForm() {
  document.getElementById('device-form').reset();
  document.getElementById('device-form-id').value = '';
  document.getElementById('device-form-title').textContent = 'إضافة جهاز';
  document.getElementById('df-is_active').checked = true;
  document.getElementById('df-check_protocol').value = 'ping';
  document.getElementById('df-check_interval_seconds').value = 30;
  document.getElementById('df-failure_threshold').value = 3;
}

function openDeviceForm() {
  resetDeviceForm();
  document.getElementById('device-form').classList.remove('hidden');
}

async function startEditDevice(id) {
  const r = await api('/api/devices/' + id);
  if (!r.success) { alert(r.error || 'تعذر جلب الجهاز'); return; }
  const d = r.data;
  document.getElementById('device-form-id').value = d.id;
  document.getElementById('df-name').value = d.name;
  document.getElementById('df-ip').value = d.ip;
  document.getElementById('df-device_type_id').value = d.device_type_id;
  document.getElementById('df-location_id').value = d.location_id || '';
  document.getElementById('df-check_protocol').value = d.check_protocol;
  document.getElementById('df-port').value = d.port || '';
  document.getElementById('df-check_interval_seconds').value = d.check_interval_seconds;
  document.getElementById('df-failure_threshold').value = d.failure_threshold;
  document.getElementById('df-is_active').checked = !!d.is_active;
  document.getElementById('device-form-title').textContent = 'تعديل جهاز #' + d.id;
  document.getElementById('device-form').classList.remove('hidden');
}

async function submitDeviceForm(e) {
  e.preventDefault();
  const id = document.getElementById('device-form-id').value;
  const body = {
    name: document.getElementById('df-name').value.trim(),
    ip: document.getElementById('df-ip').value.trim(),
    device_type_id: Number(document.getElementById('df-device_type_id').value),
    location_id: document.getElementById('df-location_id').value
      ? Number(document.getElementById('df-location_id').value)
      : null,
    check_protocol: document.getElementById('df-check_protocol').value,
    port: document.getElementById('df-port').value
      ? Number(document.getElementById('df-port').value)
      : null,
    check_interval_seconds: Number(document.getElementById('df-check_interval_seconds').value),
    failure_threshold: Number(document.getElementById('df-failure_threshold').value),
    is_active: document.getElementById('df-is_active').checked ? 1 : 0,
  };

  const url = id ? '/api/devices/' + id : '/api/devices';
  const method = id ? 'PUT' : 'POST';
  const r = await api(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.success) {
    document.getElementById('device-form').classList.add('hidden');
    await loadDevices();
  } else {
    // لو الخطأ يتعلق بتكرار IP، نظهر رسالة واضحة بدلاً من alert عام.
    const errMsg = r.error || 'فشل الحفظ';
    if (errMsg.includes('IP') || errMsg.includes('مسجّل')) {
      alert('⚠️ ' + errMsg);
      // تظليل حقل IP لflutterattention المستخدم.
      const ipField = document.getElementById('df-ip');
      if (ipField) { ipField.focus(); ipField.select(); }
    } else {
      alert(errMsg);
    }
  }
}

async function deleteDevice(id, name) {
  if (!confirm('تأكيد حذف الجهاز: ' + name + '؟')) return;
  const r = await api('/api/devices/' + id, { method: 'DELETE' });
  if (r.success) {
    await loadDevices();
  } else {
    alert(r.error || 'فشل الحذف');
  }
}

async function exportDevicesExcel() {
  try {
    const r = await fetch('/api/devices/export/excel', { credentials: 'include' });
    if (!r.ok) throw new Error('فشل التصدير');
    const blob = await r.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'devices.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    alert('خطأ في التصدير: ' + e.message);
  }
}

async function importDevicesExcel(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const r = await fetch('/api/devices/import/excel', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    const data = await r.json();
    if (data.success) {
      const { imported, skipped, errors } = data.data;
      let msg = `تم الاستيراد: ${imported} جهاز، تم التخطي: ${skipped}`;
      if (errors.length) msg += '\nأخطاء:\n' + errors.join('\n');
      alert(msg);
      await loadDevices();
    } else {
      alert('فشل الاستيراد: ' + (data.error || 'خطأ غير معروف'));
    }
  } catch (e) {
    alert('خطأ في الاستيراد: ' + e.message);
  }
}

async function logoutNow() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = 'login.html';
}

// ====== تهيئة عند تحميل الصفحة ======
document.addEventListener('DOMContentLoaded', async () => {
  // التحقق من الجلسة.
  try {
    const me = await api('/api/auth/me');
    if (!me.success) { window.location.href = 'login.html'; return; }
  } catch (e) {
    window.location.href = 'login.html';
    return;
  }

  await loadFormOptions();
  await loadDevices();

  document.getElementById('add-device-btn').addEventListener('click', openDeviceForm);
  document.getElementById('device-form').addEventListener('submit', submitDeviceForm);
  document.getElementById('device-form-cancel').addEventListener('click', () => {
    document.getElementById('device-form').classList.add('hidden');
  });
  document.getElementById('logout-btn').addEventListener('click', logoutNow);

  // مستمع تغيير الترتيب للأجهزة
  const sortDevicesEl = document.getElementById('filter-sort-devices');
  if (sortDevicesEl) {
    sortDevicesEl.addEventListener('change', (e) => {
      currentDevicesSort = e.target.value;
      loadDevices();
    });
  }

  // تحديث placeholder حقل المنفذ حسب البروتوكول المختار
  const protoSel = document.getElementById('df-check_protocol');
  const portInput = document.getElementById('df-port');
  function updatePortPlaceholder() {
    const proto = protoSel.value;
    if (proto === 'http') {
      portInput.placeholder = '80';
      portInput.title = 'منفذ HTTP (افتراضي 80)';
    } else if (proto === 'https') {
      portInput.placeholder = '443';
      portInput.title = 'منفذ HTTPS (افتراضي 443)';
    } else if (proto === 'port') {
      portInput.placeholder = 'مثلاً 8080';
      portInput.title = 'منفذ TCP';
    } else {
      portInput.placeholder = '';
      portInput.title = '';
    }
  }
  protoSel.addEventListener('change', updatePortPlaceholder);
  // تطبيق البداية
  updatePortPlaceholder();

  // تصدير/استيراد
  document.getElementById('export-devices-btn').addEventListener('click', exportDevicesExcel);
  document.getElementById('import-devices-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importDevicesExcel(e.target.files[0]);
    e.target.value = ''; // السماح بإعادة نفس الملف
  });

  // مستمع dropdown الترتيب
  const sortSel = document.getElementById('filter-sort-devices');
  if (sortSel) {
    sortSel.addEventListener('change', (e) => {
      currentDevicesSort = e.target.value;
      loadDevices();
    });
  }
});
