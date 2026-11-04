/* SketchFlow editing tools + input routing: select/transform (elastic joins), joints, parametric dimensions, text, pick, pan, gestures, keys. */
(function (SF) {
'use strict';
const U = SF.U, G = SF.G, T = SF.tools;
const P = () => SF.prefs;
const cv = SF.cv;

/* =============== selection =============== */
const sel = SF.sel = {
  ids: new Set(), layerId: null,
  clear(silent) { sel.ids.clear(); sel.layerId = null; if (!silent) SF.emit('selection'); SF.requestRender(); },
  set(ids, layerId) { sel.ids = new Set(ids); sel.layerId = layerId || SF.doc.active; SF.overlay.pulseUntil = performance.now() + 2600; SF.emit('selection'); SF.requestRender(); },
  items() { const L = SF.doc.layers.find(l => l.id === sel.layerId); if (!L) return []; const items = SF.override && SF.override.layerId === L.id ? SF.override.items : L.items; return items.filter(i => sel.ids.has(i.id)); },
  box() { let b = null; for (const it of sel.items()) b = G.unionBox(b, G.bbox(it)); return b; },
  handles() {
    const b = sel.box(); if (!b) return [];
    const a = SF.toScreen(b.x, b.y), q = SF.toScreen(b.x + b.w, b.y + b.h), o = 4;
    return [{ k: 'nw', x: a.x - o, y: a.y - o }, { k: 'ne', x: q.x + o, y: a.y - o }, { k: 'se', x: q.x + o, y: q.y + o }, { k: 'sw', x: a.x - o, y: q.y + o }, { k: 'rot', x: (a.x + q.x) / 2, y: a.y - 30 }];
  },
  layer() { return SF.doc.layers.find(l => l.id === sel.layerId); }
};
SF.applyToSelection = (fn, label) => {
  const L = sel.layer(); if (!L || !sel.ids.size) return false;
  SF.setItems(L, L.items.map(it => (sel.ids.has(it.id) ? fn(it) : it))); SF.commit(label); return true;
};
SF.selectionActions = {
  del() { const L = sel.layer(); if (!L || !sel.ids.size) return; SF.setItems(L, L.items.filter(i => !sel.ids.has(i.id))); sel.clear(); SF.commit('Delete'); },
  dup() {
    const L = sel.layer(); if (!L || !sel.ids.size) return;
    const m = G.mat.translate(24 / SF.view.z, 24 / SF.view.z), copies = sel.items().map(it => Object.assign(G.transformItem(it, m), { id: U.uid(it.t[0]) }));
    SF.addItems(L, copies); sel.set(copies.map(c => c.id), L.id); SF.commit('Duplicate');
  },
  front() { const L = sel.layer(); if (!L) return; SF.setItems(L, L.items.filter(i => !sel.ids.has(i.id)).concat(L.items.filter(i => sel.ids.has(i.id)))); SF.commit('Bring to front'); },
  back() { const L = sel.layer(); if (!L) return; SF.setItems(L, L.items.filter(i => sel.ids.has(i.id)).concat(L.items.filter(i => !sel.ids.has(i.id)))); SF.commit('Send to back'); },
  flip(h) { const b = sel.box(); if (!b) return; const m = G.mat.around(b.x + b.w / 2, b.y + b.h / 2, h ? -1 : 1, h ? 1 : -1, 0); SF.applyToSelection(it => G.transformItem(it, m), h ? 'Flip horizontal' : 'Flip vertical'); },
  all() { const L = SF.layer(); if (!L) return; sel.set(L.items.map(i => i.id), L.id); SF.setTool('select'); }
};

function hitTop(x, y) {
  const tol = 6 / SF.view.z, d = SF.doc, ai = SF.layerIndex();
  const order = [ai].concat(d.layers.map((_, i) => i).reverse().filter(i => i !== ai));
  for (const li of order) {
    const L = d.layers[li]; if (!L || !L.visible || L.locked) continue;
    for (let i = L.items.length - 1; i >= 0; i--) { const it = L.items[i]; if (!it.hidden && !it.locked && G.hit(it, x, y, tol)) return { L, it }; }
  }
  return null;
}
SF.hitTop = hitTop;

/* elastic joins: unselected vertices that touch selected joints follow the transform */
function elasticRefs(L, ids) {
  if (!P().snap) return [];
  const selItems = L.items.filter(i => ids.has(i.id)), others = L.items.filter(i => !ids.has(i.id) && !i.locked);
  const refs = [], seen = new Set();
  for (const j of SF.joints(selItems)) for (const r of SF.coincident(others, j.x, j.y)) { const k = r.id + ':' + r.k; if (!seen.has(k)) { seen.add(k); refs.push(r); } }
  return refs;
}
let sx = null;
T.select = {
  cursor: 'default',
  down(e, d) {
    const z = SF.view.z;
    const s = SF.toScreen(d.x, d.y);
    if (sel.ids.size) {
      const h = sel.handles().find(h => Math.hypot(h.x - s.x, h.y - s.y) < 13);
      const b = sel.box();
      if (h || (b && d.x >= b.x && d.x <= b.x + b.w && d.y >= b.y && d.y <= b.y + b.h && !e.shiftKey)) return startXf(h ? h.k : 'move', d, b);
    }
    const hit = hitTop(d.x, d.y);
    if (hit) {
      if (hit.L.id !== SF.doc.active) { SF.doc.active = hit.L.id; SF.emit('layers'); }
      if (e.shiftKey && sel.layerId === hit.L.id) { const ids = new Set(sel.ids); ids.has(hit.it.id) ? ids.delete(hit.it.id) : ids.add(hit.it.id); sel.set(ids, hit.L.id); return false; }
      if (!sel.ids.has(hit.it.id)) {
        const grp = hit.it.pid && !e.altKey ? hit.L.items.filter(i => i.pid === hit.it.pid && !i.hidden && !i.locked).map(i => i.id) : [hit.it.id];
        sel.set(grp, hit.L.id);
      }
      return startXf('move', d, sel.box());
    }
    if (!e.shiftKey) sel.clear();
    sx = { mode: 'marquee', x0: d.x, y0: d.y }; SF.overlay.marquee = { x0: d.x, y0: d.y, x1: d.x, y1: d.y }; void z;
    return true;
  },
  move(e, d) {
    if (!sx) return;
    if (sx.mode === 'marquee') { SF.overlay.marquee.x1 = d.x; SF.overlay.marquee.y1 = d.y; SF.requestRender(); return; }
    const b = sx.box, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    let m;
    if (sx.mode === 'move') {
      let dx = d.x - sx.d0.x, dy = d.y - sx.d0.y;
      /* join-snap: nearest selected joint onto an unselected joint */
      SF.overlay.snap = null;
      if (P().snap && !e.altKey) {
        const r = SF.snapR(); let best = null, bd = r;
        const others = SF.joints(sx.L.items.filter(i => !sel.ids.has(i.id)));
        for (const j of sx.selJ) for (const o of others) { const dd = Math.hypot(j.x + dx - o.x, j.y + dy - o.y); if (dd < bd) { bd = dd; best = { j, o }; } }
        if (best) { dx = best.o.x - best.j.x; dy = best.o.y - best.j.y; SF.overlay.snap = { x: best.o.x, y: best.o.y, kind: 'joint', label: 'join' }; }
        else { const lp = sx.selJ[0] && SF.lattice(sx.selJ[0].x + dx, sx.selJ[0].y + dy); if (lp && Math.hypot(lp.x - sx.selJ[0].x - dx, lp.y - sx.selJ[0].y - dy) < r) { dx = lp.x - sx.selJ[0].x; dy = lp.y - sx.selJ[0].y; } }
      }
      m = G.mat.translate(dx, dy);
    } else if (sx.mode === 'rot') {
      let a = Math.atan2(d.y - cy, d.x - cx) - Math.atan2(sx.d0.y - cy, sx.d0.x - cx);
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      m = G.mat.around(cx, cy, 1, 1, a);
    } else {
      const corners = { nw: [b.x + b.w, b.y + b.h], ne: [b.x, b.y + b.h], se: [b.x, b.y], sw: [b.x + b.w, b.y] };
      const an = e.altKey ? [cx, cy] : corners[sx.mode];
      const d0 = Math.hypot(sx.d0.x - an[0], sx.d0.y - an[1]) || 1, d1 = Math.hypot(d.x - an[0], d.y - an[1]);
      const k = U.clamp(d1 / d0, 0.02, 50);
      m = G.mat.around(an[0], an[1], k, k, 0);
    }
    sx.m = m;
    /* measure against the committed geometry, not the previous preview frame */
    SF.override = null;
    let items = sx.L.items.map(it => {
      if (!sel.ids.has(it.id)) return it;
      /* text on a line that moves with its line keeps its place on it (only its size scales) */
      const refIds = (r) => (!r ? [] : r.a ? [r.a.id, r.b.id] : r.c ? [r.c.id] : [r.id]);
      if (it.t === 'text' && ((it.pathId && sel.ids.has(it.pathId)) || (it.surf && it.surf.some(Boolean) && it.surf.every(r => refIds(r).every(id => sel.ids.has(id))))))
        return Object.assign({}, it, { size: Math.max(4, it.size * G.xfScale(m)) });
      const o = G.transformItem(it, m);
      if (o.anc) { const keep = (r) => r && (sel.ids.has(r.ctr) || (r.mid && sel.ids.has(r.mid.id))); o.anc = { s: keep(o.anc.s) ? o.anc.s : null, e: keep(o.anc.e) ? o.anc.e : null }; if (!o.anc.s && !o.anc.e) o.anc = null; }
      /* a shape fill moved without its outline lets go of it */
      if (o.bind && !o.bind.every(r => (r.a ? sel.ids.has(r.a.id) && sel.ids.has(r.b.id) : sel.ids.has(r.id)))) { o.bind = null; o.holes = o.holes ? o.holes.map(h => Object.assign({}, h, { bind: [] })) : o.holes; }
      if (o.holes && it.holes && o !== it) o.holes = o.holes.map(h => Object.assign({}, h, { pts: (() => { const P2 = h.pts.slice(); for (let i = 0; i < P2.length; i += 3) { const q = G.xfPoint(m, P2[i], P2[i + 1]); P2[i] = q.x; P2[i + 1] = q.y; } return P2; })() }));
      return o;
    });
    items = SF.moveVertices(items, sx.refs, (x, y) => G.xfPoint(m, x, y));
    SF.override = { layerId: sx.L.id, items }; SF.requestRender();
  },
  up() {
    if (!sx) return;
    if (sx.mode === 'marquee') {
      const m = SF.overlay.marquee, L = SF.layer(); SF.overlay.marquee = null;
      const box = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
      if (L && box.w * SF.view.z > 3) { const ids = L.items.filter(it => G.boxHit(G.bbox(it), box)).map(i => i.id); const set = new Set(sel.layerId === L.id ? sel.ids : []); ids.forEach(i => set.add(i)); sel.set(set, L.id); }
    } else if (SF.override && sx.m) {
      SF.setItems(sx.L, SF.override.items); SF.override = null;
      SF.commit(sx.mode === 'move' ? (SF.overlay.snap ? 'Join' : 'Move') : sx.mode === 'rot' ? 'Rotate' : 'Scale');
    }
    SF.override = null; SF.overlay.snap = null; sx = null; SF.requestRender();
  },
  cancel() { sx = null; SF.override = null; SF.overlay.marquee = null; SF.requestRender(); }
};
function startXf(mode, d, box) {
  const L = sel.layer(); if (!L || L.locked) return false;
  sx = { mode, d0: d, box: box || sel.box(), L, refs: elasticRefs(L, sel.ids), selJ: SF.joints(L.items.filter(i => sel.ids.has(i.id))).slice(0, 400) };
  return true;
}

/* =============== joints tool =============== */
let jx = null, lastTap = { t: 0, x: 0, y: 0 };
T.joint = {
  cursor: 'default',
  down(e, d) {
    const L = SF.layer(); if (!L || L.locked) { SF.toast('Layer is locked'); return false; }
    const r = 16 / SF.view.z;
    let best = null, bd = r;
    for (const j of SF.joints(L.items)) { const dd = Math.hypot(j.x - d.x, j.y - d.y); if (dd < bd) { bd = dd; best = j; } }
    const now = performance.now();
    if (best && now - lastTap.t < 320 && Math.hypot(lastTap.x - best.x, lastTap.y - best.y) < 2) { lastTap.t = 0; removeVertex(L, best); return false; }
    if (best) { lastTap = { t: now, x: best.x, y: best.y }; }
    let items = L.items, refs;
    if (best) refs = e.altKey ? [{ id: best.id, k: best.k }] : SF.coincident(items, best.x, best.y);
    else {
      /* grab a line → insert a bendable joint there */
      let hit = null, hd = 10 / SF.view.z;
      for (const it of items) {
        if (it.t !== 'path') continue; const n = it.pts.length / 3, segs = n - 1 + (it.closed ? 1 : 0);
        for (let i = 0; i < segs; i++) { const a = i, b = (i + 1) % n; const q = G.segDist(d.x, d.y, it.pts[a * 3], it.pts[a * 3 + 1], it.pts[b * 3], it.pts[b * 3 + 1]); if (q.d < hd) { hd = q.d; hit = { it, i, q }; } }
      }
      if (!hit) return false;
      const it = hit.it, Pp = it.pts.slice(), ins = (hit.i + 1) * 3, pr = Pp[hit.i * 3 + 2];
      Pp.splice(ins, 0, hit.q.x, hit.q.y, pr);
      const ni = Object.assign({}, it, { pts: Pp });
      items = items.map(x => (x.id === it.id ? ni : x));
      refs = [{ id: it.id, k: hit.i + 1 }];
      best = { x: hit.q.x, y: hit.q.y, id: it.id, k: hit.i + 1 };
    }
    /* grabbing a connected line end lets go of its connector while you drag (drop it on another to reconnect) */
    const grabbed = new Map(refs.map(r => [r.id, r.k]));
    items = items.map(it => {
      if (!it.anc || !grabbed.has(it.id)) return it;
      const n = it.pts.length / 3, k = grabbed.get(it.id), anc = Object.assign({}, it.anc);
      if (k === 0) anc.s = null; else if (k === n - 1) anc.e = null; else return it;
      return Object.assign({}, it, { anc: anc.s || anc.e ? anc : null });
    });
    const ids = new Set(refs.map(r => r.id));
    jx = { L, base: items, refs, start: { x: best.x, y: best.y }, exRefs: new Set(refs.map(r => r.id + ':' + r.k)), ids };
    /* neighbour for direction constraint */
    const it0 = items.find(i => i.id === refs[0].id);
    if (it0 && it0.mode === 'poly') { const n = it0.pts.length / 3, k = refs[0].k, nb = k > 0 ? k - 1 : (n > 1 ? 1 : -1); if (nb >= 0) jx.from = { x: it0.pts[nb * 3], y: it0.pts[nb * 3 + 1] }; }
    SF.override = { layerId: L.id, items }; SF.requestRender();
    return true;
  },
  move(e, d) {
    if (!jx) return;
    const s = e.altKey ? { x: d.x, y: d.y } : SF.snapPoint(d.x, d.y, { items: jx.base, exRefs: jx.exRefs, segExclude: jx.ids, from: jx.from, maxDiff: 0.12, shift: e.shiftKey });
    SF.showSnap(s); jx.snap = s;
    const tx = s.x, ty = s.y;
    SF.override = { layerId: jx.L.id, items: SF.moveVertices(jx.base, jx.refs, () => ({ x: tx, y: ty })) };
    SF.requestRender();
  },
  up() {
    if (!jx) return;
    if (SF.override && jx.snap) {
      const na = SF.anchorOf(jx.snap), moved = new Map(jx.refs.map(r => [r.id, r.k]));
      const items = SF.override.items.map(it => {
        if (!moved.has(it.id) || it.t !== 'path') return it;
        const n = it.pts.length / 3, k = moved.get(it.id), key = k === 0 ? 's' : k === n - 1 ? 'e' : null; if (!key) return it;
        const anc = Object.assign({ s: null, e: null }, it.anc || {}); anc[key] = na; return Object.assign({}, it, { anc: anc.s || anc.e ? anc : null });
      });
      SF.override = null;
      SF.setItems(jx.L, items); SF.commit(jx.snap.kind === 'joint' ? 'Join' : na ? 'Connect' : 'Move joint');
    }
    else if (jx.base !== jx.L.items && !jx.snap) { /* inserted but not moved: discard */ }
    SF.override = null; SF.overlay.snap = null; SF.overlay.align = []; SF.overlay.ray = null; jx = null; SF.requestRender();
  },
  cancel() { jx = null; SF.override = null; SF.requestRender(); }
};
function removeVertex(L, j) {
  const it = L.items.find(i => i.id === j.id); if (!it || it.mode !== 'poly') return;
  const n = it.pts.length / 3; if (n <= 2 || (it.closed && n <= 3)) { SF.toast('A line needs at least two joints'); return; }
  const Pp = it.pts.slice(); Pp.splice(j.k * 3, 3);
  SF.replaceItem(L, Object.assign({}, it, { pts: Pp })); SF.commit('Remove joint');
}

/* =============== dimensions =============== */
let dx = null;
function bindPoint(x, y) {
  const s = SF.snapPoint(x, y, { noSegs: true, noAlign: true });
  if (s.kind === 'joint') return { ref: s.joint.id, k: s.joint.k, x: s.x, y: s.y, _snap: s };
  return { x: s.x, y: s.y, _snap: s.kind ? s : null };
}
T.dim = {
  cursor: 'crosshair',
  down(e, d) {
    const L = SF.drawTarget(); if (!L) return false;
    /* tap a label → edit value */
    for (let i = L.items.length - 1; i >= 0; i--) { const it = L.items[i]; if (it.t === 'dim') { const g = SF.dimGeom(it); if (Math.hypot(d.x - g.lx, d.y - g.ly) < 24 / SF.view.z) { dx = { mode: 'label', L, it, d0: d, off0: it.off, moved: false, lab0: { x: g.lx, y: g.ly } }; return true; } } }
    const a = bindPoint(d.x, d.y); SF.showSnap(a._snap);
    dx = { mode: 'new', L, a };
    return true;
  },
  move(e, d) {
    if (!dx) return;
    if (dx.mode === 'label') {
      const g = SF.dimGeom(dx.it); const dd = (d.x - dx.d0.x) * g.nx + (d.y - dx.d0.y) * g.ny;
      if (Math.hypot(d.x - dx.d0.x, d.y - dx.d0.y) * SF.view.z > 4) dx.moved = true;
      let patch = null;
      if (g.plane) {
        /* plane-following: the drag picks which plane's extension direction to use */
        const target = { x: dx.lab0.x + (d.x - dx.d0.x), y: dx.lab0.y + (d.y - dx.d0.y) }, mid = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }, v = { x: target.x - mid.x, y: target.y - mid.y };
        let best = null, bs = -1;
        for (const c of SF.dimExtCandidates(g.a, g.b)) { const s2 = Math.abs(v.x * Math.cos(c.a) + v.y * Math.sin(c.a)) / (Math.hypot(v.x, v.y) || 1); if (s2 > bs) { bs = s2; best = c; } }
        if (best) {
          const ea = best.extVP != null ? (() => { const vp = SF.doc.guides.vps[best.extVP], l = Math.hypot(vp.x - mid.x, vp.y - mid.y) || 1; return { x: (vp.x - mid.x) / l, y: (vp.y - mid.y) / l }; })() : { x: Math.cos(best.a), y: Math.sin(best.a) };
          patch = { ext: best.extVP != null ? null : best.a, extVP: best.extVP != null ? best.extVP : null, off: v.x * ea.x + v.y * ea.y };
        }
      }
      const off = dx.it.axis === 'h' ? dx.off0 + (d.y - dx.d0.y) : dx.it.axis === 'v' ? dx.off0 + (d.x - dx.d0.x) : dx.off0 + dd;
      dx.cur = Object.assign({}, dx.it, patch || { off });
      SF.override = { layerId: dx.L.id, items: dx.L.items.map(i => (i.id === dx.it.id ? dx.cur : i)) }; SF.requestRender(); return;
    }
    const b = bindPoint(d.x, d.y); SF.showSnap(b._snap); dx.b = b;
    const ax = Math.abs(b.x - dx.a.x) > Math.abs(b.y - dx.a.y) ? 'h' : 'v';
    dx.item = { t: 'dim', id: U.uid('d'), a: strip(dx.a), b: strip(b), off: -26 / SF.view.z, axis: e.shiftKey ? ax : null, color: P().color, width: Math.max(1, P().sizes.dim), size: Math.round(13 / Math.max(0.35, Math.min(SF.view.z, 2.5))), opacity: 1 };
    if (dx.item.axis === 'v') dx.item.off = 26 / SF.view.z;
    /* follow the drawing space's planes: extension lines run along an iso axis / toward a vanishing point */
    if (!e.shiftKey && P().dimPlanes !== false && SF.doc.guides.space !== 'free') {
      const cands = SF.dimExtCandidates(dx.a, b), u = Math.atan2(b.y - dx.a.y, b.x - dx.a.x);
      let best = null, bd = Infinity; for (const c of cands) { const df = Math.abs(U.angDiff(c.a, u) - Math.PI / 2) + (c.a > 0 ? 0 : 0.01); if (df < bd) { bd = df; best = c; } }
      if (best) { if (best.extVP != null) dx.item.extVP = best.extVP; else dx.item.ext = best.a; }
    }
    SF.live = { layerId: dx.L.id, item: dx.item }; SF.requestRender();
  },
  up() {
    if (!dx) return;
    if (dx.mode === 'label') {
      if (dx.moved && dx.cur) { SF.setItems(dx.L, SF.override.items); SF.commit('Move dimension'); }
      else SF.editDim(dx.L, dx.it);
      SF.override = null;
    } else if (dx.item && Math.hypot(dx.b.x - dx.a.x, dx.b.y - dx.a.y) > 3) { SF.addItems(dx.L, SF.autoColor([dx.item])); SF.commit('Dimension'); }
    SF.live = null; SF.overlay.snap = null; dx = null; SF.requestRender();
  },
  cancel() { dx = null; SF.live = null; SF.override = null; SF.requestRender(); }
};
function strip(p) { const o = { x: p.x, y: p.y }; if (p.ref) { o.ref = p.ref; o.k = p.k; } return o; }

/* parametric: set a dimension's length by moving its free/bound end (joined geometry follows) */
SF.setDimLength = (L, dim, newPx) => {
  /* a dimension that drives a primitive: rebuild the primitive from the new size */
  if (dim.drive && SF.regenPrim) {
    if (!(newPx > 0)) return false;
    const pp = SF.primParams(dim.drive.pid); if (!pp) { SF.toast('That object is no longer parametric'); return false; }
    const ok = SF.regenPrim(dim.drive.pid, pp.type === 'sphere' ? { W: newPx, D: newPx, H: newPx } : { [dim.drive.param]: newPx });
    if (ok) SF.commit((pp.type === 'sphere' ? 'Diameter = ' : 'Height = ') + SF.fmtLen(newPx));
    return ok;
  }
  const g = SF.dimGeom(dim); if (!g) return false;
  const cur = dim.axis === 'h' ? Math.abs(g.b.x - g.a.x) : dim.axis === 'v' ? Math.abs(g.b.y - g.a.y) : Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
  if (!(newPx > 0)) return false;
  const delta = newPx - cur;
  let ux, uy;
  if (dim.axis === 'h') { ux = Math.sign(g.b.x - g.a.x) || 1; uy = 0; } else if (dim.axis === 'v') { ux = 0; uy = Math.sign(g.b.y - g.a.y) || 1; } else { const l = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) || 1; ux = (g.b.x - g.a.x) / l; uy = (g.b.y - g.a.y) / l; }
  /* move end b (or a, reversed, if only a is bound) */
  let end = dim.b, sign = 1; if (!dim.b.ref && dim.a.ref) { end = dim.a; sign = -1; }
  const mvx = ux * delta * sign, mvy = uy * delta * sign;
  if (end.ref) {
    const f = SF.findItem(end.ref); if (!f) return false;
    const pos = SF.dimPoint(end), items0 = f.L.items;
    let refs = SF.coincident(items0, pos.x, pos.y);
    if (dim.axis === 'h' || dim.axis === 'v') {
      /* CAD-style stretch: the whole edge through the moved end travels with it, joined geometry follows */
      const touched = new Set(refs.map(r => r.id)), seen = new Set(refs.map(r => r.id + ':' + r.k));
      const add = (r) => { const k = r.id + ':' + r.k; if (!seen.has(k)) { seen.add(k); refs.push(r); } };
      for (const it of items0) {
        if (!touched.has(it.id) || it.t !== 'path' || it.mode !== 'poly') continue;
        for (let k = 0; k < it.pts.length / 3; k++) {
          const x = it.pts[k * 3], y = it.pts[k * 3 + 1];
          if (dim.axis === 'h' ? Math.abs(x - pos.x) < 0.75 : Math.abs(y - pos.y) < 0.75) { add({ id: it.id, k }); SF.coincident(items0, x, y).forEach(add); }
        }
      }
    }
    SF.setItems(f.L, SF.moveVertices(f.L.items, refs, (x, y) => ({ x: x + mvx, y: y + mvy })));
    SF.setItems(L, L.items.map(i => (i.id === dim.id ? Object.assign({}, i, { label: null }) : i)));
  } else {
    const ne = Object.assign({}, end, { x: end.x + mvx, y: end.y + mvy });
    SF.setItems(L, L.items.map(i => (i.id === dim.id ? Object.assign({}, i, sign > 0 ? { b: ne } : { a: ne }) : i)));
  }
  SF.commit('Dimension = ' + SF.fmtLen(newPx));
  return true;
};
SF.editDim = (L, dim) => {
  const ed = U.$('#dimEd'), g = SF.dimGeom(dim), s = SF.toScreen(g.lx, g.ly);
  const cur = Math.hypot(g.b2.x - g.a2.x, g.b2.y - g.a2.y) * (P().unitScale || 1);
  ed.hidden = false; ed.value = +cur.toFixed(Math.max(0, P().dimPrec || 0) + 2) + '';
  ed.style.left = (s.x - 45) + 'px'; ed.style.top = (s.y - 16) + 'px'; ed.focus(); ed.select();
  const done = (ok) => {
    ed.hidden = true; ed.onkeydown = null; ed.onblur = null;
    if (!ok) return;
    const v = parseFloat(String(ed.value).replace(',', '.'));
    if (v > 0) SF.setDimLength(L, dim, v / (P().unitScale || 1));
  };
  ed.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
  ed.onblur = () => done(true);
  SF.toast('Type a length — joined lines follow', 1600);
};

