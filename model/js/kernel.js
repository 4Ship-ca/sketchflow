/* SketchFlow 3D kernel (v2) — self-contained solid modelling: no third-party code.
   Solids are closed sets of outward-facing convex polygons; booleans use BSP trees (iterative, no deep recursion).
   Every polygon carries a surface id (sid) so drawings can find real edges after booleans split faces.
   Kept behind a narrow interface (Solid + builders + edges) so a different engine can be swapped in later. */

export const EPS = 1e-5;
/* ---------- vectors ---------- */
export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  neg: (a) => [-a[0], -a[1], -a[2]]
};
/* column-major 4x4 (same layout as WebGL) */
export const M4 = {
  ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  point: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]],
  dir: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]],
  translate: (t) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1],
  /* frame from origin + x axis + z axis (y = z × x) */
  frame(o, x, z) { z = V.norm(z); x = V.norm(V.sub(x, V.mul(z, V.dot(x, z)))); const y = V.cross(z, x); return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1]; },
  /* rigid inverse */
  inv(m) { const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]; const t = M4.dir(r, [m[12], m[13], m[14]]); r[12] = -t[0]; r[13] = -t[1]; r[14] = -t[2]; return r; },
  /* rotation from Euler degrees, applied X then Y then Z */
  euler(rx, ry, rz) {
    const [a, b, c] = [rx, ry, rz].map(d => d * Math.PI / 180);
    const X = [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
    const Y = [Math.cos(b), 0, -Math.sin(b), 0, 0, 1, 0, 0, Math.sin(b), 0, Math.cos(b), 0, 0, 0, 0, 1];
    const Z = [Math.cos(c), Math.sin(c), 0, 0, -Math.sin(c), Math.cos(c), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return M4.mul(Z, M4.mul(Y, X));
  },
  axisAngle(ax, deg) {
    const [x, y, z] = V.norm(ax), a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
  }
};

/* ---------- polygons & planes ---------- */
class Plane {
  constructor(n, w) { this.n = n; this.w = w; }
  static from(a, b, c) { const n = V.norm(V.cross(V.sub(b, a), V.sub(c, a))); return new Plane(n, V.dot(n, a)); }
  clone() { return new Plane(this.n.slice(), this.w); }
  flip() { this.n = V.neg(this.n); this.w = -this.w; }
  split(poly, cf, cb, f, b) {
    const types = [], vs = poly.v; let type = 0;
    for (const v of vs) { const t = V.dot(this.n, v.p) - this.w, ty = t < -EPS ? 2 : t > EPS ? 1 : 0; type |= ty; types.push(ty); }
    if (type === 0) { (V.dot(this.n, poly.plane.n) > 0 ? cf : cb).push(poly); return; }
    if (type === 1) { f.push(poly); return; }
    if (type === 2) { b.push(poly); return; }
    const fv = [], bv = [];
    for (let i = 0; i < vs.length; i++) {
      const j = (i + 1) % vs.length, ti = types[i], tj = types[j], vi = vs[i], vj = vs[j];
      if (ti !== 2) fv.push(vi);
      if (ti !== 1) bv.push(vi);
      if ((ti | tj) === 3) {
        const t = (this.w - V.dot(this.n, vi.p)) / V.dot(this.n, V.sub(vj.p, vi.p));
        const v = { p: V.lerp(vi.p, vj.p, t), n: V.norm(V.lerp(vi.n, vj.n, t)) };
        fv.push(v); bv.push(v);
      }
    }
    if (fv.length >= 3) f.push(new Poly(fv, poly.sid, poly.plane));
    if (bv.length >= 3) b.push(new Poly(bv, poly.sid, poly.plane));
  }
}
export class Poly {
  constructor(v, sid, plane) { this.v = v; this.sid = sid; this.plane = plane || Plane.from(v[0].p, v[1].p, v[2].p); }
  clone() { return new Poly(this.v.map(x => ({ p: x.p.slice(), n: x.n.slice() })), this.sid, this.plane.clone()); }
  flip() { this.v.reverse(); this.v = this.v.map(x => ({ p: x.p, n: V.neg(x.n) })); this.plane = this.plane.clone(); this.plane.flip(); }
}
/* build a polygon from points; flat normal unless per-vertex normals given */
export function poly(pts, sid, normals) {
  const pl = planeOf(pts); if (!pl) return null;
  return new Poly(pts.map((p, i) => ({ p, n: normals ? normals[i] : pl.n })), sid, pl);
}
function planeOf(pts) {
  /* Newell's method: robust for any planar polygon */
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
  const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return null;
  const n = [nx / l, ny / l, nz / l]; return new Plane(n, V.dot(n, pts[0]));
}

/* ---------- BSP (iterative) ---------- */
class Node {
  constructor() { this.plane = null; this.front = null; this.back = null; this.polys = []; }
  nodes() { const out = [], st = [this]; while (st.length) { const n = st.pop(); out.push(n); if (n.front) st.push(n.front); if (n.back) st.push(n.back); } return out; }
  invert() { for (const n of this.nodes()) { for (const p of n.polys) p.flip(); if (n.plane) n.plane.flip(); const t = n.front; n.front = n.back; n.back = t; } }
  clipPolygons(polys) {
    const out = [], st = [[this, polys]];
    while (st.length) {
      const [n, ps] = st.pop();
      if (!n.plane) { for (const p of ps) out.push(p); continue; }
      const f = [], b = [];
      for (const p of ps) n.plane.split(p, f, b, f, b);
      if (n.front) st.push([n.front, f]); else for (const p of f) out.push(p);
      if (n.back) st.push([n.back, b]);
    }
    return out;
  }
  clipTo(bsp) { for (const n of this.nodes()) n.polys = bsp.clipPolygons(n.polys); }
  all() { const out = []; for (const n of this.nodes()) for (const p of n.polys) out.push(p); return out; }
  build(polys) {
    if (!polys.length) return;
    const st = [[this, polys]];
    while (st.length) {
      const [n, ps] = st.pop();
      if (!ps.length) continue;
      if (!n.plane) n.plane = ps[0].plane.clone();
      const f = [], b = [];
      for (const p of ps) n.plane.split(p, n.polys, n.polys, f, b);
      if (f.length) { if (!n.front) n.front = new Node(); st.push([n.front, f]); }
      if (b.length) { if (!n.back) n.back = new Node(); st.push([n.back, b]); }
    }
  }
}

/* ---------- Solid ---------- */
export class Solid {
  constructor(polys) { this.polys = polys || []; }
  clone() { return new Solid(this.polys.map(p => p.clone())); }
  static empty() { return new Solid([]); }
  isEmpty() { return this.polys.length === 0; }
  union(o) {
    if (this.isEmpty()) return o.clone(); if (o.isEmpty()) return this.clone();
    const a = new Node(), b = new Node(); a.build(this.clone().polys); b.build(o.clone().polys);
    a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all());
    return new Solid(a.all());
  }
  subtract(o) {
    if (this.isEmpty() || o.isEmpty()) return this.clone();
    const a = new Node(), b = new Node(); a.build(this.clone().polys); b.build(o.clone().polys);
    a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); a.invert();
    return new Solid(a.all());
  }
  intersect(o) {
    if (this.isEmpty() || o.isEmpty()) return Solid.empty();
    const a = new Node(), b = new Node(); a.build(this.clone().polys); b.build(o.clone().polys);
    a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.all()); a.invert();
    return new Solid(a.all());
  }
  transform(m) {
    const flip = M4det(m) < 0;
    const polys = this.polys.map(p => {
      const v = p.v.map(x => ({ p: M4.point(m, x.p), n: V.norm(M4.dir(m, x.n)) }));
      const q = new Poly(v, p.sid); if (flip) q.flip(); return q;
    });
    return new Solid(polys);
  }
  /* rename surfaces (sid prefix = owning object) */
  tag(prefix) { for (const p of this.polys) if (!p.sid.startsWith(prefix + ':')) p.sid = prefix + ':' + p.sid; return this; }
  bbox() {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of this.polys) for (const v of p.v) for (let k = 0; k < 3; k++) { if (v.p[k] < mn[k]) mn[k] = v.p[k]; if (v.p[k] > mx[k]) mx[k] = v.p[k]; }
    return { min: mn, max: mx };
  }
  volume() { let s = 0; for (const p of this.polys) { const a = p.v[0].p; for (let i = 1; i < p.v.length - 1; i++) s += V.dot(a, V.cross(p.v[i].p, p.v[i + 1].p)); } return s / 6; }
  /* volume, centroid and inertia tensor about the centroid (unit density), by summing signed tetrahedra from the origin */
  massProps() {
    let V0 = 0; const c = [0, 0, 0], C = [0, 0, 0, 0, 0, 0];   /* second moments xx yy zz xy yz zx */
    for (const p of this.polys) {
      const a = p.v[0].p;
      for (let i = 1; i < p.v.length - 1; i++) {
        const b = p.v[i].p, d = p.v[i + 1].p, v = V.dot(a, V.cross(b, d)) / 6; if (!v) continue;
        V0 += v; for (let k = 0; k < 3; k++) c[k] += v * (a[k] + b[k] + d[k]) / 4;
        const s = [a[0] + b[0] + d[0], a[1] + b[1] + d[1], a[2] + b[2] + d[2]], f = v / 20;
        const sq = (i2, j2) => a[i2] * a[j2] + b[i2] * b[j2] + d[i2] * d[j2] + s[i2] * s[j2];
        C[0] += f * sq(0, 0); C[1] += f * sq(1, 1); C[2] += f * sq(2, 2); C[3] += f * sq(0, 1); C[4] += f * sq(1, 2); C[5] += f * sq(2, 0);
      }
    }
    if (Math.abs(V0) < 1e-12) return { volume: 0, centroid: [0, 0, 0], inertia: [0, 0, 0, 0, 0, 0] };
    const g = c.map(x => x / V0);
    /* about the centroid: shift second moments, then I = trace·1 − C */
    const xx = C[0] - V0 * g[0] * g[0], yy = C[1] - V0 * g[1] * g[1], zz = C[2] - V0 * g[2] * g[2], xy = C[3] - V0 * g[0] * g[1], yz = C[4] - V0 * g[1] * g[2], zx = C[5] - V0 * g[2] * g[0];
    return { volume: V0, centroid: g, inertia: [yy + zz, zz + xx, xx + yy, -xy, -yz, -zx] };   /* Ixx Iyy Izz Ixy Iyz Izx per unit density */
  }
  area() { let s = 0; for (const p of this.polys) { const a = p.v[0].p; for (let i = 1; i < p.v.length - 1; i++) s += V.len(V.cross(V.sub(p.v[i].p, a), V.sub(p.v[i + 1].p, a))) / 2; } return s; }
  /* triangles for rendering / export. Booleans leave T-junctions (a vertex of one polygon in the middle of its
     neighbour's edge) which show as pixel cracks and make STL files leaky; repair them by inserting those vertices
     into the neighbour's edge and fanning that polygon from its centre. */
  toMesh() {
    const lines = new Map(), info = this.polys.map(p => p.v.map((v, i) => {
      const a = v.p, b = p.v[(i + 1) % p.v.length].p; if (V.len(V.sub(b, a)) < 1e-9) return null;
      const lk = lineKey(a, b); let L = lines.get(lk.key); if (!L) { L = { d: lk.d, ts: [] }; lines.set(lk.key, L); }
      L.ts.push(V.dot(a, L.d), V.dot(b, L.d)); return L;
    }));
    for (const L of lines.values()) { L.ts.sort((x, y) => x - y); const u = []; for (const t of L.ts) if (!u.length || t - u[u.length - 1] > 1e-6) u.push(t); L.ts = u; }
    const pos = [], nrm = [], sids = [], tri = [];
    const put = (P, N) => { pos.push(P[0], P[1], P[2]); nrm.push(N[0], N[1], N[2]); };
    this.polys.forEach((p, pi) => {
      const ring = []; let added = false;
      p.v.forEach((v, i) => {
        ring.push(v); const L = info[pi][i]; if (!L) return;
        const w = p.v[(i + 1) % p.v.length], ta = V.dot(v.p, L.d), tb = V.dot(w.p, L.d), lo = Math.min(ta, tb) + 1e-5, hi = Math.max(ta, tb) - 1e-5;
        const ts = L.ts; let k0 = 0, k1 = ts.length; while (k0 < k1) { const h = (k0 + k1) >> 1; if (ts[h] <= lo) k0 = h + 1; else k1 = h; }
        const mid = []; for (let k = k0; k < ts.length && ts[k] < hi; k++) mid.push(ts[k]); if (!mid.length) return;
        if (tb < ta) mid.reverse();
        for (const t of mid) { const f = (t - ta) / (tb - ta); ring.push({ p: V.lerp(v.p, w.p, f), n: V.norm(V.lerp(v.n, w.n, f)) }); }
        added = true;
      });
      if (!added) {
        for (let i = 1; i < ring.length - 1; i++) { for (const v of [ring[0], ring[i], ring[i + 1]]) put(v.p, v.n); sids.push(p.sid); tri.push(p); }
        return;
      }
      let c = [0, 0, 0], cn = [0, 0, 0]; for (const v of p.v) { c = V.add(c, v.p); cn = V.add(cn, v.n); }
      c = V.mul(c, 1 / p.v.length); cn = V.norm(cn);
      for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; put(c, cn); put(a.p, a.n); put(b.p, b.n); sids.push(p.sid); tri.push(p); }
    });
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), sids, polysOfTri: tri, count: pos.length / 3 };
  }
}
function M4det(m) { return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]); }

