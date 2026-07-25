// admin-discovery.js: منطق اكتشاف الأجهزة في لوحة التحكم.
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
let discoveryAbortController = null;

// ========== CIDR History Management (localStorage) ==========
const CIDR_HISTORY_KEY = 'network_monitor_cidr_history';
const CIDR_LAST_USED_KEY = 'network_monitor_cidr_last_used';
const MAX_HISTORY = 10;

function loadCidrHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(CIDR_HISTORY_KEY) || '[]');
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function getLastUsedCidr() {
  try {
    return localStorage.getItem(CIDR_LAST_USED_KEY) || '';
  } catch {
    return '';
  }
}

function saveLastUsedCidr(cidr) {
  if (!cidr) return;
  try {
    localStorage.setItem(CIDR_LAST_USED_KEY, cidr);
  } catch (e) {
    console.warn('Failed to save last used CIDR:', e);
  }
}

function saveCidrToHistory(cidr) {
  if (!cidr) return;
  const history = loadCidrHistory();
  // Remove if already exists
  const filtered = history.filter(item => item !== cidr);
  // Add to beginning
  filtered.unshift(cidr);
  // Limit size
  const limited = filtered.slice(0, MAX_HISTORY);
  localStorage.setItem(CIDR_HISTORY_KEY, JSON.stringify(limited));
  // Also save as last used
  saveLastUsedCidr(cidr);
  updateCidrDatalist();
}

function updateCidrDatalist() {
  const datalist = document.getElementById('cidr-history');
  if (!datalist) return;
  
  const history = loadCidrHistory();
  datalist.innerHTML = '';
  
  history.forEach(cidr => {
    const option = document.createElement('option');
    option.value = cidr;
    datalist.appendChild(option);
  });
}

// Add default CIDR options if no history
function initCidrDatalist() {
  const datalist = document.getElementById('cidr-history');
  const input = document.getElementById('discovery-cidr');
  if (!datalist || !input) return;
  
  const history = loadCidrHistory();
  // If no history, populate with defaults
  if (history.length === 0) {
    const defaults = ['192.168.1.0/24', '192.168.0.0/24', '10.0.0.0/24', '172.16.0.0/24'];
    defaults.forEach(cidr => {
      const option = document.createElement('option');
      option.value = cidr;
      datalist.appendChild(option);
    });
  } else {
    updateCidrDatalist();
  }
  
  // Restore last used CIDR as the input value
  const lastUsed = getLastUsedCidr();
  if (lastUsed) {
    input.value = lastUsed;
  }
}

function formatPorts(ports) {
  if (!ports || ports.length === 0) return '<span style="color:var(--muted);">—</span>';
  return ports.map(p => '<span style="background:var(--bg); padding:0.15rem 0.4rem; border-radius:4px; font-size:0.75rem;">' + p.port + '/' + p.service + '</span>').join(' ');
}

function renderDiscoveryTable(devices) {
  const tbody = document.getElementById('discovery-table-body');
  tbody.innerHTML = '';
  
  for (const d of devices) {
    const tr = document.createElement('tr');
    const existingBadge = d.existsInDB 
      ? '<span style="background:var(--warning); color:#000; padding:0.1rem 0.4rem; border-radius:4px; font-size:0.7rem;">موجود في قاعدة البيانات</span>'
      : '<span style="background:var(--online); color:#fff; padding:0.1rem 0.4rem; border-radius:4px; font-size:0.7rem;">جديد</span>';
    
    tr.innerHTML = `
      <td><input type="checkbox" class="discovery-checkbox" data-ip="${esc(d.ip)}" ${d.existsInDB ? 'disabled' : ''} /></td>
      <td>${esc(d.ip)}</td>
      <td>
        <input type="text" class="discovery-name-input" value="${esc(d.suggestedName)}" style="width:100%; padding:0.3rem; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);" />
      </td>
      <td>
        <select class="discovery-type-select" style="width:100%; padding:0.3rem; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);">
          <option value="">— اختر النوع —</option>
        </select>
      </td>
      <td>${esc(d.macVendor)} ${d.mac ? '<br><small style="color:var(--muted);">' + esc(d.mac) + '</small>' : ''}</td>
      <td>${formatPorts(d.openPorts)}</td>
      <td>${d.snmpInfo ? '<small>' + esc(d.snmpInfo.sysDescr || d.snmpInfo.sysName || 'متاح') + '</small>' : '<span style="color:var(--muted);">—</span>'}</td>
      <td>${d.responseTime ? esc(d.responseTime.toFixed(2)) + ' ms' : '—'}</td>
    `;
    tbody.appendChild(tr);
    
    // تعبئة قائمة الأنواع
    const typeSelect = tr.querySelector('.discovery-type-select');
    if (window.discoveryTypes) {
      for (const t of window.discoveryTypes) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        if (t.name.toLowerCase() === d.deviceType.toLowerCase()) opt.selected = true;
        typeSelect.appendChild(opt);
      }
    }
    
    // تعطيل الصف إذا كان موجود في قاعدة البيانات
    if (d.existsInDB) {
      tr.style.opacity = '0.6';
      tr.style.background = 'var(--bg)';
    }
  }
  
  updateSelectionButtons();
}

