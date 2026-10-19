// admin-notifications.js: تحميل وحفظ إعدادات الإشعارات + عرض سجل الإشعارات عند فتح التبويب.
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
let currentLogsSort = 'sent_at_desc';
// v2.33.0 — فلتر حالة سجل الإشعارات: '' = كل الحالات · sent · failed · maintenance
let logsFilterStatus = '';

// v2.34.0 — نصّ رسالة السجل: يُترجم عند العرض بلغة السجل المختارة (nm-log-i18n.js)،
// ومع الوسوم التي يكتبها السيرفر لِتلجرام (<b>/<code>) تُنظَّف في اللغتين.
function logText(s) {
  try { return window.NMLogI18N ? NMLogI18N.translate(s) : s; } catch (e) { return s; }
}

// v2.34.0 — زر لغة رسائل السجل، وصار (v2.50.x) يحكم **الأمرين معًا**: لغة الرسائل التي تُرسَل فعلًا
// (تلجرام · واتساب · الموبايل · التقارير) ولغة عرض السجل. الإعداد محفوظ في الخادم
// (app_settings.notification_language) لأن الرسائل تُبنى وتُرسَل من الخادم وقد لا يكون أي متصفح مفتوحًا
// وقت الإرسال (جهاز يقع فجرًا). ويُحفظ اختيار المتصفح أيضًا للرسم الفوري بلا انتظار.
// المدير وحده يغيّر إعداد الخادم — وإن رُفض (حساب «عرض») يبقى التبديل محليًّا لهذه الشاشة وحدها.
function paintLogLangBtn() {
  const btn = document.getElementById('logs-lang-toggle');
  if (!btn || !window.NMLogI18N) return;
  const n = window.NMI18N;
  const isEn = NMLogI18N.getLang() === 'en';
  const key = isEn ? 'logs.lang.toAr' : 'logs.lang.toEn';
  const titleKey = isEn ? 'logs.lang.toArTitle' : 'logs.lang.toEnTitle';
  btn.textContent = n ? n.t(key) : (isEn ? '🌐 عربي' : '🌐 English');
  btn.title = n ? n.t(titleKey) : '';
  btn.setAttribute('aria-label', btn.title);
  // مِلء أزرق = عرض الرسائل بالإنجليزية مُفعَّل الآن (نفس أسلوب زرّ اللغة العلوي).
  btn.classList.toggle('btn-primary', isEn);
}

function toggleLogLang() {
  if (!window.NMLogI18N) return;
  NMLogI18N.setLang(NMLogI18N.getLang() === 'en' ? 'ar' : 'en');
  paintLogLangBtn();
  loadNotificationLogs(); // إعادة رسم الجدول باللغة المختارة (نفس الفلتر والترتيب)
  pushLogLangToServer(NMLogI18N.getLang());
}

/** بذر لغة الإشعارات من الخادم عند فتح الشاشة (فتتبع شاشة السجل والرسائل المُرسَلة إعدادًا واحدًا). */
async function syncLogLangFromServer() {
  if (!window.NMLogI18N) return;
  const r = await api('/api/settings/notification-language');
  const v = r && r.success && r.data && r.data.notification_language;
  if (!v) return;   // بلا إعداد ⇒ يبقى الاحتياط في nm-log-i18n.js
  NMLogI18N.setServerLang(v);
  paintLogLangBtn();
  if (currentNtfSub === 'logs') loadNotificationLogs();   // نُعيد رسم الجدول بالإعداد الجديد
}

/** إرسال الاختيار للخادم (أفضل جهد): ينجح للمدير وحده؛ الرفض لا يُربك المستخدم. */
async function pushLogLangToServer(code) {
  const r = await api('/api/settings/notification-language', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notification_language: code }),
  });
  if (r && !r.success) console.warn('[ntf-lang] the server kept its own setting:', r.error || 'refused');
}

// تغيير لغة الواجهة يُعيد كتابة نصّ الزرّ؛ وإعادة رسم الجدول تتكفّل بها nm-lang.js (نقر التبويب).
document.addEventListener('nm:lang', paintLogLangBtn);

// ═══ TZ-01 (2026-10-18) — المنطقة الزمنية للجدولة من اللوحة ═══
// المشكلة: التقرير اليومي كان يعمل بتوقيت الخادم (UTC على الأبلاينس) فوصل 13:30 بدل 10:30
// لمالك UTC+3. الحل: حقل منطقة IANA (Africa/Cairo) يُمرَّر للمجدولات؛ اسم المنطقة — لا إزاحة
// ثابتة — هو ما يجعل التوقيت الصيفي/الشتوي يُحسب تلقائيًّا (لا تعديل مرتين في السنة).
const TZ_COMMON = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'America/New_York', 'UTC'];

// tzT(key, fallback, vars): نصّ بلغة الواجهة مع استبدال {placeholders} (T لا يدعم المتغيّرات).
function tzT(key, fallback, vars) {
  if (window.NMI18N && typeof NMI18N.t === 'function') {
    try { return NMI18N.t(key, vars); } catch (e) { /* نكمل بالاحتياط */ }
  }
  let s = fallback;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

// tzOffsetLabel(zone): إزاحة المنطقة عن UTC الآن (UTC+03:00 صيفًا وUTC+02:00 شتاءً بمصر) —
// تُحسب لحظة الرسم (لا قيمة محفوظة) وتتبع التوقيت الصيفي تلقائيًّا.
function tzOffsetLabel(zone) {
  try {
    const now = new Date();
    const p = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).forEach((x) => { p[x.type] = x.value; });
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const mins = Math.round((asUTC - Math.floor(now.getTime() / 1000) * 1000) / 60000);
    const sign = mins >= 0 ? '+' : '-';
    const abs = Math.abs(mins);
    return 'UTC' + sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
  } catch (e) { return ''; }
}

