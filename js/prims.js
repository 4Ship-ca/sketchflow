/* SketchFlow 3D primitives: box, cylinder, cone, sphere, pyramid, prism.
   Built from real 3D geometry, then drawn as
   - an isometric drawing: visible faces are closed faces (fillable, shaded, text-on-surface ready), hidden edges dashed,
     round shapes get centre lines; or
   - in the 3-view / 4-view spaces: aligned FRONT · TOP · RIGHT SIDE orthographic views (+ the iso view in 4-view).
   Every part shares exact corner coordinates, so parts are joined, and centres/midpoints work as connectors. */
(function (SF) {
'use strict';
const U = SF.U;
const P = () => SF.prefs;
const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
const VIEW = [1, 1, 1];                                   /* toward the viewer in isometric */
const LIGHT = (() => { const l = [0.35, 0.15, 1]; const m = Math.hypot(...l); return l.map(v => v / m); })();
const iso = (x, y, z) => ({ x: (x - y) * C30, y: (x + y) * S30 - z });
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const m = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };
function shadeHex(hex, k) { const [r, g, b] = U.hexToRgb(hex); return U.rgbToHex(r * k, g * k, b * k); }
const PART_NAMES = { top: 'top', bottom: 'bottom', side: 'side' };

/* ---------- 3D descriptions (unit-agnostic) ---------- */
function polyhedron(type, W, D, H) {
  if (type === 'box') return { v: [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0], [0, 0, H], [W, 0, H], [W, D, H], [0, D, H]], f: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5], [0, 1, 5, 4], [3, 2, 6, 7]] };
  if (type === 'pyramid') return { v: [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0], [W / 2, D / 2, H]], f: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] };
  /* prism: triangular cross-section in y–z, ridge along x */
  return { v: [[0, 0, 0], [0, D, 0], [0, D / 2, H], [W, 0, 0], [W, D, 0], [W, D / 2, H]], f: [[0, 1, 2], [3, 4, 5], [0, 3, 4, 1], [0, 3, 5, 2], [1, 4, 5, 2]] };
}
const circ = (cx, cy, z, R, t) => [cx + R * Math.cos(t), cy + R * Math.sin(t), z];
function samplePts3(type, W, D, H) {
  if (type === 'box' || type === 'pyramid' || type === 'prism') return polyhedron(type, W, D, H).v;
  const R = W / 2, o = [];
  for (let i = 0; i < 72; i++) {
    const t = i / 72 * Math.PI * 2;
    if (type === 'sphere') { o.push(circ(R, R, R, R, t)); o.push([R + R * Math.cos(t), R, R + R * Math.sin(t)]); o.push([R, R + R * Math.cos(t), R + R * Math.sin(t)]); }
    else { o.push(circ(R, R, 0, R, t)); if (type === 'cylinder') o.push(circ(R, R, H, R, t)); }
  }
  if (type === 'cone') o.push([R, R, H]);
  return o;
}

/* ---------- isometric drawing ---------- */
function isoBox(type, W, D, H) {
  const pts = samplePts3(type, W, D, H).map(p => iso(...p));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  if (type === 'sphere') { const R = W / 2, c = iso(R, R, R), rs = R * Math.sqrt(1.5); minx = c.x - rs; maxx = c.x + rs; miny = c.y - rs; maxy = c.y + rs; }
  return { minx, miny, w: maxx - minx, h: maxy - miny };
}
/* fit dims into a target box (x0,y0,w,h): W = D = 1 base, solve H so the drawing's aspect matches */
function fitIso(type, bx, cube) {
  let H;
  if (type === 'sphere') H = 1;
  else if (cube) H = 1;
  else {
    const target = bx.h / Math.max(1e-6, bx.w); let lo = 0.03, hi = 40;
    const asp = (h) => { const b = isoBox(type, 1, 1, h); return b.h / b.w; };
    if (asp(lo) >= target) H = lo; else if (asp(hi) <= target) H = hi;
    else { for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (asp(mid) < target) lo = mid; else hi = mid; } H = (lo + hi) / 2; }
  }
  const b = isoBox(type, 1, 1, H), s = Math.min(bx.w / b.w, type === 'sphere' || cube ? bx.h / b.h : Infinity);
  const ox = bx.x + (bx.w - b.w * s) / 2 - b.minx * s, oy = bx.y + (type === 'sphere' || cube ? (bx.h - b.h * s) / 2 : 0) - b.miny * s;
  return { W: s, D: s, H: H * s, proj: (x, y, z) => { const p = iso(x, y, z); return { x: ox + p.x, y: oy + p.y }; } };
}
function partStyle(style, part) {
  const fillMode = P().shapeFill, base = style.fillBase || style.color;
  const o = { color: style.color, width: style.width, opacity: style.opacity == null ? 1 : style.opacity, brush: 'shape' };
  if (style.lt) o.lt = style.lt;
  if (part && fillMode !== 'outline') { o.fill = shadeHex(base, part); o.fillOpacity = fillMode === 'both' ? 0.45 : 1; }
  return o;
}
/* drawing order: centre lines, then hidden edges, then fills, then visible edges/faces —
   so on filled solids only the parts of axes and hidden edges outside the silhouette show */
