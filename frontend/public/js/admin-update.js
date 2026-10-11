// admin-update.js (v2.10.0) — صفحة «🔄 تحديثات النظام» في لوحة التحكم.
// ما الذي تغيّر عن النسخة السابقة؟
//   1) بنية جديدة: شريط حالة واحد (الحالي · المتاح · الحالة · آخر فحص) بدل 3 كروت + بنرات متفرقة.
//   2) مصدر واحد لرسالة الحالة + حذف الكارت الداخلي المكرر للـ changelog (نافذة واحدة فقط).
//   3) شارة برتقالية على التبويب عند توفّر تحديث + فحص تلقائي (عند الفتح + كل 6 ساعات).
//   4) زر واحد «🛡️ نسخة احتياطية + تحديث» (إنشاء نسخة ثم طلب التحديث).
//   5) «↩️ الرجوع لإصدار أقدم» من قائمة وسوم GitHub عبر نفس مسار الطلب الآمن.
//   6) تقدّم على شكل خطوات + سجل قابل للطي + سجل عمليات + زر نسخ السجل.
// ⚠️ قيد أمني: الويب لا تنفّذ أوامر — على الأبلاينس نكتب «ملف طلب» فقط والمساعد root ينفّذ.
// esc() / api() / confirmAction() مُعرَّفة في admin-utils.js (يُحمَّل أولًا).

let updMode = 'plain';          // appliance | plain
let updBusy = false;
let updLastCheck = null;        // آخر نتيجة فحص ناجحة
let updProgressTimer = null;
const UPD_LAST_KEY = 'nm.updatesLastCheckAt';
const UPD_AUTO_MS = 6 * 60 * 60 * 1000;      // فحص تلقائي كل 6 ساعات
const UPD_FRESH_MS = 15 * 60 * 1000;         // «طازج» = خلال 15 دقيقة (لتجنّب نداءات متكرّرة)

const updEl = (id) => document.getElementById(id);
const updShow = (id, on = true) => { const el = updEl(id); if (el) el.classList.toggle('hidden', !on); };
function updSet(id, txt, cls) {
  const el = updEl(id);
  if (!el) return;
  el.textContent = txt == null ? '—' : String(txt);
  if (cls !== undefined) el.className = cls;
}
function updNote(msg) { const el = updEl('upd-note'); if (el) el.textContent = msg || ''; }
function updBadge(on) { const b = updEl('upd-tab-badge'); if (b) b.classList.toggle('hidden', !on); }

function updSetBusy(on) {
  updBusy = on;
  ['upd-check-btn', 'upd-safe-btn', 'upd-rollback-btn', 'upd-download-btn', 'upd-apply-btn'].forEach((id) => {
    const b = updEl(id);
    if (b) b.disabled = on;
  });
  // منع إغلاق الصفحة أثناء عملية تحديث جارية
  window.onbeforeunload = on ? (e) => { e.preventDefault(); e.returnValue = ''; return ''; } : null;
}

// ── آخر فحص (يُحفظ محليًّا) ──
function updReadLast() { try { return Number(localStorage.getItem(UPD_LAST_KEY)) || 0; } catch (e) { return 0; } }
function updRenderLast(ts) {
  const t = ts || updReadLast();
  if (!t) { updSet('upd-lastcheck', '—'); return; }
  const mins = Math.round((Date.now() - t) / 60000);
  updSet('upd-lastcheck', mins < 1 ? 'الآن' : (mins < 60 ? `قبل ${mins} دقيقة` : `قبل ${Math.round(mins / 60)} ساعة`));
}

// ── خطوات التقدّم ──
const UPD_STEPS = [
  [['تنزيل', 'جلب', 'الأرشيف', 'git pull'], 'download'],
  [['ملفات', 'rsync', 'نسخ ملفات'], 'files'],
  [['npm', 'تبعيات'], 'deps'],
  [['تشغيل', 'restart', 'success'], 'restart'],
];
function updStepFromMessage(msg) {
  const m = String(msg || '').toLowerCase();
  for (const [keys, step] of UPD_STEPS) {
    if (keys.some((k) => m.includes(String(k).toLowerCase()))) return step;
  }
  return null;
}
function updStepsReset() {
  document.querySelectorAll('#upd-steps li').forEach((li) => li.classList.remove('active', 'done'));
}
function updStepSet(step, state) {
  const li = document.querySelector(`#upd-steps li[data-step="${step}"]`);
  if (!li) return;
  li.classList.remove('active', 'done');
  if (state) li.classList.add(state);
}
function updStepsAllDone() {
  document.querySelectorAll('#upd-steps li').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
}