/* =============== text =============== */
let tx = null;
const tEd = U.$('#textEd');
T.text = {
  cursor: 'text',
  down(e, d) {
    if (tx) { commitText(); return false; }
    const L = SF.drawTarget(); if (!L) return false;
    const hit = hitTop(d.x, d.y);
    if (hit && hit.it.t === 'text' && hit.L.id === L.id) { openText(L, hit.it, true); return false; }
    const base = { t: 'text', id: U.uid('t'), x: d.x, y: d.y - P().sizes.text * 0.6, text: '', size: P().sizes.text, font: P().font, bold: P().bold, italic: P().italic, color: P().color, opacity: P().opac.text, align: 'left', r: 0 };
    const mode = P().textMode || (P().onPath ? 'path' : 'free');
    if (mode === 'path' && hit && hit.it.t === 'path' && hit.L.id === L.id) { base.pathId = hit.it.id; base.align = 'center'; }
    else if (mode === 'surface') {
      const f = (hit && hit.L.id === L.id && SF.faceOfItem(hit.it)) || SF.findFace(d.x, d.y);
      if (f && f.quad) {
        base.quad = f.quad; base.surf = f.refs; base.align = 'center';
        base.x = (f.quad[0] + f.quad[3] + f.quad[6] + f.quad[9]) / 4; base.y = (f.quad[1] + f.quad[4] + f.quad[7] + f.quad[10]) / 4;
      } else { SF.toast(((f && f.error) || 'No face here') + ' — tap inside a 4-sided face, or switch text to Free', 2200); return false; }
    }
    openText(L, base, false);
    return false;
  },
  move() {}, up() {}, cancel() { closeText(); }
};
function openText(L, it, existing) {
  tx = { L, it: Object.assign({}, it), existing };
  if (existing) SF.override = { layerId: L.id, items: L.items.filter(i => i.id !== it.id) };
  tEd.hidden = false; tEd.value = it.text;
  layoutText(); updateLive();
  const f = () => { tEd.focus({ preventScroll: true }); tEd.setSelectionRange(tEd.value.length, tEd.value.length); };
  f(); setTimeout(() => { if (tx && document.activeElement !== tEd) f(); }, 0);
}
function layoutText() {
  const it = tx.it, z = SF.view.z, s = SF.toScreen(it.x, it.y);
  tEd.style.font = SF.fontCss(Object.assign({}, it, { size: it.size * z }));
  const plain = !!(it.pathId || it.quad);
  tEd.style.color = plain ? SF.colors.ink : 'transparent'; tEd.style.caretColor = SF.colors.accent;
  tEd.style.background = plain ? SF.colors['pill-solid'] : 'transparent';
  const m = G.textMetrics(Object.assign({}, it, { text: tEd.value || ' ' }));
  if (plain) { tEd.style.transform = 'none'; tEd.style.font = '500 16px var(--f-ui)'; tEd.style.left = (s.x - 80) + 'px'; tEd.style.top = (s.y + 20) + 'px'; tEd.style.width = '200px'; tEd.style.height = '28px'; tEd.placeholder = it.quad ? 'Text on the surface…' : 'Text along the line…'; }
  else { tEd.placeholder = ''; tEd.style.left = s.x + 'px'; tEd.style.top = s.y + 'px'; tEd.style.width = (m.w * z + it.size * z) + 'px'; tEd.style.height = (m.h * z + 4) + 'px'; tEd.style.transform = `rotate(${it.r || 0}rad)`; tEd.style.transformOrigin = '0 0'; }
}
function updateLive() { if (!tx) return; tx.it.text = tEd.value; SF.live = { layerId: tx.L.id, item: Object.assign({}, tx.it) }; layoutText(); SF.requestRender(); }
tEd.addEventListener('input', updateLive);
tEd.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') { closeText(true); }
  else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
});
tEd.addEventListener('blur', () => setTimeout(() => { if (tx && document.activeElement !== tEd) commitText(); }, 120));
function commitText() {
  if (!tx) return;
  const { L, it, existing } = tx; it.text = tEd.value;
  const items = (SF.override && SF.override.layerId === L.id) ? SF.override.items : L.items;
  if (it.text.trim()) { SF.setItems(L, existing ? L.items.map(i => (i.id === it.id ? Object.assign({}, it) : i)) : items.concat(SF.autoColor([Object.assign({}, it)]))); SF.override = null; closeText(); SF.commit(existing ? 'Edit text' : 'Text'); }
  else { if (existing) { SF.setItems(L, L.items.filter(i => i.id !== it.id)); SF.override = null; closeText(); SF.commit('Delete text'); } else closeText(true); }
}
function closeText(discard) { tEd.hidden = true; SF.live = null; if (discard) SF.override = null; tx = null; SF.override = null; SF.requestRender(); }
SF.textEditing = () => !!tx;
SF.restyleText = (patch) => { if (tx) { Object.assign(tx.it, patch); updateLive(); return true; } return false; };

