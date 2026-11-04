/* SketchFlow 3D interference & collision.
   interference(): which parts overlap, by how much (exact boolean intersection for parts of moderate size, a voxel
   estimate for big ones), and the overlapping region to show.
   collisionProbe() / collides(): a fast test for motion frames — sample points just inside each part's surface are
   tested against the other part with grid-accelerated ray parity, so parts that only touch never count. */
import * as K from './kernel.js';
const { V, M4 } = K;

const probeCache = new WeakMap();
/* a part's triangles in a grid over (y, z) for +x rays, its bbox, and surface sample points pushed inward a little */
export function collisionProbe(solid, maxPoints = 1800) {
  let pr = probeCache.get(solid); if (pr) return pr;
  const m = solid.toMesh(), P = m.positions, N = m.normals, tris = [], bb = solid.bbox(), G = 48;
  for (let i = 0; i < P.length; i += 9) tris.push([P[i], P[i + 1], P[i + 2], P[i + 3], P[i + 4], P[i + 5], P[i + 6], P[i + 7], P[i + 8]]);
  const cy = (bb.max[1] - bb.min[1]) / G || 1, cz = (bb.max[2] - bb.min[2]) / G || 1, grid = Array.from({ length: G * G }, () => []);
  const cell = (y, z) => [Math.max(0, Math.min(G - 1, Math.floor((y - bb.min[1]) / cy))), Math.max(0, Math.min(G - 1, Math.floor((z - bb.min[2]) / cz)))];
  tris.forEach((t, i) => { const a = cell(Math.min(t[1], t[4], t[7]), Math.min(t[2], t[5], t[8])), b = cell(Math.max(t[1], t[4], t[7]), Math.max(t[2], t[5], t[8])); for (let y = a[0]; y <= b[0]; y++) for (let z = a[1]; z <= b[1]; z++) grid[z * G + y].push(i); });
  const size = V.len(V.sub(bb.max, bb.min)), inset = Math.max(0.02, size * 5e-4);
  /* sample points: vertices and centres of larger triangles, moved inward along the surface normal */
  const seen = new Set(), pts = [];
  for (let i = 0; i < P.length; i += 3) {
    const k = Math.round(P[i] * 1e3) + ',' + Math.round(P[i + 1] * 1e3) + ',' + Math.round(P[i + 2] * 1e3); if (seen.has(k)) continue; seen.add(k);
    pts.push([P[i] - N[i] * inset, P[i + 1] - N[i + 1] * inset, P[i + 2] - N[i + 2] * inset]);
  }
  const areaMin = size * size * 1e-4;
  for (let i = 0; i < P.length; i += 9) {
    const a = [P[i], P[i + 1], P[i + 2]], b = [P[i + 3], P[i + 4], P[i + 5]], c = [P[i + 6], P[i + 7], P[i + 8]], cr = V.cross(V.sub(b, a), V.sub(c, a)), ar = V.len(cr) / 2;
    if (ar < areaMin) continue; const n = V.norm(cr), g = V.mul(V.add(V.add(a, b), c), 1 / 3); pts.push(V.sub(g, V.mul(n, inset)));
  }
  /* points along the edges too: two thin parts crossing like an X have no corner inside each other */
  const ctr = V.lerp(bb.min, bb.max, 0.5), stepL = Math.max(size / 30, 0.5), edgePts = [];
  for (const [a, b] of K.creaseEdges(solid)) { const L = V.len(V.sub(b, a)), n = Math.min(60, Math.floor(L / stepL)); for (let k = 1; k < n; k++) { const q = V.lerp(a, b, k / n), toC = V.sub(ctr, q), l = V.len(toC) || 1; edgePts.push(V.add(q, V.mul(toC, inset / l))); } }
  let sample = pts, budget = Math.max(200, maxPoints - Math.min(edgePts.length, maxPoints / 2));
  if (pts.length > budget) { const step = pts.length / budget; sample = Array.from({ length: budget }, (_, k) => pts[Math.floor(k * step)]); }
  const eb = Math.min(edgePts.length, maxPoints - sample.length); if (eb > 0) { const step = edgePts.length / eb; for (let k = 0; k < eb; k++) sample.push(edgePts[Math.floor(k * step)]); }
  pr = { tris, grid, G, cy, cz, bb, points: sample, inset, size }; probeCache.set(solid, pr); return pr;
}
/* is point q (in the probe's own frame) inside its solid? ray along +x, count crossings */
export function inside(pr, q0) {
  /* a straight +x ray (it stays in its grid cell); the start is nudged off grid-aligned edges and vertices */
  const q = [q0[0], q0[1] + 1.37e-6 * (1 + pr.size * 1e-3), q0[2] + 2.91e-6 * (1 + pr.size * 1e-3)];
  const { bb } = pr; if (q[0] > bb.max[0] || q[1] < bb.min[1] || q[1] > bb.max[1] || q[2] < bb.min[2] || q[2] > bb.max[2]) return false;
  const y = Math.max(0, Math.min(pr.G - 1, Math.floor((q[1] - bb.min[1]) / pr.cy))), z = Math.max(0, Math.min(pr.G - 1, Math.floor((q[2] - bb.min[2]) / pr.cz)));
  const d = [1, 0, 0]; let n = 0;
  for (const i of pr.grid[z * pr.G + y]) {
    const t = pr.tris[i]; if (Math.max(t[0], t[3], t[6]) < q[0]) continue;
    const e1 = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], e2 = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]; if (Math.abs(det) < 1e-14) continue;
    const s = [q[0] - t[0], q[1] - t[1], q[2] - t[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det; if (u < 0 || u > 1) continue;
    const qq = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (d[0] * qq[0] + d[1] * qq[1] + d[2] * qq[2]) / det; if (v < 0 || u + v > 1) continue;
    if ((e2[0] * qq[0] + e2[1] * qq[1] + e2[2] * qq[2]) / det > 1e-9) n++;
  }
  return n % 2 === 1;
}
const bboxOf = (bb, M) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const x of [bb.min[0], bb.max[0]]) for (const y of [bb.min[1], bb.max[1]]) for (const z of [bb.min[2], bb.max[2]]) { const p = M ? M4.point(M, [x, y, z]) : [x, y, z]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } } return { min: mn, max: mx }; };
const overlapBox = (a, b, pad = 0) => { const mn = [0, 1, 2].map(k => Math.max(a.min[k], b.min[k])), mx = [0, 1, 2].map(k => Math.min(a.max[k], b.max[k])); return mn.every((v, k) => v < mx[k] - pad) ? { min: mn, max: mx } : null; };
/* how many of A's sample points (A placed by MA) are inside B (placed by MB) */
export function penetration(prA, MA, prB, MB, stopAt = Infinity) {
  const rel = M4.mul(M4.inv(MB), MA); let n = 0;
  for (const q of prA.points) { if (inside(prB, M4.point(rel, q))) { n++; if (n >= stopAt) break; } }
  return n;
}
/* pairs of bodies that should not overlap (a weld bead touches what it joins by design) */
export function checkPairs(model) {
  const R = model.result, bodies = R.bodies.filter(b => !b.hidden && !b.solid.isEmpty()), pairs = [];
  const joins = new Map(); for (const o of model.doc.objects) if (o.type === 'weld') joins.set(o.id, new Set((o.joins || []).map(id => (model.bodyContaining(id) || {}).id)));
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j];
    if ((joins.get(a.id) && joins.get(a.id).has(b.id)) || (joins.get(b.id) && joins.get(b.id).has(a.id))) continue;
    pairs.push([a, b]);
  }
  return pairs;
}
/* one-click interference check */
export function interference(model, opts = {}) {
  const out = [], maxExact = opts.maxExact || 7000;
  for (const [a, b] of checkPairs(model)) {
    const ob = overlapBox(a.solid.bbox(), b.solid.bbox(), 1e-6); if (!ob) continue;
    const exact = a.solid.polys.length + b.solid.polys.length <= maxExact;
    if (exact) {
      const I = a.solid.intersect(b.solid), v = Math.abs(I.volume());
      if (v > 1e-3) out.push({ a: a.id, b: b.id, names: [a.name, b.name], volume: +v.toFixed(3), exact: true, region: I, bbox: I.bbox() });
      continue;
    }
    /* big parts: voxels in the overlap box that are inside both */
    const pa = collisionProbe(a.solid), pb = collisionProbe(b.solid), ext = V.sub(ob.max, ob.min), cellSz = Math.max(Math.max(...ext) / 28, 0.15), nx = Math.max(1, Math.ceil(ext[0] / cellSz)), ny = Math.max(1, Math.ceil(ext[1] / cellSz)), nz = Math.max(1, Math.ceil(ext[2] / cellSz));
    const vox = []; let hits = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      const q = [ob.min[0] + (i + 0.5) * ext[0] / nx, ob.min[1] + (j + 0.5) * ext[1] / ny, ob.min[2] + (k + 0.5) * ext[2] / nz];
      if (inside(pa, q) && inside(pb, q)) { hits++; if (vox.length < 3000) vox.push(q); }
    }
    if (!hits) { const pen = penetration(pa, M4.ident(), pb, M4.ident(), 3) + penetration(pb, M4.ident(), pa, M4.ident(), 3); if (pen < 3) continue; }
    const cv = (ext[0] / nx) * (ext[1] / ny) * (ext[2] / nz), polys = [];
    for (const q of vox) polys.push(...K.box(ext[0] / nx, ext[1] / ny, ext[2] / nz).transform(M4.translate([q[0], q[1], q[2] - ext[2] / nz / 2])).polys);
    out.push({ a: a.id, b: b.id, names: [a.name, b.name], volume: +(hits * cv).toFixed(2), exact: false, region: new K.Solid(polys), bbox: ob });
  }
  return out.sort((x, y) => y.volume - x.volume);
}
/* collisions at a motion pose: bodies with their pose matrices (relative to where they were built); baseline pairs that
   already overlapped at rest are skipped. Returns [{a, b, count}] */
export function collisions(model, deltas, opts = {}) {
  const out = [], base = opts.baseline || new Set(), moving = new Set([...deltas.keys()]);
  for (const [a, b] of checkPairs(model)) {
    const key = a.id + '|' + b.id; if (base.has(key)) continue;
    const Ma = deltas.get(a.id) || M4.ident(), Mb = deltas.get(b.id) || M4.ident();
    if (!moving.has(a.id) && !moving.has(b.id)) continue;
    if (!overlapBox(bboxOf(a.solid.bbox(), Ma), bboxOf(b.solid.bbox(), Mb), 1e-6)) continue;
    const pa = collisionProbe(a.solid), pb = collisionProbe(b.solid);
    const n = penetration(pa, Ma, pb, Mb, opts.stopAt || 3) + penetration(pb, Mb, pa, Ma, opts.stopAt || 3);
    if (n >= (opts.min || 2)) out.push({ a: a.id, b: b.id, names: [a.name, b.name], count: n });
  }
  return out;
}
export function restBaseline(model) {
  const s = new Set(); for (const r of interference(model, { maxExact: 0 })) s.add(r.a + '|' + r.b); return s;
}