// ── كشف وضع الأبلاينس ──
async function updDetectMode() {
  const r = await api('/api/appliance-update/mode');
  updMode = r && r.success && r.appliance ? 'appliance' : 'plain';
  updShow('upd-plain-actions', updMode !== 'appliance');
  updShow('upd-rollback-btn', updMode === 'appliance');
  updNote(updMode === 'appliance'
    ? '🔐 وضع الأبلاينس: التنفيذ بصلاحية root عبر «ملف طلب» (بلا أوامر من الويب) — والتحديث يشمل ملفات التطبيق فقط.'
    : '💻 تثبيت عادي (Git): التحديث يتم بسحب الفرع + تثبيت التبعيات + إعادة تشغيل الخدمة.');
  return updMode;
}

// ── الفحص ──
async function updCheck(silent = false) {
  const btn = updEl('upd-check-btn');
  if (btn && !silent) { btn.disabled = true; btn.textContent = '⏳ جارٍ الفحص…'; }
  if (!silent) updSet('upd-state', '⏳ جارٍ الفحص…', 'upd-hero-value upd-muted');
  try {
    const r = await api('/api/update/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' }),
    });
    if (!r || !r.success) {
      updSet('upd-state', '❌ تعذّر الفحص', 'upd-hero-value upd-bad');
      updSet('upd-latest-sub', (r && r.error) ? String(r.error).slice(0, 80) : '');
      if (!silent) {
        updNote('تعذّر فحص التحديثات — تأكّد من الإنترنت أو حدود GitHub API.');
        showToast('❌ تعذّر فحص التحديثات', { type: 'error', duration: 7000 });
      }
      return null;
    }
    updLastCheck = r;
    const cur = String(r.currentVersion || '—').replace(/^v/i, '');
    const lat = String(r.latestVersion || '—').replace(/^v/i, '');
    const has = !!(r.hasUpdate || r.updateAvailable);
    updSet('upd-current', 'v' + cur, 'upd-hero-value');
    updSet('upd-latest', 'v' + lat, 'upd-hero-value ' + (has ? 'upd-warn' : 'upd-ok'));
    updSet('upd-latest-sub', has ? 'يتوفّر تحديث جديد 🟠' : 'أنت على أحدث إصدار ✓', 'upd-hero-sub');
    updSet('upd-state', has ? '🟠 تحديث متاح' : '🟢 محدَّث', 'upd-hero-value ' + (has ? 'upd-warn' : 'upd-ok'));
    const now = Date.now();
    try { localStorage.setItem(UPD_LAST_KEY, String(now)); } catch (e) { /* تجاهل */ }
    updRenderLast(now);
    updBadge(has);
    // v2.10.5 — إشعار بنتيجة الفحص (وإلا تبدو الصفحة صامتة)؛ ويظهر أيضًا في الفحص التلقائي لو وُجد تحديث
    if (!silent || has) {
      showToast(has ? ('🟠 يتوفّر تحديث جديد: v' + lat) : ('🟢 أنت على أحدث إصدار (v' + cur + ')'),
        { type: has ? 'warning' : 'success', duration: has ? 6000 : 3000 });
    }
    updShow('upd-changelog-btn', has);
    updShow('upd-safe-btn', has && updMode === 'appliance');
    if (updMode === 'plain') { updShow('upd-download-btn', has); updShow('upd-apply-btn', has); }
    return r;
  } catch (e) {
    updSet('upd-state', '❌ خطأ', 'upd-hero-value upd-bad');
    if (!silent) updNote('خطأ: ' + e.message);
    return null;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 فحص التحديثات'; }
  }
}

