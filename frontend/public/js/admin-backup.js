// admin-backup.js: منطق النسخ الاحتياطي واستعادة قاعدة البيانات في لوحة التحكم.
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).

// دالة API خاصة للنسخ الاحتياطي — مغلّف خفيف حول api() المشتركة.
async function backupApi(url, opts) {
  return api(url, opts);
}

function showBackupStatus(message, isError = false) {
  const el = document.getElementById('backup-status');
  if (el) {
    el.textContent = message;
    el.style.color = isError ? 'var(--offline)' : 'var(--online)';
    el.classList.remove('hidden');
  }
}

function hideBackupStatus() {
  const el = document.getElementById('backup-status');
  if (el) el.classList.add('hidden');
}

function appendBackupLog(message) {
  const logPre = document.getElementById('backup-log');
  const outputDiv = document.getElementById('backup-output');
  if (logPre) logPre.textContent += (logPre.textContent ? '\n' : '') + message;
  if (outputDiv) outputDiv.scrollTop = outputDiv.scrollHeight;
}

function showBackupOutput(show = true) {
  const outputDiv = document.getElementById('backup-output');
  if (outputDiv) {
    if (show) outputDiv.classList.remove('hidden');
    else outputDiv.classList.add('hidden');
  }
}

// تحميل معلومات القاعدة الحالية عند فتح التبويب
async function loadBackupInfo() {
  const r = await backupApi('/api/backup/info');
  const sizeEl = document.getElementById('backup-db-size');
  const tablesEl = document.getElementById('backup-table-count');
  const modifiedEl = document.getElementById('backup-last-modified');
  const tableListEl = document.getElementById('backup-table-list');

  if (!r.success) {
    if (sizeEl) sizeEl.textContent = 'خطأ';
    if (tablesEl) tablesEl.textContent = '—';
    if (modifiedEl) modifiedEl.textContent = '—';
    showBackupStatus('❌ تعذر تحميل معلومات القاعدة: ' + (r.error || ''), true);
    return;
  }

  if (sizeEl) sizeEl.textContent = `${r.sizeMB} ميجابايت`;
  if (tablesEl) tablesEl.textContent = `${r.tableCount} جدول`;
  if (modifiedEl) modifiedEl.textContent = new Date(r.lastModified).toLocaleString('ar-EG');

  if (tableListEl) {
    const counts = r.tables || {};
    tableListEl.innerHTML = '';
    Object.keys(counts).sort().forEach((t) => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex; justify-content:space-between; padding:0.35rem 0.6rem; border-bottom:1px solid var(--border);';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = t;
      const countSpan = document.createElement('span');
      countSpan.style.color = 'var(--muted)';
      countSpan.textContent = counts[t] >= 0 ? `${counts[t]} صف` : '—';
      li.appendChild(nameSpan);
      li.appendChild(countSpan);
      tableListEl.appendChild(li);
    });
  }
}

// تصدير نسخة احتياطية (.db)
async function exportBackup() {
  const exportBtn = document.getElementById('backup-export-btn');
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.textContent = '⏳ جاري إنشاء النسخة...';
  }
  showBackupStatus('⏳ جاري إنشاء نسخة احتياطية من قاعدة البيانات...', false);

  try {
    const response = await fetch('/api/backup/download', { credentials: 'include' });
    if (!response.ok) {
      let err = `HTTP ${response.status}`;
      try { const j = await response.json(); if (j && j.error) err = j.error; } catch (e) {}
      throw new Error(err);
    }

    // اسم الملف من Content-Disposition
    const cd = response.headers.get('Content-Disposition') || '';
    let filename = 'network-monitor-backup.db';
    const m = cd.match(/filename="?([^";]+)"?/);
    if (m && m[1]) filename = m[1];

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showBackupStatus(`✅ تم تنزيل النسخة الاحتياطية: ${filename}`, false);
  } catch (e) {
    console.error('[BACKUP] export error:', e);
    showBackupStatus('❌ خطأ في التصدير: ' + e.message, true);
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.textContent = '⬇️ تصدير نسخة احتياطية (.db)';
    }
  }
}

