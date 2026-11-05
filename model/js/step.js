/* SketchFlow — STEP export (ISO 10303-21, AP214 "automotive_design") and a reader that vets what was written.

   The model's solids are faceted (planar polygons from the BSP kernel), so each one is written as an exact planar B-rep:
   a MANIFOLD_SOLID_BREP whose faces are PLANEs bounded by straight EDGE_CURVEs. That is a complete, closed solid that any
   CAD system imports as a real body (measure it, cut it, mate to its faces), not a mesh.

   Mesh → B-rep:
     1. weld corners that are within a tolerance into shared vertices;
     2. heal T-junctions (a corner of one polygon lying on its neighbour's edge — booleans leave these) by splitting that
        edge, so every edge is shared by exactly two polygons;
     3. merge neighbouring coplanar polygons into one face, and trace each face's boundary loops (outer + holes) around
        its polygons, which stays right where a face touches itself at a corner;
     4. drop corners that only split a straight edge (a vertex with two edges), so a box comes out as 6 faces, 12 edges,
        8 vertices whatever the booleans did to it.

   Vetting (readStep / vetStep) parses the file back with its own reader and checks: every reference resolves; every loop
   closes; every edge is used exactly twice, once each way (a closed, oriented shell); every vertex lies on its faces'
   planes; the outer loops agree with the face normals; the Euler–Poincaré formula gives a whole genus; and the volume and
   bounding box computed from the B-rep alone match the model's. */
import * as K from './kernel.js';
import { cosmeticThreads } from './model.js';
const { V, M4 } = K;

