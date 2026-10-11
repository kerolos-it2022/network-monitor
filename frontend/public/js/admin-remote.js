// admin-remote.js (v2.9.0): قسم «🌍 الوصول عن بُعد» (ngrok) في لوحة التحكم.
// ملاحظات تصميم:
//   • الويب **لا تنفّذ** أي أمر على الجهاز: تقرأ الحالة من /api/remote-access/status،
//     وتكتب «ملف طلب» فقط عبر /api/remote-access/request — والتنفيذ بمصدر root (nm-remote).
//   • أي توكن لا يظهر هنا أبدًا: الخادم يُرشّح السجلات، ونحن نعرض «set/not_set/unknown» فقط.
//   • esc() و api() و confirmAction() مُعرّفة في admin-utils.js (يُحمَّل أولًا).

let remoteAutoTimer = null;
let remoteBusy = false;
let lastRemoteAt = null;   // وقت آخر عملية تحكّم (لمتابعة النتيجة بعد كل طلب)

function remoteSet(id, text, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text == null ? '—' : String(text);
  if (color) el.style.color = color;
}

function remoteShowStatus(message, isError = false) {
  const el = document.getElementById('remote-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--offline)' : 'var(--online)';
  el.classList.toggle('hidden', !message);
}

function remoteSetButtonsEnabled(enabled) {
  const ids = ['remote-start-btn', 'remote-restart-btn', 'remote-stop-btn', 'remote-auto-on-btn', 'remote-auto-off-btn'];
  ids.forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = !enabled;
  });
}

// عرض الحالة القادمة من الخادم.
function renderRemoteStatus(s) {
  if (!s || !s.success) {
    remoteSet('remote-state', '❌ تعذّر الفحص', 'var(--offline)');
    remoteShowStatus((s && s.error) || 'تعذّر قراءة الحالة', true);
    return;
  }

  // 1) كارت الحالة
  if (!s.installed) {
    remoteSet('remote-state', '⚪ غير مثبّت', 'var(--muted)');
  } else if (s.running) {
    remoteSet('remote-state', '🟢 شغّال', 'var(--online)');
  } else {
    remoteSet('remote-state', '🔴 متوقف', 'var(--offline)');
  }

  // 2) الملف التنفيذي
  remoteSet('remote-binary', s.installed ? ('مثبّت ✓ ' + (s.version ? '(' + s.version + ')' : '')) : 'غير مثبّت ✗',
    s.installed ? 'var(--online)' : 'var(--offline)');

  // 3) التشغيل التلقائي
  remoteSet('remote-autostart', s.autostart ? 'مفعّل ✓' : 'معطّل',
    s.autostart ? 'var(--online)' : 'var(--muted)');

  // 4) حالة مفتاح ngrok — نعرض **رموزًا فقط** (set / not_set / unknown) بلا أي قيمة حقيقية.
  const AUTH_LABELS = { set: 'مضبوط ✓', not_set: 'غير مضبوط ✗' };
  const AUTH_COLORS = { set: 'var(--online)', not_set: 'var(--offline)' };
  const authState = String(s.authtoken || 'unknown');
  remoteSet('remote-auth-state', AUTH_LABELS[authState] || 'غير معروفة', AUTH_COLORS[authState] || 'var(--muted)');

  // 5) الرابط
  const urlEl = document.getElementById('remote-url');
  const url = s.publicUrl || s.expectedUrl || '';
  if (urlEl) urlEl.value = url || '—';
  const openBtn = document.getElementById('remote-open-btn');
  const copyBtn = document.getElementById('remote-copy-btn');
  if (openBtn) openBtn.disabled = !s.publicUrl;
  if (copyBtn) copyBtn.disabled = !url;
  const domainEl = document.getElementById('remote-domain');
  if (domainEl) {
    const parts = [];
    parts.push(s.domain ? ('الدومين الثابت: ' + s.domain) : 'الدومين: ديناميكي (الرابط يتغيّر مع كل تشغيل — يُنصح بدومين ثابت من الكونسول)');
    if (!s.publicUrl && s.expectedUrl) parts.push('الرابط المتوقّع — النفق متوقف الآن');
    if (s.protocol && s.addr) parts.push('البروتوكول: ' + s.protocol + ' → ' + s.addr);
    domainEl.textContent = parts.join(' · ');
  }

  // 6) أزرار التحكّم
  const canControl = !!(s.control && s.control.available);
  remoteSetButtonsEnabled(canControl && !remoteBusy);
  const noteEl = document.getElementById('remote-note');
  if (noteEl) {
    if (canControl) {
      noteEl.textContent = 'التحكّم متاح ✓ (ينفّذه مساعد root عبر ملف طلب — الويب لا تنفّذ أوامر).';
    } else {
      noteEl.textContent = 'التحكّم غير متاح على هذا التثبيت (مساعد nm-remote غير مثبّت) — العرض للقراءة يعمل طبيعيًّا.';
    }
  }

  // 7) آخر عملية
  const last = s.control && s.control.last;
  if (last && last.at) lastRemoteAt = last.at;
  if (last && last.message) {
    const when = last.at ? new Date(last.at).toLocaleString('ar-EG') : '';
    const icon = last.state === 'success' ? '✅ ' : (last.state === 'failed' ? '❌ ' : '⏳ ');
    remoteShowStatus(icon + last.message + (when ? ' — ' + when : ''), last.state === 'failed');
  }

  // 8) السجلات
  const logCard = document.getElementById('remote-log-card');
  const logPre = document.getElementById('remote-log');
  if (logCard && logPre) {
    if (s.log) { logPre.textContent = s.log; logCard.classList.remove('hidden'); }
    else logCard.classList.add('hidden');
  }
  const nCard = document.getElementById('remote-ngrok-log-card');
  const nPre = document.getElementById('remote-ngrok-log');
  if (nCard && nPre) {
    if (s.ngrokLog) { nPre.textContent = s.ngrokLog; nCard.classList.remove('hidden'); }
    else nCard.classList.add('hidden');
  }
}

