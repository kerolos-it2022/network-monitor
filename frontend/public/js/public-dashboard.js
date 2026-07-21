// public-dashboard.js: \u062c\u0644\u0628/\u0639\u0631\u0636 \u0627\u0644\u0623\u062c\u0647\u0632\u0629\u060c \u0627\u0644\u0641\u0644\u062a\u0631\u0629\u060c \u0627\u0644\u062a\u0631\u062a\u064a\u0628\u060c \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0628\u064a\u0646 \u0646\u0645\u0637 \u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062a \u0648\u0627\u0644\u062c\u062f\u0648\u0644\u060c \u0627\u0644\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u062f\u0648\u0631\u064a\u060c \u062a\u0628\u062f\u064a\u0644 \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0644\u064a\u0644\u064a.
let allDevices = [];
let currentChart = null;
let currentView = 'cards'; // 'cards' | 'table'
let currentSort = 'name';  // 'name' | 'ip' | 'status' | 'type' | 'location' | 'last_checked'
const VIEW_STORAGE_KEY = 'nm.publicView';
const SORT_STORAGE_KEY = 'nm.publicSort';
const THEME_STORAGE_KEY = 'nm.publicTheme'; // 'dark' | 'light'

// ====== \u062c\u0644\u0628 \u0648\u0639\u0631\u0636 \u0627\u0644\u0623\u062c\u0647\u0632\u0629 ======
async function fetchApi(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      return { success: false, error: 'HTTP ' + r.status };
    }
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { success: false, error: '\u0631\u062f \u063a\u064a\u0631 \u0635\u062d\u064a\u062d' };
    }
  } catch (e) {
    return { success: false, error: '\u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u0627\u062a\u0635\u0627\u0644' };
  }
}

function statusText(status) {
  if (status === 'online') return '\u0645\u062a\u0635\u0644';
  if (status === 'offline') return '\u0645\u062a\u0648\u0642\u0641';
  return '\u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641';
}

function statusDotClass(d) {
  if (d.current_status === 'online' && d.last_response_time_ms != null && d.last_response_time_ms > 500) {
    return 'warning';
  }
  return d.current_status || 'unknown';
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '\u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return s + ' \u062b\u0627\u0646\u064a\u0629';
  if (s < 3600) return Math.floor(s / 60) + ' \u062f\u0642\u064a\u0642\u0629';
  return Math.floor(s / 3600) + ' \u0633\u0627\u0639\u0629 ' + Math.floor((s % 3600) / 60) + ' \u062f\u0642\u064a\u0642\u0629';
}

// ====== \u062f\u0627\u0644\u0629 \u0627\u0644\u062a\u0631\u062a\u064a\u0628 ======
function sortDevices(devicesList) {
  const sorted = [...devicesList];
  sorted.sort((a, b) => {
    let valA, valB;
    switch (currentSort) {
      case 'ip':
        valA = a.ip.split('.').map(Number);
        valB = b.ip.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
          if (valA[i] !== valB[i]) return valA[i] - valB[i];
        }
        return 0;
      case 'status':
        const statusOrder = { offline: 0, unknown: 1, online: 2 };
        return (statusOrder[a.current_status] || 1) - (statusOrder[b.current_status] || 1);
      case 'type':
        valA = (a.device_type_name || '').toLowerCase();
        valB = (b.device_type_name || '').toLowerCase();
        return valA.localeCompare(valB, 'ar');
      case 'location':
        valA = (a.location_name || '').toLowerCase();
        valB = (b.location_name || '').toLowerCase();
        return valA.localeCompare(valB, 'ar');
      case 'last_checked':
        valA = a.last_checked_at ? new Date(a.last_checked_at).getTime() : 0;
        valB = b.last_checked_at ? new Date(b.last_checked_at).getTime() : 0;
        return valB - valA;
      case 'name':
      default:
        valA = (a.name || '').toLowerCase();
        valB = (b.name || '').toLowerCase();
        return valA.localeCompare(valB, 'ar');
    }
  });
  return sorted;
}

