// اختبارات جسر تنظيف بقايا التحديث القديم (services/cleanup-stale-files.service.js).
// الغرض — إثبات العقد كاملًا على جذر تثبيت وهمي (بلا قاعدة بيانات ولا شبكة):
//   • الملفات المدرَجة في القائمة تُحذف، والمجلد الذي أُفرغ وحده يُزال.
//   • المحفوظ (.env · database · node_modules · docs/_notes · docs/private) وغير
//     المدرَج في القائمة لا يُمسّان إطلاقًا.
//   • القائمة تُطبَّق مرة واحدة (علامة backend/removed-files.applied)، وقائمة إصدار
//     لاحق (for مختلف) تُطبَّق بدورها.
//   • القائمة مدخل غير موثوق: المسار المطلق/القرص/UNC/«..» ومجلد مُدرَج تُرفض ولا
//     تُلمس أي بقعة خارج جذر التثبيت.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { cleanupStaleFiles } = require('../src/services/cleanup-stale-files.service');

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
function exists(p) { return fs.existsSync(p); }

// لقطة شجرة كاملة (المسارات + المحتوى) لمقارنة «لم يتغيّر شيء».
function snapshot(dir, base = dir, out = new Map()) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) snapshot(p, base, out);
    else out.set(path.relative(base, p).replace(/\\/g, '/'), fs.readFileSync(p, 'utf8'));
  }
  return out;
}
function assertSameTree(dir, before) {
  const after = snapshot(dir);
  assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort());
}

// بقايا حقيقية من القائمة المرافقة للإصدار (backend/removed-files.json).
const STALE = [
  'docs/archive/ARCHITECTURE_REVIEW-2026-10.md',
  'docs/screenshots/dashboard-devices.png',
];

// تثبيت وهمي: بيانات محفوظة + ملف غير مدرَج + بقايا الإصدار القديم المدرَجة في القائمة.
function buildFakeInstall(root, removed = STALE) {
  write(path.join(root, 'backend/.env'), 'SECRET=keep');
  write(path.join(root, 'backend/database/monitoring.db'), 'LIVE DB');
  write(path.join(root, 'backend/node_modules/dep/index.js'), 'DEP');
  write(path.join(root, 'backend/src/server.js'), 'APP CODE');
  write(path.join(root, 'docs/_notes/local.md'), 'MY NOTES');
  write(path.join(root, 'docs/private/secret.md'), 'PRIVATE');
  write(path.join(root, 'docs/screenshots/keep-me.png'), 'UNRELATED PNG');
  write(path.join(root, 'database/monitoring.db'), 'ROOT DB');
  write(path.join(root, '.env'), 'ROOT SECRET');
  for (const p of removed) {
    // مدخل مجلد قائم (حالة اختبار الرفض) أو مسار غير قابل للكتابة على القرص
    // (المطلق/القرص/UNC في اختبار التلاعب) لا يُنشأ له ملف — القائمة وحدها تكفي.
    if (!/^[A-Za-z0-9._\-\/]+$/.test(p) || p.startsWith('/') || p.includes('..')) continue;
    const abs = path.join(root, ...p.split('/'));
    if (!exists(abs)) write(abs, 'STALE BYTES');
  }
  write(path.join(root, 'backend/removed-files.json'), JSON.stringify({ for: '2.50.2', removed }, null, 2));
  return root;
}

test('التنظيف: المدرَج يُحذف، والمحفوظ وغير المدرَج يبقى، والمجلد الفارغ يُزال', () => {
  const root = buildFakeInstall(path.join(mkTmp('nm-clean-'), 'repo'));
  const report = cleanupStaleFiles({ root });

  assert.equal(report.ran, true);
  assert.equal(report.skipped, false);
  assert.deepEqual(report.deleted, STALE);
  assert.deepEqual(report.refused, []);
  assert.deepEqual(report.dirsRemoved, ['docs/archive']);

  // البقايا ذهبت — والمجلد الذي أُفرغ وحده ذهب معها.
  assert.equal(exists(path.join(root, 'docs/archive/ARCHITECTURE_REVIEW-2026-10.md')), false);
  assert.equal(exists(path.join(root, 'docs/archive')), false);
  assert.equal(exists(path.join(root, 'docs/screenshots/dashboard-devices.png')), false);
  // غير المدرَج في القائمة يبقى (وفي مجلده ما يمنع إزالته).
  assert.equal(exists(path.join(root, 'docs/screenshots/keep-me.png')), true);
  assert.equal(exists(path.join(root, 'docs/screenshots')), true);
  // المحفوظ يبقى حرفيًّا.
  for (const keep of [
    'backend/.env', 'backend/database/monitoring.db', 'backend/node_modules/dep/index.js',
    'backend/src/server.js', 'docs/_notes/local.md', 'docs/private/secret.md',
    'database/monitoring.db', '.env',
  ]) {
    assert.equal(exists(path.join(root, ...keep.split('/'))), true, 'محفوظ اختفى: ' + keep);
  }
  assert.equal(fs.readFileSync(path.join(root, 'backend/database/monitoring.db'), 'utf8'), 'LIVE DB');
});

