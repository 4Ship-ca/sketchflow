/* SketchFlow 3D add-on: Welding & joining.
   Pick two parts (or a point where they meet): the add-on finds the joint between them — butt, tee, corner or lap —
   reads both thicknesses, the materials, how well a torch can reach each side and the welding position, and suggests a
   joint for LIGHT, REGULAR and HEAVY service by common standards:
     ISO 9692-1 / -3 (edge preparations, steel / aluminium), AWS D1.1 (prequalified joints, minimum fillet sizes),
     EN 1993-1-8 (fillet throat), ISO 5817 (quality levels B / C / D), ISO 4063 (process numbers), ISO 2553 (symbols),
     IIW fatigue recommendations (toe grinding), and for non-welded joints adhesive-joint and marine (FRP tabbing) practice.
   Each suggestion carries the preparation (square, V, X, bevel, K, J, U, none), root gap and face, the process, sizes,
   passes, weld metal, labour and machining time, cost, an ease score and the reasons. Applying one cuts the preparation
   out of the parts, opens the root gap, places the weld metal (or adhesive, filler, laminate) as a part of its own, and
   labels the joint with its weld symbol — all attached to the parts, so they follow them.
   Materials that cannot be fusion-welded (aluminium to steel, plastics, wood, composites) get bonded, filled or
   fibre-reinforced joints instead — or ask for one with method. Plain object, no imports: the host passes the kernel. */

const DEG = Math.PI / 180;
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
const half = (v) => Math.round(v * 2) / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- materials: how each one joins ---------- */
const MAT = {
  steel: { cls: 'steel', label: 'carbon steel (S235–S355)', weld: true, filler: 'G 42 4 M21 3Si1 (ER70S-6)', rho: 7.85, vAngle: 60, cost: 3 },
  stainless: { cls: 'stainless', label: 'austenitic stainless (304/316)', weld: true, filler: 'G 19 9 L Si (ER308LSi)', rho: 7.9, vAngle: 60, cost: 12 },
  aluminium: { cls: 'aluminium', label: 'aluminium (5xxx / 6xxx)', weld: true, filler: 'S Al 5356 (ER5356)', rho: 2.7, vAngle: 70, cost: 10 },
  cast_iron: { cls: 'cast_iron', label: 'cast iron', weld: true, filler: 'E C Ni-CI (ENi-CI)', rho: 7.2, vAngle: 70, cost: 40 },
  titanium: { cls: 'titanium', label: 'titanium', weld: true, filler: 'S Ti 0120 (ERTi-2)', rho: 4.5, vAngle: 60, cost: 90 },
  copper: { cls: 'copper', label: 'copper', braze: true, rho: 8.9 }, brass: { cls: 'copper', label: 'brass', braze: true, rho: 8.5 }, bronze: { cls: 'copper', label: 'bronze', braze: true, rho: 8.8 },
  carbon_fibre: { cls: 'composite', label: 'carbon fibre (CFRP)', rho: 1.6 }, gfrp: { cls: 'composite', label: 'glass fibre (GFRP)', rho: 1.8 },
  oak: { cls: 'wood', label: 'oak', rho: 0.75 }, pine: { cls: 'wood', label: 'pine', rho: 0.5 }, plywood: { cls: 'wood', label: 'plywood', rho: 0.68 }, mdf: { cls: 'wood', label: 'MDF', rho: 0.75 },
  pla: { cls: 'plastic', label: 'PLA', rho: 1.24, print: true }, petg: { cls: 'plastic', label: 'PETG', rho: 1.27, print: true }, abs: { cls: 'plastic', label: 'ABS', rho: 1.04, solvent: true }, asa: { cls: 'plastic', label: 'ASA', rho: 1.07, solvent: true },
  tpu: { cls: 'plastic', label: 'TPU', rho: 1.21, flexible: true }, nylon: { cls: 'plastic', label: 'nylon', rho: 1.01, hard: true }, pa_cf: { cls: 'plastic', label: 'nylon CF', rho: 1.15, hard: true }, pom: { cls: 'plastic', label: 'POM (acetal)', rho: 1.41, hard: true },
  acrylic: { cls: 'plastic', label: 'acrylic', rho: 1.18, solvent: true }, polycarbonate: { cls: 'plastic', label: 'polycarbonate', rho: 1.2, solvent: true },
  resin: { cls: 'thermoset', label: 'cured resin', rho: 1.18 }, tough_resin: { cls: 'thermoset', label: 'tough resin', rho: 1.15 },
  concrete: { cls: 'mineral', label: 'concrete', rho: 2.4 }, glass: { cls: 'glass', label: 'glass', rho: 2.5 }, rubber: { cls: 'elastomer', label: 'rubber', rho: 1.15 },
  adhesive: { cls: 'thermoset', label: 'adhesive', rho: 1.2 }, filler: { cls: 'thermoset', label: 'filler', rho: 1.0 }
};
/* ISO 4063 processes: deposition (kg/h, manual, flat), operating factor (arc-on share of the welder's time), skill */
const PROC = {
  111: { name: 'MMA / SMAW (stick)', rate: 1.4, of: 0.3, skill: 1, gas: 'none (flux-coated rod)' },
  135: { name: 'MAG / GMAW', rate: 3.0, of: 0.35, skill: 0, gas: 'M21 (Ar + 18 % CO₂)' },
  136: { name: 'FCAW (flux-cored)', rate: 4.5, of: 0.4, skill: 0, gas: 'M21 / C1' },
  131: { name: 'MIG (aluminium)', rate: 2.0, of: 0.35, skill: 1, gas: 'I1 (argon)' },
  141: { name: 'TIG / GTAW', rate: 0.8, of: 0.3, skill: 2, gas: 'I1 (argon)' },
  121: { name: 'SAW (submerged arc)', rate: 8, of: 0.5, skill: 0, gas: 'flux' }
};
const POSF = { PA: 1, PB: 0.95, PC: 0.85, PD: 0.65, PE: 0.6, PF: 0.7, PG: 0.8 };
const POSNAME = { PA: 'flat', PB: 'horizontal-vertical', PC: 'horizontal', PD: 'horizontal-overhead', PE: 'overhead', PF: 'vertical up', PG: 'vertical down' };

/* ---------- geometry ---------- */
function V(api) { return api.V; }
function polyArea(V, q) { let s = [0, 0, 0]; for (let i = 0; i < q.v.length; i++) s = V.add(s, V.cross(q.v[i].p, q.v[(i + 1) % q.v.length].p)); return V.len(s) / 2; }
/* where two bodies touch (or face each other across a small gap): planes of A with B's faces opposite them */
function contacts(api, sa, sb, maxGap) {
  const Vv = api.V, groups = [];
  for (const q of sa.polys) {
    let g = groups.find(x => Vv.dot(x.n, q.plane.n) > 1 - 1e-6 && Math.abs(x.w - q.plane.w) < 1e-4);
    if (!g) { g = { n: q.plane.n.slice(), w: q.plane.w, A: [], B: [], sep: 0 }; groups.push(g); }
    g.A.push(q);
  }
  for (const q of sb.polys) for (const g of groups) {
    if (Vv.dot(g.n, q.plane.n) > -1 + 1e-6) continue;
    const sep = -q.plane.w - g.w; if (sep < -1e-4 || sep > maxGap) continue;
    g.B.push(q); g.sep = Math.max(g.sep, sep);
  }
  return groups.filter(g => g.B.length);
}
/* the separate places where two parts touch on one plane (a notched or stitched edge touches in several): the overlaps of
   their faces, grouped where they meet, each with the faces of either part that take part in it */
function splitContact(Vv, g) {
  let best = null, bl = 0;
  for (const q of g.B.concat(g.A)) for (let i = 0; i < q.v.length; i++) { const e = Vv.sub(q.v[(i + 1) % q.v.length].p, q.v[i].p), l = Vv.len(e); if (l > bl) { bl = l; best = Vv.mul(e, 1 / l); } }
  if (!best) return [g];
  const e1 = Vv.norm(Vv.sub(best, Vv.mul(g.n, Vv.dot(best, g.n)))), e2 = Vv.cross(g.n, e1);
  const ra = g.A.map(q => rectOf(Vv, [q], e1, e2)), rb = g.B.map(q => rectOf(Vv, [q], e1, e2)), cells = [], tol = 0.05;
  for (let i = 0; i < ra.length; i++) for (let k = 0; k < rb.length; k++) {
    const a = ra[i], b = rb[k], u0 = Math.max(a.u0, b.u0), u1 = Math.min(a.u1, b.u1), v0 = Math.max(a.v0, b.v0), v1 = Math.min(a.v1, b.v1);
    if (u1 - u0 > 1e-6 && v1 - v0 > 1e-6) cells.push({ u0, u1, v0, v1, i, k });
  }
  if (!cells.length) return [];
  const up = cells.map((c, i) => i), find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
  for (let x = 0; x < cells.length; x++) for (let y = x + 1; y < cells.length; y++) {
    const a = cells[x], b = cells[y];
    if (a.u0 <= b.u1 + tol && b.u0 <= a.u1 + tol && a.v0 <= b.v1 + tol && b.v0 <= a.v1 + tol) up[find(x)] = find(y);
  }
  const comps = new Map(); cells.forEach((c, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(c); });
  return [...comps.values()].map(list => Object.assign({}, g, { A: [...new Set(list.map(c => c.i))].map(i => g.A[i]), B: [...new Set(list.map(c => c.k))].map(k => g.B[k]) }));
}
function rectOf(Vv, polys, e1, e2) { let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const q of polys) for (const x of q.v) { const u = Vv.dot(x.p, e1), v = Vv.dot(x.p, e2); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } return { u0, u1, v0, v1 }; }
/* distance from p along dir until the ray leaves the solid (its thickness there) */
function depthAlong(Vv, sol, p, dir) {
  const o = Vv.add(p, Vv.mul(dir, 1e-3)), hits = [];
  for (const q of sol.polys) {
    const dn = Vv.dot(q.plane.n, dir); if (Math.abs(dn) < 1e-9) continue;
    const t = (q.plane.w - Vv.dot(q.plane.n, o)) / dn; if (t <= 1e-6) continue;
    const x = Vv.add(o, Vv.mul(dir, t)); if (inPoly(Vv, q, x)) hits.push({ t, out: dn > 0 });
  }
  hits.sort((a, b) => a.t - b.t); const h = hits.find(x => x.out); return h ? h.t + 1e-3 : 0;
}
function inPoly(Vv, q, x) {
  const n = q.plane.n; let sgn = 0;
  for (let i = 0; i < q.v.length; i++) { const a = q.v[i].p, b = q.v[(i + 1) % q.v.length].p, c = Vv.dot(Vv.cross(Vv.sub(b, a), Vv.sub(x, a)), n); if (Math.abs(c) < 1e-9) continue; const s = c > 0 ? 1 : -1; if (!sgn) sgn = s; else if (s !== sgn) return false; }
  return true;
}
/* does a ray from p along dir hit any solid within reach? (bounding boxes first) */
function blockedBy(Vv, bodies, p, dir, reach) {
  for (const b of bodies) {
    const bb = b.bb; let t0 = 0, t1 = reach, ok = true;
    for (let k = 0; k < 3 && ok; k++) { if (Math.abs(dir[k]) < 1e-12) { if (p[k] < bb.min[k] || p[k] > bb.max[k]) ok = false; continue; } let a = (bb.min[k] - p[k]) / dir[k], c = (bb.max[k] - p[k]) / dir[k]; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) ok = false; }
    if (!ok) continue;
    for (const q of b.solid.polys) { const dn = Vv.dot(q.plane.n, dir); if (Math.abs(dn) < 1e-9) continue; const t = (q.plane.w - Vv.dot(q.plane.n, p)) / dn; if (t <= 0.05 || t > reach) continue; if (inPoly(Vv, q, Vv.add(p, Vv.mul(dir, t)))) return b; }
  }
  return null;
}
const rot = (Vv, v, axis, a) => Vv.add(Vv.add(Vv.mul(v, Math.cos(a)), Vv.mul(Vv.cross(axis, v), Math.sin(a))), Vv.mul(axis, Vv.dot(axis, v) * (1 - Math.cos(a))));
/* how a torch reaches a seam: rays from points along it, round the approach direction */
function accessOf(ctx, seam, reach = 80) {
  const Vv = ctx.api.V, bodies = ctx.result.bodies.filter(b => !b.hidden && b.solid && !b.solid.isEmpty()).map(b => ({ id: b.id, solid: b.solid, bb: b.solid.bbox() }));
  let clear = 0, total = 0; const who = new Map();
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const p0 = Vv.add(Vv.add(seam.O, Vv.mul(seam.e1, seam.L * f)), Vv.mul(seam.approach, 1.5));
    for (const [a, b] of [[0, 0], [25, 0], [-25, 0], [0, 25], [0, -25]]) {
      let d = rot(Vv, seam.approach, seam.e1, a * DEG); d = rot(Vv, d, Vv.norm(Vv.cross(seam.e1, seam.approach)), b * DEG); total++;
      const hit = blockedBy(Vv, bodies, p0, Vv.norm(d), reach); if (!hit) clear++; else who.set(hit.id, (who.get(hit.id) || 0) + 1);
    }
  }
  const share = clear / total, names = [...who.keys()].map(id => (ctx.get(id) || {}).name || id);
  return { level: share >= 0.6 ? 'open' : share >= 0.2 ? 'restricted' : 'blocked', clear: r2(share), blockers: names };
}
/* ISO 6947 position from the weld's axis and the direction the torch comes from (world Z up) */
function positionOf(seam, fillet) {
  const z = [0, 0, 1], ax = Math.abs(seam.e1[0] * z[0] + seam.e1[1] * z[1] + seam.e1[2] * z[2]), up = seam.approach[2];
  if (ax > 0.7) return 'PF';
  if (up > (fillet ? 0.9 : 0.7)) return 'PA';
  if (fillet && up > 0.35) return 'PB';
  if (up < -0.6) return 'PE';
  if (up < -0.2) return fillet ? 'PD' : 'PE';
  return fillet ? 'PB' : 'PC';
}

