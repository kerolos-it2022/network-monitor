// اختبارات v2.33.0 — إدارة خطوط البثّ الحيّ (SSE): السياسة · الحدود · البطء · الإحصاء · الخصوصية.
// المنهج: (أ) عبر HTTP حقيقي على السيرفر التجريبي (اتصال، إغلاق بالسياسة، 503 عند الحدود)،
//        (ب) على مستوى الخدمة مباشرةً بـ res مُستبدَل (إسقاط العميل البطيء والحدّ العام) بلا سوكتات.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv, startServer, seedUser, makeClient, readText } = require('./helpers/test-app');

// حدود صغيرة مُقصودة: حدّ لكل IP = 1 (قابل للاختبار من 127.0.0.1)، والحدّ العام واسع.
const env = setupTestEnv({ NM_SSE_MAX_CLIENTS: '500', NM_SSE_MAX_PER_IP: '1', NM_SSE_MAX_BUFFER: String(64 * 1024) });

const db = require('../src/db');
const live = require('../src/services/live.service');
const publicDisplay = require('../src/services/public-display.service');

let srv, admin;
const openStreams = [];

// اتصال SSE خام (fetch stream) — قارئ واحد فقط لكل استجابة (الـ ReadableStream يُقفل بعد getReader).
async function openStream() {
  const ac = new AbortController();
  const res = await fetch(srv.baseUrl + '/api/live/status', { signal: ac.signal });
  openStreams.push(ac);
  return { res, ac, buf: '', reader: res.ok && res.body ? res.body.getReader() : null };
}

// قراءة حتى ظهور نصّ معيّن، أو انتهاء الخطّ، أو انتهاء المهلة (بلا تعليق للاختبار).
async function readUntil(stream, predicate, timeoutMs = 3000) {
  if (!stream.reader) return { text: stream.buf, ended: true };
  const dec = new TextDecoder();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const remain = Math.max(50, timeoutMs - (Date.now() - started));
    const chunk = await Promise.race([
      stream.reader.read(),
      new Promise((r) => setTimeout(() => r({ timeout: true }), remain)),
    ]);
    if (chunk && chunk.done) return { text: stream.buf, ended: true };
    if (chunk && chunk.value) stream.buf += dec.decode(chunk.value, { stream: true });
    if (predicate(stream.buf)) return { text: stream.buf, ended: false };
  }
  return { text: stream.buf, ended: false };
}

// إغلاق كل الخطوط المفتوحة + مهلة قصيرة حتى يُنفّذ السيرفر تنظيفه (close ⇒ removeClient).
async function abortStreams(waitMs = 200) {
  for (const ac of openStreams.splice(0)) { try { ac.abort(); } catch (_) {} }
  await new Promise((r) => setTimeout(r, waitMs));
}

test.before(async () => {
  srv = await startServer();
  seedUser(db, 'admin_sse', 'AdminPass123!', 'admin');
  admin = makeClient(srv.baseUrl);
  assert.equal((await admin.login('admin_sse', 'AdminPass123!')).status, 200);
  publicDisplay.setMode('lan');
});

test.after(async () => {
  await abortStreams(0);
  try { publicDisplay.setMode('lan'); } catch (_) {}
  if (srv) await srv.close();
  env.cleanup();
});

test('T-sse: اللقطة الأولى تصل للمجهول وبلا أي عنوان أو اسم (خصوصية الحمولة)', async () => {
  const stream = await openStream();
  assert.equal(stream.res.status, 200);
  assert.match(String(stream.res.headers.get('content-type')), /text\/event-stream/);
  const got = await readUntil(stream, (t) => t.includes('"type":"snapshot"'));
  assert.match(got.text, /"type":"snapshot"/);
  assert.match(got.text, /"totals"/);
  // الحمولة لا تحوي أي حقل حسّاس — لا IP ولا MAC ولا اسم
  assert.doesNotMatch(got.text, /"ip"/);
  assert.doesNotMatch(got.text, /"mac"/);
  assert.doesNotMatch(got.text, /"name"/);
  assert.doesNotMatch(got.text, /(\d{1,3}\.){3}\d{1,3}/, 'لا يوجد أي عنوان IPv4 في نصّ البثّ');
  await abortStreams();   // نُحرّر المقعد (الحدّ لكل IP = 1 في هذه البيئة)
});

