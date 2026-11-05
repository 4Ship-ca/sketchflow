/* STEP export and its vetting: node model/test/step.test.mjs */
import { Model } from '../js/model.js';
import { exportStep, vetStep, readStep, stepToSolids, stepReal, stepString, solidToBrep } from '../js/step.js';
import { exampleDoc } from '../js/examples.js';
import { cosmeticThreads } from '../js/model.js';
const require_plain = (m) => cosmeticThreads(m.doc).doc;
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const DATE = '2026-01-01T00:00:00';

/* the file format */
ok('REALs always have a decimal point and an E exponent', ['0.', '1.', '-12.5', '1.E-07', '25.4'].join() === [stepReal(0), stepReal(1), stepReal(-12.5), stepReal(1e-7), stepReal(25.4)].join(), [stepReal(0), stepReal(1), stepReal(-12.5), stepReal(1e-7), stepReal(25.4)]);
ok("strings double their apostrophes and encode anything outside ASCII", stepString("Bob's Ø6 part") === "'Bob''s \\X2\\00D8\\X0\\6 part'", stepString("Bob's Ø6 part"));

/* a box: exactly the B-rep a CAD system would write */
const Bx = new Model(); Bx.apply([{ op: 'add', type: 'box', id: 'b', params: { width: 40, depth: 30, height: 20 }, color: '#3366cc' }]);
const bx = exportStep(Bx, { date: DATE });
ok('a box is 6 faces, 12 edges, 8 vertices, genus 0, and vets clean', bx.report.ok && bx.report.parts[0].faces === 6 && bx.report.parts[0].edges === 12 && bx.report.parts[0].vertices === 8 && bx.report.parts[0].genus === 0, bx.report.parts[0]);
ok('…its volume and area in the file are exact', near(bx.report.parts[0].volume_mm3, 24000) && near(bx.report.parts[0].area_mm2, 2 * (40 * 30 + 40 * 20 + 30 * 20)));
ok('…the file declares AP214, millimetres and the part colour', /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/.test(bx.text) && /SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(bx.text) && /COLOUR_RGB\('',0\.2,0\.4,0\.8\)/.test(bx.text));
ok('…and the same model always writes the same file', exportStep(Bx, { date: DATE }).text === bx.text);

/* booleans: coplanar faces merge, holes give genus, T-junctions are healed */
const Pl = new Model(); Pl.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 60, depth: 40, height: 10 } }, { op: 'hole', target: 'p', at: [-10, 0, 10], size: 'M8', kind: 'counterbore', dims: false }, { op: 'hole', target: 'p', at: [15, 5, 10], size: 'M5', dims: false }, { op: 'edge', target: 'p', near: [30, -20, 5], style: 'fillet', size: 3 }]);
const pl = exportStep(Pl, { date: DATE });
ok('a plate with two through holes is genus 2 and vets clean', pl.report.ok && pl.report.parts[0].genus === 2, pl.report.parts[0]);
const Lb = new Model(); Lb.apply([{ op: 'add', type: 'box', id: 'p', params: { width: 60, depth: 40, height: 10 } }, { op: 'add', type: 'box', id: 'q', params: { width: 20, depth: 40, height: 30 }, mate: { to: 'p', a: 'top', b: 'bottom', slide: [-20, 0] }, into: 'p', mode: 'union' }]);
const lb = exportStep(Lb, { date: DATE });
ok('an L made by a union is one closed solid of 8 faces (the coplanar pieces merged, the split edges joined)', lb.report.ok && lb.report.parts[0].faces === 8 && lb.report.parts[0].vertices === 12, lb.report.parts[0]);

