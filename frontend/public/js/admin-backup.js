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

// جدول «تفاصيل الجداول»: نحفظ العدّادات لِإعادة الترتيب بلا نداء جديد.
let backupTableCounts = {};

// رسم صفوف الجداول بالترتيب المطلوب (اسم/الأكثر صفوفًا) بصفوف موحّدة الصفات من ui.css.
function backupRenderTableRows() {
  const tableListEl = document.getElementById('backup-table-list');
  if (!tableListEl) return;
  const modeEl = document.getElementById('backup-tables-sort');
  const mode = modeEl ? modeEl.value : 'name';
  let names = Object.keys(backupTableCounts);
  names = (mode === 'rows_desc')
    ? names.sort((a, b) => (backupTableCounts[b] || 0) - (backupTableCounts[a] || 0) || a.localeCompare(b))
    : names.sort((a, b) => a.localeCompare(b));
  tableListEl.innerHTML = '';
  if (names.length === 0) {
    tableListEl.innerHTML = `<li class="nm-muted">${T('tail.no_tables', 'لا توجد جداول.')}</li>`;
    return;
  }
  names.forEach((t) => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'nm-ltr';
    nameSpan.textContent = t;
    const countSpan = document.createElement('span');
    countSpan.className = 'v';
    countSpan.textContent = backupTableCounts[t] >= 0 ? (NMFormat.num(backupTableCounts[t]) + T('tail.rows', ' صف')) : '—';
    li.appendChild(nameSpan);
    li.appendChild(countSpan);
    tableListEl.appendChild(li);
  });
}
function backupSortTables() { backupRenderTableRows(); }

// تحميل معلومات القاعدة الحالية عند فتح التبويب
async function loadBackupInfo() {
  const r = await backupApi('/api/backup/info');
  const sizeEl = document.getElementById('backup-db-size');
  const tablesEl = document.getElementById('backup-table-count');
  const modifiedEl = document.getElementById('backup-last-modified');

  if (!r.success) {
    if (sizeEl) sizeEl.textContent = T('tail.error', 'خطأ');
    if (tablesEl) tablesEl.textContent = '—';
    if (modifiedEl) modifiedEl.textContent = '—';
    showBackupStatus(T('tail.could_not_load_the_database_info', '❌ تعذر تحميل معلومات القاعدة: ') + ' ' + (r.error || ''), true);
    return;
  }

  if (sizeEl) sizeEl.textContent = NMFormat.bytes((Number(r.sizeMB) || 0) * 1024 * 1024);
  if (tablesEl) tablesEl.textContent = NMFormat.num(r.tableCount) + T('tail.tables', ' جدول');
  if (modifiedEl) modifiedEl.textContent = NMFormat.dateTime(r.lastModified);

  backupTableCounts = r.tables || {};
  backupRenderTableRows();
}

// تصدير نسخة احتياطية (.db)
async function exportBackup() {
  const exportBtn = document.getElementById('backup-export-btn');
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.textContent = T('s2j.creating_the_copy', '⏳ جاري إنشاء النسخة...');
  }
  showBackupStatus(T('tail.creating_a_database_backup', '⏳ جاري إنشاء نسخة احتياطية من قاعدة البيانات...'), false);

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

    showBackupStatus(`✅ ${T('frag.the_backup_was_downloaded', 'تم تنزيل النسخة الاحتياطية')}: ${filename}`, false);
  } catch (e) {
    console.error('[BACKUP] export error:', e);
    showBackupStatus(T('tail.export_error', '❌ خطأ في التصدير: ') + ' ' + e.message, true);
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.textContent = T('s2.export_a_backup_db', '⬇️ تصدير نسخة احتياطية (.db)');
    }
  }
}