// استعادة نسخة من ملف مرفوع
async function restoreBackup() {
  const fileInput = document.getElementById('backup-restore-file');
  const restoreBtn = document.getElementById('backup-restore-btn');

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showBackupStatus('⚠️ الرجاء اختيار ملف .db أولاً', true);
    return;
  }

  const file = fileInput.files[0];
  if (!file.name.toLowerCase().endsWith('.db')) {
    showBackupStatus('⚠️ الملف يجب أن يكون بصيغة .db', true);
    return;
  }

  // تأكيد ثنائي نظراً لأن العملية خطيرة
  const confirmed = confirm(
    '⚠️ تحذير: سيتم استبدال قاعدة البيانات الحالية بالكامل بالملف المختار.\n\n' +
    '• سيتم إنشاء نسخة أمنية تلقائية من القاعدة الحالية قبل الاستبدال.\n' +
    '• سيتم إعادة تشغيل الخادم بعد الانتهاء.\n' +
    `• حجم الملف: ${(file.size / 1024 / 1024).toFixed(2)} ميجابايت\n\n` +
    'هل تريد المتابعة؟'
  );
  if (!confirmed) return;

  if (restoreBtn) {
    restoreBtn.disabled = true;
    restoreBtn.textContent = '⏳ جاري الاستعادة...';
  }
  showBackupOutput(true);
  document.getElementById('backup-log').textContent = '';
  appendBackupLog(`📤 رفع الملف: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`);
  showBackupStatus('⏳ جاري رفع واستعادة النسخة...', false);

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/backup/restore', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

    if (response.ok && data && data.success) {
      appendBackupLog(`✅ ${data.message}`);
      if (data.backupFile) appendBackupLog(`🗂️ النسخة الأمنية المحفوظة: ${data.backupFile}`);
      showBackupStatus('✅ تمت الاستعادة. جاري إعادة تشغيل الخادم...', false);

      // ننتظر قليلاً ثم نعيد التحميل؛ الخادم قد يكون في مرحلة إعادة التشغيل
      let countdown = 8;
      const reloadTimer = setInterval(() => {
        if (countdown <= 0) {
          clearInterval(reloadTimer);
          appendBackupLog('🔄 إعادة تحميل الصفحة...');
          location.reload();
          return;
        }
        appendBackupLog(`⏱️ إعادة التحميل خلال ${countdown} ثانية...`);
        countdown--;
      }, 1000);
    } else {
      const err = (data && data.error) ? data.error : `HTTP ${response.status}`;
      throw new Error(err);
    }
  } catch (e) {
    console.error('[BACKUP] restore error:', e);
    appendBackupLog(`❌ خطأ: ${e.message}`);
    showBackupStatus('❌ خطأ في الاستعادة: ' + e.message, true);
    if (restoreBtn) {
      restoreBtn.disabled = false;
      restoreBtn.textContent = '⬆️ استعادة النسخة';
    }
  }
}