/* ---------- 2D helpers ---------- */
export function area2(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function ccw(pts) { return area2(pts) < 0 ? pts.slice().reverse() : pts.slice(); }
function cleanProfile(pts) {
  const o = []; for (const p of pts) { const l = o[o.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-7) o.push([+p[0], +p[1]]); }
  if (o.length > 2 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 1e-7) o.pop();
  return o;
}
/* ear-clipping triangulation of a simple polygon (any orientation) → index triples (CCW) */
export function triangulate(pts) {
  const n = pts.length; if (n < 3) return [];
  let idx = [...Array(n).keys()]; if (area2(pts) < 0) idx.reverse();
  const out = [], cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length], a = pts[ia], b = pts[ib], c = pts[ic];
      if (cr(a, b, c) <= 1e-14) continue;
      let ear = true;
      for (const j of idx) { if (j === ia || j === ib || j === ic) continue; if (inside(pts[j], a, b, c)) { ear = false; break; } }
      if (!ear) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) { idx.splice(0, 1); }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
/* resample a closed 2D profile to n points by arc length */
export function resample(pts, n) {
  const L = [0]; for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const tot = L[L.length - 1], out = []; let k = 0;
  for (let i = 0; i < n; i++) { const d = tot * i / n; while (k < pts.length - 1 && L[k + 1] < d) k++; const a = pts[k], b = pts[(k + 1) % pts.length], t = (d - L[k]) / ((L[k + 1] - L[k]) || 1); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  return out;
}

/* ---------- ring mesher: stacks of 3D rings (same point count) + two triangulated caps ---------- */
/* rings[k][i] = 3D point; profile2D = the 2D shape used for cap triangulation (same order as rings) */
function ringSolid(rings, capIdx, sidSide, smooth, sidA, sidB) {
  const polys = [], n = rings[0].length;
  const push = (pts, sid, normals) => { const p = poly(pts, sid, normals); if (p) polys.push(p); };
  for (let k = 0; k < rings.length - 1; k++) {
    const r0 = rings[k], r1 = rings[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = r0[i], b = r0[j], c = r1[j], d = r1[i];
      const quadPlanar = (() => { const pl = planeOf([a, b, c]); return pl && Math.abs(V.dot(pl.n, d) - pl.w) < 1e-6; })();
      const sid = typeof sidSide === 'function' ? sidSide(i) : sidSide;
      if (quadPlanar) push([a, b, c, d], sid); else { push([a, b, c], sid); push([a, c, d], sid); }
    }
  }
  const capA = rings[0], capB = rings[rings.length - 1];
  for (const [i, j, k] of capIdx) { push([capA[i], capA[k], capA[j]], sidA); push([capB[i], capB[j], capB[k]], sidB); }
  const s = new Solid(polys);
  if (smooth) smoothNormals(s, typeof sidSide === 'function' ? null : sidSide);
  return s;
}
/* average vertex normals inside a smooth surface (rendering only; geometry stays faceted) */
function smoothNormals(s, sid) {
  const key = (p) => p.map(v => Math.round(v * 1e4)).join(','), acc = new Map();
  for (const p of s.polys) { if (sid && p.sid !== sid) continue; for (const v of p.v) { const k = key(v.p), a = acc.get(k) || [0, 0, 0]; acc.set(k, V.add(a, p.plane.n)); } }
  for (const p of s.polys) { if (sid && p.sid !== sid) continue; p.v = p.v.map(v => ({ p: v.p, n: V.norm(acc.get(key(v.p))) })); }
}

/* ---------- primitives (local frames: base centred on the XY plane, Z up) ---------- */
export function box(W, D, H) {
  const x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2, z0 = 0, z1 = H;
  const P = (x, y, z) => [x, y, z];
  return new Solid([
    poly([P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)], 'bottom'),
    poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], 'top'),
    poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], 'front'),
    poly([P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)], 'back'),
    poly([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], 'left'),
    poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], 'right')
  ]);
}
/* right-angle wedge: vertical face on the left (x = -W/2), slope from top-left down to the right */
export function wedge(W, D, H) {
  const x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2;
  return new Solid([
    poly([[x0, y0, 0], [x0, y1, 0], [x1, y1, 0], [x1, y0, 0]], 'bottom'),
    poly([[x0, y0, 0], [x0, y0, H], [x0, y1, H], [x0, y1, 0]], 'left'),
    poly([[x1, y0, 0], [x1, y1, 0], [x0, y1, H], [x0, y0, H]], 'slope'),
    poly([[x0, y0, 0], [x1, y0, 0], [x0, y0, H]], 'front'),
    poly([[x0, y1, 0], [x0, y1, H], [x1, y1, 0]], 'back')
  ]);
}
export function cylinder(R1, R2, H, seg) {
  seg = seg || 40; R2 = R2 == null ? R1 : R2;
  const ring = (r, z) => { const o = []; for (let i = 0; i < seg; i++) { const t = i / seg * Math.PI * 2; o.push([Math.cos(t) * r, Math.sin(t) * r, z]); } return o; };
  const b = ring(R1, 0), polys = [];
  const slope = (R1 - R2) / H;
  const nAt = (t) => V.norm([Math.cos(t), Math.sin(t), slope]);
  if (R2 <= 1e-9) {
    const apex = [0, 0, H];
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg, ti = i / seg * Math.PI * 2, tj = j / seg * Math.PI * 2; const p = poly([b[i], b[j], apex], 'side', [nAt(ti), nAt(tj), nAt((ti + tj) / 2)]); if (p) polys.push(p); }
  } else {
    const t = ring(R2, H);
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg, ti = i / seg * Math.PI * 2, tj = j / seg * Math.PI * 2; const p = poly([b[i], b[j], t[j], t[i]], 'side', [nAt(ti), nAt(tj), nAt(tj), nAt(ti)]); if (p) polys.push(p); }
    polys.push(poly(t.slice(), 'top'));
  }
  polys.push(poly(b.slice().reverse(), 'bottom'));
  return new Solid(polys);
}
export function sphere(R, seg) {
  seg = seg || 32; const rings = Math.max(6, Math.round(seg / 2)), polys = [];
  const P = (i, j) => { const th = i / seg * Math.PI * 2, ph = j / rings * Math.PI; return [R * Math.sin(ph) * Math.cos(th), R * Math.sin(ph) * Math.sin(th), R - R * Math.cos(ph)]; };
  const N = (p) => V.norm([p[0], p[1], p[2] - R]);
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    const pts = (j === 0 ? [a, d, c] : j === rings - 1 ? [a, d, b] : [a, d, c, b]).reverse();
    const p = poly(pts, 'surface', pts.map(N)); if (p) polys.push(p);
  }
  return new Solid(polys);
}
/* extrude a 2D profile along local Z: length, twist (deg), end scale [sx, sy], oblique direction (unit vector, z > 0) */
export function extrude(profile, o) {
  o = o || {}; let pts = ccw(cleanProfile(profile)); const L = +o.length || 10, tw = (+o.twist || 0) * Math.PI / 180;
  const sc = Array.isArray(o.scale) ? o.scale : [o.scale == null ? 1 : +o.scale, o.scale == null ? 1 : +o.scale];
  const dir = o.dir ? V.norm(o.dir) : [0, 0, 1], steps = Math.max(1, o.divisions || (tw ? Math.ceil(Math.abs(tw) / (Math.PI / 24)) : 1));
  /* draft: the end profile is the start one offset (inward when negative), corners mitred */
  const endPts = o.offsetEnd ? offsetPolygon(pts, o.offsetEnd) : null;
  if (o.offsetEnd && (!endPts || endPts.length !== pts.length)) throw new Error('that draft closes the profile up before the end: use a smaller angle or a shorter length');
  const cap = triangulate(pts), rings = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, a = tw * t, sx = 1 + (sc[0] - 1) * t, sy = 1 + (sc[1] - 1) * t, c = Math.cos(a), s = Math.sin(a);
    const off = V.mul(dir, L * t / (dir[2] || 1));
    rings.push(pts.map(([x0, y0], i) => { const x = endPts ? x0 + (endPts[i][0] - x0) * t : x0, y = endPts ? y0 + (endPts[i][1] - y0) * t : y0, X = x * sx, Y = y * sy; return [X * c - Y * s + off[0], X * s + Y * c + off[1], off[2]]; }));
  }
  return ringSolid(rings, cap, o.sideSid || ((i) => 'side' + i), false, 'start', 'end');
}
/* loft between two different closed profiles (resampled to the same count, start points aligned) */
export function loft(profA, profB, o) {
  o = o || {}; const L = +o.length || 10, tw = (+o.twist || 0) * Math.PI / 180, n = Math.max(profA.length, profB.length, o.samples || 48);
  const A = resample(ccw(cleanProfile(profA)), n); let B = resample(ccw(cleanProfile(profB)), n);
  /* align start of B to A (min total distance) */
  let best = 0, bd = Infinity; for (let s = 0; s < n; s++) { let d = 0; for (let i = 0; i < n; i += Math.max(1, n >> 4)) { const q = B[(i + s) % n]; d += Math.hypot(q[0] - A[i][0], q[1] - A[i][1]); } if (d < bd) { bd = d; best = s; } }
  B = B.slice(best).concat(B.slice(0, best));
  const steps = Math.max(1, o.divisions || 8), rings = [], cap = triangulate(A);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, a = tw * t, c = Math.cos(a), s = Math.sin(a);
    rings.push(A.map((p, i) => { const x = p[0] + (B[i][0] - p[0]) * t, y = p[1] + (B[i][1] - p[1]) * t; return [x * c - y * s, x * s + y * c, L * t]; }));
  }
  const capB = triangulate(B);
  const s = ringSolid(rings, cap, 'side', true, 'start', 'end');
  /* replace the end cap with B's own triangulation (rings share points so caps stay watertight) */
  const last = rings[rings.length - 1];
  s.polys = s.polys.filter(p => p.sid !== 'end');
  for (const [i, j, k] of capB) { const p = poly([last[i], last[j], last[k]], 'end'); if (p) s.polys.push(p); }
  return s;
}
/* revolve a 2D profile (x = radius ≥ 0, y = height) around local Z */
export function revolve(profile, o) {
  o = o || {}; const deg = Math.min(360, Math.max(1, +o.degrees || 360)), seg = Math.max(8, o.segments || Math.ceil(48 * deg / 360));
  let pts = ccw(cleanProfile(profile)).map(([r, z]) => [Math.max(0, r), z]);
  const full = deg >= 359.999, steps = seg, polys = [];
  const P = (r, z, a) => [r * Math.cos(a), r * Math.sin(a), z];
  for (let k = 0; k < steps; k++) {
    const a0 = deg * Math.PI / 180 * k / steps, a1 = deg * Math.PI / 180 * (k + 1) / steps;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (p[0] < 1e-9 && q[0] < 1e-9) continue;
      const quad = [P(p[0], p[1], a0), P(q[0], q[1], a0), P(q[0], q[1], a1), P(p[0], p[1], a1)];
      const pts2 = p[0] < 1e-9 ? [quad[0], quad[1], quad[2]] : q[0] < 1e-9 ? [quad[0], quad[1], quad[3]] : quad;
      const pg = poly(pts2.slice().reverse(), 'rev' + i); if (pg) polys.push(pg);
    }
  }
  if (!full) {
    const cap = triangulate(pts), a1 = deg * Math.PI / 180;
    for (const [i, j, k] of cap) {
      const p0 = poly([P(pts[i][0], pts[i][1], 0), P(pts[k][0], pts[k][1], 0), P(pts[j][0], pts[j][1], 0)].map(v => v), 'start');
      const p1 = poly([P(pts[i][0], pts[i][1], a1), P(pts[j][0], pts[j][1], a1), P(pts[k][0], pts[k][1], a1)], 'end');
      if (p0) polys.push(p0); if (p1) polys.push(p1);
    }
  }
  const s = new Solid(polys); fixOrientation(s); return s;
}
/* sweep a 2D profile along a 3D polyline path (parallel-transport frames, mitred corners) */
export function sweep(profile, path, o) {
  o = o || {}; const pts = ccw(cleanProfile(profile)); const P = path.map(p => p.map(Number));
  if (P.length < 2) throw new Error('A sweep path needs at least 2 points');
  const T = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; return V.norm(V.sub(b, a)); });
  let up = Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let X = V.norm(V.cross(up, T[0])), Y = V.cross(T[0], X);
  const rings = [];
  for (let i = 0; i < P.length; i++) {
    if (i > 0) { /* parallel transport */ const t0 = T[i - 1], t1 = T[i], ax = V.cross(t0, t1), s = V.len(ax); if (s > 1e-9) { const ang = Math.atan2(s, V.dot(t0, t1)) * 180 / Math.PI, R = M4.axisAngle(ax, ang); X = V.norm(M4.dir(R, X)); Y = V.norm(M4.dir(R, Y)); } }
    let k = 1;
    if (i > 0 && i < P.length - 1) { const d0 = V.norm(V.sub(P[i], P[i - 1])), d1 = V.norm(V.sub(P[i + 1], P[i])); const c = V.dot(d0, T[i]); k = 1 / Math.max(0.25, c); void d1; }
    /* mitre: stretch the profile across the corner bisector */
    const bend = i > 0 && i < P.length - 1 ? V.norm(V.sub(V.norm(V.sub(P[i + 1], P[i])), V.norm(V.sub(P[i], P[i - 1])))) : null;
    rings.push(pts.map(([x, y]) => {
      let q = V.add(V.mul(X, x), V.mul(Y, y));
      if (bend && V.len(bend) > 1e-9) { const along = V.dot(q, bend); q = V.add(q, V.mul(bend, along * (k - 1))); }
      return V.add(P[i], q);
    }));
  }
  const s = ringSolid(rings, triangulate(pts), 'side', false, 'start', 'end'); fixOrientation(s); return s;
}
/* make sure polygons face outward (positive volume) */
function fixOrientation(s) { if (s.volume() < 0) for (const p of s.polys) p.flip(); }