test('مرة واحدة: التشغيل الثاني لا يغيّر شيئًا (لقطة شجرة متطابقة)', () => {
  const root = buildFakeInstall(path.join(mkTmp('nm-clean-'), 'repo'));
  cleanupStaleFiles({ root });
  const before = snapshot(root);

  const second = cleanupStaleFiles({ root });
  assert.equal(second.ran, false);
  assert.equal(second.skipped, true);
  assert.equal(second.deleted.length, 0);
  assertSameTree(root, before);

  // العلامة تسجّل إصدار القائمة التي طُبِّقت (مرجع للتشغيل الواحد).
  assert.equal(fs.readFileSync(path.join(root, 'backend/removed-files.applied'), 'utf8').trim(), '2.50.2');
});

test('قائمة إصدار لاحق (for مختلف) تُطبَّق مرة أخرى', () => {
  const root = buildFakeInstall(path.join(mkTmp('nm-clean-'), 'repo'));
  cleanupStaleFiles({ root });
  // إصدار لاحق ينشر قائمة جديدة ببقايا جديدة ⇒ العلامة القديمة لا تمنعها.
  const newer = ['backend/src/old-page.js'];
  write(path.join(root, 'backend/src/old-page.js'), 'STALE 2');
  write(path.join(root, 'backend/removed-files.json'), JSON.stringify({ for: '2.50.3', removed: newer }));
  const report = cleanupStaleFiles({ root });
  assert.equal(report.skipped, false);
  assert.deepEqual(report.deleted, newer);
  assert.equal(exists(path.join(root, 'backend/src/old-page.js')), false);
});

test('المحفوظ والمجلدات: مسارات البيانات/التبعيات ومجلد مُدرَج تُرفض بلا حذف', () => {
  const root = buildFakeInstall(path.join(mkTmp('nm-clean-'), 'repo'), [
    'backend/.env',
    'backend/database/monitoring.db',
    'backend/node_modules/dep/index.js',
    'docs/_notes/local.md',
    'docs/private/secret.md',
    'database/monitoring.db',
    '.env',
    'docs',
    'docs/screenshots',
  ]);
  const before = snapshot(root);
  const report = cleanupStaleFiles({ root });

  assert.equal(report.deleted.length, 0);
  assert.equal(report.refused.length, 9);
  assertSameTree(root, before);
  assert.equal(exists(path.join(root, 'docs/screenshots')), true);
  assert.equal(fs.readFileSync(path.join(root, 'backend/.env'), 'utf8'), 'SECRET=keep');
  assert.equal(fs.readFileSync(path.join(root, 'database/monitoring.db'), 'utf8'), 'ROOT DB');
});

test('قائمة متلاعَب بها: مطلق/قرص/UNC/«..» تُرفض ولا يُلمس ما خارج الجذر', () => {
  const base = mkTmp('nm-clean-');
  const root = path.join(base, 'repo');
  const outside = path.join(base, 'outside.txt');
  write(outside, 'OUTSIDE BYTES');
  const crafted = [
    '../../etc/passwd',
    'C:\\Windows\\x',
    '/etc/passwd',
    '\\\\server\\share\\x',
    '../outside.txt',
    'docs/../../outside.txt',
  ];
  buildFakeInstall(root, crafted);
  const before = snapshot(root);
  const report = cleanupStaleFiles({ root });

  assert.equal(report.deleted.length, 0);
  assert.deepEqual(report.refused, crafted);       // تُرفض كما هي — بلا أي لمس
  assert.equal(report.markerWritten, false);       // قائمة مرفوضة لا تُوسم «طُبِّقت»
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE BYTES');
  assertSameTree(root, before);
});

test('قائمة بلا حقل «for» (أو بلا ملف أصلًا) لا تُطبَّق ولا تكتب علامة', () => {
  const root = path.join(mkTmp('nm-clean-'), 'repo');
  write(path.join(root, 'docs/archive/ARCHITECTURE_REVIEW-2026-10.md'), 'STALE');
  write(path.join(root, 'backend/removed-files.json'), JSON.stringify({ removed: ['docs/archive/ARCHITECTURE_REVIEW-2026-10.md'] }));

  const report = cleanupStaleFiles({ root });
  assert.equal(report.ran, false);
  assert.equal(report.deleted.length, 0);
  assert.equal(exists(path.join(root, 'docs/archive/ARCHITECTURE_REVIEW-2026-10.md')), true);
  assert.equal(exists(path.join(root, 'backend/removed-files.applied')), false);

  // تثبيت جديد بلا قائمة: لا شيء يحدث إطلاقًا.
  const fresh = path.join(mkTmp('nm-clean-'), 'repo');
  fs.mkdirSync(fresh, { recursive: true });
  const none = cleanupStaleFiles({ root: fresh });
  assert.equal(none.ran, false);
  assert.equal(none.deleted.length, 0);
});
