// telegram-bot.service.js (v2.14.0) — «البوت اللي بيسمع».
// ─────────────────────────────────────────────────────────────
// حتى الآن البوت كان يرسل فقط (sendMessage عبر notifier). هذه الخدمة تضيف الاستقبال:
//   • حلقة Long Polling على getUpdates — تعمل خلف أي جدار ناري بلا IP عام أو webhook
//     (القرار: webhook هش على الأبلاينس لأنه يتعلق بدومين عام قابل للتغير).
//   • أوامر نصية: /status · /down · /recent · /help — وأزرار مضمّنة (Inline Keyboard)
//     تُضاف تحت رسائل الانقطاع/الاسترجاع (callback_data بقسمة 'cmd:...') في notifier.
//   • أمان: يرد **فقط** على chat_id المصرَّح به في إعدادات الإشعارات (قاعدة ثم .env) —
//     أي حساب آخر يتجاهل تمامًا (البوت يبحث عنه بالاسم فهي حماية أساسية المطلوبة).
//   • خصوصية التشغيل: تعمل فقط لو TELEGRAM token + chat_id موجودان وtelegram_enabled=1؛
//     أي فشل شبكي = تراجع زمني (3 ثوانٍ) بلا توقف للخادم.
//   • ملاحظة تشغيلية: عميل واحد فقط لكل توكن (طبيعة getUpdates — لو جهازان على نفس
//     البوت تتقاسمان الرسائل بالتناوب) — البوت مخصص لجهاز المنشأة الواحد.
const axios = require('axios');
const db = require('../db');
const { getSettings } = require('./notifier.service');
const { msg, pick, now } = require('./message-i18n.service');
// نصّ حالة البوت الذي يُقرأ في تبويب حالة النظام — بلغة الواجهة (لا بلغة الإشعارات).
const { uiText } = require('./ui-text.service');

let running = false;
let offset = 0;
let unauthorizedWarnedAt = 0;

// v2.33.0 — حالة مرئية للمالك (مؤشر «البوت شغّال / واقف» في تبويب حالة النظام):
//   mode: 'idle'    = لم تبدأ الحلقة بعد
//         'waiting' = القناة معطّلة أو الاعتمادات ناقصة (الحلقة تفحص كل 10 ثوانٍ)
//         'running' = يستمع فعليًّا (Long Polling)
let botMode = 'idle';
let startedAt = null;      // لحظة بدء الحلقة
let lastPollAt = null;     // آخر محاولة استقبال (نجحت أو فشلت)
let lastPollOk = null;     // هل آخر محاولة نجحت؟
let lastError = null;      // آخر خطأ (نصّ مختصر)
let updatesHandled = 0;    // عدد التحديثات (أوامر/أزرار) المُعالَجة منذ الإقلاع
let commandsEnabled = false;

// esc(s): ترميز HTML لأسماء الأجهزة (وضع parse_mode:'HTML' في تلجرام).
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// stamp(v): طابع زمني يتبع لغة الإشعارات — نُفوّضه لدالة message-i18n.now (مصدر واحد للتنسيق،
// فيتطابق ما يُرسَل في البوت مع ما يبنيه باقي النظام ومع ما يعرضه السجل).
function stamp(v) {
  return now(new Date(v));
}

// v2.14.2 — proxyTelegram(): توكيل اختياري من .env (TELEGRAM_PROXY=http://host:port)
// لشبكات تمنع/تبطئ api.telegram.org — axios يدعم http/https proxy بلا مكتبات إضافية.
function proxyConfig() {
  const raw = (process.env.TELEGRAM_PROXY || '').trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol.startsWith('http')) return { protocol: u.protocol.replace(':', ''), host: u.hostname, port: Number(u.port) || 8080 };
  } catch (e) { /* راجع صيغة TELEGRAM_PROXY */ }
  return undefined;
}