function updateSelectionButtons() {
  const checkboxes = document.querySelectorAll('.discovery-checkbox:not(:disabled)');
  const checked = document.querySelectorAll('.discovery-checkbox:checked');
  const addBtn = document.getElementById('discovery-add-selected-btn');
  const selectAllCheckbox = document.getElementById('discovery-select-all-checkbox');
  
  if (addBtn) addBtn.disabled = checked.length === 0;
  if (selectAllCheckbox) selectAllCheckbox.indeterminate = checked.length > 0 && checked.length < checkboxes.length;
  if (selectAllCheckbox) selectAllCheckbox.checked = checked.length > 0 && checked.length === checkboxes.length;
  
  const countEl = document.getElementById('discovery-count');
  if (countEl) countEl.textContent = checked.length + ' محددة من ' + checkboxes.length + ' متاحة';
}

async function loadTypesAndLocations() {
  const r = await api('/api/scan/types');
  if (r.success) {
    window.discoveryTypes = r.data.types;
    window.discoveryLocations = r.data.locations;
  }
}

async function startDiscovery() {
  const cidr = document.getElementById('discovery-cidr').value.trim();
  const scanPorts = document.getElementById('discovery-scan-ports').checked;
  const scanSNMP = document.getElementById('discovery-scan-snmp').checked;
  const snmpCommunity = document.getElementById('discovery-snmp-community').value.trim() || 'public';
  
  if (!cidr) {
    alert('الرجاء إدخال نطاق الشبكة (CIDR)');
    return;
  }
  
  // Save CIDR to history when starting scan
  saveCidrToHistory(cidr);
  
  // إخفاء النتائج السابقة
  document.getElementById('discovery-results').classList.add('hidden');
  document.getElementById('discovery-error').classList.add('hidden');
  document.getElementById('discovery-error').textContent = '';
  
  // إظهار شريط التقدم
  document.getElementById('discovery-progress').classList.remove('hidden');
  document.getElementById('discovery-progress-text').textContent = 'جاري بدء المسح...';
  document.getElementById('discovery-progress-count').textContent = '';
  
  const startBtn = document.getElementById('discovery-start-btn');
  startBtn.disabled = true;
  startBtn.textContent = '⏳ جاري المسح...';
  
  try {
    const r = await api('/api/scan/subnet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidr, scanPorts, scanSNMP, snmpCommunity })
    });
    
    if (!r.success) {
      throw new Error(r.error || 'فشل بدء المسح');
    }
    
    // استخدام SSE للتقدم المباشر
    const scanId = r.data.scanId;
    connectSSE(scanId);
    
  } catch (e) {
    showError(e.message);
    resetStartButton();
  }
}

function connectSSE(scanId) {
  const eventSource = new EventSource('/api/scan/stream/' + scanId);
  
  eventSource.addEventListener('start', (e) => {
    document.getElementById('discovery-progress-text').textContent = e.data;
  });
  
  eventSource.addEventListener('line', (e) => {
    const line = JSON.parse(e.data);
    document.getElementById('discovery-progress-text').textContent = line;
    document.getElementById('discovery-progress-count').textContent = '';
  });
  
  eventSource.addEventListener('done', () => {
    eventSource.close();
    // جلب النتائج النهائية
    fetchResults(scanId);
  });
  
  eventSource.addEventListener('error', (e) => {
    eventSource.close();
    showError('انقطع الاتصال بالخادم');
    resetStartButton();
  });
  
  // تخزين reference للإيقاف
  discoveryAbortController = eventSource;
}

async function fetchResults(scanId) {
  try {
    const r = await api('/api/scan/results/' + scanId);
    if (r.success && r.data && r.data.length > 0) {
      document.getElementById('discovery-progress').classList.add('hidden');
      document.getElementById('discovery-results').classList.remove('hidden');
      renderDiscoveryTable(r.data);
      resetStartButton();
      return;
    }
    // إذا لم تكن النتائج جاهزة، ننتظر قليلاً ونحاول مرة أخرى
    setTimeout(() => fetchResults(scanId), 1000);
  } catch (e) {
    console.error('Fetch results error:', e);
    setTimeout(() => fetchResults(scanId), 1000);
  }
}

