// admin-ai.js — 🤖 شات AI (v2.21.0): محادثة عربية عن الشبكة + إعدادات المفتاح/النموذج.
// ملاحظة: esc و api مُعرّفتان في admin-utils.js (يُحمَّل أولاً).
// المحادثة في الذاكرة فقط (لا تُخزَّن على الخادم) — «محو» يبدأها من جديد.
let aiHistory = [];      // [{role:'user'|'assistant', content}]
let aiBusy = false;

function aiAddBubble(role, text) {
  const box = document.getElementById('ai-chat-box');
  const empty = document.getElementById('ai-chat-empty');
  if (empty) empty.remove();
  const mine = role === 'user';
  const el = document.createElement('div');
  el.style.cssText = 'max-width:85%; align-self:' + (mine ? 'flex-end' : 'flex-start') + '; padding:0.6rem 0.85rem; border-radius:12px; line-height:1.7; white-space:pre-wrap; word-break:break-word; font-size:0.9rem;'
    + (mine
      ? 'background:var(--primary, #2563eb); color:#fff; border-bottom-left-radius:4px;'
      : 'background:var(--card-bg, rgba(125,125,125,0.12)); border:1px solid var(--border); border-bottom-right-radius:4px;');
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function aiSetStatus(msg, isError) {
  const el = document.getElementById('ai-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--offline, #dc2626)' : 'var(--muted)';
}

async function loadAiSettings() {
  const r = await api('/api/ai/settings');
  if (!r.success) { aiSetSettingsStatus(T('tail.could_not_load_the_ai_chat_settings', 'تعذّر تحميل إعدادات شات AI: ') + ' ' + (r.error || ''), true); return; }
  const d = r.data;
  document.getElementById('ai-enabled').checked = !!d.enabled;
  const keyEl = document.getElementById('ai-api-key');
  keyEl.value = '';
  keyEl.placeholder = d.api_key_masked || T('s2.not_set', T('admin.unset', 'غير مضبوط'));
  document.getElementById('ai-base-url').value = d.base_url || '';
  document.getElementById('ai-model').value = d.model || '';
  const redactEl = document.getElementById('ai-redact-internal');
  if (redactEl) redactEl.checked = d.redact_internal == null ? true : !!d.redact_internal;
  if (!d.enabled || !d.has_key) {
    aiSetStatus(T('ai.chatOffHint', 'شات AI غير مفعّل — الردود الآن «بقواعد محلية» بلا أي إرسال خارجي. أضف مفتاح API وفعّل وضع النموذج للتحليل الكامل.'), false);
  }
}

// AI-02 — معاينة ما سيُرسَل فعلًا لمزوّد النموذج (بعد التنقيح) — شفافية كاملة قبل أي إرسال.
async function aiPreviewContext() {
  const out = document.getElementById('ai-preview-out');
  if (!out) return;
  out.classList.remove('hidden');
  out.textContent = T('s2j.preparing', '…جارٍ التجهيز');
  const r = await api('/api/ai/context-preview');
  if (!r.success) { out.textContent = T('s2j.failed', 'تعذّر:') + ' ' + (r.error || ''); return; }
  const d = r.data;
  const head = (d.redacted ? T('tail.redacted_addresses_mac_as_tokens', '🛡️ منقّح (العناوين/MAC برموز) — ') + ' ' : T('tail.not_redacted_real_addresses_are_shown', '⚠️ غير منقّح (يعرض عناوين حقيقية) — ') + ' ')
    + d.chars + ' حرفًا · أجهزة ' + d.stats.devices
    + ' (مُستبعَد ' + d.stats.omitted_devices + ') · أحداث ' + d.stats.events
    + ' · أعطال ' + d.stats.incidents;
  out.textContent = head + '\n\n' + d.preview;
}

function aiSetSettingsStatus(msg, isError) {
  const el = document.getElementById('ai-settings-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--offline, #dc2626)' : 'var(--online, #16a34a)';
}

async function saveAiSettings() {
  const base = document.getElementById('ai-base-url').value.trim();
  const model = document.getElementById('ai-model').value.trim();
  // تحقق لطيف قبل الحفظ: العنوان لا يساوي فراغًا ولا يفشل صامتًا.
  if (base && !/^https?:\/\//i.test(base)) {
    aiSetSettingsStatus(T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', T('tail.the_service_endpoint_must_start_with_http_or', 'عنوان الخدمة يجب أن يبدأ بـ http:// أو https://')))))))))))), true);
    return;
  }
  const r = await api('/api/ai/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled: document.getElementById('ai-enabled').checked ? 1 : 0,
      api_key: document.getElementById('ai-api-key').value.trim() || undefined,
      base_url: base,
      model: model,
      // AI-02 — قرار المالك بشأن تنقيح العناوين الداخلية قبل الإرسال.
      redact_internal: (document.getElementById('ai-redact-internal') || {}).checked ? 1 : 0,
    }),
  });
  if (!r.success) { aiSetSettingsStatus(T('s2j.save_failed', 'فشل الحفظ:') + ' ' + (r.error || ''), true); return; }
  aiSetSettingsStatus('✅ حُفظت الإعدادات — المفتاح: ' + (r.data.api_key_masked || T('s2.not_set', T('admin.unset', 'غير مضبوط'))), false);
  document.getElementById('ai-api-key').value = '';
  document.getElementById('ai-api-key').placeholder = r.data.api_key_masked || T('s2.not_set', T('admin.unset', 'غير مضبوط'));
  if (r.data.enabled && r.data.has_key) aiSetStatus(T('tail.ai_chat_is_ready_ask_away', 'شات AI جاهز — اسأل ما شئت.'), false);
  else aiSetStatus('شات AI غير نشط (يحتاج مفتاحًا + تفعيلًا).', false);
}

async function aiSend() {
  if (aiBusy) return;
  const input = document.getElementById('ai-input');
  const message = (input.value || '').trim();
  if (!message) return;
  input.value = '';

  aiAddBubble('user', message);
  aiHistory.push({ role: 'user', content: message });
  if (aiHistory.length > 20) aiHistory = aiHistory.slice(-20);

  aiBusy = true;
  document.getElementById('ai-send-btn').disabled = true;
  aiAddBubble('assistant', T('tail.thinking', '⏳ أفكّر…'));
  aiSetStatus('');

  const r = await api('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history: aiHistory.slice(-11, -1) }),
  });

  const box = document.getElementById('ai-chat-box');
  const pending = box.lastElementChild; // فقاعة «أفكّر…» تُستبدل بالرد
  aiBusy = false;
  document.getElementById('ai-send-btn').disabled = false;
  input.focus();

  if (r.success && r.reply) {
    if (pending) pending.remove();
    aiAddBubble('assistant', r.reply);
    aiHistory.push({ role: 'assistant', content: r.reply });
    aiSetStatus(T('tail.context_sent', 'السياق المُرسل: ') + ' ' + (r.context_stats ? r.context_stats.devices + ' جهازًا · ' + r.context_stats.offline + ' واقعًا · ' + r.context_stats.events + ' انقطاعًا' : ''), false);
  } else {
    const err = '⚠️ ' + (r.error || T('tail.unknown_error', 'خطأ غير معروف'));
    if (pending) { pending.textContent = err; pending.style.color = 'var(--offline, #dc2626)'; }
    aiSetStatus(err, true);
  }
}

