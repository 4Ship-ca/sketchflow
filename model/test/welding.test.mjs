/* the welding & joining add-on: joint detection, advice by duty and material, access, building the joint, symbols and
   drawings — node model/test/welding.test.mjs */
import { Model, registerAddon, massReport } from '../js/model.js';
import welding from '../addons/welding.js';
import { interference } from '../js/collide.js';
import { weldSymbol, weldSymbolText, weldSymbolBlockSVG, jointSectionSVG } from '../js/weldsymbol.js';
import { drawingSVG, drawingDXF } from '../js/drawing.js';
import { exampleDoc } from '../js/examples.js';
registerAddon(welding);
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const run = (m, action, args) => m.apply([{ op: 'addon', addon: 'welding', action, args }])[0];
const query = (m, action, args) => welding.actions[action].run(args, m.addonContext()).info;
const vol = (m, id) => { const b = m.result.bodies.find(x => x.id === id); return b ? b.solid.volume() : 0; };

/* the parts */
const tee = (mat = 'steel', extra = []) => { const m = new Model(); m.apply([{ op: 'add', type: 'box', id: 'plate', name: 'Base plate', params: { width: 200, depth: 120, height: 12 }, mate: { to: 'origin', a: 'xy', b: 'bottom' }, material: mat }, { op: 'add', type: 'box', id: 'web', name: 'Web', params: { width: 10, depth: 120, height: 80 }, mate: { to: 'plate', a: 'top', b: 'bottom' }, material: mat }, ...extra]); return m; };
const butt = (t = 16, mat = 'steel') => { const m = new Model(); m.apply([{ op: 'add', type: 'box', id: 'p1', name: 'Left plate', params: { width: 100, depth: 150, height: t }, material: mat, fixed: true }, { op: 'add', type: 'box', id: 'p2', name: 'Right plate', params: { width: 100, depth: 150, height: t }, mate: { to: 'p1', a: 'right', b: 'left' }, material: mat }]); return m; };
const lap = (ma, mb, t = 6) => { const m = new Model(); m.apply([{ op: 'add', type: 'box', id: 'l1', params: { width: 100, depth: 80, height: t }, material: ma }, { op: 'add', type: 'box', id: 'l2', params: { width: 100, depth: 80, height: t }, mate: { to: 'l1', a: 'top', b: 'bottom', slide: [70, 0] }, material: mb }]); return m; };
const corner = () => { const m = new Model(); m.apply([{ op: 'add', type: 'box', id: 'c1', params: { width: 100, depth: 100, height: 8 }, material: 'stainless' }, { op: 'add', type: 'box', id: 'c2', params: { width: 8, depth: 100, height: 60 }, mate: { to: 'c1', a: 'top', b: 'bottom', slide: [46, 0] }, material: 'stainless' }]); return m; };

/* ---------- the joint ---------- */
const jt = query(tee(), 'analyze', { a: 'plate', b: 'web' });
ok('a stem standing on a plate is a tee: stem and base thicknesses, seam length', jt.joint === 'tee' && jt.thickness_mm.stem === 10 && jt.thickness_mm.base === 12 && jt.length_mm === 120, jt);
ok('…both sides are open inside corners, welded horizontal-vertical (PB)', jt.sides.length === 2 && jt.sides.every(s => s.kind === 'inside corner' && s.access === 'open' && /^PB/.test(s.position)), jt.sides);
const jb = query(butt(), 'analyze', { a: 'p1', b: 'p2' });
ok('two plates end to end are a butt joint, thickness 16 each', jb.joint === 'butt' && jb.thickness_mm.a === 16 && jb.thickness_mm.b === 16 && jb.length_mm === 150, jb);
ok('…its top is flat (PA), its underside overhead (PE)', jb.sides.map(s => s.position.slice(0, 2)).sort().join() === 'PA,PE', jb.sides);
ok('overlapping plates are a lap joint', query(lap('steel', 'steel'), 'analyze', { a: 'l1', b: 'l2' }).joint === 'lap');
const jc = query(corner(), 'analyze', { a: 'c1', b: 'c2' });
ok('a stem flush with the plate edge is a corner joint (one inside, one flush side)', jc.joint === 'corner' && jc.sides.some(s => s.kind === 'inside corner') && jc.sides.some(s => s.kind === 'flush / open'), jc.sides);
let err = ''; try { const m = new Model(); m.apply([{ op: 'add', type: 'box', id: 'a', params: { width: 10, depth: 10, height: 10 } }, { op: 'add', type: 'box', id: 'b', params: { width: 10, depth: 10, height: 10 }, at: [100, 0, 0], fixed: true }]); query(m, 'analyze', { a: 'a', b: 'b' }); } catch (e) { err = e.message; }
ok('parts that do not touch are reported, with what to do', /do not touch/.test(err) && /mate them/.test(err), err);

