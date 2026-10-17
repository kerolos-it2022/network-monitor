// nm-i18n.js — أساس الترجمة (i18n) لكل صفحات النظام: مفتاح واحد لكل نصّ مرئي، والعربية هي اللغة
// الافتراضية الآن. الهدف المُعلن للمالك: «هنضيف الإنجليزية بجانب العربية في المستقبل» — إضافة اللغة
// الإنجليزية لاحقًا تكون **بتعبئة نفس المفاتيح** في القسم en، بلا أي تعديل في الشاشات.
//
// الاستخدام:
//   • في الـ HTML:  <span data-i18n="nav.devices">الأجهزة</span>
//                   <button data-i18n-attr="title:tools.ping.title" data-i18n="tools.ping">📡 Ping</button>
//                   (النصّ العربي مكتوب في الوسم كحلّ احتياطي — الصفحة تظهر فورًا بلا انتظار جافاسكربت)
//   • في الـ JS:    NMI18N.t('noc.online')            → 'أجهزة متصلة'
//                   NMI18N.t('x.y', { n: 3 })        → استبدال {n} داخل النصّ
//
// قواعد ثابتة (قرار المالك):
//   • القيم البرمجية (lan · minimal · off · ping · zone …) **لا تُترجم** — نصوص التشغيل تبقى كما هي.
//   • بيانات المستخدم (أسماء الأجهزة والأنواع والمواقع) **لا تُترجم** — تُعرض كما كتبها.
//   • معلومات النظام (Heap · x64 · Windows_NT …) ومقادير الأجهزة **لا تُترجم**.
//   • أسماء العلامات (ngrok · Node · SNMP · IP · MAC …) تبقى كما هي في اللغتين.
(function () {
  'use strict';

  const DICT = {
    ar: {
      // ── التنسيق العام ──
      'common.yes': 'نعم',
      'common.no': 'لا',
      'common.none': '—',
      'common.all': 'الكل',
      'common.save': '💾 حفظ',
      'common.saveSettings': '💾 حفظ الإعدادات',
      'common.cancel': 'إلغاء',
      'common.edit': '✏️ تعديل',
      'common.delete': '🗑️ حذف',
      'common.details': 'تفاصيل',
      'common.add': '➕ إضافة',
      'common.close': 'إغلاق',
      'common.retry': '🔄 إعادة المحاولة',
      'common.loading': '…جارٍ التحميل',

      // ── حالات الأجهزة ──
      'status.online': 'متصل',
      'status.offline': 'متوقف',
      'status.unknown': 'غير معروف',
      'status.paused': 'موقوف',
      'status.serviceDown': 'خدمة متوقفة',

      // ── الشريط العلوي والقائمة الجانبية (لوحة التحكم) ──
      'nav.devices': 'الأَجهزة',
      'nav.locations': 'المواقع',
      'nav.types': 'أنواع الأجهزة',
      'nav.discovery': 'اِكتشاف الأَجهزة',
      'nav.map': 'خريطة المواقع',
      'nav.topology': 'سلسلة الشبكة',
      'nav.notifications': 'الإِشعارات',
      'nav.ai': 'شات AI',
      'nav.logs': 'السجل',
      'nav.profile': 'الملف الشخصي',
      'nav.backup': 'النسخ الاحتياطي',
      'nav.remote': 'الوصول عن بُعد',
      'nav.display': 'إعدادات العرض',
      'nav.system': 'حالة النظام',
      'nav.updates': 'التَحديثات',
      'topbar.dashboard': 'لوحة التحكم',
      'topbar.publicPage': '🏠 الصفحة العامة',
      'topbar.themeDark': '🌙 وضع ليلي',
      'topbar.themeLight': '☀️ وضع نهاري',
      'topbar.logout': '🚪 تسجيل الخروج',

      // ── الصفحة العامة ──
      'public.title': 'مراقبة أجهزة الشبكة',
      'public.adminLink': 'لوحة التحكم',
      'public.notifyOn': '🔔 تفعيل الإشعارات',
      'public.tvScreen': '📺 عرض الشاشة',
      'public.filter.type': 'كل الأنواع',
      'public.filter.location': 'كل المواقع',
      'public.filter.status': 'كل الحالات',
      'public.view.cards': 'عرض بطاقات',
      'public.view.table': 'عرض جدول',
      'public.tools.title': '🛠️ أدوات الشبكة',
      'public.tools.ping': '📡 Ping',
      'public.tools.tracert': '🌐 Tracert',
      'public.tools.speed': '⚡ قياس السرعة',
      'public.tools.stop': '⏹ إيقاف',
      'public.tools.clear': '🗑️ مسح',

      // ── شاشة NOC ──
      'noc.brand': 'مراقبة الشبكة — NOC',
      'noc.tag': 'مركز عمليات الشبكة',
      'noc.online': '🟢 أجهزة متصلة',
      'noc.offline': '🔴 أجهزة منقطعة',
      'noc.blocked': '⛔ مسدودة عبر المسار',
      'noc.sites': '🏢 إجمالي المواقع والمباني',
      'noc.backbone': '🔗 مسار الإنترنت والبنية التحتية الرئيسية',
      'noc.assets': 'أنواع الأجهزة',
      'noc.publicPage': '🏠 الصفحة العامة',
      'noc.themeDark': '🌙 وضع ليلي',
      'noc.themeLight': '☀️ وضع نهاري',
      'noc.sound': 'تنبيه صوتي',
      'noc.fullscreen': '⛶ ملء الشاشة',
      'noc.liveStatus': 'مراقبة حية — تحديث فوري (SSE)',
      'noc.pollStatus': 'مراقبة حية — تحديث دوري كل {s} ثانية',
      'noc.serverDown': '⚠️ تعذر الوصول للخادم — إعادة المحاولة جارية...',
      'noc.displayOff': '⛔ أوقف المالك العرض العام — لا بثّ ولا تحديث (إعادة محاولة كل دقيقة)',

      // ── لوحة التحكم: عناوين الأقسام ──
      'card.devices.title': '📱 إدارة الأجهزة',
      'card.locations.title': '📍 إدارة المواقع',
      'card.types.title': '🏷️ أنواع الأجهزة',
      'card.discovery.title': '🔍 اكتشاف الأجهزة',
      'card.map.title': '🗺️ خريطة المواقع',
      'card.topology.title': '🔗 سلسلة الشبكة',
      'card.notifications.title': '🔔 إعدادات الإشعارات',
      'card.ai.title': '🤖 شات AI',
      'card.logs.title': '📋 سجل الإشعارات',
      'card.profile.title': '👤 الملف الشخصي والحسابات',
      'card.backup.title': '💾 النسخ الاحتياطي',
      'card.remote.title': '🌍 الوصول عن بُعد (ngrok)',
      'card.display.title': '🎛️ إعدادات العرض والأدوات',
      'card.system.title': '🖥️ حالة النظام — الاستهلاك الحي',
      'card.updates.title': '🔄 تحديثات النظام',

      // ── لوحة التحكم: أزرار وحقول متكرّرة ──
      'admin.addDevice': '➕ إضافة جهاز',
      'admin.unset': 'غير مضبوط',
      'admin.enabled': 'مفعّل',
      'admin.disabled': 'معطّل',
      'admin.unknownType.title': 'شات AI',
      'admin.refresh': '🔄 تحديث',
      'admin.testNotification': '🔔 اختبار الإشعار',
      'admin.testChannel': '🔔 اختبار هذه القناة',

      // ── الأوضاع (الوصف الظاهر — القيم البرمجية لا تُترجم) ──
      'display.mode.lan': '🏠 البطاقات + خريطة المواقع (الافتراضي للشبكة الداخلية)',
      'display.mode.minimal': '🔒 الحالة فقط بلا خريطة (الأنسب للرابط المكشوف على الإنترنت)',
      'display.mode.off': '⛔ إيقاف العرض العام تمامًا (أي زائر يُرفض)',
      'display.guestHeading': '🧑‍🤝‍🧑 ما يراه الزائر (بدون تسجيل دخول)',
      'display.userHeading': '🙋 ما يراه المستخدم المسجَّل (مدير أو عرض)',
      'display.toolsHeading': '🛠️ أدوات التشخيص (Ping / Tracert)',

      // ── أنواع المواقع ──
      'kind.internet': '🌐 إنترنت',
      'kind.zone': '📍 منطقة',
      'kind.site': '🏛️ موقع',
      'kind.building': '🏢 مبنى',
      'kind.floor': '📐 طابق',
      'kind.room': '🚪 غرفة',
      'kind.rack': '🗄️ خزانة',

      // ── تسجيل الدخول ──
      'login.title': 'تسجيل الدخول',
      'login.username': 'اسم المستخدم',
      'login.password': 'كلمة المرور',
      'login.remember': 'تذكّرني (30 يومًا)',
      'login.submit': '🔑 دخول',
      'login.back': 'العودة للصفحة العامة',

      // ── مجموعات أنواع الأجهزة في NOC ──
      'noc.group.firewall': 'جدار الحماية والبوابات',
      'noc.group.server': 'الخوادم والأنظمة المركزية',
      'noc.group.switch': 'السويتشات وموزعات الشبكة',
      'noc.group.ap': 'نقاط الواي فاي والشبكة اللاسلكية',
      'noc.group.nvr': 'كاميرات المراقبة وأجهزة التسجيل',
      'noc.group.printer': 'الطابعات وماكينات التصوير',
      'noc.group.other': 'أجهزة وأنظمة أخرى',

      // ── ملخص الأجهزة والبحث في لوحة التحكم ──
      'devices.search.placeholder': '🔍 ابحث بالاسم أو IP…',

      'devices.sum.total': '📊 إجمالي الأجهزة',
      'devices.sum.online': '🟢 متصل الآن',
      'devices.sum.offline': '🔴 منقطع',
      'devices.sum.unknown': '⚪ غير معروف',
      'devices.sum.services': '🧩 خدمات متأثرة',

      // ── ذيل الصفحة ──
      'footer.rights': 'جميع الحقوق محفوظة',

      // ── مفاتيح أقسام داخلية (إشعارات · نسخ احتياطي · مستخدمون · دخول) ──
      'login.subtitle': 'لوحة تحكم نظام مراقبة الشبكة',
      'noc.activeDevices': '📊 إجمالي الأجهزة النشطة',
      'notify.sub.telegram': '📨 تلجرام',
      'notify.sub.whatsapp': '📟 واتساب',
      'notify.sub.mobile': '📱 إشعارات الهاتف',
      'notify.sub.smart': '🧠 ذكاء الإشعارات',
      'backup.card.schedule': '⏰ النسخ الاحتياطي التلقائي المجدول',
      'backup.card.main': '💾 النسخ الاحتياطي واستعادة قاعدة البيانات',
      'backup.card.cleanup': '🧹 تَنظيف جداول السِّجلّات الكبيرة',
      'backup.card.io': '⬆️⬇️ تصدير واستعادة ملف',
      'users.card.title': '👥 إدارة المستخدمين',
      'users.card.password': '🔐 تغيير كلمة المرور',
      'users.card.info': '🪪 معلومات الحساب',
    },

    // ⬇️ مكان اللغة الإنجليزية: تُعبّأ لاحقًا بنفس المفاتيح (لا شيء مطلوب الآن).
    // en: { 'status.online': 'Online', ... }
  };

  let lang = 'ar';

  /** t(key, vars) — نصّ المفتاح باللغة الحالية، ثم العربية كاحتياط، ثم المفتاح نفسه (لا نصّ فارغ). */
  function t(key, vars) {
    const table = DICT[lang] || DICT.ar;
    let out = (table && table[key] !== undefined) ? table[key] : (DICT.ar[key] !== undefined ? DICT.ar[key] : key);
    if (vars && typeof out === 'string') {
      out = out.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
    }
    return out;
  }

  function setLang(code) {
    const c = String(code || '').toLowerCase();
    lang = DICT[c] ? c : 'ar';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', 'rtl');   // كل لغات المشروع الحالية RTL
    applyDom(document);
    return lang;
  }

  function getLang() { return lang; }

  /** يملأ كل عنصر عليه data-i18n من القاموس (العربية الآن) — بلا أي تأثير على القيم البرمجية. */
  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const val = t(key);
      if (val !== key) el.textContent = val;
      // ترجمة سمات إضافية: data-i18n-attr="title:some.key placeholder:other.key"
      const extra = el.getAttribute('data-i18n-attr');
      if (extra) {
        extra.split(/\s+/).forEach((pair) => {
          const [attr, k] = pair.split(':');
          if (attr && k) {
            const v = t(k);
            if (v !== k) el.setAttribute(attr, v);
          }
        });
      }
    });
  }

  /** مفاتيح القاموس العربية — تُستعمل في فحص التغطية والاختبارات. */
  function keys() { return Object.keys(DICT.ar); }

  /** كل المفاتيح المستخدمة في الصفحة الحالية (لاستخدامها في تقرير التغطية). */
  function usedKeys(root) {
    const scope = root || document;
    const out = new Set();
    scope.querySelectorAll('[data-i18n]').forEach((el) => out.add(el.getAttribute('data-i18n')));
    return [...out];
  }

  window.NMI18N = { t, setLang, getLang, applyDom, keys, usedKeys, dict: DICT };

  document.addEventListener('DOMContentLoaded', () => { try { applyDom(document); } catch (e) {} });
})();
