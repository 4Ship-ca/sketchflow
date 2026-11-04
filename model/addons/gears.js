/* SketchFlow 3D add-on: Gears.
   Involute spur, helical and herringbone gears (external and internal/ring), a "gear" mate that keeps two gears in mesh
   (centre distance and tooth phase follow the live parameters), and actions that build pairs, simple and compound
   trains and planetary sets, plus an advisor that picks module, tooth counts, form and tolerances for a purpose and a
   manufacturing process. Plain object, no imports: the host passes the kernel in `api`. See model/ADDONS.md. */

const DEG = Math.PI / 180;
const inv = (a) => Math.tan(a) - a;
const STANDARD_MODULES = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/* ---------- geometry ---------- */
function geometry(p) {
  const m = +p.module, z = Math.max(3, Math.round(+p.teeth)), alpha = (+p.pressure_angle || 20) * DEG, beta = (+p.helix || 0) * DEG;
  if (!(m > 0)) throw new Error('module must be above 0');
  if (p.style !== 'spur' && Math.abs(beta) >= 60 * DEG) throw new Error('helix angle must be under 60°');
  const b = p.style === 'spur' ? 0 : beta;
  const mt = m / Math.cos(b), at = Math.atan(Math.tan(alpha) / Math.cos(b));
  const x = p.internal ? 0 : (+p.shift || 0), j = Math.max(0, +p.backlash || 0), c = p.clearance == null ? 0.25 : Math.max(0, +p.clearance);
  const r = mt * z / 2, rb = r * Math.cos(at);
  const ra = p.internal ? r - m : r + m * (1 + x), rf = p.internal ? r + m * (1 + c) : r - m * (1 + c - x);
  return { m, z, alpha, beta: b, mt, at, x, j, c, r, rb, ra, rf, internal: !!p.internal };
}
/* closed 2D outline, counter-clockwise, star-shaped about the centre. halfThickness at the pitch circle = psi.
   bumps point outward between rIn (root) and rOut (tip); for a ring gear the bumps are the tooth spaces. */
function involuteOutline(g, psi, rIn, rOut, phase, detail) {
  const { z, rb, at } = g, half = Math.PI / z, psiB = psi + inv(at);
  const theta = (rho) => psiB - inv(Math.acos(Math.min(1, rb / rho)));
  let tip = rOut;
  if (theta(tip) < 0.04 / z) { let lo = Math.max(rb, rIn), hi = rOut; for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (theta(mid) > 0.04 / z) lo = mid; else hi = mid; } tip = lo; }
  const r0 = Math.max(rIn, rb), n = Math.max(3, detail | 0);
  const flank = []; for (let i = 0; i <= n; i++) { const t = i / n, rho = r0 + (tip - r0) * (1 - (1 - t) * (1 - t)); flank.push([rho, theta(rho)]); }
  let rootHalf = rIn < rb ? psiB : theta(rIn);
  rootHalf = Math.min(rootHalf, half * 0.995);
  const P = (rho, a) => [rho * Math.cos(a), rho * Math.sin(a)], pts = [], rootN = 3, tipN = 3;
  for (let k = 0; k < z; k++) {
    const c0 = phase + 2 * Math.PI * k / z;
    for (let i = 0; i < rootN; i++) pts.push(P(rIn, c0 - half + (half - rootHalf) * i / rootN));
    if (rIn < rb) pts.push(P(rIn, c0 - psiB));
    for (const [rho, th] of flank) pts.push(P(rho, c0 - Math.min(th, rootHalf)));
    const thT = Math.max(0, theta(tip));
    for (let i = 1; i < tipN; i++) pts.push(P(tip, c0 - thT + 2 * thT * i / tipN));
    for (let i = flank.length - 1; i >= 0; i--) pts.push(P(flank[i][0], c0 + Math.min(flank[i][1], rootHalf)));
    if (rIn < rb) pts.push(P(rIn, c0 + psiB));
    for (let i = 1; i < rootN; i++) pts.push(P(rIn, c0 + rootHalf + (half - rootHalf) * i / rootN));
  }
  const out = []; for (const q of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-9) out.push(q); }
  if (Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return { pts: out, tipRadius: tip };
}
const circle = (rad, n) => Array.from({ length: n }, (_, i) => [rad * Math.cos(2 * Math.PI * i / n), rad * Math.sin(2 * Math.PI * i / n)]);
/* twist stations along the face width: helical = steady twist, herringbone = out and back */
function stations(g, p) {
  const w = +p.width;
  if (p.style === 'spur' || !g.beta) return [{ z: 0, rot: 0 }, { z: w, rot: 0 }];
  const k = Math.tan(g.beta) / g.r, span = p.style === 'herringbone' ? w / 2 : w, total = Math.abs(k * span) / DEG;
  const n = Math.max(2, Math.ceil(total / 1.5)), st = [];
  for (let i = 0; i <= n; i++) st.push({ z: span * i / n, rot: k * span * i / n });
  if (p.style === 'herringbone') for (let i = n - 1; i >= 0; i--) st.push({ z: w - span * i / n, rot: k * span * i / n });
  return st;
}
function buildGear(p, api) {
  const g = geometry(p), detail = Math.max(3, Math.round(+p.detail || 8)), st = stations(g, p);
  if (!(+p.width > 0)) throw new Error('width must be above 0');
  if (g.internal) {
    const s = g.mt * Math.PI / 2 + g.j / 2;              /* tooth space of the ring at the pitch circle */
    const { pts } = involuteOutline(g, s / (2 * g.r), g.ra, g.rf, Math.PI / g.z, detail);
    const outerR = g.rf + Math.max(g.m, +p.rim || 3 * g.m);
    return api.K.ringExtrude(circle(outerR, Math.max(96, g.z * 3)), pts, st, { sidOuter: 'rim', sidInner: 'teeth' });
  }
  const s = g.mt * (Math.PI / 2 + 2 * g.x * Math.tan(g.at)) - g.j / 2;
  const { pts } = involuteOutline(g, s / (2 * g.r), g.rf, g.ra, 0, detail);
  const bore = +p.bore || 0;
  if (bore > 0 && bore / 2 > g.rf - 0.5 * g.m) throw new Error(`bore Ø${bore} is too big for the root circle Ø${r2(2 * g.rf)}`);
  return api.K.ringExtrude(pts, bore > 0 ? circle(bore / 2, 48) : null, st, { sidOuter: 'teeth', sidInner: 'bore' });
}
const minTeeth = (alphaDeg, x = 0) => Math.ceil(2 * (1 - x) / Math.pow(Math.sin(alphaDeg * DEG), 2));
function gearInfo(p) {
  const g = geometry(p), out = {
    pitch_diameter: r3(2 * g.r), outside_diameter: r3(2 * (g.internal ? g.ra : g.ra)), root_diameter: r3(2 * g.rf), base_diameter: r3(2 * g.rb),
    circular_pitch: r3(Math.PI * g.mt), transverse_module: r3(g.mt)
  };
  if (g.internal) { out.inside_diameter = out.outside_diameter; delete out.outside_diameter; out.rim_diameter = r3(2 * (g.rf + Math.max(g.m, +p.rim || 3 * g.m))); }
  const zmin = minTeeth(+p.pressure_angle || 20, g.x);
  if (!g.internal && g.z < zmin) out.warning = `${g.z} teeth undercut at ${+p.pressure_angle || 20}° (needs ${zmin}+): use shift ≈ ${r2((zmin - g.z) / zmin)} or a 25° pressure angle`;
  return out;
}

