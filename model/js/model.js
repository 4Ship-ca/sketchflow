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
  extrude: { label: 'Extrude', params: { profile: [[-10, -10], [10, -10], [10, 10], [-10, 10]], length: 20, twist: 0, scale: 1, direction: [0, 0, 1] } },
  loft: { label: 'Loft', params: { profile: [[-10, -10], [10, -10], [10, 10], [-10, 10]], profile2: null, length: 30, twist: 0 } },
  revolve: { label: 'Revolve', params: { profile: [[5, 0], [12, 0], [12, 4], [5, 4]], degrees: 360 } },
  sweep: { label: 'Sweep', params: { profile: [[-2, -2], [2, -2], [2, 2], [-2, 2]], path: [[0, 0, 0], [0, 0, 30], [30, 0, 30]] } },
  edge: { label: 'Edge treatment', params: { style: 'fillet', size: 4, mode: 'auto' } }
};
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
    case 'fillet': return [conn('edge', [0, 0, 0], [0, 1, 0], [1, 0, 1], 'edge'), conn('leg-x', [p.size / 2, 0, 0], [0, 0, -1], [1, 0, 0]), conn('leg-z', [0, 0, p.size / 2], [-1, 0, 0], [0, 0, 1]),
      conn('end-a', [0, -p.length / 2, 0], [0, -1, 0], [1, 0, 0]), conn('end-b', [0, p.length / 2, 0], [0, 1, 0], [1, 0, 0])];
    default: {
      /* features: start/end faces + bounding-box faces & centre */
      const c = [];
      if (o.type === 'extrude' || o.type === 'loft') {
        const cen = centroid2(p.profile), dir = o.type === 'extrude' ? V.norm(p.direction || [0, 0, 1]) : [0, 0, 1], L = p.length;
        const end = o.type === 'extrude' ? V.add([cen[0], cen[1], 0], V.mul(dir, L / (dir[2] || 1))) : [cen[0], cen[1], L];
        c.push(conn('start', [cen[0], cen[1], 0], [0, 0, -1], [1, 0, 0]), conn('end', end, [0, 0, 1], [1, 0, 0]));
      }
      if (solid && !solid.isEmpty()) {
        const b = solid.bbox(), m = V.lerp(b.min, b.max, 0.5);
        c.push(conn('center', m, [0, 0, 1], [1, 0, 0], 'center'));
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
    case 'extrude': return K.extrude(p.profile, { length: p.length, twist: p.twist, scale: p.scale, dir: p.direction });
    case 'loft': return K.loft(p.profile, p.profile2 || p.profile, { length: p.length, twist: p.twist });
    case 'revolve': return K.revolve(p.profile, { degrees: p.degrees });
    case 'sweep': return K.sweep(p.profile, p.path);
  }
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
    case 'extrude': { const c = centroid2(p.profile), dir = V.norm(p.direction || [0, 0, 1]); return [D('length', [c[0], c[1], 0], V.add([c[0], c[1], 0], V.mul(dir, p.length / (dir[2] || 1))), 'auto')]; }
    case 'loft': { const c = centroid2(p.profile); return [D('length', [c[0], c[1], 0], [c[0], c[1], p.length], 'auto')]; }
    default: return [];
  }
}

/* ---------- document ---------- */
export function newDoc(name) { return { v: 2, name: name || 'Model', units: 'mm', objects: [], origin: null, ground: null, dims: [], created: Date.now(), updated: Date.now() }; }
function defaultParams(type, given) {
  const base = JSON.parse(JSON.stringify(TYPES[type].params)), out = Object.assign(base, given || {});
  for (const k of Object.keys(out)) if (typeof base[k] === 'number' && typeof out[k] === 'string' && out[k] !== '' && isFinite(+out[k])) out[k] = +out[k];
  if (type === 'loft' && !out.profile2) out.profile2 = out.profile;
  return out;
}

