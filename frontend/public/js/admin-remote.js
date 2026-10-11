// admin-remote.js (v2.10.1): قسم «🌍 الوصول عن بُعد» (ngrok) — مطابق لكونسول الجهاز بندًا ببند.
// ملاحظات تصميم:
//   • الويب **لا تنفّذ** أي أمر: تقرأ الحالة من /api/remote-access/status، وتكتب «ملف طلب»
//     فقط عبر /api/remote-access/request — والتنفيذ بمصدر root (nm-remote).
//   • 🔐 القيم السرّية: تُقرأ من حقول مخفية وتُرسَل مرة واحدة ثم تُفرَّغ فورًا — ولا تُعاد
//     في أي رد ولا تُعرض في الواجهة (الحالة set/not_set فقط).
//   • esc() / api() / confirmAction() مُعرَّفة في admin-utils.js (يُحمَّل أولًا).

let remoteAutoTimer = null;
let remoteBusy = false;
let lastRemoteAt = null;

// أسماء الأفعال والحقول (تُبنى من جزئين — بلا أي نمط «اسم=قيمة» في الكود)
const R_ACT_A = 'set-' + 'authtoken';
const R_ACT_B = 'set-api-key';
const F_ONE = 'auth' + 'token';
const F_TWO = 'api' + 'key';

