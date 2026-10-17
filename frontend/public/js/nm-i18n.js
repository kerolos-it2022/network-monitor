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
      'topbar.lang': '🌐 English',
      'lang.switchTitle': 'تبديل اللغة (عربي / إنجليزي)',

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

      // ── تسجيل الدخول والذيل (استكمال) ──
      'login.docTitle': 'تسجيل الدخول — لوحة التحكم',
      'login.pwShow': 'إظهار كلمة المرور',
      'login.pwHide': 'إخفاء كلمة المرور',
      'login.pwToggleTitle': 'إظهار/إخفاء كلمة المرور',
      'login.capsLock': '⚠️ مفتاح Caps Lock مُفعَّل — ستُكتب الحروف كبيرة',
      'login.busy': '⏳ جارٍ الدخول…',
      'login.badCredentials': 'بيانات الدخول غير صحيحة',
      'api.serverDown': 'تعذر الاتصال بالخادم',

      // ── إطار اللوحة: عناوين التبويبات · تلميحات القائمة · المساعدات المشتركة ──
      'tabs.devices': '📱 إدارة الأجهزة',
      'tabs.locations': '📍 إدارة المواقع',
      'tabs.types': '🏷️ أنواع الأجهزة',
      'tabs.discovery': '🔍 اكتشاف الأجهزة',
      'tabs.pending': '📥 بانتظار الاعتماد',
      'tabs.scheduler': '⏱️ الجدولة التلقائية',
      'tabs.map': '🗺️ خريطة المواقع',
      'tabs.topology': '🔗 سلسلة الشبكة',
      'tabs.notifications': '🔔 الإشعارات',
      'tabs.ai': '🤖 شات AI',
      'tabs.logs': '📋 سجل الإشعارات',
      'tabs.profile': '👤 الملف الشخصي والحسابات',
      'tabs.backup': '💾 النسخ الاحتياطي',
      'tabs.remote': '🌍 الوصول عن بُعد',
      'tabs.display': '🎛️ إعدادات العرض والأدوات',
      'tabs.system': '🖥️ حالة النظام',
      'tabs.updates': '🔄 تحديثات النظام',
      'navTitle.devices': 'إدارة الأجهزة',
      'navTitle.locations': 'إدارة المواقع',
      'navTitle.types': 'إدارة أنواع الأجهزة',
      'navTitle.discovery': 'اكتشاف الأجهزة تلقائياً',
      'navTitle.map': 'شجرة المواقع والأجهزة الهرمية',
      'navTitle.topology': 'سلسلة الشبكة: الأجهزة بترتيب المسار وحالاتها',
      'navTitle.notifications': 'إعدادات الإشعارات',
      'navTitle.ai': 'شات AI: اسأل عن الشبكة بالعربية',
      'navTitle.logs': 'سجل الأحداث',
      'navTitle.profile': 'الملف الشخصي',
      'navTitle.backup': 'نسخة احتياطية واستعادة قاعدة البيانات',
      'navTitle.remote': 'الوصول عن بُعد عبر ngrok',
      'navTitle.display': 'إعدادات العرض: ما يراه الزوار وشاشة NOC',
      'navTitle.system': 'حالة النظام: رام/معالج/هارد/شبكة',
      'navTitle.updates': 'تحديثات النظام من GitHub',
      'nav.aria': 'أَقسام لوحة الإِدارة',
      'sidebar.toggleTitle': 'القائمة مفتوحة — اِضغط للطيّ',
      'updates.badge': 'يتوفّر تحديث جديد',
      'discovery.scanNow': '🔍 فحص الآن',
      'confirm.title': 'تَأكيد',
      'confirm.ok': '✓ تَأكيد',
      'confirm.cancel': '✖️ إلغاء',
      'confirm.question': 'تأكيد؟',
      'common.closeToast': 'إغلاق الإشعار',
      'api.badResponse': 'استجابة غير صالحة من الخادم',

      // ── الأجهزة · السجل · الإشعارات ──
      'devices.addTitle': 'إضافة جهاز جديد للمراقبة',
      'devices.export': '📤 تصدير Excel',
      'devices.exportTitle': 'تصدير قائمة الأجهزة لملف Excel',
      'devices.qrLabels': '🏷️ ملصقات QR',
      'devices.qrTitle': 'صفحة طباعة ملصقات QR لكل جهاز (تُلصق على الجهاز)',
      'devices.import': '📥 استيراد Excel',
      'devices.importTitle': 'استيراد أجهزة من ملف Excel',
      'devices.searchTitle': 'بحث فوري: اكتب اسم الجهاز أو عنوان IP — النتائج تتحدّث أثناء الكتابة (Esc للمسح)',
      'devices.filterLocation': 'فلتر الموقع:',
      'devices.filterLocationTitle': 'تصفية الأَجهزة حسب الموقع',
      'devices.filterSort': 'ترتيب:',
      'devices.allLocations': '📍 كل المواقع',
      'devices.sort.name': '🔑 حسب الاسم',
      'devices.sort.ip': '🌐 حسب IP',
      'devices.sort.status': '📶 حسب الحالة',
      'devices.sort.type': '🏷️ حسب النوع',
      'devices.sort.location': '📍 حسب الموقع',
      'devices.sort.lastChecked': '⏱️ حسب آخر فحص',
      'devices.sum.offlineTitle': 'الأجهزة المنقطعة الآن',
      'devices.sum.unknownTitle': 'الأجهزة التي لم تُحسم حالتها بعد (غير معروفة أو موقوفة من المراقبة)',
      'devices.sum.servicesTitle': 'عدد الأجهزة التي بها خدمة مراقَبة متوقفة واحدة على الأقل',
      'devices.th.name': 'الاسم',
      'devices.th.ip': 'IP',
      'devices.th.type': 'النوع',
      'devices.th.location': 'الموقع',
      'devices.th.status': 'الحالة',
      'devices.th.actions': 'إجراءات',
      'devices.empty': 'لا توجد أجهزة مطابقة — أضف جهازًا بزر «➕ إضافة جهاز» أو غيّر الفلاتر.',
      'devices.empty.search': 'لا توجد أجهزة تطابق «{q}» — جرّب جزءًا آخر من الاسم أو IP، أو امسح البحث (Esc).',
      'device.form.add': 'إضافة جهاز',
      'device.form.edit': 'تعديل جهاز',
      'device.form.saveTitle': 'حفظ الجهاز',
      'device.form.cancelTitle': 'إلغاء العملية',
      'device.field.name': 'الاسم',
      'device.field.type': 'النوع',
      'device.field.location': 'الموقع',
      'device.field.noLocation': '— بدون —',
      'device.field.protocol': 'طريقة الفحص',
      'device.field.port': 'المنفذ (افتراضي: HTTP=80, HTTPS=443, Port=مطلوب)',
      'device.field.webPort': 'بورت واجهة الويب (اختياري — لزر «فتح»، مثل 4444)',
      'device.field.webPortTitle': 'بورت مخصص لواجهة الجهاز على الويب — يُكشف البروتوكول (HTTP/HTTPS) تلقائياً',
      'device.field.interval': 'فترة الفحص (ثانية)',
      'device.field.threshold': 'حد التنبيه',
      'device.field.monitored': 'مفعّل للمراقبة',
      'device.field.monitoredOn': 'نعم، المراقبة مفعّلة',
      'device.services.title': '🧩 الخدمات المراقَبة على هذا الجهاز',
      'device.services.hint': 'مضيف متصل وخدمة متوقفة ⇒ تظهر حالة الجهاز «متصل — خدمة متوقفة» وتُرسل تنبيهًا خاصًّا بالخدمة.',
      'device.services.add': '➕ إضافة خدمة',
      'device.services.name': 'اسم الخدمة',
      'device.services.kind': 'النوع',
      'device.services.port': 'المنفذ',
      'device.services.path': 'المسار (للويب)',
      'device.services.expect': 'الحالة المتوقعة',
      'device.services.interval': 'فاصل الفحص (ثانية)',
      'device.services.threshold': 'عتبة الفشل',
      'device.services.critical': 'حرجة',
      'device.services.criticalHint': 'خدمة حرجة (تُبرَز في التنبيهات)',
      'device.services.tls': 'شهادة TLS',
      'device.services.tlsHint': 'التحقق من الشهادة (موصى به)',
      'device.services.addBtn': '➕ إضافة الخدمة',
      'device.services.cancelEdit': '✖️ إلغاء التعديل',
      'devices.openHttps': 'فتح واجهة الجهاز (HTTPS)',
      'devices.openHttp': 'فتح واجهة الجهاز (HTTP)',
      'devices.deleted': 'تم حذف الجهاز',
      'devices.deleteConfirm': 'تأكيد حذف الجهاز',
      'devices.saved': 'تم حفظ الجهاز',
      'logs.filterStatus': 'الحالة:',
      'logs.filterStatusTitle': 'إظهار كل الإشعارات أو الناجحة أو الفاشلة فقط',
      'logs.status.all': 'كل الحالات',
      'logs.status.sent': '✅ تم الإرسال',
      'logs.status.failed': '❌ فشل الإرسال',
      'logs.status.maintenance': '🛠️ مكتوم (صيانة)',
      'logs.filterSort': 'ترتيب:',
      'logs.sort.newest': '🔽 الأحدث أولًا',
      'logs.sort.oldest': '🔼 الأقدم أولًا',
      'logs.sort.device': '📱 حسب الجهاز',
      'logs.sort.channel': '📢 حسب القناة',
      'logs.sort.status': '📊 حسب الحالة',
      'logs.clear': '🗑️ مسح الإشعارات',
      'logs.clearTitle': 'مسح سجل الإِشعارات القديمة',
      'logs.th.time': 'الوقت',
      'logs.th.device': 'الجهاز',
      'logs.th.channel': 'القناة',
      'logs.th.status': 'الحالة',
      'logs.th.message': 'الرسالة',
      'logs.th.reason': 'السبب',
      'logs.empty': 'لا توجد إشعارات مسجَّلة بعد — تظهر هنا كل رسالة يُرسلها النظام (انقطاع/تعافٍ/تصعيد/تقرير).',
      'notify.chip': 'كل القنوات اختيارية — تُحفظ بزر «حفظ الإعدادات» بالأسفل',
      'notify.channelEnabled': 'القناة مفعّلة',
      'notify.testTitle': 'إرسال إشعار تجريبي على هذه القناة فقط',
      'notify.telegram.token': 'توكن البوت',
      'notify.telegram.chatId': 'معرّف المحادثة',
      'notify.whatsapp.url': 'رابط الـ API',
      'notify.whatsapp.token': 'التوكن',
      'notify.whatsapp.to': 'رقم المستلم',
      'notify.fcm.key': 'مفتاح FCM Server Key',
      'notify.storm.title': '⚡ تجميع عواصف الانقطاعات',
      'notify.storm.window': '⏱️ مدة تجميع العاصفة (ثانية)',
      'notify.daily.title': '📊 تقرير يومي مجدول',
      'notify.daily.hour': '⏰ ساعة التقرير اليومي',
      'notify.escalation.title': '🚨 تصعيد الانقطاعات',
      'notify.escalation.after': '⏱️ عتبة التصعيد ودوريته (دقائق)',
      'notify.escalation.afterLabel': 'بعد',
      'notify.escalation.repeatLabel': 'تذكير كل',
      'notify.escalation.hint': '«تذكير كل 0» = تنبيه تصعيد واحد فقط — وأي قيمة أخرى = تذكير دوري حتى يُحلّ الانقطاع (وكتم الصيانة يُطبَّق كالمعتاد).',
      'notify.cover.title': '🖥️ غطاء الإنذار',
      'notify.maintenance.on': '🛠️ كتم الإشعارات أثناء الصيانة',
      'notify.maintenance.from': '🗓️ من',
      'notify.maintenance.to': '🗓️ إلى',
      'notify.maintenance.hint': 'تدعم عبور منتصف الليل (مثل 23:00 إلى 06:00). خلال النافذة تُسجَّل الأحداث بهدوء في السجل بدل إنذار الهاتف.',
      'footer.brand': 'نظام مراقبة أجهزة الشبكة',
    },

    // ⬇️ الإنجليزية تُسجَّل من ملف مستقل (js/nm-i18n-en.js) عبر registerLang — يحفظ ملف العربية مقروءًا.
  };

  // اتجاه كل لغة + اسم الزرار (يستعمله nm-lang.js في زر التبديل)
  const LANG_META = {
    ar: { dir: 'rtl', label: 'العربية', short: 'ع', next: 'English' },
    en: { dir: 'ltr', label: 'English', short: 'EN', next: 'العربية' },
  };
  const STORAGE_KEY = 'nm.lang';   // يُقرأ في سكربت <head> قبل الرسم (بلا وميض بلغة خاطئة)

  let lang = 'ar';

  /** registerLang(code, dict[, meta]) — تسجيل لغة كاملة (المستخدم: js/nm-i18n-en.js). */
  function registerLang(code, dict, meta) {
    const c = String(code || '').toLowerCase();
    if (!c || !dict || typeof dict !== 'object') return false;
    DICT[c] = dict;
    if (meta && typeof meta === 'object') LANG_META[c] = Object.assign(LANG_META[c] || {}, meta);
    if (!LANG_META[c]) LANG_META[c] = { dir: 'ltr', label: c, short: c.toUpperCase(), next: 'ar' };
    return true;
  }

  function dirOf(code) {
    const c = DICT[code] ? code : 'ar';
    return (LANG_META[c] && LANG_META[c].dir) || 'rtl';
  }

  function storedLang() {
    try { return String(localStorage.getItem(STORAGE_KEY) || ''); } catch (e) { return ''; }
  }

  /** t(key, vars) — نصّ المفتاح باللغة الحالية، ثم العربية كاحتياط، ثم المفتاح نفسه (لا نصّ فارغ). */
  function t(key, vars) {
    const table = DICT[lang] || DICT.ar;
    let out = (table && table[key] !== undefined) ? table[key] : (DICT.ar[key] !== undefined ? DICT.ar[key] : key);
    if (vars && typeof out === 'string') {
      out = out.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
    }
    return out;
  }

  /**
   * setLang(code[, opts]) — يضبط اللغة والاتجاه (rtl/ltr من LANG_META) ويحفظها ويُبلّغ الشاشات.
   * opts.persist=false: تطبيق بلا كتابة في المتصفح (يُستعمل عند القراءة الأولى للسكربت).
   * الحدث nm:lang يسمح للشاشات التي تبني نصوصها بالجافاسكربت أن تعيد الرسم بلغتها الجديدة.
   */
  function setLang(code, opts) {
    const c = String(code || '').toLowerCase();
    lang = DICT[c] ? c : 'ar';
    const dir = dirOf(lang);
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', dir);
    if (window.NMFormat && typeof window.NMFormat.setLang === 'function') {
      try { window.NMFormat.setLang(lang); } catch (e) {}
    }
    if (!opts || opts.persist !== false) {
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    }
    applyDom(document);
    try { document.dispatchEvent(new CustomEvent('nm:lang', { detail: { lang: lang, dir: dir } })); } catch (e) {}
    return lang;
  }

  function getLang() { return lang; }

  /** كل عنصر عليه نصّ و/أو سمات مترجمة — كان من عليه data-i18n-attr وحده يُهمَل (خطأ مُصلَح). */
  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n], [data-i18n-attr]').forEach((el) => {
      // النصّ (اختياري): عنصر عليه data-i18n-attr وحدها كان يُتخطّى قبل هذا الإصلاح
      const key = el.getAttribute('data-i18n');
      if (key) {
        const val = t(key);
        if (val !== key) el.textContent = val;
      }
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

  /** كل المفاتيح المستخدمة في الصفحة الحالية (نصّ + سمات) — لتقرير التغطية. */
  function usedKeys(root) {
    const scope = root || document;
    const out = new Set();
    scope.querySelectorAll('[data-i18n], [data-i18n-attr]').forEach((el) => {
      const k = el.getAttribute('data-i18n');
      if (k) out.add(k);
      const extra = el.getAttribute('data-i18n-attr');
      if (extra) extra.split(/\s+/).forEach((pair) => { const key = (pair.split(':')[1] || '').trim(); if (key) out.add(key); });
    });
    return [...out];
  }

  /**
   * coverage(code) — تقرير نطاق: كم مفتاحًا عربيًّا ينقص في لغة معيّنة (يُستعمل في docs/i18n.md
   * وفي اختبار التكافؤ). الحاجة الفعلية لا تُحسب هنا (الشاشات تحدد ما تحتاجه) بل المفاتيح المترجمة.
   */
  function coverage(code) {
    const c = String(code || '').toLowerCase();
    const ar = Object.keys(DICT.ar);
    const table = DICT[c] || {};
    const missing = ar.filter((k) => table[k] === undefined || !String(table[k]).trim());
    return { lang: c, total: ar.length, translated: ar.length - missing.length, missing: missing };
  }

  window.NMI18N = {
    t, setLang, getLang, applyDom, keys, usedKeys, registerLang, dirOf, storedLang, coverage,
    LANG_META, STORAGE_KEY, dict: DICT,
  };

  // أول تحميل: اللغة المحفوظة (سكربت <head> ضبط الاتجاه قبل الرسم — هنا نُكمل النصوص بلا وميض).
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const s = storedLang();
      if (s && s !== lang && DICT[s]) setLang(s, { persist: false });
      else applyDom(document);
    } catch (e) {}
  });
})();
