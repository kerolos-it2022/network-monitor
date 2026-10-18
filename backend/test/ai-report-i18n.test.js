// ai-report-i18n.test.js — قرار المالك (2026-10-18): تحليل AI في التقرير اليومي **بلغتين معًا**
// (كتلة عربية ثم كتلة إنجليزية في الرسالة نفسها) مهما كانت لغة الإشعارات — لأن قارئي التقرير مختلفان.
//
// يحرس هذا الاختبار:
//   ١) كتلتان دائمًا: «🧠 تحليل AI:» أولًا ثم «🧠 AI analysis:»، وبينهما سطر فارغ.
//   ٢) استقلال القسم عن notification_language: الكتلتان حاضِرتان مع 'ar' و'en' على السواء.
//   ٣) وضع القواعد المحلية (بلا مزوّد · بلا شبكة): العربي **حرفيًّا كما كان** (مِسلات مكتوبة هنا
//      تُفشل أي تعديل مستقبلي بصوت عالٍ)، والإنجليزي توأم كامل بلا حرف عربي واحد.
//   ٤) التدهور المرن لردّ المزوّد: ما وصل يُعرض في كتلته، والناقص يُكمَل بنصّ القواعد المحلية بلغته —
//      ولا فاصل ولا كتلة فارغة ولا {placeholder} في أي مخرَج.
// بلا أي شبكة: مسار المزوّد يُختبر باستبدال fetch العام بردّ مزيّف (نمط log-i18n مع axios).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnv } = require('./helpers/test-app');

const env = setupTestEnv();

const db = require('../src/db');
const ai = require('../src/services/ai.service');
const smartAlerts = require('../src/services/smart-alerts.service');

// ── مِسلات عربية حرفية (النسخة السابقة نفسها) — أي مساس بالعربي يُفشل الاختبارات أدناه ──
const AR_FIRST_LINE = '📊 الشبكة الآن: 4 جهازًا — متصل 2 · متقطع 2 · غير معروف 0 · متدهور 1.';
const AR_OFFLINE_HEADER = '🔴 أعلى الأعطال أولويةً:';
const AR_DEGRADED_LINE = '🟡 أجهزة متصلة لكن بها خدمات متوقفة: server-odoo (1)';
const AR_FOOTER = 'ℹ️ هذه إجابة بقواعد محلية — لا تُرسَل أي بيانات خارج الجهاز. فعّل مزوّد AI لمزيد من التحليل.';

// ── التوأم الإنجليزي المتوقّع (بلا الطابع الزمني المتغيّر في سطر «منذ …») ──
const EN_FIRST_LINE = '📊 Network now: 4 devices — online 2 · offline 2 · unknown 0 · degraded 1.';
const EN_OFFLINE_HEADER = '🔴 Top-priority outages:';
const EN_DEGRADED_LINE = '🟡 Devices online but with services down: server-odoo (1)';
const EN_FOOTER = 'ℹ️ This is a local-rules answer — no data leaves the device. Enable an AI provider for deeper analysis.';

// فاصل التوأمة بين النصّين في ردّ المزوّد — مكتوب هنا حرفيًّا كي لا يمرّ تغييره صامتًا.
const MARKER = '<<<EN>>>';
const AR_AI = '📌 الملاحظة: لا نمط خطر في آخر 24 ساعة.\n💡 التوصية: أبقِ الفحوص الدورية كما هي.';
const EN_AI = '📌 Note: no risky pattern in the last 24 hours.\n💡 Recommendation: keep the periodic checks as they are.';

