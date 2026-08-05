// scan-scheduler.routes.js (v2.5.0)
// ─────────────────────────────────────────────────────────────
// مسارات API لِـ إدارة المسح الدوري (settings CRUD + start/stop + سِجل المسحات).
// المنطق الفِعلي يَعيش في services/scan-scheduler.service.js (نَلتزم بِـ separation:
// routes = HTTP فقط، service = منطق التَشغيل + setInterval).
// كل المسارات محميّة بالـ requireAuth (مدير فقط) ما عدا /status (للعرض العام).
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const scheduler = require('../services/scan-scheduler.service');

// GET /api/scan-scheduler/settings — إعدادات المسح الدوري.
router.get('/settings', requireAuth, (req, res) => {
  try {
    const settings = scheduler.getSettings();
    res.json({ success: true, data: settings || {} });
  } catch (e) {
    res.status(500).json({ success: false, error: 'فشل قراءة إعدادات المسح: ' + e.message });
  }
});

// PUT /api/scan-scheduler/settings — تَحديث الإعدادات (enabled, interval_minutes, subnets, ...).
// أَيّ تَغيير يُعيد تَشغيل الـ interval تلقائيًّا لو enabled=1.
router.put('/settings', requireAuth, (req, res) => {
  try {
    const patch = req.body || {};
    const updated = scheduler.updateSettings(patch);

    // إِعادة start/stop تَلقائيًّا حَسب enabled.
    if (updated.enabled === 1) {
      const started = scheduler.startInterval();
      if (!started) {
        return res.status(400).json({
          success: false,
          error: 'تعذّر بدء المُجدوِل — تأكد من ضبط subnets (لا يمكن أن تكون فارغة).',
          data: updated,
        });
      }
    } else {
      scheduler.stopInterval();
    }

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: 'فشل تحديث إعدادات المسح: ' + e.message });
  }
});

// POST /api/scan-scheduler/start — بَدء المسح الدوري (enabled=1 فعليًّا من settings، ثم startInterval).
router.post('/start', requireAuth, (req, res) => {
  try {
    scheduler.updateSettings({ enabled: 1 });
    const ok = scheduler.startInterval();
    if (!ok) {
      return res.status(400).json({ success: false, error: 'تعذّر بدء المسح — تأكد من ضبط subnets.' });
    }
    res.json({ success: true, message: 'بدأ المسح الدوري.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/scan-scheduler/stop — إيقاف المسح الدوري (enabled=0 + stopInterval).
router.post('/stop', requireAuth, (req, res) => {
  try {
    scheduler.updateSettings({ enabled: 0 });
    scheduler.stopInterval();
    res.json({ success: true, message: 'أُوقف المسح الدوري.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/scan-scheduler/run-now — شَغّل مسحاً فوريًّا على subnets المُهَيَّأة (لا يَنتظر interval).
router.post('/run-now', requireAuth, (req, res) => {
  try {
    if (scheduler.isRunning()) {
      return res.status(409).json({ success: false, error: 'هناك مسح جارٍ بالفعل — انتظره.' });
    }
    // fire-and-forget: نَردّ فورًا، النتيجة في /runs History
    scheduler.runScheduledScan().catch((e) => {
      console.error('[SCHEDULER] /run-now error:', e.message);
    });
    res.json({ success: true, message: 'بدأ المسح الفوري — ترقّب النتائج في سِجل المسحات.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/scan-scheduler/status — حالة المُجدوِل الحالية (آخر نَتيجة + is_running).
// يُسمح به للعرض العام (لا يُكشِف credentials) — لكن نَحميه بـ requireAuth للأمان.
router.get('/status', requireAuth, (req, res) => {
  try {
    const settings = scheduler.getSettings() || {};
    res.json({
      success: true,
      data: {
        enabled: settings.enabled === 1,
        interval_minutes: settings.interval_minutes,
        subnets: settings.subnets,
        is_running: scheduler.isRunning(),
        last_run: scheduler.getLastRunSummary(),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/scan-scheduler/runs — سِجل المسحات السابقة (آخر 50).
router.get('/runs', requireAuth, (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const rows = require('../db').prepare(
      `SELECT id, subnet, started_at, ended_at, devices_found, devices_added, devices_lost, status, error_message
       FROM scan_runs ORDER BY started_at DESC LIMIT ?`
    ).all(limit);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
