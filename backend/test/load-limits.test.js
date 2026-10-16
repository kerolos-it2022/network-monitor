// اختبارات MON-03 — حدود الحمل والعدالة: الحد التكيّفي، تقدير التأخير، ومنع «جوع» الأجهزة.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv } = require('./helpers/test-app');

const env = setupTestEnv();

const monitor = require('../src/services/monitor.service');

test.after(() => env.cleanup());

const REAL_ENV = process.env.NM_MAX_CONCURRENT_CHECKS;
function withEnv(value, fn) {
  if (value === undefined) delete process.env.NM_MAX_CONCURRENT_CHECKS;
  else process.env.NM_MAX_CONCURRENT_CHECKS = String(value);
  try { return fn(); } finally {
    if (REAL_ENV === undefined) delete process.env.NM_MAX_CONCURRENT_CHECKS;
    else process.env.NM_MAX_CONCURRENT_CHECKS = REAL_ENV;
  }
}

test('MON-03: الحد التكيّفي — يكفي لفحص كل الأجهزة، وبحدٍّ أقصى 100، وبأرضية 10', () => {
  withEnv(undefined, () => {
    assert.equal(monitor.maxConcurrentChecks(10), 10);
    assert.equal(monitor.maxConcurrentChecks(50), 50, 'شبكة 50 جهازًا ⇒ الحد 50 (لا تأخير)');
    assert.equal(monitor.maxConcurrentChecks(100), 100);
    assert.equal(monitor.maxConcurrentChecks(200), 100, 'سقف صلب 100 ⇒ تأخير مُعلَن لا انفجار');
    assert.equal(monitor.maxConcurrentChecks(3), 10, 'أرضية آمنة 10');
    assert.equal(monitor.maxConcurrentChecks(null), 10);
  });
});

test('MON-03: ضبط المالك الصريح يُحترم حرفيًّا حتى لو كان أصغر', () => {
  withEnv(10, () => {
    assert.equal(monitor.maxConcurrentChecks(200), 10, 'NM_MAX_CONCURRENT_CHECKS=10 ⇒ قرار المالك');
    assert.equal(monitor.maxConcurrentChecks(50), 10);
  });
});

test('MON-03: تقدير التأخير والفاصل الفعلي (للعرض في /api/health)', () => {
  assert.equal(monitor.lagFactorFor(200, 100), 2);
  assert.equal(monitor.lagFactorFor(50, 100), 1);
  assert.equal(monitor.lagFactorFor(500, 100), 5);
  assert.equal(monitor.lagFactorFor(0, 10), 1);
  assert.equal(monitor.achievableIntervalSeconds(10, 200, 100), 20, '10 ثوانٍ مطلوبة ⇒ 20 ثانية فعلية');
  assert.equal(monitor.achievableIntervalSeconds(60, 200, 100), 60, 'الفاصل المُعرَّف أكبر ⇒ لا يتأثر');
});

test('MON-03: ترتيب الأجهزة المستحقة — الأقدم أولًا (منع «جوع» آخر القائمة)', () => {
  const now = 1_000_000;
  const devices = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, check_interval_seconds: 10 }));
  const lastCheck = new Map();

  // الدورة الأولى: كل الأجهزة مستحقة (لم تُفحص) ⇒ 25 مستحقًّا مرتّبين بالمعرّف
  const firstDue = monitor.orderDueDevices(devices, lastCheck, now);
  assert.equal(firstDue.length, 25);

  // محاكاة دورة بحد 10: أول 10 «فُحصت» الآن
  for (const d of firstDue.slice(0, 10)) lastCheck.set(d.id, now);

  // الدورة التالية (بعد 10 ثوانٍ): الـ15 غير المفحوصة يجب أن تتقدّم (الأقدم = 0)
  const secondDue = monitor.orderDueDevices(devices, lastCheck, now + 10_000);
  assert.equal(secondDue.length, 25, 'الجميع مستحق بعد مرور الفاصل');
  const firstTenIds = secondDue.slice(0, 10).map((d) => d.id);
  assert.ok(firstTenIds.every((id) => id > 10), `الأجهزة غير المفحوصة تُقدَّم أولًا (كانت ${firstTenIds.join(',')})`);
  assert.ok(firstTenIds.includes(11) && firstTenIds.includes(20), 'تشمل الأجهزة من 11 إلى 20');

  // الدورة الثالثة: من لم يُفحص بعد (21-25) يتقدّم، ثم الأقدم فحصًا (المجموعة الأولى)
  for (const d of secondDue.slice(0, 10)) lastCheck.set(d.id, now + 10_000);
  const thirdDue = monitor.orderDueDevices(devices, lastCheck, now + 20_000);
  const thirdIds = thirdDue.slice(0, 10).map((d) => d.id);
  assert.ok(thirdIds.includes(21) && thirdIds.includes(25), 'الأجهزة غير المفحوصة تُخدَم أولًا');
  assert.ok(thirdIds.includes(1) || thirdIds.includes(2), 'ثم الأقدم فحصًا (المجموعة الأولى)');

  // الخاصية الأهم: خلال 3 دورات بحد 10 خُدمت الـ25 كلها (لا «جوع» لأي جهاز)
  const served = new Set([
    ...firstDue.slice(0, 10).map((d) => d.id),
    ...secondDue.slice(0, 10).map((d) => d.id),
    ...thirdIds,   // مصفوفة معرّفات جاهزة
  ]);
  assert.equal(served.size, 25, 'كل الأجهزة خُدمت خلال 3 دورات');
});

test('MON-03: الأجهزة غير المستحقة (داخل فاصلها) لا تُبعث للفحص', () => {
  const now = 500_000;
  const devices = [
    { id: 1, check_interval_seconds: 60 },
    { id: 2, check_interval_seconds: 10 },
  ];
  const lastCheck = new Map([[1, now - 30_000], [2, now - 30_000]]); // الأول 60ث ⇒ غير مستحق
  const due = monitor.orderDueDevices(devices, lastCheck, now);
  assert.deepEqual(due.map((d) => d.id), [2]);
});
