// اختبارات SNMP-01/02 — قراءة فقط، معطّلة افتراضيًّا، ومعالجة صحيحة لالتفاف/تصفير العدّادات.
// لا جهاز حقيقي: جلسة SNMP تُحقَن بالكامل (sessionFactory).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient, readText } = require('./helpers/test-app');

const env = setupTestEnv();

const snmp = require('../src/services/integrations/snmp.service');
const db = require('../src/db');

let srv, admin, viewer;
let deviceId;

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_snmp', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_snmp', 'ViewerPass123!', 'viewer');
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_snmp', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_snmp', 'ViewerPass123!')).status, 200);
  const typeId = db.prepare('SELECT id FROM device_types LIMIT 1').get().id;
  deviceId = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, check_protocol, is_active, current_status, host_status, overall_health)
     VALUES ('سويتش SNMP', '192.168.88.2', ?, 'ping', 1, 'online', 'online', 'online')`
  ).run(typeId).lastInsertRowid;
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

// ── الدوال النقية ──
test('SNMP: حساب المعدّل الطبيعي والالتفاف (32/64-bit) بلا سبايكات سالبة', () => {
  // طبيعي: 1,000,000 بايت خلال 10 ثوانٍ = 800 kbps
  assert.equal(snmp.computeRate({ prev: 0, curr: 1_000_000, elapsedMs: 10_000, bits: 32 }), 800_000);

  // التفاف 32-bit: قبل الالتفاف 4,294,967,290 وبعده 100 ⇒ الفرق 106 بايت فقط
  const wrapped = snmp.computeRate({ prev: 4_294_967_290, curr: 100, elapsedMs: 1000, bits: 32 });
  assert.equal(wrapped, 106 * 8, 'يُحتسب الفرق داخل سعة العدّاد بلا قفزة ضخمة');

  // تصفير/إعادة تشغيل للعدّاد: هبوط كبير لا يُفسَّر بالتفاف ⇒ لا معدّل مُختلَق
  assert.equal(snmp.computeRate({ prev: 1_000_000_000, curr: 5, elapsedMs: 1000, bits: 32 }), null, 'لا سبايك بعد التصفير');

  // 64-bit طبيعي والسالب مستحيل
  // 1,000,000 بايت خلال 5 ثوانٍ = 8,000,000 بت ÷ 5 = 1,600,000 بت/ث
  const big = snmp.computeRate({ prev: '10000000000', curr: '10001000000', elapsedMs: 5000, bits: 64 });
  assert.equal(big, 1_600_000);
  assert.ok(big >= 0);

  // حالات غير صالحة ⇒ null (لا صفر مضلِّل)
  assert.equal(snmp.computeRate({ prev: null, curr: 100, elapsedMs: 1000 }), null);
  assert.equal(snmp.computeRate({ prev: 100, curr: 200, elapsedMs: 0 }), null);
  assert.equal(snmp.computeRate({ prev: -5, curr: 10, elapsedMs: 1000 }), null);
  assert.equal(snmp.computeRate({ prev: 10, curr: 10, elapsedMs: 1000 }), 0, 'ثبات ⇒ صفر حقيقي');
});

test('SNMP: ترجمة حالة الواجهة وفهرس OID وعرض المعدّل', () => {
  assert.equal(snmp.parseOperStatus(1), 'up');
  assert.equal(snmp.parseOperStatus(2), 'down');
  assert.equal(snmp.parseOperStatus(99), 'unknown');
  assert.equal(snmp.oidKeyToIndex('1.3.6.1.2.1.2.2.1.8.42'), 42);
  assert.equal(snmp.formatBps(null), '—');
  assert.equal(snmp.formatBps(900), '900 bps');
  assert.equal(snmp.formatBps(1_500_000), '1.5 Mbps');
});

test('SNMP: معطّل افتراضيًّا — لا سياسة ولا أهداف ولا محاولة اتصال', async () => {
  const s = snmp.getSettings();
  assert.equal(!!s.enabled, false, 'SNMP معطّل افتراضيًّا');
  // هدف غير مفعّل ⇒ غير جاهز حتى لو كانت الإعدادات كاملة
  assert.equal(snmp.isTargetReady({ enabled: 1, version: '3', security_name: 'u', auth_key: 'a', priv_key: 'p' }), false);

  let sessions = 0;
  const spyFactory = () => { sessions += 1; throw new Error('لا يجب إنشاء جلسة'); };
  const r = await snmp.pollDevice(deviceId, { sessionFactory: spyFactory });
  assert.equal(r.ok, false);
  assert.equal(sessions, 0, 'صفر محاولات اتصال عندما يكون SNMP معطّلًا');
});

test('SNMP: التفعيل + هدف v3 كامل ⇒ قراءة واجهات ومعدّلات من جلسة محقونة', async () => {
  db.prepare('UPDATE snmp_settings SET enabled = 1 WHERE id = 1').run();
  const saved = snmp.upsertTarget(deviceId, {
    version: '3', security_name: 'monitor', auth_protocol: 'sha', auth_key: 'authsecret',
    priv_protocol: 'aes', priv_key: 'privsecret', enabled: 1,
  });
  assert.equal(saved.ok, true);
  // الأسرار لا تُعاد أبدًا
  const masked = JSON.stringify(saved.target);
  assert.ok(!masked.includes('authsecret') && !masked.includes('privsecret'), 'الأسرار مقنّعة في الاستجابة');
  assert.equal(saved.target.auth_key_set, true);

  const sessions = [];
  const fakeFactory = (opts) => {
    sessions.push(opts);
    return {
      get({ oids }, cb) {
        const vb = (oid, value) => ({ oid, value });
        cb(null, [
          vb(snmp.OIDS.ifName + '.1', 'ether1'),
          vb(snmp.OIDS.ifName + '.2', 'wlan1'),
          vb(snmp.OIDS.ifOperStatus + '.1', 1),
          vb(snmp.OIDS.ifOperStatus + '.2', 2),
          vb(snmp.OIDS.ifHighSpeed + '.1', 1000),           // 1000 Mbps
          vb(snmp.OIDS.ifHCInOctets + '.1', '1000000000'),
          vb(snmp.OIDS.ifHCOutOctets + '.1', '500000000'),
          vb(snmp.OIDS.ifInErrors + '.1', '3'),
        ]);
      },
      close() { /* noop */ },
    };
  };

  const first = await snmp.pollDevice(deviceId, { sessionFactory: fakeFactory, nowMs: Date.now() });
  assert.equal(first.ok, true);
  assert.equal(first.interfaces, 2);
  assert.equal(sessions[0].host, '192.168.88.2');
  assert.equal(sessions[0].version, '3');
  assert.equal(sessions[0].authKey, 'authsecret', 'المفتاح يُمرَّر للجلسة فقط (قراءة)');

  let ifaces = snmp.listInterfaces(deviceId);
  const ether = ifaces.find((i) => i.if_name === 'ether1');
  const wlan = ifaces.find((i) => i.if_name === 'wlan1');
  assert.equal(ether.oper_status_text, 'up');
  assert.equal(wlan.oper_status_text, 'down');
  assert.equal(ether.speed_bps, 1000 * 1e6);
  assert.equal(ether.in_rate_bps, null, 'أول قراءة بلا معدّل (لا قراءة سابقة)');
  assert.equal(ether.in_errors, '3');
  assert.equal(ether.poe_supported, false, 'PoE يُعلَن غير مدعوم بصدق');

  // قراءة ثانية بعد 10 ثوانٍ مع زيادة 100MB ⇒ معدّل محسوب
  const t1 = new Date(snmp.listInterfaces(deviceId)[0].polled_at).getTime();
  const fake2 = (opts) => ({
    get({ oids }, cb) {
      cb(null, [
        { oid: snmp.OIDS.ifName + '.1', value: 'ether1' },
        { oid: snmp.OIDS.ifOperStatus + '.1', value: 1 },
        { oid: snmp.OIDS.ifHCOutOctets + '.1', value: '500000000' },
        { oid: snmp.OIDS.ifHCInOctets + '.1', value: '1100000000' },   // +100MB
      ]);
    },
    close() {},
  });
  const second = await snmp.pollDevice(deviceId, { sessionFactory: fake2, nowMs: t1 + 10_000 });
  assert.equal(second.ok, true);
  ifaces = snmp.listInterfaces(deviceId);
  const ether2 = ifaces.find((i) => i.if_name === 'ether1');
  assert.equal(ether2.in_rate_bps, 80_000_000, '100MB/10s = 80 Mbps');
  assert.equal(ether2.out_rate_bps, 0, 'العدّاد ثابت ⇒ 0 لا null');

  db.prepare('UPDATE snmp_settings SET enabled = 0 WHERE id = 1').run();  // إعادة الوضع الآمن
  snmp.removeTarget(deviceId);
});

test('SNMP: v2c يحتاج تفعيلًا صريحًا (رسائله غير مشفّرة)', () => {
  db.prepare('UPDATE snmp_settings SET enabled = 1, allow_v2c = 0 WHERE id = 1').run();
  const denied = snmp.upsertTarget(deviceId, { version: '2c', community: 'public', enabled: 1 });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /v2c/);

  db.prepare('UPDATE snmp_settings SET allow_v2c = 1 WHERE id = 1').run();
  const allowed = snmp.upsertTarget(deviceId, { version: '2c', community: 'public', enabled: 1 });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.target.community_set, true);
  assert.ok(!JSON.stringify(allowed.target).includes('public'), 'المجتمع (community) لا يُعاد أبدًا');

  db.prepare('UPDATE snmp_settings SET enabled = 0, allow_v2c = 0 WHERE id = 1').run();
  snmp.removeTarget(deviceId);
});

test('SNMP: واجهات الإدارة محميّة والتفعيل مُدقَّق', async () => {
  assert.equal((await admin.get('/api/integrations/capabilities')).status, 200);
  assert.equal((await viewer.get('/api/integrations/snmp/targets')).status, 403, 'الأهداف للمدير فقط');

  const cap = await (await admin.get('/api/integrations/capabilities')).json();
  assert.equal(cap.data.snmp.available, true);
  assert.equal(cap.data.snmp.enabled, false, 'معطّل افتراضيًّا');
  assert.equal(cap.data.sophos.available, false, 'لا ندّعي دعمًا لم يُتحقق منه');

  const put = await admin.put('/api/integrations/snmp/settings', { enabled: 1, interval_seconds: 120 });
  assert.equal(put.status, 200);
  assert.equal((await put.json()).data.enabled, true);

  const target = await admin.put(`/api/integrations/snmp/targets/${deviceId}`, {
    version: '3', security_name: 'm', auth_key: 'aaaa', priv_key: 'bbbb', enabled: 1,
  });
  assert.equal(target.status, 200);
  const tbody = await target.json();
  assert.equal(tbody.data.auth_key_set, true);
  assert.ok(!JSON.stringify(tbody).includes('aaaa'));

  // استطلاع بلا جهاز حقيقي ⇒ فشل آمن 502 (بلا رمي ولا تعطيل المحرك)
  const poll = await admin.post(`/api/integrations/snmp/poll/${deviceId}`);
  assert.equal([502, 200].includes(poll.status), true);
  if (poll.status === 502) {
    const pollBody = JSON.parse(await readText(poll));
    assert.equal(typeof pollBody.error === 'string' && pollBody.error.length > 0, true, 'رسالة فشل واضحة بلا رمي');
  }

  // التدقيق
  const events = db.prepare("SELECT event FROM audit_log WHERE event LIKE 'snmp_%' ORDER BY id").all().map((r) => r.event);
  assert.ok(events.includes('snmp_settings_change'));
  assert.ok(events.includes('snmp_target_saved'));

  await admin.put('/api/integrations/snmp/settings', { enabled: 0, allow_v2c: 0, interval_seconds: 60 });
  await admin.del(`/api/integrations/snmp/targets/${deviceId}`);
});