function buildIso(type, fit, style, meta) {
  const rank = (it) => (it.lt === 'center' ? 0 : it.lt === 'dashed' ? 1 : it.stroke === false ? 2 : 3);
  return buildIsoRaw(type, fit, style, meta).map((it, i) => [it, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
}
function buildIsoRaw(type, fit, style, meta) {
  const { W, D, H, proj } = fit, items = [], hiddenOn = P().showHidden !== false, thin = Math.max(0.6, style.width * 0.6);
  const mk = (pts3or2, o) => SF.newPath(Object.assign({ mode: 'poly', closed: false }, o, { pts: pts3or2.flatMap(p => [p.x, p.y, 0.5]), prim: type, pid: meta.pid }));
  const P2 = (p) => proj(p[0], p[1], p[2]);
  if (type === 'box' || type === 'pyramid' || type === 'prism') {
    const m = polyhedron(type, W, D, H), cen = m.v.reduce((a, v) => [a[0] + v[0] / m.v.length, a[1] + v[1] / m.v.length, a[2] + v[2] / m.v.length], [0, 0, 0]);
    const faces = m.f.map(f => {
      let n = cross(sub(m.v[f[1]], m.v[f[0]]), sub(m.v[f[2]], m.v[f[0]]));
      const fc = f.reduce((a, i) => [a[0] + m.v[i][0] / f.length, a[1] + m.v[i][1] / f.length, a[2] + m.v[i][2] / f.length], [0, 0, 0]);
      if (dot(n, sub(fc, cen)) < 0) n = n.map(v => -v);
      n = norm(n);
      return { f, n, vis: dot(n, VIEW) > 1e-6, light: 0.6 + 0.4 * Math.max(0, dot(n, LIGHT)), name: n[2] > 0.7 ? 'top' : n[2] < -0.7 ? 'bottom' : 'side' };
    });
    /* hidden edges (both neighbouring faces face away) first, so opaque faces cover them */
    if (hiddenOn) {
      const edges = new Map();
      faces.forEach((F, fi) => F.f.forEach((a, k) => { const b = F.f[(k + 1) % F.f.length], key = Math.min(a, b) + '-' + Math.max(a, b); if (!edges.has(key)) edges.set(key, { a, b, fs: [] }); edges.get(key).fs.push(fi); }));
      for (const e of edges.values()) if (e.fs.every(fi => !faces[fi].vis)) items.push(mk([P2(m.v[e.a]), P2(m.v[e.b])], { color: style.color, width: thin, opacity: 0.8, lt: 'dashed', brush: 'shape', shape: 'line', name: cap(type) + ' · hidden edge' }));
    }
    faces.filter(F => F.vis).forEach(F => items.push(mk(F.f.map(i => P2(m.v[i])), Object.assign(partStyle(style, F.light), { closed: true, name: cap(type) + ' · ' + PART_NAMES[F.name] }))));
    if (type === 'pyramid') items.push(mk([P2([W / 2, D / 2, -H * 0.08]), P2([W / 2, D / 2, H * 1.08])], { color: style.color, width: thin, lt: 'center', brush: 'shape', name: 'Pyramid · axis' }));
    return items;
  }
  const R = W / 2, cx = R, cy = R, N = 48;
  const arc = (z, t0, t1, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(P2(circ(cx, cy, z, R, t0 + (t1 - t0) * i / n))); return o; };
  const L = Math.PI * 3 / 4, Rt = -Math.PI / 4;                 /* silhouette angles of a horizontal circle in iso */
  const sideLight = 0.78, topLight = 1.0;
  if (type === 'cylinder') {
    const st = partStyle(style, sideLight);
    if (st.fill) items.push(mk([P2(circ(cx, cy, H, R, L)), P2(circ(cx, cy, 0, R, L))].concat(arc(0, L, Rt, 32).slice(1)).concat(arc(H, Rt, L, 32)), { stroke: false, fill: st.fill, fillOpacity: st.fillOpacity, closed: true, color: style.color, width: 0, brush: 'shape', name: 'Cylinder · body' }));
    if (hiddenOn) items.push(mk(arc(0, L, Rt + Math.PI * 2, 32), { color: style.color, width: thin, opacity: 0.8, lt: 'dashed', brush: 'shape', name: 'Cylinder · hidden edge', mode: 'smooth' }));
    items.push(mk(arc(0, Rt, L, 32), { color: style.color, width: style.width, brush: 'shape', mode: 'smooth', name: 'Cylinder · base' }));
    items.push(mk([P2(circ(cx, cy, 0, R, L)), P2(circ(cx, cy, H, R, L))], { color: style.color, width: style.width, brush: 'shape', shape: 'line', name: 'Cylinder · side' }));
    items.push(mk([P2(circ(cx, cy, 0, R, Rt)), P2(circ(cx, cy, H, R, Rt))], { color: style.color, width: style.width, brush: 'shape', shape: 'line', name: 'Cylinder · side' }));
    const top = []; for (let i = 0; i < N; i++) top.push(P2(circ(cx, cy, H, R, i / N * Math.PI * 2)));
    items.push(mk(top, Object.assign(partStyle(style, topLight), { closed: true, mode: 'smooth', name: 'Cylinder · top' })));
    items.push(mk([P2([cx, cy, -H * 0.1]), P2([cx, cy, H * 1.1])], { color: style.color, width: thin, lt: 'center', brush: 'shape', name: 'Cylinder · axis' }));
    return items;
  }
  if (type === 'cone') {
    const A = P2([cx, cy, H]), samples = [];
    for (let i = 0; i < 720; i++) { const t = i / 720 * Math.PI * 2, q = P2(circ(cx, cy, 0, R, t)); samples.push({ t, q, a: Math.atan2(q.x - A.x, q.y - A.y) }); }
    const ring = samples.map(s => s.q), inside = SF.G.pointInPoly(A.x, A.y, ring);
    if (inside) {
      if (hiddenOn) items.push(mk(arc(0, L, Rt + Math.PI * 2, 32), { color: style.color, width: thin, opacity: 0.8, lt: 'dashed', brush: 'shape', mode: 'smooth', name: 'Cone · hidden edge' }));
      items.push(mk(arc(0, Rt, L, 32), { color: style.color, width: style.width, brush: 'shape', mode: 'smooth', name: 'Cone · base' }));
    } else {
      let mn = samples[0], mx = samples[0]; for (const s of samples) { if (s.a < mn.a) mn = s; if (s.a > mx.a) mx = s; }
      /* the visible arc is the one that passes the front point (t = 45°) */
      const front = Math.PI / 4, nrm = (t) => { while (t < front - Math.PI) t += Math.PI * 2; while (t > front + Math.PI) t -= Math.PI * 2; return t; };
      let t1 = nrm(mn.t), t2 = nrm(mx.t); if (t1 > t2) [t1, t2] = [t2, t1];
      const st = partStyle(style, sideLight);
      if (st.fill) items.push(mk([A].concat(arc(0, t1, t2, 40)), { stroke: false, fill: st.fill, fillOpacity: st.fillOpacity, closed: true, color: style.color, width: 0, brush: 'shape', name: 'Cone · body' }));
      if (hiddenOn) items.push(mk(arc(0, t2, t1 + Math.PI * 2, 40), { color: style.color, width: thin, opacity: 0.8, lt: 'dashed', brush: 'shape', mode: 'smooth', name: 'Cone · hidden edge' }));
      items.push(mk(arc(0, t1, t2, 40), { color: style.color, width: style.width, brush: 'shape', mode: 'smooth', name: 'Cone · base' }));
      items.push(mk([A, P2(circ(cx, cy, 0, R, t1))], { color: style.color, width: style.width, brush: 'shape', shape: 'line', name: 'Cone · side' }));
      items.push(mk([A, P2(circ(cx, cy, 0, R, t2))], { color: style.color, width: style.width, brush: 'shape', shape: 'line', name: 'Cone · side' }));
    }
    items.push(mk([P2([cx, cy, -H * 0.1]), P2([cx, cy, H * 1.08])], { color: style.color, width: thin, lt: 'center', brush: 'shape', name: 'Cone · axis' }));
    return items;
  }
  /* sphere */
  const C = P2([R, R, R]), rs = R * Math.sqrt(1.5), out = [];
  for (let i = 0; i < N; i++) { const t = i / N * Math.PI * 2; out.push({ x: C.x + Math.cos(t) * rs, y: C.y + Math.sin(t) * rs }); }
  if (hiddenOn) items.push(mk((() => { const o = []; for (let i = 0; i <= 32; i++) o.push(P2(circ(R, R, R, R, L + Math.PI * i / 32))); return o; })(), { color: style.color, width: thin, opacity: 0.8, lt: 'dashed', brush: 'shape', mode: 'smooth', name: 'Sphere · hidden equator' }));
  items.push(mk(out, Object.assign(partStyle(style, 0.9), { closed: true, mode: 'smooth', name: 'Sphere · outline' })));
  items.push(mk(arc(R, Rt, L, 32), { color: style.color, width: thin, brush: 'shape', mode: 'smooth', name: 'Sphere · equator' }));
  items.push(mk([{ x: C.x, y: C.y - rs * 1.1 }, { x: C.x, y: C.y + rs * 1.1 }], { color: style.color, width: thin, lt: 'center', brush: 'shape', name: 'Sphere · axis' }));
  return items;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- orthographic views (3-view / 4-view) ---------- */
function buildViews(type, a, b, style, meta) {
  const d = SF.doc, hw = d.w / 2, hh = d.h / 2, items = [], thin = Math.max(0.6, style.width * 0.6);
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const W = Math.max(4, x1 - x0); let H = Math.max(4, y1 - y0); if (type === 'sphere') H = W;
  const D = W, R = W / 2, T0 = 2 * hh - (y1 - H), S0 = 2 * hw - x1;
  const fy0 = y1 - H;
  const mk = (pts, o) => SF.newPath(Object.assign({ mode: 'poly', closed: false, color: style.color, width: style.width, opacity: style.opacity == null ? 1 : style.opacity, brush: 'shape', prim: type, pid: meta.pid }, style.lt ? { lt: style.lt } : {}, o, { pts: pts.flatMap(p => [p.x, p.y, 0.5]) }));
  const rect = (x, y, w, h, name) => mk([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], Object.assign(partStyle(style, 0.92), { closed: true, name }));
  const circle = (cx, cy, r, name) => { const o = []; for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; o.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r }); } return mk(o, Object.assign(partStyle(style, 0.92), { closed: true, mode: 'smooth', name })); };
  const tri = (p, q, r, name) => mk([p, q, r], Object.assign(partStyle(style, 0.92), { closed: true, name }));
  const cl = (p, q, name) => mk([p, q], { width: thin, lt: 'center', name });
  const cross2 = (cx, cy, r, name) => [cl({ x: cx - r * 1.15, y: cy }, { x: cx + r * 1.15, y: cy }, name), cl({ x: cx, y: cy - r * 1.15 }, { x: cx, y: cy + r * 1.15 }, name)];
  const N = cap(type);
  /* FRONT (x, z) */
  if (type === 'box') items.push(rect(x0, fy0, W, H, N + ' · front view'));
  else if (type === 'cylinder') { items.push(rect(x0, fy0, W, H, N + ' · front view')); items.push(cl({ x: x0 + R, y: fy0 - H * 0.08 }, { x: x0 + R, y: y1 + H * 0.08 }, N + ' · axis')); }
  else if (type === 'cone' || type === 'pyramid') { items.push(tri({ x: x0, y: y1 }, { x: x1, y: y1 }, { x: x0 + R, y: fy0 }, N + ' · front view')); items.push(cl({ x: x0 + R, y: fy0 - H * 0.08 }, { x: x0 + R, y: y1 + H * 0.08 }, N + ' · axis')); }
  else if (type === 'sphere') { items.push(circle(x0 + R, y1 - R, R, N + ' · front view')); items.push(...cross2(x0 + R, y1 - R, R, N + ' · centre')); }
  else if (type === 'prism') items.push(rect(x0, fy0, W, H, N + ' · front view'));
  /* TOP (x, y): y = 0 (front) nearest the front view */
  const ty = (y) => T0 - y;
  if (type === 'box' || type === 'prism') { items.push(rect(x0, ty(D), W, D, N + ' · top view')); if (type === 'prism') items.push(mk([{ x: x0, y: ty(D / 2) }, { x: x1, y: ty(D / 2) }], { name: N + ' · ridge' })); }
  else if (type === 'pyramid') { items.push(rect(x0, ty(D), W, D, N + ' · top view')); const c = { x: x0 + W / 2, y: ty(D / 2) }; [[x0, ty(0)], [x1, ty(0)], [x1, ty(D)], [x0, ty(D)]].forEach(([x, y]) => items.push(mk([{ x, y }, c], { name: N + ' · edge' }))); }
  else { items.push(circle(x0 + R, ty(R), R, N + ' · top view')); items.push(...cross2(x0 + R, ty(R), R, N + ' · centre')); }
  /* RIGHT SIDE (y, z): y = 0 (front) nearest the front view */
  const sx = (y) => S0 + y;
  if (type === 'box' || type === 'cylinder') { items.push(rect(sx(0), fy0, D, H, N + ' · side view')); if (type === 'cylinder') items.push(cl({ x: sx(R), y: fy0 - H * 0.08 }, { x: sx(R), y: y1 + H * 0.08 }, N + ' · axis')); }
  else if (type === 'cone' || type === 'pyramid' || type === 'prism') { items.push(tri({ x: sx(0), y: y1 }, { x: sx(D), y: y1 }, { x: sx(D / 2), y: fy0 }, N + ' · side view')); if (type !== 'prism') items.push(cl({ x: sx(D / 2), y: fy0 - H * 0.08 }, { x: sx(D / 2), y: y1 + H * 0.08 }, N + ' · axis')); }
  else { items.push(circle(sx(R), y1 - R, R, N + ' · side view')); items.push(...cross2(sx(R), y1 - R, R, N + ' · centre')); }
  /* 4-view: the 3D view in the top-right quadrant at the same proportions */
  if (d.guides.space === 'v4') {
    /* one shared 3D scene: each object sits where it is in the front view (x along X, height above the FRONT
       quadrant's floor as Z), at a common scale — so side-by-side objects stay side by side */
    const sc = 0.5, A = { x: hw * 1.1, y: hh * 0.55 }, zb = d.h - y1;
    const fit = { W, D, H, proj: (x, y, z) => { const q = iso(x0 + x, y, zb + z); return { x: A.x + q.x * sc, y: A.y + q.y * sc }; } };
    items.push(...buildIso(type, fit, Object.assign({}, style, { width: Math.max(0.8, style.width * 0.8) }), meta));
  }
  return items;
}

