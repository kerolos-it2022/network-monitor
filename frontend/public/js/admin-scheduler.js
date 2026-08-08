// admin-scheduler.js (v2.5.0)
// ─────────────────────────────────────────────────────────────
// إدارة تبويب "المسح الدوري" (scan_settings + scan_runs):
//   - جَلب/حِفظ الإعدادات (PUT /api/scan-scheduler/settings).
//   - start/stop/run-now عبر endpoints.
//   - عرض الحالة الحالية + سِجل المسحات.
// ─────────────────────────────────────────────────────────────

let schedulerRunsRefreshHandle = null;

async function loadSchedulerSettings() {
  const r = await api('/api/scan-scheduler/settings');
  if (!r || !r.success) {
    console.warn('Failed to load scheduler settings:', r?.error);
    return;
  }
  const s = r.data || {};
  document.getElementById('sched-enabled').checked = s.enabled === 1;
  document.getElementById('sched-interval').value = s.interval_minutes || 15;
  document.getElementById('sched-subnets').value = s.subnets || '';
  document.getElementById('sched-scan-ports').checked = s.scan_ports_enabled === 1;
  document.getElementById('sched-scan-snmp').checked = s.scan_snmp_enabled === 1;
  document.getElementById('sched-snmp-community').value = s.snmp_community || 'public';
  document.getElementById('sched-new-device-alert').checked = s.new_device_alert === 1;
}

async function loadSchedulerStatus() {
  const r = await api('/api/scan-scheduler/status');
  const el = document.getElementById('sched-current-status');
  if (!el) return;
  if (!r || !r.success) {
    el.textContent = 'تعذّر جلب الحالة.';
    return;
  }
  const d = r.data || {};
  const runningTxt = d.is_running ? '🟡 جارٍ مسح الآن...' : '🟢 لا يَعمل مسح حاليًّا';
  const enabledTxt = d.enabled ? '✅ مُفعّل' : '⏸️ متوقف';
  const lastTxt = d.last_run
    ? `آخر مسح #${d.last_run.runId}: ${d.last_run.status} (وُجدت ${d.last_run.devices_found} / أُضيفت ${d.last_run.devices_added} / ضاعت ${d.last_run.devices_lost})`
    : 'لا توجد مسحات سابقة';
  el.innerHTML = `${enabledTxt} — ${runningTxt}<br><span style="font-size:0.9em;color:var(--muted);">${lastTxt}`;
  if (d.last_run && d.last_run.error) {
    el.innerHTML += `<br><span style="color:#b00;font-size:0.85em;">خطأ: ${esc(d.last_run.error)}</span>`;
  }
}

async function loadSchedulerRuns() {
  const r = await api('/api/scan-scheduler/runs?limit=20');
  const tbody = document.getElementById('sched-runs-table-body');
  if (!tbody) return;
  if (!r || !r.success) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:#b00;">⚠️ ${esc(r?.error || 'تعذّر الجلب')}</td></tr>`;
    return;
  }
  const rows = r.data || [];
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--muted);text-align:center;">لا توجد مسحات مُسجَّلة بعد.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => {
    const statusBadge = row.status === 'completed' ? '✅ مكتمل' : (row.status === 'failed' ? '❌ فشل' : '🟡 جارٍ');
    return `<tr>
      <td>${esc(row.id)}</td>
      <td>${esc(row.subnet)}</td>
      <td>${esc(row.started_at || '—')}</td>
      <td>${esc(row.ended_at || '—')}</td>
      <td>${esc(row.devices_found)}</td>
      <td>${esc(row.devices_added)}</td>
      <td>${esc(row.devices_lost)}</td>
      <td>${statusBadge}</td>
      <td>${esc(row.error_message || '—')}</td>
    </tr>`;
  }).join('');
}

async function saveSchedulerSettings() {
  const patch = {
    enabled: document.getElementById('sched-enabled').checked ? 1 : 0,
    interval_minutes: parseInt(document.getElementById('sched-interval').value, 10) || 15,
    subnets: document.getElementById('sched-subnets').value.trim(),
    scan_ports_enabled: document.getElementById('sched-scan-ports').checked ? 1 : 0,
    scan_snmp_enabled: document.getElementById('sched-scan-snmp').checked ? 1 : 0,
    snmp_community: document.getElementById('sched-snmp-community').value.trim() || 'public',
    new_device_alert: document.getElementById('sched-new-device-alert').checked ? 1 : 0,
  };
  if (!patch.subnets) {
    showToast('الرجاء إدخال شبكة فرعية واحدة على الأقل (CIDR). مثال: 192.168.1.0/24', { type: 'warning' });
    return;
  }
  const r = await api('/api/scan-scheduler/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (r && r.success) {
    showToast('تم حفظ إعدادات المسح الدوري وتطبيقها.', { type: 'success' });
    await loadSchedulerStatus();
    await loadSchedulerRuns();
  } else {
    showToast('فشل الحفظ: ' + (r?.error || 'خطأ غير معروف'), { type: 'error' });
  }
}

async function runSchedulerNow() {
  const r = await api('/api/scan-scheduler/run-now', { method: 'POST' });
  if (r && r.success) {
    showToast('بدأ المسح الفوري — ترقّب النتائج في سجل المسحات.', { type: 'success' });
    await loadSchedulerStatus();
    await loadSchedulerRuns();
  } else {
    showToast('فشل بدء المسح الفوري: ' + (r?.error || 'خطأ غير معروف'), { type: 'error' });
  }
}

async function stopScheduler() {
  const r = await api('/api/scan-scheduler/stop', { method: 'POST' });
  if (r && r.success) {
    showToast('تم إيقاف المسح الدوري.', { type: 'success' });
    // أَيضًا نُحدّث checkbox يدويًّا
    document.getElementById('sched-enabled').checked = false;
    await loadSchedulerStatus();
  } else {
    showToast('فشل الإيقاف: ' + (r?.error || 'خطأ غير معروف'), { type: 'error' });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sched-save-btn')?.addEventListener('click', saveSchedulerSettings);
  document.getElementById('sched-run-now-btn')?.addEventListener('click', runSchedulerNow);
  document.getElementById('sched-stop-btn')?.addEventListener('click', stopScheduler);

  // إِدخال بسيط في cache: لِمُزامنة المحادثات المُتَأثِّرة فقَط عند فَتح التَّبويب
  const observer = new MutationObserver(() => {
    const section = document.getElementById('section-scheduler');
    if (!section) return;
    const visible = !section.classList.contains('hidden');
    if (visible) {
      // lazy-load
      loadSchedulerSettings().catch(() => {});
      loadSchedulerStatus().catch(() => {});
      loadSchedulerRuns().catch(() => {});
      if (!schedulerRunsRefreshHandle) {
        schedulerRunsRefreshHandle = setInterval(() => {
          loadSchedulerStatus().catch(() => {});
          loadSchedulerRuns().catch(() => {});
        }, 15000);
      }
    } else {
      if (schedulerRunsRefreshHandle) {
        clearInterval(schedulerRunsRefreshHandle);
        schedulerRunsRefreshHandle = null;
      }
    }
  });
  const s = document.getElementById('section-scheduler');
  if (s) observer.observe(s, { attributes: true, attributeFilter: ['class'] });
});
