// ai.service.js (v2.25.0) — الخدمة المشتركة لاستدعاء النموذج اللغوي.
// استُخرجت المنطق من ai.routes.js ليُعاد استخدامه خارج الشات (مثل: تحليل التقرير
// اليومي في smart-alerts). بقواعد v2.21.0 نفسها: بلا مفتاح = غير نشط صامتًا،
// أي endpoint متوافق OpenAI، مهلة 60ث، أخطاء مترجمة عربيًّا.
const db = require('../db');
// قرار المالك (2026-10-18): تحليل AI في التقرير اليومي يُبنى **بلغتين معًا** — both() يجمع التوأمين.
const { both } = require('./message-i18n.service');

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
// AI-01 : ترتيب **واقعيًّا** لا أبجديًّا (المتوقف ثم المتدهور ثم غير المعروف ثم المتصل)،
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
// قرار المالك (2026-10-18): تحليل التقرير اليومي يُرسَل باللغتين معًا، فالقواعد المحلية تبني
// **توأمين من نفس الحقائق المحسوبة** — والنصّ العربي أدناه حرفيًّا كما كان (لا يُعاد صياغته).

// enCount(n, word): صياغة إنجليزية سليمة للعدد (1 device · 4 devices) — للتوأم الإنجليزي وحده.
function enCount(n, word) { return n + ' ' + word + (Number(n) === 1 ? '' : 's'); }

// enStamp(date): طابع زمني إنجليزي حتمي بنفس صيغة رسائل النظام (nm-log-i18n · message-i18n.now):
// dd/mm/yyyy, h:mm:ss AM/PM — لا نستعمل now() لأنها تتبع لغة الإشعارات ونحن نحتاج اللغتين **معًا**.
function enStamp(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}, ` +
    `${h12}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${h24 < 12 ? 'AM' : 'PM'}`;
}

// deterministicDiagnosisBoth(ctxInput): التشخيص المحلي بقواعد بنسختَيه — يعيد both(ar, en) من نفس
// الحقائق، وكل سطر إنجليزي توأم السطر العربي المقابل. بلا شبكة إطلاقًا (وضع «بلا مفتاح» الآمن).
function deterministicDiagnosisBoth(ctxInput) {
  const ctx = ctxInput && ctxInput.devices ? ctxInput : buildNetworkContext();
  const offline = ctx.devices.filter((d) => d.current_status === 'offline');
  const degraded = ctx.devices.filter((d) => d.overall_health === 'degraded');
  const unknown = ctx.devices.filter((d) => d.current_status === 'unknown');
  const arLines = [];
  const enLines = [];
  arLines.push(`📊 الشبكة الآن: ${ctx.counts.total} جهازًا — متصل ${ctx.counts.online} · متقطع ${ctx.counts.offline} · غير معروف ${ctx.counts.unknown} · متدهور ${ctx.counts.degraded || 0}.`);
  enLines.push(`📊 Network now: ${enCount(ctx.counts.total, 'device')} — online ${ctx.counts.online} · offline ${ctx.counts.offline} · unknown ${ctx.counts.unknown} · degraded ${ctx.counts.degraded || 0}.`);
  if (ctx.open_incidents && ctx.open_incidents.length) {
    const inc = ctx.open_incidents[0];
    arLines.push(`🧠 عطل مركزي محتمل (#${inc.id}) يشمل ${inc.affected_count} جهازًا (ثقة: ${inc.confidence || 'غير محددة'}) — ابدأ بفحص الجهاز الأعلى قبل الأبناء.`);
    enLines.push(`🧠 Likely central fault (#${inc.id}) affecting ${enCount(inc.affected_count, 'device')} (confidence: ${inc.confidence || 'unspecified'}) — start by checking the top device before its children.`);
  }
  if (offline.length) {
    arLines.push('🔴 أعلى الأعطال أولويةً:');
    enLines.push('🔴 Top-priority outages:');
    for (const d of offline.slice(0, 5)) {
      const ev = (ctx.recent_downtime_events || []).find((e) => Number(e.device_id) === Number(d.id) && !e.ended_at);
      const since = ev && ev.started_at ? ` (منذ ${new Date(ev.started_at).toLocaleString('ar')})` : '';
      const sinceEn = ev && ev.started_at ? ` (since ${enStamp(new Date(ev.started_at))})` : '';
      arLines.push(`   • ${d.name} — ${d.type_name || 'جهاز'} في ${d.location_name || 'بلا موقع'}${since}`);
      enLines.push(`   • ${d.name} — ${d.type_name || 'device'} at ${d.location_name || 'no location'}${sinceEn}`);
    }
    if (offline.length > 5) {
      arLines.push(`   • و${offline.length - 5} جهازًا آخر منقطعًا.`);
      enLines.push(`   • and ${enCount(offline.length - 5, 'more device')} offline.`);
    }
  } else {
    arLines.push('🟢 لا انقطاعات مسجّلة حاليًّا.');
    enLines.push('🟢 No outages recorded right now.');
  }
  if (degraded.length) {
    arLines.push('🟡 أجهزة متصلة لكن بها خدمات متوقفة: ' + degraded.slice(0, 5).map((d) => `${d.name} (${d.services_down_count || 0})`).join(' · '));
    enLines.push('🟡 Devices online but with services down: ' + degraded.slice(0, 5).map((d) => `${d.name} (${d.services_down_count || 0})`).join(' · '));
  }
  if (ctx.omitted_devices) {
    arLines.push(`ℹ️ لم تُدرَج ${ctx.omitted_devices} جهازًا في اللقطة (الحد ${ctx.context_limit}).`);
    enLines.push(`ℹ️ ${enCount(ctx.omitted_devices, 'device')} omitted from the snapshot (limit ${ctx.context_limit}).`);
  }
  arLines.push('ℹ️ هذه إجابة بقواعد محلية — لا تُرسَل أي بيانات خارج الجهاز. فعّل مزوّد AI لمزيد من التحليل.');
  enLines.push('ℹ️ This is a local-rules answer — no data leaves the device. Enable an AI provider for deeper analysis.');
  return both(arLines.join('\n'), enLines.join('\n'));
}

