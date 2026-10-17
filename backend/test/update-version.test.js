// اختبارات منطق الإصدارات للمُحدِّث (services/update-version.service.js).
// الغرض: تثبيت السلوك المعتمد — الفحص **يُبلّغ بكل فرق** مع ما هو منشور على GitHub (سلوك المشروع)،
// ويُبيّن اتجاه الفرق: على GitHub أحدث ⇒ يوجد ما يُثبَّت، ونسختنا أحدث ⇒ لا شيء يُنزَّل
// (وضع طبيعي أثناء العمل على إصدار لم يُرفع بعد). هذا الاختبار لا يحتاج قاعدة بيانات (منطق نقي).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { semverParts, isNewerVersion, isSameVersion, compareVersions } = require('../src/services/update-version.service');

test('تفكيك الإصدار: يقبل v والناقص والأشكال غير الصالحة', () => {
  assert.deepEqual(semverParts('v2.33.0'), [2, 33, 0]);
  assert.deepEqual(semverParts('2.32.1'), [2, 32, 1]);
  assert.deepEqual(semverParts('v2.33'), [2, 33, 0]);
  assert.deepEqual(semverParts('غير-صلاح'), [0, 0, 0]);
  assert.deepEqual(semverParts(null), [0, 0, 0]);
});

test('المقارنة رقمية لا نصّية (2.10.0 أحدث من 2.9.0)', () => {
  assert.equal(isNewerVersion('v2.10.0', '2.9.0'), true);
  assert.equal(isNewerVersion('2.9.0', '2.10.0'), false);
  assert.equal(isSameVersion('v2.32.1', '2.32.1'), true);
});

test('نسختنا المحلية أحدث من المنشور: نُبلّغ بالفرق ونتجاهل الاتجاه للتنزيل', () => {
  const cmp = compareVersions('2.33.0', '2.32.1');
  assert.equal(cmp.same, false);
  assert.equal(cmp.differenceFromGithub, true, 'الفرق مع GitHub يُعرَض كما هو');
  assert.equal(cmp.localNewer, true);
  assert.equal(cmp.remoteNewer, false, 'لا يوجد ما يُنزَّل — منع التنزيل النازل');
  assert.match(cmp.note, /أحدث منه/);
  assert.match(cmp.note, /v2\.32\.1/);
  assert.match(cmp.note, /v2\.33\.0/);
});

test('على GitHub إصدار أحدث: تحديث حقيقي قابل للتنزيل', () => {
  const cmp = compareVersions('2.33.0', '2.34.0');
  assert.equal(cmp.remoteNewer, true);
  assert.equal(cmp.localNewer, false);
  assert.equal(cmp.differenceFromGithub, true);
  assert.match(cmp.note, /يتوفّر تحديث جديد/);
});

test('تطابق الإصدار: لا فرق ولا تحديث', () => {
  const cmp = compareVersions('v2.32.1', '2.32.1');
  assert.equal(cmp.same, true);
  assert.equal(cmp.differenceFromGithub, false);
  assert.equal(cmp.remoteNewer, false);
  assert.equal(cmp.localNewer, false);
  assert.match(cmp.note, /نفس آخر إصدار/);
});
