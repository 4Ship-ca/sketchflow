/* SketchFlow renderer: item drawing, layer caches, guides for drawing spaces, overlays, offscreen export rendering. */
(function (SF) {
'use strict';
const U = SF.U, G = SF.G;

const cv = U.$('#cv');
const ctx = cv.getContext('2d');
SF.cv = cv; SF.ctx = ctx;
SF.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
SF.colors = {};
SF.readColors = () => {
  const cs = getComputedStyle(document.documentElement);
  ['desk', 'ink', 'ink-2', 'ink-3', 'accent', 'ai', 'cool', 'guide1', 'guide2', 'guide3', 'gridc', 'joint', 'line', 'pill-solid', 'warn', 'ok'].forEach(k => { SF.colors[k] = cs.getPropertyValue('--' + k).trim() || '#888'; });
};
SF.resize = () => {
  SF.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(innerWidth * SF.dpr); cv.height = Math.round(innerHeight * SF.dpr);
  layerCache.clear(); SF.requestRender();
};

/* ---------- render scheduling ---------- */
let rafId = 0;
SF.requestRender = () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; try { render(); } catch (e) { console.error(e); } }); };

/* ---------- path tracing (shared by canvas and SVG) ---------- */
/* sink: {M(x,y), L(x,y), Q(cx,cy,x,y), Z()} */
SF.tracePts = (sink, P, closed, smooth) => {
  const n = P.length / 3;
  if (n === 0) return;
  if (n === 1) { sink.M(P[0], P[1]); sink.L(P[0] + 0.01, P[1]); return; }
  if (!smooth || n < 3) {
    sink.M(P[0], P[1]); for (let i = 1; i < n; i++) sink.L(P[i * 3], P[i * 3 + 1]); if (closed) sink.Z(); return;
  }
  if (closed) {
    const mx = (P[(n - 1) * 3] + P[0]) / 2, my = (P[(n - 1) * 3 + 1] + P[1]) / 2;
    sink.M(mx, my);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; sink.Q(P[i * 3], P[i * 3 + 1], (P[i * 3] + P[j * 3]) / 2, (P[i * 3 + 1] + P[j * 3 + 1]) / 2); }
    sink.Z(); return;
  }
  sink.M(P[0], P[1]);
  for (let i = 1; i < n - 1; i++) sink.Q(P[i * 3], P[i * 3 + 1], (P[i * 3] + P[i * 3 + 3]) / 2, (P[i * 3 + 1] + P[i * 3 + 4]) / 2);
  sink.L(P[(n - 1) * 3], P[(n - 1) * 3 + 1]);
};
const ctxSink = (c) => ({ M: (x, y) => c.moveTo(x, y), L: (x, y) => c.lineTo(x, y), Q: (a, b, x, y) => c.quadraticCurveTo(a, b, x, y), Z: () => c.closePath() });

/* pressure → width factor per brush */
SF.pfac = (brush, p) => {
  if (p == null) p = 0.5;
  switch (brush) {
    case 'pencil': return 0.55 + 0.45 * p;
    case 'brush': return 0.08 + 0.92 * Math.pow(p, 1.2);
    case 'marker': return 1;
    default: return 0.35 + 0.65 * p;
  }
};
/* outline polygon for pressure-varying strokes → flat [x,y,0,...] closed, smooth */
SF.outline = (it) => {
  const P = it.pts, n = P.length / 3, out = [], L = [], R = [];
  const W = (i) => Math.max(0.3, it.width * SF.pfac(it.brush, P[i * 3 + 2]) / 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let tx = P[b * 3] - P[a * 3], ty = P[b * 3 + 1] - P[a * 3 + 1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const w = W(i);
    L.push(P[i * 3] - ty * w, P[i * 3 + 1] + tx * w); R.push(P[i * 3] + ty * w, P[i * 3 + 1] - tx * w);
  }
  const cap = (cx, cy, w, ang0) => { const pts = []; for (let k = 1; k < 8; k++) { const a = ang0 + Math.PI * k / 8; pts.push(cx + Math.cos(a) * w, cy + Math.sin(a) * w); } return pts; };
  for (let i = 0; i < L.length; i += 2) out.push(L[i], L[i + 1], 0);
  { const i = n - 1, a = Math.max(0, i - 1); const ang = Math.atan2(P[i * 3 + 1] - P[a * 3 + 1], P[i * 3] - P[a * 3]) + Math.PI / 2; const c = cap(P[i * 3], P[i * 3 + 1], W(i), ang); for (let k = 0; k < c.length; k += 2) out.push(c[k], c[k + 1], 0); }
  for (let i = R.length - 2; i >= 0; i -= 2) out.push(R[i], R[i + 1], 0);
  { const b = Math.min(n - 1, 1); const ang = Math.atan2(P[1] - P[b * 3 + 1], P[0] - P[b * 3]) + Math.PI / 2; const c = cap(P[0], P[1], W(0), ang); for (let k = 0; k < c.length; k += 2) out.push(c[k], c[k + 1], 0); }
  return out;
};
SF.isPV = (it) => it.pv && it.brush !== 'marker' && it.mode !== 'poly' && it.pts.length >= 9;

/* pencil grain pattern per colour */
const grain = new Map();
function pencilPattern(c, color) {
  let g = grain.get(color);
  if (!g) {
    g = U.canvas(64, 64); const x = g.getContext('2d'); const im = x.createImageData(64, 64); const [r, gg, b] = U.hexToRgb(color);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < im.data.length; i += 4) { im.data[i] = r; im.data[i + 1] = gg; im.data[i + 2] = b; im.data[i + 3] = rnd() < 0.62 ? 150 + rnd() * 105 : rnd() * 70; }
    x.putImageData(im, 0, 0); grain.set(color, g); if (grain.size > 40) grain.delete(grain.keys().next().value);
  }
  return c.createPattern(g, 'repeat');
}

