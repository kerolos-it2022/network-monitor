// ai.routes.js — 🤖 شات AI (v2.21.0، مُعاد هيكلته v2.25.0): محادثة عربية عن الشبكة
// بسياق من القاعدة المحلية. منطق النموذج انتقل إلى services/ai.service.js ليُعاد
// استخدامه (التقرير اليومي مثلًا) — هنا المسارات والقواعد فقط.
// أمن: requireAuth على كل المسارات + المفتاح يُقنَّع عند القراءة ولا يُمسح عند الحفظ الفارغ.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
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
  if (!ai.isReady()) {
    return res.status(400).json({ success: false, error: 'شات AI معطّل — فعّله واكتب مفتاح API من تبويب الشات أولاً.' });
  }
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'اكتب سؤالًا أولًا.' });
  if (message.length > MAX_QUESTION_CHARS) return res.status(400).json({ success: false, error: 'السؤال طويل جدًّا (الحد ' + MAX_QUESTION_CHARS + ' حرفًا).' });

  const historyIn = Array.isArray(req.body.history) ? req.body.history.slice(-MAX_HISTORY_MESSAGES) : [];
  const history = historyIn
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION_CHARS) }));

  const context = ai.buildNetworkContext();
  const messages = [
    { role: 'system', content: ai.systemPrompt(context) },
    ...history,
    { role: 'user', content: message },
  ];

  try {
    const reply = await ai.chatCompletion(messages);
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
    return res.status(502).json({ success: false, error: ai.friendlyModelError(e) });
  }
});

module.exports = router;
