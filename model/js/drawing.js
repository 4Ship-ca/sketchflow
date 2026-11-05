/* SketchFlow 3D drawings: an engineering sheet from the live model.
   Third-angle layout (TOP above FRONT, RIGHT beside it, an isometric view top-right), visible and hidden lines
   (hidden-line removal by sampling every edge against all parts' triangles, sped up with a 2D grid), the parts'
   carried dimensions and the measured dimensions, a parts list and a title block. Exports SVG (prints to PDF) and DXF.
   An assembly (two or more parts) gets an exploded isometric instead, with numbered balloons tied to the parts list. */
import * as K from './kernel.js';
import { dimsOf, measureDim, massReport, bom, MATERIALS } from './model.js';
const { V, M4 } = K;

const VIEWS = {
  front: { r: [1, 0, 0], u: [0, 0, 1], f: [0, -1, 0] },
  top: { r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] },
  right: { r: [0, 1, 0], u: [0, 0, 1], f: [1, 0, 0] },
  iso: (() => { const f = V.norm([1, -1, 1]), r = V.norm(V.cross([0, 0, 1], f)), u = V.cross(f, r); return { r, u, f }; })()
};
const SMOOTH = (sid) => /:(side|surface|arc|rev\d+|teeth|bore|rim)$/.test(sid) || /side$/.test(sid);
const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420] };
const SCALES = [10, 5, 4, 2, 1, 1 / 2, 1 / 2.5, 1 / 4, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100];
const fmt = (v) => (Math.round(v * 100) / 100).toString();
const scaleText = (s) => (s >= 1 ? `${fmt(s)}:1` : `1:${fmt(1 / s)}`);

/* exploded-view offsets, the same rule as the 3D view's explode: each part slides away from the assembly centre */
export function explodeOffsets(R, factor = 1) {
  const bodies = R.bodies.filter(b => !b.hidden && !b.solid.isEmpty()), out = new Map(); if (bodies.length < 2) return out;
  const cs = bodies.map(b => { const bb = b.solid.bbox(); return [b.id, V.lerp(bb.min, bb.max, 0.5), V.len(V.sub(bb.max, bb.min))]; });
  let C = [0, 0, 0]; for (const [, c] of cs) C = V.add(C, c); C = V.mul(C, 1 / cs.length);
  const size = Math.max(...cs.map(x => x[2]));
  for (const [id, c] of cs) { let d = V.sub(c, C); if (V.len(d) < 1e-6) d = [0, 0, 1]; out.set(id, V.mul(V.norm(d), factor * (0.35 * size + V.len(d) * 0.6))); }
  return out;
}
/* lines of one view, each split into visible / hidden runs, in view coordinates (x right, y up, mm);
   opts.offsets (body id → world shift) draws the parts moved, e.g. exploded */
