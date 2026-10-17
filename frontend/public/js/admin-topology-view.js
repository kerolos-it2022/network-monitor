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
    if (status === 'offline') return { cls: 'down', st: T('s3b.offline', T('devices.sum.offline', '🔴 منقطع')) };
    if (status === 'paused') return { cls: 'paused', st: T('s3b.paused', '⏸ موقوف') };
    if (status === 'unknown') return { cls: 'unknown', st: '❔ غير معروف' };
    return { cls: 'up', st: T('s3b.online', '🟢 متصل') };
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
    if (kind === 'building') return T('s2.building', T('s3.building', T('kind.building', T('s2.building', T('s3.building', T('kind.building', T('s2.building', T('s3.building', T('kind.building', T('s2.building', T('s3.building', T('kind.building', T('s2.building', T('s3.building', T('kind.building', T('s2.building', '🏢 مبنى'))))))))))))))));
    if (kind === 'internet') return '🌐 بوابة إنترنت';
    if (kind === 'floor') return T('s2.floor', T('s3.floor', T('kind.floor', '📐 طابق')));
    if (kind === 'room') return T('s2.room', T('s3.room', T('kind.room', '🚪 غرفة')));
    if (kind === 'rack') return T('s2.rack', T('s3.rack', T('kind.rack', '🗄️ خزانة')));
    if (kind === 'site') return T('s2.site', T('s3.site', T('kind.site', '🏛️ موقع')));
    return T('s2.zone', T('s3.zone', T('kind.zone', '📍 منطقة')));
  }

  // v2.10.2 — أيقونة النوع (نفس أيقونات «خريطة المواقع»).
  function kindIcon(kind) {
    if (kind === 'building') return '🏢';
    if (kind === 'internet') return '🌐';
    if (kind === 'floor') return '📐';
    if (kind === 'room') return '🚪';
    if (kind === 'rack') return '🗄️';
    if (kind === 'site') return '🏛️';
    return '📍';
  }

  // v2.10.2 — إحصاء أجهزة الشجرة الفرعية (للمباني: نفس معلومات كارت «خريطة المواقع»).
  // القاعدة (مطابقة v2.8.9): لا أجهزة ⇒ محيّد · الكل متصل ⇒ أخضر · بعضها ⇒ برتقالي · كلها واقعة ⇒ أحمر.
  function subtreeCounts(n) {
    const acc = { online: 0, offline: 0, unknown: 0, total: 0 };
    (function walk(node) {
      const kids = Array.isArray(node.children) ? node.children : [];
      for (const c of kids) {
        if (c.type === 'location') { walk(c); continue; }
        acc.total += 1;
        if (c.status === 'offline') acc.offline += 1;
        else if (c.status === 'online') acc.online += 1;
        else acc.unknown += 1;
        walk(c);
      }
    })(n);
    return acc;
  }
  function locClass(c) {
    if (!c.total) return 'loc-neutral';
    if (c.offline > 0) return c.online > 0 ? 'loc-warn' : 'loc-bad';
    if (c.online === c.total) return 'loc-ok';
    return 'loc-neutral';
  }

  // بناء HTML للعقدة وأبنائها تنازليًا — pathDown = مسدود عبر الأب.
  function renderNode(n, depth) {
    const si = statusInfo(n);
    const pathDown = !!n.pathDown;
    const isLoc = n.type === 'location';
    const lc = isLoc ? subtreeCounts(n) : null;
    const cls = ['t-node', si.cls, isLoc ? locClass(lc) : '', pathDown ? 'pathdown' : ''].filter(Boolean).join(' ');
    const children = Array.isArray(n.children) ? n.children : [];
    let html = '<div class="' + cls + '" data-id="' + esc(n.id) + '">'
      + '<div class="t-row">'
      + '<b class="t-nm">' + esc(n.name) + '</b>'
      + (isLoc
          ? ' <span class="t-ip">' + esc(kindIcon(n.kind)) + ' ' + esc(kindLabel(n.kind)) + '</span>'
            + ` <span class="t-loc-stats" title="${T('frag.devices_in_this_building', 'أجهزة هذا المبنى')}: ${T('status.online', 'متصل')} · ${T('frag.offline_unknown', 'منقطع · غير معروف')}">🟢 ` + lc.online
            + ' · 🔴 ' + lc.offline + ' · ⚪ ' + lc.unknown + ' <b>(' + lc.total + ')</b></span>'
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
        treeEl.innerHTML = `<p class="muted">${T('common.no', 'لا')} ${T('frag.no_devices_yet_add_devices_from_the', T('frag.no_devices_yet_add_devices_from_the', 'توجد أجهزة بعد — أضف أجهزة من تبويب') + ' ')}«${T('frag.devices_2', 'الأجهزة')}» ${T('frag.and_set_for_each_device', 'وحدّد لكل جهاز ')}«${T('s3.connects_via', 'متصل عبر')}» ${T('frag.to_build_the_path', 'لبناء المسار.')}</p>`;
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
    btn.textContent = T('s2j.refresh', '↻ تحديث');
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