// ====== \u0646\u0645\u0637 \u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062a ======
function renderDevices(devicesList) {
  const grid = document.getElementById('devices-grid');
  grid.innerHTML = '';
  if (!devicesList || devicesList.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);padding:1rem;">\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u062c\u0647\u0632\u0629 \u0645\u0637\u0627\u0628\u0642\u0629.</p>';
    return;
  }
  for (const d of devicesList) {
    const sc = statusDotClass(d);
    const statusClass = 'status-' + sc;
    const badgeClass = 'badge-' + sc;

    // بناء رابط الواجهة إذا كان الجهاز يدعم HTTP/HTTPS (فحص تلقائي)
    var openBtnHtml = '';
    if (d.https_accessible == 1) {
      var url = 'https://' + d.ip + '/';
      openBtnHtml = '<button class="btn btn-primary open-device-btn" data-url="' + escapeHtml(url) + '" title="فتح واجهة الجهاز (HTTPS)" type="button">🔒 فتح HTTPS</button>';
    } else if (d.http_accessible == 1) {
      var url = 'http://' + d.ip + '/';
      openBtnHtml = '<button class="btn btn-primary open-device-btn" data-url="' + escapeHtml(url) + '" title="فتح واجهة الجهاز (HTTP)" type="button">🌐 فتح HTTP</button>';
    }

    const card = document.createElement('div');
    card.className = 'device-card ' + statusClass;
    card.innerHTML =
      '<div class="name">' + escapeHtml(d.name) + '</div>' +
      '<div class="ip">' + escapeHtml(d.ip) + '</div>' +
      '<div class="meta">\u0627\u0644\u0646\u0648\u0639: ' + escapeHtml(d.device_type_name || '-') + '</div>' +
      '<div class="meta">\u0627\u0644\u0645\u0648\u0642\u0639: ' + escapeHtml(d.location_name || '-') + '</div>' +
      '<div class="meta">\u0622\u062e\u0631 \u0641\u062d\u0635: ' + (d.last_checked_at ? new Date(d.last_checked_at).toLocaleString('ar') : '\u0644\u0645 \u064a\u0641\u062d\u0635 \u0628\u0639\u062f') + '</div>' +
      '<span class="status-badge ' + badgeClass + '">' + statusText(d.current_status) + '</span>' +
      (openBtnHtml ? '<div class="card-actions">' + openBtnHtml + '</div>' : '');
    card.addEventListener('click', function (e) {
      // لا تفتح المودال إذا تم الضغط على زر الفتح
      if (e.target.closest('.open-device-btn')) return;
      if (typeof window.openDeviceModal === 'function') window.openDeviceModal(d.id);
    });
    grid.appendChild(card);
  }

  // إضافة مستمعي الأحداث لأزرار الفتح
  grid.querySelectorAll('.open-device-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      window.open(this.dataset.url, '_blank');
    });
  });
}

// ====== \u0646\u0645\u0637 \u0627\u0644\u062c\u062f\u0648\u0644 ======
function renderTable(devicesList) {
  const tbody = document.getElementById('devices-table-body');
  tbody.innerHTML = '';
  if (!devicesList || devicesList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:1rem;">\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u062c\u0647\u0632\u0629 \u0645\u0637\u0627\u0628\u0642\u0629.</td></tr>';
    return;
  }
  for (const d of devicesList) {
    const dot = statusDotClass(d);
    // بناء رابط الفتح للأجهزة التي تدعم HTTP/HTTPS (فحص تلقائي)
    let openBtnHtml = '';
    if (d.https_accessible == 1) {
      const url = 'https://' + d.ip + '/';
      openBtnHtml = '<button class="btn open-device-btn" data-url="' + escapeHtml(url) + '" title="فتح الواجهة (HTTPS)">🔒 فتح HTTPS</button>';
    } else if (d.http_accessible == 1) {
      const url = 'http://' + d.ip + '/';
      openBtnHtml = '<button class="btn open-device-btn" data-url="' + escapeHtml(url) + '" title="فتح الواجهة (HTTP)">🌐 فتح HTTP</button>';
    }
    const tr = document.createElement('tr');
    tr.className = 'public-row';
    tr.innerHTML =
      '<td><span class="status-dot ' + dot + '" title="' + escapeHtml(statusText(d.current_status)) + '"></span></td>' +
      '<td>' + escapeHtml(d.name) + '</td>' +
      '<td style="direction:ltr;text-align:center;font-size:0.85rem;">' + escapeHtml(d.ip) + '</td>' +
      '<td>' + escapeHtml(d.device_type_name || '-') + '</td>' +
      '<td>' + escapeHtml(d.location_name || '-') + '</td>' +
      '<td style="font-size:0.85rem;color:var(--muted);">' + (d.last_checked_at ? new Date(d.last_checked_at).toLocaleString('ar') : '-') + '</td>' +
      '<td>' + (openBtnHtml || '') + '</td>' +
      '<td><button class="btn" data-detail="' + d.id + '">\u062a\u0641\u0627\u0635\u064a\u0644</button></td>';
    // إضافة مستمع للزر التفاصيل
    tr.querySelector('[data-detail]').addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof window.openDeviceModal === 'function') window.openDeviceModal(d.id);
    });
    // إضافة مستمع لزر الفتح
    if (openBtnHtml) {
      tr.querySelector('.open-device-btn').addEventListener('click', function(e) {
        e.stopPropagation();
        window.open(this.dataset.url, '_blank');
      });
    }
    tr.addEventListener('click', function () {
      if (typeof window.openDeviceModal === 'function') window.openDeviceModal(d.id);
    });
    tbody.appendChild(tr);
  }
}

