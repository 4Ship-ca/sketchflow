/* The MCP op reference (model_reference) stays true: node model/test/reference.test.mjs
 * - every op model_build accepts has a reference entry, and every entry is a real op or part type
 * - every worked example runs against a model that has the ids it mentions */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Model, TYPES, registerAddon } from '../js/model.js';
import gears from '../addons/gears.js';
import { REF, TOPICS, reference } from '../../mcp-reference.mjs';

registerAddon(gears);
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };

/* the op enum of the model_build tool, read from the server source */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
const m = /op: \{ type: 'string', enum: \[([^\]]+)\]/.exec(server);
const OPS = m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]) : [];
ok('the model_build op list was found in server.mjs', OPS.length > 30, OPS.length);
const missing = OPS.filter(op => !REF[op]);
ok('every model_build op has a reference entry', !missing.length, missing);
const unknown = Object.keys(REF).filter(k => !OPS.includes(k) && !TYPES[k]);
ok('every reference entry is an op or a part type', !unknown.length, unknown);
ok('the index lists every op with a one-line summary', Object.keys(REF).every(k => reference().includes(`- ${k}: `)));
ok('topics and ops read in full, with an example', Object.keys(TOPICS).every(t => reference(t).startsWith(t)) && Object.keys(REF).every(k => reference(k).includes('Example (model_build ops)')));

/* a model holding every id the examples refer to */
function fixture() {
  const f = new Model();
  f.apply([
    { op: 'var', name: 'gap', value: 2 },
    { op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 80, height: 10 } },
    { op: 'add', type: 'cylinder', id: 'post', params: { diameter: 20, height: 30 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [30, 0] } },
    { op: 'hole', id: 'hole1', target: 'plate', at: [-40, 20, 10], size: 'M6', dims: false },
    { op: 'add', type: 'cylinder', id: 'bore', params: { diameter: 8, height: 12 }, mate: { to: 'plate', a: 'top', b: 'top', flip: false, offset: 1, slide: [-40, -20] }, into: 'plate', mode: 'subtract' },
    { op: 'add', type: 'box', id: 'bracket', params: { width: 30, depth: 30, height: 30 }, at: [200, 0, 0], fixed: true },
    { op: 'add', type: 'cylinder', id: 'wheel', params: { diameter: 40, height: 8 }, at: [300, 0, 0], fixed: true },
    { op: 'add', type: 'box', id: 'lid', params: { width: 20, depth: 20, height: 4 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-30, 0] } },
    { op: 'joint', id: 'lid', joint: 'revolute' },
    { op: 'edge', id: 'fillet1', target: 'bracket', near: [215, -15, 15], style: 'fillet', size: 2 },
    { op: 'shell', id: 'shell1', target: 'bracket', thickness: 2, open: 'top' },
    { op: 'add', type: 'box', id: 'rib2', params: { width: 4, depth: 30, height: 10 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [50, 0] } },
    { op: 'text', id: 'logo', target: 'plate', at: [0, -25, 10], text: 'HI', height: 6, depth: 0.5 },
    { op: 'extrude', id: 'flange', profile: [[0, 0], [40, 0], [40, 20], [0, 20]], length: 5, at: [0, 200, 0], fixed: true, constraints: [{ type: 'h', i: 0 }, { type: 'v', i: 1 }, { type: 'h', i: 2 }, { type: 'v', i: 3 }, { type: 'fix', i: 0, at: [0, 0] }] },
    { op: 'extrude', id: 'slot', profile: [[0, 0], [30, 0], [30, 12], [0, 12]], arcs: [{ i: 1, c: [30, 6], ccw: true }, { i: 3, c: [0, 6], ccw: true }], length: 4, at: [0, 500, 0], fixed: true },
    { op: 'plane', id: 'mid', target: 'plate', face: 'top', offset: -5 },
    { op: 'add', type: 'box', id: 'box', params: { width: 30, depth: 20, height: 10 }, at: [0, -200, 0], fixed: true },
    { op: 'add', type: 'box', id: 'base', params: { width: 30, depth: 20, height: 10 }, at: [0, -300, 0], fixed: true },
    { op: 'add', type: 'cylinder', id: 'body', params: { diameter: 60, height: 40 }, at: [0, 400, 0], fixed: true },
    { op: 'add', type: 'bolt', id: 'b1', params: { size: 'M6', length: 20 }, at: [-200, 0, 0], fixed: true },
    { op: 'add', type: 'nut', id: 'cap', params: { size: 'M6' }, mate: { to: 'b1', a: 'bottom', b: 'bottom', flip: false, offset: 4 } },
    { op: 'joint', id: 'cap', joint: 'screw' },
    { op: 'add', type: 'box', id: 'slide', params: { width: 10, depth: 10, height: 10 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-50, 30] } },
    { op: 'joint', id: 'slide', joint: 'slider' },
    { op: 'dim', a: { obj: 'post', conn: 'center' }, b: { obj: 'plate', conn: 'left' }, view: 'top' }
  ], 'reference fixture');
  f.doc.dims[f.doc.dims.length - 1].id = 'dim1';
  return f;
}
const failed = [];
for (const [k, [, example]] of Object.entries(REF)) {
  const f = fixture();
  /* shelling the plate needs it without the small features that would be thinner than its walls */
  if (k === 'shell') f.apply([{ op: 'delete', id: 'hole1' }, { op: 'delete', id: 'bore' }, { op: 'delete', id: 'logo' }, { op: 'cleanup' }]);
  try { f.apply(JSON.parse(JSON.stringify(example)), 'example ' + k); if (f.result.errors.size) failed.push([k, [...f.result.errors.values()][0]]); }
  catch (e) { failed.push([k, e.message]); }
}
ok(`all ${Object.keys(REF).length} worked examples run`, !failed.length, failed);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