/* the joint between parts a and b (or the one nearest `near`) */
function analyze(ctx, args) {
  const api = ctx.api, Vv = api.V;
  const A0 = ctx.get(args.a), B0 = ctx.get(args.b);
  if (!A0 || !B0) throw new Error('give a and b: the two parts to join');
  const ba = ctx.bodyOf(args.a), bb = ctx.bodyOf(args.b);
  if (!ba || !bb) throw new Error('both parts need geometry');
  if (ba.id === bb.id) throw new Error(`${A0.name} and ${B0.name} are one part already (a boolean merged them) — join separate parts`);
  const groups = contacts(api, ba.solid, bb.solid, args.max_gap == null ? 6 : +args.max_gap).flatMap(g => splitContact(Vv, g));
  if (!groups.length) throw new Error(`${ctx.get(ba.id).name} and ${ctx.get(bb.id).name} do not touch or face each other within 6 mm — mate them together first`);
  const joints = [];
  for (const g of groups) {
    const c = g.n; let best = null, bl = 0;
    for (const q of g.B.concat(g.A)) for (let i = 0; i < q.v.length; i++) { const e = Vv.sub(q.v[(i + 1) % q.v.length].p, q.v[i].p), l = Vv.len(e); if (l > bl) { bl = l; best = Vv.mul(e, 1 / l); } }
    let e1 = Vv.norm(Vv.sub(best, Vv.mul(c, Vv.dot(best, c)))), e2 = Vv.cross(c, e1);
    let RA = rectOf(Vv, g.A, e1, e2), RB = rectOf(Vv, g.B, e1, e2);
    let P = { u0: Math.max(RA.u0, RB.u0), u1: Math.min(RA.u1, RB.u1), v0: Math.max(RA.v0, RB.v0), v1: Math.min(RA.v1, RB.v1) };
    if (P.u1 - P.u0 < 0.5 || P.v1 - P.v0 < 0.3) continue;
    if (P.v1 - P.v0 > P.u1 - P.u0) { const n1 = e2, n2 = Vv.neg(e1); e1 = n1; e2 = n2; RA = rectOf(Vv, g.A, e1, e2); RB = rectOf(Vv, g.B, e1, e2); P = { u0: Math.max(RA.u0, RB.u0), u1: Math.min(RA.u1, RB.u1), v0: Math.max(RA.v0, RB.v0), v1: Math.min(RA.v1, RB.v1) }; }
    const size = Math.max(P.u1 - P.u0, P.v1 - P.v0), tol = Math.max(0.05, size * 0.002);
    /* does each part END here (the contact is its whole face), or does its face carry on? */
    const areaIn = (polys) => polys.reduce((s, q) => s + polyArea(Vv, q), 0), patch = (P.u1 - P.u0) * (P.v1 - P.v0);
    const ends = (R, polys) => Math.abs(R.v0 - P.v0) < tol && Math.abs(R.v1 - P.v1) < tol && areaIn(polys) < patch * 1.08 + 1e-6;
    const aEnds = ends(RA, g.A), bEnds = ends(RB, g.B);
    const origin = Vv.mul(c, g.w);   /* the contact plane through the origin's projection: the joint frame's origin */
    const at = (u, v, q = 0) => Vv.add(Vv.add(Vv.add(origin, Vv.mul(e1, u)), Vv.mul(e2, v)), Vv.mul(c, q));
    const mid = at((P.u0 + P.u1) / 2, (P.v0 + P.v1) / 2);
    let type, stem = null, base = null;
    if (aEnds && bEnds) type = 'butt';
    else if (bEnds) { type = 'tee'; stem = 'b'; base = 'a'; }
    else if (aEnds) { type = 'tee'; stem = 'a'; base = 'b'; }
    else type = 'lap';
    const tA = aEnds ? P.v1 - P.v0 : depthAlong(Vv, ba.solid, mid, Vv.neg(c)), tB = bEnds ? P.v1 - P.v0 : depthAlong(Vv, bb.solid, Vv.add(mid, Vv.mul(c, g.sep)), c);
    const seams = [];
    for (const side of ['v1', 'v0']) {
      const s = side === 'v1' ? e2 : Vv.neg(e2), v = P[side], ext = (R) => side === 'v1' ? R.v1 - P.v1 : P.v0 - R.v0;
      const aExt = ext(RA), bExt = ext(RB);
      let kind, y = c, onto = null;
      if (type === 'butt') kind = 'flush';
      else if (type === 'tee') { const baseExt = base === 'a' ? aExt : bExt; kind = baseExt > tol ? 'inside' : 'flush'; y = base === 'a' ? c : Vv.neg(c); }
      else { if (aExt < tol && bExt > tol) { kind = 'inside'; y = Vv.neg(c); onto = 'b'; } else if (bExt < tol && aExt > tol) { kind = 'inside'; y = c; onto = 'a'; } else kind = 'flush'; }
      const approach = kind === 'inside' ? Vv.norm(Vv.add(s, y)) : s;
      const seam = { side, s, y, kind, onto, e1, L: P.u1 - P.u0, O: at(P.u0, v), approach };
      seam.access = accessOf(ctx, seam); seam.position = positionOf(seam, kind === 'inside');
      seams.push(seam);
    }
    if (type === 'tee' && seams.some(x => x.kind === 'flush')) type = 'corner';
    joints.push({ type, c, e1, e2, origin, rect: P, sep: r2(g.sep), stem, base, tA: r2(tA), tB: r2(tB), length: r1(P.u1 - P.u0), width: r1(P.v1 - P.v0), area: r1(patch), seams, mid, a: ba.id, b: bb.id });
  }
  if (!joints.length) throw new Error('the parts only touch along a line or a point — no face to join');
  let j = joints.reduce((x, y) => (y.area > x.area ? y : x));
  if (args.near) { const n = args.near; j = joints.reduce((x, y) => (Vv.len(Vv.sub(y.mid, n)) < Vv.len(Vv.sub(x.mid, n)) ? y : x)); }
  j.others = joints.length - 1;
  return j;
}

/* ---------- advice ---------- */
function materialsOf(ctx, j) {
  const ka = ctx.material(j.a), kb = ctx.material(j.b);
  return { ka, kb, A: MAT[ka] || null, B: MAT[kb] || null };
}
/* what kind of joint suits these materials (method auto) */
function methodFor(m) {
  const { A, B, ka, kb } = m;
  if (!A || !B) return { method: 'weld', note: !ka || !kb ? 'no material set on one of the parts — assumed carbon steel (set it in Properties → Material for exact advice)' : null, assumed: true };
  if (A.weld && B.weld) {
    if (A.cls === B.cls) return { method: 'weld' };
    if ((A.cls === 'steel' && B.cls === 'stainless') || (A.cls === 'stainless' && B.cls === 'steel')) return { method: 'weld', dissimilar: '309L filler (G 23 12 L Si / ER309LSi) for carbon steel to stainless' };
    return { method: 'bond', note: `${A.label} cannot be fusion-welded to ${B.label} — bonded (or riveted / bolted); a transition insert (explosion-bonded) is the welded route` };
  }
  if ((A.braze || B.braze) && (A.weld || A.braze) && (B.weld || B.braze) && A.cls !== 'aluminium' && B.cls !== 'aluminium') return { method: 'braze' };
  if (A.cls === 'composite' || B.cls === 'composite') return { method: 'tab' };
  return { method: 'bond' };
}
function processFor(cls, t, duty, pos, length, args) {
  if (args.process && args.process !== 'auto' && PROC[args.process]) return +args.process;
  if (cls === 'aluminium') return t < 3 ? 141 : 131;
  if (cls === 'stainless') return t <= 4 || duty === 'heavy' ? 141 : 135;
  if (cls === 'titanium') return 141;
  if (cls === 'cast_iron') return 111;
  if (duty === 'heavy' && pos === 'PA' && length >= 1000 && t >= 12) return 121;
  if (t >= 12 && duty !== 'light') return 136;
  return 135;
}
/* shielding gas by process and material (EN ISO 14175) */
function gasFor(proc, cls, P) {
  if (proc === 135 && cls === 'stainless') return 'M12 (Ar + 2.5 % CO₂)';
  if (proc === 141 && cls === 'titanium') return 'I1 (argon), with a trailing shield and back purge';
  if (proc === 141 && cls === 'stainless') return 'I1 (argon), back purge for full-penetration roots';
  if ((proc === 131 || proc === 141) && cls === 'aluminium') return 'I1 (argon) or I3 (Ar + He) over 10 mm';
  return P.gas;
}
const aMin = (tmax) => (tmax <= 10 ? 3 : tmax <= 20 ? 4 : tmax <= 30 ? 5 : 6);   /* EN 1011 / EN 1993 practice; AWS D1.1 Table 5.7 is similar */