/* ---------- advice by duty ---------- */
const at = query(tee(), 'advise', { a: 'plate', b: 'web' }), L = at.options.light, R = at.options.regular, H = at.options.heavy;
ok('tee, light: one fillet, at least the minimum throat for a 12 mm part (a4), ISO 5817-D, visual', /single fillet a4/.test(L.weld) && L.quality === 'ISO 5817-D' && L.inspection === 'VT', L.weld);
ok('tee, regular: fillets both sides ≈ 0.5 t (a5), ISO 5817-C', /double fillet a5/.test(R.weld) && R.quality === 'ISO 5817-C', R.weld);
ok('tee, heavy: full-penetration double bevel (K) with a root gap, ISO 5817-B, 100 % UT', /K/.test(H.weld) && H.full_penetration && H.gap_mm === 2 && H.quality === 'ISO 5817-B' && /100 % UT/.test(H.inspection), H.weld);
ok('time and cost rise with the duty', L.time_min.total < R.time_min.total && R.time_min.total < H.time_min.total && L.cost.total < R.cost.total && R.cost.total < H.cost.total, [L.time_min.total, R.time_min.total, H.time_min.total]);
ok('the heavy one needs preparation time, the light one none', H.time_min.prep > 0 && L.time_min.prep === 0);
ok('…and it is harder to make', H.ease < L.ease, [L.ease, H.ease]);
ok('each suggestion says why, the steps, and its ISO 2553 symbol', [L, R, H].every(o => o.why.length && o.steps.length && o.symbol && o.symbol.tail && o.iso.includes('<')), H.iso);
ok('the labour rate scales the cost', query(tee(), 'advise', { a: 'plate', b: 'web', labor_rate: 120 }).options.regular.cost.labour > R.cost.labour * 1.9);
const ab = query(butt(), 'advise', { a: 'p1', b: 'p2' });
ok('butt 16 mm: light partial-penetration Y, regular single V + sealing run, heavy X ground flush', /partial/.test(ab.options.light.weld) && ab.options.light.symbol.sym === 'Y' && /single-V/.test(ab.options.regular.weld) && ab.options.regular.symbol.seal && /X/.test(ab.options.heavy.weld) && ab.options.heavy.symbol.finish === 'G', [ab.options.light.weld, ab.options.regular.weld, ab.options.heavy.weld]);
ok('…the main run is welded flat (PA), the back overhead is named separately', ab.options.regular.position.code === 'PA' && ab.options.regular.position.worst === 'PE', ab.options.regular.position);
ok('…the V is 60° with a 1.5 mm root face and 2 mm gap (ISO 9692-1)', /60° V/.test(ab.options.regular.prep.text) && ab.options.regular.prep.rootFace === 1.5 && ab.options.regular.gap_mm === 2, ab.options.regular.prep.text);
const thin = query(butt(3), 'advise', { a: 'p1', b: 'p2' });
ok('thin sheet (3 mm) butt: square edges, no bevel', thin.options.regular.prep.shape === 'I' && thin.options.light.prep.shape === 'I', thin.options.regular.prep);
const thick = query(butt(40), 'advise', { a: 'p1', b: 'p2' });
ok('40 mm plate, heavy: double U (machined), preheated', /double-U/.test(thick.options.heavy.weld) && thick.options.heavy.prep.machined && thick.options.heavy.time_min.preheat > 0, thick.options.heavy.weld);

