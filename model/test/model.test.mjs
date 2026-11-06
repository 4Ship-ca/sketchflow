/* SketchFlow v2 model tests: node model/test/model.test.mjs */
import { Model, worldConnectors, massReport, bom, weldAdvice, measureDim, dimsOf, threadPitchOf, carrySplines } from '../js/model.js';
import { layoutSheet, drawingSVG, drawingDXF } from '../js/drawing.js';
import { textSolid, layoutText } from '../js/text.js';
import * as K0 from '../js/kernel.js';
import { EXAMPLES, exampleDoc } from '../js/examples.js';
import { expandArcs as expandArcs_t, splineCurve as splineCurve_t } from '../js/sketch.js';
import { interference } from '../js/collide.js';
const { V, M4 } = K0;
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const near = (a, b, t = 1e-3) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const m = new Model();
const [base] = m.apply([{ op: 'add', type: 'box', id: 'base', params: { width: 80, depth: 50, height: 20 } }]);
ok('first object is the ground', m.result.ground === 'base');
m.apply([{ op: 'add', type: 'cylinder', id: 'post', params: { diameter: 20, height: 40 } }]);
const postBottom = worldConnectors(m.result, 'post').find(c => c.name === 'bottom'), baseTop = worldConnectors(m.result, 'base').find(c => c.name === 'top');
ok('new object stacks on the ground (bottom → top)', near(postBottom.o[2], 20) && near(postBottom.o[0], 0), postBottom.o);
ok('mated faces point at each other', near(postBottom.n[2], -1) && near(baseTop.n[2], 1));
ok('no floating warnings yet', !m.result.warnings.some(w => w.kind === 'floating'), m.result.warnings);
/* parametric: raise the base → the post rides up */
m.apply([{ op: 'set', id: 'base', params: { height: 35 } }]);
ok('raising the base lifts the mated post', near(worldConnectors(m.result, 'post').find(c => c.name === 'bottom').o[2], 35));
/* a pyramid-like cone on the post, centred, with a gap */
m.apply([{ op: 'add', type: 'cone', id: 'tip', params: { diameter: 20, height: 15 }, mate: { to: 'post', a: 'top', b: 'bottom', offset: 2 } }]);
ok('cone sits on the post with a 2 mm gap', near(worldConnectors(m.result, 'tip').find(c => c.name === 'bottom').o[2], 35 + 40 + 2));
/* boolean: drill a hole through the base */
m.apply([{ op: 'add', type: 'cylinder', id: 'drill', params: { diameter: 10, height: 60 }, mate: { to: 'base', a: 'bottom', b: 'bottom', flip: false, offset: 5, slide: [25, 0] }, into: 'base', mode: 'subtract' }]);
const vol = m.result.bodies.find(b => b.id === 'base').solid.volume(), holeA = 0.5 * 48 * 25 * Math.sin(2 * Math.PI / 48);
ok('subtracting the drill makes a through hole', near(vol, 80 * 50 * 35 - holeA * 35, 1e-3), { vol, want: 80 * 50 * 35 - holeA * 35 });
ok('tool body no longer drawn on its own', !m.result.bodies.some(b => b.id === 'drill'));
/* edge treatments: round the top-front edge of the base (convex → subtract) */
const topFront = worldConnectors(m.result, 'base').find(c => c.name === 'edge:top-front').o;
const r1 = m.apply([{ op: 'edge', target: 'base', near: topFront, style: 'fillet', size: 6 }])[0];
const v2 = m.result.bodies.find(b => b.id === 'base').solid.volume();
ok('convex edge is detected and the fillet subtracts', r1.convex === true && r1.mode === 'subtract', r1);
ok('fillet removed (1 − π/4)·r²·L of material', near(vol - v2, (1 - Math.PI / 4) * 36 * 80, 0.04), { removed: +(vol - v2).toFixed(2), want: +((1 - Math.PI / 4) * 36 * 80).toFixed(2) });
/* inside corner: an L made from two unioned boxes, then fillet the inner corner (concave → add) */
const L = new Model();
L.apply([{ op: 'add', type: 'box', id: 'floor', params: { width: 60, depth: 40, height: 10 } }, { op: 'add', type: 'box', id: 'wall', params: { width: 10, depth: 40, height: 40 }, mate: { to: 'floor', a: 'top', b: 'bottom', slide: [-25, 0] }, into: 'floor', mode: 'add' }]);
const lv = L.result.bodies[0].solid.volume();
ok('L-bracket volume', near(lv, 60 * 40 * 10 + 10 * 40 * 40), lv);
const r2 = L.apply([{ op: 'edge', target: 'floor', near: [-20, 0, 10], style: 'fillet', size: 8 }])[0];
const lv2 = L.result.bodies[0].solid.volume();
ok('inside corner is concave and the fillet adds material', r2.convex === false && r2.mode === 'add', r2);
ok('added (1 − π/4)·r²·L', near(lv2 - lv, (1 - Math.PI / 4) * 64 * 40, 0.05), { added: +(lv2 - lv).toFixed(2), want: +((1 - Math.PI / 4) * 64 * 40).toFixed(2) });
const r3 = L.apply([{ op: 'edge', target: 'floor', near: [30, 0, 10], style: 'chamfer', size: 3 }])[0];
ok('outer edge chamfer subtracts ½·t²·L', r3.convex && near(lv2 - L.result.bodies[0].solid.volume(), 0.5 * 9 * 40, 0.02));
/* edge treatment follows parametric changes (edge re-found after the wall gets taller) */
L.apply([{ op: 'set', id: 'wall', params: { height: 60 } }]);
ok('fillet survives a dimension change', !L.result.warnings.some(w => w.kind === 'edge'), L.result.warnings);
/* features */
m.apply([{ op: 'extrude', id: 'ext', profile: [[0, 0], [20, 0], [10, 15]], length: 12, twist: 30, scale: 0.6, face: { obj: 'base', conn: 'right' } }]);
ok('extrude on a face starts on that face', near(worldConnectors(m.result, 'ext').find(c => c.name === 'start').o[0], 40), worldConnectors(m.result, 'ext').find(c => c.name === 'start').o);
m.apply([{ op: 'revolve', id: 'rev', profile: [[0, 0], [8, 0], [8, 3], [3, 9], [0, 9]], at: [120, 0, 0], fixed: true }]);
ok('revolve builds a closed solid', m.result.bodies.find(b => b.id === 'rev').solid.volume() > 0);
m.apply([{ op: 'loft', id: 'lft', profile: [[-8, -8], [8, -8], [8, 8], [-8, 8]], profile2: [[-4, -4], [4, -4], [4, 4], [-4, 4]], length: 20, twist: 45, at: [-120, 0, 0], fixed: true }]);
ok('loft square → smaller twisted square', m.result.bodies.find(b => b.id === 'lft').solid.volume() > 0);
m.apply([{ op: 'sweep', id: 'swp', profile: [[-2, -2], [2, -2], [2, 2], [-2, 2]], path: [[0, 0, 0], [0, 0, 30], [25, 0, 30]], at: [0, 120, 0], fixed: true }]);
ok('sweep along an L path', m.result.bodies.find(b => b.id === 'swp').solid.volume() > 0);
/* floating + orphans + cleanup */
m.apply([{ op: 'add', type: 'sphere', id: 'ball', params: { diameter: 16 }, at: [0, -120, 0] }]);
ok('object placed without a mate is flagged floating', m.result.warnings.some(w => w.kind === 'floating' && w.id === 'ball'));
m.apply([{ op: 'delete', id: 'post' }]);
ok('deleting the post orphans the cone mated to it', m.result.warnings.some(w => w.kind === 'orphan' && w.id === 'tip'), m.result.warnings.map(w => w.text));
ok('fixed features are not reported as floating', !m.result.warnings.some(w => w.kind === 'floating' && ['rev', 'lft', 'swp'].includes(w.id)));
const c = m.apply([{ op: 'cleanup', fixFloating: true }])[0];
ok('cleanup fixes orphans and floating objects', c.fixes >= 2 && !m.result.warnings.some(w => w.kind === 'orphan' || w.kind === 'floating'), { fixes: c.fixes, w: m.result.warnings });
/* ephemeral origin */
m.apply([{ op: 'origin', obj: 'base', conn: 'corner-x-y-z' }]);
ok('world origin moved to the base corner', near(m.result.originPoint[0], -40) && near(m.result.originPoint[1], -25) && near(m.result.originPoint[2], 0), m.result.originPoint);
const d = m.describe(); ok('describe() lists objects, bodies and connectors', d.objects.length > 5 && d.bodies.length > 2 && d.objects[0].connectors.includes('top'));
/* undo / redo */
const n0 = m.doc.objects.length; m.undo(); m.undo(); const n1 = m.doc.objects.length; m.redo(); m.redo();
ok('undo/redo', m.doc.objects.length === n0 && n1 <= n0, { n0, n1 });
/* topological edge reference: the chamfer follows the corner when the plate grows (geometry alone would lose it) */
const T = new Model();
T.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 70, height: 10 } }]);
T.apply([{ op: 'edge', target: 'plate', near: [60, -35, 5], style: 'chamfer', size: 3 }]);
const tv1 = T.result.bodies[0].solid.volume();
T.apply([{ op: 'set', id: 'plate', params: { width: 140 } }]);
const tv2 = T.result.bodies[0].solid.volume();
ok('edge is re-found by its two faces after a resize', !T.result.warnings.some(w => w.kind === 'edge') && near(tv2 - tv1, 20 * 70 * 10, 1e-3), { warnings: T.result.warnings.map(w => w.text), dv: tv2 - tv1 });
ok('edge stores the faces it sits between', JSON.stringify(T.doc.objects[1].edge.faces.slice().sort()) === JSON.stringify(['plate:front', 'plate:right']), T.doc.objects[1].edge.faces);
/* round edges: the treatment runs around the whole circular edge (Pappus: area × centroid path) */
const Rd = new Model();
Rd.apply([{ op: 'add', type: 'cylinder', id: 'disc', params: { diameter: 80, height: 8 } }]);
const rv0 = Rd.result.bodies[0].solid.volume(), [rr] = Rd.apply([{ op: 'edge', target: 'disc', near: [40, 0, 8], style: 'chamfer', size: 2 }]);
ok('disc rim chamfer goes all the way round', rr.round && rr.round.closed && near(rv0 - Rd.result.bodies[0].solid.volume(), 2 * 2 / 2 * 2 * Math.PI * (40 - 2 / 3), 0.01), { removed: rv0 - Rd.result.bodies[0].solid.volume() });
const Hs = new Model();
Hs.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 60, depth: 60, height: 10 } }, { op: 'add', type: 'cylinder', id: 'hole', params: { diameter: 10, height: 12 }, mate: { to: 'p', a: 'top', b: 'top', flip: false, offset: 1 }, into: 'p', mode: 'subtract' }]);
const hv0 = Hs.result.bodies[0].solid.volume(), [hr] = Hs.apply([{ op: 'edge', target: 'p', near: [5, 0, 10], style: 'chamfer', size: 1.5 }]);
ok('hole rim chamfer = countersink (convex → subtract)', hr.convex && hr.round && near(hv0 - Hs.result.bodies[0].solid.volume(), 1.5 * 1.5 / 2 * 2 * Math.PI * (5 + 0.5), 0.01));
const Bs = new Model();
Bs.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 60, depth: 60, height: 10 } }, { op: 'add', type: 'cylinder', id: 'boss', params: { diameter: 20, height: 15 }, into: 'p', mode: 'add' }]);
const bv0 = Bs.result.bodies[0].solid.volume(), [br] = Bs.apply([{ op: 'edge', target: 'p', near: [10, 0, 10], style: 'fillet', size: 3 }]);
const spandrel = 9 * (1 - Math.PI / 4), cpath = 2 * Math.PI * (10 + 3 * (10 - 3 * Math.PI) / (12 - 3 * Math.PI));
ok('fillet at the base of a boss is added (concave)', !br.convex && near(Bs.result.bodies[0].solid.volume() - bv0, spandrel * cpath, 0.015), { added: Bs.result.bodies[0].solid.volume() - bv0, want: spandrel * cpath });
Bs.apply([{ op: 'set', id: 'boss', params: { diameter: 30 } }]);
ok('round edge is re-found after the boss grows', !Bs.result.warnings.length, Bs.result.warnings);
/* patterns: copies follow the source, and a hole's countersink comes along */
const Pt = new Model(), pv = (id) => Pt.result.bodies.find(b => b.id === id).solid.volume();
Pt.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 100, depth: 60, height: 10 } }, { op: 'add', type: 'cylinder', id: 'h', params: { diameter: 8, height: 12 }, mate: { to: 'p', a: 'top', b: 'top', flip: false, offset: 1, slide: [-30, 0] }, into: 'p', mode: 'subtract' }]);
Pt.apply([{ op: 'edge', target: 'p', near: [-26, 0, 10], style: 'chamfer', size: 1 }]);
const one = 100 * 60 * 10 - pv('p'), [lp] = Pt.apply([{ op: 'pattern', of: 'h', kind: 'linear', count: 4, spacing: 20, direction: [1, 0, 0] }]);
ok('linear array repeats the hole and its countersink', lp.of.length === 2 && near(100 * 60 * 10 - pv('p'), 4 * one, 1e-6), { of: lp.of, ratio: (100 * 60 * 10 - pv('p')) / one });
Pt.apply([{ op: 'set', id: 'h', params: { diameter: 6 } }]);
const P6 = new Model();
P6.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 100, depth: 60, height: 10 } }, { op: 'add', type: 'cylinder', id: 'h', params: { diameter: 6, height: 12 }, mate: { to: 'p', a: 'top', b: 'top', flip: false, offset: 1, slide: [-30, 0] }, into: 'p', mode: 'subtract' }]);
P6.apply([{ op: 'edge', target: 'p', near: [-27, 0, 10], style: 'chamfer', size: 1 }]);
const one6 = 100 * 60 * 10 - P6.result.bodies[0].solid.volume();
ok('array copies follow the source size (countersinks re-found)', !Pt.result.warnings.length && near(100 * 60 * 10 - pv('p'), 4 * one6, 1e-6), { warnings: Pt.result.warnings, ratio: (100 * 60 * 10 - pv('p')) / one6 });
const Cp = new Model();
Cp.apply([{ op: 'add', type: 'cylinder', id: 'disc', params: { diameter: 80, height: 8 } }, { op: 'add', type: 'cylinder', id: 'b', params: { diameter: 7, height: 10 }, mate: { to: 'disc', a: 'top', b: 'top', flip: false, offset: 1, slide: [29, 0] }, into: 'disc', mode: 'subtract' }]);
const c0 = Cp.result.bodies[0].solid.volume(), [cp] = Cp.apply([{ op: 'pattern', of: 'b', kind: 'circular', count: 6, about: { obj: 'disc', conn: 'center' } }]);
const holeV = 0.5 * 48 * 3.5 * 3.5 * Math.sin(2 * Math.PI / 48) * 8;
ok('circular array: bolt circle of 6', cp.copies === 5 && near(c0 - Cp.result.bodies[0].solid.volume(), 5 * holeV, 0.01), { removed: c0 - Cp.result.bodies[0].solid.volume(), want: 5 * holeV });
const Mi = new Model();
Mi.apply([{ op: 'add', type: 'box', id: 'base', params: { width: 100, depth: 40, height: 5 } }, { op: 'add', type: 'cylinder', id: 'post', params: { diameter: 10, height: 30 }, mate: { to: 'base', a: 'top', b: 'bottom', slide: [35, 10] } }]);
Mi.apply([{ op: 'pattern', of: 'post', kind: 'mirror', plane: 'yz' }]);
const mcopy = Mi.result.bodies.find(b => b.virtual), mbb = mcopy && mcopy.solid.bbox();
ok('mirror makes a left-hand copy across the YZ plane', mcopy && near(mbb.min[0], -40) && near(mbb.max[0], -30) && near(mcopy.solid.volume(), Mi.result.bodies.find(b => b.id === 'post').solid.volume()));
/* welds: a bead body between two parts that stay separate (an assembly); a fillet would merge them */
const Wd = new Model(), wv = (id) => Wd.result.bodies.find(b => b.id === id).solid.volume();
Wd.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 70, height: 10 } }, { op: 'add', type: 'box', id: 'web', params: { width: 10, depth: 70, height: 60 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-40, 0] } }]);
const pv0 = wv('plate'), wv0 = wv('web'), [wd] = Wd.apply([{ op: 'weld', a: 'plate', b: 'web', near: [-35, 0, 10], size: 5 }]);
ok('weld is its own body; the welded parts are unchanged', Wd.result.bodies.length === 3 && wv('plate') === pv0 && wv('web') === wv0 && near(wv(wd.id), 0.5 * 25 * 70, 1e-6), { bead: wv(wd.id) });
Wd.apply([{ op: 'set', id: 'web', params: { width: 14 } }]);
ok('weld follows its seam when a part changes', !Wd.result.warnings.length && near(wv(wd.id), 0.5 * 25 * 70, 1e-6), Wd.result.warnings);
ok('welded parts count as attached, not floating', !Wd.result.warnings.some(w => w.kind === 'floating'));
Wd.apply([{ op: 'delete', id: wd.id }]);
ok('removing the weld leaves both parts whole', Wd.result.bodies.length === 2 && wv('plate') === pv0);
Wd.apply([{ op: 'boolean', target: 'plate', tool: 'web', mode: 'add' }]);
let werr = ''; try { Wd.apply([{ op: 'weld', a: 'plate', b: 'web' }]); } catch (e) { werr = e.message; }
ok('a weld refuses parts that a boolean already merged', /one part already/.test(werr), werr);
const Tb = new Model();
Tb.apply([{ op: 'add', type: 'box', id: 'pl', params: { width: 80, depth: 80, height: 6 } }, { op: 'add', type: 'cylinder', id: 'tube', params: { diameter: 30, height: 40 }, mate: { to: 'pl', a: 'top', b: 'bottom' } }]);
const [tw] = Tb.apply([{ op: 'weld', a: 'pl', b: 'tube', size: 3 }]);
ok('a tube on a plate is welded all the way round', tw.round && near(Tb.result.bodies.find(b => b.id === tw.id).solid.volume(), 0.5 * 9 * 2 * Math.PI * (15 + 1), 0.01));
/* metadata → mass, centre of gravity, inertia, balance, parts list */
const Ms = new Model();
Ms.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 100, depth: 50, height: 10 }, material: 'aluminium', meta: { part_no: 'P-1' } },
  { op: 'add', type: 'box', id: 'block', params: { width: 20, depth: 20, height: 40 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [40, 0] }, material: 'steel' }]);
