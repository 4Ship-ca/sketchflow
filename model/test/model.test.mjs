/* SketchFlow v2 model tests: node model/test/model.test.mjs */
import { Model, worldConnectors, massReport, bom, weldAdvice, measureDim } from '../js/model.js';
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
let threw = false; try { m.apply([{ op: 'mate', id: 'tip', to: 'base', a: 'nope' }]); } catch (e) { threw = /No connector/.test(e.message); }
ok('bad connector names give a helpful error', threw);
console.log(`\n${pass} passed, ${fail} failed · eval ${m.result.ms.toFixed(1)} ms for ${m.doc.objects.length} objects`);
process.exit(fail ? 1 : 0);
