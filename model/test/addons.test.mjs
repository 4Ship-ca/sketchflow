/* Add-on contract tests: node model/test/addons.test.mjs */
import { Model, registerAddon, listAddons, TYPES } from '../js/model.js';
import fasteners from '../addons/examples/fasteners.js';
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

ok('an add-on needs an id', throws(() => registerAddon({}), /needs an id/));
ok('a shape needs build()', throws(() => registerAddon({ id: 'bad', types: { thing: { params: {} } } }), /needs build/));
ok('core shapes cannot be replaced', throws(() => registerAddon({ id: 'bad2', types: { box: { build: () => null } } }), /already exists/));
registerAddon(fasteners);
ok('side-built add-on registers its shapes and actions', TYPES.hex_bolt && TYPES.hex_bolt.addon === 'fasteners' && listAddons().some(a => a.id === 'fasteners' && a.actions.fasten));
const m = new Model();
m.apply([{ op: 'add', type: 'box', id: 'top', params: { width: 60, depth: 40, height: 6 } }, { op: 'add', type: 'box', id: 'bot', params: { width: 60, depth: 40, height: 8 }, mate: { to: 'top', a: 'bottom', b: 'top' } }]);
const [r] = m.apply([{ op: 'addon', addon: 'fasteners', action: 'fasten', args: { on: 'top', grip: 14, size: 'M6', slide: [20, 10] } }]);
const z = (id) => { const b = m.result.bodies.find(x => x.id === id).solid.bbox(); return [+b.min[2].toFixed(2), +b.max[2].toFixed(2)]; };
ok('fasten picks the shortest standard bolt with thread to spare', r.info.length === 30 && r.info.protrusion > 1, r.info);
ok('the stack is in order: washer, head above; washer, nut below the joint', z(r.info.washers[0])[0] === 6 && z(r.info.bolt)[1] > 11 && z(r.info.washers[1])[1] === -8 && z(r.info.nut)[1] === z(r.info.washers[1])[0], { w1: z(r.info.washers[0]), bolt: z(r.info.bolt), w2: z(r.info.washers[1]), nut: z(r.info.nut) });
ok('add-on parts carry metadata into the mass report', m.describe().mass.parts.find(p => p.id === r.info.bolt).mass_g > 5);
m.apply([{ op: 'set', id: r.info.bolt, params: { size: 'M8' } }]);
ok('add-on shapes are parametric (M6 → M8 rebuilds)', m.describe().objects.find(o => o.id === r.info.bolt).info.across_flats === 13);
ok('bad add-on parameters are reported, not crashed on', (() => { try { m.apply([{ op: 'set', id: r.info.nut, params: { size: 'M7' } }]); } catch (e) { return false; } return m.result.warnings.some(w => /size must be one of/.test(w.text)); })(), m.result.warnings.map(w => w.text));
let unknown = ''; try { m.apply([{ op: 'addon', addon: 'fasteners', action: 'nope' }]); } catch (e) { unknown = e.message; }
ok('unknown actions list the available ones', /Try: fasten/.test(unknown), unknown);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