/* ---------- 2D offsets (draft, thin walls, ribs) ---------- */
/* a closed polygon moved outward by d (inward when d < 0), corners mitred; null when it turns inside out */
export function offsetPolygon(pts, d) {
  const P = ccw(cleanProfile(pts)), n = P.length; if (n < 3) return null;
  const lines = [];
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L; lines.push([[a[0] + nx * d, a[1] + ny * d], [dx / L, dy / L]]); }
  const out = [];
  for (let i = 0; i < n; i++) {
    const [p1, d1] = lines[(i + n - 1) % n], [p2, d2] = lines[i], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) { out.push(p2); continue; }
    const u = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; out.push([p1[0] + d1[0] * u, p1[1] + d1[1] * u]);
  }
  /* each edge must keep its direction (no edge flipped by a too-large inward offset) */
  for (let i = 0; i < n; i++) { const a = out[i], b = out[(i + 1) % n], e = [P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]]; if ((b[0] - a[0]) * e[0] + (b[1] - a[1]) * e[1] < 0) return null; }
  return area2(out) > 1e-9 ? out : null;
}
/* an open polyline thickened to a closed outline of width t (centred on the line, mitred joins, square ends) */
export function thickenPolyline(pts, t) {
  const P = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9), n = P.length, h = t / 2;
  if (n < 2) throw new Error('an open profile needs at least two points');
  if (!(t > 0)) throw new Error('a thin wall needs a thickness above 0');
  const dir = (i) => { const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  const side = (s) => P.map((p, i) => {
    const d0 = i > 0 ? dir(i - 1) : dir(0), d1 = i < n - 1 ? dir(i) : dir(n - 2), n0 = [-d0[1], d0[0]], n1 = [-d1[1], d1[0]];
    const m = [n0[0] + n1[0], n0[1] + n1[1]], ml = Math.hypot(m[0], m[1]) || 1, cos = (m[0] * n1[0] + m[1] * n1[1]) / ml, k = h / Math.max(0.2, cos);
    return [p[0] + s * m[0] / ml * k, p[1] + s * m[1] / ml * k];
  });
  const L = side(1), Rt = side(-1);
  return L.concat(Rt.reverse());
}
/* ---------- offset (for shells): every face moves along its normal by offsetFor(face); each vertex goes to where its
   faces' moved planes meet (least squares where more than three meet, e.g. on curved facets). Exact for flat-faced
   parts (mitred corners) as long as the offset is smaller than the thinnest section and the tightest convex rounding. */