/* ---------- entry point used by the Shapes tool, the AI bridge and makeShape ---------- */
SF.makePrim = (type, a, b, mods, style) => {
  mods = mods || {}; style = style || SF.brushStyle('shape');
  const meta = { pid: U.uid('g') };
  const sp = SF.doc.guides.space;
  if ((sp === 'v3' || sp === 'v4') && !mods.isoOnly && SF.viewQuad(a.x, a.y) === 'LB') return buildViews(type, a, b, style, meta);
  let x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  if (mods.center) { const hw = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y); x0 = a.x - hw; x1 = a.x + hw; y0 = a.y - hh; y1 = a.y + hh; }
  const bx = { x: x0, y: y0, w: Math.max(4, x1 - x0), h: Math.max(4, y1 - y0) };
  const fit = fitIso(type, bx, !!mods.square), o = fit.proj(0, 0, 0);
  return SF.buildPrimFromParams(makePP(type, o, fit.W, fit.D, fit.H, style), meta.pid);
};

/* =============== parametric primitives =============== */
/* every part of an isometric primitive carries pp = its sizes + where its 3D origin sits on the board,
   so it can be rebuilt (e.g. a new height typed into its height dimension) */
const projFrom = (o) => (x, y, z) => { const p = iso(x, y, z); return { x: o.x + p.x, y: o.y + p.y }; };
function makePP(type, o, W, D, H, style) {
  return { type, ox: o.x, oy: o.y, W, D: type === 'box' || type === 'pyramid' || type === 'prism' ? D : W, H: type === 'sphere' ? W : H,
    style: { color: style.color, width: style.width, opacity: style.opacity == null ? 1 : style.opacity, lt: style.lt, fillBase: style.fillBase },
    fillMode: P().shapeFill, hidden: P().showHidden !== false };
}
SF.makePP = makePP;
function withPrefs(pp, fn) { const p = P(), a = p.shapeFill, h = p.showHidden; p.shapeFill = pp.fillMode; p.showHidden = pp.hidden; try { return fn(); } finally { p.shapeFill = a; p.showHidden = h; } }
SF.buildPrimFromParams = (pp, pid) => withPrefs(pp, () => buildIso(pp.type, { W: pp.W, D: pp.D, H: pp.H, proj: projFrom({ x: pp.ox, y: pp.oy }) }, pp.style, { pid })).map(it => Object.assign(it, { pp }));
/* the vertical column a height is measured along (screen-vertical in iso = true height) */
function column(pp) { if (pp.type === 'box') return [pp.W, 0]; if (pp.type === 'prism') return [pp.W, pp.D / 2]; if (pp.type === 'pyramid') return [pp.W / 2, pp.D / 2]; return [pp.W / 2, pp.W / 2]; }
const topZ = (pp) => (pp.type === 'sphere' ? pp.W : pp.H);
function findPart(pid) {
  for (const L of SF.doc.layers) {
    const items = SF.override && SF.override.layerId === L.id ? SF.override.items : L.items;
    const it = items.find(i => i.pid === pid && i.pp); if (it) return { L, it };
  }
  return null;
}
SF.primAnchor = (pid, at) => {
  const f = findPart(pid); if (!f) return null;
  const pp = f.it.pp, c = column(pp), P2 = projFrom({ x: pp.ox, y: pp.oy });
  return P2(c[0], c[1], at === 'top' ? topZ(pp) : 0);
};
SF.primParams = (pid) => { const f = findPart(pid); return f ? f.it.pp : null; };
/* rebuild a primitive from changed sizes; keeps part ids so connectors, shape fills and surface text stay attached */
SF.regenPrim = (pid, patch) => {
  for (const L of SF.doc.layers) {
    const parts = L.items.filter(i => i.pid === pid); if (!parts.length) continue;
    const pp0 = (parts.find(i => i.pp) || {}).pp; if (!pp0) return false;
    const pp = Object.assign({}, pp0, patch);
    if (pp.type === 'sphere') { pp.D = pp.W; pp.H = pp.W; }
    const fresh = SF.buildPrimFromParams(pp, pid), old = SF.buildPrimFromParams(pp0, pid);
    const edited = old.length !== parts.length || old.some((o, i) => o.pts.length !== parts[i].pts.length || o.pts.some((v, k) => Math.abs(v - parts[i].pts[k]) > 0.5));
    if (fresh.length === parts.length) fresh.forEach((it, i) => { it.id = parts[i].id; if (parts[i].hidden) it.hidden = true; if (parts[i].locked) it.locked = true; });
    const first = L.items.indexOf(parts[0]), rest = L.items.filter(i => i.pid !== pid);
    rest.splice(Math.min(first, rest.length), 0, ...fresh);
    SF.setItems(L, rest);
    if (edited) SF.toast('Rebuilt from its sizes — hand edits to its corners were replaced', 2200);
    return true;
  }
  return false;
};
/* height (or diameter for spheres) dimension that drives the primitive */
SF.primHeightDim = (pid, items) => {
  const pp = items[0].pp, c = column(pp), P2 = projFrom({ x: pp.ox, y: pp.oy });
  let right = -Infinity; for (const it of items) { const b = SF.G.bbox(it); right = Math.max(right, b.x + b.w); }
  const base = P2(c[0], c[1], 0), top = P2(c[0], c[1], topZ(pp)), z = SF.view.z;
  return { t: 'dim', id: U.uid('d'), a: { pa: { pid, at: 'base' }, x: base.x, y: base.y }, b: { pa: { pid, at: 'top' }, x: top.x, y: top.y },
    axis: 'v', off: (right - base.x) + 26 / z, drive: { pid, param: pp.type === 'sphere' ? 'W' : 'H' },
    color: pp.style.color, width: Math.max(1, P().sizes.dim || 1.5), size: Math.round(13 / Math.max(0.35, Math.min(z, 2.5))), opacity: 1 };
};
/* parametric placement from explicit sizes (AI / API): at = base centre, or the base's back corner with from:'corner' */
SF.makePrimParams = (spec, style) => {
  const type = spec.type, R = spec.radius != null ? +spec.radius : null;
  let W = +(spec.width || (R ? R * 2 : 100)), D = +(spec.depth || W), H = +(spec.height || (spec.cube ? W : W * 0.8));
  if (type !== 'box' && type !== 'pyramid' && type !== 'prism') { if (R) W = R * 2; D = W; }
  if (type === 'sphere') H = W;
  const at = { x: +spec.x, y: +spec.y };
  const o = spec.from === 'corner' ? at : (() => { const p = iso(W / 2, D / 2, type === 'sphere' && spec.center_is_middle ? W / 2 : 0); return { x: at.x - p.x, y: at.y - p.y }; })();
  const pid = U.uid('g'), pp = makePP(type, o, W, D, H, style || SF.brushStyle('shape'));
  return { pid, items: SF.buildPrimFromParams(pp, pid) };
};