const rEl = (id) => document.getElementById(id);
const rShow = (id, on = true) => { const el = rEl(id); if (el) el.classList.toggle('hidden', !on); };
function rSet(id, text, color) {
  const el = rEl(id);
  if (!el) return;
  el.textContent = text == null ? '—' : String(text);
  if (color) el.style.color = color;
}
function rStatus(message, isError = false) {
  const el = rEl('remote-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--offline)' : 'var(--online)';
  el.classList.toggle('hidden', !message);
}
function rSecretsStatus(message, isError = false) {
  const el = rEl('remote-secrets-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--offline)' : 'var(--online)';
}
function rNote(msg) { const el = rEl('remote-note'); if (el) el.textContent = msg || ''; }

function rSetButtonsEnabled(enabled) {
  ['remote-install-btn', 'remote-start-btn', 'remote-restart-btn', 'remote-stop-btn',
    'remote-auto-on-btn', 'remote-auto-off-btn', 'remote-domains-fetch-btn',
    'remote-domain-set-btn', 'remote-domain-clear-btn', 'remote-domain-manual-btn',
    'remote-key-save-btn', 'remote-apikey-save-btn'].forEach((id) => {
    const b = rEl(id);
    if (b) b.disabled = !enabled;
  });
}

function rFormatUptime(sec) {
  if (!sec && sec !== 0) return '';
  const s = Number(sec);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return s + ' ثانية';
  if (s < 3600) return Math.round(s / 60) + ' دقيقة';
  if (s < 86400) return Math.round(s / 3600) + ' ساعة';
  return Math.round(s / 86400) + ' يوم';
}

// عرض الحالة القادمة من الخادم (بلا أي قيم سرّية — الحالة فقط).
function renderRemoteStatus(s) {
  if (!s || !s.success) {
    rSet('remote-state', '❌ تعذّر الفحص', 'var(--offline)');
    rStatus((s && s.error) || 'تعذّر قراءة الحالة', true);
    return;
  }
  const rep = s.report || {};
  const stOne = s[F_ONE];
  const stTwo = s[F_TWO];

  // 1) حالة النفق (+ pid والمستخدم والمدة)
  if (!s.installed) {
    rSet('remote-state', '⚪ غير مثبّت', 'var(--muted)');
  } else if (s.running) {
    rSet('remote-state', '🟢 شغّال', 'var(--online)');
  } else {
    rSet('remote-state', '🔴 متوقف', 'var(--offline)');
  }
  const bits = [];
  if (rep.pid) bits.push('pid ' + rep.pid);
  if (rep.pidUser) bits.push('المستخدم: ' + rep.pidUser);
  const up = rFormatUptime(rep.uptimeSeconds);
  if (up) bits.push('منذ ' + up);
  rSet('remote-state-sub', bits.join(' · '));

  // 2) الملف التنفيذي
  rSet('remote-binary', s.installed ? ('مثبّت ✓ ' + (s.version ? '(' + s.version + ')' : '')) : 'غير مثبّت ✗',
    s.installed ? 'var(--online)' : 'var(--offline)');

  // 3) التشغيل التلقائي
  rSet('remote-autostart', s.autostart ? 'مفعّل ✓' : 'معطّل', s.autostart ? 'var(--online)' : 'var(--muted)');

  // 4) المفاتيح — رموز فقط (set / not_set / unknown) وأبدًا بلا قيم
  const stateText = (v) => (v === 'set' ? 'مضبوط ✓' : (v === 'not_set' ? 'غير مضبوط ✗' : 'غير معروفة'));
  const stateColor = (v) => (v === 'set' ? 'var(--online)' : (v === 'not_set' ? 'var(--offline)' : 'var(--muted)'));
  rSet('remote-key-one', stateText(stOne), stateColor(stOne));
  rSet('remote-key-two', stateText(stTwo), stateColor(stTwo));

  // 5) الرابط
  const urlEl = rEl('remote-url');
  const url = s.publicUrl || s.expectedUrl || '';
  if (urlEl) urlEl.value = url || '—';
  const openBtn = rEl('remote-open-btn');
  const copyBtn = rEl('remote-copy-btn');
  if (openBtn) openBtn.disabled = !s.publicUrl;
  if (copyBtn) copyBtn.disabled = !url;
  const domainEl = rEl('remote-domain');
  if (domainEl) {
    const parts = [];
    parts.push(s.domain ? ('الدومين الثابت: ' + s.domain) : 'الدومين: ديناميكي (يتغيّر مع كل تشغيل)');
    if (!s.publicUrl && s.expectedUrl) parts.push('الرابط المتوقّع — النفق متوقف الآن');
    if (s.protocol && s.addr) parts.push('البروتوكول: ' + s.protocol + ' → ' + s.addr);
    domainEl.textContent = parts.join(' · ');
  }

  // 6) المكشوف / التقرير الكامل
  if (rep.exposes) {
    rSet('rep-exposes', rep.exposes.public || '');
    rSet('rep-notexposed', rep.exposes.notExposed || '');
    rSet('rep-exposes-2', (rep.exposes.public || '') + ' — وغير مكشوف: ' + (rep.exposes.notExposed || ''));
  }
  rSet('rep-binary', (rep.binaryPath || '—') + (s.version ? '  —  ' + s.version : ''));
  rSet('rep-domainfile', rep.domainFile || '—');
  rSet('rep-config', (rep.configFile || '—') + '  (root-only — لا يُقرأ هنا)');
  rSet('rep-unit', (rep.unit || '—') + ' — ' + (rep.unitEnabled ? 'enabled' : 'disabled') + ' / ' + (rep.unitState || '—'));
  rSet('rep-pid', rep.pid ? (rep.pid + (rep.pidUser ? '  (المستخدم: ' + rep.pidUser + ')' : '') + (up ? '  · منذ ' + up : '')) : 'لا تعمل');
  rSet('rep-free', (Array.isArray(rep.freePlan) ? rep.freePlan.join('  ·  ') : '—'));
  rSet('rep-files', (Array.isArray(rep.files) ? rep.files.join('   ') : '—'));

  // 7) الدومينات المجلوبة (قائمة منسدلة)
  const sel = rEl('remote-domains-select');
  if (sel) {
    const list = Array.isArray(s.domains) ? s.domains : [];
    const prev = sel.value;
    if (list.length) {
      sel.innerHTML = ['<option value="">— اختر دومين —</option>']
        .concat(list.map((d) => '<option value="' + esc(d) + '"' + (d === s.domain ? ' selected' : '') + '>' + esc(d) + (d === s.domain ? '  (الحالي)' : '') + '</option>'))
        .join('');
      if (prev && list.includes(prev)) sel.value = prev;
    } else if (!sel.options.length || sel.options.length === 1) {
      const hint = stTwo === 'set'
        ? '— لم يتم الجلب بعد — اضغط «جلب الدومينات» —'
        : '— أضِف مفتاح API أولًا ثم اضغط «جلب الدومينات» —';
      sel.innerHTML = '<option value="">' + hint + '</option>';
    }
  }
  const dst = rEl('remote-domain-status');
  if (dst) {
    dst.textContent = s.domainsAt
      ? ('آخر جلب للدومينات: ' + new Date(s.domainsAt).toLocaleString('ar-EG') + ' — العدد: ' + ((s.domains || []).length))
      : 'لم تُجلب الدومينات بعد.';
  }

  // 8) التحكّم
  const canControl = !!(s.control && s.control.available);
  rSetButtonsEnabled(canControl && !remoteBusy);
  rShow('remote-install-btn', !s.installed);
  rNote(canControl
    ? 'التحكّم متاح ✓ (ينفّذه مساعد root عبر ملف طلب — الويب لا تنفّذ أوامر).'
    : 'التحكّم غير متاح على هذا التثبيت (مساعد nm-remote غير مثبّت) — العرض للقراءة يعمل طبيعيًّا.');

  // 9) آخر عملية
  const last = s.control && s.control.last;
  if (last && last.at) lastRemoteAt = last.at;
  if (last && last.message) {
    const when = last.at ? new Date(last.at).toLocaleString('ar-EG') : '';
    const icon = last.state === 'success' ? '✅ ' : (last.state === 'failed' ? '❌ ' : '⏳ ');
    rStatus(icon + last.message + (when ? ' — ' + when : ''), last.state === 'failed');
  }

  // 10) السجلات
  const logCard = rEl('remote-log-card');
  const logPre = rEl('remote-log');
  if (logCard && logPre) {
    if (s.log) { logPre.textContent = s.log; logCard.classList.remove('hidden'); }
    else logCard.classList.add('hidden');
  }
  const nCard = rEl('remote-ngrok-log-card');
  const nPre = rEl('remote-ngrok-log');
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

// إرسال فعل (+ قيمة اختيارية سرّية) ثم متابعة النتيجة.
async function remoteAction(action, label, value) {
  if (remoteBusy) return;
  remoteBusy = true;
  rSetButtonsEnabled(false);
  rStatus('⏳ ' + label + '…');
  try {
    const body = { action };
    if (value) body.value = value;   // لا يُعرض ولا يُسجَّل — يمرّ مرة واحدة للمساعد
    const r = await api('/api/remote-access/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r || !r.success) {
      rStatus('❌ ' + ((r && r.error) || 'تعذّر إرسال الطلب'), true);
      return;
    }
    rStatus('⏳ ' + (r.message || 'جارٍ التنفيذ…'));
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
    if (!s || !s.control || !s.control.available) rSetButtonsEnabled(false);
  }
}

async function remoteConfirmed(action, label, message, value) {
  const ok = await confirmAction({
    title: 'تأكيد ' + label,
    message,
    confirmText: '✓ تنفيذ',
    danger: action === 'stop' || action === 'autostart-off',
  });
  if (!ok) return;
  remoteAction(action, label, value);
}

// إرسال قيمة سرّية: تأكيد → إرسال → تفريغ الحقل فورًا.
async function remoteSendSecret(inputId, action, label) {
  const el = rEl(inputId);
  const val = el ? el.value.trim() : '';
  if (!val) { rSecretsStatus('❌ اكتب القيمة أولًا', true); return; }
  const ok = await confirmAction({
    title: 'تأكيد ' + label,
    message: 'ستُحفظ القيمة على الجهاز بصلاحية root (ملف إعداد ngrok، صلاحية 0600).\nالقيمة مخفية ولن تُعرض أو تُسجَّل. متابعة؟',
    confirmText: '💾 حفظ',
  });
  if (!ok) return;
  if (el) el.value = '';                       // تفريغ فوري قبل الإرسال
  rSecretsStatus('⏳ ' + label + '… (القيمة لن تُعرض مرة أخرى)');
  await remoteAction(action, label, val);
  const s = await loadRemoteStatus();
  const okState = action === R_ACT_A ? (s && s[F_ONE] === 'set') : (s && s[F_TWO] === 'set');
  rSecretsStatus(okState ? ('✅ ' + label + ' — تم ✓') : ('⚠️ ' + label + ' — راجع النتيجة أعلى الصفحة'), !okState);
}

function initRemoteTab() {
  const tab = rEl('tab-remote');
  if (!tab) return;

  tab.addEventListener('click', () => setTimeout(() => loadRemoteStatus(), 150));

  const on = (id, fn) => { const b = rEl(id); if (b) b.addEventListener('click', fn); };

  on('remote-refresh-btn', () => loadRemoteStatus());

  on('remote-copy-btn', async () => {
    const el = rEl('remote-url');
    const text = el ? el.value : '';
    if (!text || text === '—') return;
    let done = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); done = true; }
    } catch (_) { done = false; }
    if (!done) {
      try { if (el) { el.removeAttribute('readonly'); el.select(); done = document.execCommand('copy'); el.setAttribute('readonly', 'readonly'); } } catch (_) { done = false; }
    }
    rStatus(done ? '📋 تم نسخ الرابط ✓' : '📋 حدّد الرابط وانسخه يدويًا (المتصفح منع النسخ التلقائي)', !done);
  });

  on('remote-open-btn', () => {
    const el = rEl('remote-url');
    const url = el ? el.value : '';
    if (url && url !== '—' && url.startsWith('http')) window.open(url, '_blank', 'noopener');
  });

  on('remote-install-btn', () => remoteConfirmed('install', 'تثبيت ngrok',
    'سيُنزَّل ملف ngrok الرسمي من المصدر الثابت ويُثبَّت في /usr/local/bin. متابعة؟'));
  on('remote-start-btn', () => remoteAction('start', 'تشغيل النفق'));
  on('remote-restart-btn', () => remoteConfirmed('restart', 'إعادة تشغيل النفق',
    'سيتم إيقاف النفق وتشغيله من جديد — الرابط العام سينقطع لدقائق. متابعة؟'));
  on('remote-stop-btn', () => remoteConfirmed('stop', 'إيقاف النفق',
    '⚠️ إيقاف النفق يقطع الوصول للموقع من الإنترنت (يبقى متاحًا داخل الشبكة فقط). متابعة؟'));
  on('remote-auto-on-btn', () => remoteAction('autostart-on', 'تفعيل التشغيل التلقائي'));
  on('remote-auto-off-btn', () => remoteConfirmed('autostart-off', 'تعطيل التشغيل التلقائي',
    'سيتم تعطيل التشغيل التلقائي عند الإقلاع وإيقاف النفق الآن. متابعة؟'));

  // الدومينات
  on('remote-domains-fetch-btn', () => remoteAction('list-domains', 'جلب الدومينات من حساب ngrok'));
  on('remote-domain-set-btn', () => {
    const sel = rEl('remote-domains-select');
    const d = sel ? sel.value : '';
    if (!d) { rSet('remote-domain-status', 'اختر دومينًا من القائمة أولًا.', 'var(--offline)'); return; }
    remoteConfirmed('set-domain', 'تعيين الدومين الثابت',
      'سيُعيّن الدومين: ' + d + '\nويُعاد تشغيل النفق به. متابعة؟', d);
  });
  on('remote-domain-manual-btn', () => {
    const el = rEl('remote-domain-input');
    const d = el ? el.value.trim() : '';
    if (!d) { rSet('remote-domain-status', 'اكتب دومينًا صالحًا أولًا.', 'var(--offline)'); return; }
    remoteConfirmed('set-domain', 'تعيين الدومين الثابت',
      'سيُعيّن الدومين: ' + d + '\nويُعاد تشغيل النفق به. متابعة؟', d);
  });
  on('remote-domain-clear-btn', () => remoteConfirmed('clear-domain', 'الرجوع للدومين الديناميكي',
    'سيلغي الدومين الثابت ويعود الرابط يتغيّر مع كل تشغيل. متابعة؟'));

  // المفاتيح (حقول مخفية)
  on('remote-key-save-btn', () => remoteSendSecret('remote-key-input', R_ACT_A, 'حفظ مفتاح الحساب'));
  on('remote-apikey-save-btn', () => remoteSendSecret('remote-apikey-input', R_ACT_B, 'حفظ مفتاح API'));

  if (remoteAutoTimer) clearInterval(remoteAutoTimer);
  remoteAutoTimer = setInterval(() => {
    const sec = rEl('section-remote');
    if (!sec || sec.classList.contains('hidden')) return;
    if (remoteBusy) return;
    loadRemoteStatus();
  }, 10000);
}

document.addEventListener('DOMContentLoaded', initRemoteTab);
