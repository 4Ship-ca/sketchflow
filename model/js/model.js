/* SketchFlow v2 parametric model.
   doc.objects is the feature list (order = history). Each object = shape type + dimensions in its own local frame,
   placed by a mate (connector → connector) or a pose. Booleans are relations (object "into" a target with an op),
   evaluated in list order — editable at any time. Edge treatments (fillet / weld / chamfer) are objects too.
   One API — apply(ops) — serves the UI and the MCP bridge, so an LLM builds with the same JSON a click produces. */
import * as K from './kernel.js';
const { V, M4 } = K;

export const TYPES = {
  box: { label: 'Box', params: { width: 40, depth: 30, height: 20 } },
  wedge: { label: 'Wedge', params: { width: 40, depth: 20, height: 20 } },
  cylinder: { label: 'Cylinder', params: { diameter: 30, height: 40 } },
  cone: { label: 'Cone', params: { diameter: 30, top: 0, height: 40 } },
  sphere: { label: 'Sphere', params: { diameter: 30 } },
  fillet: { label: 'Fillet strip', params: { size: 6, length: 40, style: 'fillet' } },
  extrude: { label: 'Extrude', params: { profile: [[-10, -10], [10, -10], [10, 10], [-10, 10]], length: 20, twist: 0, scale: 1, direction: [0, 0, 1], shape: 'points', x: 0, y: 0, width: 40, height: 20, radius: 0, diameter: 20, sides: 6 } },
  loft: { label: 'Loft', params: { profile: [[-10, -10], [10, -10], [10, 10], [-10, 10]], profile2: null, length: 30, twist: 0 } },
  revolve: { label: 'Revolve', params: { profile: [[5, 0], [12, 0], [12, 4], [5, 4]], degrees: 360 } },
  sweep: { label: 'Sweep', params: { profile: [[-2, -2], [2, -2], [2, 2], [-2, 2]], path: [[0, 0, 0], [0, 0, 30], [30, 0, 30]] } },
  edge: { label: 'Edge treatment', params: { style: 'fillet', size: 4, mode: 'auto' } },
  /* a linked copy of another part: same shape and features, its own place */
  instance: { label: 'Instance', params: {} },
  /* an imported triangle mesh (STL / OBJ), stored in doc.meshes */
  mesh: { label: 'Mesh', params: { scale: 1 } },
  /* standard hole: a tool (subtract it into a part); its top sits on the surface and it goes down (−z) */
  hole: { label: 'Hole', params: { size: 'M6', kind: 'simple', fit: 'normal', through: true, depth: 12, diameter: 0 } },
  /* hollow a part to a wall thickness, optionally open on one face */
  shell: { label: 'Shell', params: { thickness: 2, open: 'top' } },
  /* array of other features: linear (1 or 2 directions), circular (about an axis), mirror (across a plane) */
  pattern: { label: 'Pattern', params: { kind: 'linear', count: 3, spacing: 20, direction: [1, 0, 0], count2: 1, spacing2: 20, direction2: [0, 1, 0], angle: 360, axis: [0, 0, 1], center: [0, 0, 0], about: null, plane: 'yz', offset: 0 } },
  /* weld bead joining two separate parts; the parts stay separate components (an assembly), unlike a fillet, which merges */
  weld: { label: 'Weld', params: { size: 4, profile: 'flat', all_around: false } }
};
/* materials: density in g/cm³ (= mg/mm³), a display colour, and a family */
export const MATERIALS = {
  pla: { name: 'PLA', density: 1.24, color: '#e9e4d8', family: 'plastic' }, petg: { name: 'PETG', density: 1.27, color: '#cfe3ea', family: 'plastic' },
  abs: { name: 'ABS', density: 1.04, color: '#e8e2dc', family: 'plastic' }, asa: { name: 'ASA', density: 1.07, color: '#e2ddd5', family: 'plastic' },
  tpu: { name: 'TPU', density: 1.21, color: '#5b5f66', family: 'plastic' }, nylon: { name: 'Nylon PA12', density: 1.01, color: '#efeee9', family: 'plastic' },
  pa_cf: { name: 'Nylon CF', density: 1.15, color: '#3b3e44', family: 'plastic' }, pom: { name: 'POM (acetal)', density: 1.41, color: '#f2f1ec', family: 'plastic' },
  acrylic: { name: 'Acrylic (PMMA)', density: 1.18, color: '#d8eef2', family: 'plastic' }, polycarbonate: { name: 'Polycarbonate', density: 1.20, color: '#dfe8ec', family: 'plastic' },
  resin: { name: 'Resin (SLA)', density: 1.18, color: '#c9cfd8', family: 'plastic' }, tough_resin: { name: 'Tough resin', density: 1.15, color: '#b9c3cc', family: 'plastic' },
  aluminium: { name: 'Aluminium 6061', density: 2.70, color: '#c4c9cf', family: 'metal' }, steel: { name: 'Steel (mild)', density: 7.85, color: '#9aa1a8', family: 'metal' },
  stainless: { name: 'Stainless 304', density: 8.00, color: '#b4b9bd', family: 'metal' }, cast_iron: { name: 'Cast iron', density: 7.20, color: '#6f7377', family: 'metal' },
  brass: { name: 'Brass', density: 8.50, color: '#c9a94f', family: 'metal' }, bronze: { name: 'Bronze', density: 8.80, color: '#b0814a', family: 'metal' },
  copper: { name: 'Copper', density: 8.96, color: '#c27a4e', family: 'metal' }, titanium: { name: 'Titanium Ti-6Al-4V', density: 4.43, color: '#a4a29d', family: 'metal' },
  oak: { name: 'Oak', density: 0.75, color: '#b8895a', family: 'wood' }, pine: { name: 'Pine', density: 0.50, color: '#d9b77e', family: 'wood' },
  plywood: { name: 'Plywood (birch)', density: 0.68, color: '#d6b98a', family: 'wood' }, mdf: { name: 'MDF', density: 0.75, color: '#b49a78', family: 'wood' },
  carbon_fibre: { name: 'Carbon fibre (CFRP)', density: 1.60, color: '#2d2f33', family: 'composite' }, concrete: { name: 'Concrete', density: 2.40, color: '#a9a79f', family: 'other' },
  glass: { name: 'Glass', density: 2.50, color: '#d5e9ee', family: 'other' }, rubber: { name: 'Rubber', density: 1.15, color: '#3a3b3d', family: 'other' }
};
/* object types that are not shapes of their own */
const META = new Set(['edge', 'pattern', 'weld', 'shell']);
export const SHAPES = ['box', 'wedge', 'cylinder', 'cone', 'sphere', 'fillet'];
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/* ---------- connectors (local frames): o = origin, n = normal / axis, u = in-plane reference ---------- */
function conn(name, o, n, u, kind) { return { name, o, n: V.norm(n), u: V.norm(u), kind: kind || 'face' }; }
function boxLike(W, D, H, wedge) {
  const c = [conn('top', [0, 0, H], [0, 0, 1], [1, 0, 0]), conn('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0]),
    conn('front', [0, -D / 2, H / 2], [0, -1, 0], [1, 0, 0]), conn('back', [0, D / 2, H / 2], [0, 1, 0], [-1, 0, 0]),
    conn('left', [-W / 2, 0, H / 2], [-1, 0, 0], [0, -1, 0]), conn('right', [W / 2, 0, H / 2], [1, 0, 0], [0, 1, 0]),
    conn('center', [0, 0, H / 2], [0, 0, 1], [1, 0, 0], 'center')];
  if (wedge) { c.splice(0, 1, conn('slope', [0, 0, H / 2], [H, 0, W], [0, 1, 0])); c.splice(c.findIndex(x => x.name === 'right'), 1); }
  const xs = [-W / 2, W / 2], ys = [-D / 2, D / 2], zs = [0, H], s = (v) => (v > 0 ? '+' : '-');
  for (const x of xs) for (const y of ys) for (const z of zs) { if (wedge && x > 0 && z > 0) continue; c.push(conn('corner' + s(x) + 'x' + s(y) + 'y' + s(z - H / 2) + 'z', [x, y, z], [0, 0, 1], [1, 0, 0], 'corner')); }
  /* edge midpoints: axis along the edge, u pointing out from the body */
  const E = (name, a, b) => { const m = V.lerp(a, b, 0.5), out = V.sub(m, [0, 0, H / 2]); c.push(conn('edge:' + name, m, V.sub(b, a), V.sub(out, V.mul(V.norm(V.sub(b, a)), V.dot(out, V.norm(V.sub(b, a))))), 'edge')); };
  if (!wedge) {
    E('top-front', [-W / 2, -D / 2, H], [W / 2, -D / 2, H]); E('top-back', [-W / 2, D / 2, H], [W / 2, D / 2, H]); E('top-left', [-W / 2, -D / 2, H], [-W / 2, D / 2, H]); E('top-right', [W / 2, -D / 2, H], [W / 2, D / 2, H]);
    E('bottom-front', [-W / 2, -D / 2, 0], [W / 2, -D / 2, 0]); E('bottom-back', [-W / 2, D / 2, 0], [W / 2, D / 2, 0]); E('bottom-left', [-W / 2, -D / 2, 0], [-W / 2, D / 2, 0]); E('bottom-right', [W / 2, -D / 2, 0], [W / 2, D / 2, 0]);
    E('front-left', [-W / 2, -D / 2, 0], [-W / 2, -D / 2, H]); E('front-right', [W / 2, -D / 2, 0], [W / 2, -D / 2, H]); E('back-left', [-W / 2, D / 2, 0], [-W / 2, D / 2, H]); E('back-right', [W / 2, D / 2, 0], [W / 2, D / 2, H]);
  }
  return c;
}
function roundLike(R, H, Rtop) {
  const c = [conn('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0]), conn('center', [0, 0, H / 2], [0, 0, 1], [1, 0, 0], 'center')];
  c.push(Rtop > 1e-9 || Rtop == null ? conn('top', [0, 0, H], [0, 0, 1], [1, 0, 0]) : conn('apex', [0, 0, H], [0, 0, 1], [1, 0, 0], 'corner'));
  const rm = Rtop == null ? R : (R + Rtop) / 2;
  for (const [nm, x, y] of [['+x', 1, 0], ['-x', -1, 0], ['+y', 0, 1], ['-y', 0, -1]]) c.push(conn('side' + nm, [x * rm, y * rm, H / 2], [x, y, 0], [0, 0, 1], 'side'));
  return c;
}
function connectorsOf(o, solid) {
  const p = o.params;
  switch (o.type) {
    case 'box': return boxLike(p.width, p.depth, p.height);
    case 'wedge': return boxLike(p.width, p.depth, p.height, true);
    case 'cylinder': return roundLike(p.diameter / 2, p.height);
    case 'cone': return roundLike(p.diameter / 2, p.height, (p.top || 0) / 2);
    case 'sphere': return roundLike(p.diameter / 2, p.diameter);
    case 'hole': { const dep = p.through ? Math.max(0.5, +p.depth || 10) : (+p.depth || 10); return [conn('top', [0, 0, 0], [0, 0, 1], [1, 0, 0]), conn('center', [0, 0, -dep / 2], [0, 0, 1], [1, 0, 0], 'center'), conn('bottom', [0, 0, -dep], [0, 0, -1], [1, 0, 0])]; }
    case 'fillet': return [conn('edge', [0, 0, 0], [0, 1, 0], [1, 0, 1], 'edge'), conn('leg-x', [p.size / 2, 0, 0], [0, 0, -1], [1, 0, 0]), conn('leg-z', [0, 0, p.size / 2], [-1, 0, 0], [0, 0, 1]),
      conn('end-a', [0, -p.length / 2, 0], [0, -1, 0], [1, 0, 0]), conn('end-b', [0, p.length / 2, 0], [0, 1, 0], [1, 0, 0])];
    default: {
      /* features: start/end faces + bounding-box faces & centre (add-on shapes add their own connectors first) */
      const T = TYPES[o.type], c = T && T.def && T.def.connectors ? T.def.connectors(p, addonApi).slice() : [];
      if (o.type === 'extrude' || o.type === 'loft') {
        const cen = centroid2(o.type === 'extrude' && p.shape && p.shape !== 'points' ? shapeProfile(p) : p.profile), dir = o.type === 'extrude' ? V.norm(p.direction || [0, 0, 1]) : [0, 0, 1], L = p.length;
        const end = o.type === 'extrude' ? V.add([cen[0], cen[1], 0], V.mul(dir, L / (dir[2] || 1))) : [cen[0], cen[1], L];
        c.push(conn('start', [cen[0], cen[1], 0], [0, 0, -1], [1, 0, 0]), conn('end', end, [0, 0, 1], [1, 0, 0]));
      }
      if (solid && !solid.isEmpty()) {
        const b = solid.bbox(), m = V.lerp(b.min, b.max, 0.5);
        if (!c.find(x => x.name === 'center')) c.push(conn('center', m, [0, 0, 1], [1, 0, 0], 'center'));
        for (const [nm, k, s] of [['+x', 0, 1], ['-x', 0, -1], ['+y', 1, 1], ['-y', 1, -1], ['+z', 2, 1], ['-z', 2, -1]]) {
          const o2 = m.slice(); o2[k] = s > 0 ? b.max[k] : b.min[k]; const n = [0, 0, 0]; n[k] = s;
          c.push(conn('bbox' + nm, o2, n, k === 2 ? [1, 0, 0] : [0, 0, 1]));
        }
        if (!c.find(x => x.name === 'bottom')) c.push(conn('bottom', [m[0], m[1], b.min[2]], [0, 0, -1], [1, 0, 0]));
        if (!c.find(x => x.name === 'top')) c.push(conn('top', [m[0], m[1], b.max[2]], [0, 0, 1], [1, 0, 0]));
      }
      return c;
    }
  }
}
const centroid2 = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
const ORIGIN_CONNS = [conn('origin', [0, 0, 0], [0, 0, 1], [1, 0, 0], 'center'), conn('xy', [0, 0, 0], [0, 0, 1], [1, 0, 0]), conn('xz', [0, 0, 0], [0, -1, 0], [1, 0, 0]), conn('yz', [0, 0, 0], [1, 0, 0], [0, 1, 0])];
const frameOf = (c) => M4.frame(c.o, c.u, c.n);

/* ---------- add-ons ----------
   An add-on is a plain object (no imports needed): { id, name, version, description,
     types:   { typeName: { label, params, doc, build(p, api) → Solid, connectors?(p, api), dims?(p, api), info?(p, api) } },
     mates:   { kind: { doc, solve({ self, target, mate, api }) → { a, b, flip, offset, angle, slide } } },
     actions: { name: { doc, args: { key: { default, doc, options? } }, run(args, ctx) → { ops?, info? } } } }
   Its shapes become first-class objects (mates, booleans, edges, patterns, dimensions, export, MCP) — see model/ADDONS.md. */
export const ADDONS = new Map();
const ADDON_MATES = new Map();
export const addonApi = {
  K, V, M4, SEG: 48,
  conn: (name, o, n, u, kind) => conn(name, o, n, u, kind),
  dim: (param, a, b, view, kind) => ({ param, a, b, view, kind: kind || 'linear' }),
  num: (v, d) => num(v, d)
};
export function registerAddon(a) {
  if (!a || typeof a !== 'object' || !a.id) throw new Error('An add-on needs an id');
  for (const [t, def] of Object.entries(a.types || {})) {
    if (TYPES[t] && TYPES[t].addon !== a.id) throw new Error(`Add-on ${a.id}: type “${t}” already exists`);
    if (typeof def.build !== 'function') throw new Error(`Add-on ${a.id}: type “${t}” needs build(params, api)`);
    TYPES[t] = { label: def.label || t, params: def.params || {}, addon: a.id, def };
  }
  for (const [k, def] of Object.entries(a.mates || {})) { if (typeof def.solve !== 'function') throw new Error(`Add-on ${a.id}: mate “${k}” needs solve()`); ADDON_MATES.set(k, Object.assign({ addon: a.id }, def)); }
  ADDONS.set(a.id, a); BODY_CACHE.clear(); LOCAL_CACHE.clear(); localCache.clear();
  return a;
}
export function listAddons() {
  return [...ADDONS.values()].map(a => ({
    id: a.id, name: a.name || a.id, version: a.version || '0', description: a.description || '',
    types: Object.fromEntries(Object.entries(a.types || {}).map(([t, d]) => [t, { label: d.label || t, params: d.params || {}, doc: d.doc || '' }])),
    mates: Object.fromEntries(Object.entries(a.mates || {}).map(([k, d]) => [k, d.doc || ''])),
    actions: Object.fromEntries(Object.entries(a.actions || {}).map(([k, d]) => [k, { doc: d.doc || '', args: d.args || {}, query: !!d.query }]))
  }));
}

/* ---------- holes: ISO metric (clearance ISO 273, counterbore for ISO 4762 heads, countersink for ISO 10642, tap drill, heat-set inserts) ---------- */
export const HOLES = {
  M2: { close: 2.2, normal: 2.4, loose: 2.6, cb: [4.4, 2.2], cs: 4.4, tap: 1.6, pitch: 0.4, insert: [3.2, 4] },
  'M2.5': { close: 2.7, normal: 2.9, loose: 3.1, cb: [5.5, 2.7], cs: 5.5, tap: 2.05, pitch: 0.45, insert: [3.6, 5] },
  M3: { close: 3.2, normal: 3.4, loose: 3.6, cb: [6.5, 3.3], cs: 6.7, tap: 2.5, pitch: 0.5, insert: [4.0, 5.7] },
  M4: { close: 4.3, normal: 4.5, loose: 4.8, cb: [8, 4.4], cs: 9, tap: 3.3, pitch: 0.7, insert: [5.6, 8.1] },
  M5: { close: 5.3, normal: 5.5, loose: 5.8, cb: [10, 5.4], cs: 11.2, tap: 4.2, pitch: 0.8, insert: [6.4, 9.5] },
  M6: { close: 6.4, normal: 6.6, loose: 7, cb: [11, 6.4], cs: 13.4, tap: 5, pitch: 1, insert: [8, 12.7] },
  M8: { close: 8.4, normal: 9, loose: 10, cb: [15, 8.6], cs: 17.9, tap: 6.8, pitch: 1.25, insert: [9.6, 12.7] },
  M10: { close: 10.5, normal: 11, loose: 12, cb: [18, 10.8], cs: 22.4, tap: 8.5, pitch: 1.5 },
  M12: { close: 13, normal: 13.5, loose: 14.5, cb: [20, 13], cs: 26.9, tap: 10.2, pitch: 1.75 },
  M16: { close: 17, normal: 17.5, loose: 18.5, cb: [26, 17.5], cs: 33.6, tap: 14, pitch: 2 }
};
export function holeSpec(p) {
  const H = HOLES[String(p.size || 'M6').toUpperCase().replace('M2.5', 'M2.5')] || HOLES[p.size]; if (!H && !(+p.diameter > 0)) throw new Error(`size is one of ${Object.keys(HOLES).join(', ')} (or set diameter)`);
  const kind = p.kind || 'simple', fit = p.fit || 'normal';
  let d = +p.diameter > 0 ? +p.diameter : kind === 'tapped' ? H.tap : kind === 'insert' ? (H.insert ? H.insert[0] : null) : fit === 'print' ? H.normal + 0.2 : H[fit] || H.normal;
  if (!d) throw new Error(`no heat-set insert size for ${p.size}`);
  const out = { d, kind, cb: H && H.cb ? [H.cb[0] + (fit === 'print' ? 0.3 : 0), H.cb[1]] : null, cs: H ? H.cs : null, tap: H ? H.tap : null, pitch: H ? H.pitch : null, insertDepth: H && H.insert ? H.insert[1] : null };
  if (!H) { out.label = `Ø${d} ${kind}`; return out; }
  out.label = kind === 'tapped' ? `${p.size}×${H.pitch} tapped (Ø${H.tap} drill)` : kind === 'insert' ? `${p.size} heat-set insert Ø${d} × ${out.insertDepth}` : `${p.size} ${fit} clearance Ø${d}${kind === 'counterbore' ? `, counterbore Ø${out.cb[0]} × ${out.cb[1]}` : kind === 'countersink' ? `, countersink Ø${out.cs} × 90°` : ''}`;
  return out;
}
function buildHole(p) {
  const h = holeSpec(p), r = h.d / 2, depth = p.kind === 'insert' && !p.through ? (+p.depth || h.insertDepth) : Math.max(0.5, +p.depth || 10);
  const seg = 48, up = 1, tr = (sol, z) => sol.transform(M4.translate([0, 0, z]));
  let s = tr(K.cylinder(r, r, depth + up, seg), -depth);
  if (!p.through) { const tip = r / Math.tan(59 * Math.PI / 180); s = s.union(tr(K.cylinder(0.0001, r, tip, seg), -depth - tip)); }
  if (h.kind === 'counterbore' && h.cb) s = s.union(tr(K.cylinder(h.cb[0] / 2, h.cb[0] / 2, h.cb[1] + up, seg), -h.cb[1]));
  if (h.kind === 'countersink' && h.cs) { const rc = h.cs / 2, dz = rc - r; s = s.union(tr(K.cylinder(r, rc, dz, seg), -dz)).union(tr(K.cylinder(rc, rc, up, seg), 0)); }
  return s;
}
/* shell cavity in the part's own frame: the same shape, thinner by t, opened through one face */
function shellCavity(root, p) {
  const t = +p.thickness, q = root.params, open = p.open || 'none', E = 1;
  if (!(t > 0)) throw new Error('thickness must be above 0');
  const box = (w, d, h, x, y, z) => K.box(w, d, h).transform(M4.translate([x, y, z]));
  switch (root.type) {
    case 'box': {
      const W = q.width - 2 * t, D = q.depth - 2 * t; if (W <= 0 || D <= 0 || q.height - 2 * t <= 0) throw new Error(`walls of ${t} leave nothing inside`);
      const z0 = open === 'bottom' ? -E : t, z1 = open === 'top' ? q.height + E : q.height - t;
      let x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2;
      if (open === 'front') y0 = -q.depth / 2 - E; if (open === 'back') y1 = q.depth / 2 + E; if (open === 'left') x0 = -q.width / 2 - E; if (open === 'right') x1 = q.width / 2 + E;
      return box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, z0);
    }
    case 'cylinder': case 'cone': {
      const R1 = q.diameter / 2, R2 = root.type === 'cone' ? (q.top || 0) / 2 : R1, H = q.height, slope = (R1 - R2) / H, k = Math.sqrt(1 + slope * slope);
      const z0 = open === 'bottom' ? -E : t, z1 = open === 'top' ? H + E : H - t, rAt = (z) => R1 - slope * z - t * k;
      if (rAt(Math.max(0, z0)) <= 0) throw new Error(`walls of ${t} leave nothing inside`);
      return K.cylinder(Math.max(0.01, rAt(z0)), Math.max(0.01, rAt(z1)), z1 - z0, SEG).transform(M4.translate([0, 0, z0]));
    }
    case 'sphere': { const R = q.diameter / 2 - t; if (R <= 0) throw new Error('walls too thick'); return K.sphere(R, 32).transform(M4.translate([0, 0, t])); }
    case 'extrude': {
      if ((q.twist || 0) !== 0 || (q.scale != null && q.scale !== 1)) throw new Error('shell works on straight extrudes (no twist or taper)');
      const inner = insetPolygon(q.shape && q.shape !== 'points' ? shapeProfile(q) : q.profile, t); if (!inner) throw new Error(`walls of ${t} leave nothing inside the profile`);
      const z0 = open === 'start' || open === 'bottom' ? -E : t, z1 = open === 'end' || open === 'top' ? q.length + E : q.length - t;
      return K.extrude(inner, { length: z1 - z0, dir: q.direction }).transform(M4.translate(V.mul(V.norm(q.direction || [0, 0, 1]), z0 / (V.norm(q.direction || [0, 0, 1])[2] || 1))));
    }
  }
  throw new Error('shell works on boxes, cylinders, cones, spheres and straight extrudes');
}
/* inward offset of a simple polygon (mitred corners) */
function insetPolygon(pts, t) {
  let P = pts.slice(); if (K.area2(P) < 0) P = P.reverse();
  const n = P.length, lines = [];
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L; lines.push([[a[0] + nx * t, a[1] + ny * t], [dx / L, dy / L]]); }
  const out = [];
  for (let i = 0; i < n; i++) {
    const [p1, d1] = lines[(i + n - 1) % n], [p2, d2] = lines[i], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) { out.push(p2); continue; }
    const u = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; out.push([p1[0] + d1[0] * u, p1[1] + d1[1] * u]);
  }
  return K.area2(out) > 1e-6 ? out : null;
}
/* ---------- imported meshes ---------- */
let MESH_STORE = {};   /* set per evaluation from doc.meshes: id → { b64 (Float32 xyz per vertex, 3 per triangle), tris } */
export function encodeTriangles(arr) { const f = arr instanceof Float32Array ? arr : Float32Array.from(arr), u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let sx = ''; for (let i = 0; i < u.length; i += 0x8000) sx += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(sx) : Buffer.from(u).toString('base64'); }
function decodeTriangles(b64) { const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); }
function meshSolid(o) {
  const m = MESH_STORE[o.params.ref || o.id]; if (!m) throw new Error('the mesh data is missing (re-import it)');
  const P = decodeTriangles(m.b64), sc = +o.params.scale || 1, polys = [];
  for (let i = 0; i + 8 < P.length; i += 9) { const q = K.poly([[P[i] * sc, P[i + 1] * sc, P[i + 2] * sc], [P[i + 3] * sc, P[i + 4] * sc, P[i + 5] * sc], [P[i + 6] * sc, P[i + 7] * sc, P[i + 8] * sc]], 'mesh'); if (q) polys.push(q); }
  const s = new K.Solid(polys); if (s.volume() < 0) for (const q of s.polys) q.flip();
  return s;
}
/* parse STL (binary or ASCII) or OBJ into one flat triangle array, re-centred on its base (like the built-in shapes) */
export function parseMesh(name, data) {
  const lower = String(name || '').toLowerCase(), tri = [];
  const asText = typeof data === 'string' ? data : new TextDecoder().decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  if (lower.endsWith('.obj')) {
    const v = [];
    for (const line of asText.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === 'v') v.push([+t[1], +t[2], +t[3]]);
      else if (t[0] === 'f') { const idx = t.slice(1).map(x => { const k = parseInt(x.split('/')[0], 10); return k < 0 ? v.length + k : k - 1; }); for (let i = 1; i < idx.length - 1; i++) for (const k of [idx[0], idx[i], idx[i + 1]]) tri.push(...v[k]); }
    }
  } else {
    const bytes = typeof data === 'string' ? null : (data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    const isAscii = !bytes || (/^\s*solid/.test(asText.slice(0, 80)) && /facet\s+normal/.test(asText.slice(0, 1000)));
    if (isAscii) { const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g; let mm; while ((mm = re.exec(asText))) tri.push(+mm[1], +mm[2], +mm[3]); }
    else { const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = dv.getUint32(80, true); for (let i = 0; i < n; i++) { const o0 = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) tri.push(dv.getFloat32(o0 + k * 4, true)); } }
  }
  if (tri.length < 9) throw new Error('no triangles found in ' + name);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], tri[i]); mx[k] = Math.max(mx[k], tri[i]); }
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]];
  for (let i = 0; i < tri.length; i++) tri[i] -= c[i % 3];
  return { triangles: Float32Array.from(tri), count: tri.length / 9, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}
