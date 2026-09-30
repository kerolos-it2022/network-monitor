// public-speedtest.js (v2.7.5): قياس سرعة الانترنت في الصفحة العامة — زرّ ⚡ في أدوات الشبكة.
// ─────────────────────────────────────────────────────────────
// v2.7.5 (b) — اختيار الخادم: dropdown في الـ modal يختار بين:
//   🟠 Cloudflare  — قياس كامل (ping + تنزيل + رفع) — الأفضل.
//   🟣 jsDelivr    — ping + تنزيل فقط (CDN — بديل للتقدير، لا رفع).
//   🟢 unpkg       — ping + تنزيل فقط (CDN — بديل للتقدير، لا رفع).
// كل الخيارات CORS مفتوح (Access-Control-Allow-Origin: *) — تم التحقق فعليًّا.
// الخيار المُحدَّد يُحفظ في localStorage (nm.speedTestServer).
// ─────────────────────────────────────────────────────────────
// المنهجية (نَفس منطق مواقع القياس الاحترافية):
//   - Ping: 5 طلبات صغيرة → الوسيط بالمللي ثانية.
//   - التنزيل: 4 اتصالات متوازية لمدة ~8 ثوانٍ — قراءة streaming عبر response.body
//     (reader) لِـ عَدّ البايتات الجزئيّة أَيضًا (دقة عالية على الاتصالات البطيئة).
//   - الرفع (Cloudflare فقط): 3 اتصالات متوازية لمدة ~6 ثوانٍ — POST blobs 512KB.
// الإلغاء: AbortController عالمي — إِغلاق الـ modal يُلغي كل الاتصالات فورًا.
// ─────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var SERVER_KEY_STORAGE = 'nm.speedTestServer';
  var LAST_KEY = 'nm.lastSpeedTest';

  // ═══ تعريف الخوادم — كلها مُتحقَّق منها بـ CORS مفتوح ═══
  var SERVERS = {
    cloudflare: {
      label: 'Cloudflare',
      supportsUpload: true,
      pingUrl: function () { return 'https://speed.cloudflare.com/__down?bytes=0'; },
      downloadUrl: function () { return 'https://speed.cloudflare.com/__down?bytes=' + DOWNLOAD_CHUNK_BYTES; },
      uploadUrl: function () { return 'https://speed.cloudflare.com/__up'; },
    },
    jsdelivr: {
      label: 'jsDelivr',
      supportsUpload: false,
      pingUrl: function () { return 'https://cdn.jsdelivr.net/npm/left-pad@1.3.0/package.json'; },
      downloadUrl: function () { return 'https://cdn.jsdelivr.net/npm/typescript@5.4.5/lib/typescript.js'; },
    },
    unpkg: {
      label: 'unpkg',
      supportsUpload: false,
      pingUrl: function () { return 'https://unpkg.com/left-pad@1.3.0/package.json'; },
      downloadUrl: function () { return 'https://unpkg.com/typescript@5.4.5/lib/typescript.js'; },
    },
  };

  var PING_PROBES = 5;
  var DOWNLOAD_SECONDS = 8;
  var DOWNLOAD_STREAMS = 4;
  var DOWNLOAD_CHUNK_BYTES = 10 * 1024 * 1024;   // 10MB لِـ كل طلب (Cloudflare) — نُلغي القراءة عِند انتهاء المدة
  var UPLOAD_SECONDS = 6;
  var UPLOAD_STREAMS = 3;
  var UPLOAD_CHUNK_BYTES = 512 * 1024;           // 512KB — يُكمل سريعًا حَتى على اتصال بطيء

  var serverKey = 'cloudflare';
  var running = false;
  var abortCtl = null;

  function $(id) { return document.getElementById(id); }
  function currentServer() { return SERVERS[serverKey] || SERVERS.cloudflare; }
  function setValue(id, txt) { var el = $(id); if (el) el.textContent = txt; }
  function setStatus(msg) { var el = $('st-status'); if (el) el.textContent = msg; }
  function setProgress(pct) {
    var fill = $('st-progress-fill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }
  function mbps(bytes, elapsedMs) {
    return elapsedMs > 0 ? (bytes * 8) / (elapsedMs / 1000) / 1e6 : 0;
  }

  // ═══ Ping: 5 طلبات صغيرة → الوسيط ═══
  async function measurePing(signal) {
    var srv = currentServer();
    var times = [];
    for (var i = 0; i < PING_PROBES; i++) {
      var t = performance.now();
      var r = await fetch(srv.pingUrl(), { cache: 'no-store', signal: signal });
      await r.arrayBuffer();
      times.push(performance.now() - t);
      setProgress(((i + 1) / PING_PROBES) * 10);   // Ping = أَول 10% من شريط التقدم
    }
    times.sort(function (a, b) { return a - b; });
    return Math.round(times[Math.floor(times.length / 2)]);
  }

  // ═══ التنزيل: streams متوازية قائمة على المدة — قراءة streaming مع عَدّ جزئي ═══
  async function runDownload(onTick) {
    var srv = currentServer();
    var totalBytes = 0;
    var start = performance.now();
    var deadline = start + DOWNLOAD_SECONDS * 1000;

    async function stream() {
      while (performance.now() < deadline && !abortCtl.signal.aborted) {
        var r = await fetch(srv.downloadUrl(), { cache: 'no-store', signal: abortCtl.signal });
        var reader = r.body.getReader();
        while (true) {
          if (performance.now() >= deadline) { try { reader.cancel(); } catch (_) {} break; }
          var chunk;
          try {
            chunk = await reader.read();
          } catch (e) {
            if (abortCtl.signal.aborted) return;   // إِلغاء عالمي (إِغلاق modal) — خروج صامت
            throw e;
          }
          if (chunk.done) break;
          totalBytes += chunk.value.byteLength;
          onTick(performance.now() - start, totalBytes);
        }
      }
    }

    var jobs = [];
    for (var i = 0; i < DOWNLOAD_STREAMS; i++) jobs.push(stream());
    await Promise.all(jobs);
    return mbps(totalBytes, performance.now() - start);
  }

  // ═══ الرفع: POST blobs مُكرّرة — chunk صغير يُكمل حَتى على اتصال بطيء ═══
  async function runUpload(onTick) {
    var srv = currentServer();
    var totalBytes = 0;
    var start = performance.now();
    var deadline = start + UPLOAD_SECONDS * 1000;

    function makeChunk() { return new Blob([new Uint8Array(UPLOAD_CHUNK_BYTES)]); }

    async function stream() {
      while (performance.now() < deadline && !abortCtl.signal.aborted) {
        var remain = Math.max(deadline - performance.now(), 200);
        var ctl = new AbortController();
        var timer = setTimeout(function () { ctl.abort(); }, remain);
        try {
          var blob = makeChunk();
          await fetch(srv.uploadUrl(), { method: 'POST', body: blob, cache: 'no-store', signal: ctl.signal });
          totalBytes += blob.size;
          onTick(performance.now() - start, totalBytes);
        } catch (e) {
          if (ctl.signal.aborted || abortCtl.signal.aborted) break;   // انتهاء المدة أَو إِلغاء
          throw e;
        } finally {
          clearTimeout(timer);
        }
      }
    }

    var jobs = [];
    for (var i = 0; i < UPLOAD_STREAMS; i++) jobs.push(stream());
    await Promise.all(jobs);
    return mbps(totalBytes, performance.now() - start);
  }

  // ═══ الدورة الكاملة: ping → download → upload (لو مدعوم) ═══
  async function runSpeedTest() {
    if (running) return;
    running = true;
    abortCtl = new AbortController();
    var srv = currentServer();
    var startBtn = $('st-start-btn');
    if (startBtn) startBtn.disabled = true;
    setValue('st-ping', '—'); setValue('st-download', '—'); setValue('st-upload', '—');

    try {
      // 1) Ping
      setStatus('⏳ [' + srv.label + '] جارٍ قياس زمن الاستجابة (Ping)…');
      var ping = await measurePing(abortCtl.signal);
      setValue('st-ping', ping + ' ms');

      // 2) Download (10% → 70% من شريط التقدم) — قيمة حيّة أثناء القياس
      setStatus('⏳ [' + srv.label + '] جارٍ قياس سرعة التنزيل…');
      var down = await runDownload(function (elapsedMs, bytes) {
        setProgress(10 + (elapsedMs / (DOWNLOAD_SECONDS * 1000)) * 60);
        setValue('st-download', mbps(bytes, elapsedMs).toFixed(1) + ' Mbps');
      });
      setValue('st-download', down.toFixed(1) + ' Mbps');

      // 3) Upload (70% → 100%) — Cloudflare فقط؛ خوادم CDN تنزيل فقط.
      var up = null;
      if (srv.supportsUpload) {
        setStatus('⏳ [' + srv.label + '] جارٍ قياس سرعة الرفع…');
        up = await runUpload(function (elapsedMs, bytes) {
          setProgress(70 + (elapsedMs / (UPLOAD_SECONDS * 1000)) * 30);
          setValue('st-upload', mbps(bytes, elapsedMs).toFixed(1) + ' Mbps');
        });
        setValue('st-upload', up.toFixed(1) + ' Mbps');
      } else {
        setValue('st-upload', 'غير متاح');
        setProgress(100);
      }

      setProgress(100);
      setStatus('✅ اكتمل القياس' + (srv.supportsUpload ? '' : ' (تنزيل فقط لهذا الخادم)'));
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({
          server: srv.label,
          ping: ping,
          down: Math.round(down * 10) / 10,
          up: up == null ? null : Math.round(up * 10) / 10,
          at: Date.now(),
        }));
      } catch (_) {}
    } catch (e) {
      if (abortCtl.signal.aborted) {
        setStatus('أُلغي القياس.');
      } else {
        setStatus('⚠️ تعذر الوصول لخادم القياس (' + srv.label + ') — تأكد من اتصال الانترنت أَو جرّب خادمًا آخر.');
      }
      setProgress(0);
    } finally {
      running = false;
      if (abortCtl) abortCtl = null;
      if (startBtn) startBtn.disabled = false;
    }
  }

  // ═══ فتح/إغلاق الـ modal ═══
  function openModal() {
    var m = $('speedtest-modal');
    if (!m) return;
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden', 'false');
    setProgress(0);
    // عرض آخر نتيجة محفوظة (إن وُجدت).
    try {
      var last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
      if (last) {
        setValue('st-ping', last.ping + ' ms');
        setValue('st-download', last.down + ' Mbps');
        setValue('st-upload', last.up == null ? '—' : last.up + ' Mbps');
        setStatus('آخر قياس [' + (last.server || '—') + ']: ' + new Date(last.at).toLocaleString('ar') + ' — اضغط «ابدأ القياس» لإعادة القياس.');
      }
    } catch (_) {}
  }

  function closeModal() {
    // إِلغاء أي قياس جارٍ فورًا.
    if (abortCtl) abortCtl.abort();
    var m = $('speedtest-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.setAttribute('aria-hidden', 'true');
  }

  // ═══ تهيئة عند التحميل ═══
  document.addEventListener('DOMContentLoaded', function () {
    // اِسترجاع الخادم المُختار (افتراضيًّا Cloudflare) + مستمع التغيير (حفظ فوري).
    var serverSel = $('st-server');
    if (serverSel) {
      try {
        var savedServer = localStorage.getItem(SERVER_KEY_STORAGE);
        if (savedServer && SERVERS[savedServer]) serverSel.value = savedServer;
      } catch (_) {}
      serverKey = SERVERS[serverSel.value] ? serverSel.value : 'cloudflare';
      serverSel.addEventListener('change', function () {
        serverKey = SERVERS[this.value] ? this.value : 'cloudflare';
        try { localStorage.setItem(SERVER_KEY_STORAGE, serverKey); } catch (_) {}
      });
    }

    var btn = $('speedtest-btn');
    if (btn) btn.addEventListener('click', openModal);

    var closeBtn = document.querySelector('#speedtest-modal .speedtest-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // النقر على الخلفية المعتمة (خارج المحتوى) يُغلق.
    var modal = $('speedtest-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
    }

    var startBtn = $('st-start-btn');
    if (startBtn) startBtn.addEventListener('click', runSpeedTest);
  });
})();
