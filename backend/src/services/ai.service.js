// ai.service.js (v2.25.0) — الخدمة المشتركة لاستدعاء النموذج اللغوي.
// استُخرجت المنطق من ai.routes.js ليُعاد استخدامه خارج الشات (مثل: تحليل التقرير
// اليومي في smart-alerts). بقواعد v2.21.0 نفسها: بلا مفتاح = غير نشط صامتًا،
// أي endpoint متوافق OpenAI، مهلة 60ث، أخطاء مترجمة عربيًّا.
const db = require('../db');

const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-flash';
const CHAT_TIMEOUT_MS = 60000;
const MAX_CONTEXT_DEVICES = 120;
const MAX_CONTEXT_EVENTS = 60;

function getSettings() {
  return db.prepare('SELECT * FROM ai_settings WHERE id = 1').get() || {};
}

// جاهزية أي ميزة AI: مفعّلة + مفتاح موجود.
function isReady() {
  const s = getSettings();
  return !!(s.enabled && s.api_key);
}

// ── بناء «موجز السياق» من القاعدة (بكل شيء شامل الـ IPs — قرار المستخدم 2026-10-15) ──
function buildNetworkContext() {
  const devices = db.prepare(`
    SELECT d.id, d.name, d.ip, d.current_status, d.last_response_time_ms, d.last_checked_at,
           d.is_active, d.parent_id, d.web_port,
           t.name AS type_name, l.name AS location_name
    FROM devices d
    LEFT JOIN device_types t ON t.id = d.device_type_id
    LEFT JOIN locations l ON l.id = d.location_id
    ORDER BY d.current_status DESC, d.name COLLATE NOCASE ASC
    LIMIT ?
  `).all(MAX_CONTEXT_DEVICES);
  const events = db.prepare(`
    SELECT de.id, de.device_id, de.started_at, de.ended_at, de.duration_seconds,
           dv.name AS device_name, dv.ip AS device_ip
    FROM downtime_events de
    JOIN devices dv ON dv.id = de.device_id
    ORDER BY de.ended_at IS NOT NULL ASC, de.started_at DESC
    LIMIT ?
  `).all(MAX_CONTEXT_EVENTS);
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN current_status = 'online' THEN 1 ELSE 0 END) AS online,
      SUM(CASE WHEN current_status = 'offline' THEN 1 ELSE 0 END) AS offline,
      SUM(CASE WHEN current_status = 'unknown' THEN 1 ELSE 0 END) AS unknown
    FROM devices WHERE is_active = 1
  `).get();
  return { generated_at: new Date().toISOString(), counts, devices, recent_downtime_events: events };
}

function systemPrompt(context) {
  return [
    'أنت «مساعد مراقبة الشبكة» داخل نظام مراقبة أجهزة (network-monitor) في منشأة عربية.',
    'أجب بالعربية بجُمل واضحة ومختصرة، اعتمادًا حصريًّا على بيانات السياق المرفقة (JSON).',
    'لا تخترع بيانات غير موجودة في السياق — إن كان الجواب غير متوفر قل ذلك بصراحة.',
    'أنت استشاري تشخيصي فقط: لا تنفّذ أي إجراء ولا تدّعي التنفيذ؛ اقترح الخطوة للإنسان.',
    'عند ذكر جهاز واقع، اذكر اسمه وعنوانه وموقعه ومدة انقطاعها إن وُجدت.',
    'ترتيب الأجهزة في السياق: الواقعة أولًا. الانقطاعات بstarted_at بصيغة ISO؛ ended_at فارغ = مستمر الآن.',
    '',
    '=== سياق الشبكة الحالي (JSON) ===',
    JSON.stringify(context),
  ].join('\n');
}

// ── استدعاء النموذج (HTTP عادي — بلا أي مكتبات إضافية) ──
async function callModel(baseUrl, apiKey, model, messages) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = JSON.stringify({ model, messages, temperature: 0.3, stream: false });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body,
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  }).catch((e) => { const err = new Error(e.message); err.native = true; throw err; });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try { const j = JSON.parse(text); detail = (j.error && (j.error.message || j.error.code)) || detail; } catch (_) {}
    const e = new Error('HTTP ' + res.status + ': ' + detail);
    e.status = res.status;
    throw e;
  }
  const data = JSON.parse(text);
  const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!reply) throw new Error('رد غير متوقع من النموذج (لا يوجد choices[0].message.content)');
  return reply.trim();
}

// رسائل خطأ عربية واضحة بدل الردود الفنية الخام.
function friendlyModelError(e) {
  const msg = String(e && e.message || e);
  if (/HTTP 401|HTTP 403/.test(msg)) return 'مفتاح API مرفوض من المزوّد (401/403) — تحقّق من صحة المفتاح في إعدادات شات AI.';
  if (/HTTP 404/.test(msg)) return 'المسار أو اسم النموذج غير صحيح — تحقّق من «عنوان الخدمة» و«اسم النموذج» في الإعدادات.';
  if (/HTTP 429/.test(msg)) return 'تجاوزت حد الاستدعاءات لدى المزوّد (429) — انتظر قليلًا أو راجع رصيد المفتاح.';
  if (/HTTP 402/.test(msg)) return 'رصيد المفتاح غير كافٍ لدى المزوّد (402) — راجع حسابك لديه.';
  if (/timeout|aborted|TimeoutError/i.test(msg)) return 'انتهت مهلة استجابة النموذج (60 ثانية) — حاول مرة أخرى أو استخدم نموذجًا أسرع.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|certificate/i.test(msg)) return 'تعذّر الوصول إلى خدمة النموذج — تحقّق من اتصال الجهاز بالإنترنت وصحة «عنوان الخدمة».';
  return 'فشل استدعاء النموذج: ' + msg;
}

// chatCompletion(messages) — جواب نصي خام (يُستخدم من الشات والتقرير اليومي).
async function chatCompletion(messages) {
  const s = getSettings();
  return callModel(s.base_url || DEFAULT_BASE_URL, s.api_key, s.model || DEFAULT_MODEL, messages);
}

// analyzeDailyReport(reportPlainText) — تحليل قصير للتقرير اليومي (≤3 جمل + توصية).
// يعيد نصًّا عربيًّا أو null (تسليمًا لأي فشل — التقرير العادي يجب ألا يتأثر أبدًا).
async function analyzeDailyReport(reportPlainText, timeoutMs = 45000) {
  if (!isReady()) return null;
  const messages = [
    { role: 'system', content: [
      'أنت محلل شبكة عربي داخل نظام مراقبة. صِل أحكامك من النص المعطى فقط ولا تخترع أرقامًا.',
      'اكتب تحليلًا عربيًّا من 3 جمل كحد أقصى: ملاحظة أهم نمط، ثم توصية عملية واحدة بالفعل.',
      'بدايةً بنص مثل: «📌 الملاحظة: …» ثم «💡 التوصية: …». بلا مقدمات أو مجاملات.',
    ].join('\n') },
    { role: 'user', content: 'تقرير اليوم:\n' + String(reportPlainText || '').slice(0, 3000) },
  ];
  const s = getSettings();
  try {
    const res = await fetch((s.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.api_key },
      body: JSON.stringify({ model: s.model || DEFAULT_MODEL, messages, temperature: 0.3, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return reply ? String(reply).trim().slice(0, 700) : null;
  } catch (e) {
    return null; // التقرير أولاً — التحليل ميزة إضافية لا شرط
  }
}

module.exports = {
  DEFAULT_BASE_URL, DEFAULT_MODEL, CHAT_TIMEOUT_MS,
  getSettings, isReady, buildNetworkContext, systemPrompt,
  callModel, friendlyModelError, chatCompletion, analyzeDailyReport,
};