/* ---------- parametric sketch shapes (extrude profiles that keep their sizes as dimensions) ---------- */
export const SKETCH_SHAPES = { rect: ['x', 'y', 'width', 'height', 'radius'], circle: ['x', 'y', 'diameter'], slot: ['x', 'y', 'width', 'height'], polygon: ['x', 'y', 'diameter', 'sides'] };
export function shapeProfile(p) {
  const cx = +p.x || 0, cy = +p.y || 0, out = [], arc = (x, y, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([x + r * Math.cos(a), y + r * Math.sin(a)]); } };
  switch (p.shape) {
    case 'rect': {
      const w = +p.width, h = +p.height, r = Math.max(0, Math.min(+p.radius || 0, w / 2 - 1e-6, h / 2 - 1e-6)); if (!(w > 0 && h > 0)) throw new Error('width and height must be above 0');
      if (r <= 1e-6) return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
      arc(cx + w / 2 - r, cy - h / 2 + r, r, -Math.PI / 2, 0, 8); arc(cx + w / 2 - r, cy + h / 2 - r, r, 0, Math.PI / 2, 8); arc(cx - w / 2 + r, cy + h / 2 - r, r, Math.PI / 2, Math.PI, 8); arc(cx - w / 2 + r, cy - h / 2 + r, r, Math.PI, 1.5 * Math.PI, 8);
      return out;
    }
    case 'circle': { const r = +p.diameter / 2; if (!(r > 0)) throw new Error('diameter must be above 0'); for (let i = 0; i < SEG; i++) out.push([cx + r * Math.cos(2 * Math.PI * i / SEG), cy + r * Math.sin(2 * Math.PI * i / SEG)]); return out; }
    case 'slot': { const L = +p.width, h = +p.height, r = h / 2; if (!(L > h && h > 0)) throw new Error('a slot needs width (overall length) greater than height'); arc(cx + L / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2, 16); arc(cx - L / 2 + r, cy, r, Math.PI / 2, 1.5 * Math.PI, 16); return out; }
    case 'polygon': { const n = Math.max(3, Math.round(+p.sides || 6)), r = +p.diameter / 2; if (!(r > 0)) throw new Error('diameter must be above 0'); for (let i = 0; i < n; i++) out.push([cx + r * Math.cos(Math.PI / 2 + 2 * Math.PI * i / n), cy + r * Math.sin(Math.PI / 2 + 2 * Math.PI * i / n)]); return out; }
  }
  return p.profile;
}
/* ---------- local geometry ---------- */
const SEG = 48;
function buildLocal(o) {
  const p = o.params;
  switch (o.type) {
    case 'box': return K.box(p.width, p.depth, p.height);
    case 'wedge': return K.wedge(p.width, p.depth, p.height);
    case 'cylinder': return K.cylinder(p.diameter / 2, p.diameter / 2, p.height, p.segments || SEG);
    case 'cone': return K.cylinder(p.diameter / 2, Math.max(0, (p.top || 0) / 2), p.height, p.segments || SEG);
    case 'sphere': return K.sphere(p.diameter / 2, p.segments || 32);
    case 'fillet': return K.edgePiece([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], p.size, p.style || 'fillet', p.length);
    case 'extrude': return K.extrude(p.shape && p.shape !== 'points' ? shapeProfile(p) : p.profile, { length: p.length, twist: p.twist, scale: p.scale, dir: p.direction });
    case 'loft': return K.loft(p.profile, p.profile2 || p.profile, { length: p.length, twist: p.twist });
    case 'revolve': return K.revolve(p.profile, { degrees: p.degrees });
    case 'sweep': return K.sweep(p.profile, p.path);
    case 'hole': return buildHole(p);
    case 'mesh': return meshSolid(o);
    case 'instance': return K.Solid.empty();   /* geometry comes from its source part, after the bodies are built */
  }
  const T = TYPES[o.type]; if (T && T.def) return T.def.build(p, addonApi);
  throw new Error('Unknown shape ' + o.type);
}
const localCache = new Map();
function localSolid(o) {
  const key = o.type + JSON.stringify(o.params);
  let s = localCache.get(key);
  if (!s) { s = buildLocal(o); if (localCache.size > 300) localCache.clear(); localCache.set(key, s); }
  return s;
}
/* carried dimensions: which parameter, measured between which local points, best shown in which view */
export function dimsOf(o) {
  const p = o.params, D = (param, a, b, view, kind) => ({ param, a, b, view, kind: kind || 'linear' });
  switch (o.type) {
    case 'box': case 'wedge': return [D('width', [-p.width / 2, -p.depth / 2, 0], [p.width / 2, -p.depth / 2, 0], 'front'), D('height', [-p.width / 2, -p.depth / 2, 0], [-p.width / 2, -p.depth / 2, p.height], 'front'), D('depth', [p.width / 2, -p.depth / 2, p.height], [p.width / 2, p.depth / 2, p.height], 'top')];
    case 'cylinder': return [D('diameter', [-p.diameter / 2, 0, p.height], [p.diameter / 2, 0, p.height], 'top', 'diameter'), D('height', [p.diameter / 2, 0, 0], [p.diameter / 2, 0, p.height], 'front')];
    case 'cone': { const o2 = [D('diameter', [-p.diameter / 2, 0, 0], [p.diameter / 2, 0, 0], 'front', 'diameter'), D('height', [p.diameter / 2, 0, 0], [p.diameter / 2, 0, p.height], 'front')]; if (p.top > 0) o2.push(D('top', [-p.top / 2, 0, p.height], [p.top / 2, 0, p.height], 'front', 'diameter')); return o2; }
    case 'sphere': return [D('diameter', [-p.diameter / 2, 0, p.diameter / 2], [p.diameter / 2, 0, p.diameter / 2], 'front', 'diameter')];
    case 'fillet': return [D('size', [0, 0, 0], [p.size, 0, 0], 'front'), D('length', [0, -p.length / 2, 0], [0, p.length / 2, 0], 'top')];
    case 'extrude': {
      const prof = p.shape && p.shape !== 'points' ? shapeProfile(p) : p.profile, c = centroid2(prof), dir = V.norm(p.direction || [0, 0, 1]);
      const out = [D('length', [c[0], c[1], 0], V.add([c[0], c[1], 0], V.mul(dir, p.length / (dir[2] || 1))), 'auto')], x = +p.x || 0, y = +p.y || 0;
      /* a shape's own sizes are dimensions in its sketch plane */
      if (p.shape === 'rect' || p.shape === 'slot') out.push(D('width', [x - p.width / 2, y - p.height / 2, 0], [x + p.width / 2, y - p.height / 2, 0], 'auto'), D('height', [x - p.width / 2, y - p.height / 2, 0], [x - p.width / 2, y + p.height / 2, 0], 'auto'));
      if (p.shape === 'circle' || p.shape === 'polygon') out.push(D('diameter', [x - p.diameter / 2, y, 0], [x + p.diameter / 2, y, 0], 'auto', 'diameter'));
      return out;
    }
    case 'loft': { const c = centroid2(p.profile); return [D('length', [c[0], c[1], 0], [c[0], c[1], p.length], 'auto')]; }
    default: { const T = TYPES[o.type]; if (T && T.def && T.def.dims) { try { return T.def.dims(p, addonApi) || []; } catch (e) { return []; } } return []; }
  }
}

