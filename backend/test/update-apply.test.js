// اختبارات «الاستبدال الكامل» لملفات التطبيق عند التحديث (services/update-apply.service.js).
// الغرض — إثبات العِلّة والإصلاح معًا:
//   • العِلّة: التحديث القديم نسخ فوق الشجرة القائمة (cp -a / rsync بلا --delete) فبقي
//     كل ملف حُذف من الإصدار الجديد (صفحات/سكربتات/مجلدات قديمة).
//   • الإصلاح: شجرة قديمة + أرشيف جديد ⇒ (أ) الملفات القديمة الزائدة تُحذف، (ب) كل ملفات
//     الإصدار الجديد موجودة ومطابقة بايت-ببايت، (ج) قاعدة البيانات و.env وnode_modules
//     والنسخ والمرفوعات لم تُمس. واختبار السلامة: فشل التجهيز لا يغيّر الشجرة القديمة.
// لا قاعدة بيانات ولا شبكة — الخدمة عمليات ملفات نقية.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyReleaseTree, stageReleaseTree, commitStagedTree } = require('../src/services/update-apply.service');

const tmpRoots = [];
function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}
test.after(() => {
  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* تجاهل */ } }
});

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function read(p) { return fs.readFileSync(p); }
// يتجاهل مجلدات عمل المُحدِّث (staging/backup) عند مقارنة الشجرة القديمة.
function walkFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.nm-update-staging-') || ent.name.startsWith('.nm-update-old-')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out;
}

// شجرة «نسخة قديمة» كاملة: ملفات تطبيق زائدة (ستُحذف)، بيانات مستخدم (ستُحفظ).
function buildOldTree(prefix) {
  const dir = mkTmp(prefix);
  write(path.join(dir, 'backend/src/server.js'), 'OLD SERVER');
  write(path.join(dir, 'backend/src/legacy/deleted.js'), 'STALE LEGACY JS');
  write(path.join(dir, 'backend/stale-root.js'), 'STALE ROOT JS');
  write(path.join(dir, 'backend/package.json'), '{"version":"2.50.0"}');
  write(path.join(dir, 'backend/.env'), 'SECRET=keep-me\nDB_PATH=../database/monitoring.db\n');
  write(path.join(dir, 'backend/node_modules/dep/index.js'), 'DEP INSTALLED');
  write(path.join(dir, 'backend/database/update-web-status.json'), '{"state":"old"}');
  write(path.join(dir, 'frontend/public/index.html'), 'OLD INDEX');
  write(path.join(dir, 'frontend/public/js/removed-page.js'), 'STALE PAGE JS');
  write(path.join(dir, 'frontend/public/sw.js'), 'OLD SW');
  write(path.join(dir, 'frontend/uploads/logo.png'), 'UPLOADED LOGO');
  write(path.join(dir, 'database/monitoring.db'), 'LIVE DB BYTES');
  write(path.join(dir, 'database/backups/manual.db'), 'MANUAL BACKUP');
  write(path.join(dir, 'database/schema.sql'), 'OLD SCHEMA');
  write(path.join(dir, 'docs/old-only.md'), 'STALE DOC');
  write(path.join(dir, 'docs/_notes/local.md'), 'MY LOCAL NOTES');
  write(path.join(dir, 'ui-redesign/README.md'), 'LOCAL DEV SNAPSHOT');
  write(path.join(dir, '.env'), 'ROOT SECRET');
  write(path.join(dir, 'update.sh'), 'OLD UPDATE SCRIPT');
  return dir;
}

// شجرة «إصدار جديد» كما يفكّها الأرشيف: مجلد أعلى واحد ثم محتوى الإصدار.
// (تختبر أيضًا اكتشاف المجلد الأعلى للأرشيف — resolveReleaseRoot.)
function buildNewRelease(prefix) {
  const container = mkTmp(prefix);
  const dir = path.join(container, 'network-monitor-2.50.1');
  write(path.join(dir, 'backend/src/server.js'), 'NEW SERVER');
  write(path.join(dir, 'backend/src/new-file.js'), 'NEW FILE');
  write(path.join(dir, 'backend/package.json'), '{"version":"2.50.1"}');
  write(path.join(dir, 'frontend/public/index.html'), 'NEW INDEX');
  write(path.join(dir, 'frontend/public/js/new-page.js'), 'NEW PAGE JS');
  write(path.join(dir, 'frontend/public/sw.js'), 'NEW SW');
  write(path.join(dir, 'database/schema.sql'), 'NEW SCHEMA');
  write(path.join(dir, 'docs/DEPLOY.md'), 'NEW DOC');
  write(path.join(dir, 'update.sh'), 'NEW UPDATE SCRIPT');
  write(path.join(dir, 'ecosystem.config.js'), 'NEW ECOSYSTEM');
  return { container, releaseRoot: dir };
}

