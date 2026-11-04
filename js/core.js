/* SketchFlow core: namespace, utils, prefs, document model, history, geometry, joints. */
window.SF = window.SF || {};
(function (SF) {
'use strict';

/* ---------------- utils ---------------- */
const U = SF.U = {
  $: (s, r) => (r || document).querySelector(s),
  $$: (s, r) => Array.from((r || document).querySelectorAll(s)),
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
  _c: 0,
  uid(p) { U._c = (U._c + 1) % 1e6; return (p || 'i') + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6) + U._c.toString(36); },
  debounce(fn, ms) { let t = 0; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; },
  el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  },
  hexToRgb(h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); },
  luma(hex) { const [r, g, b] = U.hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; },
  normColor(c) {
    if (!c) return '#000000';
    if (/^#[0-9a-f]{3,8}$/i.test(c)) { let h = c.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return '#' + h.slice(0, 6).toLowerCase(); }
    const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = '#000'; cv.fillStyle = c;
    const v = cv.fillStyle; return /^#/.test(v) ? v : (() => { const m = v.match(/\d+(\.\d+)?/g) || [0, 0, 0]; return U.rgbToHex(+m[0], +m[1], +m[2]); })();
  },
  ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  },
  canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; },
  copyCanvas(src) { const c = U.canvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; },
  angDiff(a, b) { let d = (a - b) % Math.PI; if (d < 0) d += Math.PI; return Math.min(d, Math.PI - d); }
};