/* ---------- document ---------- */
export function newDoc(name) { return { v: 2, name: name || 'Model', units: 'mm', objects: [], origin: null, ground: null, dims: [], vars: {}, created: Date.now(), updated: Date.now() }; }
function defaultParams(type, given) {
  const base = JSON.parse(JSON.stringify(TYPES[type].params)), out = Object.assign(base, given || {});
  for (const k of Object.keys(out)) if (typeof base[k] === 'number' && typeof out[k] === 'string' && out[k] !== '' && isFinite(+out[k])) out[k] = +out[k];
  if (type === 'loft' && !out.profile2) out.profile2 = out.profile;
  return out;
}

/* ---------- links & formulas ----------
   Any numeric parameter can follow another: o.expr[param] = '=plate.depth' or '=plate.depth - 2 * #wall'.
   References: objectId.param (or Object_Name.param, spaces as _), model variables #name (doc.vars), pi.
   Functions: min max round floor ceil abs sqrt sin cos tan (degrees). Resolved before every evaluation, leaders first. */
const FUNCS = { min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt, sin: (d) => Math.sin(d * Math.PI / 180), cos: (d) => Math.cos(d * Math.PI / 180), tan: (d) => Math.tan(d * Math.PI / 180) };
export function parseExpr(src) {
  const s = String(src).replace(/^\s*=/, ''), toks = []; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(s.slice(i)); if (num) { toks.push({ t: 'n', v: +num[0] }); i += num[0].length; continue; }
    const ref = /^#?[A-Za-z_][\w-]*(\.[A-Za-z_]\w*)?/.exec(s.slice(i)); if (ref) { toks.push({ t: 'id', v: ref[0] }); i += ref[0].length; continue; }
    if ('+-*/%^(),'.includes(ch)) { toks.push({ t: ch }); i++; continue; }
    throw new Error(`can't read “${ch}” in “${s}”`);
  }
  let k = 0; const peek = () => toks[k], eat = (t) => { if (!toks[k] || toks[k].t !== t) throw new Error(`expected “${t}” in “${s}”`); return toks[k++]; };
  const expr = () => { let n = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = toks[k++].t, r = term(); n = { op, a: n, b: r }; } return n; };
  const term = () => { let n = unary(); while (peek() && '*/%'.includes(peek().t)) { const op = toks[k++].t, r = unary(); n = { op, a: n, b: r }; } return n; };
  const unary = () => { if (peek() && (peek().t === '-' || peek().t === '+')) { const op = toks[k++].t, a = unary(); return op === '-' ? { op: 'neg', a } : a; } return power(); };
  const power = () => { const a = atom(); if (peek() && peek().t === '^') { k++; return { op: '^', a, b: unary() }; } return a; };
  const atom = () => {
    const t = peek(); if (!t) throw new Error(`“${s}” ends too early`);
    if (t.t === 'n') { k++; return { op: 'n', v: t.v }; }
    if (t.t === '(') { k++; const e = expr(); eat(')'); return e; }
    if (t.t === 'id') {
      k++;
      if (peek() && peek().t === '(') { k++; const args = []; if (peek() && peek().t !== ')') { args.push(expr()); while (peek() && peek().t === ',') { k++; args.push(expr()); } } eat(')'); if (!FUNCS[t.v]) throw new Error(`unknown function ${t.v}()`); return { op: 'f', f: t.v, args }; }
      return { op: 'ref', v: t.v };
    }
    throw new Error(`unexpected “${t.t}” in “${s}”`);
  };
  const tree = expr(); if (k < toks.length) throw new Error(`unexpected “${toks[k].v || toks[k].t}” in “${s}”`);
  return tree;
}
function refsOf(tree, out = []) { if (!tree) return out; if (tree.op === 'ref') out.push(tree.v); for (const c of [tree.a, tree.b, ...(tree.args || [])]) if (c) refsOf(c, out); return out; }
function evalTree(tree, look) {
  switch (tree.op) {
    case 'n': return tree.v; case 'ref': return look(tree.v); case 'neg': return -evalTree(tree.a, look);
    case 'f': return FUNCS[tree.f](...tree.args.map(a => evalTree(a, look)));
    case '+': return evalTree(tree.a, look) + evalTree(tree.b, look); case '-': return evalTree(tree.a, look) - evalTree(tree.b, look);
    case '*': return evalTree(tree.a, look) * evalTree(tree.b, look); case '/': { const b = evalTree(tree.b, look); if (b === 0) throw new Error('division by zero'); return evalTree(tree.a, look) / b; }
    case '%': return evalTree(tree.a, look) % evalTree(tree.b, look); case '^': return Math.pow(evalTree(tree.a, look), evalTree(tree.b, look));
  }
  throw new Error('bad formula');
}
/* resolve every linked parameter (leaders before followers); writes the numbers into params, returns warnings */
export function resolveLinks(doc, cfg) {
  const warn = [], byId = new Map(doc.objects.map(o => [o.id, o])), byName = new Map(doc.objects.map(o => [String(o.name || '').replace(/\s+/g, '_'), o]));
  const vars = Object.assign({}, doc.vars || {}, (cfg && cfg.vars) || {}), state = new Map(), varState = new Map(), varVal = new Map();
  const varOf = (name, chain) => {
    if (varVal.has(name)) return varVal.get(name);
    if (!(name in vars)) throw new Error(`no variable #${name}`);
    if (varState.get(name) === 'busy') throw new Error(`#${name} refers to itself`);
    varState.set(name, 'busy');
    const v = typeof vars[name] === 'number' ? vars[name] : evalTree(parseExpr(vars[name]), (r) => look(r, chain));
    varState.set(name, 'done'); varVal.set(name, v); return v;
  };
  const look = (ref, chain) => {
    if (ref === 'pi') return Math.PI;
    if (ref[0] === '#') return varOf(ref.slice(1), chain);
    const dot = ref.indexOf('.'); if (dot < 0) { if (ref in vars) return varOf(ref, chain); throw new Error(`“${ref}” needs a parameter, e.g. ${ref}.width`); }
    const oid = ref.slice(0, dot), prm = ref.slice(dot + 1), x = byId.get(oid) || byName.get(oid); if (!x) throw new Error(`no object “${oid}”`);
    if (!(prm in (x.params || {}))) throw new Error(`${x.name} has no “${prm}” (it has ${Object.keys(x.params || {}).filter(q => typeof x.params[q] === 'number').join(', ')})`);
    resolveParam(x, prm, chain);
    const v = x.params[prm]; if (typeof v !== 'number') throw new Error(`${x.name}.${prm} is not a number`); return v;
  };
  const resolveParam = (x, prm, chain = []) => {
    const e = x.expr && x.expr[prm]; if (!e) return;
    const key = x.id + '.' + prm; if (state.get(key) === 'done') return;
    if (state.get(key) === 'busy' || chain.includes(key)) throw new Error(`links go round in a circle: ${[...chain, key].join(' → ')}`);
    state.set(key, 'busy');
    const v = evalTree(parseExpr(e), (r) => look(r, [...chain, key]));
    if (!isFinite(v)) throw new Error(`${e} is not a finite number`);
    x.params[prm] = Math.round(v * 1e9) / 1e9; state.set(key, 'done');
  };
  for (const o of doc.objects) for (const prm of Object.keys(o.expr || {})) {
    try { resolveParam(o, prm); } catch (e) { state.set(o.id + '.' + prm, 'done'); warn.push({ kind: 'link', id: o.id, text: `${o.name}.${prm} ${o.expr[prm]}: ${e.message}` }); }
  }
  return warn;
}
/* split given params into plain values and links ('=…' strings on numeric params) */
function splitParams(type, given) {
  const vals = {}, links = {}, base = (TYPES[type] || {}).params || {};
  for (const [k, v] of Object.entries(given || {})) {
    if (typeof v === 'string' && /^\s*=/.test(v)) { if (base[k] !== undefined && typeof base[k] !== 'number') throw new Error(`${k} can't be a formula`); parseExpr(v); links[k] = v.trim(); }
    else vals[k] = v;
  }
  return { vals, links };
}

/* ---------- measured (driven / driving) dimensions ----------
   md = { a: {obj, conn}, b: {obj, conn}, view, axis: 'h' | 'v' | 'aligned' | 'normal' }.
   normal = perpendicular distance to a face (or an edge line) — the usual "hole from the edge" dimension. */
const VIEW_AXES = { front: { r: [1, 0, 0], u: [0, 0, 1], f: [0, -1, 0] }, top: { r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] }, right: { r: [0, 1, 0], u: [0, 0, 1], f: [1, 0, 0] } };
export function measureDim(R, md) {
  const ca = worldConnectors(R, md.a.obj).find(c => c.name === md.a.conn), cb = worldConnectors(R, md.b.obj).find(c => c.name === md.b.conn);
  if (!ca || !cb) return null;
  const B = VIEW_AXES[md.view] || VIEW_AXES.front, inPlane = (v) => V.sub(v, V.mul(B.f, V.dot(v, B.f)));
  let axis = md.axis || 'aligned', from = ca.o, to = cb.o, dir;
  if (axis === 'normal') {
    /* the reference is a face or edge seen edge-on in this view (its normal / direction lies in the view plane) */
    const edgeOn = (c) => (c.kind === 'face' || c.kind === 'edge') && Math.abs(V.dot(c.n, B.f)) < 0.2;
    const ref = edgeOn(cb) ? cb : edgeOn(ca) ? ca : null;
    if (!ref) return measureDim(R, Object.assign({}, md, { axis: 'aligned' }));
    const pt = ref === ca ? cb.o : ca.o;
    let d = V.sub(pt, ref.o);
    if (ref.kind === 'edge') { d = V.sub(d, V.mul(ref.n, V.dot(d, ref.n))); }
    else { d = V.mul(ref.n, V.dot(d, ref.n)); }
    d = inPlane(d); from = V.sub(pt, d); to = pt; dir = V.len(d) > 1e-9 ? V.norm(d) : B.r;
    /* endA / endB: where each end of the dimension sits (the face end is the foot on that face) */
    return { value: V.len(d), from, to, dir, ref: ref === ca ? 'a' : 'b', endA: ref === ca ? from : to, endB: ref === ca ? to : from };
  }
  const delta = inPlane(V.sub(to, from));
  if (axis === 'h') dir = B.r; else if (axis === 'v') dir = B.u; else dir = V.len(delta) > 1e-9 ? V.norm(delta) : B.r;
  const t = V.dot(delta, dir);
  if (t < 0) dir = V.neg(dir);
  return { value: Math.abs(t), from, to, dir, endA: from, endB: to };
}

/* ---------- evaluation ---------- */
const BODY_CACHE = new Map(), LOCAL_CACHE = new Map();
function cachedLocal(o) {
  const key = o.type + '|' + JSON.stringify(o.params); let s = LOCAL_CACHE.get(key);
  if (!s) { s = localSolid(o); LOCAL_CACHE.set(key, s); if (LOCAL_CACHE.size > 200) LOCAL_CACHE.delete(LOCAL_CACHE.keys().next().value); }
  return s;
}
/* ---------- joints (moving mates) ----------
   mate.joint: fixed | revolute (spins about the connector axis) | slider (travels along axis n / u / v) | cylindrical (spin + travel)
   | planar (slides on the face + spin). The joint's values are the mate's own angle / offset / slide, so a pose is just data. */
export const JOINTS = {
  revolute: [{ key: 'angle', unit: '°', min: -180, max: 180 }],
  slider: [{ key: 'travel', unit: 'mm', min: -50, max: 50 }],
  cylindrical: [{ key: 'angle', unit: '°', min: -180, max: 180 }, { key: 'offset', unit: 'mm', min: -50, max: 50 }],
  planar: [{ key: 'u', unit: 'mm', min: -50, max: 50 }, { key: 'v', unit: 'mm', min: -50, max: 50 }, { key: 'angle', unit: '°', min: -180, max: 180 }]
};
const dofGet = (m, key) => key === 'angle' ? (m.angle || 0) : key === 'offset' ? (m.offset || 0) : key === 'u' ? (m.slide || [0, 0])[0] : key === 'v' ? (m.slide || [0, 0])[1]
  : key === 'travel' ? (m.axis === 'u' ? (m.slide || [0, 0])[0] : m.axis === 'v' ? (m.slide || [0, 0])[1] : (m.offset || 0)) : 0;