/* ---------- mesh placement (the "gear" mate) ---------- */
function meshPlacement(A, B, mate) {
  /* A = target gear (fixed), B = this gear. Returns B's centre (A's frame) and rotation so a tooth meets a gap. */
  const ga = geometry(A), gb = geometry(B);
  if (Math.abs(ga.m - gb.m) > 1e-9) throw new Error(`modules differ (${ga.m} vs ${gb.m}) — gears only mesh at the same module`);
  if (Math.abs((+A.pressure_angle || 20) - (+B.pressure_angle || 20)) > 1e-9) throw new Error('pressure angles differ — they will not mesh');
  const helA = A.style === 'spur' ? 0 : (+A.helix || 0), helB = B.style === 'spur' ? 0 : (+B.helix || 0), oneRing = ga.internal !== gb.internal;
  if (ga.internal && gb.internal) throw new Error('two ring gears cannot mesh');
  if (Math.abs(Math.abs(helA) - Math.abs(helB)) > 1e-9 || (helA && (oneRing ? Math.sign(helA) !== Math.sign(helB) : Math.sign(helA) === Math.sign(helB))) || (A.style === 'herringbone') !== (B.style === 'herringbone'))
    throw new Error(oneRing ? 'a ring and its pinion need the same helix angle and hand' : 'helical pairs need equal helix angles of opposite hand (one +, one −)');
  /* around = world direction of this gear from the target; spin = the target's own (continuous) rotation.
     phi is the direction in the target's turned frame; d is how far the target's nearest tooth is from the
     line of centres — kept continuous in spin, so the driven gear turns smoothly instead of snapping tooth to tooth */
  const around = (+mate.around || 0) * DEG, spin = (+mate.spin || 0) * DEG, phi = around - spin, za = ga.z, zb = gb.z;
  let a, beta;
  const nearest = (ang, z) => ang - (2 * Math.PI / z) * Math.round(ang / (2 * Math.PI / z));
  if (!oneRing) {
    a = ga.r + gb.r + (ga.x + gb.x) * ga.m;
    const d = nearest(around, za) - spin;
    beta = phi + Math.PI + Math.PI / zb + d * za / zb;
  } else if (ga.internal) {            /* ring (target) with a pinion inside */
    a = ga.r - gb.r;
    const d = nearest(around, za) - spin;
    beta = phi + Math.PI / zb - d * za / zb;
  } else {                              /* this gear is the ring around the target pinion */
    a = gb.r - ga.r;
    const d = nearest(around + Math.PI, za) - spin;
    beta = phi + Math.PI + Math.PI / zb - d * za / zb;
  }
  beta += (+mate.phase || 0) * DEG;
  return { a, phi, beta, spinSelf: (spin + beta) / DEG };
}