// browserTimeZone(): منطقة المتصفح (اقتراح فقط — لا تُحفظ إلا بنقرة/حفظ صريح).
function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
}

// buildTimezoneDatalist(): تعبئة القائمة (أسماء شائعة أولًا ثم Intl.supportedValuesOf كاملة
// + خيار فارغ صريح معناه «توقيت الخادم (افتراضي)»). بلا supportedValuesOf تبقى الأسماء الشائعة.
function buildTimezoneDatalist() {
  const dl = document.getElementById('ntf-timezone-zones');
  if (!dl) return;
  let all = [];
  try { all = (typeof Intl.supportedValuesOf === 'function') ? Intl.supportedValuesOf('timeZone') : []; } catch (e) { all = []; }
  const seen = new Set();
  const zones = TZ_COMMON.concat(all.filter((z) => !TZ_COMMON.includes(z)));
  dl.textContent = '';
  const system = document.createElement('option');
  system.value = '';
  system.label = tzT('notify.timezone.systemOption', 'توقيت الخادم (افتراضي)');
  dl.appendChild(system);
  for (const z of zones) {
    if (seen.has(z)) continue;
    seen.add(z);
    const o = document.createElement('option');
    o.value = z;
    dl.appendChild(o);
  }
}

// paintTimezoneHint(): التلميح الحيّ أسفل الحقل — يُظهر المنطقة الفعّالة وإزاحتها الآن ليرى
// المالك بعينه سبب فارق الساعات (وينطبق نفسه صيفًا وشتاءً بفضل اسم المنطقة).
// الفارغ = توقيت الخادم + اقتراح منطقة المتصفح (زر اختيار — لا حفظ تلقائي).
function paintTimezoneHint() {
  const hint = document.getElementById('ntf-timezone-hint');
  const input = document.getElementById('ntf-timezone');
  if (!hint || !input) return;
  const val = String(input.value || '').trim();
  hint.textContent = '';
  if (!val) {
    hint.appendChild(document.createTextNode(tzT('notify.timezone.hintSystem', 'بتوقيت الخادم المحلي — اختر منطقتك ليضبط الجدول على ساعتك')));
    const bz = browserTimeZone();
    if (bz) {
      const offset = tzOffsetLabel(bz);
      const sep = document.createTextNode(' · ');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      btn.id = 'ntf-timezone-suggest';
      btn.textContent = tzT('notify.timezone.suggest', 'منطقتك: {zone} ({offset}) — اضغط للاختيار', { zone: bz, offset: offset });
      btn.addEventListener('click', () => { input.value = bz; paintTimezoneHint(); });
      hint.appendChild(sep);
      hint.appendChild(btn);
    }
    return;
  }
  // اسم منطقة؟ نتحقق به بنفس طريقة التحقق في الخادم (بناء Intl داخل try/catch).
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: val }).resolvedOptions().timeZone || '';
    if (resolved) {
      hint.appendChild(document.createTextNode(tzT('notify.timezone.hint', 'بتوقيت: {zone} ({offset}) — التوقيت الصيفي يُحسب تلقائيًّا', { zone: resolved, offset: tzOffsetLabel(resolved) })));
      return;
    }
  } catch (e) { /* منطقة غير معروفة ⇒ رسالة واضحة أدناه */ }
  hint.appendChild(document.createTextNode(tzT('notify.timezone.invalid', 'منطقة غير معروفة — اختر اسمًا من القائمة (مثل Africa/Cairo)')));
}

// تغيير لغة الواجهة يُعيد تعبئة القائمة (تسمية «توقيت الخادم») وإعادة رسم التلميح بلغتها.
document.addEventListener('nm:lang', () => { buildTimezoneDatalist(); paintTimezoneHint(); });


// ═══ v2.34.0 — شرائح شاشة الإشعارات (بنفس نمط شاشة «اكتشاف الأجهزة»): الإعدادات ⇄ سجل الإشعارات ═══
// شريط الشرائح داخل #section-notifications فيبقى ظاهرًا في الشريحتين، والسجل قسمٌ مستقل يُخفى ويُظهر.
const NTF_SUB_PANELS = { settings: 'ntf-settings-panel', logs: 'section-logs' };
let currentNtfSub = 'settings';

function showNotifSub(sub) {
  currentNtfSub = NTF_SUB_PANELS[sub] ? sub : 'settings';
  for (const [key, panelId] of Object.entries(NTF_SUB_PANELS)) {
    const el = document.getElementById(panelId);
    if (el) el.classList.toggle('hidden', key !== currentNtfSub);
  }
  const bar = document.getElementById('ntf-segments');
  if (bar) {
    bar.querySelectorAll('button[data-sub]').forEach((b) => {
      b.classList.toggle('btn-primary', b.dataset.sub === currentNtfSub);
    });
  }
  if (currentNtfSub === 'logs') loadNotificationLogs(); // أهمّل التخزين: افتح السجل ببيانات لحظية
}