/* ---------- item drawing ---------- */
function arrowHead(c, it) {
  const P = it.pts, n = P.length / 3; if (n < 2) return;
  let i = n - 2; while (i > 0 && Math.hypot(P[(n - 1) * 3] - P[i * 3], P[(n - 1) * 3 + 1] - P[i * 3 + 1]) < it.width * 2) i--;
  const ex = P[(n - 1) * 3], ey = P[(n - 1) * 3 + 1], a = Math.atan2(ey - P[i * 3 + 1], ex - P[i * 3]);
  const L = Math.max(10, it.width * 4.2), Wd = L * 0.55;
  c.beginPath(); c.moveTo(ex + Math.cos(a) * it.width * 0.6, ey + Math.sin(a) * it.width * 0.6);
  c.lineTo(ex - Math.cos(a) * L + Math.cos(a + Math.PI / 2) * Wd, ey - Math.sin(a) * L + Math.sin(a + Math.PI / 2) * Wd);
  c.lineTo(ex - Math.cos(a) * L - Math.cos(a + Math.PI / 2) * Wd, ey - Math.sin(a) * L - Math.sin(a + Math.PI / 2) * Wd);
  c.closePath(); c.fillStyle = it.color; c.fill();
}
/* exception-safe wrapper: one malformed item can never leave the canvas state (clip/transform) dirty or blank a layer */
SF.drawItem = (c, it, ox) => {
  c.save();
  try { drawItemRaw(c, it, ox); }
  catch (err) { if (!SF._drawWarned) { SF._drawWarned = true; console.warn('Skipped an item that could not be drawn', it && it.id, err); } }
  finally { c.restore(); }
};
function drawItemRaw(c, it, ox) {
  ox = ox || {};
  c.save();
  c.globalAlpha *= (it.opacity == null ? 1 : it.opacity);
  if (it.t === 'path') {
    const smooth = it.mode !== 'poly';
    if (it.fill && it.closed) {
      c.beginPath(); SF.tracePts(ctxSink(c), it.pts, true, smooth);
      if (it.holes) for (const h of it.holes) SF.tracePts(ctxSink(c), h.pts, true, false);
      c.save(); c.globalAlpha *= (it.fillOpacity == null ? 1 : it.fillOpacity); c.fillStyle = it.fill; c.fill(it.holes ? 'evenodd' : 'nonzero'); c.restore();
    }
    if (it.stroke !== false) {
      const paint = it.brush === 'pencil' ? pencilPattern(c, it.color) : it.color;
      if (it.pts.length === 3) { c.beginPath(); c.arc(it.pts[0], it.pts[1], Math.max(0.5, it.width * SF.pfac(it.brush, it.pts[2]) / 2), 0, Math.PI * 2); c.fillStyle = paint; c.fill(); }
      else if (SF.isPV(it) && SF.lineType(it) === 'solid') { c.beginPath(); SF.tracePts(ctxSink(c), SF.outline(it), true, true); c.fillStyle = paint; c.fill(); }
      else {
        c.beginPath(); SF.tracePts(ctxSink(c), it.pts, it.closed, smooth);
        c.lineWidth = Math.max(0.3, it.width); c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = paint;
        const dash = SF.dashFor(it); if (dash) { c.setLineDash(dash); if (SF.lineType(it) !== 'solid') c.lineCap = 'butt'; }
        if (SF.lineType(it) === 'construction') c.globalAlpha *= 0.55;
        c.stroke();
      }
      if (it.arrow) arrowHead(c, it);
    }
  } else if (it.t === 'image') {
    c.translate(it.x, it.y); c.rotate(it.r || 0); c.scale(it.s * (it.fx ? -1 : 1), it.s * (it.fy ? -1 : 1));
    c.imageSmoothingQuality = 'high';
    c.drawImage(it.img, -it.iw / 2, -it.ih / 2);
  } else if (it.t === 'text') {
    drawText(c, it, ox);
  } else if (it.t === 'dim') {
    drawDim(c, it, ox);
  }
  c.restore();
}