// api(method, payload): نداء موحد لواجهة البوت.
async function api(token, method, payload, timeoutMs = 35000) {
  const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: timeoutMs, proxy: proxyConfig() });
  if (!res.data || !res.data.ok) throw new Error(`Telegram ${method}: ${(res.data && res.data.description) || uiText('رد غير متوقع', 'unexpected response')}`);
  return res.data;
}

// tgButtons(): لوحة الأزرار المضمّنة القياسية لأوامر الاستعلام.
// تسميات الأزرار تتبع لغة الإشعارات (عربي/إنجليزي) — callback_data ثابت لا يتغيّر.
function tgButtons() {
  return {
    inline_keyboard: [
      [
        { text: pick('🌐 الحالة الآن', '🌐 Status now'), callback_data: 'cmd:status' },
        { text: pick('🔴 المنقطعون', '🔴 Down devices'), callback_data: 'cmd:down' },
      ],
      [
        { text: pick('📊 آخر الانقطاعات', '📊 Recent outages'), callback_data: 'cmd:recent' },
        { text: pick('❓ الجدول', '❓ Commands'), callback_data: 'cmd:help' },
      ],
    ],
  };
}

// cmdStatus(): ملخص الحالة الآن (نفس أرقام NOC).
// الرد بلغة الإشعارات — نفس الأسطر والوسوم والترتيب بلغة واحدة.
function cmdStatus() {
  const d = db.prepare(
    "SELECT current_status s, COUNT(*) n FROM devices WHERE is_active = 1 GROUP BY current_status"
  ).all();
  const m = Object.fromEntries(d.map((r) => [r.s, r.n]));
  const up = m.online || 0, down = m.offline || 0, unk = m.unknown || 0, paused = m.paused || 0;
  const total = up + down + unk + paused;
  return msg(
    `🌐 <b>حالة الشبكة الآن</b>\n` +
    `الإجمالي: <b>{total}</b> جهاز\n` +
    `🟢 متصل: <b>{up}</b>\n` +
    `🔴 متوقف: <b>{down}</b>\n` +
    `⚪ غير معروف: {unk}` + (paused ? `\n⏸️ موقوف: {paused}` : ''),
    `🌐 <b>Network status now</b>\n` +
    `Total: <b>{total}</b> devices\n` +
    `🟢 Online: <b>{up}</b>\n` +
    `🔴 Offline: <b>{down}</b>\n` +
    `⚪ Unknown: {unk}` + (paused ? `\n⏸️ Paused: {paused}` : ''),
    { total, up, down, unk, paused }
  );
}

// cmdDown(): قائمة الأجهزة المتوقفة الآن مع بداية الانقطاع المفتوح.
// الرد بلغة الإشعارات — أسماء الأجهزة والـIP كما هي، والأعمار بالوحدات المختصرة نفسها.
function cmdDown() {
  const rows = db.prepare(`
    SELECT d.name, d.ip, de.started_at
    FROM devices d
    LEFT JOIN downtime_events de ON de.device_id = d.id AND de.ended_at IS NULL
    WHERE d.is_active = 1 AND d.current_status = 'offline'
    ORDER BY de.started_at IS NULL, de.started_at ASC
  `).all();
  if (rows.length === 0) return pick('🟢 مفيش أي جهاز متوقف — الشبكة كاملة!', '🟢 No devices are down — the whole network is up!');
  const lines = rows.map((r) => {
    let age = '';
    if (r.started_at) {
      const mins = Math.max(0, Math.floor((Date.now() - new Date(r.started_at).getTime()) / 60000));
      age = mins < 1 ? pick(' (لحظات)', ' (just now)')
        : mins < 60 ? msg(' ({n} دقيقة)', ' ({n} min)', { n: mins })
        : mins < 1440 ? msg(' ({h} س {m} د)', ' ({h} h {m} min)', { h: Math.floor(mins / 60), m: mins % 60 })
        : msg(' ({d} يوم {h} س)', ' ({d} d {h} h)', { d: Math.floor(mins / 1440), h: Math.floor((mins % 1440) / 60) });
    }
    return `🔴 <b>${esc(r.name)}</b> — <code>${esc(r.ip)}</code>${age}`;
  });
  return msg(`🔴 <b>الأجهزة المتوقفة ({n}):</b>\n`, `🔴 <b>Down devices ({n}):</b>\n`, { n: rows.length }) + lines.join('\n');
}

