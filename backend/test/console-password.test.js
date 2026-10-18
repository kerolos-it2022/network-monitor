'use strict';
// console-password.test.js — «كلمة مرور واحدة لكل الأبواب»: عقد المساعد + ألا يبقى بابٌ يُكتب يدويًّا.
// ملاحظة: التنفيذ الفعلي (chpasswd/sha512sum) لا يُجرَّب هنا — يحتاج لينكس + root؛ هذا الاختبار
// يحرس **العقد والترابط**: المساعد واحد، ويُستدعى من كل الأبواب، وليس فيه مسار مفتوح.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const f = (...p) => path.join(ROOT, ...p);
const read = (...p) => fs.readFileSync(f(...p), 'utf8');

const HELPER = f('appliance/config/includes.chroot/usr/local/sbin/nm-sync-console-password');
const SUDOERS = f('appliance/config/includes.chroot/etc/sudoers.d/nm-console-sync');
const HOOK = f('appliance/config/hooks/live/0120-fix-perms.hook.chroot');
const CONSOLE = f('appliance/config/includes.chroot/usr/local/sbin/nm-console');
const INSTALL = f('appliance/config/includes.chroot/usr/local/sbin/nm-install-to-disk');
const ROUTE = f('backend/src/routes/auth.routes.js');
const SERVICE = f('backend/src/services/console-password.service.js');

const { syncSystemPassword, helperCommand, HELPER: HELPER_PATH } = require('../src/services/console-password.service');

test('خدمة المزامنة لا ترمي خطأً خارج الأبلاينس (تطوير/ويندوز) — تتخطّى بهدوء', () => {
  const r = syncSystemPassword('some-password-123');
  assert.equal(r.skipped, true);
  assert.equal(r.ok, undefined);
});

test('كلمة مرور أقصر من 4 أحرف تُتخطّى ولا تُنفَّذ', () => {
  assert.equal(syncSystemPassword('abc').skipped, true);
  assert.equal(syncSystemPassword('').skipped, true);
  assert.equal(syncSystemPassword(null).skipped, true);
});

test('عقد الاستدعاء: sudo -n <المساعد> فقط، وكلمة المرور لا تظهر في وسائط argv', () => {
  const { cmd, args } = helperCommand();
  assert.equal(cmd, '/usr/bin/sudo');
  assert.deepEqual(args, ['-n', HELPER_PATH]);
  // لا تُمرَّر كلمة المرور كقيمة في أي وسيط (المسار نفسه فيه كلمة password، فلا نفحصه)
  assert.ok(!args.some((a) => a === HELPER_PATH ? false : /pass=|--password|secret|=/i.test(a)));
});

test('المساعد يقرأ كلمة المرور من stdin فقط ويكتب البوابة + حساب لينكس', () => {
  const s = read('appliance/config/includes.chroot/usr/local/sbin/nm-sync-console-password');
  assert.match(s, /PW=\$\(cat\)/);                     // stdin لا argv
  assert.ok(!/\$1\b/.test(s), 'لا يستعمل $1 (وسائط الأوامر) إطلاقًا');
  assert.match(s, /CONSOLE_HASH=/);                    // بوابة شاشة الكونسول
  assert.match(s, /chmod 600 "\$CONF"/);
  assert.match(s, /chpasswd/);                         // حساب لينكس (SSH/تيرمنال)
  assert.match(s, /id -u.*-eq 0/);                     // لا يعمل إلا بـroot
  assert.match(s, /MIN_LEN=4/);
  assert.ok(!/rm -rf|dd |mkfs/.test(s), 'لا يحتوي أي أمر مدمّر');
});

test('قاعدة sudo: مسار واحد صريح بلا كلمة مرور وبلا أحرف بديلة', () => {
  const s = read('appliance/config/includes.chroot/etc/sudoers.d/nm-console-sync');
  const rules = s.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.equal(rules.length, 1, 'قاعدة واحدة فقط');
  assert.equal(rules[0], 'netmon ALL=(root) NOPASSWD: /usr/local/sbin/nm-sync-console-password');
  assert.ok(!/NOPASSWD:\s*ALL|ALL=\(ALL\)|\*/.test(s), 'لا صلاحية شاملة ولا wildcards');
});

test('hook البناء يضبط صلاحيات المساعد وملف sudoers (440 root:root)', () => {
  const s = read('appliance/config/hooks/live/0120-fix-perms.hook.chroot');
  assert.match(s, /chmod \+x \/usr\/local\/sbin\/nm-sync-console-password/);
  assert.match(s, /chown root:root \/etc\/sudoers\.d\/nm-console-sync/);
  assert.match(s, /chmod 440 \/etc\/sudoers\.d\/nm-console-sync/);
});

test('كل «أبواب» كلمة المرور تمرّ من المساعد الواحد — لا كتابة يدويًّا في مكانين', () => {
  const consoleSrc = read('appliance/config/includes.chroot/usr/local/sbin/nm-console');
  assert.ok((consoleSrc.match(/nm-sync-console-password/g) || []).length >= 2, 'التغيير + أول تشغيل');
  assert.ok(!/printf 'CONSOLE_HASH=/.test(consoleSrc), 'لا كتابة يدوية لبوابة الكونسول بعد الآن');

  const installSrc = read('appliance/config/includes.chroot/usr/local/sbin/nm-install-to-disk');
  assert.match(installSrc, /nm-sync-console-password/);
  assert.ok(!/echo "sysadmin:\$ADMIN_PASS" \| chroot/.test(installSrc), 'لا chpasswd يدوي بعد الآن');

  const routeSrc = read('backend/src/routes/auth.routes.js');
  assert.match(routeSrc, /syncSystemPassword\(new_password\)/);
  assert.match(routeSrc, /require\('\.\.\/services\/console-password\.service'\)/);

  assert.match(read('backend/src/services/console-password.service.js'), /input: `\$\{password\}\\n`/);
  assert.ok(fs.existsSync(SERVICE) && fs.existsSync(HELPER) && fs.existsSync(SUDOERS));
});

test('التثبيت على القرص يحذف حساب live الافتراضي (كلمة مروره معروفة للجميع)', () => {
  const s = read('appliance/config/includes.chroot/usr/local/sbin/nm-install-to-disk');
  assert.match(s, /getent passwd user/);
  assert.match(s, /deluser --remove-home user|userdel -r user/);
  assert.match(s, /rm -f "\$MOUNT\/etc\/sudoers\.d\/live"/);
  assert.match(s, /sysadmin/);                          // حساب لينكس المرئي للمستخدم مذكور في مخرجات التثبيت
  assert.match(s, /sysadmin' — the SAME password|sysadmin \(type this name/);
});