function dofSet(m, key, v) {
  const sl = (m.slide || [0, 0]).slice();
  if (key === 'angle') m.angle = v; else if (key === 'offset') m.offset = v; else if (key === 'u') { sl[0] = v; m.slide = sl; } else if (key === 'v') { sl[1] = v; m.slide = sl; }
  else if (key === 'travel') { if (m.axis === 'u') { sl[0] = v; m.slide = sl; } else if (m.axis === 'v') { sl[1] = v; m.slide = sl; } else m.offset = v; }
}
export function jointsOf(doc) {
  return doc.objects.filter(o => o.mate && o.mate.joint && JOINTS[o.mate.joint]).map(o => ({
    id: o.id, name: o.name, joint: o.mate.joint, axis: o.mate.axis,
    dofs: JOINTS[o.mate.joint].map(d => { const lim = (o.mate.limits || {})[d.key]; return { key: d.key, unit: d.unit, value: dofGet(o.mate, d.key), min: lim ? lim[0] : d.min, max: lim ? lim[1] : d.max, limited: !!lim }; })
  }));
}
/* apply joint values {id: {key: value}} to a copy of the document (a pose to look at, without editing the model) */
export function posedDoc(doc, pose) {
  const d = JSON.parse(JSON.stringify(doc));
  for (const [id, vals] of Object.entries(pose || {})) {
    const o = d.objects.find(x => x.id === id); if (!o || !o.mate) continue;
    for (const [key, v] of Object.entries(typeof vals === 'number' ? { [JOINTS[o.mate.joint] ? JOINTS[o.mate.joint][0].key : 'angle']: vals } : vals)) {
      const lim = (o.mate.limits || {})[key]; dofSet(o.mate, key, lim ? Math.max(lim[0], Math.min(lim[1], +v)) : +v);
    }
  }
  return d;
}
export function evaluate(doc, opts) {
  const R = { world: new Map(), local: new Map(), conns: new Map(), bodies: [], errors: new Map(), warnings: [], roots: [], originPoint: [0, 0, 0], consumed: new Set(), virtual: new Map(), spin: new Map() };
  MESH_STORE = doc.meshes || {};
  const cfg = (doc.configs || []).find(c => c.name === doc.config) || null;
  R.warnings.push(...resolveLinks(doc, cfg));
  /* suppressed features, and everything after the rollback bar, are placed but make no geometry */
  const rb = Number.isInteger(doc.rollback) ? doc.rollback : Infinity, cfgOff = new Set((cfg && cfg.suppress) || []), off = new Set(doc.objects.filter((o, i) => o.suppressed || cfgOff.has(o.id) || i >= rb).map(o => o.id));
  R.config = cfg ? cfg.name : null;
  R.off = off;
  const byId = new Map(doc.objects.map(o => [o.id, o]));
  const ground = byId.get(doc.ground) ? doc.ground : (doc.objects.find(o => !META.has(o.type)) || {}).id;
  R.ground = ground;
  /* local solids + connectors */
  for (const o of doc.objects) {
    if (META.has(o.type)) continue;
    /* a through hole is as deep as its part is big (so it stays through when the part changes) */
    if (o.type === 'hole' && o.params.through && o.into && R.local.has(o.into)) { const bb = R.local.get(o.into).bbox(), L = Math.ceil(V.len(V.sub(bb.max, bb.min)) + 2); if (o.params.depth !== L) o.params.depth = L; }
    if (o.type === 'instance') { const src = byId.get(o.of); R.conns.set(o.id, src && R.conns.has(src.id) ? R.conns.get(src.id) : []); if (!src) R.errors.set(o.id, 'its source part was deleted'); continue; }
    try { const s = cachedLocal(o); R.local.set(o.id, s); R.conns.set(o.id, connectorsOf(o, s)); }
    catch (e) { R.errors.set(o.id, e.message); let c = []; try { c = connectorsOf(o, null); } catch (e2) { /* an add-on shape with bad parameters has no connectors */ } R.conns.set(o.id, c); }
  }
  /* world transforms: mates resolved from the ground outward */
  const state = new Map();
  const poseM = (o) => { const p = o.pose || {}; return M4.mul(M4.translate(p.at || [0, 0, 0]), M4.euler(...(p.rot || [0, 0, 0]))); };
  const worldOf = (id) => {
    if (R.world.has(id)) return R.world.get(id);
    const o = byId.get(id); if (!o) return M4.ident();
    if (state.get(id) === 'busy') { R.warnings.push({ kind: 'cycle', id, text: `${o.name}: its mates form a loop` }); return poseM(o); }
    state.set(id, 'busy');
    let M = poseM(o), m = o.mate;
    if (m && id !== ground) {
      const target = m.to === 'origin' ? null : byId.get(m.to);
      /* add-on mate kinds (e.g. a gear mesh) work out ordinary mate values from both objects' live parameters */
      if (m.kind && target) {
        const mk = ADDON_MATES.get(m.kind);
        if (!mk) { R.warnings.push({ kind: 'orphan', id, text: `${o.name}: mate kind “${m.kind}” needs its add-on` }); m = null; }
        else { try { const tw = worldOf(m.to); m = Object.assign({}, m, mk.solve({ self: o, target, mate: m, api: addonApi, targetWorld: tw, targetSpin: R.spin.get(m.to) })); if (m._spin != null) R.spin.set(id, m._spin); } catch (e) { R.warnings.push({ kind: 'error', id, text: `${o.name}: ${e.message}` }); m = null; } }
      }
      if (!m) { /* keep its own pose */ }
      else if (m.to !== 'origin' && !target) R.warnings.push({ kind: 'orphan', id, text: `${o.name}: mated to a deleted object` });
      else {
        const tConns = m.to === 'origin' ? ORIGIN_CONNS : (R.conns.get(m.to) || []), tc = tConns.find(c => c.name === m.a), sc = (R.conns.get(id) || []).find(c => c.name === m.b);
        if (!tc || !sc) R.warnings.push({ kind: 'orphan', id, text: `${o.name}: mate connector “${!tc ? m.a : m.b}” no longer exists` });
        else {
          const Mt = m.to === 'origin' ? M4.ident() : worldOf(m.to);
          const Fa = M4.mul(Mt, frameOf(tc)), slide = m.slide || [0, 0];
          const T = M4.translate([slide[0] || 0, slide[1] || 0, m.offset || 0]);
          const flip = m.flip ? [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1] : M4.ident();
          const Rz = M4.axisAngle([0, 0, 1], m.angle || 0);
          M = M4.mul(Fa, M4.mul(T, M4.mul(flip, M4.mul(Rz, M4.inv(frameOf(sc))))));
        }
      }
    }
    state.set(id, 'done'); R.world.set(id, M); return M;
  };
  for (const o of doc.objects) if (!META.has(o.type)) worldOf(o.id);
  /* ephemeral world origin: a connector the user (or the first object) chose; display coordinates are relative to it */
  const og = doc.origin && byId.get(doc.origin.obj) ? doc.origin : (ground ? { obj: ground, conn: 'bottom' } : null);
  if (og) { const c = (R.conns.get(og.obj) || []).find(x => x.name === og.conn); if (c) R.originPoint = M4.point(R.world.get(og.obj), c.o); }
  R.originRef = og;
  /* floating = not grounded, not fixed, no mate chain to the ground / origin, and not welded to something that is */
  const welds = doc.objects.filter(o => o.type === 'weld' && Array.isArray(o.joins) && !off.has(o.id));
  const grounded = (id, seen = new Set()) => {
    if (id === ground) return true; const o = byId.get(id); if (!o || seen.has(id)) return false; seen.add(id);
    if (o.fixed) return true;
    if (o.mate && (o.mate.to === 'origin' || grounded(o.mate.to, seen))) return true;
    for (const w of welds) { const k = w.joins.indexOf(id); if (k >= 0 && grounded(w.joins[1 - k], seen)) return true; }
    return false;
  };
  for (const o of doc.objects) if (!META.has(o.type) && !off.has(o.id) && !grounded(o.id)) R.warnings.push({ kind: 'floating', id: o.id, text: `${o.name} is floating — not mated to anything` });
  /* patterns: virtual copies of their source features (live: they follow the source's parameters) */
  const objs = doc.objects.slice();
  for (const P of doc.objects.filter(o => o.type === 'pattern' && !off.has(o.id))) {
    const srcs = (P.of || []).map(id => byId.get(id)).filter(x => x && !off.has(x.id));
    if (!srcs.length) { R.warnings.push({ kind: 'orphan', id: P.id, text: `${P.name}: nothing to repeat (its source was deleted)` }); continue; }
    let Ts; try { Ts = patternTransforms(P, R, byId); } catch (e) { R.warnings.push({ kind: 'error', id: P.id, text: `${P.name}: ${e.message}` }); continue; }
    const add = [];
    Ts.forEach((Tk, k) => {
      const map = new Map(srcs.map(src => [src.id, `${src.id}@${P.id}.${k + 1}`]));
      for (const src of srcs) {
        const vid = map.get(src.id), v = Object.assign({}, src, { id: vid, name: `${src.name} ·${k + 2}`, _virtual: P.id, _source: src.id, mate: null });
        delete v._resolved;
        if (src.type === 'edge') {
          if (!src.edge) continue;
          const own = map.has(src.into), Wb = R.world.get(src.into);
          const mm = own || !Wb ? src.edge.m : M4.point(M4.inv(Wb), M4.point(Tk, M4.point(Wb, src.edge.m)));
          const dd = own || !Wb || !src.edge.d ? src.edge.d : M4.dir(M4.inv(Wb), M4.dir(Tk, M4.dir(Wb, src.edge.d)));
          v.into = own ? map.get(src.into) : src.into;
          v.edge = Object.assign({}, src.edge, { m: mm, d: dd, faces: (src.edge.faces || []).map(f => { const i = f.indexOf(':'), pre = f.slice(0, i); return map.has(pre) ? map.get(pre) + f.slice(i) : f; }) });
        } else if (!META.has(src.type)) {
          if (!R.world.has(src.id)) continue;
          if (map.has(src.into)) v.into = map.get(src.into);
          R.world.set(vid, M4.mul(Tk, R.world.get(src.id))); if (R.local.has(src.id)) R.local.set(vid, R.local.get(src.id)); R.conns.set(vid, R.conns.get(src.id) || []);
        } else continue;
        add.push(v); byId.set(vid, v); R.virtual.set(vid, { pattern: P.id, source: src.id, index: k + 1 });
      }
    });
    objs.splice(objs.indexOf(P) + 1, 0, ...add);
  }
  if (opts && opts.placementOnly) return R;   /* motion frames only need where everything is */
  const intoOf = new Map(); for (const t of objs) if (t.into && !off.has(t.id)) { if (!intoOf.has(t.into)) intoOf.set(t.into, []); intoOf.get(t.into).push(t); }
  /* bodies: booleans in feature-list order */
  const memo = new Map();
  const bodyOf = (id, chain = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const o = byId.get(id); if (!o || chain.has(id)) return K.Solid.empty();
    chain.add(id);
    let s = R.local.has(id) ? R.local.get(id).transform(R.world.get(id)).tag(id) : K.Solid.empty();
    for (const t of intoOf.get(id) || []) {
      R.consumed.add(t.id);
      try {
        if (t.type === 'edge') { s = applyEdge(s, t, o, R); continue; }
        if (t.type === 'shell') { s = s.subtract(shellCavity(o, t.params).transform(R.world.get(o.id)).tag(t.id)); continue; }
        if (META.has(t.type)) continue;
        const tool = bodyOf(t.id, chain);
        const op = t.op || 'subtract';
        s = op === 'add' || op === 'union' ? s.union(tool) : op === 'intersect' ? s.intersect(tool) : s.subtract(tool);
      } catch (e) { R.errors.set(t.id, e.message); }
    }
    chain.delete(id);
    memo.set(id, s); return s;
  };
  for (const o of doc.objects) {
    if (o.into && !byId.has(o.into)) R.warnings.push({ kind: 'orphan', id: o.id, text: `${o.name}: its boolean target was deleted` });
  }
  /* body cache: a body is rebuilt only when something it is made of changed (shape, size, place, booleans, edges, patterns) */
  const r9 = (M) => (M ? Array.from(M, v => Math.round(v * 1e7) / 1e7) : null);
  const sig = (id, seen = new Set()) => {
    const o = byId.get(id); if (!o || seen.has(id)) return null; seen.add(id);
    return [o.type, o.params, o.op, o.edge || null, r9(R.world.get(id)), R.errors.get(id) || null, (intoOf.get(id) || []).map(t => [t.id, sig(t.id, seen)])];
  };
  const subtree = (id, out = []) => { for (const t of intoOf.get(id) || []) if (!out.includes(t.id)) { out.push(t.id); subtree(t.id, out); } return out; };
  const cachedBody = (id) => {
    const key = JSON.stringify(sig(id)), hit = BODY_CACHE.get(id + '|' + key);
    if (hit) {
      for (const c of hit.consumed) R.consumed.add(c);
      R.warnings.push(...hit.warnings); for (const [k, v] of hit.errors) R.errors.set(k, v);
      for (const [k, v] of hit.resolved) { const t = byId.get(k); if (t) t._resolved = v; }
      return hit.solid;
    }
    const w0 = R.warnings.length, e0 = new Set(R.errors.keys()), solid = bodyOf(id), ids = subtree(id);
    const entry = { solid, consumed: ids, warnings: R.warnings.slice(w0), errors: [...R.errors].filter(([k]) => !e0.has(k)), resolved: ids.map(k => [k, byId.get(k)._resolved]).filter(([, v]) => v) };
    BODY_CACHE.set(id + '|' + key, entry); if (BODY_CACHE.size > 160) BODY_CACHE.delete(BODY_CACHE.keys().next().value);
    return solid;
  };
  for (const o of objs) {
    if (META.has(o.type) || (o.into && byId.has(o.into)) || off.has(o.id)) continue;
    if (o.type === 'instance') {
      /* the source part's finished body, moved from where the source is to where this instance is */
      const src = R.bodies.find(b => b.id === o.of), Ws = R.world.get(o.of), Wi = R.world.get(o.id);
      if (!src || !Ws || !Wi) { if (byId.has(o.of)) R.warnings.push({ kind: 'error', id: o.id, text: `${o.name}: its source has no geometry (suppressed, or later in the list)` }); continue; }
      const sm = MATERIALS[((byId.get(o.of) || {}).meta || {}).material] || MATERIALS[doc.material];
      const Mi = M4.mul(Wi, M4.inv(Ws)), ik = serialOf(src.solid) + '|' + Array.from(Mi, v => Math.round(v * 1e7)).join(',');
      let isol = INST_CACHE.get(ik); if (!isol) { isol = src.solid.transform(Mi); INST_CACHE.set(ik, isol); if (INST_CACHE.size > 120) INST_CACHE.delete(INST_CACHE.keys().next().value); }
      R.bodies.push({ id: o.id, solid: isol, color: o.color || src.color || (sm ? sm.color : null), name: o.name, hidden: !!o.hidden, instance: o.of });
      R.roots.push(o.id); continue;
    }
    const s = cachedBody(o.id);
    if (s.isEmpty() && !R.errors.has(o.id)) R.warnings.push({ kind: 'empty', id: o.id, text: `${o.name}: nothing left after its booleans` });
    const mat = MATERIALS[(o.meta || {}).material] || MATERIALS[doc.material];
    R.bodies.push({ id: o.id, solid: s, color: o.color || (mat ? mat.color : null), name: o.name, hidden: !!o.hidden, virtual: o._virtual || null });
    R.roots.push(o.id);
  }
  /* welds: their own bodies, between two parts that stay separate */
  for (const w of welds) {
    try {
      const out = weldBody(w, R, byId);
      if (out.warning) R.warnings.push({ kind: 'weld', id: w.id, text: `${w.name}: ${out.warning}` });
      const matOf = (id) => { const x = byId.get(rootIdOf(id, byId)); return (x && x.meta && x.meta.material) || doc.material || null; };
      const adv = weldAdvice(matOf(w.joins[0]), matOf(w.joins[1])); if (adv) R.warnings.push({ kind: 'weld-material', id: w.id, text: `${w.name}: ${adv}` });
      if (out.solid) R.bodies.push({ id: w.id, solid: out.solid, color: w.color || '#a8824f', name: w.name, hidden: !!w.hidden, weld: true });
      w._resolved = out.resolved || null;
    } catch (e) { R.warnings.push({ kind: 'error', id: w.id, text: `${w.name}: ${e.message}` }); }
  }
  for (const [id, msg] of R.errors) { const o = byId.get(id); R.warnings.push({ kind: 'error', id, text: `${o ? o.name : id}: ${msg}` }); }
  return R;
}
/* ---------- patterns ---------- */
function connWorld(R, ref) {
  if (!ref || !ref.obj) return null;
  if (ref.obj === 'origin') { const c = ORIGIN_CONNS.find(x => x.name === (ref.conn || 'origin')); return c ? { o: R.originPoint, n: c.n } : null; }
  const c = (R.conns.get(ref.obj) || []).find(x => x.name === (ref.conn || 'center')), M = R.world.get(ref.obj);
  if (!c || !M) throw new Error(`no connector “${ref.conn}” on ${ref.obj}`);
  return { o: M4.point(M, c.o), n: V.norm(M4.dir(M, c.n)) };
}
/* world transforms of the copies (the original is not included) */
function patternTransforms(P, R) {
  const p = P.params || {}, out = [];
  if (p.kind === 'circular') {
    const ref = connWorld(R, p.about), axis = V.norm(ref ? ref.n : (p.axis || [0, 0, 1])), c = ref ? ref.o : V.add(p.center || [0, 0, 0], R.originPoint);
    const n = Math.max(1, Math.round(p.count || 1)), total = num(p.angle, 360), step = Math.abs(total) >= 360 - 1e-9 ? total / n : (n > 1 ? total / (n - 1) : 0);
    for (let k = 1; k < n; k++) out.push(M4.mul(M4.translate(c), M4.mul(M4.axisAngle(axis, step * k), M4.translate(V.neg(c)))));
  } else if (p.kind === 'mirror') {
    const ref = connWorld(R, p.about), planeN = { yz: [1, 0, 0], xz: [0, 1, 0], xy: [0, 0, 1] };
    const nn = V.norm(ref ? ref.n : (planeN[p.plane] || p.normal || [1, 0, 0])), c = V.add(ref ? ref.o : R.originPoint, V.mul(nn, num(p.offset, 0)));
    const Rm = [1 - 2 * nn[0] * nn[0], -2 * nn[0] * nn[1], -2 * nn[0] * nn[2], 0, -2 * nn[1] * nn[0], 1 - 2 * nn[1] * nn[1], -2 * nn[1] * nn[2], 0, -2 * nn[2] * nn[0], -2 * nn[2] * nn[1], 1 - 2 * nn[2] * nn[2], 0, 0, 0, 0, 1];
    out.push(M4.mul(M4.translate(c), M4.mul(Rm, M4.translate(V.neg(c)))));
  } else {
    const d1 = V.norm(p.direction || [1, 0, 0]), d2 = V.norm(p.direction2 || [0, 1, 0]);
    const n1 = Math.max(1, Math.round(p.count || 1)), n2 = Math.max(1, Math.round(p.count2 || 1));
    for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) { if (!i && !j) continue; out.push(M4.translate(V.add(V.mul(d1, num(p.spacing, 0) * i), V.mul(d2, num(p.spacing2, 0) * j)))); }
  }
  if (out.length > 400) throw new Error('more than 400 copies — lower the count');
  return out;
}
/* ---------- welds ---------- */
const solidSerial = new WeakMap(); let serialN = 0;
const serialOf = (s) => { let n = solidSerial.get(s); if (!n) solidSerial.set(s, (n = ++serialN)); return n; };
const WELD_CACHE = new Map(), INST_CACHE = new Map();
const rootIdOf = (id, byId) => { let cur = byId.get(id); const seen = new Set(); while (cur && cur.into && byId.has(cur.into) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.into); } return cur ? cur.id : null; };
const sidSet = (s) => new Set(s.polys.map(p => p.sid));
/* the inside-corner edges where two separate bodies meet (found on their union, faces from one body on each side) */
export function findSeams(sa, sb) {
  const U = sa.union(sb), A = sidSet(sa), B = sidSet(sb), out = [], seen = new Set();
  for (const [a, b] of creasesOf(U)) {
    const f = edgeFacesAt(U, V.lerp(a, b, 0.5), V.norm(V.sub(b, a)), a, b); if (f.length < 2) continue;
    const mixed = (A.has(f[0].sid) && B.has(f[1].sid)) || (B.has(f[0].sid) && A.has(f[1].sid)); if (!mixed) continue;
    const key = [f[0].sid, f[1].sid].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
    const e = findEdge(U, { faces: [f[0].sid, f[1].sid], m: V.lerp(a, b, 0.5) }); if (e) out.push(e);
  }
  return { U, seams: out };
}
const WELD_STYLE = { flat: 'chamfer', convex: 'weld', concave: 'fillet' };
/* can these two materials actually be welded? (null = fine / unknown) */
const FERROUS = new Set(['steel', 'stainless', 'cast_iron']), COPPERY = new Set(['copper', 'brass', 'bronze']), THERMOSET = new Set(['resin', 'tough_resin']);
export function weldAdvice(a, b) {
  if (!a || !b || !MATERIALS[a] || !MATERIALS[b]) return null;
  const A = MATERIALS[a], B = MATERIALS[b], fa = A.family, fb = B.family;
  if (fa === 'metal' && fb === 'metal') {
    if (a === b) return a === 'cast_iron' ? 'cast iron welds poorly (pre-heat, nickel rod) — consider brazing or bolting' : null;
    if (FERROUS.has(a) && FERROUS.has(b)) return a === 'cast_iron' || b === 'cast_iron' ? 'cast iron to steel needs pre-heat and nickel filler — brazing or bolting is easier' : `${A.name} to ${B.name} welds with a 309 filler`;
    if ((COPPERY.has(a) || COPPERY.has(b)) && !(a === 'aluminium' || b === 'aluminium')) return `${A.name} to ${B.name}: braze or silver-solder rather than fusion weld`;
    return `${A.name} cannot be fusion-welded to ${B.name} — use fasteners, rivets or a structural adhesive`;
  }
  if (fa === 'plastic' && fb === 'plastic') {
    if (THERMOSET.has(a) || THERMOSET.has(b)) return 'cured resin does not melt, so it cannot be welded — bond it with epoxy or fasten it';
    return a === b ? null : `different plastics (${A.name}, ${B.name}) do not weld to each other — use an adhesive or fasteners`;
  }
  const kind = (m) => (m.family === 'wood' ? 'wood' : m.family === 'metal' ? 'metal' : m.family === 'plastic' ? 'plastic' : m.name.toLowerCase());
  return `a weld cannot join ${kind(A)} (${A.name}) to ${kind(B)} (${B.name}) — use glue, screws or bolts; the joint is still modelled so you can see the bead`;
}
function weldBody(w, R, byId) {
  const [aId, bId] = w.joins, ra = rootIdOf(aId, byId), rb = rootIdOf(bId, byId);
  if (!ra || !rb) return { warning: 'one of the welded parts was deleted' };
  if (ra === rb) return { warning: 'these parts are now one part (a boolean joined them) — a weld joins separate parts' };
  const ba = R.bodies.find(b => b.id === ra), bb = R.bodies.find(b => b.id === rb);
  if (!ba || !bb || ba.solid.isEmpty() || bb.solid.isEmpty()) return { warning: 'a welded part has no geometry' };
  const p = w.params || {}, key = [w.id, JSON.stringify(p), JSON.stringify(w.seam || null), serialOf(ba.solid), serialOf(bb.solid)].join('|');
  const hit = WELD_CACHE.get(key); if (hit) return hit;
  const { U, seams } = findSeams(ba.solid, bb.solid);
  let pick = [];
  if (p.all_around) pick = seams.filter(e => !e.convex);
  else {
    const Wa = R.world.get(ra), ref = w.seam || {}, m = ref.m && Wa ? M4.point(Wa, ref.m) : null;
    let e = ref.faces ? findEdge(U, { faces: ref.faces, m: m || [0, 0, 0] }) : null;
    if (!e && m) { let bd = Infinity; for (const s2 of seams) { const d = V.len(V.sub(s2.m, m)); if (d < bd) { bd = d; e = s2; } } }
    if (e) pick = [e];
  }
  let out;
  if (!pick.length) out = { warning: seams.length ? 'the seam it was on is gone' : 'the parts no longer touch' };
  else if (pick.every(e => e.convex)) out = { warning: 'that edge is an outside edge — a weld goes in the inside corner where the parts meet' };
  else {
    const style = WELD_STYLE[p.profile] || 'chamfer', polys = [];
    for (const e of pick) {
      if (e.convex) continue;
      const piece = e.loop ? K.loopPiece(e.loop, e.closed, e.c, e.axis, e.uu1, e.uu2, num(p.size, 4), style) : K.edgePiece(e.m, e.d, e.u1, e.u2, num(p.size, 4), style, V.len(V.sub(e.b, e.a)), 0);
      polys.push(...piece.tag(w.id).polys);
    }
    out = { solid: new K.Solid(polys), resolved: { seams: pick.length, round: pick.some(e => e.loop), length: +pick.reduce((L, e) => L + (e.loop ? 2 * Math.PI * e.radius : V.len(V.sub(e.b, e.a))), 0).toFixed(2) } };
  }
  WELD_CACHE.set(key, out); if (WELD_CACHE.size > 80) WELD_CACHE.delete(WELD_CACHE.keys().next().value);
  return out;
}
/* world-space connectors of an object */
export function worldConnectors(R, id) {
  const M = id === 'origin' ? M4.ident() : R.world.get(id); if (!M) return [];
  return (id === 'origin' ? ORIGIN_CONNS : (R.conns.get(id) || [])).map(c => ({ name: c.name, kind: c.kind, o: M4.point(M, c.o), n: V.norm(M4.dir(M, c.n)), u: V.norm(M4.dir(M, c.u)) }));
}