/* =============== pick / hand =============== */
T.pick = { cursor: 'crosshair', down(e, d) { const c = SF.sampleColor(d.x, d.y); SF.setColor(c); SF.toast('Picked ' + c, 900); return false; }, move() {}, up() {} };
let pan = null;
T.hand = {
  cursor: 'grab',
  down(e) { pan = { x: e.clientX, y: e.clientY, vx: SF.view.x, vy: SF.view.y }; cv.classList.add('grabbing'); return true; },
  move(e) { if (!pan) return; SF.view.x = pan.vx + e.clientX - pan.x; SF.view.y = pan.vy + e.clientY - pan.y; SF.emit('view'); SF.requestRender(); },
  up() { pan = null; cv.classList.remove('grabbing'); SF.gesturing = false; SF.requestRender(); },
  cancel() { this.up(); }
};
/* vanishing-point pip drag */
let vpd = null;
const VP = {
  down(e, k) { vpd = { k, x: e.clientX, y: e.clientY, v: Object.assign({}, SF.doc.guides.vps[k]) }; return true; },
  move(e) { if (!vpd) return; const z = SF.view.z, v = SF.doc.guides.vps[vpd.k]; v.x = vpd.v.x + (e.clientX - vpd.x) / z; v.y = vpd.v.y + (e.clientY - vpd.y) / z; if (SF.doc.guides.space === 'p2' && vpd.k < 2 && !e.altKey) { SF.doc.guides.vps[1 - vpd.k].y = v.y; } SF.requestRender(); },
  up() { vpd = null; SF.emit('change', 'guides'); SF.requestRender(); }, cancel() { vpd = null; }
};