export function viewLines(R, view, opts = {}) {
  const B = VIEWS[view], O = R.originPoint, bodies = R.bodies.filter(b => !b.hidden && !b.solid.isEmpty()), offs = opts.offsets || new Map();
  const P = (p) => { const q = V.sub(p, O); return [V.dot(q, B.r), V.dot(q, B.u), V.dot(q, B.f)]; };
  /* occluders */
  const tris = []; let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  for (const b of bodies) { const m = b.solid.toMesh(), X = m.positions, sh = offs.get(b.id) || [0, 0, 0], Q = (i) => P([X[i] + sh[0], X[i + 1] + sh[1], X[i + 2] + sh[2]]); for (let i = 0; i < X.length; i += 9) { const t = [Q(i), Q(i + 3), Q(i + 6)]; const area = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]); if (Math.abs(area) < 1e-10) continue; tris.push(t); for (const q of t) { mn = [Math.min(mn[0], q[0]), Math.min(mn[1], q[1])]; mx = [Math.max(mx[0], q[0]), Math.max(mx[1], q[1])]; } } }
  if (!tris.length) return { lines: [], bbox: null };
  const G = 96, cw = (mx[0] - mn[0]) / G || 1, ch = (mx[1] - mn[1]) / G || 1, grid = Array.from({ length: G * G }, () => []);
  const cell = (x, y) => [Math.max(0, Math.min(G - 1, Math.floor((x - mn[0]) / cw))), Math.max(0, Math.min(G - 1, Math.floor((y - mn[1]) / ch)))];
  tris.forEach((t, i) => { const a = cell(Math.min(t[0][0], t[1][0], t[2][0]), Math.min(t[0][1], t[1][1], t[2][1])), b = cell(Math.max(t[0][0], t[1][0], t[2][0]), Math.max(t[0][1], t[1][1], t[2][1])); for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) grid[y * G + x].push(i); });
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1]), eps = Math.max(1e-3, diag * 2e-4);
  const hidden = (x, y, z) => {
    const [cx, cy] = cell(x, y);
    for (const i of grid[cy * G + cx]) {
      const [a, b, c] = tris[i], d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, l3 = 1 - l1 - l2;
      const tol = 1e-6; if (l1 < tol || l2 < tol || l3 < tol) continue;   /* strictly inside: an edge on a face's boundary is not hidden by that face */
      if (l1 * a[2] + l2 * b[2] + l3 * c[2] > z + eps) return true;
    }
    return false;
  };
  /* edges: creases (all), silhouettes of curved surfaces (for this direction) */
  const segs = [];
  for (const b of bodies) {
    const sh = offs.get(b.id) || [0, 0, 0], Q = (p) => P(V.add(p, sh));
    for (const [a, c] of K.creaseEdges(b.solid)) segs.push([Q(a), Q(c)]);
    for (const [a, c] of K.silhouetteEdges(b.solid, B.f, SMOOTH)) segs.push([Q(a), Q(c)]);
  }
  const lines = [], step = Math.max(diag / 500, 0.05);
  for (const [a, c] of segs) {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1e-6) continue;
    const n = Math.max(2, Math.min(80, Math.ceil(L / step))), state = [];
    for (let k = 0; k <= n; k++) { const t = k / n; state.push(hidden(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t)); }
    /* single-sample flips are grazing-angle noise (an edge lying on a surface): follow the neighbours */
    for (let k = 1; k < n; k++) if (state[k] !== state[k - 1] && state[k] !== state[k + 1]) state[k] = state[k - 1];
    let s0 = 0;
    for (let k = 1; k <= n + 1; k++) {
      if (k === n + 1 || state[k] !== state[s0]) {
        const t0 = s0 === 0 ? 0 : (s0 - 0.5) / n, t1 = k === n + 1 ? 1 : (k - 0.5) / n;
        if (t1 - t0 > 1e-6 && (!state[s0] || opts.hidden !== false)) lines.push({ a: [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0], b: [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1], hidden: state[s0] });
        s0 = k;
      }
    }
  }
  return { lines, bbox: { min: mn, max: mx } };
}