// استعادة نسخة من ملف مرفوع
async function restoreBackup() {
  const fileInput = document.getElementById('backup-restore-file');
  const restoreBtn = document.getElementById('backup-restore-btn');

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showBackupStatus(T('tail.choose_a_db_file_first', '⚠️ الرجاء اختيار ملف .db أولاً'), true);
    return;
  }

  const file = fileInput.files[0];
  if (!file.name.toLowerCase().endsWith('.db')) {
    showBackupStatus(T('tail.the_file_must_be_a_db', '⚠️ الملف يجب أن يكون بصيغة .db'), true);
    return;
  }

  // تأكيد ثنائي نظراً لأن العملية خطيرة
  const confirmed = await confirmAction({
    title: T('s2j.confirm_restoring_the_copy', '⚠️ تَأكيد استعادة النَسخة'),
    message:
      '⚠️ تحذير: سيتم استبدال قاعدة البيانات الحالية بالكامل بالملف المختار.\n\n' +
      '• سيتم إنشاء نسخة أمنية تلقائية من القاعدة الحالية قبل الاستبدال.\n' +
      '• سيتم إعادة تشغيل الخادم بعد الانتهاء.\n' +
      `• ${T('frag.file_size', 'حجم الملف')}: ${(file.size / 1024 / 1024).toFixed(2)} ${T('frag.mb', 'ميجابايت')}\n\n` +
      T('tail.continue', 'هل تريد المتابعة؟'),
    confirmText: '🔄 استعادة',
    danger: true,
  });
  if (!confirmed) return;

  if (restoreBtn) {
    restoreBtn.disabled = true;
    restoreBtn.textContent = T('s2j.restoring', '⏳ جاري الاستعادة...');
  }
  showBackupOutput(true);
  document.getElementById('backup-log').textContent = '';
  appendBackupLog(`📤 ${T('frag.uploading', 'رفع الملف')}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`);
  showBackupStatus(T('tail.uploading_and_restoring_the_copy', '⏳ جاري رفع واستعادة النسخة...'), false);

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
      if (data.backupFile) appendBackupLog(`🗂️ ${T('frag.the_saved_safety_copy', 'النسخة الأمنية المحفوظة')}: ${data.backupFile}`);
      showBackupStatus(T('tail.restored_restarting_the_server', '✅ تمت الاستعادة. جاري إعادة تشغيل الخادم...'), false);

      // ننتظر قليلاً ثم نعيد التحميل؛ الخادم قد يكون في مرحلة إعادة التشغيل
      let countdown = 8;
      const reloadTimer = setInterval(() => {
        if (countdown <= 0) {
          clearInterval(reloadTimer);
          appendBackupLog('🔄 إعادة تحميل الصفحة...');
          location.reload();
          return;
        }
        appendBackupLog(`⏱️ ${T('frag.the_page_reloads_in', 'إعادة التحميل خلال ')}${countdown} ${T('frag.seconds', 'ثانية...')}`);
        countdown--;
      }, 1000);
    } else {
      let err = (data && data.error) ? data.error : `HTTP ${response.status}`;
      // v2.8.7 — رسالة واضحة لخطأ الحجم (nginx يرفض الطلب قبل أن يصل للخادم).
      if (response.status === 413) {
        err = T('tail.the_copy_is_larger_than_the_proxy_server_all', T('tail.the_copy_is_larger_than_the_proxy_server_all', T('tail.the_copy_is_larger_than_the_proxy_server_all', T('tail.the_copy_is_larger_than_the_proxy_server_all', T('tail.the_copy_is_larger_than_the_proxy_server_all', T('tail.the_copy_is_larger_than_the_proxy_server_all', 'حجم ملف النَسخة أكبر من الحدّ المسموح على الخادم الوسيط (nginx: client_max_body_size). ارفع الحدّ أو استعِد النَسخة من سطر الأوامر.'))))));
      } else if (response.status === 404 || response.status === 502) {
        err = T('tail.could_not_reach_the_server_it_may_be_restart', T('tail.could_not_reach_the_server_it_may_be_restart', T('tail.could_not_reach_the_server_it_may_be_restart', T('tail.could_not_reach_the_server_it_may_be_restart', T('tail.could_not_reach_the_server_it_may_be_restart', T('tail.could_not_reach_the_server_it_may_be_restart', 'تعذّر الوصول للخادم (قد يكون في إعادة تشغيل) — أعِد المحاولة بعد لحظات.'))))));
      }
      throw new Error(err);
    }
  } catch (e) {
    console.error('[BACKUP] restore error:', e);
    appendBackupLog(`❌ ${T('tail.error', 'خطأ')}: ${e.message}`);
    showBackupStatus(T('tail.restore_error', '❌ خطأ في الاستعادة: ') + ' ' + e.message, true);
    if (restoreBtn) {
      restoreBtn.disabled = false;
      restoreBtn.textContent = T('s2.restore_the_copy', '⬆️ استعادة النسخة');
    }
  }
}

