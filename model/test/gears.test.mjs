/* Gears add-on tests: node model/test/gears.test.mjs */
import { Model, registerAddon } from '../js/model.js';
import gears from '../addons/gears.js';
registerAddon(gears);
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const body = (m, id) => m.result.bodies.find(b => b.id === id).solid;
const G = (id, z, extra, mate) => ({ op: 'add', type: 'gear', id, params: Object.assign({ module: 2, teeth: z, width: 4, bore: 6, backlash: 0.1 }, extra), mate });
const offPhase = (ops, id) => JSON.parse(JSON.stringify(ops)).map(o => (o.id === id ? Object.assign(o, { mate: Object.assign({}, o.mate, { phase: 180 / o.params.teeth }) }) : o));
const build = (ops) => { const m = new Model(); m.apply(ops); return m; };

/* vertices of B strictly inside solid A (ray parity), only where they could touch: within A's reach and between its faces */
function penetration(A, B, reach, width) {
  const m = A.toMesh(), P = m.positions, T = [];
  for (let i = 0; i < P.length; i += 9) T.push(P.slice(i, i + 9));
  const d = [1, 0.000123, 0.000317];
  const inside = (q) => {
    let n = 0;
    for (const t of T) {
      if (Math.max(t[1], t[4], t[7]) < q[1] - 0.01 || Math.min(t[1], t[4], t[7]) > q[1] + 0.01 || Math.max(t[2], t[5], t[8]) < q[2] - 0.01 || Math.min(t[2], t[5], t[8]) > q[2] + 0.01 || Math.max(t[0], t[3], t[6]) < q[0]) continue;
      const e1 = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], e2 = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]; if (Math.abs(det) < 1e-14) continue;
      const s = [q[0] - t[0], q[1] - t[1], q[2] - t[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det; if (u < 0 || u > 1) continue;
      const qq = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (d[0] * qq[0] + d[1] * qq[1] + d[2] * qq[2]) / det; if (v < 0 || u + v > 1) continue;
      if ((e2[0] * qq[0] + e2[1] * qq[1] + e2[2] * qq[2]) / det > 1e-9) n++;
    }
    return n % 2 === 1;
  };
  const bb = A.bbox(), cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2, Q = B.toMesh().positions, seen = new Set(); let k = 0;
  for (let i = 0; i < Q.length; i += 3) {
    const q = [Q[i], Q[i + 1], Q[i + 2]], key = q.map(v => v.toFixed(4)).join(); if (seen.has(key)) continue; seen.add(key);
    if (Math.hypot(q[0] - cx, q[1] - cy) > reach || q[2] < 0.05 || q[2] > width - 0.05) continue;
    if (inside(q)) k++;
  }
  return k;
}