/* =============== tool switching & ring =============== */
SF.setTool = (t) => {
  if (!T[t]) return;
  if (SF.textEditing() && t !== 'text') commitText();
  if (SF.primPlace && SF.primPlace.active()) SF.primPlace.cancel();
  P().tool = t; SF.savePrefs();
  cv.className = ''; const c = T[t].cursor; if (c === 'none') cv.classList.add('c-none'); else if (c === 'grab') cv.classList.add('c-hand'); else if (c === 'default') cv.classList.add('c-select'); else if (c === 'text') cv.classList.add('c-text');
  if (t !== 'select') { /* keep selection while recolouring via select only */ }
  SF.overlay.ring = null; SF.overlay.snap = null;
  SF.emit('tool', t); SF.requestRender();
};

/* =============== pointer routing & gestures =============== */
const ptrs = new Map();
let act = null, pinch = null, tapSess = null, longT = 0, space = false;
const fingersNav = (e) => e.pointerType === 'touch' && (P().fingers === 'never' || (P().fingers === 'auto' && P().sawPen));
function startPinch() {
  const [a, b] = [...ptrs.values()];
  pinch = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, vx: SF.view.x, vy: SF.view.y, z: SF.view.z };
  SF.gesturing = true;
}
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  if (SF.ui && SF.ui.wheelOpen && SF.ui.wheelOpen()) return;
  SF.emit('canvasdown');
  /* keep focus where we put it (text editor) instead of letting the browser move it on mousedown */
  e.preventDefault();
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae !== tEd && ae.blur) ae.blur();
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, x0: e.clientX, y0: e.clientY });
  if (e.pointerType === 'pen' && !P().sawPen) { P().sawPen = true; SF.savePrefs(); if (P().fingers === 'auto') SF.toast('Stylus detected — fingers now pan & zoom (change in Feel)'); }
  if (e.pointerType === 'touch') {
    const touches = [...ptrs.values()].filter(p => p.type === 'touch').length;
    if (!tapSess || touches === 1) tapSess = { t: performance.now(), max: touches, moved: false };
    tapSess.max = Math.max(tapSess.max, touches);
    if (touches >= 2) {
      clearTimeout(longT);
      if (act && act.young) { T[act.tool] && T[act.tool].cancel && T[act.tool].cancel(); act = null; }
      if (!act) { startPinch(); return; }
    }
  }
  if (e.button === 2 || (e.button === 0 && e.pointerType === 'pen' && (e.buttons & 2))) { SF.ui.openWheel(e.clientX, e.clientY, e.pointerId); return; }
  const d = SF.toDoc(e.clientX, e.clientY);
  if (e.button === 1 || space || fingersNav(e)) { if (T.hand.down(e)) act = { tool: 'hand', id: e.pointerId }; return; }
  if (/^p[123]$/.test(SF.doc.guides.space)) {
    const n = +SF.doc.guides.space[1];
    for (let k = 0; k < n; k++) { const p = SF.overlay['pip' + k]; if (p && Math.hypot(p.x - e.clientX, p.y - e.clientY) < 16) { VP.down(e, k); act = { tool: '_vp', id: e.pointerId }; return; } }
  }
  if (SF.motion && SF.motion.editing && SF.motion.pointerDown(e, d)) { act = { tool: '_motion', id: e.pointerId }; return; }
  let tool = P().tool;
  if (e.altKey && (tool === 'pen' || tool === 'shape' || tool === 'fill' || tool === 'text')) tool = 'pick';
  const ok = T[tool].down(e, d);
  if (ok) {
    act = { tool, id: e.pointerId, young: true, t0: performance.now() };
    setTimeout(() => { if (act) act.young = false; }, 220);
    if (e.pointerType === 'touch') { clearTimeout(longT); longT = setTimeout(() => { const p = ptrs.get(e.pointerId); if (act && p && Math.hypot(p.x - p.x0, p.y - p.y0) < 8) { T[act.tool].cancel && T[act.tool].cancel(); act = null; SF.ui.openWheel(p.x, p.y, e.pointerId); } }, 560); }
  }
});
cv.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (p) { p.x = e.clientX; p.y = e.clientY; if (tapSess && Math.hypot(p.x - p.x0, p.y - p.y0) > 10) tapSess.moved = true; }
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, dd = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const z = U.clamp(pinch.z * dd / pinch.d, 0.05, 16);
    SF.view.z = z;
    SF.view.x = cx - (pinch.cx - pinch.vx) * (z / pinch.z);
    SF.view.y = cy - (pinch.cy - pinch.vy) * (z / pinch.z);
    SF.emit('view'); SF.requestRender(); return;
  }
  const d = SF.toDoc(e.clientX, e.clientY);
  if (act && act.id === e.pointerId) {
    const list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    if (act.tool === '_vp') VP.move(e);
    else if (act.tool === '_motion') SF.motion.pointerMove(e, d);
    else T[act.tool].move(e, d, list);
    hover(e, d); return;
  }
  if (!e.buttons || e.pointerType === 'mouse') hover(e, d);
});
function hover(e, d) {
  const tool = P().tool, o = SF.overlay;
  o.hover = { x: e.clientX, y: e.clientY };
  if (tool === 'eraser') o.ring = { x: e.clientX, y: e.clientY, r: P().sizes.eraser / 2 };
  else if (tool === 'pen') o.ring = { x: e.clientX, y: e.clientY, r: Math.max(1, P().sizes[P().brush] / 2) };
  else o.ring = null;
  if (!act && (tool === 'pen' || tool === 'shape' || tool === 'dim') && P().snap && e.pointerType !== 'touch') { const s = SF.snapPoint(d.x, d.y, { noAlign: true }); SF.showSnap(s); SF.overlay.align = []; }
  if (!act && tool === 'select') o.hoverItem = (hitTop(d.x, d.y) || {}).it || null;
  if (!act && T[tool] && T[tool].hover) T[tool].hover(e, d);
  SF.requestRender();
}
function endPointer(e, cancel) {
  const had = ptrs.has(e.pointerId);
  ptrs.delete(e.pointerId);
  clearTimeout(longT);
  if (pinch) { if (ptrs.size < 2) { pinch = null; SF.gesturing = false; SF.requestRender(); } }
  if (act && act.id === e.pointerId) {
    const d = SF.toDoc(e.clientX, e.clientY);
    if (act.tool === '_vp') VP.up(); else if (act.tool === '_motion') SF.motion.pointerUp(e, d);
    else if (cancel) T[act.tool].cancel && T[act.tool].cancel(); else T[act.tool].up(e, d);
    act = null;
  }
  if (had && e.pointerType === 'touch' && tapSess && ![...ptrs.values()].some(p => p.type === 'touch')) {
    const dt = performance.now() - tapSess.t;
    if (!tapSess.moved && dt < 320) { if (tapSess.max === 2) SF.undo(); else if (tapSess.max === 3) SF.redo(); }
    tapSess = null;
  }
}
cv.addEventListener('pointerup', (e) => endPointer(e, false));
/* hover outlines point at item versions that an edit just replaced: drop them */
SF.on('history', () => { SF.overlay.hoverItem = null; SF.overlay.hl = null; });
cv.addEventListener('pointercancel', (e) => endPointer(e, true));
cv.addEventListener('pointerleave', (e) => { if (!act) { SF.overlay.ring = null; SF.overlay.hover = null; SF.overlay.snap = null; SF.requestRender(); } void e; });

cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const mouseish = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
  const zoom = e.ctrlKey || e.metaKey || (P().wheel === 'zoom') || (P().wheel === 'auto' && mouseish);
  /* wheel zoom / pan always redraws sharply from the vectors (no stretched preview) */
  if (zoom) { const k = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) * (e.ctrlKey && !mouseish ? 0.01 : 0.0018)); SF.zoomAt(e.clientX, e.clientY, k); }
  else { SF.view.x -= e.deltaX; SF.view.y -= e.deltaY; SF.emit('view'); SF.requestRender(); }
}, { passive: false });

/* =============== keyboard =============== */
const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };
window.addEventListener('keydown', (e) => {
  if (isTyping()) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  if (k === ' ') { space = true; cv.classList.add('c-hand'); e.preventDefault(); return; }
  if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? SF.redo() : SF.undo(); return; }
  if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); SF.redo(); return; }
  if (mod && (k === 'c' || k === 'C')) { e.preventDefault(); SF.io.copy(e.shiftKey ? 'layer' : 'flat'); return; }
  if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); SF.selectionActions.dup(); return; }
  if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); SF.selectionActions.all(); return; }
  if (mod && (k === 's' || k === 'S')) { e.preventDefault(); if (e.shiftKey) SF.io.exportFile('png'); else SF.io.saveNow(true); return; }
  if (mod && (k === 'o' || k === 'O')) { e.preventDefault(); U.$('#openIn').click(); return; }
  if (mod && k === 'Enter') { e.preventDefault(); SF.ui.openSend(); return; }
  if (mod && k === '0') { e.preventDefault(); SF.fit(); return; }
  if (mod && k === '1') { e.preventDefault(); SF.zoomAt(innerWidth / 2, innerHeight / 2, 1 / SF.view.z); return; }
  if (mod) return;
  if (k === 'Escape') { if (SF.primPlace && SF.primPlace.active()) SF.primPlace.cancel(); SF.ui.closeAll(); sel.clear(); if (act) { T[act.tool].cancel && T[act.tool].cancel(); act = null; } return; }
  if ((k === 'Delete' || k === 'Backspace')) { if (sel.ids.size) SF.selectionActions.del(); return; }
  if (k === 'Tab') { e.preventDefault(); SF.ui.toggleFocus(); return; }
  const map = { b: 'pen', s: 'shape', t: 'text', f: 'fill', e: 'eraser', v: 'select', j: 'joint', d: 'dim', i: 'pick', h: 'hand' };
  const lk = k.toLowerCase();
  if (map[lk] && !e.shiftKey) {
    if (lk === 'b' && P().tool === 'pen') { const br = ['pen', 'pencil', 'marker', 'brush']; P().brush = br[(br.indexOf(P().brush) + 1) % br.length]; SF.toast('Brush · ' + P().brush, 800); SF.emit('tool', 'pen'); }
    SF.setTool(map[lk]); return;
  }
  if (k === '[' || k === ']') { SF.ui.nudge(e.shiftKey ? 'op' : 'size', k === ']' ? 1 : -1); return; }
  if (k === '{' || k === '}') { SF.ui.nudge('op', k === '}' ? 1 : -1); return; }
  if (lk === 'p') { SF.ui.cycleSpace(e.shiftKey ? -1 : 1); return; }
  if (lk === 'm') { SF.ui.toggle('snap'); return; }
  if (lk === 'l') { SF.ui.toggle('lightbox'); return; }
  if (lk === 'g') { SF.ui.toggle('grid'); return; }
  if (lk === 'q') { const o = SF.overlay.hover || { x: innerWidth / 2, y: innerHeight / 2 }; SF.ui.openWheel(o.x, o.y, null); return; }
  if (lk === 'n') { e.shiftKey ? SF.ui.newBoard() : SF.ui.addLayer(); return; }
  if (k === '0') { SF.fit(); return; }
  if (k === '?') { SF.ui.openHub('help'); return; }
  if (lk === 'x' && SF.motion) { SF.motion.toggle(); return; }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { space = false; if (P().tool !== 'hand') cv.classList.remove('c-hand'); } });

})(window.SF);
