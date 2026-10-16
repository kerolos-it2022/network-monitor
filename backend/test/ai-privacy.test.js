// اختبارات AI-01/02 — خصوصية السياق وترتيب الأعطال والوضع المحلي بلا شبكة.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient, readText } = require('./helpers/test-app');

const env = setupTestEnv();

const ai = require('../src/services/ai.service');
const db = require('../src/db');

let srv, admin, viewer;

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_ai', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_ai', 'ViewerPass123!', 'viewer');
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_ai', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_ai', 'ViewerPass123!')).status, 200);

  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  const locId = db.prepare("INSERT INTO locations (name, kind) VALUES ('المكتب', 'site')").run().lastInsertRowid;
  const ins = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, location_id, check_protocol, is_active, current_status, host_status, overall_health)
     VALUES (?, ?, ?, ?, 'ping', 1, ?, ?, ?)`
  );
  // جهازان منقطعان + واحد متدهور + واحد سليم (للتحقق من الترتيب)
  ins.run('كاميرا المدخل', '192.168.88.31', typeId, locId, 'offline', 'offline', 'offline');
  ins.run('سويتش الدور', '192.168.88.2', typeId, locId, 'offline', 'offline', 'offline');
  const degradedId = ins.run('خادم Odoo', '192.168.88.20', typeId, locId, 'online', 'online', 'degraded').lastInsertRowid;
  ins.run('طابعة الاستقبال', '192.168.88.50', typeId, locId, 'online', 'online', 'online');
  db.prepare(
    `INSERT INTO monitored_services (device_id, name, kind, port, is_enabled, status) VALUES (?, 'Odoo ERP', 'tcp', 8069, 1, 'offline')`
  ).run(degradedId);
  db.prepare('INSERT INTO downtime_events (device_id, started_at) VALUES ((SELECT id FROM devices WHERE name = ?), ?)')
    .run('كاميرا المدخل', new Date(Date.now() - 3600e3).toISOString());
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('AI-01: ترتيب السياق واقعيّ (المتقطع ثم المتدهور) + عدّاد المُستبعَد + لقطة موقّتة', () => {
  const ctx = ai.buildNetworkContext();
  assert.equal(ctx.devices.length >= 4, true);
  const first = ctx.devices[0];
  assert.equal(first.current_status, 'offline', 'الواقع أولًا وليس الأبجدي');
  const degradedIdx = ctx.devices.findIndex((d) => d.overall_health === 'degraded');
  // ملاحظة: الجهاز المتدهور نفسه current_status = 'online' ⇒ نقارن بسليم غير متدهور.
  const healthyOnlineIdx = ctx.devices.findIndex((d) => d.current_status === 'online' && d.overall_health !== 'degraded');
  assert.ok(degradedIdx > -1 && healthyOnlineIdx > degradedIdx, 'المتدهور قبل السليم');
  assert.equal(typeof ctx.omitted_devices, 'number');
  assert.equal(ctx.omitted_devices, Math.max(0, ctx.counts.total - ctx.devices.length));
  assert.ok(ctx.snapshot_at && ctx.context_limit, 'لقطة موقّتة بحدود صريحة');
});

test('AI-02: التنقيح يستبدل IP/MAC برموز ثابتة ويحذف المفاتيح السرّية ويُبقي الأسماء', () => {
  const input = {
    devices: [{ name: 'خادم Odoo', ip: '192.168.88.20' }, { name: 'لابتوب', ip: '192.168.88.20' }],
    macs: ['aa:bb:cc:dd:ee:01'],
    api_key: 'sk-secret-value',
    webhook_url: 'https://example/hook',
    note: 'العنوان 10.0.0.7 لجهاز آخر',
  };
  const out = ai.redactContext(input, true);
  assert.equal(out.redacted, true);
  const text = JSON.stringify(out.data);
  assert.ok(!text.includes('192.168.88.20'), 'لا IP خام');
  assert.ok(!text.includes('10.0.0.7'), 'ولا داخل النصوص الحرة');
  assert.ok(!text.includes('aa:bb:cc:dd:ee:01'), 'لا MAC خام');
  assert.ok(!text.includes('sk-secret-value'), 'المفتاح السري محذوف');
  assert.equal(out.data.api_key, '[REDACTED]');
  assert.equal(out.data.webhook_url, '[REDACTED]');
  assert.equal(out.data.devices[0].ip, out.data.devices[1].ip, 'نفس العنوان ⇒ نفس الرمز (اتساق)');
  assert.equal(out.data.devices[0].name, 'خادم Odoo', 'الأسماء المعروضة تبقى (أساس التشخيص)');

  const offOut = ai.redactContext(input, false);
  assert.equal(offOut, input, 'عند إيقاف التنقيح يُعاد الكائن كما هو (قرار المالك الصريح)');
});

test('AI-02: التشخيص المحلي يذكر الأعطال بلا أي اتصال خارجي', () => {
  const ctx = ai.buildNetworkContext();
  const text = ai.deterministicDiagnosis(ctx);
  assert.match(text, /كاميرا المدخل|سويتش الدور/, 'يذكر أسماء الأجهزة المنقطعة');
  assert.match(text, /بقواعد محلية/, 'يوضّح أنه بلا إرسال خارجي');
  assert.match(text, /متقطع/, 'يحمل ملخص العدّادات');
});

test('AI-02: معاينة السياق تُبيّن ما سيُرسَل فعلًا (منقّح افتراضيًّا)', async () => {
  // المجهول يُرفض
  assert.equal((await viewer.get('/api/ai/context-preview')).status, 403, 'المعاينة للمدير فقط');
  const res = await admin.get('/api/ai/context-preview');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.redacted, true, 'التنقيح مفعّل افتراضيًّا');
  assert.ok(!body.data.preview.includes('192.168.88.20'), 'المعاينة لا تحوي IP خام');
  assert.ok(!body.data.preview.includes('192.168.88.31'));
  assert.ok(body.data.chars > 0);
  // والتدقيق سُجِّل
  const ev = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE event = 'ai_context_preview'").get().c;
  assert.equal(ev, 1);
});

test('AI-02: AI معطّل ⇒ /api/ai/chat يرد ببقواعد محلية (صفر شبكة) وليس خطأ', async () => {
  const res = await admin.post('/api/ai/chat', { message: 'إيه اللي واقع دلوقتي؟' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.mode, 'rules', 'وضع محلي بلا مزوّد');
  assert.match(body.reply, /بقواعد محلية/);
  assert.ok(body.context_stats && typeof body.context_stats.omitted_devices === 'number');
  assert.equal(body.context_stats.redacted, false, 'لم يُرسَل شيء إطلاقًا فالتنقيح غير ذي صلة');
});

test('AI-02: إعداد التنقيح يُقبل ويُحفظ ويظهر في قراءة الإعدادات', async () => {
  const put = await admin.put('/api/ai/settings', { redact_internal: 0 });
  assert.equal(put.status, 200);
  assert.equal((await put.json()).data.redact_internal, 0);
  const get = await admin.get('/api/ai/settings');
  assert.equal((await get.json()).data.redact_internal, 0);
  // إعادته للوضع الآمن الافتراضي (اختبار لا يغيّر سلوك المنتج النهائي)
  await admin.put('/api/ai/settings', { redact_internal: 1 });
  const preview = await admin.get('/api/ai/context-preview');
  assert.equal((await preview.json()).data.redacted, true);
});
