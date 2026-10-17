// nm-format.js — تنسيقات موحّدة (تاريخ/وقت/أحجام/أرقام) لكل شاشات النظام:
// لوحة التحكم والصفحة العامة وNOC. الغرض: شكل واحد للأرقام والتواريخ في كل مكان
// (كانت الشاشات تخلط toLocaleString('ar') و('ar-EG') فظهر «08:20:9» بجانب «01:05:10»).
// الاعتماد على دوال JS الأساسية بدل Intl لضمان نفس الناتج في كل المتصفحات (بما فيها متصفحات TV).
(function () {
  'use strict';

  const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toDate(v) {
    if (v === null || v === undefined || v === '') return null;
    const d = (v instanceof Date) ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  // 08:20:09 ص · 01:05:10 م
  function time12(d, withSeconds) {
    let h = d.getHours();
    const suffix = h < 12 ? 'ص' : 'م';
    h = h % 12 || 12;
    let out = pad2(h) + ':' + pad2(d.getMinutes());
    if (withSeconds !== false) out += ':' + pad2(d.getSeconds());
    return out + ' ' + suffix;
  }

  const NMFormat = {
    /** 17/10/2026، 08:20:09 ص */
    dateTime(v) {
      const d = toDate(v);
      if (!d) return '—';
      return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + '، ' + time12(d);
    },
    /** 17/10/2026 */
    date(v) {
      const d = toDate(v);
      if (!d) return '—';
      return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
    },
    /** 17 أكتوبر 2026 */
    dateLong(v) {
      const d = toDate(v);
      if (!d) return '—';
      return d.getDate() + ' ' + AR_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    },
    /** السبت، 17 أكتوبر 2026 */
    dateLongWd(v) {
      const d = toDate(v);
      if (!d) return '—';
      const wd = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][d.getDay()];
      return wd + '، ' + d.getDate() + ' ' + AR_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    },
    /** 08:20:09 ص */
    time(v) {
      const d = toDate(v);
      return d ? time12(d) : '—';
    },
    /** 08:20 ص */
    timeShort(v) {
      const d = toDate(v);
      return d ? time12(d, false) : '—';
    },
    /** «الآن» · «قبل 5 دقائق» · «قبل 3 ساعات» · «قبل يومين» */
    relative(v) {
      const d = toDate(v);
      if (!d) return '—';
      const sec = Math.round((Date.now() - d.getTime()) / 1000);
      if (sec < 20) return 'الآن';
      if (sec < 60) return 'قبل ' + sec + ' ثانية';
      const min = Math.round(sec / 60);
      if (min < 60) return min === 1 ? 'قبل دقيقة' : (min === 2 ? 'قبل دقيقتين' : 'قبل ' + min + ' دقيقة');
      const hr = Math.round(min / 60);
      if (hr < 24) return hr === 1 ? 'قبل ساعة' : (hr === 2 ? 'قبل ساعتين' : 'قبل ' + hr + ' ساعات');
      const day = Math.round(hr / 24);
      return day === 1 ? 'قبل يوم' : (day === 2 ? 'قبل يومين' : 'قبل ' + day + ' أيام');
    },
    /** مدة بالثواني: «12 دقيقة» · «3 ساعات و12 دقيقة» · «يوم و4 ساعات» */
    duration(seconds) {
      const s = Number(seconds);
      if (!Number.isFinite(s) || s < 0) return '—';
      if (s < 60) return Math.round(s) + ' ثانية';
      const min = Math.floor(s / 60);
      if (min < 60) return min + ' دقيقة';
      const hr = Math.floor(min / 60), rm = min % 60;
      if (hr < 24) return hr + ' ساعة' + (rm ? ' و' + rm + ' دقيقة' : '');
      const day = Math.floor(hr / 24), rh = hr % 24;
      return day + ' يوم' + (rh ? ' و' + rh + ' ساعة' : '');
    },
    /** 1.71 ميجابايت · 512 كيلوبايت · 3.2 جيجابايت */
    bytes(n) {
      const v0 = Number(n);
      if (!Number.isFinite(v0)) return '—';
      const units = [['بايت', 1], ['كيلوبايت', 1024], ['ميجابايت', 1024 * 1024], ['جيجابايت', 1024 * 1024 * 1024], ['تيرابايت', 1024 * 1024 * 1024 * 1024]];
      let idx = 0;
      for (let i = units.length - 1; i >= 0; i--) { if (Math.abs(v0) >= units[i][1]) { idx = i; break; } }
      const val = v0 / units[idx][1];
      const shown = idx === 0 ? String(Math.round(val)) : (val >= 100 ? val.toFixed(0) : val.toFixed(2).replace(/\.?0+$/, ''));
      return shown + ' ' + units[idx][0];
    },
    /** معدّل بيانات: 12.4 ميجابايت/ث */
    rate(n) {
      const v0 = Number(n);
      if (!Number.isFinite(v0)) return '—';
      return NMFormat.bytes(v0) + '/ث';
    },
    /** 1,234 رقم بفواصل */
    num(n) {
      const v0 = Number(n);
      if (!Number.isFinite(v0)) return '—';
      return v0.toLocaleString('en-US');
    },
    /** نسبة مئوية: 83.3% */
    pct(n, digits) {
      const v0 = Number(n);
      if (!Number.isFinite(v0)) return '—';
      return (Math.round(v0 * 10) / 10).toFixed(digits === undefined ? 1 : digits) + '%';
    }
  };

  window.NMFormat = NMFormat;
})();
