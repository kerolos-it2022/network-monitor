// admin-topology-view.js: عارض «سلسلة الشبكة» داخل لوحة التحكم — يملأ #topology-tree
// بجلب /api/topology وعرض الشجرة هرميًا (classes جاهزة في style.css: .t-node/.t-children).
// تحميل كسول: أول فتح للتبويب يبدأ الجلب — والزرّ ↻ يعيد الجلب دائمًا.
(function () {
  const treeEl = document.getElementById('topology-tree');
  const section = document.getElementById('section-topology');
  const tabBtn = document.getElementById('tab-topology');
  if (!treeEl || !section || !tabBtn) return;

  let loaded = false;
  let loading = false;

  // طباعة آمنة (نفس أسلوب admin-topology.js).
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // نص الحالة + class اللون (متسق مع statusInfo في admin-topology.js وnoc.html).
  // v2.8.2 — عقدة موقع (n.type==='location') تعرض كصندوق مبني لا كجهاز.
  function statusInfo(n) {
    if (n.type === 'location') return { cls: 'location', st: '' };
    const status = n.status;
    if (status === 'offline') return { cls: 'down', st: '🔴 منقطع' };
    if (status === 'paused') return { cls: 'paused', st: '⏸ موقوف' };
    if (status === 'unknown') return { cls: 'unknown', st: '❔ غير معروف' };
    return { cls: 'up', st: '🟢 متصل' };
  }

  // إضافة مؤشرات الترقيم (_idx/_parent) لكل عقدة لبناء المسار الرقمي الهرمي (1.2.3).
  function indexTree(nodes, parent, map) {
    for (let i = 0; i < nodes.length; i++) {
      nodes[i]._idx = i;
      nodes[i]._parent = parent || null;
      map.set(String(nodes[i].id), nodes[i]);
      if (nodes[i].children && nodes[i].children.length) indexTree(nodes[i].children, nodes[i], map);
    }
  }

  // المسار الرقمي من الجذر حتى العقدة (مثال: 1.2.3).
  function pathLabel(node) {
    const parts = [];
    let cur = node;
    while (cur) {
      parts.unshift((cur._idx + 1));
      cur = cur._parent;
    }
    return parts.join('.');
  }

  // v2.8.2 — تسمية عربية لنوع الموقع.
  function kindLabel(kind) {
    if (kind === 'building') return '🏢 مبنى';
    if (kind === 'internet') return '🌐 بوابة إنترنت';
    if (kind === 'floor') return '📐 طابق';
    if (kind === 'room') return '🚪 غرفة';
    if (kind === 'rack') return '🗄️ خزانة';
    if (kind === 'site') return '🏛️ موقع';
    return '📍 منطقة';
  }

  // بناء HTML للعقدة وأبنائها تنازليًا — pathDown = مسدود عبر الأب.
  function renderNode(n, depth) {
    const si = statusInfo(n);
    const pathDown = !!n.pathDown;
    const cls = ['t-node', si.cls, pathDown ? 'pathdown' : ''].filter(Boolean).join(' ');
    const children = Array.isArray(n.children) ? n.children : [];
    let html = '<div class="' + cls + '" data-id="' + esc(n.id) + '">'
      + '<div class="t-row">'
      + '<b class="t-nm">' + esc(n.name) + '</b>'
      + (n.type === 'location'
          ? ' <span class="t-ip">' + esc(kindLabel(n.kind)) + '</span>'
          : ' <span class="t-ip">' + esc(n.ip) + (n.device_type_name ? ' — ' + esc(n.device_type_name) : '') + '</span>')
      + ' <span class="t-type">' + (si.st ? si.st + ' ' : '') + (pathDown ? '⛔ مسدود عبر الأب' : '') + '</span>'
      + ' <span class="t-type" title="المسار الرقمي الهرمي">🧭 ' + esc(pathLabel(n)) + '</span>'
      + '</div>';
    if (children.length) {
      html += '<div class="t-children">'
        + children.map((c) => renderNode(c, depth + 1)).join('')
        + '</div>';
    }
    html += '</div>';
    return html;
  }

  async function load() {
    if (loading) return;
    loading = true;
    treeEl.innerHTML = '<p class="muted">⏳ جارِ تحميل السلسلة…</p>';
    try {
      const r = await fetch('/api/topology', { credentials: 'same-origin' });
      const j = await r.json();
      if (!j.success || !Array.isArray(j.data)) throw new Error(j.error || 'فشل تحميل السلسلة');
      const byId = new Map();
      indexTree(j.data, null, byId);
      if (!j.data.length) {
        treeEl.innerHTML = '<p class="muted">لا توجد أجهزة بعد — أضف أجهزة من تبويب «الأجهزة» وحدّد لكل جهاز «متصل عبر» لبناء المسار.</p>';
      } else {
        treeEl.innerHTML = j.data.map((n) => renderNode(n, 0)).join('');
      }
      loaded = true;
    } catch (e) {
      treeEl.innerHTML = '<p class="muted">❌ ' + esc(e.message) + ' — <button type="button" class="btn btn-secondary" id="topo-view-retry">إعادة المحاولة</button></p>';
      const retry = document.getElementById('topo-view-retry');
      if (retry) retry.addEventListener('click', load);
    } finally {
      loading = false;
    }
  }

  // زر تحديث أعلى القسم (يُنشأ مرة واحدة بجانب العنوان).
  (function injectToolbar() {
    const h2 = section.querySelector('h2');
    if (!h2 || document.getElementById('topo-view-reload')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'topo-view-reload';
    btn.className = 'btn btn-secondary';
    btn.title = 'إعادة تحميل السلسلة';
    btn.textContent = '↻ تحديث';
    btn.style.marginInlineStart = '12px';
    btn.addEventListener('click', load);
    h2.appendChild(btn);
  })();

  // تحميل كسول: أول فتح للتبويب يجلب السلسلة؛ الفتحات التالية تعرض آخر بيانات
  // (والزرّ ↻ يعيد الجلب يدويًا) — نفس نمط «افتح التبويب لتحميل السلسلة…».
  tabBtn.addEventListener('click', () => {
    if (!loaded) load();
  });

  // لو كان القسم مفتوحًا أصلًا عند الإقلاع (احتياط)، حمّل فورًا.
  if (!section.classList.contains('hidden')) load();
})();
