/* SketchFlow v2 parametric model.
   doc.objects is the feature list (order = history). Each object = shape type + dimensions in its own local frame,
   placed by a mate (connector → connector) or a pose. Booleans are relations (object "into" a target with an op),
   evaluated in list order — editable at any time. Edge treatments (fillet / weld / chamfer) are objects too.
   One API — apply(ops) — serves the UI and the MCP bridge, so an LLM builds with the same JSON a click produces. */
import * as K from './kernel.js';
import { solveSketch, KINDS as SKETCH_KINDS, measure as measureConstraint, expandArcs, arcMid } from './sketch.js';
import { textSolid, layoutText, TEXT_PATHS, TEXT_ALIGN } from './text.js';
const { V, M4 } = K;
export { SKETCH_KINDS, TEXT_PATHS, TEXT_ALIGN, layoutText };

export const TYPES = {
  box: { label: 'Box', params: { width: 40, depth: 30, height: 20 } },
  wedge: { label: 'Wedge', params: { width: 40, depth: 20, height: 20 } },
  /* thread: none | M2…M24 | custom (with pitch): a modelled ISO thread on the outside, thread_length (0 = all of it) from the bottom or top; bore: a hole down the middle (a tube) */
  cylinder: { label: 'Cylinder', params: { diameter: 30, height: 40, thread: 'none', pitch: 0, thread_length: 0, thread_from: 'bottom', left_hand: false, bore: 0 } },
  cone: { label: 'Cone', params: { diameter: 30, top: 0, height: 40 } },
  sphere: { label: 'Sphere', params: { diameter: 30 } },
  fillet: { label: 'Fillet strip', params: { size: 6, length: 40, style: 'fillet' } },
  /* end: blind | symmetric (both ways, half each) | through (through everything, for cuts); draft: taper ° (inward);
     thin: a wall of that thickness (a closed profile becomes a tube-like wall; an open one, open: true, a rib / thin plate) */
  extrude: { label: 'Extrude', params: { profile: [[-10, -10], [10, -10], [10, 10], [-10, 10]], arcs: [], splines: [], length: 20, end: 'blind', draft: 0, thin: 0, open: false, twist: 0, scale: 1, direction: [0, 0, 1], shape: 'points', x: 0, y: 0, width: 40, height: 20, radius: 0, diameter: 20, sides: 6, constraints: [] } },
  /* loft: the profile at 0 to its end at length (profile2, or the profile again); sections [{z, scale, rot, offset, profile?}] in between
     (one at z = length restyles the end); guides [[[x,y,z]…]…] pull its sides; smooth = a monotone cubic through the sections */
  loft: { label: 'Loft', params: { profile: [[-10, -10], [10, -10], [10, 10], [-10, 10]], arcs: [], splines: [], profile2: null, length: 30, twist: 0, sections: [], guides: [], smooth: true, constraints: [] } },
  revolve: { label: 'Revolve', params: { profile: [[5, 0], [12, 0], [12, 4], [5, 4]], arcs: [], splines: [], degrees: 360, constraints: [] } },
  /* helix: {radius, pitch, turns, left} sweeps the profile along a helix instead of path (springs, coils, threads' cores) */
  /* sweep: a profile along a path (smooth: a curve through the path points), twisting (° over the path) and scaling (at its end) */
  sweep: { label: 'Sweep', params: { profile: [[-2, -2], [2, -2], [2, 2], [-2, 2]], path: [[0, 0, 0], [0, 0, 30], [30, 0, 30]], helix: null, smooth: false, twist: 0, scale: 1 } },
  /* fasteners with modelled ISO threads: a bolt (hex or socket head; thread_length 0 = threaded all the way) and a nut; left_hand for a left-hand thread */
  bolt: { label: 'Bolt', params: { size: 'M8', length: 25, head: 'hex', thread_length: 0, left_hand: false } },
  nut: { label: 'Nut', params: { size: 'M8', shape: 'hex', thickness: 0, od: 0, diameter: 0, pitch: 0, left_hand: false } },
  /* a sketch (or text) wrapped onto a cylindrical face: emboss stands out of it, engrave cuts in; radius follows the cylinder */
  /* a sketch or text projected onto any surface (sphere, cone, torus, freeform) and embossed / engraved square to it; built on its
     part as that part is at this point in the history, from a frame in the part's own coordinates (so it moves with it) */
  drape: { label: 'Projected sketch', params: { profile: [[-5, -5], [5, -5], [5, 5], [-5, 5]], arcs: [], splines: [], constraints: [], text: '', size: 8, weight: 0, depth: 1, mode: 'emboss', origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0], cell: 0 } },
  wrap: { label: 'Wrap', params: { profile: [[-5, -5], [5, -5], [5, 5], [-5, 5]], arcs: [], splines: [], constraints: [], text: '', size: 8, weight: 0, depth: 1, radius: 20, mode: 'emboss' } },
  /* a reference plane (no solid): sketch on it, mate to it, split with it. Mate it to a face with gap (offset) and tilt */
  plane: { label: 'Plane', params: { size: 60 } },
  /* an annotation on a part (a weld symbol, a joint note): `on` = the part; at / dir / along in that part's own coordinates, so it
     moves with it; symbol = what the weld-symbol drawer needs (ISO 2553); lines = the note's text */
  callout: { label: 'Callout', params: { at: [0, 0, 0], dir: [0, 0, 1], along: [1, 0, 0], symbol: null, lines: [], kind: 'note', joint: null } },
  /* everything on one side of a plane (a big block): the tool a split uses */
  halfspace: { label: 'Half-space', params: { size: 4000 } },
  edge: { label: 'Edge treatment', params: { style: 'fillet', size: 4, mode: 'auto' } },
  /* a linked copy of another part: same shape and features, its own place */
  instance: { label: 'Instance', params: {} },
  /* an imported triangle mesh (STL / OBJ), stored in doc.meshes */
  mesh: { label: 'Mesh', params: { scale: 1 } },
  /* standard hole: a tool (subtract it into a part); its top sits on the surface and it goes down (−z) */
  hole: { label: 'Hole', params: { size: 'M6', kind: 'simple', fit: 'normal', through: true, depth: 12, diameter: 0, modelled: false, left_hand: false } },
  /* text (single-stroke engraving font) along a line, an arc or a polyline; emboss = union it onto a face, engrave = subtract it */
  text: { label: 'Text', params: { text: 'TEXT', height: 10, depth: 1, weight: 1.2, spacing: 1, path: 'line', radius: 40, angle: 0, align: 'center', points: [[-40, 0], [40, 0]] } },
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
  carbon_fibre: { name: 'Carbon fibre (CFRP)', density: 1.60, color: '#2d2f33', family: 'composite' }, gfrp: { name: 'Glass fibre (GFRP laminate)', density: 1.80, color: '#d9dcc8', family: 'composite' },
  adhesive: { name: 'Structural adhesive (epoxy)', density: 1.20, color: '#e0c36a', family: 'plastic' }, filler: { name: 'Epoxy filler (silica / microfibre)', density: 1.00, color: '#e8dcc0', family: 'plastic' }, concrete: { name: 'Concrete', density: 2.40, color: '#a9a79f', family: 'other' },
  glass: { name: 'Glass', density: 2.50, color: '#d5e9ee', family: 'other' }, rubber: { name: 'Rubber', density: 1.15, color: '#3a3b3d', family: 'other' }
};
/* object types that are not shapes of their own */
const META = new Set(['edge', 'pattern', 'weld', 'shell', 'drape', 'callout']);
export const SHAPES = ['box', 'wedge', 'cylinder', 'cone', 'sphere', 'fillet'];
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const fmt = (v) => String(Math.round(v * 100) / 100);
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
    case 'bolt': { const T = threadSize(p.size), L = +p.length, k = p.head === 'socket' ? T.d : T.k; return [conn('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0]), conn('seat', [0, 0, L], [0, 0, -1], [1, 0, 0]), conn('top', [0, 0, L + k], [0, 0, 1], [1, 0, 0]), conn('center', [0, 0, L / 2], [0, 0, 1], [1, 0, 0], 'center')]; }
    case 'nut': { const m = nutThickness(p); return [conn('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0]), conn('top', [0, 0, m], [0, 0, 1], [1, 0, 0]), conn('center', [0, 0, m / 2], [0, 0, 1], [1, 0, 0], 'center')]; }
    case 'wrap': return [conn('base', [0, 0, 0], [0, 0, 1], [1, 0, 0], 'center')];
    case 'plane': return [conn('plane', [0, 0, 0], [0, 0, 1], [1, 0, 0]), conn('back', [0, 0, 0], [0, 0, -1], [1, 0, 0]), conn('center', [0, 0, 0], [0, 0, 1], [1, 0, 0], 'center')];
    case 'halfspace': return [conn('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0])];
    /* text: its anchor (the line's middle / start / end, an arc's centre) on the bottom and top faces, so editing the words never moves it */
    case 'text': return [conn('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0]), conn('top', [0, 0, +p.depth || 1], [0, 0, 1], [1, 0, 0]), conn('center', [0, 0, (+p.depth || 1) / 2], [0, 0, 1], [1, 0, 0], 'center')];
    case 'fillet': return [conn('edge', [0, 0, 0], [0, 1, 0], [1, 0, 1], 'edge'), conn('leg-x', [p.size / 2, 0, 0], [0, 0, -1], [1, 0, 0]), conn('leg-z', [0, 0, p.size / 2], [-1, 0, 0], [0, 0, 1]),
      conn('end-a', [0, -p.length / 2, 0], [0, -1, 0], [1, 0, 0]), conn('end-b', [0, p.length / 2, 0], [0, 1, 0], [1, 0, 0])];
    case 'sweep': if (p.helix) { const h = p.helix, rw = Math.max(...(p.profile || [[1, 0]]).map(q => Math.hypot(q[0], q[1]))), H = (+h.pitch || 0) * (+h.turns || 0); return [conn('bottom', [0, 0, -rw], [0, 0, -1], [1, 0, 0]), conn('top', [0, 0, H + rw], [0, 0, 1], [1, 0, 0]), conn('axis', [0, 0, H / 2], [0, 0, 1], [1, 0, 0], 'center')]; }
      /* a sweep along a path: falls through to the general connectors, with start / end on the path's ends */
    default: {
      /* features: start/end faces + bounding-box faces & centre (add-on shapes add their own connectors first) */
      const T = TYPES[o.type], c = T && T.def && T.def.connectors ? T.def.connectors(p, addonApi).slice() : [];
      if (o.type === 'extrude' || o.type === 'loft') {
        const cen = centroid2(o.type === 'extrude' && p.shape && p.shape !== 'points' ? shapeProfile(p) : p.profile), dir = o.type === 'extrude' ? V.norm(p.direction || [0, 0, 1]) : [0, 0, 1];
        const L = o.type === 'extrude' && p.end === 'through' ? THROUGH : p.length, z0 = o.type === 'extrude' && p.end === 'symmetric' ? -L / 2 : 0, along = (z) => V.mul(dir, z / (dir[2] || 1));
        const start = V.add([cen[0], cen[1], 0], along(z0)), end = V.add([cen[0], cen[1], 0], along(z0 + L));
        c.push(conn('start', start, [0, 0, -1], [1, 0, 0]), conn('end', end, [0, 0, 1], [1, 0, 0]));
      }
      if (o.type === 'sweep' && Array.isArray(p.path) && p.path.length >= 2) {
        const P = p.path.map(q => q.map(Number)), t0 = V.norm(V.sub(P[1], P[0])), t1 = V.norm(V.sub(P[P.length - 1], P[P.length - 2]));
        const perp = (t) => V.norm(V.cross(Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], t));
        c.push(conn('start', P[0], V.neg(t0), perp(t0)), conn('end', P[P.length - 1], t1, perp(t1)));
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
/* anchors [{obj, conn, i?}]: a part sketched on a face (mated to it by its start / end) whose points follow other parts'
   connectors. A shaped rectangle takes its size along each of its own axes from the spread of its anchors, and its place
   on the face (the mate's slide) from where they are; one anchor on a side moves it without resizing. A drawn outline
   (profile points) holds each anchored point (i) with a fix constraint that moves with its target; the rest of the
   outline stays where it is, re-solved with its own constraints. Returns true when it changed anything. */
export const anchorWorld = (R, a) => { const c = worldConnectors(R, a.obj).find(x => x.name === a.conn); return c ? c.o : null; };
function followAnchorsOf(R, o, missing, notes) {
  const m = o.mate, M = R.world.get(o.id), p = o.params;
  if (!M || !p) return false;
  if (!m || !m.to || m.kind || m.frame || !['start', 'end'].includes(m.b)) { notes.push({ o, text: 'anchors only work on a part sketched on a face (mated to it by its start or end) — it stays where it is' }); return false; }
  const tc = worldConnectors(R, m.to).find(c => c.name === m.a); if (!tc) return false;
  const pts = []; for (const a of o.anchors) { const w = anchorWorld(R, a); if (w) pts.push(Object.assign({ w }, a)); else missing.push({ o, a }); }
  if (!pts.length) return false;
  const xw = V.norm(M4.dir(M, [1, 0, 0])), yw = V.norm(M4.dir(M, [0, 1, 0])), zw = V.norm(M4.dir(M, [0, 0, 1])), u = tc.u, v = V.cross(tc.n, tc.u);
  const Ol = M4.point(M, [0, 0, 0]), rel = (w) => V.sub(w, tc.o), r6a = (x) => Math.round(x * 1e6) / 1e6, ex = o.expr || {}, mx = o.mexpr || {};
  let changed = false, at = null;   /* at: where the mate's connector (the profile's centre) now belongs, in world */
  if (p.shape === 'rect') {
    const Cw = V.add(V.add(Ol, V.mul(xw, +p.x || 0)), V.mul(yw, +p.y || 0)), axes = [xw, yw], keys = ['width', 'height'], cen = [0, 0];
    for (let k = 0; k < 2; k++) {
      const c0 = V.dot(rel(Cw), axes[k]), vals = pts.map(q => V.dot(rel(q.w), axes[k])), lo = Math.min(...vals), hi = Math.max(...vals);
      let size = +p[keys[k]];
      if (hi - lo > 1e-6) {
        if (ex[keys[k]]) notes.push({ o, text: `its ${keys[k]} follows a formula (${ex[keys[k]]}), so its anchors don't resize it — unlink it to let them` });
        else size = hi - lo;
        cen[k] = (hi + lo) / 2;
      } else { const s = Math.sign(Math.round((lo - c0) * 1e6)); cen[k] = s ? lo - s * size / 2 : lo; }
      if (Math.abs(size - p[keys[k]]) > 1e-6) { p[keys[k]] = r6a(size); changed = true; }
    }
    at = V.add(V.add(V.add(tc.o, V.mul(xw, cen[0])), V.mul(yw, cen[1])), V.mul(zw, V.dot(rel(Cw), zw)));
  } else if (Array.isArray(p.profile) && (!p.shape || p.shape === 'points')) {
    if (!Array.isArray(p.constraints)) p.constraints = [];
    const cons = p.constraints;
    for (const q of pts) {
      if (!(q.i >= 0 && q.i < p.profile.length)) { notes.push({ o, text: `an anchor names point ${(q.i | 0) + 1}, which the outline does not have` }); continue; }
      const L = [r6a(V.dot(V.sub(q.w, Ol), xw)), r6a(V.dot(V.sub(q.w, Ol), yw))];
      /* the anchored point is held by a fix of its own (a plain fix on the same point would fight it) */
      for (let k = cons.length - 1; k >= 0; k--) if (cons[k].type === 'fix' && cons[k].i === q.i && !cons[k].anchor) { cons.splice(k, 1); changed = true; }
      let fx = cons.find(c => c.type === 'fix' && c.i === q.i && c.anchor);
      if (!fx) { fx = { type: 'fix', i: q.i, at: L, anchor: true }; cons.push(fx); changed = true; }
      const cur = p.profile[q.i];
      if (Math.hypot(fx.at[0] - L[0], fx.at[1] - L[1]) > 1e-6 || Math.hypot(cur[0] - L[0], cur[1] - L[1]) > 1e-6) { fx.at = L; p.profile[q.i] = L.slice(); changed = true; }
    }
    const c = centroid2(p.profile); at = V.add(V.add(Ol, V.mul(xw, c[0])), V.mul(yw, c[1]));
  } else { notes.push({ o, text: `anchors move a rectangle or a drawn outline, not a ${p.shape}` }); return false; }
  /* the slide that puts the profile's centre there (the rest of the part keeps its place on the face) */
  const sl = m.slide || [0, 0], ns = [r6a(V.dot(rel(at), u)), r6a(V.dot(rel(at), v))];
  if (Math.abs(ns[0] - (+sl[0] || 0)) > 1e-6 || Math.abs(ns[1] - (+sl[1] || 0)) > 1e-6) {
    if (mx['slide.0'] || mx['slide.1']) notes.push({ o, text: 'its slide follows a formula, so its anchors don\'t move it — unlink it to let them' });
    else { o.mate = Object.assign({}, m, { slide: ns }); changed = true; }
  }
  return changed;
}
const cleanAnchors = (list) => {
  if (list == null || list === false) return null;
  if (!Array.isArray(list)) throw new Error('anchors: give a list of {obj, conn} (and i, the point, for a drawn outline)');
  const out = list.filter(Boolean).map(a => { if (typeof a.obj !== 'string' || typeof a.conn !== 'string') throw new Error('each anchor needs obj (a part id) and conn (one of its connectors, e.g. corner+x-y-z)'); return Object.assign({ obj: a.obj, conn: a.conn }, Number.isInteger(a.i) ? { i: a.i } : {}); });
  return out.length ? out : null;
};
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
  out.label = kind === 'tapped' ? `${p.size}×${H.pitch} tapped (${p.modelled ? 'modelled thread' : 'Ø' + H.tap + ' drill'})` : kind === 'insert' ? `${p.size} heat-set insert Ø${d} × ${out.insertDepth}` : `${p.size} ${fit} clearance Ø${d}${kind === 'counterbore' ? `, counterbore Ø${out.cb[0]} × ${out.cb[1]}` : kind === 'countersink' ? `, countersink Ø${out.cs} × 90°` : ''}`;
  return out;
}
function buildHole(p) {
  const h = holeSpec(p), r = h.d / 2, depth = p.kind === 'insert' && !p.through ? (+p.depth || h.insertDepth) : Math.max(0.5, +p.depth || 10);
  const seg = 48, up = 1, tr = (sol, z) => sol.transform(M4.translate([0, 0, z]));
  if (p.kind === 'tapped' && p.modelled && !p.cosmetic && h.pitch) {
    /* a modelled internal thread: the tool is the mating bolt's shape (plus clearance), entered at the full diameter */
    const d = +String(p.size).slice(1), P = h.pitch, fn = threadR(d, P, { clear: 0.1, left: !!p.left_hand }), Rm = d / 2 + 0.1, tip = (h.tap / 2) / Math.tan(59 * Math.PI / 180);
    const st = [];
    if (!p.through) st.push({ z: -depth - tip, r: () => 0.05, sid: 'tip' });
    st.push(...threadStations(-depth, 0, P, (t, z) => Math.max(fn(t, z), Rm + z, p.through ? Rm - (z + depth) : 0)), { z: 0, r: () => Rm, sid: 'entry' }, { z: up, r: () => Rm, sid: 'entry' });
    return K.radialSolid(threadN(d * 2), st);
  }
  let s = tr(K.cylinder(r, r, depth + up, seg), -depth);
  if (!p.through) { const tip = r / Math.tan(59 * Math.PI / 180); s = s.union(tr(K.cylinder(0.0001, r, tip, seg), -depth - tip)); }
  if (h.kind === 'counterbore' && h.cb) s = s.union(tr(K.cylinder(h.cb[0] / 2, h.cb[0] / 2, h.cb[1] + up, seg), -h.cb[1]));
  if (h.kind === 'countersink' && h.cs) { const rc = h.cs / 2, dz = rc - r; s = s.union(tr(K.cylinder(r, rc, dz, seg), -dz)).union(tr(K.cylinder(rc, rc, up, seg), 0)); }
  return s;
}
/* shell: any closed part becomes walls of thickness t. Every face moves inward by t (an offset, not a scale, so walls
   are even on any shape: each vertex goes to where its faces' moved planes meet) and that inner solid is subtracted.
   The open face (one of the part's face connectors) gets no wall, so the cavity breaks through it.
   Where the inner offset would fold over — a rounding tighter than the wall, a boss or rib thinner than two walls —
   the cavity is taken from the part rebuilt without those features (replay), so a small rounding gets a sharp inner
   corner (the exact result) and a thin boss or rib stays solid, as in other CAD shells. A cut that leaves a section
   thinner than two walls is reported instead. */
const SHELL_CACHE = new Map();
const shapeKey = (s) => { const b = s.bbox(); return s.polys.length + '|' + s.volume().toFixed(6) + '|' + [...b.min, ...b.max].map(v => v.toFixed(5)).join(','); };
function shellBody(solid, root, p, R, tagId, replay) {
  const t = +p.thickness; if (!(t > 0)) throw new Error('thickness must be above 0');
  let open = null;
  if (p.open && p.open !== 'none') {
    const c = worldConnectors(R, root.id).find(x => x.name === p.open && x.kind === 'face');
    if (!c) throw new Error(`no face “${p.open}” on ${root.name} to leave open`);
    open = { n: c.n, d: V.dot(c.n, c.o) };
  }
  const key = shapeKey(solid) + '|' + t + '|' + (open ? open.n.map(x => x.toFixed(6)) + ',' + open.d.toFixed(6) : '-'), MARK = '\u0001';
  const named = (r) => { const c = r.solid.clone(); for (const q of c.polys) if (q.sid.startsWith(MARK + ':')) q.sid = tagId + q.sid.slice(1); return { solid: c, solidKept: r.solidKept }; };
  const hit = SHELL_CACHE.get(key); if (hit) return named(hit);
  const bb = solid.bbox(), size = V.len(V.sub(bb.max, bb.min)), tolD = size * 1e-6 + 1e-6, eps = Math.max(0.01, size * 1e-4);
  const isOpen = (poly) => !!open && V.dot(poly.plane.n, open.n) > 1 - 1e-6 && Math.abs(poly.plane.w - open.d) < tolD;
  /* the inward offset, or null where it folds over */
  const inward = (x) => { const { solid: inner, flipped } = K.offsetSolid(x, (poly) => (isOpen(poly) ? eps : -t)); if (flipped) return null; const v = inner.volume(); return v > 0 && v < x.volume() ? inner : null; };
  let inner = inward(solid), solidKept = [];
  if (!inner) {
    if (!replay) throw new Error(`walls of ${t} are thicker than parts of ${root.name} allow`);
    const r = replay((x) => inward(x) != null);
    if (r.blocked) throw new Error(r.blocked === root.name ? `walls of ${t} are thicker than ${root.name}'s own shape allows (it has a section thinner than two walls)` : `walls of ${t}: ${r.blocked} leaves a section thinner than two walls`);
    inner = inward(r.base); solidKept = r.skipped;
    if (!inner) throw new Error(`walls of ${t} are thicker than parts of ${root.name} allow`);
  }
  const out = { solid: solid.subtract(inner.tag(MARK)), solidKept };
  if (!(out.solid.volume() > 0)) throw new Error(`the shell of ${root.name} came out empty`);
  if (SHELL_CACHE.size > 64) SHELL_CACHE.clear();
  SHELL_CACHE.set(key, out); return named(out);
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
/* rebuild a part step by step, leaving out each union or edge step after which ok(solid) fails (a boss thinner than
   two walls, a rounding tighter than the wall). Cuts cannot be left out: the first one that fails is reported. */
function replayFor(start, steps, root, R, ok) {
  if (!ok(start)) return { base: start, skipped: [], blocked: root.name };
  const quiet = Object.assign({}, R, { warnings: [] }), skipped = []; let b = start;
  for (const st of steps) {
    const saved = st.t._resolved; let nb;
    try { nb = st.run(b, quiet); } catch (e) { nb = null; } finally { st.t._resolved = saved; }
    if (!nb) continue;
    if (ok(nb)) { b = nb; continue; }
    if (st.kind === 'union' || st.kind === 'edge') { skipped.push({ name: st.t.name, kind: st.kind }); continue; }
    return { base: b, skipped, blocked: st.t.name };
  }
  return { base: b, skipped, blocked: null };
}
/* ---------- threads (ISO metric coarse), bolts, nuts, wrapped sketches ---------- */
export const THREADS = {
  M2: { p: 0.4, af: 4, k: 1.4, m: 1.6, dk: 3.8, s: 1.5 }, 'M2.5': { p: 0.45, af: 5, k: 1.7, m: 2, dk: 4.5, s: 2 }, M3: { p: 0.5, af: 5.5, k: 2, m: 2.4, dk: 5.5, s: 2.5 },
  M4: { p: 0.7, af: 7, k: 2.8, m: 3.2, dk: 7, s: 3 }, M5: { p: 0.8, af: 8, k: 3.5, m: 4.7, dk: 8.5, s: 4 }, M6: { p: 1, af: 10, k: 4, m: 5.2, dk: 10, s: 5 },
  M8: { p: 1.25, af: 13, k: 5.3, m: 6.8, dk: 13, s: 6 }, M10: { p: 1.5, af: 16, k: 6.4, m: 8.4, dk: 16, s: 8 }, M12: { p: 1.75, af: 18, k: 7.5, m: 10.8, dk: 18, s: 10 },
  M14: { p: 2, af: 21, k: 8.8, m: 12.8, dk: 21, s: 12 }, M16: { p: 2, af: 24, k: 10, m: 14.8, dk: 24, s: 14 }, M20: { p: 2.5, af: 30, k: 12.5, m: 18, dk: 30, s: 17 }, M24: { p: 3, af: 36, k: 15, m: 21.5, dk: 36, s: 19 }
};
function threadSize(name) { const key = String(name || '').toUpperCase(), T = THREADS[key]; if (!T) throw new Error(`thread size is one of ${Object.keys(THREADS).join(', ')} (or custom, with a diameter and pitch)`); return Object.assign({ d: +key.slice(1) }, T); }
/* the radius of an ISO 60° thread at angle t and height z: root (minor) flat P/4, crest flat P/8, 30° flanks; right-hand
   unless left. clear grows it (a nut's bore, a tap). z0 / z1: chamfered free ends (45° lead-in from the minor diameter) */
function threadR(d, P, o = {}) {
  const c = o.clear || 0, R = d / 2 + c, r1 = (d - 1.0825 * P) / 2 + c, h = R - r1, sgn = o.left ? -1 : 1;
  return (t, z) => {
    let u = ((z - sgn * P * t / (2 * Math.PI)) / P) % 1; if (u < 0) u += 1;
    let r = u < 0.125 ? r1 : u < 0.4375 ? r1 + h * (u - 0.125) / 0.3125 : u < 0.5625 ? R : u < 0.875 ? R - h * (u - 0.5625) / 0.3125 : r1;
    if (o.z0 != null) r = Math.min(r, r1 + Math.max(0, z - o.z0));
    if (o.z1 != null) r = Math.min(r, r1 + Math.max(0, o.z1 - z));
    return r;
  };
}
const threadN = (d) => Math.max(36, Math.min(96, Math.round(d * 4 / 12) * 12));   /* points round: a multiple of 12 so hex corners are exact */
const PER_PITCH = 16;                                                              /* stations per turn */
function threadStations(za, zb, P, fn, extra) {
  const n = Math.max(1, Math.ceil((zb - za) / (P / PER_PITCH))), out = [];
  for (let k = 0; k <= n; k++) { const z = za + (zb - za) * k / n; out.push(Object.assign({ z, r: (t) => fn(t, z), sid: 'thread' }, extra ? extra(z) : {})); }
  return out;
}
const hexR = (af) => (t) => (af / 2) / Math.cos(((t % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6);
const flatSid = (j, N) => 'flat' + (Math.floor((2 * Math.PI * (j + 0.5) / N) / (Math.PI / 3)) % 6);   /* hexR has its corners at 0°, 60°…: flat k spans 60k°…60(k+1)° */
function buildCylinder(p) {
  const R = p.diameter / 2, H = +p.height, thr = p.thread && p.thread !== 'none' && !p.cosmetic, bore = +p.bore || 0;   /* cosmetic: the thread left plain (exports) */
  if (!(R > 0 && H > 0)) throw new Error('diameter and height must be above 0');
  if (!thr && !bore) return K.cylinder(R, R, H, p.segments || SEG);
  if (bore >= p.diameter) throw new Error('the bore must be smaller than the diameter');
  const ri = bore > 0 ? () => bore / 2 : null, plain = (z) => ({ z, r: () => R, ri, sid: 'side', sidIn: 'bore' });
  if (!thr) return K.radialSolid(p.segments || SEG, [plain(0), plain(H)]);
  const P = p.thread === 'custom' ? +p.pitch : threadSize(p.thread).p; if (!(P > 0)) throw new Error('a custom thread needs a pitch');
  if (bore > 0 && bore / 2 >= (p.diameter - 1.0825 * P) / 2 - 0.3) throw new Error(`a ${bore} bore leaves no wall under the thread (keep it under Ø${(p.diameter - 1.0825 * P - 0.6).toFixed(2)})`);
  const L = Math.min(H, +p.thread_length > 0 ? +p.thread_length : H), top = p.thread_from === 'top', za = top ? H - L : 0, zb = top ? H : L;
  const fn = threadR(p.diameter, P, { left: !!p.left_hand, z0: za === 0 ? 0 : null, z1: zb === H ? H : null });
  const st = [];
  if (za > 0) st.push(plain(0), plain(za));
  st.push(...threadStations(za, zb, P, fn, () => ({ ri, sidIn: 'bore' })));
  if (zb < H) st.push(plain(zb), plain(H));
  return K.radialSolid(threadN(p.diameter), st);
}
function buildBolt(p) {
  const T = threadSize(p.size), d = T.d, P = T.p, L = +p.length; if (!(L > 0)) throw new Error('length must be above 0');
  const Lt = +p.thread_length > 0 ? Math.min(L, +p.thread_length) : L, R = d / 2, N = threadN(d), fn = threadR(d, P, { z0: 0, left: !!p.left_hand });
  const st = p.cosmetic ? [{ z: 0, r: () => R, sid: 'thread' }, { z: Lt, r: () => R, sid: 'thread' }] : threadStations(0, Lt, P, fn);
  if (Lt < L) st.push({ z: Lt, r: () => R, sid: 'shank' }, { z: L, r: () => R, sid: 'shank' });
  if (p.head === 'socket') {
    const rk = T.dk / 2, k = d, dep = Math.min(k * 0.6, k - 0.5), hs = hexR(T.s);
    st.push({ z: L, r: () => rk, sid: 'seat' }, { z: L + k - dep, r: () => rk, sid: 'head' }, { z: L + k - dep, r: () => rk, ri: hs, sid: 'head', sidIn: 'socket' }, { z: L + k, r: () => rk, ri: hs, sid: 'head', sidIn: 'socket' });
  } else {
    const hx = hexR(T.af);
    st.push({ z: L, r: hx, sid: 'seat' }, { z: L, r: hx, sid: 'seat', flat: true }, { z: L + T.k, r: hx, sid: 'head', flat: true });
  }
  return K.radialSolid(N, st, { sidFlat: flatSid });
}
/* the signed pitch of a part's modelled thread (negative = left-hand), or null: what a screw joint on it advances per turn */
export function threadPitchOf(o) {
  if (!o || !o.params) return null;
  const p = o.params, sg = p.left_hand ? -1 : 1, iso = (sz) => { try { return threadSize(sz).p; } catch (e) { return null; } };
  let P = null;
  if (o.type === 'bolt') P = iso(p.size);
  else if (o.type === 'nut') P = p.size === 'custom' ? +p.pitch || null : iso(p.size);
  else if (o.type === 'cylinder' && p.thread && p.thread !== 'none') P = p.thread === 'custom' ? +p.pitch || null : iso(p.thread);
  else if (o.type === 'hole' && p.kind === 'tapped' && p.modelled) P = iso(p.size);
  return P ? sg * P : null;
}
function nutThickness(p) { if (+p.thickness > 0) return +p.thickness; if (p.size === 'custom') return Math.max(2, +p.diameter * 0.8); return threadSize(p.size).m; }
function buildNut(p) {
  const custom = p.size === 'custom', T = custom ? null : threadSize(p.size), d = custom ? +p.diameter : T.d, P = custom ? +p.pitch : T.p, m = nutThickness(p);
  if (!(d > 0 && P > 0)) throw new Error('a custom nut needs a diameter and a pitch');
  const fn = threadR(d, P, { clear: 0.1, left: !!p.left_hand }), c = 0.1, Rm = d / 2 + c;
  /* the bore: the mating thread's shape (plus clearance), opened 45° at both faces */
  const bore = (z) => (t) => Math.max(fn(t, z), Rm - Math.min(z, m - z));
  const shape = p.shape || 'hex', od = +p.od > 0 ? +p.od : (T ? T.af / Math.cos(Math.PI / 6) : d * 1.8);
  if (od / 2 <= Rm + 0.5) throw new Error(`an outside of Ø${od} leaves no wall round a ${d} thread`);
  const outer = shape === 'round' ? () => od / 2 : shape === 'knurled' ? (t) => od / 2 - Math.min(0.6, od * 0.02) * Math.abs(Math.sin(Math.round(od * 1.2) * t / 2)) : hexR(T ? T.af : od * Math.cos(Math.PI / 6));
  const st = p.cosmetic ? [0, m].map(z => ({ z, r: outer, ri: () => (d - 1.0825 * P) / 2, sid: shape === 'knurled' ? 'knurl' : 'outer', sidIn: 'thread', flat: shape === 'hex' }))   /* cosmetic: a plain bore at the minor diameter */
    : threadStations(0, m, P, fn, (z) => ({ r: outer, ri: bore(z), sid: shape === 'knurled' ? 'knurl' : 'outer', sidIn: 'thread', flat: shape === 'hex' }));
  return K.radialSolid(Math.max(threadN(d), shape === 'knurled' ? 96 : 36), st, { sidFlat: shape === 'hex' ? flatSid : null });
}
/* a loft with sections or guides (otherwise the plain two-profile loft, unchanged) */
const loftIsMulti = (p) => (Array.isArray(p.sections) && p.sections.length > 0) || (Array.isArray(p.guides) && p.guides.length > 0);
/* the loft's sections: the profile at 0, the ones given in between, its end at length (profile2 or the profile; a section at
   z = length restyles it) */
/* a copy of the document with every modelled thread left plain (bolts and threaded cylinders at their major diameter, nuts
   and tapped holes at the tap-drill size) — how CAD systems exchange threads, and a much smaller file */
export function cosmeticThreads(doc) {
  const d = JSON.parse(JSON.stringify(doc)); let n = 0;
  for (const o of d.objects) {
    const p = o.params || {};
    if (o.type === 'bolt' || o.type === 'nut' || (o.type === 'cylinder' && p.thread && p.thread !== 'none') || (o.type === 'hole' && p.kind === 'tapped' && p.modelled)) { p.cosmetic = true; n++; }
  }
  return { doc: d, count: n };
}
export function loftStations(p, A) {
  A = A || expandArcs(p.profile, p.arcs, { splines: p.splines }).pts;
  const L = +p.length; if (!(L > 0)) throw new Error('length must be above 0');
  const prof = (q) => q.profile ? expandArcs(q.profile, q.arcs, { splines: q.splines }).pts : A;
  const mid = [], endStyle = {};
  for (const q of p.sections || []) {
    const z = +q.z; if (!(z > 0 && z <= L + 1e-9)) throw new Error(`a loft section at ${q.z} is outside the loft (0 … ${L}); make the loft longer or move the section`);
    const st = { z, profile: prof(q), scale: q.scale == null ? 1 : +q.scale, rot: +q.rot || 0, offset: q.offset || [0, 0] };
    if (Math.abs(z - L) < 1e-9) Object.assign(endStyle, st); else mid.push(st);
  }
  const end = Object.assign({ z: L, profile: p.profile2 || A, scale: 1, rot: 0, offset: [0, 0] }, endStyle, { z: L });
  if (endStyle.profile && !(p.sections || []).find(q => Math.abs(+q.z - L) < 1e-9).profile) end.profile = p.profile2 || A;
  return [{ z: 0, profile: A, scale: 1, rot: 0, offset: [0, 0] }, ...mid, end];
}
function buildWrap(p) {
  const R = +p.radius, depth = +p.depth, emboss = p.mode !== 'engrave', eps = Math.min(0.2, depth * 0.25);
  if (!(depth > 0)) throw new Error('depth must be above 0');
  let flat;
  if (p.text) flat = textSolid({ text: p.text, height: +p.size || 8, depth: depth + eps, weight: +p.weight > 0 ? +p.weight : undefined, spacing: p.spacing, align: 'center', path: 'line' });
  else flat = K.extrude(expandArcs(p.profile, p.arcs, { splines: p.splines }).pts, { length: depth + eps });
  if (!emboss && depth >= R) throw new Error(`an engraving ${depth} deep goes through a radius ${R} cylinder`);
  return K.wrapSolid(flat.transform(M4.translate([0, 0, emboss ? -eps : -depth])), R, 2);
}
/* ---------- extrude end conditions, draft and thin walls; helix paths ---------- */
const THROUGH = 4000;   /* "through all": far enough to come out of any part */
function buildExtrude(p) {
  const shaped = p.shape && p.shape !== 'points', open = !shaped && !!p.open, t = +p.thin || 0, end = p.end || 'blind';
  const L = end === 'through' ? THROUGH : +p.length; if (!(L > 0)) throw new Error('length must be above 0');
  let prof, sides = null;
  if (shaped) prof = shapeProfile(p);
  else { const X = expandArcs(p.profile, p.arcs, { open, splines: p.splines }); prof = X.pts; sides = X.sides; }
  if (open) { if (!(t > 0)) throw new Error('an open profile is a thin wall: give it a thickness (thin)'); prof = K.thickenPolyline(prof, t); sides = null; }
  /* keep each side face named after its own segment, whichever way round the profile was drawn */
  if (sides && K.area2(prof) < 0) { const N = prof.length, sd = sides; prof = prof.slice().reverse(); sides = prof.map((_, k) => sd[((N - 2 - k) % N + N) % N]); }
  const draft = +p.draft || 0, offEnd = draft ? -L * Math.tan(draft * Math.PI / 180) : 0;
  if (Math.abs(draft) >= 89) throw new Error('draft must be between -89° and 89°');
  const one = (outline, names) => K.extrude(outline, { length: L, twist: p.twist, scale: p.scale, dir: p.direction, offsetEnd: offEnd || undefined, sideSid: names ? (i) => names[i] || 'side' + i : undefined });
  let s = one(prof, sides);
  if (t > 0 && !open) { const inner = K.offsetPolygon(prof, -t); if (!inner) throw new Error(`walls of ${t} leave nothing inside the profile`); s = s.subtract(one(inner, null).tag('inner')); }
  if (end === 'symmetric') { const dir = V.norm(p.direction || [0, 0, 1]); s = s.transform(M4.translate(V.mul(dir, -L / 2 / (dir[2] || 1)))); }
  return s;
}
/* a helix along +z from the origin: radius, pitch (rise per turn), turns; left-handed when left is true */
function helixPath(h) {
  const r = +h.radius, pitch = +h.pitch, turns = +h.turns, sgn = h.left ? -1 : 1;
  if (!(r > 0 && pitch > 0 && turns > 0)) throw new Error('a helix needs radius, pitch and turns above 0');
  if (turns > 200) throw new Error('at most 200 turns');
  const n = Math.max(12, Math.ceil(turns * 36)), out = [];
  for (let k = 0; k <= n; k++) { const a = sgn * 2 * Math.PI * turns * k / n; out.push([r * Math.cos(a), r * Math.sin(a), pitch * turns * k / n]); }
  return out;
}
/* every flat face of a shape is a face connector too ("face:<surface>"), so inclined and side faces can take holes,
   text, bosses, sketches and mates. Faces that a named connector already covers are skipped; curved surfaces too. */
const FACE_CONN_CACHE = new WeakMap();
function faceConnectors(s, have) {
  if (!s || s.isEmpty()) return [];
  const hit = FACE_CONN_CACHE.get(s), hk = have.filter(h => h.kind === 'face').map(h => h.name + h.o.map(v => v.toFixed(4)) + h.n.map(v => v.toFixed(4))).join('|');
  if (hit && hit.hk === hk) return hit.out;
  const out = faceConnectorsOf(s, have); FACE_CONN_CACHE.set(s, { hk, out }); return out;
}
function faceConnectorsOf(s, have) {
  const groups = new Map();
  for (const q of s.polys) {
    let g = groups.get(q.sid); if (!g) groups.set(q.sid, g = { sid: q.sid, n: q.plane.n, w: q.plane.w, area: 0, c: [0, 0, 0], curved: false });
    if (V.dot(g.n, q.plane.n) < 1 - 1e-6 || Math.abs(g.w - q.plane.w) > 1e-6 * (1 + Math.abs(g.w))) g.curved = true;
    const a = q.v[0].p; for (let i = 1; i < q.v.length - 1; i++) { const b = q.v[i].p, c = q.v[i + 1].p, ar = V.len(V.cross(V.sub(b, a), V.sub(c, a))) / 2; g.area += ar; g.c = V.add(g.c, V.mul(V.add(V.add(a, b), c), ar / 3)); }
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.curved || g.area < 1e-6 || out.length >= 64) continue;
    const c = V.mul(g.c, 1 / g.area);
    if (have.some(h => h.kind === 'face' && V.dot(h.n, g.n) > 1 - 1e-6 && Math.abs(V.dot(V.sub(c, h.o), g.n)) < 1e-6)) continue;
    let u = V.sub([1, 0, 0], V.mul(g.n, g.n[0])); if (V.len(u) < 0.1) u = V.sub([0, 1, 0], V.mul(g.n, g.n[1]));
    out.push(conn('face:' + g.sid.split(':').pop(), c, g.n, u));
  }
  return out;
}
/* ---------- local geometry ---------- */
const SEG = 48;
function buildLocal(o) {
  const p = o.params;
  switch (o.type) {
    case 'box': return K.box(p.width, p.depth, p.height);
    case 'wedge': return K.wedge(p.width, p.depth, p.height);
    case 'cylinder': return buildCylinder(p);
    case 'bolt': return buildBolt(p);
    case 'nut': return buildNut(p);
    case 'wrap': return buildWrap(p);
    case 'cone': return K.cylinder(p.diameter / 2, Math.max(0, (p.top || 0) / 2), p.height, p.segments || SEG);
    case 'sphere': return K.sphere(p.diameter / 2, p.segments || 32);
    case 'fillet': return K.edgePiece([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], p.size, p.style || 'fillet', p.length);
    case 'extrude': return buildExtrude(p);
    case 'loft': { const A = expandArcs(p.profile, p.arcs, { splines: p.splines }).pts; if (!loftIsMulti(p)) return K.loft(A, p.profile2 || A, { length: p.length, twist: p.twist }); return K.loftSections(loftStations(p, A), { guides: p.guides, smooth: p.smooth !== false, twist: p.twist }); }
    case 'revolve': return K.revolve(expandArcs(p.profile, p.arcs, { splines: p.splines }).pts, { degrees: p.degrees });
    case 'sweep': return K.sweep(p.profile, p.helix ? helixPath(p.helix) : p.path, p.helix ? {} : { smooth: !!p.smooth, twist: +p.twist || 0, scale: p.scale == null ? 1 : +p.scale });
    case 'plane': return K.Solid.empty();
    case 'halfspace': return K.box(+p.size || 4000, +p.size || 4000, (+p.size || 4000) / 2);
    case 'hole': return buildHole(p);
    case 'text': return textSolid(p);
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
    case 'bolt': { const d = threadSize(p.size).d; return [D('length', [d / 2 + 2, 0, 0], [d / 2 + 2, 0, +p.length], 'front')]; }
    case 'wrap': return [D('depth', [+p.radius, 0, 0], [+p.radius + +p.depth, 0, 0], 'top')];
    case 'text': {
      const z = +p.depth || 0, out = [D('depth', [0, 0, 0], [0, 0, z], 'front')];
      if (p.path === 'arc' || p.path === 'arc-inside') out.push(D('radius', [0, 0, z], [0, p.path === 'arc' ? +p.radius : -p.radius, z], 'top'));
      else if (!p.path || p.path === 'line') { const a = (+p.angle || 0) * Math.PI / 180, y0 = p.align === 'center' || !p.align ? -p.height / 2 : -(+p.weight || 0) / 2, n = [-Math.sin(a), Math.cos(a), 0]; out.push(D('height', V.mul(n, y0), V.mul(n, y0 + +p.height), 'top')); }
      return out;
    }
    case 'extrude': {
      const prof = p.shape && p.shape !== 'points' ? shapeProfile(p) : p.profile, c = centroid2(prof), dir = V.norm(p.direction || [0, 0, 1]);
      const z0 = p.end === 'symmetric' ? -p.length / 2 : 0, out = p.end === 'through' ? [] : [D('length', V.add([c[0], c[1], 0], V.mul(dir, z0 / (dir[2] || 1))), V.add([c[0], c[1], 0], V.mul(dir, (z0 + p.length) / (dir[2] || 1))), 'auto')], x = +p.x || 0, y = +p.y || 0;
      /* a shape's own sizes are dimensions in its sketch plane */
      if (p.shape === 'rect' || p.shape === 'slot') out.push(D('width', [x - p.width / 2, y - p.height / 2, 0], [x + p.width / 2, y - p.height / 2, 0], 'auto'), D('height', [x - p.width / 2, y - p.height / 2, 0], [x - p.width / 2, y + p.height / 2, 0], 'auto'));
      if (p.shape === 'circle' || p.shape === 'polygon') out.push(D('diameter', [x - p.diameter / 2, y, 0], [x + p.diameter / 2, y, 0], 'auto', 'diameter'));
      if (!p.shape || p.shape === 'points') out.push(...constraintDims(p, false));
      return out;
    }
    case 'loft': { const c = centroid2(p.profile); return [D('length', [c[0], c[1], 0], [c[0], c[1], p.length], 'auto'), ...constraintDims(p, false)]; }
    case 'revolve': return constraintDims(p, true);
    default: { const T = TYPES[o.type]; if (T && T.def && T.def.dims) { try { return T.def.dims(p, addonApi) || []; } catch (e) { return []; } } return []; }
  }
}

/* driving sketch values as carried dimensions, in the profile's own plane (revolve profiles are (r, z)) */
function constraintDims(p, rz) {
  const out = [], P = p.profile || [], n = P.length, L3 = (q) => (rz ? [q[0], 0, q[1]] : [q[0], q[1], 0]);
  for (const c of p.constraints || []) {
    if (!c.p || !n) continue;
    if (c.type === 'length') out.push({ param: c.p, a: L3(P[c.i % n]), b: L3(P[(c.i + 1) % n]), view: 'auto', kind: 'linear' });
    if (c.type === 'fixx') out.push({ param: c.p, a: L3([0, P[c.i % n][1]]), b: L3(P[c.i % n]), view: 'auto', kind: 'linear' });
    if (c.type === 'fixy') out.push({ param: c.p, a: L3([P[c.i % n][0], 0]), b: L3(P[c.i % n]), view: 'auto', kind: 'linear' });
    if (c.type === 'fitx' || c.type === 'fity') { const sp = (p.splines || []).find(z => z.i === c.i), q = sp && sp.pts[c.k]; if (q) out.push({ param: c.p, a: L3(c.type === 'fitx' ? [0, q[1]] : [q[0], 0]), b: L3(q), view: 'auto', kind: 'linear' }); }
    if (c.type === 'radius') { const a = (p.arcs || []).find(q => q.i === c.i); if (a) out.push({ param: c.p, a: L3(a.c), b: L3(arcMid(P[c.i % n], P[(c.i + 1) % n], a.c, a.ccw)), view: 'auto', kind: 'radius' }); }
  }
  return out;
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
  /* mate formulas: offset / angle / tilt / slide.0 / slide.1 follow sizes and variables */
  for (const o of doc.objects) {
    if (!o.mexpr || !o.mate || o.mate.kind) continue;
    for (const [k, e] of Object.entries(o.mexpr)) {
      try {
        const v = evalTree(parseExpr(e), (r) => look(r, [o.id + '.mate.' + k])); if (!isFinite(v)) throw new Error(`${e} is not a finite number`);
        const r9 = Math.round(v * 1e9) / 1e9; o.mate = Object.assign({}, o.mate);
        if (k === 'slide.0' || k === 'slide.1') { const sl = (o.mate.slide || [0, 0]).slice(); sl[+k.slice(6)] = r9; o.mate.slide = sl; }
        else if (k === 'offset' && o.mate.joint === 'screw') { o.mate.base = r9; o.mate.offset = r9 + (o.mate.pitch || 0) * (o.mate.angle || 0) / 360; }   /* a screw's formula places it at angle 0 */
        else o.mate[k] = r9;
        if (k === 'angle' && o.mate.joint === 'screw') o.mate.offset = (o.mate.base || 0) + (o.mate.pitch || 0) * r9 / 360;
      } catch (err) { warn.push({ kind: 'link', id: o.id, text: `${o.name} mate ${k} ${e}: ${err.message}` }); }
    }
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

/* when the solver moves a spline's end points, its fit points go with them: the similarity (move, turn, scale) that takes
   the old chord onto the new one, so the curve keeps its shape relative to its ends */
export function carrySplines(before, after, splines, open) {
  const n = before.length, r9 = (v) => Math.round(v * 1e9) / 1e9;
  return splines.map(sp => {
    if (!(sp.i >= 0 && sp.i < n) || (open && sp.i >= n - 1)) return sp;
    const a0 = before[sp.i], b0 = before[(sp.i + 1) % n], a1 = after[sp.i], b1 = after[(sp.i + 1) % n];
    const dx0 = b0[0] - a0[0], dy0 = b0[1] - a0[1], dx1 = b1[0] - a1[0], dy1 = b1[1] - a1[1], L2 = dx0 * dx0 + dy0 * dy0;
    if (Math.abs(a1[0] - a0[0]) < 1e-12 && Math.abs(a1[1] - a0[1]) < 1e-12 && Math.abs(b1[0] - b0[0]) < 1e-12 && Math.abs(b1[1] - b0[1]) < 1e-12) return sp;
    /* k = (b1 - a1) / (b0 - a0) as complex numbers; a zero-length chord just moves */
    const kr = L2 > 1e-18 ? (dx1 * dx0 + dy1 * dy0) / L2 : 1, ki = L2 > 1e-18 ? (dy1 * dx0 - dx1 * dy0) / L2 : 0;
    return Object.assign({}, sp, { pts: sp.pts.map(([x, y]) => { const ux = x - a0[0], uy = y - a0[1]; return [r9(a1[0] + kr * ux - ki * uy), r9(a1[1] + ki * ux + kr * uy)]; }) });
  });
}

/* fit-point constraints (fitfix / fitx / fity) put the fit points they name where they say, over the carried shape */
function applyFitConstraints(q) {
  const fits = (q.constraints || []).filter(c => SKETCH_KINDS[c.type] && SKETCH_KINDS[c.type].fit); if (!fits.length) return null;
  let bad = null; q.splines = (q.splines || []).map(sp => Object.assign({}, sp, { pts: sp.pts.map(p => p.slice()) }));
  for (const c of fits) {
    const sp = q.splines.find(z => z.i === c.i); if (!sp || !sp.pts[c.k]) { bad = `${SKETCH_KINDS[c.type].label.toLowerCase()} ${c.i + 1}.${(c.k || 0) + 1} has no fit point to hold (remove it)`; continue; }
    if (c.type === 'fitfix') sp.pts[c.k] = c.at.slice();
    else { const v = q[c.p]; if (typeof v === 'number' && isFinite(v)) sp.pts[c.k][c.type === 'fitx' ? 0 : 1] = v; }
  }
  return bad;
}
/* how many fit-point coordinates are held: each fit point has two; a fix holds both, fitx / fity one each */
function fitStatus(q) {
  const total = (q.splines || []).reduce((a, sp) => a + 2 * (sp.pts || []).length, 0), held = new Set();
  for (const c of q.constraints || []) { if (c.type === 'fitfix') { held.add(c.i + '.' + c.k + 'x'); held.add(c.i + '.' + c.k + 'y'); } else if (c.type === 'fitx') held.add(c.i + '.' + c.k + 'x'); else if (c.type === 'fity') held.add(c.i + '.' + c.k + 'y'); }
  return { coordinates: total, held: held.size, carried: total - held.size };
}

/* ---------- evaluation ---------- */
const BODY_CACHE = new Map(), LOCAL_CACHE = new Map();
function cachedLocal(o) {
  const key = o.type + '|' + JSON.stringify(o.params); let s = LOCAL_CACHE.get(key);
  if (!s) { s = localSolid(o); LOCAL_CACHE.set(key, s); if (LOCAL_CACHE.size > 200) LOCAL_CACHE.delete(LOCAL_CACHE.keys().next().value); }
  return s;
}
/* ---------- joints (moving mates) ----------
   mate.joint: fixed | revolute (spins about the connector axis) | slider (travels along axis n / u / v) | cylindrical (spin + travel) | planar (u, v, spin)
   | screw (spin, advancing mate.pitch per turn along the axis; negative pitch = left-hand)
   | planar (slides on the face + spin). The joint's values are the mate's own angle / offset / slide, so a pose is just data. */
export const JOINTS = {
  revolute: [{ key: 'angle', unit: '°', min: -180, max: 180 }],
  slider: [{ key: 'travel', unit: 'mm', min: -50, max: 50 }],
  cylindrical: [{ key: 'angle', unit: '°', min: -180, max: 180 }, { key: 'offset', unit: 'mm', min: -50, max: 50 }],
  planar: [{ key: 'u', unit: 'mm', min: -50, max: 50 }, { key: 'v', unit: 'mm', min: -50, max: 50 }, { key: 'angle', unit: '°', min: -180, max: 180 }],
  /* screw: turning it moves it along the axis by the pitch per turn (a cap on a thread, a lead screw) */
  screw: [{ key: 'angle', unit: '°', min: -720, max: 720 }]
};
/* a joint move (or a driving dimension) sets a mate field directly, so a formula on that field lets go of it */
function unlinkMateField(x, key) {
  if (!x.mexpr) return;
  const m = x.mate || {}, f = key === 'angle' ? ['angle'] : key === 'offset' ? ['offset'] : key === 'u' ? ['slide.0'] : key === 'v' ? ['slide.1'] : key === 'travel' ? [m.axis === 'u' ? 'slide.0' : m.axis === 'v' ? 'slide.1' : 'offset'] : [key];
  for (const k of f) delete x.mexpr[k]; if (!Object.keys(x.mexpr).length) delete x.mexpr;
}
const dofGet = (m, key) => key === 'angle' ? (m.angle || 0) : key === 'offset' ? (m.offset || 0) : key === 'u' ? (m.slide || [0, 0])[0] : key === 'v' ? (m.slide || [0, 0])[1]
  : key === 'travel' ? (m.axis === 'u' ? (m.slide || [0, 0])[0] : m.axis === 'v' ? (m.slide || [0, 0])[1] : (m.offset || 0)) : 0;
function dofSet(m, key, v) {
  const sl = (m.slide || [0, 0]).slice();
  if (key === 'angle' && m.joint === 'screw') { m.angle = v; m.offset = (m.base || 0) + (m.pitch || 1) * v / 360; return; }
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
  R.sketch = new Map();
  const cfg = (doc.configs || []).find(c => c.name === doc.config) || null;
  R.warnings.push(...resolveLinks(doc, cfg));
  /* suppressed features, and everything after the rollback bar, are placed but make no geometry */
  const rb = Number.isInteger(doc.rollback) ? doc.rollback : Infinity, cfgOff = new Set((cfg && cfg.suppress) || []), off = new Set(doc.objects.filter((o, i) => o.suppressed || cfgOff.has(o.id) || i >= rb).map(o => o.id));
  R.config = cfg ? cfg.name : null;
  /* constrained profiles are solved before anything is built (their values may be linked parameters) */
  for (const o of doc.objects) {
    const q = o.params; if (!q || !Array.isArray(q.profile) || (q.shape && q.shape !== 'points') || !((Array.isArray(q.constraints) && q.constraints.length) || (Array.isArray(q.arcs) && q.arcs.length))) continue;
    try {
      const res = solveSketch(q.profile, q.constraints || [], q, q.arcs || [], { open: !!q.open }); R.sketch.set(o.id, res);
      if (res.ok) { if (Array.isArray(q.splines) && q.splines.length) q.splines = carrySplines(q.profile, res.points, q.splines, !!q.open); q.profile = res.points; if (q.arcs && q.arcs.length) q.arcs = res.arcs; }
      else R.warnings.push({ kind: 'sketch', id: o.id, text: `${o.name}: the sketch can't satisfy ${res.conflicts.map(c => SKETCH_KINDS[c.type].label.toLowerCase() + ' ' + (c.i + 1) + (c.j != null ? '/' + (c.j + 1) : '')).join(', ') || 'all its constraints'} — remove one` });
      const fitWarn = applyFitConstraints(q); if (fitWarn) R.warnings.push({ kind: 'sketch', id: o.id, text: `${o.name}: ${fitWarn}` });
      res.fit = fitStatus(q);
    } catch (e) { R.warnings.push({ kind: 'sketch', id: o.id, text: `${o.name}: ${e.message}` }); }
  }
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
    try { const s = cachedLocal(o); R.local.set(o.id, s); const cs = connectorsOf(o, s); R.conns.set(o.id, o.type === 'mesh' || o.type === 'halfspace' ? cs : cs.concat(faceConnectors(s, cs))); }
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
      else if (Array.isArray(m.frame) && m.frame.length === 16) M = M4.mul(m.to === 'origin' ? M4.ident() : worldOf(m.to), m.frame);   /* attached: a fixed place in the target's own frame */
      else {
        const tConns = m.to === 'origin' ? ORIGIN_CONNS : (R.conns.get(m.to) || []), tc = tConns.find(c => c.name === m.a), sc = (R.conns.get(id) || []).find(c => c.name === m.b);
        if (!tc || !sc) R.warnings.push({ kind: 'orphan', id, text: `${o.name}: mate connector “${!tc ? m.a : m.b}” no longer exists` });
        else {
          const Mt = m.to === 'origin' ? M4.ident() : worldOf(m.to);
          const Fa = M4.mul(Mt, frameOf(tc)), slide = m.slide || [0, 0];
          const T = M4.translate([slide[0] || 0, slide[1] || 0, m.offset || 0]);
          const flip = m.flip ? [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1] : M4.ident();
          const Rz = M4.axisAngle([0, 0, 1], m.angle || 0), Rt = m.tilt ? M4.axisAngle([1, 0, 0], m.tilt) : M4.ident();   /* tilt: about the target face's u axis */
          M = M4.mul(Fa, M4.mul(T, M4.mul(Rt, M4.mul(flip, M4.mul(Rz, M4.inv(frameOf(sc)))))));
        }
      }
    }
    state.set(id, 'done'); R.world.set(id, M); return M;
  };
  for (const o of doc.objects) if (!META.has(o.type)) worldOf(o.id);
  /* ephemeral world origin: a connector the user (or the first object) chose; display coordinates are relative to it */
  /* by default the ground part's bottom — when that part is mated to the origin. A ground placed by coordinates (at / fixed)
     was placed in board coordinates: they stay the model's, or every later op given in model coordinates would land off by
     wherever that part's bottom face happens to be (an extrude's is the middle of its start face) */
  const gob = ground && byId.get(ground);
  const og = doc.origin && byId.get(doc.origin.obj) ? doc.origin : (gob && gob.mate && gob.mate.to === 'origin' ? { obj: ground, conn: 'bottom' } : null);
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
    const start = s, steps = [];   /* what was applied, so a shell can rebuild the part without features that fold */
    for (const t of intoOf.get(id) || []) {
      R.consumed.add(t.id);
      try {
        if (t.type === 'edge') { s = applyEdge(s, t, o, R); steps.push({ kind: 'edge', t, run: (x, RR) => applyEdge(x, t, o, RR) }); continue; }
        if (t.type === 'drape') { s = applyDrape(s, t, o, R); steps.push({ kind: t.params.mode === 'engrave' ? 'subtract' : 'union', t, run: (x, RR) => applyDrape(x, t, o, RR || R) }); continue; }
        if (t.type === 'shell') {
          const replay = (ok) => replayFor(start, steps, o, R, ok);
          const r = shellBody(s, o, t.params, R, t.id, replay); s = r.solid;
          const kept = r.solidKept.filter(k => k.kind === 'union').map(k => k.name);   /* a skipped rounding just gets a sharp inner corner (exact) */
          if (kept.length) R.warnings.push({ kind: 'shell', id: t.id, text: `${t.name}: ${kept.join(', ')} ${kept.length > 1 ? 'stay' : 'stays'} solid (thinner than two walls)` });
          steps.push({ kind: 'shell', t, run: (x, RR) => shellBody(x, o, t.params, RR, t.id).solid });
          continue;
        }
        if (META.has(t.type)) continue;
        const tool = bodyOf(t.id, chain);
        const op = t.op || 'subtract', run = (x) => (op === 'add' || op === 'union' ? x.union(tool) : op === 'intersect' ? x.intersect(tool) : x.subtract(tool));
        s = run(s); steps.push({ kind: op === 'add' || op === 'union' ? 'union' : op, t, run });
      } catch (e) { R.errors.set(t.id, e.message); }
    }
    chain.delete(id);
    memo.set(id, s); return s;
  };
  for (const o of doc.objects) {
    if (o.into && !byId.has(o.into)) R.warnings.push({ kind: 'orphan', id: o.id, text: `${o.name}: its boolean target was deleted` });
    if (o.type === 'callout' && !byId.has(o.on)) R.warnings.push({ kind: 'orphan', id: o.id, text: `${o.name}: the part it labels was deleted` });
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
    if (o.type === 'plane' || o.type === 'halfspace') { R.planes = R.planes || []; if (o.type === 'plane') R.planes.push(o.id); continue; }   /* reference geometry, no body */
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
const SMOOTH = /:(side|surface|rev\d+|arc\d*|spl\d*|thread|shank|knurl|bore|rim)$/;
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
/* a projected sketch (drape): the flat sketch (or text) as a thin solid in its own frame, cut into small cells, laid onto the
   part as it is at this point in the history, then joined (emboss) or cut (engrave) */
function applyDrape(s, t, root, R) {
  const p = t.params, M = R.world.get(root.id); if (!M) throw new Error('its part has no position');
  const depth = +p.depth; if (!(depth > 0)) throw new Error('depth must be above 0');
  const emboss = p.mode !== 'engrave', eps = Math.min(0.2, depth * 0.25);
  const O = M4.point(M, p.origin || [0, 0, 0]), N = V.norm(M4.dir(M, p.normal || [0, 0, 1])), x0 = M4.dir(M, p.xdir || [1, 0, 0]);
  let X = V.sub(x0, V.mul(N, V.dot(x0, N))); if (V.len(X) < 1e-6) X = Math.abs(N[2]) < 0.9 ? V.cross([0, 0, 1], N) : [1, 0, 0]; X = V.norm(X); const Y = V.cross(N, X);
  let flat;
  if (p.text) flat = textSolid({ text: p.text, height: +p.size || 8, depth: depth + eps, weight: +p.weight > 0 ? +p.weight : undefined, spacing: p.spacing, align: 'center', path: 'line' });
  else flat = K.extrude(expandArcs(p.profile, p.arcs, { splines: p.splines }).pts, { length: depth + eps });
  flat = flat.transform(M4.translate([0, 0, emboss ? -eps : -depth]));
  const fb = flat.bbox(), cell = +p.cell > 0 ? +p.cell : Math.max(0.4, Math.min(2.5, Math.max(fb.max[0] - fb.min[0], fb.max[1] - fb.min[1]) / 30));
  const tool = K.drapeSolid(K.gridSplit(flat, cell), s, { O, X, Y, N }).tag(t.id);
  return emboss ? s.union(tool) : s.subtract(tool);
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
  recompute() { const t0 = performance.now(); this.result = evaluate(this.doc); this.followAnchors(); this.solveDims(); this.result.ms = performance.now() - t0; return this.result; }
  /* sketch anchors: points of a face sketch held on other parts' connectors (a corner, a face centre) follow them — after
     every evaluation the anchored sizes and places are brought up to date, and the model evaluated again (a few passes) */
  followAnchors() {
    const list = this.doc.objects.filter(o => Array.isArray(o.anchors) && o.anchors.length);
    if (!list.length) return;
    let missing = [], notes = [];
    for (let pass = 0; pass < 6; pass++) {
      missing = []; notes = []; let moved = false;
      for (const o of list) {
        if (this.result.off && this.result.off.has(o.id)) continue;
        try { if (followAnchorsOf(this.result, o, missing, notes)) moved = true; } catch (e) { notes.push({ o, text: e.message }); }
      }
      if (!moved) break;
      this.result = evaluate(this.doc);
    }
    for (const { o, a } of missing) this.result.warnings.push({ kind: 'anchor', id: o.id, text: `${o.name}: the ${a.conn} it follows on ${(this.get(a.obj) || {}).name || a.obj} is gone — it stays where it is (Properties → Follows to change it)` });
    for (const { o, text } of notes) this.result.warnings.push({ kind: 'anchor', id: o.id, text: `${o.name}: ${text}` });
  }
  /* the face connector of a part at a point (the face's normal there narrows it down), and that point as a slide on the
     face: what a click on a face turns into, so a feature placed there is mated to that face and follows it */
  faceAt(id, at, normal) {
    const faces = worldConnectors(this.result, id).filter(f => f.kind === 'face'), n = normal ? V.norm(normal) : null;
    const c = faces.filter(f => !n || V.dot(f.n, n) > 0.999).sort((x, y) => Math.abs(V.dot(V.sub(at, x.o), x.n)) - Math.abs(V.dot(V.sub(at, y.o), y.n)))[0];
    if (!c) return null;
    const d = V.sub(at, c.o);
    return { face: c.name, slide: [+V.dot(d, c.u).toFixed(3), +V.dot(d, V.cross(c.n, c.u)).toFixed(3)], off: Math.abs(V.dot(d, c.n)), conn: c };
  }
  /* the cylinder under a point on a curved face: a cylinder part's side, or any round surface (fitted from its facets,
     whose normals are all square to one axis). Returns the axis, radius, and where the point is round it */
  cylinderAt(id, at, normal) {
    const o = this.get(id), R = this.result; if (!o) return null;
    if (o.type === 'cylinder' && (!o.params.thread || o.params.thread === 'none') && R.world.has(id)) {
      const M = R.world.get(id), q = M4.point(M4.inv(M), at), r = o.params.diameter / 2;
      if (Math.abs(Math.hypot(q[0], q[1]) - r) > Math.max(0.6, r * 0.06) || q[2] < -1e-6 || q[2] > o.params.height + 1e-6) return null;
      return { id, primitive: true, radius: r, axis: V.norm(M4.dir(M, [0, 0, 1])), angle: +(Math.atan2(q[1], q[0]) * 180 / Math.PI).toFixed(4), height: +(q[2] - o.params.height / 2).toFixed(4), point: at };
    }
    const body = this.bodyContaining(id); if (!body || !normal) return null;
    /* the facets round the point (within a reach, facing within 50° of it): their normals all square to one axis */
    const n0 = V.norm(normal), bb = body.solid.bbox(), reach = Math.max(5, 0.3 * V.len(V.sub(bb.max, bb.min)));
    const fac = body.solid.polys.filter(q => { if (V.dot(q.plane.n, n0) < 0.64) return false; let c = [0, 0, 0]; for (const v of q.v) c = V.add(c, v.p); c = V.mul(c, 1 / q.v.length); return V.len(V.sub(c, at)) < reach; });
    if (fac.length < 3) return null;
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const q of fac) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += q.plane.n[r] * q.plane.n[c];
    let axis = null, al = 0; for (const [r1, r2] of [[0, 1], [1, 2], [0, 2]]) { const x = V.cross(C[r1], C[r2]), l = V.len(x); if (l > al) { al = l; axis = x; } }
    if (!axis || al < 1e-9) return null; axis = V.norm(axis);
    if (fac.some(q => Math.abs(V.dot(q.plane.n, axis)) > 0.03)) return null;     /* not a cylinder (a cone, a sphere, a flat face) */
    if (Math.max(...fac.map(q => V.len(V.cross(q.plane.n, n0)))) < 0.02) return null;   /* flat: no curvature to fit */
    /* circle through the facets' corners, seen along the axis */
    const e1 = V.norm(V.sub(n0, V.mul(axis, V.dot(n0, axis)))), e2 = V.cross(axis, e1), pts = [];
    for (const q of fac) for (const v of q.v) pts.push([V.dot(v.p, e1), V.dot(v.p, e2)]);
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const m = pts.length;
    for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, m]], b = [-sxz, -syz, -sz], det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D0 = det(A); if (Math.abs(D0) < 1e-12) return null; const col = (k) => A.map((row, r) => row.map((x, c) => (c === k ? b[r] : x)));
    const Dd = det(col(0)) / D0, Ee = det(col(1)) / D0, Ff = det(col(2)) / D0, cx = -Dd / 2, cy = -Ee / 2, rad = Math.sqrt(Math.max(0, cx * cx + cy * cy - Ff));
    if (!(rad > 0)) return null;
    const along = V.dot(at, axis), centre = V.add(V.add(V.mul(e1, cx), V.mul(e2, cy)), V.mul(axis, along));
    return { id: body.id, primitive: false, radius: +rad.toFixed(4), axis, origin: centre, point: at };
  }
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
        if (mover.mexpr && ['offset', 'slide.0', 'slide.1'].some(k => mover.mexpr[k])) { if (!this.result.warnings.some(w => w.kind === 'dim' && w.id === mover.id)) this.result.warnings.push({ kind: 'dim', id: mover.id, text: `${mover.name} is placed by a formula (${Object.entries(mover.mexpr).map(([k, e]) => k + ' ' + e).join(', ')}), so the driving dimension can't move it — unlink the formula or make the dimension a reference` }); continue; }
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
  /* swap in a document without an undo step (a shared room's state; changes made by other people) */
  replaceDoc(doc) { const vers = this.doc.versions; this.doc = doc; if (vers && !doc.versions) this.doc.versions = vers; this.recompute(); this.emit(); }
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
        if (o.anchors) ob.anchors = cleanAnchors(o.anchors) || undefined;
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
        if (o.anchors !== undefined) { const an = cleanAnchors(o.anchors); if (an) x.anchors = an; else delete x.anchors; }
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
        /* attached: a fixed place in the target's own frame (16 numbers, column-major) — it moves with the target */
        if (o.frame) {
          if (!Array.isArray(o.frame) || o.frame.length !== 16 || o.frame.some(v => !isFinite(+v))) throw new Error('frame is a 4×4 matrix: 16 numbers, column-major');
          x.mate = { to: o.to, frame: o.frame.map(Number) }; this.recompute(); return { label: 'Attach ' + x.name, id: x.id };
        }
        const tconns = o.to === 'origin' ? ORIGIN_CONNS : (this.result.conns.get(o.to) || connectorsOf(need(o.to), null));
        if (!this.result.conns.has(x.id) && x.type !== 'instance') this.recompute();   /* a part added in this batch: build it first so its own connectors exist */
        const sconns = this.result.conns.get(x.id) || (x.type === 'instance' ? this.result.conns.get(x.of) : null) || connectorsOf(x, null);
        const a = o.a || 'top', b = o.b || 'bottom';
        if (!tconns.find(c => c.name === a)) throw new Error(`No connector “${a}” on the target. Try: ${tconns.map(c => c.name).join(', ')}`);
        if (!sconns.find(c => c.name === b)) throw new Error(`No connector “${b}” on ${x.name}. Try: ${sconns.map(c => c.name).join(', ')}`);
        const kindA = tconns.find(c => c.name === a).kind, kindB = sconns.find(c => c.name === b).kind;
        const flip = o.flip != null ? !!o.flip : (kindA === 'face' && kindB === 'face') || (kindA === 'side' && kindB === 'side');
        /* offset, angle, tilt and either slide can be "=formula" (resolved with the parameter links); a number unlinks */
        const prev = x.mate && !x.mate.kind ? x.mate : null, mexpr = {}, isF = (v) => typeof v === 'string' && /^\s*=/.test(v);
        const mv = (key, v, fallback) => { if (isF(v)) { parseExpr(v); mexpr[key] = v.trim(); return fallback; } return num(v, 0); };
        const sl = Array.isArray(o.slide) ? o.slide : [0, 0], was = prev || {}, wsl = was.slide || [0, 0];
        x.mate = { to: o.to, a, b, flip, offset: mv('offset', o.offset, was.offset || 0), angle: mv('angle', o.angle, was.angle || 0), slide: [mv('slide.0', sl[0], wsl[0] || 0), mv('slide.1', sl[1], wsl[1] || 0)] };
        const tilt = mv('tilt', o.tilt, was.tilt || 0); if (tilt || mexpr.tilt) x.mate.tilt = tilt;
        if (Object.keys(mexpr).length) x.mexpr = mexpr; else delete x.mexpr;
        /* re-mating keeps the part's joint (its type, axis, limits, pitch); a joint can also be given here */
        if (prev && prev.joint && o.joint === undefined) { for (const k of ['joint', 'axis', 'limits', 'pitch']) if (prev[k] !== undefined) x.mate[k] = prev[k]; if (x.mate.joint === 'screw') x.mate.base = x.mate.offset - x.mate.pitch * (x.mate.angle || 0) / 360; }
        this.recompute();
        if (o.joint && o.joint !== 'fixed') this.op({ op: 'joint', id: x.id, joint: o.joint, axis: o.axis, limits: o.limits, pitch: o.pitch });
        return { label: 'Mate ' + x.name, id: x.id };
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
        const add = { op: 'add', type: o.op, id: o.id, name: o.name, params, at: o.at, rot: o.rot, mate: o.mate, into: o.into, mode: o.mode, color: o.color, fixed: o.fixed, stack: false, material: o.material, meta: o.meta, anchors: o.anchors };
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
      case 'callout': {
        /* {on: part, at:[x,y,z] (world, origin-relative with relative ops), dir (leader direction), along (the joint's direction), symbol, lines, kind} */
        const t = need(o.on), M = this.result.world.get(t.id); if (!M) throw new Error(`${t.name} has no position`);
        const Mi = M4.inv(M), id = o.id && !this.get(o.id) ? String(o.id) : uid('cal');
        const params = defaultParams('callout', { at: M4.point(Mi, W(o.at) || [0, 0, 0]).map(r6), dir: V.norm(M4.dir(Mi, o.dir || [0, 0, 1])).map(r6), along: V.norm(M4.dir(Mi, o.along || [1, 0, 0])).map(r6), symbol: o.symbol || null, lines: (o.lines || []).map(String), kind: o.kind || 'note', joint: o.joint || null });
        this.insert({ id, name: o.name || (o.kind === 'weld' ? 'Weld symbol' : 'Callout') + ' ' + (d.objects.filter(x => x.type === 'callout').length + 1), type: 'callout', on: t.id, params, mate: null, pose: null, into: null, op: null, color: null });
        return { label: 'Label ' + t.name, id };
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
        const x = need(o.id), xi = d.objects.indexOf(x); d.objects = d.objects.filter(y => y.id !== x.id && !(y.type === 'callout' && y.on === x.id));   /* a label goes with the part it labels */
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
        d.objects = d.objects.filter(y => { if ((y.type === 'edge' && !ids.has(y.into)) || (y.type === 'callout' && !ids.has(y.on))) { n++; return false; } return true; });
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
        /* make a mate a moving joint: {id, joint: fixed|revolute|slider|cylindrical|planar|screw (pitch), axis: n|u|v (slider), limits: {angle:[lo,hi], travel:[..], offset, u, v}} */
        const x = need(o.id); if (!x.mate) throw new Error(`${x.name} is not mated: mate it first, then make the mate a joint`);
        if (x.mate.kind) throw new Error(`${x.name} is placed by a ${x.mate.kind} mate; make its partner a joint instead and it will follow`);
        const j = o.joint || 'revolute'; if (j !== 'fixed' && !JOINTS[j]) throw new Error(`joint is one of fixed, ${Object.keys(JOINTS).join(', ')}`);
        x.mate = Object.assign({}, x.mate); if (j === 'fixed') { delete x.mate.joint; delete x.mate.limits; delete x.mate.axis; }
        else { x.mate.joint = j; if (o.axis) x.mate.axis = o.axis; else if (j === 'slider' && !x.mate.axis) x.mate.axis = 'n'; if (o.limits !== undefined) x.mate.limits = o.limits || undefined; }
        if (j === 'screw') {
          /* the pitch: given, kept from before, or read from the thread on this part or the one it is mated to (a nut on a bolt, a cap on a threaded neck) */
          const P = o.pitch != null && o.pitch !== '' ? +o.pitch : x.mate.pitch ? +x.mate.pitch : (threadPitchOf(x) || threadPitchOf(this.get(x.mate.to)));
          if (!P || !isFinite(P)) throw new Error(`a screw joint needs a pitch (mm per turn; negative for a left-hand thread): ${x.name} and ${(this.get(x.mate.to) || {}).name || 'what it is mated to'} have no modelled thread to take it from`);
          x.mate.pitch = P; x.mate.base = (x.mate.offset || 0) - P * (x.mate.angle || 0) / 360;
        } else { delete x.mate.pitch; delete x.mate.base; }
        this.recompute(); return { label: `${x.name}: ${j} joint`, id: x.id, joints: jointsOf(d).find(q => q.id === x.id) };
      }
      case 'drive': {
        /* set joint values: {values: {id: {angle: 30}} } or {id, key, value} */
        const vals = o.values || { [o.id]: { [o.key || 'angle']: o.value } };
        for (const [id, kv] of Object.entries(vals)) { const x = need(id); if (!x.mate || !x.mate.joint) throw new Error(`${x.name} is not a joint`); x.mate = Object.assign({}, x.mate); for (const [k, v] of Object.entries(kv)) { unlinkMateField(x, k); const lim = (x.mate.limits || {})[k]; dofSet(x.mate, k, lim ? Math.max(lim[0], Math.min(lim[1], +v)) : +v); } }
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
        const params = { size: o.size || 'M6', kind: o.kind || 'simple', fit: o.fit || 'normal', through, depth: +o.depth || 12, diameter: +o.diameter || 0, modelled: !!o.modelled && (o.kind === 'tapped'), left_hand: !!o.left_hand && !!o.modelled && (o.kind === 'tapped') };
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
      case 'wrap': {
        /* a sketch or text wrapped onto a cylindrical face: emboss (a boolean add) or engrave (a boolean remove). Placed by a
           point on the face (at + normal), or on a cylinder part by angle (° round from its x axis) and height (from its middle) */
        const t = need(o.target), root = (this.bodyContaining(t.id) || {}).id || t.id;
        const mode = /^(engrave|cut|subtract|remove)$/.test(o.mode || '') ? 'engrave' : 'emboss';
        let cyl = o.project ? null : o.at ? this.cylinderAt(t.id, W(o.at), o.normal) : t.type === 'cylinder' ? { id: t.id, primitive: true, radius: t.params.diameter / 2, angle: +o.angle || 0, height: +o.height || 0 } : null;
        if (!cyl) {
          /* not a cylinder (a sphere, a cone, a lofted or filleted surface…), or asked to project: a projected sketch */
          if (!o.at || !o.normal) throw new Error(`${t.name}: give at:[x,y,z] (a point on the face) and normal (the face's normal there) — on a cylinder part angle + height also work`);
          const body = this.bodyContaining(t.id); if (!body) throw new Error(`${t.name} has no geometry to project onto`);
          const rootObj = this.get(body.id), Mw = this.result.world.get(rootObj.id), Mi = M4.inv(Mw), n0 = V.norm(o.normal);
          let xw = o.xdir ? V.norm(o.xdir) : (Math.abs(n0[2]) < 0.9 ? V.norm(V.cross([0, 0, 1], n0)) : [1, 0, 0]);
          const dp = { depth: +o.depth || 1, mode, origin: M4.point(Mi, W(o.at)).map(r6), normal: V.norm(M4.dir(Mi, n0)).map(r6), xdir: V.norm(M4.dir(Mi, xw)).map(r6), cell: +o.cell || 0 };
          for (const k of ['profile', 'arcs', 'splines', 'text', 'size', 'weight', 'spacing']) if (o[k] !== undefined) dp[k] = o[k];
          if (o.shape) dp.profile = shapeProfile(o);
          if (!dp.text && !(Array.isArray(dp.profile) && dp.profile.length >= 3)) throw new Error('give text, a profile [[x,y]…] (in the plane square to normal, from at) or a shape');
          const pid = o.id && !this.get(o.id) ? String(o.id) : uid('drp'), pname = o.name || `${mode === 'engrave' ? 'Engrave' : 'Emboss'} projected${dp.text ? ' “' + String(dp.text).slice(0, 14) + '”' : ''}`;
          this.insert({ id: pid, name: pname, type: 'drape', params: Object.assign(defaultParams('drape'), dp), into: rootObj.id, op: mode === 'engrave' ? 'subtract' : 'add', mate: null, pose: null, fixed: false, color: null });
          this.recompute();
          if (this.result.errors.has(pid)) { const msg = this.result.errors.get(pid); throw new Error(`${pname}: ${msg}`); }
          return { label: `${pname} on ${t.name}`, id: pid, name: pname, projected: true };
        }
        const params = { depth: +o.depth || 1, mode, radius: cyl.radius };
        for (const k of ['profile', 'arcs', 'splines', 'text', 'size', 'weight', 'spacing']) if (o[k] !== undefined) params[k] = o[k];
        if (o.shape) params.profile = shapeProfile(o);
        if (!params.text && !(Array.isArray(params.profile) && params.profile.length >= 3)) throw new Error('give text, a profile [[s,t]…] (s round the face, t along it) or a shape');
        if (cyl.primitive && cyl.id === t.id) params.radius = `=${t.id}.diameter / 2`;   /* follows the cylinder */
        const name = o.name || `${mode === 'engrave' ? 'Engrave' : 'Emboss'} wrap${params.text ? ' “' + String(params.text).slice(0, 14) + '”' : ''}`;
        let place;
        if (cyl.primitive) place = { mate: { to: cyl.id, a: 'center', b: 'base', flip: false, angle: cyl.angle, offset: cyl.height } };
        else { const x = V.norm(V.sub(cyl.point, cyl.origin)), M = M4.frame(cyl.origin, V.sub(x, V.mul(cyl.axis, V.dot(x, cyl.axis))), cyl.axis), pose = poseFromMatrix(M); place = { at: pose.at, rot: pose.rot, fixed: true }; }
        const r = this.op(Object.assign({ op: 'add', type: 'wrap', id: o.id, name, params, into: root, mode: mode === 'engrave' ? 'subtract' : 'union', stack: false }, place));
        return { label: `${name} on ${t.name} (R${fmt(cyl.radius)})`, id: r.id, name };
      }
      case 'thread': {
        /* a modelled thread on a cylinder part: size M2…M24 (or custom with pitch), length (0 = all), from bottom | top, left_hand */
        const t = need(o.target); if (t.type !== 'cylinder') throw new Error(`${t.name} is not a cylinder: threads go on cylinder parts (or use a bolt, nut, or a tapped hole with modelled: true)`);
        const size = o.size || 'M8', patch = { thread: size, thread_length: +o.length || 0, thread_from: o.from === 'top' ? 'top' : 'bottom', left_hand: !!o.left_hand };
        if (size === 'custom') { if (!(+o.pitch > 0)) throw new Error('a custom thread needs a pitch'); patch.pitch = +o.pitch; if (o.diameter) patch.diameter = +o.diameter; }
        else { const T = threadSize(size); if (o.resize !== false) patch.diameter = T.d; }
        this.op({ op: 'set', id: t.id, params: patch });
        if (this.result.errors.has(t.id)) throw new Error(this.result.errors.get(t.id));
        return { label: `Thread ${size === 'custom' ? 'Ø' + t.params.diameter + '×' + patch.pitch : size} on ${t.name}`, id: t.id };
      }
      case 'plane': {
        /* a reference plane on a face (gap along its normal, tilt about its u axis, turn about the normal), or at a pose */
        const name = o.name || `Plane ${d.objects.filter(x => x.type === 'plane').length + 1}`, params = { size: +o.size || 60 };
        if (!o.target) return Object.assign(this.op({ op: 'add', type: 'plane', id: o.id, name, params, at: o.at, rot: o.rot, fixed: true, stack: false }), { label: 'Add ' + name });
        const t = need(o.target); let face = o.face || 'top', slide = o.slide || [0, 0];
        if (o.at) { const f = this.faceAt(t.id, W(o.at), o.normal); if (!f) throw new Error(`no flat face of ${t.name} there`); face = f.face; slide = f.slide; }
        if (!worldConnectors(this.result, t.id).some(c => c.name === face)) throw new Error(`${t.name} has no connector “${face}”`);
        const r = this.op({ op: 'add', type: 'plane', id: o.id, name, params, mate: { to: t.id, a: face, b: 'back', offset: +o.offset || 0, angle: +o.angle || 0, tilt: +o.tilt || 0, slide }, stack: false });
        return { label: `${name} on ${t.name} (${face}${o.offset ? ', ' + o.offset + ' mm out' : ''}${o.tilt ? ', tilted ' + o.tilt + '°' : ''})`, id: r.id, name };
      }
      case 'split': {
        /* cut a part with a plane: keep the side below it (against its normal), above it, or both as two parts */
        const t = need(o.target), root = (this.bodyContaining(t.id) || {}).id || t.id, keep = o.keep || 'below';
        if (!['below', 'above', 'both'].includes(keep)) throw new Error('keep is below, above or both');
        let to, conn = o.conn;
        if (typeof o.plane === 'string') { const pl = need(o.plane); to = pl.id; if (!conn) conn = 'plane'; }
        else if (o.plane && o.plane.obj) { to = need(o.plane.obj).id; conn = o.plane.conn || 'top'; }
        else throw new Error('plane: the id of a plane, or {obj, conn} (a face connector of a part)');
        if (!worldConnectors(this.result, to).some(c => c.name === conn)) throw new Error(`no connector “${conn}” on ${need(to).name}`);
        /* a half-space mated to that plane: flipped it fills the side the plane's normal points to (above), else the other side */
        const cutOff = (target, side) => this.op({ op: 'add', type: 'halfspace', name: `Split: remove ${side} ${need(to).name}`, params: { size: THROUGH }, mate: { to, a: conn, b: 'bottom', flip: side === 'above', offset: 0 }, into: target, mode: 'subtract', stack: false });
        if (keep === 'both') {
          const cp = this.op({ op: 'duplicate', id: root, offset: [0, 0], name: (o.name || this.get(root).name) + ' (above)' });
          cutOff(root, 'above'); cutOff(cp.id, 'below');
          this.recompute(); return { label: `Split ${t.name} in two`, id: root, other: cp.id };
        }
        cutOff(root, keep === 'below' ? 'above' : 'below');
        this.recompute(); return { label: `Split ${t.name}, keeping ${keep}`, id: root };
      }
      case 'helix': {
        /* a coil spring (or any profile swept along a helix): wire diameter, coil radius (to the wire's centre), pitch, turns */
        const wire = +o.wire || 2, seg = 24, prof = o.profile || Array.from({ length: seg }, (_, k) => [wire / 2 * Math.cos(2 * Math.PI * k / seg), wire / 2 * Math.sin(2 * Math.PI * k / seg)]);
        const helix = { radius: +o.radius || 10, pitch: +o.pitch || 5, turns: +o.turns || 5, left: !!o.left };
        if (!o.profile && helix.pitch <= wire) throw new Error(`a pitch of ${helix.pitch} is no more than the ${wire} wire: the coils would overlap (use a pitch above ${wire})`);
        const r = this.op({ op: 'add', type: 'sweep', id: o.id, name: o.name || 'Spring', params: { profile: prof, helix, path: [[0, 0, 0], [0, 0, 1]] }, at: o.at, rot: o.rot, mate: o.mate, into: o.into, mode: o.mode, fixed: o.fixed, stack: o.stack, material: o.material, meta: o.meta });
        return { label: `Helix: ${helix.turns} turns, pitch ${helix.pitch}, R${helix.radius}`, id: r.id, name: r.name };
      }
      case 'feature': {
        /* a boss (a boolean add standing on a face) or a cut (a boolean remove sunk flush into it): a simple shape mated
           to a face of a part, at a point on it, so it follows the face when the part changes */
        const t = need(o.target), root = (this.bodyContaining(t.id) || {}).id || t.id, type = o.shape || o.type || 'cylinder';
        if (!['box', 'cylinder', 'cone', 'wedge', 'sphere'].includes(type)) throw new Error(`a boss or cut is a box, cylinder, cone, wedge or sphere (for any other outline, sketch on the face)`);
        const mode = /^(cut|subtract|pocket|remove)$/.test(o.mode || '') ? 'subtract' : 'union', faces = worldConnectors(this.result, t.id).filter(c => c.kind === 'face');
        let face = o.face || 'top', slide = o.slide || [0, 0];
        if (o.at) { const f = this.faceAt(t.id, W(o.at), o.normal); if (!f) throw new Error(`no flat face of ${t.name} there`); face = f.face; slide = f.slide; }
        if (!faces.some(c => c.name === face)) throw new Error(`${t.name} has no face “${face}”. Faces: ${faces.map(c => c.name).join(', ')}`);
        const kind = mode === 'subtract' ? 'Cut' : 'Boss', n = d.objects.filter(x => new RegExp('^' + kind + ' \\d+$').test(x.name || '')).length + 1;
        const mate = mode === 'subtract' ? { to: t.id, a: face, b: 'top', flip: false, slide, angle: o.angle || 0 } : { to: t.id, a: face, b: 'bottom', slide, angle: o.angle || 0 };
        const r = this.op({ op: 'add', type, id: o.id, name: o.name || `${kind} ${n}`, params: o.params, mate, into: root, mode, color: o.color });
        return { label: `${kind} on ${t.name} (${face})`, id: r.id, name: o.name || `${kind} ${n}` };
      }
      case 'text': {
        /* text on a face: emboss (a boolean add, standing on the face) or engrave (a boolean remove, sunk into it) */
        const keys = ['text', 'height', 'depth', 'weight', 'spacing', 'path', 'radius', 'angle', 'align', 'points'], params = {};
        for (const k of keys) if (o[k] !== undefined) params[k] = o[k];
        if (o.params) Object.assign(params, o.params);
        if (params.text == null) throw new Error('text needs some text');
        const mode = /^(engrave|subtract|cut|remove)$/.test(o.mode || '') ? 'subtract' : 'union';
        const name = o.name || `${mode === 'subtract' ? 'Engrave' : o.target ? 'Emboss' : 'Text'} “${String(params.text).slice(0, 18)}”`;
        if (!o.target) return Object.assign(this.op({ op: 'add', type: 'text', id: o.id, name, params, at: o.at, rot: o.rot, fixed: o.fixed }), { label: 'Add ' + name });
        const t = need(o.target), root = (this.bodyContaining(t.id) || {}).id || t.id, faces = worldConnectors(this.result, t.id).filter(c => c.kind === 'face');
        let face = o.face || 'top', slide = o.slide || [0, 0];
        if (o.at) {
          /* a clicked point (and the face's normal there): the matching face connector, and the point as a slide on it */
          const f = this.faceAt(t.id, W(o.at), o.normal); if (!f) throw new Error(`no flat face of ${t.name} there for text`);
          face = f.face; slide = f.slide;
        }
        if (!faces.some(c => c.name === face)) throw new Error(`${t.name} has no face “${face}”. Faces: ${faces.map(c => c.name).join(', ')}`);
        const mate = mode === 'subtract' ? { to: t.id, a: face, b: 'top', flip: false, slide, angle: o.rotate || 0 } : { to: t.id, a: face, b: 'bottom', slide, angle: o.rotate || 0 };
        const r = this.op({ op: 'add', type: 'text', id: o.id, name, params, mate, into: root, mode });
        return { label: (mode === 'subtract' ? 'Engrave ' : 'Emboss ') + `“${String(params.text).slice(0, 24)}” on ${t.name}`, id: r.id, name };
      }
      case 'shell': {
        const t = need(o.target), body = this.bodyContaining(t.id), root = this.get((body || {}).id || t.id);
        if (!body) throw new Error(`${t.name} has no geometry to shell`);
        if (!(+o.thickness > 0)) throw new Error('thickness must be above 0');
        const id = o.id && !this.get(o.id) ? String(o.id) : uid('shl');
        this.insert({ id, name: o.name || `Shell ${o.thickness}`, type: 'shell', params: { thickness: +o.thickness, open: o.open || 'none' }, into: root.id, op: 'shell', pose: null, mate: null });
        this.recompute(); if (this.result.errors.has(id)) throw new Error(this.result.errors.get(id));   /* apply() rolls back */
        return { label: `Shell ${root.name} (${o.thickness} mm walls${o.open && o.open !== 'none' ? ', open ' + o.open : ''})`, id };
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
      case 'constrain': {
        /* add a sketch constraint to a polyline profile: {id, type, i, j?, value?} — value-driven ones get a parameter (a dimension) */
        const x = need(o.id), q = x.params; if (!Array.isArray(q.profile) || !Array.isArray(q.constraints) || (q.shape && q.shape !== 'points')) throw new Error(`${x.name} has no polyline sketch to constrain`);
        const k = SKETCH_KINDS[o.type]; if (!k) throw new Error(`type is one of ${Object.keys(SKETCH_KINDS).join(', ')}`);
        const c = { type: o.type, i: Math.round(o.i) }; if (k.args === 2) c.j = Math.round(o.j);
        if (k.fit) {
          const sp = (q.splines || []).find(z => z.i === c.i); if (!sp) throw new Error(`${k.label}: segment ${c.i + 1} is not a spline`);
          c.k = Math.round(+o.k || 0); if (!(c.k >= 0 && c.k < sp.pts.length)) throw new Error(`${k.label}: spline ${c.i + 1} has fit points 1…${sp.pts.length} (k is 0…${sp.pts.length - 1})`);
          if (o.type === 'fitfix') c.at = (o.at || sp.pts[c.k]).slice();
          else { let pn = 1; while (('d' + pn) in q) pn++; c.p = 'd' + pn; const v = o.value != null ? o.value : sp.pts[c.k][o.type === 'fitx' ? 0 : 1]; if (typeof v === 'string') { x.expr = Object.assign({}, x.expr || {}, { [c.p]: v }); q[c.p] = sp.pts[c.k][o.type === 'fitx' ? 0 : 1]; } else q[c.p] = Math.round(+v * 1e4) / 1e4; }
          q.constraints = [...q.constraints.filter(e => !(e.type === c.type && e.i === c.i && e.k === c.k)), c];
          if (o.type === 'fitfix') q.constraints = q.constraints.filter(e => !((e.type === 'fitx' || e.type === 'fity') && e.i === c.i && e.k === c.k));
          this.recompute(); return { label: `${k.label} ${c.i + 1}.${c.k + 1}`, id: x.id, constraint: c };
        }
        if (!k.point) for (const si of k.args === 2 ? [c.i, c.j] : [c.i]) if ((q.splines || []).some(z => z.i === si)) throw new Error(`${k.label}: segment ${si + 1} is a spline (a free curve through its points), so it has no straight direction or length to constrain — constrain its end points, or make it a line`);
        if (o.type === 'fix') c.at = o.at || q.profile[c.i % q.profile.length].slice();
        if (k.value) { let pn = 1; while (('d' + pn) in q) pn++; c.p = 'd' + pn; const v = o.value != null ? o.value : measureConstraint(q.profile, c, q.arcs); q[c.p] = typeof v === 'string' ? v : Math.round(v * 1e4) / 1e4; if (typeof v === 'string') { x.expr = Object.assign({}, x.expr || {}, { [c.p]: v }); q[c.p] = Math.round(measureConstraint(q.profile, c, q.arcs) * 1e4) / 1e4; } }
        q.constraints = [...q.constraints.filter(e => !(e.type === c.type && e.i === c.i && e.j === c.j && !k.value)), c];
        if (o.type === 'h') q.constraints = q.constraints.filter(e => !(e.type === 'v' && e.i === c.i)); if (o.type === 'v') q.constraints = q.constraints.filter(e => !(e.type === 'h' && e.i === c.i));
        this.recompute(); const st = this.result.sketch.get(x.id);
        return { label: `${k.label} ${c.i + 1}${c.j != null ? '/' + (c.j + 1) : ''}`, id: x.id, param: c.p, dof: st ? st.dof : null, ok: st ? st.ok : null };
      }
      case 'unconstrain': {
        const x = need(o.id), q = x.params, c = (q.constraints || [])[o.index]; if (!c) throw new Error('No constraint ' + o.index);
        q.constraints = q.constraints.filter((_, k) => k !== o.index); if (c.p && !q.constraints.some(e => e.p === c.p)) { delete q[c.p]; if (x.expr) delete x.expr[c.p]; }
        this.recompute(); return { label: `Remove ${SKETCH_KINDS[c.type].label.toLowerCase()}`, id: x.id };
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
          const c = JSON.parse(JSON.stringify(y)); c.id = map.get(y.id); delete c._resolved; delete c.anchors;   /* a copy beside it does not follow the original's corners */
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
      case 'unlink': { const x = need(o.id); if (/^mate\./.test(o.param || '')) { unlinkMateField(x, o.param.slice(5)); this.recompute(); return { label: `${x.name} ${o.param} unlinked`, id: x.id }; } if (x.expr) { delete x.expr[o.param]; if (!Object.keys(x.expr).length) delete x.expr; } this.recompute(); return { label: `${x.name}.${o.param} unlinked`, id: x.id }; }
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
  /* callouts placed in the world: [{id, name, on, point, dir, along, symbol, lines, kind}] — for the views and the drawings */
  callouts() {
    const out = [];
    for (const o of this.doc.objects) {
      if (o.type !== 'callout' || o.suppressed || o.hidden) continue; const M = this.result.world.get(o.on); if (!M) continue; const p = o.params;
      out.push({ id: o.id, name: o.name, on: o.on, point: M4.point(M, p.at), dir: V.norm(M4.dir(M, p.dir)), along: V.norm(M4.dir(M, p.along)), symbol: p.symbol, lines: p.lines || [], kind: p.kind });
    }
    return out;
  }
  addonContext() {
    const self = this;
    return { api: addonApi, get doc() { return self.doc; }, get result() { return self.result; }, get: (id) => self.get(id), describe: () => self.describe(), uid, ground: () => self.result.ground,
      /* geometry, for add-ons that work on what is there: the body (solid, world) holding an object, its world matrix, its material */
      bodyOf: (id) => self.bodyContaining(id) || null, world: (id) => self.result.world.get(id) || null,
      material: (id) => { const b = self.bodyContaining(id), o = self.get((b && b.id) || id); return (o && o.meta && o.meta.material) || self.doc.material || null; },
      materials: MATERIALS,
      /* a world point as the ops in this batch expect it (origin-relative when the batch is) */
      opPoint: (p) => (self.rel ? V.sub(p, self.result.originPoint) : p),
      worldPoint: (p) => (Array.isArray(p) && self.rel ? V.add(p.map(Number), self.result.originPoint) : p),
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
        return { id: o.id, name: o.name, type: o.type, addon: T && T.addon, params: o.params, info, at: META.has(o.type) ? undefined : at, mate: o.mate, mate_formulas: o.mexpr || undefined, boolean: o.into ? { into: o.into, mode: o.op } : null, fixed: !!o.fixed, resolved: o._resolved,
          sketch: R.sketch && R.sketch.has(o.id) ? { dof: R.sketch.get(o.id).dof, ok: R.sketch.get(o.id).ok, constraints: o.params.constraints, arcs: (o.params.arcs || []).length ? o.params.arcs : undefined, spline_fit: (o.params.splines || []).length ? R.sketch.get(o.id).fit : undefined } : undefined,
          suppressed: o.suppressed || undefined, rolled_back: R.off && R.off.has(o.id) && !o.suppressed ? true : undefined,
          of: o.of, joins: o.joins, anchors: o.anchors && o.anchors.length ? o.anchors : undefined, meta: o.meta && Object.keys(o.meta).length ? o.meta : undefined, links: o.expr && Object.keys(o.expr).length ? o.expr : undefined,
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