/* ---------------- tiny event bus ---------------- */
const bus = {};
SF.on = (ev, fn) => { (bus[ev] = bus[ev] || []).push(fn); };
SF.emit = (ev, data) => { (bus[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); };

/* ---------------- safe storage ---------------- */
SF.store = {
  get(k, d) { try { const v = localStorage.getItem('sf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sf.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
};

/* ---------------- palettes ---------------- */
SF.PALETTES = {
  ink: { name: 'Ink', c: ['#1c1c1e', '#3a3a3c', '#6e6e73', '#aeaeb2', '#ffffff', '#1f3a93', '#b3261e', '#0b6e4f', '#e8a33d', '#5b3a29'] },
  bright: { name: 'Bright', c: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#1c1c1e', '#ffffff'] },
  pastel: { name: 'Pastel', c: ['#ffd1dc', '#ffe5b4', '#fff5ba', '#c1f0c1', '#b5ead7', '#c7ceea', '#e2c2ff', '#f8c8dc', '#ffffff', '#555555'] },
  earth: { name: 'Earth', c: ['#3e2c1c', '#6f4e37', '#a0522d', '#c2703d', '#d9a441', '#e6d2a8', '#7a8450', '#4f6d3a', '#2f4f4f', '#8b9a9b'] },
  neon: { name: 'Neon', c: ['#39ff14', '#ff073a', '#0ff0fc', '#fe019a', '#ffef00', '#bc13fe', '#ff6700', '#111111', '#ffffff'] },
  skin: { name: 'Skin', c: ['#ffe0bd', '#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#a1665e', '#8d5524', '#5c3a21', '#3b2219'] },
  blueprint: { name: 'Blueprint', c: ['#0b3d91', '#1e5aa8', '#3a7bd5', '#7fb2f0', '#cfe3ff', '#ffffff', '#f2c94c', '#eb5757', '#27ae60'] },
  markers: { name: 'Marker greys', c: ['#f0efea', '#d9d6cf', '#b8b4ab', '#8f8b82', '#5e5b55', '#e6eaee', '#c9d1d8', '#9aa6b2', '#66727e', '#3b4550'] },
  blackops: { name: 'BlackOps', c: ['#0b0d0e', '#24282b', '#3c4146', '#5b6166', '#4b5320', '#6b6f3a', '#81613c', '#c2b280', '#8e9a8b', '#7cfc6a', '#d0392b'] },
  cyberpunk: { name: 'Cyberpunk', c: ['#0d0221', '#2a0a5e', '#7700a6', '#ff2a6d', '#ff00a0', '#05d9e8', '#00ffcc', '#b4ff39', '#f9f002', '#d1f7ff'] },
  chill: { name: 'Chill', c: ['#1f2a44', '#3d5a80', '#98c1d9', '#e0fbfc', '#a8dadc', '#c9e4ca', '#fff1d0', '#f1c0b9', '#ee6c4d', '#b8b8ff'] }
};

/* ---------------- prefs ---------------- */
const DEFAULT_PREFS = {
  theme: 'dark', palette: 'ink', color: '#1c1c1e', recent: [],
  tool: 'pen', brush: 'pen', shape: 'rect', shapeFill: 'outline',
  sizes: { pen: 4, pencil: 3, marker: 18, brush: 12, shape: 3, eraser: 22, text: 40, dim: 2 },
  opac: { pen: 1, pencil: 0.85, marker: 0.5, brush: 1, shape: 1, eraser: 1, text: 1, dim: 1 },
  steady: 0.4, holdSnap: true, holdMs: 450, snap: true, align: true,
  eraseMode: 'cut', fillTol: 22, fillAll: true,
  font: 'sans', bold: false, italic: false, onPath: false,
  fingers: 'auto', wheel: 'auto', lightboxAmt: 0.3, autosave: true, units: 'px', unitScale: 1, dimPrec: 0,
  lastBoard: null, sawPen: false, tips: {}
};
SF.DEFAULT_PREFS = DEFAULT_PREFS;
const saved = SF.store.get('prefs', {}) || {};
SF.prefs = Object.assign(JSON.parse(JSON.stringify(DEFAULT_PREFS)), saved);
SF.prefs.sizes = Object.assign({}, DEFAULT_PREFS.sizes, saved.sizes || {});
SF.prefs.opac = Object.assign({}, DEFAULT_PREFS.opac, saved.opac || {});
SF.savePrefs = U.debounce(() => SF.store.set('prefs', SF.prefs), 250);

SF.FONTS = {
  sans: { name: 'Sans', css: '"Figtree", ui-sans-serif, system-ui, sans-serif' },
  serif: { name: 'Serif', css: '"Fraunces", Georgia, "Times New Roman", serif' },
  hand: { name: 'Hand', css: '"Caveat", "Comic Sans MS", cursive' },
  marker: { name: 'Marker', css: '"Permanent Marker", "Comic Sans MS", cursive' },
  mono: { name: 'Mono', css: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
  display: { name: 'Display', css: '"Bricolage Grotesque", "Figtree", system-ui, sans-serif' }
};
SF.fontCss = (it) => `${it.italic ? 'italic ' : ''}${it.bold ? 700 : 500} ${it.size}px ${(SF.FONTS[it.font] || SF.FONTS.sans).css}`;

/* ---------------- drawing spaces ---------------- */
SF.SPACES = {
  free: { name: 'Free', desc: 'Blank paper, joint snapping only' },
  grid: { name: 'Flat grid', desc: 'Square grid, 0°/90° lines snap' },
  iso: { name: 'Isometric', desc: '30° / 90° / 150° axes and lattice' },
  p1: { name: '1-point', desc: 'One vanishing point + horizon' },
  p2: { name: '2-point', desc: 'Two vanishing points on the horizon' },
  p3: { name: '3-point', desc: 'Two VPs + one vertical VP' },
  v3: { name: '3-view', desc: 'Front · Top · Side, aligned projections' },
  v4: { name: '4-view', desc: '3-view + isometric 3D quadrant' }
};
SF.SPACE_ORDER = ['free', 'grid', 'iso', 'p1', 'p2', 'p3', 'v3', 'v4'];

/* ---------------- document ---------------- */
SF.mkLayer = (name) => ({ id: U.uid('L'), name: name || 'Layer', visible: true, opacity: 1, blend: 'source-over', ref: false, locked: false, items: [] });

SF.defaultGuides = (w, h) => ({
  space: 'free', grid: 50,
  vps: [{ x: w * 0.12, y: h * 0.42 }, { x: w * 0.88, y: h * 0.42 }, { x: w * 0.5, y: h * 1.9 }],
  lightbox: false
});

SF.newDoc = (w, h, name) => {
  const L = SF.mkLayer('Sketch');
  const now = Date.now();
  return {
    id: U.uid('b'), name: name || ('Board · ' + new Date(now).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
    w: Math.round(w), h: Math.round(h), paper: '#ffffff', created: now, updated: now,
    layers: [L], active: L.id, guides: SF.defaultGuides(w, h)
  };
};

SF.doc = null;
SF.layer = (id) => SF.doc.layers.find(l => l.id === (id || SF.doc.active));
SF.layerIndex = (id) => SF.doc.layers.findIndex(l => l.id === (id || SF.doc.active));
SF.findLayer = (ref) => {
  if (ref == null || ref === '') return SF.layer();
  const d = SF.doc;
  return d.layers.find(l => l.id === ref) || d.layers.find(l => l.name.toLowerCase() === String(ref).toLowerCase()) ||
    (Number.isInteger(+ref) ? d.layers[+ref] : null);
};
SF.findItem = (id) => {
  for (const L of SF.doc.layers) {
    const items = SF.override && SF.override.layerId === L.id ? SF.override.items : L.items;
    const it = items.find(i => i.id === id); if (it) return { L, it };
  }
  return null;
};

/* ---------------- history (immutable snapshots; items are never mutated after commit) ---------------- */
const H = SF.history = { states: [], i: -1, max: 200 };
const snap = () => ({ layers: SF.doc.layers.map(l => Object.assign({}, l)), active: SF.doc.active, paper: SF.doc.paper, paperHidden: SF.doc.paperHidden || null });
SF.resetHistory = () => { H.states = [{ s: snap(), label: 'Start' }]; H.i = 0; SF.emit('history'); };
SF.commit = (label) => {
  H.states.length = H.i + 1;
  H.states.push({ s: snap(), label: label || 'Edit' });
  if (H.states.length > H.max) H.states.shift(); else H.i++;
  SF.doc.updated = Date.now();
  SF.emit('history'); SF.emit('change', label);
  SF.requestRender();
};
function restore(s) {
  SF.doc.layers = s.layers.map(l => Object.assign({}, l));
  SF.doc.active = SF.doc.layers.some(l => l.id === s.active) ? s.active : SF.doc.layers[SF.doc.layers.length - 1].id;
  SF.doc.paper = s.paper; SF.doc.paperHidden = s.paperHidden || null;
  SF.doc.updated = Date.now();
  SF.sel && SF.sel.clear && SF.sel.clear(true);
  SF.emit('history'); SF.emit('change', 'history'); SF.emit('layers');
  SF.requestRender();
}
SF.undo = () => { if (H.i <= 0) { SF.toast && SF.toast('Nothing to undo'); return false; } const lab = H.states[H.i].label; H.i--; restore(H.states[H.i].s); SF.toast && SF.toast('Undo · ' + lab, 900); return true; };
SF.redo = () => { if (H.i >= H.states.length - 1) { SF.toast && SF.toast('Nothing to redo'); return false; } H.i++; restore(H.states[H.i].s); SF.toast && SF.toast('Redo · ' + H.states[H.i].label, 900); return true; };
SF.goHistory = (idx) => { idx = U.clamp(idx | 0, 0, H.states.length - 1); if (idx === H.i) return; H.i = idx; restore(H.states[H.i].s); };

/* layer item helpers: always replace arrays */
SF.setItems = (L, items) => { L.items = SF.resolveItems(items); };
SF.addItems = (L, items) => { L.items = SF.resolveItems(L.items.concat(items)); };
SF.replaceItem = (L, it) => { L.items = SF.resolveItems(L.items.map(x => (x.id === it.id ? it : x))); };

/* ---------------- geometry ---------------- */
const G = SF.G = {};
G.npts = (it) => (it.pts ? it.pts.length / 3 : 0);
G.pt = (it, i) => ({ x: it.pts[i * 3], y: it.pts[i * 3 + 1], p: it.pts[i * 3 + 2] });
G.segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = U.clamp(t, 0, 1);
  const qx = ax + dx * t, qy = ay + dy * t;
  return { d: Math.hypot(px - qx, py - qy), t, x: qx, y: qy };
};
G.pathLen = (pts, closed) => {
  let L = 0; const n = pts.length / 3;
  for (let i = 1; i < n; i++) L += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
  if (closed && n > 2) L += Math.hypot(pts[0] - pts[(n - 1) * 3], pts[1] - pts[(n - 1) * 3 + 1]);
  return L;
};
/* Ramer-Douglas-Peucker on flat [x,y,p] arrays */
G.rdp = (pts, eps) => {
  const n = pts.length / 3; if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = G.segDist(pts[i * 3], pts[i * 3 + 1], pts[a * 3], pts[a * 3 + 1], pts[b * 3], pts[b * 3 + 1]).d;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  return out;
};
G.polyArea = (xy) => { let a = 0; for (let i = 0, n = xy.length; i < n; i++) { const p = xy[i], q = xy[(i + 1) % n]; a += p.x * q.y - q.x * p.y; } return a / 2; };
G.pointInPoly = (x, y, xy) => {
  let inside = false;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const a = xy[i], b = xy[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/* bounding boxes (cached per immutable item) */
const bbCache = new WeakMap();
G.bbox = (it) => {
  let b = bbCache.get(it); if (b) return b;
  if (it.t === 'path') {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const n = it.pts.length / 3;
    for (let i = 0; i < n; i++) { const x = it.pts[i * 3], y = it.pts[i * 3 + 1]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const pad = (it.stroke === false ? 0 : it.width / 2) + (it.arrow ? it.width * 3 + 6 : 0) + 1;
    b = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  } else if (it.t === 'image') {
    const c = G.imageCorners(it); b = G.ptsBox(c);
  } else if (it.t === 'text') {
    const c = G.textCorners(it); b = G.ptsBox(c);
    if (it.pathId) return b; /* follows its path: not cached */
  } else if (it.t === 'dim') {
    const g = SF.dimGeom ? SF.dimGeom(it) : null;
    b = g ? G.ptsBox([g.a2, g.b2, g.a, g.b, { x: g.lx - 40, y: g.ly - 14 }, { x: g.lx + 40, y: g.ly + 14 }]) : { x: 0, y: 0, w: 0, h: 0 };
    return b; /* dims depend on other items: not cached */
  } else b = { x: 0, y: 0, w: 0, h: 0 };
  bbCache.set(it, b); return b;
};
G.ptsBox = (ps) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
G.unionBox = (a, b) => { if (!a) return b; if (!b) return a; const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
G.boxHit = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
G.rot = (x, y, cx, cy, r) => { const c = Math.cos(r), s = Math.sin(r), dx = x - cx, dy = y - cy; return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }; };
G.imageCorners = (it) => {
  const hw = it.iw * it.s / 2, hh = it.ih * it.s / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => G.rot(it.x + x, it.y + y, it.x, it.y, it.r || 0));
};
G.textMetrics = (it) => {
  const ctx = G._mctx || (G._mctx = document.createElement('canvas').getContext('2d'));
  ctx.font = SF.fontCss(it);
  const lines = String(it.text || '').split('\n');
  let w = 0; for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  return { w: Math.max(4, w), h: lines.length * it.size * 1.2, lines };
};
/* text on a path: position of every glyph. offset slides along the line, lift raises it off the line.
   Glyphs that run past either end continue straight along the end's direction instead of vanishing. */
SF.pathTextLayout = (it, path) => {
  if (!path || path.t !== 'path' || path.pts.length < 6) return null;
  const ctx = G._mctx || (G._mctx = document.createElement('canvas').getContext('2d'));
  ctx.font = SF.fontCss(it);
  const P = path.pts, n = P.length / 3, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2]));
  const total = cum[n - 1], chars = [...String(it.text || '').replace(/\n/g, ' ')];
  const widths = chars.map(ch => ctx.measureText(ch).width), tw = widths.reduce((a, b) => a + b, 0);
  let s = it.align === 'center' ? (total - tw) / 2 : it.align === 'right' ? total - tw : 0;
  s += it.offset || 0;
  const start = s, lift = (path.stroke === false ? 0 : path.width / 2) + it.size * 0.18 + (it.lift || 0);
  const at = (d) => {
    if (d <= 0 || total === 0) { const a = Math.atan2(P[4] - P[1], P[3] - P[0]); return { x: P[0] + Math.cos(a) * d, y: P[1] + Math.sin(a) * d, a }; }
    if (d >= total) { const a = Math.atan2(P[(n - 1) * 3 + 1] - P[(n - 2) * 3 + 1], P[(n - 1) * 3] - P[(n - 2) * 3]); return { x: P[(n - 1) * 3] + Math.cos(a) * (d - total), y: P[(n - 1) * 3 + 1] + Math.sin(a) * (d - total), a }; }
    let seg = 1; while (seg < n - 1 && cum[seg] < d) seg++;
    const t = (d - cum[seg - 1]) / ((cum[seg] - cum[seg - 1]) || 1);
    return { x: U.lerp(P[seg * 3 - 3], P[seg * 3], t), y: U.lerp(P[seg * 3 - 2], P[seg * 3 + 1], t), a: Math.atan2(P[seg * 3 + 1] - P[seg * 3 - 2], P[seg * 3] - P[seg * 3 - 3]) };
  };
  const glyphs = chars.map((ch, i) => { const w = widths[i], q = at(s + w / 2); s += w; return { ch, w, x: q.x, y: q.y, a: q.a }; });
  return { glyphs, lift, start, total, width: tw, mid: at(start + tw / 2) };
};
/* corners of every glyph box (for bbox / hit testing) */
SF.pathTextQuads = (it, path) => {
  const L = SF.pathTextLayout(it, path); if (!L) return null;
  const top = -L.lift - it.size * 0.82, bot = -L.lift + it.size * 0.24;
  return L.glyphs.map(g => [[-g.w / 2, top], [g.w / 2, top], [g.w / 2, bot], [-g.w / 2, bot]].map(([lx, ly]) => ({ x: g.x + lx * Math.cos(g.a) - ly * Math.sin(g.a), y: g.y + lx * Math.sin(g.a) + ly * Math.cos(g.a) })));
};
G.textCorners = (it) => {
  if (it.quad) { const S = SF.surfaceLayout(it); if (S) return S.corners; }
  if (it.pathId) {
    const f = SF.findItem(it.pathId);
    const q = f && SF.pathTextQuads(it, f.it);
    if (q && q.length) return q.flat();
  }
  const m = G.textMetrics(it);
  let ox = 0; if (it.align === 'center') ox = -m.w / 2; else if (it.align === 'right') ox = -m.w;
  return [[ox, 0], [ox + m.w, 0], [ox + m.w, m.h], [ox, m.h]].map(([x, y]) => G.rot(it.x + x, it.y + y, it.x, it.y, it.r || 0));
};

/* hit test an item at doc point (tol in doc px) */
G.hit = (it, x, y, tol) => {
  const b = G.bbox(it);
  if (x < b.x - tol || y < b.y - tol || x > b.x + b.w + tol || y > b.y + b.h + tol) return false;
  if (it.t === 'path') {
    const n = it.pts.length / 3, P = it.pts, hw = (it.stroke === false ? 0 : it.width / 2) + tol;
    if (n === 1) return Math.hypot(x - P[0], y - P[1]) <= hw;
    for (let i = 1; i < n; i++) if (G.segDist(x, y, P[i * 3 - 3], P[i * 3 - 2], P[i * 3], P[i * 3 + 1]).d <= hw) return true;
    if (it.closed && G.segDist(x, y, P[(n - 1) * 3], P[(n - 1) * 3 + 1], P[0], P[1]).d <= hw) return true;
    if (it.closed && it.fill) {
      const loop = (Q) => { const xy = []; for (let i = 0; i < Q.length; i += 3) xy.push({ x: Q[i], y: Q[i + 1] }); return xy; };
      if (!G.pointInPoly(x, y, loop(P))) return false;
      return !(it.holes || []).some(h => G.pointInPoly(x, y, loop(h.pts)));
    }
    return false;
  }
  if (it.t === 'image') {
    const p = G.rot(x, y, it.x, it.y, -(it.r || 0));
    const hw = it.iw * it.s / 2, hh = it.ih * it.s / 2;
    if (Math.abs(p.x - it.x) > hw || Math.abs(p.y - it.y) > hh) return false;
    if (it.fill || it.cut) { /* only opaque pixels count for fills / cut-outs */
      try {
        let lx = (p.x - it.x) / it.s + it.iw / 2, ly = (p.y - it.y) / it.s + it.ih / 2;
        if (it.fx) lx = it.iw - lx; if (it.fy) ly = it.ih - ly;
        const a = it.img.getContext('2d').getImageData(U.clamp(lx | 0, 0, it.iw - 1), U.clamp(ly | 0, 0, it.ih - 1), 1, 1).data[3];
        return a > 20;
      } catch (e) { return true; }
    }
    return true;
  }
  if (it.t === 'text') {
    if (it.pathId) {
      const f = SF.findItem(it.pathId), quads = f && SF.pathTextQuads(it, f.it);
      if (quads) return quads.some(q => G.pointInPoly(x, y, q) || q.some((p, i) => G.segDist(x, y, p.x, p.y, q[(i + 1) % 4].x, q[(i + 1) % 4].y).d <= tol));
    }
    return G.pointInPoly(x, y, G.textCorners(it));
  }
  if (it.t === 'dim') {
    const g = SF.dimGeom(it); if (!g) return false;
    return G.segDist(x, y, g.a2.x, g.a2.y, g.b2.x, g.b2.y).d < tol + 4 || Math.hypot(x - g.lx, y - g.ly) < 22 + tol;
  }
  return false;
};

/* affine transform applied to items (used by select/move/scale/rotate and flips) */
G.xfPoint = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
G.xfScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
G.xfRot = (m) => Math.atan2(m[1], m[0]);
G.mat = { translate: (dx, dy) => [1, 0, 0, 1, dx, dy], mul: (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]] };
G.mat.around = (cx, cy, sx, sy, r) => {
  const c = Math.cos(r), s = Math.sin(r);
  const m = [c * sx, s * sx, -s * sy, c * sy, 0, 0];
  m[4] = cx - (m[0] * cx + m[2] * cy); m[5] = cy - (m[1] * cx + m[3] * cy);
  return m;
};
G.transformItem = (it, m) => {
  const s = G.xfScale(m), r = G.xfRot(m), flip = (m[0] * m[3] - m[1] * m[2]) < 0;
  if (it.t === 'path') {
    const P = it.pts.slice();
    for (let i = 0; i < P.length; i += 3) { const q = G.xfPoint(m, P[i], P[i + 1]); P[i] = q.x; P[i + 1] = q.y; }
    const o = Object.assign({}, it, { pts: P, width: it.width * s });
    if (it.pp) {
      /* parametric primitive: moving / scaling keeps its sizes; rotating or mirroring freezes it into plain lines */
      if (Math.abs(G.xfRot(m)) > 1e-6 || (m[0] * m[3] - m[1] * m[2]) < 0) o.pp = null;
      else { const q = G.xfPoint(m, it.pp.ox, it.pp.oy); o.pp = Object.assign({}, it.pp, { ox: q.x, oy: q.y, W: it.pp.W * s, D: it.pp.D * s, H: it.pp.H * s, style: Object.assign({}, it.pp.style, { width: it.pp.style.width * s }) }); }
    }
    return o;
  }
  if (it.t === 'image') {
    const q = G.xfPoint(m, it.x, it.y);
    if (!flip) return Object.assign({}, it, { x: q.x, y: q.y, s: it.s * s, r: (it.r || 0) + r });
    /* M = M' * diag(-1,1): mirror in local x then rotate by M' */
    const rr = Math.atan2(-m[1], -m[0]);
    return Object.assign({}, it, { x: q.x, y: q.y, s: it.s * s, r: rr - (it.r || 0), fx: !it.fx });
  }
  if (it.t === 'text') {
    if (it.quad) {
      const S = SF.surfaceLayout(it), o = Object.assign({}, it, { size: Math.max(4, it.size * s) });
      if (S) {
        const q = G.xfPoint(m, S.center.x, S.center.y), dx = q.x - S.center.x, dy = q.y - S.center.y;
        const ax = S.ax, ay = S.ay, bx = S.bx, by = S.by, det = ax * by - bx * ay;
        if (Math.abs(det) > 1e-9) { o.su = (it.su || 0) + (dx * by - dy * bx) / det; o.sv = (it.sv || 0) + (ax * dy - ay * dx) / det; }
      }
      return o;
    }
    if (it.pathId) {
      const f = SF.findItem(it.pathId), L = f && SF.pathTextLayout(it, f.it);
      const o = Object.assign({}, it, { size: Math.max(4, it.size * s) });
      if (L) {
        const q = G.xfPoint(m, L.mid.x, L.mid.y), dx = q.x - L.mid.x, dy = q.y - L.mid.y, ux = Math.cos(L.mid.a), uy = Math.sin(L.mid.a);
        o.offset = (it.offset || 0) + dx * ux + dy * uy;
        o.lift = (it.lift || 0) + dx * uy - dy * ux;
      }
      return o;
    }
    const q = G.xfPoint(m, it.x, it.y);
    return Object.assign({}, it, { x: q.x, y: q.y, size: Math.max(4, it.size * s), r: flip ? it.r || 0 : (it.r || 0) + r });
  }
  if (it.t === 'dim') {
    const o = Object.assign({}, it);
    if (!it.a.ref) o.a = Object.assign({}, it.a, G.xfPoint(m, it.a.x, it.a.y));
    if (!it.b.ref) o.b = Object.assign({}, it.b, G.xfPoint(m, it.b.x, it.b.y));
    o.off = it.off * s; return o;
  }
  return it;
};

/* ---------------- joints ---------------- */
/* joints = open endpoints of every path + every vertex of straight (poly) paths */
const jCache = new WeakMap();
SF.joints = (items) => {
  let J = jCache.get(items); if (J) return J;
  J = [];
  for (const it of items) {
    /* centre lines (dash-dot axes) end at arbitrary overshoot points: no joints there */
    if (it.t !== 'path' || it.bind || it.hidden || (it.prim && it.stroke === false) || it.lt === 'center') continue;
    const n = it.pts.length / 3; if (n < 2) continue;
    if (it.mode === 'poly') { for (let i = 0; i < n; i++) J.push({ x: it.pts[i * 3], y: it.pts[i * 3 + 1], id: it.id, k: i, end: !it.closed && (i === 0 || i === n - 1) }); }
    else if (!it.closed) { J.push({ x: it.pts[0], y: it.pts[1], id: it.id, k: 0, end: true }); J.push({ x: it.pts[(n - 1) * 3], y: it.pts[(n - 1) * 3 + 1], id: it.id, k: n - 1, end: true }); }
  }
  /* mark joined: joints sharing a position with a joint of another item */
  for (let a = 0; a < J.length; a++) for (let b = a + 1; b < J.length; b++) {
    if (J[a].id !== J[b].id && Math.abs(J[a].x - J[b].x) < 0.75 && Math.abs(J[a].y - J[b].y) < 0.75) { J[a].joined = J[b].joined = true; }
  }
  jCache.set(items, J); return J;
};
/* all vertices (any index of any path) at a position */
SF.coincident = (items, x, y, eps) => {
  eps = eps || 0.75; const out = [];
  for (const it of items) {
    if (it.t !== 'path' || it.bind) continue;
    const n = it.pts.length / 3;
    for (let i = 0; i < n; i++) {
      if (it.mode !== 'poly' && i !== 0 && i !== n - 1) continue;
      if (Math.abs(it.pts[i * 3] - x) < eps && Math.abs(it.pts[i * 3 + 1] - y) < eps) out.push({ id: it.id, k: i });
    }
  }
  return out;
};
/* move vertex k of item to (x,y). free strokes deform their tail smoothly so the stroke follows the joint. */
SF.moveVertex = (it, k, x, y) => {
  const P = it.pts.slice(), n = P.length / 3;
  const dx = x - P[k * 3], dy = y - P[k * 3 + 1];
  if (it.mode === 'poly' || n < 3) { P[k * 3] = x; P[k * 3 + 1] = y; return Object.assign({}, it, { pts: P }); }
  const total = G.pathLen(it.pts, false), endpoint = k === 0 || k === n - 1;
  const fall = Math.max(20, total * (endpoint ? 0.45 : 0.28));
  P[k * 3] += dx; P[k * 3 + 1] += dy;
  for (const dir of [-1, 1]) {
    let acc = 0;
    for (let i = k + dir; i >= 0 && i < n; i += dir) {
      acc += Math.hypot(it.pts[i * 3] - it.pts[(i - dir) * 3], it.pts[i * 3 + 1] - it.pts[(i - dir) * 3 + 1]);
      if (acc > fall) break;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * acc / fall);
      P[i * 3] += dx * w; P[i * 3 + 1] += dy * w;
    }
  }
  return Object.assign({}, it, { pts: P });
};
/* move a set of {id,k} vertices by a function f(x,y)->{x,y} on an items array; returns new array */
SF.moveVertices = (items, refs, f) => {
  if (!refs.length) return items;
  const byId = new Map(); for (const r of refs) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r.k); }
  return items.map(it => {
    const ks = byId.get(it.id); if (!ks) return it;
    let o = it;
    for (const k of ks) { const q = f(it.pts[k * 3], it.pts[k * 3 + 1]); o = SF.moveVertex(o, k, q.x, q.y); }
    return o;
  });
};

/* ---------------- dimensions (parametric) ---------------- */
/* dim endpoint: {x,y} free point or {ref:itemId, k:vertexIndex, x,y} bound to a joint (x,y = fallback) */
SF.dimPoint = (e) => {
  if (e.pa && SF.primAnchor) { const q = SF.primAnchor(e.pa.pid, e.pa.at); if (q) return q; }
  if (e.ref) { const f = SF.findItem(e.ref); if (f && f.it.t === 'path' && e.k < f.it.pts.length / 3) return { x: f.it.pts[e.k * 3], y: f.it.pts[e.k * 3 + 1] }; }
  return { x: e.x, y: e.y };
};
SF.dimGeom = (it) => {
  const a = SF.dimPoint(it.a), b = SF.dimPoint(it.b);
  let dx = b.x - a.x, dy = b.y - a.y;
  if (it.axis === 'h') dy = 0; else if (it.axis === 'v') dx = 0;
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  let a2, b2;
  if (it.axis === 'h') { const yy = Math.min(a.y, b.y) + it.off; a2 = { x: a.x, y: yy }; b2 = { x: b.x, y: yy }; }
  else if (it.axis === 'v') { const xx = Math.max(a.x, b.x) + it.off; a2 = { x: xx, y: a.y }; b2 = { x: xx, y: b.y }; }
  else if (it.extVP != null && SF.doc && SF.doc.guides.vps[it.extVP]) {
    /* perspective: each extension line heads for the vanishing point of its plane */
    const v = SF.doc.guides.vps[it.extVP], ua = Math.hypot(v.x - a.x, v.y - a.y) || 1, ub = Math.hypot(v.x - b.x, v.y - b.y) || 1;
    a2 = { x: a.x + (v.x - a.x) / ua * it.off, y: a.y + (v.y - a.y) / ua * it.off }; b2 = { x: b.x + (v.x - b.x) / ub * it.off, y: b.y + (v.y - b.y) / ub * it.off };
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, um = Math.hypot(v.x - m.x, v.y - m.y) || 1;
    return { a, b, a2, b2, len, ux, uy, nx: (v.x - m.x) / um, ny: (v.y - m.y) / um, ex: (v.x - m.x) / um, ey: (v.y - m.y) / um, plane: true, lx: (a2.x + b2.x) / 2, ly: (a2.y + b2.y) / 2 };
  }
  else if (it.ext != null) {
    /* follow a plane: extension lines run along one of the drawing space's axes (iso 30°/150°/90°, grid, etc.) */
    const ex = Math.cos(it.ext), ey = Math.sin(it.ext);
    a2 = { x: a.x + ex * it.off, y: a.y + ey * it.off }; b2 = { x: b.x + ex * it.off, y: b.y + ey * it.off };
    return { a, b, a2, b2, len, ux, uy, nx: ex, ny: ey, ex, ey, plane: true, lx: (a2.x + b2.x) / 2, ly: (a2.y + b2.y) / 2 };
  }
  else { a2 = { x: a.x + nx * it.off, y: a.y + ny * it.off }; b2 = { x: b.x + nx * it.off, y: b.y + ny * it.off }; }
  return { a, b, a2, b2, len, ux, uy, nx, ny, lx: (a2.x + b2.x) / 2, ly: (a2.y + b2.y) / 2 };
};
/* extension-line choices for a dimension in the current drawing space (never parallel to what's measured) */
SF.dimExtCandidates = (a, b) => {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, u = Math.atan2(b.y - a.y, b.x - a.x), out = [];
  for (const d of SF.guideDirs ? SF.guideDirs(m.x, m.y) : []) {
    if (U.angDiff(d.a, u) < 0.2) continue;
    out.push(d.vp != null ? { extVP: d.vp, a: d.a } : { ext: d.a, a: d.a });
  }
  return out;
};
SF.fmtLen = (px) => {
  const p = SF.prefs, v = px * (p.unitScale || 1);
  const prec = p.dimPrec != null ? p.dimPrec : 0;
  return v.toFixed(prec) + (p.units && p.units !== 'px' ? ' ' + p.units : '');
};

/* ---------------- view ---------------- */
SF.view = { x: 0, y: 0, z: 1 };
SF.toDoc = (sx, sy) => ({ x: (sx - SF.view.x) / SF.view.z, y: (sy - SF.view.y) / SF.view.z });
SF.toScreen = (x, y) => ({ x: x * SF.view.z + SF.view.x, y: y * SF.view.z + SF.view.y });
SF.fit = () => {
  const W = innerWidth, Hh = innerHeight, d = SF.doc; if (!d) return;
  const narrow = W < 760;
  const padX = narrow ? 24 : 150, padTop = narrow ? 70 : 74, padBot = narrow ? 180 : 80;
  const z = Math.min((W - padX) / d.w, (Hh - padTop - padBot) / d.h);
  SF.view.z = U.clamp(z, 0.05, 8);
  SF.view.x = (W - d.w * SF.view.z) / 2;
  SF.view.y = padTop + (Hh - padTop - padBot - d.h * SF.view.z) / 2;
  SF.emit('view'); SF.requestRender();
};
SF.zoomAt = (sx, sy, factor) => {
  const z0 = SF.view.z, z1 = U.clamp(z0 * factor, 0.05, 16);
  SF.view.x = sx - (sx - SF.view.x) * (z1 / z0);
  SF.view.y = sy - (sy - SF.view.y) * (z1 / z0);
  SF.view.z = z1; SF.emit('view'); SF.requestRender();
};

/* layers needing a drawable target */
SF.drawTarget = () => {
  let L = SF.layer();
  if (!L) return null;
  if (L.locked) { SF.toast('This layer is locked — unlock it in Layers'); return null; }
  if (L.ref) {
    const idx = SF.layerIndex(L.id);
    const above = SF.doc.layers[idx + 1];
    if (above && !above.ref && !above.locked) { SF.doc.active = above.id; L = above; }
    else { const nl = SF.mkLayer('Ink'); SF.doc.layers.splice(idx + 1, 0, nl); SF.doc.active = nl.id; L = nl; SF.toast('Reference layers stay clean — drawing on new layer “Ink”'); }
    SF.emit('layers');
  }
  if (!L.visible) { L.visible = true; SF.emit('layers'); }
  return L;
};

/* ---------------- bound fills: fill shapes whose outline is tied to other items' vertices ---------------- */
/* ref forms: {id,k} = vertex k of item id;  {a:{id,k}, b:{id,k}} = crossing of segment a(k→k+1) with segment b(k→k+1) */
const resolveCache = new WeakMap();
function refPoint(map, r) {
  if (r.a && r.b) {
    const A = map.get(r.a.id), B = map.get(r.b.id); if (!A || !B) return null;
    const na = A.pts.length / 3, nb = B.pts.length / 3;
    if (r.a.k + 1 >= na + (A.closed ? 1 : 0) || r.b.k + 1 >= nb + (B.closed ? 1 : 0)) return null;
    const a1 = r.a.k, a2 = (r.a.k + 1) % na, b1 = r.b.k, b2 = (r.b.k + 1) % nb;
    const x1 = A.pts[a1 * 3], y1 = A.pts[a1 * 3 + 1], x2 = A.pts[a2 * 3], y2 = A.pts[a2 * 3 + 1];
    const x3 = B.pts[b1 * 3], y3 = B.pts[b1 * 3 + 1], x4 = B.pts[b2 * 3], y4 = B.pts[b2 * 3 + 1];
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(den) < 1e-9) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  }
  if (r.c) return SF.curvePoint(map.get(r.c.id), r.c.k, r.t);
  const it = map.get(r.id); if (!it || r.k >= it.pts.length / 3) return null;
  return { x: it.pts[r.k * 3], y: it.pts[r.k * 3 + 1] };
}
/* point on the smoothed (quadratic-midpoint) curve of a free/smooth path: segment around vertex k, parameter t */
SF.curvePoint = (it, k, t) => {
  if (!it) return null;
  const P = it.pts, n = P.length / 3; if (n < 3 || k >= n) return null;
  const pt = (i) => ({ x: P[((i + n) % n) * 3], y: P[((i + n) % n) * 3 + 1] });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let s0, c, e;
  if (it.closed) { s0 = mid(pt(k - 1), pt(k)); c = pt(k); e = mid(pt(k), pt(k + 1)); }
  else { if (k < 1 || k > n - 2) return null; s0 = k === 1 ? pt(0) : mid(pt(k - 1), pt(k)); c = pt(k); e = mid(pt(k), pt(k + 1)); }
  const m = 1 - t;
  return { x: m * m * s0.x + 2 * m * t * c.x + t * t * e.x, y: m * m * s0.y + 2 * m * t * c.y + t * t * e.y };
};
function resolveLoop(map, pts, bind) {
  let changed = false; const P = pts.slice();
  for (let i = 0; i < bind.length; i++) {
    if (!bind[i]) continue;
    const q = refPoint(map, bind[i]); if (!q) continue;
    if (Math.abs(P[i * 3] - q.x) > 1e-6 || Math.abs(P[i * 3 + 1] - q.y) > 1e-6) { P[i * 3] = q.x; P[i * 3 + 1] = q.y; changed = true; }
  }
  return changed ? P : pts;
}
/* connector anchors on line ends: {mid:{id,k}} = midpoint of segment k of item id, {ctr:id} = centre of item id */
function anchorPoint(map, ref, selfId) {
  if (ref.mid) {
    const A = map.get(ref.mid.id); if (!A || A.id === selfId) return null;
    const n = A.pts.length / 3, k = ref.mid.k, k2 = (k + 1) % n; if (k >= n || (!A.closed && k2 === 0)) return null;
    return { x: (A.pts[k * 3] + A.pts[k2 * 3]) / 2, y: (A.pts[k * 3 + 1] + A.pts[k2 * 3 + 1]) / 2 };
  }
  if (ref.ctr) { const A = map.get(ref.ctr); return A && A.id !== selfId ? SF.itemCenter(A) : null; }
  return null;
}
SF.resolveItems = (items) => {
  if (!items || !items.length) return items;
  let r = resolveCache.get(items); if (r) return r;
  if (!items.some(i => i.bind || i.surf || i.anc)) { resolveCache.set(items, items); return items; }
  const map = new Map(); for (const it of items) if (it.t === 'path' && !it.bind) map.set(it.id, it);
  let any = false, cur = items;
  if (items.some(i => i.anc)) {
    for (let pass = 0; pass < 2; pass++) {
      cur = cur.map(it => {
        if (!it.anc || it.t !== 'path') return it;
        const n = it.pts.length / 3; let o = it;
        for (const [key, k] of [['s', 0], ['e', n - 1]]) {
          const ref = it.anc[key]; if (!ref) continue;
          const q = anchorPoint(map, ref, it.id); if (!q) continue;
          if (Math.abs(o.pts[k * 3] - q.x) > 1e-6 || Math.abs(o.pts[k * 3 + 1] - q.y) > 1e-6) o = SF.moveVertex(o, k, q.x, q.y);
        }
        if (o !== it) { any = true; map.set(o.id, o); }
        return o;
      });
    }
  }
  const out = cur.map(it => {
    if (it.t === 'text' && it.surf && it.quad) { const q = resolveLoop(map, it.quad, it.surf); if (q === it.quad) return it; any = true; return Object.assign({}, it, { quad: q }); }
    if (!it.bind) return it;
    const pts = resolveLoop(map, it.pts, it.bind);
    let holes = it.holes, hc = false;
    if (holes) holes = holes.map(h => { const hp = resolveLoop(map, h.pts, h.bind); if (hp !== h.pts) { hc = true; return Object.assign({}, h, { pts: hp }); } return h; });
    if (pts === it.pts && !hc) return it;
    any = true; return Object.assign({}, it, { pts, holes });
  });
  r = any ? out : items;
  resolveCache.set(items, r); if (r !== items) resolveCache.set(r, r);
  return r;
};

