/* SketchFlow 3D sketch constraints for profiles (extrude / revolve / loft) made of lines and arcs.
   Points P0…Pn-1 in the sketch plane; segment i runs Pi → P(i+1 mod n) (an open profile has no closing segment).
   A segment can be an arc: arcs = [{ i, c: [x, y], ccw }] — it runs from Pi to Pi+1 around centre c, counter-clockwise
   or clockwise. Its centre is an unknown too, held equidistant from both ends, so an arc adds one freedom: its radius.
   Constraints: h, v (segment horizontal / vertical — an arc's chord), length (segment, or chord), equal (two lines'
   lengths, or two arcs' radii), parallel, perpendicular, angle (between two segments, degrees), radius (an arc),
   tangent (two segments that meet: line–arc or arc–arc), concentric (two arcs), fix (point at x, y),
   fixx / fixy (one coordinate).
   A driving value lives in a parameter (c.p), so it is an ordinary editable dimension (links, formulas, configurations).
   Solved by damped Gauss-Newton (Levenberg–Marquardt): from the drawn shape, the smallest change that satisfies
   everything — so an under-defined sketch keeps the shape you drew. */

export const KINDS = {
  h: { label: 'Horizontal', args: 1 }, v: { label: 'Vertical', args: 1 }, length: { label: 'Length', args: 1, value: true },
  equal: { label: 'Equal', args: 2 }, parallel: { label: 'Parallel', args: 2 }, perpendicular: { label: 'Perpendicular', args: 2 },
  angle: { label: 'Angle', args: 2, value: true }, radius: { label: 'Radius', args: 1, value: true, arc: true },
  tangent: { label: 'Tangent', args: 2 }, concentric: { label: 'Concentric', args: 2, arc: true },
  fix: { label: 'Fix point', args: 1, point: true }, fixx: { label: 'Point x', args: 1, point: true, value: true }, fixy: { label: 'Point y', args: 1, point: true, value: true }
};
const TAU = 2 * Math.PI, normA = (t) => ((t % TAU) + TAU) % TAU;

