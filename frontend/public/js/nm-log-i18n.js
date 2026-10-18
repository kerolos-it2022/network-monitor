// nm-log-i18n.js — ترجمة **عرض** رسائل سجل الإشعارات (بطاقة «📋 سجل الإشعارات» في اللوحة).
//
// لماذا ترجمة عند العرض لا تخزين نسخة إنجليزية؟
//   رسائل السجل نصّ عربي يُبنى ويُخزَّن في السيرفر (notification_logs.message — ٢٤ شكل رسالة من ٦
//   ملفات سيرفر + أسباب). الترجمة عند العرض تعني: صفر تغيير في السيرفر/القاعدة/الـAPI، و**السجل
//   القديم كله يُترجم** (لا عمود جديد ولا هجرة بيانات).
//
// عقد الترجمة:
//   ١) **سطر كامل أو لا شيء**: كل قاعدة تُطبَّق على سطر واحد كامل؛ أي سطر لا تطابقه قاعدة يبقى كما هو
//      — فلا تظهر رسالة نصف مترجمة أبدًا.
//   ٢) **بيانات المستخدم لا تُترجم**: أسماء الأجهزة/المواقع/الصانع/الـIP/MAC تُنسخ حرفيًا؛
//      الترجمة تمسّ التسميات الثابتة والصياغة التي يكتبها النظام فقط.
//   ٣) التنظيف من وسوم تليجرام (<b>/<code>) يجري في اللغتين — نفس ما يفعله السيرفر لواتساب/الهاتف،
//      وكانت تظهر حرفيًا في الجدول.
//
// ⚠️ للمطوّر: عند تغيير/إضافة قالب رسالة في السيرفر (notifier · smart-alerts · escalation ·
//    scan-scheduler · monitor · notifications.routes) عدّل/أضِف قاعدة هنا. اختبار
//    backend/test/log-i18n.test.js يفشل تلقائيًا لو لم تعد «المِسلة» العربية لأي قاعدة موجودة في
//    ملفات السيرفر (أي أن تعارض القوالب يُكتشف فورًا).
//
// حدود معروفة (مقصودة): (١) نصّ تحليل AI داخل التقرير اليومي يُولَّد بالعربية في السيرفر ⇒ يبقى
// عربيًا (العنوان فقط يُترجم). (٢) نصّ الخطأ الحرّ القادم من المزوّدين (service.last_error / ردود
// Telegram) يبقى كما هو. (٣) أي قالب جديد يُضاف للسيرفر يظهر عربيًا حتى تُضاف له قاعدة هنا.
(function (root) {
  'use strict';

  const LS_KEY = 'nm.logLang'; // 'ar' | 'en' — اختيار صريح يخصّ شاشة السجل وحدها (يتجاوز لغة الواجهة)

  // ══ أدوات نصّية ══════════════════════════════════════════════════════════

  /** الأرقام العربية-الهندية (٠-٩) والفارسية ⇒ لاتينية. */
  function latinDigits(s) {
    return String(s)
      .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
  }

  /** طابع زمني/تاريخ عربي (toLocaleString('ar') من Node) ⇒ مقروء بالإنجليزية. */
  function dt(s) {
    let t = latinDigits(s)
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '') // علامات الاتجاه
      .replace(/\u060C/g, ',');                                 // «،» ⇒ ','
    t = t.replace(/\s*ص\s*$/, ' AM').replace(/\s*م\s*$/, ' PM'); // ص/م ⇒ AM/PM
    return t.replace(/\s+/g, ' ').trim();
  }

  /** كلمة وحدتها بالإفراد/الجمع: 1 minute · 3 minutes */
  function unit(n, word) { return word + (Number(n) === 1 ? '' : 's'); }

  /**
   * مدة الانقطاع كما يكتبها السيرفر (notifier.formatDuration):
   * «45 ثانية» · «3 دقيقة» · «1 ساعة و20 دقيقة» · «غير معروف». تُرجع null لشكل غير معروف.
   */
  function enDuration(raw) {
    const t = latinDigits(raw).replace(/[\u200E\u200F]/g, '').trim();
    if (t === 'غير معروف') return 'unknown';
    let m;
    if ((m = t.match(/^(\d+)\s*ثانية$/))) return m[1] + ' ' + unit(+m[1], 'second');
    if ((m = t.match(/^(\d+)\s*دقيقة$/))) return m[1] + ' ' + unit(+m[1], 'minute');
    if ((m = t.match(/^(\d+)\s*ساعة\s*و\s*(\d+)\s*دقيقة$/))) {
      return m[1] + ' ' + unit(+m[1], 'hour') + ' ' + m[2] + ' ' + unit(+m[2], 'minute');
    }
    if ((m = t.match(/^(\d+)\s*ساعة$/))) return m[1] + ' ' + unit(+m[1], 'hour');
    return null;
  }

  /** قيم ثابتة يكتبها السيرفر بنفسه (ليست بيانات مستخدم) ⇒ تُترجم. */
  const VALUES = { 'غير متاح': 'n/a', 'غير معروف': 'unknown', 'جهاز محذوف': 'deleted device' };
  function val(v) {
    const t = String(v).trim();
    return Object.prototype.hasOwnProperty.call(VALUES, t) ? VALUES[t] : v;
  }

  function stripTags(s) { return String(s).replace(/<\/?(?:b|code)>/gi, ''); }

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ══ القواعد ══════════════════════════════════════════════════════════════
  // ar  : المِسلة العربية الحرفية كما هي في ملفات السيرفر (يُدقّقها الاختبار الآلي).
  // re  : تعبير على السطر الكامل — البادئة (الإيموجي) تُلتقط ولا تُشترط حرفيًا.
  // en  : دالة تبني الترجمة من نتيجة المطابقة (m)، وnull = اترك السطر كما هو.

  const RULES = [];

  /** قاعدة «سطر كامل» مخصّصة: `^(.*?)المِسلة…(.*)$` أو تعبير كامل مع باني ترجمة. */
  function rule(ar, re, en) { RULES.push({ ar: [].concat(ar), re, en }); }

  /** قاعدة «تسمية: قيمة» — التسمية العربية تُترجم والقيمة تُترك/تُحوَّل بدالة. */
  function field(ar, en, valueFn) {
    rule(ar, new RegExp('^(.*?)' + escRe(ar) + ': (.*)$'),
      (m) => m[1] + en + ': ' + (valueFn ? valueFn(m[2]) : m[2]));
  }

  // ── ١-٦ · انقطاع/تعافٍ جهاز — notifier.service (notifyDeviceDown/Recovered) ──
  rule(['[صيانة] انقطع الجهاز: ', ' — الوقت: '],
    /^(.*?)\[صيانة\] انقطع الجهاز: (.*?) \(IP: (.*?)\) — الوقت: (.*)$/,
    (m) => m[1] + '[Maintenance] Device down: ' + m[2] + ' (IP: ' + m[3] + ') — Time: ' + dt(m[4]));
  rule(['انقطع الجهاز: '], /^(.*?)انقطع الجهاز: (.*)$/, (m) => m[1] + 'Device down: ' + m[2]);
  rule(['[صيانة] عاد الجهاز: ', ' — الوقت: '],
    /^(.*?)\[صيانة\] عاد الجهاز: (.*?) \(IP: (.*?)\) — الوقت: (.*)$/,
    (m) => m[1] + '[Maintenance] Device recovered: ' + m[2] + ' (IP: ' + m[3] + ') — Time: ' + dt(m[4]));
  rule(['عاد الجهاز للعمل: '], /^(.*?)عاد الجهاز للعمل: (.*)$/, (m) => m[1] + 'Device back online: ' + m[2]);
  rule(['مدة الانقطاع: '], /^(.*?)مدة الانقطاع: (.*)$/,
    (m) => m[1] + 'Downtime: ' + (enDuration(m[2]) || m[2]));

  // ── ٧-١١ · الخدمات المراقَبة (MON-02) — notifier.service ──
  rule(['خدمة متوقفة: '], /^(.*?)خدمة متوقفة: (.*)$/, (m) => m[1] + 'Service down: ' + m[2]);
  rule(['عادت الخدمة للعمل: '], /^(.*?)عادت الخدمة للعمل: (.*)$/, (m) => m[1] + 'Service back up: ' + m[2]);
  field('الجهاز', 'Device');
  field('الفحص', 'Check');
  field('الخطأ', 'Error', (v) => val(v));

  // ── حقول مشتركة داخل الرسائل (انقطاع/جهاز جديد) ──
  field('النوع', 'Type');
  field('الموقع', 'Location');
  field('الوقت', 'Time', (v) => dt(v));

  // ── ١٢-١٣ · رسائل الاختبار — notifier.service · notifications.routes ──
  rule(['إشعار تجريبي من نظام مراقبة الشبكة'],
    /^(.*?)إشعار تجريبي من نظام مراقبة الشبكة(.*)$/,
    (m) => m[1] + 'Test notification from Network Monitor' + m[2]);
  rule(['إشعار تجريبي (', ') من نظام مراقبة الشبكة'],
    /^(.*?)إشعار تجريبي \((.*?)\) من نظام مراقبة الشبكة(.*)$/,
    (m) => m[1] + 'Test notification (' + m[2] + ') from Network Monitor' + m[3]);

  // ── ١٤-١٨ · تنبيه العاصفة (انقطاع جماعي) — smart-alerts.service ──
  rule(['انقطاع جماعي — ', 'جهازًا خلال دقيقتين:'],
    /^(.*?)انقطاع جماعي — (.*?) جهازًا خلال دقيقتين:(.*)$/,
    (m) => m[1] + 'Mass outage — ' + m[2] + ' devices within two minutes:' + m[3]);
  rule(['السبب المشترك المحتمل:', 'الجهاز الأب في السلسلة: ', ' — افحصه أولًا.'],
    /^(.*?)السبب المشترك المحتمل: (.*?)الجهاز الأب في السلسلة: (.*?) \((.*?)\) — افحصه أولًا\.(.*)$/,
    (m) => m[1] + 'Likely common cause: ' + m[2] + 'the parent device in the chain: ' + m[3] +
      ' (' + m[4] + ') — check it first.' + m[5]);
  rule(['الخط الخارجي واقع أيضًا', ' — الأرجح: عطل من مزود الإنترنت/الراوتر الرئيسي وليس داخل شبكتك'],
    /^(.*?)الخط الخارجي واقع أيضًا(.*?)\s*\((.*?)\) — الأرجح: عطل من مزود الإنترنت\/الراوتر الرئيسي وليس داخل شبكتك(.*)$/,
    (m) => m[1] + 'The external line is down too' + m[2] + ' (' + m[3] +
      ') — most likely an ISP / main-router fault, not inside your network' + m[4]);
  rule(['خط الإنترنت الخارجي يعمل — الانقطاع ', 'داخلي', ' (سويتش/كابل/توصيلات)'],
    /^(.*?)خط الإنترنت الخارجي يعمل — الانقطاع داخلي \(سويتش\/كابل\/توصيلات\)(.*)$/,
    (m) => m[1] + 'The external internet line is up — the outage is internal ' +
      '(switch/cable/wiring)' + m[2]);

  // ── ١٩-٢٤ · التقرير اليومي — smart-alerts.service (buildDailyReport) ──
  rule(['التقرير اليومي — '], /^(.*?)التقرير اليومي — (.*)$/, (m) => m[1] + 'Daily report — ' + dt(m[2]));
  rule(['يوم نظيف: لا انقطاعات في آخر 24 ساعة'],
    /^(.*?)يوم نظيف: لا انقطاعات في آخر 24 ساعة(.*)$/,
    (m) => m[1] + 'Clean day: no outages in the last 24 hours' + m[2]);
  rule(['انقطاعات آخر 24 ساعة: ', ' · إجمالي ', ' دقيقة'],
    /^(.*?)انقطاعات آخر 24 ساعة: (.*?) · إجمالي (.*?) دقيقة(.*)$/,
    (m) => m[1] + 'Outages in the last 24 hours: ' + m[2] + ' · total ' + m[3] + ' ' +
      unit(parseInt(m[3], 10) || 2, 'minute') + m[4]);
  rule(['الأكثر انقطاعًا: ', ' دقيقة', ' ثانية', ' مرة)'],
    /^(.*?)الأكثر انقطاعًا: (.*?) — (.*?) (دقيقة|ثانية) \((\d+) مرة\)(.*)$/,
    (m) => m[1] + 'Most affected: ' + m[2] + ' — ' + m[3] + ' ' +
      unit(parseInt(m[3], 10) || 2, m[4] === 'ثانية' ? 'second' : 'minute') +
      ' (' + m[5] + ' ' + unit(+m[5], 'time') + ')' + m[6]);
  rule(['الوضع الآن: ', ' متصل · ', ' متوقف'],
    /^(.*?)الوضع الآن: (.*?) متصل · (.*?) متوقف(.*)$/,
    (m) => m[1] + 'Status now: ' + m[2] + ' online · ' + m[3] + ' offline' + m[4]);
  rule(['تحليل AI:'], /^(.*?)تحليل AI:(.*)$/, (m) => m[1] + 'AI analysis:' + m[2]);

  // ── ٢٥-٢٦ · التصعيد — escalation.service ──
  rule(['تصعيد انقطاع', ' (تذكير دوري كل ', ' دقيقة)'],
    /^(.*?)تصعيد انقطاع( \(تذكير دوري كل (\d+) دقيقة\))?(.*)$/,
    (m) => m[1] + 'Outage escalation' +
      (m[2] ? ' (periodic reminder every ' + m[3] + ' ' + unit(+m[3], 'minute') + ')' : '') + m[4]);
  rule(['ما زال واقعًا منذ ', ' دقيقة', ' (العتبة: ', ' دقيقة) — تحرّك الآن أو أكّد العمل.'],
    /^(.*?)ما زال واقعًا منذ (.*?) دقيقة \(العتبة: (.*?) دقيقة\) — تحرّك الآن أو أكّد العمل\.(.*)$/,
    (m) => m[1] + 'Still down for ' + m[2] + ' ' + unit(parseInt(m[2], 10) || 2, 'minute') +
      ' (threshold: ' + m[3] + ' ' + unit(parseInt(m[3], 10) || 2, 'minute') +
      ') — act now or acknowledge.' + m[4]);

  // ── ٢٧-٢٩ · جهاز جديد في الشبكة — scan-scheduler.service ──
  rule(['جهاز جديد في الشبكة'], /^(.*?)جهاز جديد في الشبكة(.*)$/,
    (m) => m[1] + 'New device on the network' + m[2]);
  field('الصانع', 'Vendor');
  field('الاسم', 'Name');
  field('النوع المتوقَّع', 'Expected type');

  // ── ٣٠-٣٣ · محرك المراقبة (الحراسة) — monitor.service ──
  rule(['تحذير: محرك المراقبة متعطل'],
    /^(.*?)تحذير: محرك المراقبة متعطل(.*)$/,
    (m) => m[1] + 'Warning: the monitoring engine is stalled' + m[2]);
  rule(['لا نبضة من محرك الفحص منذ ', ' ثانية'],
    /^(.*?)لا نبضة من محرك الفحص منذ (.*?) ثانية(.*)$/,
    (m) => m[1] + 'No heartbeat from the check engine for ' + m[2] + ' ' +
      unit(parseInt(m[2], 10) || 2, 'second') + m[3]);
  rule([' فحص عالق منذ أكثر من ', ' ثانية ('],
    /^(.*?)(\d+) فحص عالق منذ أكثر من (\d+) ثانية \((.*)\)(.*)$/,
    (m) => m[1] + m[2] + ' ' + unit(parseInt(m[2], 10) || 2, 'check') + ' stuck for more than ' +
      m[3] + ' ' + unit(parseInt(m[3], 10) || 2, 'second') + ' (' + m[4].replace(/،\s*/g, ', ') + ')' + m[5]);
  rule(['البيانات المعروضة قد تكون قديمة — راجع حالة الجهاز.'],
    /^(.*?)البيانات المعروضة قد تكون قديمة — راجع حالة الجهاز\.(.*)$/,
    (m) => m[1] + 'Displayed data may be stale — check the device status.' + m[2]);
  rule(['عاد محرك المراقبة للعمل طبيعيًا.'],
    /^(.*?)عاد محرك المراقبة للعمل طبيعيًا\.(.*)$/,
    (m) => m[1] + 'The monitoring engine is working normally again.' + m[2]);

  // ── ٣٤ · أسباب السجل (notification_logs.error) — notifier/routes ──
  rule(['مجمَّع في تنبيه العاصفة (سيصدر خلال دقيقتين)'],
    /^(.*?)مجمَّع في تنبيه العاصفة \(سيصدر خلال دقيقتين\)(.*)$/,
    (m) => m[1] + 'Batched into the storm alert (will be sent within two minutes)' + m[2]);
  rule(['كل التسجيلات لم تعد صالحة (404/410) وتم تعطيلها — أعِد التفعيل من الهاتف'],
    /^(.*?)كل التسجيلات لم تعد صالحة \(404\/410\) وتم تعطيلها — أعِد التفعيل من الهاتف(.*)$/,
    (m) => m[1] + 'All subscriptions are no longer valid (404/410) and were disabled — ' +
      're-enable them from the phone' + m[2]);
  rule(['تعذّر الإرسال لأي تسجيل'], /^(.*?)تعذّر الإرسال لأي تسجيل(.*)$/,
    (m) => m[1] + 'Could not send to any subscription' + m[2]);
  rule(['خطأ غير معروف'], /^(.*?)خطأ غير معروف(.*)$/, (m) => m[1] + 'Unknown error' + m[2]);
  // قناة غير معروفة: مسارات الخادم تكتبها بصيغتين («: sms — المتاح: …» و«— المتاح: …»).
  rule(['قناة غير معروفة: ', ' — المتاح: '],
    /^(.*?)قناة غير معروفة: (.*?) — المتاح: (.*)$/,
    (m) => m[1] + 'Unknown channel: ' + m[2] + ' — available: ' + m[3]);
  rule(['قناة غير معروفة — المتاح: '],
    /^(.*?)قناة غير معروفة — المتاح: (.*)$/,
    (m) => m[1] + 'Unknown channel — available: ' + m[2]);
  rule(['قناة غير معروفة'], /^(.*?)قناة غير معروفة(.*)$/, (m) => m[1] + 'Unknown channel' + m[2]);
  rule(['بلا نتيجة'], /^(.*?)بلا نتيجة(.*)$/, (m) => m[1] + 'No result' + m[2]);
  rule(['المتاح: '], /^(.*?)المتاح: (.*)$/, (m) => m[1] + 'available: ' + m[2]);

  // ══ الترجمة ══════════════════════════════════════════════════════════════

  function translateLine(line) {
    const t = line.trim();
    if (!t) return line;
    for (let i = 0; i < RULES.length; i++) {
      const m = RULES[i].re.exec(t);
      if (m) {
        const out = RULES[i].en(m);
        return out === null || out === undefined ? line : out;
      }
    }
    return line; // سطر غير معروف ⇒ كما هو (لا ترجمة نصف مكسورة)
  }

  /** translate(text): يعيد النصّ جاهزًا للعرض بلغة السجل المختارة. */
  function translate(text) {
    if (text === null || text === undefined) return '';
    const src = String(text);
    if (!src) return src;
    const clean = stripTags(src);
    if (getLang() !== 'en') return clean;
    try {
      return clean.split(/\r?\n/).map(translateLine).join('\n');
    } catch (e) {
      return clean;
    }
  }

  // ══ لغة السجل (مستقلة عن لغة الواجهة) ════════════════════════════════════

  function store() { try { return root.localStorage || null; } catch (e) { return null; } }

  function override() {
    try {
      const s = store();
      const v = s ? s.getItem(LS_KEY) : null;
      return (v === 'ar' || v === 'en') ? v : null;
    } catch (e) { return null; }
  }

  function uiLang() {
    try {
      const n = root.NMI18N;
      if (n && typeof n.getLang === 'function') return n.getLang() === 'ar' ? 'ar' : 'en';
      return 'en';   // احتياط: الإنجليزية هي الافتراضية
    } catch (e) { return 'en'; }
  }

  // إعداد الخادم (app_settings.notification_language) — لغة الإشعارات المُرسَلة نفسها. يُبذَر عند فتح
  // الشاشة، ويُحترم اختيار المستخدم الصريح فوقه. وبذلك يتفق ما يُعرَض في السجل مع ما يُرسَل فعلًا.
  let serverLang = null;
  function setServerLang(code) {
    serverLang = (code === 'ar' || code === 'en') ? code : null;
    return serverLang;
  }

  /** لغة الرسائل الفعلية: اختيار المستخدم ← إعداد الخادم ← لغة الواجهة (احتياط قبل وصول الإعداد). */
  function getLang() { return override() || serverLang || uiLang(); }

  /** هل لغة الرسائل ما زالت تابعة للإعداد (بلا اختيار صريح من المستخدم)؟ */
  function followsUi() { return override() === null; }

  function setLang(code) {
    const v = code === 'en' ? 'en' : 'ar';
    try { const s = store(); if (s) s.setItem(LS_KEY, v); } catch (e) { /* متصفح بلا تخزين */ }
    return v;
  }

  root.NMLogI18N = {
    translate: translate,
    stripTags: stripTags,
    getLang: getLang,
    setLang: setLang,
    setServerLang: setServerLang,
    followsUi: followsUi,
    uiLang: uiLang,
    latinDigits: latinDigits,
    enDuration: enDuration,
    rules: RULES, // للاختبار الآلي (تدقيق المِسلات + عيّنات القوالب)
  };
})(typeof window !== 'undefined' ? window : globalThis);