// cmdRecent(): آخر 10 انقطاعات مغلقة من downtime_events.
// الرد بلغة الإشعارات — التاريخ يتبع اللغة (عربي كما كان · إنجليزي بتنسيق الواجهة)، والاسم/الـIP كما هما.
function cmdRecent() {
  const rows = db.prepare(`
    SELECT d.name, d.ip, de.started_at, de.ended_at
    FROM downtime_events de
    LEFT JOIN devices d ON d.id = de.device_id
    WHERE de.ended_at IS NOT NULL
    ORDER BY de.ended_at DESC
    LIMIT 10
  `).all();
  if (rows.length === 0) return pick('📊 لا توجد انقطاعات مسجلة بعد.', '📊 No outages recorded yet.');
  const mins = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
  const lines = rows.map((r) =>
    `<b>${esc((r && r.name) || pick('جهاز محذوف', 'deleted device'))}</b> — ${esc((r && r.ip) || '?')} · ` +
    `${stamp(r.ended_at)} · ` + msg('دام {n} د', 'lasted {n} min', { n: mins(r.started_at, r.ended_at) })
  );
  return pick(`📊 <b>آخر 10 انقطاعات:</b>\n`, `📊 <b>Last 10 outages:</b>\n`) + lines.join('\n');
}

// cmdHelp(): جدول الأوامر.
// الجدول كامل بلغة الإشعارات — أسماء الأوامر نفسها (/status…) لا تُترجم.
function cmdHelp() {
  return pick(
    '🤖 <b>أوامر بوت المراقبة:</b>\n' +
    '/status — الحالة الآن\n' +
    '/down — الأجهزة المتوقفة\n' +
    '/recent — آخر 10 انقطاعات\n' +
    '/help — هذا الجدول\n\n' +
    'الأزرار تحت رسائل الانقطاع تنفّذ نفس الأوامر بضغطة واحدة.',
    '🤖 <b>Monitoring bot commands:</b>\n' +
    '/status — Status now\n' +
    '/down — Down devices\n' +
    '/recent — Last 10 outages\n' +
    '/help — This list\n\n' +
    'The buttons under outage messages run the same commands with one tap.'
  );
}