// ── متابعة تنفيذ التحديث (أبلاينس: من ملف الحالة + السجل) ──
function updFollowAppliance() {
  const started = Date.now();
  updSetBusy(true);
  updShow('upd-progress-card', true);
  updStepsReset();
  updStepSet('download', 'active');
  if (updProgressTimer) clearInterval(updProgressTimer);
  updProgressTimer = setInterval(async () => {
    try {
      const p = await api('/api/appliance-update/progress');
      const st = p && p.state;
      if (p && typeof p.log === 'string' && p.log) { const el = updEl('upd-log'); if (el) el.textContent = p.log; }
      if (st && st.message) {
        updSet('upd-progress-text', st.message);
        const step = updStepFromMessage(st.message);
        if (step) updStepSet(step, 'active');
      }
      if (st && st.state === 'success') {
        clearInterval(updProgressTimer); updProgressTimer = null;
        updStepsAllDone();
        updSet('upd-progress-text', '✅ ' + st.message);
        updNote('✅ ' + st.message + ' — جارٍ إعادة تحميل الصفحة…');
        showToast('✅ ' + st.message, { type: 'success', duration: 6000 });
        updSetBusy(false);
        setTimeout(() => location.reload(), 3000);
        return;
      }
      if (st && st.state === 'failed') {
        clearInterval(updProgressTimer); updProgressTimer = null;
        updSetBusy(false);
        updSet('upd-progress-text', '❌ ' + st.message);
        updNote('❌ فشل التحديث: ' + st.message + ' — راجع السجل التفصيلي.');
        showToast('❌ فشل التحديث: ' + st.message, { type: 'error', duration: 10000 });
      }
    } catch (e) {
      // الخدمة قد تكون في لحظة إعادة تشغيل — نواصل المحاولة
    }
    if (Date.now() - started > 20 * 60 * 1000) {
      clearInterval(updProgressTimer); updProgressTimer = null;
      updSetBusy(false);
      updNote('⏳ انتهت مدة المتابعة — راجع سجل التحديث أو أعد الفحص.');
    }
  }, 2500);
}

// ── 🛡️ نسخة احتياطية ثم تحديث (ضغطة واحدة) ──
async function updSafeRun() {
  const ok = await confirmAction({
    title: '🛡️ نسخة احتياطية + تحديث',
    message: 'سيتم:\n① إنشاء نسخة احتياطية من قاعدة البيانات\n② تحديث النظام وإعادة تشغيل الخدمة\n\nمتابعة؟',
    confirmText: '🛡️ تنفيذ',
    danger: false,
  });
  if (!ok) return;
  updSetBusy(true);
  try {
    updNote('⏳ إنشاء نسخة احتياطية…');
    showToast('⏳ إنشاء نسخة احتياطية…', { type: 'info', duration: 3000 });
    const b = await api('/api/backup/create', { method: 'POST' });
    if (!b || !b.success) throw new Error((b && b.error) || 'فشل إنشاء النسخة الاحتياطية');
    updNote('✅ ' + (b.message || 'تم إنشاء النسخة الاحتياطية') + ' — بدء التحديث…');
    showToast('✅ ' + (b.message || 'تم إنشاء النسخة الاحتياطية'), { type: 'success', duration: 4500 });
    const r = await api('/api/appliance-update/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'latest' }),
    });
    if (!r || !r.success) throw new Error((r && r.error) || 'تعذّر إرسال طلب التحديث');
    updFollowAppliance();
  } catch (e) {
    updSetBusy(false);
    updNote('❌ ' + e.message);
    showToast('❌ ' + e.message, { type: 'error', duration: 9000 });
  }
}

// ── ↩️ الرجوع لإصدار أقدم ──
async function updOpenRollback() {
  const modal = updEl('rollback-modal');
  const listEl = updEl('rollback-list');
  const stEl = updEl('rollback-status');
  if (!modal || !listEl) return;
  modal.classList.remove('hidden');
  if (stEl) stEl.textContent = '';
  listEl.innerHTML = '<div style="padding:0.8rem; color:var(--muted);">⏳ جارٍ جلب الإصدارات…</div>';
  const r = await api('/api/appliance-update/tags');
  const tags = (r && r.success && Array.isArray(r.tags)) ? r.tags : [];
  const cur = updLastCheck && updLastCheck.currentVersion ? 'v' + String(updLastCheck.currentVersion).replace(/^v/i, '') : '';
  if (!tags.length) {
    listEl.innerHTML = '<div style="padding:0.8rem; color:var(--muted);">' + esc((r && r.error) || 'تعذّر جلب قائمة الإصدارات') + '</div>';
    showToast('❌ ' + ((r && r.error) || 'تعذّر جلب قائمة الإصدارات'), { type: 'error', duration: 7000 });
    return;
  }
  listEl.innerHTML = tags.map((t) => {
    const isCur = t === cur;
    return '<div class="upd-row" style="padding:0.55rem 0.8rem; align-items:center;">'
      + '<span style="font-family:monospace;">' + esc(t) + (isCur ? ' <span style="color:var(--online);">(الحالي)</span>' : '') + '</span>'
      + (isCur ? '' : '<button type="button" class="btn" data-tag="' + esc(t) + '" style="padding:0.2rem 0.6rem; font-size:0.8rem;">↩️ الرجوع</button>')
      + '</div>';
  }).join('');
  listEl.querySelectorAll('button[data-tag]').forEach((b) => {
    b.addEventListener('click', () => updRollbackTo(b.getAttribute('data-tag')));
  });
  if (stEl && r && r.cached) stEl.textContent = 'قائمة من الكاش (يُحدَّث كل 10 دقائق).';
}

