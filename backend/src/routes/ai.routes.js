// ai.routes.js — 🤖 شات AI (v2.21.0): محادثة عربية عن الشبكة بسياق من القاعدة المحلية.
// المبدأ: السؤال + «موجز سياق» يُجمَع لحظيًّا من القاعدة يُرسلان إلى نموذج لغوي بمفتاح
// المستخدم (أي endpoint متوافق OpenAI Chat Completions — افتراضي z.ai/GLM). الميزة
// اختيارية بالكامل: بلا مفتاح/تفعيل يرد المسار 404 منطقيًّا والنظام يعمل كالمعتاد.
// أمن: requireAuth على كل المسارات + المفتاح يُقنَّع عند القراءة ولا يُمسح عند الحفظ الفارغ.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-flash';
const CHAT_TIMEOUT_MS = 60000;
// سقوف السياق: نحدّ من يتكلّم كثيرًا (تاريخ المحادثة + حجم الموجز).
const MAX_HISTORY_MESSAGES = 10;          // آخر رسائل المحادثة المُرسلة من الواجهة
const MAX_CONTEXT_DEVICES = 120;          // سقف حماية لو تضخّمت القائمة
const MAX_CONTEXT_EVENTS = 60;            // آخر انقطاع (مفتوح أولًا ثم الأحدث)
const MAX_QUESTION_CHARS = 4000;

function maskKey(value) {
  if (!value) return '';
  const v = String(value).trim();
  if (v.length <= 6) return '***';
  return '***' + v.slice(-4);
}

function getSettings() {
  return db.prepare('SELECT * FROM ai_settings WHERE id = 1').get() || {};
}

// ── بناء «موجز السياق» من القاعدة (كل شيء شامل الـ IPs — قرار المستخدم 2026-10-15) ──
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

  // آخر الانقطاعات: المفتوحة (جارية) أولًا ثم المغلقة الأحدث.
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

  const nowIso = new Date().toISOString();
  return { generated_at: nowIso, counts, devices, recent_downtime_events: events };
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

// ── الاتصال بالنموذج (HTTP عادي — بلا أي مكتبات إضافية) ──
function callModel(baseUrl, apiKey, model, messages) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = JSON.stringify({ model, messages, temperature: 0.3, stream: false });
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body,
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  }).then(async (res) => {
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
  });
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

// GET /api/ai/settings 🔒 — الحالة + المفتاح مقنّع.
router.get('/settings', requireAuth, (req, res) => {
  const s = getSettings();
  return res.json({
    success: true,
    data: {
      enabled: s.enabled ? 1 : 0,
      api_key_masked: maskKey(s.api_key),
      base_url: s.base_url || DEFAULT_BASE_URL,
      model: s.model || DEFAULT_MODEL,
      has_key: !!s.api_key,
    },
  });
});

// PUT /api/ai/settings 🔒 — كنمط الإشعارات: المفتاح الفارغ لا يمسح الموجود (null يمسحه).
router.put('/settings', requireAuth, (req, res) => {
  const { enabled, api_key, base_url, model } = req.body || {};
  const current = getSettings();
  let newKey = current.api_key || null;
  if (api_key === null) newKey = null;
  else if (typeof api_key === 'string' && api_key.trim() !== '') newKey = api_key.trim();
  db.prepare('UPDATE ai_settings SET enabled = ?, api_key = ?, base_url = ?, model = ? WHERE id = 1').run(
    enabled ? 1 : 0,
    newKey,
    (typeof base_url === 'string' && base_url.trim() !== '') ? base_url.trim() : DEFAULT_BASE_URL,
    (typeof model === 'string' && model.trim() !== '') ? model.trim() : DEFAULT_MODEL,
  );
  const s = getSettings();
  return res.json({
    success: true,
    data: { enabled: !!s.enabled, api_key_masked: maskKey(s.api_key), base_url: s.base_url, model: s.model, has_key: !!s.api_key },
  });
});

// POST /api/ai/chat 🔒 — { message, history? } ⇒ { reply, context_stats }
router.post('/chat', requireAuth, async (req, res) => {
  if (!checkReady()) {
    return res.status(400).json({ success: false, error: 'شات AI معطّل — فعّله واكتب مفتاح API من تبويب الشات أولاً.' });
  }
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'اكتب سؤالًا أولًا.' });
  if (message.length > MAX_QUESTION_CHARS) return res.status(400).json({ success: false, error: 'السؤال طويل جدًّا (الحد ' + MAX_QUESTION_CHARS + ' حرفًا).' });

  const historyIn = Array.isArray(req.body.history) ? req.body.history.slice(-MAX_HISTORY_MESSAGES) : [];
  const history = historyIn
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION_CHARS) }));

  const s = getSettings();
  const context = buildNetworkContext();
  const messages = [
    { role: 'system', content: systemPrompt(context) },
    ...history,
    { role: 'user', content: message },
  ];

  try {
    const reply = await callModel(s.base_url || DEFAULT_BASE_URL, s.api_key, s.model || DEFAULT_MODEL, messages);
    return res.json({
      success: true,
      reply,
      context_stats: {
        devices: context.devices.length,
        offline: (context.counts && context.counts.offline) || 0,
        events: context.recent_downtime_events.length,
      },
    });
  } catch (e) {
    return res.status(502).json({ success: false, error: friendlyModelError(e) });
  }
});

// جاهزية الشات: مفعّل + مفتاح موجود.
function checkReady() {
  const s = getSettings();
  return !!(s.enabled && s.api_key);
}

module.exports = router;