/* ---------- advisor: purpose + process → module, teeth, form, tolerances ---------- */
const PROCESS = {
  fdm: { name: 'FDM 3D print', minModule: 1, module: 1.5, backlash: 0.3, clearance: 0.35, style: 'herringbone', helix: 25, widthK: 10, bore: 0.25,
    notes: ['Print flat on the face, no supports; 3+ perimeters and 40%+ infill so the teeth are solid.', 'Herringbone needs no axial retention and runs quieter than spur on printed teeth.', 'Holes print small: the bore allowance is already added.'] },
  sla: { name: 'Resin (SLA/DLP)', minModule: 0.5, module: 0.8, backlash: 0.12, clearance: 0.25, style: 'helical', helix: 20, widthK: 8, bore: 0.1,
    notes: ['Standard resin is brittle: use a tough or nylon-like resin for load.', 'Post-cure shrinks slightly; the backlash allows for it.'] },
  cnc: { name: 'CNC milled', minModule: 0.3, module: 1, backlash: 0.05, clearance: 0.25, style: 'spur', helix: 15, widthK: 10, bore: 0.02,
    notes: ['Root fillets are limited by the cutter radius; check the smallest tool against the gap at the root.', 'Spur or helical: herringbone cannot be milled in one setup.'] },
  laser: { name: 'Laser / waterjet (flat sheet)', minModule: 1, module: 1.5, backlash: 0.15, clearance: 0.3, style: 'spur', helix: 0, widthK: 0, bore: 0.1,
    notes: ['2D only, so spur gears; face width = sheet thickness.', 'Add the kerf (about 0.1–0.2 mm) to the backlash for your cutter.', 'Stack offset plates for a stepped helical/herringbone.'] },
  injection: { name: 'Injection moulded', minModule: 0.3, module: 0.8, backlash: 0.08, clearance: 0.25, style: 'helical', helix: 15, widthK: 8, bore: 0.05,
    notes: ['POM (acetal) or nylon; keep walls even (web + rim), add draft on the faces.'] },
  hobbed: { name: 'Hobbed / ground metal', minModule: 0.5, module: 2, backlash: 0.05, clearance: 0.25, style: 'spur', helix: 20, widthK: 10, bore: 0.01,
    notes: ['Use a standard module so stock hobs fit.', 'Lubricate; check hardness and AGMA/ISO rating for real loads.'] }
};
const MATERIAL_MPA = { pla: 20, petg: 18, abs: 15, asa: 15, nylon: 25, pa: 25, pom: 30, acetal: 30, resin: 15, tough_resin: 22, aluminium: 60, aluminum: 60, brass: 70, steel: 150 };
const lewisY = (z) => Math.max(0.05, 0.154 - 0.912 / z);
function advise(args) {
  const proc = PROCESS[args.process] || PROCESS.fdm, pr = args.priority || 'balanced', why = [];
  const ratio = +args.ratio || (Array.isArray(args.teeth) && args.teeth.length === 2 ? args.teeth[1] / args.teeth[0] : 2);
  if (!(ratio > 0)) throw new Error('ratio must be above 0');
  const alphaDeg = +args.pressure_angle || (pr === 'strength' || Math.max(ratio, 1 / ratio) > 6 ? 25 : 20);
  const zLimit = minTeeth(alphaDeg, 0), zmin = Math.max(pr === 'compact' ? 10 : 12, Math.min(zLimit, pr === 'compact' ? 12 : 17));
  const flip = ratio < 1, R = flip ? 1 / ratio : ratio;
  /* 1. tooth counts: near the ratio, small, coprime (hunting tooth) unless the exact ratio matters */
  let Z1, Z2;
  if (Array.isArray(args.teeth) && args.teeth.length === 2) { Z1 = Math.min(...args.teeth); Z2 = Math.max(...args.teeth); }
  else {
    let best = null;
    for (let z1 = zmin; z1 <= zmin + 40; z1++) for (const z2 of new Set([Math.floor(z1 * R) - 1, Math.floor(z1 * R), Math.ceil(z1 * R), Math.ceil(z1 * R) + 1])) {
      if (z2 < z1) continue;
      const err = Math.abs(z2 / z1 - R) / R, hunting = gcd(z1, z2) === 1;
      /* precision: the exact ratio wins; otherwise a hunting-tooth pair is worth up to ~3 % of ratio error (even wear, quieter) */
      const score = err * (pr === 'precision' ? 400 : 8) + (hunting || pr === 'precision' ? 0 : 0.25) + (z1 - zmin) * (pr === 'compact' ? 0.03 : 0.012);
      if (!best || score < best.score) best = { z1, z2, score };
    }
    Z1 = best.z1; Z2 = best.z2;
  }
  /* 2. form and face width */
  const style = args.style || (proc.widthK === 0 ? 'spur' : (pr === 'compact' || pr === 'precision') && proc.style === 'herringbone' ? 'helical' : proc.style);
  const widthK = pr === 'compact' ? Math.max(6, proc.widthK - 3) : pr === 'strength' ? proc.widthK + 2 : proc.widthK;
  /* 3. module: from torque (Lewis bending) when given, else the process sweet spot; never below what the process can make */
  const mat = String(args.material || (args.process === 'cnc' || args.process === 'hobbed' ? 'steel' : args.process === 'injection' ? 'pom' : args.process === 'sla' ? 'tough_resin' : 'petg')).toLowerCase(), sigma = MATERIAL_MPA[mat] || 18;
  let m = +args.module || (pr === 'compact' ? proc.minModule : proc.module);
  if (args.torque && !args.module) {
    const kb = args.width ? null : (widthK || 10), need = kb ? Math.cbrt((2000 * args.torque * 1.5) / (Z1 * kb * lewisY(Z1) * sigma)) : Math.sqrt((2000 * args.torque * 1.5) / (Z1 * args.width * lewisY(Z1) * sigma));
    m = Math.max(need, pr === 'compact' ? proc.minModule : proc.module);
    why.push(`${args.torque} N·m on the pinion in ${mat.toUpperCase()} (about ${sigma} MPa allowable) needs module ≥ ${r2(need)} (Lewis bending, service factor 1.5).`);
  }
  m = Math.max(m, proc.minModule); m = STANDARD_MODULES.find(x => x >= m - 1e-9) || m;
  if (m === proc.minModule && !args.torque) why.push(`Module ${m}: the smallest tooth ${proc.name} makes reliably.`);
  /* 4. a required centre distance re-splits the tooth sum */
  if (+args.centre_distance) {
    const sum = Math.max(2 * zmin, Math.round(2 * args.centre_distance / m));
    Z1 = Math.max(zmin, Math.round(sum / (1 + R))); Z2 = sum - Z1;
    why.push(`Centre distance ${args.centre_distance} mm at module ${m}: ${Z1} + ${Z2} teeth gives ${r2((Z1 + Z2) * m / 2)} mm.`);
  }
  const a = (Z1 + Z2) * m / 2, width = +args.width || Math.max(3, r2((widthK || 8) * m));
  const shift1 = Z1 < zLimit ? r2((zLimit - Z1) / zLimit) : 0;
  if (alphaDeg === 25) why.push('25° pressure angle: thicker tooth roots and fewer teeth before undercut.');
  if (shift1) why.push(`The ${Z1}-tooth pinion would undercut: profile shift +${shift1} on it and −${shift1} on the wheel keeps the centre distance.`);
  why.push(gcd(Z1, Z2) === 1 ? `${Z1}:${Z2} share no factor (hunting tooth), so wear spreads over every tooth${Math.abs(Z2 / Z1 - R) > 1e-9 ? `; priority “precision” gives the exact ${r3(R)} instead` : ''}.` : `${Z1}:${Z2} is an exact ${r3(Z2 / Z1)} ratio (the counts share a factor, so the same teeth keep meeting).`);
  const helix = style === 'spur' ? 0 : (+args.helix || proc.helix || 20);
  why.push(style === 'herringbone' ? `Herringbone ${helix}°: opposite helices cancel the axial thrust, self-centre the pair and print without supports.`
    : style === 'helical' ? `Helical ${helix}°: more teeth in contact and quieter; take the axial thrust with a shoulder or thrust washer.` : 'Spur: simplest to make and mount, no axial thrust.');
  const cA = Math.cos(alphaDeg * DEG), rb1 = Z1 * m * cA / 2, rb2 = Z2 * m * cA / 2, ra1 = Z1 * m / 2 + m * (1 + shift1), ra2 = Z2 * m / 2 + m * (1 - shift1);
  const contact = (Math.sqrt(ra1 * ra1 - rb1 * rb1) + Math.sqrt(ra2 * ra2 - rb2 * rb2) - a * Math.sin(alphaDeg * DEG)) / (Math.PI * m * cA);
  why.push(`Contact ratio ${r2(contact)} (${contact >= 1.4 ? 'smooth' : contact >= 1.2 ? 'acceptable' : 'low: use more teeth or 20°'}).`);
  let stress, safety;
  if (args.torque) { const Ft = 2000 * args.torque / (m * Z1); stress = r2(Ft / (width * m * lewisY(Z1))); safety = r2(sigma / stress); }
  const notes = proc.notes.slice();
  if (args.rpm) { const v = Math.PI * Z1 * m * args.rpm / 60000; notes.push(`Pitch-line speed ${r2(v)} m/s${v > 5 && ['fdm', 'sla', 'injection'].includes(args.process || 'fdm') ? ': high for plastic gears, so lubricate, or go helical and larger' : ''}.`); }
  if (safety != null && safety < 1.2) notes.push(`Safety factor ${safety} is low: widen the face, raise the module or use a stronger material.`);
  const pin = flip ? Z2 : Z1, whl = flip ? Z1 : Z2;
  return {
    process: proc.name, priority: pr, module: m, teeth: [pin, whl], ratio: r3(whl / pin), ratio_error_percent: r2(100 * Math.abs(whl / pin - ratio) / ratio),
    style, helix, pressure_angle: alphaDeg, width, backlash: proc.backlash, clearance: proc.clearance, shift: flip ? [-shift1, shift1] : [shift1, -shift1],
    centre_distance: r3(a + 0), pitch_diameters: [r3(pin * m), r3(whl * m)], contact_ratio: r2(contact), hunting_tooth: gcd(Z1, Z2) === 1,
    material: mat, bending_stress_MPa: stress, safety_factor: safety, bore_allowance: proc.bore, why, notes
  };
}