async function updRollbackTo(tag) {
  const ok = await confirmAction({
    title: 'الرجوع إلى ' + tag,
    message: 'سيتم تثبيت الإصدار ' + tag + ' وإعادة تشغيل الخدمة.\nيُنصح بعمل نسخة احتياطية أولاً.',
    confirmText: '↩️ رجوع',
    danger: true,
  });
  if (!ok) return;
  const stEl = updEl('rollback-status');
  const r = await api('/api/appliance-update/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  });
  if (!r || !r.success) { if (stEl) stEl.textContent = '❌ ' + ((r && r.error) || 'تعذّر إرسال الطلب'); return; }
  if (stEl) stEl.textContent = '⏳ ' + (r.message || 'جارٍ التنفيذ…');
  updShow('rollback-modal', false);
  showToast('⏳ ' + (r.message || 'جارٍ التنفيذ…'), { type: 'info', duration: 3500 });
  updFollowAppliance();
}

// ── مسار التثبيت العادي (Git): تحميل (SSE) + تطبيق ──
async function updPlainDownload() {
  const dlBtn = updEl('upd-download-btn');
  const applyBtn = updEl('upd-apply-btn');
  const logEl = updEl('upd-log');
  updShow('upd-progress-card', true);
  updStepsReset();
  updStepSet('download', 'active');
  if (dlBtn) dlBtn.disabled = true;
  if (applyBtn) applyBtn.disabled = true;
  if (logEl) logEl.textContent = '⏳ بدء التحميل…\n';
  try {
    const res = await fetch('/api/update/download?branch=' + encodeURIComponent('main'), { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!res.body) throw new Error('لا يوجد بثّ بيانات');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        const lines = part.trim().split('\n');
        let ev = 'line', data = '';
        for (const ln of lines) {
          if (ln.startsWith('event:')) ev = ln.slice(6).trim();
          else if (ln.startsWith('data:')) data = ln.slice(5).trim();
        }
        if (!data) continue;
        let js = null;
        try { js = JSON.parse(data); } catch (e) { js = null; }
        const msg = (js && js.message) ? js.message : data;
        if (ev === 'line' || ev === 'start') {
          if (logEl) logEl.textContent += msg + '\n';
          const step = updStepFromMessage(msg);
          if (step) updStepSet(step, 'active');
          updSet('upd-progress-text', msg);
        } else if (ev === 'progress' && js) {
          updSet('upd-progress-text', `⬇️ ${js.percent}% (${js.downloaded} / ${js.total})`);
        } else if (ev === 'error') {
          throw new Error(msg);
        } else if (ev === 'done') {
          updStepSet('download', 'done');
          updSet('upd-progress-text', msg);
          if (applyBtn) { applyBtn.disabled = false; applyBtn.style.display = 'inline-block'; }
        }
      }
    }
  } catch (e) {
    if (logEl) logEl.textContent += '\n❌ ' + e.message + '\n';
    updNote('❌ خطأ في التحميل: ' + e.message);
  } finally {
    if (dlBtn) dlBtn.disabled = false;
  }
}

async function updPlainApply() {
  const ok = await confirmAction({
    title: 'تأكيد تطبيق التحديث',
    message: 'سيتم سحب الفرع، تثبيت التبعيات، وإعادة تشغيل الخدمة. متابعة؟',
    confirmText: '🚀 متابعة',
    danger: true,
  });
  if (!ok) return;
  updSetBusy(true);
  updShow('upd-progress-card', true);
  updNote('⏳ جارٍ تطبيق التحديث…');
  try {
    const r = await api('/api/update/perform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' }),
    });
    if (!r || !r.success) throw new Error((r && r.error) || 'فشل تنفيذ التحديث');
    updStepsAllDone();
    updNote('✅ ' + (r.message || 'تم التحديث') + ' — جارٍ إعادة تحميل الصفحة…');
    updSetBusy(false);
    setTimeout(() => location.reload(), 3000);
  } catch (e) {
    updSetBusy(false);
    updNote('❌ ' + e.message);
  }
}