let rep = massReport(Ms.doc, Ms.result);
ok('mass = volume × density per part', near(rep.parts[0].mass_g, 135, 1e-6) && near(rep.parts[1].mass_g, 125.6, 1e-6), rep.parts.map(p => p.mass_g));
const Mt = 135 + 125.6;
ok('assembly centre of gravity is the mass-weighted centroid', near(rep.cog[0], 125.6 * 40 / Mt, 1e-4) && near(rep.cog[2], (135 * 5 + 125.6 * 30) / Mt, 1e-4), rep.cog);
ok('box inertia matches m(b² + c²)/12', near(rep.parts[0].inertia_kg_mm2[0], 0.135 * (50 * 50 + 10 * 10) / 12, 1e-3), rep.parts[0].inertia_kg_mm2);
ok('it stands: CoG inside the base', rep.balance.stands === true);
Ms.apply([{ op: 'set', id: 'block', params: { height: 400 } }, { op: 'mate', id: 'block', to: 'plate', a: 'top', b: 'bottom', slide: [65, 0] }]);   /* overhangs the edge, above the floor */
rep = massReport(Ms.doc, Ms.result);
ok('balance: a heavy part hung off the side tips it over', rep.balance.stands === false && rep.balance.tips_toward === '+x', rep.balance);
Ms.apply([{ op: 'set', id: 'block', meta: { material: 'pla', fill: 20 } }]);
ok('fill % (3D-print infill) scales the mass', near(massReport(Ms.doc, Ms.result).parts[1].mass_g, 20 * 20 * 400 / 1000 * 1.24 * 0.2, 1e-6));
let merr = ''; try { Ms.apply([{ op: 'set', id: 'plate', material: 'unobtainium' }]); } catch (e) { merr = e.message; }
ok('unknown materials are refused with the list', /Unknown material/.test(merr));
Ms.apply([{ op: 'add', type: 'cylinder', id: 'pin', params: { diameter: 8, height: 20 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-40, 15] }, material: 'brass' }, { op: 'pattern', of: 'pin', kind: 'linear', count: 3, spacing: 10, direction: [0, -1, 0] }]);
const bl = bom(Ms.doc, Ms.result).lines.find(l => l.part === Ms.get('pin').name);
ok('parts list counts pattern copies as quantity', bl && bl.quantity === 3 && near(bl.mass_total_g, 3 * bl.mass_each_g, 1e-3), bl);
ok('weld advice: aluminium to steel is not fusion-weldable', /cannot be fusion-welded/.test(weldAdvice('aluminium', 'steel')) && weldAdvice('steel', 'steel') === null && /do not weld/.test(weldAdvice('pla', 'petg')));
/* links & formulas: a follower keeps step with its leader */
const Lk = new Model();
Lk.apply([{ op: 'add', type: 'box', id: 'plate', name: 'Base plate', params: { width: 120, depth: 70, height: 10 } }, { op: 'add', type: 'box', id: 'web', params: { width: 12, depth: '=plate.depth', height: 60 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-54, 0] } }]);
Lk.apply([{ op: 'set', id: 'plate', params: { depth: 100 } }]);
ok('a linked size follows its leader', Lk.get('web').params.depth === 100 && Lk.get('web').expr.depth === '=plate.depth');
Lk.apply([{ op: 'var', name: 'wall', value: 3 }, { op: 'set', id: 'web', params: { width: '=#wall * 4', height: '=Base_plate.width / 2' } }]);
Lk.apply([{ op: 'var', name: 'wall', value: 5 }]);
ok('variables and formulas (by id or by name) resolve', Lk.get('web').params.width === 20 && Lk.get('web').params.height === 60, Lk.get('web').params);
Lk.apply([{ op: 'set', id: 'plate', params: { depth: '=web.depth' } }]);
ok('a circle of links is reported, not looped', Lk.result.warnings.some(w => /round in a circle/.test(w.text)));
Lk.apply([{ op: 'set', id: 'plate', params: { depth: 100 } }, { op: 'set', id: 'web', params: { depth: 80 } }]);
ok('typing a number on a follower unlinks it', !('depth' in (Lk.get('web').expr || {})) && Lk.get('web').params.depth === 80);
let ferr = ''; try { Lk.apply([{ op: 'set', id: 'web', params: { depth: '=plate.depth +' } }]); } catch (e) { ferr = e.message; }
ok('a broken formula is refused with the reason', /ends too early/.test(ferr), ferr);
/* driving dimensions: the hole is held 15 from the plate edge, even when the plate grows */
Lk.apply([{ op: 'add', type: 'cylinder', id: 'h', params: { diameter: 8, height: 12 }, mate: { to: 'plate', a: 'top', b: 'top', flip: false, offset: 1, slide: [40, 22] }, into: 'plate', mode: 'subtract' }]);
const [dm] = Lk.apply([{ op: 'dim', a: { obj: 'h', conn: 'top' }, b: { obj: 'plate', conn: 'right' }, view: 'top' }]);
ok('hole → face dimension measures square to the face (off-edge)', dm.axis === 'normal' && near(dm.value, 20), dm);
Lk.apply([{ op: 'setdim', id: dm.id, value: 15 }]);
ok('setting the dimension moves the hole', near(measureDim(Lk.result, Lk.doc.dims[0]).value, 15) && near(Lk.get('h').mate.slide[0], 45));
Lk.apply([{ op: 'set', id: 'plate', params: { width: 160 } }]);
ok('a driving dimension holds when the part grows', near(measureDim(Lk.result, Lk.doc.dims[0]).value, 15) && near(Lk.get('h').mate.slide[0], 65));
const [dv2] = Lk.apply([{ op: 'dim', a: { obj: 'h', conn: 'top' }, b: { obj: 'plate', conn: 'back' }, view: 'top' }]);
Lk.apply([{ op: 'setdim', id: dv2.id, value: 12 }, { op: 'set', id: 'plate', params: { depth: 120 } }]);
ok('two driving dimensions hold together (x and y)', near(measureDim(Lk.result, Lk.doc.dims[0]).value, 15) && near(measureDim(Lk.result, Lk.doc.dims[1]).value, 12) && !Lk.result.warnings.some(w => w.kind === 'dim'));
const [dpp] = Lk.apply([{ op: 'dim', a: { obj: 'h', conn: 'top' }, b: { obj: 'plate', conn: 'corner+x+y+z' }, view: 'top' }]);
Lk.apply([{ op: 'dimaxis', id: dpp.id, axis: 'h' }]);
ok('point-to-point dimensions can be horizontal / vertical', near(measureDim(Lk.result, Lk.doc.dims[2]).value, 15), measureDim(Lk.result, Lk.doc.dims[2]).value);
/* history: suppress, rollback, reorder, duplicate */
const Hs2 = new Model(), hv = () => Hs2.result.bodies.find(b => b.id === 'p').solid.volume();
Hs2.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 100, depth: 60, height: 10 } }, { op: 'add', type: 'cylinder', id: 'h', params: { diameter: 10, height: 12 }, mate: { to: 'p', a: 'top', b: 'top', flip: false, offset: 1 }, into: 'p', mode: 'subtract' }]);
const full = hv();
Hs2.apply([{ op: 'suppress', id: 'h' }]);
ok('a suppressed hole stops cutting (and comes back)', near(hv(), 60000) && (Hs2.apply([{ op: 'suppress', id: 'h' }]), near(hv(), full)));
Hs2.apply([{ op: 'rollback', to: 1 }]);
ok('rolling back hides later features', near(hv(), 60000) && Hs2.describe().objects[1].rolled_back === true);
Hs2.apply([{ op: 'add', type: 'cylinder', id: 'h2', params: { diameter: 6, height: 12 }, mate: { to: 'p', a: 'top', b: 'top', flip: false, offset: 1, slide: [30, 0] }, into: 'p', mode: 'subtract' }]);
ok('a feature added while rolled back goes in at the bar', Hs2.doc.objects[1].id === 'h2' && Hs2.doc.rollback === 2);
Hs2.apply([{ op: 'rollback', to: null }]);
ok('rolling to the end brings everything back', Hs2.doc.rollback == null && hv() < full);
let merr2 = ''; try { Hs2.apply([{ op: 'move', id: 'h', to: 0 }]); } catch (e) { merr2 = e.message; }
ok('reordering refuses to put a hole before the part it cuts', /must come after/.test(merr2), merr2);
Hs2.apply([{ op: 'move', id: 'h2', after: 'h' }]);
ok('reordering within the rules works', Hs2.doc.objects.map(o => o.id).join() === 'p,h,h2');
const [dup] = Hs2.apply([{ op: 'duplicate', id: 'p' }]);
const dupBody = Hs2.result.bodies.find(b => b.id === dup.id);
ok('duplicate copies the part with its holes, beside it', dupBody && near(dupBody.solid.volume(), hv()) && Hs2.doc.objects.filter(o => o.into === dup.id).length === 2, { dup });
/* hole wizard and shell */
const Hw = new Model(), hwv = () => Hw.result.bodies.find(b => b.id === 'p').solid.volume();
Hw.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 100, depth: 60, height: 12 } }]);
const [hw] = Hw.apply([{ op: 'hole', target: 'p', at: [30, 15, 12], size: 'M6', kind: 'counterbore' }]);
ok('counterbore hole: ISO sizes, through, cut volume', /Ø6.6, counterbore Ø11 × 6.4/.test(hw.spec) && near(100 * 60 * 12 - hwv(), Math.PI * 3.3 * 3.3 * (12 - 6.4) + Math.PI * 5.5 * 5.5 * 6.4, 0.01), hw.spec);
ok('a placed hole is dimensioned from the two nearest edges (driving)', hw.dims.length === 2 && Hw.doc.dims.every(d => d.drive != null), hw.dims);
Hw.apply([{ op: 'set', id: 'p', params: { height: 20, width: 140 } }]);
ok('the hole stays through and stays put as the part grows', Hw.get(hw.id).params.depth > 20 && near(measureDim(Hw.result, Hw.doc.dims[0]).value, hw.dims[0].value));
const [ht] = Hw.apply([{ op: 'hole', target: 'p', at: [-30, 0, 20], size: 'M4', kind: 'tapped', depth: 10, dims: false }]);
ok('tapped blind hole uses the tap drill', /Ø3.3 drill/.test(ht.spec) && !Hw.get(ht.id).params.through);
const Sh = new Model();
Sh.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 30 } }, { op: 'shell', target: 'b', thickness: 2, open: 'top' }]);
ok('shell hollows a box to its walls, open on top', near(Sh.result.bodies[0].solid.volume(), 80 * 50 * 30 - 76 * 46 * 28, 1e-6));
Sh.apply([{ op: 'set', id: 'b', params: { height: 40 } }]);
ok('shell walls stay the same when the part changes', near(Sh.result.bodies[0].solid.volume(), 80 * 50 * 40 - 76 * 46 * 38, 1e-6));
/* general shell: an inward offset of every face, so any shape gets even walls */
const shellOf = (ops) => { const m2 = new Model(); m2.apply(ops); return m2; };
const ShL = shellOf([{ op: 'add', type: 'extrude', id: 'e', params: { profile: [[0, 0], [60, 0], [60, 10], [10, 10], [10, 40], [0, 40]], length: 30 } }, { op: 'shell', target: 'e', thickness: 2, open: 'end' }]);
ok('shell an L-profile extrude: mitred walls, open at its end', near(ShL.result.bodies[0].solid.volume(), 900 * 30 - (56 * 6 + 6 * 30) * 28, 1e-6));
const ShU = shellOf([{ op: 'add', type: 'box', id: 'a', params: { width: 60, depth: 30, height: 10 } }, { op: 'add', type: 'box', id: 'r', params: { width: 10, depth: 30, height: 40 }, mate: { to: 'a', a: 'top', b: 'bottom', slide: [-25, 0] }, into: 'a', mode: 'union' }, { op: 'shell', target: 'a', thickness: 2 }]);
ok('shell a boolean union (closed): one cavity through both parts', near(ShU.result.bodies[0].solid.volume(), 30000 - (56 * 6 + 6 * 40) * 26, 1e-6), ShU.result.bodies[0].solid.volume());
const ShC = shellOf([{ op: 'add', type: 'cylinder', id: 'c', params: { diameter: 40, height: 30 } }, { op: 'shell', target: 'c', thickness: 2, open: 'top' }]);
const apo = 20 * Math.cos(Math.PI / 48) - 2, inArea = 48 * apo * apo * Math.tan(Math.PI / 48), outArea = 24 * 400 * Math.sin(2 * Math.PI / 48);
ok('shell a cylinder: walls even all round, open on top', near(ShC.result.bodies[0].solid.volume(), outArea * 30 - inArea * 28, 1e-6));
const filletBox = (r) => [{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 30 } }, { op: 'edge', target: 'b', near: [0, -25, 30], style: 'fillet', size: r }];
const pre = shellOf(filletBox(1)).result.bodies[0].solid.volume(), ShF = shellOf([...filletBox(1), { op: 'shell', target: 'b', thickness: 2, open: 'bottom' }]);
ok('a rounding smaller than the wall gets a sharp inner corner (exact)', near(ShF.result.bodies[0].solid.volume(), pre - 76 * 46 * 28, 1e-6) && !ShF.result.warnings.some(w => w.kind === 'shell'));
const ShF5 = shellOf([...filletBox(5), { op: 'shell', target: 'b', thickness: 2, open: 'bottom' }]), pre5 = shellOf(filletBox(5)).result.bodies[0].solid.volume();
ok('a rounding bigger than the wall stays round inside (radius minus the wall)', near(pre5 - ShF5.result.bodies[0].solid.volume(), 76 * 46 * 28 - (1 - Math.PI / 4) * 9 * 76, 2e-3));
const bossOps = [{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 30 } }, { op: 'add', type: 'cylinder', id: 'boss', name: 'Boss', params: { diameter: 4, height: 8 }, mate: { to: 'b', a: 'top', b: 'bottom' }, into: 'b', mode: 'union' }];
const preB = shellOf(bossOps).result.bodies[0].solid.volume(), ShB = shellOf([...bossOps, { op: 'shell', target: 'b', thickness: 3, open: 'bottom' }]);
ok('a boss thinner than two walls stays solid, and says so', near(ShB.result.bodies[0].solid.volume(), preB - 74 * 44 * 27, 1e-6) && ShB.result.warnings.some(w => w.kind === 'shell' && /Boss stays solid/.test(w.text)));
let thinErr = null; try { shellOf([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 6 } }, { op: 'shell', target: 'b', thickness: 5 }]); } catch (e) { thinErr = e.message; }
ok('walls thicker than the part allows: refused with the reason', /thinner than two walls/.test(thinErr || ''), thinErr);
let webErr = null; try { shellOf([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 30 } }, { op: 'add', type: 'box', id: 'pk', name: 'Pocket', params: { width: 60, depth: 30, height: 27 }, mate: { to: 'b', a: 'top', b: 'top', flip: false }, into: 'b', mode: 'subtract' }, { op: 'shell', target: 'b', thickness: 2 }]); } catch (e) { webErr = e.message; }
ok('a cut that leaves a web thinner than two walls is named', /Pocket leaves a section thinner than two walls/.test(webErr || ''), webErr);
const ShP = shellOf([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 30 } }, { op: 'add', type: 'box', id: 'pk', params: { width: 60, depth: 30, height: 27 }, mate: { to: 'b', a: 'top', b: 'top', flip: false }, into: 'b', mode: 'subtract' }, { op: 'shell', target: 'b', thickness: 2, open: 'bottom' }]);
ok('open underneath, the same pocket floor is simply a wall (exact)', near(ShP.result.bodies[0].solid.volume(), 71400 - (76 * 46 * 28 - 64 * 34 * 27), 1e-6));
/* configurations, instances, imported meshes, versions */
const Cf = new Model();
Cf.apply([{ op: 'var', name: 'len', value: 100 }, { op: 'add', type: 'box', id: 'bar', params: { width: '=#len', depth: 20, height: 10 } }, { op: 'add', type: 'cylinder', id: 'h', params: { diameter: 6, height: 12 }, mate: { to: 'bar', a: 'top', b: 'top', flip: false, offset: 1 }, into: 'bar', mode: 'subtract' }]);
Cf.apply([{ op: 'config', action: 'add', name: 'Long', vars: { len: 200 }, suppress: ['h'] }]);
ok('a configuration sets its variables and switches features off', Cf.get('bar').params.width === 200 && near(Cf.result.bodies[0].solid.volume(), 200 * 20 * 10));
Cf.apply([{ op: 'config', name: null }]);
ok('switching back to Default restores everything', Cf.get('bar').params.width === 100 && Cf.result.bodies[0].solid.volume() < 100 * 20 * 10);
const In = new Model();
In.apply([{ op: 'add', type: 'box', id: 'base', params: { width: 200, depth: 100, height: 5 } }, { op: 'add', type: 'cylinder', id: 'leg', params: { diameter: 10, height: 40 }, mate: { to: 'base', a: 'bottom', b: 'top', slide: [-90, -40] }, material: 'steel' }]);
In.apply([{ op: 'instance', of: 'leg', mate: { to: 'base', a: 'bottom', b: 'top', slide: [90, -40] } }, { op: 'instance', of: 'leg', mate: { to: 'base', a: 'bottom', b: 'top', slide: [90, 40] } }]);
In.apply([{ op: 'set', id: 'leg', params: { diameter: 16 } }]);
const legsV = In.result.bodies.filter(b => b.id === 'leg' || b.instance === 'leg').map(b => b.solid.volume());
ok('instances are linked copies: the source change shows in all', legsV.length === 3 && legsV.every(v => near(v, legsV[0])) && legsV[0] > 7000);
ok('the parts list counts instances as quantity', bom(In.doc, In.result).lines.find(l => l.part === In.get('leg').name).quantity === 3);
const cube = 'solid c\n' + [['0 0 0', '10 10 0', '10 0 0'], ['0 0 0', '0 10 0', '10 10 0'], ['0 0 10', '10 0 10', '10 10 10'], ['0 0 10', '10 10 10', '0 10 10'], ['0 0 0', '10 0 0', '10 0 10'], ['0 0 0', '10 0 10', '0 0 10'], ['10 0 0', '10 10 0', '10 10 10'], ['10 0 0', '10 10 10', '10 0 10'], ['10 10 0', '0 10 0', '0 10 10'], ['10 10 0', '0 10 10', '10 10 10'], ['0 10 0', '0 0 0', '0 0 10'], ['0 10 0', '0 0 10', '0 10 10']].map(t => 'facet normal 0 0 0\nouter loop\n' + t.map(v => 'vertex ' + v).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid c';
const [imp] = In.apply([{ op: 'import', name: 'cube.stl', data: cube, material: 'pla' }]);
const ib = In.result.bodies.find(b => b.id === imp.id);
ok('STL import: a closed mesh part with volume and mass', imp.triangles === 12 && near(ib.solid.volume(), 1000, 1e-6) && near(massReport(In.doc, In.result).parts.find(q => q.id === imp.id).mass_g, 1.24, 1e-6));
const vv = In.saveVersion('before'); In.apply([{ op: 'delete', id: imp.id }]); In.restoreVersion(vv.id);
ok('a saved version restores (and survives undo)', In.doc.objects.some(o => o.id === imp.id) && In.listVersions().length === 1 && (In.undo(), In.listVersions().length === 1));
/* parametric sketch shapes and drawings */
const Sk = new Model();
Sk.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 100, depth: 60, height: 10 } }, { op: 'extrude', id: 'pocket', shape: 'rect', x: 20, y: 0, width: 20, height: 10, length: 12, at: [0, 0, -1], into: 'p', mode: 'subtract', fixed: true }]);
ok('a rectangle sketch cuts a pocket of its size', near(Sk.result.bodies[0].solid.volume(), 60000 - 2000, 1e-6));
Sk.apply([{ op: 'set', id: 'pocket', params: { width: 30 } }]);
ok('the sketch shape keeps its sizes as parameters', near(Sk.result.bodies[0].solid.volume(), 60000 - 3000, 1e-6) && Sk.describe().objects[1].params.shape === 'rect');
Sk.apply([{ op: 'extrude', id: 'hex', shape: 'polygon', diameter: 20, sides: 6, length: 10, at: [0, 0, 10], fixed: true }]);
ok('a polygon sketch extrudes to its exact area', near(Sk.result.bodies.find(b => b.id === 'hex').solid.volume(), 1.5 * Math.sqrt(3) * 100 * 10, 1e-6));
const sheet = layoutSheet(Sk);
ok('a drawing sheet has visible and hidden lines, dimensions and a title block', sheet.lines.some(l => !l.hidden) && sheet.lines.some(l => l.hidden) && sheet.dims.length > 2 && sheet.title.fields.some(([k]) => k === 'SCALE'), { lines: sheet.lines.length, hidden: sheet.lines.filter(l => l.hidden).length, dims: sheet.dims.length, scale: sheet.scale });
const svgOut = drawingSVG(Sk), dxfOut = drawingDXF(Sk);
ok('drawings export as SVG and DXF', /^<\?xml[\s\S]*<svg[\s\S]*<\/svg>$/.test(svgOut) && /SECTION[\s\S]*ENTITIES[\s\S]*\nEOF$/.test(dxfOut) && (dxfOut.match(/\nLINE\n/g) || []).length > 20);
/* exploded isometric with balloons tied to the parts list */
const Ex = new Model();
Ex.apply([{ op: 'add', type: 'box', id: 'plate', name: 'Plate', params: { width: 120, depth: 60, height: 8 } },
  { op: 'add', type: 'cylinder', id: 'post', name: 'Post', params: { diameter: 10, height: 30 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-40, 0] } },
  { op: 'pattern', of: 'post', kind: 'linear', count: 3, spacing: 40, direction: [1, 0, 0] },
  { op: 'add', type: 'box', id: 'cap', name: 'Cap', params: { width: 120, depth: 20, height: 6 }, mate: { to: 'plate', a: 'top', b: 'bottom', offset: 30 } }]);