/* ---------- ops helpers for actions ---------- */
/* the material a process usually means (the caller's material wins) */
const PROCESS_MATERIAL = { fdm: 'petg', sla: 'tough_resin', cnc: 'steel', laser: 'acrylic', injection: 'pom', hobbed: 'steel' };
const MATERIAL_ALIAS = { pa: 'nylon', acetal: 'pom', aluminum: 'aluminium' };
const GEAR_MATERIALS = ['pla', 'petg', 'abs', 'asa', 'nylon', 'pom', 'resin', 'tough_resin', 'aluminium', 'brass', 'steel'];
const gearMeta = (args) => { let m = args.material || PROCESS_MATERIAL[args.process]; if (!m) return undefined; m = String(m).toLowerCase(); return { material: MATERIAL_ALIAS[m] || m }; };
const gearParams = (o, z, extra) => Object.assign({ module: o.module, teeth: z, width: o.width, pressure_angle: o.pressure_angle, style: o.style, helix: o.style === 'spur' ? 0 : o.helix, backlash: o.backlash, clearance: o.clearance, bore: 0 }, extra || {});
const pick = (args, keys) => Object.fromEntries(keys.filter(k => args[k] !== undefined && args[k] !== null && args[k] !== '').map(k => [k, args[k]]));
function settle(args) {
  /* merge the process preset under anything the caller set */
  const proc = PROCESS[args.process] || null, o = Object.assign({}, args);
  if (proc) { for (const [k, v] of Object.entries({ backlash: proc.backlash, clearance: proc.clearance })) if (o[k] == null || o[k] === '') o[k] = v; if (!o.style) o.style = proc.style; if (o.helix == null || o.helix === '') o.helix = proc.helix; }
  o.style = o.style || 'spur'; o.helix = o.style === 'spur' ? 0 : (+o.helix || 20);
  o.module = +o.module || (proc ? proc.module : 1.5); o.width = +o.width || Math.max(3, r2((proc && proc.widthK ? proc.widthK : 8) * o.module));
  o.pressure_angle = +o.pressure_angle || 20; o.backlash = o.backlash == null || o.backlash === '' ? 0.1 : +o.backlash; o.clearance = o.clearance == null || o.clearance === '' ? 0.25 : +o.clearance;
  return o;
}
/* ids that are free in the document and not yet used in this batch */
const freshIds = (ctx) => { const used = new Set(); return (prefix) => { let i = 1; while (ctx.get(prefix + i) || used.has(prefix + i)) i++; used.add(prefix + i); return prefix + i; }; };
const list = (v, n) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,\s]+/).filter(Boolean)).map(Number).filter(x => isFinite(x)).slice(0, n || 64);