function offsetFrame(solid) {
  const m = solid.toMesh(), P = m.positions, tris = m.polysOfTri, nT = m.count / 3;
  const key = (i) => Math.round(P[i * 3] * 1e5) + ',' + Math.round(P[i * 3 + 1] * 1e5) + ',' + Math.round(P[i * 3 + 2] * 1e5);
  const vIndex = new Map(), verts = [], vTris = [], triV = [];
  for (let t = 0; t < nT; t++) {
    const ids = [];
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k, kk = key(i); let vi = vIndex.get(kk);
      if (vi == null) { vi = verts.length; vIndex.set(kk, vi); verts.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); vTris.push([]); }
      vTris[vi].push(t); ids.push(vi);
    }
    triV.push(ids);
  }
  return { tris, nT, verts, vTris, triV };
}
const det3 = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
/* where each vertex goes when its faces move by offs[triangle] */
function movedVertices(F, offs) {
  return F.verts.map((v, i) => {
    const L = [];
    for (const t of F.vTris[i]) { const n = F.tris[t].plane.n, o = offs[t]; if (!L.some(q => Math.abs(q.n[0] - n[0]) < 1e-5 && Math.abs(q.n[1] - n[1]) < 1e-5 && Math.abs(q.n[2] - n[2]) < 1e-5 && Math.abs(q.o - o) < 1e-9)) L.push({ n, o }); }
    const A = [[1e-9, 0, 0], [0, 1e-9, 0], [0, 0, 1e-9]], b = [0, 0, 0];
    for (const { n, o } of L) for (let r = 0; r < 3; r++) { b[r] += n[r] * o; for (let c = 0; c < 3; c++) A[r][c] += n[r] * n[c]; }
    const D = det3(A), col = (k) => A.map((row, r) => row.map((x, c) => (c === k ? b[r] : x)));
    const d = Math.abs(D) < 1e-30 ? [0, 0, 0] : [det3(col(0)) / D, det3(col(1)) / D, det3(col(2)) / D];
    return V.add(v, d);
  });
}
export function offsetSolid(solid, offsetFor) {
  const F = offsetFrame(solid), offs = F.tris.map(p => offsetFor(p)), moved = movedVertices(F, offs);
  const groups = new Map();
  for (let t = 0; t < F.nT; t++) { const pl = F.tris[t].plane, k = pl.n.map(x => Math.round(x * 1e5)).join(',') + '|' + Math.round(pl.w * 1e4); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const polys = []; let flipped = 0;
  const tri = (t) => F.triV[t].map(i => moved[i]);
  for (const ts of groups.values()) {
    const n0 = F.tris[ts[0]].plane.n; let net = 0, bad = 0, scale = 0;
    const sa = ts.map(t => { const [a, b, c] = tri(t), s = V.dot(V.cross(V.sub(b, a), V.sub(c, a)), n0) / 2; scale = Math.max(scale, Math.abs(s)); return s; });
    for (const s of sa) { net += s; if (s < -1e-9 * (1 + scale)) bad++; }
    if (!bad) { ts.forEach(t => { const q = poly(tri(t), F.tris[t].sid); if (q) polys.push(q); }); continue; }
    /* a flat face whose triangulation folds inside its own plane (a fan across a seam between coplanar pieces): the
       face itself is fine, so rebuild it from its moved outline */
    const rebuilt = net > 1e-9 * (1 + scale) ? rebuildFace(F, ts, moved, n0) : null;
    if (rebuilt) { for (const r of rebuilt) { const q = poly(r, F.tris[ts[0]].sid); if (q) polys.push(q); } continue; }
    flipped += bad; ts.forEach(t => { const q = poly(tri(t), F.tris[t].sid); if (q) polys.push(q); });
  }
  /* a real fold (a section thinner than two offsets, a rounding tighter than the offset) brings moved vertices closer
     to the original surface than they were sent: count those too */
  if (!flipped) flipped = tooClose(F, offs, moved);
  return { solid: new Solid(polys), flipped };
}
/* the outline loops of a set of coplanar triangles, moved, re-triangulated (null if the moved outline is not simple) */
function rebuildFace(F, ts, moved, n) {
  const has = new Set(); for (const t of ts) { const [a, b, c] = F.triV[t]; has.add(a + ',' + b); has.add(b + ',' + c); has.add(c + ',' + a); }
  const out = new Map();
  for (const t of ts) { const [a, b, c] = F.triV[t]; for (const [i, j] of [[a, b], [b, c], [c, a]]) if (!has.has(j + ',' + i)) { if (!out.has(i)) out.set(i, []); out.get(i).push(j); } }
  const loops = [], used = new Set();
  for (const [i0, js] of out) for (const j0 of js) {
    if (used.has(i0 + ',' + j0)) continue;
    const loop = [i0]; let i = i0, j = j0, guard = 0;
    while (guard++ < 100000) { used.add(i + ',' + j); if (j === i0) break; loop.push(j); const nx = (out.get(j) || []).find(k => !used.has(j + ',' + k)); if (nx == null) return null; i = j; j = nx; }
    loops.push(loop);
  }
  const u = V.norm(Math.abs(n[0]) < 0.9 ? V.cross(n, [1, 0, 0]) : V.cross(n, [0, 1, 0])), v = V.cross(n, u);
  const to2 = (i) => [V.dot(moved[i], u), V.dot(moved[i], v)];
  const L = loops.map(lp => ({ ids: lp, p: lp.map(to2) })).map(l => Object.assign(l, { a: area2(l.p) }));
  /* the moved outline must stay simple: no two edges cross */
  const segs = []; for (const l of L) for (let k = 0; k < l.p.length; k++) segs.push([l.p[k], l.p[(k + 1) % l.p.length], l.ids[k], l.ids[(k + 1) % l.ids.length]]);
  if (segs.length <= 3000) for (let x = 0; x < segs.length; x++) for (let y = x + 1; y < segs.length; y++) {
    const [a, b, ia, ib] = segs[x], [c, d, ic, id] = segs[y]; if (ia === ic || ia === id || ib === ic || ib === id) continue;
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
    const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    if (((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12))) return null;
  }
  const outers = L.filter(l => l.a > 0), holes = L.filter(l => l.a < 0), res = [];
  for (const o of outers) {
    const mine = holes.filter(h => pointInPoly2(h.p[0], o.p) && !outers.some(o2 => o2 !== o && o2.a < o.a && pointInPoly2(h.p[0], o2.p) && pointInPoly2(o2.p[0], o.p)));
    const ring = bridgeHoles(o.ids.map((id, k) => ({ id, p: o.p[k] })), mine.map(h => h.ids.map((id, k) => ({ id, p: h.p[k] }))));
    const tris = earClip(ring.map(r => r.p)); if (!tris) return null;
    let sum = 0; for (const [a, b, c] of tris) { const s = area2([ring[a].p, ring[b].p, ring[c].p]); if (s < -1e-9) return null; sum += s; }
    if (Math.abs(sum - (o.a + mine.reduce((x, h) => x + h.a, 0))) > 1e-6 * (1 + Math.abs(o.a))) return null;
    for (const [a, b, c] of tris) res.push([moved[ring[a].id], moved[ring[b].id], moved[ring[c].id]]);
  }
  return res.length ? res : null;
}
function pointInPoly2(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
/* splice holes (clockwise) into an outer ring (counter-clockwise) with zero-width bridges, rightmost hole first */
function bridgeHoles(outer, holes) {
  let ring = outer.slice();
  const hs = holes.map(h => { let m = 0; h.forEach((q, k) => { if (q.p[0] > h[m].p[0]) m = k; }); return { h, m }; }).sort((a, b) => b.h[b.m].p[0] - a.h[a.m].p[0]);
  for (const { h, m } of hs) {
    const M = h[m].p; let best = -1, bx = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k].p, b = ring[(k + 1) % ring.length].p;
      if ((a[1] > M[1]) === (b[1] > M[1]) && a[1] !== M[1]) continue;
      if (a[1] === b[1]) { if (a[1] === M[1]) { for (const [q, kk] of [[a, k], [b, (k + 1) % ring.length]]) if (q[0] >= M[0] && q[0] - M[0] < bx) { bx = q[0] - M[0]; best = kk; } } continue; }
      const x = a[0] + (M[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]); if (x < M[0] - 1e-12 || x - M[0] >= bx) continue;
      bx = x - M[0]; best = a[0] > b[0] ? k : (k + 1) % ring.length;
    }
    if (best < 0) continue;
    /* prefer a vertex inside the triangle (M, hit, candidate) closest in angle, so the bridge stays inside */
    const P = ring[best].p, I = [M[0] + bx, M[1]], cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inTri = (q) => { const d1 = cr(M, I, q), d2 = cr(I, P, q), d3 = cr(P, M, q); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
    let pick = best, bestAng = Infinity;
    for (let k = 0; k < ring.length; k++) { const q = ring[k].p; if (k === best || q[0] < M[0] || !inTri(q)) continue; const ang = Math.abs(Math.atan2(q[1] - M[1], q[0] - M[0])); if (ang < bestAng || (ang === bestAng && Math.hypot(q[0] - M[0], q[1] - M[1]) < Math.hypot(ring[pick].p[0] - M[0], ring[pick].p[1] - M[1]))) { bestAng = ang; pick = k; } }
    const hole = [...h.slice(m), ...h.slice(0, m), h[m]];
    ring = [...ring.slice(0, pick + 1), ...hole, ring[pick], ...ring.slice(pick + 1)];
  }
  return ring;
}
/* ear clipping that tolerates the duplicate points of bridges; null when it gets stuck */
function earClip(pts) {
  let idx = [...pts.keys()]; const out = [], cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < pts.length * 4) {
    let clipped = false;
    for (let i = 0; i < idx.length && !clipped; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length], a = pts[ia], b = pts[ib], c = pts[ic];
      const c0 = cr(a, b, c);
      if (Math.abs(c0) < 1e-14 && (same(a, c) || V.dot([b[0] - a[0], b[1] - a[1], 0], [c[0] - b[0], c[1] - b[1], 0]) >= 0)) { idx.splice(i, 1); clipped = true; break; }   /* drop a straight-through or doubled-back point */
      if (c0 <= 0) continue;
      let ear = true;
      for (const j of idx) { if (j === ia || j === ib || j === ic) continue; const p = pts[j]; if (same(p, a) || same(p, b) || same(p, c)) continue; if (cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0) { ear = false; break; } }
      if (!ear) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); clipped = true;
    }
    if (!clipped) return null;
  }
  if (idx.length === 3 && cr(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 0) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
/* closest distance from p to triangle abc (Ericson) */
function pointTriDist(p, a, b, c) {
  const ab = V.sub(b, a), ac = V.sub(c, a), ap = V.sub(p, a), d1 = V.dot(ab, ap), d2 = V.dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return V.len(ap);
  const bp = V.sub(p, b), d3 = V.dot(ab, bp), d4 = V.dot(ac, bp); if (d3 >= 0 && d4 <= d3) return V.len(bp);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return V.len(V.sub(p, V.add(a, V.mul(ab, d1 / (d1 - d3)))));
  const cp = V.sub(p, c), d5 = V.dot(ab, cp), d6 = V.dot(ac, cp); if (d6 >= 0 && d5 <= d6) return V.len(cp);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return V.len(V.sub(p, V.add(a, V.mul(ac, d2 / (d2 - d6)))));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return V.len(V.sub(p, V.add(b, V.mul(V.sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))))));
  const den = 1 / (va + vb + vc); return V.len(V.sub(p, V.add(a, V.add(V.mul(ab, vb * den), V.mul(ac, vc * den)))));
}
/* how many moved vertices sit closer to the original surface (faces moved inward only) than they were sent */
function tooClose(F, offs, moved) {
  let need = 0; for (const o of offs) if (o < 0) need = Math.max(need, -o); if (!need) return 0;
  const P = (t) => F.triV[t].map(i => F.verts[i]), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of F.verts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  const h = Math.max(need, Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 48), cell = (x, k) => Math.floor((x - mn[k] + need) / h), grid = new Map();
  for (let t = 0; t < F.nT; t++) {
    if (!(offs[t] < 0)) continue;
    const q = P(t), lo = [0, 1, 2].map(k => cell(Math.min(q[0][k], q[1][k], q[2][k]) - need, k)), hi = [0, 1, 2].map(k => cell(Math.max(q[0][k], q[1][k], q[2][k]) + need, k));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const key = x + ',' + y + ',' + z; let L = grid.get(key); if (!L) grid.set(key, (L = [])); L.push(t); }
  }
  let n = 0;
  moved.forEach((p, i) => {
    const want = Math.max(0, ...F.vTris[i].map(t => -offs[t])); if (!want) return;
    const planes = new Set(F.vTris[i].map(t => F.tris[t].plane.n.map(x => Math.round(x * 1e4)).join(','))).size, tol = planes > 3 ? 0.1 : 0.02;
    const L = grid.get(cell(p[0], 0) + ',' + cell(p[1], 1) + ',' + cell(p[2], 2)) || [];
    for (const t of L) { const [a, b, c] = P(t); if (pointTriDist(p, a, b, c) < want * (1 - tol) - 1e-9) { n++; return; } }
  });
  return n;
}