// deterministicDiagnosis(ctxInput): الواجهة السابقة نفسها — النصّ العربي وحده (شات /api/ai/chat).
function deterministicDiagnosis(ctxInput) {
  return deterministicDiagnosisBoth(ctxInput).ar;
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

// ── تحليل التقرير اليومي (v2.25.0 · بلغتين من 2026-10-18) ──
// فاصل التوأمة بين النصّين في ردّ المزوّد الواحد — يُقتطع قبل العرض فلا يظهر للمستخدم أبدًا.
const AI_BI_MARKER = '<<<EN>>>';

// splitBilingualReply(reply): يقسم ردّ المزوّد الواحد إلى { ar, en } حول الفاصل الحرفي:
//   • الفاصل موجود ⇒ العربي ما قبله والإنجليزي ما بعده، ويُحذف الفاصل (ولو تكرّر) من الاثنين.
//   • بلا فاصل ⇒ نصّ واحد يُصنَّف بلغته (حروف عربية ⇒ عربي وإلا إنجليزي) والطرف الآخر null؛
//     والمتلقّي يُكمِل الناقص بنصّ القواعد المحلية بلغته (تدهور مرن بلا فاصل ولا كتلة فارغة).
function splitBilingualReply(reply) {
  const raw = String(reply == null ? '' : reply);
  const strip = (s) => s.split(AI_BI_MARKER).join(' ').trim();
  const idx = raw.indexOf(AI_BI_MARKER);
  if (idx === -1) {
    const whole = strip(raw);
    if (!whole) return { ar: null, en: null };
    return /[\u0600-\u06FF]/.test(whole) ? { ar: whole, en: null } : { ar: null, en: whole };
  }
  const ar = strip(raw.slice(0, idx));
  const en = strip(raw.slice(idx + AI_BI_MARKER.length));
  return { ar: ar || null, en: en || null };
}

// analyzeDailyReport(reportPlainText) — تحليل قصير للتقرير اليومي **بلغتين معًا** (≤3 جمل + توصية لكل لغة).
// قرار المالك (2026-10-18): قارئا التقرير مختلفان ⇒ **استدعاء واحد** يطلب النصّين مفصولين بالفاصل
// الحرفي أعلاه. يعيد { ar, en } كلاهما غير فارغ — أو null عند أي فشل (التقرير العادي لا يتأثر أبدًا).
// تدهور مرن: طرف ناقص (فاصل مفقود/جزء واحد/فراغ) يُكمَل بنصّ القواعد المحلية بلغته — بلا شبكة.
async function analyzeDailyReport(reportPlainText, timeoutMs = 45000) {
  if (!isReady()) return null;
  const messages = [
    { role: 'system', content: [
      'أنت محلل شبكة عربي داخل نظام مراقبة. صِل أحكامك من النص المعطى فقط ولا تخترع أرقامًا.',
      'اكتب تحليلًا عربيًّا من 3 جمل كحد أقصى: ملاحظة أهم نمط، ثم توصية عملية واحدة بالفعل.',
      'بدايةً بنص مثل: «📌 الملاحظة: …» ثم «💡 التوصية: …». بلا مقدمات أو مجاملات.',
      'ثم اكتب سطرًا مستقلًّا وحده فيه الفاصل الحرفي الآتي دون أي تغيير: ' + AI_BI_MARKER,
      'وبعده مباشرة اكتب التحليل الإنجليزي المكافئ (3 جمل كحد أقصى) بنفس البنية: "📌 Note: …" ثم "💡 Recommendation: …".',
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
    if (!reply) return null;
    const parts = splitBilingualReply(reply);
    const fallback = (parts.ar && parts.en) ? null : deterministicDiagnosisBoth();
    return {
      ar: String(parts.ar || fallback.ar).trim().slice(0, 700),
      en: String(parts.en || fallback.en).trim().slice(0, 700),
    };
  } catch (e) {
    return null; // التقرير أولاً — التحليل ميزة إضافية لا شرط
  }
}

module.exports = {
  DEFAULT_BASE_URL, DEFAULT_MODEL, CHAT_TIMEOUT_MS,
  getSettings, isReady, buildNetworkContext, systemPrompt,
  callModel, friendlyModelError, chatCompletion, analyzeDailyReport,
  // AI-01/AI-02
  redactContext, privacyPreview, deterministicDiagnosis, MAX_CONTEXT_DEVICES,
  // قرار المالك (2026-10-18): التقرير اليومي بلغتين — التوأم المحلي وفاصل القسمة.
  deterministicDiagnosisBoth, splitBilingualReply, AI_BI_MARKER,
};