/* ---------- mesh → planar B-rep ---------- */
export function solidToBrep(solid, opts = {}) {
  const tol = opts.tol || 1e-5, polys = solid.polys.filter(p => p.v.length >= 3);
  /* 1. weld */
  const P = [], cell = tol * 8, grid = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
  const vid = (p) => {
    const i = Math.floor(p[0] / cell), j = Math.floor(p[1] / cell), k = Math.floor(p[2] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = grid.get(key(i + a, j + b, k + c)); if (!l) continue;
      for (const id of l) { const q = P[id]; if (Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol && Math.abs(q[2] - p[2]) <= tol) return id; }
    }
    const id = P.length; P.push([p[0], p[1], p[2]]); const kk = key(i, j, k); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(id); return id;
  };
  let F = [];
  for (const p of polys) {
    const ring = []; for (const v of p.v) { const id = vid(v.p); if (ring[ring.length - 1] !== id) ring.push(id); }
    while (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    if (ring.length >= 3) F.push({ ring, n: p.plane.n.slice(), w: p.plane.w });
  }
  /* 2. T-junctions: every vertex lying inside an edge splits it */
  const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const q of P) for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], q[k]); bb.max[k] = Math.max(bb.max[k], q[k]); }
  const span = Math.max(1e-9, ...[0, 1, 2].map(k => bb.max[k] - bb.min[k])), gs = Math.max(span / 96, tol * 16), vg = new Map();
  const gk = (q) => [0, 1, 2].map(k => Math.floor((q[k] - bb.min[k]) / gs));
  P.forEach((q, id) => { const c = gk(q).join(','); if (!vg.has(c)) vg.set(c, []); vg.get(c).push(id); });
  const onEdge = (a, b) => {
    const A = P[a], B = P[b], d = V.sub(B, A), L = V.len(d); if (L < tol) return [];
    const u = V.mul(d, 1 / L), lo = gk([Math.min(A[0], B[0]) - tol, Math.min(A[1], B[1]) - tol, Math.min(A[2], B[2]) - tol]), hi = gk([Math.max(A[0], B[0]) + tol, Math.max(A[1], B[1]) + tol, Math.max(A[2], B[2]) + tol]);
    const out = [];
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const l = vg.get(i + ',' + j + ',' + k); if (!l) continue;
      for (const id of l) {
        if (id === a || id === b) continue;
        const w = V.sub(P[id], A), t = V.dot(w, u); if (t <= tol || t >= L - tol) continue;
        if (V.len(V.sub(w, V.mul(u, t))) <= tol) out.push([t, id]);
      }
    }
    return out.sort((x, y) => x[0] - y[0]).map(x => x[1]);
  };
  const split = new Map();
  for (const f of F) {
    const r = [];
    for (let i = 0; i < f.ring.length; i++) {
      const a = f.ring[i], b = f.ring[(i + 1) % f.ring.length]; r.push(a);
      const k = a < b ? a + '_' + b : b + '_' + a; let mid = split.get(k);
      if (!mid) { mid = a < b ? onEdge(a, b) : onEdge(b, a); split.set(k, mid); }
      if (mid.length) r.push(...(a < b ? mid : mid.slice().reverse()));
    }
    f.ring = r;
  }
  /* 2b. hair-line cracks: a boolean between nearly coplanar faces (a curved engraving cut into a faceted cylinder) can leave
     gaps far below a micron wide. Close them: ends of open edges within crackTol of each other are welded, and a corner
     within crackTol of an open edge splits it. Only open edges are touched, so good geometry is never moved. */
  const crackTol = opts.crackTol || Math.max(tol * 200, 2e-3), hk = (a, b) => a + '>' + b;
  const openEdges = () => { const H0 = new Set(); for (const f of F) f.ring.forEach((a, i) => H0.add(hk(a, f.ring[(i + 1) % f.ring.length]))); const out = []; for (const f of F) f.ring.forEach((a, i) => { const b = f.ring[(i + 1) % f.ring.length]; if (!H0.has(hk(b, a))) out.push([a, b]); }); return out; };
  const remap = (find) => { F = F.map(f => { const r = []; for (const v of f.ring) { const w = find(v); if (r[r.length - 1] !== w) r.push(w); } while (r.length > 1 && r[0] === r[r.length - 1]) r.pop(); return Object.assign(f, { ring: r }); }).filter(f => f.ring.length >= 3 && new Set(f.ring).size === f.ring.length); };
  for (let pass = 0; pass < 4; pass++) {
    let oe = openEdges(); if (!oe.length) break;
    /* a grid of every corner, to find what an open edge nearly touches */
    const cg = new Map(), cs = crackTol * 2, ck = (q) => [0, 1, 2].map(k => Math.floor(q[k] / cs));
    const usedV = new Set(); for (const f of F) for (const v of f.ring) usedV.add(v);
    for (const v of usedV) { const c = ck(P[v]).join(','); if (!cg.has(c)) cg.set(c, []); cg.get(c).push(v); }
    const near = (q, r) => { const c = ck(q), out = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) for (const v of cg.get((c[0] + a) + ',' + (c[1] + b) + ',' + (c[2] + d)) || []) if (V.len(V.sub(P[v], q)) <= r) out.push(v); return out; };
    /* weld each open-edge end to the nearest other corner within crackTol */
    const rep = new Map(), find = (v) => { while (rep.has(v)) v = rep.get(v); return v; };
    for (const v of new Set(oe.flat())) {
      const a = find(v); let best = -1, bd = Infinity;
      for (const w of near(P[a], crackTol)) { const b = find(w); if (b === a) continue; const dd = V.len(V.sub(P[a], P[b])); if (dd < bd) { bd = dd; best = b; } }
      if (best >= 0) rep.set(Math.max(a, best), Math.min(a, best));
    }
    if (rep.size) { remap(find); oe = openEdges(); }
    /* split open edges at corners lying on them */
    const openSet = new Set(oe.map(([a, b]) => hk(a, b)));
    for (const f of F) {
      const r = []; let changed = false;
      for (let i = 0; i < f.ring.length; i++) {
        const a = f.ring[i], b = f.ring[(i + 1) % f.ring.length]; r.push(a);
        if (!openSet.has(hk(a, b))) continue;
        const A = P[a], d = V.sub(P[b], A), L = V.len(d); if (L < tol) continue; const u = V.mul(d, 1 / L), mid = [], seenV = new Set();
        const steps = Math.max(1, Math.ceil(L / cs));
        for (let k = 0; k <= steps; k++) for (const v of near(V.add(A, V.mul(u, L * k / steps)), cs * 1.5)) {
          if (v === a || v === b || seenV.has(v)) continue; seenV.add(v);
          const w = V.sub(P[v], A), t = V.dot(w, u); if (t > crackTol && t < L - crackTol && V.len(V.sub(w, V.mul(u, t))) <= crackTol) mid.push([t, v]);
        }
        if (mid.length) { mid.sort((x, y) => x[0] - y[0]); for (const [, v] of mid) r.push(v); changed = true; }
      }
      if (changed) f.ring = r;
    }
  }
  /* doubled faces a boolean can leave where two surfaces coincide: an opposite-facing pair cancels, a same-facing pair is one */
  {
    const byKey = new Map(); F.forEach((f, i) => { const k = f.ring.slice().sort((a, b) => a - b).join(','); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); });
    const drop = new Set(), orient = (f) => { const r = f.ring, m = r.indexOf(Math.min(...r)); return r[(m + 1) % r.length]; };
    for (const ids of byKey.values()) {
      if (ids.length < 2) continue;
      const fw = ids.filter(i => orient(F[i]) === orient(F[ids[0]])), bw = ids.filter(i => !fw.includes(i));
      const pairs = Math.min(fw.length, bw.length); for (let k = 0; k < pairs; k++) { drop.add(fw[k]); drop.add(bw[k]); }
      for (const g of [fw.slice(pairs), bw.slice(pairs)]) for (let k = 1; k < g.length; k++) drop.add(g[k]);
    }
    if (drop.size) F = F.filter((_, i) => !drop.has(i));
  }
  /* tidy every ring: no corner twice in a row, nothing degenerate */
  F = F.map(f => { const r = []; for (const v of f.ring) if (r[r.length - 1] !== v) r.push(v); while (r.length > 1 && r[0] === r[r.length - 1]) r.pop(); return Object.assign(f, { ring: r }); }).filter(f => f.ring.length >= 3 && new Set(f.ring).size === f.ring.length);
  /* small holes left where a boolean dropped a sliver of face: the edges used more often one way than the other, chained into
     closed holes; a hole at most holeMax across is capped with flat triangles from its centre (they meet every edge it has) */
  const holeMax = opts.holeMax || 2, repairs = { holesFilled: 0, holesLeft: 0, fillArea: 0 };
  {
    const cnt = new Map(); for (const f of F) f.ring.forEach((a, i) => { const k = hk(a, f.ring[(i + 1) % f.ring.length]); cnt.set(k, (cnt.get(k) || 0) + 1); });
    const excess = new Map(); /* a → [b, b…] */
    for (const [k, n] of cnt) { const [a, b] = k.split('>').map(Number), m = n - (cnt.get(hk(b, a)) || 0); for (let j = 0; j < m; j++) { if (!excess.has(a)) excess.set(a, []); excess.get(a).push(b); } }
    for (const start of [...excess.keys()]) {
      while (excess.has(start) && excess.get(start).length) {
        const cyc = [start]; let cur = start, guard = 0, ok = false;
        while (guard++ < 10000) { const out = excess.get(cur); if (!out || !out.length) break; const nx = out.pop(); if (nx === start) { ok = true; break; } cyc.push(nx); cur = nx; }
        if (!ok || cyc.length < 2) { repairs.holesLeft++; continue; }
        let c = [0, 0, 0]; for (const v of cyc) c = V.add(c, P[v]); c = V.mul(c, 1 / cyc.length);
        /* small (at most holeMax across) or a sliver (mean width 2 × area / perimeter at most sliverMax): a boolean's leftover */
        const size = Math.max(...cyc.map(v => V.len(V.sub(P[v], c)))) * 2;
        let va = [0, 0, 0], per = 0; for (let k = 0; k < cyc.length; k++) { const a = P[cyc[k]], b = P[cyc[(k + 1) % cyc.length]]; va = V.add(va, V.cross(V.sub(a, c), V.sub(b, c))); per += V.len(V.sub(b, a)); }
        const width = per > 0 ? V.len(va) / per : 0;
        if (size > holeMax && !(width <= (opts.sliverMax || 0.05) && size <= holeMax * 10)) { repairs.holesLeft++; continue; }
        const ci = P.length; P.push(c);
        for (let i = 0; i < cyc.length; i++) { const a = cyc[i], b = cyc[(i + 1) % cyc.length]; F.push({ ring: [b, a, ci], n: null, w: 0 }); repairs.fillArea += V.len(V.cross(V.sub(P[a], c), V.sub(P[b], c))) / 2; }
        repairs.holesFilled++;
      }
    }
  }
  /* every polygon's plane from its welded corners; one that is no longer flat (a crack was closed across it) is fanned into
     triangles round its centre, each exactly flat, so no face is ever written with a corner off its plane */
  const scale = Math.max(1, span), flatTol = 1e-9 * scale * 100, G = [];
  for (const f of F) {
    let n = [0, 0, 0]; const r = f.ring; for (let i = 0; i < r.length; i++) { const a = P[r[i]], b = P[r[(i + 1) % r.length]]; n = V.add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]); }
    const ln = V.len(n); if (ln < 1e-14) continue; n = V.mul(n, 1 / ln);
    let w = 0; for (const v of r) w += V.dot(n, P[v]); w /= r.length;
    let dev = 0; for (const v of r) dev = Math.max(dev, Math.abs(V.dot(n, P[v]) - w));
    if (dev <= flatTol) { G.push({ ring: r, n, w }); continue; }
    let c = [0, 0, 0]; for (const v of r) c = V.add(c, P[v]); c = V.mul(c, 1 / r.length); const ci = P.length; P.push(c);
    for (let i = 0; i < r.length; i++) { const a = P[r[i]], b = P[r[(i + 1) % r.length]], tn = V.cross(V.sub(a, c), V.sub(b, c)), tl = V.len(tn); if (tl < 1e-14) continue; const nn = V.mul(tn, 1 / tl); G.push({ ring: [ci, r[i], r[(i + 1) % r.length]], n: nn, w: V.dot(nn, c) }); }
  }
  F = G;
  /* half-edges: directed (a → b) → polygon, position */
  const H = new Map(); let dup = 0;
  F.forEach((f, fi) => f.ring.forEach((a, i) => { const b = f.ring[(i + 1) % f.ring.length], k = hk(a, b); if (H.has(k)) dup++; H.set(k, [fi, i]); }));
  let open = 0; const openList = []; for (const k of H.keys()) { const [a, b] = k.split('>'); if (!H.has(b + '>' + a)) { open++; if (opts.debug && openList.length < 50) openList.push([+a, +b]); } }
  /* 3. coplanar neighbours → one face */
  const par = F.map((_, i) => i), find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const coplanar = (f, g) => V.dot(f.n, g.n) > 1 - 1e-12 && Math.abs(f.w - g.w) <= flatTol;
  F.forEach((f, fi) => f.ring.forEach((a, i) => { const b = f.ring[(i + 1) % f.ring.length], t = H.get(hk(b, a)); if (t && coplanar(f, F[t[0]])) { const x = find(fi), y = find(t[0]); if (x !== y) par[x] = y; } }));
  const groups = new Map(); F.forEach((_, fi) => { const g = find(fi); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(fi); });
  const faces = [];
  for (const members of groups.values()) {
    const g = find(members[0]), inFace = (fi) => find(fi) === g, used = new Set(), loops = [];
    let best = members[0], ba = -1;
    for (const fi of members) { const a = Math.abs(ringArea(P, F[fi].ring, F[fi].n)); if (a > ba) { ba = a; best = fi; } }
    for (const fi of members) {
      const f = F[fi];
      for (let i = 0; i < f.ring.length; i++) {
        const a = f.ring[i], b = f.ring[(i + 1) % f.ring.length], t = H.get(hk(b, a));
        if ((t && inFace(t[0])) || used.has(hk(a, b))) continue;
        /* a boundary half-edge: trace its loop, turning round each corner through this face's own polygons */
        const loop = []; let cf = fi, ci = i, guard = 0;
        while (guard++ < 1e6) {
          const ring = F[cf].ring, x = ring[ci], y = ring[(ci + 1) % ring.length]; if (used.has(hk(x, y))) break;
          used.add(hk(x, y)); loop.push(x);
          let nf = cf, ni = (ci + 1) % ring.length, spin = 0;
          while (spin++ < 1e5) {
            const r2 = F[nf].ring, p = r2[ni], q = r2[(ni + 1) % r2.length], tw = H.get(hk(q, p));
            if (!(tw && inFace(tw[0]))) break;
            nf = tw[0]; ni = (tw[1] + 1) % F[nf].ring.length;
          }
          cf = nf; ci = ni;
        }
        if (loop.length >= 3) loops.push(loop);
      }
    }
    if (loops.length) faces.push({ n: F[best].n, w: F[best].w, loops });
  }
  /* 4. corners that only split a straight edge go */
  const removeSplitters = () => {
    const nb = new Map(), link = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
    for (const f of faces) for (const L of f.loops) L.forEach((a, i) => { const b = L[(i + 1) % L.length]; link(a, b); link(b, a); });
    const drop = new Set();
    for (const [v, s] of nb) {
      if (s.size !== 2) continue;
      const [u, w] = [...s], d1 = V.sub(P[v], P[u]), d2 = V.sub(P[w], P[v]), l1 = V.len(d1), l2 = V.len(d2);
      if (l1 < tol || l2 < tol) continue;
      if (V.len(V.cross(V.mul(d1, 1 / l1), V.mul(d2, 1 / l2))) < 1e-9 && V.dot(d1, d2) > 0) drop.add(v);
    }
    if (!drop.size) return false;
    for (const f of faces) f.loops = f.loops.map(L => L.filter(v => !drop.has(v))).filter(L => L.length >= 3);
    return true;
  };
  for (let pass = 0; pass < 4 && removeSplitters(); pass++);
  /* pinch vertices: where two separate fans of faces meet at one point (two features just touching), each fan gets its own
     vertex at that point, so the surface stays a manifold round every vertex */
  {
    const corners = new Map(); /* v → [{f, l, i, prev, next}] */
    faces.forEach((f, fi) => f.loops.forEach((L, li) => L.forEach((v, i) => { if (!corners.has(v)) corners.set(v, []); corners.get(v).push({ fi, li, i, prev: L[(i - 1 + L.length) % L.length], next: L[(i + 1) % L.length] }); })));
    for (const [v, cs] of corners) {
      if (cs.length < 3) continue;
      /* round the vertex: a corner leaving along v → w is followed by the corner arriving along w → v */
      const byPrev = new Map(); cs.forEach((c, k) => { if (!byPrev.has(c.prev)) byPrev.set(c.prev, []); byPrev.get(c.prev).push(k); });
      const seenC = new Set(), fans = [];
      for (let k = 0; k < cs.length; k++) {
        if (seenC.has(k)) continue; const fan = []; let c = k, guard = 0;
        while (!seenC.has(c) && guard++ < 1000) { seenC.add(c); fan.push(c); const nx = (byPrev.get(cs[c].next) || []).find(x => !seenC.has(x)); if (nx == null) break; c = nx; }
        fans.push(fan);
      }
      for (let k = 1; k < fans.length; k++) { const nv = P.length; P.push(P[v].slice()); for (const c of fans[k]) { const cc = cs[c]; faces[cc.fi].loops[cc.li][cc.i] = nv; } }
    }
  }
  /* outer loop first: the one whose area runs with the face normal (largest), holes after */
  for (const f of faces) {
    const ar = f.loops.map(L => ringArea(P, L, f.n));
    const order = f.loops.map((L, i) => i).sort((i, j) => ar[j] - ar[i]);
    f.loops = order.map(i => f.loops[i]); f.areas = order.map(i => ar[i]);
  }
  const used = new Set(); for (const f of faces) for (const L of f.loops) for (const v of L) used.add(v);
  return { points: P, faces, stats: { polygons: polys.length, welded: P.length, vertices: used.size, faces: faces.length, duplicateEdges: dup, openEdges: open, holesFilled: repairs.holesFilled, holesLeft: repairs.holesLeft, fillArea: +repairs.fillArea.toFixed(6) }, debug: opts.debug ? { openList, F } : undefined };
}
/* signed area of a loop seen along n (positive = counter-clockwise about n) */
function ringArea(P, ring, n) {
  let s = [0, 0, 0]; for (let i = 0; i < ring.length; i++) s = V.add(s, V.cross(P[ring[i]], P[ring[(i + 1) % ring.length]]));
  return V.dot(s, n) / 2;
}