async function loadNotificationSettings() {
  const r = await api('/api/notifications/settings');
  if (!r.success) return;
  const d = r.data;
  const src = d.sources || {};
  // v2.13.0 — placeholder واعٍ بالمصدر: لو الحقل فارغ في القاعدة لكن الاعتماد يعمل
  // من .env فلا نقول «غير مضبوط» بل نوضّح من أين يُقرأ (لأن sendTelegram/WhatsApp
  // يقبلان الرجوع إلى متغيّرات البيئة الآن).
  const placeholderFor = (masked, from, envName) => {
    if (masked) return masked;
    if (from === 'env') return T('ntf.fromEnv', 'يُقرأ من') + ' ' + envName + ' ' + T('ntf.fromEnvAfter', 'في .env — اكتب قيمة هنا لاستبداله');
    return T('s2.not_set', T('admin.unset', 'غير مضبوط'));
  };
  document.getElementById('ntf-telegram_enabled').checked = !!d.telegram_enabled;
  // نعرض المفتاح المقنّع فقط كـ placeholder؛ المستخدم يمكنه إدخال قيمة جديدة.
  document.getElementById('ntf-telegram_bot_token').placeholder = placeholderFor(d.telegram_bot_token, src.telegram_bot_token, 'TELEGRAM_BOT_TOKEN');
  document.getElementById('ntf-telegram_bot_token').value = '';
  document.getElementById('ntf-telegram_chat_id').value = d.telegram_chat_id || '';
  document.getElementById('ntf-whatsapp_enabled').checked = !!d.whatsapp_enabled;
  document.getElementById('ntf-whatsapp_api_url').value = d.whatsapp_api_url || '';
  document.getElementById('ntf-whatsapp_api_token').placeholder = placeholderFor(d.whatsapp_api_token, src.whatsapp_api_token, 'WHATSAPP_API_TOKEN');
  document.getElementById('ntf-whatsapp_api_token').value = '';
  document.getElementById('ntf-whatsapp_to_number').value = d.whatsapp_to_number || '';
  // إعدادات الموبايل/FCM
  document.getElementById('ntf-mobile_enabled').checked = !!d.mobile_enabled;
  document.getElementById('ntf-maintenance_enabled').checked = !!d.maintenance_enabled;
  (function () { const w = String(d.maintenance_window || '02:00-04:00').split('-'); const fromEl = document.getElementById('ntf-maintenance_from'); const toEl = document.getElementById('ntf-maintenance_to'); if (fromEl) fromEl.value = (w[0] || '02:00').trim(); if (toEl) toEl.value = (w[1] || '04:00').trim(); })();
  document.getElementById('ntf-daily_report_enabled').checked = d.daily_report_enabled === undefined ? true : !!d.daily_report_enabled;
  document.getElementById('ntf-daily_report_hour').value = d.daily_report_hour || '08:00';
  // TZ-01 — المنطقة الزمنية للجدولة ('' = توقيت الخادم المحلي) + تلميح الإزاحة الحالية.
  document.getElementById('ntf-timezone').value = d.timezone || '';
  paintTimezoneHint();
  document.getElementById('ntf-bot_commands_enabled').checked = d.bot_commands_enabled === undefined ? true : !!d.bot_commands_enabled;
  document.getElementById('ntf-storm_digest_enabled').checked = d.storm_digest_enabled === undefined ? true : !!d.storm_digest_enabled;
  document.getElementById('ntf-storm_window_seconds').value = Number(d.storm_window_seconds) || 90;
  // v2.25.0 — تصعيد الانقطاعات.
  document.getElementById('ntf-escalation_enabled').checked = !!d.escalation_enabled;
  document.getElementById('ntf-escalation_after_minutes').value = Number(d.escalation_after_minutes) || 30;
  document.getElementById('ntf-escalation_repeat_minutes').value = Number(d.escalation_repeat_minutes) || 0;
  document.getElementById('ntf-noc_alert_screen').checked = (d.noc_alert_screen_enabled === undefined || d.noc_alert_screen_enabled === null) ? true : !!d.noc_alert_screen_enabled;
  document.getElementById('ntf-fcm_server_key').placeholder = d.fcm_server_key || T('s2.not_set', T('admin.unset', 'غير مضبوط'));
  document.getElementById('ntf-fcm_server_key').value = '';
  // v2.13.0 — تنبيه صريح لو مفاتيح Web Push غير جاهزة (سبب رسالة «الإشعارات غير مُهيّأة»).
  const vapidEl = document.getElementById('ntf-status');
  if (vapidEl && d.vapid_public_key_ready === false) {
    vapidEl.style.color = 'var(--offline)';
    vapidEl.textContent = T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', T('s2j.web_push_vapid_keys_are_not_ready_on_the_ser', '⚠️ مفاتيح Web Push (VAPID) غير جاهزة على الخادم — إشعارات الهاتف لن تُفعّل حتى تُضبط.'))))))))));
  }
}