const exS = layoutSheet(Ex), exItems = bom(Ex.doc, Ex.result).lines;
const plainS = layoutSheet(Ex, { exploded: false });
ok('an assembly drawing shows an exploded isometric', exS.exploded && exS.labels.some(l => l.text === 'EXPLODED ISOMETRIC') && !plainS.exploded && plainS.labels.some(l => l.text === 'ISOMETRIC') && !plainS.balloons.length);
ok('one balloon per parts-list item, numbered as the list (the 3 posts are one item)', exS.balloons.length === exItems.length && exItems.length === 3 && exS.balloons.map(b => b.item).join() === exItems.map(l => l.item).join() && exItems.find(l => l.part === 'Post').quantity === 3, { balloons: exS.balloons.map(b => b.item), items: exItems.map(l => l.part + '×' + l.quantity) });
const isoPts = exS.lines.filter(l => l.view === 'iso').flatMap(l => [l.a, l.b]), inBox = (p, q) => p[0] >= q.min[0] - 1e-6 && p[0] <= q.max[0] + 1e-6 && p[1] >= q.min[1] - 1e-6 && p[1] <= q.max[1] + 1e-6;
const isoBox = { min: [Math.min(...isoPts.map(p => p[0])), Math.min(...isoPts.map(p => p[1]))], max: [Math.max(...isoPts.map(p => p[0])), Math.max(...isoPts.map(p => p[1]))] };
const apart = exS.balloons.every((b, i) => exS.balloons.every((c, j) => i === j || Math.hypot(b.at[0] - c.at[0], b.at[1] - c.at[1]) >= 2 * b.r + 1));
ok('balloons sit outside the view, inside the frame, apart, each leader on its part', apart && exS.balloons.every(b => !inBox(b.at, isoBox) && b.at[0] - b.r >= exS.m && b.at[0] + b.r <= exS.W - exS.m && b.at[1] - b.r >= exS.m && b.at[1] + b.r <= exS.H - exS.m && inBox(b.anchor, isoBox)), exS.balloons);
const exSvg = drawingSVG(Ex), exDxf = drawingDXF(Ex);
ok('balloons export to SVG (circle + number) and DXF (CIRCLE on a BALLOONS layer)', (exSvg.match(/class="bn">\d+</g) || []).length === 3 && (exDxf.match(/\nCIRCLE\n8\nBALLOONS\n/g) || []).length === 3);
const spread = (S) => { const P2 = S.lines.filter(l => l.view === 'iso').flatMap(l => [l.a, l.b]); return Math.max(...P2.map(p => p[1])) - Math.min(...P2.map(p => p[1])); };
ok('the exploded view pulls the parts apart', spread(exS) / exS.isoScale > spread(plainS) / plainS.isoScale * 1.2);
/* text: emboss (boolean add) and engrave (boolean remove), straight or on an arc */
const tx = (p) => textSolid(Object.assign({ height: 10, depth: 1, weight: 1.2 }, p));
const tLine = tx({ text: 'HELLO' }), tb = tLine.bbox();
ok('text is centred on its anchor, cap height as asked', near(tb.min[0], -tb.max[0], 1e-6) && tb.max[1] - tb.min[1] >= 10 - 1e-6 && tb.max[1] - tb.min[1] < 10.6 && near(tb.max[2], 1, 1e-9), tb);
ok('lower case prints as capitals; unknown characters as ?', near(tx({ text: 'hello' }).volume(), tLine.volume(), 1e-9) && near(tx({ text: '~' }).volume(), tx({ text: '?' }).volume(), 1e-9));
const Tx = new Model();
Tx.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 60, height: 6 } }]);
const tpv0 = Tx.result.bodies[0].solid.volume();
const [emb] = Tx.apply([{ op: 'text', target: 'plate', text: 'SKETCH', height: 10, depth: 1.5 }]);
ok('emboss: a boolean add standing on the face (one body, exactly the text\'s volume more)', Tx.result.bodies.length === 1 && near(Tx.result.bodies[0].solid.volume() - tpv0, tx({ text: 'SKETCH', depth: 1.5 }).volume(), 1e-6) && near(Tx.result.bodies[0].solid.bbox().max[2], 7.5, 1e-9));
const tpv1 = Tx.result.bodies[0].solid.volume();
const [eng] = Tx.apply([{ op: 'text', target: 'plate', face: 'bottom', text: 'FLOW 3D', height: 8, depth: 0.8, weight: 1, mode: 'engrave' }]);
ok('engrave: a boolean remove cut in flush with the face', near(tpv1 - Tx.result.bodies[0].solid.volume(), textSolid({ text: 'FLOW 3D', height: 8, depth: 0.8, weight: 1 }).volume(), 1e-6) && near(Tx.result.bodies[0].solid.bbox().min[2], 0, 1e-9));
const W0 = Tx.result.world.get(eng.id), xs = M4.dir(W0, [1, 0, 0]), ys = M4.dir(W0, [0, 1, 0]);
ok('text on any face reads the right way round (its x × up is the face normal)', V.dot(V.cross(xs, ys), [0, 0, -1]) > 0.999);
const tv = () => Tx.result.bodies[0].solid.volume(), before = tv();
Tx.apply([{ op: 'set', id: emb.id, params: { text: 'SKETCHFLOW' } }]);
ok('editing the words keeps the text where it was and rebuilds it', tv() > before && near(Tx.result.world.get(emb.id)[12], 0, 1e-9));
const arcT = tx({ text: 'ROUND BADGE', height: 6, weight: 0.8, path: 'arc', radius: 30 });
const arcPts = arcT.polys.flatMap(q => q.v.map(v => Math.hypot(v.p[0], v.p[1])));
ok('arc text: letters stand on the arc, tops outward, centred at the top', Math.min(...arcPts) > 30 - 0.8 && Math.max(...arcPts) < 36.6 && arcT.bbox().min[1] > 0 && near(arcT.bbox().min[0] + arcT.bbox().max[0], 0, 0.6));
const inT = tx({ text: 'MADE 2026', height: 5, weight: 0.7, path: 'arc-inside', radius: 30 }), inPts = inT.polys.flatMap(q => q.v.map(v => Math.hypot(v.p[0], v.p[1])));
ok('arc-inside text: along the bottom, tops toward the centre', Math.max(...inPts) < 30 + 0.7 && Math.min(...inPts) > 30 - 5.7 && inT.bbox().max[1] < 0);
const D2 = new Model(); D2.apply([{ op: 'add', type: 'cylinder', id: 'disc', params: { diameter: 80, height: 5 } }]);
const dv0 = D2.result.bodies[0].solid.volume();
D2.apply([{ op: 'text', target: 'disc', text: 'ROUND BADGE', path: 'arc', radius: 30, height: 6, depth: 0.8, weight: 0.8 }, { op: 'text', target: 'disc', text: 'MADE 2026', path: 'arc-inside', radius: 30, height: 5, depth: 0.6, weight: 0.7, mode: 'engrave' }]);
ok('a badge: arc text embossed over the top and engraved under the bottom of a disc', near(D2.result.bodies[0].solid.volume() - dv0, arcT.volume() * 0.8 / 1 - inT.volume() * 0.6 / 1, 1e-6));
const pathT = layoutText({ text: 'AB', height: 10, weight: 1.2, path: 'points', points: [[0, 0], [10, 0], [10, 30]], align: 'start' });
ok('text follows a polyline path, each letter turned to its tangent', pathT.chars[0].strokes[0][0][1] < 1e-9 && pathT.chars.length === 2);
let longErr = null; try { tx({ text: 'A VERY LONG TEXT THAT GOES ALL THE WAY ROUND', path: 'arc', radius: 10 }); } catch (e) { longErr = e.message; }
ok('text longer than its arc is refused with the numbers', /longer than the arc/.test(longErr || ''));
const [clk] = Tx.apply([{ op: 'text', target: 'plate', at: [30, 15, 7.5], normal: [0, 0, 1], text: 'X', height: 6, depth: 1 }]);
ok('a click on a face places the text there (face found from the normal)', Tx.get(clk.id).mate.a === 'top' && near(Tx.result.world.get(clk.id)[12], 30, 1e-6) && near(Tx.result.world.get(clk.id)[13], 15, 1e-6));
/* features placed on a face: boss (boolean add) and cut (boolean remove), mated to the face at the clicked point */
const Fe = new Model(); Fe.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 20 } }]);
const fv = () => Fe.result.bodies[0].solid.volume(), fv0 = fv(), cylV = 0.5 * 48 * 25 * Math.sin(2 * Math.PI / 48) * 8;
const [boss] = Fe.apply([{ op: 'feature', target: 'b', at: [20, 10, 20], normal: [0, 0, 1], shape: 'cylinder', params: { diameter: 10, height: 8 } }]);
ok('a boss stands on the face it was placed on (one body, its volume more)', Fe.result.bodies.length === 1 && near(fv() - fv0, cylV, 1e-6) && Fe.get(boss.id).mate.a === 'top' && Fe.get(boss.id).mate.slide.join() === '20,10' && boss.name === 'Boss 1');
const fv1 = fv(), [cut] = Fe.apply([{ op: 'feature', target: 'b', at: [-40, 0, 10], normal: [-1, 0, 0], shape: 'box', params: { width: 10, depth: 6, height: 5 }, mode: 'cut' }]);
ok('a cut goes into the face it was placed on, flush', near(fv1 - fv(), 300, 1e-6) && Fe.get(cut.id).mate.a === 'left' && Fe.get(cut.id).op === 'subtract');
Fe.apply([{ op: 'set', id: 'b', params: { width: 100, height: 30 } }]);
ok('both follow their faces when the part changes size', near(Fe.result.world.get(cut.id)[12], -45, 1e-6) && near(Fe.result.world.get(boss.id)[14], 30, 1e-6));
let featErr = null; try { Fe.apply([{ op: 'feature', target: 'b', face: 'nowhere', shape: 'box' }]); } catch (e) { featErr = e.message; }
ok('an unknown face is refused with the list of faces', /no face “nowhere”[\s\S]*top/.test(featErr || ''), featErr);
const fa = Fe.faceAt('b', [10, 25, 15], [0, 1, 0]);
ok('faceAt turns a point on a face into that face and a slide on it', fa && fa.face === 'back' && fa.off < 1e-9 && fa.slide.length === 2);
/* true arcs in sketches: centres solved, radius dimensions drive them, tangency holds */
const Ar_n = new Model();
Ar_n.apply([{ op: 'extrude', id: 'sl', profile: [[0, 0], [40, 0], [40, 20], [0, 20]], arcs: [{ i: 1, c: [40, 10], ccw: true }, { i: 3, c: [0, 10], ccw: true }], length: 10, fixed: true }]);
const slotV_n = (r) => { const n = Math.max(2, Math.ceil(Math.PI / (6 * Math.PI / 180))); return 0.5 * n * r * r * Math.sin(Math.PI / n) * 2; };
ok('arcs are real profile segments (a slot with round ends, exact to its chords)', near(Ar_n.result.bodies[0].solid.volume(), (800 + slotV_n(10)) * 10, 1e-6), Ar_n.result.bodies[0].solid.volume());
Ar_n.apply([{ op: 'constrain', id: 'sl', type: 'radius', i: 1 }, { op: 'constrain', id: 'sl', type: 'fix', i: 0, at: [0, 0] }, { op: 'constrain', id: 'sl', type: 'h', i: 0 }, { op: 'constrain', id: 'sl', type: 'h', i: 2 }, { op: 'constrain', id: 'sl', type: 'tangent', i: 0, j: 1 }, { op: 'constrain', id: 'sl', type: 'tangent', i: 1, j: 2 }]);
const rp_n = Ar_n.get('sl').params.constraints.find(c => c.type === 'radius').p;
ok('a radius dimension measures the arc', near(Ar_n.get('sl').params[rp_n], 10, 1e-9) && Ar_n.describe().objects[0].sketch.arcs.length === 2);
Ar_n.apply([{ op: 'set', id: 'sl', params: { [rp_n]: 15 } }]);
const sp_n = Ar_n.get('sl').params, sa_n = sp_n.arcs.find(a => a.i === 1);
ok('changing the radius moves the arc and its tangent lines with it', Ar_n.result.sketch.get('sl').ok && near(sp_n.profile[2][1], 30, 1e-5) && near(sa_n.c[1], 15, 1e-5) && near(Math.hypot(sp_n.profile[1][0] - sa_n.c[0], sp_n.profile[1][1] - sa_n.c[1]), 15, 1e-5));
ok('a radius shows as a dimension (R) on the part', dimsOf(Ar_n.get('sl')).some(d => d.kind === 'radius' && d.param === rp_n));
let arcErr_n = null; try { Ar_n.apply([{ op: 'constrain', id: 'sl', type: 'radius', i: 0 }]); } catch (e) { arcErr_n = e.message; }
ok('radius on a straight segment is refused', /not an arc/.test(arcErr_n || ''), arcErr_n);
const Cn_n = new Model();
Cn_n.apply([{ op: 'extrude', id: 'w', profile: [[-20, 0], [20, 0], [10, 0.01], [-10, 0.01]], arcs: [{ i: 1, c: [0, 0], ccw: true }, { i: 3, c: [0, 0.3], ccw: false }], length: 5, fixed: true, constraints: [{ type: 'concentric', i: 1, j: 3 }] }]);
const ca_n = Cn_n.get('w').params.arcs;
ok('concentric arcs share a centre', Cn_n.result.sketch.get('w').ok && near(ca_n[0].c[0], ca_n[1].c[0], 1e-6) && near(ca_n[0].c[1], ca_n[1].c[1], 1e-6));
/* every flat face is a face connector, so inclined and side faces take features */
const Fc_n = new Model();
Fc_n.apply([{ op: 'extrude', id: 'L', profile: [[0, 0], [60, 0], [60, 10], [10, 10], [10, 40], [0, 40]], length: 20, fixed: true }]);
const lf_n = worldConnectors(Fc_n.result, 'L').filter(c => c.kind === 'face').map(c => c.name);
ok('an extrude\'s inner side faces are face connectors', lf_n.includes('face:side2') && lf_n.includes('face:side3'), lf_n);
const Wg_n = new Model(); Wg_n.apply([{ op: 'add', type: 'wedge', id: 'w', params: { width: 60, depth: 40, height: 30 } }]);
const slope_n = worldConnectors(Wg_n.result, 'w').find(c => c.name === 'slope'), wv0_n = Wg_n.result.bodies[0].solid.volume();
const [bs_n] = Wg_n.apply([{ op: 'feature', target: 'w', at: slope_n.o, normal: slope_n.n, shape: 'cylinder', params: { diameter: 8, height: 5 } }]);
ok('a boss on an inclined face stands square to it', Wg_n.get(bs_n.id).mate.a === 'slope' && Wg_n.result.bodies[0].solid.volume() > wv0_n && Math.abs(V.dot(M4.dir(Wg_n.result.world.get(bs_n.id), [0, 0, 1]), slope_n.n) - 1) < 1e-9);
/* extrude end conditions, draft, thin walls and ribs */
const ex1_n = (extra) => { const q2 = new Model(); q2.apply([Object.assign({ op: 'extrude', id: 'e', profile: [[-10, -10], [10, -10], [10, 10], [-10, 10]], length: 20, fixed: true }, extra)]); return q2; };
const sym_n = ex1_n({ end: 'symmetric' }).result.bodies[0].solid.bbox();
ok('symmetric extrude goes half each way', near(sym_n.min[2], -10, 1e-9) && near(sym_n.max[2], 10, 1e-9));
const dr_n = ex1_n({ draft: 10 }).result.bodies[0].solid.volume(), e2_n = 20 - 2 * 20 * Math.tan(10 * Math.PI / 180);
ok('draft tapers the walls (a frustum of the right size)', near(dr_n, 20 / 3 * (400 + e2_n * e2_n + 20 * e2_n), 1e-6), dr_n);
ok('a thin closed profile is a wall of that thickness', near(ex1_n({ thin: 2 }).result.bodies[0].solid.volume(), (400 - 256) * 20, 1e-9));
const Rb_n = new Model(); Rb_n.apply([{ op: 'extrude', id: 'rib', profile: [[0, 0], [30, 0], [30, 20]], open: true, thin: 3, length: 10, fixed: true }]);
ok('an open profile with a thickness is a rib', near(Rb_n.result.bodies[0].solid.volume(), 3 * 50 * 10, 1e-9));
const Th_n = new Model(); Th_n.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 20 } }, { op: 'extrude', id: 'c', shape: 'circle', diameter: 10, end: 'through', length: 5, mate: { to: 'b', a: 'top', b: 'end', flip: false }, into: 'b', mode: 'subtract' }]);
const thV_n = 0.5 * 48 * 25 * Math.sin(2 * Math.PI / 48) * 20;
ok('a through-all cut goes right through, and still does when the part grows', near(80000 - Th_n.result.bodies[0].solid.volume(), thV_n, 1e-6) && (Th_n.apply([{ op: 'set', id: 'b', params: { height: 35 } }]), near(80 * 50 * 35 - Th_n.result.bodies[0].solid.volume(), thV_n * 35 / 20, 1e-6)));
/* helix sweep (springs) */
const Sp_n = new Model(); Sp_n.apply([{ op: 'helix', id: 'sp_n', wire: 2, radius: 10, pitch: 5, turns: 4, fixed: true }]);
const spb_n = Sp_n.result.bodies[0].solid.bbox(), wireA_n = 0.5 * 24 * 1 * Math.sin(2 * Math.PI / 24);
ok('a spring: wire swept along a helix, the right length and size', near(Sp_n.result.bodies[0].solid.volume(), wireA_n * 4 * Math.hypot(2 * Math.PI * 10, 5), 0.02) && near(spb_n.max[0], 11, 0.02) && near(spb_n.max[2] - spb_n.min[2], 22, 0.05), { v: Sp_n.result.bodies[0].solid.volume(), spb_n });
let pitchErr_n = null; try { new Model().apply([{ op: 'helix', wire: 3, pitch: 2 }]); } catch (e) { pitchErr_n = e.message; }
ok('a pitch smaller than the wire is refused (coils would overlap)', /coils would overlap/.test(pitchErr_n || ''));
/* reference planes and splitting */
const Pl_n = new Model(); Pl_n.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 20 } }, { op: 'plane', id: 'p1', target: 'b', face: 'top', offset: -10 }]);
ok('a plane is reference geometry: no body, no mass, a face connector to use', Pl_n.result.bodies.length === 1 && worldConnectors(Pl_n.result, 'p1').some(c => c.name === 'plane' && near(c.o[2], 10, 1e-9)) && massReport(Pl_n.doc, Pl_n.result).parts.length === 1);
for (const [keep, want] of [['below', [[0, 10]]], ['above', [[10, 20]]], ['both', [[0, 10], [10, 20]]]]) {
  const q3 = new Model(); q3.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 20 } }, { op: 'plane', id: 'p1', target: 'b', face: 'top', offset: -10 }, { op: 'split', target: 'b', plane: 'p1', keep }]);
  const got = q3.result.bodies.map(bb => [bb.solid.bbox().min[2], bb.solid.bbox().max[2]]);
  ok(`split by a plane, keep ${keep}`, got.length === want.length && got.every((g, k) => near(g[0], want[k][0], 1e-9) && near(g[1], want[k][1], 1e-9)) && q3.result.bodies.every(bb => near(bb.solid.volume(), 40000, 1e-9)), got);
}
const Pt_n = new Model(); Pt_n.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 80, depth: 50, height: 20 } }, { op: 'plane', id: 'p2', target: 'b', face: 'top', tilt: 30 }]);
const ptn_n = worldConnectors(Pt_n.result, 'p2').find(c => c.name === 'plane').n;
ok('a plane tilts about the face', near(ptn_n[2], Math.cos(Math.PI / 6), 1e-9) && near(Math.abs(ptn_n[1]), 0.5, 1e-9));
/* splines, modelled threads (bolts, nuts, threaded cylinders, tapped holes), and sketches wrapped onto curved faces */
const Sl_t = new Model(); Sl_t.apply([{ op: 'extrude', id: 's', profile: [[0, 0], [40, 0], [40, 20], [0, 20]], splines: [{ i: 2, pts: [[30, 30], [10, 26]] }], length: 5, fixed: true }]);
const slb_t = Sl_t.result.bodies[0].solid.bbox();
ok('a spline segment bulges smoothly through its fit points', slb_t.max[1] > 29.5 && slb_t.max[1] < 31.5 && Sl_t.result.bodies[0].solid.volume() > 40 * 20 * 5 && !worldConnectors(Sl_t.result, 's').some(c => c.name === 'face:spl2'), slb_t);
const Bt_t = new Model(); Bt_t.apply([{ op: 'add', type: 'bolt', id: 'b', params: { size: 'M8', length: 25 } }, { op: 'add', type: 'nut', id: 'n', params: { size: 'M8' }, mate: { to: 'b', a: 'bottom', b: 'bottom', flip: false, offset: 5 } }]);
const bolt_t = Bt_t.result.bodies.find(x => x.id === 'b').solid, nut_t = Bt_t.result.bodies.find(x => x.id === 'n').solid, bbb_t = bolt_t.bbox();
ok('an M8 × 25 hex bolt_t: 13 across flats, head 5.3, threaded shank', near(bbb_t.max[1], 6.5, 1e-6) && near(bbb_t.max[2], 30.3, 1e-6) && bolt_t.volume() > Math.PI * 3.32 * 3.32 * 25 && bolt_t.volume() < Math.PI * 16 * 25 + 13 * 13 * 5.3 * 1.2, { v: bolt_t.volume(), bbb_t });
const tI_t = performance.now(), ov_t = Math.abs(bolt_t.intersect(nut_t).volume()), tIms_t = performance.now() - tI_t;
ok('a nut_t screws onto its bolt_t: the threads mesh without overlapping (and checking is fast)', ov_t < 1e-6 && tIms_t < 5000, { ov_t, tIms_t });
ok('bolt connectors: tip, seat under the head, top; the head flats are faces', ['bottom', 'seat', 'top'].every(n => worldConnectors(Bt_t.result, 'b').some(c => c.name === n)) && worldConnectors(Bt_t.result, 'b').filter(c => /^face:flat/.test(c.name)).length === 6);
const Tc_t = new Model(); Tc_t.apply([{ op: 'add', type: 'cylinder', id: 'c', params: { diameter: 10, height: 30 } }, { op: 'thread', target: 'c', size: 'M10', length: 15 }]);
const tcV_t = Tc_t.result.bodies[0].solid.volume(), r1t_t = (10 - 1.0825 * 1.5) / 2;
ok('threading a cylinder keeps the plain part and cuts the thread (between minor and major)', tcV_t < Math.PI * 25 * 30 && tcV_t > Math.PI * 25 * 15 + Math.PI * r1t_t * r1t_t * 15 && Tc_t.get('c').params.thread === 'M10', tcV_t);
const Th2_t = new Model(); Th2_t.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 40, depth: 30, height: 12 } }, { op: 'hole', target: 'p', at: [0, 0, 12], size: 'M6', kind: 'tapped', modelled: true, depth: 10, through: false, dims: false }]);
const tapRemoved_t = 14400 - Th2_t.result.bodies[0].solid.volume();
ok('a modelled tapped hole cuts a real thread (more than the tap drill, less than the full diameter)', tapRemoved_t > Math.PI * 2.5 * 2.5 * 10 && tapRemoved_t < Math.PI * 3.2 * 3.2 * 11 + 10, tapRemoved_t);
const Wr_t = new Model(); Wr_t.apply([{ op: 'add', type: 'cylinder', id: 'c', params: { diameter: 40, height: 30 } }]); const wv0_t = Wr_t.result.bodies[0].solid.volume();
Wr_t.apply([{ op: 'wrap', target: 'c', at: [0, -20, 15], normal: [0, -1, 0], profile: [[-10, -5], [10, -5], [10, 5], [-10, 5]], depth: 2 }]);
ok('a sketch wrapped onto a cylinder stands out of it (curved, the right size)', near(Wr_t.result.bodies[0].solid.volume() - wv0_t, 20 * 10 * 2 * 21 / 20, 0.02) && Wr_t.result.bodies[0].solid.bbox().min[1] < -21.9);
Wr_t.apply([{ op: 'set', id: 'c', params: { diameter: 60 } }]);
ok('the wrap follows the cylinder when it changes size', near(Wr_t.result.bodies[0].solid.bbox().min[1], -32, 0.02));
const Wt_t = new Model(); Wt_t.apply([{ op: 'add', type: 'cylinder', id: 'c', params: { diameter: 40, height: 30 } }]); const wtv_t = Wt_t.result.bodies[0].solid.volume();
Wt_t.apply([{ op: 'wrap', target: 'c', text: 'SKETCH', size: 8, depth: 0.8, mode: 'engrave' }]);
ok('text engraved round a cylinder', Wt_t.result.bodies[0].solid.volume() < wtv_t - 20 && Wt_t.result.bodies.length === 1);
const Wf_t = new Model(); Wf_t.apply([{ op: 'extrude', id: 'e', shape: 'circle', diameter: 30, length: 20, fixed: true }]);
const fitc_t = Wf_t.cylinderAt('e', [15, 0, 10], [1, 0, 0]);
ok('any round face is found as a cylinder (axis, radius) to wrap onto', fitc_t && near(fitc_t.radius, 15, 1e-3) && Math.abs(fitc_t.axis[2]) > 0.9999);
/* sketch constraints on a polyline profile */
const Sc = new Model();
Sc.apply([{ op: 'extrude', id: 'L', profile: [[0, 0], [61, 1.5], [60, 9], [11, 10.5], [9, 41], [1, 40]], length: 10, fixed: true, constraints: [{ type: 'fix', i: 0, at: [0, 0] }, { type: 'h', i: 0 }, { type: 'v', i: 1 }, { type: 'h', i: 2 }, { type: 'v', i: 3 }, { type: 'h', i: 4 }, { type: 'v', i: 5 }] }]);
const LP = () => Sc.get('L').params.profile;
ok('horizontal / vertical constraints square up a sloppy sketch', LP().every((q, i, a) => { const b = a[(i + 1) % a.length]; return Math.abs(q[0] - b[0]) < 1e-6 || Math.abs(q[1] - b[1]) < 1e-6; }), LP());
for (const [i, v] of [[0, 60], [1, 10], [5, 40], [4, 10]]) Sc.apply([{ op: 'constrain', id: 'L', type: 'length', i, value: v }]);
ok('length dimensions drive it and it becomes fully defined', near(Sc.result.bodies[0].solid.volume(), (60 * 10 + 10 * 30) * 10, 1e-6) && Sc.describe().objects[0].sketch.dof === 0, { dof: Sc.describe().objects[0].sketch.dof });
Sc.apply([{ op: 'var', name: 'leg', value: 25 }, { op: 'set', id: 'L', params: { d1: '=#leg * 4' } }]);
ok('a sketch dimension can be a formula', near(LP()[1][0], 100, 1e-6));
Sc.apply([{ op: 'constrain', id: 'L', type: 'length', i: 0, value: 10 }]);
ok('conflicting constraints are reported, not forced', Sc.result.warnings.some(w => /can't satisfy/.test(w.text)));
/* left-hand threads, and the screw joint's pitch read from the thread */
const lhPair_t = (bl, nl) => { const L = new Model(); L.apply([{ op: 'add', type: 'bolt', id: 'b', params: { size: 'M8', length: 20, left_hand: bl }, fixed: true }, { op: 'add', type: 'nut', id: 'n', params: { size: 'M8', left_hand: nl }, mate: { to: 'b', a: 'bottom', b: 'bottom', flip: false, offset: 5 } }, { op: 'joint', id: 'n', joint: 'screw' }]); return L; };
const Lh_t = lhPair_t(true, true), lhz0_t = Lh_t.result.bodies.find(x => x.id === 'n').solid.bbox().min[2];
ok('a screw joint takes its pitch from the thread: negative for left-hand', Lh_t.get('n').mate.pitch === -1.25 && threadPitchOf(lhPair_t(false, false).get('n')) === 1.25);
Lh_t.apply([{ op: 'drive', id: 'n', key: 'angle', value: 270 }]);
ok('a left-hand nut on a left-hand bolt meshes and runs the other way, staying clear', !interference(Lh_t).length && near(Lh_t.result.bodies.find(x => x.id === 'n').solid.bbox().min[2] - lhz0_t, 0.9375, 1e-3));
ok('a right-hand nut on a left-hand bolt clashes', interference(lhPair_t(true, false)).length === 1);
let noPitch_t = ''; try { const Np = new Model(); Np.apply([{ op: 'add', type: 'box', id: 'a', params: { width: 20, depth: 20, height: 5 } }, { op: 'add', type: 'cylinder', id: 'c', params: { diameter: 8, height: 10 } }, { op: 'joint', id: 'c', joint: 'screw' }]); } catch (e) { noPitch_t = e.message; }
ok('a screw joint with no thread to read asks for a pitch', /needs a pitch/.test(noPitch_t), noPitch_t);
/* splines keep their shape when the sketch's dimensions move their ends */
const Sp_t = new Model();
Sp_t.apply([{ op: 'extrude', id: 'g', profile: [[0, 0], [40, 0], [40, 10], [0, 30]], splines: [{ i: 2, pts: [[25, 12], [12, 22]] }], length: 5, fixed: true, constraints: [{ type: 'fix', i: 0, at: [0, 0] }, { type: 'h', i: 0 }, { type: 'v', i: 1 }, { type: 'v', i: 3 }] }]);
Sp_t.apply([{ op: 'constrain', id: 'g', type: 'length', i: 0, value: 80 }]);
const spP_t = Sp_t.get('g').params, spF_t = spP_t.splines[0].pts;
/* the chord (40,10)→(0,30) becomes (80,10)→(0,30): k = (-80+20i)/(-40+20i) = 1.8+0.4i, so (25,12) → (80,10) + k·(-15,2) = (52.2, 7.6) */
ok('when a dimension moves the spline\'s ends, its fit points go with them (same shape on the new chord)', near(spP_t.profile[2][0], 80) && near(spF_t[0][0], 52.2) && near(spF_t[0][1], 7.6) && near(spF_t[1][0], 24.8) && near(spF_t[1][1], 20.4), spF_t);
ok('…by the similarity of its chord (turn and scale too)', JSON.stringify(carrySplines([[0, 0], [10, 0]], [[0, 0], [0, 20]], [{ i: 0, pts: [[5, 2]] }], true)[0].pts) === JSON.stringify([[-4, 10]]));
let splCon_t = ''; try { Sp_t.apply([{ op: 'constrain', id: 'g', type: 'h', i: 2 }]); } catch (e) { splCon_t = e.message; }
ok('straight-line constraints are refused on a spline segment, with the reason', /is a spline/.test(splCon_t), splCon_t);
/* a sweep along a path (not a helix) builds, with start / end connectors on the path's ends */
const Sw_t = new Model(); Sw_t.apply([{ op: 'sweep', id: 'pipe', profile: [[-3, -3], [3, -3], [3, 3], [-3, 3]], path: [[0, 0, 0], [0, 0, 40], [40, 0, 40]], fixed: true }]);
const swEnd_t = worldConnectors(Sw_t.result, 'pipe').find(c => c.name === 'end');
ok('a sweep along a path builds and has an end connector square to its last leg', !Sw_t.result.errors.size && Sw_t.result.bodies.length === 1 && swEnd_t && near(swEnd_t.o[0], 40) && near(swEnd_t.n[0], 1), { errors: [...Sw_t.result.errors.values()] });
/* placement formulas: a mate's offset / slide follow sizes and variables; re-mating keeps the joint */
const Mf_t = new Model();
Mf_t.apply([{ op: 'var', name: 'gap', value: 3 }, { op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 40, height: 5 } },
  { op: 'add', type: 'box', id: 'lid', params: { width: 20, depth: 20, height: 4 }, mate: { to: 'plate', a: 'top', b: 'bottom', offset: '=#gap', slide: ['=plate.width / 2 - 10', 0], joint: 'revolute', limits: { angle: [0, 90] } } }]);
const lidAt_t = () => worldConnectors(Mf_t.result, 'lid').find(c => c.name === 'bottom').o;
ok('a mate offset and slide can be formulas', near(lidAt_t()[0], 50) && near(lidAt_t()[2], 8), lidAt_t());
Mf_t.apply([{ op: 'set', id: 'plate', params: { width: 200 } }, { op: 'var', name: 'gap', value: 6 }]);
ok('…and the part follows when the sizes change', near(lidAt_t()[0], 90) && near(lidAt_t()[2], 11), lidAt_t());
ok('a joint can be given with the mate', Mf_t.get('lid').mate.joint === 'revolute' && Mf_t.get('lid').mate.limits.angle[1] === 90);
Mf_t.apply([{ op: 'mate', id: 'lid', to: 'plate', a: 'top', b: 'bottom', offset: '=#gap', slide: ['=plate.width / 2 - 10', 5] }]);
ok('re-mating (e.g. a new slide) keeps the joint and its limits', Mf_t.get('lid').mate.joint === 'revolute' && Mf_t.get('lid').mate.limits.angle[1] === 90 && near(lidAt_t()[1], 5));
Mf_t.apply([{ op: 'unlink', id: 'lid', param: 'mate.offset' }, { op: 'var', name: 'gap', value: 1 }]);
ok('unlinking a mate formula keeps its value', near(lidAt_t()[2], 11) && !('offset' in (Mf_t.get('lid').mexpr || {})) && Mf_t.describe().objects.find(o => o.id === 'lid').mate_formulas['slide.0'] === '=plate.width / 2 - 10');
let badMf_t = ''; try { Mf_t.apply([{ op: 'mate', id: 'lid', to: 'plate', a: 'top', b: 'bottom', offset: '=2 +' }]); } catch (e) { badMf_t = e.message; }
ok('a broken mate formula is refused, saying why', /ends too early/.test(badMf_t), badMf_t);
/* lofts through sections, guide curves, smooth / twisted / scaled sweeps */
const sq_t = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
const Lf_t = new Model(); Lf_t.apply([{ op: 'loft', id: 'l', profile: sq_t, length: 40, sections: [{ z: 20, scale: 2 }], smooth: false, fixed: true }]);
/* ruled: two frusta 20 tall, from a 20 square to a 40 square and back: V = h/3 (A1 + A2 + √(A1 A2)) each */
const frus_t = 20 / 3 * (400 + 1600 + 800);
ok('a ruled loft through a middle section is two frusta', near(Lf_t.result.bodies[0].solid.volume(), 2 * frus_t, 1e-6), Lf_t.result.bodies[0].solid.volume());
Lf_t.apply([{ op: 'set', id: 'l', params: { smooth: true } }]);
const lfB_t = Lf_t.result.bodies[0].solid.bbox();
ok('…smooth, it bulges through the section without overshooting it', near(lfB_t.max[0], 20, 1e-6) && Lf_t.result.bodies[0].solid.volume() > 2 * frus_t, { x: lfB_t.max[0], v: Lf_t.result.bodies[0].solid.volume() });
const circ_t = [...Array(32)].map((_, i) => [10 * Math.cos(i * Math.PI / 16), 10 * Math.sin(i * Math.PI / 16)]);
const Gd_t = new Model(); Gd_t.apply([{ op: 'loft', id: 'v', profile: circ_t, length: 60, guides: [[[10, 0, 0], [18, 0, 30], [10, 0, 60]], [[-10, 0, 0], [-18, 0, 30], [-10, 0, 60]]], fixed: true }]);
const gdB_t = Gd_t.result.bodies[0].solid.bbox();
ok('two guides scale the sections between them (a barrel 36 across)', near(gdB_t.max[0], 18, 1e-3) && near(gdB_t.max[1], 18, 2e-2) && near(gdB_t.max[2], 60), gdB_t);
const Gd1_t = new Model(); Gd1_t.apply([{ op: 'loft', id: 'v', profile: circ_t, length: 60, guides: [[[10, 0, 0], [25, 0, 30], [10, 0, 60]]], fixed: true }]);
ok('one guide moves the sections along it', near(Gd1_t.result.bodies[0].solid.bbox().max[0], 25, 1e-3) && near(Gd1_t.result.bodies[0].solid.volume(), Math.PI * 100 * 60, 0.02));
let inv_t = ''; try { new Model().apply([{ op: 'loft', id: 'x', profile: sq_t, length: 40, sections: [{ z: 60, scale: 1 }], fixed: true }]); } catch (e) { inv_t = e.message; }
const InvM_t = new Model(); InvM_t.apply([{ op: 'loft', id: 'x', profile: sq_t, length: 40, sections: [{ z: 60, scale: 1 }], fixed: true }]);
ok('a loft section outside the loft is reported', /outside the loft/.test([...InvM_t.result.errors.values()].join(' ') + inv_t));
const Sw2_t = new Model(); Sw2_t.apply([{ op: 'sweep', id: 's', profile: [[-2, -2], [2, -2], [2, 2], [-2, 2]], path: [[0, 0, 0], [0, 0, 50]], twist: 90, scale: 0.5, fixed: true }]);
ok('a sweep that twists and scales to half along a straight path is a frustum (twisting keeps each cross-section\'s area)', near(Sw2_t.result.bodies[0].solid.volume(), 50 / 3 * (16 + 4 + 8), 2e-3), Sw2_t.result.bodies[0].solid.volume());
const Sw3_t = new Model(); Sw3_t.apply([{ op: 'sweep', id: 's', profile: [[-2, -2], [2, -2], [2, 2], [-2, 2]], path: [[0, 0, 0], [0, 0, 30], [30, 0, 30]], smooth: true, fixed: true }]);
const sw3e_t = worldConnectors(Sw3_t.result, 's').find(c => c.name === 'end');
const sp3_t = K0.smoothPath([[0, 0, 0], [0, 0, 30], [30, 0, 30]]); let sp3L_t = 0; for (let i = 1; i < sp3_t.length; i++) sp3L_t += V.len(V.sub(sp3_t[i], sp3_t[i - 1]));
ok('a smooth sweep follows a curve through the path points (volume = area × its length) and ends on the last point', !Sw3_t.result.errors.size && near(sw3e_t.o[0], 30) && near(sw3e_t.o[2], 30) && sp3_t.some(q => near(q[2], 30) && Math.abs(q[0]) < 1e-9) && near(Sw3_t.result.bodies[0].solid.volume(), 16 * sp3L_t, 2e-3), { v: Sw3_t.result.bodies[0].solid.volume(), want: 16 * sp3L_t });
/* sketches and text projected onto any curved surface */
const Dr_t = new Model(); Dr_t.apply([{ op: 'add', type: 'sphere', id: 'ball', params: { diameter: 40 } }]); const drV0_t = Dr_t.result.bodies[0].solid.volume();
const drR_t = Dr_t.apply([{ op: 'wrap', target: 'ball', at: [0, -20, 20], normal: [0, -1, 0], profile: [[-5, -3], [5, -3], [5, 3], [-5, 3]], depth: 1, mode: 'emboss' }])[0];
const drB_t = Dr_t.result.bodies[0].solid.bbox(), drAdd_t = Dr_t.result.bodies[0].solid.volume() - drV0_t;
ok('on a sphere a sketch is projected (not wrapped) and stands 1 mm off the surface', drR_t.projected && Dr_t.get(drR_t.id).type === 'drape' && near(drB_t.min[1], -21, 2e-3) && drAdd_t > 60 * 0.95 && drAdd_t < 60 * 1.25, { y: drB_t.min[1], added: drAdd_t });
Dr_t.apply([{ op: 'set', id: drR_t.id, params: { mode: 'engrave' } }]);
const drE_t = drV0_t - Dr_t.result.bodies[0].solid.volume();
ok('…engraved, it cuts the same patch in (about the same volume)', drE_t > 60 * 0.85 && drE_t < 60 * 1.15 && Dr_t.result.bodies.length === 1, drE_t);
Dr_t.apply([{ op: 'set', id: 'ball', at: [50, 0, 0] }]);
ok('…and moves with its part', near(Dr_t.result.bodies[0].solid.bbox().min[0], 30, 1e-3) && !Dr_t.result.errors.size);
const Dt_t = new Model(); Dt_t.apply([{ op: 'add', type: 'cone', id: 'k', params: { diameter: 40, top: 10, height: 40 } }]); const dtV_t = Dt_t.result.bodies[0].solid.volume();
Dt_t.apply([{ op: 'wrap', target: 'k', at: [0, -12.5, 20], normal: [0, -0.8, 0.6], text: 'UP', size: 6, depth: 0.6, mode: 'engrave' }]);
ok('text engraved onto a cone (projected)', Dt_t.result.bodies[0].solid.volume() < dtV_t - 5 && !Dt_t.result.errors.size, dtV_t - Dt_t.result.bodies[0].solid.volume());
let off_t = ''; try { new Model().apply([{ op: 'add', type: 'sphere', id: 'b', params: { diameter: 20 } }, { op: 'wrap', target: 'b', at: [0, -10, 10], normal: [0, -1, 0], profile: [[-30, -2], [30, -2], [30, 2], [-30, 2]], depth: 1 }]); } catch (e) { off_t = e.message; }
ok('a sketch bigger than the face it is projected onto is refused, saying why', /runs off the surface/.test(off_t), off_t);
/* spline ends: exactly tangent (to a line, an arc, another spline), a corner, or a set angle */
const angAt_t = (pts, at, dir) => { const k = pts.findIndex(p => Math.abs(p[0] - at[0]) < 1e-9 && Math.abs(p[1] - at[1]) < 1e-9), q = dir > 0 ? pts[k + 1] : pts[k - 1]; return Math.atan2(dir > 0 ? q[1] - at[1] : at[1] - q[1], dir > 0 ? q[0] - at[0] : at[0] - q[0]) * 180 / Math.PI; };
const fin_t = [[0, 0], [40, 0], [40, 10], [0, 30]], fine_t = { splineSteps: 2000 };
const tg_t = expandArcs_t(fin_t, [], Object.assign({ splines: [{ i: 2, pts: [[35, 22], [15, 29]], start: 'tangent', end: 'tangent' }] }, fine_t)).pts;
ok('a tangent spline leaves a line along it and arrives along the next one', Math.abs(angAt_t(tg_t, [40, 10], 1) - 90) < 0.1 && Math.abs(angAt_t(tg_t, [0, 30], -1) + 90) < 0.1, [angAt_t(tg_t, [40, 10], 1), angAt_t(tg_t, [0, 30], -1)]);
const au_t = expandArcs_t(fin_t, [], Object.assign({ splines: [{ i: 2, pts: [[39, 20], [15, 29]] }] }, fine_t)).pts, co_t = expandArcs_t(fin_t, [], Object.assign({ splines: [{ i: 2, pts: [[25, 12], [12, 22]] }] }, fine_t)).pts;
ok('auto: tangent when it sets off near the line\'s direction, a corner when it turns away', Math.abs(angAt_t(au_t, [40, 10], 1) - 90) < 0.1 && Math.abs(angAt_t(co_t, [40, 10], 1) - 90) > 30, [angAt_t(au_t, [40, 10], 1), angAt_t(co_t, [40, 10], 1)]);
const an_t = expandArcs_t(fin_t, [], Object.assign({ splines: [{ i: 2, pts: [[25, 22]], start: 135 }] }, fine_t)).pts;
ok('a set angle: it leaves at that direction', Math.abs(angAt_t(an_t, [40, 10], 1) - 135) < 0.1, angAt_t(an_t, [40, 10], 1));
const ss_t = expandArcs_t([[0, 0], [40, 0], [40, 20], [20, 30], [0, 20]], [], Object.assign({ splines: [{ i: 2, pts: [[34, 28]] }, { i: 3, pts: [[8, 27]] }] }, fine_t)).pts;
ok('two splines meeting at a corner share one tangent there (smooth)', Math.abs(angAt_t(ss_t, [20, 30], -1) - angAt_t(ss_t, [20, 30], 1)) < 0.1, [angAt_t(ss_t, [20, 30], -1), angAt_t(ss_t, [20, 30], 1)]);
const ar_t = expandArcs_t([[0, 0], [40, 0], [40, 20], [0, 20]], [{ i: 0, c: [20, 20], ccw: true }], Object.assign({ splines: [{ i: 1, pts: [[45, 12]], start: 'tangent' }] }, fine_t)).pts;
/* the arc round (20, 20) reaches (40, 0) heading at 45° (its chords are 6° steps, so measure against the exact tangent) */
ok('…and a spline after an arc carries on along the arc\'s exact tangent', Math.abs(angAt_t(ar_t, [40, 0], 1) - 45) < 0.1, angAt_t(ar_t, [40, 0], 1));
/* fit-point constraints: pinned points stay, dimensioned coordinates follow their value (or formula) */
const Fp_t = new Model();
Fp_t.apply([{ op: 'var', name: 'rise', value: 24 }, { op: 'extrude', id: 'g', profile: [[0, 0], [40, 0], [40, 10], [0, 30]], splines: [{ i: 2, pts: [[25, 12], [12, 22]] }], length: 5, fixed: true, constraints: [{ type: 'fix', i: 0, at: [0, 0] }, { type: 'h', i: 0 }, { type: 'v', i: 1 }, { type: 'v', i: 3 }] }]);
Fp_t.apply([{ op: 'constrain', id: 'g', type: 'fitfix', i: 2, k: 0 }, { op: 'constrain', id: 'g', type: 'fity', i: 2, k: 1, value: '=#rise + 1' }]);
Fp_t.apply([{ op: 'constrain', id: 'g', type: 'length', i: 0, value: 80 }]);
const fpP_t = Fp_t.get('g').params.splines[0].pts;
ok('a pinned fit point stays put when a dimension moves the spline\'s ends', near(fpP_t[0][0], 25) && near(fpP_t[0][1], 12), fpP_t);
ok('…a dimensioned coordinate follows its formula, the other one moves with the spline', near(fpP_t[1][1], 25) && !near(fpP_t[1][0], 12), fpP_t[1]);
Fp_t.apply([{ op: 'var', name: 'rise', value: 30 }]);
ok('…and follows the variable when it changes', near(Fp_t.get('g').params.splines[0].pts[1][1], 31));
const fpS_t = Fp_t.describe().objects.find(o => o.id === 'g').sketch.spline_fit;
ok('the sketch reports how many fit-point coordinates are held', fpS_t && fpS_t.coordinates === 4 && fpS_t.held === 3 && fpS_t.carried === 1, fpS_t);
let fpBad_t = ''; try { Fp_t.apply([{ op: 'constrain', id: 'g', type: 'fitfix', i: 1, k: 0 }]); } catch (e) { fpBad_t = e.message; }
ok('a fit-point constraint on a segment that is not a spline is refused', /not a spline/.test(fpBad_t), fpBad_t);
/* the bundled pump housing (built over MCP) still rebuilds: constrained flange, threads, wrap, screw joint */
const Ex_t = new Model(); Ex_t.load(exampleDoc('pump-housing'));
const exFl_t = Ex_t.describe().objects.find(o => o.id === 'flange').sketch, exMass_t = massReport(Ex_t.doc, Ex_t.result);
ok('the pump housing example rebuilds with no warnings and a fully defined flange sketch', EXAMPLES.length >= 1 && !Ex_t.result.warnings.length && exFl_t.ok && exFl_t.dof === 0, { warnings: Ex_t.result.warnings, dof: exFl_t.dof });
ok('its parts: housing, cap and four socket screws (597.75 g)', Ex_t.result.bodies.length === 6 && near(exMass_t.total_mass_g, 597.75, 1e-5), exMass_t.total_mass_g);
ok('nothing in it interferes (cap threads on the neck, screws in their counterbores)', interference(Ex_t).length === 0);
const capZ_t = () => Ex_t.result.bodies.find(b => b.id === 'cap').solid.bbox().max[2], cz0_t = capZ_t();
Ex_t.apply([{ op: 'drive', id: 'cap', key: 'angle', value: 360 }]);
ok('one turn of the screw-jointed cap lifts it by the thread pitch (3 mm)', near(capZ_t() - cz0_t, 3, 1e-3), capZ_t() - cz0_t);
ok('…and it stays clear of the neck threads while it turns', interference(Ex_t).length === 0);
let threw = false; try { m.apply([{ op: 'mate', id: 'tip', to: 'base', a: 'nope' }]); } catch (e) { threw = /No connector/.test(e.message); }
ok('bad connector names give a helpful error', threw);
/* sketch anchors: a rectangle sketched on a wedge's slope follows two corners (one on a mirror copy) */
const An = new Model();
An.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 100, height: 6 }, mate: { to: 'origin', a: 'xy', b: 'bottom' } }, { op: 'add', type: 'wedge', id: 'w1', params: { width: 120, depth: 6, height: 25 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [0, 47] } }, { op: 'pattern', id: 'mir', of: 'w1', kind: 'mirror', plane: 'xz' }]);
An.apply([{ op: 'extrude', id: 'deck', shape: 'rect', x: 0, y: 0, width: 50, height: 30, length: 6, mate: { to: 'w1', a: 'slope', b: 'start', flip: true, slide: [-20, 10] }, anchors: [{ obj: 'w1', conn: 'corner+x+y-z' }, { obj: 'w1@mir.1', conn: 'corner-x+y+z' }] }]);
const dk = () => An.get('deck').params, dbb = () => An.result.bodies.find(b => b.id === 'deck').solid.bbox();
ok('a rectangle anchored to two corners spans them: across both wedges, the full slope', Math.abs(dk().width - 100) < 1e-6 && Math.abs(dk().height - Math.hypot(120, 25)) < 1e-5 && Math.abs(dbb().min[1] + 50) < 1e-6 && Math.abs(dbb().max[1] - 50) < 1e-6, [dk().width, dk().height]);
An.apply([{ op: 'set', id: 'w1', params: { width: 90, height: 40 } }]);
ok('…and follows them when the wedge changes', Math.abs(dk().height - Math.hypot(90, 40)) < 1e-5 && Math.abs(dbb().min[0] + 45) < 1e-6, dk().height);
An.apply([{ op: 'mate', id: 'w1', to: 'plate', a: 'top', b: 'bottom', slide: [0, 60] }]);
ok('…and when the wedges move apart (the mirror copy follows too)', Math.abs(dk().width - 126) < 1e-6, dk().width);
An.undo();
ok('…undo puts it back', Math.abs(dk().width - 100) < 1e-6);
An.apply([{ op: 'delete', id: 'mir' }]);
ok('a corner that is gone: it stays where it is and says so', An.result.warnings.some(w => w.kind === 'anchor' && /is gone/.test(w.text)) && Math.abs(dk().width - 100) < 1e-6);
An.undo(); An.apply([{ op: 'set', id: 'deck', anchors: null }, { op: 'set', id: 'w1', params: { width: 120 } }]);
ok('…and with no anchors it keeps its own size', Math.abs(dk().height - Math.hypot(90, 40)) < 1e-5 && !An.get('deck').anchors);
/* a size the user types is theirs: the anchors stop driving it, and still place it (from the first anchor) */
An.apply([{ op: 'set', id: 'deck', anchors: [{ obj: 'w1', conn: 'corner+x+y-z' }, { obj: 'w1@mir.1', conn: 'corner-x+y+z' }] }]);
const slopeLen = () => Math.hypot(An.get('w1').params.width, An.get('w1').params.height);
ok('anchored again: it spans the slope', Math.abs(dk().height - slopeLen()) < 1e-5, [dk().height, slopeLen()]);
An.apply([{ op: 'set', id: 'deck', params: { height: 80 } }]);
const lowEnd = () => An.result.bodies.find(b => b.id === 'deck').solid.bbox().max[0];
ok('typing a height makes it yours: it stays 80', Math.abs(dk().height - 80) < 1e-9 && JSON.stringify(An.get('deck').held) === '["height"]', An.get('deck').held);
ok('…it still starts at the first corner (the thin end) and still spans across both wedges', Math.abs(lowEnd() - (An.get('w1').params.width / 2 + 6 * Math.sin(Math.atan2(An.get('w1').params.height, An.get('w1').params.width)))) < 0.05 && Math.abs(dk().width - 100) < 1e-6, [lowEnd(), dk().width]);
An.apply([{ op: 'set', id: 'w1', params: { width: 150 } }]);
ok('…the wedge changes: the height stays yours, the width still follows', Math.abs(dk().height - 80) < 1e-9 && Math.abs(dk().width - 100) < 1e-6);
An.apply([{ op: 'set', id: 'deck', held: null }]);
ok('let the corners set it again', Math.abs(dk().height - slopeLen()) < 1e-5 && !An.get('deck').held, dk().height);
/* a driving dimension on an anchored part places it; its size still follows */
const Dd = new Model();
Dd.apply([{ op: 'add', type: 'box', id: 'base', params: { width: 200, depth: 100, height: 10 }, mate: { to: 'origin', a: 'xy', b: 'bottom' } }, { op: 'add', type: 'box', id: 'p1', params: { width: 10, depth: 10, height: 10 }, mate: { to: 'base', a: 'top', b: 'bottom', slide: [-50, 0] } }, { op: 'add', type: 'box', id: 'p2', params: { width: 10, depth: 10, height: 10 }, mate: { to: 'base', a: 'top', b: 'bottom', slide: [50, 20] } }]);
Dd.apply([{ op: 'extrude', id: 'pad', shape: 'rect', x: 0, y: 0, width: 20, height: 20, length: 2, mate: { to: 'base', a: 'top', b: 'start', flip: true }, anchors: [{ obj: 'p1', conn: 'corner-x-y-z' }, { obj: 'p2', conn: 'corner+x+y-z' }] }]);
ok('a rectangle between two blocks spans their outer corners', Math.abs(Dd.get('pad').params.width - 110) < 1e-6 && Math.abs(Dd.get('pad').params.height - 30) < 1e-6, [Dd.get('pad').params.width, Dd.get('pad').params.height]);
const [pd] = Dd.apply([{ op: 'dim', a: { obj: 'base', conn: 'left' }, b: { obj: 'pad', conn: 'start' }, view: 'top' }]);
Dd.apply([{ op: 'setdim', id: pd.id, value: 130 }]);
const padX = () => { const bb = Dd.result.bodies.find(b => b.id === 'pad').solid.bbox(); return (bb.min[0] + bb.max[0]) / 2; };
ok('a driving dimension on it places it (130 from the left edge); its size still follows the corners', Math.abs(padX() - 30) < 1e-4 && (Dd.get('pad').held || []).includes('place') && Math.abs(Dd.get('pad').params.width - 110) < 1e-6, [padX(), Dd.get('pad').held]);
Dd.apply([{ op: 'mate', id: 'p2', to: 'base', a: 'top', b: 'bottom', slide: [70, 20] }]);
ok('…the corners move: it resizes, the dimension still holds its place', Math.abs(Dd.get('pad').params.width - 130) < 1e-6 && Math.abs(padX() - 30) < 1e-4, [Dd.get('pad').params.width, padX()]);
Dd.apply([{ op: 'setdim', id: pd.id, value: null }]);
ok('…the dimension made a reference again: the corners place it again', !(Dd.get('pad').held || []).includes('place') && Math.abs(padX() - 10) < 1e-4, padX());