// ── سجل عمليات التحديث ──
async function updLoadHistory() {
  const el = updEl('upd-history');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--muted);">⏳…</span>';
  const r = await api('/api/update/history');
  const rows = (r && r.success && Array.isArray(r.history)) ? r.history : (Array.isArray(r) ? r : []);
  if (!rows.length) {
    const p = (updMode === 'appliance') ? await api('/api/appliance-update/progress') : null;
    const st = p && p.state;
    el.innerHTML = (st && st.message)
      ? '<div class="upd-row"><span>آخر عملية (مساعد الأبلاينس)</span><span>' + esc(st.message) + (st.at ? ' — ' + esc(st.at) : '') + '</span></div>'
      : '<span style="color:var(--muted);">لا توجد عمليات مسجّلة بعد.</span>';
    return;
  }
  el.innerHTML = rows.slice(0, 10).map((h) => {
    const when = esc(h.at || h.date || h.time || '');
    const what = esc(h.message || h.text || h.tag || h.version || JSON.stringify(h));
    return '<div class="upd-row"><span>' + when + '</span><span>' + what + '</span></div>';
  }).join('');
}

function updCopyAll() {
  const parts = [];
  const hist = updEl('upd-history');
  if (hist) parts.push('سجل عمليات التحديث:\n' + hist.innerText);
  const log = updEl('upd-log');
  if (log && log.textContent) parts.push('\nسجل التحديث التفصيلي:\n' + log.textContent);
  const txt = parts.join('\n') || 'لا يوجد سجل';
  let done = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); done = true; }
  } catch (e) { done = false; }
  if (!done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      done = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { done = false; }
  }
  updNote(done ? '📋 تم نسخ السجل ✓' : '📋 تعذّر النسخ التلقائي — حدّد النص وانسخه يدويًا');
  showToast(done ? '📋 تم نسخ السجل ✓' : 'تعذّر النسخ التلقائي — حدّد النص يدويًا', { type: done ? 'success' : 'warning', duration: 4000 });
}

// ── التشغيل ──
async function updInit() {
  const tab = updEl('tab-updates');
  if (!tab) return;

  await updDetectMode();
  updRenderLast();
  updCheck(true);                     // فحص أولي (صامت) لرسم شريط الحالة
  updLoadHistory();

  const checkBtn = updEl('upd-check-btn');
  if (checkBtn) checkBtn.addEventListener('click', () => updCheck(false));

  const safeBtn = updEl('upd-safe-btn');
  if (safeBtn) safeBtn.addEventListener('click', updSafeRun);

  const rollbackBtn = updEl('upd-rollback-btn');
  if (rollbackBtn) rollbackBtn.addEventListener('click', updOpenRollback);

  const dlBtn = updEl('upd-download-btn');
  if (dlBtn) dlBtn.addEventListener('click', updPlainDownload);

  const applyBtn = updEl('upd-apply-btn');
  if (applyBtn) applyBtn.addEventListener('click', updPlainApply);

  const copyBtn = updEl('upd-log-copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', updCopyAll);

  const chBtn = updEl('upd-changelog-btn');
  if (chBtn) chBtn.addEventListener('click', () => {
    const modal = updEl('changelog-modal');
    const content = updEl('changelog-content');
    if (content) content.textContent = (updLastCheck && updLastCheck.changelog) || 'لا توجد تغييرات مسجّلة';
    if (modal) modal.classList.remove('hidden');
  });
  const chClose = updEl('changelog-close');
  if (chClose) chClose.addEventListener('click', () => updShow('changelog-modal', false));
  const chModal = updEl('changelog-modal');
  if (chModal) chModal.addEventListener('click', (e) => { if (e.target === chModal) updShow('changelog-modal', false); });

  // نافذة الرجوع
  const rbClose = updEl('rollback-close');
  if (rbClose) rbClose.addEventListener('click', () => updShow('rollback-modal', false));
  const rbModal = updEl('rollback-modal');
  if (rbModal) rbModal.addEventListener('click', (e) => { if (e.target === rbModal) updShow('rollback-modal', false); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    updShow('rollback-modal', false);
    updShow('changelog-modal', false);
  });

  // عند فتح التبويب: تحديث إن كانت البيانات قديمة + تحديث سجل العمليات
  tab.addEventListener('click', () => {
    const last = updReadLast();
    if (!updBusy && (!last || Date.now() - last > UPD_FRESH_MS)) updCheck(true);
    updLoadHistory();
  });

  // فحص تلقائي كل 6 ساعات (يعمل حتى لو التبويب مقفول)
  setInterval(() => { if (!updBusy) updCheck(true); }, UPD_AUTO_MS);
}

document.addEventListener('DOMContentLoaded', updInit);