// ====== \u0645\u0644\u062e\u0635 \u0634\u0631\u064a\u0637 \u0639\u0644\u0648\u064a ======
function updateSummaryBar(devicesList) {
  const total = devicesList.length;
  const online = devicesList.filter(function (d) { return d.current_status === 'online'; }).length;
  const offline = devicesList.filter(function (d) { return d.current_status === 'offline'; }).length;
  document.getElementById('summary-bar').textContent =
    '\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a: ' + total + '  \u2022  \u0645\u062a\u0635\u0644: ' + online + '  \u2022  \u0645\u062a\u0648\u0642\u0641: ' + offline;
}

// ====== \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0628\u064a\u0646 \u0627\u0644\u0646\u0645\u0637\u064a\u0646 ======
function switchView(view) {
  currentView = view;
  var cardsWrap = document.getElementById('devices-grid');
  var tableWrap = document.getElementById('devices-table-view');
  var cardsBtn = document.getElementById('view-cards-btn');
  var tableBtn = document.getElementById('view-table-btn');

  if (view === 'table') {
    cardsWrap.classList.add('hidden');
    tableWrap.classList.remove('hidden');
    cardsBtn.classList.remove('active');
    tableBtn.classList.add('active');
  } else {
    cardsWrap.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    cardsBtn.classList.add('active');
    tableBtn.classList.remove('active');
  }
  try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch (e) {}
  applyFilters();
}

// ====== \u0627\u0644\u0641\u0644\u062a\u0631\u0629 \u0648\u0627\u0644\u062a\u0631\u062a\u064a\u0628 ======
function applyFilters() {
  var q = (document.getElementById('search-input').value || '').trim().toLowerCase();
  var type = document.getElementById('filter-type').value;
  var location = document.getElementById('filter-location').value;
  var status = document.getElementById('filter-status').value;

  var filtered = allDevices.filter(function (d) {
    if (q && !String(d.name).toLowerCase().includes(q) && !String(d.ip).toLowerCase().includes(q)) return false;
    if (type && d.device_type_id != +type) return false;
    if (location && d.location_id != +location) return false;
    if (status && d.current_status !== status) return false;
    return true;
  });

  filtered = sortDevices(filtered);

  if (currentView === 'table') {
    renderTable(filtered);
  } else {
    renderDevices(filtered);
  }
  updateSummaryBar(filtered);
}