/* the groove of one part's edge in (r, w): r = depth below the welded surface (0 … −d), w = into the part from the joint face */
function groove(prep, d, m) {
  const out = [];
  if (prep.shape === 'J') {
    const R = prep.radius, phi = (90 - prep.angle) * DEG, cx = -d + R, n = 8;
    out.push([-d, -m]); out.push([m, -m]);
    const T = [cx - R * Math.cos(phi), R * Math.sin(phi)], wEnd = T[1] + (m - T[0]) * Math.tan(prep.angle * DEG);
    out.push([m, wEnd]); out.push(T);
    for (let k = n - 1; k >= 1; k--) { const th = Math.PI + phi * k / n; out.push([cx + R * Math.cos(th), -R * Math.sin(th)]); }
    out.push([-d, 0]);
    return { cut: out, face: [[-d, 0], ...out.slice(4, -1).reverse(), T, [0, T[1] + (0 - T[0]) * Math.tan(prep.angle * DEG)]] };
  }
  const tb = Math.tan(prep.angle * DEG);
  return { cut: [[-d, -m], [m, -m], [m, (d + m) * tb], [-d, 0]], face: [[-d, 0], [0, d * tb]] };
}
const polyArea2 = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
/* the weld metal of a groove seen in its seam's section (p = out of the surface, q = across: part 1 at q ≤ 0, part 2 at q ≥ g) */
/* a groove face cut off at depth −e (the run stops above a back-gouged root): points below it go, one is interpolated */
function trimFace(f, e) {
  if (!(f[0][0] < -e - 1e-9)) return f;
  const out = []; for (let k = 0; k < f.length; k++) {
    const [r, w] = f[k]; if (r >= -e - 1e-9) { if (!out.length && k > 0) { const [r0, w0] = f[k - 1], t = (-e - r0) / (r - r0); out.push([-e, w0 + (w - w0) * t]); } out.push([r, w]); }
  }
  return out.length >= 2 ? out : [[-e, 0], [0, f[f.length - 1][1]]];
}
function grooveBead(t, depthEnd, g, f1, f2, cap, root, flush) {
  /* f1 / f2: the two groove faces as [r, w] lists from the root up (w into each part); flush: ground level with the surface */
  if (!root) { f1 = trimFace(f1, depthEnd); f2 = trimFace(f2, depthEnd); }
  const P = [];
  if (root) for (let k = 0; k <= 6; k++) { const q = -0.6 + (g + 1.2) * k / 6; P.push([-t - root * Math.sin(Math.PI * k / 6), q]); }
  if (root) P.push([-t, g]);
  for (const [r, w] of f2) P.push([r, g + w]);
  const qB = g + f2[f2.length - 1][1], qA = -f1[f1.length - 1][1];
  if (flush || !cap) P.push([0, qB], [0, qA]);
  else { const n = 8, a0 = qB + 1, a1 = qA - 1; P.push([0, qB], [0, a0]); for (let k = 1; k < n; k++) P.push([cap * Math.sin(Math.PI * k / n), a0 + (a1 - a0) * k / n]); P.push([0, a1], [0, qA]); }
  for (let k = f1.length - 1; k >= 0; k--) P.push([f1[k][0], -f1[k][1]]);
  if (root) P.push([-t, 0]);
  return tidy(P);
}
/* no repeated points, no points on a straight run (they would give the inset and the booleans needle edges) */
function tidy(P) {
  let Q = P.slice();
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (let i = 0; i < Q.length; i++) {
      const a = out.length ? out[out.length - 1] : Q[(i + Q.length - 1) % Q.length], p = Q[i], b = Q[(i + 1) % Q.length];
      if (Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-3) continue;
      const ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1], lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lv > 1e-9 && Math.abs(ux * vy - uy * vx) / (lu * lv) < 1e-6 && ux * vx + uy * vy > 0) continue;
      out.push(p);
    }
    if (out.length === Q.length) break; Q = out;
  }
  return Q;
}
const fillet = (z, convex) => convex ? [[0, 0], [z, 0], [z * 0.62, z * 0.62], [0, z]] : [[0, 0], [z, 0], [0, z]];
const concaveFillet = (r, n = 8) => { const P = [[0, 0], [r, 0]]; for (let k = 1; k < n; k++) { const a = 1.5 * Math.PI - (0.5 * Math.PI) * k / n; P.push([r + r * Math.cos(a), r + r * Math.sin(a)]); } P.push([0, r]); return P; };
/* a laminate (n plies) over a filler fillet of radius r, legs L1 / L2 onto the two faces */
function laminate(r, tl, L1, L2, n = 8) {
  const P = [[L1, 0], [r, 0]];
  for (let k = 1; k < n; k++) { const a = 1.5 * Math.PI - (0.5 * Math.PI) * k / n; P.push([r + r * Math.cos(a), r + r * Math.sin(a)]); }
  P.push([0, r], [0, L2], [tl, L2 - tl], [tl, r]);
  const ri = r - tl; for (let k = 1; k < n; k++) { const a = Math.PI + (0.5 * Math.PI) * k / n; P.push([r + ri * Math.cos(a), r + ri * Math.sin(a)]); }
  P.push([r, tl], [L1 - tl, tl]);
  return P;
}