/* ---------- edge treatments ---------- */
function pointInPoly3(p, poly, tol) {
  const n = poly.plane.n, vs = poly.v;
  if (Math.abs(V.dot(n, p) - poly.plane.w) > tol) return false;
  for (let i = 0; i < vs.length; i++) { const a = vs[i].p, b = vs[(i + 1) % vs.length].p; if (V.dot(V.cross(V.sub(b, a), V.sub(p, a)), n) < -tol) return false; }
  return true;
}
/* find the straight crease nearest to a reference and the two faces meeting there */
/* the two faces meeting along a crease at m (direction d): outward normals n, in-face directions u pointing away from the edge, surface ids */
/* polygons indexed by the lines their edges lie on (a crease is always made of polygon edges, so only these can touch it) */
const lineIndexCache = new WeakMap(), creaseCache = new WeakMap();
function lineIndex(s) {
  let ix = lineIndexCache.get(s); if (ix) return ix;
  ix = new Map();
  for (const p of s.polys) for (let i = 0; i < p.v.length; i++) {
    const a = p.v[i].p, b = p.v[(i + 1) % p.v.length].p; if (V.len(V.sub(b, a)) < 1e-9) continue;
    const k = K.lineKey(a, b).key; let L = ix.get(k); if (!L) ix.set(k, (L = new Set())); L.add(p);
  }
  lineIndexCache.set(s, ix); return ix;
}
const creasesOf = (s) => { let c = creaseCache.get(s); if (!c) creaseCache.set(s, (c = K.creaseEdges(s))); return c; };
function edgeFacesAt(s, m, d, a, b) {
  const faces = [], cand = a && b ? lineIndex(s).get(K.lineKey(a, b).key) : null;
  for (const p of cand || s.polys) {
    if (Math.abs(V.dot(p.plane.n, m) - p.plane.w) > 1e-3) continue;
    const u = V.norm(V.cross(p.plane.n, d));
    for (const sgn of [1, -1]) { const uu = V.mul(u, sgn), probe = V.add(m, V.mul(uu, 1e-2)); if (pointInPoly3(probe, p, 1e-4)) { if (!faces.some(f => V.len(V.sub(f.n, p.plane.n)) < 1e-3)) faces.push({ n: p.plane.n, u: uu, sid: p.sid }); break; } }
    if (faces.length === 2) break;
  }
  return faces;
}
const segDist = (m, a, b) => { const ab = V.sub(b, a), t = Math.max(0, Math.min(1, V.dot(V.sub(m, a), ab) / (V.dot(ab, ab) || 1))); return V.len(V.sub(m, V.add(a, V.mul(ab, t)))); };
/* Find a straight edge on a finished body.
   ref.faces = the two surface ids it was created between (topological reference: survives size changes);
   otherwise / as a fallback: the crease nearest ref.m (optionally parallel to ref.d) within ref.tol. */
export function findEdge(s, ref) {
  const segs = creasesOf(s); let best = null, bd = Infinity;
  if (ref.faces && ref.faces.length === 2) {
    const want = ref.faces.slice().sort().join('|');
    for (const [a, b] of segs) {
      const ix = lineIndex(s).get(K.lineKey(a, b).key); if (!ix || ![...ix].some(p => ref.faces.includes(p.sid))) continue;
      const d = V.norm(V.sub(b, a)), f = edgeFacesAt(s, V.lerp(a, b, 0.5), d, a, b);
      if (f.length < 2 || [f[0].sid, f[1].sid].sort().join('|') !== want) continue;
      const dist = segDist(ref.m, a, b); if (dist < bd) { bd = dist; best = { a, b, d, faces: f }; }
    }
  }
  if (!best) {
    for (const [a, b] of segs) {
      const d = V.norm(V.sub(b, a)); if (ref.d && V.len(V.cross(d, V.norm(ref.d))) > 0.05) continue;
      const dist = segDist(ref.m, a, b); if (dist < bd) { bd = dist; best = { a, b, d }; }
    }
    if (!best || bd > (ref.tol || 2)) return null;
    best.faces = edgeFacesAt(s, V.lerp(best.a, best.b, 0.5), best.d, best.a, best.b);
  }
  const faces = best.faces; if (faces.length < 2) return null;
  const m = V.lerp(best.a, best.b, 0.5), convex = V.dot(faces[0].u, faces[1].n) < 0;
  const e = { a: best.a, b: best.b, d: best.d, m, u1: faces[0].u, u2: faces[1].u, n1: faces[0].n, n2: faces[1].n, sids: [faces[0].sid, faces[1].sid], convex, angle: Math.acos(Math.max(-1, Math.min(1, V.dot(faces[0].u, faces[1].u)))) * 180 / Math.PI };
  /* a round edge (flat face meets a surface of revolution): treat the whole loop, not one facet */
  const sm = faces.map(f => SMOOTH.test(f.sid));
  if (sm[0] !== sm[1]) {
    const L = edgeLoop(s, segs, e.sids);
    if (L && L.pts.length >= 3) {
      const flat = sm[0] ? faces[1] : faces[0], axis = flat.n, ring = circleFit(L.pts, axis);
      if (ring) {
        const rd = V.norm(V.sub(V.sub(m, ring.c), V.mul(axis, V.dot(V.sub(m, ring.c), axis))));
        const to2 = (u) => [V.dot(u, rd), V.dot(u, axis)];
        Object.assign(e, { loop: L.pts, closed: L.closed, c: ring.c, axis, radius: ring.r, uu1: to2(e.u1), uu2: to2(e.u2) });
      }
    }
  }
  return e;
}
const SMOOTH = /:(side|surface|rev\d+|arc|bore|rim)$/;
/* all crease segments between the same two surfaces, chained into an ordered loop / polyline */
function edgeLoop(s, segs, sids) {
  const want = sids.slice().sort().join('|'), mine = [];
  for (const [a, b] of segs) {
    const ix = lineIndex(s).get(K.lineKey(a, b).key); if (!ix || ![...ix].some(p => sids.includes(p.sid))) continue;
    const f = edgeFacesAt(s, V.lerp(a, b, 0.5), V.norm(V.sub(b, a)), a, b); if (f.length === 2 && [f[0].sid, f[1].sid].sort().join('|') === want) mine.push([a, b]);
  }
  if (!mine.length) return null;
  const key = (p) => p.map(v => Math.round(v * 1e3)).join(','), adj = new Map();
  const link = (p, q) => { const k = key(p); if (!adj.has(k)) adj.set(k, { p, next: [] }); adj.get(k).next.push(q); };
  for (const [a, b] of mine) { link(a, b); link(b, a); }
  /* start at an open end if there is one */
  let start = [...adj.values()].find(n => n.next.length === 1) || adj.values().next().value;
  const pts = [start.p], seen = new Set([key(start.p)]); let cur = start;
  for (;;) { const nx = cur.next.find(q => !seen.has(key(q))); if (!nx) break; pts.push(nx); seen.add(key(nx)); cur = adj.get(key(nx)); if (!cur) break; }
  const closed = pts.length > 2 && cur.next.some(q => key(q) === key(pts[0]));
  return { pts, closed };
}
/* least-squares circle (Kåsa) of points in the plane ⟂ axis */
function circleFit(pts, axis) {
  const e1 = V.norm(Math.abs(axis[0]) < 0.9 ? V.cross(axis, [1, 0, 0]) : V.cross(axis, [0, 1, 0])), e2 = V.cross(axis, e1), o = pts[0];
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sxz = 0, Syz = 0, Sz = 0, h = 0; const n = pts.length;
  for (const p of pts) { const w = V.sub(p, o), x = V.dot(w, e1), y = V.dot(w, e2), z = x * x + y * y; Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y; Sxz += x * z; Syz += y * z; Sz += z; h += V.dot(w, axis); }
  /* solve [Sxx Sxy Sx; Sxy Syy Sy; Sx Sy n]·[D E F] = -[Sxz Syz Sz] */
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], bv = [-Sxz, -Syz, -Sz];
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D0 = det(A); if (Math.abs(D0) < 1e-12) return null;
  const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? bv[i] : v)));
  const D = det(col(0)) / D0, E = det(col(1)) / D0, F = det(col(2)) / D0, cx = -D / 2, cy = -E / 2, r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  return { c: V.add(o, V.add(V.add(V.mul(e1, cx), V.mul(e2, cy)), V.mul(axis, h / n))), r: Math.sqrt(r2) };
}
function applyEdge(s, t, target, R) {
  const M = R.world.get(target.id), ref = t.edge || {};
  const wm = M4.point(M, ref.m || [0, 0, 0]), wd = ref.d ? M4.dir(M, ref.d) : null;
  const e = findEdge(s, { m: wm, d: wd, faces: ref.faces, tol: Math.max(2, (t.params.size || 1) * 1.5) });
  if (!e) { R.warnings.push({ kind: 'edge', id: t.id, text: `${t.name}: its edge can no longer be found` }); return s; }
  const mode = t.params.mode === 'add' || t.params.mode === 'subtract' ? t.params.mode : (e.convex ? 'subtract' : 'add');
  let style = t.params.style || 'fillet';
  if (style === 'weld' && mode === 'subtract') style = 'fillet';
  let piece;
  if (e.loop) {
    if (mode === 'subtract' && t.params.size >= e.radius - 1e-6 && e.uu1[0] < 0 && e.uu2[0] < 0) { R.warnings.push({ kind: 'edge', id: t.id, text: `${t.name}: size ${t.params.size} is too big for a Ø${(e.radius * 2).toFixed(1)} edge` }); return s; }
    piece = K.loopPiece(e.loop, e.closed, e.c, e.axis, e.uu1, e.uu2, t.params.size, style).tag(t.id);
  } else piece = K.edgePiece(e.m, e.d, e.u1, e.u2, t.params.size, style, V.len(V.sub(e.b, e.a)), mode === 'subtract' ? 0.5 : 0).tag(t.id);
  t._resolved = { convex: e.convex, mode, angle: +e.angle.toFixed(2), round: !!e.loop };
  return mode === 'subtract' ? s.subtract(piece) : s.union(piece);
}

/* ---------- metadata & mass properties ---------- */
function cleanMeta(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'material') { const key = String(v).toLowerCase().replace(/[\s-]+/g, '_'); if (!MATERIALS[key]) throw new Error(`Unknown material “${v}”. Try: ${Object.keys(MATERIALS).join(', ')} (or give density in g/cm³)`); out.material = key; }
    else if (k === 'density' || k === 'fill' || k === 'quantity') { const n = +v; if (!(n > 0)) throw new Error(`${k} must be a number above 0`); out[k] = k === 'fill' ? Math.min(1, n > 1 ? n / 100 : n) : n; }
    else out[k] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : (typeof v === 'number' || typeof v === 'boolean' ? v : String(v));
  }
  return out;
}
const MASS_CACHE = new WeakMap();
const massOf = (s) => { let m = MASS_CACHE.get(s); if (!m) MASS_CACHE.set(s, (m = s.massProps())); return m; };
/* per part: material → density → mass, centre of gravity, inertia; then the assembly (parallel-axis sum) and whether it stands */
export function massReport(doc, R) {
  const byId = new Map(doc.objects.map(o => [o.id, o])), O = R.originPoint, parts = [];
  for (const b of R.bodies) {
    if (b.hidden || b.solid.isEmpty()) continue;
    const v = R.virtual && R.virtual.get(b.id), srcId = v ? v.source : b.instance || b.id, src = byId.get(srcId); if (!src) continue;
    let meta = src.meta || {};
    if (src.type === 'weld' && !meta.material && !meta.density) { const base = byId.get(src.joins && src.joins[0]); meta = Object.assign({}, base && base.meta, meta); }
    const matKey = meta.material || doc.material || null, mat = matKey ? MATERIALS[matKey] : null;
    const density = meta.density || (mat ? mat.density : null), fill = meta.fill || 1, mp = massOf(b.solid);
    const rho = density ? density * fill / 1000 : null;   /* g per mm³ */
    parts.push({ id: b.id, name: b.name, source: v ? v.source : b.instance || undefined, weld: b.weld || undefined, material: matKey, material_name: mat ? mat.name : (meta.density ? 'custom' : null), assumed: !meta.material && !meta.density && !!doc.material,
      density, fill: fill < 1 ? fill : undefined, volume_mm3: mp.volume, mass_g: rho == null ? null : mp.volume * rho, centroid: V.sub(mp.centroid, O), inertia_kg_mm2: rho == null ? null : mp.inertia.map(x => x * rho / 1000), meta });
  }
  const known = parts.filter(p => p.mass_g != null), M = known.reduce((t, p) => t + p.mass_g, 0);
  const cog = M > 0 ? V.mul(known.reduce((acc, p) => V.add(acc, V.mul(p.centroid, p.mass_g)), [0, 0, 0]), 1 / M) : null;
  let I = null;
  if (M > 0) {
    I = [0, 0, 0, 0, 0, 0];
    for (const p of known) {
      const d = V.sub(p.centroid, cog), m = p.mass_g / 1000, J = p.inertia_kg_mm2;
      I[0] += J[0] + m * (d[1] * d[1] + d[2] * d[2]); I[1] += J[1] + m * (d[2] * d[2] + d[0] * d[0]); I[2] += J[2] + m * (d[0] * d[0] + d[1] * d[1]);
      I[3] += J[3] - m * d[0] * d[1]; I[4] += J[4] - m * d[1] * d[2]; I[5] += J[5] - m * d[2] * d[0];
    }
  }
  /* balance: is the centre of gravity over the base (the footprint of what touches the lowest level)? */
  let balance = null;
  if (cog && R.bodies.length) {
    let zmin = Infinity; for (const b of R.bodies) if (!b.hidden && !b.solid.isEmpty()) zmin = Math.min(zmin, b.solid.bbox().min[2]);
    const foot = []; for (const b of R.bodies) { if (b.hidden || b.solid.isEmpty()) continue; for (const pl of b.solid.polys) if (pl.plane.n[2] < -0.999 && pl.v.every(q => Math.abs(q.p[2] - zmin) < 1e-3)) for (const q of pl.v) foot.push([q.p[0] - O[0], q.p[1] - O[1]]); }
    if (foot.length >= 3) {
      const hull = hull2(foot), c2 = [cog[0], cog[1]], inside = hull.length >= 3 && hull.every((a, i) => { const b2 = hull[(i + 1) % hull.length]; return (b2[0] - a[0]) * (c2[1] - a[1]) - (b2[1] - a[1]) * (c2[0] - a[0]) >= -1e-9; });
      let margin = Infinity, edgeDir = null;
      for (let i = 0; i < hull.length; i++) { const a = hull[i], b2 = hull[(i + 1) % hull.length], ex = b2[0] - a[0], ey = b2[1] - a[1], L = Math.hypot(ex, ey) || 1, dist = ((c2[0] - a[0]) * ey - (c2[1] - a[1]) * ex) / -L; if (Math.abs(dist) < Math.abs(margin)) { margin = dist; edgeDir = [ey / L, -ex / L]; } }
      balance = { stands: inside, margin_mm: +margin.toFixed(2), tips_toward: inside ? null : (Math.abs(edgeDir[0]) > Math.abs(edgeDir[1]) ? (edgeDir[0] > 0 ? '+x' : '-x') : (edgeDir[1] > 0 ? '+y' : '-y')), base_z: +(zmin - O[2]).toFixed(3) };
    }
  }
  const r = (v, n = 3) => (v == null ? null : +v.toFixed(n));
  return {
    parts: parts.map(p => ({ id: p.id, name: p.name, source: p.source, weld: p.weld, material: p.material, material_name: p.material_name, assumed: p.assumed || undefined, density: p.density, fill: p.fill, volume_cm3: r(p.volume_mm3 / 1000, 3), mass_g: r(p.mass_g, 2), centroid: p.centroid.map(x => r(x)), inertia_kg_mm2: p.inertia_kg_mm2 && p.inertia_kg_mm2.map(x => r(x, 4)), meta: p.meta })),
    total_mass_g: r(M, 2), cog: cog && cog.map(x => r(x)), inertia_kg_mm2: I && I.map(x => r(x, 3)), balance,
    unassigned: parts.filter(p => p.mass_g == null).map(p => p.name)
  };
}
function hull2(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = []; for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up);
}
/* bill of materials: one line per distinct part (pattern copies counted as quantity), welds with their length */
export function bom(doc, R) {
  const rep = massReport(doc, R), byId = new Map(doc.objects.map(o => [o.id, o])), lines = new Map();
  for (const p of rep.parts) {
    const key = p.source || p.id, o = byId.get(key) || {}, meta = o.meta || {};
    let L = lines.get(key);
    if (!L) { L = { item: lines.size + 1, part: (o.name || p.name), part_no: meta.part_no || '', type: o.type === 'weld' ? 'weld' : o.type, material: p.material_name || '', quantity: 0, mass_each_g: p.mass_g, mass_total_g: 0, volume_each_cm3: p.volume_cm3, notes: meta.notes || '', supplier: meta.supplier || '', size: o.type === 'weld' ? `${(o.params || {}).size} mm × ${(o._resolved || {}).length || '?'} mm` : '' }; lines.set(key, L); }
    const q = (meta.quantity || 1); L.quantity += q; L.mass_total_g = +((L.mass_total_g || 0) + (p.mass_g || 0) * q).toFixed(2);
  }
  return { lines: [...lines.values()], total_mass_g: rep.total_mass_g };
}