/* outline / circle / slot and a sketch placed by coordinates */
const Cs = new Model();
Cs.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 100, depth: 60, height: 10 }, mate: { to: 'origin', a: 'xy', b: 'bottom' } }, { op: 'add', type: 'cylinder', id: 'peg', params: { diameter: 8, height: 15 }, mate: { to: 'b', a: 'top', b: 'bottom', slide: [20, 10] } }, { op: 'add', type: 'box', id: 'k', params: { width: 6, depth: 6, height: 6 }, mate: { to: 'b', a: 'top', b: 'bottom', slide: [-30, -15] } }]);
Cs.apply([{ op: 'extrude', id: 'ring', shape: 'circle', x: 0, y: 0, diameter: 10, length: 1, mate: { to: 'b', a: 'top', b: 'start', flip: true }, anchors: [{ role: 'centre', obj: 'peg', conn: 'bottom' }, { role: 'rim', obj: 'k', conn: 'corner+x+y-z' }] }]);
const ringC = () => { const bb = Cs.result.bodies.find(x => x.id === 'ring').solid.bbox(); return [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2]; };
ok('a circle centred on a connector, its rim through another', Math.abs(ringC()[0] - 20) < 0.05 && Math.abs(ringC()[1] - 10) < 0.05 && Math.abs(Cs.get('ring').params.diameter - 2 * Math.hypot(47, 22)) < 1e-4, [ringC(), Cs.get('ring').params.diameter]);
Cs.apply([{ op: 'mate', id: 'peg', to: 'b', a: 'top', b: 'bottom', slide: [0, 0] }]);
ok('…it moves and resizes with them', Math.abs(ringC()[0]) < 0.05 && Math.abs(Cs.get('ring').params.diameter - 2 * Math.hypot(27, 12)) < 1e-4, Cs.get('ring').params.diameter);
Cs.apply([{ op: 'extrude', id: 'sl', shape: 'slot', x: 0, y: 0, width: 30, height: 6, length: 1, mate: { to: 'b', a: 'top', b: 'start', flip: true }, anchors: [{ role: 'end', obj: 'peg', conn: 'bottom' }, { role: 'end', obj: 'k', conn: 'bottom' }] }]);
ok('a slot between two connectors: its length is their distance plus its width', Math.abs(Cs.get('sl').params.width - (Math.hypot(30, 15) + 6)) < 0.5 || Math.abs(Cs.get('sl').params.width - (30 + 6)) < 1e-6, Cs.get('sl').params.width);
Cs.apply([{ op: 'extrude', id: 'v', shape: 'rect', x: 0, y: 0, width: 5, height: 5, length: 2, at: [0, -40, 0], rot: [90, 0, 0], fixed: true, anchors: [{ obj: 'b', conn: 'corner-x-y-z' }, { obj: 'b', conn: 'corner+x-y+z' }] }]);
const vbb = Cs.result.bodies.find(x => x.id === 'v').solid.bbox();
ok('a sketch placed by coordinates (drawn in a view) follows too', Math.abs(Cs.get('v').params.width - 100) < 1e-6 && Math.abs(Cs.get('v').params.height - 10) < 1e-6 && Math.abs(vbb.min[0] + 50) < 1e-6 && Math.abs(vbb.max[2] - 10) < 1e-6, [Cs.get('v').params.width, Cs.get('v').params.height, vbb.min[0], vbb.max[2]]);
Cs.apply([{ op: 'set', id: 'b', params: { width: 140 } }]);
ok('…and when the part it follows grows', Math.abs(Cs.get('v').params.width - 140) < 1e-6);

