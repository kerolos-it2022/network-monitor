// admin-system.js — 🖥️ حالة النظام (v2.23.0): عرض استهلاك الجهاز الحي (رام/معالج/هارد/شبكة)
// + تفاصيل النظام + صحة المحرك، بتحديث ذاتي كل 5 ثوانٍ (مفتاح محفوظ في localStorage).
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
const SYS_REFRESH_KEY = 'nm.systemAutoRefresh';
let sysTimer = null;
let sysDrawSkip = 0;
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
  // v2.33.0 — عزل القيم اللاتينية/الرقمية داخل نصّ عربي (bdi) لمنع تشوّه ترتيب النصّ
  const bdi = (v) => '<bdi class="nm-ltr">' + esc(v) + '</bdi>';

  // 🧠 الرام
  sysSetBar('sys-memory-bar', d.memory.used_percent);
  document.getElementById('sys-memory-text').innerHTML =
    'مستخدم ' + bdi(sysFmtBytes(d.memory.used_bytes)) + ' من ' + bdi(sysFmtBytes(d.memory.total_bytes))
    + ' — متاح ' + bdi(sysFmtBytes(d.memory.free_bytes)) + ' (' + bdi(d.memory.used_percent + '%') + ')';
  document.getElementById('sys-process').innerHTML =
    '🧩 خدمة المراقبة: ' + bdi(sysFmtBytes(d.memory.process.rss_bytes))
    + ' (Heap مستخدم ' + bdi(sysFmtBytes(d.memory.process.heap_used_bytes)) + ')'
    + ' · مفتوحة منذ ' + esc(sysFmtUptime(d.memory.process.uptime_seconds));

  // ⚡ المعالج
  const cpuPercent = d.cpu.usage_percent;
  sysSetBar('sys-cpu-bar', cpuPercent);
  document.getElementById('sys-cpu-text').innerHTML = (cpuPercent === null ? 'يُحسب من التحديث التالي…' : 'الاستخدام الحي: ' + bdi(cpuPercent + '%'))
    + ' · أنوية: ' + bdi(d.cpu.cores) + (d.cpu.model ? ' · ' + bdi(d.cpu.model) : '');
  document.getElementById('sys-loadavg').innerHTML =
    d.cpu.loadavg_1_5_15 ? 'تحميل النظام (1/5/15 دقيقة): ' + bdi(d.cpu.loadavg_1_5_15.join(' · ')) : '—';

  // 💾 القرص
  const root = d.disks.root;
  if (root) {
    sysSetBar('sys-disk-bar', root.used_percent);
    document.getElementById('sys-disk-text').innerHTML =
      'مستخدم ' + bdi(sysFmtBytes(root.used)) + ' من ' + bdi(sysFmtBytes(root.total)) + ' — متاح ' + bdi(sysFmtBytes(root.free)) + ' (' + bdi(root.used_percent + '%') + ')';
  } else {
    sysSetBar('sys-disk-bar', null);
    document.getElementById('sys-disk-text').textContent = T('s2j.root_disk_measurement_is_not_available_on_th', 'قياس قرص الجذر غير متاح على هذه المنصة');
  }
  document.getElementById('sys-db-size').innerHTML =
    '🗃️ قاعدة البيانات: ' + bdi(sysFmtBytes(d.disks.db_file_bytes))
    + ' · 💾 النسخ الاحتياطية: ' + bdi(sysFmtBytes(d.disks.backups_bytes));

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
      .map((i) => esc(i.name) + ' (' + sysFmtBytes(i.rx_bytes) + '/' + sysFmtBytes(i.tx_bytes) + ')').join(' · ');
    document.getElementById('sys-net-ifaces').innerHTML = top ? 'الواجهات الأنشط: ' + bdi(top) : '—';
  }

  // 📋 تفاصيل النظام — سطور «اسم: قيمة» مع عزل القيم (أسماء أنظمة/أرقام إنجليزية) داخل صفحة عربية
  const ltr = (v) => '<bdi class="nm-ltr">' + esc(v) + '</bdi>';
  const kvRow = (label, value) => '<div class="nm-kv"><span class="k">' + label + '</span><span class="v">' + value + '</span></div>';
  const s = d.system;
  document.getElementById('sys-details').innerHTML =
    kvRow(T('s3.os', '💻 النظام:'), ltr(String(s.type || s.platform || '—') + ' ' + String(s.release || '')))
    + kvRow(T('s3.architecture', '🧱 المعمارية:'), ltr(s.arch || '—'))
    + kvRow(T('s3.host', '🖥️ الجهاز:'), ltr(s.hostname || '—'))
    + kvRow(T('s3.node_version', '🟢 إصدار Node:'), ltr(s.node_version || '—'))
    + kvRow(T('s3.monitoring_service_up_for', '⏰ خدمة المراقبة مفتوحة منذ:'), esc(sysFmtUptime(s.app_uptime_seconds)))
    + kvRow(T('s3.os_up_for', '🔋 نظام التشغيل منذ:'), esc(sysFmtUptime(s.os_uptime_seconds)));

  // ⏱️ المحرك
  const e = d.engine;
  document.getElementById('sys-engine').textContent = !e ? '—'
    : (e.stalled ? '⚠️ المحرك متوقف أو متعثر! آخر دورة قبل ' + Math.round((e.last_tick_age_ms || 0) / 1000) + ' ثانية — راجع تبويب السجل'
       : '✅ سليم — آخر دورة فحص قبل ' + Math.round((e.last_tick_age_ms || 0) / 1000) + ' ثانية · أجهزة نشطة: ' + (d.devices_active !== null ? d.devices_active : (e.active_devices || '—')) + ' · فحوص جارية: ' + (e.inflight_checks || 0));

  // 🤖 بوت تلجرام (v2.33.0): شغّال/واقف + السبب — أوضح إشارة للمالك عند تعطّل الأوامر
  const botEl = document.getElementById('sys-bot');
  if (botEl) {
    const b = d.bot;
    if (!b) botEl.textContent = T('s2j.service_not_loaded', '— (الخدمة غير محمّلة)');
    else if (b.listening) {
      const age = b.lastPollAt ? Math.round((Date.now() - b.lastPollAt) / 1000) : null;
      const ageTxt = age === null ? 'لم تبدأ بعد' : (age < 60 ? 'قبل ' + age + ' ثانية' : 'قبل ' + Math.round(age / 60) + ' دقيقة');
      botEl.innerHTML = '✅ <b>يعمل</b> — يستمع للأوامر والأزرار (آخر استقبال ' + esc(ageTxt)
        + ' · أوامر مُنفَّذة منذ الإقلاع: <bdi>' + esc(b.updatesHandled) + '</bdi>)'
        + (b.lastPollOk === false && b.lastError ? ' · ⚠️ آخر خطأ: ' + esc(b.lastError) : '');
    } else {
      // السبب الدقيق بدل «متوقف» المبهمة
      const reasons = [];
      if (!b.telegramEnabled) reasons.push('قناة تلجرام غير مفعّلة');
      if (!b.hasToken) reasons.push('توكن البوت غير مضبوط');
      if (!b.hasChatId) reasons.push('معرّف المحادثة غير مضبوط');
      if (b.hasToken && b.hasChatId && b.telegramEnabled && !b.commandsEnabled) reasons.push('مفتاح «بوت تلجرام التفاعلي» مُطفأ');
      if (reasons.length === 0 && b.running) reasons.push('في انتظار أول دورة استقبال');
      botEl.innerHTML = '⛔ <b>متوقف</b>'
        + (reasons.length ? ' — السبب: ' + esc(reasons.join(' · ')) : ' — الحلقة لم تبدأ بعد')
        + (b.lastError ? ' · آخر خطأ: ' + esc(b.lastError) : '');
    }
  }

  // 📡 خطوط البثّ الحيّ (SSE) — v2.33.0: كام شاشة مفتوحة الآن، وهل أسقطنا عميلًا بطيئًا أو رفضنا خطًّا؟ (يُقاس)
  const sseEl = document.getElementById('sys-sse');
  if (sseEl) {
    const s = d.sse;
    if (!s) sseEl.textContent = T('s2j.service_not_loaded', '— (الخدمة غير محمّلة)');
    else {
      const parts = [
        'شاشات مفتوحة الآن: <bdi>' + esc(s.clients) + '</bdi> / ' + esc(s.maxClients),
        'أقصى عدد وصل: <bdi>' + esc(s.peak) + '</bdi>',
        'مُسقَطون (شاشات بطيئة): <bdi>' + esc(s.droppedSlow) + '</bdi>',
        'مرفوضون (تجاوز الحد): <bdi>' + esc(s.rejectedLimit) + '</bdi>',
      ];
      if (s.closedByPolicy) parts.push('أُغلقوا بعد إيقاف العرض: <bdi>' + esc(s.closedByPolicy) + '</bdi>');
      sseEl.innerHTML = parts.join(' · ')
        + '<br><span class="nm-sub">بايتات مُرسَلة منذ الإقلاع: ' + esc(NMFormat.bytes(s.bytesSent)) + '</span>';
    }
  }
  sysSetStatus(T('s2j.last_updated', T('s3.last_update', 'آخر تحديث:')) + ' ' + NMFormat.time(d.ts), false);
  // v2.26.0 — الرسم الزمني: كل 10 دورات نحضّر السجل ونرسم (تقليل حمل الرسم).
  loadAndDrawHistory();
}