/* shared by pair and advise(build) */
function pairOps(args, ctx) {
  const o = settle(args), fresh = freshIds(ctx);
  let T = list(args.teeth, 2);
  if (T.length < 2) { const rec = advise({ ratio: +args.ratio || 3, process: args.process, priority: args.priority }); T = rec.teeth; }
  const shifts = Array.isArray(args.shift) ? args.shift : [0, 0], bores = list(args.bore, 2), ring = !!args.ring, ops = [];
  let pin = args.driver || null;
  if (pin) {
    const g = ctx.get(pin); if (!g || g.type !== 'gear') throw new Error(`driver “${pin}” is not a gear`);
    Object.assign(o, { module: g.params.module, pressure_angle: g.params.pressure_angle, style: g.params.style, helix: (+g.params.helix || 0) * (ring ? 1 : -1), width: +args.width || g.params.width });
    T = [g.params.teeth, T[1]];
  } else {
    pin = fresh('gear');
    ops.push({ op: 'add', type: 'gear', id: pin, name: `Pinion ${T[0]}T`, params: gearParams(o, T[0], { shift: ring ? 0 : (+shifts[0] || 0), bore: bores[0] != null ? bores[0] : r2(Math.min(5, T[0] * o.module / 3)) }) });
    if (!ring) o.helix = -o.helix;
  }
  const wid = fresh(ring ? 'ring' : 'gear');
  ops.push({ op: 'add', type: 'gear', id: wid, name: `${ring ? 'Ring' : 'Wheel'} ${T[1]}T`, params: gearParams(o, T[1], { shift: ring ? 0 : (+shifts[1] || 0), internal: ring, bore: ring ? 0 : (bores[1] != null ? bores[1] : r2(Math.min(8, T[1] * o.module / 4))) }),
    mate: { to: pin, kind: 'gear', around: (+args.around || 0) + (ring ? 180 : 0) } });
  const m = o.module, a = ring ? (T[1] - T[0]) * m / 2 : (T[0] + T[1]) * m / 2 + ((+shifts[0] || 0) + (+shifts[1] || 0)) * m;
  const meta = gearMeta(args); if (meta) for (const x of ops) x.meta = meta;
  return { ops, label: `${ring ? 'Ring' : 'Gear'} pair ${T[0]}:${T[1]}`, info: { pinion: pin, wheel: wid, ratio: r3(T[1] / T[0]), centre_distance: r3(a), module: m, style: o.style, helix: o.style === 'spur' ? 0 : Math.abs(o.helix), backlash: o.backlash } };
}

