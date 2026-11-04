/* SketchFlow motion (v1): every drawn item is a rigid link, touching joints are pin joints.
   Pin joints to ground, put a motor on a link, press play. Traces show the path a joint follows. */
(function (SF) {
'use strict';
const U = SF.U, $ = U.$, el = U.el;
const M = SF.motion = { editing: false, playing: false, mode: 'pin', speed: 30, sim: null };

const md = () => { if (!SF.doc.motion) SF.doc.motion = { pins: [], motors: [], traces: [] }; return SF.doc.motion; };
const near = (list, x, y, r) => list.findIndex(p => Math.hypot(p.x - x, p.y - y) < (r || 2));

/* ---------- build rigid-body graph from the active layer ---------- */
function build(items) {
  const nodes = [], cons = [], bodies = [];
  const nodeAt = (x, y) => { for (let i = 0; i < nodes.length; i++) if (Math.abs(nodes[i].x - x) < 0.75 && Math.abs(nodes[i].y - y) < 0.75) return i; nodes.push({ x, y, x0: x, y0: y, fixed: false }); return nodes.length - 1; };
  items.forEach((it, bi) => {
    if (it.t !== 'path' || it.pts.length < 6) return;
    const n = it.pts.length / 3;
    /* free strokes: only the two ends are joints; interior points ride along rigidly */
    const keyIdx = it.mode === 'poly' ? [...Array(n).keys()] : [0, n - 1];
    const ids = keyIdx.map(k => nodeAt(it.pts[k * 3], it.pts[k * 3 + 1]));
    const uniq = [...new Set(ids)];
    if (uniq.length < 2) return;
    for (let a = 0; a < uniq.length; a++) for (let b = a + 1; b < uniq.length && b <= a + 2; b++) { const A = nodes[uniq[a]], B = nodes[uniq[b]]; cons.push({ a: uniq[a], b: uniq[b], L: Math.hypot(A.x - B.x, A.y - B.y) }); }
    if (uniq.length > 3) { const A = nodes[uniq[0]], B = nodes[uniq[uniq.length - 1]]; cons.push({ a: uniq[0], b: uniq[uniq.length - 1], L: Math.hypot(A.x - B.x, A.y - B.y) }); }
    bodies.push({ bi, id: it.id, nodes: uniq, rest: uniq.map(i => ({ x: nodes[i].x, y: nodes[i].y })) });
  });
  return { nodes, cons, bodies };
}
/* rigid transform that best maps body rest nodes onto current nodes (2D Procrustes) */
function fit(rest, cur) {
  let cx0 = 0, cy0 = 0, cx1 = 0, cy1 = 0; const n = rest.length;
  for (let i = 0; i < n; i++) { cx0 += rest[i].x; cy0 += rest[i].y; cx1 += cur[i].x; cy1 += cur[i].y; }
  cx0 /= n; cy0 /= n; cx1 /= n; cy1 /= n;
  let s = 0, c = 0; for (let i = 0; i < n; i++) { const ax = rest[i].x - cx0, ay = rest[i].y - cy0, bx = cur[i].x - cx1, by = cur[i].y - cy1; c += ax * bx + ay * by; s += ax * by - ay * bx; }
  const a = Math.atan2(s, c), co = Math.cos(a), si = Math.sin(a);
  return [co, si, -si, co, cx1 - (co * cx0 - si * cy0), cy1 - (si * cx0 + co * cy0)];
}
function prepare() {
  const L = SF.layer(); if (!L) return null;
  const g = build(L.items), m = md();
  if (!g.bodies.length) { SF.toast('Draw some straight links first (lines, polylines, shapes)'); return null; }
  for (const p of m.pins) { const i = g.nodes.findIndex(n => Math.hypot(n.x - p.x, n.y - p.y) < 2); if (i >= 0) g.nodes[i].fixed = true; }
  g.motors = [];
  for (const mo of m.motors) {
    const b = g.bodies.find(b => b.id === mo.id); if (!b) continue;
    const pv = b.nodes.find(i => Math.hypot(g.nodes[i].x - mo.x, g.nodes[i].y - mo.y) < 2); if (pv == null) continue;
    g.nodes[pv].fixed = true;
    g.motors.push({ body: b, pivot: pv, rpm: mo.rpm == null ? M.speed : mo.rpm, rest: b.nodes.map(i => ({ x: g.nodes[i].x, y: g.nodes[i].y })) });
  }
  if (!g.motors.length) { SF.toast('Add a motor: Motor mode → tap a link next to a pinned joint'); return null; }
  g.L = L; g.items = L.items; g.theta = 0; g.trace = m.traces.map(t => ({ idx: g.nodes.findIndex(n => Math.hypot(n.x - t.x, n.y - t.y) < 2), pts: [] })).filter(t => t.idx >= 0);
  return g;
}
function step(g, dt) {
  g.theta += dt * (g.motors[0].rpm / 60) * Math.PI * 2;
  for (const mo of g.motors) {
    const th = g.theta * (mo.rpm / g.motors[0].rpm), pv = g.nodes[mo.pivot], c = Math.cos(th), s = Math.sin(th);
    mo.body.nodes.forEach((ni, k) => { if (ni === mo.pivot) return; const r = mo.rest[k], dx = r.x - pv.x0, dy = r.y - pv.y0; const n = g.nodes[ni]; n.x = pv.x0 + dx * c - dy * s; n.y = pv.y0 + dx * s + dy * c; n.driven = true; });
  }
  for (let it = 0; it < 60; it++) {
    for (const k of g.cons) {
      const A = g.nodes[k.a], B = g.nodes[k.b]; const fa = A.fixed || A.driven, fb = B.fixed || B.driven; if (fa && fb) continue;
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-9, diff = (d - k.L) / d;
      if (fa) { B.x -= dx * diff; B.y -= dy * diff; } else if (fb) { A.x += dx * diff; A.y += dy * diff; } else { A.x += dx * diff * 0.5; A.y += dy * diff * 0.5; B.x -= dx * diff * 0.5; B.y -= dy * diff * 0.5; }
    }
  }
  g.nodes.forEach(n => { n.driven = false; });
  for (const t of g.trace) { const n = g.nodes[t.idx]; t.pts.push(n.x, n.y, 0.5); if (t.pts.length > 3 * 2400) t.pts.splice(0, 3); }
}
function pose(g) {
  const byId = new Map(g.bodies.map(b => [b.id, b]));
  return g.items.map(it => {
    const b = byId.get(it.id); if (!b) return it;
    const m = fit(b.rest, b.nodes.map(i => g.nodes[i]));
    return SF.G.transformItem(it, m);
  });
}
/* error of loop closure: large means the mechanism is locked / over-constrained */
function strain(g) { let e = 0; for (const k of g.cons) { const A = g.nodes[k.a], B = g.nodes[k.b]; e = Math.max(e, Math.abs(Math.hypot(B.x - A.x, B.y - A.y) - k.L)); } return e; }

/* ---------- headless simulation for the AI bridge ---------- */
M.simulate = (o) => {
  o = o || {};
  const g = prepare(); if (!g) return { ok: false, error: 'Mechanism needs links, at least one pinned joint and a motor.' };
  const steps = U.clamp(o.steps || 72, 2, 720), dt = (60 / Math.abs(g.motors[0].rpm || 30)) / steps;
  const watch = (o.joints && o.joints.length ? o.joints : g.nodes.map(n => ({ x: n.x, y: n.y }))).map(p => g.nodes.findIndex(n => Math.hypot(n.x - p.x, n.y - p.y) < 3)).filter(i => i >= 0);
  const paths = watch.map(i => ({ start: { x: +g.nodes[i].x.toFixed(1), y: +g.nodes[i].y.toFixed(1) }, fixed: g.nodes[i].fixed, path: [] }));
  let maxStrain = 0;
  for (let s = 0; s < steps; s++) { step(g, dt); maxStrain = Math.max(maxStrain, strain(g)); watch.forEach((i, k) => paths[k].path.push([+g.nodes[i].x.toFixed(1), +g.nodes[i].y.toFixed(1)])); }
  return { ok: true, steps, links: g.bodies.length, joints: g.nodes.length, pins: g.nodes.filter(n => n.fixed).length, maxStrain: +maxStrain.toFixed(2), locked: maxStrain > 2, paths };
};

/* ---------- playback ---------- */
let raf = 0, last = 0;
M.play = () => {
  if (M.playing) return;
  const g = prepare(); if (!g) return false;
  M.sim = g; M.playing = true; last = performance.now();
  const tick = (t) => {
    if (!M.playing) return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    step(g, dt);
    SF.override = { layerId: g.L.id, items: pose(g) };
    M.locked = strain(g) > 2;
    SF.requestRender(); raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick); syncBar(); return true;
};
M.stop = () => { M.playing = false; cancelAnimationFrame(raf); SF.override = null; M.sim = null; M.locked = false; SF.requestRender(); syncBar(); };
M.bakeTraces = () => {
  if (!M.sim || !M.sim.trace.length) { SF.toast('Play with a trace first'); return; }
  const L = M.sim.L, items = M.sim.trace.filter(t => t.pts.length > 9).map(t => SF.newPath({ pts: t.pts.slice(), color: SF.colors.ai || '#14a394', width: 2, mode: 'free', brush: 'pen', dash: true, opacity: 0.9 }));
  M.stop(); SF.addItems(L, items); SF.commit('Bake motion path'); SF.toast('Motion path added as a dashed line');
};

/* ---------- editing: pins / motors / traces ---------- */
M.toggle = (on) => {
  M.editing = on == null ? !M.editing : on;
  if (!M.editing) M.stop();
  if (M.editing && SF.prefs.tool !== 'joint' && SF.prefs.tool !== 'select') SF.setTool('joint');
  syncBar(); SF.ui.refresh(); SF.requestRender();
  if (M.editing) SF.toast('Motion: Pin joints to ground, add a Motor to a link, press Play', 2600);
};
M.pointerDown = (e, d) => {
  if (M.playing) return true;
  const L = SF.layer(); if (!L) return false;
  const r = 16 / SF.view.z, J = SF.joints(L.items);
  let j = null, bd = r; for (const q of J) { const dd = Math.hypot(q.x - d.x, q.y - d.y); if (dd < bd) { bd = dd; j = q; } }
  const m = md();
  if (M.mode === 'pin') {
    if (!j) return false;
    const i = near(m.pins, j.x, j.y); if (i >= 0) m.pins.splice(i, 1); else m.pins.push({ x: j.x, y: j.y });
    SF.emit('change', 'motion'); SF.requestRender(); return true;
  }
  if (M.mode === 'trace') {
    if (!j) return false;
    const i = near(m.traces, j.x, j.y); if (i >= 0) m.traces.splice(i, 1); else m.traces.push({ x: j.x, y: j.y });
    SF.emit('change', 'motion'); SF.requestRender(); return true;
  }
  if (M.mode === 'motor') {
    const hit = SF.hitTop(d.x, d.y); if (!hit || hit.it.t !== 'path') { SF.toast('Tap a link (line) next to its pivot joint'); return true; }
    const it = hit.it, n = it.pts.length / 3, cands = (it.mode === 'poly' ? [...Array(n).keys()] : [0, n - 1]).map(k => ({ x: it.pts[k * 3], y: it.pts[k * 3 + 1] }));
    let piv = cands[0], pd = Infinity; for (const c of cands) { const dd = Math.hypot(c.x - d.x, c.y - d.y); if (dd < pd) { pd = dd; piv = c; } }
    const i = m.motors.findIndex(mo => mo.id === it.id);
    if (i >= 0) m.motors.splice(i, 1); else { m.motors.push({ id: it.id, x: piv.x, y: piv.y, rpm: M.speed }); if (near(m.pins, piv.x, piv.y) < 0) m.pins.push({ x: piv.x, y: piv.y }); }
    SF.emit('change', 'motion'); SF.requestRender(); return true;
  }
  return false;
};
M.pointerMove = () => {}; M.pointerUp = () => {};
M.drawOverlay = (c) => {
  if (!SF.doc || !SF.doc.motion) return;
  const m = SF.doc.motion, C = SF.colors; if (!M.editing && !M.playing) return;
  const nodes = M.sim ? M.sim.nodes : null;
  const posOf = (p) => { if (nodes) { const n = nodes.find(n => Math.hypot(n.x0 - p.x, n.y0 - p.y) < 2); if (n) return SF.toScreen(n.x, n.y); } return SF.toScreen(p.x, p.y); };
  c.save();
  for (const p of m.pins) { const s = posOf(p); c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x - 9, s.y + 13); c.lineTo(s.x + 9, s.y + 13); c.closePath(); c.fillStyle = C.cool; c.globalAlpha = 0.9; c.fill(); c.beginPath(); for (let k = -9; k <= 9; k += 5) { c.moveTo(s.x + k, s.y + 16); c.lineTo(s.x + k - 4, s.y + 20); } c.strokeStyle = C.cool; c.lineWidth = 1.4; c.stroke(); c.globalAlpha = 1; }
  for (const mo of m.motors) { const s = posOf(mo); c.beginPath(); c.arc(s.x, s.y, 15, -Math.PI * 0.2, Math.PI * 1.35); c.strokeStyle = C.accent; c.lineWidth = 2.5; c.stroke(); const a = Math.PI * 1.35; c.beginPath(); c.moveTo(s.x + Math.cos(a) * 15, s.y + Math.sin(a) * 15); c.lineTo(s.x + Math.cos(a) * 15 + 7, s.y + Math.sin(a) * 15 - 2); c.lineTo(s.x + Math.cos(a) * 15 + 1, s.y + Math.sin(a) * 15 + 6); c.closePath(); c.fillStyle = C.accent; c.fill(); }
  for (const t of m.traces) { const s = posOf(t); c.beginPath(); c.arc(s.x, s.y, 7, 0, Math.PI * 2); c.strokeStyle = C.ai; c.lineWidth = 2; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]); }
  if (M.sim) for (const t of M.sim.trace) { c.beginPath(); for (let i = 0; i < t.pts.length; i += 3) { const s = SF.toScreen(t.pts[i], t.pts[i + 1]); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); } c.strokeStyle = C.ai; c.lineWidth = 1.6; c.globalAlpha = 0.85; c.stroke(); c.globalAlpha = 1; }
  if (M.locked) { c.font = '700 13px "Figtree", sans-serif'; c.fillStyle = C.warn; c.fillText('Mechanism is locking up — check pins and link lengths', 16, innerHeight - 140); }
  c.restore();
};

