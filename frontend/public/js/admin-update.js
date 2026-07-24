// admin-update.js: منطق تحديثات النظام في لوحة التحكم.
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
let updateAbortController = null;

// حالة عامة لحفظ نتيجة آخر فحص (تستخدمها الأزرار)
let lastCheckResult = null;

function showUpdateStatus(message, isError = false) {
  const statusEl = document.getElementById('update-status');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--offline)' : 'var(--online)';
    statusEl.classList.remove('hidden');
  }
}

function hideUpdateStatus() {
  const statusEl = document.getElementById('update-status');
  if (statusEl) statusEl.classList.add('hidden');
}

// ضبط حالة زر الفحص فقط (بدون لمس أزرار التحميل/التطبيق)
function setButtonsState(checking = false) {
  const checkBtn = document.getElementById('update-check-btn');
  if (checkBtn) {
    checkBtn.disabled = checking;
    checkBtn.textContent = checking ? '⏳ جاري الفحص...' : '🔍 فحص التحديثات';
  }
}

// إظهار/إخفاء أزرار التحميل والتطبيق وفق نتائج الفحص
function setUpdateButtonsVisibility(hasUpdate) {
  const changelogBtn = document.getElementById('update-view-changelog-btn');
  const downloadBtn = document.getElementById('update-download-btn');
  const applyBtn = document.getElementById('update-apply-btn');

  if (hasUpdate) {
    if (changelogBtn) changelogBtn.disabled = false;
    if (downloadBtn) { downloadBtn.disabled = false; downloadBtn.style.display = 'inline-block'; }
    if (applyBtn) { applyBtn.disabled = false; applyBtn.style.display = 'inline-block'; }
  } else {
    if (changelogBtn) changelogBtn.disabled = true;
    if (downloadBtn) { downloadBtn.disabled = true; downloadBtn.style.display = 'none'; }
    if (applyBtn) { applyBtn.disabled = true; applyBtn.style.display = 'none'; }
  }
}

async function checkUpdates() {
  setButtonsState(true);
  hideUpdateStatus();

  try {
    const branchEl = document.getElementById('update-branch');
    const branch = (branchEl && branchEl.value) ? branchEl.value : 'main';

    const r = await api('/api/update/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    });

    console.log('[UPDATE] API Response:', r);

    if (!r.success) {
      throw new Error(r.error || 'فشل في فحص التحديثات');
    }

    // حفظ نتيجة الفحص لاستخدامها في الأزرار
    lastCheckResult = r;

    // عرض معلومات الإصدار
    const curEl = document.getElementById('update-current-version');
    const latEl = document.getElementById('update-latest-version');
    const branchNameEl = document.getElementById('update-branch-name');
    if (curEl) curEl.textContent = r.currentVersion || 'غير معروف';
    if (latEl) latEl.textContent = r.latestVersion || 'غير معروف';
    if (branchNameEl) branchNameEl.textContent = r.branch || 'main';

    const hasUpdate = !!(r.hasUpdate || r.updateAvailable);

    if (hasUpdate) {
      showUpdateStatus('🎉 يتوفر تحديث جديد! الإصدار ' + (r.latestVersion || '') + ' متاح.', false);
    } else {
      const statusMsg = r.error ? `⚠️ ${r.error}` : `✅ أنت تستخدم أحدث إصدار (${r.currentVersion || ''}).`;
      showUpdateStatus(statusMsg, !!r.error);
    }

    setUpdateButtonsVisibility(hasUpdate);
  } catch (e) {
    console.error('[UPDATE] Error:', e);
    showUpdateStatus('❌ خطأ: ' + e.message, true);
    setUpdateButtonsVisibility(false);
  } finally {
    setButtonsState(false);
  }
}

function showChangelog(changelog) {
  const modal = document.getElementById('changelog-modal');
  const content = document.getElementById('changelog-content');
  if (modal && content) {
    content.textContent = changelog || 'لا توجد تغييرات مسجلة';
    modal.classList.remove('hidden');
  }
}

function closeChangelog() {
  const modal = document.getElementById('changelog-modal');
  if (modal) modal.classList.add('hidden');
}

// عرض الكارد الداخلي لسجل التغييرات (الموجود داخل القسم)
function showInlineChangelog(changelog) {
  const card = document.getElementById('update-changelog');
  const content = document.getElementById('update-changelog-content');
  if (card && content) {
    content.textContent = changelog || 'لا توجد تغييرات مسجلة';
    card.classList.remove('hidden');
  }
}

function closeInlineChangelog() {
  const card = document.getElementById('update-changelog');
  if (card) card.classList.add('hidden');
}

async function applyUpdate() {
  if (!confirm('⚠️ سيتم تحديث النظام وإعادة تشغيل الخدمة. هل تريد المتابعة؟')) return;

  const applyBtn = document.getElementById('update-apply-btn');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = '⏳ جاري التحديث...';
  }

  showUpdateStatus('🔄 جاري تنفيذ التحديث...', false);

  try {
    const branchEl = document.getElementById('update-branch');
    const branch = (branchEl && branchEl.value) ? branchEl.value : 'main';

    const r = await api('/api/update/perform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    });

    if (r.success) {
      showUpdateStatus('✅ ' + (r.message || 'تم التحديث بنجاح! جاري إعادة تشغيل الخدمة...'), false);

      setTimeout(() => {
        showUpdateStatus('✅ تم التحديث بنجاح! يرجى تحديث الصفحة.', false);
        setTimeout(() => location.reload(), 3000);
      }, 5000);
    } else {
      throw new Error(r.error || 'فشل في تنفيذ التحديث');
    }
  } catch (e) {
    showUpdateStatus('❌ خطأ: ' + e.message, true);
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.textContent = '🚀 تطبيق التحديث';
    }
  }
}