/* ---------- evaluation ---------- */
const BODY_CACHE = new Map(), LOCAL_CACHE = new Map();
function cachedLocal(o) {
  const key = o.type + '|' + JSON.stringify(o.params); let s = LOCAL_CACHE.get(key);
  if (!s) { s = localSolid(o); LOCAL_CACHE.set(key, s); if (LOCAL_CACHE.size > 200) LOCAL_CACHE.delete(LOCAL_CACHE.keys().next().value); }
  return s;
}
export function evaluate(doc) {
  const R = { world: new Map(), local: new Map(), conns: new Map(), bodies: [], errors: new Map(), warnings: [], roots: [], originPoint: [0, 0, 0], consumed: new Set() };
  const byId = new Map(doc.objects.map(o => [o.id, o]));
  const ground = byId.get(doc.ground) ? doc.ground : (doc.objects.find(o => o.type !== 'edge') || {}).id;
  R.ground = ground;
  /* local solids + connectors */
  for (const o of doc.objects) {
    if (o.type === 'edge') continue;
    try { const s = cachedLocal(o); R.local.set(o.id, s); R.conns.set(o.id, connectorsOf(o, s)); }
    catch (e) { R.errors.set(o.id, e.message); R.conns.set(o.id, connectorsOf(o, null)); }
  }
  /* world transforms: mates resolved from the ground outward */
  const state = new Map();
  const poseM = (o) => { const p = o.pose || {}; return M4.mul(M4.translate(p.at || [0, 0, 0]), M4.euler(...(p.rot || [0, 0, 0]))); };
  const worldOf = (id) => {
    if (R.world.has(id)) return R.world.get(id);
    const o = byId.get(id); if (!o) return M4.ident();
    if (state.get(id) === 'busy') { R.warnings.push({ kind: 'cycle', id, text: `${o.name}: its mates form a loop` }); return poseM(o); }
    state.set(id, 'busy');
    let M = poseM(o);
    const m = o.mate;
    if (m && id !== ground) {
      const target = m.to === 'origin' ? null : byId.get(m.to);
      if (m.to !== 'origin' && !target) R.warnings.push({ kind: 'orphan', id, text: `${o.name}: mated to a deleted object` });
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
  for (const o of doc.objects) if (o.type !== 'edge') worldOf(o.id);
  /* floating = not grounded, not fixed, and no mate chain to the ground / origin */
  const grounded = (id, seen = new Set()) => { if (id === ground) return true; const o = byId.get(id); if (!o || seen.has(id)) return false; seen.add(id); if (o.fixed) return true; if (!o.mate) return false; return o.mate.to === 'origin' || grounded(o.mate.to, seen); };
  for (const o of doc.objects) if (o.type !== 'edge' && !grounded(o.id)) R.warnings.push({ kind: 'floating', id: o.id, text: `${o.name} is floating — not mated to anything` });
  /* bodies: booleans in feature-list order */
  const memo = new Map();
  const bodyOf = (id, chain = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const o = byId.get(id); if (!o || chain.has(id)) return K.Solid.empty();
    chain.add(id);
    let s = R.local.has(id) ? R.local.get(id).transform(R.world.get(id)).tag(id) : K.Solid.empty();
    for (const t of doc.objects) {
      if (t.into !== id) continue;
      R.consumed.add(t.id);
      try {
        if (t.type === 'edge') { s = applyEdge(s, t, o, R); continue; }
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
  /* body cache: a body is rebuilt only when something it is made of changed (shape, size, place, booleans, edges) */
  const r9 = (M) => (M ? Array.from(M, v => Math.round(v * 1e7) / 1e7) : null);
  const sig = (id, seen = new Set()) => {
    const o = byId.get(id); if (!o || seen.has(id)) return null; seen.add(id);
    return [o.type, o.params, o.op, o.edge || null, r9(R.world.get(id)), R.errors.get(id) || null, doc.objects.filter(t => t.into === id).map(t => sig(t.id, seen))];
  };
  const subtree = (id, out = []) => { for (const t of doc.objects) if (t.into === id && !out.includes(t.id)) { out.push(t.id); subtree(t.id, out); } return out; };
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
    BODY_CACHE.set(id + '|' + key, entry); if (BODY_CACHE.size > 120) BODY_CACHE.delete(BODY_CACHE.keys().next().value);
    return solid;
  };
  for (const o of doc.objects) {
    if (o.type === 'edge' || (o.into && byId.has(o.into))) continue;
    const s = cachedBody(o.id);
    if (s.isEmpty() && !R.errors.has(o.id)) R.warnings.push({ kind: 'empty', id: o.id, text: `${o.name}: nothing left after its booleans` });
    R.bodies.push({ id: o.id, solid: s, color: o.color, name: o.name, hidden: !!o.hidden });
    R.roots.push(o.id);
  }
  /* ephemeral world origin: a connector the user (or the first object) chose; display coordinates are relative to it */
  const og = doc.origin && byId.get(doc.origin.obj) ? doc.origin : (ground ? { obj: ground, conn: 'bottom' } : null);
  if (og) { const c = (R.conns.get(og.obj) || []).find(x => x.name === og.conn); if (c) R.originPoint = M4.point(R.world.get(og.obj), c.o); }
  R.originRef = og;
  for (const [id, msg] of R.errors) { const o = byId.get(id); R.warnings.push({ kind: 'error', id, text: `${o ? o.name : id}: ${msg}` }); }
  return R;
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
const SMOOTH = /:(side|surface|rev\d+|arc)$/;
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

/* ---------- the API ---------- */
export class Model {
  constructor(doc) { this.doc = doc || newDoc(); this.undoStack = []; this.redoStack = []; this.listeners = new Set(); this.result = null; this.recompute(); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) try { f(this); } catch (e) { console.error(e); } }
  recompute() { const t0 = performance.now(); this.result = evaluate(this.doc); this.result.ms = performance.now() - t0; return this.result; }
  get(id) { return this.doc.objects.find(o => o.id === id); }
  snapshot() { return JSON.stringify(this.doc); }
  commit(label, before, t0) { this.undoStack.push({ label, json: before }); if (this.undoStack.length > 150) this.undoStack.shift(); this.redoStack = []; this.doc.updated = Date.now(); this.recompute(); if (t0 != null) this.result.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0; this.emit(); }
  undo() { const s = this.undoStack.pop(); if (!s) return false; this.redoStack.push({ label: s.label, json: this.snapshot() }); this.doc = JSON.parse(s.json); this.recompute(); this.emit(); return s.label; }
  redo() { const s = this.redoStack.pop(); if (!s) return false; this.undoStack.push({ label: s.label, json: this.snapshot() }); this.doc = JSON.parse(s.json); this.recompute(); this.emit(); return s.label; }
  load(doc) { const before = this.snapshot(); this.doc = doc; this.commit('Open model', before); }
  /* apply a batch of operations atomically (one undo step). Returns per-op results. */
  /* opts.relative: positions (at, near) are measured from the ephemeral world origin, the same frame describe() reports */
  apply(ops, label, opts = {}) {
    const before = this.snapshot(), out = [], t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    this.rel = !!opts.relative;
    try { (Array.isArray(ops) ? ops : [ops]).forEach((op, i) => { try { out.push(this.op(op)); } catch (e) { e.message = `op ${i + 1} (${op && op.op}): ${e.message}`; throw e; } }); }
    catch (e) { this.doc = JSON.parse(before); this.recompute(); throw e; }
    finally { this.rel = false; }
    this.commit(label || (out.length === 1 ? out[0].label : out.length + ' changes'), before, t0);   /* ms = the whole batch, what the user waited for */
    return out.map(r => { delete r.label; return r; });
  }
  op(o) {
    const d = this.doc, need = (id) => { const x = this.get(id); if (!x) throw new Error('No object “' + id + '”. Objects: ' + (d.objects.map(y => y.id).join(', ') || 'none yet')); return x; };
    const W = (p) => (Array.isArray(p) && this.rel ? V.add(p.map(Number), this.result.originPoint) : p);
    switch (o.op) {
      case 'add': {
        const type = o.type || o.shape; if (!TYPES[type] || type === 'edge') throw new Error('Unknown shape “' + type + '”. Use ' + Object.keys(TYPES).filter(t => t !== 'edge').join(', '));
        const id = o.id && !this.get(o.id) ? String(o.id) : uid(type.slice(0, 3));
        const ob = { id, name: o.name || TYPES[type].label + ' ' + (d.objects.filter(x => x.type === type).length + 1), type, params: defaultParams(type, o.params), pose: { at: W(o.at) || [0, 0, 0], rot: o.rot || [0, 0, 0] }, mate: null, into: null, op: null, color: o.color || null, fixed: !!o.fixed };
        d.objects.push(ob);
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
        if (o.params) { x.params = Object.assign({}, x.params, o.params); for (const k of Object.keys(o.params)) if (typeof TYPES[x.type].params[k] === 'number') x.params[k] = num(+x.params[k], TYPES[x.type].params[k]); }
        if (o.name) x.name = String(o.name); if (o.color !== undefined) x.color = o.color; if (o.hidden !== undefined) x.hidden = !!o.hidden;
        if (o.at || o.rot) { x.pose = { at: W(o.at) || (x.pose || {}).at || [0, 0, 0], rot: o.rot || (x.pose || {}).rot || [0, 0, 0] }; }
        if (o.fixed !== undefined) x.fixed = !!o.fixed;
        this.recompute(); return { label: 'Edit ' + x.name, id: x.id };
      }
      case 'mate': {
        const x = need(o.id); if (o.to !== 'origin') need(o.to);
        if (o.to === x.id) throw new Error('An object cannot mate to itself');
        const tconns = o.to === 'origin' ? ORIGIN_CONNS : (this.result.conns.get(o.to) || connectorsOf(need(o.to), null));
        const sconns = this.result.conns.get(x.id) || connectorsOf(x, null);
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
        d.objects.push({ id, name: o.name || (style === 'chamfer' ? 'Chamfer' : style === 'weld' ? 'Weld' : 'Fillet') + ' ' + (d.objects.filter(x => x.type === 'edge').length + 1), type: 'edge', params: { style, size: num(o.size, 4), mode: o.mode || 'auto' }, edge: { m: M4.point(Mi, e.m), d: M4.dir(Mi, e.d), faces: e.sids }, into: body.id, op: 'edge', pose: null, mate: null });
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
      case 'delete': {
        const x = need(o.id); d.objects = d.objects.filter(y => y.id !== x.id);
        for (const y of d.objects) { if (y.into === x.id && y.type === 'edge') y.into = '__deleted__'; }
        if (d.ground === x.id) d.ground = null; if (d.origin && d.origin.obj === x.id) d.origin = null;
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
        for (const w of this.result.warnings) if (w.kind === 'floating') { const y = this.get(w.id); if (y && o.fixFloating) { const M = this.result.world.get(y.id); if (M) y.pose = poseFromMatrix(M); y.fixed = true; n++; } }
        this.recompute(); return { label: 'Clean up (' + n + ' fixes)', fixes: n };
      }
      case 'dim': { const id = uid('dim'); d.dims.push({ id, a: o.a, b: o.b, view: o.view || 'front' }); return { label: 'Add dimension', id }; }
      case 'undim': { d.dims = d.dims.filter(x => x.id !== o.id); return { label: 'Remove dimension', id: o.id }; }
      case 'rename': { d.name = String(o.name || d.name); return { label: 'Rename model', name: d.name }; }
    }
    throw new Error('Unknown op “' + o.op + '”');
  }
  bodyContaining(id) {
    let cur = this.get(id); const seen = new Set();
    while (cur && cur.into && !seen.has(cur.id)) { seen.add(cur.id); cur = this.get(cur.into); }
    return cur ? this.result.bodies.find(b => b.id === cur.id) : null;
  }
  /* summary for the AI and the tree */
  describe() {
    const R = this.result;
    return {
      name: this.doc.name, units: this.doc.units, ground: R.ground, origin: R.originRef, origin_point: R.originPoint.map(v => +v.toFixed(3)),
      objects: this.doc.objects.map(o => {
        const M = R.world.get(o.id), at = M ? [M[12], M[13], M[14]].map((v, k) => +(v - R.originPoint[k]).toFixed(3)) : null;
        return { id: o.id, name: o.name, type: o.type, params: o.params, at, mate: o.mate, boolean: o.into ? { into: o.into, mode: o.op } : null, fixed: !!o.fixed, resolved: o._resolved,
          connectors: o.type === 'edge' ? undefined : (R.conns.get(o.id) || []).map(c => c.name) };
      }),
      bodies: R.bodies.map(b => ({ id: b.id, name: b.name, volume: +b.solid.volume().toFixed(3), bbox: (() => { const bb = b.solid.bbox(); return b.solid.isEmpty() ? null : { min: bb.min.map((v, k) => +(v - R.originPoint[k]).toFixed(3)), max: bb.max.map((v, k) => +(v - R.originPoint[k]).toFixed(3)) }; })() })),
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