/* ---------- materials ---------- */
const al = query(lap('aluminium', 'aluminium'), 'advise', { a: 'l1', b: 'l2' });
ok('aluminium: MIG 131 with 5356 filler, a note on the softened heat-affected zone', al.options.regular.process.code === 131 && /5356/.test(al.options.regular.process.filler) && al.options.regular.notes.some(n => /heat-affected/.test(n)), al.options.regular.process);
const ss = query(tee('stainless'), 'advise', { a: 'plate', b: 'web' });
ok('stainless: TIG for heavy, M12 gas for MAG, pickling and back purge', ss.options.heavy.process.code === 141 && /M12/.test(ss.options.regular.process.gas) && ss.options.regular.steps.some(t => /pickle/.test(t)), [ss.options.regular.process.gas, ss.options.heavy.process.code]);
const mix = query(lap('aluminium', 'steel'), 'advise', { a: 'l1', b: 'l2' });
ok('aluminium to steel cannot be fusion welded: bonded, with why', mix.method === 'bond' && mix.options.regular.method === 'bond' && /cannot be fusion-welded/.test(mix.method_auto.note), mix.method_auto);
ok('…the adhesive and its preparation depend on the duty', mix.options.light.process.filler !== mix.options.heavy.process.filler && /anodize|sol-gel|silane/.test(mix.options.heavy.prep.text), [mix.options.light.process.filler, mix.options.heavy.process.filler]);
const cs = query(lap('steel', 'stainless'), 'advise', { a: 'l1', b: 'l2' });
ok('carbon steel to stainless welds with 309L filler', cs.method === 'weld' && /309/.test(cs.options.regular.process.filler), cs.options.regular.process.filler);
const cf = query(tee('carbon_fibre'), 'advise', { a: 'plate', b: 'web' });
ok('carbon fibre: filler fillet and tabbing, plies growing with the duty', cf.method === 'tab' && /tabbed/.test(cf.options.regular.weld) && cf.options.light.symbol.size !== cf.options.heavy.symbol.size, [cf.options.light.weld, cf.options.heavy.weld]);
ok('copper alloys braze', query(lap('brass', 'copper'), 'advise', { a: 'l1', b: 'l2' }).method === 'braze');
ok('plastics bond', query(lap('abs', 'abs', 4), 'advise', { a: 'l1', b: 'l2' }).method === 'bond');
const none = new Model(); none.apply([{ op: 'add', type: 'box', id: 'a', params: { width: 100, depth: 50, height: 8 } }, { op: 'add', type: 'box', id: 'b', params: { width: 8, depth: 50, height: 40 }, mate: { to: 'a', a: 'top', b: 'bottom' } }]);
ok('no material set: steel assumed, and it says so', query(none, 'advise', { a: 'a', b: 'b' }).options.regular.notes.some(n => /assumed/.test(n)));
ok('any method can be asked for: a filled tee', /filled tee/.test(query(tee(), 'advise', { a: 'plate', b: 'web', method: 'filled' }).options.regular.weld));

/* ---------- access ---------- */
const walled = tee('steel', [{ op: 'add', type: 'box', id: 'wall', name: 'Side wall', params: { width: 10, depth: 120, height: 80 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-14, 0] } }]);
const aw = query(walled, 'analyze', { a: 'plate', b: 'web' }), cramped = aw.sides.find(s => s.access !== 'open');
ok('a part 4 mm beside the stem blocks the torch on that side, and is named', cramped && cramped.blocked_by && cramped.blocked_by.includes('Side wall'), aw.sides);
const awr = query(walled, 'advise', { a: 'plate', b: 'web' }).options.regular;
ok('…so regular duty welds the open side only, a heavier single fillet (≈ 0.7 t)', /single fillet a7/.test(awr.weld) && awr.why.some(t => /only one side/.test(t)), awr.weld);
const boxed = tee('steel', [{ op: 'add', type: 'box', id: 'w1', name: 'Wall 1', params: { width: 10, depth: 120, height: 80 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-14, 0] } }, { op: 'add', type: 'box', id: 'w2', name: 'Wall 2', params: { width: 10, depth: 120, height: 80 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [14, 0] } }]);
const ib = query(boxed, 'advise', { a: 'plate', b: 'web' }).options.regular;
ok('with both sides walled in, the wizard says it cannot be welded as built, and what to do', ib.impossible && /weld it before|bond it/.test(ib.why[0]), ib);