/* the vetting catches broken files */
const dropFace = bx.text.replace(/#(\d+)=CLOSED_SHELL\('',\((#\d+),/, (m, id, first) => `#${id}=CLOSED_SHELL('',(`);
ok('vetting catches a missing face (an open shell)', !vetStep(dropFace).ok && vetStep(dropFace).errors.some(e => /used 1× forwards and 0× backwards|used 0× forwards and 1× backwards/.test(e)), vetStep(dropFace).errors[0]);
const badRef = bx.text.replace(/VERTEX_POINT\('',#(\d+)\)/, 'VERTEX_POINT(\'\',#999999)');
ok('…a dangling reference', vetStep(badRef).errors.some(e => /does not exist/.test(e)));
const moved = bx.text.replace(/CARTESIAN_POINT\('',\((-?[\d.]+),/, (m, x) => `CARTESIAN_POINT('',(${stepReal(+x + 0.5)},`);
ok('…a vertex moved off its faces', !vetStep(moved).ok, vetStep(moved).errors[0]);
ok('…and a volume that does not match the model', vetStep(bx.text, [{ name: 'Box 1', volume: 25000 }]).errors.some(e => /volume/.test(e)));
ok('…but not a sound file', vetStep(bx.text, [{ name: 'Box 1', volume: 24000 }]).ok && readStep(bx.text).errors.length === 0);

/* round trip: read the file back as solids */
const back = stepToSolids(pl.text)[0].solid, orig = Pl.result.bodies[0].solid;
ok('a STEP file reads back to the same solid (volume, area)', near(back.volume(), orig.volume(), 1e-9) && near(back.area(), orig.area(), 1e-9), { v: back.volume(), want: orig.volume() });
ok('…with no volume between the two either way', orig.subtract(back).volume() < 1e-6 && back.subtract(orig).volume() < 1e-6);
const again = exportStep({ result: { bodies: [{ id: 'x', solid: back }] }, doc: { name: 'rt' }, get: () => null, constructor: Model }, { date: DATE });
ok('…and writing that again gives the same topology', again.report.ok && ['faces', 'edges', 'vertices', 'genus'].every(k => again.report.parts[0][k] === pl.report.parts[0][k]), again.report.parts[0]);
let curved = ''; try { stepToSolids(bx.text.replace("PLANE('',", "CYLINDRICAL_SURFACE('',")); } catch (e) { curved = e.message; }
ok('curved CAD surfaces are refused on import, by name', /CYLINDRICAL_SURFACE/.test(curved), curved);

/* bent geometry: wrapped and projected text come out as closed solids */
const Wr = new Model(); Wr.apply([{ op: 'add', type: 'cylinder', id: 'c', params: { diameter: 40, height: 30 } }, { op: 'wrap', target: 'c', text: 'SKETCH', size: 8, depth: 0.8, mode: 'engrave' }]);
const wr = exportStep(Wr, { date: DATE });
ok('text engraved round a cylinder exports as one closed solid', wr.report.ok, wr.report.errors);
const Sp = new Model(); Sp.apply([{ op: 'add', type: 'sphere', id: 'b', params: { diameter: 40 } }, { op: 'wrap', target: 'b', at: [0, -20, 20], normal: [0, -1, 0], text: 'HI', size: 8, depth: 1 }]);
ok('…and text projected onto a sphere', exportStep(Sp, { date: DATE }).report.ok);

/* an assembly: one product per part, repeated parts placed rather than copied, threads plain or modelled */
const Pu = new Model(); Pu.load(exampleDoc('pump-housing'));
const t0 = Date.now(), pp = exportStep(Pu, { threads: 'plain', date: DATE }), tp = Date.now() - t0;
ok('the pump housing (plain threads) vets clean as an assembly', pp.report.ok && pp.report.assembly && pp.report.parts.length === 3 && pp.report.occurrences === 6 && pp.report.placed_copies === 3, { ok: pp.report.ok, errors: pp.report.errors, parts: pp.report.parts.length, occ: pp.report.occurrences });
ok('…the four screws are one product placed four times', (pp.text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\('\d+','M6 screw/g) || []).length === 4 && (pp.text.match(/PRODUCT\('M6 screw'/g) || []).length === 1);
ok('…the flange is genus 4 (its four through holes), and plain threads keep it small', pp.report.parts.find(p => p.name === 'Base flange').genus === 4 && pp.report.bytes < 8e6 && /plain/.test(pp.report.threads), { kb: pp.report.bytes >> 10, ms: tp });
const pm = exportStep(Pu, { date: DATE });
ok('…with modelled threads it is still closed and matches the model', pm.report.ok && pm.report.parts.length === 3, pm.report.errors);
const bk = stepToSolids(pp.text);
const pBodies_t = new Model(); pBodies_t.load(require_plain(Pu));
ok('…and it reads back as all six parts, each where it was (the placed copies too)', bk.length === 6 && bk.every(x => { const b = pBodies_t.result.bodies.find(y => pBodies_t.get(y.id) ? pBodies_t.get(y.id).name === x.name.replace(/ \(\d+\)$/, '') : true); return b && near(x.solid.volume(), pp.report.parts.find(p => x.name.startsWith(p.name)).volume_mm3, 1e-6); }) && bk.filter(x => /^M6 screw/.test(x.name)).map(x => x.solid.bbox().min[0].toFixed(1) + ',' + x.solid.bbox().min[1].toFixed(1)).sort().join(' ') === '-63.0,-38.0 -63.0,28.0 53.0,-38.0 53.0,28.0', bk.map(x => [x.name, +x.solid.volume().toFixed(3)]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