/* ---------- floating motion bar ---------- */
let bar = null;
function syncBar() {
  document.body.classList.toggle('motion', M.editing);
  if (!M.editing) { if (bar) { bar.remove(); bar = null; } return; }
  if (!bar) {
    bar = el('div', { class: 'pill', id: 'motionBar', style: 'left:50%;transform:translateX(-50%);bottom:calc(76px + env(safe-area-inset-bottom,0px));gap:6px;padding:6px 8px;flex-wrap:wrap;max-width:calc(100vw - 24px)' });
    document.body.append(bar);
  }
  bar.innerHTML = '';
  const segEl = el('div', { class: 'seg' });
  [['pin', 'Pin'], ['motor', 'Motor'], ['trace', 'Trace']].forEach(([k, n]) => segEl.append(el('button', { class: M.mode === k ? 'on' : '', onclick: () => { M.mode = k; syncBar(); } }, n)));
  const playB = el('button', { class: 'primary' + (M.playing ? '' : ' acc'), onclick: () => (M.playing ? M.stop() : M.play()) }, M.playing ? '■ Stop' : '▶ Play');
  const sp = el('input', { type: 'range', min: 2, max: 120, step: 1, value: M.speed, style: 'width:90px;accent-color:var(--accent)' });
  sp.oninput = () => { M.speed = +sp.value; const m = md(); m.motors.forEach(mo => { mo.rpm = M.speed; }); if (M.sim) M.sim.motors.forEach(mo => { mo.rpm = M.speed; }); spl.textContent = M.speed + ' rpm'; };
  const spl = el('span', { class: 'mini', style: 'font-family:var(--f-mono)' }, M.speed + ' rpm');
  const clr = el('button', { class: 'tbtn', onclick: () => { M.stop(); SF.doc.motion = { pins: [], motors: [], traces: [] }; SF.emit('change', 'motion'); SF.requestRender(); } }, 'Clear');
  const bake = el('button', { class: 'tbtn', onclick: M.bakeTraces }, 'Keep path');
  const close = el('button', { class: 'tbtn', onclick: () => M.toggle(false) }, 'Done');
  bar.append(el('span', { class: 'lbl', style: 'font:700 11px var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);padding:0 4px' }, 'Motion'), segEl, playB, sp, spl, bake, clr, close);
}
M.syncBar = syncBar;
SF.on('doc', () => { M.stop(); });

})(window.SF);