/* an outline: the anchored point follows, the rest of the outline stays where it is */
const Ao = new Model();
Ao.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 100, depth: 60, height: 10 }, mate: { to: 'origin', a: 'xy', b: 'bottom' } }, { op: 'add', type: 'box', id: 'post', params: { width: 10, depth: 10, height: 20 }, mate: { to: 'b', a: 'top', b: 'bottom', slide: [30, 0] } }]);
Ao.apply([{ op: 'extrude', id: 'tri', profile: [[-20, -10], [10, -10], [-20, 15]], length: 2, mate: { to: 'b', a: 'top', b: 'start', flip: true, slide: [-20, 0] }, anchors: [{ i: 1, obj: 'post', conn: 'corner-x-y-z' }] }]);
const triW = () => { const M = Ao.result.world.get('tri'); return Ao.get('tri').params.profile.map(q => M4.point(M, [q[0], q[1], 0]).map(v => +v.toFixed(4))); };
const t0 = triW();
ok('an anchored outline point sits on its corner', Math.abs(t0[1][0] - 25) < 1e-6 && Math.abs(t0[1][1] + 5) < 1e-6, t0[1]);
Ao.apply([{ op: 'mate', id: 'post', to: 'b', a: 'top', b: 'bottom', slide: [10, 15] }]);
const t1 = triW();
ok('…moves with it, and the other points stay put', Math.abs(t1[1][0] - 5) < 1e-6 && Math.abs(t1[1][1] - 10) < 1e-6 && JSON.stringify(t1[0]) === JSON.stringify(t0[0]) && JSON.stringify(t1[2]) === JSON.stringify(t0[2]), [t0, t1]);