test.before(() => {
  // بيانات **لاتينية** عن قصد: توأم وضع القواعد الإنجليزي يجب أن يخلو تمامًا من أي حرف عربي.
  const typeId = db.prepare("INSERT INTO device_types (name, icon) VALUES ('Camera', 'camera')").run().lastInsertRowid;
  const locId = db.prepare("INSERT INTO locations (name, kind) VALUES ('Office', 'site')").run().lastInsertRowid;
  const ins = db.prepare(
    `INSERT INTO devices (name, ip, device_type_id, location_id, check_protocol, is_active, current_status, host_status, overall_health)
     VALUES (?, ?, ?, ?, 'ping', 1, ?, ?, ?)`
  );
  ins.run('cam-gate', '192.168.88.31', typeId, locId, 'offline', 'offline', 'offline');
  ins.run('switch-floor', '192.168.88.2', typeId, locId, 'offline', 'offline', 'offline');
  const odooId = ins.run('server-odoo', '192.168.88.20', typeId, locId, 'online', 'online', 'degraded').lastInsertRowid;
  ins.run('printer', '192.168.88.50', typeId, locId, 'online', 'online', 'online');
  db.prepare(
    "INSERT INTO monitored_services (device_id, name, kind, port, is_enabled, status) VALUES (?, 'odoo-erp', 'tcp', 8069, 1, 'offline')"
  ).run(odooId);
  // انقطاع مفتوح واحد (يظهر في «منذ …» بوضع القواعد المحلية)
  db.prepare('INSERT INTO downtime_events (device_id, started_at) VALUES ((SELECT id FROM devices WHERE name = ?), ?)')
    .run('cam-gate', new Date(Date.now() - 3600e3).toISOString());
});

test.after(() => {
  try { db.close(); } catch (_) { /* تجاهل */ }
  env.cleanup();
});

// يضبط لغة الإشعارات في القاعدة (نفس ما يكتبه مسار /api/settings/notification-language — بلا HTTP).
function setNotificationLanguage(lang) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('notification_language', ?, ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(lang, new Date().toISOString());
}

// يفعّل/يوقف مزوّد AI مباشرة في القاعدة (نمط ai-privacy: بلا HTTP).
function setProvider(enabled) {
  db.prepare(
    "UPDATE ai_settings SET enabled = ?, api_key = ?, base_url = 'https://ai.invalid/v1', model = 'stub-model' WHERE id = 1"
  ).run(enabled ? 1 : 0, enabled ? 'test-key' : null);
}

// يشغّل التقرير اليومي الحقيقي (buildDailyReportWithAnalysis) وfetch العام مردودٌ بردّ مزوّد مزيّف.
// يعيد { report: {text, plain}, calls: [{url, body}] } — يستعيد fetch دائمًا مهما حدث.
async function runReport(reply, lang, { ok = true, now = new Date(2026, 9, 18, 12, 0, 0) } = {}) {
  setNotificationLanguage(lang);
  const saved = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: String(opts.body || '') });
    return { ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content: reply } }] }) };
  };
  try {
    const report = await smartAlerts.buildDailyReportWithAnalysis(now);
    return { report, calls };
  } finally {
    global.fetch = saved;
  }
}

function assertNoMarkerNoPlaceholder(...texts) {
  for (const t of texts) {
    assert.ok(!String(t).includes(MARKER), 'فاصل التوأمة تسرّب إلى المخرَج');
    assert.ok(!/\{\w+\}/.test(String(t)), 'placeholder خام في المخرَج: ' + JSON.stringify(String(t).slice(0, 160)));
  }
}

// استخراج كتلة من نصّ التقرير بين عنوانِها والعنوان التالي (أو نهاية النص).
function blockAfter(text, header, nextHeader) {
  const start = text.indexOf(header);
  assert.ok(start > -1, 'العنوان مفقود: ' + header);
  const from = start + header.length;
  const end = nextHeader ? text.indexOf(nextHeader, from) : -1;
  return end > -1 ? text.slice(from, end) : text.slice(from);
}