function aiClear() {
  aiHistory = [];
  const box = document.getElementById('ai-chat-box');
  box.innerHTML = `<div id="ai-chat-empty" style="margin:auto 0; text-align:start; color:var(--muted); font-size:0.9rem; line-height:1.9;"><div style="font-size:2rem;">🤖</div>${T('frag.type_your_question_below_e_g', 'اكتب سؤالك أسفل… مثل')}: «${T('frag.what_is_down_right_now', 'إيه اللي واقع دلوقتي؟')}» ${T('frag.or', 'أو ')}«${T('frag.is_the_camera_wing_down', 'جنّاح الكاميرات طايح؟')}» ${T('frag.or', 'أو ')}«${T('frag.the_most', 'أكثر ')}${T('tail.devices', ' جهاز')} ${T('frag.fails_most', 'بيقع؟')}»</div>`;
  aiSetStatus(T('tail.conversation_cleared_2', 'محُوِت المحادثة.'), false);
}

document.addEventListener('DOMContentLoaded', () => {
  const sendBtn = document.getElementById('ai-send-btn');
  const clearBtn = document.getElementById('ai-clear-btn');
  const input = document.getElementById('ai-input');
  if (!sendBtn) return; // الصفحة بلا قسم AI (احتياط)
  sendBtn.addEventListener('click', aiSend);
  clearBtn.addEventListener('click', aiClear);
  document.getElementById('ai-save-btn').addEventListener('click', saveAiSettings);
  const previewBtn = document.getElementById('ai-preview-btn');
  if (previewBtn) previewBtn.addEventListener('click', aiPreviewContext);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); }
  });
  loadAiSettings();
});
