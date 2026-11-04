/* SketchFlow ↔ MCP bridge (page side). Connects to the local SketchFlow server over SSE and runs AI commands on the board. */
(function (SF) {
'use strict';
const U = SF.U, $ = U.$;
const P = () => SF.prefs;
const B = SF.bridge = { connected: false, primary: true, token: '', cid: U.uid('c') };

function chip(state, text) {
  const c = $('#aiChip'); if (!c) return;
  c.classList.toggle('live', state === 'live');
  c.querySelector('span').textContent = text;
  c.title = state === 'live' ? 'AI link connected' : 'AI link off — see Help';
}
async function post(path, body) {
  const r = await fetch(path + '?t=' + encodeURIComponent(B.token), { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-token': B.token }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('bridge ' + r.status);
  return r.json().catch(() => ({}));
}
B.init = () => {
  const meta = document.querySelector('meta[name="sketchflow-bridge"]');
  B.token = (meta && meta.getAttribute('content')) || '';
  if (!B.token || !/^https?:$/.test(location.protocol)) { chip('off', 'AI off'); return; }
  connect();
};
let es = null, retry = 1000;
function connect() {
  try { es && es.close(); } catch (e) { /* ignore */ }
  es = new EventSource('/bridge/events?t=' + encodeURIComponent(B.token) + '&cid=' + B.cid);
  es.addEventListener('hello', (e) => { const d = JSON.parse(e.data); B.connected = true; B.primary = d.primary; retry = 1000; chip('live', d.primary ? 'AI linked' : 'AI on other tab'); });
  es.addEventListener('role', (e) => { const d = JSON.parse(e.data); B.primary = d.primary; chip('live', d.primary ? 'AI linked' : 'AI on other tab'); if (!d.primary) SF.toast('Another tab is now the AI board', 2500, { label: 'Use this tab', fn: () => post('/bridge/claim', { cid: B.cid }) }); });
  es.addEventListener('cmd', async (e) => {
    const { id, cmd, args } = JSON.parse(e.data);
    try { const result = await run(cmd, args || {}); await post('/bridge/reply', { id, ok: true, result }); }
    catch (err) { console.error(err); await post('/bridge/reply', { id, ok: false, error: String(err && err.message || err) }).catch(() => {}); }
  });
  es.onerror = () => {
    B.connected = false; chip('off', 'AI reconnecting'); try { es.close(); } catch (e) { /* ignore */ }
    setTimeout(async () => {
      /* the server may have restarted with a new token: read it from a fresh copy of the page */
      try { const html = await (await fetch('/', { cache: 'no-store' })).text(); const m = html.match(/name="sketchflow-bridge" content="([a-f0-9]+)"/); if (m) B.token = m[1]; } catch (e) { /* server down */ }
      connect();
    }, retry);
    retry = Math.min(retry * 2, 15000);
  };
}

/* =============== snapshot / info =============== */
const b64 = async (c, type, q) => { const blob = await new Promise(r => c.toBlob(r, type || 'image/png', q)); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
function info() {
  const d = SF.doc;
  return {
    board: d.name, width: d.w, height: d.h, paper: d.paper, background: { color: d.paper === 'transparent' ? (d.paperHidden || null) : d.paper, visible: d.paper !== 'transparent', note: 'always the bottom layer; fills the canvas' }, space: d.guides.space, space_name: SF.SPACES[d.guides.space].name, grid: d.guides.grid,
    vanishing_points: d.guides.vps.map(v => ({ x: Math.round(v.x), y: Math.round(v.y) })), lightbox: d.guides.lightbox,
    units: P().units, units_per_px: P().unitScale, active_layer: d.active, tool: P().tool, color: P().color,
    layers: d.layers.map((L, i) => ({ index: i, id: L.id, name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend, reference: L.ref, locked: L.locked, items: L.items.length, kinds: [...new Set(L.items.map(it => it.t))] })),
    motion: d.motion || null, history: { step: SF.history.i, steps: SF.history.states.length - 1 }
  };
}
async function snapshot(a) {
  const d = SF.doc, max = U.clamp(a.max_size || 1024, 128, 4096);
  const s = Math.min(1, max / Math.max(d.w, d.h));
  let c;
  if (a.layer) { const L = SF.findLayer(a.layer); if (!L) throw new Error('No layer ' + a.layer); c = SF.renderLayer(L, s, null, { construction: true }); }
  else c = SF.renderDoc({ scale: s, includeRef: a.include_reference !== false, construction: true, transparent: !!a.transparent });
  return { png: await b64(c), width: c.width, height: c.height, scale: s, info: info() };
}
B.send = async (note, withLayers) => {
  const shot = await snapshot({ max_size: 1280 });
  const body = { png: shot.png, width: shot.width, height: shot.height, scale: shot.scale, note, info: shot.info };
  if (withLayers) { body.layers = []; for (const L of SF.doc.layers) if (L.visible) body.layers.push({ name: L.name, png: await b64(SF.renderLayer(L, shot.scale)) }); }
  await post('/bridge/push', body);
};

/* =============== AI drawing =============== */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
function svgPathToPolys(d) {
  /* minimal SVG path parser → list of {pts:[x,y,..], closed, curved} */
  const toks = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const out = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0, lcx = 0, lcy = 0;
  const nx = () => +toks[i++];
  const begin = () => { if (cur && cur.pts.length >= 6) out.push(cur); cur = { pts: [x, y, 0.5], closed: false, curved: false }; };
  const add = (px, py) => { cur.pts.push(px, py, 0.5); x = px; y = py; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') { x = ox + nx(); y = oy + nx(); sx = x; sy = y; begin(); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { if (!cur) begin(); add(ox + nx(), oy + nx()); }
    else if (C === 'H') { if (!cur) begin(); add(rel ? x + nx() : nx(), y); }
    else if (C === 'V') { if (!cur) begin(); add(x, rel ? y + nx() : nx()); }
    else if (C === 'C' || C === 'S' || C === 'Q' || C === 'T') {
      if (!cur) begin(); cur.curved = true;
      let c1x, c1y, c2x, c2y, ex, ey;
      if (C === 'C') { c1x = ox + nx(); c1y = oy + nx(); c2x = ox + nx(); c2y = oy + nx(); ex = ox + nx(); ey = oy + nx(); }
      else if (C === 'S') { c1x = 2 * x - lcx; c1y = 2 * y - lcy; c2x = ox + nx(); c2y = oy + nx(); ex = ox + nx(); ey = oy + nx(); }
      else if (C === 'Q') { c1x = ox + nx(); c1y = oy + nx(); ex = ox + nx(); ey = oy + nx(); c2x = c1x; c2y = c1y; }
      else { c1x = 2 * x - lcx; c1y = 2 * y - lcy; ex = ox + nx(); ey = oy + nx(); c2x = c1x; c2y = c1y; }
      const x0 = x, y0 = y, q = C === 'Q' || C === 'T';
      for (let k = 1; k <= 16; k++) { const t = k / 16, m = 1 - t; if (q) add(m * m * x0 + 2 * m * t * c1x + t * t * ex, m * m * y0 + 2 * m * t * c1y + t * t * ey); else add(m * m * m * x0 + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t * t * t * ex, m * m * m * y0 + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t * t * t * ey); }
      lcx = q ? c1x : c2x; lcy = q ? c1y : c2y; continue;
    }
    else if (C === 'A') { if (!cur) begin(); nx(); nx(); nx(); nx(); nx(); add(ox + nx(), oy + nx()); }
    else if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; out.push(cur); cur = null; } }
    else { i++; }
    lcx = x; lcy = y;
  }
  if (cur && cur.pts.length >= 6) out.push(cur);
  return out;
}
function styleOf(s) {
  const fill = s.fill && s.fill !== 'none' ? U.normColor(s.fill) : null;
  const lt = SF.LINE_TYPES[s.line_type] ? s.line_type : (s.dash ? 'dashed' : 'solid');
  return { color: U.normColor(s.color || s.stroke || P().color), width: num(s.width, num(s.stroke_width, 3)), opacity: U.clamp(num(s.opacity, 1), 0, 1), fill, fillOpacity: num(s.fill_opacity, 1), brush: ['pen', 'pencil', 'marker', 'brush'].includes(s.brush) ? s.brush : 'shape', lt: lt === 'solid' ? undefined : lt, stroke: s.stroke === 'none' || s.stroke === false ? false : true };
}
function snapEnds(pts, enabled) {
  if (!enabled) return pts;
  const J = SF.joints(SF.activeItems()), n = pts.length / 3;
  [0, n - 1].forEach(k => { let b = null, bd = 8; for (const j of J) { const dd = Math.hypot(j.x - pts[k * 3], j.y - pts[k * 3 + 1]); if (dd < bd) { bd = dd; b = j; } } if (b) { pts[k * 3] = b.x; pts[k * 3 + 1] = b.y; } });
  return pts;
}
/* a line whose end sits on a segment midpoint or a shape centre (within 2px) stays connected to it */
function connectLine(it, enabled) {
  if (!enabled) return it;
  const T = SF.snapTargets(SF.activeItems()), n = it.pts.length / 3, near = (x, y) => { for (const q of T.ctrs.concat(T.mids)) if (Math.hypot(q.x - x, q.y - y) < 2) return q; return null; };
  const a = near(it.pts[0], it.pts[1]), b = near(it.pts[(n - 1) * 3], it.pts[(n - 1) * 3 + 1]);
  if (a || b) it.anc = { s: a ? a.ref : null, e: b ? b.ref : null };
  return it;
}
function makeItems(s) {
  const st = styleOf(s), mk = (pts, o) => SF.newPath(Object.assign({}, st, { pts, mode: 'poly', closed: false, shape: ['line', 'arrow', 'rect', 'circle', 'ellipse', 'arc', 'star', 'polygon', 'polyline'].includes(s.type) ? s.type : undefined }, o || {}));
  const P2 = (arr) => { const o = []; for (const p of arr || []) o.push(+p[0], +p[1], p[2] == null ? 0.5 : +p[2]); return o; };
  const snap = s.snap !== false;
  switch (s.type) {
    case 'line': return [connectLine(mk(snapEnds([s.x1, s.y1, 0.5, s.x2, s.y2, 0.5], snap)), snap)];
    case 'arrow': return [connectLine(mk(snapEnds([s.x1, s.y1, 0.5, s.x2, s.y2, 0.5], snap), { arrow: true }), snap)];
    case 'polyline': return [mk(snapEnds(P2(s.points), snap && !s.closed), { closed: !!s.closed })];
    case 'polygon': return [mk(P2(s.points), { closed: true })];
    case 'rect': { const x = s.x, y = s.y, w = s.w != null ? s.w : s.width, h = s.h != null ? s.h : s.height; return [mk([x, y, 0.5, x + w, y, 0.5, x + w, y + h, 0.5, x, y + h, 0.5], { closed: true })]; }
    case 'circle': case 'ellipse': { const rx = s.type === 'circle' ? s.r : s.rx, ry = s.type === 'circle' ? s.r : s.ry, o = []; for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; o.push(s.cx + Math.cos(t) * rx, s.cy + Math.sin(t) * ry, 0.5); } return [mk(o, { closed: true, mode: 'smooth' })]; }
    case 'arc': { const a0 = num(s.start, 0) * Math.PI / 180, a1 = num(s.end, 180) * Math.PI / 180, n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * 12)), o = []; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; o.push(s.cx + Math.cos(t) * s.r, s.cy + Math.sin(t) * s.r, 0.5); } return [mk(o, { mode: 'smooth' })]; }
    case 'star': { const n = Math.max(3, s.points || 5), o = []; for (let i = 0; i < n * 2; i++) { const t = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? s.r * num(s.inner, 0.42) : s.r; o.push(s.cx + Math.cos(t) * r, s.cy + Math.sin(t) * r, 0.5); } return [mk(o, { closed: true })]; }
    case 'box': case 'cylinder': case 'cone': case 'sphere': case 'pyramid': case 'prism': {
      const prev = P().shapeFill, hid = P().showHidden;
      P().shapeFill = s.fill && s.fill !== 'none' ? (num(s.fill_opacity, 1) < 1 ? 'both' : 'fill') : 'outline'; if (s.hidden_edges != null) P().showHidden = !!s.hidden_edges;
      try {
        if (s.from === 'corner' || s.from === 'centre' || s.from === 'center') {
          /* parametric: true sizes, placed by the base centre (or the base's back corner), with a driving height dimension */
          const r = SF.makePrimParams({ type: s.type, x: s.x, y: s.y, from: s.from === 'corner' ? 'corner' : 'centre', width: s.width, depth: s.depth, height: s.height, radius: s.radius, cube: s.cube }, Object.assign({}, st, { brush: 'shape', fill: undefined, fillBase: st.fill || undefined }));
          return s.height_dim === false ? r.items : r.items.concat([SF.primHeightDim(r.pid, r.items)]);
        }
        return SF.makeShape(s.type, { x: s.x, y: s.y }, { x: s.x + (s.w || s.width), y: s.y + (s.h || s.height) }, { square: !!s.cube, isoOnly: s.views === false }, Object.assign({}, st, { brush: 'shape', fill: undefined, fillBase: st.fill || undefined })); }
      finally { P().shapeFill = prev; P().showHidden = hid; }
    }
    case 'freehand': { const pts = P2(s.points); return [SF.newPath(Object.assign({}, st, { pts: snapEnds(pts, snap), mode: 'free', brush: st.brush === 'shape' ? 'pen' : st.brush, pv: pts.some((v, i) => i % 3 === 2 && v !== 0.5) }))]; }
    case 'path': return svgPathToPolys(s.d).map(p => mk(p.pts, { closed: p.closed, mode: p.curved ? 'free' : 'poly' }));
    case 'text': {
      let it = { t: 'text', id: U.uid('t'), x: s.x, y: s.y, text: String(s.text || ''), size: num(s.size, 32), font: SF.FONTS[s.font] ? s.font : 'sans', bold: !!s.bold, italic: !!s.italic, color: st.color, opacity: st.opacity, align: ['left', 'center', 'right'].includes(s.align) ? s.align : 'left', r: num(s.rotation, 0) * Math.PI / 180 };
      if (s.along) { const f = SF.findItem(s.along); if (f) { it.pathId = s.along; if (!s.align) it.align = 'center'; } }
      if (s.on || s.surface || s.corners) {
        const f = s.on ? SF.faceOfItem((SF.findItem(String(s.on)) || {}).it) : s.surface ? SF.findFace(+s.surface.x, +s.surface.y) : (Array.isArray(s.corners) && s.corners.length === 4 ? SF.faceOfPoints(s.corners) : null);
        if (!f || !f.quad) throw new Error('Text surface: ' + ((f && f.error) || 'give surface:{x,y} inside a 4-sided face, on:<id of a closed 4-corner shape>, or corners:[[x,y],[x,y],[x,y],[x,y]]'));
        it.quad = f.quad; it.surf = f.refs; it.pathId = null; if (!s.align) it.align = 'center'; if (s.fit === false) it.fit = false;
        it.x = (f.quad[0] + f.quad[3] + f.quad[6] + f.quad[9]) / 4; it.y = (f.quad[1] + f.quad[4] + f.quad[7] + f.quad[10]) / 4;
        for (let k = 0; k < ((s.turn | 0) % 4 + 4) % 4; k++) it = SF.turnOnSurface(it);
      }
      return [it];
    }
    case 'dimension': {
      const bind = (x, y) => { const J = SF.joints(SF.activeItems()); let b = null, bd = 4; for (const j of J) { const dd = Math.hypot(j.x - x, j.y - y); if (dd < bd) { bd = dd; b = j; } } return b ? { x: b.x, y: b.y, ref: b.id, k: b.k } : { x, y }; };
      return [{ t: 'dim', id: U.uid('d'), a: bind(s.x1, s.y1), b: bind(s.x2, s.y2), off: num(s.offset, -26), axis: s.axis === 'h' || s.axis === 'v' ? s.axis : null, color: st.color, width: num(s.width, 1.5), size: num(s.size, 14), opacity: 1, label: s.label || null }];
    }
  }
  throw new Error('Unknown item type “' + s.type + '”. Use line, arrow, polyline, polygon, rect, circle, ellipse, arc, star, box, freehand, path, text, dimension, fill.');
}
async function draw(a) {
  let L = null;
  if (a.new_layer) { L = SF.mkLayer(String(a.new_layer)); SF.doc.layers.splice(SF.layerIndex() + 1, 0, L); }
  else L = a.layer != null ? SF.findLayer(a.layer) : SF.layer();
  if (!L) throw new Error('No layer ' + a.layer);
  SF.doc.active = L.id;
  const items = [], animate = a.animate !== false && (a.items || []).length <= 80;
  try {
    for (const s of a.items || []) {
      if (s.type === 'fill') {
        const col = U.normColor(s.fill || s.color || P().color);
        let made = null;
        if (s.follow !== false) made = SF.shapeFillAt(+s.x, +s.y, col, { noCommit: true });
        if (made) {
          if (s.id) made.id = String(s.id);
          const idx = L.items.findIndex(i => (i.t === 'path' && i.stroke !== false) || i.t === 'text' || i.t === 'dim');
          const arr = L.items.slice(); arr.splice(idx < 0 ? arr.length : idx, 0, made); SF.setItems(L, arr); items.push(made);
        } else {
          const ids0 = new Set(L.items.map(i => i.id)); SF.fillAt(+s.x, +s.y, col); const nw = L.items.find(i => !ids0.has(i.id)); if (nw) items.push(nw);
        }
        if (animate) { SF.requestRender(); await new Promise(r => setTimeout(r, 35)); }
        continue;
      }
      const made = makeItems(s);
      if (s.id) made.forEach((it, k) => { it.id = k ? s.id + '-' + k : String(s.id); });
      items.push(...made);
      /* add as we go so later items (dimensions, text along a line, joins) can bind to earlier ones */
      SF.addItems(L, made);
      if (animate) { SF.requestRender(); await new Promise(r => setTimeout(r, 35)); }
    }
  } catch (e) { if (items.length) SF.commit((a.label || 'AI drawing') + ' (partial)'); throw e; }
  SF.commit(a.label || 'AI drawing'); SF.emit('layers');
  return { layer: { id: L.id, name: L.name }, created: items.map(i => ({ id: i.id, type: i.t, mode: i.mode })) };
}
function itemSummary(it) {
  const b = SF.G.bbox(it), k = SF.kindOf(it), o = { id: it.id, type: it.t, group: k.group, kind: k.label, bbox: [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)] };
  if (it.name) o.name = it.name; if (it.hidden) o.hidden = true; if (it.locked) o.locked = true; if (it.bind) o.follows_outline = true;
  if (it.lt) o.line_type = it.lt; if (it.prim) { o.primitive = it.prim; o.group_id = it.pid; if (it.pp) o.sizes = { width: +it.pp.W.toFixed(1), depth: +it.pp.D.toFixed(1), height: +it.pp.H.toFixed(1) }; }
  if (it.drive) o.drives = { group_id: it.drive.pid, size: it.drive.param === 'W' ? 'diameter' : 'height' }; if (it.anc) o.connected = { start: it.anc.s || undefined, end: it.anc.e || undefined };
  if (it.t === 'path') { Object.assign(o, { mode: it.mode, closed: it.closed, color: it.color, width: +it.width.toFixed(2), points: it.pts.length / 3 }); if (it.pts.length / 3 <= 12) { o.vertices = []; for (let i = 0; i < it.pts.length; i += 3) o.vertices.push([Math.round(it.pts[i] * 10) / 10, Math.round(it.pts[i + 1] * 10) / 10]); } if (it.fill) o.fill = it.fill; if (it.arrow) o.arrow = true; }
  if (it.t === 'text') Object.assign(o, { text: it.text, font: it.font, size: it.size, color: it.color, along: it.pathId || undefined, on_surface: it.quad ? true : undefined });
  if (it.t === 'image') Object.assign(o, { name: it.name, cutout: !!it.cut, fill: it.fill || undefined });
  if (it.t === 'dim') { const g = SF.dimGeom(it); Object.assign(o, { length_px: +g.len.toFixed(2), label: SF.fmtLen(Math.hypot(g.b2.x - g.a2.x, g.b2.y - g.a2.y)), bound: [!!it.a.ref, !!it.b.ref] }); }
  return o;
}
function items(a) {
  const L = a.layer != null ? SF.findLayer(a.layer) : SF.layer(); if (!L) throw new Error('No layer ' + a.layer);
  const ids = new Set(a.ids || []);
  switch (a.action || 'list') {
    case 'list': return { layer: L.name, count: L.items.length, type_colors: SF.typeColors(), items: SF.resolveItems(L.items).slice(-300).map(itemSummary), joints: SF.joints(L.items).slice(0, 400).map(j => ({ x: Math.round(j.x * 10) / 10, y: Math.round(j.y * 10) / 10, item: j.id, k: j.k, joined: !!j.joined })) };
    case 'delete': SF.setItems(L, L.items.filter(i => !ids.has(i.id))); SF.commit('AI delete'); return { deleted: [...ids] };
    case 'move': { const m = SF.G.mat.translate(num(a.dx, 0), num(a.dy, 0)); SF.setItems(L, L.items.map(i => (ids.has(i.id) ? SF.G.transformItem(i, m) : i))); SF.commit('AI move'); return { moved: [...ids] }; }
    case 'transform': { const m = SF.G.mat.around(num(a.cx, SF.doc.w / 2), num(a.cy, SF.doc.h / 2), num(a.scale, 1), num(a.scale, 1), num(a.rotate, 0) * Math.PI / 180); SF.setItems(L, L.items.map(i => (ids.has(i.id) ? SF.G.transformItem(i, m) : i))); SF.commit('AI transform'); return { transformed: [...ids] }; }
    case 'style': { const p = a.style || {}; SF.setItems(L, L.items.map(i => { if (!ids.has(i.id)) return i; const o = Object.assign({}, i); if (p.color) o.color = U.normColor(p.color); if (p.width != null && i.t === 'path') o.width = +p.width; if (p.opacity != null) o.opacity = +p.opacity; if ('fill' in p && i.t === 'path') o.fill = p.fill ? U.normColor(p.fill) : null; if (p.text != null && i.t === 'text') o.text = String(p.text); if (p.size != null && i.t === 'text') o.size = +p.size; if (p.font && i.t === 'text') o.font = p.font; if (p.name != null) o.name = String(p.name) || undefined; if (p.line_type && i.t === 'path') { o.lt = p.line_type === 'solid' ? undefined : p.line_type; o.dash = false; } if (i.t === 'text') { if (p.offset != null) o.offset = +p.offset; if (p.lift != null) o.lift = +p.lift; if (p.along === null || p.along === '') { Object.assign(o, SF.detachPathText(o)); } else if (p.along) { o.pathId = String(p.along); o.offset = o.offset || 0; o.lift = o.lift || 0; } } if (p.hidden != null) o.hidden = !!p.hidden; if (p.locked != null) o.locked = !!p.locked; return p.color && (i.t === 'image' && i.fill || (i.t === 'path' && i.stroke === false)) ? SF.recolorItem(o, U.normColor(p.color)) : o; })); SF.commit('AI restyle'); return { styled: [...ids] }; }
    case 'color_by_type': SF.colorByType(); return { type_colors: SF.typeColors() };
    case 'set_size': {
      const pid = a.group_id || ((SF.findItem(a.id || (a.ids || [])[0]) || {}).it || {}).pid; if (!pid) throw new Error('Give group_id or the id of any part of a 3D primitive');
      const pp = SF.primParams(pid); if (!pp) throw new Error('That primitive is not parametric (it was rotated, mirrored, or drawn in 3-view)');
      const patch = {}; if (a.width != null) patch.W = +a.width; if (a.depth != null) patch.D = +a.depth; if (a.height != null) patch.H = +a.height; if (a.radius != null) { patch.W = +a.radius * 2; patch.D = +a.radius * 2; }
      Object.keys(patch).forEach(k => { patch[k] /= (P().unitScale || 1); });
      if (!SF.regenPrim(pid, patch)) throw new Error('Could not rebuild ' + pid);
      SF.commit('AI resize ' + pp.type); const n = SF.primParams(pid);
      return { group_id: pid, type: n.type, width: +(n.W * (P().unitScale || 1)).toFixed(2), depth: +(n.D * (P().unitScale || 1)).toFixed(2), height: +(n.H * (P().unitScale || 1)).toFixed(2) };
    }
    case 'set_dimension': { const dim = L.items.find(i => i.id === a.id && i.t === 'dim'); if (!dim) throw new Error('No dimension ' + a.id); SF.setDimLength(L, dim, num(a.value, 0) / (P().unitScale || 1)); return itemSummary(SF.findItem(a.id).it); }
    case 'move_joint': { const refs = SF.coincident(L.items, a.x, a.y, 1.5); if (!refs.length) throw new Error('No joint at ' + a.x + ',' + a.y); SF.setItems(L, SF.moveVertices(L.items, refs, () => ({ x: a.to_x, y: a.to_y }))); SF.commit('AI move joint'); return { moved_vertices: refs.length }; }
  }
  throw new Error('Unknown items action ' + a.action);
}
function layers(a) {
  const d = SF.doc;
  switch (a.action || 'list') {
    case 'list': return info().layers;
    case 'add': { const L = SF.mkLayer(a.name || 'Layer ' + (d.layers.length + 1)); const idx = a.index != null ? U.clamp(a.index, 0, d.layers.length) : SF.layerIndex() + 1; d.layers.splice(idx, 0, L); applyProps(L, a); d.active = L.id; SF.commit('AI new layer'); SF.emit('layers'); return { id: L.id, name: L.name, index: d.layers.indexOf(L) }; }
    case 'update': {
      if (String(a.layer || '').toLowerCase() === 'background') {
        if (a.color) SF.setBackgroundColor(a.color === 'transparent' ? '#ffffff' : U.normColor(a.color));
        if (a.visible != null) SF.setBackgroundVisible(!!a.visible);
        return { background: { color: d.paper === 'transparent' ? d.paperHidden : d.paper, visible: d.paper !== 'transparent' } };
      }
      const L = SF.findLayer(a.layer); if (!L) throw new Error('No layer ' + a.layer); applyProps(L, a); if (a.index != null) { const i = d.layers.indexOf(L); d.layers.splice(i, 1); d.layers.splice(U.clamp(a.index, 0, d.layers.length), 0, L); } SF.commit('AI layer'); SF.emit('layers'); return { id: L.id, name: L.name }; }
    case 'select': { const L = SF.findLayer(a.layer); if (!L) throw new Error('No layer ' + a.layer); d.active = L.id; SF.emit('layers'); return { active: L.id }; }
    case 'clear': { const L = SF.findLayer(a.layer); if (!L) throw new Error('No layer ' + a.layer); SF.setItems(L, []); SF.commit('AI clear layer'); return { cleared: L.id }; }
    case 'delete': { const L = SF.findLayer(a.layer); if (!L) throw new Error('No layer ' + a.layer); if (d.layers.length === 1) { SF.setItems(L, []); } else { d.layers.splice(d.layers.indexOf(L), 1); if (d.active === L.id) d.active = d.layers[d.layers.length - 1].id; } SF.commit('AI delete layer'); SF.emit('layers'); return { deleted: L.id }; }
  }
  throw new Error('Unknown layers action ' + a.action);
}
function applyProps(L, a) {
  if (a.name != null) L.name = String(a.name); if (a.visible != null) L.visible = !!a.visible; if (a.opacity != null) L.opacity = U.clamp(+a.opacity, 0, 1);
  if (a.blend) L.blend = a.blend === 'normal' ? 'source-over' : a.blend; if (a.reference != null) L.ref = !!a.reference; if (a.locked != null) L.locked = !!a.locked;
}
function guides(a) {
  const g = SF.doc.guides;
  if (a.space) { if (!SF.SPACES[a.space]) throw new Error('space must be one of ' + SF.SPACE_ORDER.join(', ')); g.space = a.space; }
  if (Array.isArray(a.vanishing_points)) a.vanishing_points.forEach((v, i) => { if (g.vps[i] && v) { g.vps[i].x = +v.x; g.vps[i].y = +v.y; } });
  if (a.grid != null) g.grid = U.clamp(+a.grid, 4, 400);
  if (a.lightbox != null) g.lightbox = !!a.lightbox;
  if (a.snap != null) { P().snap = !!a.snap; SF.savePrefs(); }
  if (a.units) { P().units = a.units; } if (a.units_per_px != null) P().unitScale = +a.units_per_px; SF.savePrefs();
  SF.emit('change', 'guides'); SF.ui.syncTop(); SF.invalidate();
  return { space: g.space, grid: g.grid, vanishing_points: g.vps, lightbox: g.lightbox, snap: P().snap, units: P().units, units_per_px: P().unitScale };
}
async function board(a) {
  switch (a.action || 'info') {
    case 'info': return info();
    case 'new': await SF.io.saveNow(); SF.loadDoc(SF.newDoc(U.clamp(a.width || SF.doc.w, 64, 8192), U.clamp(a.height || SF.doc.h, 64, 8192), a.name)); if (a.paper) SF.setPaper(a.paper); await SF.io.saveNow(); return info();
    case 'paper': SF.setPaper(a.paper === 'transparent' ? 'transparent' : U.normColor(a.paper)); return { paper: SF.doc.paper };
    case 'rename': SF.doc.name = String(a.name || SF.doc.name); $('#boardName').textContent = SF.doc.name; SF.emit('change', 'rename'); return { name: SF.doc.name };
    case 'undo': for (let i = 0; i < (a.steps || 1); i++) SF.undo(); return info().history;
    case 'redo': for (let i = 0; i < (a.steps || 1); i++) SF.redo(); return info().history;
    case 'fit': SF.fit(); return { ok: true };
    case 'list': return (await SF.io.listBoards()).map(b => ({ id: b.id, name: b.name, updated: new Date(b.updated).toISOString(), width: b.w, height: b.h }));
    case 'open': await SF.io.saveNow(); if (!(await SF.io.openBoard(a.id))) throw new Error('No board ' + a.id); return info();
  }
  throw new Error('Unknown board action ' + a.action);
}
async function image(a) {
  let src = a.data_url; if (!src) throw new Error('No image data');
  const im = await SF.io.loadImage(src); let c = SF.io.imageToCanvas(im, 2560);
  if (a.remove_background) { const g = c.getContext('2d'); const id = g.getImageData(0, 0, c.width, c.height); const out = SF.io.cutout(id, { auto: true, tol: num(a.tolerance, 18), soft: 1, holes: !!a.remove_holes, taps: [] }); g.putImageData(out, 0, 0); }
  let L = null; if (a.layer) L = SF.findLayer(a.layer);
  const r = SF.io.placeCanvas(c, { name: a.name || 'Image', x: a.x, y: a.y, width: a.width, height: a.height, rotation: num(a.rotation, 0) * Math.PI / 180, cut: !!a.remove_background, trace: !!a.as_reference, layer: L });
  return { layer: { id: r.layer.id, name: r.layer.name }, item: r.item.id, size: [Math.round(r.item.iw * r.item.s), Math.round(r.item.ih * r.item.s)] };
}
async function exportAll(a) {
  const kinds = a.formats && a.formats.length ? a.formats : ['png', 'tpng', 'svg', 'layers'];
  const opt = { scale: num(a.scale, 1), ref: !!a.include_reference }, files = [];
  for (const k of kinds) {
    if (k === 'layers') { for (const [i, L] of SF.doc.layers.entries()) { if (L.ref && !opt.ref) continue; files.push({ name: 'layers/' + String(i + 1).padStart(2, '0') + '-' + L.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.png', b64: await b64(SF.renderLayer(L, opt.scale)) }); } continue; }
    const r = await SF.io.exportBlob(k, opt);
    const buf = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    files.push({ name: r.name, b64: btoa(s) });
  }
  return { board: SF.doc.name, files };
}
function mechanism(a) {
  const d = SF.doc; if (!d.motion) d.motion = { pins: [], motors: [], traces: [] };
  const m = d.motion;
  if (a.clear) { SF.motion.stop(); d.motion = { pins: [], motors: [], traces: [] }; }
  const M2 = d.motion;
  (a.pins || []).forEach(p => { if (!M2.pins.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 2)) M2.pins.push({ x: +p.x, y: +p.y }); });
  (a.motors || []).forEach(mo => { M2.motors = M2.motors.filter(q => q.id !== mo.item); M2.motors.push({ id: mo.item, x: +mo.pivot_x, y: +mo.pivot_y, rpm: num(mo.rpm, 30) }); if (!M2.pins.some(q => Math.hypot(q.x - mo.pivot_x, q.y - mo.pivot_y) < 2)) M2.pins.push({ x: +mo.pivot_x, y: +mo.pivot_y }); });
  (a.traces || []).forEach(p => { if (!M2.traces.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 2)) M2.traces.push({ x: +p.x, y: +p.y }); });
  void m;
  SF.emit('change', 'motion');
  let sim = null;
  if (a.simulate !== false) sim = SF.motion.simulate({ steps: a.steps || 72, joints: a.watch });
  if (a.play) { SF.motion.toggle(true); SF.motion.play(); } else if (a.play === false) SF.motion.stop();
  return { motion: M2, simulation: sim };
}

async function run(cmd, a) {
  switch (cmd) {
    case 'ping': return { ok: true, board: SF.doc.name };
    case 'info': return info();
    case 'snapshot': return snapshot(a);
    case 'draw': return draw(a);
    case 'items': return items(a);
    case 'layers': return layers(a);
    case 'guides': return guides(a);
    case 'board': return board(a);
    case 'image': return image(a);
    case 'export': return exportAll(a);
    case 'mechanism': return mechanism(a);
    case 'say': SF.ui.say(String(a.text || ''), a.seconds); return { shown: true };
    case 'banner': SF.ui.banner(a.text || null); return { shown: !!a.text };
  }
  throw new Error('Unknown command ' + cmd);
}
B.run = run;

})(window.SF);
