// اختبارات SEC-03 — الجلسات الدائمة، CSRF، الهيدرز الأمنية، سجل التدقيق، وبذرة الأدمن.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { setupTestEnv, startServer, seedUser, makeClient, readText } = require('./helpers/test-app');

const env = setupTestEnv();

let srv, db, admin;

test.before(async () => {
  srv = await startServer();
  db = srv.db;
  seedUser(db, 'admin_sec', 'AdminPass123!', 'admin');
  // دالة بدل نص: يظل العميل صالحًا بعد إعادة تشغيل الخادم (منفذ جديد) في اختبار الجلسات.
  admin = makeClient(() => srv.baseUrl);
  const r = await admin.login('admin_sec', 'AdminPass123!');
  assert.equal(r.status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('SEC-03: هيدرز أمنية أساسية على كل الاستجابات', async () => {
  const res = await fetch(srv.baseUrl + '/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(String(res.headers.get('content-security-policy')), /frame-ancestors 'self'/);
  assert.match(String(res.headers.get('referrer-policy')), /same-origin/);
});

test('SEC-03: CSRF — أصل خارجي/null مرفوض، الأصل المطابق وغياب الأصل مقبولان', async () => {
  const post = (headers) => fetch(srv.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ username: 'admin_sec', password: 'AdminPass123!' }),
  });

  const evil = await post({ origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.match(JSON.parse(await readText(evil)).error, /CSRF/);

  const nullOrigin = await post({ origin: 'null' });
  assert.equal(nullOrigin.status, 403);

  const sameOrigin = await post({ origin: srv.baseUrl });
  assert.equal(sameOrigin.status, 200, 'الأصل المطابق للمضيف يجب أن يمر');

  const noOrigin = await post({}); // أدوات CLI/تكامل داخلي
  assert.equal(noOrigin.status, 200, 'غياب Origin (غير متصفح) يجب أن يمر');
});

test('SEC-03: CSRF — يمكن إيقافه صراحةً بـ NM_CSRF_GUARD=0 (خيار تشغيلي موثّق)', async () => {
  process.env.NM_CSRF_GUARD = '0';
  let srv2;
  try {
    srv2 = await startServer();
    const res = await fetch(srv2.baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ username: 'admin_sec', password: 'AdminPass123!' }),
    });
    assert.equal(res.status, 200, 'مع الإيقاف الصريح يمر الطلب (ورغم ذلك يحتاج اعتمادات صحيحة)');
  } finally {
    delete process.env.NM_CSRF_GUARD;
    if (srv2) await srv2.close();
  }
});

test('SEC-03: الجلسة تبقى صالحة بعد إعادة تشغيل الخادم (مخزن SQLite)', async () => {
  const c = makeClient(srv.baseUrl);
  assert.equal((await c.login('admin_sec', 'AdminPass123!')).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
  const cookie = c.cookie;

  await srv.close();
  srv = await startServer(); // نفس ملف القاعدة ⇒ نفس مخزن الجلسات

  const me = await fetch(srv.baseUrl + '/api/auth/me', { headers: { cookie } });
  assert.equal(me.status, 200, 'الجلسة يجب أن تبقى بعد إعادة التشغيل (auth stable after reboot)');
  const body = await me.json();
  assert.equal(body.data.username, 'admin_sec');
});

test('SEC-03: سجل التدقيق يسجّل الدخول الفاشل/الناجح وتغيير الإعدادات — بلا أسرار', async () => {
  await fetch(srv.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin_sec', password: 'wrong-password-xyz' }),
  });
  await admin.put('/api/settings/public-display', { mode: 'minimal' });
  await admin.put('/api/settings/public-display', { mode: 'lan' });

  const events = db.prepare('SELECT event FROM audit_log ORDER BY id DESC LIMIT 50').all().map((r) => r.event);
  for (const expected of ['login_success', 'login_failed', 'settings_change']) {
    assert.ok(events.includes(expected), `يجب تسجيل الحدث ${expected}`);
  }
  const change = db.prepare("SELECT actor, target, details FROM audit_log WHERE event = 'settings_change' ORDER BY id DESC LIMIT 1").get();
  assert.equal(change.actor, 'admin_sec');
  assert.match(change.details, /lan/);
  assert.ok(!JSON.stringify(change).includes('password'), 'السجل يجب ألا يحوي أي كلمة مرور');

  // تنقية الأسرار في خدمة التدقيق
  const { scrub } = require('../src/services/audit.service');
  const s = scrub({ username: 'a', password: 'secret123', nested: { token: 'abc', keep: 'ok' }, deep: { x: { y: { z: 1 } } } });
  assert.equal(s.password, '[REDACTED]');
  assert.equal(s.nested.token, '[REDACTED]');
  assert.equal(s.nested.keep, 'ok');
  assert.equal(s.username, 'a');
});

test('SEC-03: seedAdmin — رفض كلمة ضعيفة في الإنتاج، وتوليد كلمة عشوائية تُعرض مرة واحدة', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-seed-'));
  const dbPath = path.join(dir, 'seed.db');
  const backendDir = path.resolve(__dirname, '..');
  const runSeed = (extraEnv) => spawnSync(process.execPath, ['src/seedAdmin.js'], {
    cwd: backendDir,
    env: { ...process.env, DB_PATH: dbPath, DEFAULT_ADMIN_USERNAME: 'admin', ...extraEnv },
    encoding: 'utf8',
  });

  try {
    // إنتاج + كلمة مرور افتراضية/ضعيفة ⇒ رفض (exit 1) وبلا إنشاء مستخدم
    const prod = runSeed({ NODE_ENV: 'production', DEFAULT_ADMIN_PASSWORD: 'ChangeMe123!' });
    assert.equal(prod.status, 1, 'يجب رفض الكلمة الضعيفة في الإنتاج');
    assert.match(prod.stderr, /رفض إنشاء حساب المدير/);
    const db1 = new Database(dbPath);
    assert.equal(db1.prepare('SELECT COUNT(*) AS c FROM users').get().c, 0);
    db1.close();

    // تطوير بلا كلمة مرور ⇒ كلمة عشوائية تُطبع مرة واحدة، والنص المُطبَع يطابق المخزَّن
    const dev = runSeed({ NODE_ENV: 'development', DEFAULT_ADMIN_PASSWORD: '' });
    assert.equal(dev.status, 0);
    assert.match(dev.stdout, /تُعرض مرة واحدة فقط/);
    const db2 = new Database(dbPath);
    const user = db2.prepare('SELECT username, password_hash, role FROM users').get();
    assert.equal(user.username, 'admin');
    assert.equal(user.role, 'admin');
    const m = dev.stdout.match(/احفظها الآن\): (\S+)/);
    assert.ok(m, 'يجب أن تُطبع كلمة المرور المولّدة مرة واحدة');
    assert.ok(bcrypt.compareSync(m[1], user.password_hash), 'كلمة المرور المطبوعة يجب أن تطابق المخزَّنة');
    db2.close();

    // إنتاج + كلمة قوية مقدَّمة ⇒ قبول وبلا طباعة كلمة المرور
    fs.rmSync(dbPath, { force: true });
    const prod2 = runSeed({ NODE_ENV: 'production', DEFAULT_ADMIN_PASSWORD: 'Highly-Secret-Pass-2026!' });
    assert.equal(prod2.status, 0);
    assert.match(prod2.stdout, /لم تُطبع هنا/);
    assert.ok(!prod2.stdout.includes('Highly-Secret-Pass-2026!'), 'كلمة المرور المقدَّمة يجب ألا تُطبع');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