/* a cut through more than its own part: also [ids], or also:'crossed' — every part it goes through */
const Ac = new Model();
Ac.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 100, height: 6 }, mate: { to: 'origin', a: 'xy', b: 'bottom' } }, { op: 'add', type: 'wedge', id: 'w1', params: { width: 120, depth: 6, height: 25 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [0, 47] } }, { op: 'pattern', id: 'mir', of: 'w1', kind: 'mirror', plane: 'xz' }, { op: 'extrude', id: 'deck', shape: 'rect', x: 0, y: 0, width: 100, height: 103.08, length: 6, mate: { to: 'w1', a: 'slope', b: 'start', flip: true, slide: [-47, 0] } }]);
const av = (id) => Ac.result.bodies.find(b => b.id === id).solid.volume(), dk0 = av('deck'), pl0 = av('plate');
Ac.apply([{ op: 'extrude', id: 'cut', shape: 'circle', x: 0, y: 0, diameter: 20, end: 'through', mate: { to: 'plate', a: 'bottom', b: 'end', flip: false }, into: 'plate', mode: 'subtract' }]);
ok('a through cut cuts its own part only, by default', pl0 - av('plate') > 1800 && Math.abs(dk0 - av('deck')) < 1e-6);
Ac.apply([{ op: 'set', id: 'cut', also: ['deck'] }]);
ok('…also:[deck] cuts the inclined deck it goes through too (an elliptical hole)', dk0 - av('deck') > Math.PI * 100 * 6 && !Ac.result.errors.size, dk0 - av('deck'));
Ac.undo(); Ac.undo();
Ac.apply([{ op: 'extrude', id: 'cut2', shape: 'circle', x: 0, y: 0, diameter: 20, end: 'through', mate: { to: 'plate', a: 'bottom', b: 'end', flip: false }, into: 'plate', mode: 'subtract', also: 'crossed' }]);
ok("…also:'crossed' finds the parts it goes through when it is made (not the wedges it misses)", JSON.stringify(Ac.get('cut2').also) === '["deck"]' && dk0 - av('deck') > Math.PI * 100 * 6, Ac.get('cut2').also);
Ac.apply([{ op: 'set', id: 'w1', params: { height: 35 } }]);
ok('…and still cuts it when the deck moves', dk0 - av('deck') > Math.PI * 100 * 6 && Math.abs(av('deck') - dk0) > 1);
Ac.apply([{ op: 'separate', id: 'cut2' }]);
ok('separating the cut stops it cutting either', !Ac.get('cut2').also && Math.abs(av('plate') - pl0) < 1e-6);