test('استبدال كامل: الملفات القديمة الغائبة عن الإصدار الجديد تُحذف بالكامل', () => {
  const oldDir = buildOldTree('nm-upd-old-');
  const { container } = buildNewRelease('nm-upd-new-');

  const report = applyReleaseTree({ srcDir: container, destDir: oldDir });

  // (أ) لا أثر لأي ملف/مجلد قديم حُذف من الإصدار الجديد
  assert.equal(fs.existsSync(path.join(oldDir, 'backend/src/legacy/deleted.js')), false);
  assert.equal(fs.existsSync(path.join(oldDir, 'backend/stale-root.js')), false);
  assert.equal(fs.existsSync(path.join(oldDir, 'backend/src/legacy')), false, 'المجلد الفارغ القديم يُزال هو أيضًا');
  assert.equal(fs.existsSync(path.join(oldDir, 'frontend/public/js/removed-page.js')), false);
  assert.equal(fs.existsSync(path.join(oldDir, 'docs/old-only.md')), false);

  // (ب) عناصر الإصدار الجديد كلها موجودة ومطابقة بايت-ببايت
  const releaseRoot = report.releaseRoot;
  for (const rel of walkFiles(releaseRoot)) {
    const applied = path.join(oldDir, rel);
    assert.ok(fs.existsSync(applied), 'ملف الإصدار الجديد مفقود بعد التحديث: ' + rel);
    assert.ok(read(applied).equals(read(path.join(releaseRoot, rel))), 'محتوى مختلف (ليس نسخة جديدة): ' + rel);
  }
  assert.equal(read(path.join(oldDir, 'backend/src/server.js')).toString(), 'NEW SERVER');
  assert.equal(read(path.join(oldDir, 'backend/package.json')).toString(), '{"version":"2.50.1"}');
  assert.equal(read(path.join(oldDir, 'docs/DEPLOY.md')).toString(), 'NEW DOC');

  // (ج) بيانات المستخدم لم تُمس إطلاقًا
  assert.equal(read(path.join(oldDir, 'database/monitoring.db')).toString(), 'LIVE DB BYTES');
  assert.equal(read(path.join(oldDir, 'database/backups/manual.db')).toString(), 'MANUAL BACKUP');
  assert.equal(read(path.join(oldDir, 'backend/.env')).toString(), 'SECRET=keep-me\nDB_PATH=../database/monitoring.db\n');
  assert.equal(read(path.join(oldDir, '.env')).toString(), 'ROOT SECRET');
  assert.equal(read(path.join(oldDir, 'backend/node_modules/dep/index.js')).toString(), 'DEP INSTALLED');
  assert.equal(read(path.join(oldDir, 'backend/database/update-web-status.json')).toString(), '{"state":"old"}');
  assert.equal(read(path.join(oldDir, 'frontend/uploads/logo.png')).toString(), 'UPLOADED LOGO');
  assert.equal(read(path.join(oldDir, 'docs/_notes/local.md')).toString(), 'MY LOCAL NOTES');
  assert.equal(read(path.join(oldDir, 'ui-redesign/README.md')).toString(), 'LOCAL DEV SNAPSHOT');

  // التقرير يوثّق ما استُبدل وما حُفظ وما أُزيل
  for (const name of ['backend', 'frontend', 'docs', 'update.sh', 'ecosystem.config.js']) {
    assert.ok(report.replaced.includes(name), 'يجب أن يُستبدل: ' + name);
  }
  assert.ok(report.merged.includes('database'));
  assert.deepEqual(report.preserved.backend.sort(), ['.env', 'database', 'node_modules']);
  assert.ok(report.removedStaleEntries >= 4, 'يجب عدّ العناصر القديمة المُزالة (>=4) — العدد: ' + report.removedStaleEntries);
});

