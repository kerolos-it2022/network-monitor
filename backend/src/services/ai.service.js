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

// ── بناء «موجز السياق» من القاعدة ──
// AI-01 (SpaceKit): ترتيب **واقعيًّا** لا أبجديًّا (المتوقف ثم المتدهور ثم غير المعروف ثم المتصل)،
// مع عدد الأجهزة المُستبعَدة صراحةً، ووقت اللقطة ورقم الإصدار، وعطل مركزي جارٍ إن وُجد.
function buildNetworkContext() {
  const devices = db.prepare(`
    SELECT d.id, d.name, d.ip, d.current_status, d.host_status, d.overall_health,
           d.last_response_time_ms, d.last_checked_at, d.is_active, d.parent_id, d.web_port,
           (SELECT COUNT(*) FROM monitored_services s
             WHERE s.device_id = d.id AND s.is_enabled = 1 AND s.status = 'offline') AS services_down_count,
           t.name AS type_name, l.name AS location_name
    FROM devices d
    LEFT JOIN device_types t ON t.id = d.device_type_id
    LEFT JOIN locations l ON l.id = d.location_id
    ORDER BY
      CASE
        WHEN d.current_status = 'offline' THEN 0
        WHEN d.overall_health = 'degraded' THEN 1
        WHEN d.current_status = 'unknown' THEN 2
        ELSE 3
      END ASC,
      d.name COLLATE NOCASE ASC
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
      SUM(CASE WHEN current_status = 'unknown' THEN 1 ELSE 0 END) AS unknown,
      SUM(CASE WHEN overall_health = 'degraded' THEN 1 ELSE 0 END) AS degraded
    FROM devices WHERE is_active = 1
  `).get();
  // RCA — أعطال مركزية جارية (تُقدَّم كسياق مستهدف بدل الاعتماد على قائمة الأجهزة وحدها).
  let incidents = [];
  try {
    incidents = db.prepare(
      "SELECT id, root_device_id, kind, confidence, started_at, affected_json FROM incidents WHERE status = 'open' ORDER BY id DESC LIMIT 10"
    ).all().map((r) => {
      let affected = [];
      try { affected = JSON.parse(r.affected_json || '[]'); } catch (_) { affected = []; }
      return { id: r.id, kind: r.kind, confidence: r.confidence, started_at: r.started_at, affected_count: affected.length, affected_names: affected.slice(0, 8).map((a) => a.name) };
    });
  } catch (_) { incidents = []; }

  let version = null;
  try { version = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../package.json'), 'utf8')).version; } catch (_) { version = null; }

  return {
    snapshot_at: new Date().toISOString(),
    app_version: version,
    counts,
    // عدد الأجهزة التي لم تُدرَج في القائمة (شفافية بدل حدٍّ صامت) — AI-01.
    omitted_devices: Math.max(0, (counts.total || 0) - devices.length),
    context_limit: MAX_CONTEXT_DEVICES,
    devices,
    open_incidents: incidents,
    recent_downtime_events: events,
  };
}

// ═══ AI-02 — تنقيح السياق قبل أي إرسال لمزوّد خارجي ═══
// استبدال العناوين الداخلية وأسماء MAC برموز ثابتة (نفس العنوان ⇒ نفس الرمز داخل اللقطة)،
// وحذف أي مفتاح يشبه سرًّا. الأسماء المعروضة (alias) للمالك تبقى — فهي أساس فائدة التشخيص.
// الدالة **نقية** ⇒ قابلة للاختبار مباشرة.
const SECRET_KEY_RE = /(key|token|secret|password|passwd|authorization|cookie|credential|webhook|chat_id|api)/i;
function redactContext(ctx, enabled = true) {
  if (!enabled) return ctx;
  const ipTokens = new Map();
  const macTokens = new Map();
  const tokenFor = (map, value, prefix) => {
    if (!value) return value;
    if (!map.has(value)) map.set(value, prefix + '-' + (map.size + 1));
    return map.get(value);
  };
  const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
  const MAC_RE = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi;

  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEY_RE.test(k)) { out[k] = '[REDACTED]'; continue; }
        out[k] = walk(v);
      }
      return out;
    }
    if (typeof value === 'string') {
      let s = value.replace(MAC_RE, (m) => tokenFor(macTokens, m.toLowerCase(), 'mac'));
      s = s.replace(IPV4_RE, (m) => tokenFor(ipTokens, m, 'ip'));
      return s;
    }
    return value;
  };

  return {
    redacted: true,
    redaction_note: 'العناوين الداخلية وMAC مُستبدلة برموز (ip-1، mac-1…) — الأسماء المعروضة كما هي.',
    data: walk(ctx),
  };
}

