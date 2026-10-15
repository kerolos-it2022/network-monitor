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
let updElapsedTimer = null;   // v2.11.1 — عدّاد الزمن الظاهر أثناء التحديث
const UPD_LAST_KEY = 'nm.updatesLastCheckAt';
// v2.11.8 — آخر حالة «إعادة تشغيل الجهاز» شوهدت (لمنع حلقة إعادة تحميل بعد الإقلاع).
const UPD_REBOOT_KEY = 'nm.updRebootSeenAt';
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

// ── خطوات التقدّم (v2.11.1) ──
// نصوص المساعد nm-update العربية حرفيًّا: «بدأ التحديث إلى X» · «تحديث ملفات التطبيق» ·
// «تحديث التبعيات (npm ci)» · «تحديث أدوات النظام (المساعدون والوحدات)» · «إعادة تشغيل الخدمة» ·
// «تم التحديث إلى X بنجاح». (قبل v2.11.1 كانت المطابقة بكلمات إنجليزية فلا تُضاء معظم الخطوات.)
const UPD_STEPS = [
  [['بدأ التحديث'], 'start', 10],
  [['ملفات التطبيق', 'تنزيل', 'الأرشيف'], 'files', 40],
  [['التبعيات', 'npm'], 'deps', 70],
  [['أدوات النظام'], 'tools', 85],
  [['إعادة تشغيل', 'restart'], 'restart', 95],
];
function updStepFromMessage(msg) {
  const m = String(msg || '').toLowerCase();
  for (const [keys, step, pct] of UPD_STEPS) {
    if (keys.some((k) => m.includes(String(k).toLowerCase()))) return { step, pct };
  }
  if (m.includes('تم التحديث') || m.includes('أحدث إصدار')) return { step: 'restart', pct: 100 };
  return null;
}
// شريط النسبة + المرحلة الحالية.
function updSetBar(pct, phase) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const fill = updEl('upd-bar-fill'); const bar = updEl('upd-bar');
  const pctEl = updEl('upd-bar-pct'); const ph = updEl('upd-phase');
  if (fill) fill.style.width = v + '%';
  if (bar) bar.setAttribute('aria-valuenow', String(v));
  if (pctEl) pctEl.textContent = v + '%';
  if (ph && phase) ph.textContent = phase;
}
// بانر إعادة التشغيل (يظهر عند مرحلة «إعادة تشغيل الخدمة»).
function updShowRestartBanner(on) {
  const el = updEl('upd-restart-banner');
  if (el) el.classList.toggle('hidden', !on);
}
// v2.11.3 — كاشف التعطّل: لو لم تتحدّث حالة المساعد منذ أكثر من 3 دقائق أثناء «جارٍ»
// (خطوة npm ci في المساعد بلا مهلة؛ وقد تعلّق عند تعطّل الشبكة مع npm registry) نُظهر
// تنبيهًا مع زرّي «فحص الحالة الآن» و«نسخ السجل» — بدل شاشة واقفة صامتة.
const UPD_STALL_MS = 3 * 60 * 1000;
function updShowStall(on, mins) {
  const el = updEl('upd-stall-banner');
  if (!el) return;
  const m = updEl('upd-stall-mins');
  if (on && m) m.textContent = String(mins);
  el.classList.toggle('hidden', !on);
}
// v2.11.8 — بعد اكتمال التحديث يعيد المساعد تشغيل الجهاز كاملًا؛ ننتظر عودة الخادم
// (فحص كل 5 ثوانٍ) ثم نُحدّث الصفحة تلقائيًا — بدل إعادة تحميل فورية تفشل أثناء الإقلاع.
function updWaitForReboot() {
  if (window.__updRebootWait) return;
  let tries = 0;
  window.__updRebootWait = setInterval(async () => {
    tries += 1;
    let up = false;
    try {
      const r = await fetch('/api/appliance-update/progress', { credentials: 'same-origin', cache: 'no-store' });
      // أي ردّ من الخادم (حتى 401 — الجلسة تُطلب من جديد بعد الإقلاع) يعني أنه عاد.
      up = !(r.status === 502 || r.status === 503 || r.status === 504);
    } catch (e) { up = false; }
    if (up) {
      clearInterval(window.__updRebootWait); window.__updRebootWait = null;
      location.reload();
      return;
    }
    if (tries > 120) { // ≈ 10 دقائق حد أقصى
      clearInterval(window.__updRebootWait); window.__updRebootWait = null;
      updNote('⏳ لم يعد الجهاز بعد — افتح الصفحة يدويًّا عند جاهزيته.');
    }
  }, 5000);
}