export default {
  id: 'gears',
  name: 'Gears',
  version: '1.0.0',
  description: 'Involute spur, helical, herringbone and ring gears; gear mates that keep the mesh as sizes change; pairs, simple and compound trains, planetary sets; and an advisor that chooses module, teeth, form and tolerances for the job and the manufacturing process.',
  types: {
    gear: {
      label: 'Gear',
      doc: 'Involute gear. module = tooth size (pitch Ø = module × teeth); style spur | helical | herringbone (helix° with hand by sign); internal = ring gear; backlash (mm at the pitch circle, total per mesh) and clearance (× module) are the manufacturing allowances.',
      params: { module: 1.5, teeth: 20, width: 10, bore: 5, pressure_angle: 20, style: 'spur', helix: 0, backlash: 0.15, clearance: 0.25, shift: 0, internal: false, rim: 4, detail: 8 },
      build: buildGear,
      info: gearInfo,
      connectors(p, api) {
        const g = geometry(p), w = +p.width, C = api.conn;
        const c = [C('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0]), C('top', [0, 0, w], [0, 0, 1], [1, 0, 0]), C('center', [0, 0, w / 2], [0, 0, 1], [1, 0, 0], 'center')];
        for (const [nm, x, y] of [['+x', 1, 0], ['-x', -1, 0], ['+y', 0, 1], ['-y', 0, -1]]) c.push(C('pitch' + nm, [x * g.r, y * g.r, w / 2], [x, y, 0], [0, 0, 1], 'side'));
        if (g.internal) { const R = g.rf + Math.max(g.m, +p.rim || 3 * g.m); for (const [nm, x, y] of [['+x', 1, 0], ['-x', -1, 0], ['+y', 0, 1], ['-y', 0, -1]]) c.push(C('rim' + nm, [x * R, y * R, w / 2], [x, y, 0], [0, 0, 1], 'side')); }
        return c;
      },
      dims(p, api) {
        const g = geometry(p), w = +p.width, D = api.dim, out = [D('width', [g.internal ? g.rf + Math.max(g.m, +p.rim || 3 * g.m) : g.ra, 0, 0], [g.internal ? g.rf + Math.max(g.m, +p.rim || 3 * g.m) : g.ra, 0, w], 'front')];
        if (!g.internal && +p.bore > 0) out.push(D('bore', [-p.bore / 2, 0, w], [p.bore / 2, 0, w], 'top', 'diameter'));
        return out;
      }
    }
  },
  mates: {
    gear: {
      doc: 'Keeps this gear in mesh with the target gear: centre distance and tooth phase follow both gears\' live parameters. Fields: around (direction from the target, degrees), axial (shift along the axis, mm), phase (extra spin, degrees).',
      solve({ self, target, mate, api, targetWorld, targetSpin }) {
        if (!target || target.type !== 'gear' || self.type !== 'gear') throw new Error('a gear mate joins two gears');
        /* "around" is a world direction: take out the target's own spin (a meshed gear has turned to engage, a driven one turns) */
        let spin = 0;
        if (targetSpin != null) spin = targetSpin;
        else if (targetWorld && api) {
          const V = api.V, xl = V.norm([targetWorld[0], targetWorld[1], targetWorld[2]]), zl = V.norm([targetWorld[8], targetWorld[9], targetWorld[10]]);
          let ref = V.sub([1, 0, 0], V.mul(zl, zl[0])); if (V.len(ref) < 1e-6) ref = V.sub([0, 1, 0], V.mul(zl, zl[1])); ref = V.norm(ref);
          spin = Math.atan2(V.dot(V.cross(ref, xl), zl), V.dot(ref, xl)) / DEG;
          /* a revolute target keeps counting past ±180°: its mate angle turns it about its own mate face's normal,
             which points along +z or −z of the gear (bottom face → the world turn is −angle) */
          if (target.mate && !target.mate.kind) {
            const nb = target.mate.b === 'bottom' ? -1 : target.mate.b === 'top' || target.mate.b === 'center' ? 1 : 0;
            if (nb) { const th = nb * (+target.mate.angle || 0); let c = spin - th; c -= 360 * Math.round(c / 360); spin = th + c; }
          }
        }
        const { a, phi, beta, spinSelf } = meshPlacement(target.params, self.params, Object.assign({}, mate, { spin }));
        /* expressed as an ordinary mate between the two bottom faces (frame: u = +x, v = −y, normal −z) */
        return { a: 'bottom', b: 'bottom', flip: false, offset: -(+mate.axial || 0), slide: [a * Math.cos(phi), -a * Math.sin(phi)], angle: -beta / DEG, _spin: spinSelf };
      }
    }
  },
  actions: {
    advise: {
      doc: 'Recommend module, tooth counts, form (spur/helical/herringbone), pressure angle, backlash, clearance and face width for a ratio, a process and a priority. Optional torque (N·m on the pinion), rpm, material, centre distance. Changes nothing; build:true also adds the pair.',
      query: true,
      args: { ratio: { default: 3, doc: 'output ÷ input speed reduction, e.g. 3 = 3:1' }, process: { default: 'fdm', options: Object.keys(PROCESS), doc: 'how it will be made' }, priority: { default: 'balanced', options: ['balanced', 'strength', 'quiet', 'compact', 'precision'] }, torque: { default: null, doc: 'N·m on the pinion (optional)' }, rpm: { default: null }, material: { default: null, options: GEAR_MATERIALS }, centre_distance: { default: null, doc: 'mm (optional)' }, build: { default: false } },
      run(args, ctx) {
        const rec = advise(Object.assign({}, args, { torque: +args.torque || null, rpm: +args.rpm || null, ratio: +args.ratio, centre_distance: +args.centre_distance || null }));
        if (!args.build) return { info: rec };
        const res = pairOps({ teeth: rec.teeth, module: rec.module, width: rec.width, style: rec.style, helix: rec.helix, pressure_angle: rec.pressure_angle, backlash: rec.backlash, clearance: rec.clearance, shift: rec.shift, process: args.process }, ctx);
        return { ops: res.ops, info: Object.assign({ advice: rec }, res.info), label: `Gear pair ${rec.teeth[0]}:${rec.teeth[1]} (advised)` };
      }
    },
    pair: {
      doc: 'Two gears in mesh. teeth [pinion, wheel] (or ratio), module, width, style, helix, process (fills backlash/clearance/form), around (direction of the wheel, deg), driver (an existing gear id to mesh with instead of adding the pinion), bore [b1, b2], ring:true makes the wheel an internal ring gear.',
      args: { teeth: { default: [15, 45] }, module: { default: 1.5 }, width: { default: null }, style: { default: null, options: ['spur', 'helical', 'herringbone'] }, helix: { default: null }, process: { default: 'fdm', options: Object.keys(PROCESS) }, around: { default: 0 }, driver: { default: null }, ring: { default: false }, bore: { default: null }, material: { default: null, options: GEAR_MATERIALS } },
      run(args, ctx) { return pairOps(args, ctx); }
    },
    train: {
      doc: 'A gear train. teeth [z1, z2, …] = a simple chain (idlers in between); stages [[z1, z2], [z3, z4], …] = compound: each stage\'s second gear shares a shaft with the next stage\'s first, so ratios multiply. around = direction(s) in degrees.',
      args: { teeth: { default: [12, 36, 12] }, stages: { default: null }, module: { default: 1.5 }, width: { default: null }, style: { default: null, options: ['spur', 'helical', 'herringbone'] }, process: { default: 'fdm', options: Object.keys(PROCESS) }, around: { default: 0 }, material: { default: null, options: GEAR_MATERIALS } },
      run(args, ctx) {
        const o = settle(args), ops = [], ids = [], aroundL = list(args.around), around = (i) => (aroundL.length ? aroundL[Math.min(i, aroundL.length - 1)] : 0);
        const fresh = freshIds(ctx), nid = () => fresh('gear');
        const stages = Array.isArray(args.stages) && args.stages.length ? args.stages.map(s => list(s, 2)) : null;
        let ratio = 1, k = 0;
        if (stages) {
          let prev = null;
          stages.forEach((st, si) => {
            const hand = si % 2 ? -1 : 1, idIn = nid(), idOut = nid(); k += 2;
            ops.push({ op: 'add', type: 'gear', id: idIn, name: `Stage ${si + 1} pinion (${st[0]}T)`, params: gearParams(o, st[0], { helix: o.helix * hand }),
              mate: prev ? { to: prev, a: 'top', b: 'bottom', flip: true } : undefined });
            ops.push({ op: 'add', type: 'gear', id: idOut, name: `Stage ${si + 1} wheel (${st[1]}T)`, params: gearParams(o, st[1], { helix: -o.helix * hand }), mate: { to: idIn, kind: 'gear', around: around(si) } });
            ids.push(idIn, idOut); ratio *= st[1] / st[0]; prev = idOut;
          });
        } else {
          const T = list(args.teeth); if (T.length < 2) throw new Error('give at least two tooth counts');
          T.forEach((z, i) => {
            const id = nid(); k++;
            ops.push({ op: 'add', type: 'gear', id, name: `Gear ${i + 1} (${z}T)`, params: gearParams(o, z, { helix: o.helix * (i % 2 ? -1 : 1) }), mate: i ? { to: ids[i - 1], kind: 'gear', around: around(i - 1) } : undefined });
            ids.push(id);
          });
          ratio = T[T.length - 1] / T[0];
        }
        const meta = gearMeta(args); if (meta) for (const x of ops) x.meta = meta;
        return { ops, label: stages ? `Compound train ${stages.map(s => s.join(':')).join(' · ')}` : `Gear train ${list(args.teeth).join('–')}`, info: { gears: ids, ratio: r3(ratio), output_turns_per_input_turn: r3(1 / ratio), direction: stages ? (stages.length % 2 ? 'reversed' : 'same') : (list(args.teeth).length % 2 ? 'same' : 'reversed') } };
      }
    },
    planetary: {
      doc: 'Planetary (epicyclic) set: sun, planets around it and an internal ring. ring teeth = sun + 2 × planet. With the ring held, ratio = 1 + ring/sun (sun in, carrier out).',
      args: { sun: { default: 18 }, planet: { default: 12 }, planets: { default: 3 }, module: { default: 1.5 }, width: { default: null }, style: { default: null, options: ['spur', 'helical', 'herringbone'] }, process: { default: 'fdm', options: Object.keys(PROCESS) } },
      run(args, ctx) {
        const o = settle(args), zs = Math.round(+args.sun), zp = Math.round(+args.planet), n = Math.max(1, Math.round(+args.planets)), zr = zs + 2 * zp;
        if ((zs + zr) % n) {
          const ok = []; for (let d = -3; d <= 3; d++) if (zs + d > 6 && (2 * (zs + d) + 2 * zp) % n === 0) ok.push(zs + d);
          throw new Error(`${n} planets will not fit evenly: (sun + ring) = ${zs + zr} must divide by ${n}. Try sun ${ok.join(' or ') || zs + 1}.`);
        }
        const sid = freshIds(ctx)('sun'), ops = [{ op: 'add', type: 'gear', id: sid, name: `Sun (${zs}T)`, params: gearParams(o, zs, { helix: o.helix }) }], pids = [];
        for (let k = 0; k < n; k++) { const id = sid + '_p' + (k + 1); pids.push(id); ops.push({ op: 'add', type: 'gear', id, name: `Planet ${k + 1} (${zp}T)`, params: gearParams(o, zp, { helix: -o.helix, bore: Math.min(+args.planet_bore || 3, zp * o.module / 3) }), mate: { to: sid, kind: 'gear', around: 360 * k / n } }); }
        const rid = sid + '_ring';
        ops.push({ op: 'add', type: 'gear', id: rid, name: `Ring (${zr}T)`, params: gearParams(o, zr, { helix: -o.helix, internal: true, rim: Math.max(3, 2 * o.module) }), mate: { to: pids[0], kind: 'gear', around: 180 }, color: '#9aa3b5' });
        const meta = gearMeta(args); if (meta) for (const x of ops) x.meta = meta;
        return { ops, label: `Planetary ${zs}/${zp}/${zr} ×${n}`, info: { sun: sid, planets: pids, ring: rid, ring_teeth: zr, ratio_ring_fixed: r3(1 + zr / zs), ratio_carrier_fixed: r3(-zr / zs), ratio_sun_fixed: r3(1 + zs / zr) } };
      }
    },
    gear: {
      doc: 'One gear. process fills in backlash, clearance and form; teeth below the undercut limit get a profile shift.',
      args: { teeth: { default: 20 }, module: { default: 1.5 }, width: { default: null }, bore: { default: 5 }, style: { default: null, options: ['spur', 'helical', 'herringbone'] }, helix: { default: null }, process: { default: 'fdm', options: Object.keys(PROCESS) }, internal: { default: false } },
      run(args, ctx) {
        const o = settle(args), z = Math.round(+args.teeth), zm = minTeeth(o.pressure_angle, 0);
        const shift = !args.internal && z < zm ? r2((zm - z) / zm) : 0;
        const id = freshIds(ctx)('gear');
        return { ops: [{ op: 'add', type: 'gear', id, name: `${args.internal ? 'Ring' : 'Gear'} ${z}T m${o.module}`, params: gearParams(o, z, { bore: +args.bore || 0, internal: !!args.internal, shift }), meta: gearMeta(args) }], info: { id, shift } };
      }
    }
  }
};
