// admin-notifications.js: تحميل وحفظ إعدادات الإشعارات + عرض سجل الإشعارات عند فتح التبويب.
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
let currentLogsSort = 'sent_at_desc'; // متغير عام لتخزين الترتيب الحالي للسجلات

async function loadNotificationSettings() {
  const r = await api('/api/notifications/settings');
  if (!r.success) return;
  const d = r.data;
  document.getElementById('ntf-telegram_enabled').checked = !!d.telegram_enabled;
  // نعرض المفتاح المقنّع فقط كـ placeholder؛ المستخدم يمكنه إدخال قيمة جديدة.
  document.getElementById('ntf-telegram_bot_token').placeholder = d.telegram_bot_token || 'غير مضبوط';
  document.getElementById('ntf-telegram_bot_token').value = '';
  document.getElementById('ntf-telegram_chat_id').value = d.telegram_chat_id || '';
  document.getElementById('ntf-whatsapp_enabled').checked = !!d.whatsapp_enabled;
  document.getElementById('ntf-whatsapp_api_url').value = d.whatsapp_api_url || '';
  document.getElementById('ntf-whatsapp_api_token').placeholder = d.whatsapp_api_token || 'غير مضبوط';
  document.getElementById('ntf-whatsapp_api_token').value = '';
  document.getElementById('ntf-whatsapp_to_number').value = d.whatsapp_to_number || '';
  // إعدادات الموبايل/FCM
  document.getElementById('ntf-mobile_enabled').checked = !!d.mobile_enabled;
  document.getElementById('ntf-fcm_server_key').placeholder = d.fcm_server_key || 'غير مضبوط';
  document.getElementById('ntf-fcm_server_key').value = '';
}

async function saveNotificationSettings() {
  // v2.7.1 (مَطلب 5) — تَأكيد قبل حفظ إعدادات الإِشعارات (إِجراء حسّاس).
  const ok = await confirmAction({
    title: 'تَأكيد حفظ الإِعدادات',
    message: 'تَأكيد حفظ تَعديل إعدادات الإِشعارات؟',
    confirmText: '✓ تَأكيد الحفظ',
  });
  if (!ok) return;
  const statusEl = document.getElementById('ntf-status');
  statusEl.style.color = 'var(--online)';
  statusEl.textContent = 'جارٍ الحفظ…';
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
  };
  const r = await api('/api/notifications/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.success) {
    statusEl.textContent = '✅ تم الحفظ';
    await loadNotificationSettings();
  } else {
    statusEl.style.color = 'var(--offline)';
    statusEl.textContent = '❌ ' + (r.error || 'فشل الحفظ');
  }
}

// إرسال إشعار تجريبي للتسجيلات النشطة
async function testNotification() {
  const statusEl = document.getElementById('ntf-status');
  statusEl.style.color = 'var(--online)';
  statusEl.textContent = '🔔 جارٍ إرسال إشعار تجريبي…';
  try {
    const r = await fetch('/api/notifications/test', {
      method: 'POST',
      credentials: 'include',
    });
    const data = await r.json();
    if (data.success) {
      statusEl.textContent = '✅ تم الإرسال (افتح هاتفك للتأكد)';
    } else {
      statusEl.style.color = 'var(--offline)';
      statusEl.textContent = '❌ ' + (data.error || 'فشل الإرسال — تأكد من FCM Key و وجود تسجيلات نشطة');
    }
  } catch (e) {
    statusEl.style.color = 'var(--offline)';
    statusEl.textContent = '❌ خطأ في الاتصال بالخادم';
  }
}