test('تحليل AI في التقرير اليومي: عربي أولًا ثم إنجليزي تحت عنوانَيهما — مع لغة الإشعارات ar', async () => {
  assert.equal(ai.AI_BI_MARKER, MARKER, 'فاصل التوأمة تغيّر — حدّث الاختبار معه');
  setProvider(true);
  const { report, calls } = await runReport(AR_AI + '\n' + MARKER + '\n' + EN_AI, 'ar');

  // استدعاء واحد فقط للغتين (قرار المالك: لا استدعاءين).
  assert.equal(calls.length, 1, 'يجب أن يكفي استدعاء واحد');
  const t = report.text;
  assert.ok(t.includes('🧠 <b>تحليل AI:</b>\n' + AR_AI), 'الكتلة العربية تحت عنوانها العربي');
  assert.ok(t.includes('🧠 <b>AI analysis:</b>\n' + EN_AI), 'الكتلة الإنجليزية تحت عنوانها الإنجليزي');
  assert.ok(t.indexOf('🧠 <b>تحليل AI:</b>') < t.indexOf('🧠 <b>AI analysis:</b>'), 'العربية أولًا ثم الإنجليزية');
  assert.ok(t.includes(AR_AI + '\n\n🧠 <b>AI analysis:</b>'), 'سطر فارغ يفصل الكتلتين');
  assert.ok(/🧠 <b>تحليل AI:<\/b>\n\S/.test(t) && /🧠 <b>AI analysis:<\/b>\n\S/.test(t), 'لا كتلة فارغة تحت أي عنوان');
  assert.equal(t.split('🧠 <b>AI analysis:</b>').length, 2, 'عنوان إنجليزي واحد فقط');

  // النسخة المجرّدة من الوسوم (واتساب/الموبايل) تحمل الكتلتين أيضًا.
  assert.ok(report.plain.includes('🧠 تحليل AI:\n' + AR_AI));
  assert.ok(report.plain.includes('🧠 AI analysis:\n' + EN_AI));
  assert.ok(report.plain.includes(AR_AI + '\n\n🧠 AI analysis:\n'));

  // الطلب الواحد طلب فعلًا النصّين: الفاصل في التعليمات + المطالبة بالتوأم الإنجليزي.
  const body = JSON.parse(calls[0].body);
  assert.ok(body.messages[0].content.includes(MARKER), 'تعليمات المزوّد تحمل الفاصل الحرفي');
  assert.ok(body.messages[0].content.includes('إنجليزي'), 'تعليمات المزوّد تطلب التوأم الإنجليزي');
  assert.ok(body.messages[1].content.startsWith('تقرير اليوم:'));
  assertNoMarkerNoPlaceholder(t, report.plain);
});

test('تحليل AI في التقرير اليومي: الكتلتان نفسهما مع لغة الإشعارات en', async () => {
  setProvider(true);
  const { report } = await runReport(AR_AI + '\n' + MARKER + '\n' + EN_AI, 'en');
  assert.ok(report.text.includes('🧠 <b>تحليل AI:</b>\n' + AR_AI));
  assert.ok(report.text.includes('🧠 <b>AI analysis:</b>\n' + EN_AI));
  assert.ok(report.text.indexOf('🧠 <b>تحليل AI:</b>') < report.text.indexOf('🧠 <b>AI analysis:</b>'));
  assert.ok(report.plain.includes('🧠 تحليل AI:\n' + AR_AI));
  assert.ok(report.plain.includes('🧠 AI analysis:\n' + EN_AI));
  assertNoMarkerNoPlaceholder(report.text, report.plain);
});