async function downloadUpdate() {
  console.log('[DOWNLOAD] downloadUpdate() called');

  const downloadBtn = document.getElementById('update-download-btn');
  const applyBtn = document.getElementById('update-apply-btn');
  const progressDiv = document.getElementById('update-progress');
  const progressText = document.getElementById('update-progress-text');
  const outputDiv = document.getElementById('update-output');
  const logPre = document.getElementById('update-log');

  // تعطيل زر التحميل أثناء العملية
  if (downloadBtn) downloadBtn.disabled = true;
  if (applyBtn) applyBtn.disabled = true;

  // إظهار واجهة التقدم
  if (progressDiv) progressDiv.classList.remove('hidden');
  if (outputDiv) outputDiv.classList.remove('hidden');
  if (logPre) logPre.textContent = '';

  if (progressText) progressText.textContent = 'جاري الاتصال بالخادم...';
  if (logPre) logPre.textContent += '⏳ جاري بدء عملية التحميل...\n';

  try {
    const branchEl = document.getElementById('update-branch');
    const branch = (branchEl && branchEl.value) ? branchEl.value : 'main';
    const url = `/api/update/download?branch=${encodeURIComponent(branch)}`;

    console.log('[DOWNLOAD] Fetching:', url);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('الاستجابة لا تحتوي على بث بيانات (SSE غير مدعوم)');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.trim().split('\n');
        let eventType = 'line';
        let data = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            data = line.substring(5).trim();
          }
        }

        if (!data) continue;

        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = null; }

        if (eventType === 'start' || eventType === 'line') {
          const message = (parsed && parsed.message) ? parsed.message : data;
          if (logPre) logPre.textContent += message + '\n';
          if (outputDiv) outputDiv.scrollTop = outputDiv.scrollHeight;
        } else if (eventType === 'progress' && parsed) {
          if (progressText) progressText.textContent = `⬇️ تحميل: ${parsed.percent}% (${parsed.downloaded} / ${parsed.total})`;
          if (logPre) logPre.textContent += `\r[${parsed.percent}%] ${parsed.downloaded} / ${parsed.total}\n`;
          if (outputDiv) outputDiv.scrollTop = outputDiv.scrollHeight;
        } else if (eventType === 'error') {
          const errMsg = (parsed && parsed.message) ? parsed.message : 'خطأ غير معروف';
          throw new Error(errMsg);
        } else if (eventType === 'done') {
          const doneMsg = (parsed && parsed.message) ? parsed.message : 'اكتمل التحميل';
          if (progressText) progressText.textContent = doneMsg;
          if (logPre) logPre.textContent += `\n✅ ${doneMsg}\n`;
          if (outputDiv) outputDiv.scrollTop = outputDiv.scrollHeight;
          // تمكين زر التطبيق فقط
          if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.textContent = '🚀 تطبيق التحديث';
            applyBtn.style.display = 'inline-block';
          }
        }
      }
    }

    // في حال انتهى البث بدون حدث done
    if (progressText) progressText.textContent = '✅ اكتمل التحميل';
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.textContent = '🚀 تطبيق التحديث';
      applyBtn.style.display = 'inline-block';
    }
    if (downloadBtn) downloadBtn.disabled = false;

  } catch (e) {
    console.error('[UPDATE] Download error:', e);
    if (logPre) logPre.textContent += `\n❌ خطأ: ${e.message}\n`;
    if (progressText) progressText.textContent = `خطأ: ${e.message}`;
    showUpdateStatus('❌ خطأ في التحميل: ' + e.message, true);
    if (downloadBtn) downloadBtn.disabled = false;
    if (applyBtn) applyBtn.disabled = false;
  }
}