/* dimensions shown in a view: [{a, b (view coords), dir?, text, kind}] */
function viewDims(model, view) {
  const R = model.result, O = R.originPoint, B = VIEWS[view], out = [];
  const P = (p) => { const q = V.sub(p, O); return [V.dot(q, B.r), V.dot(q, B.u)]; };
  for (const ob of model.doc.objects) {
    if (!R.world.has(ob.id) || ['edge', 'pattern', 'weld', 'shell'].includes(ob.type) || (R.off && R.off.has(ob.id))) continue;
    const M = R.world.get(ob.id), lb = R.local.get(ob.id), lc = lb && !lb.isEmpty() ? V.lerp(lb.bbox().min, lb.bbox().max, 0.5) : [0, 0, 0], c = P(M4.point(M, lc));   /* the part's middle: dimensions go outside it */
    for (const d of dimsOf(ob)) {
      const a = M4.point(M, d.a), b = M4.point(M, d.b), dir = V.norm(V.sub(b, a));
      let v = d.view; if (v === 'auto') { let best = 'front', bs = -1; for (const w of ['front', 'top', 'right']) { const sc = 1 - Math.abs(V.dot(dir, VIEWS[w].f)); if (sc > bs) { bs = sc; best = w; } } v = best; }
      if (v !== view || Math.abs(V.dot(dir, B.f)) > 0.2) continue;
      out.push({ a: P(a), b: P(b), text: (d.kind === 'diameter' ? 'Ø' : '') + fmt(ob.params[d.param]), center: c, owner: ob.id });
    }
  }
  for (const md of model.doc.dims || []) {
    if ((md.view || 'front') !== view) continue;
    const m = measureDim(R, md); if (!m) continue;
    out.push({ a: P(m.from), b: P(m.to), dir: [V.dot(m.dir, B.r), V.dot(m.dir, B.u)], text: fmt(m.value), owner: 'm', measured: true });
  }
  return out;
}