async function saveNotificationSettings() {
  // v2.7.1 (مَطلب 5) — تَأكيد قبل حفظ إعدادات الإِشعارات (إِجراء حسّاس).
  const ok = await confirmAction({
    title: T('s2j.confirm_saving_the_settings', 'تَأكيد حفظ الإِعدادات'),
    message: T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', T('s2j.save_the_notification_settings_changes', 'تَأكيد حفظ تَعديل إعدادات الإِشعارات؟')))))))))),
    confirmText: T('ntf.confirmSave', '✓ تَأكيد الحفظ'),
  });
  if (!ok) return;
  const statusEl = document.getElementById('ntf-status');
  statusEl.style.color = 'var(--online)';
  statusEl.textContent = T('s2j.saving_2', 'جارٍ الحفظ…');
  const body = {
    telegram_enabled: document.getElementById('ntf-telegram_enabled').checked,
    telegram_bot_token: document.getElementById('ntf-telegram_bot_token').value.trim(),
    telegram_chat_id: document.getElementById('ntf-telegram_chat_id').value.trim(),
    whatsapp_enabled: document.getElementById('ntf-whatsapp_enabled').checked,
    whatsapp_api_url: document.getElementById('ntf-whatsapp_api_url').value.trim(),
    whatsapp_api_token: document.getElementById('ntf-whatsapp_api_token').value.trim(),
    whatsapp_to_number: document.getElementById('ntf-whatsapp_to_number').value.trim(),
    mobile_enabled: document.getElementById('ntf-mobile_enabled').checked,
    fcm_server_key: document.getElementById('ntf-fcm_server_key').value.trim(),
    maintenance_enabled: document.getElementById('ntf-maintenance_enabled').checked,
    maintenance_window: (document.getElementById('ntf-maintenance_from').value || '02:00') + '-' + (document.getElementById('ntf-maintenance_to').value || '04:00'),
    daily_report_enabled: document.getElementById('ntf-daily_report_enabled').checked,
    daily_report_hour: document.getElementById('ntf-daily_report_hour').value || '08:00',
    // TZ-01 — المنطقة الزمنية (فارغة = توقيت الخادم)؛ الخادم يتحقق منها ويرفض غير الصالح.
    timezone: document.getElementById('ntf-timezone').value.trim(),
    bot_commands_enabled: document.getElementById('ntf-bot_commands_enabled').checked,
    storm_digest_enabled: document.getElementById('ntf-storm_digest_enabled').checked,
    storm_window_seconds: Number(document.getElementById('ntf-storm_window_seconds').value) || 90,
    // v2.25.0 — تصعيد الانقطاعات.
    escalation_enabled: document.getElementById('ntf-escalation_enabled').checked ? 1 : 0,
    escalation_after_minutes: Number(document.getElementById('ntf-escalation_after_minutes').value) || 30,
    escalation_repeat_minutes: Number(document.getElementById('ntf-escalation_repeat_minutes').value) || 0,
    noc_alert_screen_enabled: document.getElementById('ntf-noc_alert_screen').checked ? 1 : 0,
  };
  const r = await api('/api/notifications/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.success) {
    statusEl.textContent = T('s2j.saved', '✅ تم الحفظ');
    await loadNotificationSettings();
  } else {
    statusEl.style.color = 'var(--offline)';
    statusEl.textContent = '❌ ' + (r.error || T('ntf.saveFailed', 'فشل الحفظ'));
  }
}

// إرسال إشعار تجريبي عبر القنوات المفعّلة
// v2.13.0 — الردّ صار يحمل نتيجة كل قناة بسببها، فنعرض سبب كل قناة بدل «فشل الإرسال»
// المبهم (مع دعم خادم أقدم يردّ { sent } فقط — تراجُع آمن). والتفصيل يُعرض حتى عندما
// تكون success=false (القنوات مفعّلة لكن الإرسال فشل) فلا نستبدله برسالة عامة.
// channel (اختياري، v2.33.0) — 'telegram' | 'whatsapp' | 'mobile' لاختبار قناة واحدة
// (أزرار «🔔 اختبار هذه القناة» داخل كل قسم)؛ بلا مُعامل ⇒ كل القنوات المفعّلة كما كان.
async function testNotification(channel) {
  const statusEl = document.getElementById('ntf-status');
  const only = channel ? { telegram: T('s3.telegram', 'تلجرام'), whatsapp: T('s3.whatsapp', 'واتساب'), mobile: T('tail.mobile', 'هاتف') }[channel] || channel : null;
  statusEl.style.color = 'var(--online)';
  statusEl.textContent = only
    ? (T('ntf.testSendingOne', '🔔 جارٍ إرسال إشعار تجريبي على') + ' ' + only + ' ' + T('ntf.only', 'فقط…'))
    : T('ntf.testSendingAll', '🔔 جارٍ إرسال إشعار تجريبي عبر القنوات المفعّلة…');
  try {
    const r = await fetch('/api/notifications/test', {
      method: 'POST',
      credentials: 'include',
      headers: channel ? { 'Content-Type': 'application/json' } : undefined,
      body: channel ? JSON.stringify({ channel: channel }) : undefined,
    });
    const data = await r.json();
    const results = data.data && Array.isArray(data.data.results) ? data.data.results : null;
    if (!results) {
      // خادم لم يُحدَّث بعد (يردّ { success, sent } فقط بلا تفصيل لكل قناة).
      if (data.success) {
        const okSent = !!(data.data && data.data.sent);
        statusEl.textContent = okSent
          ? T('tail.sent_check_your_phone', '✅ تم الإرسال (افتح هاتفك للتأكد)')
          : T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', T('tail.sending_failed_make_sure_the_channel_is_enab', '❌ فشل الإرسال — تأكد من تفعيل القناة ووجود تسجيلات نشطة'))))))))));
        if (!okSent) statusEl.style.color = 'var(--offline)';
      } else {
        statusEl.style.color = 'var(--offline)';
        statusEl.textContent = '❌ ' + (data.error || T('ntf.sendFailed', 'فشل الإرسال — تأكد من تفعيل القناة ووجود تسجيلات نشطة'));
      }
      return;
    }
    const labels = { telegram: T('s3.telegram', 'تلجرام'), whatsapp: T('s3.whatsapp', 'واتساب'), mobile: T('tail.mobile', 'هاتف') };
    const lines = results.map((res) => {
      const name = labels[res.channel] || res.channel;
      if (res.ok) return name + ': ' + T('ntf.sent', '✅ تم الإرسال');
      if (res.skipped) return name + ': ' + T('ntf.notSent', '⏭️ لم يُرسل —') + ' ' + (res.reason || T('tail.skipped_2', 'متخطّاة'));
      return name + ': ' + T('ntf.failedDash', '❌ فشل —') + ' ' + (res.error || T('tail.no_details', 'بلا تفصيل'));
    });
    const anyOk = results.some((res) => res.ok);
    statusEl.style.color = anyOk ? 'var(--online)' : 'var(--offline)';
    statusEl.innerHTML = lines.map(esc).join('<br>');
  } catch (e) {
    statusEl.style.color = 'var(--offline)';
    statusEl.textContent = T('s2j.server_connection_error', '❌ خطأ في الاتصال بالخادم');
  }
}