/* ---------- writing ISO 10303-21 ---------- */
/* a REAL: always with a decimal point, exponent as E */
export function stepReal(x) {
  if (!isFinite(x)) throw new Error('not a finite number: ' + x);
  if (Math.abs(x) < 1e-11) return '0.';
  /* 1e-9 mm is far below any tolerance; the shortest digits that keep it */
  const r = Math.abs(x) >= 1e-3 ? Math.round(x * 1e9) / 1e9 : +x.toPrecision(10);
  let s = r.toString().toUpperCase();
  if (s.includes('E')) { let [m, e] = s.split('E'); if (!m.includes('.')) m += '.'; const sign = e[0] === '-' ? '-' : '+', digits = e.replace(/^[+-]/, '').padStart(2, '0'); return m + 'E' + sign + digits; }
  return s.includes('.') ? s : s + '.';
}
/* a STRING: apostrophes doubled, backslashes doubled, anything outside printable ASCII as \X2\hhhh\X0\ */
export function stepString(s) {
  let out = '', wide = '';
  const flush = () => { if (wide) { out += '\\X2\\' + wide + '\\X0\\'; wide = ''; } };
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) { flush(); out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch; }
    else if (c <= 0xffff) wide += c.toString(16).toUpperCase().padStart(4, '0');
    else { const h = c - 0x10000; wide += (0xd800 + (h >> 10)).toString(16).toUpperCase() + (0xdc00 + (h & 0x3ff)).toString(16).toUpperCase(); }
  }
  flush(); return "'" + out + "'";
}
/* parts: [{name, description, color:[r,g,b] 0…1, solid | brep}] — one product each. occurrences: [{part, T (4×4, or null for
   where it is), name}] — where each product is used; several (or a placed one) make an assembly, so a part repeated by a
   pattern is written once and placed many times */