test('T-sse: تغيير إعداد العرض إلى off يُغلق الخطوط المفتوحة فورًا برسالة سببية', async () => {
  const stream = await openStream();
  const snapshot = await readUntil(stream, (t) => t.includes('"type":"snapshot"'));
  assert.match(snapshot.text, /"type":"snapshot"/, 'الخط مفتوح ويبثّ قبل الإيقاف');

  // إيقاف العرض العام من مسار الإعدادات (مدير) — الردّ يُبلّغ بعدد الخطوط المُغلقة
  const put = await admin.put('/api/settings/public-display', { mode: 'off' });
  assert.equal(put.status, 200);
  const body = await put.json();
  assert.equal(body.data.mode, 'off');
  assert.ok(body.data.closed_streams >= 1, 'الردّ يُبلّغ بعدد الخطوط المُغلقة: ' + body.data.closed_streams);

  // الخطّ يستقبل {type:'closed'} ثم يُنهيه السيرفر (انتهاء القراءة)
  const tail = await readUntil(stream, (t) => t.includes('"type":"closed"'));
  assert.match(tail.text, /"type":"closed"/);
  assert.match(tail.text, /public-display-off/);
  const end = await readUntil(stream, () => true, 2000);
  assert.equal(end.ended, true, 'السيرفر أنهى الخطّ بعد الإغلاق');

  // والعرض العام صار ممنوعًا للاتصالات الجديدة
  const refused = await fetch(srv.baseUrl + '/api/live/status');
  assert.equal(refused.status, 403);
  await readText(refused);

  // إعادة التشغيل للاختبارات التالية
  const back = await admin.put('/api/settings/public-display', { mode: 'lan' });
  assert.equal(back.status, 200);
  await abortStreams();
});

test('T-sse: حدّ الخطوط لكل IP ⇒ الخطّ الزائد يُرفض بـ 503 (والشاشة تُعيد المحاولة تلقائيًّا)', async () => {
  publicDisplay.setMode('lan');
  const first = await openStream();
  assert.equal(first.res.status, 200);
  await readUntil(first, (t) => t.includes('"type":"snapshot"'));

  // نفس الـ IP (127.0.0.1) ومع الحدّ = 1 ⇒ الرفض
  const second = await fetch(srv.baseUrl + '/api/live/status');
  assert.equal(second.status, 503);
  assert.equal(second.headers.get('retry-after'), '10');
  const j = await second.json();
  assert.equal(j.success, false);
  assert.match(String(j.error), /الحدّ الأقصى/);

  const s = live.stats();
  assert.ok(s.rejectedLimit >= 1, 'يُحتسب الرفض في الإحصاءات: ' + s.rejectedLimit);
  assert.equal(s.maxPerIp, 1);
  await abortStreams();   // نُفرغ السجلّ قبل اختبارات الخدمة المباشرة
});

test('T-sse: عميل بطيء لا يقرأ ⇒ يُسقَط بدل تكديس الذاكرة (فحص المخزون)', () => {
  // res مُستبدَل: يدّعي مخزونًا أكبر من الحدّ (64KB في هذه البيئة) بلا أي شبكة
  const fakeRes = {
    writableLength: 70 * 1024,
    writes: 0,
    ended: false,
    write() { this.writes += 1; return true; },
    end() { this.ended = true; },
  };
  const before = live.stats();
  const client = live.addClient({ ip: '10.0.0.9', socket: { remoteAddress: '10.0.0.9' } }, fakeRes);
  assert.ok(client && !client.rejected, 'الخطّ يُقبل أولًا');
  live.writeRaw(client, 'data: {"type":"update"}\n\n');   // التضخّم يظهر هنا ⇒ الإسقاط
  const after = live.stats();
  assert.equal(after.droppedSlow, before.droppedSlow + 1, 'يُحتسب العميل المُسقَط');
  assert.equal(fakeRes.ended, true, 'يُغلق الخطّ فورًا');
  assert.equal(after.clients, before.clients, 'لا يبقى الخطّ في السجلّ (لا تراكم)');
});

test('T-sse: الحدّ العام للخطوط يرفض فوق السقف حتى من عناوين مختلفة', () => {
  const before = live.stats();
  const fake = () => ({ writableLength: 0, write() { return true; }, end() {} });
  const cap = before.maxClients;
  assert.ok(cap >= 2);
  const made = [];
  for (let i = 0; i < cap; i++) {
    const c = live.addClient({ ip: '10.1.' + Math.floor(i / 250) + '.' + (i % 250) }, fake());
    if (c && !c.rejected) made.push(c);
  }
  const overflow = live.addClient({ ip: '10.9.9.9' }, fake());
  assert.equal(overflow.rejected, 'max-clients', 'فوق السقف ⇒ رفض بسبب الحدّ العام');
  assert.ok(live.stats().rejectedLimit > before.rejectedLimit);
  for (const c of made) live.removeClient(c);   // تنظيف بلا أثر على اختبارات أخرى
  assert.equal(live.stats().clients, before.clients, 'عاد عدد الخطوط كما كان بعد التنظيف');
});
