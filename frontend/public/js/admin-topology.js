// admin-topology.js: وضع الرسم — اسحب الأجهزة على اللوحة، اربطها («متصل عبر»)،
// واضغط 💾 حفظ التخطيط — يُخزَّن (pos_x/pos_y) ويُعرض كما رسمته في شاشة NOC.
(function () {
  const canvas = document.getElementById('topology-canvas');
  const svg = document.getElementById('topology-links');
  const saveBtn = document.getElementById('topo-save-btn');
  const dirtyEl = document.getElementById('topo-dirty');
  const addLocSel = document.getElementById('topo-add-loc-select');
  let nodes = [];       // {id, name, ip, status, parent_id, pos_x, pos_y, device_type_name}
  let drag = null;
  let dirty = false;
  const CANVAS_W = 2800, CANVAS_H = 1450;
  const CARD_W = 210, CARD_H = 74;
  const LOC_W = 320, LOC_HEAD_H = 17;
  let zoomLevel = 1.0;



  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // v2.8.2 — تسمية عربية لنوع الموقع.
  function kindLabel(kind) {
    if (kind === 'building') return T('s2.building', T('s3.building', T('kind.building', T('s2.building', T('s3.building', T('kind.building', T('s2.building', T('s3.building', T('kind.building', T('s2.building', '🏢 مبنى'))))))))));
    if (kind === 'internet') return '🌐 بوابة إنترنت';
    if (kind === 'floor') return T('s2.floor', T('s3.floor', '📐 طابق'));
    if (kind === 'room') return T('s2.room', T('s3.room', '🚪 غرفة'));
    if (kind === 'rack') return T('s2.rack', T('s3.rack', '🗄️ خزانة'));
    if (kind === 'site') return T('s2.site', T('s3.site', '🏛️ موقع'));
    return T('s2.zone', T('s3.zone', '📍 منطقة'));
  }

  const placed = () => nodes.filter((n) => n.pos_x != null && n.pos_y != null);
  const unplaced = () => nodes.filter((n) => n.pos_x == null || n.pos_y == null);
  const byId = (id) => nodes.find((n) => String(n.id) === String(id));

  function statusInfo(n) {
    if (n.type === 'location') return { cls: 'location', st: kindLabel(n.kind), color: '#a78bfa' };
    if (n.status === 'offline') return { cls: 'down', st: T('devices.sum.offline', '🔴 منقطع'), color: '#ef4444' };
    if (n.status === 'paused') return { cls: 'paused', st: T('s3b.paused', '⏸ موقوف'), color: '#94a3b8' };
    if (n.status === 'unknown') return { cls: 'unknown', st: '❔ غير معروف', color: '#64748b' };
    return { cls: 'up', st: T('s3b.online', '🟢 متصل'), color: '#22c55e' };
  }

  async function loadAll() {
    const [tRes, dRes] = await Promise.all([
      fetch('/api/topology', { credentials: 'same-origin' }),
      fetch('/api/devices', { credentials: 'same-origin' }),
    ]);
    const tj = await tRes.json();
    const dj = await dRes.json();
    nodes = [];
    if (tj.success && Array.isArray(tj.data)) {
      // v2.8.1 fix — عقدة /api/topology ناقصة الحقول الإدارية (device_type_id، check_interval_seconds…)
      // و saveOne يبعتها كما هي في PUT → السيرفر يرفض بـ «الحقول name وip وdevice_type_id مطلوبة».
      // الحل: ندمج بيانات /api/devices الكاملة فوق كل عقدة (نفس id) قبل الاستخدام.
      // v2.8.2 — عقد المواقع (type=location) تدخل اللوحة كذلك بمفتاح 'L<id>'.
      const full = new Map();
      if (dj.success && Array.isArray(dj.data)) for (const d of dj.data) full.set(Number(d.id), d);
      (function flat(ts) {
        for (const n of ts) {
          if (n.type === 'location') {
            nodes.push({ ...n, id: 'L' + n.location_id });
          } else {
            const f = full.get(Number(n.id));
            nodes.push(f ? { ...f, ...n, device_type_id: f.device_type_id } : n);
          }
          if (n.children && n.children.length) flat(n.children);
        }
      })(tj.data);
    } else {
      nodes = (dj.success && Array.isArray(dj.data)) ? dj.data.map((d) => ({ ...d, pos_x: null, pos_y: null })) : [];
    }
    // لا يتم إضافة أي مبنى تلقائيًا على اللوحة:
    // المباني التي تملك موضعًا محفوظًا فقط (pos_x != null && pos_y != null) تظهر على اللوحة،
    // وأي مبنى ليس له موضع محفوظ يبقى في قائمة الاختيار (أضف مبنى/موقع للوحة) ليقوم الأدمن بإضافته يدوياً.
    dirty = false;
    renderCanvas();
    if (placed().length) {
      setTimeout(() => centerOnNodes(false), 50);
    }
  }

  // بناء شجرة من القائمة المسطحة (لو الـ API رجع خطأ والقائمة متاحة).
  function buildTreeFromFlat(list) {
    const byId = new Map(list.map((n) => [n.id, { ...n, children: [] }]));
    const roots = [];
    for (const n of byId.values()) {
      const p = n.parent_id ? byId.get(n.parent_id) : null;
      if (p) p.children.push(n); else roots.push(n);
    }
    return roots;
  }

  // v2.8.2 — قيمة أب موحدة: 'D<id>' جهاز، 'L<id>' موقع، '' جذر.
  // v2.8.4 — علاقة واحدة موحدة (parent_id) لكل الأنواع:
  //   • موقع  → أبوه موقع (parent_id) — نفس العلاقة التي يبنيها /api/topology ويرسمها NOC.
  //   • جهاز  → أبوه جهاز (parent_id)، وإن غاب فموقعه (location_id).
  // (upstream_location_id عمود قديم غير مقروء من الخادم — أُزيل من المسار هنا.)
  function parentKeyOf(n) {
    if (n.type === 'location') return n.parent_id ? 'L' + n.parent_id : '';
    if (n.parent_id) return 'D' + n.parent_id;
    // v2.8.3 — الجهاز يتعلق بمبنى location_id (نفس مصدر شجرة المواقع).
    if (n.location_id) return 'L' + n.location_id;
    return '';
  }

  // v2.8.3 — أجهزة المبنى: من location_id (نفس مصدر شجرة المواقع — تعيين المستخدم الموثوق).
  function locChildren(locId) {
    return nodes.filter((o) => o.type !== 'location' && Number(o.location_id) === Number(locId));
  }

  function renderCanvas() {
    // v2.8.2 — الجهاز التابع لمبنى (parent_location_id) يُعرض داخل بطاقة المبنى فقط.
    const nestedIn = new Set();
    const drawnLocs = placed().filter((n) => n.type === 'location');
    for (const n of drawnLocs) {
      for (const k of locChildren(n.location_id)) nestedIn.add(String(k.id));
    }
    // v2.8.3 — الأجهزة بلا موقع (location_id فاضي) لا تظهر على اللوحة إطلاقًا:
    // تُدار من تبويب الأجهزة (حقل الموقع) — اللوحة للمباني وأجهزتها فقط.
    // v2.8.3 — الاتساق النهائي: جهاز له مبنى مرسوم يظهر جوه البطاقة دائمًا
    // (حتى لو موضع الجهاز نفسه null — العلاقة هي المصدر، مش الإحداثيات).
    // v2.8.3 — القاعدة النهائية الصارمة:
    //   • المبنى يظهر لو له موضع على اللوحة.
    //   • الجهاز له location_id ⇒ لا يظهر أبدًا ككرت مستقل (يظهر فقط جوه بطاقة مبنىه).
    //   • الجهاز بلا location_id ⇒ لا يظهر أبدًا (يُدار من تبويب الأجهزة).
    const pl = nodes.filter((n) => n.type === 'location' && n.pos_x != null);
    canvas.innerHTML = pl.map((n) => {
      const si = statusInfo(n);
      const isLoc = n.type === 'location';
      // v2.8.4 — قائمة المباني تعرض مواقع فقط: أب الموقع لا يمكن أن يكون جهازًا
      // (وإلا صار الخيار بلا أثر — /api/topology يبني المواقع من parent_id للمواقع فقط).
      const others = nodes.filter((o) => String(o.id) !== String(n.id) && (!isLoc || o.type === 'location'));
      const cur = parentKeyOf(n);
      const opts = `<option value="">— ${T('frag.internet_gateway', 'مدخل إنترنت ')}(${T('frag.root', 'جذر')}) —</option>`
        + others.map((o) => {
            const key = o.type === 'location' ? 'L' + o.location_id : 'D' + o.id;
            const label = o.type === 'location'
              ? esc(o.name) + ' — ' + esc(kindLabel(o.kind))
              : esc(o.name) + ' (' + esc(o.ip) + ')';
            return '<option value="' + key + '"' + (cur === key ? ' selected' : '') + '>' + label + '</option>';
          }).join('');
      const meta = isLoc
        ? esc(kindLabel(n.kind))
        : esc(n.ip) + (n.device_type_name ? ' — ' + esc(n.device_type_name) : '');
      const head = '<div class="t-row"><span class="t-dot" style="background:' + si.color + '"></span>'
        + '<b class="t-nm">' + esc(n.name) + '</b>'
        + '<button class="t-remove" data-id="' + esc(n.id) + '" title="إخراج من اللوحة">✕</button></div>'
        + '<div class="t-ip">' + meta + '</div>'
        + '<div class="t-parent-row">متصل عبر (السلسلة): <select class="t-parent" data-id="' + esc(n.id) + '">' + opts + '</select></div>';
      if (!isLoc) {
        return '<div class="t-card ' + si.cls + '" data-id="' + esc(n.id) + '" style="left:' + n.pos_x + 'px; top:' + n.pos_y + 'px">'
          + head + '</div>';
      }
      // v2.8.3 — بطاقة المبنى بنفس شكل كارت خريطة المواقع: مصمتة + ترويسة بعدادات
      // + صفوف أجهزة (أيقونة النوع + النوع + الاسم + IP + الحالة).
      const kids = locChildren(n.location_id);
      const up = kids.filter((k) => k.status === 'online').length;
      const down = kids.filter((k) => k.status === 'offline').length;
      const unk = kids.length - up - down;
      const counters = '<span class="map-count">'
        + `<span class="map-${T('unit.status', ' status')} online">🟢 ` + up + '</span> · '
        + `<span class="map-${T('unit.status', ' status')} offline">🔴 ` + down + '</span> · '
        + `<span class="map-${T('unit.status', ' status')} unknown">⚪ ` + unk + '</span>'
        + '</span>';
      // لون إطار البطاقة: أحمر لو فيه منقطع، أخضر لو الكل متصل، رمادي لو فاضي.
      // v2.10.2 — نفس قاعدة «خريطة المواقع»: لا أجهزة ⇒ محيّد · الكل متصل ⇒ أخضر · جزئي ⇒ برتقالي · الكل واقع ⇒ أحمر.
      const borderCls = !kids.length ? 'neutral' : (down > 0 ? (up > 0 ? 'warn' : 'down') : 'up');
      const rows = kids.map((k) => {
        const ksi = statusInfo(k);
        const kIcon = '🖥️';
        return '<div class="t-inner" data-id="' + esc(k.id) + '">'
          + '<span class="t-dot" style="background:' + ksi.color + '"></span>'
          + '<span class="t-inner-type">' + kIcon + ' ' + esc(k.device_type_name || T('s2x.device', 'جهاز')) + '</span>'
          + '<span class="t-inner-nm" title="' + esc(k.name) + '">' + esc(k.name) + '</span>'
          + '<span class="t-inner-ip">' + esc(k.ip) + '</span>'
          + '<span class="t-inner-st">' + ksi.st + '</span>'
          + '</div>';
      }).join('');
      return '<div class="t-card location maploc ' + borderCls + '" data-id="' + esc(n.id) + '" style="left:' + n.pos_x + 'px; top:' + n.pos_y + 'px">'
        + '<div class="maploc-head">'
        + '<b class="maploc-nm">' + esc(n.name) + '</b>'
        + counters
        + '<button class="t-remove" data-id="' + esc(n.id) + '" title="إخراج من اللوحة">✕</button>'
        + '</div>'
        + '<div class="maploc-kind">' + esc(kindLabel(n.kind)) + '</div>'
        + '<div class="t-parent-row">متصل عبر: <select class="t-parent" data-id="' + esc(n.id) + '">' + opts + '</select></div>'
        + (kids.length
            ? '<div class="t-inner-list">' + rows + '</div>'
            : `<div class="t-inner-empty">${T('common.no', 'لا')} ${T('frag.devices_inside_this_building', 'أجهزة داخل هذا المبنى')}</div>`)
        + '</div>';
    }).join('');
    // قائمة الإضافة: مباني فقط.
    const unLoc = unplaced().filter((n) => n.type === 'location').sort((a, b) => natKey(a) - natKey(b));
    addLocSel.innerHTML = `<option value="">${T('s2.add_a_building_location_to_the_board', '🏢 أضف مبنى/موقع للوحة…')}</option>`
      + unLoc.map((n) => '<option value="' + esc(n.id) + '">' + esc(n.name) + ' — ' + esc(kindLabel(n.kind)) + '</option>').join('')
      + (unLoc.length === 0 ? `<option value="" disabled>${T('frag.all', 'كل')} ${T('frag.buildings_already_on_the_board', 'المباني موجودة على اللوحة')}</option>` : '');
    addLocSel.classList.remove('hidden');
    drawLinks();
    saveBtn.classList.toggle('attention', dirty);
    dirtyEl.classList.toggle('hidden', !dirty);
  }

  function center(n) {
    return { x: (n.pos_x || 0) + CARD_W / 2, y: (n.pos_y || 0) + CARD_H / 2 };
  }

  // v2.8.4 — ارتكاز بطاقة المبنى: عرض 320px + منتصف الترويسة (~17px). مشترك مع NOC.
  function locAnchor(n) {
    return { x: (n.pos_x || 0) + LOC_W / 2, y: (n.pos_y || 0) + LOC_HEAD_H };
  }

  function drawLinks() {
    svg.setAttribute('width', CANVAS_W);
    svg.setAttribute('height', CANVAS_H);
    let h = '';
    const nested = new Set();
    for (const n of placed()) {
      if (n.type === 'location' && n.pos_x != null) {
        for (const k of locChildren(n.location_id)) nested.add(String(k.id));
      }
    }
    for (const n of placed()) {
      if (nested.has(String(n.id))) continue; // داخل بطاقة المبنى — لا خط خارجي.
      const key = parentKeyOf(n);
      if (!key) continue;
      const p = placed().find((o) => (o.type === 'location' ? 'L' + o.location_id : 'D' + o.id) === key);
      if (!p) continue;
      // v2.8.4 — خطوط المباني بمرتكز موحّد مع NOC (منتصف ترويسة بطاقة المبنى 320 عرضًا)
      // حتى تكون نفس الوصلات بنفس الإحداثيات في الشاشتين.
      const a = n.type === 'location' ? locAnchor(n) : center(n);
      const b = p.type === 'location' ? locAnchor(p) : center(p);
      const color = n.type === 'location' ? '#a78bfa'
        : n.status === 'offline' ? '#ef4444' : n.pathDown ? '#f59e0b' : '#22c55e';
      h += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + color + '" stroke-width="3" opacity="0.75" />';
    }
    // v2.8.3 — خطوط داخلية قصيرة: من ترويسة بطاقة المبنى لكل صف جهاز جواها.
    // (تظهر الأجهزة متصلة بمبنىها دائمًا — حتى في المباني اللي مالهاش ربط خارجي زي الدور الثالث.)
    for (const loc of placed()) {
      if (loc.type !== 'location') continue;
      const kids = locChildren(loc.location_id);
      const headY = loc.pos_y + 22; // منتصف الترويسة تقريبًا
      const headX = loc.pos_x + 40;
      kids.forEach((k, i) => {
        const rowY = loc.pos_y + 108 + i * 32;
        const color = k.status === 'offline' ? '#ef4444' : k.status === 'paused' ? '#94a3b8' : '#22c55e';
        h += '<line x1="' + headX + '" y1="' + headY + '" x2="' + (loc.pos_x + 10) + '" y2="' + (rowY + 10) + '" stroke="' + color + '" stroke-width="1.5" opacity="0.45" />';
      });
    }
    svg.innerHTML = h;
  }

  function markDirty() {
    dirty = true;
    saveBtn.classList.add('attention');
    dirtyEl.classList.remove('hidden');
  }

  // ── السحب (Pointer Events — يعمل بالماوس واللمس مع دعم Zoom) ──
  canvas.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.t-card');
    if (!card || e.target.closest('select') || e.target.closest('button')) return;
    const rect = canvas.getBoundingClientRect();
    drag = {
      id: card.dataset.id,
      card,
      offX: (e.clientX - rect.left) / zoomLevel - parseFloat(card.style.left || '0'),
      offY: (e.clientY - rect.top) / zoomLevel - parseFloat(card.style.top || '0'),
    };
    try { card.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });

  const onPointerMove = (e) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) / zoomLevel - drag.offX;
    let y = (e.clientY - rect.top) / zoomLevel - drag.offY;
    const cw = drag.card.offsetWidth || LOC_W;
    const ch = drag.card.offsetHeight || CARD_H;
    x = Math.max(0, Math.min(x, CANVAS_W - cw));
    y = Math.max(0, Math.min(y, CANVAS_H - ch));
    drag.card.style.left = Math.round(x) + 'px';
    drag.card.style.top = Math.round(y) + 'px';
    const n = byId(drag.id);
    if (n) { n.pos_x = Math.round(x); n.pos_y = Math.round(y); }
    drawLinks();
    markDirty();
  };

  const onPointerUp = (e) => {
    if (drag) {
      try { drag.card.releasePointerCapture(e.pointerId); } catch (_) {}
      drag = null;
    }
  };

  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointerup', onPointerUp);

  // ── الأحداث ──
  canvas.addEventListener('change', async (e) => {
    const sel = e.target.closest('.t-parent');
    if (!sel) return;
    const id = sel.dataset.id;
    const val = sel.value || '';
    // v2.8.2 — الأب ممكن جهاز (D<id>) أو موقع (L<id>) أو لا شيء (جذر).
    if (id[0] === 'L') {
      // v2.8.4 — موقع: الربط عبر parent_id — نفس العلاقة التي يقرأها /api/topology و NOC.
      // (كان يكتب upstream_location_id الذي لا يقبله الخادم، فكان الاختيار يضيع بصمت.)
      const pid = val[0] === 'L' ? Number(val.slice(1)) : null;
      const ok = await saveLocationOne(id, { parent_id: pid });
      if (ok) { Object.assign(byId(id), { parent_id: pid }); renderCanvas(); }
      return;
    }
    // v2.8.3 — جهاز: اختيار مبنى يعدّل location_id (نفس حقل نموذج الجهاز/شجرة المواقع).
    const devPatch = val[0] === 'L'
      ? { parent_id: null, location_id: Number(val.slice(1)) }
      : val[0] === 'D'
        ? { parent_id: Number(val.slice(1)) }
        : { parent_id: null };
    const ok = await saveOne(id, devPatch);
    if (ok) {
      // v2.8.1 fix — تحديث محلي بدون loadAll (يحفظ السحبات غير المحفوظة).
      Object.assign(byId(id), devPatch);
      drawLinks();
      renderCanvas();
    }
  });
  canvas.addEventListener('click', async (e) => {
    const rm = e.target.closest('.t-remove');
    if (!rm) return;
    const id = rm.dataset.id;
    if (id[0] === 'L') {
      // v2.8.3 — ✕ على المبنى يخرجه **وأجهزته معًا** (الأجهزة تابعة لبطاقته — لو المبنى
      // خرج لوحده بقوا كروت منفردة متسربة، وده كان شكل خاطئ).
      const n = byId(id);
      const kids = n ? locChildren(n.location_id) : [];
      const locLayout = [{ id, pos_x: null, pos_y: null, _clear: true }];
      const devLayout = kids.map((k) => ({ id: String(k.id), pos_x: null, pos_y: null }));
      const okLoc = await saveLocationPositions(locLayout);
      const okDev = devLayout.length ? await savePositions(devLayout) : true;
      if (okLoc && okDev) {
        if (n) { n.pos_x = null; n.pos_y = null; }
        for (const k of kids) { k.pos_x = null; k.pos_y = null; }
        renderCanvas();
      }
      return;
    }
    const ok = await savePositions([{ id, pos_x: null, pos_y: null }]);
    if (ok) {
      // v2.8.1 fix — تحديث محلي بدل loadAll (نفس سبب تغيير الأب).
      const n = byId(id);
      if (n) { n.pos_x = null; n.pos_y = null; }
      renderCanvas();
    }
  });
  // عند إضافة مبنى يظهر دائمًا في أقصى اليمين
  function firstFreeSpot() {
    const W = LOC_W + 40, H = 240;
    // في الواجهة العربية واللوحة (2800px)، أقصى اليمين يبدأ بالقرب من 2400px
    const rightX = CANVAS_W - LOC_W - 60; // 2800 - 320 - 60 = 2420px
    const taken = placed().map((n) => ({ x: n.pos_x || 0, y: n.pos_y || 0 }));
    
    // نبحث عن أول صف عمودي فاضي في أقصى اليمين من الأعلى للأسفل
    for (let row = 0; row < 10; row++) {
      const y = 40 + row * H;
      if (!taken.some((t) => Math.abs(t.x - rightX) < W - 20 && Math.abs(t.y - y) < H - 20)) {
        return { x: rightX, y };
      }
    }
    // لو امتلأ العمود الأيمن، ننتقل للعمود المجاور له جهة اليسار
    const nextColX = rightX - W;
    for (let row = 0; row < 10; row++) {
      const y = 40 + row * H;
      if (!taken.some((t) => Math.abs(t.x - nextColX) < W - 20 && Math.abs(t.y - y) < H - 20)) {
        return { x: nextColX, y };
      }
    }
    const maxY = Math.max(40, ...taken.map((t) => t.y));
    return { x: rightX, y: maxY + H };
  }

  // v2.8.2 — إضافة مبنى يدويًا من القائمة المنسدلة:
  addLocSel.addEventListener('change', async () => {
    const id = addLocSel.value;
    if (!id) return;
    const n = byId(id);
    if (!n) return;
    const spot = firstFreeSpot();
    n.pos_x = spot.x; n.pos_y = spot.y;
    const ok = await saveLocationPositions([{ id, pos_x: n.pos_x, pos_y: n.pos_y }]);
    if (ok) {
      renderCanvas();
      showToast(T('s2j.the_building_was_added_to_the_board_drag_it', T('s2j.the_building_was_added_to_the_board_drag_it', T('s2j.the_building_was_added_to_the_board_drag_it', T('s2j.the_building_was_added_to_the_board_drag_it', T('s2j.the_building_was_added_to_the_board_drag_it', T('s2j.the_building_was_added_to_the_board_drag_it', '✅ تم إضافة المبنى إلى اللوحة — يمكنك سحبه ثم 💾 حفظ التخطيط')))))), { type: 'success' });
      setTimeout(() => centerOnNodes(true), 50);
    }
    addLocSel.value = '';
  });
  saveBtn.addEventListener('click', async () => {
    // v2.8.3 fix — حارس: نرفض الحفظ لو أي موضع null/NaN (كان بيمسح مواضع المباني في الداتا).
    const bad = placed().filter((n) => !Number.isFinite(Number(n.pos_x)) || !Number.isFinite(Number(n.pos_y)));
    if (bad.length) {
      showToast('❌ فيه ' + bad.length + ' عنصر بموضع غير صالح — أعد تحميل التبويب (↻) ثم احفظ', { type: 'error', duration: 6000 });
      return;
    }
    const pl = placed();
    const locs = pl.filter((n) => n.type === 'location').map((n) => ({ id: n.id, pos_x: Number(n.pos_x), pos_y: Number(n.pos_y) }));
    const devs = pl.filter((n) => n.type !== 'location').map((n) => ({ id: n.id, pos_x: Number(n.pos_x), pos_y: Number(n.pos_y) }));
    // v2.8.3 fix — نسكيب النداء لو القائمة فاضية (السيرفر يرفض layout=[] بـ «لا توجد مواضع»).
    const ok = (devs.length ? await savePositions(devs) : true) && (locs.length ? await saveLocationPositions(locs) : true);
    if (ok) {
      dirty = false;
      saveBtn.classList.remove('attention');
      dirtyEl.classList.add('hidden');
      showToast(T('s2j.layout_saved_it_will_appear_exactly_as_drawn', T('s2j.layout_saved_it_will_appear_exactly_as_drawn', T('s2j.layout_saved_it_will_appear_exactly_as_drawn', T('s2j.layout_saved_it_will_appear_exactly_as_drawn', T('s2j.layout_saved_it_will_appear_exactly_as_drawn', T('s2j.layout_saved_it_will_appear_exactly_as_drawn', '✅ تم حفظ التخطيط — سيُعرض كما رسمته في شاشة NOC')))))), { type: 'success' });
    }
  });
  document.getElementById('topo-reload-btn').addEventListener('click', loadAll);

  async function savePositions(layout) {
    try {
      // v2.8.3 guard — نفلتر أي عنصر بموضع غير صالح (يمنع مسح المواضع في الداتا).
      layout = (layout || []).filter((it) => Number.isFinite(Number(it.pos_x)) && Number.isFinite(Number(it.pos_y)));
      if (!layout.length) return true;
      const r = await fetch('/api/topology/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ layout }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'فشل الحفظ');
      return true;
    } catch (e) {
      showToast('❌ ' + e.message, { type: 'error' });
      return false;
    }
  }
  // v2.8.2 — حفظ مواضع/ربط المواقع عبر /api/locations/:id.
  async function saveLocationPositions(layout) {
    try {
      for (const it of layout) {
        const lid = Number(String(it.id).slice(1));
        // v2.8.3 guard — null مسموح فقط في الإخراج الصريح (✕)؛ غير كده نتجاهل العنصر.
        const isClear = !!it._clear;
        if (!isClear && (!Number.isFinite(Number(it.pos_x)) || !Number.isFinite(Number(it.pos_y)))) continue;
        const r = await fetch('/api/locations/' + lid, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          // v2.8.4 — _clear يطلب NULL حقيقيًا من الخادم (بدل ما null يتحول (0,0)).
          body: JSON.stringify(isClear
            ? { _pos_only: true, _clear: true }
            : { pos_x: Number(it.pos_x), pos_y: Number(it.pos_y), _pos_only: true }),
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || 'فشل حفظ موضع المبنى');
      }
      return true;
    } catch (e) {
      showToast('❌ ' + e.message, { type: 'error' });
      return false;
    }
  }
  async function saveLocationOne(lkey, patch) {
    const lid = Number(String(lkey).slice(1));
    const n = byId(lkey);
    try {
      // نجلب بيانات الموقع كاملة ثم نرسل التعديل (PUT يتطلب name).
      const g = await fetch('/api/locations', { credentials: 'same-origin' });
      const gj = await g.json();
      const loc = (gj.success && Array.isArray(gj.data)) ? gj.data.find((x) => Number(x.id) === lid) : null;
      if (!loc) throw new Error('المبنى غير موجود');
      // v2.8.4 — نرسل الحقول التي يقبلها PUT /api/locations/:id فعلًا (name/kind/parent_id/sort_order).
      const body = {
        name: loc.name, kind: loc.kind, parent_id: loc.parent_id,
        sort_order: loc.sort_order,
        ...patch,
      };
      const r = await fetch('/api/locations/' + lid, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'فشل الحفظ');
      return true;
    } catch (e) {
      showToast('❌ ' + e.message, { type: 'error' });
      return false;
    }
  }
  async function saveOne(id, patch) {
    const n = byId(id);
    if (!n) return false;
    const body = {
      name: n.name, ip: n.ip, device_type_id: n.device_type_id,
      location_id: n.location_id || null, parent_id: n.parent_id || null,
      pos_x: n.pos_x == null ? null : n.pos_x, pos_y: n.pos_y == null ? null : n.pos_y,
      check_protocol: n.check_protocol, port: n.port || null, web_port: n.web_port || null,
      check_interval_seconds: n.check_interval_seconds, failure_threshold: n.failure_threshold,
      is_active: n.is_active ? 1 : 0,
      ...patch,
    };
    try {
      const r = await fetch('/api/devices/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'فشل الحفظ');
      Object.assign(n, patch);
      return true;
    } catch (e) {
      showToast('❌ ' + e.message, { type: 'error' });
      return false;
    }
  }

  // نص مساعد للتحقق من التحميل
  function natKey(n) {
    const m = String(n.name || '').match(/(\d+)\s*$/);
    if (m) return parseInt(m[1], 10);
    const ipm = String(n.ip || '').match(/(\d+)\s*$/);
    return ipm ? parseInt(ipm[1], 10) : 999999;
  }

  // ── التمركز حول البطاقات في منتصف مجال الرؤية ──
  function centerOnNodes(smooth = false) {
    const pl = placed().filter((n) => n.type === 'location');
    if (!pl.length) return;
    const wrap = canvas.closest('.topo-canvas-wrap');
    if (!wrap || wrap.clientWidth === 0) return;
    const minX = Math.min(...pl.map((n) => n.pos_x || 0));
    const maxX = Math.max(...pl.map((n) => (n.pos_x || 0) + LOC_W));
    const minY = Math.min(...pl.map((n) => n.pos_y || 0));
    const maxY = Math.max(...pl.map((n) => (n.pos_y || 0) + 200));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const targetX = Math.max(0, centerX - wrap.clientWidth / 2);
    const targetY = Math.max(0, centerY - wrap.clientHeight / 2);

    if (smooth && typeof wrap.scrollTo === 'function') {
      wrap.scrollTo({ left: targetX, top: targetY, behavior: 'smooth' });
    } else {
      wrap.scrollLeft = targetX;
      wrap.scrollTop = targetY;
    }
  }

  // ── أزرار التكبير والملاءمة للشاشة (Zoom & Fit) ──
  function applyZoom() {
    canvas.style.transform = `scale(${zoomLevel})`;
    if (svg) svg.style.transform = `scale(${zoomLevel})`;
  }
  const zoomInBtn = document.getElementById('topo-zoom-in');
  const zoomOutBtn = document.getElementById('topo-zoom-out');
  const zoomResetBtn = document.getElementById('topo-zoom-reset');
  const zoomFitBtn = document.getElementById('topo-zoom-fit');

  if (zoomInBtn) zoomInBtn.addEventListener('click', () => { zoomLevel = Math.min(1.8, zoomLevel + 0.15); applyZoom(); });
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { zoomLevel = Math.max(0.35, zoomLevel - 0.15); applyZoom(); });
  if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => { zoomLevel = 1.0; applyZoom(); centerOnNodes(true); });
  if (zoomFitBtn) zoomFitBtn.addEventListener('click', () => {
    const wrap = canvas.closest('.topo-canvas-wrap');
    const pl = placed().filter((n) => n.type === 'location');
    if (wrap && pl.length) {
      const minX = Math.min(...pl.map((n) => n.pos_x || 0));
      const maxX = Math.max(...pl.map((n) => (n.pos_x || 0) + LOC_W));
      const minY = Math.min(...pl.map((n) => n.pos_y || 0));
      const maxY = Math.max(...pl.map((n) => (n.pos_y || 0) + 250));
      const contentW = Math.max(400, (maxX - minX) + 100);
      const contentH = Math.max(300, (maxY - minY) + 100);
      const scaleX = wrap.clientWidth / contentW;
      const scaleH = wrap.clientHeight / contentH;
      zoomLevel = Math.max(0.35, Math.min(1.0, Math.min(scaleX, scaleH)));
      applyZoom();
      centerOnNodes(true);
    }
  });

  // تحديث وتحريك الرؤية تلقائيًا عند الضغط على تبويب سلسلة الشبكة
  const tabBtn = document.getElementById('tab-topology');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => {
      setTimeout(() => {
        loadAll();
        setTimeout(() => centerOnNodes(true), 120);
      }, 50);
    });
  }

  if (canvas) loadAll();
})();