/* text on a surface: lay the text out on the face's flat page, then map the page onto the quad */
const surfBmp = new WeakMap();
function drawSurfacePage(g, it, S) {
  const size = it.size * S.k, lh = size * 1.2;
  g.font = SF.fontCss(Object.assign({}, it, { size })); g.fillStyle = it.color; g.textBaseline = 'top'; g.textAlign = 'left';
  S.m.lines.forEach((ln, i) => {
    const lw = g.measureText(ln).width;
    const x = it.align === 'left' ? S.bx0 : it.align === 'right' ? S.bx0 + S.bw - lw : S.bx0 + (S.bw - lw) / 2;
    g.fillText(ln, x, S.by0 + i * lh + size * 0.08);
  });
}
function drawSurfaceText(c, it, ox) {
  const S = SF.surfaceLayout(it); if (!S) return;
  if (S.affine) { /* iso / parallelogram faces: exact skew, text stays vector-crisp */
    c.transform(S.ax, S.ay, S.bx, S.by, S.Q[0], S.Q[1]); drawSurfacePage(c, it, S); return;
  }
  /* perspective faces: render the page once, then warp it through a triangle mesh */
  const want = U.clamp((ox.z || 1) * SF.dpr * 1.3, 0.5, 4), sc = Math.min(want, 2400 / S.pw, 2400 / S.ph), key = Math.round(sc * 8) / 8;
  let bm = surfBmp.get(it);
  if (!bm || bm.key !== key) {
    const cv2 = U.canvas(S.pw * key, S.ph * key), g = cv2.getContext('2d'); g.scale(key, key); drawSurfacePage(g, it, S);
    bm = { key, c: cv2 }; surfBmp.set(it, bm);
  }
  const W = bm.c.width, H = bm.c.height, N = 12, pad = 0.6 / Math.max(0.05, ox.z || 1);
  const grid = []; for (let j = 0; j <= N; j++) { grid.push([]); for (let i = 0; i <= N; i++) grid[j].push(S.qm.map(i / N, j / N)); }
  const tri = (s0, s1, s2, d0, d1, d2) => {
    const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
    const ex = (p) => { const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * pad, y: p.y + dy / l * pad }; };
    const e0 = ex(d0), e1 = ex(d1), e2 = ex(d2);
    const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y); if (Math.abs(den) < 1e-9) return;
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den, b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
    const cc = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den, dd = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
    const e = d0.x - a * s0.x - cc * s0.y, f = d0.y - b * s0.x - dd * s0.y;
    c.save(); c.beginPath(); c.moveTo(e0.x, e0.y); c.lineTo(e1.x, e1.y); c.lineTo(e2.x, e2.y); c.closePath(); c.clip();
    c.transform(a, b, cc, dd, e, f);
    const x0 = Math.max(0, Math.min(s0.x, s1.x, s2.x) - 2), y0 = Math.max(0, Math.min(s0.y, s1.y, s2.y) - 2), x1 = Math.min(W, Math.max(s0.x, s1.x, s2.x) + 2), y1 = Math.min(H, Math.max(s0.y, s1.y, s2.y) + 2);
    if (x1 > x0 && y1 > y0) c.drawImage(bm.c, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    c.restore();
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s00 = { x: i / N * W, y: j / N * H }, s10 = { x: (i + 1) / N * W, y: j / N * H }, s01 = { x: i / N * W, y: (j + 1) / N * H }, s11 = { x: (i + 1) / N * W, y: (j + 1) / N * H };
    tri(s00, s10, s01, grid[j][i], grid[j][i + 1], grid[j + 1][i]);
    tri(s10, s11, s01, grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
  }
}
SF.drawSurfaceText = drawSurfaceText;
function drawText(c, it, ox) {
  if (it.quad) { drawSurfaceText(c, it, ox || {}); return; }
  c.font = SF.fontCss(it); c.fillStyle = it.color;
  const path = it.pathId ? SF.findItem(it.pathId) : null;
  const L = path ? SF.pathTextLayout(it, path.it) : null;
  if (L) {
    c.textBaseline = 'alphabetic';
    for (const g of L.glyphs) { c.save(); c.translate(g.x, g.y); c.rotate(g.a); c.fillText(g.ch, -g.w / 2, -L.lift); c.restore(); }
    return;
  }
  const m = G.textMetrics(it);
  c.translate(it.x, it.y); c.rotate(it.r || 0); c.textBaseline = 'top'; c.textAlign = it.align || 'left';
  m.lines.forEach((ln, i) => c.fillText(ln, 0, i * it.size * 1.2 + it.size * 0.08));
}

