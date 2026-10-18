// اختبارات INT-01..03 — موصلات قراءة فقط: معطّلة افتراضيًّا، أسرار مقنّعة، تنقية أخطاء،
// وقراءة صحة تخزين Synology من استجابة محقونة (بلا أي جهاز حقيقي).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient, readText } = require('./helpers/test-app');

const env = setupTestEnv();

const connectors = require('../src/services/integrations/connector-base.service');
const synology = require('../src/services/integrations/synology.service');
const db = require('../src/db');

let srv, admin, viewer;

test.before(async () => {
  // الملف يتحقق من صياغات عربية (ملخصات الفحص/رسائل التفعيل) ⇒ نُثبّت لغة الواجهة عربيًا.
  require('../src/services/ui-language.service').setLang('ar');
  srv = await startServer();
  seedUser(db, 'admin_int', 'AdminPass123!', 'admin');
  seedUser(db, 'viewer_int', 'ViewerPass123!', 'viewer');
  admin = makeClient(srv.baseUrl);
  viewer = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_int', 'AdminPass123!')).status, 200);
  assert.equal((await viewer.login('viewer_int', 'ViewerPass123!')).status, 200);
});

test.after(async () => {
  await srv.close();
  env.cleanup();
});

test('INT نقي: تطبيع العنوان + رفض http غير المشفّر + تنقية الأسرار من النصوص', () => {
  assert.equal(connectors.normalizeBaseUrl('https://192.168.88.10:5001').ok, true);
  assert.equal(connectors.normalizeBaseUrl('http://nas.local').ok, false, 'http مرفوض افتراضيًّا');
  assert.equal(connectors.normalizeBaseUrl('http://nas.local', { allowInsecure: true }).ok, true);
  assert.equal(connectors.normalizeBaseUrl('ftp://nas').ok, false);
  assert.equal(connectors.normalizeBaseUrl('').ok, false);
  // بيانات اعتماد داخل الرابط تُزال
  const norm = connectors.normalizeBaseUrl('https://user:pass@nas.local:5001/path/');
  assert.equal(norm.ok, true);
  assert.ok(!norm.baseUrl.includes('user') && !norm.baseUrl.includes('pass'));

  const cleaned = connectors.redactText('فشل الاتصال بـ https://admin:S3cret@nas.local/x مع Authorization: Bearer abc.def.ghi والسر S3cret', { secrets: ['S3cret'] });
  assert.ok(!cleaned.includes('S3cret'), 'السر أُزيل');
  assert.ok(!cleaned.includes('admin:S3cret@'), 'بيانات الاعتماد في الرابط أُزيلت');
  assert.ok(!cleaned.includes('abc.def.ghi'), 'التوكن أُزيل');
  assert.match(cleaned, /\[REDACTED\]/);
});

test('INT نقي: حكم نتيجة الفحص — 2xx متصل · 401 مرفوض · 404 إصدار مختلف', () => {
  assert.equal(connectors.parseProbeOutcome({ status: 200, ok: true }).reachable, true);
  const unauth = connectors.parseProbeOutcome({ status: 401, ok: false });
  assert.equal(unauth.reachable, true);
  assert.equal(unauth.authorized, false);
  assert.match(unauth.summary, /بيانات الدخول/);
  const notFound = connectors.parseProbeOutcome({ status: 404, ok: false });
  assert.match(notFound.summary, /إصدار/);
  const timeout = connectors.parseProbeOutcome({ timedOut: true });
  assert.equal(timeout.reachable, false);
  assert.match(timeout.summary, /المهلة/);
});

test('INT: معطّل افتراضيًّا ⇒ لا اتصال ولا فحص (صفر شبكة)', async () => {
  const report = connectors.capabilitiesReport();
  assert.equal(report.length, 3);
  assert.ok(report.every((c) => c.state === 'disabled' && c.enabled === false), 'كل الموصلات معطّلة افتراضيًّا');

  let calls = 0;
  const spy = async () => { calls += 1; return { status: 200, ok: true, body: '{}' }; };
  const probeRes = await connectors.probe('synology', { httpClient: spy });
  assert.equal(probeRes.ok, false);
  assert.equal(calls, 0, 'لا محاولة اتصال قبل التفعيل');
  const storage = await synology.readStorageHealth({ httpClient: spy });
  assert.equal(storage.ok, false);
  assert.equal(calls, 0);
});

