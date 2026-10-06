// admin-topology.js: سلسلة الشبكة — عرض + تعديل «متصل عبر» من نفس الشاشة
// (قائمة اختيار على كل بطاقة — التغيير يُحفظ فورًا ويعيد رسم السلسلة بالترتيب الجديد).
(function () {
  let tree = [];
  let devices = []; // قائمة مسطحة لتعبئة قوائم الآباء

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ترتيب رقمي طبيعي للإخوة (Device-2 قبل Device-10 — العلة الميدانية في ترتيب NOC).
  function natKey(n) {
    const m = String(n.name || '').match(/(\d+)\s*$/);
    if (m) return parseInt(m[1], 10);
    const ipm = String(n.ip || '').match(/(\d+)\s*$/);
    return ipm ? parseInt(ipm[1], 10) : 999999;
  }
  function sortLevel(nodes) {
    nodes.sort((a, b) => natKey(a) - natKey(b));
    nodes.forEach((n) => { if (n.children && n.children.length) sortLevel(n.children); });
  }

  function parentOptions(node) {
    return devices
      .filter((d) => Number(d.id) !== Number(node.id))
      .map((d) => '<option value="' + d.id + '"' + (Number(node.parent_id) === Number(d.id) ? ' selected' : '') + '>'
        + esc(d.name) + ' (' + esc(d.ip) + ')</option>')
      .join('');
  }

  function nodeHtml(node, depth) {
    const paused = node.status === 'paused';
    const down = node.status === 'offline';
    const pathDown = !!node.pathDown;
    const cls = paused ? 't-node paused' : down ? 't-node down' : pathDown ? 't-node pathdown' : 't-node up';
    const badge = paused ? '⏸ موقوف' : down ? '🔴 منقطع' : pathDown ? '⛔ مسدود عبر الأب' : '🟢 متصل';
    const kids = (node.children || []).map((c) => nodeHtml(c, depth + 1)).join('');
    const indent = depth ? ' style="margin-inline-start:' + depth * 28 + 'px"' : '';
    return '<div class="' + cls + '"' + indent + '>'
      + '<div class="t-head"><span class="t-status">' + badge + '</span> <b>' + esc(node.name) + '</b>'
      + ' <span class="t-ip">' + esc(node.ip) + '</span>'
      + (node.device_type_name ? ' <span class="t-type">(' + esc(node.device_type_name) + ')</span>' : '')
      + '</div>'
      + '<div class="t-parent-row">متصل عبر: <select class="t-parent" data-id="' + node.id + '">'
      + '<option value="">— مدخل إنترنت —</option>' + parentOptions(node) + '</select></div>'
      + (kids ? '<div class="t-children">' + kids + '</div>' : '')
      + '</div>';
  }

  // حفظ فوري: نجلب الجهاز كاملاً ثم نحفظ بنفس بياناته مع الأب الجديد (لا نفقد إعداداته).
  async function applyParent(deviceId, parentId) {
    try {
      const r = await fetch('/api/devices/' + deviceId, { credentials: 'same-origin' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'تعذر جلب الجهاز');
      const d = j.data;
      const body = {
        name: d.name, ip: d.ip, device_type_id: d.device_type_id,
        location_id: d.location_id || null, parent_id: parentId ? Number(parentId) : null,
        check_protocol: d.check_protocol, port: d.port || null, web_port: d.web_port || null,
        check_interval_seconds: d.check_interval_seconds, failure_threshold: d.failure_threshold,
        is_active: d.is_active ? 1 : 0,
      };
      const pr = await fetch('/api/devices/' + deviceId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const pj = await pr.json();
      if (!pj.success) throw new Error(pj.error || 'فشل الحفظ');
      return true;
    } catch (e) {
      alert('خطأ في حفظ الأب: ' + e.message);
      return false;
    }
  }

  async function loadAll() {
    const box = document.getElementById('topology-tree');
    if (!box) return;
    box.innerHTML = '<p class="muted">جاري التحميل…</p>';
    try {
      const [tRes, dRes] = await Promise.all([
        fetch('/api/topology', { credentials: 'same-origin' }),
        fetch('/api/devices', { credentials: 'same-origin' }),
      ]);
      const tj = await tRes.json();
      const dj = await dRes.json();
      if (!tj.success || !Array.isArray(tj.data)) {
        box.innerHTML = '<p class="muted">تعذر تحميل السلسلة</p>';
        return;
      }
      tree = tj.data;
      devices = (dj.success && Array.isArray(dj.data)) ? dj.data : [];
      sortLevel(tree);
      if (tree.length === 0) {
        box.innerHTML = '<p class="muted">لا توجد أجهزة — أضف الأجهزة أولاً ثم حدد «متصل عبر» من هنا.</p>';
        return;
      }
      box.innerHTML = tree.map((n) => nodeHtml(n, 0)).join('')
        + '<p class="muted">💡 تغيير «متصل عبر» يُحفظ فورًا ويعيد رسم السلسلة بالترتيب الجديد.</p>';
      box.querySelectorAll('.t-parent').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const id = Number(sel.dataset.id);
          const ok = await applyParent(id, sel.value);
          loadAll();   // نجاح: إعادة رسم بالترتيب الجديد — فشل: إعادة رسم بالقيمة القديمة
        });
      });
    } catch (e) {
      box.innerHTML = '<p class="muted">خطأ: ' + esc(e.message) + '</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('tab-topology');
    if (btn) btn.addEventListener('click', loadAll);
  });
})();
