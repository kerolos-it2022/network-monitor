// admin-utils.js: دوال مساعدة مشتركة لكل ملفات لوحة التحكم.
// يُحمَّل FIRST في dashboard.html قبل كل سكريبتات admin لتفادي تكرار التعريفات.

// تحويل القيمة إلى نص ثم الهروب من أحرف HTML الخطيرة (يمنع XSS عند الحقن في innerHTML).
// ملاحظة: الترتيب مهم — يجب معالجة & أولاً حتى لا تُشوّه escapes اللاحقة.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

// دالة fetch عامة للطلبات البسيطة (JSON) — تتعامل مع الاستجابات غير JSON بأمان.
// ملاحظة: لا تُستخدم لطلاقات SSE (Server-Sent Events) — فهي تحتاج معالجة بث خاصّة.
async function api(url, opts) {
  try {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!r.ok && r.status !== 401 && r.status !== 404) {
      return data || { success: false, error: 'HTTP ' + r.status };
    }
    return data != null ? data : { success: false, error: 'استجابة غير صالحة من الخادم' };
  } catch (e) {
    return { success: false, error: 'تعذر الاتصال بالخادم' };
  }
}

// ═══ v2.7.0 — modal تأكيد موحّد + toast موقّت (بدَل confirm()/alert() الأَصلية) ═══

// confirmAction(opts): تَعود Promise<boolean> — true لو أكّد، false لو أَلغى.
//   opts: {
//     title:   'عنوان التَأكيد' (افتراضي: 'تأكيد'),
//     message: 'نَصّ السؤال (يَحترم \n)',
//     confirmText: 'تأكيد' (افتراضي),
//     cancelText:  'إلغاء' (افتراضي),
//     danger:  true/false → يُلوّن زرّ التَأكيد بِـ الأَحمر (لِـ الحَذف/الإِستعادة).
//   }
// الاستعمال: const ok = await confirmAction({title, message, danger:true}); if (!ok) return;
let __confirmState = null;   // يَحفظ الـ handlers أثناء فتح الـ modal.
function confirmAction(opts) {
  opts = opts || {};
  const modal = document.getElementById('confirm-modal');
  if (!modal) {
    // fallback آمن: لو modal غَير مَوجُود (خطأ تَحميل)، اِستَعمِل confirm الأَصلي.
    return Promise.resolve(window.confirm(opts.message || 'تأكيد؟'));
  }
  const titleEl = document.getElementById('confirm-modal-title');
  const msgEl = document.getElementById('confirm-modal-message');
  const okBtn = document.getElementById('confirm-modal-ok-btn');
  const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
  if (titleEl) titleEl.textContent = opts.title || 'تَأكيد';
  if (msgEl) msgEl.textContent = opts.message || '';
  if (okBtn) okBtn.textContent = opts.confirmText || '✓ تَأكيد';
  if (cancelBtn) cancelBtn.textContent = opts.cancelText || '✖️ إلغاء';
  // danger → زرّ أَحمر على الـ modal.
  modal.classList.toggle('danger', !!opts.danger);

  return new Promise((resolve) => {
    // اِنظِف handlers سابِقة (لِـ تَفادي تَسرّب promise نشط).
    if (__confirmState) __confirmState._cleanup();
    let settled = false;
    function settle(result) {
      if (settled) return;
      settled = true;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      modal.classList.remove('danger');
      document.removeEventListener('keydown', onKey);
      if (__confirmState) __confirmState = null;
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); settle(false); }
      else if (e.key === 'Enter') { e.preventDefault(); settle(true); }
    }
    function onBackdropClick(e) { if (e.target === modal) settle(false); }
    function _cleanup() {
      if (okBtn) okBtn.removeEventListener('click', onOk);
      if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdropClick);
    }
    function onOk() { settle(true); }
    function onCancel() { settle(false); }
    if (okBtn) okBtn.addEventListener('click', onOk);
    if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKey);
    __confirmState = { _cleanup };

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    // focus على زرّ التَأكيد لِـ a11y (لو أَراد Enter مباشرة).
    if (okBtn) okBtn.focus();
  });
}

