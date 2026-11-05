/* Interference & collision tests: node model/test/collide.test.mjs */
import { Model, registerAddon, posedDoc, evaluate } from '../js/model.js';
import gears from '../addons/gears.js';
import { interference, collisions, restBaseline } from '../js/collide.js';
import * as K from '../js/kernel.js';
registerAddon(gears);
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const near = (a, b, t) => Math.abs(a - b) <= t * Math.abs(b);
const m = new Model();
m.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 70, height: 10 } },
  { op: 'add', type: 'box', id: 'web', params: { width: 12, depth: 70, height: 60 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-54, 0] } },
  { op: 'add', type: 'cylinder', id: 'boss', params: { diameter: 26, height: 18 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [5, 0] } }]);
m.apply([{ op: 'weld', a: 'plate', b: 'web', near: [-48, 0, 10], size: 6 }]);
ok('touching and welded parts do not count as interference', interference(m).length === 0, interference(m));
m.apply([{ op: 'mate', id: 'boss', to: 'plate', a: 'top', b: 'bottom', slide: [5, 0], offset: -3 }, { op: 'add', type: 'box', id: 'blk', params: { width: 20, depth: 20, height: 20 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-44, 20] } }]);
const r = interference(m), byPair = (a, b) => r.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
ok('a part sunk into another: exact overlap volume', byPair('plate', 'boss') && near(byPair('plate', 'boss').volume, 0.5 * 48 * 13 * 13 * Math.sin(2 * Math.PI / 48) * 3, 1e-3) && byPair('plate', 'boss').exact, r.map(x => [x.names, x.volume]));
ok('a block cutting into the upright: 20 × 20 × 6', byPair('web', 'blk') && near(byPair('web', 'blk').volume, 2400, 1e-6));
const g = new Model();
g.apply([{ op: 'add', type: 'gear', id: 'a', params: { module: 2, teeth: 15, width: 10, style: 'herringbone', helix: 25, bore: 5 } }, { op: 'add', type: 'gear', id: 'b', params: { module: 2, teeth: 30, width: 10, style: 'herringbone', helix: -25, bore: 5 }, mate: { to: 'a', kind: 'gear' } }]);
ok('meshed herringbone gears (big parts, voxel path) are clear', interference(g).length === 0);
g.apply([{ op: 'mate', id: 'b', to: 'a', kind: 'gear', phase: 6 }]);
const clash = interference(g), clashV = interference(g, { maxExact: 0 });
ok('half a tooth out of phase they clash (exact volume; the voxel estimate agrees)', clash.length === 1 && clash[0].exact && clash[0].volume > 1 && clashV.length === 1 && !clashV[0].exact && Math.abs(clashV[0].volume - clash[0].volume) < clash[0].volume * 0.6 + 20, { exact: clash.map(x => x.volume), voxel: clashV.map(x => x.volume) });
/* motion: a door hinged on its corner swings into a wall */
const d = new Model();
d.apply([{ op: 'add', type: 'box', id: 'floor', params: { width: 200, depth: 200, height: 5 } }, { op: 'add', type: 'box', id: 'wall', params: { width: 100, depth: 5, height: 60 }, mate: { to: 'floor', a: 'top', b: 'bottom', slide: [0, 42.5] } },
  { op: 'add', type: 'box', id: 'door', params: { width: 50, depth: 5, height: 50 }, mate: { to: 'floor', a: 'top', b: 'corner-x-y-z', slide: [15, 0] } }, { op: 'joint', id: 'door', joint: 'revolute' }]);
const base = restBaseline(d);
const hitAt = (ang) => { const R2 = evaluate(posedDoc(d.doc, { door: { angle: ang } }), { placementOnly: true }), moving = new Map(); const D = K.M4.mul(R2.world.get('door'), K.M4.inv(d.result.world.get('door'))); moving.set('door', D); return collisions(d, moving, { baseline: base }).length > 0; };
let first = null; for (let a = 0; a <= 120 && first == null; a += 1) if (hitAt(a)) first = a;
const expect = Math.asin(40 / Math.hypot(50, 5)) * 180 / Math.PI - Math.atan2(5, 50) * 180 / Math.PI;
ok('a swinging door first touches the wall where geometry says', first != null && Math.abs(first - expect) <= 1.5, { first, expect: +expect.toFixed(1) });
ok('swinging the other way stays clear', !hitAt(-90) && !hitAt(-150));
ok('a crossing (no corner inside the other) is still caught', hitAt(90));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
