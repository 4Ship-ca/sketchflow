/* SketchFlow drawing tools: snapping engine, hold-to-shape recognition, pen, shapes, eraser, fill. */
(function (SF) {
'use strict';
const U = SF.U, G = SF.G;
const T = SF.tools = SF.tools || {};
const P = () => SF.prefs;
const COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;

/* =============== snapping =============== */
SF.snapR = () => 14 / SF.view.z;
SF.activeItems = () => { const L = SF.layer(); if (!L) return []; return SF.override && SF.override.layerId === L.id ? SF.override.items : L.items; };

SF.guideDirs = (x, y) => {
  const gd = SF.doc.guides, sp = gd.space, out = [], V = Math.PI / 2, C = SF.colors;
  const vp = (k) => { const v = gd.vps[k]; out.push({ a: Math.atan2(v.y - y, v.x - x), vp: k, color: [C.guide1, C.guide2, C.guide3][k], to: v }); };
  switch (sp) {
    case 'grid': out.push({ a: 0 }, { a: V }, { a: Math.PI / 4 }, { a: -Math.PI / 4 }); break;
    case 'iso': out.push({ a: Math.PI / 6 }, { a: -Math.PI / 6 }, { a: V }); break;
    case 'p1': vp(0); out.push({ a: 0 }, { a: V }); break;
    case 'p2': vp(0); vp(1); out.push({ a: V }); break;
    case 'p3': vp(0); vp(1); vp(2); break;
    case 'v3': case 'v4':
      if (sp === 'v4' && SF.viewQuad(x, y) === 'RT') out.push({ a: Math.PI / 6 }, { a: -Math.PI / 6 }, { a: V });
      else out.push({ a: 0 }, { a: V });
      break;
    default: break;
  }
  return out;
};
/* angle-snap fallback (Shift) */
const angleDirs = () => { const o = []; for (let k = 0; k < 12; k++) o.push({ a: k * Math.PI / 12 }); return o; };

SF.constrainDir = (s, p, dirs, maxDiff) => {
  if (!dirs.length) return null;
  const th = Math.atan2(p.y - s.y, p.x - s.x);
  let best = null, bd = Infinity;
  for (const d of dirs) { const df = U.angDiff(th, d.a); if (df < bd) { bd = df; best = d; } }
  if (bd > maxDiff) return null;
  const ux = Math.cos(best.a), uy = Math.sin(best.a), t = (p.x - s.x) * ux + (p.y - s.y) * uy;
  return { x: s.x + ux * t, y: s.y + uy * t, dir: best, t };
};

SF.lattice = (x, y) => {
  const gd = SF.doc.guides, sp = gd.space, g = gd.grid;
  const iso = () => { const dx = g * COS30; const i = Math.round(x / dx); const off = (i & 1) ? g / 2 : 0; const j = Math.round((y - off) / g); return { x: i * dx, y: j * g + off }; };
  const sq = () => ({ x: Math.round(x / g) * g, y: Math.round(y / g) * g });
  if (sp === 'grid') return sq();
  if (sp === 'iso') return iso();
  if (sp === 'v3' || sp === 'v4') return (sp === 'v4' && SF.viewQuad(x, y) === 'RT') ? iso() : sq();
  return null;
};

/* main snap: joints > constrained direction > on-line > lattice > alignment */
SF.snapPoint = (x, y, o) => {
  o = o || {};
  const r = SF.snapR(), items = o.items || SF.activeItems(), ex = o.exclude || null;
  const res = { x, y, kind: null };
  SF.overlay.align = []; SF.overlay.ray = null;
  if (!P().snap && !o.force) {
    if (o.from && o.shift) { const c = SF.constrainDir(o.from, { x, y }, angleDirs(), 1); if (c) { res.x = c.x; res.y = c.y; } }
    return res;
  }
  const J = SF.joints(items).filter(j => !(ex && ex.has(j.id)) && !(o.exRefs && o.exRefs.has(j.id + ':' + j.k)));
  const segEx = o.segExclude || ex;
  const nearJoint = (px, py) => { let b = null, bd = r; for (const j of J) { const d = Math.hypot(j.x - px, j.y - py); if (d < bd) { bd = d; b = j; } } return b; };
  let j = nearJoint(x, y);
  if (j && !o.noJoints) return { x: j.x, y: j.y, kind: 'joint', label: 'join', joint: j };
  /* connectors: shape centres and segment midpoints (a line that snaps here stays attached to it) */
  if (!o.noTargets) {
    const T2 = SF.snapTargets(items);
    const pick = (list) => { let b = null, bd = r; for (const q of list) { const rid = q.ref.ctr || (q.ref.mid && q.ref.mid.id); if (ex && ex.has(rid)) continue; const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; b = q; } } return b; };
    if (P().snapCtr !== false) { const q = pick(T2.ctrs); if (q) return { x: q.x, y: q.y, kind: 'ctr', label: 'centre', anchor: q.ref }; }
    if (P().snapMid !== false) { const q = pick(T2.mids); if (q) return { x: q.x, y: q.y, kind: 'mid', label: 'midpoint', anchor: q.ref }; }
  }
  /* perpendicular: the foot of the perpendicular from the start point onto a nearby line */
  if (o.from && P().snapPerp !== false && !o.noSegs) {
    let best = null, bd = r;
    for (const it of items) {
      if (it.t !== 'path' || it.bind || it.hidden || (segEx && segEx.has(it.id)) || it.pts.length < 6) continue;
      const b = G.bbox(it); if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) continue;
      const Pp = it.pts, n = Pp.length / 3, m = n - 1 + (it.closed ? 1 : 0);
      for (let i = 0; i < m; i++) {
        const k2 = (i + 1) % n, ax = Pp[i * 3], ay = Pp[i * 3 + 1], dx = Pp[k2 * 3] - ax, dy = Pp[k2 * 3 + 1] - ay, L2 = dx * dx + dy * dy; if (L2 < 1) continue;
        const t = ((o.from.x - ax) * dx + (o.from.y - ay) * dy) / L2; if (t < 0 || t > 1) continue;
        const fx = ax + dx * t, fy = ay + dy * t, dd = Math.hypot(fx - x, fy - y);
        if (dd < bd && Math.hypot(fx - o.from.x, fy - o.from.y) > r) { bd = dd; best = { x: fx, y: fy, segAng: Math.atan2(dy, dx) }; }
      }
    }
    if (best) return { x: best.x, y: best.y, kind: 'perp', label: '⊥ perpendicular', segAng: best.segAng };
  }
  /* constrained direction from a start point */
  if (o.from) {
    let dirs = o.shift ? angleDirs() : SF.guideDirs(o.from.x, o.from.y);
    /* starting on a line: offer square-off (⊥) and along-the-line directions */
    if (o.fromSegAng != null && P().snapPerp !== false) dirs = [{ a: o.fromSegAng + Math.PI / 2, perp: true }].concat(dirs);
    const c = SF.constrainDir(o.from, { x, y }, dirs, o.shift ? 1 : (o.maxDiff || 0.42));
    if (c) {
      res.x = c.x; res.y = c.y; res.kind = c.dir.perp ? 'perp' : 'dir'; res.dir = c.dir; if (c.dir.perp) { res.label = '⊥ square off'; res.segAng = o.fromSegAng; }
      const far = c.dir.to ? c.dir.to : { x: o.from.x + Math.cos(c.dir.a) * (c.t >= 0 ? 4000 : -4000), y: o.from.y + Math.sin(c.dir.a) * (c.t >= 0 ? 4000 : -4000) };
      SF.overlay.ray = { x1: o.from.x, y1: o.from.y, x2: far.x, y2: far.y, color: c.dir.color };
      j = nearJoint(res.x, res.y);
      if (j && !o.noJoints) return { x: j.x, y: j.y, kind: 'joint', label: 'join', joint: j };
      /* lattice along the ray */
      const lp = SF.lattice(res.x, res.y);
      if (lp && Math.hypot(lp.x - res.x, lp.y - res.y) < r * 0.8) { res.x = lp.x; res.y = lp.y; }
      return res;
    }
  }
  /* on an existing line (T-junction) */
  if (!o.noSegs) {
    let best = null, bd = r * 0.8;
    for (const it of items) {
      if (it.t !== 'path' || (segEx && segEx.has(it.id))) continue;
      const b = G.bbox(it); if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) continue;
      const Pp = it.pts, n = Pp.length / 3;
      const segs = n - 1 + (it.closed ? 1 : 0);
      for (let i = 0; i < segs; i++) {
        const a = i, bb = (i + 1) % n;
        const q = G.segDist(x, y, Pp[a * 3], Pp[a * 3 + 1], Pp[bb * 3], Pp[bb * 3 + 1]);
        if (q.d < bd) { bd = q.d; best = { x: q.x, y: q.y, id: it.id, seg: i, t: q.t }; }
      }
    }
    if (best) return { x: best.x, y: best.y, kind: 'seg', label: 'on line', seg: best };
  }
  const lp = SF.lattice(x, y);
  if (lp && Math.hypot(lp.x - x, lp.y - y) < r) { res.x = lp.x; res.y = lp.y; res.kind = 'grid'; }
  /* alignment with other joints (projection lines in 3-view) */
  if (P().align && !o.noAlign && res.kind !== 'grid') {
    let ax = null, ay = null, bdx = r * 0.6, bdy = r * 0.6;
    for (const jj of J) { const dx = Math.abs(jj.x - x), dy = Math.abs(jj.y - y); if (dx < bdx) { bdx = dx; ax = jj; } if (dy < bdy) { bdy = dy; ay = jj; } }
    if (ax) { res.x = ax.x; SF.overlay.align.push({ x1: ax.x, y1: ax.y, x2: ax.x, y2: y }); res.kind = res.kind || 'align'; }
    if (ay) { res.y = ay.y; SF.overlay.align.push({ x1: ay.x, y1: ay.y, x2: x, y2: ay.y }); res.kind = res.kind || 'align'; }
  }
  return res;
};
SF.showSnap = (s) => { SF.overlay.snap = s && ['joint', 'seg', 'grid', 'mid', 'ctr', 'perp'].includes(s.kind) ? s : null; };
/* angle of the segment a 'seg' snap landed on */
SF.segAngleOf = (s, items) => {
  if (!s) return null;
  const info = s.kind === 'seg' && s.seg ? { id: s.seg.id, k: s.seg.seg } : s.kind === 'mid' && s.anchor && s.anchor.mid ? { id: s.anchor.mid.id, k: s.anchor.mid.k } : null;
  if (!info) return null;
  const it = (items || SF.activeItems()).find(i => i.id === info.id); if (!it) return null;
  const n = it.pts.length / 3, k = info.k, k2 = (k + 1) % n;
  return Math.atan2(it.pts[k2 * 3 + 1] - it.pts[k * 3 + 1], it.pts[k2 * 3] - it.pts[k * 3]);
};
const anchorOf = (s) => (s && (s.kind === 'mid' || s.kind === 'ctr') ? s.anchor : null);
SF.anchorOf = anchorOf;