// قراءة واحدة لحالة التقدّم + رسمها (تُستعمل من المؤقّت ومن زرّ «فحص الحالة الآن»).
async function updRenderProgress() {
  let p = null;
  try { p = await api('/api/appliance-update/progress'); } catch (e) { return; } // الخدمة قد تكون في إعادة تشغيل
  const st = p && p.state;
  if (p && typeof p.log === 'string' && p.log) { const el = updEl('upd-log'); if (el) el.textContent = p.log; }
  // v2.11.8 — حالة «إعادة تشغيل الجهاز»: نهاية طبيعية للتحديث على الأبلاينس.
  if (st && st.state === 'rebooting') {
    clearInterval(updProgressTimer); updProgressTimer = null;
    if (updElapsedTimer) { clearInterval(updElapsedTimer); updElapsedTimer = null; }
    updStepsAllDone();
    updSetBar(100, 'اكتمل ✓');
    updShowStall(false);
    updShowRestartBanner(true);
    updSet('upd-progress-text', '🔄 ' + st.message);
    updSetBusy(false);
    let seen = '';
    try { seen = localStorage.getItem(UPD_REBOOT_KEY) || ''; } catch (e) { /* تجاهل */ }
    const atKey = String(st.at || st.message || 'reboot');
    if (seen === atKey) {
      // الصفحة فُتحت بعد عودة الجهاز — رسالة معلوماتية فقط (بلا انتظار أو إعادة تحميل).
      updNote('✅ ' + st.message);
    } else {
      try { localStorage.setItem(UPD_REBOOT_KEY, atKey); } catch (e) { /* تجاهل */ }
      updNote('🔄 تم التحديث — الجهاز يعيد التشغيل الآن… ستُحدَّث الصفحة تلقائيًا عند عودة النظام (دقيقة تقريبًا).');
      showToast('🔄 تم التحديث — إعادة تشغيل الجهاز…', { type: 'success', duration: 8000 });
      updWaitForReboot();
    }
    return;
  }
  if (st && st.message) {
    updSet('upd-progress-text', st.message);
    const hit = updStepFromMessage(st.message);
    if (hit) {
      updStepsMark(hit.step);
      updSetBar(hit.pct, st.message);
      updShowRestartBanner(hit.step === 'restart' && st.state !== 'success');
    }
  }
  // v2.11.3 — كاشف التعطّل حسب طابع الحالة (at) القادم من المساعد.
  if (st && st.state === 'in_progress' && st.at) {
    const ts = Date.parse(st.at);
    const stale = Number.isFinite(ts) ? (Date.now() - ts) : 0;
    updShowStall(Number.isFinite(ts) && stale > UPD_STALL_MS, Math.floor(stale / 60000));
  } else if (st) {
    updShowStall(false);
  }
  if (st && st.state === 'success') {
    clearInterval(updProgressTimer); updProgressTimer = null;
    if (updElapsedTimer) { clearInterval(updElapsedTimer); updElapsedTimer = null; }
    updStepsAllDone();
    updSetBar(100, 'اكتمل ✓');
    updShowRestartBanner(false);
    updShowStall(false);
    updSet('upd-progress-text', '✅ ' + st.message);
    // v2.24.0 — الحقيقة المقاسة: بعد الاكتمال نسأل الخادم عن الإصدار الفعلي العامل
    // ونعرضه بجانب رسالة السجل (مع تنبيه لو اختلفا) — السجل قد يكون لتشغيل قديم.
    fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((h) => {
        const v = h && h.version;
        if (!v) return;
        const tagVer = String(st.tag || '').replace(/^v/i, '');
        const mismatch = tagVer && tagVer !== String(v);
        const line = '✅ ' + st.message + ' — النسخة العاملة فعلياً: v' + v + (mismatch ? ' (رسالة السجل عن تشغيل قديم — المعتمَد هو العمل)' : '');
        updSet('upd-progress-text', line);
      })
      .catch(() => {});
    updNote('✅ ' + st.message + ' — النظام يعمل الآن، وجارٍ إعادة تحميل الصفحة…');
    showToast('✅ ' + st.message, { type: 'success', duration: 6000 });
    updSetBusy(false);
    setTimeout(() => location.reload(), 3000);
    return;
  }
  if (st && st.state === 'failed') {
    clearInterval(updProgressTimer); updProgressTimer = null;
    if (updElapsedTimer) { clearInterval(updElapsedTimer); updElapsedTimer = null; }
    updShowRestartBanner(false);
    updShowStall(false);
    updSetBusy(false);
    updSet('upd-progress-text', '❌ ' + st.message);
    updNote('❌ فشل التحديث: ' + st.message + ' — راجع السجل التفصيلي.');
    showToast('❌ فشل التحديث: ' + st.message, { type: 'error', duration: 10000 });
  }
}
// إضاءة الخطوة الحالية + تعليم ما قبلها مُنجزًا.
function updStepsMark(step) {
  const list = [...document.querySelectorAll('#upd-steps li')];
  let reached = false;
  for (const li of list) {
    if (li.dataset.step === step) { li.classList.remove('done'); li.classList.add('active'); reached = true; }
    else if (!reached) { li.classList.remove('active'); li.classList.add('done'); }
    else { li.classList.remove('active', 'done'); }
  }
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
  updStepsMark('start');
  updSetBar(5, 'بدء التحديث');
  updShowRestartBanner(false);
  const elapsedEl = updEl('upd-elapsed');
  if (updElapsedTimer) clearInterval(updElapsedTimer);
  updElapsedTimer = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    if (elapsedEl) elapsedEl.textContent = '⏱ منذ ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
  if (updProgressTimer) clearInterval(updProgressTimer);
  updRenderProgress(); // قراءة فورية أوّلية
  updProgressTimer = setInterval(async () => {
    await updRenderProgress();
    if (updProgressTimer && Date.now() - started > 20 * 60 * 1000) {
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
    message: 'سيتم:\n① إنشاء نسخة احتياطية من قاعدة البيانات\n② تحديث النظام\n③ 🔄 إعادة تشغيل الجهاز بالكامل بعد اكتمال التحديث — ستنقطع الشاشة دقيقة تقريبًا ثم تعود تلقائيًّا\n\nلا تفصل الكهرباء ولا تغلق الصفحة أثناء التنفيذ. متابعة؟',
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
    message: 'سيتم تثبيت الإصدار ' + tag + ' ثم إعادة تشغيل الجهاز بالكامل.\nيُنصح بعمل نسخة احتياطية أولاً.',
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
  updStepsMark('start');
  updSetBar(5, 'بدء التنزيل');
  updShowRestartBanner(false);
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
          const hit = updStepFromMessage(msg);
          if (hit) { updStepsMark(hit.step); updSetBar(hit.pct, msg); }
          updSet('upd-progress-text', msg);
        } else if (ev === 'progress' && js) {
          updSet('upd-progress-text', `⬇️ ${js.percent}% (${js.downloaded} / ${js.total})`);
        } else if (ev === 'error') {
          throw new Error(msg);
        } else if (ev === 'done') {
          updStepsMark('files');
          updSetBar(40, 'تم التنزيل — جاهز للتطبيق');
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
// v2.25.0 — إعدادات التحديث التلقائي المجدول (تحميل/حفظ من بطاقة تبويب التحديثات).
async function loadAutoUpdateSettings() {
  const r = await api('/api/appliance-update/auto-schedule');
  if (!r.success) { updSet('upd-auto-status', 'تعذّر تحميل إعدادات التحديث التلقائي: ' + (r.error || ''), 1); return; }
  document.getElementById('upd-auto-enabled').checked = !!r.data.enabled;
  document.getElementById('upd-auto-hour').value = r.data.hour || '03:30';
}
async function saveAutoUpdateSettings() {
  const r = await api('/api/appliance-update/auto-schedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled: document.getElementById('upd-auto-enabled').checked ? 1 : 0,
      hour: document.getElementById('upd-auto-hour').value || '03:30',
    }),
  });
  if (!r.success) { updSet('upd-auto-status', 'فشل الحفظ: ' + (r.error || ''), 1); return; }
  updSet('upd-auto-status', '✅ حُفظ — التحديث التلقائي ' + (r.data.enabled ? 'مفعّل عند ' + r.data.hour + ' يوميًّا' : 'معطّل'));
}

async function updInit() {
  const tab = updEl('tab-updates');
  if (!tab) return;

  await updDetectMode();
  updRenderLast();
  updCheck(true);                     // فحص أولي (صامت) لرسم شريط الحالة
  updLoadHistory();
  // v2.25.0 — بطاقة التحديث التلقائي (عناصرها قد لا توجد في حالات خاصة — احتياط).
  const autoBtn = updEl('upd-auto-save-btn');
  if (autoBtn) {
    autoBtn.addEventListener('click', saveAutoUpdateSettings);
    loadAutoUpdateSettings();
  }

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

  // v2.11.3 — زرّا كاشف التعطّل.
  const stallCheck = updEl('upd-stall-check-btn');
  if (stallCheck) stallCheck.addEventListener('click', async () => {
    await updRenderProgress();
    showToast('🔄 تم فحص الحالة الآن', { type: 'info', duration: 2500 });
  });
  const stallCopy = updEl('upd-stall-copy-btn');
  if (stallCopy) stallCopy.addEventListener('click', async () => {
    const el = updEl('upd-log');
    const txt = (el && el.textContent) || '';
    try { await navigator.clipboard.writeText(txt); showToast('📋 تم نسخ السجل', { type: 'success' }); }
    catch (e) { showToast('تعذّر النسخ — افتح السجل التفصيلي وانسخه يدويًّا', { type: 'warning', duration: 6000 }); }
  });

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