// استعادة نسخة موجودة من مجلد backups/
async function restoreFromExisting(filename) {
  const confirmed = await confirmAction({
    title: T('s2j.confirm_restoring_an_existing_copy', '⚠️ تَأكيد استعادة نَسخة موجودة'),
    message:
      NMI18N.t('backup.restoreWarn', { file: filename }),
    confirmText: '🔄 استعادة',
    danger: true,
  });
  if (!confirmed) return;

  showBackupOutput(true);
  document.getElementById('backup-log').textContent = '';
  appendBackupLog(`🔄 ${T('frag.restore_from_the_existing_copy', 'استعادة من النسخة الموجودة')}: ${filename}...`);
  showBackupStatus(T('s2j.restoring', '⏳ جاري الاستعادة...'), false);

  try {
    const data = await backupApi('/api/backup/restore-existing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });

    if (data && data.success) {
      appendBackupLog(`✅ ${data.message}`);
      if (data.backupFile) appendBackupLog(`🗂️ ${T('frag.safety_copy', 'النسخة الأمنية')}: ${data.backupFile}`);
      showBackupStatus(T('tail.restored_restarting_the_server', '✅ تمت الاستعادة. جاري إعادة تشغيل الخادم...'), false);

      let countdown = 8;
      const reloadTimer = setInterval(() => {
        if (countdown <= 0) {
          clearInterval(reloadTimer);
          appendBackupLog('🔄 إعادة تحميل الصفحة...');
          location.reload();
          return;
        }
        appendBackupLog(`⏱️ ${T('frag.the_page_reloads_in', 'إعادة التحميل خلال ')}${countdown} ${T('frag.seconds', 'ثانية...')}`);
        countdown--;
      }, 1000);
    } else {
      throw new Error((data && data.error) ? data.error : T('tail.restore_failed', 'فشل الاستعادة'));
    }
  } catch (e) {
    appendBackupLog(`❌ ${T('tail.error', 'خطأ')}: ${e.message}`);
    showBackupStatus('❌ خطأ في الاستعادة: ' + e.message, true);
  }
}

// حذف نسخة أمنية
async function deleteBackup(filename, rowEl) {
  const confirmed = await confirmAction({
    title: T('s2j.confirm_deleting_the_copy', 'تَأكيد حذف النَسخة'),
    message: `${T('frag.delete_this_copy', 'هل أَنت متأَكّد من حذف النَسخة')}:\n${filename}\n\n${T('frag.this_action_cannot_be_undone', 'لا يمكن التَراجُع عن هذا الإجراء.')}`,
    confirmText: T('common.delete', '🗑️ حذف'),
    danger: true,
  });
  if (!confirmed) return;

  try {
    const data = await backupApi(`/api/backup/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    if (data && data.success) {
      if (rowEl) rowEl.remove();
      showBackupStatus(`🗑️ ${T('frag.deleted', 'تم حذف ')}"${filename}"`, false);
      // إعادة تحميل القائمة للتأكد من الترتيب الصحيح
      loadBackupList();
    } else {
      throw new Error((data && data.error) ? data.error : 'فشل الحذف');
    }
  } catch (e) {
    showBackupStatus(T('tail.delete_error', '❌ خطأ في الحذف: ') + ' ' + e.message, true);
  }
}

// تحميل قائمة النسخ الأمنية الموجودة
async function loadBackupList() {
  const listEl = document.getElementById('backup-list');
  if (!listEl) return;

  const r = await backupApi('/api/backup/list');
  if (!r.success) {
    listEl.innerHTML = `<div style="color:var(--muted); padding:1rem;">${T('tail.could_not_load_the_safety_copies', '❌ تعذر تحميل النسخ الأمنية')}</div>`;
    return;
  }

  if (!r.backups || r.backups.length === 0) {
    listEl.innerHTML = `<div class="nm-empty" style="color:var(--muted); padding:1rem;">${T('tail.no_safety_copies_yet_one_is_created_automati', '📭 لا توجد نسخ أمنية حالياً. سيتم إنشاؤها تلقائياً عند أول عملية استعادة.')}</div>`;
    return;
  }

  listEl.innerHTML = '';
  r.backups.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'nm-listitem';

    const info = document.createElement('div');
    info.innerHTML = `
      <div class="nm-listitem-title">🗂️ <span class="nm-ltr">${esc(b.filename)}</span></div>
      <div class="nm-listitem-sub">${esc(NMFormat.bytes((Number(b.sizeMB) || 0) * 1024 * 1024))} • ${esc(NMFormat.dateTime(b.createdAt))}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'nm-listitem-actions';

    const restoreB = document.createElement('button');
    restoreB.type = 'button';
    restoreB.className = 'btn btn-primary btn-sm';
    restoreB.textContent = T('s2j.restore', '↩️ استعادة');
    restoreB.addEventListener('click', () => restoreFromExisting(b.filename));

    const deleteB = document.createElement('button');
    deleteB.type = 'button';
    deleteB.className = 'btn btn-danger btn-sm';
    deleteB.textContent = T('common.delete', '🗑️ حذف');
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
        if (labelEl) labelEl.textContent = T('s2.no_file_selected', 'لم يتم اختيار ملف');
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

// ── v2.19.0 — النسخ الاحتياطي التلقائي المجدول (تحميل/حفظ الإعدادات) ──
(function bindBackupSchedule() {
  async function loadSchedule() {
    try {
      const r = await backupApi("/api/backup/schedule");
      const sc = (r && r.schedule) || {};
      const en = document.getElementById("bk-sched-enabled");
      const hr = document.getElementById("bk-sched-hour");
      const kp = document.getElementById("bk-sched-keep");
      if (en) en.checked = sc.enabled === undefined ? true : !!sc.enabled;
      if (hr) hr.value = sc.hour || "03:30";
      if (kp) kp.value = Number(sc.keep) || 7;
    } catch (e) { /* صامت — اللوحة تعمل بلا جدولة */ }
  }
  async function saveSchedule() {
    const st = document.getElementById("bk-sched-status");
    try {
      const payload = {
        enabled: !!document.getElementById("bk-sched-enabled").checked,
        hour: document.getElementById("bk-sched-hour").value || "03:30",
        keep: Number(document.getElementById("bk-sched-keep").value) || 7,
      };
      const r = await backupApi("/api/backup/schedule", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r || !r.success) throw new Error((r && r.error) || "فشل الحفظ");
      if (st) { st.textContent = "✅ تم حفظ جدولة النسخ الاحتياطي"; st.style.color = "var(--online)"; }
    } catch (e) {
      if (st) { st.textContent = "✗ " + (e.message || e); st.style.color = "var(--offline)"; }
    }
  }
  loadSchedule();
  const sb = document.getElementById("bk-sched-save");
  if (sb) sb.addEventListener("click", saveSchedule);
})();

// ── v2.20.1 — تصدير الانقطاعات CSV (downtime_events) ──
(function bindDowntimesExport() {
  const btn = document.getElementById("downtimes-export-btn");
  const daysSel = document.getElementById("downtimes-export-days");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const days = daysSel ? daysSel.value : "90";
    btn.disabled = true;
    try {
      const r = await fetch("/api/backup/export-downtimes?days=" + days, { credentials: "same-origin" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "downtimes-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert("فشل التصدير: " + (e.message || e));
    } finally {
      btn.disabled = false;
    }
  });
})();
