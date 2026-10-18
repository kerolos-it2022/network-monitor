// اختبارات SEC-01 — محدِّدات التكرار والتزامن (بساعة مزيفة، بلا انتظار حقيقي).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSlidingWindowLimiter, createSemaphore } = require('../src/services/net/tool-limits');

test('محدِّد النافذة المنزلقة: يسمح حتى الحد ثم يرفض مع زمن إعادة', () => {
  let now = 1000;
  const lim = createSlidingWindowLimiter({ windowMs: 60000, max: 3, now: () => now });

  assert.equal(lim.check('u1').ok, true);
  assert.equal(lim.check('u1').ok, true);
  assert.equal(lim.check('u1').ok, true);

  const denied = lim.check('u1');
  assert.equal(denied.ok, false);
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 60000);

  // مستخدم آخر لا يتأثر
  assert.equal(lim.check('u2').ok, true);

  // بعد انقضاء النافذة يُسمح مجددًا
  now += 60001;
  assert.equal(lim.check('u1').ok, true);
});

test('محدِّد النافذة المنزلقة: ينزلق تدريجيًّا لا دفعة واحدة', () => {
  let now = 0;
  const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 2, now: () => now });
  assert.equal(lim.check('k').ok, true);   // t=0
  now = 500;
  assert.equal(lim.check('k').ok, true);   // t=500
  assert.equal(lim.check('k').ok, false);  // ممتلئ
  now = 1001;                              // انتهت صلاحية الطلب الأول فقط
  assert.equal(lim.check('k').ok, true);
  assert.equal(lim.check('k').ok, false);  // الثاني (t=500) ما زال داخل النافذة
});

test('إشارة التزامن: تحترم الحد الأقصى وتحرّر المقعد مرة واحدة', () => {
  const sem = createSemaphore(2);
  const r1 = sem.tryAcquire();
  const r2 = sem.tryAcquire();
  assert.notEqual(r1, null);
  assert.notEqual(r2, null);
  assert.equal(sem.active, 2);
  assert.equal(sem.tryAcquire(), null, 'الحد الأقصى بلغ');

  r1();
  assert.equal(sem.active, 1);
  r1(); // تحرير مكرر لا يُنقص مجددًا
  assert.equal(sem.active, 1);

  const r3 = sem.tryAcquire();
  assert.notEqual(r3, null);
  assert.equal(sem.active, 2);
  r2(); r3();
  assert.equal(sem.active, 0);
});
