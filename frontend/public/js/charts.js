// charts.js: رسم بياني زمني لزمن استجابة الجهاز باستخدام Chart.js (متاح عالمياً من CDN).
// window.renderDeviceChart(canvas, statusPoints) → Chart instance (لإتاحة التدمير لاحقاً).
window.renderDeviceChart = function (canvasElement, statusPoints) {
  const ctx = canvasElement.getContext('2d');
  const labels = (statusPoints || []).map((p) => {
    const d = new Date(p.checked_at);
    return d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  });
  const data = (statusPoints || []).map((p) => {
    if (p.status !== 'online') return 0; // لإظهار الانخفاض عند الانقطاع.
    return p.response_time_ms == null ? 0 : p.response_time_ms;
  });

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'زمن الاستجابة (ms)',
          data: data,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true,
          tension: 0.2,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'ms' } },
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      },
    },
  });
};