/* centre of an item (closed shapes, arcs, straight lines) — used by centre snaps and connectors */
SF.itemCenter = (it) => {
  if (!it || it.t !== 'path') return null;
  const P = it.pts, n = P.length / 3; if (n < 2) return null;
  if (it.shape === 'arc' && n >= 3 && !it.closed) {
    const a = { x: P[0], y: P[1] }, m = { x: P[Math.floor(n / 2) * 3], y: P[Math.floor(n / 2) * 3 + 1] }, b = { x: P[(n - 1) * 3], y: P[(n - 1) * 3 + 1] };
    const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y)); if (Math.abs(d) < 1e-9) return null;
    return { x: ((a.x * a.x + a.y * a.y) * (m.y - b.y) + (m.x * m.x + m.y * m.y) * (b.y - a.y) + (b.x * b.x + b.y * b.y) * (a.y - m.y)) / d, y: ((a.x * a.x + a.y * a.y) * (b.x - m.x) + (m.x * m.x + m.y * m.y) * (a.x - b.x) + (b.x * b.x + b.y * b.y) * (m.x - a.x)) / d };
  }
  if (!it.closed) return n === 2 ? { x: (P[0] + P[3]) / 2, y: (P[1] + P[4]) / 2 } : null;
  if (it.mode === 'poly') {
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, cr = P[i * 3] * P[j * 3 + 1] - P[j * 3] * P[i * 3 + 1]; A += cr; cx += (P[i * 3] + P[j * 3]) * cr; cy += (P[i * 3 + 1] + P[j * 3 + 1]) * cr; }
    if (Math.abs(A) > 1e-6) return { x: cx / (3 * A), y: cy / (3 * A) };
  }
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += P[i * 3]; sy += P[i * 3 + 1]; } return { x: sx / n, y: sy / n };
};
/* snap targets per items array: segment midpoints and shape centres */
const tgtCache = new WeakMap();
SF.snapTargets = (items) => {
  let T = tgtCache.get(items); if (T) return T;
  T = { mids: [], ctrs: [] };
  for (const it of items) {
    if (it.t !== 'path' || it.bind || it.hidden || it.pts.length < 6 || (it.prim && it.stroke === false) || it.lt === 'center') continue;
    const n = it.pts.length / 3;
    if (it.mode === 'poly') { const m = n - 1 + (it.closed ? 1 : 0); for (let k = 0; k < m; k++) { const k2 = (k + 1) % n; T.mids.push({ x: (it.pts[k * 3] + it.pts[k2 * 3]) / 2, y: (it.pts[k * 3 + 1] + it.pts[k2 * 3 + 1]) / 2, ref: { mid: { id: it.id, k } } }); } }
    if (it.closed || it.shape === 'arc') { const c = SF.itemCenter(it); if (c) T.ctrs.push({ x: c.x, y: c.y, ref: { ctr: it.id } }); }
  }
  tgtCache.set(items, T); return T;
};

