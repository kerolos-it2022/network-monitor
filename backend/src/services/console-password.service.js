'use strict';
// console-password.service.js — مزامنة كلمة مرور «أبواب» الأبلاينس مع تغيير كلمة مرور اللوحة.
//
// على الأبلاينس: مساعد root (/usr/local/sbin/nm-sync-console-password) يعطيه sudoers هذا
// المسار الوحيد لخدمة netmon وبلا كلمة مرور ⇒ نُمرّر له الكلمة الجديدة على **stdin**
// (لا على وسائط argv) فيحدّث: بوابة شاشة الكونسول + كلمة مرور مستخدم لينكس.
//
// خارج الأبلاينس (ويندوز/تطوير): لا يُوجد المساعد ⇒ { skipped: true } بلا أي أخطاء ولا أثر.
// وأي فشل هنا **لا يُفشل** تغيير كلمة المرور في اللوحة — يُسجَّل فقط (أفضل جهد، بلا تعطيل).
const fs = require('fs');
const { spawnSync } = require('child_process');

const HELPER = process.env.NM_SYNC_CONSOLE_HELPER || '/usr/local/sbin/nm-sync-console-password';
const SUDO = '/usr/bin/sudo';
const TIMEOUT_MS = 8000;

// عقدة الاستدعاء — دالة نقية تُختبر وحدها (بلا spawn)
function helperCommand() {
  return { cmd: SUDO, args: ['-n', HELPER] };
}

function syncSystemPassword(password) {
  if (typeof password !== 'string' || password.length < 4) return { skipped: true, reason: 'too-short' };
  if (process.platform !== 'linux' || !fs.existsSync(HELPER)) return { skipped: true, reason: 'appliance-helper-absent' };

  const { cmd, args } = helperCommand();
  try {
    const r = spawnSync(cmd, args, { input: `${password}\n`, timeout: TIMEOUT_MS, encoding: 'utf8' });
    if (r.error) {
      console.warn('[console-pass] spawn failed:', r.error.message);
      return { ok: false, error: r.error.message };
    }
    if (r.status !== 0) {
      console.warn('[console-pass] helper exited', r.status, String(r.stderr || '').trim().slice(0, 200));
      return { ok: false, status: r.status };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[console-pass] helper threw:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { syncSystemPassword, helperCommand, HELPER, SUDO };