/* a size that extends to another part: a bar's height up to the inclined deck above it, keeping its box shape */
const Ut = new Model();
Ut.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 100, height: 6 }, mate: { to: 'origin', a: 'xy', b: 'bottom' } }, { op: 'add', type: 'wedge', id: 'w1', params: { width: 120, depth: 6, height: 25 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [0, 47] } }, { op: 'pattern', id: 'mir', of: 'w1', kind: 'mirror', plane: 'xz' },
  { op: 'extrude', id: 'deck', shape: 'rect', x: 0, y: 0, width: 100, height: Math.hypot(120, 25), length: 6, mate: { to: 'w1', a: 'slope', b: 'start', flip: true, slide: [-47, 0] } }, { op: 'add', type: 'box', id: 'bar', params: { width: 6, depth: 80, height: 10 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-54, 0] } }]);
const under = (x) => 6 + Ut.get('w1').params.height * (60 - x) / 120, barTop = () => Ut.result.bodies.find(b => b.id === 'bar').solid.bbox().max[2];
Ut.apply([{ op: 'set', id: 'bar', upTo: { param: 'height', obj: 'deck' } }]);
ok('a bar extended to the inclined deck: its flat top just meets the deck where it is lowest over it', Math.abs(barTop() - under(-51)) < 2e-3 && Ut.result.bodies.find(b => b.id === 'bar').solid.polys.every(q => Math.abs(q.plane.n[2]) < 1e-9 || Math.abs(Math.abs(q.plane.n[2]) - 1) < 1e-9), [barTop(), under(-51)]);
ok('…and it does not go into the deck', interference(Ut).filter(c => c.volume > 0.01).length === 0);
Ut.apply([{ op: 'set', id: 'w1', params: { height: 35 } }]);
ok('…the deck rises: the bar follows', Math.abs(barTop() - under(-51)) < 2e-3, [barTop(), under(-51)]);
Ut.apply([{ op: 'set', id: 'bar', upTo: { param: 'height', obj: 'deck', mode: 'centre', gap: 0.5 } }]);
ok('…centre mode with a 0.5 gap: its middle is 0.5 under the deck', Math.abs(barTop() - (under(-54) - 0.5)) < 2e-3, [barTop(), under(-54) - 0.5]);
Ut.apply([{ op: 'set', id: 'bar', params: { height: 12 } }]);
ok('…a height typed over it is yours: it no longer extends', Ut.get('bar').params.height === 12 && !Ut.get('bar').upTo);
let upErr = ''; try { Ut.apply([{ op: 'set', id: 'bar', upTo: { param: 'width', obj: 'deck' } }]); } catch (e) { upErr = e.message; }
ok('…a size that cannot extend says which can', /height/.test(upErr), upErr);

