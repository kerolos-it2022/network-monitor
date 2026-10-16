// ai.routes.js — 🤖 شات AI (v2.21.0، مُعاد هيكلته v2.25.0): محادثة عربية عن الشبكة
// بسياق من القاعدة المحلية. منطق النموذج انتقل إلى services/ai.service.js ليُعاد
// استخدامه (التقرير اليومي مثلًا) — هنا المسارات والقواعد فقط.
// أمن: requireAuth على كل المسارات + المفتاح يُقنَّع عند القراءة ولا يُمسح عند الحفظ الفارغ.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const audit = require('../services/audit.service');
const ai = require('../services/ai.service');

const router = express.Router();

const DEFAULT_BASE_URL = ai.DEFAULT_BASE_URL;
const DEFAULT_MODEL = ai.DEFAULT_MODEL;
const MAX_HISTORY_MESSAGES = 10;          // آخر رسائل المحادثة المُرسلة من الواجهة
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
      // AI-02 — تنقيح العناوين/MAC مفعّل افتراضيًّا قبل أي إرسال خارجي.
      redact_internal: s.redact_internal == null ? 1 : (s.redact_internal ? 1 : 0),
    },
  });
});

// PUT /api/ai/settings 🔒 — كنمط الإشعارات: المفتاح الفارغ لا يمسح الموجود (null يمسحه).
router.put('/settings', requireAuth, (req, res) => {
  const { enabled, api_key, base_url, model, redact_internal } = req.body || {};
  const current = getSettings();
  let newKey = current.api_key || null;
  if (api_key === null) newKey = null;
  else if (typeof api_key === 'string' && api_key.trim() !== '') newKey = api_key.trim();
  const newRedact = redact_internal === undefined
    ? (current.redact_internal == null ? 1 : (current.redact_internal ? 1 : 0))
    : (redact_internal ? 1 : 0);
  db.prepare('UPDATE ai_settings SET enabled = ?, api_key = ?, base_url = ?, model = ?, redact_internal = ? WHERE id = 1').run(
    enabled ? 1 : 0,
    newKey,
    (typeof base_url === 'string' && base_url.trim() !== '') ? base_url.trim() : DEFAULT_BASE_URL,
    (typeof model === 'string' && model.trim() !== '') ? model.trim() : DEFAULT_MODEL,
    newRedact,
  );
  const s = getSettings();
  return res.json({
    success: true,
    data: {
      enabled: !!s.enabled,
      api_key_masked: maskKey(s.api_key),
      base_url: s.base_url,
      model: s.model,
      has_key: !!s.api_key,
      redact_internal: s.redact_internal == null ? 1 : (s.redact_internal ? 1 : 0),
    },
  });
});

// GET /api/ai/context-preview 🔒(admin) — AI-02: معاينة **ما سيُرسَل فعلًا** لمزوّد خارجي
// (بعد التنقيح) قبل تفعيل أي استدعاء — للمراجعة والشفافية.
router.get('/context-preview', requireAuth, requireRole('admin'), (req, res) => {
  const preview = ai.privacyPreview();
  audit.record('ai_context_preview', req, { details: { redacted: preview.redacted, chars: preview.chars } });
  res.json({ success: true, data: preview });
});

// POST /api/ai/chat 🔒 — { message, history? } ⇒ { reply, mode, context_stats }
// AI-02: بلا مزوّد فعلّي ⇒ إجابة **بقواعد محلية** بلا أي إرسال خارجي (بدل خطأ)،
// ومع مزوّد ⇒ يُرسَل سياق **منقّح** (إلا إن أوقف المالك التنقيح صراحةً).
router.post('/chat', requireAuth, async (req, res) => {
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'اكتب سؤالًا أولًا.' });
  if (message.length > MAX_QUESTION_CHARS) return res.status(400).json({ success: false, error: 'السؤال طويل جدًّا (الحد ' + MAX_QUESTION_CHARS + ' حرفًا).' });

  const settings = getSettings();
  const context = ai.buildNetworkContext();
  const redacted = settings.redact_internal == null ? true : !!settings.redact_internal;

  if (!ai.isReady()) {
    // تشخيص محلي حتمي — صفر اتصال خارجي.
    const reply = ai.deterministicDiagnosis(context);
    audit.record('ai_chat_rules_mode', req, { details: { reason: 'provider-not-configured' } });
    return res.json({
      success: true,
      mode: 'rules',
      reply,
      context_stats: {
        devices: context.devices.length,
        offline: (context.counts && context.counts.offline) || 0,
        events: context.recent_downtime_events.length,
        omitted_devices: context.omitted_devices,
        redacted: false,
      },
    });
  }

  const historyIn = Array.isArray(req.body.history) ? req.body.history.slice(-MAX_HISTORY_MESSAGES) : [];
  const history = historyIn
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION_CHARS) }));

  const contextForModel = redacted ? ai.redactContext(context, true).data : context;
  const messages = [
    { role: 'system', content: ai.systemPrompt(contextForModel) },
    ...history,
    { role: 'user', content: message },
  ];

  try {
    const reply = await ai.chatCompletion(messages);
    audit.record('ai_chat_external', req, { details: { redacted, devices: context.devices.length, model: settings.model } });
    return res.json({
      success: true,
      mode: 'model',
      reply,
      context_stats: {
        devices: context.devices.length,
        offline: (context.counts && context.counts.offline) || 0,
        events: context.recent_downtime_events.length,
        omitted_devices: context.omitted_devices,
        redacted,
      },
    });
  } catch (e) {
    return res.status(502).json({ success: false, error: ai.friendlyModelError(e) });
  }
});

module.exports = router;