/* where two segments meet: the shared point index, or -1 */
function sharedPoint(i, j, n) { if ((i + 1) % n === j) return j; if ((j + 1) % n === i) return i; return -1; }
function residuals(x, n, cons, val, scale, arcAt) {
  const P = (i) => [x[2 * (i % n)], x[2 * (i % n) + 1]], S = (i) => { const a = P(i), b = P(i + 1); return [b[0] - a[0], b[1] - a[1]]; };
  const C = (k) => [x[2 * n + 2 * k], x[2 * n + 2 * k + 1]], len = (v) => Math.hypot(v[0], v[1]) || 1e-12, r = [];
  const rad = (seg) => { const k = arcAt.get(seg), c = C(k), p = P(seg); return Math.hypot(p[0] - c[0], p[1] - c[1]); };
  /* every arc: its centre the same distance from both ends */
  for (const [seg, k] of arcAt) { const c = C(k), a = P(seg), b = P(seg + 1); r.push(Math.hypot(a[0] - c[0], a[1] - c[1]) - Math.hypot(b[0] - c[0], b[1] - c[1])); }
  for (const c of cons) {
    const i = c.i, j = c.j;
    switch (c.type) {
      case 'h': r.push(S(i)[1]); break;
      case 'v': r.push(S(i)[0]); break;
      case 'length': r.push(len(S(i)) - val(c)); break;
      case 'equal': r.push(arcAt.has(i) ? rad(i) - rad(j) : len(S(i)) - len(S(j))); break;
      case 'parallel': { const a = S(i), b = S(j); r.push((a[0] * b[1] - a[1] * b[0]) / len(b)); break; }
      case 'perpendicular': { const a = S(i), b = S(j); r.push((a[0] * b[0] + a[1] * b[1]) / len(b)); break; }
      case 'angle': { const a = S(i), b = S(j); let d = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) - val(c) * Math.PI / 180; d -= TAU * Math.round(d / TAU); r.push(d * scale); break; }
      case 'radius': r.push(rad(i) - val(c)); break;
      case 'concentric': { const a = C(arcAt.get(i)), b = C(arcAt.get(j)); r.push(a[0] - b[0], a[1] - b[1]); break; }
      case 'tangent': {
        const q = P(sharedPoint(i, j, n)), ai = arcAt.has(i), aj = arcAt.has(j);
        if (ai && aj) { const c1 = C(arcAt.get(i)), c2 = C(arcAt.get(j)), u = [q[0] - c1[0], q[1] - c1[1]], w = [q[0] - c2[0], q[1] - c2[1]]; r.push((u[0] * w[1] - u[1] * w[0]) / len(w)); }
        else if (ai || aj) { const arc = ai ? i : j, line = ai ? j : i, c0 = C(arcAt.get(arc)), d = S(line), rv = [q[0] - c0[0], q[1] - c0[1]]; r.push((d[0] * rv[0] + d[1] * rv[1]) / len(d)); }
        else { const a = S(i), b = S(j); r.push((a[0] * b[1] - a[1] * b[0]) / len(b)); }   /* two lines: collinear direction */
        break;
      }
      case 'fix': { const p = P(i), v = c.at || [0, 0]; r.push(p[0] - v[0], p[1] - v[1]); break; }
      case 'fixx': r.push(P(i)[0] - val(c)); break;
      case 'fixy': r.push(P(i)[1] - val(c)); break;
    }
  }
  return r;
}
/* solve A x = b (dense, partial pivoting) */
function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) continue; [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = Math.abs(M[r][r]) < 1e-14 ? 0 : s / M[r][r]; }
  return x;
}
function rank(J, tol) {
  const M = J.map(r => r.slice()), rows = M.length, cols = rows ? M[0].length : 0; let rk = 0;
  for (let c = 0; c < cols && rk < rows; c++) {
    let p = rk; for (let r = rk + 1; r < rows; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < tol) continue; [M[rk], M[p]] = [M[p], M[rk]];
    for (let r = rk + 1; r < rows; r++) { const f = M[r][c] / M[rk][c]; for (let k = c; k < cols; k++) M[r][k] -= f * M[rk][k]; }
    rk++;
  }
  return rk;
}
/* check the arcs list against the points: one arc per segment, each on a real segment */
function arcIndex(arcs, n, open) {
  const at = new Map();
  (arcs || []).forEach((a, k) => {
    if (!(a && Number.isInteger(a.i) && a.i >= 0 && a.i < (open ? n - 1 : n))) throw new Error(`arc ${k + 1}: segment ${a && a.i + 1} does not exist`);
    if (!Array.isArray(a.c) || a.c.length < 2 || !a.c.every(Number.isFinite)) throw new Error(`arc on segment ${a.i + 1} needs a centre c: [x, y]`);
    if (at.has(a.i)) throw new Error(`segment ${a.i + 1} has two arcs`);
    at.set(a.i, k);
  });
  return at;
}
export function solveSketch(points, cons, params = {}, arcs = [], opts = {}) {
  const n = points.length, m = (arcs || []).length;
  if (n < 2 || ((!cons || !cons.length) && !m)) return { points, arcs: arcs || [], ok: true, dof: 2 * n + m, residual: 0, conflicts: [] };
  const arcAt = arcIndex(arcs, n, opts.open);
  for (const c of cons || []) {
    const k = KINDS[c.type]; if (!k) throw new Error(`unknown sketch constraint ${c.type}`);
    if (!(c.i >= 0 && c.i < n) || (k.args === 2 && !(c.j >= 0 && c.j < n))) throw new Error(`${k.label}: segment/point ${c.i + 1}${k.args === 2 ? ' / ' + (c.j + 1) : ''} does not exist (the profile has ${n})`);
    if (c.type === 'radius' && !arcAt.has(c.i)) throw new Error(`Radius: segment ${c.i + 1} is not an arc`);
    if (c.type === 'concentric' && !(arcAt.has(c.i) && arcAt.has(c.j))) throw new Error('Concentric needs two arcs');
    if (c.type === 'equal' && arcAt.has(c.i) !== arcAt.has(c.j)) throw new Error('Equal works on two lines (lengths) or two arcs (radii)');
    if (c.type === 'tangent' && sharedPoint(c.i, c.j, n) < 0) throw new Error(`Tangent: segments ${c.i + 1} and ${c.j + 1} do not meet`);
  }
  cons = cons || [];
  const val = (c) => { const v = c.p != null ? params[c.p] : c.value; if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${KINDS[c.type].label} needs a value`); return v; };
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity; for (const [px, py] of points) { mnx = Math.min(mnx, px); mxx = Math.max(mxx, px); mny = Math.min(mny, py); mxy = Math.max(mxy, py); }
  const scale = Math.max(1, Math.hypot(mxx - mnx, mxy - mny)), tol = 1e-9 * scale, N = 2 * n + 2 * m;
  let x = points.flatMap(p => [+p[0], +p[1]]).concat((arcs || []).flatMap(a => [+a.c[0], +a.c[1]]));
  const F = (xx) => residuals(xx, n, cons, val, scale, arcAt);
  let r = F(x), err = Math.hypot(...r), lambda = 1e-3;
  const jac = (xx) => { const r0 = F(xx), J = r0.map(() => new Array(N).fill(0)), h = 1e-7 * scale; for (let k = 0; k < N; k++) { const x2 = xx.slice(); x2[k] += h; const r1 = F(x2); for (let q = 0; q < r0.length; q++) J[q][k] = (r1[q] - r0[q]) / h; } return J; };
  for (let it = 0; it < 200 && err > tol; it++) {
    const J = jac(x), A = Array.from({ length: N }, () => new Array(N).fill(0)), g = new Array(N).fill(0);
    for (let q = 0; q < J.length; q++) for (let a = 0; a < N; a++) { if (!J[q][a]) continue; g[a] += J[q][a] * r[q]; for (let b = 0; b < N; b++) A[a][b] += J[q][a] * J[q][b]; }
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const Ad = A.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (1 + v) : v))), dx = solveLinear(Ad, g.map(v => -v)), x2 = x.map((v, k) => v + dx[k]);
      const r2 = F(x2), e2 = Math.hypot(...r2);
      if (e2 < err) { x = x2; r = r2; err = e2; lambda = Math.max(1e-12, lambda / 4); improved = true; break; }
      lambda *= 8;
    }
    if (!improved) break;
  }
  const J = jac(x), rk = J.length ? rank(J, 1e-7 * Math.max(1, ...J.map(row => Math.max(...row.map(Math.abs))))) : 0, dof = N - rk;
  const ok = err <= 1e-6 * scale, conflicts = ok ? [] : cons.filter(c => Math.hypot(...residuals(x, n, [c], val, scale, arcAt).slice(arcAt.size)) > 1e-4 * scale);
  const rd = (v) => Math.round(v * 1e9) / 1e9;
  return { points: Array.from({ length: n }, (_, i) => [rd(x[2 * i]), rd(x[2 * i + 1])]), arcs: (arcs || []).map((a, k) => ({ i: a.i, c: [rd(x[2 * n + 2 * k]), rd(x[2 * n + 2 * k + 1])], ccw: !!a.ccw })), ok, dof, residual: err, conflicts };
}
/* constraints a fresh polyline gets automatically: near-horizontal / near-vertical lines (not arcs), and its first point fixed */
export function autoConstraints(points, tolDeg = 4, arcs = [], open = false) {
  const out = [{ type: 'fix', i: 0, at: [points[0][0], points[0][1]] }], t = Math.tan(tolDeg * Math.PI / 180), n = points.length, isArc = new Set((arcs || []).map(a => a.i));
  for (let i = 0; i < (open ? n - 1 : n); i++) { if (isArc.has(i)) continue; const a = points[i], b = points[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1]; if (Math.abs(dy) <= t * Math.abs(dx)) out.push({ type: 'h', i }); else if (Math.abs(dx) <= t * Math.abs(dy)) out.push({ type: 'v', i }); }
  return out;
}
/* measured value of a would-be constraint (to seed a new driving dimension) */
export function measure(points, c, arcs = []) {
  const n = points.length, P = (i) => points[i % n], S = (i) => [P(i + 1)[0] - P(i)[0], P(i + 1)[1] - P(i)[1]];
  if (c.type === 'length') return Math.hypot(...S(c.i));
  if (c.type === 'angle') { const a = S(c.i), b = S(c.j); return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180 / Math.PI; }
  if (c.type === 'radius') { const a = (arcs || []).find(q => q.i === c.i); if (!a) throw new Error(`segment ${c.i + 1} is not an arc`); return Math.hypot(P(c.i)[0] - a.c[0], P(c.i)[1] - a.c[1]); }
  if (c.type === 'fixx') return P(c.i)[0]; if (c.type === 'fixy') return P(c.i)[1];
  return null;
}
/* the sweep of an arc from a to b around c (radians, signed: + counter-clockwise) */
export function arcSweep(a, b, c, ccw) {
  const A = Math.atan2(a[1] - c[1], a[0] - c[0]), B = Math.atan2(b[1] - c[1], b[0] - c[0]);
  let s = ccw ? normA(B - A) : -normA(A - B); if (Math.abs(s) < 1e-12) s = ccw ? TAU : -TAU;
  return { start: A, sweep: s, r: (Math.hypot(a[0] - c[0], a[1] - c[1]) + Math.hypot(b[0] - c[0], b[1] - c[1])) / 2 };
}
/* the point halfway along an arc (for its radius dimension and its label) */
export function arcMid(a, b, c, ccw) { const { start, sweep, r } = arcSweep(a, b, c, ccw), t = start + sweep / 2; return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]; }
/* the outline as straight segments: each arc split into short chords (about every 6°). sides[k] names the face that
   segment k makes when extruded: 'side<i>' for line i, 'arc<i>' for every chord of arc i (one smooth face) */
export function expandArcs(points, arcs, opts = {}) {
  const n = points.length, open = !!opts.open, step = (opts.stepDeg || 6) * Math.PI / 180, by = new Map((arcs || []).map(a => [a.i, a])), spl = new Map((opts.splines || []).map(q => [q.i, q]));
  const pts = [], sides = [];
  for (let i = 0; i < n; i++) {
    pts.push(points[i]);
    if (open && i === n - 1) break;
    const sp = spl.get(i);
    if (sp) {
      /* a spline: through its fit points, smooth; its ends lean on the neighbouring points so it blends in */
      const prev = open && i === 0 ? null : points[(i - 1 + n) % n], next = open && i + 1 === n - 1 ? null : points[(i + 2) % n];
      const curve = splinePoints([points[i], ...sp.pts, points[(i + 1) % n]], prev && !spl.has((i - 1 + n) % n) && !by.has((i - 1 + n) % n) ? prev : null, next && !spl.has((i + 1) % n) && !by.has((i + 1) % n) ? next : null, opts.splineSteps || 10);
      for (let k = 1; k < curve.length - 1; k++) pts.push(curve[k]);
      for (let k = 0; k < curve.length - 1; k++) sides.push('spl' + i);
      continue;
    }
    const a = by.get(i);
    if (!a) { sides.push('side' + i); continue; }
    const b = points[(i + 1) % n], { start, sweep, r } = arcSweep(points[i], b, a.c, a.ccw), k = Math.max(2, Math.ceil(Math.abs(sweep) / step));
    for (let s = 1; s < k; s++) { const t = start + sweep * s / k; pts.push([a.c[0] + r * Math.cos(t), a.c[1] + r * Math.sin(t)]); }
    for (let s = 0; s < k; s++) sides.push('arc' + i);
  }
  return { pts, sides };
}
/* an arc through three points a → (through c) → b: its centre and direction, or null when they are in a line */
export function arcThrough(a, b, c) {
  const [ax, ay] = a, [bx, by] = b, [cx, cy] = c, D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-9 * (1 + Math.hypot(bx - ax, by - ay) ** 2)) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy, ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
  const A = Math.atan2(ay - uy, ax - ux), ccw = normA(Math.atan2(cy - uy, cx - ux) - A) < normA(Math.atan2(by - uy, bx - ux) - A);
  return { c: [ux, uy], ccw };
}
/* an arc from a that leaves along direction t (tangent to the line before it) and ends at b: centre and direction */
export function arcTangent(a, t, b) {
  const L = Math.hypot(t[0], t[1]) || 1, tx = t[0] / L, ty = t[1] / L, nx = -ty, ny = tx, d = [a[0] - b[0], a[1] - b[1]], den = 2 * (nx * d[0] + ny * d[1]);
  if (Math.abs(den) < 1e-9) return null;
  const s = -(d[0] * d[0] + d[1] * d[1]) / den;
  return { c: [a[0] + nx * s, a[1] + ny * s], ccw: s > 0 };
}
/* a smooth curve through points (centripetal Catmull–Rom, no loops or cusps); before / after are the neighbouring
   points beyond each end (or null: the curve then starts straight at its end) */
export function splinePoints(P, before, after, steps = 10) {
  if (P.length < 2) return P.slice();
  const ext = [before || [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]], ...P, after || [2 * P[P.length - 1][0] - P[P.length - 2][0], 2 * P[P.length - 1][1] - P[P.length - 2][1]]];
  const out = [P[0]];
  for (let k = 1; k < ext.length - 2; k++) {
    const p0 = ext[k - 1], p1 = ext[k], p2 = ext[k + 1], p3 = ext[k + 2], d = (a, b) => Math.max(1e-9, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3), L = (a, b, ta, tb, t) => [(a[0] * (tb - t) + b[0] * (t - ta)) / (tb - ta), (a[1] * (tb - t) + b[1] * (t - ta)) / (tb - ta)];
    for (let s = 1; s <= steps; s++) {
      const t = t1 + (t2 - t1) * s / steps;
      const A1 = L(p0, p1, t0, t1, t), A2 = L(p1, p2, t1, t2, t), A3 = L(p2, p3, t2, t3, t), B1 = L(A1, A2, t0, t2, t), B2 = L(A2, A3, t1, t3, t);
      out.push(s === steps ? p2 : L(B1, B2, t1, t2, t));
    }
  }
  return out;
}
