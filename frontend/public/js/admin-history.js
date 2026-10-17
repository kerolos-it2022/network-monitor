// admin-history.js (SpaceKit HIST-03) — نافذة «تشغيل الجهاز» في لوحة التحكم.
//   GET /api/devices/:id/history?range=24h|7d|30d  (بجلسة — داخلي)
// تعرض: نسبة التشغيل الزمنية + **نسبة التغطية** + جودة البيانات + مدد (متصل/متقطع/مجهول)
// + شريط حالة مصغّر (SVG بلا أي مكتبة خارجية — يعمل على الأبلاينس بلا إنترنت) + أحداث الانقطاع.
// المصدر نفسه المستعمل في HIST-01/HIST-02، فيظهر الفرق بين «بيانات كاملة» و«بيانات جزئية» بصدق.
(function () {
  'use strict';

  let currentDeviceId = null;
  let currentRange = '7d';

  function el(id) { return document.getElementById(id); }

  function fmtDuration(seconds) {
    if (seconds == null) return '—';
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return s + ' ثانية';
    if (s < 3600) return Math.round(s / 60) + ' دقيقة';
    if (s < 86400) return Math.round(s / 3600) + ' ساعة';
    return (Math.round(s / 8640) / 10) + ' يوم';
  }

  // شريط حالة مصغّر: نُجمّع النقاط في ≤ 240 خانة (أي انقطاع ⇒ أحمر) — SVG بلا مكتبات.
  function renderStrip(points) {
    const host = el('history-strip');
    if (!host) return;
    if (!points || !points.length) {
      host.innerHTML = `<span style="font-size:0.85rem; color:var(--muted);">${T('tail.no_raw_samples_in_this_period_rollups_were_u', 'لا عيّنات خام في هذه الفترة (اعتُمدت التجميعات للأرقام).')}</span>`;
      return;
    }
    const buckets = 240;
    const per = Math.max(1, Math.ceil(points.length / buckets));
    const cells = [];
    for (let i = 0; i < points.length; i += per) {
      const slice = points.slice(i, i + per);
      const anyOffline = slice.some((p) => p.status === 'offline');
      cells.push(anyOffline ? '#ef4444' : '#22c55e');
    }
    const w = 100 / cells.length;
    const rects = cells.map((c, i) => `<rect x="${(i * w).toFixed(3)}%" y="0" width="${Math.max(0.2, w).toFixed(3)}%" height="26" fill="${c}"></rect>`).join('');
    host.innerHTML = `<svg viewBox="0 0 100 26" preserveAspectRatio="none" style="width:100%; height:26px; border-radius:6px; overflow:hidden;">${rects}</svg>
      <div style="display:flex; justify-content:space-between; font-size:0.72rem; color:var(--muted); margin-top:2px;">
        <span>أقدم</span><span>${points.length} عيّنة</span><span>الأحدث</span>
      </div>`;
  }

  function renderHistory(data) {
    const qualityAr = { complete: T('s3b.complete_data', 'بيانات كاملة'), partial: T('s3b.partial_data', 'بيانات جزئية'), insufficient: T('s3b.insufficient_data', 'بيانات غير كافية') };
    const qEl = el('history-quality');
    if (qEl) {
      qEl.textContent = '· ' + (qualityAr[data.data_quality] || data.data_quality || '—')
        + (data.rollup_granularity ? ' (مدمَج مع تجميعات ' + (data.rollup_granularity === 'day' ? 'يومية' : 'ساعية') + ')' : '');
    }

    const uPct = data.uptime_percentage == null ? 'بيانات غير كافية' : data.uptime_percentage + '%';
    const sEl = el('history-summary');
    if (sEl) {
      sEl.innerHTML =
        `نسبة التشغيل (${data.range}): <b>${uPct}</b>` +
        ` · التغطية: <b>${data.coverage_percentage}%</b>` +
        ` · متصل: ${fmtDuration(data.online_seconds)}` +
        ` · متقطع: ${fmtDuration(data.offline_seconds)}` +
        ` · بلا دليل: ${fmtDuration(data.unknown_seconds)}`;
    }

    renderStrip(data.status_points);

    const list = el('history-downtimes');
    if (list) {
      list.innerHTML = '';
      const events = (data.downtime_events || []).slice(-10).reverse();
      if (!events.length) {
        list.innerHTML = `<li style="color:var(--muted);">${T('tail.no_outages_recorded_in_the_period', 'لا انقطاعات مسجّلة في الفترة.')}</li>`;
      } else {
        for (const ev of events) {
          const li = document.createElement('li');
          const end = ev.ended_at ? NMFormat.dateTime(ev.ended_at) : T('s3b.ongoing_now', 'مستمر الآن');
          li.textContent = 'من ' + NMFormat.dateTime(ev.started_at) + ' إلى ' + end
            + ' — المدة: ' + NMFormat.duration(ev.duration_seconds);
          list.appendChild(li);
        }
      }
    }
  }

  async function load(range) {
    if (!currentDeviceId) return;
    currentRange = range || currentRange;
    document.querySelectorAll('#history-ranges button[data-hrange]').forEach((b) => {
      b.classList.toggle('btn-primary', b.dataset.hrange === currentRange);
    });
    const sEl = el('history-summary');
    if (sEl) sEl.textContent = T('s2j.calculating', '…جارٍ الحساب');
    const r = await api('/api/devices/' + currentDeviceId + '/history?range=' + currentRange);
    if (!r || !r.success) {
      if (sEl) sEl.textContent = '⚠️ ' + ((r && r.error) || T('tail.could_not_load_the_history', 'تعذّر جلب السجل'));
      return;
    }
    renderHistory(r.data);
  }

  function open(deviceId, deviceName) {
    currentDeviceId = Number(deviceId);
    const title = el('history-modal-title');
    if (title) title.textContent = T('s2j.device_uptime', '📈 تشغيل الجهاز —') + ' ' + (deviceName || ('#' + deviceId));
    const modal = el('history-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }
    load('7d');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const ranges = el('history-ranges');
    if (ranges) {
      ranges.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-hrange]');
        if (b) load(b.dataset.hrange);
      });
    }
    const modal = el('history-modal');
    if (modal) {
      const closeBtn = modal.querySelector('.modal-close');
      if (closeBtn) closeBtn.addEventListener('click', () => { modal.classList.add('hidden'); });
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    }
  });

  window.AdminHistory = { open };
})();