export function writeStep(parts, meta = {}, occurrences) {
  occurrences = occurrences || parts.map((p, i) => ({ part: i, T: null, name: p.name }));
  const lines = []; let next = 1;
  const E = (body) => { const id = next++; lines.push('#' + id + '=' + body + ';'); return '#' + id; };
  const R = stepReal, S = stepString, list = (xs) => '(' + xs.join(',') + ')';
  const dcache = new Map(), dir = (d) => { const k = list(d.map(R)); if (!dcache.has(k)) dcache.set(k, E("DIRECTION(''," + k + ')')); return dcache.get(k); };
  const pt = (p) => E("CARTESIAN_POINT(''," + list(p.map(R)) + ')');
  const axis = (o, z, x) => E('AXIS2_PLACEMENT_3D(\'\',' + pt(o) + ',' + dir(z) + ',' + dir(x) + ')');
  /* context: millimetres, radians, steradians, and the accuracy the geometry was welded to */
  const appCtx = E("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  E("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000," + appCtx + ')');
  const mm = E('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))'), rad = E('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))'), sr = E('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = E('UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(' + R(meta.tol || 1e-5) + '),' + mm + ",'distance_accuracy_value','confusion accuracy')");
  const ctx = E('(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((' + unc + '))GLOBAL_UNIT_ASSIGNED_CONTEXT((' + mm + ',' + rad + ',' + sr + "))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))");
  const prodCtx = E("PRODUCT_CONTEXT(''," + appCtx + ",'mechanical')"), pdCtx = E("PRODUCT_DEFINITION_CONTEXT('part definition'," + appCtx + ",'design')");
  const product = (name, desc) => {
    const pr = E('PRODUCT(' + S(name) + ',' + S(name) + ',' + S(desc || '') + ',(' + prodCtx + '))');
    E("PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(" + pr + '))');
    const pdf = E("PRODUCT_DEFINITION_FORMATION(''," + "''," + pr + ')'), pd = E("PRODUCT_DEFINITION('design',''," + pdf + ',' + pdCtx + ')');
    return { pd, pds: E("PRODUCT_DEFINITION_SHAPE(''," + "''," + pd + ')') };
  };
  const styled = [], reports = [];
  const writeBrep = (brep, name) => {
    const cp = new Map(), cpt = (i) => { if (!cp.has(i)) cp.set(i, pt(brep.points[i])); return cp.get(i); };
    const vp = new Map(), vertex = (i) => { if (!vp.has(i)) vp.set(i, E("VERTEX_POINT(''," + cpt(i) + ')')); return vp.get(i); };
    const ec = new Map(), edge = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (!ec.has(k)) {
        const lo = Math.min(a, b), hi = Math.max(a, b), A = brep.points[lo], B = brep.points[hi], d = V.sub(B, A), L = V.len(d);
        const line = E("LINE(''," + cpt(lo) + ',' + E("VECTOR(''," + dir(V.mul(d, 1 / L)) + ',' + R(L) + ')') + ')');
        ec.set(k, { id: E("EDGE_CURVE(''," + vertex(lo) + ',' + vertex(hi) + ',' + line + ',.T.)'), lo });
      }
      const e = ec.get(k); return E("ORIENTED_EDGE('',*,*," + e.id + ',' + (a === e.lo ? '.T.' : '.F.') + ')');
    };
    const fids = [];
    for (const f of brep.faces) {
      const n = f.n, ref = Math.abs(n[0]) < 0.9 ? V.norm(V.cross(n, [1, 0, 0])) : V.norm(V.cross(n, [0, 1, 0]));
      const plane = E("PLANE(''," + E("AXIS2_PLACEMENT_3D(''," + cpt(f.loops[0][0]) + ',' + dir(n) + ',' + dir(ref) + ')') + ')');
      const bounds = f.loops.map((L, li) => E((li === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND') + "(''," + E("EDGE_LOOP(''," + list(L.map((a, i) => edge(a, L[(i + 1) % L.length]))) + ')') + ',.T.)'));
      fids.push(E("ADVANCED_FACE(''," + list(bounds) + ',' + plane + ',.T.)'));
    }
    return E('MANIFOLD_SOLID_BREP(' + S(name) + ',' + E("CLOSED_SHELL(''," + list(fids) + ')') + ')');
  };
  const origin = () => axis([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const partReps = [];
  for (const part of parts) {
    const brep = part.brep || solidToBrep(part.solid, { tol: meta.tol });
    reports.push({ name: part.name, ...brep.stats });
    const solid = writeBrep(brep, part.name), ax = origin();
    const abs = E('ADVANCED_BREP_SHAPE_REPRESENTATION(' + S(part.name) + ',(' + ax + ',' + solid + '),' + ctx + ')');
    const prod = product(part.name, part.description);
    const sr0 = E("SHAPE_REPRESENTATION(''," + '(' + ax + '),' + ctx + ')');
    E("SHAPE_DEFINITION_REPRESENTATION(" + prod.pds + ',' + sr0 + ')');
    E("SHAPE_REPRESENTATION_RELATIONSHIP(''," + "''," + sr0 + ',' + abs + ')');
    if (part.color) {
      const c = E("COLOUR_RGB(''," + part.color.map(x => R(Math.max(0, Math.min(1, x)))).join(',') + ')');
      const fill = E("FILL_AREA_STYLE(''," + '(' + E("FILL_AREA_STYLE_COLOUR(''," + c + ')') + '))');
      const side = E("SURFACE_SIDE_STYLE(''," + '(' + E('SURFACE_STYLE_FILL_AREA(' + fill + ')') + '))');
      styled.push(E("STYLED_ITEM('color',(" + E('PRESENTATION_STYLE_ASSIGNMENT((' + E('SURFACE_STYLE_USAGE(.BOTH.,' + side + ')') + '))') + '),' + solid + ')'));
    }
    partReps.push({ prod, sr0, ax });
  }
  if (occurrences.length > 1 || occurrences.some(q => q.T)) {
    /* the assembly: a root product holding each occurrence at its place (unplaced parts are already in world coordinates) */
    const root = product(meta.name || 'Assembly', 'assembly'), rax = origin();
    const places = occurrences.map(q => q.T ? axis(M4.point(q.T, [0, 0, 0]), V.norm(M4.dir(q.T, [0, 0, 1])), V.norm(M4.dir(q.T, [1, 0, 0]))) : rax);
    const rsr = E("SHAPE_REPRESENTATION(''," + list([...new Set(places)]) + ',' + ctx + ')');
    E('SHAPE_DEFINITION_REPRESENTATION(' + root.pds + ',' + rsr + ')');
    occurrences.forEach((q, i) => {
      const p = partReps[q.part];
      const nauo = E('NEXT_ASSEMBLY_USAGE_OCCURRENCE(' + S(String(i + 1)) + ',' + S(q.name || parts[q.part].name) + ",''," + root.pd + ',' + p.prod.pd + ',$)');
      const pds = E("PRODUCT_DEFINITION_SHAPE('Placement','Placement of an item'," + nauo + ')');
      const idt = E("ITEM_DEFINED_TRANSFORMATION(''," + "''," + places[i] + ',' + p.ax + ')');   /* where it goes in the assembly, then its own origin */
      const rel = E("(REPRESENTATION_RELATIONSHIP(''," + "''," + p.sr0 + ',' + rsr + ')REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(' + idt + ')SHAPE_REPRESENTATION_RELATIONSHIP())');
      E('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(' + rel + ',' + pds + ')');
    });
  }
  if (styled.length) E("MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION(''," + list(styled) + ',' + ctx + ')');
  const now = meta.date || new Date().toISOString().slice(0, 19);
  const head = ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('" + 'SketchFlow 3D model' + "'),'2;1');",
    'FILE_NAME(' + S(meta.file || 'model.step') + ',' + S(now) + ',(' + S(meta.author || '') + "),(''),'SketchFlow 2','SketchFlow STEP writer','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;'];
  return { text: head.concat(lines, ['ENDSEC;', 'END-ISO-10303-21;']).join('\n') + '\n', reports };
}

/* ---------- reading (to vet what was written) ---------- */
/* entities: Map id → {type, args} or, for a complex entity, {type: null, parts: {TYPE: args}} */
export function readStep(text) {
  const t = String(text), errors = [];
  if (!/^\s*ISO-10303-21;/.test(t)) errors.push('does not start with ISO-10303-21;');
  if (!/END-ISO-10303-21;\s*$/.test(t)) errors.push('does not end with END-ISO-10303-21;');
  const hs = t.indexOf('HEADER;'), ds = t.indexOf('\nDATA;'), de = t.lastIndexOf('ENDSEC;');
  if (hs < 0 || ds < 0 || de < ds) { errors.push('missing HEADER / DATA sections'); return { entities: new Map(), header: '', errors }; }
  const header = t.slice(hs, ds), body = t.slice(ds + 6, de);
  /* statements end at ';' outside strings */
  const stmts = []; let cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { cur += ch; if (ch === "'") { if (body[i + 1] === "'") { cur += "'"; i++; } else inStr = false; } continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') { if (cur.trim()) stmts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) errors.push('text after the last ;');
  const entities = new Map();
  for (const st of stmts) {
    const m = /^#(\d+)\s*=\s*([\s\S]*)$/.exec(st); if (!m) { errors.push('not an entity: ' + st.slice(0, 60)); continue; }
    const id = +m[1]; if (entities.has(id)) errors.push('#' + id + ' is defined twice');
    try { entities.set(id, parseInstance(m[2].trim())); } catch (e) { errors.push('#' + id + ': ' + e.message); }
  }
  return { entities, header, errors };
}
function parseInstance(s) {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const kw = () => { ws(); const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i)); if (!m) throw new Error('expected a keyword at ' + s.slice(i, i + 20)); i += m[0].length; return m[0].toUpperCase(); };
  const value = () => {
    ws(); const ch = s[i];
    if (ch === '(') { i++; const out = []; ws(); if (s[i] === ')') { i++; return out; } for (;;) { out.push(value()); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === ')') { i++; return out; } throw new Error('expected , or ) in a list'); } }
    if (ch === "'") { let j = i + 1, out = ''; for (;;) { if (j >= s.length) throw new Error('unterminated string'); if (s[j] === "'") { if (s[j + 1] === "'") { out += "'"; j += 2; continue; } break; } out += s[j++]; } i = j + 1; return { str: out }; }
    if (ch === '#') { const m = /^#(\d+)/.exec(s.slice(i)); i += m[0].length; return { ref: +m[1] }; }
    if (ch === '.') { const m = /^\.([A-Za-z_0-9]+)\./.exec(s.slice(i)); if (!m) throw new Error('bad enumeration'); i += m[0].length; return { enum: m[1].toUpperCase() }; }
    if (ch === '$') { i++; return { unset: true }; }
    if (ch === '*') { i++; return { derived: true }; }
    if (/[-+0-9]/.test(ch)) { const m = /^[-+]?\d+(\.\d*)?([eE][-+]?\d+)?/.exec(s.slice(i)); i += m[0].length; return { num: +m[0], real: m[0].includes('.') }; }
    const k = kw(); ws(); if (s[i] !== '(') throw new Error('expected ( after ' + k); const args = value(); return { typed: k, args };
  };
  ws();
  if (s[i] === '(') {
    /* complex instance: (A(...) B(...) …) */
    i++; const parts = {};
    for (;;) { ws(); if (s[i] === ')') { i++; break; } const k = kw(); ws(); if (s[i] !== '(') throw new Error('expected ( after ' + k); parts[k] = value(); }
    ws(); if (i < s.length) throw new Error('text after a complex entity');
    return { type: null, parts };
  }
  const type = kw(); ws(); if (s[i] !== '(') throw new Error('expected ( after ' + type); const args = value(); ws(); if (i < s.length) throw new Error('text after the entity');
  return { type, args };
}

/* vet a STEP file: structure, topology and geometry of every solid. expect: [{name, volume, bbox}] to compare with */
export function vetStep(text, expect = [], o = {}) {
  const tol = o.tol || 1e-4, { entities, header, errors } = readStep(text), warnings = [];
  if (!/FILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN/.test(header)) errors.push('FILE_SCHEMA is not AUTOMOTIVE_DESIGN (AP214)');
  /* every reference resolves */
  const walk = (v, fn) => { if (Array.isArray(v)) v.forEach(x => walk(x, fn)); else if (v && v.ref != null) fn(v.ref); else if (v && v.typed) walk(v.args, fn); };
  let badRef = 0;
  for (const [id, e] of entities) { const args = e.type ? e.args : Object.values(e.parts); walk(args, (r) => { if (!entities.has(r)) { if (badRef++ < 5) errors.push(`#${id} refers to #${r}, which does not exist`); } }); }
  const get = (r, type) => { const e = entities.get(r && r.ref != null ? r.ref : r); if (!e) throw new Error('missing #' + (r && r.ref)); if (type && e.type !== type) throw new Error(`#${r.ref} is ${e.type}, expected ${type}`); return e; };
  const num = (v) => { if (!v || v.num == null) throw new Error('expected a number'); return v.num; };
  const point = (r) => get(r, 'CARTESIAN_POINT').args[1].map(num);
  const direction = (r) => V.norm(get(r, 'DIRECTION').args[1].map(num));
  const solids = [];
  for (const [id, e] of entities) {
    if (e.type !== 'MANIFOLD_SOLID_BREP') continue;
    const rep = { id, name: e.args[0].str, faces: 0, loops: 0, edges: 0, vertices: 0, volume: 0, area: 0, bbox: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, problems: [] };
    try {
      const shell = get(e.args[1], 'CLOSED_SHELL'), use = new Map(), verts = new Set(); let vol = 0;
      for (const fr of shell.args[1]) {
        const face = get(fr, 'ADVANCED_FACE'), plane = get(face.args[2], 'PLANE'), ax = get(plane.args[1], 'AXIS2_PLACEMENT_3D');
        const o0 = point(ax.args[1]), n0 = direction(ax.args[2]), sense = face.args[3].enum === 'T' ? 1 : -1, n = V.mul(n0, sense);
        rep.faces++; let vecArea = [0, 0, 0], outer = 0;
        for (const br of face.args[1]) {
          const bound = get(br); if (bound.type !== 'FACE_OUTER_BOUND' && bound.type !== 'FACE_BOUND') throw new Error('a face bound is ' + bound.type);
          if (bound.type === 'FACE_OUTER_BOUND') outer++;
          const loop = get(bound.args[1], 'EDGE_LOOP'), flip = bound.args[2].enum === 'T' ? 1 : -1, oes = loop.args[1].map(r => get(r, 'ORIENTED_EDGE'));
          rep.loops++;
          const pts = [];
          let prevEnd = null, firstStart = null;
          const seq = flip > 0 ? oes : oes.slice().reverse();
          for (const oe of seq) {
            const ecRef = oe.args[3].ref, ec = get(oe.args[3], 'EDGE_CURVE'), fwd = (oe.args[4].enum === 'T') === (flip > 0);
            const vs = ec.args[1].ref, ve = ec.args[2].ref, start = fwd ? vs : ve, end = fwd ? ve : vs;
            if (ec.args[4].enum !== 'T') throw new Error('an edge curve runs against its line');
            const line = get(ec.args[3], 'LINE'), lp = point(line.args[1]), vec = get(line.args[2], 'VECTOR'), ld = direction(vec.args[1]);
            const pS = point(get({ ref: vs }, 'VERTEX_POINT').args[1]), pE = point(get({ ref: ve }, 'VERTEX_POINT').args[1]);
            for (const q of [pS, pE]) { const w = V.sub(q, lp); if (V.len(V.sub(w, V.mul(ld, V.dot(w, ld)))) > tol) throw new Error('an edge vertex is off its line'); }
            if (prevEnd != null && prevEnd !== start) throw new Error('a loop does not join up');
            if (firstStart == null) firstStart = start; prevEnd = end;
            const k = ecRef + (fwd ? '+' : '-'); use.set(k, (use.get(k) || 0) + 1);
            pts.push(fwd ? pS : pE); verts.add(vs); verts.add(ve);
          }
          if (prevEnd !== firstStart) throw new Error('a loop does not close');
          for (const q of pts) { if (Math.abs(V.dot(V.sub(q, o0), n0)) > tol) throw new Error(`a vertex is ${Math.abs(V.dot(V.sub(q, o0), n0)).toExponential(2)} off its face's plane`); for (let k = 0; k < 3; k++) { rep.bbox.min[k] = Math.min(rep.bbox.min[k], q[k]); rep.bbox.max[k] = Math.max(rep.bbox.max[k], q[k]); } }
          let s = [0, 0, 0]; for (let i = 0; i < pts.length; i++) s = V.add(s, V.cross(pts[i], pts[(i + 1) % pts.length]));
          const la = V.dot(s, n) / 2; if (bound.type === 'FACE_OUTER_BOUND' && la <= 0) throw new Error('an outer loop runs against its face normal');
          vecArea = V.add(vecArea, V.mul(s, 0.5));
        }
        if (outer !== 1) throw new Error(`a face has ${outer} outer bounds`);
        if (V.dot(vecArea, n) <= 0) throw new Error('a face\'s holes are bigger than its outline');
        vol += V.dot(o0, vecArea) / 3; rep.area += V.len(vecArea);
      }
      /* closed and oriented: every edge once each way */
      const edges = new Set([...use.keys()].map(k => k.slice(0, -1)));
      for (const ec of edges) { const a = use.get(ec + '+') || 0, b = use.get(ec + '-') || 0; if (a !== 1 || b !== 1) { rep.problems.push(`edge #${ec} is used ${a}× forwards and ${b}× backwards (needs 1 and 1)`); if (rep.problems.length > 5) break; } }
      rep.edges = edges.size; rep.vertices = verts.size; rep.volume = vol;
      /* Euler–Poincaré for one shell: V − E + F − (L − F) = 2 (1 − genus) */
      const chi = rep.vertices - rep.edges + rep.faces - (rep.loops - rep.faces); rep.genus = 1 - chi / 2;
      if (!Number.isInteger(rep.genus) || rep.genus < 0) rep.problems.push(`Euler–Poincaré gives genus ${rep.genus}`);
      if (vol <= 0) rep.problems.push('the shell faces inward (negative volume)');
    } catch (err) { rep.problems.push(err.message); }
    solids.push(rep);
  }
  if (!solids.length) errors.push('no MANIFOLD_SOLID_BREP in the file');
  for (const s of solids) for (const p of s.problems) errors.push(`${s.name || '#' + s.id}: ${p}`);
  /* compare with the model */
  expect.forEach((x, i) => {
    const s = solids.find(q => q.name === x.name) || solids[i]; if (!s) { errors.push(`${x.name}: missing from the file`); return; }
    if (x.volume != null && Math.abs(s.volume - x.volume) > Math.max(1e-6 * Math.abs(x.volume), x.slack || 1e-6)) errors.push(`${x.name}: volume ${s.volume.toFixed(6)} in the file, ${x.volume.toFixed(6)} in the model`);
    if (x.area != null && Math.abs(s.area - x.area) > Math.max(1e-6 * x.area, x.areaSlack || 1e-6)) errors.push(`${x.name}: surface area ${s.area.toFixed(6)} in the file, ${x.area.toFixed(6)} in the model`);
    if (x.bbox) for (let k = 0; k < 3; k++) if (Math.abs(s.bbox.min[k] - x.bbox.min[k]) > tol * 10 || Math.abs(s.bbox.max[k] - x.bbox.max[k]) > tol * 10) { errors.push(`${x.name}: bounding box differs from the model`); break; }
  });
  const products = [...entities.values()].filter(e => e.type === 'PRODUCT').map(e => e.args[0].str);
  const assembly = [...entities.values()].filter(e => e.type === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE').length;
  return { ok: !errors.length, errors, warnings, solids, products, assembly, entities: entities.size };
}

/* the model's visible solids → a vetted STEP file. Returns {text, report}; report.ok is false (with reasons) if the file
   would not stand up, and nothing is hidden: the same checks run on every export */
export function exportStep(model, opts = {}) {
  let src = model, plain = 0;
  if (opts.threads === 'plain') { const c = cosmeticThreads(model.doc); plain = c.count; if (plain) { src = new model.constructor(); src.load(c.doc); } }
  model = src;
  const R = model.result, doc = model.doc, bodies = R.bodies.filter(b => !b.hidden && b.solid && !b.solid.isEmpty());
  if (!bodies.length) throw new Error('Nothing to export: the model has no solid parts');
  const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); return m ? [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16) / 255) : null; };
  const nameOf = (b) => { const o = model.get(b.id) || (R.virtual && R.virtual.has(b.id) ? model.get(R.virtual.get(b.id).source) : null); return (o && o.name) || b.name || b.id; };
  const seen = new Map(), uniq = (n) => { const k = seen.get(n) || 0; seen.set(n, k + 1); return k ? `${n} (${k + 1})` : n; };
  /* a pattern copy or a linked instance that is a rigid copy of a part already written is placed, not written again */
  const centroid = (sol) => { let v = 0, c = [0, 0, 0]; for (const p of sol.polys) { const a = p.v[0].p; for (let i = 1; i < p.v.length - 1; i++) { const b = p.v[i].p, d = p.v[i + 1].p, t = V.dot(a, V.cross(b, d)); v += t; c = V.add(c, V.mul(V.add(V.add(a, b), d), t)); } } return V.mul(c, 1 / (4 * v)); };
  const rigid = (T) => { const x = M4.dir(T, [1, 0, 0]), y = M4.dir(T, [0, 1, 0]), z = M4.dir(T, [0, 0, 1]); return Math.abs(V.len(x) - 1) < 1e-9 && Math.abs(V.len(y) - 1) < 1e-9 && Math.abs(V.dot(x, y)) < 1e-9 && V.dot(V.cross(x, y), z) > 1 - 1e-9; };
  const parts = [], occ = [], partOfBody = new Map(), later = [];
  for (const b of bodies) {
    const v = R.virtual && R.virtual.get(b.id), o = model.get(b.id), from = v ? v.source : o && o.type === 'instance' ? o.of : null;
    if (from && opts.instances !== false) later.push([b, from]); else partOfBody.set(b.id, addPart(b));
  }
  for (const [b, from] of later) {
    const pi = partOfBody.get(from), W1 = R.world.get(b.id), W0 = R.world.get(from);
    if (pi != null && W1 && W0) {
      const T = M4.mul(W1, M4.inv(W0)), base = parts[pi].solid, v0 = base.volume(), v1 = b.solid.volume();
      if (rigid(T) && Math.abs(v1 - v0) <= 1e-9 * Math.max(1, Math.abs(v0)) && V.len(V.sub(centroid(b.solid), M4.point(T, centroid(base)))) <= 1e-6 * Math.max(1, V.len(V.sub(base.bbox().max, base.bbox().min)))) {
        occ.push({ part: pi, T: M4.mul(T, occ.find(q => q.part === pi).T || M4.ident()), name: uniq(nameOf(b)) }); continue;
      }
    }
    partOfBody.set(b.id, addPart(b));
  }
  function addPart(b) {
    const o = model.get(b.id) || (R.virtual && R.virtual.has(b.id) ? model.get(R.virtual.get(b.id).source) : null) || {};
    const name = uniq(nameOf(b)), mat = (o.meta || {}).material || doc.material || '';
    parts.push({ name, description: mat ? 'material: ' + mat : '', color: hex(o.color || b.color), solid: b.solid });
    occ.push({ part: parts.length - 1, T: null, name }); return parts.length - 1;
  }
  const t0 = Date.now(), tol = opts.tol || 1e-5;
  const breps = parts.map(p => Object.assign(p, { brep: solidToBrep(p.solid, { tol }) }));
  const { text, reports } = writeStep(breps, { name: doc.name || 'Model', file: opts.file, tol, author: opts.author, date: opts.date }, occ);
  /* welding may move a corner by up to tol, so the volume may move by (surface area × tol); a hair-line hole the mesh had
     (closed here) changes the mesh's own volume figure by at most its area × the part's size */
  const slack = (p) => { const b = p.solid.bbox(), diag = V.len(V.sub(b.max, b.min)); return p.solid.area() * tol * 2 + (p.brep.stats.fillArea || 0) * (diag + V.len(b.max) + V.len(b.min)); };
  const vet = vetStep(text, parts.map(p => ({ name: p.name, volume: p.solid.volume(), area: p.solid.area(), areaSlack: (p.brep.stats.fillArea || 0) * 1.01 + p.solid.area() * 1e-6, bbox: p.solid.bbox(), slack: slack(p) })), { tol: Math.max(1e-4, tol * 10) });
  const report = { ok: vet.ok, errors: vet.errors.slice(0, 12), parts: vet.solids.map(s => ({ name: s.name, faces: s.faces, edges: s.edges, vertices: s.vertices, genus: s.genus, volume_mm3: +s.volume.toFixed(4), area_mm2: +s.area.toFixed(4) })),
    checks: ['every reference resolves', 'every loop closes', 'every edge used once each way (closed, oriented shell)', 'every vertex on its faces\' planes', 'outer loops agree with face normals', 'Euler–Poincaré genus is whole', 'volume, surface area and bounding box match the model'], products: vet.products.length, assembly: vet.assembly > 0, occurrences: occ.length, placed_copies: occ.filter(q => q.T).length, threads: plain ? `plain (${plain} threaded feature${plain > 1 ? 's' : ''} left cosmetic)` : 'modelled', entities: vet.entities, bytes: text.length, ms: Date.now() - t0, schema: 'AP214 (automotive_design)', geometry: 'exact planar B-rep (faceted curves)' };
  report.repairs = reports.filter(r => r.holesFilled || r.holesLeft).map(r => ({ part: r.name, hairline_holes_closed: r.holesFilled, area_mm2: r.fillArea, left_open: r.holesLeft }));
  return { text, report };
}