// استعادة نسخة موجودة من مجلد backups/
async function restoreFromExisting(filename) {
  const confirmed = confirm(
    `⚠️ تحذير: سيتم استبدال قاعدة البيانات الحالية بالنسخة:\n${filename}\n\n` +
    '• سيتم إنشاء نسخة أمنية تلقائية من القاعدة الحالية قبل الاستبدال.\n' +
    '• سيتم إعادة تشغيل الخادم.\n\nهل تريد المتابعة؟'
  );
  if (!confirmed) return;

  showBackupOutput(true);
  document.getElementById('backup-log').textContent = '';
  appendBackupLog(`🔄 استعادة من النسخة الموجودة: ${filename}...`);
  showBackupStatus('⏳ جاري الاستعادة...', false);

  try {
    const data = await backupApi('/api/backup/restore-existing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });

    if (data && data.success) {
      appendBackupLog(`✅ ${data.message}`);
      if (data.backupFile) appendBackupLog(`🗂️ النسخة الأمنية: ${data.backupFile}`);
      showBackupStatus('✅ تمت الاستعادة. جاري إعادة تشغيل الخادم...', false);

      let countdown = 8;
      const reloadTimer = setInterval(() => {
        if (countdown <= 0) {
          clearInterval(reloadTimer);
          appendBackupLog('🔄 إعادة تحميل الصفحة...');
          location.reload();
          return;
        }
        appendBackupLog(`⏱️ إعادة التحميل خلال ${countdown} ثانية...`);
        countdown--;
      }, 1000);
    } else {
      throw new Error((data && data.error) ? data.error : 'فشل الاستعادة');
    }
  } catch (e) {
    appendBackupLog(`❌ خطأ: ${e.message}`);
    showBackupStatus('❌ خطأ في الاستعادة: ' + e.message, true);
  }
}

// حذف نسخة أمنية
async function deleteBackup(filename, rowEl) {
  const confirmed = confirm(`هل أنت متأكد من حذف النسخة:\n${filename}\n\nلا يمكن التراجع عن هذا الإجراء.`);
  if (!confirmed) return;

  try {
    const data = await backupApi(`/api/backup/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    if (data && data.success) {
      if (rowEl) rowEl.remove();
      showBackupStatus(`🗑️ تم حذف "${filename}"`, false);
      // إعادة تحميل القائمة للتأكد من الترتيب الصحيح
      loadBackupList();
    } else {
      throw new Error((data && data.error) ? data.error : 'فشل الحذف');
    }
  } catch (e) {
    showBackupStatus('❌ خطأ في الحذف: ' + e.message, true);
  }
}

// تحميل قائمة النسخ الأمنية الموجودة
async function loadBackupList() {
  const listEl = document.getElementById('backup-list');
  if (!listEl) return;

  const r = await backupApi('/api/backup/list');
  if (!r.success) {
    listEl.innerHTML = '<div style="color:var(--muted); padding:1rem;">❌ تعذر تحميل النسخ الأمنية</div>';
    return;
  }

  if (!r.backups || r.backups.length === 0) {
    listEl.innerHTML = '<div style="color:var(--muted); padding:1rem; text-align:center;">📭 لا توجد نسخ أمنية حالياً. سيتم إنشاؤها تلقائياً عند أول عملية استعادة.</div>';
    return;
  }

  listEl.innerHTML = '';
  r.backups.forEach((b) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:0.6rem; border:1px solid var(--border); border-radius:6px; margin-bottom:0.5rem; flex-wrap:wrap; gap:0.5rem;';

    const info = document.createElement('div');
    info.innerHTML = `
      <div style="font-weight:600;">🗂️ ${esc(b.filename)}</div>
      <div style="font-size:0.8rem; color:var(--muted);">${esc(b.sizeMB)} ميجابايت • ${new Date(b.createdAt).toLocaleString('ar-EG')}</div>
    `;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:0.4rem;';

    const restoreB = document.createElement('button');
    restoreB.type = 'button';
    restoreB.className = 'btn btn-primary';
    restoreB.style.cssText = 'padding:0.3rem 0.7rem; font-size:0.85rem;';
    restoreB.textContent = '↩️ استعادة';
    restoreB.addEventListener('click', () => restoreFromExisting(b.filename));

    const deleteB = document.createElement('button');
    deleteB.type = 'button';
    deleteB.className = 'btn';
    deleteB.style.cssText = 'padding:0.3rem 0.7rem; font-size:0.85rem; color:var(--offline);';
    deleteB.textContent = '🗑️ حذف';
    deleteB.addEventListener('click', () => deleteBackup(b.filename, row));

    actions.appendChild(restoreB);
    actions.appendChild(deleteB);
    row.appendChild(info);
    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

// تهيئة التبويب — ربط كل الأزرار بشكل دائم عبر addEventListener
function initBackupTab() {
  const exportBtn = document.getElementById('backup-export-btn');
  const restoreBtn = document.getElementById('backup-restore-btn');
  const fileInput = document.getElementById('backup-restore-file');
  const refreshListBtn = document.getElementById('backup-refresh-list-btn');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportBackup());
  }
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => restoreBackup());
  }
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const labelEl = document.getElementById('backup-file-name');
      if (fileInput.files && fileInput.files.length > 0) {
        const f = fileInput.files[0];
        if (labelEl) labelEl.textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`;
        if (restoreBtn) restoreBtn.disabled = false;
      } else {
        if (labelEl) labelEl.textContent = 'لم يتم اختيار ملف';
        if (restoreBtn) restoreBtn.disabled = true;
      }
    });
  }
  if (refreshListBtn) {
    refreshListBtn.addEventListener('click', () => loadBackupList());
  }

  // الفحص التلقائي عند فتح التبويب
  const tabBackup = document.getElementById('tab-backup');
  if (tabBackup) {
    tabBackup.addEventListener('click', () => {
      setTimeout(() => {
        loadBackupInfo();
        loadBackupList();
      }, 150);
    });
  }
}

document.addEventListener('DOMContentLoaded', initBackupTab);