/* =============== hold-to-shape recognition =============== */
SF.recognize = (flat) => {
  const n = flat.length / 3; if (n < 4) return null;
  const pts = []; for (let i = 0; i < n; i++) pts.push({ x: flat[i * 3], y: flat[i * 3 + 1] });
  const len = G.pathLen(flat, false); if (len < 12) return null;
  const s = pts[0], e = pts[n - 1], chord = Math.hypot(e.x - s.x, e.y - s.y);
  const closed = chord < Math.max(18, len * 0.16);
  if (!closed) {
    let md = 0; for (const p of pts) md = Math.max(md, G.segDist(p.x, p.y, s.x, s.y, e.x, e.y).d);
    if (md < Math.max(4, chord * 0.07)) return { kind: 'line', pts: [s, e], closed: false, mode: 'poly' };
    const simp = G.rdp(flat, Math.max(5, len * 0.045));
    const k = simp.length / 3;
    if (k <= 7) { const o = []; for (let i = 0; i < k; i++) o.push({ x: simp[i * 3], y: simp[i * 3 + 1] }); return { kind: 'polyline', pts: o, closed: false, mode: 'poly' }; }
    /* arc: three-point circle through start/mid/end */
    const m = pts[Math.floor(n / 2)], cc = circle3(s, m, e);
    if (cc && cc.r < len * 3) {
      let err = 0; for (const p of pts) err += Math.abs(Math.hypot(p.x - cc.x, p.y - cc.y) - cc.r); err /= n;
      if (err < cc.r * 0.07) {
        const a0 = Math.atan2(s.y - cc.y, s.x - cc.x), am = Math.atan2(m.y - cc.y, m.x - cc.x); let a1 = Math.atan2(e.y - cc.y, e.x - cc.x);
        let sweep = norm(a1 - a0); const toM = norm(am - a0); if (!(toM > 0 === sweep > 0 && Math.abs(toM) < Math.abs(sweep))) sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI;
        const o = []; const segs = Math.max(8, Math.ceil(Math.abs(sweep) * 12));
        for (let i = 0; i <= segs; i++) { const a = a0 + sweep * i / segs; o.push({ x: cc.x + Math.cos(a) * cc.r, y: cc.y + Math.sin(a) * cc.r }); }
        return { kind: 'arc', pts: o, closed: false, mode: 'smooth' };
      }
    }
    return null;
  }
  /* closed: compare ellipse fit vs polygon fit */
  let cx = 0, cy = 0; for (const p of pts) { cx += p.x; cy += p.y; } cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0; for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; } sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc, ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ra = Math.sqrt(2 * l1), rb = Math.sqrt(2 * Math.max(l2, 1e-6));
  const circ = rb / ra > 0.84; if (circ) { ra = rb = (ra + rb) / 2; }
  let eErr = 0; const ca = Math.cos(-ang), sa = Math.sin(-ang);
  for (const p of pts) { const dx = p.x - cx, dy = p.y - cy, lx = dx * ca - dy * sa, ly = dx * sa + dy * ca; const rr = Math.hypot(lx / ra, ly / rb); eErr += Math.abs(rr - 1) * (ra + rb) / 2; }
  eErr /= n;
  const ring = flat.slice(0, (n - 1) * 3);
  let simp = G.rdp(flat, Math.max(6, len * 0.05));
  let poly = []; for (let i = 0; i < simp.length / 3; i++) poly.push({ x: simp[i * 3], y: simp[i * 3 + 1] });
  if (poly.length > 2 && Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) < Math.max(18, len * 0.16)) poly.pop();
  poly = mergeClose(poly, len * 0.06);
  let pErr = Infinity;
  if (poly.length >= 3 && poly.length <= 6) {
    pErr = 0; for (const p of pts) { let md = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; md = Math.min(md, G.segDist(p.x, p.y, a.x, a.y, b.x, b.y).d); } pErr += md; } pErr /= n;
  }
  void ring;
  if (pErr < eErr * 0.85 && poly.length >= 3) {
    if (poly.length === 4) poly = squareUp(poly);
    return { kind: poly.length === 3 ? 'triangle' : poly.length === 4 ? 'quad' : 'polygon', pts: poly, closed: true, mode: 'poly' };
  }
  const o = []; const segs = 48;
  for (let i = 0; i < segs; i++) { const a = i / segs * Math.PI * 2, lx = Math.cos(a) * ra, ly = Math.sin(a) * rb; o.push({ x: cx + lx * Math.cos(ang) - ly * Math.sin(ang), y: cy + lx * Math.sin(ang) + ly * Math.cos(ang) }); }
  return { kind: circ ? 'circle' : 'ellipse', pts: o, closed: true, mode: 'smooth', cx, cy };
};
function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function circle3(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)); if (Math.abs(d) < 1e-6) return null;
  const ux = ((a.x * a.x + a.y * a.y) * (b.y - c.y) + (b.x * b.x + b.y * b.y) * (c.y - a.y) + (c.x * c.x + c.y * c.y) * (a.y - b.y)) / d;
  const uy = ((a.x * a.x + a.y * a.y) * (c.x - b.x) + (b.x * b.x + b.y * b.y) * (a.x - c.x) + (c.x * c.x + c.y * c.y) * (b.x - a.x)) / d;
  return { x: ux, y: uy, r: Math.hypot(a.x - ux, a.y - uy) };
}
function mergeClose(poly, eps) { const o = []; for (const p of poly) { if (!o.length || Math.hypot(p.x - o[o.length - 1].x, p.y - o[o.length - 1].y) > eps) o.push(p); } if (o.length > 2 && Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y) < eps) o.pop(); return o; }
/* near-rectangles become exact axis-aligned rectangles; others keep their (perspective) corners */
function squareUp(q) {
  const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  let axis = true;
  for (let i = 0; i < 4; i++) { const a = ang(q[i], q[(i + 1) % 4]); const df = Math.min(U.angDiff(a, 0), U.angDiff(a, Math.PI / 2)); if (df > 0.17) axis = false; }
  if (!axis) return q;
  const b = G.ptsBox(q); return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
}
const toFlat = (pts, p) => { const o = []; for (const q of pts) o.push(q.x, q.y, p == null ? 0.5 : p); return o; };
SF.toFlat = toFlat;