test('INT: التفعيل بلا بيانات دخول مرفوض، والحفظ يُقنّع السر دائمًا', async () => {
  // تفعيل بلا عنوان/سر ⇒ رفض واضح
  const bad = await admin.put('/api/integrations/connectors/synology', { enabled: 1 });
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(await readText(bad)).error, /عنوان|بيانات دخول|سر/);

  // حفظ كامل
  const ok = await admin.put('/api/integrations/connectors/synology', {
    enabled: 1, base_url: 'https://192.168.88.60:5001', username: 'monitor', secret: 'Dsm-Secret-123', owner_verified: 1,
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.data.secret_set, true);
  assert.ok(!JSON.stringify(body).includes('Dsm-Secret-123'), 'السر لا يُعاد أبدًا');
  assert.equal(body.data.owner_verified, true);

  // الحفظ اللاحق برسر فارغ لا يمسح القديم
  const again = await admin.put('/api/integrations/connectors/synology', { username: 'monitor2' });
  assert.equal((await again.json()).data.secret_set, true, 'السر محفوظ رغم غيابه في الطلب');

  // الفحص بعميل محقون: 200 ⇒ متصل ومُصرَّح
  const probeOk = await connectors.probe('synology', { httpClient: async () => ({ status: 200, ok: true, body: '{"success":true,"data":{}}' }) });
  assert.equal(probeOk.ok, true);
  assert.equal(probeOk.capabilities.reachable, true);

  // فشل بسر داخل الرسالة ⇒ يُنقّى قبل التخزين
  await connectors.probe('synology', { httpClient: async () => { throw new Error('connect failed with Dsm-Secret-123'); } });
  const row = db.prepare("SELECT last_error FROM integration_settings WHERE kind = 'synology'").get();
  assert.ok(!String(row.last_error).includes('Dsm-Secret-123'), 'لا أسرار في آخر خطأ مخزَّن');
  assert.match(String(row.last_error), /REDACTED|تعذّر/);
});

test('INT-03: قراءة صحة تخزين Synology من استجابة DSM محقونة (بلا جهاز حقيقي)', async () => {
  const dsmBody = JSON.stringify({
    success: true,
    data: {
      storage: {
        volumes: [
          { id: 'volume_1', device_type: 'shr', status: 'normal', size: { total: 4000000000000, used: 1000000000000 } },
          { id: 'volume_2', device_type: 'raid_1', status: 'degraded', is_degraded: true, size: { total: 1000000000000, used: 250000000000 } },
        ],
        disks: [
          { id: 'sda', name: 'Disk 1', model: 'WD40EFRX', status: 'normal', temp: 34, size_total: 4000000000000, smart_status: [{ id: 1, status: 'normal' }] },
          { id: 'sdb', name: 'Disk 2', model: 'WD40EFRX', status: 'warning', temp: 41, size_total: 4000000000000 },
        ],
      },
    },
  });
  const result = await synology.readStorageHealth({ httpClient: async ({ url }) => {
    assert.match(url, /SYNO\.Storage\.CGI\.Storage/);
    assert.match(url, /method=load_info/);
    return { status: 200, ok: true, body: dsmBody };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.volumes.length, 2);
  assert.equal(result.volumes[0].used_percent, 25);
  assert.equal(result.volumes[1].is_degraded, true, 'حجم متدهور يُعلَن صريحًا');
  const disk1 = result.disks.find((d) => d.id === 'sda');
  const disk2 = result.disks.find((d) => d.id === 'sdb');
  assert.equal(disk1.temperature_c, 34);
  assert.equal(disk1.smart_supported, true);
  assert.equal(disk2.smart_supported, false, 'لا نختلق SMART لقرص لا يوفّره DSM');
  assert.equal(result.smart_supported, true);

  // رفض DSM (success=false) ⇒ خطأ واضح بلا رمي
  const denied = await synology.readStorageHealth({ httpClient: async () => ({ status: 200, ok: true, body: '{"success":false,"error":{"code":105}}' }) });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /105/);

  // استجابة ليست JSON ⇒ خطأ مفهوم
  const badJson = await synology.readStorageHealth({ httpClient: async () => ({ status: 200, ok: true, body: '<html>' }) });
  assert.equal(badJson.ok, false);
  assert.match(badJson.error, /JSON/);
});

test('INT: الواجهات الإدارية محميّة ومُدقَّقة، والقدرات تعلن الحالة الحقيقية', async () => {
  assert.equal((await viewer.get('/api/integrations/connectors')).status, 403, 'الموصلات للمدير فقط');
  assert.equal((await viewer.post('/api/integrations/connectors/synology/probe')).status, 403);

  const caps = await (await admin.get('/api/integrations/capabilities')).json();
  const syn = caps.data.connectors.find((c) => c.kind === 'synology');
  assert.equal(syn.enabled, true);
  assert.equal(syn.configured, true);
  assert.ok(['reachable', 'not-probed'].includes(syn.state), 'حالة صادقة مبنية على آخر فحص');

  const probe = await admin.post('/api/integrations/connectors/synology/probe');
  // بلا جهاز حقيقي: إما فشل واضح (502) أو — لو الجهاز وهميًا — نجاح؛ المهم ألا يرمي
  assert.ok([200, 502].includes(probe.status));
  if (probe.status === 502) {
    const b = JSON.parse(await readText(probe));
    assert.equal(typeof b.error === 'string' && b.error.length > 0, true);
  }

  const events = db.prepare("SELECT event FROM audit_log WHERE event LIKE 'connector_%' ORDER BY id").all().map((r) => r.event);
  assert.ok(events.includes('connector_settings_saved'));
  assert.ok(events.includes('connector_probed'));

  // إعادة الوضع الآمن: تعطيل الموصل في نهاية الاختبار
  await admin.put('/api/integrations/connectors/synology', { enabled: 0 });
  assert.equal((await (await admin.get('/api/integrations/connectors')).json()).data.find((c) => c.kind === 'synology').enabled, false);
});