function initUpdateTab() {
  // جلب الفروع المتاحة من API
  loadAvailableBranches();

  // حدث تغيير الفرع
  const branchInput = document.getElementById('update-branch');
  if (branchInput) {
    branchInput.addEventListener('change', () => {
      const latEl = document.getElementById('update-latest-version');
      if (latEl) latEl.textContent = '—';
      setUpdateButtonsVisibility(false);
      hideUpdateStatus();
    });
  }

  // ===== ربط الأزرار بشكل دائم وموثوق (بدلاً من التعيين الديناميكي) =====
  const checkBtn = document.getElementById('update-check-btn');
  const changelogBtn = document.getElementById('update-view-changelog-btn');
  const downloadBtn = document.getElementById('update-download-btn');
  const applyBtn = document.getElementById('update-apply-btn');
  const closeChangelogInlineBtn = document.getElementById('update-close-changelog-btn');

  if (checkBtn) {
    checkBtn.addEventListener('click', checkUpdates);
  }
  if (downloadBtn) {
    downloadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[DOWNLOAD] Button clicked');
      if (!downloadBtn.disabled) downloadUpdate();
    });
  }
  if (applyBtn) {
    applyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!applyBtn.disabled) applyUpdate();
    });
  }
  if (changelogBtn) {
    changelogBtn.addEventListener('click', () => {
      if (lastCheckResult && lastCheckResult.changelog) {
        showChangelog(lastCheckResult.changelog);
      } else if (changelogBtn && !changelogBtn.disabled) {
        // على الأقل نعرض رسالة
        showChangelog('لا توجد تغييرات مسجلة');
      }
    });
  }
  if (closeChangelogInlineBtn) {
    closeChangelogInlineBtn.addEventListener('click', closeInlineChangelog);
  }

  // إغلاق المودال
  const closeModal = document.getElementById('changelog-close');
  if (closeModal) closeModal.addEventListener('click', closeChangelog);

  const modalOverlay = document.getElementById('changelog-modal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeChangelog();
    });
  }

  // مفتاح Escape لإغلاق المودال
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChangelog();
  });

  // الفحص التلقائي عند فتح تبويب التحديثات
  const tabUpdates = document.getElementById('tab-updates');
  if (tabUpdates) {
    tabUpdates.addEventListener('click', () => {
      // فحص تلقائي بعد لحظة من فتح التبويب لإظهار الحالة مباشرة
      setTimeout(() => {
        if (!lastCheckResult) checkUpdates();
      }, 200);
    });
  }
}

async function loadAvailableBranches() {
  const branchSelect = document.getElementById('update-branch');
  const branchNameEl = document.getElementById('update-branch-name');

  if (!branchSelect) return;

  try {
    branchSelect.disabled = true;
    branchSelect.innerHTML = '<option value="">جاري تحميل الفروع...</option>';

    const response = await api('/api/update/branches');

    if (response.success && response.branches && response.branches.length > 0) {
      branchSelect.innerHTML = '';
      response.branches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        if (branch === response.defaultBranch) {
          option.selected = true;
          option.textContent += ' (افتراضي)';
        }
        branchSelect.appendChild(option);
      });

      if (branchNameEl && response.defaultBranch) {
        branchNameEl.textContent = `الفرع الافتراضي: ${response.defaultBranch}`;
      }
    } else {
      branchSelect.innerHTML = '<option value="main">main</option>';
      if (branchNameEl) branchNameEl.textContent = 'الفرع الافتراضي: main';
    }
  } catch (e) {
    console.error('[UPDATE] Failed to load branches:', e);
    branchSelect.innerHTML = '<option value="main">main</option>';
    if (branchNameEl) branchNameEl.textContent = 'الفرع الافتراضي: main';
  } finally {
    branchSelect.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', initUpdateTab);
