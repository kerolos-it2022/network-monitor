// nm-format.js — تنسيقات موحّدة (تاريخ/وقت/أحجام/أرقام) لكل شاشات النظام:
// لوحة التحكم والصفحة العامة وNOC. الغرض: شكل واحد للأرقام والتواريخ في كل مكان
// (كانت الشاشات تخلط toLocaleString('ar') و('ar-EG') فظهر «08:20:9» بجانب «01:05:10»).
// الاعتماد على دوال JS الأساسية بدل Intl لضمان نفس الناتج في كل المتصفحات (بما فيها متصفحات TV).
(function () {
  'use strict';

  const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const AR_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  // الإنجليزية: أسماء الشهور والأيام + وحدات مختصرة (MB/GB) كما هو معتاد في الواجهات الإنجليزية.
  const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const EN_UNITS = [['B', 1], ['KB', 1024], ['MB', 1024 * 1024], ['GB', 1024 * 1024 * 1024], ['TB', 1024 * 1024 * 1024 * 1024]];

  // اللغة الحالية للتنسيقات — يضبطها نظام الترجمة (NMI18N.setLang ⇒ NMFormat.setLang) وبقاؤها 'ar' يعني
  // **صفر تغيير** في مخرجات العربية (كل فروع العربية كما هي حرفيًّا).
  let fmtLang = 'ar';
  function isEn() { return fmtLang === 'en'; }
  function setFmtLang(code) { fmtLang = String(code || '').toLowerCase() === 'en' ? 'en' : 'ar'; return fmtLang; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toDate(v) {
    if (v === null || v === undefined || v === '') return null;
    const d = (v instanceof Date) ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  // 08:20:09 ص · 01:05:10 م   |   English: 08:20:09 AM · 01:05:10 PM
  function time12(d, withSeconds) {
    let h = d.getHours();
    const suffix = isEn() ? (h < 12 ? 'AM' : 'PM') : (h < 12 ? 'ص' : 'م');
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
      // الإنجليزي: نفس ترتيب اليوم/الشهر/السنة مع فاصلة لاتينية (نُبقي dd/mm/yyyy في اللغتين للاتساق)
      return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + (isEn() ? ', ' : '، ') + time12(d);
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
      if (isEn()) return d.getDate() + ' ' + EN_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
      return d.getDate() + ' ' + AR_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    },
    /** السبت، 17 أكتوبر 2026  |  English: Saturday, 17 October 2026 */
    dateLongWd(v) {
      const d = toDate(v);
      if (!d) return '—';
      if (isEn()) return EN_WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + EN_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
      const wd = AR_WEEKDAYS[d.getDay()];
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
    /** «الآن» · «قبل 5 دقائق» · «قبل 3 ساعات» · «قبل يومين»  |  just now · 5 minutes ago · 2 days ago */
    relative(v) {
      const d = toDate(v);
      if (!d) return '—';
      const sec = Math.round((Date.now() - d.getTime()) / 1000);
      if (isEn()) {
        if (sec < 20) return 'just now';
        if (sec < 60) return plural(sec, 'second ago', 'seconds ago');
        const m = Math.round(sec / 60);
        if (m < 60) return plural(m, 'minute ago', 'minutes ago');
        const h = Math.round(m / 60);
        if (h < 24) return plural(h, 'hour ago', 'hours ago');
        return plural(Math.round(h / 24), 'day ago', 'days ago');
      }
      if (sec < 20) return 'الآن';
      if (sec < 60) return 'قبل ' + sec + ' ثانية';
      const min = Math.round(sec / 60);
      if (min < 60) return min === 1 ? 'قبل دقيقة' : (min === 2 ? 'قبل دقيقتين' : 'قبل ' + min + ' دقيقة');
      const hr = Math.round(min / 60);
      if (hr < 24) return hr === 1 ? 'قبل ساعة' : (hr === 2 ? 'قبل ساعتين' : 'قبل ' + hr + ' ساعات');
      const day = Math.round(hr / 24);
      return day === 1 ? 'قبل يوم' : (day === 2 ? 'قبل يومين' : 'قبل ' + day + ' أيام');
    },
    /** مدة بالثواني: «12 دقيقة» · «3 ساعات و12 دقيقة»  |  12 minutes · 3 hours 12 minutes */
    duration(seconds) {
      const s = Number(seconds);
      if (!Number.isFinite(s) || s < 0) return '—';
      if (isEn()) {
        if (s < 60) return plural(Math.round(s), 'second', 'seconds');
        const m = Math.floor(s / 60);
        if (m < 60) return plural(m, 'minute', 'minutes');
        const h = Math.floor(m / 60), rem = m % 60;
        if (h < 24) return plural(h, 'hour', 'hours') + (rem ? ' ' + plural(rem, 'minute', 'minutes') : '');
        const day = Math.floor(h / 24), rh = h % 24;
        return plural(day, 'day', 'days') + (rh ? ' ' + plural(rh, 'hour', 'hours') : '');
      }
      if (s < 60) return Math.round(s) + ' ثانية';
      const min = Math.floor(s / 60);
      if (min < 60) return min + ' دقيقة';
      const hr = Math.floor(min / 60), rm = min % 60;
      if (hr < 24) return hr + ' ساعة' + (rm ? ' و' + rm + ' دقيقة' : '');
      const day = Math.floor(hr / 24), rh = hr % 24;
      return day + ' يوم' + (rh ? ' و' + rh + ' ساعة' : '');
    },
    /** 1.71 ميجابايت · 512 كيلوبايت  |  1.71 MB · 512 KB */
    bytes(n) {
      const v0 = Number(n);
      if (!Number.isFinite(v0)) return '—';
      const units = isEn() ? EN_UNITS
        : [['بايت', 1], ['كيلوبايت', 1024], ['ميجابايت', 1024 * 1024], ['جيجابايت', 1024 * 1024 * 1024], ['تيرابايت', 1024 * 1024 * 1024 * 1024]];
      let idx = 0;
      for (let i = units.length - 1; i >= 0; i--) { if (Math.abs(v0) >= units[i][1]) { idx = i; break; } }
      const val = v0 / units[idx][1];
      const shown = idx === 0 ? String(Math.round(val)) : (val >= 100 ? val.toFixed(0) : val.toFixed(2).replace(/\.?0+$/, ''));
      return shown + ' ' + units[idx][0];
    },
    /** معدّل بيانات: 12.4 ميجابايت/ث  |  12.4 MB/s */
    rate(n) {
      const v0 = Number(n);
      if (!Number.isFinite(v0)) return '—';
      return NMFormat.bytes(v0) + (isEn() ? '/s' : '/ث');
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

  // nm-lang.js وNMI18N يضبطان اللغة عبر هذه الدالة (وهي آمنة قبل تحميل أي شاشة).
  NMFormat.setLang = setFmtLang;
  NMFormat.getLang = function () { return fmtLang; };

  window.NMFormat = NMFormat;
})();