/* lay out the sheet; returns everything in sheet mm (origin bottom-left, y up) */
export function layoutSheet(model, opts = {}) {
  const R = model.result, size = SHEETS[opts.sheet] || SHEETS.A3, [W, H] = size, m = 10, tbH = 36, tbW = 180;
  const ext = {}; let any = false;
  const nBodies = R.bodies.filter(b => !b.hidden && !b.solid.isEmpty()).length, exploded = opts.exploded !== false && nBodies >= 2, offsets = exploded ? explodeOffsets(R, opts.explode || 1) : null;
  for (const v of ['front', 'top', 'right', 'iso']) { const vl = viewLines(R, v, v === 'iso' ? { hidden: false, offsets } : { hidden: true }); ext[v] = vl; if (vl.bbox) any = true; }
  if (!any) throw new Error('Nothing to draw: the model is empty');
  const span = (v, k) => (ext[v].bbox ? ext[v].bbox.max[k] - ext[v].bbox.min[k] : 0);
  const nParts = bom(model.doc, R).lines.length, partsH = nParts > 1 ? (Math.min(14, nParts) + 1) * 5 + 4 : 0, base = tbH + partsH;   /* the title block and parts list sit bottom-right */
  const gap = 24, areaW = W - 2 * m - 10, areaH = H - 2 * m - base - 10;
  const needW = span('front', 0) + span('right', 0), needH = span('top', 1) + span('front', 1);
  const fit = Math.min((areaW * 0.68 - gap) / (needW || 1), (areaH - gap) / (needH || 1));
  const scale = opts.scale || SCALES.find(s => s <= fit) || SCALES[SCALES.length - 1];
  /* view centres: FRONT bottom-left, TOP above it, RIGHT to its right (third angle), ISO top-right */
  const fx = m + 10 + span('front', 0) * scale / 2, fy = m + base + 14 + span('front', 1) * scale / 2;
  const place = {
    front: [fx, fy],
    top: [fx, fy + span('front', 1) * scale / 2 + gap + span('top', 1) * scale / 2],
    right: [fx + span('front', 0) * scale / 2 + gap + span('right', 0) * scale / 2, fy]
  };
  const BR = 3.2, marg = exploded ? 2 * BR + 7 : 0;   /* balloons ring the exploded view */
  const isoFit = Math.min((W - m - (place.right[0] + span('right', 0) * scale / 2 + gap) - 2 * marg) / (span('iso', 0) || 1), (H - m - (fy + span('front', 1) * scale / 2 + 8) - 2 * marg) / (span('iso', 1) || 1));
  const isoScale = Math.max(Math.min(scale, isoFit * 0.85), scale * 0.35);
  place.iso = [W - m - 8 - marg - span('iso', 0) * isoScale / 2, H - m - 10 - marg - span('iso', 1) * isoScale / 2];
  const toSheet = (v, p) => { const bb = ext[v].bbox, s = v === 'iso' ? isoScale : scale, c = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2]; return [place[v][0] + (p[0] - c[0]) * s, place[v][1] + (p[1] - c[1]) * s]; };
  const lines = [], dims = [], labels = [];
  for (const v of ['front', 'top', 'right', 'iso']) {
    if (!ext[v].bbox) continue;
    for (const l of ext[v].lines) lines.push({ a: toSheet(v, l.a), b: toSheet(v, l.b), hidden: l.hidden, view: v });
    const bb = ext[v].bbox, s = v === 'iso' ? isoScale : scale, label = { at: [place[v][0], place[v][1] - (bb.max[1] - bb.min[1]) * s / 2 - 7 - (v === 'iso' ? marg : 0)], text: v === 'iso' ? (exploded ? 'EXPLODED ISOMETRIC' : 'ISOMETRIC') : v.toUpperCase(), size: 3.2 };
    labels.push(label);
    if (v === 'iso' || opts.dims === false) continue;
    const firstDim = dims.length;
    const counts = new Map();
    for (const d of viewDims(model, v)) {
      const A = toSheet(v, d.a), Bp = toSheet(v, d.b);
      let ux, uy; if (d.dir) { const l = Math.hypot(d.dir[0], d.dir[1]); if (l < 1e-9) continue; ux = d.dir[0] / l; uy = d.dir[1] / l; } else { const l = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]); if (l < 1.5) continue; ux = (Bp[0] - A[0]) / l; uy = (Bp[1] - A[1]) / l; }
      let nx = -uy, ny = ux;
      const ctr = d.center ? toSheet(v, d.center) : place[v], mid = [(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2];
      if (!d.measured && (mid[0] - ctr[0]) * nx + (mid[1] - ctr[1]) * ny < 0) { nx = -nx; ny = -ny; }
      const da = A[0] * nx + A[1] * ny, db = Bp[0] * nx + Bp[1] * ny, far = Math.max(da, db), key = d.owner + ':' + Math.round(nx * 2) + Math.round(ny * 2), k = counts.get(key) || 0; counts.set(key, k + 1);
      const off = 7 + k * 6, a2 = [A[0] + nx * (far - da + off), A[1] + ny * (far - da + off)], b2 = [Bp[0] + nx * (far - db + off), Bp[1] + ny * (far - db + off)];
      if (Math.hypot(b2[0] - a2[0], b2[1] - a2[1]) < 1) continue;
      dims.push({ ext: [[[A[0] + nx * 1, A[1] + ny * 1], [a2[0] + nx * 1.5, a2[1] + ny * 1.5]], [[Bp[0] + nx * 1, Bp[1] + ny * 1], [b2[0] + nx * 1.5, b2[1] + ny * 1.5]]], line: [a2, b2], text: d.text, at: [(a2[0] + b2[0]) / 2 + nx * 2.2, (a2[1] + b2[1]) / 2 + ny * 2.2], angle: Math.atan2(b2[1] - a2[1], b2[0] - a2[0]) });
    }
    /* the view's name goes below its lowest dimension */
    let low = label.at[1] + 7; for (const d of dims.slice(firstDim)) low = Math.min(low, d.line[0][1], d.line[1][1], d.at[1] - 2);
    label.at[1] = low - 7;
  }
  /* title block + parts list */
  const rep = massReport(model.doc, R), parts = bom(model.doc, R).lines, mats = [...new Set(rep.parts.map(p => p.material_name).filter(Boolean))];
  /* balloons: one per parts-list item, its leader on the first part of that item in the exploded view */
  const balloons = [];
  if (exploded && ext.iso.bbox) {
    const seen = new Set(), B = VIEWS.iso, O = R.originPoint;
    /* item numbers exactly as bom() numbers its lines: by first appearance of each part (or its pattern / instance source) */
    const keyOf = new Map(rep.parts.map(pp => [pp.id, pp.source || pp.id])), lineOf = new Map(); { let k = 0; const ord = new Map(); for (const pp of rep.parts) { const key = pp.source || pp.id; if (!ord.has(key)) ord.set(key, ++k); } for (const [id, key] of keyOf) lineOf.set(id, ord.get(key)); }
    for (const b of R.bodies.filter(x => !x.hidden && !x.solid.isEmpty())) {
      const item = lineOf.get(b.id); if (item == null || seen.has(item)) continue; seen.add(item);
      const bb = b.solid.bbox(), c = V.add(V.lerp(bb.min, bb.max, 0.5), offsets.get(b.id) || [0, 0, 0]), q = V.sub(c, O);
      balloons.push({ item, anchor: toSheet('iso', [V.dot(q, B.r), V.dot(q, B.u)]) });
    }
    const vb = ext.iso.bbox, lo = toSheet('iso', vb.min), hi = toSheet('iso', vb.max);
    placeBalloons(balloons, { min: lo, max: hi }, BR, 5);
  }
  const title = { x: W - m - tbW, y: m, w: tbW, h: tbH, fields: [
    ['TITLE', model.doc.name || 'Model'], ['SCALE', scaleText(scale)], ['UNITS', 'mm'], ['PROJECTION', 'third angle'],
    ['MATERIAL', mats.join(', ') || '—'], ['MASS', rep.total_mass_g ? (rep.total_mass_g >= 1000 ? fmt(rep.total_mass_g / 1000) + ' kg' : fmt(rep.total_mass_g) + ' g') : '—'],
    ['DATE', opts.date || new Date().toISOString().slice(0, 10)], ['DRAWN', 'SketchFlow 3D'], ['SHEET', '1 / 1']
  ] };
  return { W, H, m, scale, isoScale, lines, dims, labels, title, parts: parts.length > 1 ? parts : [], balloons, balloonR: BR, exploded, sheet: opts.sheet || 'A3' };
}
/* balloons on a rectangle just outside the view, each in the direction of its part from the view's middle, then
   spread along that rectangle so none overlap (leaders stay short and do not cross much) */