/* =============== style helpers =============== */
SF.brushStyle = (brush) => {
  const p = P();
  const o = { color: p.color, width: p.sizes[brush] || 4, opacity: p.opac[brush] == null ? 1 : p.opac[brush], brush };
  if (p.lineType && p.lineType !== 'solid') o.lt = p.lineType;
  return o;
};
SF.newPath = (o) => Object.assign({ t: 'path', id: U.uid('p'), pts: [], closed: false, mode: 'free', brush: 'pen', color: P().color, width: 4, opacity: 1, fill: null, pv: false }, o);

/* =============== pen =============== */
let st = null;
const pressureOf = (e, brush, s) => {
  if (e.pointerType === 'pen') return e.pressure > 0 ? Math.pow(e.pressure, 0.85) : 0.5;
  if (brush === 'brush' && s) {
    const now = e.timeStamp || performance.now(), dt = Math.max(1, now - (s.lt || now - 16));
    const sp = s.lastScreen ? Math.hypot(e.clientX - s.lastScreen.x, e.clientY - s.lastScreen.y) / dt : 0;
    s.vp = U.lerp(s.vp == null ? 0.7 : s.vp, U.clamp(1.1 - sp * 0.45, 0.2, 1), 0.25); s.lt = now; s.lastScreen = { x: e.clientX, y: e.clientY };
    return s.vp;
  }
  return 0.5;
};
T.pen = {
  cursor: 'none',
  down(e, d) {
    const L = SF.drawTarget(); if (!L) return false;
    const brush = P().brush, style = SF.brushStyle(brush);
    let s0 = { x: d.x, y: d.y };
    let s0snap = null;
    if (P().snap) { const s = SF.snapPoint(d.x, d.y, { noAlign: true }); if (['joint', 'seg', 'mid', 'ctr'].includes(s.kind)) { s0 = s; s0snap = s; } }
    st = { L, brush, startSnap: s0 !== d ? s0 : null, s0snap, sx: s0.x, sy: s0.y, raw: [s0.x, s0.y], lock: null, shape: null, moved: 0, pointer: e.pointerType };
    const pr = pressureOf(e, brush, st);
    st.item = SF.newPath(Object.assign({ pts: [s0.x, s0.y, pr] }, style));
    SF.live = { layerId: L.id, item: st.item };
    armHold(d);
    SF.requestRender(); return true;
  },
  move(e, d, list) {
    if (!st) return;
    const z = SF.view.z, it = st.item;
    if (st.shape) { adjustShape(d, e); return; }
    if (e.shiftKey || st.lock) { straightTo(d, e); return; }
    for (const ev of list) {
      const q = SF.toDoc(ev.clientX, ev.clientY);
      const k = 1 - P().steady * 0.88;
      st.sx += (q.x - st.sx) * k; st.sy += (q.y - st.sy) * k;
      const n = it.pts.length / 3, lx = it.pts[(n - 1) * 3], ly = it.pts[(n - 1) * 3 + 1];
      if (Math.hypot(st.sx - lx, st.sy - ly) < 0.9 / z) continue;
      const pr = pressureOf(ev, st.brush, st);
      it.pts.push(st.sx, st.sy, pr);
    }
    /* perspective / space lock decision after ~14px of travel */
    const sp = SF.doc.guides.space;
    if (!st.lockTried && sp !== 'free' && P().snap) {
      const s = { x: it.pts[0], y: it.pts[1] };
      if (Math.hypot(d.x - s.x, d.y - s.y) > 16 / z) {
        st.lockTried = true;
        const c = SF.constrainDir(s, d, SF.guideDirs(s.x, s.y), 0.2);
        if (c && straightness(it.pts) > 0.95) { st.lock = c.dir; straightTo(d, e); return; }
      }
    }
    armHold(d);
    SF.requestRender();
  },
  up(e, d) {
    if (!st) return;
    clearTimeout(st.holdT);
    const L = st.L; let items;
    if (st.shape || st.lock || st.straight) items = finishShape();
    else items = finishFree();
    SF.live = null; SF.overlay.snap = null; SF.overlay.ray = null; SF.overlay.align = [];
    if (items && items.length) {
      if (st.shape) items.forEach(it => { it.shape = st.shape.kind; }); else if (st.lock || st.straight) items.forEach(it => { it.shape = 'line'; });
      /* connectors: ends that landed on a midpoint or centre stay attached to it */
      const it0 = items[0], sa = anchorOf(st.s0snap), ea = anchorOf(st.endSnap);
      if (it0 && !it0.closed && (sa || ea)) it0.anc = { s: sa || null, e: ea || null };
      SF.addItems(L, SF.autoColor(items)); SF.commit(st.shape ? 'Shape · ' + st.shape.kind : 'Stroke');
    }
    st = null; SF.requestRender();
  },
  cancel() { if (st) clearTimeout(st.holdT); st = null; SF.live = null; SF.overlay.snap = null; SF.overlay.ray = null; SF.requestRender(); }
};
function straightness(flat) { const n = flat.length / 3; if (n < 3) return 1; const L = G.pathLen(flat, false); const c = Math.hypot(flat[(n - 1) * 3] - flat[0], flat[(n - 1) * 3 + 1] - flat[1]); return L ? c / L : 1; }
function armHold(d) {
  if (!P().holdSnap) return;
  const z = SF.view.z;
  if (st.holdAt && Math.hypot(d.x - st.holdAt.x, d.y - st.holdAt.y) < 3 / z) return;
  st.holdAt = { x: d.x, y: d.y }; clearTimeout(st.holdT);
  st.holdT = setTimeout(() => {
    if (!st || st.shape || st.lock) return;
    const r = SF.recognize(st.item.pts);
    if (!r) return;
    st.shape = r; st.holdPoint = { x: st.holdAt.x, y: st.holdAt.y }; st.base = r.pts.map(p => ({ x: p.x, y: p.y }));
    if (r.kind === 'line' || r.kind === 'polyline') snapShapeVerts(r);
    applyShape();
    SF.overlay.flash = { x: st.holdAt.x, y: st.holdAt.y, t0: performance.now() };
    try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* no haptics */ }
    SF.toast && SF.toast('Snapped: ' + r.kind + ' · keep dragging to adjust', 1100);
    SF.requestRender();
  }, P().holdMs);
}
function snapShapeVerts(r) {
  if (!P().snap) return;
  const ex = new Set([st.item.id]);
  r.pts = r.pts.map((p, i) => { if (r.closed || i === 0 || i === r.pts.length - 1 || r.mode === 'poly') { const s = SF.snapPoint(p.x, p.y, { exclude: ex, noAlign: true, noSegs: !(i === 0 || i === r.pts.length - 1) }); if (s.kind === 'joint' || s.kind === 'seg' || s.kind === 'grid') return { x: s.x, y: s.y }; } return p; });
  st.base = r.pts.map(p => ({ x: p.x, y: p.y }));
}
function applyShape() {
  const r = st.shape, it = st.item;
  it.pts = toFlat(r.pts, avgP(it.pts)); it.closed = r.closed; it.mode = r.mode; it.pv = false;
  SF.live.item = it;
}
function avgP(flat) { let s = 0, n = flat.length / 3; for (let i = 0; i < n; i++) s += flat[i * 3 + 2]; return n ? s / n : 0.5; }
function adjustShape(d, e) {
  const r = st.shape;
  if (r.kind === 'line') {
    const a = r.pts[0];
    const s = SF.snapPoint(d.x, d.y, { from: a, shift: e.shiftKey, exclude: new Set([st.item.id]) });
    SF.showSnap(s);
    r.pts = [a, { x: s.x, y: s.y }];
  } else {
    let cx = 0, cy = 0; st.base.forEach(p => { cx += p.x; cy += p.y; }); cx /= st.base.length; cy /= st.base.length;
    if (r.cx != null) { cx = r.cx; cy = r.cy; }
    const d0 = Math.hypot(st.holdPoint.x - cx, st.holdPoint.y - cy) || 1, d1 = Math.hypot(d.x - cx, d.y - cy);
    const k = U.clamp(d1 / d0, 0.05, 20);
    r.pts = st.base.map(p => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
  }
  applyShape(); SF.requestRender();
}
function straightTo(d, e) {
  const it = st.item, s = { x: it.pts[0], y: it.pts[1] };
  st.straight = true;
  let q;
  if (st.lock) {
    const ux = Math.cos(st.lock.a), uy = Math.sin(st.lock.a); let a = st.lock.a;
    if (st.lock.to) { a = Math.atan2(st.lock.to.y - s.y, st.lock.to.x - s.x); }
    const vx = Math.cos(a), vy = Math.sin(a), t = (d.x - s.x) * vx + (d.y - s.y) * vy; void ux; void uy;
    q = { x: s.x + vx * t, y: s.y + vy * t };
    const j = SF.snapPoint(q.x, q.y, { exclude: new Set([it.id]), noSegs: true, noAlign: true });
    if (j.kind === 'joint') q = j;
    SF.overlay.ray = { x1: s.x, y1: s.y, x2: st.lock.to ? st.lock.to.x : s.x + vx * 4000 * Math.sign(t || 1), y2: st.lock.to ? st.lock.to.y : s.y + vy * 4000 * Math.sign(t || 1), color: st.lock.color };
    SF.showSnap(j.kind === 'joint' ? j : null);
  } else {
    q = SF.snapPoint(d.x, d.y, { from: s, shift: true, exclude: new Set([it.id]) }); SF.showSnap(q);
  }
  it.pts = [s.x, s.y, it.pts[2], q.x, q.y, it.pts[2]]; it.mode = 'poly'; it.pv = false;
  SF.requestRender();
}
function finishShape() {
  const it = st.item;
  if (it.mode === 'poly' && !it.closed) {
    const n = it.pts.length / 3, ex = new Set([it.id]);
    const e = SF.snapPoint(it.pts[(n - 1) * 3], it.pts[(n - 1) * 3 + 1], { exclude: ex, noAlign: true, noTargets: !!st.lock });
    if (['joint', 'seg', 'mid', 'ctr'].includes(e.kind)) { it.pts[(n - 1) * 3] = e.x; it.pts[(n - 1) * 3 + 1] = e.y; st.endSnap = e; }
  }
  if (it.pts.length === 6 && Math.hypot(it.pts[3] - it.pts[0], it.pts[4] - it.pts[1]) < 0.5) return [];
  return [splitT(it)];
}
function finishFree() {
  const it = st.item, z = SF.view.z;
  let n = it.pts.length / 3;
  if (n >= 2) {
    /* tail join */
    if (P().snap) {
      const ex = new Set([it.id]);
      const e = SF.snapPoint(it.pts[(n - 1) * 3], it.pts[(n - 1) * 3 + 1], { exclude: ex, noAlign: true });
      if (['joint', 'seg', 'mid', 'ctr'].includes(e.kind)) {
        const moved = SF.moveVertex(Object.assign({}, it, { mode: 'free' }), n - 1, e.x, e.y); it.pts = moved.pts;
        it.pts[(n - 1) * 3] = e.x; it.pts[(n - 1) * 3 + 1] = e.y; st.endSnap = e;
      }
    }
    it.pts = G.rdp(it.pts, 0.35 / z);
    n = it.pts.length / 3;
    let mn = 1, mx = 0; for (let i = 0; i < n; i++) { mn = Math.min(mn, it.pts[i * 3 + 2]); mx = Math.max(mx, it.pts[i * 3 + 2]); }
    it.pv = (mx - mn) > 0.06 || (st.pointer === 'pen' && it.brush !== 'marker');
  }
  return [splitT(it)];
}
/* a T-junction snap onto another line does not split it; we only keep the joint point. */
function splitT(it) { return Object.assign({}, it, { pts: it.pts.slice() }); }

/* =============== shapes =============== */
SF.SHAPES2D = ['line', 'arrow', 'rect', 'ellipse', 'triangle', 'diamond', 'star', 'hexagon'];
SF.PRIMS = ['box', 'cylinder', 'cone', 'sphere', 'pyramid', 'prism'];
SF.SHAPES = SF.SHAPES2D.concat(SF.PRIMS);
SF.makeShape = (type, a, b, mods, style) => {
  mods = mods || {}; style = style || SF.brushStyle('shape');
  if (SF.PRIMS.includes(type) && SF.makePrim) return SF.makePrim(type, a, b, mods, style);
  let x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  if (mods.square && type !== 'line' && type !== 'arrow') { const s = Math.max(x1 - x0, y1 - y0); x1 = a.x <= b.x ? a.x + s : a.x; x0 = a.x <= b.x ? a.x : a.x - s; y1 = a.y <= b.y ? a.y + s : a.y; y0 = a.y <= b.y ? a.y : a.y - s; }
  if (mods.center && type !== 'line' && type !== 'arrow') { const hw = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y); x0 = a.x - hw; x1 = a.x + hw; y0 = a.y - hh; y1 = a.y + hh; }
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const fillMode = P().shapeFill;
  const base = Object.assign({}, style, { mode: 'poly', closed: true, pv: false, brush: 'shape', shape: type });
  if (fillMode === 'fill') { base.fill = style.color; base.stroke = false; }
  else if (fillMode === 'both') { base.fill = style.color; base.fillOpacity = 0.28; }
  const mk = (pts, o) => SF.newPath(Object.assign({}, base, { pts: toFlat(pts) }, o || {}));
  switch (type) {
    case 'line': return [mk([a, b], { closed: false, fill: null, stroke: true })];
    case 'arrow': return [mk([a, b], { closed: false, fill: null, stroke: true, arrow: true })];
    case 'rect': return [mk([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }])];
    case 'ellipse': { const o = []; for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; o.push({ x: cx + Math.cos(t) * w / 2, y: cy + Math.sin(t) * h / 2 }); } return [mk(o, { mode: 'smooth' })]; }
    case 'triangle': return [mk([{ x: cx, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }])];
    case 'diamond': return [mk([{ x: cx, y: y0 }, { x: x1, y: cy }, { x: cx, y: y1 }, { x: x0, y: cy }])];
    case 'star': { const o = []; for (let i = 0; i < 10; i++) { const t = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; o.push({ x: cx + Math.cos(t) * w / 2 * r, y: cy + Math.sin(t) * h / 2 * r * 1.05 + h * 0.03 }); } return [mk(o)]; }
    case 'hexagon': { const o = []; for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3; o.push({ x: cx + Math.cos(t) * w / 2, y: cy + Math.sin(t) * h / 2 }); } return [mk(o)]; }
  }
  return [];
};
let sh = null;
T.shape = {
  cursor: 'crosshair',
  down(e, d) {
    /* 3D primitives: two-step placement (base from a corner or the centre, then height) */
    if (SF.primPlace && (SF.primPlace.active() || SF.primPlace.applies(d))) { sh = null; return SF.primPlace.down(e, d); }
    const L = SF.drawTarget(); if (!L) return false;
    const s = SF.snapPoint(d.x, d.y, {});
    /* starting on a centre ⊕ grows the shape equally in both directions */
    sh = { L, a: { x: s.x, y: s.y }, aSnap: s, aSegAng: SF.segAngleOf(s, L.items), center: s.kind === 'ctr' };
    SF.showSnap(s); return true;
  },
  hover(e, d) { if (SF.primPlace && SF.primPlace.active()) SF.primPlace.hover(e, d); },
  move(e, d) {
    if (SF.primPlace && SF.primPlace.active()) { SF.primPlace.move(e, d); return; }
    if (!sh) return;
    const type = P().shape, isLine = type === 'line' || type === 'arrow';
    const s = SF.snapPoint(d.x, d.y, isLine ? { from: sh.a, shift: e.shiftKey, fromSegAng: sh.aSegAng } : {});
    SF.showSnap(s);
    sh.b = { x: s.x, y: s.y }; sh.bSnap = s;
    sh.items = SF.makeShape(type, sh.a, sh.b, { square: e.shiftKey && !isLine, center: e.altKey || (sh.center && !isLine) });
    SF.live = { layerId: sh.L.id, item: sh.items };
    SF.requestRender();
  },
  up(e, d) {
    if (SF.primPlace && SF.primPlace.active()) { SF.primPlace.up(e, d); return; }
    if (!sh) return;
    if (sh.items && sh.b && Math.hypot(sh.b.x - sh.a.x, sh.b.y - sh.a.y) > 2) {
      const type = P().shape;
      if ((type === 'line' || type === 'arrow') && sh.items[0]) { const sa = anchorOf(sh.aSnap), ea = anchorOf(sh.bSnap); if (sa || ea) sh.items[0].anc = { s: sa || null, e: ea || null }; }
      SF.addItems(sh.L, SF.autoColor(sh.items)); SF.commit('Shape · ' + type);
    }
    sh = null; SF.live = null; SF.overlay.snap = null; SF.overlay.ray = null; SF.overlay.align = []; SF.requestRender();
  },
  cancel() { sh = null; SF.live = null; if (SF.primPlace && SF.primPlace.active()) SF.primPlace.cancel(); SF.requestRender(); }
};