/* model coordinates stay the board's when the first part is placed by coordinates (an extrude's bottom is mid start face) */
const Or = new Model(); Or.apply([{ op: 'extrude', id: 'l', profile: [[0, 0], [100, 0], [100, 10], [0, 10]], length: 20, at: [0, 0, 0], rot: [90, 0, 0], fixed: true }], 'L', { relative: true });
Or.apply([{ op: 'add', type: 'box', id: 'k', params: { width: 10, depth: 10, height: 10 }, at: [50, 0, 10], fixed: true }], 'K', { relative: true });
ok('a part placed by coordinates keeps the board origin: the next op lands where it was asked', JSON.stringify(Or.result.originPoint) === '[0,0,0]' && Math.abs(Or.result.bodies.find(b => b.id === 'k').solid.bbox().min[2] - 10) < 1e-9, Or.result.originPoint);
const Om = new Model(); Om.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 40, depth: 40, height: 10 }, mate: { to: 'origin', a: 'xy', b: 'bottom' } }]);
ok('…a part mated to the origin is still the origin reference (its bottom)', Om.result.originRef && Om.result.originRef.obj === 'p' && Om.result.originRef.conn === 'bottom', Om.result.originRef);
console.log(`\n${pass} passed, ${fail} failed · eval ${m.result.ms.toFixed(1)} ms for ${m.doc.objects.length} objects`);
process.exit(fail ? 1 : 0);