// ═══ v2.7.4 — popup modal موحّد لِـ نماذج التَعديل/الإِضافة (نَقل inline form-cards) ═══
//
// openEditModal(modalEl, opts): يَفتح modal (class="modal hidden") و يَضبط إِغلاقه آليًّا
//   عبر: زرّ .modal-close، مفتاح ESC، النقر على backdrop فقط (ليس داخل .modal-content).
//   opts (اختياري): {
//     onOpen:  function() { ... }  — يُستَدعى بعد الفتح (مثلاً focus على أَول حقل).
//     onClose: function() { ... }  — يُستَدعى بعد الإِغلاق (مثلاً reset form).
//     focusSelector: 'input,select' — عنصر لِـ focus عليه بعد الفتح (افتراضي: أَول input).
//   }
// مُلاحظة: مُتوافقة مع confirmAction() — z-index الـ modal (100) أَقل من confirm-modal (2000)،
// فَيُمكن فتح تَأكيد الحفظ فوق popup التَعديل بِلا تَعارض.
let __editModalState = null;
function openEditModal(modalEl, opts) {
  if (!modalEl) return;
  opts = opts || {};
  // نَنظّف handlers سابِقة (لِـ تَفادي تَسرّب listeners نشطة من فتح سابق لِـ الـ modal نَفسه).
  if (__editModalState && __editModalState._cleanup) __editModalState._cleanup();

  const contentEl = modalEl.querySelector('.modal-content');
  const closeBtn = modalEl.querySelector('.modal-close');

  let closed = false;
  function doClose() {
    if (closed) return;
    closed = true;
    modalEl.classList.add('hidden');
    modalEl.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKey);
    modalEl.removeEventListener('click', onBackdropClick);
    __editModalState = null;
    if (typeof opts.onClose === 'function') {
      try { opts.onClose(); } catch (e) { console.warn('[editModal] onClose', e); }
    }
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); doClose(); }
  }
  function onBackdropClick(e) {
    // فقط لو نُقر الإِطار الخارجي (modal) لا الإِطار الداخلي (modal-content).
    if (e.target === modalEl) doClose();
  }
  function _cleanup() {
    document.removeEventListener('keydown', onKey);
    modalEl.removeEventListener('click', onBackdropClick);
    if (closeBtn) closeBtn.removeEventListener('click', doClose);
  }

  if (closeBtn) closeBtn.addEventListener('click', doClose);
  modalEl.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKey);
  __editModalState = { _cleanup, _close: doClose, _modalEl: modalEl };

  modalEl.classList.remove('hidden');
  modalEl.setAttribute('aria-hidden', 'false');

  // a11y: focus على العنصر المُحدّد أَو أَول input/select قابل للتركيز داخل modal.
  let focusEl = null;
  if (opts.focusSelector) focusEl = modalEl.querySelector(opts.focusSelector);
  if (!focusEl && contentEl) focusEl = contentEl.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
  if (focusEl) { try { focusEl.focus(); } catch (e) {} }

  if (typeof opts.onOpen === 'function') {
    try { opts.onOpen(); } catch (e) { console.warn('[editModal] onOpen', e); }
  }
}

// closeEditModal(modalEl): إِغلاق صريح لِـ الـ modal المفتوح (يٌستَعمل من زرّ cancel
// والمعالجات البرمجية بَعد الحفظ الناجح). آمنة بِلا throw لو الـ modal لم يَكن مفتوحًا.
function closeEditModal(modalEl) {
  if (!modalEl) return;
  // لو الـ modal المفتوح حاليًّا هو نَفسه المطلوب إِغلاقه، نَستعمل doClose المشتركة
  // (تَنظّف handlers + تٌطلق onClose). وإِلا نُخفي modalEl مباشرة.
  if (__editModalState && __editModalState._modalEl === modalEl && typeof __editModalState._close === 'function') {
    __editModalState._close();
  } else {
    modalEl.classList.add('hidden');
    modalEl.setAttribute('aria-hidden', 'true');
  }
}

// showToast(message, opts): رسالة موقّتة تَظهر في #toast-container و تَختفي آليًّا.
//   opts: { type: 'success'|'error'|'warning'|'info', duration: 4000 (ms), title: '...' }
const __toastIcon = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
function showToast(message, opts) {
  opts = opts || {};
  const container = document.getElementById('toast-container');
  if (!container) {
    // fallback: لو container غَير مَوجُود، اِستَعمِل console + alert مرّة وَاحدة.
    console.warn('[toast]', message);
    return;
  }
  const type = opts.type || 'info';
  const duration = (opts.duration != null ? opts.duration : 4000);
  const title = opts.title;
  const item = document.createElement('div');
  item.className = 'toast-item ' + type;
  item.setAttribute('role', (type === 'error' || type === 'warning') ? 'alert' : 'status');
  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  iconSpan.textContent = __toastIcon[type] || __toastIcon.info;
  const textSpan = document.createElement('span');
  textSpan.className = 'toast-text';
  // نَستعمل textContent (لا innerHTML) لِـ مَنع XSS مهما كان مَصدر الرِسالة.
  textSpan.textContent = message;
  item.appendChild(iconSpan);
  item.appendChild(textSpan);
  // زرّ إغلاق يدوي.
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'إغلاق');
  closeBtn.textContent = '×';
  item.appendChild(closeBtn);
  container.appendChild(item);

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (handle) clearTimeout(handle);
    if (item.parentNode) item.parentNode.removeChild(item);
  }
  closeBtn.addEventListener('click', dismiss);
  let handle = (duration > 0) ? setTimeout(dismiss, duration) : null;
}

