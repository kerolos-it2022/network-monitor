// admin-update.js: منطق تحديثات النظام في لوحة التحكم.
let updateAbortController = null;

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'");
}

async function api(url, opts) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok && r.status !== 401 && r.status !== 404) {
      try {
        const data = await r.json();
        return data || { success: false, error: 'HTTP ' + r.status };
      } catch (e) {
        return { success: false, error: 'HTTP ' + r.status };
      }
    }
    return await r.json();
  } catch (e) {
    return { success: false, error: 'تعذر الاتصال بالخادم' };
  }
}

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

function setButtonsState(checking = false) {
  const checkBtn = document.getElementById('update-check-btn');
  const changelogBtn = document.getElementById('update-view-changelog-btn');
  const downloadBtn = document.getElementById('update-download-btn');
  const applyBtn = document.getElementById('update-apply-btn');
  
  if (checkBtn) checkBtn.disabled = checking;
  if (checkBtn) checkBtn.textContent = checking ? '⏳ جاري الفحص...' : '🔍 فحص التحديثات';
  if (changelogBtn) changelogBtn.disabled = true;
  if (downloadBtn) downloadBtn.disabled = true;
  if (applyBtn) applyBtn.disabled = true;
}

async function checkUpdates() {
  setButtonsState(true);
  hideUpdateStatus();
  
  try {
    const branch = document.getElementById('update-branch').value || 'main';
    const r = await api('/api/update/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    });
    
    if (!r.success) {
      throw new Error(r.error || 'فشل في فحص التحديثات');
    }
    
    // عرض معلومات الإصدار
    document.getElementById('update-current-version').textContent = r.currentVersion || 'غير معروف';
    document.getElementById('update-latest-version').textContent = r.latestVersion || 'غير معروف';
    const branchNameEl = document.getElementById('update-branch-name');
    if (branchNameEl) branchNameEl.textContent = r.branch || 'main';
    
    if (r.hasUpdate || r.updateAvailable) {
      showUpdateStatus('🎉 يتوفر تحديث جديد! الإصدار ' + (r.latestVersion || '') + ' متاح.', false);
      
      // تمكين أزرار التحديث
      const changelogBtn = document.getElementById('update-view-changelog-btn');
      const downloadBtn = document.getElementById('update-download-btn');
      const applyBtn = document.getElementById('update-apply-btn');
      
      if (changelogBtn) {
        changelogBtn.disabled = false;
        changelogBtn.onclick = () => showChangelog(r.changelog);
      }
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.style.display = 'inline-block';
        downloadBtn.onclick = () => window.open('https://github.com/kerolos-it2022/network-monitor/releases', '_blank');
      }
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.onclick = () => applyUpdate();
      }
    } else {
      showUpdateStatus('✅ أنت تستخدم أحدث إصدار (' + (r.currentVersion || '') + ').', false);
      
      // تعطيل أزرار التحديث
      const changelogBtn = document.getElementById('update-view-changelog-btn');
      const downloadBtn = document.getElementById('update-download-btn');
      const applyBtn = document.getElementById('update-apply-btn');
      if (changelogBtn) changelogBtn.disabled = true;
      if (downloadBtn) { downloadBtn.disabled = true; downloadBtn.style.display = 'none'; }
      if (applyBtn) applyBtn.disabled = true;
    }
    
    // تمكين زر عرض changelog في كل الأحوال إذا كان هناك changelog
    const changelogBtn = document.getElementById('update-view-changelog-btn');
    if (changelogBtn && r.changelog && r.changelog !== 'لا توجد تغييرات') {
      changelogBtn.disabled = false;
      changelogBtn.onclick = () => showChangelog(r.changelog);
    }
    
  } catch (e) {
    showUpdateStatus('❌ خطأ: ' + e.message, true);
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

async function applyUpdate() {
  if (!confirm('⚠️ سيتم تحديث النظام وإعادة تشغيل الخدمة. هل تريد المتابعة؟')) return;
  
  const applyBtn = document.getElementById('update-apply-btn');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = '⏳ جاري التحديث...';
  }
  
  showUpdateStatus('🔄 جاري تنفيذ التحديث...', false);
  
  try {
    const r = await api('/api/update/perform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' })
    });
    
    if (r.success) {
      showUpdateStatus('✅ ' + (r.message || 'تم التحديث بنجاح! جاري إعادة تشغيل الخدمة...'), false);
      
      // انتظار إعادة التشغيل
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

function initUpdateTab() {
  // حدث تغيير الفرع
  const branchInput = document.getElementById('update-branch');
  if (branchInput) {
    branchInput.addEventListener('change', () => {
      // إعادة تعيين عند تغيير الفرع
      document.getElementById('update-latest-version').textContent = '—';
      const changelogBtn = document.getElementById('update-view-changelog-btn');
      const downloadBtn = document.getElementById('update-download-btn');
      const applyBtn = document.getElementById('update-apply-btn');
      if (changelogBtn) changelogBtn.disabled = true;
      if (downloadBtn) { downloadBtn.disabled = true; downloadBtn.style.display = 'none'; }
      const applyBtn2 = document.getElementById('update-apply-btn');
      if (applyBtn2) applyBtn2.disabled = true;
    });
  }
  
  // زر الفحص
  const checkBtn = document.getElementById('update-check-btn');
  if (checkBtn) checkBtn.addEventListener('click', checkUpdates);
  
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
  
  // فحص تلقائي عند فتح التبويب (اختياري)
  document.getElementById('tab-updates').addEventListener('click', () => {
    // يمكن تفعيل الفحص التلقائي هنا
    // checkUpdates();
  });
}

document.addEventListener('DOMContentLoaded', initUpdateTab);