/* ---------- star-shaped prisms (gears, splines, knobs) ----------
   outer: closed 2D profile, star-shaped around the origin, any start, counter-clockwise (polar angle never decreasing);
   inner: optional hole profile of the same kind (a bore, or the teeth of a ring gear), or null;
   stations: [{ z, rot (radians) }] in increasing z — twist per station gives helical / herringbone forms.
   Built directly (no booleans), so even a 60-tooth helical gear is instant. */
export function ringExtrude(outer, inner, stations, o) {
  o = o || {};
  const sidO = o.sidOuter || 'side', sidI = o.sidInner || 'bore', polys = [];
  const push = (pts, sid) => { const q = poly(pts, sid); if (q) polys.push(q); };
  const place = (pts, st) => { const c = Math.cos(st.rot || 0), sn = Math.sin(st.rot || 0); return pts.map(([x, y]) => [x * c - y * sn, x * sn + y * c, st.z]); };
  const walls = (pts, sid, rev) => {
    const n = pts.length;
    for (let k = 0; k < stations.length - 1; k++) {
      const r0 = place(pts, stations[k]), r1 = place(pts, stations[k + 1]);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = r0[i], b = r0[j], c = r1[j], d = r1[i];
        if (rev) { push([b, a, d], sid); push([b, d, c], sid); } else { push([a, b, c], sid); push([a, c, d], sid); }
      }
    }
  };
  walls(outer, sidO, false); if (inner) walls(inner, sidI, true);
  /* caps: a fan from the centre; with a hole, the ring is cut into sectors at every vertex angle of either loop and
     each sector (two rays, one piece of each loop between them) is a convex quad */
  const ang = (p) => Math.atan2(p[1], p[0]), TAU = 2 * Math.PI;
  const tris2 = [];
  if (!inner) { for (let i = 0; i < outer.length; i++) tris2.push([[0, 0], outer[i], outer[(i + 1) % outer.length]]); }
  else {
    const edgesOf = (pts) => pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; let a0 = ang(p), a1 = ang(q); if (a1 < a0 - 1e-12) a1 += TAU; return { p, q, a0, a1 }; }).filter(e => e.a1 - e.a0 > 1e-12);
    const EO = edgesOf(outer), EI = edgesOf(inner);
    const cuts = [...new Set([...outer, ...inner].map(p => { const a = ang(p); return Math.round(a * 1e12) / 1e12; }))].sort((x, y) => x - y);
    const spanning = (E, th) => { for (const e of E) for (const t of [th, th + TAU, th - TAU]) if (e.a0 <= t + 1e-12 && t <= e.a1 + 1e-12) return { e, t }; return null; };
    const onRay = (e, th) => {
      const t = th; if (Math.abs(t - e.a0) < 1e-11) return e.p; if (Math.abs(t - e.a1) < 1e-11) return e.q;
      const dx = Math.cos(t), dy = Math.sin(t), ex = e.q[0] - e.p[0], ey = e.q[1] - e.p[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-15) return e.p;
      const u = (e.p[0] * dy - e.p[1] * dx) / den; return [e.p[0] + ex * u, e.p[1] + ey * u];
    };
    for (let k = 0; k < cuts.length; k++) {
      const t0 = cuts[k], t1 = k + 1 < cuts.length ? cuts[k + 1] : cuts[0] + TAU, tm = (t0 + t1) / 2; if (t1 - t0 < 1e-12) continue;
      const so = spanning(EO, tm), si = spanning(EI, tm); if (!so || !si) continue;
      const d0o = so.t - tm, d0i = si.t - tm;   /* bring the sector's rays into each edge's angle range */
      const O0 = onRay(so.e, t0 + d0o), O1 = onRay(so.e, t1 + d0o), I0 = onRay(si.e, t0 + d0i), I1 = onRay(si.e, t1 + d0i);
      tris2.push([I0, O0, O1], [I0, O1, I1]);
    }
  }
  const s0 = stations[0], s1 = stations[stations.length - 1];
  for (const t of tris2) {
    const area = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]); if (Math.abs(area) < 1e-12) continue;
    const ccwT = area > 0 ? t : [t[0], t[2], t[1]];
    push(place([ccwT[0], ccwT[2], ccwT[1]], s0), o.sidStart || 'start'); push(place(ccwT, s1), o.sidEnd || 'end');
  }
  const solid = new Solid(polys); fixOrientation(solid);
  return solid;
}