function sysStartAuto() {
  sysStopAuto();
  loadSystemStats();
  sysTimer = setInterval(loadSystemStats, SYS_INTERVAL_MS);
}
function sysStopAuto() {
  if (sysTimer) { clearInterval(sysTimer); sysTimer = null; }
}


// ── v2.26.0 — الرسم الزمني (canvas خام بلا مكتبات): خطان — المعالج والرام ──
async function loadAndDrawHistory() {
  if (sysDrawSkip++ % 10 !== 0) return; // كل 50 ثانية (10 دورات × 5ث)
  const cv = document.getElementById('sys-history-canvas');
  if (!cv) return;
  const emptyBox = document.getElementById('sys-history-empty');
  const showEmpty = (on) => { if (emptyBox) emptyBox.classList.toggle('hidden', !on); };
  try {
    const r = await fetch('/api/system/history', { credentials: 'same-origin', cache: 'no-store' });
    const j = await r.json();
    if (!j.success || !Array.isArray(j.data) || j.data.length < 2) {
      // حالة فارغة صريحة بدل مستطيل أبيض صامت
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      showEmpty(true);
      return;
    }
    showEmpty(false);
    const pts = j.data.slice(-120); // آخر 10 دقائق تقريبًا كافية لاتجاه واضح
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const maxT = new Date(pts[pts.length - 1].ts).getTime();
    const minT = new Date(pts[0].ts).getTime() || (maxT - 1);
    const xOf = (ts) => ((new Date(ts).getTime() - minT) / Math.max(1, maxT - minT)) * (W - 24) + 12;
    const yOf = (v) => H - 16 - (Math.max(0, Math.min(100, v)) / 100) * (H - 28);
    // شبكة أفقية 25/50/75%
    ctx.strokeStyle = 'rgba(125,125,125,0.2)';
    ctx.setLineDash([3, 4]);
    for (const yv of [25, 50, 75]) {
      ctx.beginPath(); ctx.moveTo(12, yOf(yv)); ctx.lineTo(W - 12, yOf(yv)); ctx.stroke();
    }
    ctx.setLineDash([]);
    const drawLine = (key, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      let started = false;
      for (const p of pts) {
        const v = p[key];
        if (v === null || v === undefined) { started = false; continue; }
        const x = xOf(p.ts), y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    drawLine('mem_percent', '#3b82f6');
    drawLine('cpu_percent', '#a855f7');
    // تسميات المحور — لون حقيقي من الصفحة (canvas لا يفهم var(--muted) فيبقى أسود غير مرئي ليلًا)
    const muted = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#6b7280';
    // اتجاه تسميات المحور يتبع اتجاه الصفحة: في العربية من نقطة يمينية (كما كانت بالحرف)،
    // وفي الإنجليزية من نقطة يسارية — وإلا خرجت الأرقام خارج اللوحة بعد التحويل لـLTR.
    const ltrAxis = getComputedStyle(cv).direction === 'ltr';
    ctx.fillStyle = muted; ctx.font = '11px sans-serif'; ctx.textAlign = ltrAxis ? 'left' : 'right';
    const xA = ltrAxis ? 6 : 8, xB = ltrAxis ? 8 : 10;
    ctx.fillText('100%', xA, yOf(100) + 4); ctx.fillText('50%', xB, yOf(50) + 4); ctx.fillText('0%', xA, yOf(0) + 4);
  } catch (e) {
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    showEmpty(true);
  }
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