/* line types: solid (default), dashed (hidden edges), center (dash-dot), construction (guides: never printed or exported, never block fills) */
SF.LINE_TYPES = { solid: 'Solid', dashed: 'Dashed', center: 'Centre', construction: 'Construction' };
SF.lineType = (it) => it.lt || (it.dash ? 'dashed' : 'solid');
SF.isWall = (it) => it.t === 'path' && it.stroke !== false && SF.lineType(it) === 'solid';

/* ---------------- item kinds (for the layer tree) ---------------- */
SF.GROUPS = ['3D', 'Lines', 'Strokes', 'Rectangles', 'Circles', 'Triangles', 'Polygons', 'Fills', 'Text', 'Dimensions', 'Images'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
SF.kindOf = (it) => {
  if (it.t === 'text') return { group: 'Text', label: it.quad ? 'Text on surface' : it.pathId ? 'Text on path' : 'Text' };
  if (it.t === 'dim') return { group: 'Dimensions', label: 'Dimension' };
  if (it.t === 'image') return it.fill ? { group: 'Fills', label: 'Fill' } : { group: 'Images', label: it.name || 'Image' };
  if (it.t !== 'path') return { group: 'Polygons', label: 'Item' };
  if (it.bind || it.shape === 'fill') return { group: 'Fills', label: it.bind ? 'Shape fill' : 'Fill' };
  if (it.prim) return { group: '3D', label: cap(it.prim) + ' part' };
  const n = it.pts.length / 3, sh = it.shape;
  if (sh === 'arrow' || (it.arrow && !it.closed)) return { group: 'Lines', label: 'Arrow' };
  if (['star', 'hexagon', 'diamond', 'box'].includes(sh)) return { group: 'Polygons', label: sh === 'box' ? 'Iso box' : cap(sh) };
  if (sh === 'arc') return { group: 'Strokes', label: 'Arc' };
  if (it.mode === 'poly') {
    if (!it.closed) return n <= 2 ? { group: 'Lines', label: 'Line' } : { group: 'Lines', label: 'Polyline' };
    if (n === 3) return { group: 'Triangles', label: 'Triangle' };
    if (n === 4) {
      const P = it.pts; let axis = true;
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; if (Math.abs(P[i * 3] - P[j * 3]) > 0.5 && Math.abs(P[i * 3 + 1] - P[j * 3 + 1]) > 0.5) axis = false; }
      if (axis) { const b = G.ptsBox([0, 1, 2, 3].map(i => ({ x: P[i * 3], y: P[i * 3 + 1] }))); return { group: 'Rectangles', label: Math.abs(b.w - b.h) <= Math.max(b.w, b.h) * 0.04 ? 'Square' : 'Rectangle' }; }
      return { group: 'Rectangles', label: 'Quad' };
    }
    return { group: 'Polygons', label: 'Polygon' };
  }
  if (it.closed && (it.mode === 'smooth' || sh === 'ellipse' || sh === 'circle')) {
    const b = G.bbox(it); return { group: 'Circles', label: Math.abs(b.w - b.h) <= Math.max(b.w, b.h) * 0.05 ? 'Circle' : 'Ellipse' };
  }
  return { group: 'Strokes', label: it.brush && it.brush !== 'shape' && it.brush !== 'pen' ? cap(it.brush) + ' stroke' : 'Stroke' };
};
/* paint-aware colour of an item (what its swatch shows) */
SF.itemColor = (it) => (it.t === 'path' && it.stroke === false && it.fill ? it.fill : it.t === 'image' ? (it.fill || null) : it.color);
SF.recolorItem = (it, c) => {
  if (it.t === 'path') { const o = Object.assign({}, it); if (it.stroke !== false) o.color = c; if (it.fill) o.fill = c; if (it.stroke === false) o.color = c; return o; }
  if (it.t === 'image' && it.fill) return Object.assign({}, it, { img: SF.retint(it.img, c), fill: c });
  if (it.t === 'text' || it.t === 'dim') return Object.assign({}, it, { color: c });
  return it;
};
/* distinct colours from the current palette, one per type (farthest-point pick, skipping colours close to the paper) */
SF.typeColors = () => {
  const pal = (SF.PALETTES[SF.prefs.palette] || SF.PALETTES.ink).c.map(c => U.normColor(c));
  const paper = SF.doc && SF.doc.paper !== 'transparent' ? SF.doc.paper : '#ffffff';
  let cands = pal.filter(c => Math.abs(U.luma(c) - U.luma(paper)) > 0.14);
  if (cands.length < 2) cands = pal.slice();
  const d2 = (a, b) => { const x = U.hexToRgb(a), y = U.hexToRgb(b); return (x[0] - y[0]) ** 2 * 0.3 + (x[1] - y[1]) ** 2 * 0.59 + (x[2] - y[2]) ** 2 * 0.11; };
  const order = [cands[0]];
  while (order.length < cands.length) { let best = null, bd = -1; for (const c of cands) { if (order.includes(c)) continue; const m = Math.min(...order.map(o => d2(o, c))); if (m > bd) { bd = m; best = c; } } order.push(best); }
  const map = {}; SF.GROUPS.forEach((g, i) => { map[g] = order[i % order.length]; });
  return map;
};
SF.autoColor = (items) => {
  if (!SF.prefs.autoTypeColor) return items;
  const tc = SF.typeColors();
  return items.map(it => (it.t === 'image' && !it.fill ? it : SF.recolorItem(it, tc[SF.kindOf(it).group])));
};