/* ---------- importing planar STEP (round trip, and faceted files from other tools) ---------- */
/* triangles of a planar face with holes (outline counter-clockwise, holes clockwise). Each hole, rightmost first, is joined
   to the outline by a bridge found the standard way (Eberly): a ray to the right from the hole's rightmost corner M hits
   the nearest edge at I; the bridge goes to that edge's right end P, unless a reflex corner lies inside triangle M-I-P,
   in which case to the one of those at the smallest angle. The joined outline is then ear-clipped. */
function triangulateWithHoles(outer, holes) {
  let ring = outer.slice();
  const X = (u, v) => u[0] * v[1] - u[1] * v[0], sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const sorted = holes.map(h => { let hi = 0; h.forEach((q, i) => { if (q.p[0] > h[hi].p[0]) hi = i; }); return { h, hi }; }).sort((a, b) => b.h[b.hi].p[0] - a.h[a.hi].p[0]);
  for (const { h, hi } of sorted) {
    const M = h[hi].p; let bestX = Infinity, bestK = -1, I = null;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k].p, b = ring[(k + 1) % ring.length].p;
      if ((a[1] > M[1]) === (b[1] > M[1]) && !(a[1] === M[1] || b[1] === M[1])) continue;
      if (a[1] === b[1]) { if (a[1] !== M[1]) continue; const x = Math.min(a[0], b[0]); if (x >= M[0] && x < bestX) { bestX = x; bestK = k; I = [x, M[1]]; } continue; }
      const t = (M[1] - a[1]) / (b[1] - a[1]); if (t < 0 || t > 1) continue;
      const x = a[0] + (b[0] - a[0]) * t; if (x >= M[0] - 1e-12 && x < bestX) { bestX = x; bestK = k; I = [x, M[1]]; }
    }
    let pi;
    if (bestK < 0) pi = 0;
    else {
      const a = ring[bestK], b = ring[(bestK + 1) % ring.length];
      pi = (Math.abs(I[0] - a.p[0]) < 1e-12 && Math.abs(I[1] - a.p[1]) < 1e-12) ? bestK : (Math.abs(I[0] - b.p[0]) < 1e-12 && Math.abs(I[1] - b.p[1]) < 1e-12) ? (bestK + 1) % ring.length : (a.p[0] > b.p[0] ? bestK : (bestK + 1) % ring.length);
      const P = ring[pi].p, inTri = (q) => { const s1 = X(sub(I, M), sub(q, M)), s2 = X(sub(P, I), sub(q, I)), s3 = X(sub(M, P), sub(q, P)); return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0); };
      let bestA = Infinity, bestD = Infinity;
      for (let k = 0; k < ring.length; k++) {
        if (k === pi) continue; const q = ring[k].p; if (q[0] < M[0] || (q[0] === P[0] && q[1] === P[1])) continue;
        const pv = ring[(k - 1 + ring.length) % ring.length].p, nx = ring[(k + 1) % ring.length].p; if (X(sub(q, pv), sub(nx, q)) >= 0) continue;   /* only reflex corners can block */
        if (!inTri(q)) continue;
        const ang = Math.abs(Math.atan2(q[1] - M[1], q[0] - M[0])), dd = (q[0] - M[0]) ** 2 + (q[1] - M[1]) ** 2;
        if (ang < bestA - 1e-12 || (Math.abs(ang - bestA) <= 1e-12 && dd < bestD)) { bestA = ang; bestD = dd; pi = k; }
      }
    }
    /* the corner may be in the ring more than once (an earlier bridge): use the copy whose inside angle the bridge enters */
    const P = ring[pi].p, copies = []; ring.forEach((q, k) => { if (q.p[0] === P[0] && q.p[1] === P[1]) copies.push(k); });
    if (copies.length > 1) for (const k of copies) {
      const pv = ring[(k - 1 + ring.length) % ring.length].p, nx = ring[(k + 1) % ring.length].p, d1 = sub(nx, P), d0 = sub(pv, P), r = sub(M, P), convex = X(d1, d0) > 0;
      if (convex ? (X(d1, r) > 0 && X(r, d0) > 0) : !(X(d0, r) > 0 && X(r, d1) > 0)) { pi = k; break; }
    }
    const hs = h.slice(hi).concat(h.slice(0, hi + 1));
    ring = ring.slice(0, pi + 1).concat(hs, [ring[pi]], ring.slice(pi + 1));
  }
  return earClip(ring.map(q => q.p)).map(([a, b, c]) => [ring[a].i, ring[b].i, ring[c].i]);
}
/* ear clipping that copes with bridged holes (repeated points) and runs of collinear points: an ear must turn left, and no
   other corner may lie strictly inside it (corners at the ear's own positions are the bridge's twins, not obstacles) */
