// اختبارات SEC-01 — مسارات أدوات التشخيص عبر HTTP فعلي (سيرفر على منفذ عشوائي + قاعدة مؤقتة).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { setupTestEnv, startServer, seedUser, makeClient, readText, collectSSE } = require('./helpers/test-app');

// قدرات البيئة: اختبارا التنفيذ الفعلي يحتاجان ping/tracert(oute) على الجهاز.
// لو غير متوفرين (مثل حاويات slim) نُعلن التخطّي بوضوح بدل فشل كاذب — مع بقاء اختبارات
// المصادقة/التحقق/السياسة إلزامية دائمًا. (الأبلاينس/CI يثبّتان iputils-ping/traceroute.)
function binaryAvailable(name) {
  const probe = spawnSync(name, process.platform === 'win32' ? ['-h'] : ['-h'], { stdio: 'ignore' });
  return !(probe.error && probe.error.code === 'ENOENT');
}
const PING_BIN = 'ping';
const TRACERT_BIN = process.platform === 'win32' ? 'tracert' : 'traceroute';
const MISSING_BINS = [PING_BIN, TRACERT_BIN].filter((b) => !binaryAvailable(b));
const skipReason = MISSING_BINS.length
  ? `أدوات الشبكة غير متاحة في هذه البيئة: ${MISSING_BINS.join(', ')} — الاختبارات الأخرى تعمل كالمعتاد`
  : false;

// البيئة تُضبط قبل أي require لوحدات src (قاعدة مؤقتة + عدد باكيتات ping = 1 لسرعة الاختبار).
const env = setupTestEnv({
  NM_PING_COUNT: '1',
  NM_TOOLS_RATE_PER_MIN: '50',
  NM_TOOLS_MAX_CONCURRENT: '2',
});

let srv, db;
let anon, admin, viewer;

test.before(async () => {
  srv = await startServer();
  db = srv.db;
  seedUser(db, 'admin_t', 'AdminPass123!', 'admin');
  seedUser(db, 'admin_t2', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_t', 'ViewerPass123!', 'viewer');

  anon = makeClient(srv.baseUrl);
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  const a = await admin.login('admin_t', 'AdminPass123!');
  assert.equal(a.status, 200);
  const v = await viewer.login('viewer_t', 'ViewerPass123!');
  assert.equal(v.status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('T01: المجهول يُرفض بـ 401 ولا يصل لأي تنفيذ', async () => {
  for (const path of ['/api/tools/ping?ip=127.0.0.1', '/api/tools/tracert?ip=127.0.0.1']) {
    const res = await anon.get(path);
    assert.equal(res.status, 401, path);
    const body = JSON.parse(await readText(res));
    assert.equal(body.success, false);
  }
});

test('T01: حساب العرض (viewer) مرفوض افتراضيًّا بـ 403', async () => {
  const res = await viewer.get('/api/tools/ping?ip=127.0.0.1');
  assert.equal(res.status, 403);
  const body = JSON.parse(await readText(res));
  assert.equal(body.success, false);
});

test('T01: حقن الأوامر والمحارف والأعلام تُرفض بـ 400 (لا تنفيذ)', async () => {
  const payloads = [
    '127.0.0.1%0Awhoami',        // سطر جديد ⇒ أمر إضافي
    '127.0.0.1%20-f',            // مسافة + علم
    '-n%205',                    // هدف يبدأ بشرطة
    '%24(whoami)',               // استبدال أمر
    '127.0.0.1%3Bid',            // فاصلة منقوطة
    '127.0.0.1%7Cid',            // أنبوب
    '127.0.0.1%26%26id',         // AND
    '127.0.0.1%60id%60',         // backtick
    '127.0.0.1%00',              // بايت صفري
    'a%22b',                     // اقتباس
    '%D8%B9%D8%B1%D8%A8%D9%8A',  // محارف عربية (غير ASCII)
    '1.2.3',                     // IP ناقص
    'host_name',                 // شرطة سفلية
    'x%5C..%5Cetc',              // شرطة مائلة عكسية
  ];
  for (const payload of payloads) {
    const res = await admin.get('/api/tools/ping?ip=' + payload);
    assert.equal(res.status, 400, `يجب رفض: ${payload} (حصلنا على ${res.status})`);
    const body = JSON.parse(await readText(res));
    assert.equal(body.success, false);
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
  }
});

test('T01: هدف عام (خارج النطاقات) مرفوض بـ 403 افتراضيًّا', async () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    const res = await admin.get('/api/tools/ping?ip=' + encodeURIComponent(ip));
    assert.equal(res.status, 403, ip);
    const body = JSON.parse(await readText(res));
    assert.match(body.error, /نطاقات/);
  }
});

test('T01: المدير ينفّذ ping حقيقيًا على هدف محلي ويستلم بثًّا كاملًا', { skip: skipReason }, async () => {
  const res = await admin.get('/api/tools/ping?ip=127.0.0.1');
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/event-stream/);
  const events = await collectSSE(res);
  assert.equal(events[0].event, 'start');
  assert.equal(events[events.length - 1].event, 'done');
  assert.ok(events.some((e) => e.event === 'line'), 'يجب أن يصل سطر واحد على الأقل من ping');
});

test('T01: اسم مضيف محلي يُحلّ إلى IP مسموح ثم يُنفَّذ عليه', { skip: skipReason }, async () => {
  const res = await admin.get('/api/tools/tracert?ip=localhost');
  assert.equal(res.status, 200);
  const events = await collectSSE(res, { timeoutMs: 40000 });
  assert.equal(events[0].event, 'start');
  assert.equal(events[events.length - 1].event, 'done');
});

test('T01: حدّ التكرار يمنع الطلبات المتلاحقة (429)', async () => {
  process.env.NM_TOOLS_RATE_PER_MIN = '3';
  try {
    const c = makeClient(srv.baseUrl);
    const l = await c.login('admin_t2', 'AdminPass123!');
    assert.equal(l.status, 200);
    for (let i = 0; i < 3; i++) {
      const r = await c.get('/api/tools/ping?ip=8.8.8.8');
      assert.equal(r.status, 403, `طلب ${i + 1} يجب أن يصل للسياسة (403)`);
    }
    const blocked = await c.get('/api/tools/ping?ip=8.8.8.8');
    assert.equal(blocked.status, 429);
    const body = JSON.parse(await readText(blocked));
    assert.match(body.error, /محاولات كثيرة/);
  } finally {
    process.env.NM_TOOLS_RATE_PER_MIN = '50';
  }
});

test('T01: NM_TOOLS_MIN_ROLE=viewer يسمح لحساب العرض (سلوك قابل للضبط)', { skip: skipReason }, async () => {
  process.env.NM_TOOLS_MIN_ROLE = 'viewer';
  try {
    const res = await viewer.get('/api/tools/ping?ip=127.0.0.1');
    assert.equal(res.status, 200);
    const events = await collectSSE(res);
    assert.equal(events[events.length - 1].event, 'done');
  } finally {
    delete process.env.NM_TOOLS_MIN_ROLE;
  }
});