async function loadNotificationLogs() {
  // v2.34.0 — إعادة ضبط نصّ زرّ اللغة مع كل رسم (لو تغيّرت الحالة من خارج الزرّ يبقى النصّ مطابقًا).
  paintLogLangBtn();
  const r = await api('/api/notifications/logs');
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '';
  if (!r.success) return;
  
  // تطبيق الترتيب
  const sortBy = currentLogsSort;
  const sortedData = [...r.data].sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'sent_at_desc':
        valA = a.sent_at ? new Date(a.sent_at).getTime() : 0;
        valB = b.sent_at ? new Date(b.sent_at).getTime() : 0;
        return valB - valA; // الأحدث أولاً
      case 'sent_at_asc':
        valA = a.sent_at ? new Date(a.sent_at).getTime() : 0;
        valB = b.sent_at ? new Date(b.sent_at).getTime() : 0;
        return valA - valB; // الأقدم أولاً
      case 'device_name':
        valA = (a.device_name || '').toLowerCase();
        valB = (b.device_name || '').toLowerCase();
        break;
      case 'channel':
        valA = (a.channel || '').toLowerCase();
        valB = (b.channel || '').toLowerCase();
        break;
      case 'status':
        valA = (a.status || '').toLowerCase();
        valB = (b.status || '').toLowerCase();
        break;
      default:
        return 0;
    }
    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
  });
  
  const channelText = (c) => {
    if (c === 'telegram') return T('s3.telegram', 'تلجرام');
    if (c === 'whatsapp') return T('s3.whatsapp', 'واتساب');
    if (c === 'mobile') return T('tail.mobile', 'هاتف');
    return c;
  };
  // v2.33.0 — فلتر الحالة (كل / تم الإرسال / فشل / مكتوم صيانة) قبل العرض
  const statusText = (s) => (s === 'sent' ? T('s3.sent', 'تم الإرسال') : (s === 'failed' ? T('s3.failed', 'فشل') : (s === 'maintenance' ? T('s3.muted_maintenance', 'مكتوم (صيانة)') : (s || '—'))));
  const shownData = logsFilterStatus
    ? sortedData.filter((l) => String(l.status || '') === logsFilterStatus)
    : sortedData;
  const emptyBox = document.getElementById('logs-empty');
  if (emptyBox) {
    const filtered = !!logsFilterStatus && sortedData.length > 0 && shownData.length === 0;
    emptyBox.classList.toggle('hidden', shownData.length > 0);
    emptyBox.innerHTML = filtered
      ? '<span class="nm-empty-icon">🔍</span>' + (window.NMI18N
        ? NMI18N.t('logs.emptyFiltered', { s: esc(statusText(logsFilterStatus)) })
        : 'لا توجد إشعارات بحالة «' + esc(statusText(logsFilterStatus)) + '» — اختر «كل الحالات» لعرض الكل.')
      : '<span class="nm-empty-icon">📭</span>' + T('logs.empty');
  }

  for (const l of shownData) {
    const tr = document.createElement('tr');
    // dir="auto" — الرسالة الإنجليزية تظهر باتجاهها الصحيح داخل جدول عربي (والعربية كما هي).
    tr.innerHTML = `
      <td class="col-ltr">${esc(l.sent_at ? NMFormat.dateTime(l.sent_at) : '—')}</td>
      <td>${esc(l.device_name || '—')}</td>
      <td class="col-center">${esc(channelText(l.channel))}</td>
      <td class="col-status">${esc(statusText(l.status))}</td>
      <td dir="auto">${esc(logText(l.message))}</td>
      <td dir="auto">${esc(l.error ? logText(l.error) : '—')}</td>
    `;
    tbody.appendChild(tr);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // TZ-01 — قائمة المناطق تُبنى مرة عند الفتح (أسماء شائعة أولًا + كل مناطق Intl)،
  // والتلميح يُعاد رسمه مع كل كتابة/تغيير لغة.
  buildTimezoneDatalist();
  const tzInput = document.getElementById('ntf-timezone');
  if (tzInput) tzInput.addEventListener('input', paintTimezoneHint);
  await loadNotificationSettings();
  document.getElementById('ntf-save-btn').addEventListener('click', saveNotificationSettings);
  const testBtn = document.getElementById('ntf-test-btn');
  if (testBtn) testBtn.addEventListener('click', () => testNotification());
  // v2.33.0 — زر اختبار مستقل لكل قناة (تلجرام / واتساب / الهاتف)
  const perChannelTests = [
    ['ntf-test-telegram-btn', 'telegram'],
    ['ntf-test-whatsapp-btn', 'whatsapp'],
    ['ntf-test-mobile-btn', 'mobile'],
  ];
  perChannelTests.forEach(([id, ch]) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => testNotification(ch));
  });
  // v2.34.0 — تبويب «الإشعارات» صار يعرض الإعدادات + سجل الإشعارات معًا (شاشة واحدة)
  // ⇒ تحميل السجل يتم عند فتح نفس التبويب.
  document.getElementById('tab-notifications').addEventListener('click', loadNotificationLogs);
  // شرائح الإعدادات/السجل: زرّ لكل شريحة + بداية دائمًا بشريحة الإعدادات عند فتح التبويب.
  // ملاحظة: setTimeout(0) مُتعمَّد — admin-tabs يُظهِر القسمين معًا عند نقر التبويب، فنُطبّق الشريحة
  // المختارة **بعدها** (لا نعتمد على ترتيب تسجيل المستمعين).
  const ntfBar = document.getElementById('ntf-segments');
  if (ntfBar) {
    ntfBar.querySelectorAll('button[data-sub]').forEach((b) => {
      b.addEventListener('click', () => showNotifSub(b.dataset.sub));
    });
  }
  const ntfTab = document.getElementById('tab-notifications');
  if (ntfTab) ntfTab.addEventListener('click', () => setTimeout(() => showNotifSub('settings'), 0));
  // v2.33.0 — فلتر حالة السجل (كل الحالات / تم الإرسال / فشل / مكتوم صيانة)
  const filterStatusEl = document.getElementById('logs-filter-status');
  if (filterStatusEl) {
    filterStatusEl.addEventListener('change', (e) => {
      logsFilterStatus = e.target.value;
      loadNotificationLogs();
    });
  }
  // مستمع تغيير الترتيب للسجل
  const sortLogsEl = document.getElementById('filter-sort-logs');
  if (sortLogsEl) {
    sortLogsEl.addEventListener('change', (e) => {
      currentLogsSort = e.target.value;
      loadNotificationLogs();
    });
  }
  // v2.34.0 — زر لغة رسائل السجل (ترجمة عرض الرسائل وحدها — بلا مساس بلغة الواجهة).
  const logLangBtn = document.getElementById('logs-lang-toggle');
  if (logLangBtn) {
    logLangBtn.addEventListener('click', toggleLogLang);
    paintLogLangBtn();
    syncLogLangFromServer();   // لغة الإشعارات من الخادم (تُرسَل بها الرسائل وتُعرَض بها السجل)
  }
  // v2.7.3 — ثلاثة أَزرار منفصلة لِـ مَسح كل نوع من السجلّات:
  //   الإِشعارات:       DELETE /api/notifications/logs?older_than_days={days}
  //   الانقطاعات:      POST   /api/devices/cleanup-history        { range }
  //   نَقاط الفحص:     POST   /api/devices/cleanup-status-logs    { range }   (status_logs — الأَكبر)
  // كّلها تَفتح modal اختِيار المُدّة نفسه (#cleanup-select-modal) ثم تأكيد via confirmAction.
  const logsClearBtn = document.getElementById('logs-clear-btn');
  const logsClearDowntimeBtn = document.getElementById('logs-clear-downtime-btn');
  const logsClearStatusBtn = document.getElementById('logs-clear-status-btn');
  const logsTruncateStatusBtn = document.getElementById('logs-truncate-status-btn'); // v2.7.x — تَفْرِيغ كامل
  const cleanupModal = document.getElementById('cleanup-select-modal');
  const cleanupRangeSel = document.getElementById('cleanup-range-select');
  const cleanupOkBtn = document.getElementById('cleanup-select-ok-btn');
  const cleanupCancelBtn = document.getElementById('cleanup-select-cancel-btn');
  // نوع المسح الحالي للـ modal (يُحدَّد حسب الزرّ المَضغوط: notifications | downtime | status-logs | status-logs-all).
  let cleanupMode = 'notifications';
  // عنوان modal الاختيار حسب النوع (لِـ تأكيد واضح للمستخدم قبل الفتح).
  const cleanupTitles = {
    notifications: T('tail.clear_the_notification_log', '🗑️ مَسح سجل الإِشعارات'),
    downtime:      T('ntf.clearDowntimeTitle', '🗑️ مَسح سجل الانقطاعات'),
    'status-logs': T('ntf.clearChecksTitle', '🗑️ مَسح نَقاط فحص الحالة'),
  };
  const cleanupLabels = {
    notifications:    T('ntf.labelNotifications', 'سجل الإِشعارات'),
    downtime:         T('ntf.labelDowntime', 'سجل الانقطاعات'),
    'status-logs':    T('ntf.labelStatusLogs', 'نَقاط فحص الحالة'),
    'status-logs-all':T('ntf.labelStatusLogsAll', 'نَقاط فحص الحالة (تَفْرِيغ كامل)'),
  };

  // v2.7.x — تَحوِيل range(الواجهة) إِلى (days, label) لِـ الرسالة. status-logs-all يُعالَج زِرّاً مُنفَصِلاً (لَا مُدّة).
  // أَضِيفَت خِيَارات أَصْغَر (2h, day) لِأَنّ status_logs يَحتوي بيانات أَحدث من أُسبوع غالباً.
  function rangeInfo(range) {
    switch (range) {
      case '2h':    return { days: 2/24,    text: T('tail.two_hours', 'ساعتين') };
      case 'day':   return { days: 1,      text: T('s3b.24_hours', '24 ساعة') };
      case 'week':  return { days: 7,      text: T('tail.7_days', '7 أَيام') };
      case 'month': return { days: 30,     text: T('s3b.30_days', '30 يوم') };
      case 'year':  return { days: 365,    text: T('tail.365_days', '365 يوم') };
      default:      return { days: 7,      text: T('tail.7_days', '7 أَيام') };
    }
  }

  function closeCleanupModal() {
    if (!cleanupModal) return;
    cleanupModal.classList.add('hidden');
    cleanupModal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', cleanupOnKey);
    if (cleanupModal) cleanupModal.removeEventListener('click', cleanupOnBackdrop);
  }
  function cleanupOnKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeCleanupModal(); }
  }
  function cleanupOnBackdrop(e) { if (e.target === cleanupModal) closeCleanupModal(); }

  // فتح modal اختيار المُدّة حسب نوع المسح.
  function openCleanupModal(mode) {
    if (!cleanupModal) return;
    cleanupMode = mode;
    const titleEl = cleanupModal.querySelector('.confirm-modal-title');
    if (titleEl) titleEl.textContent = cleanupTitles[mode] || cleanupTitles.notifications;
    // v2.7.x — notifications endpoint يَدْعَم فَقَط 1/7/30/365 أَيام (لا 2h)؛ فَلِـ notifications
    // نُخْفي خِيَار «ساعتين» (لا مَعْنَى لِمَسح إِشعارات كل ساعتين). status-logs و downtime يَدْعَمان 2h.
    if (cleanupRangeSel) {
      const opt2h = cleanupRangeSel.querySelector('option[value="2h"]');
      if (opt2h) opt2h.hidden = (mode === 'notifications');
      // يَعِيد ضَبْط الافتراضِيّ: day لِـ notifications (لا 2h) لِأَنّ 2h مَخْفِيّ، أَو week لِلآخَرين.
      cleanupRangeSel.value = (mode === 'notifications') ? 'day' : 'week';
    }
    cleanupModal.classList.remove('hidden');
    cleanupModal.setAttribute('aria-hidden', 'false');
    if (cleanupOkBtn) cleanupOkBtn.focus();
    document.addEventListener('keydown', cleanupOnKey);
    cleanupModal.addEventListener('click', cleanupOnBackdrop);
  }

  if (logsClearBtn) logsClearBtn.addEventListener('click', () => openCleanupModal('notifications'));
  if (logsClearDowntimeBtn) logsClearDowntimeBtn.addEventListener('click', () => openCleanupModal('downtime'));
  if (logsClearStatusBtn) logsClearStatusBtn.addEventListener('click', () => openCleanupModal('status-logs'));
  if (cleanupCancelBtn) cleanupCancelBtn.addEventListener('click', closeCleanupModal);

  // v2.7.x — زِرّ «تَفْرِيغ الكُلّ» (status_logs): يَستعمِل range='all' (DELETE WHERE checked_at < now
  //         ← يُفَرِّغ الجَدول بِالكامِل) + VACUUM. لا يَفْتَح modal اخْتِيار المُدّة لِأَنّ لا مُدّة لَه؛
  //         يَذهَب مُباشِرةً إِلى confirmAction (تَأكِيد خَطِر بِنَصّ تَحْذِيرِي واضِح).
  if (logsTruncateStatusBtn) logsTruncateStatusBtn.addEventListener('click', async () => {
    const typeLabel = cleanupLabels['status-logs-all'] || T('ntf.labelStatusLogs', 'نَقاط فحص الحالة');
    const ok = await confirmAction({
      title: T('s2j.full_truncation_of_status_checks', '⚠️ تَفْرِيغ كامل لِـ نَقاط فحص الحالة'),
      message: T('ntf.truncateConfirm', 'سيتم حذف كُلّ صُفوف status_logs بِالكامِل ثُمّ VACUUM لِتَقْليص حجم القاعدة.\n⚠️ سيُفقِد ذلك تاريخ Uptime والرسوم البيانية في الصفحة العامة (لِنّ الجَدول هُو مصْدَرها). لا يمكن التَراجُع. مُتابعة؟'),
      confirmText: T('ntf.truncateAll', '⚠️ تَفْرِيغ كامل'),
      danger: true,
    });
    if (!ok) return;
    try {
      const data = await api('/api/devices/cleanup-status-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: 'all' }),
      });
      if (data && data.success) {
        const d = data.data || {};
        const deleted = d.deleted != null ? d.deleted : 0;
        const vacuumed = d.vacuumed === true;
        showToast(`✅ ${T('frag.truncated', 'تَم تَفْرِيغ ')}${deleted} ${T('frag.rows_from', 'صَف من ')}status_logs${vacuumed ? ' + ' + T('ntf.vacuumOk', 'VACUUM ناجح') : ' (' + T('ntf.vacuumFailed', 'VACUUM فَشِل — حَجْم القاعدة لَم يَتقلَّص') + ')'}`, { type: 'success' });
        showToast(T('ntf.tableTruncated', 'ℹ️ الجَدول فُرِّغ بِالكامِل — الرسوم البيانية/Uptime في الصفحة العامة سَتَبْدأ التَجَمُّع من جديد'), { type: 'info', duration: 5000 });
      } else {
        showToast('❌ ' + ((data && data.error) || T('ntf.truncateFailed', 'فشل التَفْرِيغ')), { type: 'error' });
      }
    } catch (e) {
      showToast(T('s2j.server_connection_error', '❌ خطأ في الاتصال بالخادم'), { type: 'error' });
    }
  });

  // تَنفيذ المَسح بعد اختِيار المُدّة و تأكيد المستخدم.
  if (cleanupOkBtn) cleanupOkBtn.addEventListener('click', async () => {
    const type = cleanupMode;
    const range = cleanupRangeSel ? cleanupRangeSel.value : 'week';
    // تَأكيد ثاني عبر confirmAction لِـ أَنّ المَسح لا يُمكن التَراجُع عنه.
    // v2.7.x — rangeInfo تَدْعَم 2h/day/week/month/year لِـ تَوْضِيح رِسالة التَأكِيد (ساعة/أَيام).
    const { days } = rangeInfo(range);
    const ri = rangeInfo(range);
    const typeLabel = cleanupLabels[type] || T('nav.logs', 'السجل');
    const ok = await confirmAction({
      title: T('s2j.confirm_clearing', 'تَأكيد مَسح') + ' ' + typeLabel,
      message: NMI18N.t('notify.clearConfirm', { what: typeLabel, range: ri.text }),
      confirmText: T('ntf.clearBtn', '🗑️ مَسح'),
      danger: true,
    });
    if (!ok) return;

    // نُغلق modal الاختيار فوراً بعد تأكيد المستخدم في confirmAction الثانية
    // (سواء نجح المَسح أَو فشل) — حلاً لمشكلة بَقاء الـ modal ظاهراً عند الفشل.
    closeCleanupModal();

    try {
      let data;
      if (type === 'downtime') {
        // downtime: POST /api/devices/cleanup-history { range }
        const r = await api('/api/devices/cleanup-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ range }),
        });
        data = r;
      } else if (type === 'status-logs') {
        // status_logs: POST /api/devices/cleanup-status-logs { range }
        // هذا الجدول يَكبر بِسرعة (نُقطة لكل دورة فحص لكل جهاز) لذا يُهمّ تَقليصه دورياً.
        const r = await api('/api/devices/cleanup-status-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ range }),
        });
        data = r;
      } else {
        // notifications: DELETE /api/notifications/logs?older_than_days={days}
        // v2.7.x — older_than_days يَجِب أَن يَكون صَحِيحاً (backend يَقْبُل [1,7,30,365]).
        // لِـ day=1, week=7, month=30, year=365 ← كُلّها صَحِيحة بِالفِعل (2h مَخْفِيّ فِي notifications).
        const r = await fetch(`/api/notifications/logs?older_than_days=${Math.round(days)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        data = await r.json();
      }
      if (data && data.success) {
        const deleted = data.data && data.data.deleted != null ? data.data.deleted : 0;
        // v2.7.x — تَفادِي «وَهْم لا يَمْسَح شَيئاً»: لَو deleted===0 فلا توجَد بيانات أَقدم من المُدّة،
        // نُخبِر بِشَفافِيَّة بدل عبارة «تَم مَسح 0 سجل» الغامضة الَّتي بَدَت لِلمُستخدم فشلاً.
        if (deleted === 0) {
          showToast(T('ntf.noDataIn', '✅ لا توجَد بيانات في') + ' ' + typeLabel + ' ' + T('tail.older_than', 'أَقدم من') + ' ' + ri.text + ' ' + T('tail.no_cleanup_needed', '— لا حاجة لِلمَسح'), {
            type: 'info', duration: 5000,
          });
        } else {
          showToast(`✅ ${T('frag.cleared', 'تَم مَسح ')}${deleted} ${T('frag.log', 'سجل ')}(${typeLabel} — ${T('tail.older_than', 'أَقدم من ')}${ri.text})`, { type: 'success' });
        }
        // تَحديث جدول السجل لو كان مُحمَّلاً (notifications).
        if (type === 'notifications' && typeof loadNotificationLogs === 'function') {
          await loadNotificationLogs();
        } else if (deleted > 0) {
          // downtime/status-logs: لا علاقة لَها بِـ notification_logs المَعْرُوض في تَبويب السجل،
          // لِذا لا يُعاد تَحميل الجدول. نُنبّه المُستَخدِم بِأَنّ الأَثر يَنْعَكِس على الصفحة العامة
          // فقط عِندما حَدَث مَسح فعْلِيّ (deleted>0) — إِذا لم يُحْذَف شَيء لا داعي لِلتَنْبِيه.
          showToast(T('ntf.effectOnPublic', 'ℹ️ يَنْعَكِس الأَثر على الرسوم البيانية ونِسَب Uptime في الصفحة العامة عند إِعادَة تَحميلها'), {
            type: 'info', duration: 4000,
          });
        }
      } else {
        showToast('❌ ' + ((data && data.error) || T('ntf.clearFailed', 'فشل المَسح')), { type: 'error' });
      }
    } catch (e) {
      showToast(T('s2j.server_connection_error', '❌ خطأ في الاتصال بالخادم'), { type: 'error' });
    }
  });
});