async function loadNotificationLogs() {
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
    if (c === 'telegram') return 'تلجرام';
    if (c === 'whatsapp') return 'واتساب';
    if (c === 'mobile') return 'هاتف (PWA)';
    return c;
  };
  for (const l of sortedData) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(l.sent_at ? new Date(l.sent_at).toLocaleString('ar') : '-')}</td>
      <td>${esc(l.device_name || '-')}</td>
      <td>${esc(channelText(l.channel))}</td>
      <td>${esc(l.status === 'sent' ? 'تم الإرسال' : 'فشل')}</td>
      <td>${esc(l.message)}</td>
    `;
    tbody.appendChild(tr);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadNotificationSettings();
  document.getElementById('ntf-save-btn').addEventListener('click', saveNotificationSettings);
  const testBtn = document.getElementById('ntf-test-btn');
  if (testBtn) testBtn.addEventListener('click', testNotification);
  // عند فتح تبويب السجل: تحميل السجل تلقائياً.
  document.getElementById('tab-logs').addEventListener('click', loadNotificationLogs);
  // مستمع تغيير الترتيب للسجل
  const sortLogsEl = document.getElementById('filter-sort-logs');
  if (sortLogsEl) {
    sortLogsEl.addEventListener('change', (e) => {
      currentLogsSort = e.target.value;
      loadNotificationLogs();
    });
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
    notifications: '🗑️ مَسح سجل الإِشعارات',
    downtime:      '🗑️ مَسح سجل الانقطاعات',
    'status-logs': '🗑️ مَسح نَقاط فحص الحالة',
  };
  const cleanupLabels = {
    notifications:    'سجل الإِشعارات',
    downtime:         'سجل الانقطاعات',
    'status-logs':    'نَقاط فحص الحالة',
    'status-logs-all':'نَقاط فحص الحالة (تَفْرِيغ كامل)',
  };

  // v2.7.x — تَحوِيل range(الواجهة) إِلى (days, label) لِـ الرسالة. status-logs-all يُعالَج زِرّاً مُنفَصِلاً (لَا مُدّة).
  // أَضِيفَت خِيَارات أَصْغَر (2h, day) لِأَنّ status_logs يَحتوي بيانات أَحدث من أُسبوع غالباً.
  function rangeInfo(range) {
    switch (range) {
      case '2h':    return { days: 2/24,    text: 'ساعتين' };
      case 'day':   return { days: 1,      text: '24 ساعة' };
      case 'week':  return { days: 7,      text: '7 أَيام' };
      case 'month': return { days: 30,     text: '30 يوم' };
      case 'year':  return { days: 365,    text: '365 يوم' };
      default:      return { days: 7,      text: '7 أَيام' };
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
    const typeLabel = cleanupLabels['status-logs-all'] || 'نَقاط فحص الحالة';
    const ok = await confirmAction({
      title: '⚠️ تَفْرِيغ كامل لِـ نَقاط فحص الحالة',
      message: 'سيتم حذف كُلّ صُفوف status_logs بِالكامِل ثُمّ VACUUM لِتَقْليص حجم القاعدة.\n⚠️ سيُفقِد ذلك تاريخ Uptime والرسوم البيانية في الصفحة العامة (لِنّ الجَدول هُو مصْدَرها). لا يمكن التَراجُع. مُتابعة؟',
      confirmText: '⚠️ تَفْرِيغ كامل',
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
        showToast(`✅ تَم تَفْرِيغ ${deleted} صَف من status_logs${vacuumed ? ' + VACUUM ناجح' : ' (VACUUM فَشِل — حَجْم القاعدة لَم يَتقلَّص)'}`, { type: 'success' });
        showToast('ℹ️ الجَدول فُرِّغ بِالكامِل — الرسوم البيانية/Uptime في الصفحة العامة سَتَبْدأ التَجَمُّع من جديد', { type: 'info', duration: 5000 });
      } else {
        showToast('❌ ' + ((data && data.error) || 'فشل التَفْرِيغ'), { type: 'error' });
      }
    } catch (e) {
      showToast('❌ خطأ في الاتصال بالخادم', { type: 'error' });
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
    const typeLabel = cleanupLabels[type] || 'السجل';
    const ok = await confirmAction({
      title: 'تَأكيد مَسح ' + typeLabel,
      message: `سيتم مَسح ${typeLabel} الأَقدم من ${ri.text}.\nلا يمكن التَراجُع عن هذا الإِجراء. مُتابعة؟`,
      confirmText: '🗑️ مَسح',
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
          showToast('✅ لا توجَد بيانات في ' + typeLabel + ' أَقدم من ' + ri.text + ' — لا حاجة لِلمَسح', {
            type: 'info', duration: 5000,
          });
        } else {
          showToast(`✅ تَم مَسح ${deleted} سجل (${typeLabel} — أَقدم من ${ri.text})`, { type: 'success' });
        }
        // تَحديث جدول السجل لو كان مُحمَّلاً (notifications).
        if (type === 'notifications' && typeof loadNotificationLogs === 'function') {
          await loadNotificationLogs();
        } else if (deleted > 0) {
          // downtime/status-logs: لا علاقة لَها بِـ notification_logs المَعْرُوض في تَبويب السجل،
          // لِذا لا يُعاد تَحميل الجدول. نُنبّه المُستَخدِم بِأَنّ الأَثر يَنْعَكِس على الصفحة العامة
          // فقط عِندما حَدَث مَسح فعْلِيّ (deleted>0) — إِذا لم يُحْذَف شَيء لا داعي لِلتَنْبِيه.
          showToast('ℹ️ يَنْعَكِس الأَثر على الرسوم البيانية ونِسَب Uptime في الصفحة العامة عند إِعادَة تَحميلها', {
            type: 'info', duration: 4000,
          });
        }
      } else {
        showToast('❌ ' + ((data && data.error) || 'فشل المَسح'), { type: 'error' });
      }
    } catch (e) {
      showToast('❌ خطأ في الاتصال بالخادم', { type: 'error' });
    }
  });
});
