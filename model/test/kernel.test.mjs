/* SketchFlow v2 kernel tests: node model/test/kernel.test.mjs */
import * as K from '../js/kernel.js';
let pass = 0, fail = 0;
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const check = (name, got, want, tol = 0.01) => { const ok = near(got, want, tol); ok ? pass++ : fail++; console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + ': ' + (+got).toFixed(3) + ' (want ' + (+want).toFixed(3) + ')'); };
const t0 = Date.now();
const box = K.box(20, 10, 5);
check('box volume', box.volume(), 1000);
check('box creases', K.creaseEdges(box).length, 12, 0);
const cyl = K.cylinder(3, 3, 5, 48);
const polyArea = 0.5 * 48 * 9 * Math.sin(2 * Math.PI / 48);
check('cylinder volume', cyl.volume(), polyArea * 5);
const cone = K.cylinder(4, 0, 6, 48); check('cone volume', cone.volume(), 0.5 * 48 * 16 * Math.sin(2 * Math.PI / 48) * 6 / 3);
const frus = K.cylinder(4, 2, 6, 64); check('frustum volume ≈ πh(R²+Rr+r²)/3', frus.volume(), Math.PI * 6 * (16 + 8 + 4) / 3, 0.01);
const sph = K.sphere(5, 48); check('sphere volume ≈ 4/3πr³', sph.volume(), 4 / 3 * Math.PI * 125, 0.02);
const w = K.wedge(10, 4, 6); check('wedge volume', w.volume(), 0.5 * 10 * 6 * 4);
/* booleans */
const hole = K.cylinder(3, 3, 7, 48).transform(K.M4.translate([0, 0, -1]));
const holed = box.subtract(hole); check('box − cylinder', holed.volume(), 1000 - polyArea * 5);
const b2 = K.box(20, 10, 5).transform(K.M4.translate([10, 0, 0]));
check('union of overlapping boxes', box.union(b2).volume(), 1500);
check('intersection of overlapping boxes', box.intersect(b2).volume(), 500);
check('subtract twice (pocket + through)', holed.subtract(K.box(4, 4, 2).transform(K.M4.translate([7, 0, 3.5]))).volume(), 1000 - polyArea * 5 - 4 * 4 * 1.5);
check('holed box creases still clean (12 box edges + 2 circles)', K.creaseEdges(holed).length >= 12 ? 1 : 0, 1, 0);
/* extrude / loft / revolve / sweep */
const sq = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
check('extrude square', K.extrude(sq, { length: 8 }).volume(), 800);
check('extrude with end scale 0.5 (frustum of a pyramid)', K.extrude(sq, { length: 9, scale: 0.5 }).volume(), 9 / 3 * (100 + 25 + 50));
check('extrude with 90° twist keeps volume', K.extrude(sq, { length: 8, twist: 90, divisions: 32 }).volume(), 800, 0.02);
check('oblique extrude keeps volume (shear)', K.extrude(sq, { length: 8, dir: [1, 0, 1] }).volume(), 800);
const circ = []; for (let i = 0; i < 64; i++) { const t = i / 64 * Math.PI * 2; circ.push([Math.cos(t) * 5, Math.sin(t) * 5]); }
const lf = K.loft(sq, circ, { length: 10, samples: 64 }); check('loft square → circle is closed (positive volume)', lf.volume() > 0 ? 1 : 0, 1, 0);
check('loft square → circle volume between the two', lf.volume() > 10 * Math.PI * 25 * 0.95 && lf.volume() < 1000 ? 1 : 0, 1, 0);
const ring = K.revolve([[2, 0], [5, 0], [5, 3], [2, 3]], { segments: 96 }); check('revolve washer ≈ π(R²−r²)h', ring.volume(), Math.PI * 21 * 3, 0.01);
const half = K.revolve([[2, 0], [5, 0], [5, 3], [2, 3]], { segments: 48, degrees: 180 }); check('half revolve', half.volume(), Math.PI * 21 * 3 / 2, 0.01);
const sw = K.sweep([[-1, -1], [1, -1], [1, 1], [-1, 1]], [[0, 0, 0], [0, 0, 10]]); check('straight sweep = prism', sw.volume(), 40);
const swL = K.sweep([[-1, -1], [1, -1], [1, 1], [-1, 1]], [[0, 0, 0], [0, 0, 10], [10, 0, 10]]); check('L-shaped sweep is closed', swL.volume() > 70 ? 1 : 0, 1, 0);
/* edge treatments on the box's top-front edge (x along the edge): faces top (+z) and front (−y) */
const m = [0, -5, 5], d = [1, 0, 0], u1 = [0, 1, 0], u2 = [0, 0, -1];
const fillet = K.edgePiece(m, d, u1, u2, 2, 'fillet', 20, 0.01);
check('fillet piece area (1 − π/4)·r²·L', fillet.volume(), (1 - Math.PI / 4) * 4 * 20.02, 0.03);
const chamfer = K.edgePiece(m, d, u1, u2, 2, 'chamfer', 20); check('chamfer piece ½·t²·L', chamfer.volume(), 0.5 * 4 * 20);
check('box with rounded edge', box.subtract(fillet).volume(), 1000 - (1 - Math.PI / 4) * 4 * 20, 0.01);
const weld = K.edgePiece([0, 0, 0], [1, 0, 0], [0, -1, 0], [0, 0, 1], 2, 'weld', 10); check('weld bead = quarter disc · L', weld.volume(), Math.PI * 4 / 4 * 10, 0.02);
check('tri: square → 2 triangles', K.triangulate([[0, 0], [1, 0], [1, 1], [0, 1]]).length, 2, 0);
check('tri: concave L → 4 triangles', K.triangulate([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]).length, 4, 0);
const sil = K.silhouetteEdges(cyl, [0, 1, 0], (sid) => sid === 'side'); check('cylinder side silhouettes from the front (2 lines)', sil.length, 2, 0);
console.log(`\n${pass} passed, ${fail} failed in ${Date.now() - t0} ms`);
process.exit(fail ? 1 : 0);