/* one suggestion: a weld for this joint at this duty */
function weldOption(j, m, duty, args, meth) {
  const A = m.A || MAT.steel, B = m.B || MAT.steel, cls = A.cls === 'cast_iron' || B.cls === 'cast_iron' ? 'cast_iron' : A.cls, mat = MAT[cls] || A;
  const L = j.length, notes = [], why = [], seams = j.seams.filter(s => s.access.level !== 'blocked');
  const open = (k) => seams.filter(s => s.kind === k);
  let o = { duty, method: 'weld', joint: j.type, beads: [], cuts: [], gap: 0 };
  const tS = j.type === 'butt' ? Math.min(j.tA, j.tB) : j.stem ? j[j.stem === 'a' ? 'tA' : 'tB'] : Math.min(j.tA, j.tB);
  const tBase = j.type === 'butt' ? Math.max(j.tA, j.tB) : j.base ? j[j.base === 'a' ? 'tA' : 'tB'] : Math.max(j.tA, j.tB);
  const tmin = Math.min(tS, tBase), tmax = Math.max(tS, tBase), aLo = aMin(tmax), aHi = Math.max(aLo, Math.floor(0.7 * tmin * 2) / 2);
  const angle = mat.vAngle || 60, al = cls === 'aluminium';
  const quality = { light: 'ISO 5817-D', regular: 'ISO 5817-C', heavy: 'ISO 5817-B' }[duty];
  if (!seams.length) return { duty, method: 'weld', impossible: true, title: 'No torch access', why: [`neither side of the joint can be reached (blocked by ${[...new Set(j.seams.flatMap(s => s.access.blockers))].join(', ') || 'the parts'}) — weld it before the closing part goes on, add an access hole, or bond it`] };
  const fillets = (sides, a, intermittent) => {
    for (const s of sides) o.beads.push({ seam: s, poly: fillet(a * Math.SQRT2, duty === 'regular'), kind: 'fillet' });
    o.weld = `${sides.length > 1 ? 'double' : 'single'} fillet a${a}${intermittent ? ' intermittent' : ''}`;
    o.symbol = { sym: 'fillet', both: sides.length > 1, size: 'a' + a, contour: duty === 'heavy' ? null : null, toes: duty === 'heavy' };
    if (intermittent) {
      const l = Math.max(40, Math.round(L / 6 / 10) * 10), e = 2 * l, n = Math.max(2, Math.floor((L - l) / e) + 1), s0 = (L - ((n - 1) * e + l)) / 2;
      o.symbol.length = `${n} × ${l} (${e})`; o.intermittent = { n, l, e }; o.weldLength = n * l * sides.length;
      for (const b of o.beads) b.segments = Array.from({ length: n }, (_, k) => [s0 + k * e, l]);
    }
    else o.weldLength = L * sides.length;
  };
  if (j.type === 'tee' || j.type === 'lap' || j.type === 'corner') {
    const inside = open('inside');
    if (j.type === 'lap') {
      const ta = Math.min(j.tA, j.tB), a = clamp(half(duty === 'light' ? 0.3 * ta : 0.5 * ta + (al ? 0.5 : 0)), aLo, Math.max(aLo, half(ta * 0.7)));
      if (!inside.length) return { duty, method: 'weld', impossible: true, title: 'No reachable lap edge', why: ['both lap edges are blocked'] };
      fillets(duty === 'light' ? [inside[0]] : inside, a, duty === 'light' && L >= 150);
      why.push(`lap: fillet${inside.length > 1 && duty !== 'light' ? 's on both edges' : ''} a${a} (≈ ${duty === 'light' ? '0.3' : '0.5'} × the ${ta} mm plate, at least a${aLo} for its thickness)`);
      const ov = j.width; if (ov < Math.max(25, 5 * ta)) notes.push(`overlap is ${r1(ov)} mm: AWS D1.1 wants at least 5 × t = ${Math.max(25, 5 * ta)} mm`);
      if (duty === 'heavy') notes.push('lap joints are poor in fatigue (the eccentric load bends the plates) — a butt joint or a double lap is better for dynamic loads');
      o.prep = { shape: 'none', text: 'none (sheared or sawn edges, deburred)' };
    } else if (duty === 'light' || (duty === 'regular' && tS <= 25)) {
      if (!inside.length) {
        /* corner, flush both sides (rare): a bevel groove from outside */
        o = Object.assign(o, bevelTee(j, seams.slice(0, 1), tS, duty, angle, false)); why.push('no inside corner to fillet: a partial-penetration bevel groove from outside');
      } else {
        const both = duty === 'regular' && inside.length > 1;
        const a = clamp(half((duty === 'light' ? 0.3 : both ? 0.5 : 0.7) * tS + (al ? 0.5 : 0)), aLo, aHi);
        fillets(duty === 'light' ? [inside.slice().sort((x, y) => POSF[y.position] - POSF[x.position])[0]] : (both ? inside : [inside[0]]), a, duty === 'light' && L >= 200);
        why.push(duty === 'light' ? `light duty: one fillet a${a} (0.3 × t = ${r1(0.3 * tS)}, at least a${aLo} for a ${tmax} mm part)${L >= 200 ? ', intermittent' : ''}` : both ? `fillets both sides a${a}: ≈ 0.5 × t gives about the stem's full strength in S235 (EN 1993-1-8)` : `only one side can be reached: one fillet a${a} ≈ 0.7 × t — keep it out of bending about its root`);
        if (al) why.push('aluminium: +0.5 mm on the throat for the softened heat-affected zone');
        if (j.type === 'corner') { const out = seams.find(s => s.kind === 'flush'); if (out && duty === 'regular') { o.beads.push({ seam: out, poly: [[0, -1.5], [1, -0.8], [1.2, 0], [1, 0.8], [0, 1.5]], kind: 'seal' }); notes.push('outside corner: a light sealing run along the flush edge (or leave it for appearance)'); } }
      }
      o.prep = o.prep || { shape: 'none', text: 'none — square-cut edge, deburred; the stem sits tight on the plate (gap ≤ 1 mm)' };
    } else {
      /* full penetration: single or double bevel (K), or J for thick stems */
      const sidesOk = seams.length;
      o = Object.assign(o, bevelTee(j, sidesOk > 1 ? seams : seams.slice(0, 1), tS, duty, angle, duty === 'heavy'));
      why.push(o.fullPen ? `${duty} duty: full penetration — the load passes through the weld, not round an unfused root (fatigue class rises from FAT 36 to FAT 71–80, IIW)` : 'partial penetration');
      if (sidesOk < 2) notes.push(`only one side can be reached: ${o.backing ? 'a backing strip under the root (fit it before assembly)' : 'the root is welded from one side'}`);
    }
  } else if (j.type === 'butt') {
    /* the main side: the one in the best welding position (and reachable); the other is the back */
    const t = tS, ranked = seams.slice().sort((x, y) => (POSF[y.position] - POSF[x.position]) || ((x.access.level === 'open' ? 0 : 1) - (y.access.level === 'open' ? 0 : 1))), top = ranked[0], bot = ranked[1] || null;
    const both = !!bot && seams.length > 1;
    let shape, s2 = false, pen = 'full';
    if (duty === 'light') { if (t <= 4) shape = 'I'; else if (t <= 8 && both) { shape = 'I'; s2 = true; } else { shape = 'V'; pen = 'partial'; } }
    else if (t <= 3) shape = 'I';
    else if (t <= (duty === 'heavy' ? 12 : 16) || !both) shape = t > 30 ? 'U' : 'V';
    else { shape = t > 30 && duty === 'heavy' ? 'UU' : 'X'; s2 = true; }
    const g = shape === 'I' ? (t <= 2 ? 0.5 : Math.min(3, r1(t / 2))) : pen === 'partial' ? 0 : 2;
    const rf = shape === 'I' ? 0 : pen === 'partial' ? r1(t * 0.4) : shape === 'X' || shape === 'UU' ? 2 : 1.5;
    const dOne = shape === 'I' ? 0 : s2 ? (t - rf) / 2 : t - rf;
    const prep = shape === 'U' || shape === 'UU' ? { shape: 'J', angle: 10, radius: 6 } : { shape: 'V', angle: angle / 2 };
    const backGouge = s2 && duty !== 'light' || (shape !== 'I' && both && duty !== 'light'), backing = shape !== 'I' && !both && duty !== 'light' ? (duty === 'heavy' ? 'MR' : 'M') : null;
    o.gap = g; o.fullPen = pen === 'full'; o.backing = backing;
    const sidesPrep = s2 ? [top, bot] : [top];
    if (shape !== 'I') for (const s of sidesPrep) { o.cuts.push({ part: j.a, seam: s, prep, d: dOne, sign: -1 }); o.cuts.push({ part: j.b, seam: s, prep, d: dOne, sign: 1 }); }
    const face = (d) => (shape === 'I' ? [[-t, 0], [0, 0]] : groove(prep, d, 1).face);
    const flush = duty === 'heavy', gouge = !s2 && backGouge && bot && !backing ? { shape: 'V', angle: 30 } : null, gd = 2;
    /* the top run fills down to the middle (X / double-U), to the back-gouged root, or right through */
    const topEnd = !o.fullPen ? dOne : s2 ? t / 2 : gouge ? t - gd : t;
    o.beads.push({ seam: top, kind: 'groove', poly: grooveBead(t, topEnd, g, face(dOne), face(dOne), 1.5, !s2 && o.fullPen && !backing && !gouge ? 1 : 0, flush) });
    if (s2) o.beads.push({ seam: bot, kind: 'groove', poly: grooveBead(t, t / 2, g, face(dOne), face(dOne), 1.5, 0, flush) });
    else if (gouge) {
      /* back-gouged to sound metal, then a sealing run from the back */
      o.cuts.push({ part: j.a, seam: bot, prep: gouge, d: gd, sign: -1, gouge: true }); o.cuts.push({ part: j.b, seam: bot, prep: gouge, d: gd, sign: 1, gouge: true });
      o.beads.push({ seam: bot, kind: 'seal', poly: grooveBead(t, gd, g, groove(gouge, gd, 1).face, groove(gouge, gd, 1).face, 1.2, 0, flush) });
    }
    if (backing === 'M' && bot) o.beads.push({ seam: top, kind: 'backing', name: 'backing strip', poly: [[-t - 5, -12], [-t, -12], [-t, g + 12], [-t - 5, g + 12]] });
    const nm = { I: 'square butt', V: pen === 'partial' ? 'single-V (partial penetration)' : 'single-V', X: 'double-V (X)', U: 'single-U', UU: 'double-U' }[shape];
    o.weld = `${nm} butt${o.fullPen ? ', full penetration' : ''}`;
    o.prep = { shape, text: shape === 'I' ? `square edges, root gap ${g} mm${s2 ? ', welded from both sides' : ''}` : `${shape === 'U' || shape === 'UU' ? 'U (J-faces) 2 × 10°, root radius 6' : `${angle}° V`}${s2 ? ' both sides' : ''}, root face ${rf} mm, gap ${g} mm${backing ? `, ${backing === 'MR' ? 'removable ceramic' : 'permanent steel'} backing` : ''}`, angle, rootFace: rf, gap: g, machined: shape === 'U' || shape === 'UU' };
    o.symbol = { sym: shape === 'I' ? 'square' : shape === 'U' || shape === 'UU' ? 'U' : pen === 'partial' ? 'Y' : 'V', both: s2, size: pen === 'partial' ? 's' + r1(t - rf) : '', contour: flush ? 'flat' : null, finish: flush ? 'G' : null, seal: !s2 && backGouge && !!bot, backing };
    o.weldLength = L;
    why.push(`${t} mm: ${nm}${pen === 'partial' ? ` (penetration s = ${r1(t - rf)})` : ''} — ISO 9692-${al ? 3 : 1}${shape === 'X' || shape === 'UU' ? ': both sides halve the weld metal and balance distortion' : ''}${shape === 'U' || shape === 'UU' ? ': U uses far less weld metal than V on thick plate (machined)' : ''}`);
    if (Math.abs(j.tA - j.tB) > 3) notes.push(`thicknesses differ by ${r1(Math.abs(j.tA - j.tB))} mm: taper the thicker plate 1:4 to the thinner (ISO 9692-1 / AWS D1.1)`);
    if (flush) why.push('ground flush both sides: a butt weld with its cap and root ground off rises to FAT 112 (from 90)');
  }
  /* process, position, time and cost */
  /* the main run's position names the joint; each run deposits at its own position's rate; the worst one sets the ease */
  const main = o.beads.length ? o.beads[0].seam.position : seams[0].position, pos = o.beads.reduce((w, b) => (POSF[b.seam.position] < POSF[w] ? b.seam.position : w), main);
  const proc = processFor(cls, tS, duty, main, L, args), P = PROC[proc], share = o.intermittent ? o.intermittent.n * o.intermittent.l / L : 1;
  const area = o.beads.reduce((s, b) => s + polyArea2(b.poly), 0) * share;
  const vol = area * L / 1000, mass = vol * mat.rho;
  const arcMin = o.beads.reduce((s, b) => s + polyArea2(b.poly) * share * L / 1000 * mat.rho / 1000 / (P.rate * POSF[b.seam.position] * (al ? 0.85 : 1)) * 60, 0);
  const weldMin = arcMin / P.of, passes = Math.max(1, Math.round(area / (proc === 121 ? 60 : proc === 141 ? 12 : 25)));
  const t = { fit: 3 + 0.4 * L / 100 * (o.gap || o.backing ? 1.5 : 1), prep: 0, weld: weldMin, finish: 0, ndt: 0, preheat: 0 }, ops = [];
  const prepLen = o.cuts.length * L / 1000;
  if (o.cuts.length) {
    const machined = (o.prep || {}).machined, thermal = cls === 'steel' && tS >= 6 && !machined;
    t.prep = machined ? 15 + 3.5 * prepLen * 1 : thermal ? (2.5 + 1.5) * prepLen + 4 : 6 + 5 * prepLen;
    ops.push(machined ? `machine the ${(o.prep || {}).shape === 'J' ? 'J' : 'U'} preparation (edge milling / planing)` : thermal ? 'bevel by plasma / oxy-fuel, then grind the faces bright' : `bevel by ${al ? 'router or milling (no thermal cutting)' : 'grinding / milling'}`);
  } else ops.push('square-cut and deburr the edges');
  if (cls === 'aluminium') { t.prep += 1 * L / 1000 * 2 + 1; ops.push('remove the oxide with a stainless brush just before welding, degrease'); }
  if (cls === 'stainless') ops.push('clean with stainless tools only; back-purge full-penetration roots');
  const tl = (o.beads[0] && o.beads[0].kind === 'groove') ? tS : tmax;
  if ((cls === 'steel' && tl >= 30) || cls === 'cast_iron') { t.preheat = 10 + 3 * L / 1000; ops.push(cls === 'cast_iron' ? 'preheat 200–300 °C, peen each pass, cool slowly' : 'preheat 75–100 °C (thick section; check the carbon equivalent, EN 1011-2)'); }
  if (o.symbol && (o.symbol.seal || (o.symbol.both && j.type === 'butt')) && duty !== 'light') { t.finish += 6 * L / 1000; ops.push('back-gouge the root (arc-air or grinding) to sound metal before the second side'); }
  if (o.symbol && o.symbol.finish === 'G') { t.finish += 6 * L / 1000 * (o.symbol.both ? 2 : 1); ops.push('grind the cap (and root) flush'); }
  if (o.symbol && o.symbol.toes) { t.finish += 4 * L / 1000 * o.beads.length * 2; ops.push('burr-grind the weld toes (IIW fatigue improvement)'); }
  if (cls === 'stainless') { t.finish += 4 * L / 1000; ops.push('pickle and passivate the weld zone'); }
  const ndt = duty === 'light' ? 'VT' : duty === 'regular' ? (o.fullPen ? 'VT + 10 % MT/PT' : 'VT + 10 % MT/PT') : o.fullPen ? (j.type === 'butt' ? 'VT + 100 % UT or RT' : 'VT + 100 % UT') : 'VT + 100 % MT/PT';
  t.ndt = 1 * L / 1000 + (duty === 'regular' ? 0.5 * L / 1000 + 3 : duty === 'heavy' ? 10 + 6 * L / 1000 : 0);
  const totalMin = Object.values(t).reduce((a, b) => a + b, 0), rateH = +args.labor_rate || 60;
  const filler = mass / 1000 * (mat.cost || 5) * 1.3, gas = arcMin * 0.15;
  const cost = totalMin / 60 * rateH + filler + gas;
  /* ease: 5 = an apprentice in the flat; 1 = a coded welder overhead */
  let ease = 5;
  if (o.cuts.length) ease -= (o.prep && o.prep.machined) ? 1 : 0.5;
  ease -= { PA: 0, PB: 0, PC: 0.5, PF: 1, PG: 0.5, PD: 1.5, PE: 2 }[pos] || 0;
  if (o.beads.some(b => b.seam.access.level === 'restricted')) ease -= 1;
  ease -= P.skill * 0.5; if (o.fullPen) ease -= 0.5; if (duty === 'heavy') ease -= 0.5;
  ease = clamp(Math.round(ease * 2) / 2, 1, 5);
  for (const b of o.beads) if (b.seam.access.level === 'restricted') notes.push(`limited torch room on the ${b.seam.side === 'v1' ? 'first' : 'second'} side (${b.seam.access.blockers.join(', ') || 'nearby geometry'}) — a ${proc === 141 ? 'gas-lens TIG torch' : 'slim neck / short stick-out'}; or weld it before fitting ${b.seam.access.blockers[0] || 'the part in the way'}`);
  if (o.beads.some(b => ['PE', 'PD'].includes(b.seam.position))) notes.push('overhead as modelled — turn the assembly over for this side if it can be handled (flat / horizontal is faster and sounder)');
  if (meth.dissimilar) notes.push(meth.dissimilar);
  if (al) notes.push('6xxx alloys lose 30–50 % of their strength in the heat-affected zone — size the joint on the softened strength');
  if (meth.assumed) notes.push(meth.note || 'no material set: carbon steel assumed');
  o.symbol = Object.assign({ tail: [String(proc), quality, ndt.replace(/^VT \+ /, '')] }, o.symbol || {});
  return Object.assign(o, {
    title: { light: 'Light service', regular: 'Regular service', heavy: 'Heavy service' }[duty],
    process: { code: proc, name: P.name, filler: meth.dissimilar ? 'G 23 12 L Si (ER309LSi)' : mat.filler, gas: gasFor(proc, cls, P) },
    position: Object.assign({ code: main, name: POSNAME[main] }, pos !== main ? { worst: pos, worst_name: POSNAME[pos] } : {}), quality, ndt,
    sizes: { t_stem: tS, t_base: tBase, weld_area_mm2: r1(area), weld_length_mm: r1(o.weldLength || L), passes },
    metal: { volume_cm3: r2(vol), mass_g: r1(mass) },
    time_min: { fit_up: r1(t.fit), prep: r1(t.prep), preheat: r1(t.preheat), welding: r1(t.weld), finishing: r1(t.finish), inspection: r1(t.ndt), total: r1(totalMin) },
    arc_min: r1(arcMin), cost: { total: r2(cost), labour: r2(totalMin / 60 * rateH), filler: r2(filler), gas: r2(gas), rate_per_h: rateH }, ease,
    steps: ops, why, notes, text: `${o.weld} · ${P.name.split(' ')[0]} ${proc}`
  });
}
/* tee / corner groove: single or double bevel (K), J for thick stems; fills the groove and adds a reinforcing fillet */
function bevelTee(j, sides, tS, duty, angle, full) {
  const both = sides.length > 1, J = full && tS > 25, prep = J ? { shape: 'J', angle: 15, radius: 8 } : { shape: 'V', angle: 45 };
  const rf = full ? (both ? 2 : 1.5) : r1(tS * 0.4), g = full ? 2 : 0, d = full ? (both ? (tS - rf) / 2 : tS - rf) : tS - rf;
  const backing = full && !both ? (duty === 'heavy' ? 'MR' : 'M') : null;
  const o = { cuts: [], beads: [], gap: g, fullPen: full, backing };
  for (const s of sides) {
    o.cuts.push({ part: j.stem === 'a' ? j.a : j.b, seam: s, prep, d, sign: 1, stem: true });
    const f = groove(prep, d, 1).face, end = full ? (both ? tS / 2 : tS) : d, h = g + f[f.length - 1][1], zr = Math.max(2, r1(0.25 * tS));
    const P = [[-end, 0]];
    if (s.kind === 'inside') P.push([zr, 0], [0, h + zr * 0.6]);
    else { for (let k = 0; k <= 6; k++) P.push([1.2 * Math.sin(Math.PI * k / 6), -0.5 + (h + 1) * k / 6]); }
    P.push([0, h]);
    for (let k = f.length - 1; k >= 0; k--) P.push([f[k][0], g + f[k][1]]);
    P.push([-end, g]);
    o.beads.push({ seam: s, kind: 'groove', poly: P.filter((p, i) => { const q = P[(i + P.length - 1) % P.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; }) });
  }
  const zr = Math.max(2, r1(0.25 * tS));
  o.weld = `${both ? 'double' : 'single'}-${J ? 'J' : 'bevel'}${both && !J ? ' (K)' : ''} ${full ? 'full penetration' : 'partial penetration'} + reinforcing fillet${both ? 's' : ''} a${zr}`;
  o.prep = { shape: J ? 'J' : both ? 'K' : 'bevel', text: `${J ? 'J 15°, root radius 8' : '45° bevel'}${both ? ' both sides' : ''} on the stem, root face ${rf} mm, gap ${g} mm${backing ? `, ${backing === 'MR' ? 'removable ceramic' : 'permanent'} backing` : ''}`, angle: J ? 15 : 45, rootFace: rf, gap: g, machined: J };
  o.symbol = { sym: J ? 'J' : full ? 'bevel' : 'HY', both, size: full ? '' : 's' + r1(tS - rf), toes: duty === 'heavy', backing };
  o.weldLength = j.length * sides.length;
  return o;
}

/* bonded, filled and fibre-reinforced joints */
function adhesiveFor(m, duty) {
  const c = [m.A ? m.A.cls : 'steel', m.B ? m.B.cls : 'steel'];
  const has = (k) => c.includes(k);
  if (has('wood') && c.every(x => x === 'wood')) return duty === 'heavy' ? { name: 'epoxy (gap-filling, marine)', bond: 0.3, tau: 6, cure: '24 h at 20 °C' } : duty === 'regular' ? { name: 'polyurethane (D4) or PVA (D3)', bond: 0.15, tau: 4, cure: '1–4 h clamped, 24 h full' } : { name: 'PVA wood glue (D2/D3)', bond: 0.1, tau: 3, cure: '30–60 min clamped' };
  if (has('glass')) return { name: 'UV-curing acrylic (glass to metal) or neutral silicone', bond: 0.2, tau: 3, cure: 'seconds (UV) / 24 h' };
  if (has('elastomer')) return { name: 'cyanoacrylate with polyolefin primer, or contact adhesive', bond: 0.05, tau: 2, cure: 'minutes' };
  if (has('plastic') || has('thermoset')) {
    const hard = [m.A, m.B].some(x => x && x.hard), solvent = m.A && m.B && m.A === m.B && m.A.solvent;
    if (duty === 'light') return solvent ? { name: 'solvent cement (welds the plastic)', bond: 0.05, tau: 6, cure: '1 h handling, 24 h full' } : { name: 'cyanoacrylate (instant)', bond: 0.05, tau: 5, cure: 'seconds–minutes', primer: hard ? 'polyolefin primer (acetal / nylon)' : null };
    return { name: 'structural acrylic (MMA)', bond: 0.4, tau: duty === 'heavy' ? 8 : 6, cure: '20 min handling, 24 h full', primer: hard ? 'plasma or flame treatment, then primer' : null };
  }
  if (has('composite')) return { name: 'toughened epoxy paste (structural)', bond: 0.3, tau: duty === 'heavy' ? 12 : 9, cure: '24 h at 20 °C or 1 h at 80 °C' };
  if (has('mineral')) return { name: 'epoxy mortar', bond: 1, tau: 3, cure: '24 h' };
  return duty === 'light' ? { name: '2K epoxy (general)', bond: 0.15, tau: 6, cure: '6–24 h' } : duty === 'regular' ? { name: 'toughened structural epoxy', bond: 0.2, tau: 10, cure: '24 h at 20 °C' } : { name: 'toughened structural epoxy (aerospace grade)', bond: 0.2, tau: 12, cure: '1 h at 120 °C or 7 days at 20 °C' };
}
function bondOption(j, m, duty, args, method) {
  const rateH = +args.labor_rate || 60, L = j.length, notes = [], why = [], steps = [];
  const tA = j.tA, tB = j.tB, t = Math.min(tA, tB), seams = j.seams.filter(s => s.access.level !== 'blocked'), inside = seams.filter(s => s.kind === 'inside');
  const o = { duty, method, joint: j.type, beads: [], cuts: [], gap: 0, parts: [] };
  const comp = [m.A, m.B].some(x => x && x.cls === 'composite'), wood = [m.A, m.B].every(x => x && x.cls === 'wood');
  const plyT = comp && [m.ka, m.kb].includes('carbon_fibre') ? 0.3 : 0.45, fibre = plyT === 0.3 ? 'carbon 300 g/m² biaxial' : 'glass 450 g/m² biaxial (±45°)';
  const metalOrPlastic = !comp && !wood;
  let bondArea = j.area, title = { light: 'Light service', regular: 'Regular service', heavy: 'Heavy service' }[duty];
  if (method === 'bond' || method === 'braze') {
    const adh = method === 'braze' ? { name: 'silver braze (Ag 40 %) with flux', bond: 0.08, tau: 100, cure: 'none (brazed)' } : adhesiveFor(m, duty);
    o.gap = adh.bond; o.adhesive = adh;
    /* the adhesive layer in the contact area, spew fillets at its edges */
    o.layer = { thickness: adh.bond };
    const spew = method === 'braze' ? 0.8 : Math.max(1.5, r1(adh.bond * 6));
    for (const s of inside) o.beads.push({ seam: s, kind: 'spew', poly: concaveFillet(spew), material: method === 'braze' ? null : 'adhesive', name: 'Spew fillet' });
    if (j.type === 'butt' && duty !== 'light' && method !== 'braze') {
      /* butt joints bond badly (peel, small area): straps over the joint */
      const lo = Math.max(20, r1((duty === 'heavy' ? 20 : 15) * t)), sides = duty === 'heavy' && seams.length > 1 ? seams : [seams[0]], ts = r1(duty === 'heavy' ? Math.max(1, t / 2) : Math.max(1, t * 0.6));
      for (const s of sides) o.parts.push({ seam: s, kind: 'strap', len: lo, ts, layer: adh.bond });
      bondArea = sides.length * 2 * lo * L;
      why.push(`butt joints load an adhesive in peel and give it little area: ${sides.length > 1 ? 'two straps' : 'a strap'} ${ts} mm thick, overlapping ${lo} mm each side (${duty === 'heavy' ? 20 : 15} × t)`);
      o.symbol = { sym: 'adhesive', both: sides.length > 1, size: `${adh.bond}`, length: `strap ${2 * lo + o.gap}` };
    } else {
      o.symbol = { sym: 'adhesive', size: `${adh.bond}`, length: j.type === 'lap' ? `L${r1(j.width)}` : '' };
      if (j.type === 'lap') { const need = Math.max(12, (duty === 'light' ? 10 : duty === 'regular' ? 15 : 20) * t); why.push(`lap overlap ${r1(j.width)} mm${j.width < need ? ` — at least ${r1(need)} mm (${duty === 'light' ? 10 : duty === 'regular' ? 15 : 20} × t) is the usual guidance` : ' meets the usual 10–20 × t guidance'}`); if (j.width < need) notes.push(`lengthen the overlap to ${r1(need)} mm, or add a second lap`); }
      if (j.type === 'tee' || j.type === 'corner') { why.push(`tee / corner: the stem's end is bonded, with ${inside.length > 1 ? 'fillets on both sides' : 'a fillet'} of adhesive (spew) to spread the peel load`); if (duty === 'heavy') notes.push('for heavy service add a bonded angle cleat (or rivets / screws as a peel stop) — adhesives are strong in shear, weak in peel'); }
    }
    const cap = adh.tau * bondArea / 1000;
    why.push(`${adh.name}: about ${adh.tau} MPa design shear on ${r1(bondArea)} mm² ≈ ${r1(cap)} kN in shear (not peel)`);
    const prep = method === 'braze' ? 'clean to bright metal, flux, gap 0.05–0.15 mm (capillary)' : duty === 'light' ? 'degrease (IPA / acetone), abrade P120, degrease again' : duty === 'regular' ? `degrease, ${metalOrPlastic ? 'grit-blast or abrade P80' : 'abrade P80 / remove peel ply'}, degrease${adh.primer ? ', ' + adh.primer : ''}` : `degrease, grit-blast${[m.A, m.B].some(x => x && x.cls === 'aluminium') ? ' + anodize or sol-gel' : ''}${[m.A, m.B].some(x => x && x.cls === 'steel') ? ' + primer / silane' : ''}${comp ? ' (or peel ply)' : ''}, bond within 4 h`;
    steps.push(prep, method === 'braze' ? 'torch- or furnace-braze, then wash off the flux' : `apply ${adh.name}, bond line ${adh.bond} mm (glass beads or shims keep it), clamp / fixture`, method === 'braze' ? '' : `cure: ${adh.cure}`);
    const am2 = bondArea / 1e6 * (o.parts.length ? 2 : 1);
    o.time = { prep: r1(3 + (duty === 'light' ? 20 : duty === 'regular' ? 35 : 60) * am2 * 10), fit: r1(4 + 0.5 * L / 100), apply: r1(3 + 15 * am2 * 10), finishing: r1(1 * L / 100), inspection: r1(duty === 'heavy' ? 10 : 2) };
    o.weld = method === 'braze' ? `brazed ${j.type}` : `bonded ${j.type}${o.parts.length ? ` with ${o.parts.length > 1 ? 'double straps' : 'a strap'}` : ''}`;
    o.prep = { shape: 'none', text: prep };
    o.materialText = adh.name;
  } else if (method === 'filled' || method === 'tab') {
    const k = duty === 'light' ? 0.75 : duty === 'regular' ? 1 : 1.5, r = clamp(r1(k * Math.max(t, 4)), 3, 30);
    const plies = method === 'tab' ? (duty === 'light' ? 2 : Math.max(2, Math.ceil((duty === 'regular' ? 0.5 : 1) * t / plyT))) : 0, tl = r1(plies * plyT), leg = 25 + 10 * Math.max(0, plies - 1) + r;
    if (j.type === 'butt') {
      /* a scarfed / V-ground butt filled, and (tab) laminate straps over both faces */
      const d = r1(t * (duty === 'light' ? 0.5 : 0.8)), prep = { shape: 'V', angle: 35 };
      const sides = method === 'tab' && duty !== 'light' && seams.length > 1 ? seams : [seams[0]];
      for (const s of sides) { o.cuts.push({ part: j.a, seam: s, prep, d, sign: -1 }); o.cuts.push({ part: j.b, seam: s, prep, d, sign: 1 }); o.beads.push({ seam: s, kind: 'fill', material: 'filler', poly: grooveBead(t, d, 0, groove(prep, d, 1).face, groove(prep, d, 1).face, 0, 0, true), name: 'Filler' }); }
      if (method === 'tab') for (const s of sides) o.beads.push({ seam: s, kind: 'tab', material: [m.ka, m.kb].includes('carbon_fibre') ? 'carbon_fibre' : 'gfrp', poly: [[0, -leg], [0, leg], [tl, leg - tl * 2], [tl, -leg + tl * 2]], name: 'Laminate strap' });
      o.weld = `${method === 'tab' ? 'laminated' : 'filled'} butt (V-ground ${d} mm${method === 'tab' ? `, ${plies} plies each side` : ''})`;
      o.symbol = method === 'tab' ? { sym: 'tab', both: sides.length > 1, size: `${plies} × ${fibre.split(' ')[1] || ''}`, length: `${2 * leg}` } : { sym: 'filled', size: `V${d}` };
      why.push(method === 'tab' ? `butt: grind a shallow V (35°) ${d} mm deep, fill, then ${plies} plies of ${fibre} stepped 25 mm wider each, ${r1(2 * leg)} mm overall — about ${duty === 'heavy' ? 'the' : 'half the'} laminate thickness` : `butt: a V-ground groove ${d} mm deep filled with structural filler — for light loads and fairing`);
    } else {
      for (const s of inside.length ? (duty === 'light' && method === 'filled' ? [inside[0]] : inside) : [seams[0]]) {
        o.beads.push({ seam: s, kind: 'fill', material: 'filler', poly: concaveFillet(r), name: 'Filler fillet' });
        if (method === 'tab') o.beads.push({ seam: s, kind: 'tab', material: [m.ka, m.kb].includes('carbon_fibre') ? 'carbon_fibre' : 'gfrp', poly: laminate(r, tl, leg, leg), name: 'Tabbing' });
      }
      o.weld = method === 'tab' ? `filleted and tabbed ${j.type} (R${r}, ${plies} plies ${fibre})` : `filled ${j.type} (fillet R${r})`;
      o.symbol = method === 'tab' ? { sym: 'tab', both: inside.length > 1, size: `${plies}×`, length: `${r1(leg)} / R${r}` } : { sym: 'filled', both: inside.length > 1 && duty !== 'light', size: `R${r}` };
      why.push(`filler fillet radius ${r} mm (${k} × t, the usual marine / composite rule)${method === 'tab' ? `, then ${plies} plies of ${fibre} (${tl} mm, ${duty === 'light' ? 'nominal' : duty === 'regular' ? 'about half' : 'about all'} of the ${t} mm panel), first ply ${25 + r} mm onto each face, each ply 10 mm wider` : ''}`);
    }
    const area = o.beads.reduce((s2, b) => s2 + polyArea2(b.poly), 0), resinKg = area * L / 1e6 * 1.4;
    steps.push(comp || method === 'tab' ? 'grind the faces 50 mm each side of the joint (P40–P80) or remove peel ply, vacuum, wipe' : 'abrade and degrease the faces', 'mix filler (epoxy + colloidal silica / microfibres) to peanut-butter consistency, run the fillet with a radiused spatula', method === 'tab' ? `wet out ${plies} plies (shortest first), roll out air, peel ply over` : '', `cure 24 h at 20 °C${method === 'tab' ? ', then trim and sand the ply edges' : ''}`);
    o.time = { prep: r1(5 + 8 * L / 1000 * (o.beads.length)), fit: r1(3 + 0.3 * L / 100), apply: r1(5 + (method === 'tab' ? 6 * plies : 4) * L / 1000 * Math.max(1, o.beads.length / (method === 'tab' ? 2 : 1))), finishing: r1(4 * L / 1000), inspection: r1(duty === 'heavy' ? 8 : 2) };
    o.prep = { shape: o.cuts.length ? 'V' : 'none', text: steps[0] };
    o.materialText = method === 'tab' ? `epoxy + ${fibre}` : 'epoxy structural filler';
    o.resin_kg = r2(resinKg);
  }
  const totalMin = Object.values(o.time).reduce((a, b) => a + b, 0), matCost = method === 'tab' ? (o.resin_kg || 0) * 25 + L / 1000 * 8 : method === 'filled' ? (o.resin_kg || 0) * 20 : (bondArea / 1e6) * 40 + 2;
  let ease = method === 'braze' ? 3 : method === 'bond' ? (o.parts.length ? 3.5 : 4.5) : method === 'filled' ? 4 : 3;
  if (duty === 'heavy') ease -= 0.5; if (seams.some(s => s.access.level === 'restricted')) ease -= 1;
  if ((m.A && m.A.hard) || (m.B && m.B.hard)) notes.push('acetal / nylon / PE / PP are hard to bond: plasma or flame treatment and a polyolefin primer, or design a mechanical joint');
  if (method === 'bond' && (m.A && m.B && m.A.cls !== m.B.cls)) notes.push('different materials expand differently with heat: a tougher, thicker bond line (PU or toughened epoxy, ≥ 0.3 mm) takes the movement');
  o.symbol = Object.assign({ tail: [o.materialText || '', { light: 'light', regular: 'regular', heavy: 'heavy' }[duty]] }, o.symbol || {});
  return Object.assign(o, {
    title, process: { code: method, name: { bond: 'Adhesive bond', braze: 'Brazing', filled: 'Filled (structural filler)', tab: 'Fibre-reinforced (tabbing)' }[method], filler: o.materialText },
    position: { code: (seams[0] || {}).position, name: POSNAME[(seams[0] || {}).position] }, quality: duty === 'heavy' ? 'proof-tested / witness coupons' : duty === 'regular' ? 'process control (mix, bond line, cure)' : 'visual',
    ndt: duty === 'heavy' ? 'tap test / ultrasonic C-scan, witness coupons' : 'visual (squeeze-out all round)',
    time_min: Object.assign({}, o.time, { total: r1(totalMin) }), cost: { total: r2(totalMin / 60 * rateH + matCost), labour: r2(totalMin / 60 * rateH), materials: r2(matCost), rate_per_h: rateH },
    ease: clamp(Math.round(ease * 2) / 2, 1, 5), steps: steps.filter(Boolean), why, notes, text: `${o.weld} · ${o.materialText}`,
    sizes: { t_a: tA, t_b: tB, bond_area_mm2: r1(bondArea) }
  });
}

/* the three suggestions */
function advise(ctx, args) {
  const j = analyze(ctx, args), m = materialsOf(ctx, j), auto = methodFor(m);
  const method = !args.method || args.method === 'auto' ? auto.method : args.method;
  const duties = ['light', 'regular', 'heavy'];
  const options = {};
  for (const d of duties) options[d] = method === 'weld' ? weldOption(j, m, d, args, auto) : bondOption(j, m, d, args, method);
  const summary = jointSummary(ctx, j, m);
  return { j, m, method, auto, options, summary };
}
function jointSummary(ctx, j, m) {
  const name = (id) => (ctx.get(id) || {}).name || id;
  return {
    joint: j.type, parts: [name(j.a), name(j.b)], materials: [m.A ? m.A.label : m.ka || 'not set', m.B ? m.B.label : m.kb || 'not set'],
    thickness_mm: j.type === 'butt' ? { a: j.tA, b: j.tB } : j.stem ? { stem: j[j.stem === 'a' ? 'tA' : 'tB'], base: j[j.base === 'a' ? 'tA' : 'tB'] } : { a: j.tA, b: j.tB },
    length_mm: j.length, contact_mm2: j.area, existing_gap_mm: j.sep || 0, other_contacts: j.others || 0,
    sides: j.seams.map(s => ({ side: s.side === 'v1' ? 1 : 2, kind: s.kind === 'inside' ? 'inside corner' : 'flush / open', access: s.access.level, blocked_by: s.access.blockers.length ? s.access.blockers : undefined, position: `${s.position} (${POSNAME[s.position]})` }))
  };
}

/* ---------- applying a suggestion: the operations ---------- */
function frameAt(ctx, seam, partId, s0, len) {
  /* world frame: x = s (out of the surface), y = the section's second axis, z along the seam; it covers [s0, s0 + len] */
  const Vv = ctx.api.V, M4 = ctx.api.M4, x = seam.s, y = seam.y, z = Vv.cross(x, y), along = Vv.dot(z, seam.e1) > 0;
  const o = Vv.add(seam.O, Vv.mul(seam.e1, along ? s0 : s0 + len));
  const F = [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
  const W = ctx.world(partId); return { rel: M4.mul(M4.inv(W), F), flipZ: !along };
}
/* who moves to open the root gap / bond line: the stem of a tee (otherwise b), along the contact normal, by what is still
   missing — unless the other part hangs off it (then that one moves the other way) */
function planGap(ctx, j, opt) {
  const Vv = ctx.api.V;
  const hangsOff = (x, y) => { const seen = new Set(); let o = ctx.get(x); while (o && o.mate && o.mate.to && o.mate.to !== 'origin' && !seen.has(o.id)) { seen.add(o.id); if (o.mate.to === y) return true; o = ctx.get(o.mate.to); } return false; };
  let mover = (j.type === 'tee' || j.type === 'corner') && j.stem ? (j.stem === 'a' ? j.a : j.b) : j.b, fixed = mover === j.a ? j.b : j.a;
  if (hangsOff(fixed, mover)) [mover, fixed] = [fixed, mover];
  const dirN = mover === j.b ? j.c : Vv.neg(j.c), add = r2(r2(opt.gap || 0) - (j.sep || 0)), mt = (ctx.get(mover) || {}).mate;
  return { mover, fixed, dirN, add, canMove: !(mt && mt.kind) };
}
/* the sections assume the part on the +y side of each seam moved by the gap; shift them when it was the other one */
function shifter(Vv, j, g, moved) {
  const posA = g.mover === j.a ? -moved : 0, posB = (j.sep || 0) + (g.mover === j.b ? moved : 0);
  return (seam) => (Vv.dot(seam.y, j.c) > 0 ? posA : -posB);   /* where the −y part's face now is, along the seam's y */
}
/* the adhesive layer's own frame: across the contact patch, its thickness along the contact normal */
const layerSeam = (Vv, j) => ({ s: j.e2, y: j.c, e1: j.e1, L: j.length, O: Vv.add(j.origin, Vv.mul(j.e1, j.rect.u0)) });
/* a joint's tag (W1, W2…) names all its parts (W1a, W1p1, W1c…): the next one not used by any of them */
function freeTag(ctx) {
  const objs = (ctx.doc && ctx.doc.objects) || [], used = (t) => objs.some(o => o.id === t || (o.id.startsWith(t) && /^[a-zA-Z]/.test(o.id.slice(t.length))) || (o.meta && o.meta.joint === t));
  let n = 1; while (used('W' + n)) n++;
  return 'W' + n;
}
function applyOps(ctx, args, adv, duty) {
  const opt = adv.options[duty]; if (!opt || opt.impossible) throw new Error(opt ? opt.why.join('; ') : 'no such duty (light, regular or heavy)');
  const j = adv.j, Vv = ctx.api.V, ops = [], tag = args.id || freeTag(ctx), name = (id) => (ctx.get(id) || {}).name || id;
  const matA = ctx.material(j.a) || 'steel', matB = ctx.material(j.b) || 'steel', weldMat = opt.method === 'weld' ? (MAT[matA] && MAT[matA].weld ? matA : MAT[matB] && MAT[matB].weld ? matB : 'steel') : null;
  /* 1. the root gap / bond line */
  const g = planGap(ctx, j, opt), { mover, fixed, add } = g, Bobj = ctx.get(mover);
  let gapNote = null;
  if (Math.abs(add) > 1e-3) {
    const mv = Vv.mul(g.dirN, add), mt = Bobj.mate;
    if (mt && !mt.kind && !mt.frame && mt.to) {
      const tc = (ctx.result.conns.get(mt.to) || []).find(c2 => c2.name === mt.a), W = ctx.world(mt.to);
      if (tc && W) {
        const n = Vv.norm(ctx.api.M4.dir(W, tc.n)), u = Vv.norm(ctx.api.M4.dir(W, tc.u)), v = Vv.cross(n, u), dn = Vv.dot(mv, n), du = Vv.dot(mv, u), dv = Vv.dot(mv, v), sl = mt.slide || [0, 0];
        ops.push({ op: 'mate', id: mover, to: mt.to, a: mt.a, b: mt.b, flip: mt.flip, offset: r2((mt.offset || 0) + dn), angle: mt.angle || 0, tilt: mt.tilt || 0, slide: [r2((sl[0] || 0) + du), r2((sl[1] || 0) + dv)] });
      } else gapNote = 'the root gap was not opened (its mate could not be read) — set it by hand';
    } else if (mt && mt.frame) { const f = mt.frame.slice(), Wt = ctx.world(mt.to), d = ctx.api.M4.dir(ctx.api.M4.inv(Wt), mv); f[12] += d[0]; f[13] += d[1]; f[14] += d[2]; ops.push({ op: 'mate', id: mover, to: mt.to, frame: f }); }
    else if (!mt || mt.kind) {
      if (mt && mt.kind) gapNote = `${name(mover)} is placed by a ${mt.kind} mate — the root gap was not opened`;
      else { const W = ctx.world(mover); ops.push({ op: 'set', id: mover, at: ctx.opPoint(Vv.add([W[12], W[13], W[14]], mv)), rot: (Bobj.pose || {}).rot || [0, 0, 0] }); }
    }
  }
  const shiftFor = shifter(Vv, j, g, gapNote ? 0 : add), jm = { joint: tag, joins: [j.a, j.b], duty };
  /* 2. the preparation cut out of each part (attached to it), extended past the ends so the cut is clean */
  const M = 1;
  opt.cuts.forEach((c, i) => {
    const d = c.d, g = groove(c.prep, d, M), poly = g.cut.map(([r, w]) => [r, c.sign < 0 ? -w : w]), fr = frameAt(ctx, c.seam, c.part, -M, c.seam.L + 2 * M);
    ops.push({ op: 'extrude', id: `${tag}p${i + 1}`, name: `${tag} prep · ${c.gouge ? 'back gouge' : c.prep.shape === 'J' ? 'J' : 'bevel'} ${name(c.part)}`, profile: poly, length: r2(c.seam.L + 2 * M), into: c.part, mode: 'subtract', mate: { to: c.part, frame: fr.rel }, meta: Object.assign({ notes: `${opt.title}: ${opt.prep ? opt.prep.text : 'edge preparation'}` }, jm) });
  });
  /* 3. the weld metal / adhesive / filler / laminate, each a part of its own attached to part a */
  opt.beads.forEach((b, i) => {
    /* inset by 0.02 mm: the metal is fused to the parts in reality; here it must not share faces with them exactly (booleans
       and the interference check can't tell coincident faces from overlap) */
    const mat = b.material || weldMat || 'adhesive', sh = shiftFor(b.seam), raw = b.poly.map(([x, y]) => [x, y + sh]);
    let poly = raw; try { const ins = ctx.api.K.offsetPolygon(raw, -0.02); if (ins && ins.length === raw.length) poly = ins.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]); } catch (e) { poly = raw; }
    const label = `${tag} ${b.name || (opt.method === 'weld' ? (b.kind === 'seal' ? 'sealing run' : b.kind === 'fillet' ? 'fillet weld' : 'groove weld') : b.kind)}`;
    (b.segments || [[0, b.seam.L]]).forEach(([s0, len], k, all) => {
      const fr = frameAt(ctx, b.seam, fixed, s0, len);
      ops.push({ op: 'extrude', id: `${tag}${String.fromCharCode(97 + i)}${all.length > 1 ? k + 1 : ''}`, name: label + (all.length > 1 ? ` ${k + 1}/${all.length}` : ''), profile: poly, length: r2(len), mate: { to: fixed, frame: fr.rel }, material: mat, color: b.kind === 'tab' ? '#c9c79a' : b.kind === 'fill' ? '#e6dcc0' : opt.method === 'weld' ? '#7f868e' : '#e0c36a', meta: Object.assign({ part_no: tag, notes: `${opt.title}: ${opt.weld}` }, jm) });
    });
  });
  /* adhesive layer in the contact area (bonded joints) */
  if (opt.layer) {
    const seam = layerSeam(Vv, j), fr = frameAt(ctx, seam, fixed, 0, j.length), sh = shiftFor(seam);
    const v0 = j.rect.v0, v1 = j.rect.v1;
    ops.push({ op: 'extrude', id: `${tag}L`, name: `${tag} adhesive layer`, profile: [[v0, sh], [v1, sh], [v1, sh + opt.layer.thickness], [v0, sh + opt.layer.thickness]], length: r2(j.length), mate: { to: fixed, frame: fr.rel }, material: opt.method === 'braze' ? weldMat || 'brass' : 'adhesive', color: '#e0c36a', meta: Object.assign({ part_no: tag, notes: opt.materialText }, jm) });
  }
  /* straps over a bonded butt joint */
  (opt.parts || []).forEach((sp, i) => {
    const fr = frameAt(ctx, sp.seam, fixed, 0, sp.seam.L), g = opt.gap || 0, lo = sp.len, sh = shiftFor(sp.seam);
    ops.push({ op: 'extrude', id: `${tag}s${i + 1}`, name: `${tag} strap ${i + 1}`, profile: [[sp.layer, sh - lo], [sp.layer, sh + g + lo], [sp.layer + sp.ts, sh + g + lo], [sp.layer + sp.ts, sh - lo]], length: r2(sp.seam.L), mate: { to: fixed, frame: fr.rel }, material: matA, meta: Object.assign({ part_no: `${tag}-S${i + 1}`, notes: 'bonded strap' }, jm) });
    ops.push({ op: 'extrude', id: `${tag}s${i + 1}L`, name: `${tag} strap ${i + 1} adhesive`, profile: [[0, sh - lo], [0, sh + g + lo], [sp.layer, sh + g + lo], [sp.layer, sh - lo]], length: r2(sp.seam.L), mate: { to: fixed, frame: fr.rel }, material: 'adhesive', color: '#e0c36a', meta: Object.assign({ notes: 'strap adhesive' }, jm) });
  });
  /* 4. the callout: the weld symbol at the middle of the first seam, its leader pointing out of the joint */
  const s0 = (opt.beads[0] || opt.cuts[0] || { seam: j.seams[0] }).seam, at = Vv.add(Vv.add(s0.O, Vv.mul(s0.e1, s0.L / 2)), Vv.mul(s0.approach, 0.5));
  ops.push({ op: 'callout', id: `${tag}c`, name: `${tag} ${opt.method === 'weld' ? 'weld symbol' : 'joint note'}`, on: fixed, at: ctx.opPoint(at), dir: s0.approach, along: j.e1, kind: opt.method === 'weld' ? 'weld' : opt.method, symbol: Object.assign({ ref: tag }, opt.symbol), lines: [`${tag} ${opt.title}: ${opt.weld}`, opt.method === 'weld' ? `${opt.process.code} ${opt.process.name} · ${opt.process.filler} · ${opt.quality}` : `${opt.process.name} · ${opt.materialText || ''}`, `prep: ${opt.prep ? opt.prep.text : 'none'}`] });
  return { ops, gapNote, tag, mover, fixed };
}