function stopDiscovery() {
  if (discoveryAbortController) {
    discoveryAbortController.close();
    discoveryAbortController = null;
  }
  document.getElementById('discovery-progress').classList.add('hidden');
  resetStartButton();
}

function resetStartButton() {
  const startBtn = document.getElementById('discovery-start-btn');
  startBtn.disabled = false;
  startBtn.textContent = '🚀 بدء المسح';
}

function showError(message) {
  const errorEl = document.getElementById('discovery-error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  document.getElementById('discovery-progress').classList.add('hidden');
}

async function addSelectedDevices() {
  const checkboxes = document.querySelectorAll('.discovery-checkbox:checked:not(:disabled)');
  if (checkboxes.length === 0) {
    alert('لم يتم تحديد أي أجهزة');
    return;
  }
  
  const devices = [];
  for (const cb of checkboxes) {
    const tr = cb.closest('tr');
    const nameInput = tr.querySelector('.discovery-name-input');
    const typeSelect = tr.querySelector('.discovery-type-select');
    
    if (!nameInput.value.trim()) {
      alert('الرجاء إدخال اسم للجهاز: ' + cb.dataset.ip);
      nameInput.focus();
      return;
    }
    if (!typeSelect.value) {
      alert('الرجاء اختيار نوع للجهاز: ' + cb.dataset.ip);
      typeSelect.focus();
      return;
    }
    
    devices.push({
      ip: cb.dataset.ip,
      name: nameInput.value.trim(),
      device_type_id: typeSelect.value,
      location_id: null,
      check_protocol: 'ping',
      port: null,
      check_interval_seconds: 30,
      failure_threshold: 3,
      is_active: 1
    });
  }
  
  const btn = document.getElementById('discovery-add-selected-btn');
  btn.disabled = true;
  btn.textContent = '⏳ جاري الإضافة...';
  
  try {
    const r = await api('/api/scan/bulk-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices })
    });
    
    if (r.success) {
      const { imported, skipped, errors } = r.data;
      let msg = '✅ تم إضافة ' + imported + ' جهاز بنجاح';
      if (skipped > 0) msg += '، تم تخطي ' + skipped;
      if (errors.length > 0) msg += '\n\nأخطاء:\n' + errors.join('\n');
      alert(msg);
      
      // تحديث الجدول - تعليم الأجهزة المضافة كموجودة
      for (const cb of checkboxes) {
        cb.disabled = true;
        cb.checked = false;
        const tr = cb.closest('tr');
        tr.style.opacity = '0.6';
        tr.style.background = 'var(--bg)';
      }
      
      // إعادة تحميل النتائج
      const r2 = await api('/api/scan/results');
      if (r2.success) renderDiscoveryTable(r2.data);
      
      // تحديث تبويب الأجهزة أيضاً
      if (typeof window.loadDevices === 'function') {
        await window.loadDevices();
      }
    } else {
      alert('❌ فشل الإضافة: ' + (r.error || 'خطأ غير معروف'));
    }
  } catch (e) {
    alert('❌ خطأ: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ إضافة المحددة للمراقبة';
    updateSelectionButtons();
  }
}

function toggleSelectAll() {
  const selectAllCheckbox = document.getElementById('discovery-select-all-checkbox');
  const checkboxes = document.querySelectorAll('.discovery-checkbox:not(:disabled)');
  checkboxes.forEach(cb => { cb.checked = selectAllCheckbox.checked; });
  updateSelectionButtons();
}

function clearSelection() {
  const checkboxes = document.querySelectorAll('.discovery-checkbox:checked');
  checkboxes.forEach(cb => { cb.checked = false; });
  const selectAllCheckbox = document.getElementById('discovery-select-all-checkbox');
  if (selectAllCheckbox) selectAllCheckbox.checked = false;
  updateSelectionButtons();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadTypesAndLocations();
  
  // تهيئة سجل CIDR (input + datalist)
  initCidrDatalist();
  
  document.getElementById('discovery-start-btn').addEventListener('click', startDiscovery);
  document.getElementById('discovery-stop-btn').addEventListener('click', stopDiscovery);
  document.getElementById('discovery-add-selected-btn').addEventListener('click', addSelectedDevices);
  document.getElementById('discovery-select-all-btn').addEventListener('click', () => {
    const selectAllCheckbox = document.getElementById('discovery-select-all-checkbox');
    selectAllCheckbox.checked = true;
    toggleSelectAll();
  });
  document.getElementById('discovery-clear-selection-btn').addEventListener('click', clearSelection);
  document.getElementById('discovery-select-all-checkbox').addEventListener('change', toggleSelectAll);
  
  // تحديث أزرار التحديد عند تغيير أي checkbox
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('discovery-checkbox')) {
      updateSelectionButtons();
    }
  });
});