/* turn text-on-a-line into free text sitting exactly where it is now */
SF.detachPathText = (it) => {
  const f = it.pathId && SF.findItem(it.pathId), L = f && SF.pathTextLayout(it, f.it);
  const o = Object.assign({}, it, { pathId: null, offset: 0, lift: 0, align: 'left' });
  if (!L || !L.glyphs.length) return o;
  /* free text is drawn from its top-left corner: step back half a glyph from the first glyph centre, then up past the baseline */
  const g0 = L.glyphs[0], a = g0.a, px = g0.x - Math.cos(a) * g0.w / 2, py = g0.y - Math.sin(a) * g0.w / 2;
  const up = -L.lift - it.size * 0.8;
  o.x = px - Math.sin(a) * up; o.y = py + Math.cos(a) * up; o.r = a;
  return o;
};

/* ---------------- text on a surface (any 4-sided face: iso, perspective, flat) ---------------- */
/* it.quad = [x,y,p]*4 corners TL,TR,BR,BL of the face (resolved from it.surf refs so it follows the face);
   the text is laid out on a flat "page" (pw x ph, measured along the face) and mapped onto the quad */
SF.quadMap = (Q) => {
  const x0 = Q[0], y0 = Q[1], x1 = Q[3], y1 = Q[4], x2 = Q[6], y2 = Q[7], x3 = Q[9], y3 = Q[10];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g = 0, h = 0;
  const size = Math.max(1, Math.abs(x1 - x0) + Math.abs(y3 - y0) + Math.abs(x2 - x3) + Math.abs(y2 - y1));
  const affine = Math.abs(dx3) + Math.abs(dy3) < size * 0.004;
  if (affine) { a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; }
  else {
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return { affine, map: (u, v) => { const w = g * u + h * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; } };
};
const surfCache = new WeakMap();
SF.surfaceLayout = (it) => {
  if (!it.quad) return null;
  let S = surfCache.get(it); if (S) return S;
  const Q = it.quad, P = (i) => ({ x: Q[i * 3], y: Q[i * 3 + 1] });
  const p0 = P(0), p1 = P(1), p2 = P(2), p3 = P(3);
  const pw = Math.max(1, (Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p3.x, p2.y - p3.y)) / 2);
  const ph = Math.max(1, (Math.hypot(p3.x - p0.x, p3.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y)) / 2);
  const m = G.textMetrics(Object.assign({}, it, { text: it.text || ' ' }));
  /* auto-fit: shrink to fit the face with a margin (never enlarge) */
  const k = it.fit === false ? 1 : Math.min(1, (pw * 0.9) / Math.max(1, m.w), (ph * 0.9) / Math.max(1, m.h));
  const bw = m.w * k, bh = m.h * k;
  const cx = pw / 2 + (it.su || 0), cy = ph / 2 + (it.sv || 0);
  const bx0 = it.align === 'left' ? pw * 0.05 + (it.su || 0) : it.align === 'right' ? pw * 0.95 - bw + (it.su || 0) : cx - bw / 2;
  const by0 = cy - bh / 2;
  const qm = SF.quadMap(Q), toDoc = (x, y) => qm.map(x / pw, y / ph);
  const corners = [toDoc(bx0, by0), toDoc(bx0 + bw, by0), toDoc(bx0 + bw, by0 + bh), toDoc(bx0, by0 + bh)];
  const center = toDoc(bx0 + bw / 2, by0 + bh / 2);
  S = { Q, pw, ph, k, m, bx0, by0, bw, bh, qm, toDoc, corners, center, affine: qm.affine,
    ax: (p1.x - p0.x) / pw, ay: (p1.y - p0.y) / pw, bx: (p3.x - p0.x) / ph, by: (p3.y - p0.y) / ph };
  surfCache.set(it, S); return S;
};
function orderFace(c) {
  /* clockwise on screen, then start at the edge that points most to the right (that edge is the text's top) */
  if (G.polyArea(c) < 0) c.reverse();
  let best = 0, bd = Infinity;
  for (let i = 0; i < 4; i++) { const p = c[i], q = c[(i + 1) % 4], ang = Math.atan2(q.y - p.y, q.x - p.x), score = Math.abs(ang) + (ang > 0 ? 0.001 : 0); if (score < bd) { bd = score; best = i; } }
  const ord = [0, 1, 2, 3].map(i => c[(best + i) % 4]);
  return { refs: ord.map(o => o.ref), quad: ord.flatMap(o => [o.x, o.y, 0.5]) };
}
/* find a 4-sided face around a point from the lines that enclose it (same outline finder as the hold-fill) */
SF.findFace = (x, y) => {
  if (!SF.shapeFillAt) return null;
  const f = SF.shapeFillAt(x, y, '#000000', { noCommit: true }); if (!f) return { error: 'No closed outline here' };
  const n = f.pts.length / 3, pts = []; for (let i = 0; i < n; i++) pts.push({ x: f.pts[i * 3], y: f.pts[i * 3 + 1], ref: f.bind[i] });
  const corners = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let t = Math.abs(a2 - a1); if (t > Math.PI) t = 2 * Math.PI - t;
    if (t > 0.3) corners.push(b);
  }
  if (corners.length !== 4) return { error: corners.length < 3 ? 'No flat face here' : 'That face has ' + corners.length + ' corners — surfaces need 4' };
  return orderFace(corners);
};
/* bind a text to a closed 4-corner path item */
SF.faceOfItem = (it) => {
  if (!it || it.t !== 'path' || !it.closed || it.pts.length / 3 !== 4) return null;
  return orderFace([0, 1, 2, 3].map(k => ({ x: it.pts[k * 3], y: it.pts[k * 3 + 1], ref: { id: it.id, k } })));
};
/* free quad from four points (AI / API use) */
SF.faceOfPoints = (pts) => orderFace(pts.slice(0, 4).map(p => ({ x: +p[0], y: +p[1], ref: null })));
SF.turnOnSurface = (it) => {
  if (!it.quad) return it;
  const q = it.quad, s = it.surf || [];
  return Object.assign({}, it, { quad: q.slice(3).concat(q.slice(0, 3)), surf: s.length === 4 ? s.slice(1).concat(s.slice(0, 1)) : s, su: 0, sv: 0 });
};
SF.detachSurfaceText = (it) => {
  const S = SF.surfaceLayout(it); const o = Object.assign({}, it, { quad: null, surf: null, su: 0, sv: 0, align: 'left' });
  if (!S) return o;
  o.x = S.corners[0].x; o.y = S.corners[0].y; o.r = Math.atan2(S.corners[1].y - S.corners[0].y, S.corners[1].x - S.corners[0].x); o.size = Math.max(4, it.size * S.k);
  return o;
};

})(window.SF);