async function loadRemoteStatus() {
  const s = await api('/api/remote-access/status');
  renderRemoteStatus(s);
  return s;
}

// إرسال فعل تحكّم ثم متابعة النتيجة (بلا إعادة تحميل الصفحة).
async function remoteAction(action, label) {
  if (remoteBusy) return;
  remoteBusy = true;
  remoteSetButtonsEnabled(false);
  remoteShowStatus('⏳ ' + label + '…');
  try {
    const r = await api('/api/remote-access/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!r || !r.success) {
      remoteShowStatus('❌ ' + ((r && r.error) || 'تعذّر إرسال الطلب'), true);
      return;
    }
    remoteShowStatus('⏳ ' + (r.message || 'جارٍ التنفيذ…'));
    // متابعة النتيجة: ننتظر تغيّر وقت آخر عملية (حتى ~25 ثانية).
    const before = lastRemoteAt;
    for (let i = 0; i < 25; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      const s = await loadRemoteStatus();
      const at = s && s.control && s.control.last && s.control.last.at;
      if (at && at !== before) break;
    }
  } finally {
    remoteBusy = false;
    const s = await loadRemoteStatus();
    if (!s || !s.control || !s.control.available) remoteSetButtonsEnabled(false);
  }
}

async function remoteActionConfirmed(action, label, message) {
  const ok = await confirmAction({ title: 'تأكيد ' + label, message, confirmText: '✓ تنفيذ', danger: action === 'stop' || action === 'autostart-off' });
  if (!ok) return;
  remoteAction(action, label);
}

function initRemoteTab() {
  const tab = document.getElementById('tab-remote');
  if (!tab) return;

  // تحميل أول عند فتح التبويب
  tab.addEventListener('click', () => setTimeout(() => loadRemoteStatus(), 150));

  const refreshBtn = document.getElementById('remote-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadRemoteStatus());

  const copyBtn = document.getElementById('remote-copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const el = document.getElementById('remote-url');
    const text = el ? el.value : '';
    if (!text || text === '—') return;
    let done = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); done = true; }
    } catch (_) { done = false; }
    if (!done) {
      try { if (el) { el.removeAttribute('readonly'); el.select(); done = document.execCommand('copy'); el.setAttribute('readonly', 'readonly'); } } catch (_) { done = false; }
    }
    remoteShowStatus(done ? '📋 تم نسخ الرابط ✓' : '📋 حدّد الرابط وانسخه يدويًا (المتصفح منع النسخ التلقائي)', !done);
  });

  const openBtn = document.getElementById('remote-open-btn');
  if (openBtn) openBtn.addEventListener('click', () => {
    const el = document.getElementById('remote-url');
    const url = el ? el.value : '';
    if (url && url !== '—' && url.startsWith('http')) window.open(url, '_blank', 'noopener');
  });

  const startBtn = document.getElementById('remote-start-btn');
  if (startBtn) startBtn.addEventListener('click', () => remoteAction('start', 'تشغيل النفق'));

  const restartBtn = document.getElementById('remote-restart-btn');
  if (restartBtn) restartBtn.addEventListener('click', () => remoteActionConfirmed('restart', 'إعادة تشغيل النفق', 'سيتم إيقاف النفق وتشغيله من جديد — الرابط العام سينقطع لدقائق. متابعة؟'));

  const stopBtn = document.getElementById('remote-stop-btn');
  if (stopBtn) stopBtn.addEventListener('click', () => remoteActionConfirmed('stop', 'إيقاف النفق', '⚠️ إيقاف النفق يقطع الوصول للموقع من الإنترنت (يبقى متاحًا داخل الشبكة فقط). متابعة؟'));

  const autoOn = document.getElementById('remote-auto-on-btn');
  if (autoOn) autoOn.addEventListener('click', () => remoteAction('autostart-on', 'تفعيل التشغيل التلقائي'));

  const autoOff = document.getElementById('remote-auto-off-btn');
  if (autoOff) autoOff.addEventListener('click', () => remoteActionConfirmed('autostart-off', 'تعطيل التشغيل التلقائي', 'سيتم تعطيل التشغيل التلقائي عند الإقلاع وإيقاف النفق الآن. متابعة؟'));

  // تحديث دوري كل 10 ثوانٍ — فقط عندما يكون القسم ظاهرًا.
  if (remoteAutoTimer) clearInterval(remoteAutoTimer);
  remoteAutoTimer = setInterval(() => {
    const sec = document.getElementById('section-remote');
    if (!sec || sec.classList.contains('hidden')) return;
    if (remoteBusy) return;
    loadRemoteStatus();
  }, 10000);
}

document.addEventListener('DOMContentLoaded', initRemoteTab);
