// اختبارات RCA-01/02 (T07) — تجميع عطل الجهاز الأعلى مع أبنائه: إشعار واحد للمجموعة،
// مع الاحتفاظ بانقطاع كل جهاز، وإطلاق الابن المتبقي مستقلًّا بعد عودة الأب.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient } = require('./helpers/test-app');

const env = setupTestEnv();

const incidents = require('../src/services/incidents.service');
const db = require('../src/db');

let srv, admin, anon;
let root, child;
const children = [];

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_rca', 'AdminPass123!', 'admin');
  admin = makeClient(srv.baseUrl);
  anon = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_rca', 'AdminPass123!')).status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

function addDevice(name, ip, parentId, status) {
  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  return db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, parent_id, check_protocol, is_active, current_status, host_status, overall_health, check_interval_seconds, failure_threshold)
     VALUES (?, ?, ?, ?, 'ping', 1, ?, ?, ?, 60, 2)`
  ).run(name, ip, typeId, parentId, status, status, status).lastInsertRowid;
}

function openDowntime(deviceId, startedAtMs) {
  db.prepare('INSERT INTO downtime_events (device_id, started_at) VALUES (?, ?)')
    .run(deviceId, new Date(startedAtMs).toISOString());
}

test('RCA نقي: سلسلة الأسلاف واختيار الجذر بالثقة الزمنية', () => {
  const byId = new Map([
    [1, { id: 1, name: 'root', parent_id: null }],
    [2, { id: 2, name: 'mid', parent_id: 1 }],
    [3, { id: 3, name: 'leaf', parent_id: 2 }],
    [4, { id: 4, name: 'cycleA', parent_id: 5 }],
    [5, { id: 5, name: 'cycleB', parent_id: 4 }],
  ]);
  assert.deepEqual(incidents.ancestorChain(3, byId).map((d) => d.id), [2, 1]);
  assert.deepEqual(incidents.ancestorChain(1, byId), []);
  assert.deepEqual(incidents.ancestorChain(4, byId).map((d) => d.id), [5], 'الحلقات لا تُسبب دورانًا لا نهائيًّا');

  const now = 1_000_000;
  const hostStatus = new Map([[1, 'offline'], [2, 'offline'], [3, 'offline']]);
  const since = new Map([[1, now - 30_000], [2, now - 20_000], [3, now - 5_000]]);
  const ancestors = [{ id: 2, name: 'mid' }, { id: 1, name: 'root' }];
  const cand = incidents.pickRootCandidate({ deviceId: 3, ancestors, hostStatusById: hostStatus, offlineSinceById: since, windowMs: 120_000 });
  assert.equal(cand.rootId, 2, 'الأقرب المنقطع أولًا');
  assert.equal(cand.confidence, 'high', 'الأب سبق الابن داخل النافذة ⇒ ثقة عالية');

  // سلف غير منقطع ⇒ لا سببية
  const hostStatus2 = new Map([[2, 'online'], [1, 'online']]);
  assert.equal(incidents.pickRootCandidate({ deviceId: 3, ancestors, hostStatusById: hostStatus2, offlineSinceById: since, windowMs: 120_000 }), null);
});

test('T07: عطل السويتش + 15 ابنًا ⇒ عطل مركزي واحد بقائمة 15 متأثرًا، وكل الانقطاعات محفوظة', () => {
  root = addDevice('السويتش الرئيسي', '192.168.88.2', null, 'offline');
  const now = Date.now();
  openDowntime(root, now - 60_000);

  // أولًا: انقطاع الجذر نفسه ⇒ إشعار عادي (غير مكتوم) + عطل خاص به
  const rootRes = incidents.handleDeviceDown({ id: root, name: 'السويتش الرئيسي' }, { nowMs: now - 55_000 });
  assert.equal(rootRes.suppressed, false, 'الجذر لا والد له ⇒ إشعاره يمر طبيعيًّا');

  // 15 ابنًا ينقطعون بعده
  for (let i = 0; i < 15; i++) {
    const id = addDevice('جهاز ' + (i + 1), '192.168.88.' + (10 + i), root, 'offline');
    children.push(id);
    openDowntime(id, now - 40_000 + i * 500);
    const res = incidents.handleDeviceDown({ id, name: 'جهاز ' + (i + 1) }, { nowMs: now });
    assert.equal(res.suppressed, true, `الابن ${i + 1} يجب أن يُكتَم إشعاره (عطل مركزي)`);
    assert.equal(res.grouped, true);
  }

  const inc = db.prepare("SELECT * FROM incidents WHERE root_device_id = ? AND status = 'open'").get(root);
  assert.ok(inc, 'يجب وجود عطل مفتوح للجذر');
  assert.equal(inc.kind, 'root_cause');
  const affected = JSON.parse(inc.affected_json || '[]');
  assert.equal(affected.length, 15, 'قائمة المتأثرين تحوي 15 جهازًا');
  assert.equal(affected.filter((a) => a.device_id === children[0]).length, 1, 'لا تكرار في القائمة');

  // كل الانقطاعات (16) محفوظة في downtime_events رغم كتم الإشعارات
  const openEvents = db.prepare('SELECT COUNT(*) AS c FROM downtime_events WHERE ended_at IS NULL').get().c;
  assert.equal(openEvents, 16, 'انقطاعات الأبناء تبقى مسجّلة كاملة');

  // ولا يوجد «عطل مستقل» لأي ابن مكتوم (كلهم داخل العطل المركزي)
  const childSingles = db.prepare(
    "SELECT COUNT(*) AS c FROM incidents WHERE kind = 'single' AND root_device_id IN (" + children.join(',') + ")"
  ).get().c;
  assert.equal(childSingles, 0, 'لا تُفتح أعطال مستقلة لأبناء مكتومين');
});

test('T07: جهاز بلا علاقة طوبولوجية يسقط أثناء العطل ⇒ لا يُكتَم إطلاقًا', () => {
  const now = Date.now();
  const unrelated = addDevice('طابعة بعيدة', '192.168.99.50', null, 'offline');
  openDowntime(unrelated, now);
  const res = incidents.handleDeviceDown({ id: unrelated, name: 'طابعة بعيدة' }, { nowMs: now });
  assert.equal(res.suppressed, false, 'لا علاقة ⇒ لا ادّعاء سببية ولا كتم');
  assert.equal(res.incidentId != null, true, 'لكنه يحصل على عطل مستقل خاص به');
});

test('T07: عودة الأب مع بقاء ابن واحد منقطعًا ⇒ تنبيه مستقل + عطل خاص، والباقي يُغلق', () => {
  const now = Date.now();
  // الأب + 14 ابنًا عادوا، وابن واحد ما زال منقطعًا
  db.prepare("UPDATE devices SET host_status='online', current_status='online' WHERE id = ?").run(root);
  for (const id of children) db.prepare("UPDATE devices SET host_status='online', current_status='online' WHERE id = ?").run(id);
  const survivor = children[children.length - 1];
  db.prepare("UPDATE devices SET host_status='offline', current_status='offline' WHERE id = ?").run(survivor);
  for (const id of children) {
    if (id === survivor) continue;
    db.prepare("UPDATE downtime_events SET ended_at = ? WHERE device_id = ? AND ended_at IS NULL").run(new Date(now).toISOString(), id);
  }
  db.prepare("UPDATE downtime_events SET ended_at = ? WHERE device_id = ? AND ended_at IS NULL").run(new Date(now).toISOString(), root);

  const notified = [];
  const res = incidents.handleDeviceRecovered({ id: root, name: 'السويتش الرئيسي' }, {
    nowMs: now,
    notifyIndependent: (child, inc) => notified.push({ deviceId: child.id, incidentId: inc.id }),
  });

  assert.equal(res.closedIncidents.length >= 1, true, 'عطل الجذر أُغلق');
  assert.equal(res.reopened.length, 1, 'ابن واحد فقط أُعيد إطلاقه');
  assert.equal(res.reopened[0].device_id, survivor);
  assert.deepEqual(notified.map((n) => n.deviceId), [survivor], 'تنبيه مستقل واحد للابن المتبقي');

  const keptIncident = db.prepare("SELECT * FROM incidents WHERE root_device_id = ? AND status = 'open'").get(survivor);
  assert.ok(keptIncident, 'عطل الابن المتبقي مفتوح ومستقل');
  const closedRoot = db.prepare("SELECT status FROM incidents WHERE root_device_id = ? ORDER BY id DESC LIMIT 1").get(root);
  assert.equal(closedRoot.status, 'closed', 'عطل الجذر مغلق');
});

test('T07: الحالة محفوظة في القاعدة (لا تكرار عند إعادة المعالجة بعد إعادة تشغيل)', () => {
  // سيناريو «عطل جارٍ»: الجذر منقطع بعطل مفتوح ⇒ معالجة انقطاع ابن مرتين (إعادة تشغيل محاكاة).
  db.prepare("UPDATE devices SET host_status='offline', current_status='offline' WHERE id = ?").run(root);
  const first = incidents.handleDeviceDown({ id: children[1], name: 'جهاز 2' }, { nowMs: Date.now() });
  assert.equal(first.suppressed, true, 'ابن لجذر منقطع ⇒ إشعاره مكتوم');
  const countAfterFirst = db.prepare('SELECT COUNT(*) AS c FROM incidents').get().c;
  const affectedFirst = JSON.parse(db.prepare('SELECT affected_json FROM incidents WHERE id = ?').get(first.incidentId).affected_json);

  const second = incidents.handleDeviceDown({ id: children[1], name: 'جهاز 2' }, { nowMs: Date.now() });
  const countAfterSecond = db.prepare('SELECT COUNT(*) AS c FROM incidents').get().c;
  const affectedSecond = JSON.parse(db.prepare('SELECT affected_json FROM incidents WHERE id = ?').get(second.incidentId).affected_json);

  assert.equal(countAfterSecond, countAfterFirst, 'لا صفوف جديدة عند إعادة المعالجة');
  assert.equal(affectedSecond.length, affectedFirst.length, 'لا تكرار في قائمة المتأثرين');
  assert.equal(second.incidentId, first.incidentId, 'نفس العطل المركزي (الحالة في القاعدة لا في الذاكرة)');
});

test('RCA: واجهة /api/incidents محميّة وتُعيد الجذر والمتأثرين', async () => {
  assert.equal((await anon.get('/api/incidents')).status, 401);
  const res = await admin.get('/api/incidents?status=all&limit=20');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data) && body.data.length >= 2);
  // قد توجد عدة أعطال مركزية (اختبار إعادة المعالجة أنشأ واحدًا أصغر) ⇒ نتحقق من الأكبر
  const grouped = body.data.filter((i) => i.kind === 'root_cause').sort((a, b) => b.affected_count - a.affected_count)[0];
  assert.ok(grouped, 'يجب أن يظهر العطل المركزي');
  assert.equal(grouped.root_device_id, root);
  assert.ok(grouped.root_name, 'اسم الجذر مضمّن');
  assert.ok(grouped.affected_count >= 15, `قائمة المتأثرين تحوي 15 على الأقل (كان ${grouped.affected_count})`);
  assert.equal(typeof body.window_ms, 'number');
});
