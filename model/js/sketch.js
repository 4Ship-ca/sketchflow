/* SketchFlow 3D sketch constraints for closed polylines (extrude / revolve / loft profiles).
   Points P0…Pn-1 in the sketch plane; segment i runs Pi → P(i+1 mod n).
   Constraints: h, v (segment horizontal / vertical), length (segment), equal (two segments), parallel, perpendicular,
   angle (between two segments, degrees), fix (point at x, y), fixx / fixy (one coordinate).
   A driving value lives in a parameter (c.p), so it is an ordinary editable dimension (links, formulas, configurations).
   Solved by damped Gauss-Newton (Levenberg–Marquardt): from the drawn shape, the smallest change that satisfies
   everything — so an under-defined sketch keeps the shape you drew. */

export const KINDS = {
  h: { label: 'Horizontal', args: 1 }, v: { label: 'Vertical', args: 1 }, length: { label: 'Length', args: 1, value: true },
  equal: { label: 'Equal', args: 2 }, parallel: { label: 'Parallel', args: 2 }, perpendicular: { label: 'Perpendicular', args: 2 },
  angle: { label: 'Angle', args: 2, value: true }, fix: { label: 'Fix point', args: 1, point: true }, fixx: { label: 'Point x', args: 1, point: true, value: true }, fixy: { label: 'Point y', args: 1, point: true, value: true }
};

function residuals(x, n, cons, val, scale) {
  const P = (i) => [x[2 * (i % n)], x[2 * (i % n) + 1]], S = (i) => { const a = P(i), b = P(i + 1); return [b[0] - a[0], b[1] - a[1]]; };
  const len = (v) => Math.hypot(v[0], v[1]) || 1e-12, r = [];
  for (const c of cons) {
    const i = c.i, j = c.j;
    switch (c.type) {
      case 'h': r.push(S(i)[1]); break;
      case 'v': r.push(S(i)[0]); break;
      case 'length': r.push(len(S(i)) - val(c)); break;
      case 'equal': r.push(len(S(i)) - len(S(j))); break;
      case 'parallel': { const a = S(i), b = S(j); r.push((a[0] * b[1] - a[1] * b[0]) / len(b)); break; }
      case 'perpendicular': { const a = S(i), b = S(j); r.push((a[0] * b[0] + a[1] * b[1]) / len(b)); break; }
      case 'angle': { const a = S(i), b = S(j); let d = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) - val(c) * Math.PI / 180; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); r.push(d * scale); break; }
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
export function solveSketch(points, cons, params = {}) {
  const n = points.length;
  if (n < 3 || !cons || !cons.length) return { points, ok: true, dof: 2 * n, residual: 0, conflicts: [] };
  for (const c of cons) { const k = KINDS[c.type]; if (!k) throw new Error(`unknown sketch constraint ${c.type}`); if (!(c.i >= 0 && c.i < n) || (k.args === 2 && !(c.j >= 0 && c.j < n))) throw new Error(`${k.label}: segment/point ${c.i + 1}${k.args === 2 ? ' / ' + (c.j + 1) : ''} does not exist (the profile has ${n})`); }
  const val = (c) => { const v = c.p != null ? params[c.p] : c.value; if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${KINDS[c.type].label} needs a value`); return v; };
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity; for (const [px, py] of points) { mnx = Math.min(mnx, px); mxx = Math.max(mxx, px); mny = Math.min(mny, py); mxy = Math.max(mxy, py); }
  const scale = Math.max(1, Math.hypot(mxx - mnx, mxy - mny)), tol = 1e-9 * scale;
  let x = points.flatMap(p => [+p[0], +p[1]]), r = residuals(x, n, cons, val, scale), err = Math.hypot(...r), lambda = 1e-3;
  const jac = (xx) => { const r0 = residuals(xx, n, cons, val, scale), J = r0.map(() => new Array(2 * n).fill(0)), h = 1e-7 * scale; for (let k = 0; k < 2 * n; k++) { const x2 = xx.slice(); x2[k] += h; const r1 = residuals(x2, n, cons, val, scale); for (let q = 0; q < r0.length; q++) J[q][k] = (r1[q] - r0[q]) / h; } return J; };
  for (let it = 0; it < 200 && err > tol; it++) {
    const J = jac(x), m = 2 * n, A = Array.from({ length: m }, () => new Array(m).fill(0)), g = new Array(m).fill(0);
    for (let q = 0; q < J.length; q++) for (let a = 0; a < m; a++) { if (!J[q][a]) continue; g[a] += J[q][a] * r[q]; for (let b = 0; b < m; b++) A[a][b] += J[q][a] * J[q][b]; }
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const Ad = A.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (1 + v) : v))), dx = solveLinear(Ad, g.map(v => -v)), x2 = x.map((v, k) => v + dx[k]);
      const r2 = residuals(x2, n, cons, val, scale), e2 = Math.hypot(...r2);
      if (e2 < err) { x = x2; r = r2; err = e2; lambda = Math.max(1e-12, lambda / 4); improved = true; break; }
      lambda *= 8;
    }
    if (!improved) break;
  }
  const J = jac(x), rk = rank(J, 1e-7 * Math.max(1, ...J.map(row => Math.max(...row.map(Math.abs))))), dof = 2 * n - rk;
  const ok = err <= 1e-6 * scale, conflicts = ok ? [] : cons.filter((c, k) => { const rr = residuals(x, n, [c], val, scale); return Math.hypot(...rr) > 1e-4 * scale; });
  return { points: Array.from({ length: n }, (_, i) => [Math.round(x[2 * i] * 1e9) / 1e9, Math.round(x[2 * i + 1] * 1e9) / 1e9]), ok, dof, residual: err, conflicts };
}
/* constraints a fresh polyline gets automatically: near-horizontal / near-vertical segments, and its first point fixed */
export function autoConstraints(points, tolDeg = 4) {
  const out = [{ type: 'fix', i: 0, at: [points[0][0], points[0][1]] }], t = Math.tan(tolDeg * Math.PI / 180), n = points.length;
  for (let i = 0; i < n; i++) { const a = points[i], b = points[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1]; if (Math.abs(dy) <= t * Math.abs(dx)) out.push({ type: 'h', i }); else if (Math.abs(dx) <= t * Math.abs(dy)) out.push({ type: 'v', i }); }
  return out;
}
/* measured value of a would-be constraint (to seed a new driving dimension) */
export function measure(points, c) {
  const n = points.length, P = (i) => points[i % n], S = (i) => [P(i + 1)[0] - P(i)[0], P(i + 1)[1] - P(i)[1]];
  if (c.type === 'length') return Math.hypot(...S(c.i));
  if (c.type === 'angle') { const a = S(c.i), b = S(c.j); return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180 / Math.PI; }
  if (c.type === 'fixx') return P(c.i)[0]; if (c.type === 'fixy') return P(c.i)[1];
  return null;
}