// ====== \u0641\u062a\u062d \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u062c\u0647\u0627\u0632 (\u0627\u0644\u0645\u0648\u062f\u0627\u0644) ======
window.openDeviceModal = async function (deviceId) {
  var modal = document.getElementById('device-modal');
  // إغلاق أي مودال/رسم سابق أولاً.
  if (currentChart && typeof currentChart.destroy === 'function') {
    try { currentChart.destroy(); } catch (e) {}
    currentChart = null;
  }
  try {
    var devRes = await fetchApi('/api/devices/' + deviceId);
    if (!devRes || !devRes.success) {
      alert(devRes && devRes.error ? devRes.error : '\u062a\u0639\u0630\u0631 \u062c\u0644\u0628 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u062c\u0647\u0627\u0632');
      return;
    }
    document.getElementById('modal-device-name').textContent = devRes.data.name;

    var histRes = await fetchApi('/api/devices/' + deviceId + '/history?range=24h');
    if (!histRes || !histRes.success) {
      alert(histRes && histRes.error ? histRes.error : '\u062a\u0639\u0630\u0631 \u062c\u0644\u0628 \u0633\u062c\u0644 \u0627\u0644\u062c\u0647\u0627\u0632');
      return;
    }
    var data = histRes.data;

    document.getElementById('modal-uptime').textContent =
      '\u0646\u0633\u0628\u0629 \u0627\u0644\u062a\u0634\u063a\u064a\u0644: ' + data.uptime_percentage + '%';

    var canvas = document.getElementById('modal-chart-canvas');
    if (typeof window.renderDeviceChart === 'function') {
      try {
        currentChart = window.renderDeviceChart(canvas, data.status_points);
      } catch (e) {
        console.error('chart render error', e);
      }
    }

    var list = document.getElementById('modal-downtime-list');
    list.innerHTML = '';
    if (!data.downtime_events || data.downtime_events.length === 0) {
      list.innerHTML = '<li>\u0644\u0627 \u062a\u0648\u062c\u062f \u0627\u0646\u0642\u0637\u0627\u0639\u0627\u062a \u062e\u0644\u0627\u0644 \u0622\u062e\u0631 24 \u0633\u0627\u0639\u0629.</li>';
    } else {
      for (var i = 0; i < data.downtime_events.length; i++) {
        var ev = data.downtime_events[i];
        var li = document.createElement('li');
        var ended = ev.ended_at ? new Date(ev.ended_at).toLocaleString('ar') : '\u0645\u0633\u062a\u0645\u0631 \u0627\u0644\u0622\u0646';
        li.textContent = '\u0645\u0646 ' + new Date(ev.started_at).toLocaleString('ar') + ' \u0625\u0644\u0649 ' + ended + ' \u2014 \u0627\u0644\u0645\u062f\u0629: ' + formatDuration(ev.duration_seconds);
        list.appendChild(li);
      }
    }

    modal.classList.remove('hidden');
  } catch (e) {
    console.error('openDeviceModal error', e);
    alert('\u062e\u0637\u0623 \u0641\u064a \u062c\u0644\u0628 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u062c\u0647\u0627\u0632: ' + (e && e.message ? e.message : ''));
  }
};