/* ---------- building it ---------- */
const mh = tee(), webVol = vol(mh, 'web'), r = run(mh, 'apply', { a: 'plate', b: 'web', duty: 'heavy' });
const tag = r.info.id, ids = mh.doc.objects.map(o => o.id);
ok('building returns the joint id and the suggestion it built', /^W\d+$/.test(tag) && /K/.test(r.info.weld), r.info.weld);
ok('…the stem moved up by the 2 mm root gap (through its mate)', near(mh.get('web').mate.offset, 2, 1e-6) && near(mh.result.bodies.find(b => b.id === 'web').solid.bbox().min[2], 14, 1e-6), mh.get('web').mate);
const rf = 2, d = (10 - rf) / 2, cutArea = 0.5 * d * d * Math.tan(Math.PI / 4) * 2;   /* two 45° bevels, (t − root face) / 2 deep each */
ok('…the bevels are cut out of the stem (volume ≈ 2 × ½ d² tan 45° × length)', near(webVol - vol(mh, 'web'), cutArea * 120, cutArea * 120 * 0.03), [webVol - vol(mh, 'web'), cutArea * 120]);
const beads = mh.doc.objects.filter(o => o.meta && o.meta.joint === tag && !o.into);
ok('…the weld metal is two parts attached to the plate, steel, sized by the joint', beads.length === 2 && beads.every(o => o.mate && o.mate.to === 'plate' && o.meta.material === 'steel'), beads.map(o => o.name));
const metal = beads.reduce((s, o) => s + vol(mh, o.id), 0);
ok('…their volume matches the advice’s weld metal', near(metal / 1000, r.info.weld_metal.volume_cm3, r.info.weld_metal.volume_cm3 * 0.06), [metal / 1000, r.info.weld_metal.volume_cm3]);
const clash = interference(mh).filter(c => c.volume > 1);
ok('…and nothing overlaps (weld metal sits in the groove, the parts stay apart)', !clash.length, clash.map(c => c.names.join('↔') + ' ' + c.volume.toFixed(1)));
const co = mh.callouts().find(c => c.id === tag + 'c');
ok('…with its weld symbol pinned to the plate at the joint', co && co.on === 'plate' && co.symbol.sym === 'bevel' && co.symbol.both && near(co.point[2], 12.35, 0.1), co && co.point);
ok('…mass now includes the weld metal', massReport(mh.doc, mh.result).total_mass_g > massReport(tee().doc, tee().result).total_mass_g);
mh.apply([{ op: 'set', id: 'plate', at: [50, 20, 0] }]);
const moved = mh.result.bodies.find(b => b.id === beads[0].id).solid.bbox().min, co2 = mh.callouts().find(c => c.id === tag + 'c');
ok('move the plate: the weld metal, the cuts and the symbol follow', !interference(mh).filter(c => c.volume > 1).length && near(co2.point[0], co.point[0] + 50, 1e-6) && near(co2.point[1], co.point[1] + 20, 1e-6), moved);
const back = new Model(JSON.parse(JSON.stringify(mh.doc)));
ok('the joint survives saving and loading', back.doc.objects.length === mh.doc.objects.length && back.callouts().length === 1 && near(vol(back, 'web'), vol(mh, 'web'), 1e-6));
mh.undo(); mh.undo();
ok('undo takes the whole joint away in one step', mh.doc.objects.every(o => !ids.slice(2).includes(o.id) || o.id === 'plate' || o.id === 'web') && mh.doc.objects.length === 2 && !mh.get('web').mate.offset, mh.doc.objects.map(o => o.id));
const mb = butt(); run(mb, 'apply', { a: 'p1', b: 'p2', duty: 'regular' });
ok('butt, regular: V cut in both plates, back gouge, gap opened, groove + sealing run, no overlap', mb.doc.objects.filter(o => o.into).length === 4 && mb.doc.objects.some(o => /sealing run/.test(o.name)) && near(mb.get('p2').mate.offset, 2, 1e-6) && !interference(mb).filter(c => c.volume > 1).length, mb.doc.objects.map(o => o.name));
const ml = tee('steel'); ml.apply([{ op: 'set', id: 'plate', params: { depth: 600 } }, { op: 'set', id: 'web', params: { depth: 600 } }]);
const li = query(ml, 'advise', { a: 'plate', b: 'web' }).options.light;
ok('a long light-duty seam is welded intermittently (count × length (pitch))', li.intermittent && /\d+ × \d+ \(\d+\)/.test(li.symbol.length), li.symbol.length);
run(ml, 'apply', { a: 'plate', b: 'web', duty: 'light' });
ok('…built as separate segments', ml.doc.objects.filter(o => o.meta && o.meta.joint && !o.into).length === li.intermittent.n, li.intermittent);
const mix2 = lap('aluminium', 'steel'), mr = run(mix2, 'apply', { a: 'l1', b: 'l2', duty: 'regular' });
const layer = mix2.doc.objects.find(o => /adhesive layer/.test(o.name));
ok('a bonded lap: bond line opened, adhesive layer of contact area × bond line, symbol ADH', layer && near(vol(mix2, layer.id), 30 * 80 * mr.info.gap_mm, 30 * 80 * mr.info.gap_mm * 0.05) && mix2.callouts()[0].symbol.sym === 'adhesive', [layer && vol(mix2, layer.id), mr.info.gap_mm]);
const mc = tee('carbon_fibre'); run(mc, 'apply', { a: 'plate', b: 'web', duty: 'regular' });
ok('a tabbed composite tee: filler fillets and laminate, carbon fibre, no overlap', mc.doc.objects.some(o => /Tabbing/.test(o.name) && o.meta.material === 'carbon_fibre') && mc.doc.objects.some(o => /Filler/.test(o.name)) && !interference(mc).filter(c => c.volume > 1).length);
const md = tee(); run(md, 'apply', { a: 'plate', b: 'web', duty: 'regular' }); md.apply([{ op: 'delete', id: 'plate' }]);
ok('delete the part: its weld symbol goes too', !md.doc.objects.some(o => o.type === 'callout'));

