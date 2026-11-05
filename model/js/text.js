/* SketchFlow 3D text: a built-in single-stroke engraving font (the kind CNC engravers and laser markers use), laid
   out straight, around an arc, or along any polyline in its own sketch plane, thickened to a stroke weight and
   extruded to a depth. Characters sit rigidly along the path, each turned to its tangent (as CAD text-on-a-curve
   does). Used through a boolean: emboss (add) on a face or engrave (remove) into it.
   Local frame: the text lies in z = 0…depth; its origin is the anchor (line: the text's middle for align centre, the
   baseline's start / end otherwise; arc: the arc's centre; points: the path's own coordinates). */
import * as K from './kernel.js';
const { V, M4 } = K;

/* glyphs on a grid: x 0…w (w = 4 unless given), y 0…6 = cap height; each stroke a polyline of centreline points */
const G = (w, ...s) => ({ w, s });
const RING = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
const P_BOWL = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
const DOT = (x, y) => [[x, y], [x, y + 0.01]];
export const FONT = {
  ' ': G(2.5),
  A: G(4, [[0, 0], [2, 6], [4, 0]], [[0.67, 2], [3.33, 2]]),
  B: G(4, [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]),
  C: G(4, [[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]),
  D: G(4, [[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]),
  E: G(4, [[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]),
  F: G(4, [[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]),
  G: G(4, [[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]),
  H: G(4, [[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]),
  I: G(2, [[0, 6], [2, 6]], [[1, 6], [1, 0]], [[0, 0], [2, 0]]),
  J: G(4, [[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]),
  K: G(4, [[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1.33, 3.33], [4, 0]]),
  L: G(4, [[0, 6], [0, 0], [4, 0]]),
  M: G(4.5, [[0, 0], [0, 6], [2.25, 3], [4.5, 6], [4.5, 0]]),
  N: G(4, [[0, 0], [0, 6], [4, 0], [4, 6]]),
  O: G(4, RING),
  P: G(4, P_BOWL),
  Q: G(4, RING, [[2.5, 1.5], [4.2, -0.2]]),
  R: G(4, P_BOWL, [[2, 3], [4, 0]]),
  S: G(4, [[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]),
  T: G(4, [[0, 6], [4, 6]], [[2, 6], [2, 0]]),
  U: G(4, [[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]),
  V: G(4, [[0, 6], [2, 0], [4, 6]]),
  W: G(5, [[0, 6], [1.25, 0], [2.5, 4], [3.75, 0], [5, 6]]),
  X: G(4, [[0, 0], [4, 6]], [[0, 6], [4, 0]]),
  Y: G(4, [[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]),
  Z: G(4, [[0, 6], [4, 6], [0, 0], [4, 0]]),
  0: G(4, RING, [[0.8, 1.2], [3.2, 4.8]]),
  1: G(3, [[0.5, 5], [1.5, 6], [1.5, 0]], [[0, 0], [3, 0]]),
  2: G(4, [[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]),
  3: G(4, [[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1.5, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]),
  4: G(4, [[3, 0], [3, 6], [0, 2], [4, 2]]),
  5: G(4, [[4, 6], [0, 6], [0, 3.5], [3, 3.5], [4, 2.5], [4, 1], [3, 0], [1, 0], [0, 1]]),
  6: G(4, [[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]),
  7: G(4, [[0, 6], [4, 6], [1.5, 0]]),
  8: G(4, [[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]),
  9: G(4, [[0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [4, 3]]),
  '.': G(0.5, DOT(0.25, 0)),
  ',': G(1, [[1, 0.6], [0.3, -1]]),
  ':': G(0.5, DOT(0.25, 0), DOT(0.25, 4)),
  ';': G(1, [[1, 0.6], [0.3, -1]], DOT(1, 4)),
  '-': G(3, [[0, 3], [3, 3]]),
  '_': G(4, [[0, -0.8], [4, -0.8]]),
  '+': G(4, [[0, 3], [4, 3]], [[2, 1], [2, 5]]),
  '=': G(4, [[0, 2], [4, 2]], [[0, 4], [4, 4]]),
  '/': G(4, [[0, 0], [4, 6]]),
  '\\': G(4, [[0, 6], [4, 0]]),
  '(': G(1.5, [[1.5, 6], [0, 4.5], [0, 1.5], [1.5, 0]]),
  ')': G(1.5, [[0, 6], [1.5, 4.5], [1.5, 1.5], [0, 0]]),
  '[': G(1.5, [[1.5, 6], [0, 6], [0, 0], [1.5, 0]]),
  ']': G(1.5, [[0, 6], [1.5, 6], [1.5, 0], [0, 0]]),
  '#': G(4, [[1, 0], [1.5, 6]], [[2.5, 0], [3, 6]], [[0, 2], [4, 2]], [[0, 4], [4, 4]]),
  '!': G(0.5, [[0.25, 6], [0.25, 2]], DOT(0.25, 0)),
  '?': G(4, [[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [2, 2.5], [2, 1.8]], DOT(2, 0)),
  "'": G(0.5, [[0.25, 6], [0.25, 4.5]]),
  '"': G(2, [[0, 6], [0, 4.5]], [[2, 6], [2, 4.5]]),
  '°': G(2, [[0, 6], [2, 6], [2, 4], [0, 4], [0, 6]]),
  '%': G(4, [[0, 0], [4, 6]], [[0, 6], [1, 6], [1, 5], [0, 5], [0, 6]], [[3, 1], [4, 1], [4, 0], [3, 0], [3, 1]]),
  '*': G(4, [[2, 1.5], [2, 4.5]], [[0.7, 2.25], [3.3, 3.75]], [[0.7, 3.75], [3.3, 2.25]]),
  '&': G(4, [[4, 0], [1, 4], [1, 5], [2, 6], [3, 5], [3, 4], [0, 2], [0, 1], [1, 0], [2, 0], [4, 2]]),
  '<': G(3, [[3, 5], [0, 3], [3, 1]]),
  '>': G(3, [[0, 5], [3, 3], [0, 1]]),
  '@': G(4.5, [[3, 2], [3, 4], [1.5, 4], [1.5, 2], [3.5, 2], [4.5, 3], [4.5, 5], [3.5, 6], [1, 6], [0, 5], [0, 1], [1, 0], [4, 0]]),
  'Ø': G(4, RING, [[-0.4, -0.4], [4.4, 6.4]]),
  '±': G(4, [[0, 3.5], [4, 3.5]], [[2, 1.5], [2, 5.5]], [[0, 0], [4, 0]]),
  '×': G(4, [[0.5, 1], [3.5, 5]], [[0.5, 5], [3.5, 1]])
};
export const TEXT_PATHS = ['line', 'arc', 'arc-inside', 'points'];
export const TEXT_ALIGN = ['center', 'start', 'end'];
const glyphOf = (ch) => FONT[ch] || FONT[ch.toUpperCase()] || FONT['?'];

/* where each character goes: [{ ch, strokes (2D, mm, in the text plane) }] plus the overall length */
export function layoutText(p) {
  const H = +p.height, w = +p.weight > 0 ? +p.weight : H * 0.12;
  if (!(H > 0)) throw new Error('text height must be above 0');
  if (!(w < H / 3)) throw new Error(`a stroke weight of ${w} is too heavy for ${H} tall letters (keep it under ${(H / 3).toFixed(2)})`);
  const str = String(p.text == null ? '' : p.text).replace(/\s+/g, ' ');
  if (!str.trim()) throw new Error('the text is empty');
  const u = (H - w) / 6, gap = (p.spacing == null ? 1 : +p.spacing) * u + w, gl = [...str].map(ch => ({ ch, g: glyphOf(ch) }));
  let x = 0; for (const c of gl) { c.x0 = x; c.cx = x + c.g.w * u / 2; x += c.g.w * u + gap; }
  const L = x - gap, align = TEXT_ALIGN.includes(p.align) ? p.align : 'center', path = TEXT_PATHS.includes(p.path) ? p.path : 'line';
  const ang = (+p.angle || 0) * Math.PI / 180, rot = (q) => [q[0] * Math.cos(ang) - q[1] * Math.sin(ang), q[0] * Math.sin(ang) + q[1] * Math.cos(ang)];
  /* frame of each character: baseline point B, tangent t, up n (before the whole-text rotation) */
  let frameAt;
  if (path === 'line') {
    const s0 = align === 'start' ? 0 : align === 'end' ? -L : -L / 2, y0 = align === 'center' ? -(H / 2 - w / 2) : 0;
    frameAt = (s) => ({ B: [s0 + s, y0], t: [1, 0], n: [0, 1] });
  } else if (path === 'arc' || path === 'arc-inside') {
    const R = +p.radius; if (!(R > 0)) throw new Error('an arc needs a radius above 0');
    if (L / R > 2 * Math.PI * 0.97) throw new Error(`the text is longer than the arc (${L.toFixed(1)} mm around a ${(2 * Math.PI * R).toFixed(1)} mm circle): use a bigger radius or smaller letters`);
    const s0 = align === 'start' ? 0 : align === 'end' ? -L : -L / 2;
    frameAt = path === 'arc'
      ? (s) => { const th = Math.PI / 2 - (s0 + s) / R; return { B: [R * Math.cos(th), R * Math.sin(th)], t: [Math.sin(th), -Math.cos(th)], n: [Math.cos(th), Math.sin(th)] }; }   /* over the top, reading clockwise, tops outward */
      : (s) => { const th = 1.5 * Math.PI + (s0 + s) / R; return { B: [R * Math.cos(th), R * Math.sin(th)], t: [-Math.sin(th), Math.cos(th)], n: [-Math.cos(th), -Math.sin(th)] }; };   /* along the bottom, reading anticlockwise, tops toward the centre */
  } else {
    const pts = (p.points || []).map(q => [+q[0], +q[1]]); if (pts.length < 2) throw new Error('a text path needs at least two points');
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const Lp = cum[cum.length - 1]; if (!(Lp > 0)) throw new Error('the text path has no length');
    const s0 = align === 'start' ? 0 : align === 'end' ? Lp - L : (Lp - L) / 2;
    frameAt = (s) => {
      const q = s0 + s; let i = 1; while (i < pts.length - 1 && cum[i] < q) i++;
      const a = pts[i - 1], b = pts[i], l = cum[i] - cum[i - 1] || 1, f = (q - cum[i - 1]) / l, t = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      return { B: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t, n: [-t[1], t[0]] };
    };
  }
  const chars = gl.map(c => {
    const F = frameAt(c.cx), place = (q) => { const X = (q[0] - c.g.w / 2) * u, Y = q[1] * u; return rot([F.B[0] + X * F.t[0] + Y * F.n[0], F.B[1] + X * F.t[1] + Y * F.n[1]]); };
    return { ch: c.ch, strokes: c.g.s.map(st => st.map(place)) };
  });
  return { chars, length: L, height: H, weight: w, unit: u, path, align };
}
/* the text as a solid: each stroke segment a bar of the stroke weight, with an octagonal pen tip at every point (round-
   ish ends and joints that close at any angle, never reaching more than half the weight past a point), one character
   at a time, z = 0…depth */
export function textSolid(p) {
  const depth = +p.depth; if (!(depth > 0)) throw new Error('text depth must be above 0');
  const lay = layoutText(p), w = lay.weight, pieces = [], tipR = (w / 2) / Math.cos(Math.PI / 8);
  const tip = K.cylinder(tipR, tipR, depth, 8).transform(M4.euler(0, 0, 22.5));   /* flats facing the axes: inradius w/2 */
  for (const c of lay.chars) {
    const bars = [], seen = new Set();
    for (const st of c.strokes) {
      for (let i = 1; i < st.length; i++) {
        const a = st[i - 1], b = st[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-6) continue;
        bars.push(K.box(l, w, depth).transform(M4.mul(M4.translate([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]), M4.euler(0, 0, Math.atan2(dy, dx) * 180 / Math.PI))));
      }
      for (const q of st) { const k = Math.round(q[0] * 1e4) + ',' + Math.round(q[1] * 1e4); if (seen.has(k)) continue; seen.add(k); bars.push(tip.transform(M4.translate([q[0], q[1], 0]))); }
    }
    if (!bars.length) continue;
    let layer = bars; while (layer.length > 1) { const nx = []; for (let i = 0; i < layer.length; i += 2) nx.push(i + 1 < layer.length ? layer[i].union(layer[i + 1]) : layer[i]); layer = nx; }
    pieces.push(layer[0]);
  }
  if (!pieces.length) throw new Error('the text has no printable characters');
  /* characters that do not touch are simply put together; ones that touch (tight spacing, a sharp path) are joined */
  let out = pieces[0]; const boxes = [pieces[0].bbox()];
  for (const s of pieces.slice(1)) {
    const b = s.bbox(), touches = boxes.some(a => [0, 1].every(k => a.max[k] >= b.min[k] - 1e-6 && b.max[k] >= a.min[k] - 1e-6));
    out = touches ? out.union(s) : new K.Solid(out.polys.concat(s.polys)); boxes.push(b);
  }
  return out;
}
