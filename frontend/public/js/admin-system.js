// admin-system.js — 🖥️ حالة النظام (v2.23.0): عرض استهلاك الجهاز الحي (رام/معالج/هارد/شبكة)
// + تفاصيل النظام + صحة المحرك، بتحديث ذاتي كل 5 ثوانٍ (مفتاح محفوظ في localStorage).
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
const SYS_REFRESH_KEY = 'nm.systemAutoRefresh';
let sysTimer = null;
const SYS_INTERVAL_MS = 5000;

function sysFmtBytes(b) {
  if (b === null || b === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(b) || 0, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

function sysFmtUptime(sec) {
  if (!sec || sec < 0) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return d + ' يوم و ' + h + ' ساعة';
  if (h) return h + ' ساعة و ' + m + ' دقيقة';
  return m + ' دقيقة';
}

// لون الشريط: أخضر حتى 60% · أصفر حتى 85% · أحمر بعدها.
function sysBarColor(pct) {
  if (pct === null || pct === undefined) return 'rgba(125,125,125,0.6)';
  if (pct >= 85) return 'var(--offline, #dc2626)';
  if (pct >= 60) return '#f59e0b';
  return 'var(--online, #16a34a)';
}

function sysSetBar(id, pct) {
  const bar = document.getElementById(id);
  if (!bar) return;
  const fill = bar.firstElementChild;
  const p = (pct === null || pct === undefined) ? 0 : Math.min(100, pct);
  fill.style.width = p + '%';
  fill.style.background = sysBarColor(pct);
}

function sysSetStatus(msg, isError) {
  const el = document.getElementById('sys-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--offline, #dc2626)' : 'var(--muted)';
}

async function loadSystemStats() {
  const r = await api('/api/system/stats');
  if (!r.success) { sysSetStatus('تعذّر قراءة حالة النظام: ' + (r.error || ''), true); return; }
  const d = r.data;

  // 🧠 الرام
  sysSetBar('sys-memory-bar', d.memory.used_percent);
  document.getElementById('sys-memory-text').textContent =
    'مستخدم ' + sysFmtBytes(d.memory.used_bytes) + ' من ' + sysFmtBytes(d.memory.total_bytes)
    + ' — متاح ' + sysFmtBytes(d.memory.free_bytes) + ' (' + d.memory.used_percent + '%)';
  document.getElementById('sys-process').textContent =
    '🧩 خدمة المراقبة: ' + sysFmtBytes(d.memory.process.rss_bytes)
    + ' (Heap مستخدم ' + sysFmtBytes(d.memory.process.heap_used_bytes) + ')'
    + ' · مفتوحة منذ ' + sysFmtUptime(d.memory.process.uptime_seconds);

  // ⚡ المعالج
  const cpuPercent = d.cpu.usage_percent;
  sysSetBar('sys-cpu-bar', cpuPercent);
  document.getElementById('sys-cpu-text').textContent = (cpuPercent === null ? 'يُحسب من التحديث التالي…' : 'الاستخدام الحي: ' + cpuPercent + '%')
    + ' · أنوية: ' + d.cpu.cores + (d.cpu.model ? ' · ' + d.cpu.model : '');
  document.getElementById('sys-loadavg').textContent =
    d.cpu.loadavg_1_5_15 ? 'تحميل النظام (1/5/15 دقيقة): ' + d.cpu.loadavg_1_5_15.join(' · ') : '—';

  // 💾 القرص
  const root = d.disks.root;
  if (root) {
    sysSetBar('sys-disk-bar', root.used_percent);
    document.getElementById('sys-disk-text').textContent =
      'مستخدم ' + sysFmtBytes(root.used) + ' من ' + sysFmtBytes(root.total) + ' — متاح ' + sysFmtBytes(root.free) + ' (' + root.used_percent + '%)';
  } else {
    sysSetBar('sys-disk-bar', null);
    document.getElementById('sys-disk-text').textContent = 'قياس قرص الجذر غير متاح على هذه المنصة';
  }
  document.getElementById('sys-db-size').textContent =
    '🗃️ قاعدة البيانات: ' + sysFmtBytes(d.disks.db_file_bytes)
    + ' · 💾 النسخ الاحتياطية: ' + sysFmtBytes(d.disks.backups_bytes);

  // 🌐 الشبكة (لينكس فقط — بطاقة تُخفى بهدوء على غيره)
  const netCard = document.getElementById('sys-network-card');
  if (!d.network) { netCard.style.display = 'none'; }
  else {
    netCard.style.display = '';
    const rate = (v) => (v === null || v === undefined) ? '…' : sysFmtBytes(v) + '/ث';
    document.getElementById('sys-net-rx-rate').textContent = rate(d.network.rx_rate_bps);
    document.getElementById('sys-net-tx-rate').textContent = rate(d.network.tx_rate_bps);
    document.getElementById('sys-net-rx-total').textContent = sysFmtBytes(d.network.rx_total);
    document.getElementById('sys-net-tx-total').textContent = sysFmtBytes(d.network.tx_total);
    const top = (d.network.interfaces || []).slice(0, 3)
      .map((i) => i.name + ' (' + sysFmtBytes(i.rx_bytes) + '/' + sysFmtBytes(i.tx_bytes) + ')').join(' · ');
    document.getElementById('sys-net-ifaces').textContent = top ? 'الواجهات الأنشط: ' + top : '—';
  }

  // 📋 تفاصيل النظام
  const s = d.system;
  document.getElementById('sys-details').innerHTML =
    '<div>💻 النظام: <b>' + esc(s.type || s.platform) + ' ' + esc(s.release) + '</b></div>'
    + '<div>🧱 المعمارية: <b>' + esc(s.arch) + '</b></div>'
    + '<div>🖥️ الجهاز: <b>' + esc(s.hostname) + '</b></div>'
    + '<div>🟢 إصدار Node: <b>' + esc(s.node_version) + '</b></div>'
    + '<div>⏰ خدمة المراقبة مفتوحة منذ: <b>' + sysFmtUptime(s.app_uptime_seconds) + '</b></div>'
    + '<div>🔋 نظام التشغيل منذ: <b>' + sysFmtUptime(s.os_uptime_seconds) + '</b></div>';

  // ⏱️ المحرك
  const e = d.engine;
  document.getElementById('sys-engine').textContent = !e ? '—'
    : (e.stalled ? '⚠️ المحرك متوقف أو متعثر! آخر دورة قبل ' + Math.round((e.last_tick_age_ms || 0) / 1000) + ' ثانية — راجع تبويب السجل'
       : '✅ سليم — آخر دورة فحص قبل ' + Math.round((e.last_tick_age_ms || 0) / 1000) + ' ثانية · أجهزة نشطة: ' + (d.devices_active !== null ? d.devices_active : (e.active_devices || '—')) + ' · فحوص جارية: ' + (e.inflight_checks || 0));

  sysSetStatus('آخر تحديث: ' + new Date(d.ts).toLocaleTimeString('ar-EG'), false);
}

function sysStartAuto() {
  sysStopAuto();
  loadSystemStats();
  sysTimer = setInterval(loadSystemStats, SYS_INTERVAL_MS);
}
function sysStopAuto() {
  if (sysTimer) { clearInterval(sysTimer); sysTimer = null; }
}

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('sys-auto-refresh');
  if (!toggle) return; // احتياط: صفحة بلا قسم الحالة
  // استرجاع المفتاح (الافتراضي: مفعل) — والعرض مرتبط بفتح التبويب نفسه.
  try {
    const saved = localStorage.getItem(SYS_REFRESH_KEY);
    if (saved === '0') toggle.checked = false;
    else if (saved === '1') toggle.checked = true;
  } catch (_) {}
  toggle.addEventListener('change', () => {
    try { localStorage.setItem(SYS_REFRESH_KEY, toggle.checked ? '1' : '0'); } catch (_) {}
    if (toggle.checked) sysStartAuto(); else sysStopAuto();
  });
  // أول تحميل عند فتح التبويب (ليس عند إقلاع الصفحة — توفير عبء زائد).
  document.getElementById('tab-system').addEventListener('click', () => {
    if (toggle.checked) sysStartAuto(); else loadSystemStats();
  });
});