/* =============== eraser =============== */
/* splits vector paths precisely where the eraser circle crosses them */
function segCircle(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay, fx = ax - cx, fy = ay - cy;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  if (A < 1e-9) return C <= 0 ? [0, 1] : null;
  const disc = B * B - 4 * A * C; if (disc <= 0) return null;
  const sq = Math.sqrt(disc); let t0 = (-B - sq) / (2 * A), t1 = (-B + sq) / (2 * A);
  if (t1 < 0 || t0 > 1) return null;
  return [Math.max(0, t0), Math.min(1, t1)];
}
SF.cutPath = (it, cx, cy, r) => {
  const P0 = it.pts, n = P0.length / 3; const rr = r + (it.stroke === false ? 0 : it.width * 0.35);
  const b = G.bbox(it); if (cx < b.x - rr || cx > b.x + b.w + rr || cy < b.y - rr || cy > b.y + b.h + rr) return null;
  if (n === 1) return Math.hypot(P0[0] - cx, P0[1] - cy) < rr ? [] : null;
  const pts = []; for (let i = 0; i < n; i++) pts.push([P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]);
  if (it.closed) pts.push(pts[0].slice());
  const runs = []; let cur = []; let hit = false;
  const lerp3 = (a, b2, t) => [U.lerp(a[0], b2[0], t), U.lerp(a[1], b2[1], t), U.lerp(a[2], b2[2], t)];
  if (Math.hypot(pts[0][0] - cx, pts[0][1] - cy) >= rr) cur.push(pts[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], bb = pts[i + 1];
    const ins = segCircle(a[0], a[1], bb[0], bb[1], cx, cy, rr);
    if (!ins) { if (cur.length || Math.hypot(a[0] - cx, a[1] - cy) >= rr) { if (!cur.length) cur.push(a); cur.push(bb); } continue; }
    hit = true;
    if (ins[0] > 0) { cur.push(lerp3(a, bb, ins[0])); if (cur.length >= 2) runs.push(cur); cur = []; }
    else { if (cur.length >= 2) runs.push(cur); cur = []; }
    if (ins[1] < 1) cur = [lerp3(a, bb, ins[1]), bb];
  }
  if (cur.length >= 2) runs.push(cur);
  if (!hit) return null;
  if (it.closed && runs.length >= 2) {
    const f = runs[0], l = runs[runs.length - 1];
    if (f[0][0] === pts[0][0] && f[0][1] === pts[0][1] && Math.hypot(l[l.length - 1][0] - pts[0][0], l[l.length - 1][1] - pts[0][1]) < 1e-6) { runs[0] = l.concat(f.slice(1)); runs.pop(); }
  }
  return runs.filter(rn => { let L = 0; for (let i = 1; i < rn.length; i++) L += Math.hypot(rn[i][0] - rn[i - 1][0], rn[i][1] - rn[i - 1][1]); return L > 0.6; })
    .map(rn => Object.assign({}, it, { id: U.uid('p'), pts: rn.flat(), closed: false, fill: null, arrow: false, shape: it.shape === 'arc' ? 'arc' : undefined, name: undefined }));
};
let er = null;
function eraseAt(items, x, y, r, mode) {
  let changed = false; const out = [];
  for (const it of items) {
    if (it.hidden || it.locked) { out.push(it); continue; }
    if (it.t === 'path' && mode !== 'pixels') {
      if (mode === 'whole') { if (G.hit(it, x, y, r)) { changed = true; continue; } out.push(it); continue; }
      if (it.stroke === false) { out.push(it); continue; }
      const res = SF.cutPath(it, x, y, r);
      if (res) { changed = true; out.push(...res); } else out.push(it);
    } else if ((it.t === 'text' || it.t === 'dim') && mode !== 'pixels') {
      if (G.hit(it, x, y, r)) { changed = true; continue; } out.push(it);
    } else if (it.t === 'image') {
      if (mode === 'whole' && G.hit(it, x, y, 0)) { changed = true; continue; }
      if (mode === 'pixels' && G.hit(Object.assign({}, it, { fill: null, cut: null }), x, y, r)) {
        let w = er.work.get(it.id);
        if (!w) { w = U.copyCanvas(it.img); er.work.set(it.id, w); }
        const p = G.rot(x, y, it.x, it.y, -(it.r || 0));
        let lx = (p.x - it.x) / it.s + it.iw / 2, ly = (p.y - it.y) / it.s + it.ih / 2;
        if (it.fx) lx = it.iw - lx; if (it.fy) ly = it.ih - ly;
        const g = w.getContext('2d'); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(lx, ly, r / it.s, 0, Math.PI * 2); g.fill();
        out.push(Object.assign({}, it, { img: w, cut: true })); changed = true;
      } else out.push(it);
    } else out.push(it);
  }
  return changed ? out : items;
}
T.eraser = {
  cursor: 'none',
  down(e, d) {
    const L = SF.layer(); if (!L || L.locked) { SF.toast('This layer is locked'); return false; }
    er = { L, items: L.items, last: d, work: new Map() };
    this.apply(d); return true;
  },
  apply(d) {
    const r = P().sizes.eraser / 2, mode = P().eraseMode;
    const a = er.last, dist = Math.hypot(d.x - a.x, d.y - a.y), steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
    for (let s = 1; s <= steps; s++) { const t = s / steps; er.items = eraseAt(er.items, U.lerp(a.x, d.x, t), U.lerp(a.y, d.y, t), r, mode); }
    if (steps === 1 && dist === 0) er.items = eraseAt(er.items, d.x, d.y, r, mode);
    er.last = d;
    SF.override = { layerId: er.L.id, items: er.items.slice() }; SF.requestRender();
  },
  move(e, d) { if (er) this.apply(d); },
  up() {
    if (!er) return;
    if (er.items !== er.L.items) { SF.setItems(er.L, er.items); SF.override = null; SF.commit('Erase'); }
    else { SF.override = null; const mode = P().eraseMode; if (mode === 'cut' && er.L.items.some(i => i.t === 'image') && !P().tips.eraseImg) { P().tips.eraseImg = 1; SF.savePrefs(); SF.toast('Tip: set the eraser to “Pixels” to erase photos'); } }
    er = null; SF.requestRender();
  },
  cancel() { er = null; SF.override = null; SF.requestRender(); }
};