/* a stem notched where it meets the plate touches in two places: two joints, picked by near, each welded only where it touches */
const nm = new Model(); nm.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 200, depth: 60, height: 10 }, mate: { to: 'origin', a: 'xy', b: 'bottom' }, material: 'steel' }, { op: 'extrude', id: 'rib', profile: [[-80, 10], [-20, 10], [-20, 30], [20, 30], [20, 10], [80, 10], [80, 60], [-80, 60]], length: 6, end: 'symmetric', at: [0, 0, 0], rot: [90, 0, 0], fixed: true, material: 'steel' }]);
const nj = query(nm, 'analyze', { a: 'plate', b: 'rib', near: [50, 0, 10] }), nj2 = query(nm, 'analyze', { a: 'plate', b: 'rib', near: [-50, 0, 10] });
ok('a notched stem: each place it touches is its own joint (60 mm each, one more found)', nj.joint === 'tee' && nj.length_mm === 60 && nj.other_contacts === 1 && nj2.length_mm === 60, [nj.length_mm, nj.other_contacts]);
run(nm, 'apply', { a: 'plate', b: 'rib', near: [50, 0, 10], duty: 'regular' });
const nb = nm.doc.objects.filter(o => o.meta && o.meta.joint && !o.into).map(o => nm.result.bodies.find(b => b.id === o.id).solid.bbox());
run(nm, 'apply', { a: 'plate', b: 'rib', near: [-50, 0, 10], duty: 'regular' });
ok('a second joint gets its own tag, parts and symbol (W2)', nm.doc.objects.filter(o => o.meta && o.meta.joint === 'W2' && !o.into).length === 2 && nm.get('W2c') && nm.get('W2c').params.symbol.ref === 'W2' && nm.callouts().length === 2, nm.doc.objects.map(o => o.id));
ok('…and the weld runs along that place only, not across the notch', nb.length === 2 && nb.every(bb => bb.min[0] > 19 && bb.max[0] < 81), nb.map(bb => [bb.min[0].toFixed(1), bb.max[0].toFixed(1)]));