/* ---------- edge pieces: fillet / weld / chamfer along a straight edge ---------- */
/* m = point on the edge, d = edge direction (unit), u1/u2 = unit directions along each face away from the edge,
   size = leg length along each face, length = edge length (piece runs from m - d·length/2 to m + d·length/2).
   fillet = concave arc (indent), weld = convex bead (bulge, arc centred on the corner), chamfer = straight. */
/* cross-section of an edge treatment: corner O, leg ends P1 = u1·t, P2 = u2·t, and the curve between them */
function edgeProfile(u1, u2, t, style) {
  const phi = Math.acos(Math.max(-1, Math.min(1, V.dot(u1, u2))));
  const P1 = V.mul(u1, t), P2 = V.mul(u2, t), prof = [[0, 0, 0], P1], seg = 12;
  if (style === 'chamfer') { /* straight */ }
  else if (style === 'weld') { for (let i = 1; i < seg; i++) { const a = phi * i / seg; prof.push(V.mul(V.add(V.mul(u1, Math.cos(a)), V.mul(V.norm(V.sub(u2, V.mul(u1, Math.cos(phi)))), Math.sin(a))), t)); } }
  else {
    const r = t * Math.tan(phi / 2), bis = V.norm(V.add(u1, u2)), c = V.mul(bis, r / Math.sin(phi / 2));
    const a0 = V.sub(P1, c), a1 = V.sub(P2, c), ang = Math.acos(Math.max(-1, Math.min(1, V.dot(V.norm(a0), V.norm(a1))))), ax = V.norm(V.cross(a0, a1));
    for (let i = 1; i < seg; i++) { const R = M4.axisAngle(ax, ang * 180 / Math.PI * i / seg); prof.push(V.add(c, M4.dir(R, a0))); }
  }
  prof.push(P2);
  return prof;
}
/* 2D profile (ccw) + surface naming: leg1 / leg2 lie on the two faces, one smooth 'arc' (or flat 'chamfer') between them */
function edgeProfile2D(prof3, x, y, style) {
  let P2d = prof3.map(p => [V.dot(p, x), V.dot(p, y)]), tags = prof3.map((_, i) => (i === 0 ? 'o' : i === 1 ? 'p1' : i === prof3.length - 1 ? 'p2' : 'a'));
  if (area2(P2d) < 0) { P2d = P2d.slice().reverse(); tags = tags.slice().reverse(); }
  const n = P2d.length, curved = style === 'chamfer' ? 'chamfer' : 'arc';
  const sidOf = (i) => { const a = tags[i], b = tags[(i + 1) % n]; if (a === 'o' || b === 'o') return (a === 'p1' || b === 'p1') ? 'leg1' : 'leg2'; return curved; };
  return { P2d, sidOf, curved };
}
export function edgePiece(m, d, u1, u2, size, style, length, ext) {
  d = V.norm(d); u1 = V.norm(u1); u2 = V.norm(u2);
  const prof = edgeProfile(u1, u2, size, style);
  /* build a prism: profile lies in the plane ⟂ d through the origin */
  const e = ext || 0, half = length / 2 + e, x = u1, z = d, y = V.cross(z, x);
  const { P2d, sidOf, curved } = edgeProfile2D(prof, x, y, style);
  const rings = [P2d.map(([px, py]) => [px, py, 0]), P2d.map(([px, py]) => [px, py, half * 2])];
  const solid = ringSolid(rings, triangulate(P2d), sidOf, false, 'start', 'end');
  if (curved === 'arc') smoothNormals(solid, 'arc');
  return solid.transform(M4.frame(V.sub(m, V.mul(d, half)), x, z));
}
/* Edge treatment around a circular (faceted) edge: the same cross-section swept around the actual edge loop,
   so it meets the faceted surfaces exactly. loop = ordered 3D points; c, axis = circle centre and axis;
   u1, u2 = [radial, axial] directions of the two faces away from the edge. */