/* =============== two-step placement: base (from a corner or the centre), then height (pick or type) =============== */
let pl = null, hEd = null;
const C30p = Math.cos(Math.PI / 6);
function planeDelta(p0, p1) { const dx = p1.x - p0.x, dy = p1.y - p0.y; return { x: (dx / C30p + dy / 0.5) / 2, y: (dy / 0.5 - dx / C30p) / 2 }; }
function baseFrom(type, p0, p1, mode, square) {
  const q = planeDelta(p0, p1), round = type === 'cylinder' || type === 'cone' || type === 'sphere';
  let W, D, o;
  if (round) {
    let R, cx, cy;
    if (mode === 'centre') { R = Math.hypot(q.x, q.y); cx = 0; cy = 0; } else { R = Math.min(Math.abs(q.x), Math.abs(q.y)) / 2; if (square) R = Math.max(Math.abs(q.x), Math.abs(q.y)) / 2; cx = q.x / 2; cy = q.y / 2; }
    W = D = R * 2; const p = iso(cx - R, cy - R, 0); o = { x: p0.x + p.x, y: p0.y + p.y };
    if (type === 'sphere' && mode === 'centre') { const s = iso(-R, -R, -R); o = { x: p0.x + s.x, y: p0.y + s.y }; }
  } else if (mode === 'centre') {
    let hx = Math.abs(q.x), hy = Math.abs(q.y); if (square) hx = hy = Math.max(hx, hy);
    W = hx * 2; D = hy * 2; const p = iso(-hx, -hy, 0); o = { x: p0.x + p.x, y: p0.y + p.y };
  } else {
    let x = q.x, y = q.y; if (square) { const m = Math.max(Math.abs(x), Math.abs(y)); x = Math.sign(x || 1) * m; y = Math.sign(y || 1) * m; }
    W = Math.abs(x); D = Math.abs(y); const p = iso(Math.min(0, x), Math.min(0, y), 0); o = { x: p0.x + p.x, y: p0.y + p.y };
  }
  return { W, D, o };
}
function baseOutline(type, b) {
  const P2 = projFrom(b.o), pts = [];
  if (type === 'cylinder' || type === 'cone' || type === 'sphere') { const R = b.W / 2; for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; pts.push(P2(R + R * Math.cos(t), R + R * Math.sin(t), 0)); } }
  else [[0, 0], [b.W, 0], [b.W, b.D], [0, b.D]].forEach(([x, y]) => pts.push(P2(x, y, 0)));
  return SF.newPath({ pts: pts.flatMap(p => [p.x, p.y, 0.5]), closed: true, mode: pts.length > 4 ? 'smooth' : 'poly', color: SF.colors.ai || '#14a394', width: 2 / SF.view.z, lt: 'dashed', brush: 'shape' });
}
function closePrompt() { if (hEd) { hEd.remove(); hEd = null; } }
function previewHeight() {
  const pp = makePP(pl.type, pl.base.o, pl.base.W, pl.base.D, pl.H, pl.style);
  pl.items = SF.buildPrimFromParams(pp, pl.pid);
  const live = pl.items.slice(); if (P().primDim !== false) { pl.dim = SF.primHeightDim(pl.pid, pl.items); live.push(Object.assign({}, pl.dim, { a: { x: pl.dim.a.x, y: pl.dim.a.y }, b: { x: pl.dim.b.x, y: pl.dim.b.y } })); }
  SF.live = { layerId: pl.L.id, item: live };
  if (hEd) { hEd.placeholder = 'height ' + SF.fmtLen(pl.H) + ' · type + Enter'; const c = SF.toScreen(pl.dim ? pl.dim.b.x : pl.base.o.x, pl.dim ? pl.dim.b.y : pl.base.o.y); hEd.style.left = (c.x + 26) + 'px'; hEd.style.top = (c.y - 16) + 'px'; }
  SF.requestRender();
}
function finish() {
  if (!pl) return;
  const L = pl.L, items = pl.items || [];
  if (items.length) {
    const add = items.slice(); if (P().primDim !== false && pl.dim) add.push(SF.primHeightDim(pl.pid, items));
    SF.addItems(L, add); SF.commit(cap(pl.type) + ' · ' + SF.fmtLen(pl.type === 'sphere' ? pl.base.W : pl.H) + (pl.type === 'sphere' ? ' ⌀' : ' high'));
  }
  cancel();
}
function cancel() { pl = null; closePrompt(); SF.live = null; SF.overlay.snap = null; SF.overlay.align = []; SF.requestRender(); }
SF.primPlace = {
  active: () => !!pl,
  applies(d) { const sp = SF.doc.guides.space; return SF.PRIMS.includes(P().shape) && !((sp === 'v3' || sp === 'v4') && SF.viewQuad(d.x, d.y) === 'LB'); },
  down(e, d) {
    if (pl && pl.stage === 'height') { pl.tracking = true; this.pick(e, d); return true; }
    const L = SF.drawTarget(); if (!L) return false;
    const s = SF.snapPoint(d.x, d.y, {});
    const pref = P().primBase || 'auto', mode = e.altKey ? 'centre' : pref === 'corner' ? 'corner' : pref === 'centre' ? 'centre' : (s.kind === 'ctr' ? 'centre' : 'corner');
    let style = SF.brushStyle('shape'); if (P().autoTypeColor) style = Object.assign({}, style, { color: SF.typeColors()['3D'] });
    pl = { L, stage: 'base', p0: { x: s.x, y: s.y }, mode, type: P().shape, style, pid: U.uid('g'), pointer: e.pointerType };
    SF.showSnap(s);
    return true;
  },
  move(e, d) {
    if (!pl) return;
    if (pl.stage === 'base') {
      const s = SF.snapPoint(d.x, d.y, {}); SF.showSnap(s);
      pl.base = baseFrom(pl.type, pl.p0, { x: s.x, y: s.y }, pl.mode, e.shiftKey);
      SF.live = { layerId: pl.L.id, item: [baseOutline(pl.type, pl.base)] }; SF.requestRender();
    } else if (pl.tracking) this.pick(e, d);
  },
  hover(e, d) { if (pl && pl.stage === 'height' && !pl.typed) this.pick(e, d); },
  pick(e, d) {
    const c = column(makePP(pl.type, pl.base.o, pl.base.W, pl.base.D, 1, pl.style)), b0 = projFrom(pl.base.o)(c[0], c[1], 0);
    const s = SF.snapPoint(d.x, d.y, { noSegs: true, noTargets: false }); SF.showSnap(s);
    pl.H = e.shiftKey ? Math.max(pl.base.W, pl.base.D) : Math.max(1 / SF.view.z, b0.y - s.y);
    previewHeight();
  },
  up(e) {
    if (!pl) return;
    if (pl.stage === 'base') {
      if (!pl.base || Math.max(pl.base.W, pl.base.D) * SF.view.z < 4) { cancel(); SF.toast('Drag out the base — from a corner to the opposite corner, or from a centre outwards', 2200); return; }
      if (pl.type === 'sphere') { pl.H = pl.base.W; previewHeight(); finish(); return; }
      pl.stage = 'height'; pl.H = Math.max(pl.base.W, pl.base.D) * 0.8;
      hEd = U.el('input', { class: 'hgt', inputmode: 'decimal', 'aria-label': 'Height' });
      hEd.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { cancel(); return; }
        if (ev.key === 'Enter') { const v = parseFloat(String(hEd.value).replace(',', '.')); if (v > 0) pl.H = v / (P().unitScale || 1); previewHeight(); finish(); }
      });
      hEd.addEventListener('input', () => { const v = parseFloat(String(hEd.value).replace(',', '.')); pl.typed = !!hEd.value; if (v > 0) { pl.H = v / (P().unitScale || 1); previewHeight(); } });
      document.body.append(hEd);
      previewHeight();
      if (pl.pointer !== 'touch') setTimeout(() => hEd && hEd.focus({ preventScroll: true }), 0);
      SF.toast('Now the height: move up and click, or type a number + Enter', 1800);
      return;
    }
    if (pl.tracking) finish();
  },
  cancel
};

})(window.SF);