/* ---------- a section through the joint, for the wizard: the parts as cut at mid-seam (the moving one shifted by the
   gap), the preparation taken out of them and the weld metal / adhesive / laminate put in — 2D, in mm, y up ---------- */
function sliceSolid(Vv, solid, at, n, P2) {
  const segs = [];
  for (const q of solid.polys) {
    const d = q.v.map(x => Vv.dot(Vv.sub(x.p, at), n)), pts = [];
    if (d.every(x => Math.abs(x) < 1e-7)) continue;   /* a face lying in the cut plane: its neighbours give the outline */
    for (let i = 0; i < d.length; i++) {
      const k = (i + 1) % d.length, a = q.v[i].p, b = q.v[k].p;
      if (Math.abs(d[i]) < 1e-7) pts.push(a);
      if ((d[i] > 1e-7 && d[k] < -1e-7) || (d[i] < -1e-7 && d[k] > 1e-7)) pts.push(Vv.add(a, Vv.mul(Vv.sub(b, a), d[i] / (d[i] - d[k]))));
    }
    if (pts.length < 2) continue;
    let A = pts[0], B = pts[1], best = -1;
    for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) { const l = Vv.len(Vv.sub(pts[i], pts[k])); if (l > best) { best = l; A = pts[i]; B = pts[k]; } }
    if (best > 1e-6) segs.push([P2(A), P2(B)]);
  }
  return segs;
}
/* chain cut segments into closed outlines (points matched within 1 µm) */
function chainLoops(segs) {
  const tol = 1e-3, cell = new Map(), pts = [], idOf = (p) => {
    const kx = Math.round(p[0] / tol), ky = Math.round(p[1] / tol);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = cell.get((kx + dx) + ',' + (ky + dy)); if (l) for (const i of l) if (Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]) <= tol) return i; }
    const i = pts.length; pts.push(p); const key = kx + ',' + ky; (cell.get(key) || cell.set(key, []).get(key)).push(i); return i;
  };
  const edges = segs.map(([a, b]) => [idOf(a), idOf(b)]).filter(([a, b]) => a !== b), at = new Map();
  edges.forEach(([a, b], i) => { for (const v of [a, b]) (at.get(v) || at.set(v, []).get(v)).push(i); });
  const used = new Uint8Array(edges.length), loops = [];
  for (let s0 = 0; s0 < edges.length; s0++) {
    if (used[s0]) continue; used[s0] = 1;
    const start = edges[s0][0], loop = [start]; let cur = edges[s0][1], guard = 0;
    while (cur !== start && guard++ < edges.length) {
      loop.push(cur);
      const nx = (at.get(cur) || []).find(i => !used[i]); if (nx == null) break;
      used[nx] = 1; cur = edges[nx][0] === cur ? edges[nx][1] : edges[nx][0];
    }
    if (cur === start && loop.length >= 3) loops.push(loop.map(i => pts[i]));
  }
  return loops;
}
/* Sutherland–Hodgman against the window (convex), and Liang–Barsky for the outline strokes */
function clipPoly(P, w) {
  let out = P;
  for (const [k, lim, keepAbove] of [[0, w[0], true], [0, w[2], false], [1, w[1], true], [1, w[3], false]]) {
    const inp = out; out = []; if (!inp.length) break;
    const inside = (p) => (keepAbove ? p[k] >= lim : p[k] <= lim);
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) { const t = (lim - a[k]) / (b[k] - a[k]), q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; out.push(q); }
    }
  }
  return out.length >= 3 ? out : null;
}
function clipSeg(a, b, w) {
  let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - w[0]], [dx, w[2] - a[0]], [-dy, a[1] - w[1]], [dy, w[3] - a[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}
function sectionOf(ctx, adv, duty) {
  const opt = adv.options[duty], j = adv.j, Vv = ctx.api.V;
  if (!opt || opt.impossible) return null;
  const g = planGap(ctx, j, opt), moved = g.canMove ? g.add : 0, mv = Vv.mul(g.dirN, moved), shiftFor = shifter(Vv, j, g, moved);
  /* looking along the seam; world Z up on the page when it lies across the section, otherwise the contact normal */
  const e1 = j.e1; let up = Vv.sub([0, 0, 1], Vv.mul(e1, e1[2]));
  if (Vv.len(up) < 0.3) up = j.c; up = Vv.norm(up);
  const right = Vv.norm(Vv.cross(up, e1)), mid = j.mid;
  const P2 = (p) => { const d = Vv.sub(p, mid); return [Vv.dot(d, right), Vv.dot(d, up)]; };
  const seamPt = (seam, x, y) => Vv.add(Vv.add(seam.O, Vv.mul(seam.s, x)), Vv.mul(seam.y, y));
  const beads = [], cuts = [];
  for (const b of opt.beads) { const sh = shiftFor(b.seam); beads.push({ kind: b.kind, name: b.name || null, pts: b.poly.map(([x, y]) => P2(seamPt(b.seam, x, y + sh))) }); }
  for (const c of opt.cuts) { const off = c.part === g.mover ? mv : [0, 0, 0]; cuts.push({ part: c.part, gouge: !!c.gouge, pts: groove(c.prep, c.d, 1).cut.map(([r, w]) => P2(Vv.add(seamPt(c.seam, r, c.sign < 0 ? -w : w), off))) }); }
  if (opt.layer) { const ls = layerSeam(Vv, j), sh = shiftFor(ls), t = opt.layer.thickness; beads.push({ kind: 'layer', pts: [[j.rect.v0, sh], [j.rect.v1, sh], [j.rect.v1, sh + t], [j.rect.v0, sh + t]].map(([x, y]) => P2(seamPt(ls, x, y))) }); }
  for (const sp of opt.parts || []) {
    const sh = shiftFor(sp.seam), gg = opt.gap || 0, lo = sp.len, P = (x, y) => P2(seamPt(sp.seam, x, y));
    beads.push({ kind: 'strap', pts: [P(sp.layer, sh - lo), P(sp.layer, sh + gg + lo), P(sp.layer + sp.ts, sh + gg + lo), P(sp.layer + sp.ts, sh - lo)] });
    beads.push({ kind: 'layer', pts: [P(0, sh - lo), P(0, sh + gg + lo), P(sp.layer, sh + gg + lo), P(sp.layer, sh - lo)] });
  }
  /* the window: the joint's own metal and cuts, with the parts around them */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of beads.concat(cuts)) for (const [x, y] of it.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (!(x1 > x0)) { x0 = -5; x1 = 5; y0 = -5; y1 = 5; }
  const tmax = Math.max(j.tA, j.tB, 2), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let hw = Math.max((x1 - x0) / 2 + Math.max(4, 0.6 * tmax), 1.5 * tmax + 3), hh = Math.max((y1 - y0) / 2 + Math.max(4, 0.6 * tmax), 1.5 * tmax + 3);
  if (hw < hh * 1.35) hw = hh * 1.35; else hh = Math.max(hh, hw / 1.8);
  const win = [cx - hw, cy - hh, cx + hw, cy + hh];
  const parts = [];
  for (const id of [j.a, j.b]) {
    const body = ctx.bodyOf(id); if (!body) continue;
    const off = id === g.mover ? mv : [0, 0, 0], segs = sliceSolid(Vv, body.solid, Vv.sub(mid, off), e1, (p) => P2(Vv.add(p, off)));
    parts.push({ id, name: (ctx.get(id) || {}).name || id, material: ctx.material(id) || null, mover: id === g.mover && Math.abs(moved) > 1e-3, loops: chainLoops(segs).map(l => clipPoly(l, win)).filter(Boolean), segs: segs.map(([a, b]) => clipSeg(a, b, win)).filter(Boolean) });
  }
  return { window: win, parts, cuts: cuts.map(c => Object.assign(c, { pts: clipPoly(c.pts, win) || [] })).filter(c => c.pts.length), beads: beads.map(b => Object.assign(b, { pts: clipPoly(b.pts, win) || [] })).filter(b => b.pts.length), gap: r2(opt.gap || 0), moved: r2(moved), method: opt.method, up: Math.abs(up[2]) > 0.5 ? 'world Z' : 'joint normal' };
}

/* ---------- the add-on ---------- */
const DUTY_DOC = 'light (static, low load: smallest weld, one side, intermittent where long), regular (general structural, ISO 5817-C), heavy (dynamic / fatigue / pressure: full penetration, ground, ISO 5817-B, 100 % NDT)';
const METHOD_DOC = 'auto (weld when the materials weld, otherwise bond, braze or tab), weld, bond (adhesive), braze, filled (structural filler fillet), tab (fibre-reinforced overlay)';
const ARGS = {
  a: { default: null, doc: 'first part id (the one the weld metal and the symbol attach to)' },
  b: { default: null, doc: 'second part id (moved by the root gap / bond line)' },
  near: { default: null, doc: 'optional [x,y,z] near the joint, when the parts meet in more than one place' },
  method: { default: 'auto', options: ['auto', 'weld', 'bond', 'braze', 'filled', 'tab'], doc: METHOD_DOC },
  process: { default: 'auto', options: ['auto', '135', '136', '141', '131', '111', '121'], doc: 'ISO 4063 process number, or auto' },
  labor_rate: { default: 60, doc: 'labour cost per hour (your currency), for the cost estimate' }
};
export default {
  id: 'welding', name: 'Welding & joining', version: '1.0.0',
  description: 'Suggests and builds welded, brazed, bonded, filled and fibre-reinforced joints between two parts for light, regular and heavy service — edge preparation, root gap, weld metal and ISO 2553 symbol — with time, cost and ease, by ISO 9692 / 2553 / 5817 and AWS D1.1 practice.',
  types: {},
  actions: {
    analyze: {
      query: true, doc: 'The joint between parts a and b: butt, tee, corner or lap; thicknesses; seam length; for each side whether it is an inside corner, how well a torch reaches it (and what is in the way), and the ISO 6947 welding position.',
      args: { a: ARGS.a, b: ARGS.b, near: ARGS.near },
      run(args, ctx) { const j = analyze(ctx, args), m = materialsOf(ctx, j); return { info: Object.assign(jointSummary(ctx, j, m), { method_auto: methodFor(m) }) }; }
    },
    advise: {
      query: true, doc: `Three suggestions for the joint between a and b — ${DUTY_DOC} — each with the joint and its preparation (square, V, X, bevel, K, J, U), root gap and face, process, filler, sizes, passes, weld metal, welding position, time (fit-up, prep, welding, finishing, inspection), cost, ease (1–5) and the reasons. method: ${METHOD_DOC}.`,
      args: ARGS,
      run(args, ctx) { const a = advise(ctx, args); return { info: { summary: a.summary, method: a.method, method_auto: a.auto, options: Object.fromEntries(Object.entries(a.options).map(([k, o]) => [k, publicOption(o)])) } }; }
    },
    apply: {
      doc: `Build one suggestion between a and b: cut the edge preparation out of the parts, open the root gap (bond line), place the weld metal (adhesive, filler, laminate, straps) as parts attached to a, and add the ISO 2553 weld symbol callout. duty: ${DUTY_DOC}.`,
      args: Object.assign({ duty: { default: 'regular', options: ['light', 'regular', 'heavy'], doc: DUTY_DOC } }, ARGS),
      run(args, ctx) {
        const a = advise(ctx, args), duty = args.duty || 'regular', r = applyOps(ctx, args, a, duty), o = a.options[duty];
        return { ops: r.ops, label: `${r.tag}: ${o.weld}`, info: Object.assign({ id: r.tag, summary: a.summary }, publicOption(o), r.gapNote ? { gap_note: r.gapNote } : {}) };
      }
    }
  },
  /* for the wizard (the host's UI): the same three suggestions with their drawable sections */
  ui: { advise: (ctx, args) => advise(ctx, args), publicOption: (o) => publicOption(o), section: (ctx, adv, duty) => sectionOf(ctx, adv, duty), symbolText: (o) => symbolText(o) }
};
function publicOption(o) {
  if (o.impossible) return { title: o.title, impossible: true, why: o.why };
  return { title: o.title, method: o.method, joint: o.joint, weld: o.weld, prep: o.prep, gap_mm: o.gap || 0, full_penetration: o.fullPen || undefined, backing: o.backing || undefined, process: o.process, position: o.position, quality: o.quality, inspection: o.ndt, sizes: o.sizes, weld_metal: o.metal, time_min: o.time_min, cost: o.cost, ease: o.ease, steps: o.steps, why: o.why, notes: o.notes, symbol: o.symbol, iso: symbolText(o), intermittent: o.intermittent };
}
/* the weld symbol as one line of text (ISO 2553 order: size, symbol, length) */
function symbolText(o) {
  const s = o.symbol || {}, glyph = { fillet: '◺', square: '‖', V: 'V', bevel: '⊿', Y: 'Y', HY: 'K-Y', U: 'U', J: 'J', adhesive: 'ADH', tab: 'TAB', filled: 'FILL' }[s.sym] || s.sym;
  return [s.size, glyph + (s.both ? ' both sides' : ''), s.length, s.contour === 'flat' ? 'flush' : '', s.finish ? `(${s.finish})` : '', s.backing ? `backing ${s.backing}` : '', s.seal ? '+ sealing run' : '', s.tail && s.tail.filter(Boolean).length ? `< ${s.tail.filter(Boolean).join(' / ')}` : ''].filter(Boolean).join(' ');
}