/* spur: exact overlap volume */
const spur = [G('a', 18), G('b', 30, {}, { to: 'a', kind: 'gear', around: 0 })];
const s1 = build(spur), s2 = build(offPhase(spur, 'b'));
const ov = Math.abs(body(s1, 'a').intersect(body(s1, 'b')).volume()), ovBad = Math.abs(body(s2, 'a').intersect(body(s2, 'b')).volume());
ok('spur pair meshes: no overlap (a half-tooth error overlaps)', ov < 1e-6 && ovBad > 20, { ov, ovBad });
const Wb = s1.result.world.get('b');
ok('centre distance = m(z1 + z2)/2', near(Math.hypot(Wb[12], Wb[13]), 48), Math.hypot(Wb[12], Wb[13]));
const odd = [G('a', 17), G('b', 23, {}, { to: 'a', kind: 'gear', around: 37 })], o1 = build(odd), o2 = build(offPhase(odd, 'b'));
ok('any direction and odd tooth counts mesh', Math.abs(body(o1, 'a').intersect(body(o1, 'b')).volume()) < 1e-6 && Math.abs(body(o2, 'a').intersect(body(o2, 'b')).volume()) > 20);
/* helical / herringbone / ring: penetration counts */
const hel = [G('a', 20, { style: 'helical', helix: 25, width: 6 }), G('b', 31, { style: 'helical', helix: -25, width: 6 }, { to: 'a', kind: 'gear' })];
ok('helical pair of opposite hands meshes along the whole face', penetration(body(build(hel), 'a'), body(build(hel), 'b'), 22, 6) === 0 && penetration(body(build(offPhase(hel, 'b')), 'a'), body(build(offPhase(hel, 'b')), 'b'), 22, 6) > 10);
const hb = [G('a', 15, { style: 'herringbone', helix: 25, width: 8 }), G('b', 35, { style: 'herringbone', helix: -25, width: 8 }, { to: 'a', kind: 'gear', around: 90 })];
ok('herringbone pair meshes', penetration(body(build(hb), 'a'), body(build(hb), 'b'), 17, 8) === 0 && penetration(body(build(offPhase(hb, 'b')), 'a'), body(build(offPhase(hb, 'b')), 'b'), 17, 8) > 10);
const rg = [G('r', 60, { internal: true, bore: 0 }), G('p', 18, {}, { to: 'r', kind: 'gear', around: 30 })];
const rgm = build(rg), rgBad = build(offPhase(rg, 'p'));
ok('pinion inside a ring gear meshes', penetration(body(rgm, 'r'), body(rgm, 'p'), 70, 4) === 0 && penetration(body(rgm, 'p'), body(rgm, 'r'), 20, 4) === 0 && penetration(body(rgBad, 'r'), body(rgBad, 'p'), 70, 4) > 3);
const pr = build([G('p', 18), G('r', 60, { internal: true, bore: 0 }, { to: 'p', kind: 'gear', around: 180 })]), Wr = pr.result.world.get('r');
ok('ring placed around a pinion: offset by (z_ring − z_pinion)·m/2', near(Math.hypot(Wr[12], Wr[13]), 42) && penetration(body(pr, 'p'), body(pr, 'r'), 20, 4) === 0);
/* parametric mesh */
s1.apply([{ op: 'set', id: 'a', params: { module: 2.5 } }, { op: 'set', id: 'b', params: { module: 2.5 } }]);
const Wb2 = s1.result.world.get('b');
ok('changing the module keeps the gears in mesh', near(Math.hypot(Wb2[12], Wb2[13]), 60) && Math.abs(body(s1, 'a').intersect(body(s1, 'b')).volume()) < 1e-6);
s1.apply([{ op: 'set', id: 'b', params: { module: 3 } }]);
ok('mismatched modules are reported', s1.result.warnings.some(w => /modules differ/.test(w.text)), s1.result.warnings.map(w => w.text));
let herr = ''; try { build([G('a', 20, { style: 'helical', helix: 20 }), G('b', 30, { style: 'helical', helix: 20 }, { to: 'a', kind: 'gear' })]); } catch (e) { herr = e.message; }
ok('same-hand helical pair is refused with the reason', /opposite hand/.test(herr), herr);
const info = s1.describe().objects.find(o => o.id === 'a').info;
ok('gear info: pitch, outside, root and base diameters', near(info.pitch_diameter, 45) && near(info.outside_diameter, 50) && near(info.root_diameter, 38.75), info);
const u = build([G('u', 12)]).describe().objects[0].info;
ok('undercut warning below the minimum tooth count', /undercut/.test(u.warning || ''), u.warning);
/* actions */
const A = new Model();
const adv = A.apply([{ op: 'addon', addon: 'gears', action: 'advise', args: { ratio: 3, process: 'fdm' } }])[0].info;
ok('advisor (FDM, 3:1): herringbone, printable module, hunting-tooth pair', adv.style === 'herringbone' && adv.module >= 1 && adv.hunting_tooth && Math.abs(adv.ratio - 3) / 3 < 0.06 && adv.backlash >= 0.2, { teeth: adv.teeth, module: adv.module, ratio: adv.ratio });
const adv2 = A.apply([{ op: 'addon', addon: 'gears', action: 'advise', args: { ratio: 3, process: 'fdm', torque: 5, material: 'pla' } }])[0].info;
ok('advisor: torque raises the module (Lewis bending)', adv2.module > adv.module && adv2.safety_factor >= 1, { module: adv2.module, safety: adv2.safety_factor });
const adv3 = A.apply([{ op: 'addon', addon: 'gears', action: 'advise', args: { ratio: 2, process: 'laser', priority: 'precision' } }])[0].info;
ok('advisor (laser, precision 2:1): spur, exact ratio', adv3.style === 'spur' && adv3.ratio === 2, { style: adv3.style, ratio: adv3.ratio });
const B = new Model();
const pair = B.apply([{ op: 'addon', addon: 'gears', action: 'pair', args: { teeth: [15, 45], module: 1.5, process: 'fdm' } }])[0];
ok('pair action: two gears in mesh, process preset applied', B.doc.objects.length === 2 && pair.info.ratio === 3 && B.doc.objects[1].params.style === 'herringbone' && B.doc.objects[0].params.helix === -B.doc.objects[1].params.helix && !B.result.warnings.length, pair.info);
const C = new Model();
const tr = C.apply([{ op: 'addon', addon: 'gears', action: 'train', args: { stages: [[12, 36], [12, 36]], module: 1, process: 'cnc' } }])[0];
ok('compound train: stage ratios multiply (3 × 3 = 9)', tr.info.ratio === 9 && C.doc.objects.length === 4 && !C.result.warnings.length, tr.info);
const D = new Model();
let perr = ''; try { D.apply([{ op: 'addon', addon: 'gears', action: 'planetary', args: { sun: 18, planet: 12, planets: 7, module: 1 } }]); } catch (e) { perr = e.message; }
ok('planetary: impossible planet count is refused with a fix', /must divide by 7/.test(perr), perr);
const pl = D.apply([{ op: 'addon', addon: 'gears', action: 'planetary', args: { sun: 18, planet: 12, planets: 3, module: 1, process: 'cnc' } }])[0];
const ringW = D.result.world.get(pl.info.ring), sunW = D.result.world.get(pl.info.sun);
ok('planetary set: ring is concentric with the sun, ratio 1 + ring/sun', near(ringW[12], sunW[12], 1e-6) && near(ringW[13], sunW[13], 1e-6) && near(pl.info.ratio_ring_fixed, 1 + 42 / 18, 1e-3) && !D.result.warnings.length, pl.info);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