test('وضع القواعد المحلية: العربي حرفيًّا كما كان والإنجليزي توأمه بلا أي حرف عربي', () => {
  setProvider(false);
  const pair = ai.deterministicDiagnosisBoth();
  const arLines = pair.ar.split('\n');
  // العربي: مِسلات حرفية كتلك التي كان يُنتجها قبل التغيير — أي تعديل مستقبلي يفشل هنا.
  assert.equal(arLines[0], AR_FIRST_LINE);
  assert.equal(arLines[1], AR_OFFLINE_HEADER);
  assert.match(arLines[2], /^   • cam-gate — Camera في Office \(منذ .+\)$/);
  assert.equal(arLines[3], '   • switch-floor — Camera في Office');
  assert.equal(arLines[4], AR_DEGRADED_LINE);
  assert.equal(arLines[5], AR_FOOTER);
  assert.ok(pair.ar.includes('بقواعد محلية'), 'مِسلة الحماية القائمة');
  assert.ok(pair.ar.includes('متقطع'), 'مِسلة الحماية القائمة');
  // الواجهة السابقة (شات /api/ai/chat في وضع القواعد) تُرجع نفس العربي بالحرف.
  assert.equal(ai.deterministicDiagnosis(), pair.ar);

  // الإنجليزي: توأم السطر بالسطر — بلا حرف عربي واحد (البيانات المزروعة لاتينية عن قصد).
  const enLines = pair.en.split('\n');
  assert.equal(enLines[0], EN_FIRST_LINE);
  assert.equal(enLines[1], EN_OFFLINE_HEADER);
  assert.match(enLines[2], /^   • cam-gate — Camera at Office \(since \d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM)\)$/);
  assert.equal(enLines[3], '   • switch-floor — Camera at Office');
  assert.equal(enLines[4], EN_DEGRADED_LINE);
  assert.equal(enLines[5], EN_FOOTER);
  assert.equal(/[\u0600-\u06FF]/.test(pair.en), false, 'لا حرف عربي واحد في التوأم الإنجليزي');
  assertNoMarkerNoPlaceholder(pair.ar, pair.en);
});

test('تدهور مرن: ردّ ناقص من المزوّد ⇒ ما وصل يُعرض والناقص يُكمَل بقواعد محلية', async () => {
  setProvider(true);

  // (أ) ردّ عربي واحد بلا فاصل إطلاقًا ⇒ الكتلة الإنجليزية من القواعد المحلية.
  const a = await runReport(AR_AI, 'ar');
  assert.ok(a.report.text.includes('🧠 <b>تحليل AI:</b>\n' + AR_AI), 'ما وصل حُفظ في كتلته');
  const enBlockA = blockAfter(a.report.text, '🧠 <b>AI analysis:</b>\n');
  assert.ok(enBlockA.includes(EN_FOOTER), 'الطرف الناقص أُكمِل بنصّ القواعد الإنجليزية');
  assert.equal(/[\u0600-\u06FF]/.test(enBlockA), false, 'كتلة إنجليزية نقية بلا عربي');

  // (ب) الفاصل موجود لكن الطرف الإنجليزي فارغ ⇒ نفس التدهور بلا كتلة فارغة.
  const b = await runReport(AR_AI + '\n' + MARKER + '\n   ', 'ar');
  assert.ok(b.report.text.includes('🧠 <b>تحليل AI:</b>\n' + AR_AI));
  assert.ok(blockAfter(b.report.text, '🧠 <b>AI analysis:</b>\n').includes(EN_FOOTER));

  // (ج) ردّ إنجليزي وحده بلا فاصل ⇒ الكتلة العربية من القواعد المحلية.
  const c = await runReport(EN_AI, 'en');
  assert.ok(c.report.text.includes('🧠 <b>AI analysis:</b>\n' + EN_AI));
  const arBlockC = blockAfter(c.report.text, '🧠 <b>تحليل AI:</b>\n', '🧠 <b>AI analysis:</b>');
  assert.ok(arBlockC.includes('بقواعد محلية'), 'الطرف العربي أُكمِل بنصّ القواعد العربية');

  for (const r of [a, b, c]) {
    assertNoMarkerNoPlaceholder(r.report.text, r.report.plain);
    assert.ok(/🧠 <b>تحليل AI:<\/b>\n\S/.test(r.report.text) && /🧠 <b>AI analysis:<\/b>\n\S/.test(r.report.text), 'لا كتلة فارغة');
  }
});

test('فشل المزوّد: التقرير يُرسل وحده دون قسم تحليل (السلوك السابق نفسه)', async () => {
  setProvider(true);
  const now = new Date(2026, 9, 18, 12, 0, 0);
  const { report } = await runReport('ردّ لا يُقرأ', 'ar', { ok: false, now });
  assert.equal(report.text, smartAlerts.buildDailyReport(now), 'لا شيء زِيد على التقرير عند فشل المزوّد');
  assert.equal(report.plain, report.text.replace(/<[^>]+>/g, ''));
  assert.ok(!report.text.includes('تحليل AI'), 'لا قسم تحليل عند فشل المزوّد');
});