/* ---------- symbols, sections, drawings ---------- */
const fil = weldSymbol({ sym: 'fillet', size: 'a5' }), both = weldSymbol({ sym: 'fillet', both: true, size: 'a5' });
ok('ISO 2553 system A: one-sided symbols get the dashed identification line, double-sided ones do not', fil.lines.some(l => l[4]) && !both.lines.some(l => l[4]));
ok('…size left of the symbol, the tail carries process / quality / NDT', fil.texts.some(t => t.text === 'a5' && t.anchor === 'end') && weldSymbol({ sym: 'V', tail: ['135', 'ISO 5817-C'] }).texts.some(t => t.text === '135 / ISO 5817-C'));
const lf = weldSymbol({ sym: 'bevel', tail: ['141'] }, { left: true });
ok('…drawn to the left when the arrow comes from the right, text still reading left to right', lf.box.x0 < 0 && lf.lines.every(l => l[0] <= 1e-9 && l[2] <= 3) && lf.texts.find(t => t.text === '141').anchor === 'end');
ok('symbol text and SVG', weldSymbolText({ sym: 'fillet', both: true, size: 'a5', tail: ['135'] }) === 'a5 ◺ both sides < 135' && /^<svg[^>]+viewBox/.test(weldSymbolBlockSVG({ sym: 'V', seal: true })));
const tm = tee(), adv = welding.ui.advise(tm.addonContext(), { a: 'plate', b: 'web' }), sec = welding.ui.section(tm.addonContext(), adv, 'heavy');
ok('the wizard’s section: both parts cut as closed outlines, the stem lifted by the gap, cuts and weld metal', sec.parts.length === 2 && sec.parts.every(p => p.loops.length >= 1) && sec.parts.find(p => p.id === 'web').mover && sec.cuts.length === 2 && sec.beads.length === 2 && sec.moved === 2, { cuts: sec.cuts.length, beads: sec.beads.length });
ok('…drawn as SVG with the hatch, the scale bar and the gap', /pattern id="[^"]+h"/.test(jointSectionSVG(sec, { id: 't' })) && /10 mm|20 mm|5 mm/.test(jointSectionSVG(sec)) && /root gap 2 mm/.test(jointSectionSVG(sec)));
ok('the light suggestion builds nothing in the section it does not build in the model', welding.ui.section(tm.addonContext(), adv, 'light').cuts.length === 0);
const dm = tee(); run(dm, 'apply', { a: 'plate', b: 'web', duty: 'regular' });
const svg = drawingSVG(dm, { sheet: 'A3', date: '2026-01-01' }), dxf = drawingDXF(dm, { sheet: 'A3' });
ok('drawings carry the weld symbol and a weld schedule (SVG)', svg.includes('WELD SCHEDULE') && svg.includes('a5') && svg.includes('135 / ISO 5817-C'));
const one = tee(); run(one, 'apply', { a: 'plate', b: 'web', duty: 'light' });
ok('…and in DXF, on a WELDS layer; a one-sided weld has the dashed identification line', /\nWELDS\n/.test(dxf) && dxf.includes('WELD SCHEDULE') && !/WELDS\n6\nHIDDEN/.test(dxf) && /WELDS\n6\nHIDDEN/.test(drawingDXF(one, { sheet: 'A3' })));
ok('…a joint’s metal and prep cuts carry no dimensions of their own on the sheet', !/>122</.test(svg));