/* =============== fill (region fill becomes a tinted bitmap item under the ink) =============== */
SF.floodMask = (data, w, h, sx, sy, tol, refColor) => {
  const mask = new Uint8Array(w * h), stack = new Int32Array(w * h);
  const i0 = (sy * w + sx) * 4;
  const r0 = refColor ? refColor[0] : data[i0], g0 = refColor ? refColor[1] : data[i0 + 1], b0 = refColor ? refColor[2] : data[i0 + 2], a0 = refColor ? refColor[3] : data[i0 + 3];
  const th = (tol / 100) * (tol / 100) * 4 * 255 * 255;
  const ok = (i) => { const j = i * 4, dr = data[j] - r0, dg = data[j + 1] - g0, db = data[j + 2] - b0, da = data[j + 3] - a0; return dr * dr + dg * dg + db * db + da * da * 1.2 <= th; };
  let sp = 0; stack[sp++] = sy * w + sx; mask[sy * w + sx] = 1;
  while (sp) {
    const i = stack[--sp], x = i % w, y = (i / w) | 0;
    if (x > 0 && !mask[i - 1] && ok(i - 1)) { mask[i - 1] = 1; stack[sp++] = i - 1; }
    if (x < w - 1 && !mask[i + 1] && ok(i + 1)) { mask[i + 1] = 1; stack[sp++] = i + 1; }
    if (y > 0 && !mask[i - w] && ok(i - w)) { mask[i - w] = 1; stack[sp++] = i - w; }
    if (y < h - 1 && !mask[i + w] && ok(i + w)) { mask[i + w] = 1; stack[sp++] = i + w; }
  }
  return mask;
};
SF.dilate = (mask, w, h, r) => {
  let m = mask;
  for (let k = 0; k < r; k++) {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w])) o[i] = 1; }
    m = o;
  }
  return m;
};
SF.retint = (img, color) => { const c = U.copyCanvas(img), g = c.getContext('2d'); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); return c; };
SF.fillAt = (x, y, color) => {
  const L = SF.drawTarget(); if (!L) return false;
  const d = SF.doc;
  if (x < 0 || y < 0 || x >= d.w || y >= d.h) return false;
  /* tap an existing fill → recolour it */
  for (let i = L.items.length - 1; i >= 0; i--) {
    const it = L.items[i];
    if (it.hidden || it.locked) continue;
    if (it.t === 'image' && it.fill && G.hit(it, x, y, 0)) { SF.replaceItem(L, Object.assign({}, it, { img: SF.retint(it.img, color), fill: color })); SF.commit('Recolour fill'); return true; }
    if (it.t === 'path' && it.closed && it.fill && G.hit(it, x, y, 0)) { SF.replaceItem(L, Object.assign({}, it, { fill: color })); SF.commit('Recolour fill'); return true; }
    if (it.t === 'path' && G.hit(it, x, y, 1)) { SF.replaceItem(L, Object.assign({}, it, { color })); SF.commit('Recolour line'); return true; }
  }
  const sc = Math.min(1, 2200 / Math.max(d.w, d.h)), w = Math.round(d.w * sc), h = Math.round(d.h * sc);
  const c = U.canvas(w, h), g = c.getContext('2d');
  g.setTransform(sc, 0, 0, sc, 0, 0);
  const src = P().fillAll ? d.layers.filter(l => l.visible) : [L];
  /* dimensions and text are transparent to fill: they never split a region */
  for (const l of src) { g.globalAlpha = l.opacity; SF.drawItems(g, SF.layerItems(l).filter(i => i.t !== 'dim' && i.t !== 'text' && !(i.t === 'path' && SF.lineType(i) !== 'solid')), null, {}); }
  const im = g.getImageData(0, 0, w, h);
  const sx = U.clamp(Math.floor(x * sc), 0, w - 1), sy = U.clamp(Math.floor(y * sc), 0, h - 1);
  let mask = SF.floodMask(im.data, w, h, sx, sy, P().fillTol);
  mask = SF.dilate(mask, w, h, Math.max(1, Math.round(1.5 * sc + 0.5)));
  let x0 = w, y0 = h, x1 = -1, y1 = -1, cnt = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (mask[yy * w + xx]) { cnt++; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  if (!cnt) return false;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, out = U.canvas(bw, bh), og = out.getContext('2d'), oi = og.createImageData(bw, bh);
  if (P().autoTypeColor) color = SF.typeColors().Fills;
  const [r, gg, b] = U.hexToRgb(color);
  for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) { if (!mask[(yy + y0) * w + xx + x0]) continue; const j = (yy * bw + xx) * 4; oi.data[j] = r; oi.data[j + 1] = gg; oi.data[j + 2] = b; oi.data[j + 3] = 255; }
  og.putImageData(oi, 0, 0);
  const item = { t: 'image', id: U.uid('f'), img: out, iw: bw, ih: bh, x: (x0 + bw / 2) / sc, y: (y0 + bh / 2) / sc, s: 1 / sc, r: 0, opacity: P().opac.pen == null ? 1 : 1, fill: color, name: 'Fill' };
  const idx = L.items.findIndex(i => (i.t === 'path' && i.stroke !== false) || i.t === 'text' || i.t === 'dim');
  const items = L.items.slice(); items.splice(idx < 0 ? items.length : idx, 0, item);
  SF.setItems(L, items); SF.commit('Fill');
  return true;
};
/* =============== shape fill (long-hold): a vector fill tied to the outline's vertices, so it follows when lines move =============== */
const DX8 = [-1, -1, 0, 1, 1, 1, 0, -1], DY8 = [0, -1, -1, -1, 0, 1, 1, 1];
function moore(mask, w, h, start) {
  const out = []; let cx = start % w, cy = (start / w) | 0, bx = cx - 1, by = cy;
  const sx = cx, sy = cy, sbx = bx, sby = by; let visits = 0;
  const dirOf = (dx, dy) => { for (let i = 0; i < 8; i++) if (DX8[i] === dx && DY8[i] === dy) return i; return 0; };
  for (let guard = 0; guard < w * h * 4; guard++) {
    out.push(cx, cy);
    const d0 = dirOf(bx - cx, by - cy); let moved = false;
    for (let i = 1; i <= 8; i++) {
      const dd = (d0 + i) % 8, nx = cx + DX8[dd], ny = cy + DY8[dd];
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) { const pd = (d0 + i - 1) % 8; bx = cx + DX8[pd]; by = cy + DY8[pd]; cx = nx; cy = ny; moved = true; break; }
    }
    if (!moved) break;
    if (cx === sx && cy === sy) { visits++; if ((bx === sbx && by === sby) || visits > 2) break; }
  }
  return out;
}
function floodBool(free, w, h, seeds) {
  const m = new Uint8Array(w * h), st = new Int32Array(w * h); let sp = 0;
  for (const s0 of seeds) if (free[s0] && !m[s0]) { m[s0] = 1; st[sp++] = s0; }
  while (sp) {
    const i = st[--sp], x = i % w;
    if (x > 0 && free[i - 1] && !m[i - 1]) { m[i - 1] = 1; st[sp++] = i - 1; }
    if (x < w - 1 && free[i + 1] && !m[i + 1]) { m[i + 1] = 1; st[sp++] = i + 1; }
    if (i >= w && free[i - w] && !m[i - w]) { m[i - w] = 1; st[sp++] = i - w; }
    if (i < w * h - w && free[i + w] && !m[i + w]) { m[i + w] = 1; st[sp++] = i + w; }
  }
  return m;
}
SF.shapeFillAt = (x, y, color, opt) => {
  opt = opt || {};
  const L = SF.drawTarget(); if (!L) return null;
  const items = SF.resolveItems(L.items).filter(i => i.t === 'path' && !i.bind && !i.hidden && SF.isWall(i) && i.pts.length >= 6);
  if (!items.length) return null;
  let bb = null; for (const it of items) bb = G.unionBox(bb, G.bbox(it));
  if (x <= bb.x || y <= bb.y || x >= bb.x + bb.w || y >= bb.y + bb.h) return null;
  const sc = Math.min(2, Math.sqrt(2.4e6 / Math.max(1, bb.w * bb.h)), 2400 / Math.max(bb.w, bb.h)), pad = 3;
  const W = Math.ceil(bb.w * sc) + pad * 2, H = Math.ceil(bb.h * sc) + pad * 2, ox = bb.x - pad / sc, oy = bb.y - pad / sc;
  const c = U.canvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(sc, 0, 0, sc, -ox * sc, -oy * sc); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#000';
  const sink = { M: (a, b) => g.moveTo(a, b), L: (a, b) => g.lineTo(a, b), Q: (a, b, cx, cy) => g.quadraticCurveTo(a, b, cx, cy), Z: () => g.closePath() };
  for (const it of items) { g.beginPath(); SF.tracePts(sink, it.pts, it.closed, it.mode !== 'poly'); g.lineWidth = Math.max(it.width, 2 / sc); g.stroke(); }
  const a = g.getImageData(0, 0, W, H).data, N = W * H, free = new Uint8Array(N);
  for (let i = 0; i < N; i++) free[i] = a[i * 4 + 3] < 40 ? 1 : 0;
  const sx = Math.floor((x - ox) * sc), sy = Math.floor((y - oy) * sc), seed = sy * W + sx;
  if (!free[seed]) return null;
  const region = floodBool(free, W, H, [seed]);
  for (let i = 0; i < W; i++) if (region[i] || region[(H - 1) * W + i]) return null;
  for (let j = 0; j < H; j++) if (region[j * W] || region[j * W + W - 1]) return null;
  /* outer contour */
  let start = -1; for (let i = 0; i < N; i++) if (region[i]) { start = i; break; }
  const loops = [moore(region, W, H, start)];
  /* holes: enclosed non-region islands (e.g. a circle inside the shape you filled) */
  const notRegion = new Uint8Array(N); for (let i = 0; i < N; i++) notRegion[i] = region[i] ? 0 : 1;
  const border = []; for (let i = 0; i < W; i++) border.push(i, (H - 1) * W + i); for (let j = 0; j < H; j++) border.push(j * W, j * W + W - 1);
  const outside = floodBool(notRegion, W, H, border);
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!notRegion[i] || outside[i] || seen[i]) continue;
    const comp = floodBool(notRegion, W, H, [i]); let area = 0, first = -1;
    for (let k = 0; k < N; k++) if (comp[k]) { seen[k] = 1; area++; if (first < 0) first = k; }
    if (area > 40) loops.push(moore(comp, W, H, first));
  }
  /* candidate outline points: every vertex + crossings of straight segments */
  const cands = [];
  for (const it of items) {
    const n = it.pts.length / 3;
    if (it.mode === 'poly' || n < 3) { for (let k = 0; k < n; k++) cands.push({ x: it.pts[k * 3], y: it.pts[k * 3 + 1], ref: { id: it.id, k }, w: it.width, pri: 0 }); continue; }
    /* smoothed strokes: sample the actual curve (it passes between the stored points), plus open ends */
    if (!it.closed) { cands.push({ x: it.pts[0], y: it.pts[1], ref: { id: it.id, k: 0 }, w: it.width, pri: 1 }); cands.push({ x: it.pts[(n - 1) * 3], y: it.pts[(n - 1) * 3 + 1], ref: { id: it.id, k: n - 1 }, w: it.width, pri: 1 }); }
    const segLen = G.pathLen(it.pts, it.closed) / Math.max(1, n), steps = U.clamp(Math.ceil(segLen / 6), 1, 8);
    for (let k = it.closed ? 0 : 1; k <= (it.closed ? n - 1 : n - 2); k++) for (let q = 0; q < steps; q++) { const t = q / steps, cp = SF.curvePoint(it, k, t); if (cp) cands.push({ x: cp.x, y: cp.y, ref: { c: { id: it.id, k }, t }, w: it.width, pri: 1 }); }
  }
  const segs = []; for (const it of items) { if (it.mode !== 'poly') continue; const n = it.pts.length / 3, m = n - 1 + (it.closed ? 1 : 0); for (let k = 0; k < m; k++) { const j = (k + 1) % n; segs.push({ id: it.id, k, x1: it.pts[k * 3], y1: it.pts[k * 3 + 1], x2: it.pts[j * 3], y2: it.pts[j * 3 + 1], w: it.width }); } }
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j]; if (A.id === B.id) continue;
    const den = (A.x1 - A.x2) * (B.y1 - B.y2) - (A.y1 - A.y2) * (B.x1 - B.x2); if (Math.abs(den) < 1e-9) continue;
    const t = ((A.x1 - B.x1) * (B.y1 - B.y2) - (A.y1 - B.y1) * (B.x1 - B.x2)) / den, u = -((A.x1 - A.x2) * (A.y1 - B.y1) - (A.y1 - A.y2) * (A.x1 - B.x1)) / den;
    if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue;
    cands.push({ x: A.x1 + t * (A.x2 - A.x1), y: A.y1 + t * (A.y2 - A.y1), ref: { a: { id: A.id, k: A.k }, b: { id: B.id, k: B.k } }, w: Math.max(A.w, B.w), pri: 2 });
  }
  const mapLoop = (pix) => {
    const n = pix.length / 2, cell = 8, grid = new Map(), P2 = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) { const px = (pix[i * 2] + 0.5) / sc + ox, py = (pix[i * 2 + 1] + 0.5) / sc + oy; P2[i * 2] = px; P2[i * 2 + 1] = py; const key = Math.floor(px / cell) + ',' + Math.floor(py / cell); (grid.get(key) || grid.set(key, []).get(key)).push(i); }
    const hits = [];
    for (const cd of cands) {
      const tol = cd.w * 0.85 + 2.5 / sc + 1.5, r = Math.ceil(tol / cell), gx = Math.floor(cd.x / cell), gy = Math.floor(cd.y / cell);
      let best = -1, bd = tol;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) { const l = grid.get((gx + dx) + ',' + (gy + dy)); if (!l) continue; for (const i of l) { const dd = Math.hypot(P2[i * 2] - cd.x, P2[i * 2 + 1] - cd.y); if (dd < bd) { bd = dd; best = i; } } }
      if (best >= 0) hits.push({ i: best, cd });
    }
    hits.sort((p, q) => p.i - q.i || p.cd.pri - q.cd.pri);
    const pts = [], bind = [];
    for (const h of hits) {
      const L2 = pts.length / 3;
      if (L2 && Math.hypot(pts[(L2 - 1) * 3] - h.cd.x, pts[(L2 - 1) * 3 + 1] - h.cd.y) < 0.75) continue;
      pts.push(h.cd.x, h.cd.y, 0.5); bind.push(h.cd.ref);
    }
    if (pts.length >= 9 && Math.hypot(pts[0] - pts[pts.length - 3], pts[1] - pts[pts.length - 2]) < 0.75) { pts.splice(-3, 3); bind.pop(); }
    return pts.length >= 9 ? { pts, bind } : null;
  };
  const outer = mapLoop(loops[0]); if (!outer) return null;
  const holes = loops.slice(1).map(mapLoop).filter(Boolean);
  const item = SF.newPath({ id: U.uid('f'), shape: 'fill', mode: 'poly', closed: true, stroke: false, fill: color, color, fillOpacity: 1, width: 0, opacity: 1, pts: outer.pts, bind: outer.bind, holes: holes.length ? holes : undefined });
  if (opt.noCommit) return item;
  const idx = L.items.findIndex(i => (i.t === 'path' && i.stroke !== false) || i.t === 'text' || i.t === 'dim');
  const arr = L.items.slice(); arr.splice(idx < 0 ? arr.length : idx, 0, item);
  SF.setItems(L, arr); SF.commit('Shape fill');
  return item;
};
let fh = null;
T.fill = {
  cursor: 'crosshair',
  down(e, d) {
    const HOLD = Math.max(350, P().holdMs || 450);
    fh = { d, sx: e.clientX, sy: e.clientY, fired: false, cancelled: false };
    SF.overlay.holdRing = { x: e.clientX, y: e.clientY, t0: performance.now() + 120, dur: HOLD - 120 };
    fh.timer = setTimeout(() => {
      if (!fh || fh.cancelled) return;
      fh.fired = true; SF.overlay.holdRing = null;
      const col = P().autoTypeColor ? SF.typeColors().Fills : P().color;
      const it = SF.shapeFillAt(fh.d.x, fh.d.y, col);
      if (it) { SF.overlay.flash = { x: fh.d.x, y: fh.d.y, t0: performance.now() }; try { navigator.vibrate && navigator.vibrate(8); } catch (err) { /* no haptics */ } SF.toast('Shape fill · it follows the outline when you drag its lines', 1800); }
      else { SF.toast('No closed outline here — filled normally', 1600); SF.fillAt(fh.d.x, fh.d.y, col); }
      SF.requestRender();
    }, HOLD);
    SF.requestRender(); return true;
  },
  move(e) { if (fh && !fh.fired && !fh.cancelled && Math.hypot(e.clientX - fh.sx, e.clientY - fh.sy) > 10) { fh.cancelled = true; clearTimeout(fh.timer); SF.overlay.holdRing = null; SF.requestRender(); } },
  up() {
    if (!fh) return;
    clearTimeout(fh.timer); SF.overlay.holdRing = null;
    if (!fh.fired && !fh.cancelled) SF.fillAt(fh.d.x, fh.d.y, P().color);
    fh = null; SF.requestRender();
  },
  cancel() { if (fh) clearTimeout(fh.timer); fh = null; SF.overlay.holdRing = null; SF.requestRender(); }
};

})(window.SF);