test('السلامة: فشل التجهيز لا يغيّر الشجرة القديمة إطلاقًا (تجهيز كامل قبل أي تبديل)', () => {
  const oldDir = buildOldTree('nm-upd-safe-');
  const before = walkFiles(oldDir).map((rel) => rel + ':' + read(path.join(oldDir, rel)).toString()).sort();

  // مصدر غير صالح (بلا backend/frontend) ⇒ استثناء قبل أي لمس للشجرة القائمة
  const badSrc = mkTmp('nm-upd-bad-');
  write(path.join(badSrc, 'something/readme.txt'), 'not a release');
  assert.throws(() => applyReleaseTree({ srcDir: badSrc, destDir: oldDir }), /unexpected release tree/);

  // مصدر غير موجود ⇒ استثناء
  assert.throws(() => stageReleaseTree(path.join(badSrc, 'does-not-exist'), oldDir), /not found/);

  const after = walkFiles(oldDir).map((rel) => rel + ':' + read(path.join(oldDir, rel)).toString()).sort();
  assert.deepEqual(after, before, 'الشجرة القديمة يجب أن تبقى كما هي عند فشل التجهيز');
  assert.equal(fs.existsSync(path.join(oldDir, 'backend/stale-root.js')), true);

  // تجهيز ناجح بلا commit (محاكاة انقطاع بعد التجهيز) ⇒ لا شيء تغيّر أيضًا…
  const { container, releaseRoot } = buildNewRelease('nm-upd-stage-');
  const stage = stageReleaseTree(container, oldDir);
  const afterStage = walkFiles(oldDir).map((rel) => rel + ':' + read(path.join(oldDir, rel)).toString()).sort();
  assert.deepEqual(afterStage, before, 'التجهيز وحده لا يلمس الشجرة القائمة');
  // …ثم commit يُكمل الاستبدال
  const report = commitStagedTree(stage, oldDir);
  assert.ok(report.replaced.includes('backend'));
  assert.equal(read(path.join(oldDir, 'backend/src/server.js')).toString(), 'NEW SERVER');
  assert.equal(fs.existsSync(path.join(oldDir, 'backend/stale-root.js')), false);
  assert.equal(read(path.join(oldDir, 'database/monitoring.db')).toString(), 'LIVE DB BYTES');
  assert.equal(read(path.join(releaseRoot, 'backend/src/server.js')).toString(), 'NEW SERVER');
  // الحقول المحفوظة رحلت إلى الشجرة الجديدة سليمة
  assert.equal(read(path.join(oldDir, 'backend/.env')).toString(), 'SECRET=keep-me\nDB_PATH=../database/monitoring.db\n');
  assert.equal(read(path.join(oldDir, 'backend/node_modules/dep/index.js')).toString(), 'DEP INSTALLED');
});

test('التراجع: فشل التبديل بعد التجهيز يعيد العنصر القديم كاملًا (بلا فقدان .env/node_modules)', () => {
  const oldDir = buildOldTree('nm-upd-rb-');
  const before = walkFiles(oldDir).map((rel) => rel + ':' + read(path.join(oldDir, rel)).toString()).sort();
  const { container } = buildNewRelease('nm-upd-rb-new-');

  const stage = stageReleaseTree(container, oldDir);
  // حقن فشل حتمي: نحذف النسخة المُجهَّزة من `backend` قبل التبديل ⇒ rename يفشل
  const backendEntry = stage.entries.find((e) => e.name === 'backend');
  fs.rmSync(backendEntry.staged, { recursive: true, force: true });
  assert.throws(() => commitStagedTree(stage, oldDir));

  // الشجرة القديمة عادت كاملة: لا حذف، لا فقدان .env/node_modules، لا بقايا backup
  const after = walkFiles(oldDir).map((rel) => rel + ':' + read(path.join(oldDir, rel)).toString()).sort();
  assert.deepEqual(after, before, 'بعد فشل التبديل يجب أن تعود الشجرة القديمة كما كانت بالضبط');
  assert.equal(read(path.join(oldDir, 'backend/.env')).toString(), 'SECRET=keep-me\nDB_PATH=../database/monitoring.db\n');
  assert.equal(read(path.join(oldDir, 'backend/node_modules/dep/index.js')).toString(), 'DEP INSTALLED');
  assert.equal(fs.existsSync(path.join(oldDir, 'backend/stale-root.js')), true);
  assert.equal(read(path.join(oldDir, 'database/monitoring.db')).toString(), 'LIVE DB BYTES');
  // مساحة العمل (staging) تبقى للمراجعة اليدوية — ليست جزءًا من الشجرة.
  fs.rmSync(stage.stagingDir, { recursive: true, force: true });
});