export function loopPiece(loop, closed, c, axis, u1, u2, size, style) {
  axis = V.norm(axis);
  const prof = edgeProfile(V.norm([u1[0], u1[1], 0]), V.norm([u2[0], u2[1], 0]), size, style);
  const { P2d, sidOf, curved } = edgeProfile2D(prof, [1, 0, 0], [0, 1, 0], style), n = P2d.length;
  const rings = loop.map(v => {
    const w = V.sub(v, c), z = V.dot(w, axis), rv = V.sub(w, V.mul(axis, z)), R = V.len(rv) || 1e-9, rd = V.mul(rv, 1 / R);
    return P2d.map(([dr, dz]) => V.add(c, V.add(V.mul(rd, R + dr), V.mul(axis, z + dz))));
  });
  const polys = [], push = (pts, sid) => { const p = poly(pts, sid); if (p) polys.push(p); }, K = rings.length;
  for (let k = 0; k < (closed ? K : K - 1); k++) {
    const r0 = rings[k], r1 = rings[(k + 1) % K];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, sid = sidOf(i); push([r0[i], r0[j], r1[j]], sid); push([r0[i], r1[j], r1[i]], sid); }
  }
  if (!closed) { for (const [i, j, k] of triangulate(P2d)) { push([rings[0][i], rings[0][k], rings[0][j]], 'start'); push([rings[K - 1][i], rings[K - 1][j], rings[K - 1][k]], 'end'); } }
  const solid = new Solid(polys); fixOrientation(solid);
  if (curved === 'arc') smoothNormals(solid, 'arc');
  return solid;
}

