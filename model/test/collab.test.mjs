/* shared editing: diffs, merges, conflicts, undo of one's own change — node model/test/collab.test.mjs */
import { Model } from '../js/model.js';
import { docDiff, applyDiff, conflicts, inverse, changedSince, isEmpty, touched, sameDoc } from '../js/collab.js';
import { exampleDoc } from '../js/examples.js';
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const clean = (d) => { const c = JSON.parse(JSON.stringify(d)); delete c.updated; return JSON.stringify(c); };
const snap = (m) => JSON.parse(JSON.stringify(m.doc));

/* a diff reproduces the change exactly, on a real model */
const m = new Model(); m.load(exampleDoc('pump-housing')); const d0 = snap(m);
m.apply([{ op: 'set', id: 'body', params: { diameter: 70 } }, { op: 'add', type: 'box', id: 'tab', params: { width: 10, depth: 10, height: 5 }, mate: { to: 'flange', a: 'end', b: 'bottom', slide: [40, 30] } }, { op: 'delete', id: 'label' }, { op: 'var', name: 'wall', value: 3 }]);
const d1 = snap(m), dd = docDiff(d0, d1);
ok('a diff carries exactly what changed', sameDoc(applyDiff(d0, dd), d1), touched(dd).whole.size);
ok('…and nothing when nothing changed', isEmpty(docDiff(d1, JSON.parse(JSON.stringify(d1)))));
ok('…down to one parameter of one object', JSON.stringify((dd.objects || []).find(c => c.id === 'body').set) === JSON.stringify({ 'params.diameter': 70 }));
m.apply([{ op: 'move', id: 'tab', before: 'body' }]); const d2 = snap(m), dOrder = docDiff(d1, d2);
ok('reordering the features travels as an order', !!dOrder.order && sameDoc(applyDiff(d1, dOrder), d2));

/* two people at once */
const base = new Model(); base.apply([{ op: 'add', type: 'box', id: 'plate', params: { width: 100, depth: 60, height: 8 } }, { op: 'add', type: 'cylinder', id: 'post', params: { diameter: 10, height: 20 }, mate: { to: 'plate', a: 'top', b: 'bottom' } }]);
const B0 = snap(base);
const edit = (ops) => { const x = new Model(JSON.parse(JSON.stringify(B0))); x.apply(ops); return docDiff(B0, snap(x)); };
const alexW = edit([{ op: 'set', id: 'plate', params: { width: 140 } }]), beaD = edit([{ op: 'set', id: 'plate', params: { depth: 80 } }]), beaW = edit([{ op: 'set', id: 'plate', params: { width: 90 } }]);
const afterAlex = applyDiff(B0, alexW);
ok('different sizes of the same part merge', conflicts(beaD, [{ diff: alexW, by: 'Alex' }], afterAlex).length === 0);
const both = applyDiff(afterAlex, beaD), plate = both.objects.find(o => o.id === 'plate');
ok('…and both changes are kept', plate.params.width === 140 && plate.params.depth === 80);
const cw = conflicts(beaW, [{ diff: alexW, by: 'Alex', label: 'Edit Base plate' }], afterAlex);
ok('the same size changed twice is a conflict, naming who and what', cw.length === 1 && /Alex/.test(cw[0]) && /params\.width/.test(cw[0]), cw);
const alexDel = edit([{ op: 'delete', id: 'post' }]), beaPost = edit([{ op: 'set', id: 'post', params: { height: 30 } }]);
ok('changing a part someone deleted is a conflict', conflicts(beaPost, [{ diff: alexDel, by: 'Alex' }], applyDiff(B0, alexDel)).some(t => /deleted/.test(t)));
const alexDelPlate = edit([{ op: 'delete', id: 'plate' }, { op: 'unmate', id: 'post' }]), beaHole = edit([{ op: 'add', type: 'cylinder', id: 'bore', params: { diameter: 5, height: 10 }, mate: { to: 'plate', a: 'top', b: 'top', flip: false }, into: 'plate', mode: 'subtract' }]);
const dep = conflicts(beaHole, [{ diff: alexDelPlate, by: 'Alex' }], applyDiff(B0, alexDelPlate));
ok('adding something to a part someone deleted is a conflict', dep.some(t => /relies on/.test(t)), dep);
const B3 = new Model(JSON.parse(JSON.stringify(B0))); B3.apply([{ op: 'add', type: 'box', id: 'x', params: { width: 5, depth: 5, height: 5 }, at: [200, 0, 0], fixed: true }]); const B3d = snap(B3);
const edit3 = (ops) => { const x = new Model(JSON.parse(JSON.stringify(B3d))); x.apply(ops); return docDiff(B3d, snap(x)); };
const reA = edit3([{ op: 'move', id: 'x', to: 0 }]), reB = edit3([{ op: 'move', id: 'x', after: 'plate' }]);
ok('two reorders at once are a conflict', conflicts(reB, [{ diff: reA }], applyDiff(B3d, reA)).some(t => /reordered/.test(t)));
ok('…but adding a part is not a reorder', !edit([{ op: 'add', type: 'box', id: 'y', params: { width: 5, depth: 5, height: 5 }, at: [300, 0, 0], fixed: true }]).order);
const varA = edit([{ op: 'var', name: 'wall', value: 2 }]), varB = edit([{ op: 'var', name: 'gap', value: 1 }]);
ok('different model variables merge', conflicts(varB, [{ diff: varA }], applyDiff(B0, varA)).length === 0 && JSON.stringify(applyDiff(applyDiff(B0, varA), varB).vars) === JSON.stringify({ wall: 2, gap: 1 }));

/* undo of one's own change: only what it changed, and only if nobody has changed that since */
const U = new Model(JSON.parse(JSON.stringify(B0))); U.apply([{ op: 'set', id: 'plate', params: { width: 150 }, name: 'Wide plate' }]); const Ua = snap(U), Ud = docDiff(B0, Ua);
const inv = inverse(B0, Ua, Ud), later = applyDiff(Ua, beaD);
ok('undoing my change restores what it changed', applyDiff(later, inv).objects.find(o => o.id === 'plate').params.width === 100 && applyDiff(later, inv).objects.find(o => o.id === 'plate').name === B0.objects.find(o => o.id === 'plate').name);
ok('…and keeps what someone else changed meanwhile', applyDiff(later, inv).objects.find(o => o.id === 'plate').params.depth === 80);
ok('…allowed while nobody has touched it since', changedSince(later, Ua, Ud).length === 0);
const later2 = applyDiff(Ua, edit([{ op: 'set', id: 'plate', params: { width: 120 } }]));
ok('…refused once someone has changed the same thing, naming it', changedSince(later2, Ua, Ud).some(t => /params\.width/.test(t)), changedSince(later2, Ua, Ud));
const Ad = new Model(JSON.parse(JSON.stringify(B0))); Ad.apply([{ op: 'add', type: 'sphere', id: 'ball', params: { diameter: 10 }, at: [0, 0, 50], fixed: true }]); const Aa = snap(Ad), Add = docDiff(B0, Aa);
ok('undoing an addition removes it', !applyDiff(Aa, inverse(B0, Aa, Add)).objects.some(o => o.id === 'ball'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