// ====== \u062a\u0647\u064a\u0626\u0629 \u0627\u0644\u0635\u0641\u062d\u0629 ======
async function init() {
  var results = await Promise.all([
    fetchApi('/api/devices'),
    fetchApi('/api/device-types'),
    fetchApi('/api/locations'),
  ]);
  var devs = results[0], types = results[1], locs = results[2];
  allDevices = devs.success ? devs.data : [];

  fillSelect('filter-type', types.success ? types.data : []);
  fillSelect('filter-location', locs.success ? locs.data : []);

  try {
    var savedView = localStorage.getItem(VIEW_STORAGE_KEY);
    if (savedView === 'table' || savedView === 'cards') currentView = savedView;
    var savedSort = localStorage.getItem(SORT_STORAGE_KEY);
    if (savedSort) {
      currentSort = savedSort;
      document.getElementById('filter-sort').value = savedSort;
    }
  } catch (e) {}
  switchView(currentView);

  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-type').addEventListener('change', applyFilters);
  document.getElementById('filter-location').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-sort').addEventListener('change', function () {
    currentSort = this.value;
    try { localStorage.setItem(SORT_STORAGE_KEY, currentSort); } catch (e) {}
    applyFilters();
  });

  document.getElementById('view-cards-btn').addEventListener('click', function () { switchView('cards'); });
  document.getElementById('view-table-btn').addEventListener('click', function () { switchView('table'); });

  document.getElementById('modal-close-btn').addEventListener('click', function () {
    document.getElementById('device-modal').classList.add('hidden');
  });

  // --- قسم أدوات الشبكة (بث مباشر SSE) ---
  var toolsOutput = document.getElementById('tools-output');
  var toolsStatus = document.getElementById('tools-status');
  var toolsStatusText = document.getElementById('tools-status-text');
  var toolsStopBtn = document.getElementById('tools-stop-btn');
  var toolsClearBtn = document.getElementById('tools-clear-btn');
  var toolsPingBtn = document.getElementById('tools-ping-btn');
  var toolsTracertBtn = document.getElementById('tools-tracert-btn');
  var currentAbortController = null; // للإلغاء

  document.getElementById('tools-ping-btn').addEventListener('click', function () {
    runTool('ping');
  });
  document.getElementById('tools-tracert-btn').addEventListener('click', function () {
    runTool('tracert');
  });
  document.getElementById('tools-stop-btn').addEventListener('click', function () {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    toolsStatusText.textContent = 'تم الإيقاف';
    finishTool();
  });
  document.getElementById('tools-clear-btn').addEventListener('click', function () {
    toolsOutput.textContent = '';
    toolsOutput.classList.add('hidden');
    toolsClearBtn.classList.add('hidden');
  });

  function startToolUI() {
    toolsOutput.textContent = '';
    toolsOutput.classList.remove('hidden');
    toolsStatus.classList.remove('hidden');
    toolsStatusText.textContent = 'جاري التنفيذ...';
    toolsStopBtn.classList.remove('hidden');
    toolsPingBtn.disabled = true;
    toolsTracertBtn.disabled = true;
    toolsPingBtn.style.opacity = '0.5';
    toolsTracertBtn.style.opacity = '0.5';
  }

  function finishTool() {
    toolsStatus.classList.add('hidden');
    toolsStopBtn.classList.add('hidden');
    toolsClearBtn.classList.remove('hidden');
    toolsPingBtn.disabled = false;
    toolsTracertBtn.disabled = false;
    toolsPingBtn.style.opacity = '1';
    toolsTracertBtn.style.opacity = '1';
  }

  async function runTool(tool) {
    var target = document.getElementById('tools-ip-input').value.trim();
    if (!target) {
      alert('من فضلك أدخل IP أو اسم مضيف');
      return;
    }
    if (!/^[a-zA-Z0-9.\-_]+$/.test(target)) {
      alert('حروف غير مسموحة في IP/اسم المضيف');
      return;
    }

    startToolUI();

    // إلغاء أي طلب سابق
    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();

    try {
      var response = await fetch('/api/tools/' + tool + '?ip=' + encodeURIComponent(target), {
        signal: currentAbortController.signal,
      });

      if (!response.ok) {
        toolsOutput.textContent = 'خطأ: HTTP ' + response.status;
        finishTool();
        return;
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var sseBuffer = '';

      while (true) {
        var result = await reader.read();
        if (result.done) break;

        sseBuffer += decoder.decode(result.value, { stream: true });
        var parts = sseBuffer.split('\n\n');
        sseBuffer = parts.pop() || '';

        for (var i = 0; i < parts.length; i++) {
          var block = parts[i].trim();
          if (!block) continue;

          var eventType = '';
          var data = '';
          var lines = block.split('\n');
          for (var j = 0; j < lines.length; j++) {
            if (lines[j].indexOf('event:') === 0) {
              eventType = lines[j].substring(6).trim();
            } else if (lines[j].indexOf('data:') === 0) {
              data = lines[j].substring(5).trim();
            }
          }

          if (eventType === 'start') {
            toolsStatusText.textContent = 'جاري ' + (tool === 'ping' ? 'Ping' : 'Tracert') + ' إلى ' + target + '...';
          } else if (eventType === 'line') {
            try {
              var lineText = JSON.parse(data);
              toolsOutput.textContent += lineText + '\n';
            } catch (e) {
              toolsOutput.textContent += data + '\n';
            }
            // التمرير التلقائي لآخر سطر
            toolsOutput.scrollTop = toolsOutput.scrollHeight;
          } else if (eventType === 'error') {
            try {
              var errMsg = JSON.parse(data);
              toolsOutput.textContent += '\n❌ ' + errMsg + '\n';
            } catch (e) {
              toolsOutput.textContent += '\n❌ ' + data + '\n';
            }
          } else if (eventType === 'done') {
            toolsStatusText.textContent = 'اكتمل ✓';
            finishTool();
            return;
          }
        }
      }
      finishTool();
    } catch (e) {
      if (e.name === 'AbortError') {
        // المستخدم أوقف العملية — تم التعامل أعلاه
        finishTool();
      } else {
        toolsOutput.textContent += '\n❌ خطأ: ' + e.message + '\n';
        finishTool();
      }
    }
  }
  // --- نهاية قسم أدوات الشبكة ---

  var themeBtn = document.getElementById('theme-toggle');
  // تطبيق الوضع الليلي المحفوظ عند الإقلاع.
  try {
    if (localStorage.getItem(THEME_STORAGE_KEY) === 'dark') {
      document.body.classList.add('dark');
      themeBtn.textContent = '\u2600\uFE0F \u0648\u0636\u0639 \u0646\u0647\u0627\u0631\u064a';
    }
  } catch (e) {}
  themeBtn.addEventListener('click', function () {
    document.body.classList.toggle('dark');
    var isDark = document.body.classList.contains('dark');
    themeBtn.textContent = isDark ? '\u2600\uFE0F \u0648\u0636\u0639 \u0646\u0647\u0627\u0631\u064a' : '\uD83C\uDF19 \u0648\u0636\u0639 \u0644\u062a\u064a\u0644\u064a';
    try { localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light'); } catch (e) {}
  });
  // ===== زر تفعيل إشعارات الموبايل (Web Push + VAPID) =====
  var notifyBtn = document.getElementById('notify-btn');
  if (notifyBtn) {
    function updateNotifyBtnState() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        notifyBtn.disabled = true;
        notifyBtn.textContent = "🔕 الإشعارات غير مدعومة";
        return;
      }
      if (Notification.permission === "granted") {
        notifyBtn.textContent = "🔔 الإشعارات مفعّلة";
        notifyBtn.style.color = "var(--online)";
      } else if (Notification.permission === "denied") {
        notifyBtn.disabled = true;
        notifyBtn.textContent = "🔕 الإشعارات محجوبة";
      } else {
        notifyBtn.textContent = "🔔 تفعيل الإشعارات";
      }
    }
    updateNotifyBtnState();

    notifyBtn.addEventListener("click", async function () {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("متصفحك لا يدعم الإشعارات");
        return;
      }
      var permission = await Notification.requestPermission();
      if (permission !== "granted") {
        alert("تم رفض الإذن. لتلقي الإشعارات يجب السماح بها من إعدادات المتصفح.");
        updateNotifyBtnState();
        return;
      }
      try {
        var vRes = await fetchApi("/api/notifications/vapid-public");
        if (!vRes.success || !vRes.data || !vRes.data.publicKey) {
          alert("⚠️ الإشعارات غير مُهيّأة على الخادم. اطلب من المدير ضبط VAPID keys في .env");
          updateNotifyBtnState();
          return;
        }
        var vapidPublicKey = vRes.data.publicKey;
        function urlBase64ToUint8Array(base64String) {
          var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
          var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
          var rawData = atob(base64);
          var arr = new Uint8Array(rawData.length);
          for (var i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
          return arr;
        }
        var reg = await navigator.serviceWorker.ready;
        var subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
        await fetch("/api/notifications/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: JSON.stringify(subscription),
            platform: "web",
            deviceInfo: navigator.userAgent || "",
          }),
        });
        notifyBtn.textContent = "✅ تم التفعيل بنجاح";
        notifyBtn.style.color = "var(--online)";
        reg.showNotification("🔔 تم تفعيل الإشعارات", {
          body: "ستصلك إشعارات فورية عند انقطاع أي جهاز أو عودته.",
          icon: "/icon-192.png",
        });
      } catch (e) {
        console.error("Push subscribe error", e);
        alert("❌ فشل تفعيل الإشعارات: " + (e.message || "خطأ غير معروف"));
      }
      updateNotifyBtnState();
    });
  }


  setInterval(async function () {
    try {
      var r = await fetchApi('/api/devices');
      if (r.success) {
        allDevices = r.data;
        applyFilters();
      }
    } catch (e) {
      console.error('polling error', e);
    }
  }, 10000);
}

function fillSelect(selectId, items) {
  var sel = document.getElementById(selectId);
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.name;
    sel.appendChild(opt);
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', init);