/* ---------- drawing edges ---------- */
const q = (v) => Math.round(v * 1e4);
/* a key shared by all segments on one infinite line (canonical direction + foot point from the origin); allocation-light, it runs per edge */
export const lineKey = (a, b) => {
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
  if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && (dy < -1e-9 || (Math.abs(dy) < 1e-9 && dz < 0)))) { dx = -dx; dy = -dy; dz = -dz; }
  const t = a[0] * dx + a[1] * dy + a[2] * dz, cx = a[0] - dx * t, cy = a[1] - dy * t, cz = a[2] - dz * t;
  return { key: `${Math.round(dx * 2e3)},${Math.round(dy * 2e3)},${Math.round(dz * 2e3)}|${Math.round(cx * 1e2)},${Math.round(cy * 1e2)},${Math.round(cz * 1e2)}`, d: [dx, dy, dz], c: [cx, cy, cz] };
};
/* creases: boundaries between different surfaces (robust to T-junctions created by booleans) */
export function creaseEdges(solid) {
  const bySid = new Map();
  for (const p of solid.polys) { if (!bySid.has(p.sid)) bySid.set(p.sid, []); bySid.get(p.sid).push(p); }
  const buckets = new Map();
  for (const [sid, ps] of bySid) {
    const local = new Map();
    for (const p of ps) for (let i = 0; i < p.v.length; i++) {
      const a = p.v[i].p, b = p.v[(i + 1) % p.v.length].p; if (V.len(V.sub(b, a)) < 1e-7) continue;
      const lk = lineKey(a, b); let e = local.get(lk.key); if (!e) { e = { d: lk.d, c: lk.c, iv: [] }; local.set(lk.key, e); }
      const ta = V.dot(a, lk.d), tb = V.dot(b, lk.d); e.iv.push(ta < tb ? [ta, tb, 1] : [tb, ta, -1]);
    }
    for (const [k, e] of local) {
      /* signed coverage sweep: interior edges cancel (+1 and −1), boundaries remain */
      const ev = []; for (const [t0, t1, s] of e.iv) { ev.push([t0, s], [t1, -s]); }
      ev.sort((x, y) => x[0] - y[0]);
      let cov = 0, start = null;
      for (let i = 0; i < ev.length; i++) {
        const prev = cov; cov += ev[i][1];
        const t = ev[i][0];
        if (prev === 0 && cov !== 0) start = t;
        else if (prev !== 0 && cov === 0 && start != null) { if (t - start > 1e-6) { let B = buckets.get(k); if (!B) { B = { d: e.d, c: e.c, iv: [] }; buckets.set(k, B); } B.iv.push([start, t]); } start = null; }
        else if (prev !== 0 && cov !== 0 && Math.sign(prev) !== Math.sign(cov)) { if (t - start > 1e-6) { let B = buckets.get(k); if (!B) { B = { d: e.d, c: e.c, iv: [] }; buckets.set(k, B); } B.iv.push([start, t]); } start = t; }
      }
    }
  }
  const segs = [];
  for (const B of buckets.values()) {
    B.iv.sort((a, b) => a[0] - b[0]);
    const merged = []; let cur = null;
    for (const iv of B.iv) { if (cur && iv[0] <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], iv[1]); else { if (cur) merged.push(cur); cur = iv.slice(); } }
    if (cur) merged.push(cur);
    for (const [t0, t1] of merged) segs.push([V.add(B.c, V.mul(B.d, t0)), V.add(B.c, V.mul(B.d, t1))]);
  }
  return segs;
}
/* silhouettes of curved (smooth) surfaces for a view direction */
export function silhouetteEdges(solid, viewDir, smoothSids) {
  const edges = new Map(), out = [];
  for (const p of solid.polys) {
    if (smoothSids && !smoothSids(p.sid)) continue;
    for (let i = 0; i < p.v.length; i++) {
      const a = p.v[i].p, b = p.v[(i + 1) % p.v.length].p, ka = a.map(q).join(','), kb = b.map(q).join(',');
      const key = ka < kb ? ka + '|' + kb : kb + '|' + ka, e = edges.get(key);
      if (e) { if (e.sid === p.sid && Math.sign(V.dot(e.n, viewDir)) !== Math.sign(V.dot(p.plane.n, viewDir))) out.push([a, b]); edges.delete(key); }
      else edges.set(key, { n: p.plane.n, sid: p.sid });
    }
  }
  return out;
}