function placeBalloons(list, box, r, margin) {
  if (!list.length) return;
  const x0 = box.min[0] - margin - r, y0 = box.min[1] - margin - r, x1 = box.max[0] + margin + r, y1 = box.max[1] + margin + r, w = x1 - x0, h = y1 - y0, per = 2 * (w + h);
  const c = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];
  /* perimeter coordinate: 0 at the bottom-left corner, counter-clockwise */
  const sOf = (p) => { const dx = p[0] - c[0], dy = p[1] - c[1]; const tx = dx ? (dx > 0 ? (x1 - c[0]) / dx : (x0 - c[0]) / dx) : Infinity, ty = dy ? (dy > 0 ? (y1 - c[1]) / dy : (y0 - c[1]) / dy) : Infinity, t = Math.min(tx, ty), q = [c[0] + dx * t, c[1] + dy * t];
    if (t === ty && dy < 0) return q[0] - x0; if (t === tx && dx > 0) return w + (q[1] - y0); if (t === ty && dy > 0) return w + h + (x1 - q[0]); return 2 * w + h + (y1 - q[1]); };
  const pOf = (s) => { s = ((s % per) + per) % per; if (s < w) return [x0 + s, y0]; if (s < w + h) return [x1, y0 + s - w]; if (s < 2 * w + h) return [x1 - (s - w - h), y1]; return [x0, y1 - (s - 2 * w - h)]; };
  for (const b of list) { const d = [b.anchor[0] - c[0], b.anchor[1] - c[1]]; b.s = sOf(Math.hypot(d[0], d[1]) < 1e-6 ? [c[0] + 1, c[1] + 1] : b.anchor); }
  list.sort((a, b) => a.s - b.s);
  const n = list.length, gapMin = Math.min(2 * r + 1.6, per / n);
  for (let it = 0; it < 200 && n > 1; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const a = list[i], b = list[(i + 1) % n], gap = i === n - 1 ? b.s + per - a.s : b.s - a.s;
      if (gap < gapMin - 1e-6) { const push = (gapMin - gap) / 2; a.s -= push; b.s += push; moved = true; }
    }
    if (!moved) break;
  }
  for (const b of list) { b.at = pOf(b.s); b.r = r; delete b.s; }
  list.sort((a, b) => a.item - b.item);
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function drawingSVG(model, opts = {}) {
  const S = layoutSheet(model, opts), Y = (y) => S.H - y, o = [];
  o.push(`<?xml version="1.0" encoding="UTF-8"?>`, `<svg xmlns="http://www.w3.org/2000/svg" width="${S.W}mm" height="${S.H}mm" viewBox="0 0 ${S.W} ${S.H}" font-family="Helvetica, Arial, sans-serif">`);
  o.push(`<rect x="0" y="0" width="${S.W}" height="${S.H}" fill="#fff"/>`, `<rect x="${S.m}" y="${S.m}" width="${S.W - 2 * S.m}" height="${S.H - 2 * S.m}" fill="none" stroke="#000" stroke-width="0.5"/>`);
  const L = (a, b, cls) => `<line x1="${a[0].toFixed(3)}" y1="${Y(a[1]).toFixed(3)}" x2="${b[0].toFixed(3)}" y2="${Y(b[1]).toFixed(3)}" class="${cls}"/>`;
  o.push(`<style>.v{stroke:#000;stroke-width:0.35;stroke-linecap:round}.h{stroke:#000;stroke-width:0.18;stroke-dasharray:1.6 0.9}.d{stroke:#1d4ed8;stroke-width:0.18}.t{fill:#1d4ed8;font-size:3px}.lbl{font-size:3.2px;font-weight:bold;letter-spacing:.3px}.tb{stroke:#000;stroke-width:0.25;fill:none}.k{font-size:2px;fill:#555}.val{font-size:3.4px}.bl{stroke:#000;stroke-width:0.25}.bn{font-size:3.2px;font-weight:bold}</style>`);
  o.push('<g>', ...S.lines.filter(l => l.hidden).map(l => L(l.a, l.b, 'h')), ...S.lines.filter(l => !l.hidden).map(l => L(l.a, l.b, 'v')), '</g>');
  for (const d of S.dims) {
    o.push(L(d.ext[0][0], d.ext[0][1], 'd'), L(d.ext[1][0], d.ext[1][1], 'd'), L(d.line[0], d.line[1], 'd'));
    const arrow = (p, q) => { const ux = q[0] - p[0], uy = q[1] - p[1], l = Math.hypot(ux, uy) || 1, x = ux / l, y = uy / l, s = 2.4, w = 0.8; return `<polygon points="${p[0]},${Y(p[1])} ${p[0] + x * s - y * w},${Y(p[1] + y * s + x * w)} ${p[0] + x * s + y * w},${Y(p[1] + y * s - x * w)}" fill="#1d4ed8"/>`; };
    o.push(arrow(d.line[0], d.line[1]), arrow(d.line[1], d.line[0]));
    let ang = -d.angle * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    o.push(`<text x="${d.at[0].toFixed(2)}" y="${Y(d.at[1]).toFixed(2)}" class="t" text-anchor="middle" dominant-baseline="middle" transform="rotate(${ang.toFixed(1)} ${d.at[0].toFixed(2)} ${Y(d.at[1]).toFixed(2)})">${esc(d.text)}</text>`);
  }
  for (const l of S.labels) o.push(`<text x="${l.at[0].toFixed(1)}" y="${Y(l.at[1]).toFixed(1)}" text-anchor="middle" class="lbl">${esc(l.text)}</text>`);
  /* balloons: leader from the circle's edge to a dot on the part, the parts-list item number inside */
  for (const b of S.balloons) {
    const dx = b.anchor[0] - b.at[0], dy = b.anchor[1] - b.at[1], l = Math.hypot(dx, dy) || 1, e = [b.at[0] + dx / l * b.r, b.at[1] + dy / l * b.r];
    o.push(`<g class="bl"><line x1="${e[0].toFixed(2)}" y1="${Y(e[1]).toFixed(2)}" x2="${b.anchor[0].toFixed(2)}" y2="${Y(b.anchor[1]).toFixed(2)}"/><circle cx="${b.anchor[0].toFixed(2)}" cy="${Y(b.anchor[1]).toFixed(2)}" r="0.5" fill="#000"/><circle cx="${b.at[0].toFixed(2)}" cy="${Y(b.at[1]).toFixed(2)}" r="${b.r}" fill="#fff"/></g><text x="${b.at[0].toFixed(2)}" y="${Y(b.at[1]).toFixed(2)}" text-anchor="middle" dominant-baseline="central" class="bn">${b.item}</text>`);
  }
  /* title block: a 3 × 3 grid of labelled cells */
  const T = S.title, cw = T.w / 3, chh = T.h / 3;
  o.push(`<rect x="${T.x}" y="${Y(T.y + T.h)}" width="${T.w}" height="${T.h}" class="tb"/>`);
  T.fields.forEach(([k, v], i) => { const cx = T.x + (i % 3) * cw, cy = T.y + T.h - Math.floor(i / 3) * chh; o.push(`<rect x="${cx}" y="${Y(cy)}" width="${cw}" height="${chh}" class="tb"/>`, `<text x="${cx + 1.5}" y="${Y(cy - 3)}" class="k">${k}</text>`, `<text x="${cx + 1.5}" y="${Y(cy - chh + 3)}" class="val">${esc(v).slice(0, 40)}</text>`); });
  /* third-angle symbol */
  const sx = T.x - 22, sy = T.y + 8; o.push(`<g class="tb"><circle cx="${sx + 14}" cy="${Y(sy + 6)}" r="2"/><circle cx="${sx + 14}" cy="${Y(sy + 6)}" r="4"/><polygon points="${sx},${Y(sy + 4)} ${sx + 8},${Y(sy + 2)} ${sx + 8},${Y(sy + 10)} ${sx},${Y(sy + 8)}"/></g>`);
  if (S.parts.length) {
    const rows = S.parts.slice(0, 14), rh = 5, x0 = T.x, y0 = T.y + T.h + 4, cols = [[0, 'ITEM', 12], [12, 'PART', 62], [74, 'NO.', 34], [108, 'MATERIAL', 44], [152, 'QTY', 12], [164, 'g', 16]];
    o.push(`<rect x="${x0}" y="${Y(y0 + rh * (rows.length + 1))}" width="${T.w}" height="${rh * (rows.length + 1)}" class="tb"/>`);
    [{ item: 'ITEM' }].concat(rows).forEach((r, i) => { const yy = y0 + rh * (rows.length - i + 1) - 3.4; const vals = i === 0 ? cols.map(c => c[1]) : [r.item, r.part, r.part_no, r.material, r.quantity, r.mass_total_g == null ? '' : fmt(r.mass_total_g)]; cols.forEach(([cx], j) => o.push(`<text x="${x0 + cx + 1}" y="${Y(yy)}" class="${i === 0 ? 'k' : 'val'}" style="font-size:${i === 0 ? 2 : 2.8}px">${esc(vals[j] == null ? '' : vals[j]).slice(0, 26)}</text>`)); o.push(`<line x1="${x0}" y1="${Y(y0 + rh * (rows.length - i))}" x2="${x0 + T.w}" y2="${Y(y0 + rh * (rows.length - i))}" class="tb"/>`); });
  }
  o.push('</svg>');
  return o.join('\n');
}
/* DXF (R12 ASCII): layers VISIBLE, HIDDEN (HIDDEN linetype), DIMS, TEXT, BORDER — in sheet mm */
export function drawingDXF(model, opts = {}) {
  const S = layoutSheet(model, opts), o = [], g = (c, v) => o.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'HIDDEN'); g(70, 0); g(3, 'Hidden __ __ __'); g(72, 65); g(73, 2); g(40, 2.5); g(49, 1.6); g(49, -0.9);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, 6);
  for (const [n, col, lt] of [['VISIBLE', 7, 'CONTINUOUS'], ['HIDDEN', 8, 'HIDDEN'], ['DIMS', 5, 'CONTINUOUS'], ['TEXT', 7, 'CONTINUOUS'], ['BORDER', 7, 'CONTINUOUS'], ['BALLOONS', 7, 'CONTINUOUS']]) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, col); g(6, lt); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (a, b, layer) => { g(0, 'LINE'); g(8, layer); g(10, a[0].toFixed(4)); g(20, a[1].toFixed(4)); g(30, 0); g(11, b[0].toFixed(4)); g(21, b[1].toFixed(4)); g(31, 0); };
  const text = (p, h, t, layer, rot) => { g(0, 'TEXT'); g(8, layer); g(10, p[0].toFixed(3)); g(20, p[1].toFixed(3)); g(30, 0); g(40, h); g(1, String(t).replace(/Ø/g, '%%c')); if (rot) g(50, rot.toFixed(2)); };
  const rect = (x, y, w, h, layer) => { line([x, y], [x + w, y], layer); line([x + w, y], [x + w, y + h], layer); line([x + w, y + h], [x, y + h], layer); line([x, y + h], [x, y], layer); };
  rect(S.m, S.m, S.W - 2 * S.m, S.H - 2 * S.m, 'BORDER');
  for (const l of S.lines) line(l.a, l.b, l.hidden ? 'HIDDEN' : 'VISIBLE');
  for (const d of S.dims) { line(d.ext[0][0], d.ext[0][1], 'DIMS'); line(d.ext[1][0], d.ext[1][1], 'DIMS'); line(d.line[0], d.line[1], 'DIMS'); let ang = d.angle * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180; text([d.at[0] - d.text.length * 0.9, d.at[1] - 1], 2.5, d.text, 'DIMS', ang); }
  for (const l of S.labels) text([l.at[0] - l.text.length * 1.1, l.at[1]], 3, l.text, 'TEXT');
  for (const b of S.balloons) {
    const dx = b.anchor[0] - b.at[0], dy = b.anchor[1] - b.at[1], l = Math.hypot(dx, dy) || 1;
    g(0, 'CIRCLE'); g(8, 'BALLOONS'); g(10, b.at[0].toFixed(4)); g(20, b.at[1].toFixed(4)); g(30, 0); g(40, b.r);
    line([b.at[0] + dx / l * b.r, b.at[1] + dy / l * b.r], b.anchor, 'BALLOONS');
    g(0, 'TEXT'); g(8, 'BALLOONS'); g(10, b.at[0].toFixed(3)); g(20, b.at[1].toFixed(3)); g(30, 0); g(40, 3); g(1, String(b.item)); g(72, 1); g(11, b.at[0].toFixed(3)); g(21, b.at[1].toFixed(3)); g(31, 0); g(73, 2);
  }
  const T = S.title, cw = T.w / 3, chh = T.h / 3; rect(T.x, T.y, T.w, T.h, 'BORDER');
  T.fields.forEach(([k, v], i) => { const cx = T.x + (i % 3) * cw, cy = T.y + T.h - Math.floor(i / 3) * chh; rect(cx, cy - chh, cw, chh, 'BORDER'); text([cx + 1.5, cy - 3.5], 1.8, k, 'TEXT'); text([cx + 1.5, cy - chh + 2.5], 3, String(v).slice(0, 40), 'TEXT'); });
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\n');
}
export { VIEWS as DRAWING_VIEWS, scaleText, placeBalloons };