function drawDim(c, it, ox) {
  const g = SF.dimGeom(it); if (!g) return;
  const col = it.color || '#e8672c', w = it.width || 1.5, z = ox.z || 1;
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = w; c.lineCap = 'round';
  const ext = (p, q) => { const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy); if (l < 1) return; const ux = dx / l, uy = dy / l; c.beginPath(); c.moveTo(p.x + ux * 4, p.y + uy * 4); c.lineTo(q.x + ux * 8, q.y + uy * 8); c.stroke(); };
  c.save(); c.globalAlpha *= 0.7; ext(g.a, g.a2); ext(g.b, g.b2); c.restore();
  c.beginPath(); c.moveTo(g.a2.x, g.a2.y); c.lineTo(g.b2.x, g.b2.y); c.stroke();
  const ah = Math.max(8, w * 5), dx = g.b2.x - g.a2.x, dy = g.b2.y - g.a2.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  const head = (p, s) => { c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + s * ux * ah - uy * ah * 0.35, p.y + s * uy * ah + ux * ah * 0.35); c.lineTo(p.x + s * ux * ah + uy * ah * 0.35, p.y + s * uy * ah - ux * ah * 0.35); c.closePath(); c.fill(); };
  head(g.a2, 1); head(g.b2, -1);
  const realLen = Math.hypot(g.b2.x - g.a2.x, g.b2.y - g.a2.y);
  const label = it.label || SF.fmtLen(realLen);
  const fs = it.size || 14;
  c.font = `600 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
  const tw = c.measureText(label).width;
  let ang = Math.atan2(dy, dx); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
  /* transparent label: text above the dimension line, thin paper-coloured halo so it reads over lines and fills */
  c.save(); c.translate(g.lx, g.ly);
  let skewed = false;
  if (g.plane && g.ex != null) {
    /* text lies in the dimension's plane: x along the dimension line, y along the extension lines */
    let ux = g.ux, uy = g.uy; if (ux < -1e-6 || (Math.abs(ux) < 1e-6 && uy > 0)) { ux = -ux; uy = -uy; }
    let vx = g.ex, vy = g.ey; if (ux * vy - uy * vx < 0) { vx = -vx; vy = -vy; }
    if (Math.abs(ux * vy - uy * vx) > 0.3) { c.transform(ux, uy, vx, vy, 0, 0); skewed = true; }
  }
  if (!skewed) c.rotate(ang);
  const halo = ox.paper || (SF.doc.paper === 'transparent' ? '#ffffff' : SF.doc.paper), ty = -(fs * 0.62 + w);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.lineWidth = Math.max(2.5, fs * 0.22); c.strokeStyle = halo; c.globalAlpha *= 0.9; c.strokeText(label, 0, ty); c.globalAlpha /= 0.9;
  c.fillStyle = col; c.fillText(label, 0, ty);
  void tw; void z;
  c.restore();
}

/* dash pattern per line type (in board px, scales with the line width) */
SF.dashFor = (it) => {
  const w = Math.max(1, it.width || 1), t = SF.lineType(it);
  if (t === 'dashed') return [w * 4, w * 2.6];
  if (t === 'center') return [w * 9, w * 2.6, w * 1.6, w * 2.6];
  if (t === 'construction') return [w * 6, w * 3.2];
  return null;
};
SF.drawItems = (c, items, vis, ox) => {
  for (const it of items) {
    if (it.hidden) continue;
    if (ox && ox.noConstruction && it.t === 'path' && SF.lineType(it) === 'construction') continue;
    if (vis && it.t !== 'dim' && it.t !== 'text') { const b = G.bbox(it); if (!G.boxHit(b, vis)) continue; }
    SF.drawItem(c, it, ox);
  }
};

/* ---------- layer caches (screen resolution, invalidated by items-array identity or view) ---------- */
const layerCache = new Map();
SF.invalidate = () => { layerCache.clear(); SF.requestRender(); };
SF.override = null;      /* {layerId, items}: live preview replacing a layer's items */
SF.live = null;          /* {layerId, item}: item being drawn, rendered above its layer */
SF.overlay = { snap: null, align: [], marquee: null, ring: null, hover: null, flash: null };
let settleTimer = 0;
function viewKey() { const v = SF.view; return v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.z.toFixed(5) + ',' + cv.width + 'x' + cv.height; }
function layerItems(L) { return SF.resolveItems(SF.override && SF.override.layerId === L.id ? SF.override.items : L.items); }
SF.layerItems = layerItems;
function getLayerCanvas(L, vk, allowStale) {
  let e = layerCache.get(L.id);
  const items = layerItems(L);
  if (e && e.items === items && e.vk === vk && e.paper === SF.doc.paper) return { c: e.c, rel: null };
  if (e && e.items === items && allowStale && e.paper === SF.doc.paper) {
    const v = SF.view, s = v.z / e.z;
    return { c: e.c, rel: [s, 0, 0, s, (v.x - e.x * s) * SF.dpr, (v.y - e.y * s) * SF.dpr] };
  }
  if (!e) { e = { c: U.canvas(cv.width, cv.height) }; layerCache.set(L.id, e); }
  if (e.c.width !== cv.width || e.c.height !== cv.height) { e.c.width = cv.width; e.c.height = cv.height; }
  const c = e.c.getContext('2d');
  /* start every redraw from a clean context: a clip left over from an earlier view would cut off items
     (and block clearRect) once the paper moved — that was the wheel-zoom clipping bug */
  if (typeof c.reset === 'function') c.reset(); else { e.c.width = e.c.width; }
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, e.c.width, e.c.height);
  const v = SF.view, d = SF.dpr;
  c.save();
  try {
    c.setTransform(d * v.z, 0, 0, d * v.z, d * v.x, d * v.y);
    c.beginPath(); c.rect(0, 0, SF.doc.w, SF.doc.h); c.clip();
    const tl = SF.toDoc(0, 0), br = SF.toDoc(innerWidth, innerHeight);
    SF.drawItems(c, items, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }, { z: v.z });
  } finally { c.restore(); }
  e.items = items; e.vk = vk; e.x = v.x; e.y = v.y; e.z = v.z; e.paper = SF.doc.paper;
  return { c: e.c, rel: null };
}

let checker = null;
function checkerPattern(c) {
  if (!checker) { checker = U.canvas(16, 16); const x = checker.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#e4e4e4'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8); }
  return c.createPattern(checker, 'repeat');
}

SF.gesturing = false;
function render() {
  const d = SF.doc; if (!d) return;
  const v = SF.view, dpr = SF.dpr, C = SF.colors;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = C.desk; ctx.fillRect(0, 0, cv.width, cv.height);
  /* paper */
  ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
  ctx.save(); ctx.shadowColor = '#0000004a'; ctx.shadowBlur = 18 * dpr; ctx.shadowOffsetY = 3 * dpr;
  ctx.fillStyle = d.paper === 'transparent' ? '#ffffff' : d.paper; ctx.fillRect(0, 0, d.w, d.h); ctx.restore();
  if (d.paper === 'transparent') { ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.beginPath(); const p0 = SF.toScreen(0, 0), p1 = SF.toScreen(d.w, d.h); ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y); ctx.fillStyle = checkerPattern(ctx); ctx.fill(); ctx.restore(); }
  drawSpaceUnder();
  /* layers */
  const vk = viewKey(), ai = SF.layerIndex(), stale = SF.gesturing;
  let needSettle = false;
  d.layers.forEach((L, i) => {
    if (!L.visible) return;
    const r = getLayerCanvas(L, vk, stale);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let a = L.opacity;
    if (d.guides.lightbox && i < ai) a *= SF.prefs.lightboxAmt;
    ctx.globalAlpha = a; ctx.globalCompositeOperation = L.blend || 'source-over';
    if (r.rel) { ctx.setTransform(...r.rel); needSettle = true; }
    ctx.drawImage(r.c, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (SF.live && SF.live.layerId === L.id && SF.live.item) {
      ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, d.w, d.h); ctx.clip(); ctx.globalAlpha = L.opacity;
      (Array.isArray(SF.live.item) ? SF.live.item : [SF.live.item]).forEach(it => SF.drawItem(ctx, it, { z: v.z }));
      ctx.restore();
    }
  });
  if (needSettle) { clearTimeout(settleTimer); settleTimer = setTimeout(() => { SF.gesturing = false; SF.requestRender(); }, 140); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSpaceOver();
  drawOverlays();
  SF.emit('rendered');
}

/* ---------- drawing-space guides ---------- */
const COS30 = Math.cos(Math.PI / 6);
function docLine(c, x1, y1, x2, y2) { const a = SF.toScreen(x1, y1), b = SF.toScreen(x2, y2); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
SF.viewQuad = (x, y) => { const d = SF.doc; return (x < d.w / 2 ? 'L' : 'R') + (y < d.h / 2 ? 'T' : 'B'); };
SF.VIEW_NAMES = { LT: 'TOP', LB: 'FRONT', RB: 'RIGHT SIDE', RT: 'ISO 3D' };

function squareGrid(c, x0, y0, x1, y1, g, color) {
  const z = SF.view.z; let step = g; while (step * z < 7) step *= 5;
  c.beginPath();
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) docLine(c, x, y0, x, y1);
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) docLine(c, x0, y, x1, y);
  c.strokeStyle = color; c.lineWidth = 1; c.stroke();
}
function isoGrid(c, x0, y0, x1, y1, g, color) {
  const z = SF.view.z; let step = g; while (step * z < 9) step *= 4;
  const dx = step * COS30; c.beginPath();
  for (let x = Math.ceil(x0 / dx) * dx; x <= x1; x += dx) docLine(c, x, y0, x, y1);
  const t = Math.tan(Math.PI / 6), span = (x1 - x0) * t;
  for (let k = Math.floor((y0 - span) / step) - 1; k * step <= y1 + span; k++) {
    const cc = k * step;
    docLine(c, x0, cc + (x0) * t, x1, cc + (x1) * t);
    docLine(c, x0, cc - (x0) * t, x1, cc - (x1) * t);
  }
  c.strokeStyle = color; c.lineWidth = 1; c.stroke();
}
function drawSpaceUnder() {
  const d = SF.doc, gd = d.guides, sp = gd.space, c = ctx, C = SF.colors;
  c.save(); c.setTransform(SF.dpr, 0, 0, SF.dpr, 0, 0);
  const p0 = SF.toScreen(0, 0), p1 = SF.toScreen(d.w, d.h);
  c.beginPath(); c.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y); c.clip();
  const gc = U.luma(d.paper === 'transparent' ? '#ffffff' : d.paper) > 0.5 ? '#2a3b5a22' : '#ffffff1c';
  if (sp === 'grid') squareGrid(c, 0, 0, d.w, d.h, gd.grid, gc);
  if (sp === 'iso') isoGrid(c, 0, 0, d.w, d.h, gd.grid, gc);
  if (sp === 'v3' || sp === 'v4') {
    const hw = d.w / 2, hh = d.h / 2;
    c.save(); c.beginPath(); const a = SF.toScreen(0, 0), b = SF.toScreen(hw, d.h); c.rect(a.x, a.y, b.x - a.x, b.y - a.y); const e = SF.toScreen(hw, hh), f = SF.toScreen(d.w, d.h); c.rect(e.x, e.y, f.x - e.x, f.y - e.y); c.clip();
    squareGrid(c, 0, 0, d.w, d.h, gd.grid, gc); c.restore();
    if (sp === 'v4') { c.save(); c.beginPath(); const g0 = SF.toScreen(hw, 0), g1 = SF.toScreen(d.w, hh); c.rect(g0.x, g0.y, g1.x - g0.x, g1.y - g0.y); c.clip(); isoGrid(c, hw, 0, d.w, hh, gd.grid, gc); c.restore(); }
    else { c.beginPath(); docLine(c, hw, hh, d.w, hh - (d.w - hw)); c.setLineDash([6, 6]); c.strokeStyle = C.guide2; c.globalAlpha = 0.6; c.stroke(); c.setLineDash([]); c.globalAlpha = 1; }
    c.beginPath(); docLine(c, hw, 0, hw, d.h); docLine(c, 0, hh, d.w, hh); c.strokeStyle = C.guide2; c.lineWidth = 1.5; c.globalAlpha = 0.55; c.stroke(); c.globalAlpha = 1;
    c.font = '700 11px "Figtree", system-ui, sans-serif'; c.fillStyle = C.guide2;
    [['LT', 0, 0], ['LB', 0, hh], ['RB', hw, hh], ['RT', hw, 0]].forEach(([k, x, y]) => { if (k === 'RT' && sp === 'v3') return; const s = SF.toScreen(x, y); c.fillText(SF.VIEW_NAMES[k], s.x + 8, s.y + 16); });
  }
  c.restore();
}
function drawSpaceOver() {
  const d = SF.doc, gd = d.guides, sp = gd.space, c = ctx, C = SF.colors;
  if (!/^p[123]$/.test(sp)) return;
  const n = +sp[1], cols = [C.guide1, C.guide2, C.guide3];
  const p0 = SF.toScreen(0, 0), p1 = SF.toScreen(d.w, d.h);
  c.save();
  /* horizon */
  const v1 = SF.toScreen(gd.vps[0].x, gd.vps[0].y);
  c.beginPath();
  if (n === 1) { c.moveTo(-10, v1.y); c.lineTo(innerWidth + 10, v1.y); }
  else { const v2 = SF.toScreen(gd.vps[1].x, gd.vps[1].y); const dx = v2.x - v1.x, dy = v2.y - v1.y, l = Math.hypot(dx, dy) || 1; c.moveTo(v1.x - dx / l * 5000, v1.y - dy / l * 5000); c.lineTo(v2.x + dx / l * 5000, v2.y + dy / l * 5000); }
  c.strokeStyle = C.ink; c.globalAlpha = 0.35; c.lineWidth = 1.2; c.stroke(); c.globalAlpha = 1;
  /* rays */
  c.beginPath(); c.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y); c.clip();
  for (let k = 0; k < n; k++) {
    const vp = SF.toScreen(gd.vps[k].x, gd.vps[k].y);
    const corners = [[p0.x, p0.y], [p1.x, p0.y], [p1.x, p1.y], [p0.x, p1.y]].map(([x, y]) => Math.atan2(y - vp.y, x - vp.x));
    const inside = vp.x > p0.x && vp.x < p1.x && vp.y > p0.y && vp.y < p1.y;
    let a0, a1;
    if (inside) { a0 = 0; a1 = Math.PI * 2; }
    else { const base = corners[0]; const rel = corners.map(a => { let r = a - base; while (r > Math.PI) r -= 2 * Math.PI; while (r < -Math.PI) r += 2 * Math.PI; return r; }); a0 = base + Math.min(...rel); a1 = base + Math.max(...rel); }
    const rays = inside ? 36 : 20;
    c.beginPath();
    for (let r = 0; r <= rays; r++) { const a = a0 + (a1 - a0) * r / rays; c.moveTo(vp.x, vp.y); c.lineTo(vp.x + Math.cos(a) * 6000, vp.y + Math.sin(a) * 6000); }
    c.strokeStyle = cols[k]; c.globalAlpha = 0.22; c.lineWidth = 1; c.stroke(); c.globalAlpha = 1;
  }
  c.restore();
  /* active snap ray */
  const o = SF.overlay;
  if (o.ray) { c.save(); c.beginPath(); const a = SF.toScreen(o.ray.x1, o.ray.y1), b = SF.toScreen(o.ray.x2, o.ray.y2); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = o.ray.color || C.accent; c.globalAlpha = 0.65; c.setLineDash([5, 5]); c.lineWidth = 1.5; c.stroke(); c.restore(); }
  /* pips */
  for (let k = 0; k < n; k++) {
    const s = SF.toScreen(gd.vps[k].x, gd.vps[k].y);
    const m = 18, cx = U.clamp(s.x, m, innerWidth - m), cy = U.clamp(s.y, m + 56, innerHeight - m - 60), off = cx !== s.x || cy !== s.y;
    SF.overlay['pip' + k] = { x: cx, y: cy };
    c.beginPath(); c.arc(cx, cy, 11, 0, Math.PI * 2); c.fillStyle = cols[k]; c.globalAlpha = 0.95; c.fill(); c.globalAlpha = 1;
    c.lineWidth = 2; c.strokeStyle = '#ffffff'; c.stroke();
    c.beginPath(); c.moveTo(cx - 5, cy); c.lineTo(cx + 5, cy); c.moveTo(cx, cy - 5); c.lineTo(cx, cy + 5); c.stroke();
    if (off) { const a = Math.atan2(s.y - cy, s.x - cx); c.beginPath(); c.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20); c.lineTo(cx + Math.cos(a + 0.5) * 13, cy + Math.sin(a + 0.5) * 13); c.lineTo(cx + Math.cos(a - 0.5) * 13, cy + Math.sin(a - 0.5) * 13); c.closePath(); c.fillStyle = cols[k]; c.fill(); }
    c.font = '700 10px "Figtree", sans-serif'; c.fillStyle = cols[k]; c.fillText('VP' + (k + 1), cx + 14, cy - 10);
  }
}

/* ---------- overlays ---------- */
function drawOverlays() {
  const c = ctx, C = SF.colors, o = SF.overlay, tool = SF.prefs.tool, z = SF.view.z;
  const L = SF.layer();
  /* joints */
  const showAll = tool === 'joint' || tool === 'dim' || (SF.motion && SF.motion.editing);
  const near = o.hover;
  if (L && L.visible && (showAll || ((tool === 'pen' || tool === 'shape') && near && SF.prefs.snap))) {
    const J = SF.joints(layerItems(L));
    for (const j of J) {
      const s = SF.toScreen(j.x, j.y);
      if (!showAll) { const dd = Math.hypot(s.x - near.x, s.y - near.y); if (dd > 70) continue; c.globalAlpha = 1 - dd / 70; }
      c.beginPath(); c.arc(s.x, s.y, j.joined ? 4.5 : 4, 0, Math.PI * 2);
      if (j.joined) { c.fillStyle = C.joint; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); }
      else { c.fillStyle = C['pill-solid']; c.fill(); c.strokeStyle = C.joint; c.lineWidth = 1.8; c.stroke(); }
      c.globalAlpha = 1;
    }
  }
  if (L && L.visible && near && (tool === 'pen' || tool === 'shape' || tool === 'joint' || tool === 'dim') && SF.prefs.snap) {
    const T2 = SF.snapTargets(layerItems(L));
    c.save(); c.strokeStyle = C.ai; c.lineWidth = 1.4;
    const mark = (list, fn) => { for (const q of list) { const s = SF.toScreen(q.x, q.y), dd = Math.hypot(s.x - near.x, s.y - near.y); if (dd > 80) continue; c.globalAlpha = 0.85 * (1 - dd / 80); c.beginPath(); fn(s); c.stroke(); } };
    if (SF.prefs.snapMid !== false) mark(T2.mids, (s) => { c.moveTo(s.x, s.y - 5); c.lineTo(s.x + 4.5, s.y + 3.5); c.lineTo(s.x - 4.5, s.y + 3.5); c.closePath(); });
    if (SF.prefs.snapCtr !== false) mark(T2.ctrs, (s) => { c.arc(s.x, s.y, 4.5, 0, Math.PI * 2); c.moveTo(s.x - 7, s.y); c.lineTo(s.x + 7, s.y); c.moveTo(s.x, s.y - 7); c.lineTo(s.x, s.y + 7); });
    c.restore(); c.globalAlpha = 1;
  }
  if (SF.motion && SF.motion.drawOverlay) SF.motion.drawOverlay(c);
  /* alignment lines */
  if (o.align && o.align.length) {
    c.save(); c.setLineDash([4, 4]); c.strokeStyle = C.cool; c.lineWidth = 1;
    for (const a of o.align) { c.beginPath(); const p = SF.toScreen(a.x1, a.y1), q = SF.toScreen(a.x2, a.y2); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke(); }
    c.restore();
  }
  /* snap indicator */
  if (o.snap) {
    const s = SF.toScreen(o.snap.x, o.snap.y);
    c.save(); c.strokeStyle = o.snap.kind === 'joint' ? C.joint : C.cool; c.lineWidth = 2;
    c.beginPath();
    if (o.snap.kind === 'mid' || o.snap.kind === 'ctr' || o.snap.kind === 'perp') c.strokeStyle = C.ai;
    if (o.snap.kind === 'joint') c.arc(s.x, s.y, 9, 0, Math.PI * 2);
    else if (o.snap.kind === 'seg') { c.moveTo(s.x - 7, s.y - 7); c.lineTo(s.x + 7, s.y + 7); c.moveTo(s.x + 7, s.y - 7); c.lineTo(s.x - 7, s.y + 7); }
    else if (o.snap.kind === 'mid') { c.moveTo(s.x, s.y - 9); c.lineTo(s.x + 8, s.y + 6); c.lineTo(s.x - 8, s.y + 6); c.closePath(); }
    else if (o.snap.kind === 'ctr') { c.arc(s.x, s.y, 8, 0, Math.PI * 2); c.moveTo(s.x - 12, s.y); c.lineTo(s.x + 12, s.y); c.moveTo(s.x, s.y - 12); c.lineTo(s.x, s.y + 12); }
    else if (o.snap.kind === 'perp') {
      const a = o.snap.segAng || 0, ca = Math.cos(a), sa = Math.sin(a), k = 9;
      c.moveTo(s.x - ca * 14, s.y - sa * 14); c.lineTo(s.x + ca * 14, s.y + sa * 14);
      c.moveTo(s.x + ca * k, s.y + sa * k); c.lineTo(s.x + ca * k - sa * k, s.y + sa * k + ca * k); c.lineTo(s.x - sa * k, s.y + ca * k);
    }
    else c.rect(s.x - 5, s.y - 5, 10, 10);
    c.stroke();
    if (o.snap.label) { c.font = '700 10.5px "Figtree", sans-serif'; c.fillStyle = c.strokeStyle; c.fillText(o.snap.label, s.x + 12, s.y - 10); }
    c.restore();
  }
  /* halo: selected items + item hovered in the layers list */
  const haloIds = new Set(SF.sel ? SF.sel.ids : []); if (o.hl) haloIds.add(o.hl);
  if (haloIds.size) {
    const v = SF.view, now = performance.now(), pulsing = now < (o.pulseUntil || 0), t = (now % 900) / 900, pulse = pulsing ? 0.6 + 0.35 * Math.sin(t * Math.PI * 2) : 0.55;
    c.save(); c.setTransform(SF.dpr * v.z, 0, 0, SF.dpr * v.z, SF.dpr * v.x, SF.dpr * v.y);
    for (const L of SF.doc.layers) {
      if (!L.visible) continue;
      for (const it of layerItems(L)) {
        if (!haloIds.has(it.id) || it.hidden) continue;
        c.globalAlpha = it.id === o.hl && !(SF.sel && SF.sel.ids.has(it.id)) ? 0.45 : pulse * 0.55;
        c.strokeStyle = C.accent; c.lineJoin = 'round'; c.lineCap = 'round';
        if (it.t === 'path' && it.pts.length >= 6) { c.beginPath(); SF.tracePts(ctxSink(c), it.pts, it.closed, it.mode !== 'poly'); c.lineWidth = (it.stroke === false ? 0 : it.width) + 9 / v.z; c.stroke(); }
        else { const b = G.bbox(it); c.lineWidth = 4 / v.z; c.strokeRect(b.x - 4 / v.z, b.y - 4 / v.z, b.w + 8 / v.z, b.h + 8 / v.z); }
      }
    }
    c.restore();
    if (pulsing) setTimeout(SF.requestRender, 40);
  }
  if (o.holdRing) {
    const h = o.holdRing, t = Math.min(1, (performance.now() - h.t0) / h.dur);
    c.save(); c.beginPath(); c.arc(h.x, h.y, 22, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2); c.strokeStyle = C.accent; c.lineWidth = 4; c.lineCap = 'round'; c.stroke();
    c.font = '700 11px "Figtree", sans-serif'; c.fillStyle = C.accent; c.fillText(t < 1 ? 'hold to fill shape' : 'shape fill', h.x + 28, h.y + 4); c.restore();
    if (t < 1) SF.requestRender();
  }
  /* selection */
  if (SF.sel && SF.sel.ids.size) {
    const b = SF.sel.box();
    if (b) {
      const a = SF.toScreen(b.x, b.y), q = SF.toScreen(b.x + b.w, b.y + b.h);
      c.save(); c.strokeStyle = C.cool; c.lineWidth = 1.5; c.setLineDash([6, 4]); c.strokeRect(a.x - 4, a.y - 4, q.x - a.x + 8, q.y - a.y + 8); c.setLineDash([]);
      const hs = SF.sel.handles(); c.fillStyle = C['pill-solid'];
      for (const h of hs) { c.beginPath(); if (h.k === 'rot') c.arc(h.x, h.y, 7, 0, Math.PI * 2); else c.rect(h.x - 6, h.y - 6, 12, 12); c.fill(); c.stroke(); }
      const rh = hs.find(h => h.k === 'rot'); if (rh) { c.beginPath(); c.moveTo(rh.x, rh.y + 7); c.lineTo(rh.x, a.y - 4); c.stroke(); }
      c.restore();
    }
  }
  if (o.hoverItem && tool === 'select') {
    const b = G.bbox(o.hoverItem); const a = SF.toScreen(b.x, b.y), q = SF.toScreen(b.x + b.w, b.y + b.h);
    c.save(); c.strokeStyle = C.cool; c.globalAlpha = 0.5; c.lineWidth = 1; c.strokeRect(a.x - 2, a.y - 2, q.x - a.x + 4, q.y - a.y + 4); c.restore();
  }
  if (o.marquee) {
    const m = o.marquee, a = SF.toScreen(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1)), q = SF.toScreen(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
    c.save(); c.fillStyle = C.cool; c.globalAlpha = 0.1; c.fillRect(a.x, a.y, q.x - a.x, q.y - a.y); c.globalAlpha = 0.8; c.strokeStyle = C.cool; c.lineWidth = 1; c.strokeRect(a.x, a.y, q.x - a.x, q.y - a.y); c.restore();
  }
  if (o.ring) {
    c.save(); c.beginPath(); c.arc(o.ring.x, o.ring.y, Math.max(2, o.ring.r * z), 0, Math.PI * 2); c.strokeStyle = C.ink; c.globalAlpha = 0.6; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.arc(o.ring.x, o.ring.y, Math.max(2, o.ring.r * z) + 1, 0, Math.PI * 2); c.strokeStyle = C.desk; c.globalAlpha = 0.6; c.stroke(); c.restore();
  }
  if (o.flash) {
    const f = o.flash, t = (performance.now() - f.t0) / 380;
    if (t < 1) { const s = SF.toScreen(f.x, f.y); c.save(); c.beginPath(); c.arc(s.x, s.y, 10 + t * 26, 0, Math.PI * 2); c.strokeStyle = C.accent; c.globalAlpha = 1 - t; c.lineWidth = 3; c.stroke(); c.restore(); SF.requestRender(); }
    else o.flash = null;
  }
}

/* ---------- offscreen rendering (export, thumbnails, colour pick, fill) ---------- */
SF.renderDoc = (opts) => {
  opts = opts || {}; const d = SF.doc, s = opts.scale || 1;
  const c = U.canvas(d.w * s, d.h * s), x = c.getContext('2d');
  x.setTransform(s, 0, 0, s, 0, 0);
  if (!opts.transparent && d.paper !== 'transparent') { x.fillStyle = opts.paper || d.paper; x.fillRect(0, 0, d.w, d.h); }
  for (const L of d.layers) {
    if (!L.visible) continue;
    if (L.ref && !opts.includeRef) continue;
    if (opts.only && !opts.only.includes(L.id)) continue;
    const lc = SF.renderLayer(L, s, null, { construction: !!opts.construction });
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = L.opacity; x.globalCompositeOperation = L.blend || 'source-over';
    x.drawImage(lc, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  }
  return c;
};
SF.renderLayer = (L, s, items, opt) => {
  const d = SF.doc; s = s || 1;
  const c = U.canvas(d.w * s, d.h * s), x = c.getContext('2d');
  x.setTransform(s, 0, 0, s, 0, 0);
  /* construction lines are guides: left out of exports unless asked for */
  SF.drawItems(x, items || layerItems(L), null, { z: s, paper: d.paper === 'transparent' ? '#ffffff' : d.paper, noConstruction: !(opt && opt.construction) });
  return c;
};
SF.sampleColor = (x, y) => {
  const d = SF.doc, c = U.canvas(1, 1), g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, -x, -y);
  g.fillStyle = d.paper === 'transparent' ? '#ffffff' : d.paper; g.fillRect(x - 1, y - 1, 3, 3);
  for (const L of d.layers) { if (!L.visible) continue; g.globalAlpha = L.opacity; g.globalCompositeOperation = L.blend || 'source-over'; SF.drawItems(g, layerItems(L), { x: x - 1, y: y - 1, w: 2, h: 2 }, {}); }
  const p = g.getImageData(0, 0, 1, 1).data; return U.rgbToHex(p[0], p[1], p[2]);
};
SF.thumb = (maxW, maxH) => {
  const d = SF.doc, s = Math.min(maxW / d.w, maxH / d.h);
  return SF.renderDoc({ scale: s, includeRef: true });
};
const thumbCache = new WeakMap();
SF.itemThumb = (it, w, h) => {
  const key = w + 'x' + h; let m = thumbCache.get(it); if (m && m[key]) return m[key];
  const dp = 2, c = U.canvas(w * dp, h * dp), x = c.getContext('2d');
  const paper = SF.doc.paper === 'transparent' ? '#ffffff' : SF.doc.paper;
  x.fillStyle = paper; x.fillRect(0, 0, c.width, c.height);
  const b = G.bbox(it.t === 'path' && it.bind ? Object.assign({}, it, { bind: null }) : it), pad = 4;
  const s = Math.min((c.width - pad * 2 * dp) / Math.max(1, b.w), (c.height - pad * 2 * dp) / Math.max(1, b.h), 4 * dp);
  x.setTransform(s, 0, 0, s, c.width / 2 - (b.x + b.w / 2) * s, c.height / 2 - (b.y + b.h / 2) * s);
  const vis = Object.assign({}, it, { hidden: false, opacity: it.hidden ? 0.35 : (it.opacity == null ? 1 : it.opacity) });
  if (vis.t === 'path' && vis.stroke !== false) vis.width = Math.max(vis.width, 1.6 / s);
  SF.drawItem(x, vis, { z: s, paper });
  if (!m) { m = {}; thumbCache.set(it, m); } m[key] = c; return c;
};
SF.layerThumb = (L, w, h) => {
  const d = SF.doc, s = Math.min(w / d.w, h / d.h), c = U.canvas(w, h), x = c.getContext('2d');
  x.fillStyle = d.paper === 'transparent' ? '#ffffff' : d.paper; x.fillRect(0, 0, w, h);
  x.setTransform(s, 0, 0, s, (w - d.w * s) / 2, (h - d.h * s) / 2);
  SF.drawItems(x, layerItems(L), null, {}); return c;
};

})(window.SF);