// handleCommand(cmd): يربط الأمر/الزر بالدالة المناسبة.
function handleCommand(cmd) {
  switch (String(cmd || '').trim().toLowerCase().replace(/^\//, '').split('@')[0]) {
    case 'status': return cmdStatus();
    case 'down': return cmdDown();
    case 'recent': return cmdRecent();
    case 'help': case 'start': return cmdHelp();
    default: return null;
  }
}

// handleUpdate(u): معالجة تحديث واحد (رسالة أو زر) بصلاحيات المحادثة المصرحة.
async function handleUpdate(u, token, chatId) {
  const msg = u.message;
  const cb = u.callback_query;
  let text = null, chatIdIn = null;

  if (cb) {
    chatIdIn = cb.message && cb.message.chat && cb.message.chat.id;
    text = cb.data; // 'cmd:status' مثلاً
    // إقرار الضغط (يوقف الساعة الدوارة في تلجرام) — لا يوقف المسار لو فشل.
    try { await api(token, 'answerCallbackQuery', { callback_query_id: cb.id }, 8000); } catch (e) {}
  } else if (msg) {
    chatIdIn = msg.chat && msg.chat.id;
    text = msg.text || '';
  }
  if (text == null || chatIdIn == null) return;

  // الصلاحية: chat_id المصرح فقط — الباقي يُتجاهل (سجل تحذير كل 10 دقائق كحد أقصى).
  if (String(chatIdIn) !== String(chatId)) {
    const now = Date.now();
    if (now - unauthorizedWarnedAt > 10 * 60000) {
      unauthorizedWarnedAt = now;
      console.warn(`[tg-bot] تجاهل محاولة من chat_id=${chatIdIn} (غير مصرح)`);
    }
    return;
  }

  const cmd = String(text).replace(/^cmd:/, '').trim();
  if (/^\//.test(cmd) || cb) {
    const reply = handleCommand(cmd);
    if (reply) {
      await api(token, 'sendMessage', {
        chat_id: chatIdIn, text: reply, parse_mode: 'HTML',
        reply_markup: tgButtons(), disable_web_page_preview: true,
      }, 10000);
    } else if (msg && /^\//.test(String(msg.text || '').trim())) {
      // خطأ الأمر غير المعروف بلغة الإشعارات (pick — الاسم msg محجوب برسالة التحديث أعلاه).
      await api(token, 'sendMessage', {
        chat_id: chatIdIn, text: pick('🤖 أمر غير معروف — اكتب /help', '🤖 Unknown command — type /help'), parse_mode: 'HTML',
      }, 10000);
    }
  }
}

// startTelegramBot(): يُستدعى مرة عند بدء الخادم — حلقة استمرار طويلة تلقائية.
// شروط العمل: توكن + chat_id (قاعدة أو .env) + telegram_enabled من لوحة التحكم.
async function startTelegramBot() {
  if (running) return;
  let s;
  try { s = await getSettings(); } catch (e) { console.warn('[tg-bot] تعذّر قراءة الإعدادات:', e.message); return; }
  let token = s.telegram_bot_token;
  let chatId = s.telegram_chat_id;
  startedAt = startedAt || Date.now();
  if (!s.telegram_enabled || !token || !chatId) {
    botMode = 'waiting';
    commandsEnabled = !!Number(s.bot_commands_enabled === undefined ? 1 : s.bot_commands_enabled);
    console.log('[tg-bot] بدء متوقف مؤقتًا (القناة معطلة أو اعتمادات ناقصة) — الحلقة ستفحص كل دورة وتُشغّل ذاتها تلقائيًا عند التفعيل.');
    // نبدأ الحلقة بوضع خامل: تفحص المفاتيح كل دورة دون استهلاك تحديثات.
    token = token || ''; chatId = chatId || '';
    running = true;
    (async () => {
      while (running) {
        try {
          const cs = await getSettings();
          if (!cs.telegram_enabled || !cs.telegram_bot_token || !cs.telegram_chat_id ||
              !Number(cs.bot_commands_enabled === undefined ? 1 : cs.bot_commands_enabled)) {
            await new Promise((r) => setTimeout(r, 10000));
            continue;
          }
          token = cs.telegram_bot_token; chatId = cs.telegram_chat_id;
          commandsEnabled = true;
          botMode = 'running';
          break;
        } catch (e) { await new Promise((r) => setTimeout(r, 10000)); }
      }
      try { await api(token, 'deleteWebhook', { drop_pending_updates: false }, 10000); } catch (e) {}
      console.log('[tg-bot] البوت بدأ الاستماع (Long Polling) للأوامر: /status /down /recent /help');
      loop(token, chatId).catch((e) => { console.error('[tg-bot] توقفت الحلقة:', e.message); });
    })();
    return;
  }

  // تلجرام يرفض getUpdates لو webhook مفعّل — نلغيه بحذر (بلا انفجار لو مفيش webhook).
  try { await api(token, 'deleteWebhook', { drop_pending_updates: false }, 10000); } catch (e) { /* تجاهل */ }

  const loop = async (tk, chId) => {
    while (running) {
      try {
        // v2.14.2 — مفتاح البوت التفاعلي يُقرأ حيًا كل دورة: إطفاؤه من اللوحة يوقف الردود
        // خلال ~10 ثوانٍ بلا إعادة تشغيل (ولا يستهلك updates أثناء التعطيل).
        try {
          const r = db.prepare('SELECT bot_commands_enabled FROM notification_settings WHERE id = 1').get();
          if (r && !Number(r.bot_commands_enabled)) { await new Promise((res) => setTimeout(res, 10000)); continue; }
        } catch (e) { /* جدول/عمود غير جاهز بعد ⇒ نكمل */ }
        const data = await api(tk, 'getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        }, 35000);
        lastPollAt = Date.now(); lastPollOk = true; lastError = null;
        const updates = data.result || [];
        for (const u of updates) {
          offset = Math.max(offset, Number(u.update_id || 0) + 1);
          updatesHandled += 1;
          try { await handleUpdate(u, tk, chId); }
          catch (e) { console.error('[tg-bot] خطأ معالجة تحديث:', e.message); }
        }
      } catch (e) {
        // انقطاع شبكة/سهم مؤقت ⇒ تراجع قصير (أطول لو 409: عميل آخر على نفس التوكن).
        const conflict = /409/.test(String(e.message));
        lastPollAt = Date.now(); lastPollOk = false;
        lastError = (conflict
          ? uiText('التوكن مستخدم من عميل آخر: ', 'Token is in use by another client: ')
          : uiText('خطأ شبكة: ', 'Network error: ')) + String(e.message || '').slice(0, 160);
        console.error('[tg-bot]', conflict ? 'توكن مستخدم من عميل آخر — تأخير أطول' : 'خطأ شبكة — إعادة محاولة', e.message);
        await new Promise((r) => setTimeout(r, conflict ? 30000 : 5000));
      }
    }
  };
  // v2.14.2 — مسار البدء المباشر: القناة مفعّلة والاعتمادات جاهزة عند الإقلاع.
  running = true;
  botMode = 'running';
  commandsEnabled = true;
  console.log('[tg-bot] البوت بدأ الاستماع (Long Polling) للأوامر: /status /down /recent /help');
  loop(token, chatId).catch((e) => { console.error('[tg-bot] توقفت الحلقة:', e.message); });
}

// getBotStatus(): لقطة حالة البوت للواجهة (قراءة ذاكرة + قراءة إعدادات فقط — بلا شبكة ولا كتابة).
// تُقرأ القناة/المفتاح/الـ chat من الإعدادات أيضًا كي يعرف المالك **سبب** التوقف لا مجرّد أنه متوقف.
function getBotStatus() {
  let enabled = false, commandsOn = false, hasToken = false, hasChat = false;
  try {
    const r = db.prepare('SELECT telegram_enabled, bot_commands_enabled, telegram_bot_token, telegram_chat_id FROM notification_settings WHERE id = 1').get();
    if (r) {
      enabled = !!Number(r.telegram_enabled);
      commandsOn = r.bot_commands_enabled === undefined ? true : !!Number(r.bot_commands_enabled);
      hasToken = !!String(r.telegram_bot_token || '').trim();
      hasChat = !!String(r.telegram_chat_id || '').trim();
    }
  } catch (e) { /* جدول/عمود غير جاهز بعد */ }
  const listening = running && botMode === 'running' && enabled && commandsOn && hasToken && hasChat;
  return {
    running: running,
    listening: listening,
    mode: !running ? 'idle' : (listening ? 'running' : 'waiting'),
    startedAt: startedAt,
    lastPollAt: lastPollAt,
    lastPollOk: lastPollOk,
    lastError: lastError,
    updatesHandled: updatesHandled,
    telegramEnabled: enabled,
    commandsEnabled: commandsOn,
    hasToken: hasToken,
    hasChatId: hasChat,
  };
}

module.exports = { startTelegramBot, handleCommand, tgButtons, getBotStatus };