function earClip(pts) {
  const n = pts.length; if (n < 3) return [];
  let idx = [...Array(n).keys()]; const out = [];
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const scale = Math.max(1e-9, ...pts.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1])))), eps = 1e-12 * scale * scale;
  const same = (p, q) => Math.abs(p[0] - q[0]) <= 1e-12 * scale && Math.abs(p[1] - q[1]) <= 1e-12 * scale;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = -1;
    for (let k = 0; k < idx.length && cut < 0; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], a = pts[ia], b = pts[ib], c = pts[ic];
      if (cr(a, b, c) <= eps) continue;
      let ok = true;
      for (const j of idx) { if (j === ia || j === ib || j === ic) continue; const p = pts[j]; if (same(p, a) || same(p, b) || same(p, c)) continue; if (cr(a, b, p) > eps && cr(b, c, p) > eps && cr(c, a, p) > eps) { ok = false; break; } }
      if (ok) cut = k;
    }
    if (cut < 0) {
      /* no clean ear (rounding): take the most convex corner, or drop a collinear one */
      let best = 0, bv = -Infinity; for (let k = 0; k < idx.length; k++) { const v = cr(pts[idx[(k + idx.length - 1) % idx.length]], pts[idx[k]], pts[idx[(k + 1) % idx.length]]); if (v > bv) { bv = v; best = k; } }
      if (bv <= eps) { idx.splice(best, 1); continue; }
      cut = best;
    }
    out.push([idx[(cut + idx.length - 1) % idx.length], idx[cut], idx[(cut + 1) % idx.length]]); idx.splice(cut, 1);
  }
  if (idx.length === 3 && cr(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > eps) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
export const _triangulateWithHoles = (outer, holes) => triangulateWithHoles(outer, holes);   /* for the tests */
/* solids from a STEP file whose faces are planes bounded by straight edges: [{name, solid}] (positions in mm) */
export function stepToSolids(text) {
  const { entities, errors } = readStep(text); if (errors.length) throw new Error('not a readable STEP file: ' + errors[0]);
  const get = (r) => entities.get(r.ref), num = (v) => v.num;
  const point = (r) => get(r).args[1].map(num), direction = (r) => V.norm(get(r).args[1].map(num));
  const unitScale = (() => { for (const e of entities.values()) if (!e.type && e.parts.LENGTH_UNIT && e.parts.SI_UNIT) { const pre = (e.parts.SI_UNIT[0] || {}).enum; return pre === 'MILLI' ? 1 : pre === 'CENTI' ? 10 : pre === 'DECI' ? 100 : pre === 'MICRO' ? 1e-3 : 1000; } return 1; })();
  const out = [], unsupported = new Set(), brepIds = [];
  for (const [bid, e] of entities) {
    if (e.type !== 'MANIFOLD_SOLID_BREP' && e.type !== 'BREP_WITH_VOIDS') continue;
    brepIds.push(bid);
    const shell = get(e.args[1]), polys = [];
    for (const fr of shell.args[1]) {
      const face = get(fr), surf = get(face.args[2]);
      if (face.type !== 'ADVANCED_FACE' && face.type !== 'FACE_SURFACE') { unsupported.add(face.type); continue; }
      if (surf.type !== 'PLANE') { unsupported.add(surf.type); continue; }
      const ax = get(surf.args[1]), n0 = V.mul(direction(ax.args[2]), face.args[3].enum === 'T' ? 1 : -1), o0 = point(ax.args[1]);
      const ex = Math.abs(n0[0]) < 0.9 ? V.norm(V.cross(n0, [1, 0, 0])) : V.norm(V.cross(n0, [0, 1, 0])), ey = V.cross(n0, ex);
      const loops = face.args[1].map(br => {
        const bound = get(br), loop = get(bound.args[1]), flip = bound.args[2].enum === 'T';
        if (loop.type !== 'EDGE_LOOP') { unsupported.add(loop.type); return null; }
        const seq = loop.args[1].map(r => get(r)), pts = [];
        for (const oe of flip ? seq : seq.slice().reverse()) {
          const ec = get(oe.args[3]); if (get(ec.args[3]).type !== 'LINE') unsupported.add(get(ec.args[3]).type);
          const fwd = (oe.args[4].enum === 'T') === flip, v = get(fwd ? ec.args[1] : ec.args[2]); pts.push(point(v.args[1]).map(x => x * unitScale));
        }
        return pts;
      }).filter(Boolean);
      if (!loops.length) continue;
      const all = [], flat = loops.map(L => L.map(p => { const i = all.length; all.push(p); const d = V.sub(p, V.mul(o0, unitScale)); return { p: [V.dot(d, ex), V.dot(d, ey)], i }; }));
      const tris = flat.length === 1 ? earClip(flat[0].map(q => q.p)).map(([a, b, c]) => [flat[0][a].i, flat[0][b].i, flat[0][c].i]) : triangulateWithHoles(flat[0], flat.slice(1));
      for (const [a, b, c] of tris) { const pl = K.poly([all[a], all[b], all[c]], 'step'); if (pl) { if (V.dot(pl.plane.n, n0) < 0) pl.flip(); polys.push(pl); } }
    }
    if (unsupported.size) throw new Error(`this STEP file has ${[...unsupported].join(', ')} geometry — only planar faces with straight edges can be read (SketchFlow's own STEP files, and faceted exports from other tools)`);
    out.push({ id: bid, name: e.args[0].str || 'Part', solid: new K.Solid(polys) });
  }
  if (!out.length) throw new Error('no solids (MANIFOLD_SOLID_BREP) in this STEP file');
  /* an assembly: each occurrence (NEXT_ASSEMBLY_USAGE_OCCURRENCE) places its part's solids by the transform between two axes */
  const repSolids = new Map(), addRep = (r, ids) => { if (!repSolids.has(r)) repSolids.set(r, new Set()); for (const i of ids) repSolids.get(r).add(i); };
  for (const [rid, e] of entities) if (e.type && /SHAPE_REPRESENTATION$/.test(e.type) && Array.isArray(e.args[1])) { const ids = e.args[1].filter(x => x.ref != null && brepIds.includes(x.ref)).map(x => x.ref); if (ids.length) addRep(rid, ids); }
  for (let pass = 0; pass < 3; pass++) for (const e of entities.values()) if (e.type === 'SHAPE_REPRESENTATION_RELATIONSHIP') { const a = e.args[2].ref, b = e.args[3].ref; if (repSolids.has(b)) addRep(a, repSolids.get(b)); if (repSolids.has(a)) addRep(b, repSolids.get(a)); }
  const frame = (r) => { const ax = get(r), o = point(ax.args[1]).map(x => x * unitScale), z = ax.args[2].unset ? [0, 0, 1] : direction(ax.args[2]), x0 = ax.args[3].unset ? [1, 0, 0] : direction(ax.args[3]); const xx = V.norm(V.sub(x0, V.mul(z, V.dot(x0, z)))), y = V.cross(z, xx); return [xx[0], xx[1], xx[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1]; };
  const placed = [], usedBreps = new Set();
  for (const e of entities.values()) {
    if (e.type !== 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION') continue;
    const rel = get(e.args[0]), pds = get(e.args[1]); if (rel.type || !rel.parts.REPRESENTATION_RELATIONSHIP || !rel.parts.REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION) continue;
    const child = rel.parts.REPRESENTATION_RELATIONSHIP[2].ref, idt = get(rel.parts.REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION[0]);
    if (!repSolids.has(child) || idt.type !== 'ITEM_DEFINED_TRANSFORMATION') continue;
    const T = M4.mul(frame(idt.args[2]), M4.inv(frame(idt.args[3]))), nauo = pds && pds.args[2] && get(pds.args[2]), nm = nauo && nauo.args[1] && nauo.args[1].str;
    for (const bid of repSolids.get(child)) { const src = out.find(x => x.id === bid); usedBreps.add(bid); placed.push({ name: nm || src.name, solid: src.solid.transform(T) }); }
  }
  return (placed.length ? placed.concat(out.filter(x => !usedBreps.has(x.id))) : out).map(({ name, solid }) => ({ name, solid }));
}

