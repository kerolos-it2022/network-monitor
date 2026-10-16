// اختبارات AST-01/02/03 (T05) — الهوية الثابتة: asset_id دائم، عدة MACs، سجل IP بتواريخ،
// وممنوع الدمج التلقائي (تشابه IP لا يكفي) مع قائمة مراجعة يقرّرها المدير وتدقيق كامل.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient, readText } = require('./helpers/test-app');

const env = setupTestEnv();

const assets = require('../src/services/assets.service');
const db = require('../src/db');

let srv, admin, viewer, anon;

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_ast', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_ast', 'ViewerPass123!', 'viewer');
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  anon = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_ast', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_ast', 'ViewerPass123!')).status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

function newDevice(name, ip) {
  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  const id = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, check_protocol, is_active, current_status, host_status, overall_health)
     VALUES (?, ?, ?, 'ping', 1, 'unknown', 'unknown', 'unknown')`
  ).run(name, ip, typeId).lastInsertRowid;
  return id;
}

test('AST نقي: تطبيع MAC/تحقق IP/صيغة المعرّف', () => {
  assert.equal(assets.normalizeMac('AA-BB-CC-DD-EE-01'), 'aa:bb:cc:dd:ee:01');
  assert.equal(assets.normalizeMac('aabbccddee01'), 'aa:bb:cc:dd:ee:01');
  assert.equal(assets.normalizeMac('غير-صالح'), null);
  assert.equal(assets.normalizeMac(''), null);
  assert.equal(assets.isValidIpv4('192.168.88.20'), true);
  assert.equal(assets.isValidIpv4('192.168.88.256'), false);
  assert.equal(assets.isValidIpv4('192.168.088.1'), false, 'الأصفار البادئة مرفوضة');
  assert.equal(assets.isValidIpv4('not-an-ip'), false);
  assert.equal(assets.formatAssetId(123), 'NM-000123');
  assert.equal(assets.guessMacKind('00:50:56:aa:bb:cc'), 'virtual', 'بادئة VMware تُكتشف كواجهة وهمية');
});

test('AST-02 نقي: قرار الأدلة — MAC معروف يرافق جهازه، والاشتباه ⇒ مراجعة لا دمج', () => {
  const known = {
    byIp: new Map([
      ['10.0.0.5', [{ device_id: 1, valid_to: null }]],
      ['10.0.0.9', [{ device_id: 2, valid_to: '2026-01-01' }]],
    ]),
    byMac: new Map([
      ['aa:bb:cc:dd:ee:01', [{ device_id: 1, is_active: 1 }]],
      ['aa:bb:cc:dd:ee:02', [{ device_id: 2, is_active: 1 }]],
    ]),
  };
  // نفس الجهاز (MAC وIP متطابقان) ⇒ إرفاق بثقة عالية
  const attach = assets.decideEvidence({ ip: '10.0.0.5', mac: 'AA:BB:CC:DD:EE:01' }, known);
  assert.equal(attach.action, 'attach');
  assert.equal(attach.deviceId, 1);
  assert.ok(attach.confidence >= 90);

  // IP لجهاز 1 لكن الـ MAC لجهاز 2 ⇒ تعارض يستوجب المراجعة
  const review = assets.decideEvidence({ ip: '10.0.0.5', mac: 'AA:BB:CC:DD:EE:02' }, known);
  assert.equal(review.action, 'review');
  assert.equal(review.kind, 'suggested_merge');

  // عنوان تاريخي استُخدم لجهاز آخر سابقًا وما زال MAC القديم ⇒ مراجعة إعادة استخدام IP
  const reused = assets.decideEvidence({ ip: '10.0.0.9', mac: 'AA:BB:CC:DD:EE:02' }, known);
  assert.equal(['review', 'attach'].includes(reused.action), true);

  // مجهول تمامًا ⇒ أصل جديد
  assert.equal(assets.decideEvidence({ ip: '10.0.0.77', mac: 'aa:bb:cc:dd:ee:99' }, known).action, 'new');
});

test('AST-01: منح asset_id فريدًا لكل جهاز (idempotent) وعدم إعادة استخدامه بعد الحذف', () => {
  const d1 = newDevice('أصل 1', '10.10.0.1');
  const d2 = newDevice('أصل 2', '10.10.0.2');
  const first = assets.ensureAssetIds();
  assert.ok(first.assigned >= 2);
  assert.ok(first.ipSeeded >= 2, 'سجل IP ابتدائي لكل جهاز');
  const a1 = db.prepare('SELECT asset_id FROM devices WHERE id = ?').get(d1).asset_id;
  const a2 = db.prepare('SELECT asset_id FROM devices WHERE id = ?').get(d2).asset_id;
  assert.match(a1, /^NM-\d{6}$/);
  assert.notEqual(a1, a2, 'معرّفات فريدة');

  const second = assets.ensureAssetIds();
  assert.equal(second.assigned, 0, 'إعادة التشغيل لا تمنح معرّفات جديدة');
  assert.equal(db.prepare('SELECT asset_id FROM devices WHERE id = ?').get(d1).asset_id, a1);

  // حذف جهاز ثم إضافة جهاز جديد ⇒ معرّف جديد لم يُستخدم سابقًا
  db.prepare('DELETE FROM devices WHERE id = ?').run(d2);
  const d3 = newDevice('أصل 3', '10.10.0.3');
  const a3 = assets.ensureAssetIds() && db.prepare('SELECT asset_id FROM devices WHERE id = ?').get(d3).asset_id;
  assert.notEqual(a3, a2, 'لا يُعاد استخدام المعرّف المحذوف');
  assert.match(a3, /^NM-\d{6}$/);
});

test('AST-01: تغيّر الـ IP يبقى على نفس الأصل + سجل زمني (إغلاق/فتح)', () => {
  const dev = newDevice('جهاز متنقّل', '10.20.0.10');
  assets.assignAssetId(dev);
  assets.recordIp(dev, '10.20.0.10', { source: 'manual', confidence: 100 });

  // تغيّر العنوان (DHCP مثلًا)
  const changed = assets.recordIp(dev, '10.21.0.44', { source: 'dhcp', confidence: 70 });
  assert.equal(changed.ok, true);
  assert.equal(changed.changed, true);
  assert.equal(changed.previousIp, '10.20.0.10');

  const hist = assets.getIpTimeline(dev);
  assert.equal(hist.length, 2);
  const oldRow = hist.find((h) => h.ip === '10.20.0.10');
  const newRow = hist.find((h) => h.ip === '10.21.0.44');
  assert.ok(oldRow.valid_to, 'الفترة القديمة أُغلقت بتاريخ');
  assert.equal(newRow.valid_to, null, 'العنوان الجديد هو الحالي');
  assert.equal(db.prepare('SELECT asset_id FROM devices WHERE id = ?').get(dev).asset_id, db.prepare('SELECT asset_id FROM devices WHERE id = ?').get(dev).asset_id, 'نفس الأصل (لا جهاز جديد)');
});

test('AST-01/02: جهاز بكارتَي شبكة = أصل واحد مع الاحتفاظ بالمُعطّلة تاريخيًّا', () => {
  const dev = newDevice('لابتوب', '10.30.0.5');
  const r1 = assets.addInterface(dev, 'AA:BB:CC:DD:EE:01', { kind: 'ethernet', source: 'scan' });
  const r2 = assets.addInterface(dev, 'AA:BB:CC:DD:EE:02', { kind: 'wifi', source: 'scan' });
  assert.equal(r1.ok && r2.ok, true);
  const list = assets.listInterfaces(dev);
  assert.equal(list.length, 2, 'واجهتان مسجَّلتان على نفس الجهاز (أصل واحد)');

  // إيقاف الواجهة لا يحذف السجل
  const off = assets.deactivateInterface(dev, r2.id);
  assert.equal(off.ok, true);
  const after = assets.listInterfaces(dev);
  assert.equal(after.length, 2, 'السجل التاريخي محفوظ');
  assert.equal(after.find((i) => i.id === r2.id).is_active, 0, 'الواجهة أُوقفت ولم تُحذف');

  // إضافة نفس الـ MAC لاحقًا تُعيد تنشيطه بلا صف جديد
  const again = assets.addInterface(dev, 'aa:bb:cc:dd:ee:02', { source: 'manual' });
  assert.equal(again.reactivated, true);
  assert.equal(assets.listInterfaces(dev).length, 2);
});

test('AST-02: إعادة استخدام عنوان لا تدمج الأصول تلقائيًّا — بل تفتح مراجعة', () => {
  const a = newDevice('قديم', '10.40.0.7');
  assets.assignAssetId(a);
  assets.recordIp(a, '10.40.0.7', { source: 'manual' });
  // الجهاز القديم أُوقف وأُغلق عنوانه (محاكاة DHCP)
  db.prepare("UPDATE devices SET is_active = 0 WHERE id = ?").run(a);
  db.prepare("UPDATE device_ip_history SET valid_to = ? WHERE device_id = ? AND valid_to IS NULL").run(new Date().toISOString(), a);

  const b = newDevice('جديد', '10.40.0.7');   // نفس العنوان لجهاز آخر (مسموح — لا قيد فريد على IP)
  assets.assignAssetId(b);
  assets.recordIp(b, '10.40.0.7', { source: 'scan', confidence: 60 });
  assets.addInterface(b, 'DE:AD:BE:EF:00:01', { source: 'scan' });

  // محاولة ربط رصد بنفس العنوان لكن MAC مختلف تمامًا
  const obs = assets.observeDiscovery({ ip: '10.40.0.7', mac: 'DE:AD:BE:EF:00:01', source: 'scan' });
  assert.notEqual(obs.action, 'review', 'نفس الجهاز الحالي ⇒ إرفاق طبيعي');
  assert.equal(obs.deviceId, b);

  // MAC جديد مجهول على عنوان يملكه الجهاز الجديد حاليًّا ⇒ إرفاق بثقة منخفضة بالمُلاك الحالي،
  // و**لا يُنسب للجهاز القديم إطلاقًا** (لا دمج اعتمادًا على عنوان أُعيد استخدامه).
  const obs2 = assets.observeDiscovery({ ip: '10.40.0.7', mac: 'AA:AA:AA:AA:AA:AA', source: 'scan' });
  assert.notEqual(obs2.deviceId, a, 'لا يُنسب للجهاز القديم (المالك التاريخي للعنوان)');
  assert.equal(obs2.deviceId, b, 'يُرفق بمالك العنوان الحالي');
  assert.ok(obs2.confidence <= 60, 'ثقة منخفضة لأن دليل MAC غير معروف');
  assert.equal(obs2.action, 'attach');
});

test('AST-03: قرار المدير على تعارض (approve) يرفق الدليل ويُدقَّق — بلا حذف أي سجل', () => {
  // جهازان: الأول يملك عنوانًا مفتوحًا، والثاني يملك MAC معروفًا ⇒ تعارض اقتراح دمج
  const s = newDevice('جهاز الإنتاج', '10.50.0.10');
  assets.assignAssetId(s);
  assets.recordIp(s, '10.50.0.10', { source: 'manual' });
  const o = newDevice('جهاز قديم', '10.50.0.99');
  assets.assignAssetId(o);
  assets.addInterface(o, 'AA:BB:CC:11:22:33', { source: 'scan' });

  const obs = assets.observeDiscovery({ ip: '10.50.0.10', mac: 'AA:BB:CC:11:22:33', source: 'scan' });
  assert.equal(obs.action, 'review');
  assert.equal(obs.kind, 'suggested_merge');
  assert.ok(obs.conflictId, 'تعارض مفتوح في قائمة المراجعة');

  const before = db.prepare('SELECT COUNT(*) AS c FROM devices').get().c;
  const resolved = assets.resolveConflict(obs.conflictId, 'approve', { actor: 'admin_ast', note: 'دليل MAC مؤكَّد ميدانيًّا' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.status, 'approved');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM devices').get().c, before, 'لا حذف أي جهاز');

  // الدليل **المذكور في التعارض فقط** يُرفق بالجهاز المعني (لا نسخ كل واجهات الطرف الآخر)
  const sInterfaces = assets.listInterfaces(s).map((i) => i.mac);
  const oInterfaces = assets.listInterfaces(o).map((i) => i.mac);
  assert.ok(sInterfaces.includes('aa:bb:cc:11:22:33'), 'دليل MAC أُرفق بالجهاز المعني');
  assert.equal(sInterfaces.length, 1, 'لا تُنسخ واجهات أخرى غير الدليل');
  assert.ok(oInterfaces.includes('aa:bb:cc:11:22:33'), 'وسجل الجهاز القديم محفوظ كما هو (بلا حذف)');

  const conflicts = assets.listConflicts({ status: 'all' });
  const row = conflicts.find((c) => c.id === obs.conflictId);
  assert.equal(row.status, 'approved');
  assert.equal(row.resolved_by, 'admin_ast');
});

test('AST-03: واجهة الأصول عبر HTTP — الصلاحيات، التفاصيل، والتدقيق', async () => {
  const dev = newDevice('أصل واجهة', '10.60.0.20');
  const assetId = assets.assignAssetId(dev);
  assets.recordIp(dev, '10.60.0.20', { source: 'manual' });

  // المجهول يُرفض
  assert.equal((await anon.get('/api/assets')).status, 401);
  assert.equal((await anon.get('/api/assets/' + assetId)).status, 401);

  // حساب العرض يقرأ ولا يكتب
  const vGet = await viewer.get('/api/assets');
  assert.equal(vGet.status, 200);
  const vDetail = await viewer.get('/api/assets/' + assetId);
  assert.equal(vDetail.status, 200);
  const vPost = await viewer.post('/api/assets/' + assetId + '/interfaces', { mac: 'AA:BB:CC:00:00:09' });
  assert.equal(vPost.status, 403, 'viewer لا يعدّل الأصول');

  // المدير يضيف واجهة (ثقة 80) ويقرأ التفاصيل
  const add = await admin.post('/api/assets/' + assetId + '/interfaces', { mac: 'AA-BB-CC-00-00-09', kind: 'ethernet', notes: 'ملصق على الجهاز' });
  assert.equal(add.status, 201);
  const addBody = await add.json();
  assert.equal(addBody.data.id > 0, true);

  const detailRes = await admin.get('/api/assets/' + assetId);
  const detail = (await detailRes.json()).data;
  assert.equal(detail.asset_id, assetId);
  assert.ok(detail.interfaces.some((i) => i.mac === 'aa:bb:cc:00:00:09'));
  assert.ok(detail.ip_history.some((h) => h.ip === '10.60.0.20' && h.valid_to == null));

  // تسجيل عنوان يدويًّا + الإيقاف اللاحق (بلا حذف)
  const ipPost = await admin.post('/api/assets/' + assetId + '/ip', { ip: '10.60.0.21', source: 'manual', confidence: 90 });
  assert.equal(ipPost.status, 201);
  const afterIp = (await (await admin.get('/api/assets/' + assetId)).json()).data;
  assert.equal(afterIp.ip_history.filter((h) => h.valid_to == null).length, 1, 'عنوان حالي واحد فقط');

  const ifaceId = detail.interfaces.find((i) => i.mac === 'aa:bb:cc:00:00:09').id;
  const off = await admin.post(`/api/assets/${assetId}/interfaces/${ifaceId}/deactivate`);
  assert.equal(off.status, 200);

  // MAC غير صالح ⇒ 400 برسالة عربية
  const bad = await admin.post('/api/assets/' + assetId + '/interfaces', { mac: 'zz:zz' });
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(await readText(bad)).error, /MAC/);

  // التدقيق
  const events = db.prepare("SELECT event FROM audit_log WHERE event LIKE 'asset_%' ORDER BY id").all().map((r) => r.event);
  assert.ok(events.includes('asset_interface_added'));
  assert.ok(events.includes('asset_ip_recorded'));
  assert.ok(events.includes('asset_interface_deactivated'));
});