/* ---------- the API ---------- */
export class Model {
  constructor(doc) { this.doc = doc || newDoc(); this.undoStack = []; this.redoStack = []; this.listeners = new Set(); this.result = null; this.recompute(); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) try { f(this); } catch (e) { console.error(e); } }
  recompute() { const t0 = performance.now(); this.result = evaluate(this.doc); this.solveDims(); this.result.ms = performance.now() - t0; return this.result; }
  /* new features go at the rollback bar when it is up (and the bar moves down past them) */
  insert(ob) {
    const d = this.doc, rb = Number.isInteger(d.rollback) ? Math.min(d.rollback, d.objects.length) : null;
    if (rb == null || rb >= d.objects.length) { d.objects.push(ob); if (rb != null) d.rollback = null; return; }
    d.objects.splice(rb, 0, ob); d.rollback = rb + 1;
  }
  /* order rules: a tool after what it cuts / joins, an edge after its part, a pattern after what it repeats */
  checkOrder() {
    const idx = new Map(this.doc.objects.map((o, i) => [o.id, i]));
    for (const o of this.doc.objects) {
      if (o.into && idx.has(o.into) && idx.get(o.id) < idx.get(o.into)) throw new Error(`${o.name} must come after ${this.get(o.into).name} (it ${o.type === 'edge' ? 'shapes' : o.op === 'add' ? 'joins' : 'cuts'} it)`);
      if (o.type === 'pattern') for (const s2 of o.of || []) if (idx.has(s2) && idx.get(o.id) < idx.get(s2)) throw new Error(`${o.name} must come after ${this.get(s2).name}, which it repeats`);
    }
  }
  /* which end of a dimension moves: the part mated (directly or through a chain) to the other, else the one that is free */
  dimMover(md) {
    const A = this.get(md.a.obj), B = this.get(md.b.obj); if (!A || !B) return null;
    const hangs = (x, y) => { let c = x; const seen = new Set(); while (c && c.mate && !seen.has(c.id)) { if (c.mate.to === y.id) return true; seen.add(c.id); c = this.get(c.mate.to); } return false; };
    const free = (x) => x.id !== this.result.ground && !x.fixed;
    return hangs(B, A) ? B : hangs(A, B) ? A : free(B) ? B : free(A) ? A : null;
  }
  /* driving dimensions are kept true after every change (a part grows → the hole stays 12 from its edge) */
  solveDims() {
    const dims = (this.doc.dims || []).filter(md => md.drive != null);
    for (let pass = 0; pass < 4 && dims.length; pass++) {
      let moved = false;
      for (const md of dims) {
        const cur = measureDim(this.result, md); if (!cur || Math.abs(cur.value - md.drive) < 1e-6) continue;
        const mover = this.dimMover(md); if (!mover || (mover.mate && mover.mate.kind)) continue;
        const pm = mover.id === md.b.obj ? cur.endB : cur.endA, other = mover.id === md.b.obj ? cur.endA : cur.endB;
        const sign = Math.sign(V.dot(V.sub(pm, other), cur.dir)) || 1, move = V.mul(cur.dir, sign * (md.drive - cur.value));
        if (mover.mate) {
          const tc = worldConnectors(this.result, mover.mate.to).find(c => c.name === mover.mate.a); if (!tc) continue;
          const vv = V.cross(tc.n, tc.u), sl = mover.mate.slide || [0, 0];
          mover.mate = Object.assign({}, mover.mate, { slide: [Math.round((sl[0] + V.dot(move, tc.u)) * 1e9) / 1e9, Math.round((sl[1] + V.dot(move, vv)) * 1e9) / 1e9], offset: Math.round(((mover.mate.offset || 0) + V.dot(move, tc.n)) * 1e9) / 1e9 });
        } else { const p0 = mover.pose || { at: [0, 0, 0], rot: [0, 0, 0] }; mover.pose = { at: V.add(p0.at, move), rot: p0.rot }; }
        moved = true;
      }
      if (!moved) break;
      this.result = evaluate(this.doc);
    }
    for (const md of dims) { const cur = measureDim(this.result, md); if (cur && Math.abs(cur.value - md.drive) > 1e-3) this.result.warnings.push({ kind: 'dim', id: md.a.obj, text: `A ${md.drive} dimension can't be held (now ${cur.value.toFixed(2)}) — another dimension or mate fights it` }); }
  }
  get(id) { return this.doc.objects.find(o => o.id === id); }
  /* undo snapshots leave out saved versions (they belong to the document, not to its history) */
  snapshot() { const { versions, ...rest } = this.doc; return JSON.stringify(rest); }
  saveVersion(name) {
    const v = { id: uid('ver'), name: String(name || `Version ${(this.doc.versions || []).length + 1}`), at: Date.now(), json: this.snapshot() };
    this.doc.versions = [...(this.doc.versions || []), v].slice(-30); this.emit(); return { id: v.id, name: v.name, at: v.at };
  }
  listVersions() { return (this.doc.versions || []).map(v => ({ id: v.id, name: v.name, at: v.at, objects: JSON.parse(v.json).objects.length })); }
  restoreVersion(id) {
    const v = (this.doc.versions || []).find(x => x.id === id || x.name === id); if (!v) throw new Error('No version ' + id);
    const before = this.snapshot(), vers = this.doc.versions; this.doc = JSON.parse(v.json); this.doc.versions = vers; this.commit(`Restore “${v.name}”`, before); return { restored: v.name };
  }
  commit(label, before, t0) { this.undoStack.push({ label, json: before }); if (this.undoStack.length > 150) this.undoStack.shift(); this.redoStack = []; this.doc.updated = Date.now(); this.recompute(); if (t0 != null) this.result.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0; this.emit(); }
  undo() { const s = this.undoStack.pop(); if (!s) return false; this.redoStack.push({ label: s.label, json: this.snapshot() }); const vers = this.doc.versions; this.doc = JSON.parse(s.json); if (vers) this.doc.versions = vers; this.recompute(); this.emit(); return s.label; }
  redo() { const s = this.redoStack.pop(); if (!s) return false; this.undoStack.push({ label: s.label, json: this.snapshot() }); const vers = this.doc.versions; this.doc = JSON.parse(s.json); if (vers) this.doc.versions = vers; this.recompute(); this.emit(); return s.label; }
  load(doc) { const before = this.snapshot(); this.doc = doc; this.commit('Open model', before); }
  /* apply a batch of operations atomically (one undo step). Returns per-op results. */
  /* opts.relative: positions (at, near) are measured from the ephemeral world origin, the same frame describe() reports */
  apply(ops, label, opts = {}) {
    const before = this.snapshot(), out = [], t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    this.rel = !!opts.relative;
    try { (Array.isArray(ops) ? ops : [ops]).forEach((op, i) => { try { out.push(this.op(op)); } catch (e) { e.message = `op ${i + 1} (${op && op.op}): ${e.message}`; throw e; } }); }
    catch (e) { const vers = this.doc.versions; this.doc = JSON.parse(before); if (vers) this.doc.versions = vers; this.recompute(); throw e; }
    finally { this.rel = false; }
    this.commit(label || (out.length === 1 ? out[0].label : out.length + ' changes'), before, t0);   /* ms = the whole batch, what the user waited for */
    return out.map(r => { delete r.label; return r; });
  }
  op(o) {
    const d = this.doc, need = (id) => { const x = this.get(id); if (!x) throw new Error('No object “' + id + '”. Objects: ' + (d.objects.map(y => y.id).join(', ') || 'none yet')); return x; };
    const W = (p) => (Array.isArray(p) && this.rel ? V.add(p.map(Number), this.result.originPoint) : p);
    switch (o.op) {
      case 'add': {
        const type = o.type || o.shape; if (!TYPES[type] || META.has(type)) throw new Error('Unknown shape “' + type + '”. Use ' + Object.keys(TYPES).filter(t => !META.has(t)).join(', ') + (type === 'pattern' || type === 'weld' ? ` (for a ${type} use op “${type}”)` : ''));
        const id = o.id && !this.get(o.id) ? String(o.id) : uid(type.slice(0, 3));
        const sp = splitParams(type, o.params);
        const ob = { id, name: o.name || TYPES[type].label + ' ' + (d.objects.filter(x => x.type === type).length + 1), type, params: defaultParams(type, sp.vals), expr: Object.keys(sp.links).length ? sp.links : undefined, pose: { at: W(o.at) || [0, 0, 0], rot: o.rot || [0, 0, 0] }, mate: null, into: null, op: null, color: o.color || null, fixed: !!o.fixed, meta: cleanMeta(Object.assign({}, o.meta || {}, o.material ? { material: o.material } : {})) };
        this.insert(ob);
        if (o.mate) this.op(Object.assign({ op: 'mate', id }, o.mate));
        else if (!o.at && !o.fixed && d.objects.length > 1 && o.stack !== false) {
          /* rapid prototyping default: sit it on top of the ground object */
          const g = this.result.ground && this.get(this.result.ground); if (g) ob.mate = { to: g.id, a: 'top', b: 'bottom', flip: true, offset: 0, angle: 0, slide: [0, 0] };
        }
        if (o.into) this.op({ op: 'boolean', target: o.into, tool: id, mode: o.mode || 'subtract' });
        this.recompute();
        return { label: 'Add ' + ob.name, id, name: ob.name };
      }
      case 'set': {
        const x = need(o.id);
        if (o.params) {
          const sp = splitParams(x.type, o.params);
          x.params = Object.assign({}, x.params, sp.vals);
          for (const k of Object.keys(sp.vals)) { if (typeof TYPES[x.type].params[k] === 'number') x.params[k] = num(+x.params[k], TYPES[x.type].params[k]); if (x.expr) delete x.expr[k]; }   /* a typed number replaces a link */
          if (Object.keys(sp.links).length) x.expr = Object.assign({}, x.expr || {}, sp.links);
          if (x.expr && !Object.keys(x.expr).length) delete x.expr;
        }
        if (o.name) x.name = String(o.name); if (o.color !== undefined) x.color = o.color; if (o.hidden !== undefined) x.hidden = !!o.hidden;
        if (o.meta || o.material !== undefined) { const mm = Object.assign({}, x.meta || {}, o.meta || {}, o.material !== undefined ? { material: o.material } : {}); for (const k of Object.keys(mm)) if (mm[k] === null || mm[k] === '') delete mm[k]; x.meta = cleanMeta(mm); }
        if (o.at || o.rot) { x.pose = { at: W(o.at) || (x.pose || {}).at || [0, 0, 0], rot: o.rot || (x.pose || {}).rot || [0, 0, 0] }; }
        if (o.fixed !== undefined) x.fixed = !!o.fixed;
        this.recompute(); return { label: 'Edit ' + x.name, id: x.id };
      }
      case 'mate': {
        const x = need(o.id); if (o.to !== 'origin') need(o.to);
        if (o.to === x.id) throw new Error('An object cannot mate to itself');
        if (o.kind) {
          /* add-on mate kinds: the add-on works out the placement from both objects (e.g. gears in mesh) */
          const mk = ADDON_MATES.get(o.kind); if (!mk) throw new Error(`Unknown mate kind “${o.kind}”. Available: ${[...ADDON_MATES.keys()].join(', ') || 'none (load an add-on)'}`);
          const extra = Object.assign({}, o); delete extra.op; delete extra.id;
          mk.solve({ self: x, target: need(o.to), mate: extra, api: addonApi });   /* throws a helpful error now rather than a warning later */
          x.mate = extra; this.recompute(); return { label: `Mate ${x.name} (${o.kind})`, id: x.id };
        }
        const tconns = o.to === 'origin' ? ORIGIN_CONNS : (this.result.conns.get(o.to) || connectorsOf(need(o.to), null));
        const sconns = this.result.conns.get(x.id) || (x.type === 'instance' ? this.result.conns.get(x.of) : null) || connectorsOf(x, null);
        const a = o.a || 'top', b = o.b || 'bottom';
        if (!tconns.find(c => c.name === a)) throw new Error(`No connector “${a}” on the target. Try: ${tconns.map(c => c.name).join(', ')}`);
        if (!sconns.find(c => c.name === b)) throw new Error(`No connector “${b}” on ${x.name}. Try: ${sconns.map(c => c.name).join(', ')}`);
        const kindA = tconns.find(c => c.name === a).kind, kindB = sconns.find(c => c.name === b).kind;
        const flip = o.flip != null ? !!o.flip : (kindA === 'face' && kindB === 'face') || (kindA === 'side' && kindB === 'side');
        x.mate = { to: o.to, a, b, flip, offset: num(o.offset, 0), angle: num(o.angle, 0), slide: o.slide || [0, 0] };
        this.recompute(); return { label: 'Mate ' + x.name, id: x.id };
      }
      case 'unmate': { const x = need(o.id); const M = this.result.world.get(x.id); x.mate = null; if (M) x.pose = poseFromMatrix(M); this.recompute(); return { label: 'Unmate ' + x.name, id: x.id }; }
      case 'boolean': {
        const t = need(o.target), tool = need(o.tool); if (t.id === tool.id) throw new Error('Pick two different objects');
        let cur = t; const seen = new Set(); while (cur && cur.into) { if (cur.into === tool.id || seen.has(cur.id)) throw new Error('That would make a loop of booleans'); seen.add(cur.id); cur = this.get(cur.into); }
        tool.into = t.id; tool.op = o.mode === 'add' || o.mode === 'union' ? 'add' : o.mode === 'intersect' ? 'intersect' : 'subtract';
        /* keep history order: tools after their target */
        const ti = d.objects.indexOf(t), xi = d.objects.indexOf(tool); if (xi < ti) { d.objects.splice(xi, 1); d.objects.splice(d.objects.indexOf(t) + 1, 0, tool); }
        this.recompute(); return { label: (tool.op === 'add' ? 'Union ' : tool.op === 'intersect' ? 'Intersect ' : 'Subtract ') + tool.name, id: tool.id };
      }
      case 'separate': { const x = need(o.id); x.into = null; x.op = null; this.recompute(); return { label: 'Separate ' + x.name, id: x.id }; }
      case 'edge': {
        const t = need(o.target), M = this.result.world.get(t.id); if (!M) throw new Error('Target has no geometry');
        const body = this.bodyContaining(t.id); if (!body) throw new Error('Target body not found');
        const near = W(o.near || (o.m ? o.m : null)); if (!near) throw new Error('Give near:[x,y,z] (a point on the edge)');
        const e = findEdge(body.solid, { m: near, d: o.d || null, tol: o.tol || 5 }); if (!e) throw new Error('No straight edge between two flat faces near that point');
        const Mi = M4.inv(this.result.world.get(body.id));
        const id = o.id && !this.get(o.id) ? String(o.id) : uid('edg'), style = ['fillet', 'weld', 'chamfer'].includes(o.style) ? o.style : 'fillet';
        this.insert({ id, name: o.name || (style === 'chamfer' ? 'Chamfer' : style === 'weld' ? 'Weld' : 'Fillet') + ' ' + (d.objects.filter(x => x.type === 'edge').length + 1), type: 'edge', params: { style, size: num(o.size, 4), mode: o.mode || 'auto' }, edge: { m: M4.point(Mi, e.m), d: M4.dir(Mi, e.d), faces: e.sids }, into: body.id, op: 'edge', pose: null, mate: null });
        this.recompute();
        return { label: (style === 'chamfer' ? 'Chamfer' : style === 'weld' ? 'Weld' : 'Fillet') + ' edge', id, convex: e.convex, angle: +e.angle.toFixed(2), mode: o.mode || (e.convex ? 'subtract' : 'add'), round: e.loop ? { diameter: +(e.radius * 2).toFixed(3), closed: e.closed } : undefined };
      }
      case 'extrude': case 'loft': case 'revolve': case 'sweep': {
        const params = {}; for (const k of Object.keys(TYPES[o.op].params)) if (o[k] !== undefined) params[k] = o[k];
        if (o.params) Object.assign(params, o.params);
        const add = { op: 'add', type: o.op, id: o.id, name: o.name, params, at: o.at, rot: o.rot, mate: o.mate, into: o.into, mode: o.mode, color: o.color, fixed: o.fixed, stack: false };
        /* sketch on a face: the feature starts on that face and follows it */
        if (o.face && o.face.obj) add.mate = { to: o.face.obj, a: o.face.conn || 'top', b: o.op === 'revolve' ? 'bottom' : 'start', flip: o.op !== 'revolve', offset: 0 };
        return this.op(add);
      }
      case 'pattern': {
        const of = (Array.isArray(o.of) ? o.of : [o.of || o.source]).filter(Boolean); if (!of.length) throw new Error('Give of: the id (or ids) of the features to repeat');
        for (const id of of) { const x = need(id); if (x.type === 'pattern' || x.type === 'weld') throw new Error(`${x.name} is a ${x.type}; pattern the parts or features it uses instead`); }
        /* a hole's countersink / an edge on a patterned part comes along by default */
        if (o.include_edges !== false) for (const e of d.objects) if (e.type === 'edge' && !of.includes(e.id) && e.edge && (e.edge.faces || []).some(f => of.includes(f.split(':')[0]))) of.push(e.id);
        const params = defaultParams('pattern', o.params); for (const k of Object.keys(TYPES.pattern.params)) if (o[k] !== undefined) params[k] = o[k];
        if (!['linear', 'circular', 'mirror'].includes(params.kind)) throw new Error('kind is linear, circular or mirror');
        if (params.about && params.about.obj && params.about.obj !== 'origin') need(params.about.obj);
        const id = o.id && !this.get(o.id) ? String(o.id) : uid('pat');
        this.insert({ id, name: o.name || (params.kind === 'mirror' ? 'Mirror ' : params.kind === 'circular' ? 'Circular array ' : 'Array ') + (d.objects.filter(x => x.type === 'pattern').length + 1), type: 'pattern', params, of, pose: null, mate: null, into: null, op: null });
        this.recompute();
        const copies = [...this.result.virtual.values()].filter(v => v.pattern === id).length;
        return { label: 'Pattern ' + of.map(i => this.get(i).name).join(', '), id, of, copies };
      }
      case 'weld': {
        const A = need(o.a), B = need(o.b); if (A.id === B.id) throw new Error('A weld joins two different parts');
        const ba = this.bodyContaining(A.id), bb = this.bodyContaining(B.id);
        if (!ba || !bb) throw new Error('Both parts need geometry');
        if (ba.id === bb.id) throw new Error(`${A.name} and ${B.name} are one part already (a boolean merged them). A weld joins separate parts; to blend one part use an edge fillet or chamfer`);
        const { seams } = findSeams(ba.solid, bb.solid), concave = seams.filter(e => !e.convex);
        if (!concave.length) throw new Error(`${A.name} and ${B.name} do not meet in an inside corner — mate them so they touch first`);
        let e = null; const near = W(o.near);
        if (near) { let bd = Infinity; for (const c of concave) { const dd = c.loop ? Math.min(...c.loop.map(q => V.len(V.sub(q, near)))) : segDist(near, c.a, c.b); if (dd < bd) { bd = dd; e = c; } } }
        else e = concave.reduce((b2, c) => ((c.loop ? 2 * Math.PI * c.radius : V.len(V.sub(c.b, c.a))) > (b2.loop ? 2 * Math.PI * b2.radius : V.len(V.sub(b2.b, b2.a))) ? c : b2));
        const Wa = this.result.world.get(ba.id), id = o.id && !this.get(o.id) ? String(o.id) : uid('wld');
        const params = defaultParams('weld', o.params); for (const k of ['size', 'profile', 'all_around']) if (o[k] !== undefined) params[k] = o[k];
        this.insert({ id, name: o.name || 'Weld ' + (d.objects.filter(x => x.type === 'weld').length + 1), type: 'weld', params, joins: [A.id, B.id], seam: { m: M4.point(M4.inv(Wa), e.m), faces: e.sids }, color: o.color || null, pose: null, mate: null, into: null, op: null });
        this.recompute();
        const r = this.get(id)._resolved || {};
        const mat = (x) => (x.meta && x.meta.material) || d.material || null, advice = weldAdvice(mat(this.get(ba.id) || A), mat(this.get(bb.id) || B));
        return { label: `Weld ${A.name} to ${B.name}`, id, seams: r.seams || 0, length: r.length || 0, round: !!r.round, other_seams: concave.length - 1, material_advice: advice || undefined };
      }
      case 'addon': {
        const a = ADDONS.get(o.addon); if (!a) throw new Error(`No add-on “${o.addon}”. Loaded: ${[...ADDONS.keys()].join(', ') || 'none'}`);
        const act = (a.actions || {})[o.action]; if (!act) throw new Error(`Add-on ${a.id} has no action “${o.action}”. Try: ${Object.keys(a.actions || {}).join(', ')}`);
        const args = Object.assign({}, ...Object.entries(act.args || {}).map(([k, v]) => ({ [k]: v && v.default !== undefined ? JSON.parse(JSON.stringify(v.default)) : undefined })), o.args || {});
        const res = act.run(args, this.addonContext()) || {};
        const results = (res.ops || []).map(x => this.op(x));
        return { label: res.label || `${a.name || a.id}: ${o.action}`, info: res.info, results };
      }
      case 'delete': {
        const x = need(o.id), xi = d.objects.indexOf(x); d.objects = d.objects.filter(y => y.id !== x.id);
        if (Number.isInteger(d.rollback) && xi < d.rollback) d.rollback = Math.max(0, d.rollback - 1);
        for (const y of d.objects) { if (y.into === x.id && y.type === 'edge') y.into = '__deleted__'; }
        if (d.ground === x.id) d.ground = null; if (d.origin && d.origin.obj === x.id) d.origin = null;
        if (x.type === 'mesh' && d.meshes && !d.objects.some(y => y.type === 'mesh' && (y.params.ref || y.id) === (x.params.ref || x.id))) { d.meshes = Object.assign({}, d.meshes); delete d.meshes[x.params.ref || x.id]; }
        this.recompute(); return { label: 'Delete ' + x.name, id: x.id };
      }
      case 'origin': { if (o.obj) need(o.obj); d.origin = o.obj ? { obj: o.obj, conn: o.conn || 'bottom' } : null; this.recompute(); return { label: 'Set world origin', origin: d.origin }; }
      case 'ground': { const x = need(o.id); d.ground = x.id; if (x.mate) this.op({ op: 'unmate', id: x.id }); this.recompute(); return { label: 'Ground ' + x.name, id: x.id }; }
      case 'fix': { const x = need(o.id); const M = this.result.world.get(x.id); if (M) x.pose = poseFromMatrix(M); x.mate = null; x.fixed = true; this.recompute(); return { label: 'Fix ' + x.name + ' in place', id: x.id }; }
      case 'cleanup': {
        let n = 0; const ids = new Set(d.objects.map(y => y.id));
        d.objects = d.objects.filter(y => { if (y.type === 'edge' && !ids.has(y.into)) { n++; return false; } return true; });
        for (const y of d.objects) {
          if (y.into && !ids.has(y.into)) { y.into = null; y.op = null; n++; }
          if (y.mate && y.mate.to !== 'origin' && !ids.has(y.mate.to)) { const M = this.result.world.get(y.id); y.mate = null; if (M) y.pose = poseFromMatrix(M); y.fixed = true; n++; }
        }
        const dimsBefore = (d.dims || []).length; d.dims = (d.dims || []).filter(md => ids.has(md.a.obj) && ids.has(md.b.obj)); n += dimsBefore - d.dims.length;
        d.objects = d.objects.filter(y => { if (y.type === 'pattern') { y.of = (y.of || []).filter(i => ids.has(i)); if (!y.of.length) { n++; return false; } } if (y.type === 'weld' && !(y.joins || []).every(i => ids.has(i))) { n++; return false; } return true; });
        for (const w of this.result.warnings) if (w.kind === 'floating') { const y = this.get(w.id); if (y && o.fixFloating) { const M = this.result.world.get(y.id); if (M) y.pose = poseFromMatrix(M); y.fixed = true; n++; } }
        this.recompute(); return { label: 'Clean up (' + n + ' fixes)', fixes: n };
      }
      case 'dim': {
        const id = uid('dim'), md = { id, a: o.a, b: o.b, view: o.view || 'front', axis: o.axis || null };
        if (!md.a || !md.b || !md.a.obj || !md.b.obj) throw new Error('A dimension needs a:{obj, conn} and b:{obj, conn}');
        for (const r of [md.a, md.b]) if (!worldConnectors(this.result, r.obj).some(c => c.name === r.conn)) throw new Error(`No connector “${r.conn}” on ${r.obj}`);
        if (!md.axis) { const ca = worldConnectors(this.result, md.a.obj).find(c => c.name === md.a.conn), cb = worldConnectors(this.result, md.b.obj).find(c => c.name === md.b.conn), Bv = VIEW_AXES[md.view] || VIEW_AXES.front;
          const faceIn = (c) => (c.kind === 'face' && Math.abs(V.dot(c.n, Bv.f)) < 0.2) || (c.kind === 'edge' && Math.abs(V.dot(c.n, Bv.f)) < 0.2);
          if (faceIn(ca) !== faceIn(cb)) md.axis = 'normal';
          else { const dl = V.sub(cb.o, ca.o); md.axis = Math.abs(V.dot(dl, Bv.r)) >= Math.abs(V.dot(dl, Bv.u)) ? 'h' : 'v'; } }
        (d.dims = d.dims || []).push(md);
        const m = measureDim(this.result, md);
        return { label: 'Add dimension', id, axis: md.axis, value: m ? +m.value.toFixed(4) : null };
      }
      case 'dimaxis': { const md = (d.dims || []).find(x => x.id === o.id); if (!md) throw new Error('No dimension ' + o.id); md.axis = o.axis; return { label: 'Dimension ' + o.axis, id: o.id }; }
      case 'setdim': {
        /* a driving dimension: it keeps the part that hangs off the other at this distance, from now on */
        const md = (d.dims || []).find(x => x.id === o.id); if (!md) throw new Error('No dimension ' + o.id);
        if (o.value === null) { delete md.drive; return { label: 'Dimension is a reference again', id: o.id }; }
        const value = +o.value; if (!(value >= 0)) throw new Error('A distance must be 0 or more');
        const mover = this.dimMover(md); if (!mover) throw new Error('Neither end can move (both are fixed, the ground, or pattern copies)');
        if (mover.mate && mover.mate.kind) throw new Error(`${mover.name} is placed by a ${mover.mate.kind} mate — change that instead`);
        md.drive = value; this.recompute();
        const after = measureDim(this.result, md), other = this.get(mover.id === md.b.obj ? md.a.obj : md.b.obj);
        return { label: `${mover.name}: ${+value.toFixed(3)} from ${other ? other.name : 'it'}`, id: o.id, moved: mover.id, value: after ? +after.value.toFixed(4) : null };
      }
      case 'joint': {
        /* make a mate a moving joint: {id, joint: fixed|revolute|slider|cylindrical|planar, axis: n|u|v (slider), limits: {angle:[lo,hi], travel:[..], offset, u, v}} */
        const x = need(o.id); if (!x.mate) throw new Error(`${x.name} is not mated: mate it first, then make the mate a joint`);
        if (x.mate.kind) throw new Error(`${x.name} is placed by a ${x.mate.kind} mate; make its partner a joint instead and it will follow`);
        const j = o.joint || 'revolute'; if (j !== 'fixed' && !JOINTS[j]) throw new Error(`joint is one of fixed, ${Object.keys(JOINTS).join(', ')}`);
        x.mate = Object.assign({}, x.mate); if (j === 'fixed') { delete x.mate.joint; delete x.mate.limits; delete x.mate.axis; }
        else { x.mate.joint = j; if (o.axis) x.mate.axis = o.axis; else if (j === 'slider' && !x.mate.axis) x.mate.axis = 'n'; if (o.limits !== undefined) x.mate.limits = o.limits || undefined; }
        this.recompute(); return { label: `${x.name}: ${j} joint`, id: x.id, joints: jointsOf(d).find(q => q.id === x.id) };
      }
      case 'drive': {
        /* set joint values: {values: {id: {angle: 30}} } or {id, key, value} */
        const vals = o.values || { [o.id]: { [o.key || 'angle']: o.value } };
        for (const [id, kv] of Object.entries(vals)) { const x = need(id); if (!x.mate || !x.mate.joint) throw new Error(`${x.name} is not a joint`); x.mate = Object.assign({}, x.mate); for (const [k, v] of Object.entries(kv)) { const lim = (x.mate.limits || {})[k]; dofSet(x.mate, k, lim ? Math.max(lim[0], Math.min(lim[1], +v)) : +v); } }
        this.recompute(); return { label: 'Move joints', joints: jointsOf(d) };
      }
      case 'hole': {
        /* {target, at:[x,y,z] on a face (origin-relative), normal?, size, kind, fit, through, depth, dims:true} */
        const t = need(o.target), body = this.bodyContaining(t.id); if (!body) throw new Error('That part has no geometry');
        const root = this.get(body.id), at = W(o.at); if (!at) throw new Error('Give at:[x,y,z], a point on the face');
        let n = o.normal ? V.norm(o.normal) : null;
        const faces = worldConnectors(this.result, root.id).filter(c => c.kind === 'face');
        if (!n) { let bd = Infinity; for (const c of faces) { const dd = Math.abs(V.dot(V.sub(at, c.o), c.n)); if (dd < bd) { bd = dd; n = c.n; } } }
        const face = faces.filter(c => V.dot(c.n, n) > 0.999).sort((a, b) => Math.abs(V.dot(V.sub(at, a.o), a.n)) - Math.abs(V.dot(V.sub(at, b.o), b.n)))[0];
        /* through unless a depth is given (an insert is blind by default) */
        const through = o.through !== undefined ? !!o.through : !(+o.depth > 0) && o.kind !== 'insert';
        const params = { size: o.size || 'M6', kind: o.kind || 'simple', fit: o.fit || 'normal', through, depth: +o.depth || 12, diameter: +o.diameter || 0 };
        holeSpec(params);
        const id = o.id && !this.get(o.id) ? String(o.id) : uid('hol'), add = { op: 'add', type: 'hole', id, name: o.name || `${params.size} ${params.kind === 'simple' ? 'hole' : params.kind}`, params, into: root.id, mode: 'subtract', stack: false };
        if (face) { const d0 = V.sub(at, face.o), vv = V.cross(face.n, face.u); add.mate = { to: root.id, a: face.name, b: 'top', flip: false, slide: [+V.dot(d0, face.u).toFixed(4), +V.dot(d0, vv).toFixed(4)] }; }
        else { const fr = M4.frame(at, Math.abs(n[2]) < 0.9 ? V.cross([0, 0, 1], n) : [1, 0, 0], n); const pose = poseFromMatrix(fr); add.at = this.rel ? V.sub(pose.at, this.result.originPoint) : pose.at; add.rot = pose.rot; add.fixed = true; }
        const r = this.op(add), out = { label: `${add.name} in ${root.name}`, id: r.id, on: face ? face.name : 'free', spec: holeSpec(params).label };
        /* dimension it from the two nearest edges (driving), like a hole wizard's placement sketch */
        if (o.dims !== false && face) {
          const view = Math.abs(face.n[2]) > 0.9 ? 'top' : Math.abs(face.n[1]) > 0.9 ? 'front' : 'right';
          const side = faces.filter(c => Math.abs(V.dot(c.n, face.n)) < 0.01), picks = [];
          for (const ax of [face.u, V.cross(face.n, face.u)]) { const c2 = side.filter(c => Math.abs(V.dot(c.n, ax)) > 0.99).sort((a, b) => Math.abs(V.dot(V.sub(at, a.o), a.n)) - Math.abs(V.dot(V.sub(at, b.o), b.n)))[0]; if (c2) picks.push(c2); }
          out.dims = [];
          for (const c2 of picks) { const dr = this.op({ op: 'dim', a: { obj: r.id, conn: 'top' }, b: { obj: root.id, conn: c2.name }, view, axis: 'normal' }); if (dr.value != null) { this.op({ op: 'setdim', id: dr.id, value: Math.round(dr.value * 2) / 2 }); out.dims.push({ id: dr.id, from: c2.name, value: Math.round(dr.value * 2) / 2 }); } }
        }
        return out;
      }
      case 'shell': {
        const t = need(o.target), root = this.get((this.bodyContaining(t.id) || {}).id || t.id);
        shellCavity(root, { thickness: o.thickness, open: o.open });
        const id = o.id && !this.get(o.id) ? String(o.id) : uid('shl');
        this.insert({ id, name: o.name || `Shell ${o.thickness}`, type: 'shell', params: { thickness: +o.thickness, open: o.open || 'none' }, into: root.id, op: 'shell', pose: null, mate: null });
        this.recompute(); return { label: `Shell ${root.name} (${o.thickness} mm walls${o.open && o.open !== 'none' ? ', open ' + o.open : ''})`, id };
      }
      case 'config': {
        /* configurations: named tables of variable values (and features to switch off): {action: add|set|activate|delete|rename, name, vars, suppress, to} */
        d.configs = (d.configs || []).map(c => Object.assign({}, c));
        const act = o.action || 'activate', c = d.configs.find(x => x.name === o.name);
        if (act === 'add') { if (!o.name) throw new Error('Give the configuration a name'); if (c) throw new Error(`“${o.name}” exists`); d.configs.push({ name: String(o.name), vars: Object.assign({}, o.vars || {}), suppress: (o.suppress || []).slice() }); if (o.activate !== false) d.config = String(o.name); }
        else if (act === 'set') { if (!c) throw new Error(`No configuration “${o.name}”`); if (o.vars) { c.vars = Object.assign({}, c.vars || {}, o.vars); for (const [k, v] of Object.entries(c.vars)) if (v === null || v === '') delete c.vars[k]; } if (o.suppress) c.suppress = o.suppress.slice(); }
        else if (act === 'activate') { if (o.name && !c) throw new Error(`No configuration “${o.name}”. Have: ${d.configs.map(x => x.name).join(', ') || 'none'}`); d.config = o.name || null; }
        else if (act === 'delete') { d.configs = d.configs.filter(x => x.name !== o.name); if (d.config === o.name) d.config = null; }
        else if (act === 'rename') { if (!c) throw new Error(`No configuration “${o.name}”`); c.name = String(o.to); if (d.config === o.name) d.config = c.name; }
        else throw new Error('action is add, set, activate, delete or rename');
        this.recompute(); return { label: act === 'activate' ? `Configuration: ${d.config || 'Default'}` : `Configuration ${o.name}: ${act}`, configs: d.configs.map(x => x.name), active: d.config || null };
      }
      case 'instance': {
        /* a linked copy: edits to the source part show in every instance */
        const src = need(o.of); if (src.into || META.has(src.type) || src.type === 'instance') throw new Error('Instance a whole part (not a tool, an edge or another instance)');
        const id = o.id && !this.get(o.id) ? String(o.id) : uid('ins'), n = d.objects.filter(x => x.type === 'instance' && x.of === src.id).length + 2;
        const ob = { id, name: o.name || `${src.name} #${n}`, type: 'instance', of: src.id, params: {}, pose: { at: W(o.at) || [0, 0, 0], rot: o.rot || [0, 0, 0] }, mate: null, into: null, op: null, color: o.color || null, fixed: !!o.fixed };
        this.insert(ob); this.recompute();
        if (o.mate) this.op(Object.assign({ op: 'mate', id }, o.mate));
        else if (!o.at && src.mate && !src.mate.kind) { const step = o.offset || [Math.max(10, ((src.params || {}).width || (src.params || {}).diameter || 20) + 10) * (n - 1), 0]; ob.mate = Object.assign({}, src.mate, { slide: [(src.mate.slide || [0, 0])[0] + step[0], (src.mate.slide || [0, 0])[1] + step[1]] }); delete ob.mate.joint; }
        else if (!o.at) { const Ws = this.result.world.get(src.id); if (Ws) { const pz = poseFromMatrix(M4.mul(M4.translate([((src.params || {}).width || 30) + 10, 0, 0]), Ws)); ob.pose = pz; ob.fixed = true; } }
        this.recompute(); return { label: `Instance of ${src.name}`, id, name: ob.name };
      }
      case 'import': {
        /* {name, triangles: base64 Float32 (xyz per vertex) | data: file text, format, scale} → a mesh part */
        let tri = o.triangles, count = o.count, size = null;
        if (!tri && o.data) { const parsed = parseMesh(o.name || ('mesh.' + (o.format || 'stl')), o.data); tri = encodeTriangles(parsed.triangles); count = parsed.count; size = parsed.size; }
        if (!tri) throw new Error('Give triangles (base64) or data (file text)');
        const id = o.id && !this.get(o.id) ? String(o.id) : uid('msh');
        d.meshes = Object.assign({}, d.meshes || {}, { [id]: { b64: tri, tris: count || null, name: o.name || null } });
        const r = this.op({ op: 'add', type: 'mesh', id, name: (o.name || 'Mesh').replace(/\.(stl|obj)$/i, ''), params: { scale: +o.scale || 1, ref: id }, mate: o.mate, at: o.at, material: o.material });
        return { label: `Import ${o.name || 'mesh'}`, id: r.id, triangles: count, size };
      }
      case 'suppress': {
        const ids = Array.isArray(o.id) ? o.id : [o.id], items = ids.map(need), on = o.on != null ? !!o.on : !items[0].suppressed;
        for (const x of items) { if (on) x.suppressed = true; else delete x.suppressed; }
        this.recompute(); return { label: `${on ? 'Suppress' : 'Unsuppress'} ${items.map(x => x.name).join(', ')}`, ids, suppressed: on };
      }
      case 'rollback': {
        /* to: index (features before it stay active), an id (roll back to just after it), or null (roll to the end) */
        let to = o.to;
        if (typeof to === 'string') { const i = d.objects.findIndex(x => x.id === to); if (i < 0) throw new Error('No object ' + to); to = i + 1; }
        d.rollback = to == null || to >= d.objects.length ? null : Math.max(0, Math.round(to));
        this.recompute(); return { label: d.rollback == null ? 'Roll to the end' : `Roll back to ${d.rollback ? d.objects[d.rollback - 1].name : 'the start'}`, rollback: d.rollback };
      }
      case 'move': {
        const x = need(o.id), from = d.objects.indexOf(x);
        let to = o.to != null ? Math.round(o.to) : o.before ? d.objects.findIndex(y => y.id === o.before) : o.after ? d.objects.findIndex(y => y.id === o.after) + 1 : -1;
        if (to < 0 || to > d.objects.length) throw new Error('Give to (index), before or after');
        d.objects.splice(from, 1); if (to > from) to--; d.objects.splice(to, 0, x);
        this.checkOrder(); this.recompute(); return { label: `Move ${x.name}`, id: x.id, index: to };
      }
      case 'duplicate': {
        /* a copy of a part with everything that shapes it (tools, edges), placed next to the original */
        const x = need(o.id); if (['edge', 'weld', 'pattern'].includes(x.type)) throw new Error('Duplicate the part, not its ' + x.type);
        const sub = []; const walk = (id) => { for (const y of d.objects) if (y.into === id && !sub.includes(y)) { sub.push(y); walk(y.id); } }; walk(x.id);
        const map = new Map([[x.id, uid(x.type.slice(0, 3))], ...sub.map(y => [y.id, uid(y.type.slice(0, 3))])]);
        const copy = (y) => {
          const c = JSON.parse(JSON.stringify(y)); c.id = map.get(y.id); delete c._resolved;
          if (y === x) { c.name = (o.name || y.name + ' copy'); c.into = x.into; }
          else { c.name = y.name; c.into = map.get(y.into) || y.into; }
          if (c.mate && map.has(c.mate.to)) c.mate.to = map.get(c.mate.to);
          if (c.edge && c.edge.faces) c.edge.faces = c.edge.faces.map(f => { const i = f.indexOf(':'), pre = f.slice(0, i); return map.has(pre) ? map.get(pre) + f.slice(i) : f; });
          return c;
        };
        const top = copy(x), step = o.offset || [Math.max(10, ((x.params || {}).width || (x.params || {}).diameter || 20) + 10), 0];
        if (top.mate && !top.mate.kind) top.mate.slide = [(top.mate.slide || [0, 0])[0] + step[0], (top.mate.slide || [0, 0])[1] + step[1]];
        else if (!top.mate) { const p0 = top.pose || { at: [0, 0, 0], rot: [0, 0, 0] }; top.pose = { at: V.add(p0.at, [step[0], step[1], 0]), rot: p0.rot }; }
        this.insert(top); for (const y of sub) this.insert(copy(y));
        this.recompute(); return { label: `Duplicate ${x.name}`, id: top.id, name: top.name };
      }
      case 'var': {
        const name = String(o.name || '').replace(/^#/, ''); if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error('A variable name is letters, digits and _ (e.g. wall)');
        d.vars = Object.assign({}, d.vars || {});
        if (o.value === null || o.value === undefined || o.value === '') delete d.vars[name];
        else { if (typeof o.value === 'string' && !/^\s*=/.test(o.value) && isFinite(+o.value)) d.vars[name] = +o.value; else if (typeof o.value === 'string') { parseExpr(o.value); d.vars[name] = o.value.trim().startsWith('=') ? o.value.trim() : '=' + o.value.trim(); } else d.vars[name] = +o.value; }
        this.recompute(); return { label: `#${name} = ${d.vars[name] ?? '(removed)'}`, name, value: d.vars[name] };
      }
      case 'link': {
        /* follower.param = leader.param (× factor + offset) */
        const x = need(o.id); if (!o.param) throw new Error('Give param');
        const src = o.to && o.to.obj ? `=${o.to.obj}.${o.to.param || o.param}` : o.expr; if (!src) throw new Error('Give to:{obj, param} or expr');
        let ex = src.trim().startsWith('=') ? src.trim() : '=' + src.trim();
        if (o.factor != null && +o.factor !== 1) ex += ` * ${+o.factor}`; if (o.offset) ex += ` ${+o.offset < 0 ? '-' : '+'} ${Math.abs(+o.offset)}`;
        return this.op({ op: 'set', id: x.id, params: { [o.param]: ex } }) && { label: `${x.name}.${o.param} follows ${ex.slice(1)}`, id: x.id, expr: ex };
      }
      case 'unlink': { const x = need(o.id); if (x.expr) { delete x.expr[o.param]; if (!Object.keys(x.expr).length) delete x.expr; } this.recompute(); return { label: `${x.name}.${o.param} unlinked`, id: x.id }; }
      case 'undim': { d.dims = d.dims.filter(x => x.id !== o.id); return { label: 'Remove dimension', id: o.id }; }
      case 'rename': { d.name = String(o.name || d.name); return { label: 'Rename model', name: d.name }; }
      case 'material': {   /* the model's default material, used by parts that have none of their own */
        if (o.material && !MATERIALS[o.material]) throw new Error(`Unknown material “${o.material}”. Try: ${Object.keys(MATERIALS).join(', ')}`);
        d.material = o.material || null; return { label: 'Default material ' + (o.material ? MATERIALS[o.material].name : 'none'), material: d.material };
      }
    }
    throw new Error('Unknown op “' + o.op + '”');
  }
  bodyContaining(id) {
    let cur = this.get(id); const seen = new Set();
    while (cur && cur.into && !seen.has(cur.id)) { seen.add(cur.id); cur = this.get(cur.into); }
    return cur ? this.result.bodies.find(b => b.id === cur.id) : null;
  }
  /* the object a picked body / id stands for: pattern copies resolve to their pattern */
  resolveId(id) { if (!id || this.get(id)) return id; const v = this.result.virtual && this.result.virtual.get(id); return v ? v.pattern : null; }
  /* what add-on actions see: read access plus small helpers (they return ops; they never edit the document directly) */
  addonContext() {
    const self = this;
    return { api: addonApi, get doc() { return self.doc; }, get result() { return self.result; }, get: (id) => self.get(id), describe: () => self.describe(), uid, ground: () => self.result.ground,
      newId: (prefix) => { let i = 1; while (self.get(prefix + i)) i++; return prefix + i; } };
  }
  /* summary for the AI and the tree */
  describe() {
    const R = this.result;
    return {
      name: this.doc.name, units: this.doc.units, ground: R.ground, origin: R.originRef, origin_point: R.originPoint.map(v => +v.toFixed(3)),
      objects: this.doc.objects.map(o => {
        const M = R.world.get(o.id), at = M ? [M[12], M[13], M[14]].map((v, k) => +(v - R.originPoint[k]).toFixed(3)) : null;
        const T = TYPES[o.type], info = T && T.def && T.def.info ? (() => { try { return T.def.info(o.params, addonApi); } catch (e) { return undefined; } })() : undefined;
        return { id: o.id, name: o.name, type: o.type, addon: T && T.addon, params: o.params, info, at: META.has(o.type) ? undefined : at, mate: o.mate, boolean: o.into ? { into: o.into, mode: o.op } : null, fixed: !!o.fixed, resolved: o._resolved,
          suppressed: o.suppressed || undefined, rolled_back: R.off && R.off.has(o.id) && !o.suppressed ? true : undefined,
          of: o.of, joins: o.joins, meta: o.meta && Object.keys(o.meta).length ? o.meta : undefined, links: o.expr && Object.keys(o.expr).length ? o.expr : undefined,
          copies: o.type === 'pattern' ? [...R.virtual.values()].filter(v => v.pattern === o.id).length : undefined,
          connectors: META.has(o.type) ? undefined : (R.conns.get(o.id) || []).map(c => c.name) };
      }),
      bodies: R.bodies.map(b => ({ id: b.id, name: b.name, weld: b.weld || undefined, copy_of: b.virtual || undefined, volume: +b.solid.volume().toFixed(3), bbox: (() => { const bb = b.solid.bbox(); return b.solid.isEmpty() ? null : { min: bb.min.map((v, k) => +(v - R.originPoint[k]).toFixed(3)), max: bb.max.map((v, k) => +(v - R.originPoint[k]).toFixed(3)) }; })() })),
      assembly: R.bodies.length > 1 ? { parts: R.bodies.filter(b => !b.weld).length, welds: R.bodies.filter(b => b.weld).length } : undefined,
      material: this.doc.material || null,
      vars: this.doc.vars && Object.keys(this.doc.vars).length ? this.doc.vars : undefined,
      rollback: Number.isInteger(this.doc.rollback) ? this.doc.rollback : undefined,
      configurations: (this.doc.configs || []).length ? { active: this.doc.config || 'Default', list: this.doc.configs.map(c => ({ name: c.name, vars: c.vars, suppress: c.suppress && c.suppress.length ? c.suppress : undefined })) } : undefined,
      joints: (() => { const j = jointsOf(this.doc); return j.length ? j : undefined; })(),
      dimensions: (this.doc.dims || []).length ? this.doc.dims.map(md => { const m = measureDim(R, md); return { id: md.id, a: md.a, b: md.b, view: md.view, axis: md.axis, value: m ? +m.value.toFixed(3) : null, driving: md.drive != null ? md.drive : undefined }; }) : undefined,
      mass: (() => { try { const m = massReport(this.doc, R); return { total_g: m.total_mass_g, cog: m.cog, inertia_kg_mm2: m.inertia_kg_mm2, balance: m.balance, parts: m.parts.map(p => ({ id: p.id, material: p.material, mass_g: p.mass_g, cog: p.centroid })), unassigned: m.unassigned.length ? m.unassigned : undefined }; } catch (e) { return { error: e.message }; } })(),
      addons: [...ADDONS.keys()],
      warnings: R.warnings.map(w => w.text), eval_ms: +R.ms.toFixed(1)
    };
  }
}
export function poseFromMatrix(M) {
  /* XYZ Euler (degrees) for R = Rz·Ry·Rx */
  const ry = Math.asin(Math.max(-1, Math.min(1, -M[2]))), cy = Math.cos(ry);
  let rx, rz;
  if (Math.abs(cy) > 1e-6) { rx = Math.atan2(M[6], M[10]); rz = Math.atan2(M[1], M[0]); } else { rx = Math.atan2(-M[9], M[5]); rz = 0; }
  const d = (r) => +(r * 180 / Math.PI).toFixed(6);
  return { at: [M[12], M[13], M[14]], rot: [d(rx), d(ry), d(rz)] };
}
export { K };