/* the bundled crow shelf bracket (built over MCP): it loads clean, two welded joints, nothing overlaps, 16" × 14" outside */
const cb = new Model(exampleDoc('crow-shelf-bracket')), cbb = cb.result.bodies.find(b => b.id === 'bar').solid.bbox();
ok('the crow shelf bracket example loads with no errors or warnings', !cb.result.errors.size && !cb.result.warnings.length, cb.result.warnings.map(w => w.text));
ok('…16" × 14" outside, 1" wide', near(cbb.max[2] - cbb.min[2], 406.4, 1e-6) && near(cbb.max[0] - cbb.min[0], 355.6, 1e-6) && near(cbb.max[1] - cbb.min[1], 25.4, 1e-6));
ok('…two welded joints, each with its symbol, and no overlaps', cb.callouts().length === 2 && new Set(cb.doc.objects.filter(o => o.meta && o.meta.joint).map(o => o.meta.joint)).size === 2 && !interference(cb).filter(c => c.volume > 1).length);
ok('…about 3 kg of steel', near(massReport(cb.doc, cb.result).total_mass_g, 2977, 30), massReport(cb.doc, cb.result).total_mass_g);

/* change the crow to ⅛" plate, then redo the joints: thin-plate advice, weld metal on the new faces, one undo step each */
const th = new Model(exampleDoc('crow-shelf-bracket')); th.apply([{ op: 'set', id: 'crow', params: { length: '=1/8*25.4' } }]);
ok('a size can be typed as a formula: =1/8*25.4 → 3.175', near(th.get('crow').params.length, 3.175, 1e-9));
const r1j = run(th, 'redo', { id: 'W1' }), r1in = r1j.results[r1j.results.length - 1].info;
ok('redo rebuilds the joint for the new thickness, same tag and duty', r1in.id === 'W1' && /double fillet a2/.test(r1in.weld) && r1in.title === 'Regular service', r1in.weld);
ok('…a thin part caps the throat at 0.7 t, and says why', r1in.why.some(w => /thin/.test(w) && /0\.7/.test(w)));
run(th, 'redo', { id: 'W2' });
const tb = th.doc.objects.filter(o => o.meta && o.meta.joint && !o.into).map(o => th.result.bodies.find(b => b.id === o.id).solid.bbox());
ok('…the fillets sit on the ⅛" plate faces, the symbols say a2, nothing overlaps', tb.length === 4 && tb.every(bb => Math.min(Math.abs(bb.min[1]), Math.abs(bb.max[1])) < 1.7) && th.callouts().every(c => c.symbol.size === 'a2') && !interference(th).filter(c => c.volume > 1).length, tb.map(bb => [bb.min[1].toFixed(2), bb.max[1].toFixed(2)]));
th.undo();
ok('…each redo is one undo step', th.callouts().find(c => c.id === 'W2c').symbol.size === 'a3' && th.callouts().find(c => c.id === 'W1c').symbol.size === 'a2');
const tw = query(th, 'advise', { a: 'bar', b: 'crow', near: [180, 0, 400.05] });
ok('advising a seam that is already welded says so (its own weld metal is not in the way)', tw.summary.already_welded && tw.summary.already_welded.includes('W1') && !tw.options.regular.impossible, tw.summary.already_welded);
const tn = new Model(exampleDoc('crow-shelf-bracket')); tn.apply([{ op: 'set', id: 'crow', params: { length: 3.175 } }]); tn.apply(tn.doc.objects.filter(o => (o.meta && o.meta.joint) || o.type === 'callout').map(o => ({ op: 'delete', id: o.id })));
const tq = query(tn, 'advise', { a: 'bar', b: 'crow', near: [180, 0, 400.05] }).options;
ok('heavy duty on a ⅛" stem: fillets both sides with the toes ground, not a K preparation', /double fillet a2/.test(tq.heavy.weld) && tq.heavy.symbol.toes && !tq.heavy.prep.machined && tq.heavy.time_min.prep === 0, tq.heavy.weld);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
