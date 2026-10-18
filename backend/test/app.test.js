// اختبارات QA-01 — أساس التطبيق: صحة الخادم، الواجهة الثابتة، و404 JSON للـ API.
// تحمي هذه الاختبارات فصل app.js عن server.js (إعادة الهيكلة) من الانكسار.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, readText } = require('./helpers/test-app');

const env = setupTestEnv();
let srv;

test.before(async () => {
  srv = await startServer();
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('QA-01: /api/health يعمل ويُعيد الإصدار وحالة المحرك', async () => {
  const res = await fetch(srv.baseUrl + '/api/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.match(String(body.version), /^\d+\.\d+\.\d+/, 'يجب أن يحمل رقم إصدار من package.json');
  assert.ok(body.engine && typeof body.engine === 'object');
});

test('QA-01: مسار API غير معروف يُعيد 404 JSON ولا يبتلعه SPA fallback', async () => {
  const res = await fetch(srv.baseUrl + '/api/does-not-exist-xyz');
  assert.equal(res.status, 404);
  assert.match(String(res.headers.get('content-type')), /application\/json/);
  const body = JSON.parse(await readText(res));
  assert.equal(body.success, false);
});

test('QA-01: الواجهة العامة تُخدَم من نفس الخادم (index.html)', async () => {
  const res = await fetch(srv.baseUrl + '/index.html');
  assert.equal(res.status, 200);
  const txt = await readText(res);
  assert.match(txt, /<html/i);
});

test('QA-01: مسار صفحة غير موجود يُعاد كـ index.html (SPA)', async () => {
  const res = await fetch(srv.baseUrl + '/some/spa/route');
  assert.equal(res.status, 200);
  const txt = await readText(res);
  assert.match(txt, /<html/i);
});