// معاينة ما سيُرسَل فعلًا (نفس المنطق) — للعرض للمالك قبل أي استدعاء خارجي.
function privacyPreview() {
  const s = getSettings();
  const redacted = s.redact_internal == null ? true : !!s.redact_internal;
  const ctx = buildNetworkContext();
  const payload = redacted ? redactContext(ctx, true) : { redacted: false, data: ctx };
  const text = JSON.stringify(payload.data);
  return {
    redacted,
    chars: text.length,
    preview: text.slice(0, 4000),
    stats: {
      devices: ctx.devices.length,
      omitted_devices: ctx.omitted_devices,
      events: ctx.recent_downtime_events.length,
      incidents: ctx.open_incidents.length,
    },
  };
}

// AI-02 — تشخيص محلي بقواعد (بلا أي اتصال خارجي): يشرح أعلى الأعطال أولويةً.
function deterministicDiagnosis(ctxInput) {
  const ctx = ctxInput && ctxInput.devices ? ctxInput : buildNetworkContext();
  const offline = ctx.devices.filter((d) => d.current_status === 'offline');
  const degraded = ctx.devices.filter((d) => d.overall_health === 'degraded');
  const unknown = ctx.devices.filter((d) => d.current_status === 'unknown');
  const lines = [];
  lines.push(`📊 الشبكة الآن: ${ctx.counts.total} جهازًا — متصل ${ctx.counts.online} · متقطع ${ctx.counts.offline} · غير معروف ${ctx.counts.unknown} · متدهور ${ctx.counts.degraded || 0}.`);
  if (ctx.open_incidents && ctx.open_incidents.length) {
    const inc = ctx.open_incidents[0];
    lines.push(`🧠 عطل مركزي محتمل (#${inc.id}) يشمل ${inc.affected_count} جهازًا (ثقة: ${inc.confidence || 'غير محددة'}) — ابدأ بفحص الجهاز الأعلى قبل الأبناء.`);
  }
  if (offline.length) {
    lines.push('🔴 أعلى الأعطال أولويةً:');
    for (const d of offline.slice(0, 5)) {
      const ev = (ctx.recent_downtime_events || []).find((e) => Number(e.device_id) === Number(d.id) && !e.ended_at);
      const since = ev && ev.started_at ? ` (منذ ${new Date(ev.started_at).toLocaleString('ar')})` : '';
      lines.push(`   • ${d.name} — ${d.type_name || 'جهاز'} في ${d.location_name || 'بلا موقع'}${since}`);
    }
    if (offline.length > 5) lines.push(`   • و${offline.length - 5} جهازًا آخر منقطعًا.`);
  } else {
    lines.push('🟢 لا انقطاعات مسجّلة حاليًّا.');
  }
  if (degraded.length) {
    lines.push('🟡 أجهزة متصلة لكن بها خدمات متوقفة: ' + degraded.slice(0, 5).map((d) => `${d.name} (${d.services_down_count || 0})`).join(' · '));
  }
  if (ctx.omitted_devices) lines.push(`ℹ️ لم تُدرَج ${ctx.omitted_devices} جهازًا في اللقطة (الحد ${ctx.context_limit}).`);
  lines.push('ℹ️ هذه إجابة بقواعد محلية — لا تُرسَل أي بيانات خارج الجهاز. فعّل مزوّد AI لمزيد من التحليل.');
  return lines.join('\n');
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
  // AI-01/AI-02 (SpaceKit Phase 4)
  redactContext, privacyPreview, deterministicDiagnosis, MAX_CONTEXT_DEVICES,
};
