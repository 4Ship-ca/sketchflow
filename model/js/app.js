/* SketchFlow 3D workspace: feature tree, properties, tools (add · sketch→extrude/revolve/loft · mate · booleans ·
   edge treatments · measure), editable carried dimensions, autosave, export, and the AI (MCP) bridge. */
import { THREADS, Model, TYPES, worldConnectors, newDoc, poseFromMatrix, K, MATERIALS, massReport, bom, registerAddon, listAddons, ADDONS, findSeams, dimsOf, measureDim, parseExpr, JOINTS, jointsOf, posedDoc, evaluate, HOLES, holeSpec, parseMesh, encodeTriangles, shapeProfile, SKETCH_SHAPES } from './model.js';
import { Views, fmt } from './views.js';
import gears from '../addons/gears.js';
import { drawingSVG, drawingDXF } from './drawing.js';
import { autoConstraints, KINDS as SKETCH_KINDS, expandArcs, arcThrough, arcTangent, arcMid, splinePoints } from './sketch.js';
import { interference, collisions, restBaseline } from './collide.js';
import { EXAMPLES, exampleDoc } from './examples.js';
import { exportStep, stepToSolids } from './step.js';
const { V, M4 } = K;
/* built-in add-ons are registered before the saved model is evaluated (it may use their shapes) */
registerAddon(gears);
const $ = (s) => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) { const v = attrs[k]; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v != null && v !== false) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
/* toasts sit at the top of the views (the bottom belongs to the tool bar and the motion drawer); at most three at once */
/* toasts sit at the bottom (they let clicks through); above the motion drawer when it is open */
const placeToasts = () => { const T = document.querySelector('#toasts'), mo = document.querySelector('#motion'); if (!T) return; T.style.top = ''; T.style.bottom = (mo && !mo.hidden ? innerHeight - mo.getBoundingClientRect().top + 8 : 22) + 'px'; };
const trimToasts = () => { const T = $('#toasts'); while (T.children.length > 3) T.firstChild.remove(); };
const toast = (t, ms) => { placeToasts(); const d = el('div', { class: 'toast' }, t); $('#toasts').append(d); trimToasts(); setTimeout(() => d.remove(), ms || 2200); };
/* a toast with buttons (stays until used, dismissed or timed out) */
const toastAct = (t, actions, ms) => {
  const d = el('div', { class: 'toast act' }, el('span', null, t), ...actions.map(([label, fn]) => el('button', { onclick: () => { d.remove(); fn(); } }, label)), el('button', { class: 'x', onclick: () => d.remove(), 'aria-label': 'Dismiss' }, '×'));
  placeToasts(); $('#toasts').append(d); trimToasts(); setTimeout(() => d.remove(), ms || 9000); return d;
};

const ICON = {
  wrap: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3v12c0 1.7-3.1 3-7 3s-7-1.3-7-3zM9 10h6M12 10v6',
  drape: 'M3 17c3-9 15-9 18 0M9 9l1 4h4l1-4M12 3v4',
  split: 'M3 21L21 3M6 9V6h3M18 15v3h-3M4 14l6 6M14 4l6 6',
  view: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  boss: 'M3 16l9 4 9-4-9-4zM8 14V8.5l4-2 4 2V14M8 8.5l4 2 4-2M12 10.5V16',
  cut: 'M3 12l9 4 9-4-9-4zM3 12v4l9 4 9-4v-4M8 12.2l4-1.8 4 1.8-4 1.8z',
  face: 'M3 15l9 4 9-4-9-4zM8.5 15l3.5-1.6 3.5 1.6-3.5 1.6zM16 4l4 4-6 6h-4v-4z',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', wedge: 'M4 18h16L4 6zM4 6l4-2 12 12', cylinder: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6',
  cone: 'M12 3L5 18M12 3l7 15M5 18c0 1.7 3.1 3 7 3s7-1.3 7-3-3.1-3-7-3-7 1.3-7 3z', sphere: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5',
  fillet: 'M4 20V4M4 20h16M4 8c0 7 5 12 12 12', weld: 'M4 20V4M4 20h16M4 12a8 8 0 0 0 8 8', chamfer: 'M4 20V4M4 20h16M4 10l10 10', sketch: 'M4 18l5-12 6 8 5-6M4 18h16',
  mate: 'M7 7h4v4H7zM13 13h4v4h-4zM11 11l2 2', union: 'M9 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12M15 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12', subtract: 'M9 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12M15 6a6 6 0 0 1 0 12',
  intersect: 'M12 7.5a6 6 0 0 1 0 9a6 6 0 0 1 0-9M9 6a6 6 0 1 0 0 12M15 6a6 6 0 1 1 0 12', dim: 'M4 7v10M20 7v10M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3', undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', hidden: 'M3 12h3M9 12h3M15 12h3M21 12h0M4 6h16M4 18h16', sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5', board: 'M4 5h16v12H4zM8 21h8M12 17v4', extrude: 'M6 18h8l4-4H10zM6 18V8l4-4v10M14 18V8l4-4', revolve: 'M12 3v18M8 6a4 9 0 1 0 8 0', loft: 'M5 19h10l4-4M7 7h6l2-2M5 19L7 7M15 19l-2-12', sweep: 'M5 19c4 0 4-14 14-14',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  pattern: 'M4 9h4v4H4zM10 9h4v4h-4zM16 9h4v4h-4zM4 15l16 0', circular: 'M12 4a8 8 0 1 0 8 8M20 4v5h-5M11 11h2v2h-2z', mirror: 'M12 3v18M9 7L4 17h5zM15 7l5 10h-5z',
  explode: 'M9 9h6v6H9zM4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3', clash: 'M8 8a5 5 0 1 0 0 0.01M16 8a5 5 0 1 0 0 0.01M12 13v4M12 20v.5', instance: 'M4 9h9v9H4zM9 4h11v11h-3M9 4v5', mesh: 'M12 3l9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8', hole: 'M4 7h16v10H4zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 4v3M12 17v3', shell: 'M4 8l8-4 8 4v8l-8 4-8-4zM7 9.5l5-2.5 5 2.5v5L12 17l-5-2.5z', motion: 'M12 4a8 8 0 1 0 8 8M20 4v5h-5M10 9l5 3-5 3z', section: 'M4 4h16v16H4zM4 14l10-10M9 20L20 9M14 20l6-6', cog: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 3v9h9M12 21v-9H3',
  addon: 'M9 4h6v3a2 2 0 1 0 4 0V4h1v16H4V4h1v3a2 2 0 1 0 4 0z', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', material: 'M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10'
};
const icon = (n) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICON[n] || ICON.box); s.append(p); return s; };
document.querySelectorAll('[data-icon]').forEach(b => b.prepend(icon(b.dataset.icon)));

/* ---------- model + persistence ---------- */
const load = () => { try { const s = localStorage.getItem('sf3.model'); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
const model = new Model(load() || newDoc('Model'));
const save = debounce(() => { try { localStorage.setItem('sf3.model', JSON.stringify(model.doc)); } catch (e) { /* storage blocked */ } }, 400);
const views = new Views($('#gl'), $('#ov'), model);
let selected = null;
const prefs = (() => { try { return JSON.parse(localStorage.getItem('sf3.prefs') || '{}'); } catch (e) { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('sf3.prefs', JSON.stringify(prefs)); } catch (e) { /* blocked */ } };
if (prefs.theme) document.documentElement.setAttribute('data-theme', prefs.theme);
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
views.setTheme(isDark());
model.on(() => { collisionBase = null; if (views.motion && !anim) { motionPose = null; views.motion = null; views.collide = null; } views.rebuild(); refreshGhost(); views.draw(); renderTree(); renderProps(); save(); syncBar(); if (!$('#motion').hidden && !anim) openMotion(); });
function apply(ops, label) { try { return model.apply(ops, label); } catch (e) { toast('⚠ ' + e.message, 3200); throw e; } }

/* ---------- tree ---------- */
function statusOf(o) {
  const w = model.result.warnings.filter(x => x.id === o.id), b = [];
  if (w.some(x => x.kind === 'floating')) b.push(['floating', 'w']); if (w.some(x => x.kind === 'orphan')) b.push(['orphan', 'w']);
  if (w.some(x => x.kind === 'error' || x.kind === 'edge' || x.kind === 'empty' || x.kind === 'cycle')) b.push(['error', 'w']);
  if (o.into) b.push([o.type === 'edge' ? (o._resolved ? o._resolved.mode : 'edge') : o.op === 'add' ? 'union' : o.op, o.op === 'add' || (o._resolved && o._resolved.mode === 'add') ? 'add' : 'sub']);
  if (o.id === model.result.ground) b.push(['ground', '']);
  return b;
}
function subOf(o) {
  const p = o.params || {}, name = (id) => (model.get(id) || {}).name || id;
  switch (o.type) {
    case 'box': case 'wedge': return `${fmt(p.width)} × ${fmt(p.depth)} × ${fmt(p.height)}`;
    case 'cylinder': return `Ø${fmt(p.diameter)} × ${fmt(p.height)}`;
    case 'cone': return `Ø${fmt(p.diameter)}→${fmt(p.top || 0)} × ${fmt(p.height)}`;
    case 'sphere': return `Ø${fmt(p.diameter)}`;
    case 'edge': return `${p.style} ${fmt(p.size)}${o._resolved && o._resolved.round ? ' round' : ''} · on ${name(o.into)}`;
    case 'fillet': return `${p.style} ${fmt(p.size)} × ${fmt(p.length)}`;
    case 'extrude': if (p.shape && p.shape !== 'points') return `${p.shape === 'rect' ? 'rectangle ' + fmt(p.width) + ' × ' + fmt(p.height) + (p.radius ? ' r' + fmt(p.radius) : '') : p.shape === 'slot' ? 'slot ' + fmt(p.width) + ' × ' + fmt(p.height) : (p.shape === 'polygon' ? p.sides + '-gon Ø' : 'circle Ø') + fmt(p.diameter)} · ${fmt(p.length)}${o.into ? ' · cut' : ''}`;
    /* falls through */
    case 'loft': return `${p.profile.length} pts · ${fmt(p.length)}${(p.sections || []).length ? ' · ' + (p.sections.length + 2) + ' sections' : ''}${(p.guides || []).length ? ' · ' + p.guides.length + ' guide' + (p.guides.length > 1 ? 's' : '') : ''}${p.twist ? ' · ' + p.twist + '°' : ''}`;
    case 'revolve': return `${p.profile.length} pts · ${fmt(p.degrees)}°`;
    case 'sweep': return p.helix ? `coil · ${fmt(p.helix.turns)} turns` : `${p.profile.length} pts · ${p.path.length - 1} segments${p.smooth ? ' · smooth' : ''}${p.twist ? ' · ' + fmt(p.twist) + '° twist' : ''}${p.scale != null && +p.scale !== 1 ? ' · ×' + fmt(p.scale) + ' at end' : ''}`;
    case 'gear': return `${p.internal ? 'ring · ' : ''}m${fmt(p.module)} · ${p.teeth}T · ${p.style}${p.style !== 'spur' && p.helix ? ' ' + p.helix + '°' : ''}`;
    case 'pattern': { const n = [...(model.result.virtual || new Map()).values()].filter(v => v.pattern === o.id && v.source === (o.of || [])[0]).length + 1; return `${p.kind} ×${n} · ${(o.of || []).filter(i => (model.get(i) || {}).type !== 'edge').map(name).join(', ')}`; }
    case 'weld': return `${fmt(p.size)} ${p.profile}${p.all_around ? ' all round' : ''} · ${(o.joins || []).map(name).join(' + ')}`;
    case 'hole': { try { return holeSpec(p).label + (p.through ? ' · through' : ` · ${fmt(p.depth)} deep`); } catch (e) { return p.size + ' ' + p.kind; } }
    case 'instance': return `linked copy of ${name(o.of)}`;
    case 'mesh': { const mm = (model.doc.meshes || {})[p.ref || o.id]; return `imported mesh${mm && mm.tris ? ' · ' + mm.tris.toLocaleString() + ' triangles' : ''}${p.scale !== 1 ? ' · ×' + p.scale : ''}`; }
    case 'bolt': return `${p.size} × ${fmt(p.length)} ${p.head === 'socket' ? 'socket head' : 'hex'} · modelled thread`;
    case 'nut': return `${p.size === 'custom' ? 'Ø' + fmt(p.diameter) + ' × ' + fmt(p.pitch) : p.size} ${p.shape || 'hex'} nut`;
    case 'wrap': return `${p.text ? '“' + String(p.text).slice(0, 18) + '”' : (p.profile || []).length + ' pts'} wrapped ${p.mode === 'engrave' ? 'in' : 'on'} R${fmt(typeof p.radius === 'number' ? p.radius : 0)} · ${fmt(p.depth)} deep`;
    case 'drape': return `${p.text ? '“' + String(p.text).slice(0, 18) + '”' : (p.profile || []).length + ' pts'} projected ${p.mode === 'engrave' ? 'into' : 'onto'} ${name(o.into)} · ${fmt(p.depth)} ${p.mode === 'engrave' ? 'deep' : 'high'}`;
    case 'shell': return `${fmt(p.thickness)} mm walls${p.open && p.open !== 'none' ? ' · open ' + p.open : ''} · on ${name(o.into)}`;
    case 'text': return `“${String(p.text).slice(0, 24)}” · ${fmt(p.height)} mm${p.path && p.path !== 'line' ? ' · ' + (p.path === 'points' ? 'on a path' : p.path === 'arc' ? 'arc R' + fmt(p.radius) : 'arc (inside) R' + fmt(p.radius)) : ''}${o.into ? (o.op === 'subtract' ? ' · engraved ' : ' · embossed ') + fmt(p.depth) + ' on ' + name(o.into) : ''}`;
    default: return TYPES[o.type] ? TYPES[o.type].label : o.type;
  }
}
const iconOf = (o) => (o.type === 'edge' ? o.params.style : o.type === 'pattern' ? (o.params.kind === 'circular' ? 'circular' : o.params.kind === 'mirror' ? 'mirror' : 'pattern') : ICON[o.type] ? o.type : TYPES[o.type] && TYPES[o.type].addon ? 'addon' : o.type);
/* ---------- motion: preview joint poses by moving the existing meshes (the model is untouched until you keep a pose) ---------- */
let motionPose = null;
let collisionBase = null, lastHit = null;
function previewPose(pose) {
  motionPose = Object.assign({}, motionPose || {}); for (const [id, kv] of Object.entries(pose)) motionPose[id] = Object.assign({}, motionPose[id] || {}, kv);
  const R = model.result, R2 = evaluate(posedDoc(model.doc, motionPose), { placementOnly: true }), deltas = new Map(), moving = new Map();
  for (const b of R.bodies) {
    const w = b.weld ? model.get(b.id) : null, root = w ? (model.bodyContaining((w.joins || [])[0]) || {}).id : b.id;
    const Wo = R.world.get(root), Wn = R2.world.get(root); if (!Wo || !Wn) continue;
    const D = M4.mul(Wn, M4.inv(Wo)); deltas.set(b.id, Float32Array.from(D));
    if (D.some((v, k) => Math.abs(v - (k % 5 === 0 ? 1 : 0)) > 1e-9)) moving.set(b.id, D);
  }
  views.motion = deltas;
  /* collisions: moving parts against everything, ignoring pairs that already overlap at rest */
  lastHit = null; views.collide = null;
  if (prefs.collide !== false && moving.size) {
    if (!collisionBase) collisionBase = restBaseline(model);
    const hits = collisions(model, moving, { baseline: collisionBase });
    if (hits.length) { lastHit = hits; views.collide = new Set(hits.flatMap(h => [h.a, h.b])); }
  }
  const msg = document.querySelector('#motion .clashmsg'); if (msg) { msg.textContent = lastHit ? `⚠ ${lastHit.map(h => h.names.join(' ↔ ')).join(', ')}` : ''; }
  views.draw();
  return lastHit;
}
function clearPreview() { motionPose = null; views.motion = null; views.collide = null; lastHit = null; views.draw(); }
let anim = null;
function openMotion(focusId) {
  const box = $('#motion'); box.hidden = false; box.innerHTML = '';
  const joints = jointsOf(model.doc);
  const head = el('div', { class: 'mhead' }, el('b', null, 'Motion'), el('span', { class: 'note' }, joints.length ? 'Drag a slider or press play. Meshed gears and mated parts follow.' : 'No joints yet.'),
    el('label', { class: 'hf', title: 'Turn parts red where moving parts run into others' }, (() => { const c = el('input', { type: 'checkbox' }); c.checked = prefs.collide !== false; c.onchange = () => { prefs.collide = c.checked; savePrefs(); }; return c; })(), 'collisions'),
    el('label', { class: 'hf', title: 'Stop playing at the first collision' }, (() => { const c = el('input', { type: 'checkbox' }); c.checked = prefs.stopOnHit !== false; c.onchange = () => { prefs.stopOnHit = c.checked; savePrefs(); }; return c; })(), 'stop at contact'),
    el('span', { class: 'warnline clashmsg' }, ''),
    el('span', { style: 'flex:1' }), el('button', { class: 'btn pri keep', hidden: !motionPose, onclick: keepPose, title: 'Make this pose the model’s position (undoable)' }, 'Keep this pose'), el('button', { class: 'btn', onclick: () => { stopAnim(); clearPreview(); openMotion(); } }, 'Reset'), el('button', { class: 'btn', onclick: closeMotion }, 'Close'));
  box.append(head);
  if (!joints.length) {
    const cands = model.doc.objects.filter(o => o.mate && !o.mate.kind && o.mate.to !== 'origin');
    box.append(el('div', { class: 'note', style: 'padding:4px 2px 8px' }, 'Select a mated part and choose a Joint type in Properties (Revolute spins it, Slider moves it along a line). Parts mated or meshed to it follow.'));
    const gearDriver = cands.find(o => o.type === 'gear' && model.doc.objects.some(g => g.mate && g.mate.kind === 'gear' && g.mate.to === o.id));
    if (gearDriver) box.append(el('div', { class: 'btns' }, el('button', { class: 'btn pri', onclick: () => { apply([{ op: 'joint', id: gearDriver.id, joint: 'revolute' }], `${gearDriver.name}: revolute`); openMotion(gearDriver.id); } }, `Make ${gearDriver.name} spin`)));
    return;
  }
  for (const j of joints) for (const dof of j.dofs) {
    const cur = motionPose && motionPose[j.id] && motionPose[j.id][dof.key] != null ? motionPose[j.id][dof.key] : dof.value;
    const val = el('span', { class: 'mono' }, fmt(cur) + dof.unit), rng = el('input', { type: 'range', min: dof.min, max: dof.max, step: dof.unit === '°' ? 0.5 : 0.25, value: cur });
    rng.addEventListener('input', () => { stopAnim(); previewPose({ [j.id]: { [dof.key]: +rng.value } }); val.textContent = fmt(+rng.value) + dof.unit; head.querySelector('.keep').hidden = false; });
    const play = el('button', { class: 'chain', title: 'Play', onclick: () => startAnim(j, dof, rng, val, play) }, '▶');
    box.append(el('div', { class: 'mrow' + (j.id === focusId ? ' on' : '') }, el('span', { class: 'mname' }, `${j.name} · ${dof.key}`), rng, val, play));
  }
}
function startAnim(j, dof, rng, val, btn) {
  if (anim && anim.btn === btn) { stopAnim(); return; }
  stopAnim();
  const spin = dof.unit === '°' && !dof.limited, speed = spin ? 60 : (dof.max - dof.min) / 2.5;   /* °/s for free spins, a full stroke in 2.5 s otherwise */
  let t0 = performance.now(), v0 = +rng.value, dir = 1;
  btn.textContent = '❚❚';
  const step = (now) => {
    if (!anim) return;
    const dt = (now - t0) / 1000; t0 = now;
    if (spin) v0 += speed * dt; else { v0 += dir * speed * dt; if (v0 > dof.max) { v0 = dof.max; dir = -1; } if (v0 < dof.min) { v0 = dof.min; dir = 1; } }
    const hit = previewPose({ [j.id]: { [dof.key]: v0 } }); const kb = document.querySelector('#motion .keep'); if (kb) kb.hidden = false;
    if (hit && prefs.stopOnHit !== false && prefs.collide !== false) { stopAnim(); rng.value = Math.max(dof.min, Math.min(dof.max, v0)); toast(`Stopped: ${hit[0].names.join(' and ')} touch at ${fmt(Math.round(v0 * 10) / 10)}${dof.unit}`, 3000); const m2 = document.querySelector('#motion .clashmsg'); if (m2) m2.textContent = `⚠ contact at ${fmt(Math.round(v0 * 10) / 10)}${dof.unit}: ${hit.map(h => h.names.join(' ↔ ')).join(', ')}`; return; }
    rng.value = ((v0 - dof.min) % (dof.max - dof.min) + (dof.max - dof.min)) % (dof.max - dof.min) + dof.min; val.textContent = fmt(Math.round(v0 * 10) / 10) + dof.unit;
    anim.raf = requestAnimationFrame(step);
  };
  anim = { btn, raf: requestAnimationFrame(step) };
}
function stopAnim() { if (anim) { cancelAnimationFrame(anim.raf); if (anim.btn) anim.btn.textContent = '▶'; anim = null; } }
function keepPose() {
  stopAnim(); if (!motionPose) return;
  const pose = motionPose; clearPreview();
  apply([{ op: 'drive', values: pose }], 'Keep pose'); openMotion();
}
function closeMotion() { stopAnim(); clearPreview(); $('#motion').hidden = true; }
/* ---------- interference check ---------- */
function runInterference() {
  const t0 = performance.now(); let res; try { res = interference(model); } catch (e) { toast('Check failed: ' + e.message, 3000); return; }
  const ms = performance.now() - t0, box = $('#check'); box.hidden = false; box.innerHTML = '';
  views.setHighlights(res.map(r => r.region));
  box.append(el('div', { class: 'mhead' }, el('b', null, 'Interference'), el('span', { class: res.length ? 'warnline' : 'ok' }, res.length ? `${res.length} overlap${res.length > 1 ? 's' : ''}` : 'No parts overlap'), el('span', { style: 'flex:1' }), el('button', { class: 'btn', onclick: runInterference }, 'Re-check'), el('button', { class: 'btn', onclick: closeCheck }, 'Close')));
  for (const r of res) box.append(el('button', { class: 'clash', onclick: () => { select(r.a); views.setHighlights([r.region]); } }, el('span', null, `${r.names[0]} ↔ ${r.names[1]}`), el('span', { class: 'mono' }, `${fmt(r.volume)} mm³${r.exact ? '' : ' ≈'}`)));
  if (res.length) box.append(el('div', { class: 'note' }, 'Red = where they overlap. Click one to select the first part; mate it away, resize it, or subtract one from the other.'));
  box.append(el('div', { class: 'note' }, `${model.result.bodies.length} parts checked in ${Math.round(ms)} ms`));
}
function closeCheck() { $('#check').hidden = true; views.setHighlights([]); }
/* the ⋯ / right-click menu of a feature-list row */
const META = new Set(['edge', 'pattern', 'weld', 'shell']);
function rowMenu(o, r) {
  const m = el('div', { class: 'menu', style: `left:${Math.min(r.left, innerWidth - 230)}px;top:${r.bottom + 4}px` }), idx = model.doc.objects.indexOf(o);
  const item = (t, fn, disabled) => m.append(el('button', { onclick: () => { m.remove(); fn(); }, disabled: disabled ? true : null }, t));
  item('Rename', () => { select(o.id); setTimeout(() => { const i = document.querySelector('#pbody input'); if (i) { i.focus(); i.select(); } }, 30); });
  item(o.suppressed ? 'Unsuppress' : 'Suppress (turn off, keep it)', () => apply([{ op: 'suppress', id: o.id }]));
  if (!['edge', 'pattern'].includes(o.type)) item(o.hidden ? 'Show' : 'Hide', () => apply([{ op: 'set', id: o.id, hidden: !o.hidden }]));
  if (!['edge', 'pattern', 'weld'].includes(o.type)) { item('Duplicate  (Ctrl D)', () => { const r2 = apply([{ op: 'duplicate', id: o.id }])[0]; select(r2.id); }); item('Pattern…  (P)', () => { select(o.id); patternHint(o.id); }); }
  if (!META.has(o.type) && !o.into && o.type !== 'instance') item('Insert instance (linked copy)', () => { const r2 = apply([{ op: 'instance', of: o.id }])[0]; select(r2.id); toast('Linked copy: change the original and every instance follows', 2400); });
  const cfg = (model.doc.configs || []).find(c => c.name === model.doc.config);
  if (cfg) { const inCfg = (cfg.suppress || []).includes(o.id); item(inCfg ? `Include in “${cfg.name}”` : `Suppress in “${cfg.name}” only`, () => apply([{ op: 'config', action: 'set', name: cfg.name, suppress: inCfg ? cfg.suppress.filter(x => x !== o.id) : [...(cfg.suppress || []), o.id] }])); }
  item('Roll back to here', () => apply([{ op: 'rollback', to: idx + 1 }]));
  item('Move up', () => apply([{ op: 'move', id: o.id, to: idx - 1 }]), idx === 0);
  item('Move down', () => apply([{ op: 'move', id: o.id, to: idx + 2 }]), idx === model.doc.objects.length - 1);
  item('Delete', () => { apply([{ op: 'delete', id: o.id }]); select(null); });
  document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function offm(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', offm); } }), 0);
}
/* "By part": each part with what shapes it (its tools, edges, patterns, welds); "History": the order things were made */
function treeOrder() {
  const objs = model.doc.objects;
  if ((prefs.treeMode || 'part') === 'history') return objs.map(o => ({ o, depth: o.into ? 1 : 0 }));
  const byId = new Map(objs.map(o => [o.id, o])), placed = new Set(), out = [];
  const rootOf = (o) => { let c = o; const seen = new Set(); while (c && c.into && byId.has(c.into) && !seen.has(c.id)) { seen.add(c.id); c = byId.get(c.into); } return c; };
  const ownerOf = (o) => (o.type === 'pattern' ? rootOf(byId.get((o.of || [])[0]) || o) : o.type === 'weld' ? byId.get((o.joins || [])[0]) : o.into ? rootOf(o) : null);
  const kids = (root) => objs.filter(o => o !== root && !placed.has(o.id) && ownerOf(o) && ownerOf(o).id === root.id);
  for (const o of objs) {
    if (placed.has(o.id) || ownerOf(o)) continue;
    out.push({ o, depth: 0 }); placed.add(o.id);
    for (const k of kids(o)) { out.push({ o: k, depth: 1 }); placed.add(k.id); }
  }
  for (const o of objs) if (!placed.has(o.id)) out.push({ o, depth: 1 });
  return out;
}
function renderTree() {
  const list = $('#list'); list.innerHTML = '';
  const objs = model.doc.objects; $('#count').textContent = objs.length;
  const mode = prefs.treeMode || 'part';
  list.append(el('div', { class: 'seg' }, ...[['part', 'By part'], ['history', 'History']].map(([k, t]) => el('button', { class: mode === k ? 'on' : '', onclick: () => { prefs.treeMode = k; savePrefs(); renderTree(); } }, t))));
  if (!objs.length) list.append(el('div', { class: 'empty' }, 'Add a shape from the toolbar, or sketch a profile in a FRONT / TOP / RIGHT view. New shapes stack on the first one; Mate connects any connector to any other.'));
  const off = model.result.off || new Set(), rb = Number.isInteger(model.doc.rollback) ? model.doc.rollback : objs.length;
  const bar = () => {
    const step = (to) => (e) => { e.stopPropagation(); apply([{ op: 'rollback', to }]); };
    const b = el('div', { class: 'rollbar', draggable: 'true', title: 'Rollback bar: drag it, or use the arrows, to see the model as it was; new features go in at the bar' },
      el('span', null, rb < objs.length ? `Rolled back (${objs.length - rb} after the bar)` : 'Rollback bar'),
      el('span', { class: 'rbtns' }, el('button', { title: 'Roll back one feature', disabled: rb > 0 ? null : true, onclick: step(Math.max(0, rb - 1)) }, '▲'), el('button', { title: 'Roll forward one feature', disabled: rb < objs.length ? null : true, onclick: step(rb + 1 >= objs.length ? null : rb + 1) }, '▼'), rb < objs.length ? el('button', { title: 'Roll to the end (every feature on)', onclick: step(null) }, 'To end') : ''));
    b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/sf-roll', '1'); e.dataTransfer.effectAllowed = 'move'; });
    b.addEventListener('dblclick', () => apply([{ op: 'rollback', to: null }]));
    return b;
  };
  const rows = treeOrder();
  rows.forEach(({ o, depth }, k) => {
    const sub = subOf(o) + (o.expr && Object.keys(o.expr).length ? ' · 🔗' : '');
    const row = el('div', { class: 'row' + (o.id === selected ? ' on' : '') + (depth ? ' tool' : '') + (off.has(o.id) ? ' off' : '') + (o.suppressed ? ' sup' : ''), 'data-id': o.id, onclick: () => select(o.id), title: o.mate ? `mated ${o.mate.b} → ${o.mate.to === 'origin' ? 'origin' : (model.get(o.mate.to) || {}).name} · ${o.mate.a}` : '' },
      el('span', { class: 'ic' }, icon(iconOf(o))),
      el('div', { style: 'min-width:0' }, el('div', { class: 'nm' }, o.name), el('div', { class: 'sub' }, o.suppressed ? 'suppressed · ' + sub : sub)),
      el('div', { style: 'display:flex;gap:3px;align-items:center' }, ...statusOf(o).map(([t, c]) => el('span', { class: 'badge ' + c }, t)), el('button', { class: 'more', title: 'More…', onclick: (e) => { e.stopPropagation(); rowMenu(o, e.currentTarget.getBoundingClientRect()); } }, '⋯')));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); rowMenu(o, { left: e.clientX, right: e.clientX, bottom: e.clientY }); });
    if (mode === 'history') {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/sf-id', o.id); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', (e) => { e.preventDefault(); const r = row.getBoundingClientRect(); row.classList.toggle('dropafter', e.clientY > r.top + r.height / 2); row.classList.toggle('dropbefore', e.clientY <= r.top + r.height / 2); });
      row.addEventListener('dragleave', () => row.classList.remove('dropafter', 'dropbefore'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); const after = row.classList.contains('dropafter'); row.classList.remove('dropafter', 'dropbefore');
        const idx = objs.indexOf(o) + (after ? 1 : 0);
        if (e.dataTransfer.getData('text/sf-roll')) { apply([{ op: 'rollback', to: idx }]); return; }
        const id = e.dataTransfer.getData('text/sf-id'); if (!id || id === o.id) return;
        try { apply([{ op: 'move', id, to: idx }]); } catch (err) { /* toast shown */ }
      });
    }
    if (mode === 'history' && k === rb) list.append(bar());
    list.append(row);
  });
  if (mode === 'history' && rb >= objs.length && objs.length) list.append(bar());
  const ban = $('#banner');
  if (ban) { ban.hidden = !(rb < objs.length); ban.innerHTML = ''; if (rb < objs.length) ban.append(el('span', null, `Rolled back: ${objs.length - rb} feature${objs.length - rb > 1 ? 's are' : ' is'} off; new features go at the bar.`), el('button', { onclick: () => apply([{ op: 'rollback', to: null }]) }, 'Roll to the end')); }
  const w = model.result.warnings, box = $('#warn');
  box.hidden = !w.length; box.innerHTML = '';
  if (w.length) {
    box.append(el('b', null, w.length + (w.length === 1 ? ' thing needs attention' : ' things need attention')));
    w.slice(0, 8).forEach(x => box.append(el('div', { style: 'cursor:pointer', onclick: () => select(x.id) }, '• ' + x.text)));
    box.append(el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => apply([{ op: 'cleanup', fixFloating: false }]) }, 'Fix orphans'), el('button', { class: 'btn', onclick: () => apply([{ op: 'cleanup', fixFloating: true }]) }, 'Fix all in place')));
  }
}
/* ---------- properties ---------- */
function field(label, input) { return el('label', { class: 'f' }, label, input); }
/* where a parameter's carried dimension points in the world (to find "the same" dimension on other parts) */
function dimDir(o, prm) { const d = dimsOf(o).find(x => x.param === prm), M = model.result.world.get(o.id); if (!d || !M) return null; const v = M4.dir(M, V.sub(d.b, d.a)); return V.len(v) > 1e-9 ? V.norm(v) : null; }
/* other parts' parameters that equal `oldVal` and run the same way: likely meant to stay equal */
function followerCandidates(ob, prm, oldVal) {
  const d0 = dimDir(ob, prm), out = [];
  for (const o of model.doc.objects) {
    if (o.id === ob.id || ['edge', 'pattern'].includes(o.type) || o.into === ob.id) continue;
    for (const [k, v] of Object.entries(o.params || {})) {
      if (typeof v !== 'number' || Math.abs(v - oldVal) > 1e-9 || (o.expr && o.expr[k])) continue;
      const d1 = dimDir(o, k);
      if ((d0 && d1 && Math.abs(V.dot(d0, d1)) > 0.99) || ((!d0 || !d1) && k === prm)) out.push({ o, k });
    }
  }
  return out;
}
/* set a parameter from typed text: a number, or =formula; after a plain change, offer to make matching parts follow */
function setParam(ob, prm, raw) {
  const txt = String(raw).trim(); if (!txt) return;
  if (txt.startsWith('=')) { try { parseExpr(txt); } catch (e) { toast('Formula: ' + e.message, 3600); return; } apply([{ op: 'set', id: ob.id, params: { [prm]: txt } }], `${ob.name}.${prm} ${txt}`); toast(`${ob.name} · ${prm} now follows ${txt.slice(1)}`, 2200); return; }
  const v = parseFloat(txt.replace(',', '.')); if (!isFinite(v)) { toast('Type a number, or = and a formula (e.g. =plate.depth - 10)', 3200); return; }
  const oldVal = ob.params[prm], wasLinked = ob.expr && ob.expr[prm];
  if (v === oldVal && !wasLinked) return;
  const cands = followerCandidates(ob, prm, oldVal);
  apply([{ op: 'set', id: ob.id, params: { [prm]: v } }], `${ob.name} ${prm} = ${fmt(v)}`);
  if (wasLinked) toast(`${ob.name} · ${prm} unlinked (was ${wasLinked}) — Undo to keep the link`, 3200);
  if (cands.length) {
    const ref = `=${ob.id}.${prm}`, names = cands.map(c => `${c.o.name} ${c.k}`).slice(0, 3).join(', ') + (cands.length > 3 ? '…' : '');
    toastAct(`${names} ${cands.length > 1 ? 'were' : 'was'} also ${fmt(oldVal)}.`, [[cands.length > 1 ? `Make all ${cands.length} follow` : 'Make it follow', () => apply(cands.map(c => ({ op: 'set', id: c.o.id, params: { [c.k]: ref } })), `Follow ${ob.name} ${prm}`)]], 12000);
  }
}
/* number field that also takes =formulas, with a link button */
function paramInput(ob, prm) {
  const linked = ob.expr && ob.expr[prm], wrap = el('span', { class: 'pin' });
  const i = el('input', { value: linked ? linked : fmt(ob.params[prm]), inputmode: 'decimal', class: linked ? 'linked' : '', title: linked ? `follows ${linked.slice(1)} = ${fmt(ob.params[prm])} · type a number to unlink` : 'a number, or =formula e.g. =plate.depth - 10' });
  i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); });
  i.addEventListener('change', () => setParam(ob, prm, i.value));
  const b = el('button', { class: 'chain' + (linked ? ' on' : ''), title: linked ? 'Unlink (keep the value)' : 'Follow another part’s dimension…', onclick: (e) => { e.preventDefault(); if (linked) apply([{ op: 'unlink', id: ob.id, param: prm }]); else leaderMenu(ob, prm, b); } }, icon('link'));
  wrap.append(i, b); if (linked) wrap.append(el('span', { class: 'val' }, '= ' + fmt(ob.params[prm]))); return wrap;
}
function leaderMenu(ob, prm, anchor) {
  const r = anchor.getBoundingClientRect(), m = el('div', { class: 'menu', style: `left:${Math.max(8, r.right - 260)}px;top:${r.bottom + 4}px;max-height:60vh;overflow:auto;width:260px` });
  m.append(el('div', { class: 'mh' }, `${ob.name} · ${prm} follows…`));
  const rows = [];
  for (const o of model.doc.objects) { if (o.id === ob.id || ['edge', 'pattern'].includes(o.type)) continue; for (const [k, v] of Object.entries(o.params || {})) if (typeof v === 'number') rows.push({ o, k, v, score: (Math.abs(v - ob.params[prm]) < 1e-9 ? 0 : 2) + (k === prm ? 0 : 1) }); }
  rows.sort((a, b) => a.score - b.score);
  for (const x of rows.slice(0, 40)) m.append(el('button', { onclick: () => { m.remove(); apply([{ op: 'set', id: ob.id, params: { [prm]: `=${x.o.id}.${x.k}` } }], `${ob.name}.${prm} follows ${x.o.name}.${x.k}`); } }, `${x.o.name} · ${x.k} = ${fmt(x.v)}`));
  for (const [k, v] of Object.entries(model.doc.vars || {})) m.append(el('button', { onclick: () => { m.remove(); apply([{ op: 'set', id: ob.id, params: { [prm]: `=#${k}` } }]); } }, `#${k} = ${typeof v === 'number' ? fmt(v) : v}`));
  document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
}
function numInput(v, on) { const i = el('input', { type: 'number', step: 'any', value: v }); i.addEventListener('change', () => on(+i.value)); i.addEventListener('keydown', e => e.stopPropagation()); return i; }
const OPTIONS = { shape: { extrude: ['rect', 'circle', 'slot', 'polygon', 'points'], nut: ['hex', 'round', 'knurled'] }, style: { edge: ['fillet', 'chamfer'], fillet: ['fillet', 'weld', 'chamfer'], gear: ['spur', 'helical', 'herringbone'] }, mode: { wrap: ['emboss', 'engrave'], drape: ['emboss', 'engrave'], '*': ['auto', 'add', 'subtract'] }, kind: { pattern: ['linear', 'circular', 'mirror'], hole: ['simple', 'counterbore', 'countersink', 'tapped', 'insert'] }, plane: { pattern: ['yz', 'xz', 'xy'] }, profile: { weld: ['flat', 'convex', 'concave'] }, size: { hole: Object.keys(HOLES), bolt: Object.keys(THREADS), nut: [...Object.keys(THREADS), 'custom'] }, fit: { hole: ['close', 'normal', 'loose', 'print'] }, open: { shell: ['none', 'top', 'bottom', 'front', 'back', 'left', 'right', 'start', 'end'] }, path: { text: ['line', 'arc', 'arc-inside', 'points'] }, end: { extrude: ['blind', 'symmetric', 'through'] }, thread: { cylinder: ['none', ...Object.keys(THREADS), 'custom'] }, thread_from: { cylinder: ['bottom', 'top'] }, head: { bolt: ['hex', 'socket'] }, align: { text: ['center', 'start', 'end'] } };   /* shell 'open' lists the part's own faces (shellOpens) */
/* the parameters a threaded part shows: the thread's own settings only when it has one */
const THREAD_KEYS = {
  cylinder: (p) => ['diameter', 'height', 'thread', ...(p.thread && p.thread !== 'none' ? [...(p.thread === 'custom' ? ['pitch'] : []), 'thread_length', 'thread_from', 'left_hand'] : []), 'bore'],
  bolt: () => ['size', 'length', 'head', 'thread_length', 'left_hand'],
  nut: (p) => ['size', ...(p.size === 'custom' ? ['diameter', 'pitch'] : []), 'shape', 'thickness', ...(p.shape === 'round' || p.shape === 'knurled' || p.size === 'custom' ? ['od'] : []), 'left_hand'],
  hole: (p) => ['size', 'kind', ...(p.kind === 'tapped' ? ['modelled', ...(p.modelled ? ['left_hand'] : [])] : ['fit']), 'through', ...(p.through ? [] : ['depth']), 'diameter']
};
const optionsFor = (type, k) => { const o = OPTIONS[k]; return o ? (o[type] || o['*'] || null) : null; };
const label = (k) => k.replace(/_/g, ' ');
function textInput(v, on, attrs) { const i = el('input', Object.assign({ value: v == null ? '' : v }, attrs || {})); i.addEventListener('keydown', e => e.stopPropagation()); i.addEventListener('change', () => on(i.value)); return i; }
function paramField(o, k, v) {
  const set = (val) => apply([{ op: 'set', id: o.id, params: { [k]: val } }]), opts = o.type === 'shell' && k === 'open' ? shellOpens(o.into) : optionsFor(o.type, k);
  if (opts) { const sl = el('select', null, ...opts.map(x => el('option', { value: x, selected: v === x }, x))); sl.onchange = () => set(sl.value); return field(label(k), sl); }
  if (typeof v === 'number') return field(label(k), paramInput(o, k));
  if (typeof v === 'boolean') { const c = el('input', { type: 'checkbox' }); c.checked = v; c.onchange = () => set(c.checked); return field(label(k), c); }
  if (typeof v === 'string') return field(label(k), textInput(v, set));
  const ta = el('textarea', null, JSON.stringify(v)); ta.addEventListener('keydown', e => e.stopPropagation()); ta.addEventListener('change', () => { try { set(JSON.parse(ta.value)); } catch (e) { toast('Not valid JSON: ' + e.message); } });
  return field(label(k), ta);
}
const PATTERN_KEYS = { linear: ['kind', 'count', 'spacing', 'direction', 'count2', 'spacing2', 'direction2'], circular: ['kind', 'count', 'angle', 'about', 'axis', 'center'], mirror: ['kind', 'plane', 'offset', 'about'] };
const r1 = (v) => (v == null ? '—' : fmt(v));
const xyz = (p) => (p ? p.map(v => fmt(v)).join(', ') : '—');
function materialSelect(value, withDefault, on) {
  const sl = el('select', null, el('option', { value: '' }, withDefault));
  const fam = {}; for (const [k, m] of Object.entries(MATERIALS)) (fam[m.family] = fam[m.family] || []).push([k, m]);
  for (const [f, list] of Object.entries(fam)) sl.append(el('optgroup', { label: f }, ...list.map(([k, m]) => el('option', { value: k, selected: value === k }, `${m.name} · ${m.density} g/cm³`))));
  sl.onchange = () => on(sl.value || null); return sl;
}
function massSection(o, sec) {
  const rep = massReport(model.doc, model.result);
  if (o.into && o.type !== 'edge') { const s = sec('Material & mass'); s.append(el('div', { class: 'empty', style: 'padding:4px 0' }, `Part of ${(model.get(o.into) || {}).name}: its material and mass are that part's.`)); return; }
  const s = sec('Material & mass'), meta = o.meta || {}, setMeta = (patch) => apply([{ op: 'set', id: o.id, meta: patch }]);
  const def = model.doc.material ? `model default · ${MATERIALS[model.doc.material].name}` : '— choose —';
  s.append(field('material', materialSelect(meta.material, def, v => setMeta({ material: v }))));
  const mat = MATERIALS[meta.material || model.doc.material];
  s.append(field('density g/cm³', textInput(meta.density, v => setMeta({ density: v === '' ? null : +v }), { type: 'number', step: 'any', placeholder: mat ? mat.density : 'from material' })));
  s.append(field('fill %', textInput(meta.fill ? Math.round(meta.fill * 100) : '', v => setMeta({ fill: v === '' ? null : +v / 100 }), { type: 'number', step: 'any', placeholder: '100 (solid)' })));
  s.append(field('quantity', textInput(meta.quantity, v => setMeta({ quantity: v === '' ? null : +v }), { type: 'number', step: '1', placeholder: '1' })));
  s.append(field('part no.', textInput(meta.part_no, v => setMeta({ part_no: v || null }))), field('supplier', textInput(meta.supplier, v => setMeta({ supplier: v || null }))), field('notes', textInput(meta.notes, v => setMeta({ notes: v || null }))));
  const part = rep.parts.find(x => x.id === o.id);
  if (part) {
    s.append(el('div', { class: 'f' }, 'volume', el('span', null, r1(part.volume_cm3) + ' cm³')), el('div', { class: 'f' }, 'mass', el('b', null, part.mass_g == null ? 'set a material' : fmt(part.mass_g) + ' g' + (part.assumed ? ' (model default)' : ''))), el('div', { class: 'f' }, 'centre of gravity', el('span', { class: 'mono' }, xyz(part.centroid))));
    if (part.inertia_kg_mm2) s.append(el('div', { class: 'f' }, 'inertia kg·mm²', el('span', { class: 'mono' }, part.inertia_kg_mm2.slice(0, 3).map(v => fmt(v)).join(' / '))));
  }
}
/* a loft's sections (height, scale, turn, offset) and guide curves (points x, y, z), all editable */
function loftSection(o, sec) {
  const p = o.params, L = +p.length || 0, secs = (p.sections || []).map(q => Object.assign({}, q)), guides = (p.guides || []).map(g => g.map(q => q.slice()));
  const s = sec('Loft sections & guides'), set = (patch, label) => { try { apply([{ op: 'set', id: o.id, params: patch }], label); } catch (e) { /* toast shown */ } };
  s.append(el('div', { class: 'note' }, 'The profile at 0, the end at the loft length, and any sections between. With smooth on, the sides run through every section in a smooth curve. A guide is a curve from the first section to the last; the sections follow it (one guide moves them, two also turn and scale them, three or more also skew them).'));
  const tbl = el('table', { class: 'cfg sk loft' }); tbl.append(el('tr', null, el('th', null, 'height'), el('th', null, 'scale'), el('th', null, 'turn °'), el('th', null, 'offset x'), el('th', null, 'offset y'), el('th', null, '')));
  tbl.append(el('tr', { class: 'sub' }, el('td', { class: 'mono' }, '0'), el('td', { colspan: 5, class: 'note' }, 'the profile')));
  secs.sort((a, b) => a.z - b.z).forEach((q, k) => {
    const upd = (key, v) => { const nx = secs.map(z => Object.assign({}, z)); if (key === 'offset0' || key === 'offset1') { const off = (nx[k].offset || [0, 0]).slice(); off[key === 'offset0' ? 0 : 1] = v; nx[k].offset = off; } else nx[k][key] = v; set({ sections: nx }, `Loft section ${k + 1}: ${key.replace(/\d$/, '')}`); };
    tbl.append(el('tr', null, el('td', null, numInput(q.z, v => upd('z', v))), el('td', null, numInput(q.scale == null ? 1 : q.scale, v => upd('scale', v))), el('td', null, numInput(q.rot || 0, v => upd('rot', v))),
      el('td', null, numInput((q.offset || [0, 0])[0], v => upd('offset0', v))), el('td', null, numInput((q.offset || [0, 0])[1], v => upd('offset1', v))),
      el('td', null, el('button', { class: 'chain', title: 'Remove this section', onclick: () => set({ sections: secs.filter((_, kk) => kk !== k) }, 'Remove a loft section') }, '×'))));
  });
  if (!secs.some(q => Math.abs(q.z - L) < 1e-9)) tbl.append(el('tr', { class: 'sub' }, el('td', { class: 'mono' }, fmt(L)), el('td', { colspan: 5, class: 'note' }, p.profile2 ? 'the end profile' : 'the end (the profile again)')));
  s.append(el('div', { class: 'tblwrap' }, tbl));
  const between = () => { const zs = [0, ...secs.map(q => +q.z).sort((a, b) => a - b), L].filter((v, i, a) => i === 0 || v > a[i - 1]); let gap = 0, at = L / 2; for (let i = 1; i < zs.length; i++) if (zs[i] - zs[i - 1] > gap) { gap = zs[i] - zs[i - 1]; at = (zs[i] + zs[i - 1]) / 2; } return +at.toFixed(3); };
  const smooth = el('input', { type: 'checkbox' }); smooth.checked = p.smooth !== false; smooth.onchange = () => set({ smooth: smooth.checked }, smooth.checked ? 'Smooth loft' : 'Ruled loft');
  s.append(el('div', { class: 'btns' }, el('button', { class: 'btn', title: 'A section halfway along the longest gap, at 1.2× so you see it — then set its size', onclick: () => set({ sections: secs.concat([{ z: between(), scale: 1.2, rot: 0, offset: [0, 0] }]) }, 'Add a loft section') }, '+ section'), el('label', { class: 'note', style: 'display:flex;gap:6px;align-items:center' }, smooth, 'smooth through the sections')));
  /* guides */
  guides.forEach((g, gi) => {
    const gt = el('table', { class: 'cfg sk' }); gt.append(el('tr', null, el('th', { colspan: 4 }, `Guide ${gi + 1}`), el('th', null, el('button', { class: 'chain', title: 'Remove this guide', onclick: () => set({ guides: guides.filter((_, kk) => kk !== gi) }, 'Remove a guide') }, '×'))));
    g.forEach((pt, k) => {
      const upd = (c, v) => { const nx = guides.map(x => x.map(q => q.slice())); nx[gi][k][c] = v; set({ guides: nx }, `Guide ${gi + 1} point ${k + 1}`); };
      gt.append(el('tr', { class: 'sub' }, el('td', { class: 'note' }, `point ${k + 1}`), el('td', null, el('span', { class: 'pin fit' }, el('span', { class: 'note' }, 'x'), numInput(pt[0], v => upd(0, v)))), el('td', null, el('span', { class: 'pin fit' }, el('span', { class: 'note' }, 'y'), numInput(pt[1], v => upd(1, v)))), el('td', null, el('span', { class: 'pin fit' }, el('span', { class: 'note' }, 'z'), numInput(pt[2], v => upd(2, v)))),
        el('td', null, g.length > 2 && k > 0 && k < g.length - 1 ? el('button', { class: 'chain', title: 'Remove this point', onclick: () => { const nx = guides.map(x => x.map(q => q.slice())); nx[gi].splice(k, 1); set({ guides: nx }, 'Remove a guide point'); } }, '×') : null)));
    });
    s.append(el('div', { class: 'tblwrap' }, gt), el('div', { class: 'btns' }, el('button', { class: 'btn', title: 'Add a point halfway along the longest leg of this guide', onclick: () => { let best = 0, bl = -1; for (let k = 0; k < g.length - 1; k++) { const l = Math.hypot(g[k + 1][0] - g[k][0], g[k + 1][1] - g[k][1], g[k + 1][2] - g[k][2]); if (l > bl) { bl = l; best = k; } } const a = g[best], b = g[best + 1], nx = guides.map(x => x.map(q => q.slice())); nx[gi].splice(best + 1, 0, a.map((v, c) => +((v + b[c]) / 2).toFixed(3))); set({ guides: nx }, 'Add a guide point'); } }, '+ point')));
  });
  s.append(el('div', { class: 'btns' }, el('button', { class: 'btn', title: 'A guide from the first section to the last through the point furthest out in x, bowed out by 20% in the middle — then move its points', onclick: () => {
    const prof = expandArcs(p.profile, p.arcs || [], { splines: p.splines }).pts, used = guides.length, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], dir = dirs[used % 4];
    let best = prof[0], bv = -Infinity; for (const q of prof) { const v = q[0] * dir[0] + q[1] * dir[1]; if (v > bv) { bv = v; best = q; } }
    const endProf = p.profile2 || prof; let e = endProf[0], ev = -Infinity; for (const q of endProf) { const v = q[0] * dir[0] + q[1] * dir[1]; if (v > ev) { ev = v; e = q; } }
    const mid = [(best[0] + e[0]) / 2 * 1.2, (best[1] + e[1]) / 2 * 1.2, L / 2].map(v => +v.toFixed(3));
    set({ guides: guides.concat([[[best[0], best[1], 0], mid, [e[0], e[1], L]]]) }, 'Add a guide');
  } }, '+ guide')));
}
/* the profile's constraints: status, per segment H / V / length, relations between segments, fixed points */
function sketchSection(o, sec) {
  const q = o.params, P = q.profile, n = P.length, cons = q.constraints || [], arcs = q.arcs || [], open = !!q.open, st = model.result.sketch && model.result.sketch.get(o.id);
  const nseg = open ? n - 1 : n, arcOf = (i) => arcs.find(a => a.i === i), splines = q.splines || [], splOf = (i) => splines.find(z => z.i === i);
  const s = sec('Sketch'), add = (c) => { try { apply([Object.assign({ op: 'constrain', id: o.id }, c)]); } catch (e) { /* toast */ } };
  const status = !cons.length ? ['note', 'No constraints: the profile is exactly as drawn.'] : st && !st.ok ? ['warnline', 'Conflict — remove one of the highlighted constraints'] : st && st.dof === 0 ? ['ok', 'Fully defined'] : ['note', `${st ? st.dof : '?'} degree${st && st.dof === 1 ? '' : 's'} of freedom left (it keeps the drawn shape there)`];
  s.append(el('div', { class: status[0] }, status[1]));
  /* turn a line into a gentle arc bulging outward, or an arc back into a line */
  const ccwPoly = K.area2(P) > 0;
  const makeArc = (i) => {
    const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, out = open || ccwPoly ? [dy / L, -dx / L] : [-dy / L, dx / L];
    const m = [(a[0] + b[0]) / 2 + out[0] * L * 0.134, (a[1] + b[1]) / 2 + out[1] * L * 0.134], g = arcThrough(a, b, m); if (!g) return;
    apply([{ op: 'set', id: o.id, params: { arcs: arcs.concat([{ i, c: g.c, ccw: g.ccw }]), constraints: cons.filter(c => !((c.type === 'h' || c.type === 'v') && c.i === i)) } }], `Segment ${i + 1} → arc`);
  };
  const makeSpline = (i) => {
    const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, out = open || ccwPoly ? [dy / L, -dx / L] : [-dy / L, dx / L];
    const r3 = (v) => Math.round(v * 1000) / 1000, mid = [r3((a[0] + b[0]) / 2 + out[0] * L * 0.15), r3((a[1] + b[1]) / 2 + out[1] * L * 0.15)];
    /* constraints that treat the segment as a straight line go (its end points keep theirs) */
    const keep = cons.filter(c => SKETCH_KINDS[c.type].point || (c.i !== i && c.j !== i));
    apply([{ op: 'set', id: o.id, params: { splines: splines.filter(z => z.i !== i).concat([{ i, pts: [mid] }]), constraints: keep } }], `Segment ${i + 1} → spline`);
  };
  const makeLine = (i) => apply([{ op: 'set', id: o.id, params: { arcs: arcs.filter(a => a.i !== i), constraints: cons.filter(c => !(['radius', 'concentric', 'tangent'].includes(c.type) && (c.i === i || c.j === i)) && !(c.type === 'equal' && arcOf(c.i) && (c.i === i || c.j === i))) } }], `Segment ${i + 1} → line`);
  const tbl = el('table', { class: 'cfg sk' });
  tbl.append(el('tr', null, el('th', null, '#'), el('th', null, 'size'), el('th', null, ''), el('th', null, 'dimension')));
  for (let i = 0; i < nseg; i++) {
    const a = P[i], b = P[(i + 1) % n], arc = arcOf(i), spl = splOf(i), bad = st && st.conflicts && st.conflicts.some(c => c.i === i);
    if (spl) {
      const setPts = (pts, label) => apply([{ op: 'set', id: o.id, params: { splines: splines.map(z => z.i === i ? { i, pts } : z) } }], label);
      tbl.append(el('tr', null, el('td', null, String(i + 1)), el('td', { class: 'mono', title: `a spline through ${spl.pts.length} fit point${spl.pts.length > 1 ? 's' : ''} (below)` }, 'spline'), el('td', null, el('span', { class: 'pin' }, el('button', { class: 'chain on', title: 'This segment is a spline — make it straight', onclick: () => apply([{ op: 'set', id: o.id, params: { splines: splines.filter(z => z.i !== i) } }], `Segment ${i + 1} → line`) }, '∿'))),
        el('td', null, el('button', { class: 'btn', title: 'Add a fit point halfway between the last one and the end of the segment', onclick: () => { const last = spl.pts[spl.pts.length - 1], e = b; setPts(spl.pts.concat([[Math.round((last[0] + e[0]) * 500) / 1000, Math.round((last[1] + e[1]) * 500) / 1000]]), `Spline ${i + 1}: add a point`); } }, '+ point'))));
      spl.pts.forEach((pt, k) => {
        const upd = (c, v) => { const pts = spl.pts.map(q2 => q2.slice()); pts[k][c] = v; setPts(pts, `Spline ${i + 1} point ${k + 1}`); };
        tbl.append(el('tr', { class: 'sub' }, el('td', null, ''), el('td', { colspan: 3 }, el('span', { class: 'pin fit' }, el('span', { class: 'note' }, `point ${k + 1}`), el('span', { class: 'note' }, 'x'), numInput(pt[0], v => upd(0, v)), el('span', { class: 'note' }, 'y'), numInput(pt[1], v => upd(1, v)),
          spl.pts.length > 1 ? el('button', { class: 'chain', title: 'Remove this fit point', onclick: () => setPts(spl.pts.filter((_, kk) => kk !== k), `Spline ${i + 1}: remove a point`) }, '×') : null))));
      });
      continue;
    }
    if (arc) {
      const r = Math.hypot(a[0] - arc.c[0], a[1] - arc.c[1]), ri = cons.findIndex(c => c.type === 'radius' && c.i === i);
      const dimCell = ri >= 0 ? el('span', { class: 'pin' }, el('span', { class: 'note' }, 'R'), paramInput(o, cons[ri].p), el('button', { class: 'chain', title: 'Remove the radius', onclick: () => apply([{ op: 'unconstrain', id: o.id, index: ri }]) }, '×')) : el('button', { class: 'btn', onclick: () => add({ type: 'radius', i }) }, '+ radius');
      tbl.append(el('tr', { class: bad ? 'bad' : '' }, el('td', null, String(i + 1)), el('td', { class: 'mono' }, 'R' + fmt(r)), el('td', null, el('span', { class: 'pin' }, el('button', { class: 'chain on', title: 'This segment is an arc — make it straight', onclick: () => makeLine(i) }, '⌒'))), el('td', null, dimCell)));
      continue;
    }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), has = (t) => cons.findIndex(c => c.type === t && c.i === i), hi = has('h'), vi = has('v'), li = cons.findIndex(c => c.type === 'length' && c.i === i);
    const tog = (t, idx) => el('button', { class: 'chain' + (idx >= 0 ? ' on' : ''), title: SKETCH_KINDS[t].label, onclick: () => (idx >= 0 ? apply([{ op: 'unconstrain', id: o.id, index: idx }]) : add({ type: t, i })) }, t.toUpperCase());
    const dimCell = li >= 0 ? el('span', { class: 'pin' }, paramInput(o, cons[li].p), el('button', { class: 'chain', title: 'Remove the dimension', onclick: () => apply([{ op: 'unconstrain', id: o.id, index: li }]) }, '×')) : el('button', { class: 'btn', onclick: () => add({ type: 'length', i }) }, '+ dimension');
    tbl.append(el('tr', { class: bad ? 'bad' : '' }, el('td', null, String(i + 1)), el('td', { class: 'mono' }, fmt(L)), el('td', null, el('span', { class: 'pin' }, tog('h', hi), tog('v', vi), el('button', { class: 'chain', title: 'Make this segment an arc (then give it a radius)', onclick: () => makeArc(i) }, '⌒'), el('button', { class: 'chain', title: 'Make this segment a spline (a smooth curve through points you can move)', onclick: () => makeSpline(i) }, '∿'))), el('td', null, dimCell)));
  }
  s.append(el('div', { class: 'tblwrap' }, tbl));
  /* relations between two segments */
  const segSel = () => el('select', null, ...Array.from({ length: nseg }, (_, i) => el('option', { value: i, disabled: splOf(i) ? true : null }, (arcOf(i) ? 'arc ' : splOf(i) ? 'spline ' : 'segment ') + (i + 1))));
  const sa = segSel(), sb = segSel(); sb.value = String(Math.min(1, nseg - 1));
  s.append(el('div', { class: 'relrow' }, sa, ...[['parallel', '∥'], ['perpendicular', '⊥'], ['equal', '='], ['angle', '∠'], ['tangent', 'tan'], ['concentric', '◎']].map(([t, g]) => el('button', { class: 'chain', title: SKETCH_KINDS[t].label + (t === 'equal' ? ' (lengths, or radii of two arcs)' : t === 'tangent' ? ' (two segments that meet; one or both arcs)' : t === 'concentric' ? ' (two arcs)' : ''), onclick: () => { if (sa.value === sb.value) { toast('Pick two different segments'); return; } add({ type: t, i: +sa.value, j: +sb.value }); } }, g)), sb));
  /* the constraint list */
  const items = cons.map((c, k) => [c, k]).filter(([c]) => !['h', 'v', 'length', 'radius'].includes(c.type));
  for (const [c, k] of items) {
    const lab = `${SKETCH_KINDS[c.type].label} ${c.type === 'fix' || c.type === 'fixx' || c.type === 'fixy' ? 'point ' + (c.i + 1) : (c.i + 1) + (c.j != null ? ' & ' + (c.j + 1) : '')}`;
    s.append(el('div', { class: 'f' + (st && st.conflicts && st.conflicts.includes(c) ? ' bad' : '') }, lab, el('span', { class: 'pin' }, c.p ? paramInput(o, c.p) : el('span', { class: 'note' }, c.type === 'fix' ? `at ${fmt(c.at[0])}, ${fmt(c.at[1])}` : ''), el('button', { class: 'chain', title: 'Remove', onclick: () => apply([{ op: 'unconstrain', id: o.id, index: k }]) }, '×'))));
  }
  const pt = el('select', null, ...Array.from({ length: n }, (_, i) => el('option', { value: i }, 'point ' + (i + 1))));
  s.append(el('div', { class: 'relrow' }, pt, el('button', { class: 'btn', onclick: () => add({ type: 'fix', i: +pt.value }) }, 'Fix'), el('button', { class: 'btn', onclick: () => add({ type: 'fixx', i: +pt.value }) }, 'x from origin'), el('button', { class: 'btn', onclick: () => add({ type: 'fixy', i: +pt.value }) }, 'y from origin')));
  s.append(el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => apply([{ op: 'set', id: o.id, params: { constraints: autoConstraints(P, 4, arcs, open).concat(cons.filter(c => ['tangent', 'concentric', 'radius'].includes(c.type))) } }], 'Auto-constrain') }, 'Auto H / V'), cons.length ? el('button', { class: 'btn', onclick: () => apply([{ op: 'set', id: o.id, params: { constraints: [] } }], 'Clear constraints') }, 'Clear') : null));
}
function infoSection(o, sec) {
  const T = TYPES[o.type]; if (!T || !T.def || !T.def.info) return;
  let info; try { info = T.def.info(o.params, { K, V, M4 }); } catch (e) { info = { warning: e.message }; }
  const s = sec(T.label + ' data');
  for (const [k, v] of Object.entries(info || {})) s.append(k === 'warning' ? el('div', { class: 'warnline' }, '⚠ ' + v) : el('div', { class: 'f' }, label(k), el('span', { class: 'mono' }, typeof v === 'number' ? fmt(v) : String(v))));
}
/* the obvious way to put features on a part: select it, then pick what to add */
function addToPartSection(o, sec) {
  if (META.has(o.type) || (model.result.virtual && model.result.virtual.has(o.id))) return;
  const body = model.bodyContaining(o.id); if (!body) return;
  const root = model.get(body.id); if (!root) return;
  const s = sec('Add to ' + root.name), b = (label, ic, tip, fn) => el('button', { class: 'abtn', title: tip, onclick: fn }, icon(ic), el('span', null, label));
  s.append(el('div', { class: 'agrid' },
    b('Boss', 'boss', 'Join a cylinder or box onto a face: set its size, click the face', () => setTool('boss', root.id)),
    b('Cut', 'cut', 'Cut a round or square pocket into a face', () => setTool('cut', root.id)),
    b('Hole', 'hole', 'ISO hole: clearance, counterbore, countersink, tapped, heat-set insert', () => setTool('hole', root.id)),
    b('Text', 'text', 'Emboss or engrave words on a face', () => setTool('text', root.id)),
    b('Sketch on face', 'face', 'Draw any outline on a face (lines, arcs, shapes), then join it or cut it', () => setTool('sketch-face', { only: root.id })),
    b('Fillet', 'fillet', 'Round an edge: click near it', () => setTool('edge-fillet')),
    b('Chamfer', 'chamfer', 'Bevel an edge: click near it', () => setTool('edge-chamfer')),
    b('Shell', 'shell', 'Hollow it to an even wall thickness', () => shellHint(root)),
    b('Pattern', 'pattern', 'Rows, grids, circles or mirror copies of this', () => patternHint(o.id)),
    b('Plane', 'section', 'A reference plane on one of its faces (gap, tilt): sketch on it, split with it', () => setTool('plane')),
    b('Split', 'split', 'Cut it with a plane: keep one side, or both as two parts', () => ((model.result.planes || []).length ? splitHint(root.id) : setTool('plane')))));
  s.append(el('div', { class: 'note' }, 'Each asks you to click the face (or edge) it goes on; a new shape from the Add bar lands on the selected part too.'));
}
function renderProps() {
  const body = $('#pbody'); body.innerHTML = '';
  if (addonForm) { renderAddonForm(body); return; }
  const o = selected && model.get(selected);
  const R = model.result, sec = (t) => { const s = el('div', { class: 'sec' }, el('h4', null, t)); body.append(s); return s; };
  if (!o) {
    const s = sec('Model');
    s.append(field('Name', textInput(model.doc.name, v => apply([{ op: 'rename', name: v }]))));
    s.append(el('div', { class: 'f' }, 'Bodies', el('span', null, `${R.bodies.filter(b => !b.weld).length} parts${R.bodies.some(b => b.weld) ? ' · ' + R.bodies.filter(b => b.weld).length + ' welds' : ''} · ${model.doc.objects.length} features · ${R.ms.toFixed(0)} ms`)));
    const og = R.originRef; s.append(el('div', { class: 'f' }, 'World origin', el('span', null, og ? (model.get(og.obj) || {}).name + ' · ' + og.conn : 'board 0,0,0')));
    const partsAll = model.doc.objects.filter(o => !['edge', 'pattern', 'weld'].includes(o.type) && !o.into), own = partsAll.filter(o => o.meta && (o.meta.material || o.meta.density));   /* welds take their part's material */
    s.append(field('material for parts without one', materialSelect(model.doc.material, '— none —', v => apply([{ op: 'material', material: v }]))));
    s.append(el('div', { class: 'note' }, own.length === partsAll.length ? `All ${partsAll.length} parts have their own material, so this default changes nothing.` : `${partsAll.length - own.length} of ${partsAll.length} parts use this default; ${own.length} have their own.`));
    if (model.doc.material && own.length) s.append(el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => apply(own.map(o => ({ op: 'set', id: o.id, meta: { material: model.doc.material, density: null } })), `All parts ${MATERIALS[model.doc.material].name}`) }, `Use ${MATERIALS[model.doc.material].name} for all ${partsAll.length} parts`)));
    /* configurations: named tables of variable values (S / M / L…) */
    const cfgs = model.doc.configs || [], varNames = Object.keys(model.doc.vars || {});
    const sc = sec('Configurations');
    if (!cfgs.length) sc.append(el('div', { class: 'note' }, varNames.length ? 'Save the current variable values as a size (S / M / L…), then switch between sizes from the toolbar.' : 'Add a variable first (below), use it in sizes (=#len), then make configurations with different values.'));
    else {
      const tbl = el('table', { class: 'cfg' }), hdr = el('tr', null, el('th', null, ''), el('th', null, 'name'), ...varNames.map(v => el('th', null, '#' + v)), el('th', null, ''));
      tbl.append(hdr);
      const rowOf = (c) => {
        const active = c ? model.doc.config === c.name : !model.doc.config;
        const radio = el('input', { type: 'radio', name: 'cfg', checked: active ? true : null }); radio.onchange = () => apply([{ op: 'config', name: c ? c.name : null }]);
        const cells = varNames.map(v => { const val = c ? (c.vars || {})[v] : model.doc.vars[v]; const inp = textInput(val == null ? '' : val, nv => apply([c ? { op: 'config', action: 'set', name: c.name, vars: { [v]: nv === '' ? null : (isFinite(+nv) ? +nv : nv) } } : { op: 'var', name: v, value: nv }]), { placeholder: c ? String(model.doc.vars[v]) : '' }); return el('td', null, inp); });
        return el('tr', { class: active ? 'on' : '' }, el('td', null, radio), el('td', null, c ? c.name : 'Default'), ...cells, el('td', null, c ? el('button', { class: 'chain', title: 'Delete configuration', onclick: () => apply([{ op: 'config', action: 'delete', name: c.name }]) }, '×') : ''));
      };
      tbl.append(rowOf(null)); for (const c of cfgs) tbl.append(rowOf(c));
      sc.append(el('div', { class: 'tblwrap' }, tbl));
    }
    if (varNames.length) { const cn = textInput('', () => {}, { placeholder: 'new size, e.g. Large' }); sc.append(el('div', { class: 'varadd', style: 'grid-template-columns:1fr auto' }, cn, el('button', { class: 'btn', onclick: () => { if (cn.value) apply([{ op: 'config', action: 'add', name: cn.value, vars: Object.assign({}, model.doc.vars) }]); } }, 'Add configuration'))); }
    /* model variables, usable as #name in any dimension */
    const sv = sec('Variables'), vars = model.doc.vars || {};
    for (const [k, v] of Object.entries(vars)) sv.append(field('#' + k, el('span', { class: 'pin' }, textInput(typeof v === 'number' ? fmt(v) : v, val => apply([{ op: 'var', name: k, value: val === '' ? null : val }])), el('button', { class: 'chain', title: 'Remove', onclick: () => apply([{ op: 'var', name: k, value: null }]) }, '×'))));
    const vn = textInput('', () => {}, { placeholder: 'name e.g. wall' }), vv = textInput('', () => {}, { placeholder: 'value or =formula' });
    sv.append(el('div', { class: 'varadd' }, vn, vv, el('button', { class: 'btn', onclick: () => { if (vn.value && vv.value) apply([{ op: 'var', name: vn.value, value: vv.value }]); } }, 'Add')));
    sv.append(el('div', { class: 'note' }, 'Use them in any size: type =#wall * 2. Or make one part follow another: =plate.depth, or the link button beside a size.'));
    const rep = massReport(model.doc, R), sm = sec('Mass & balance');
    sm.append(el('div', { class: 'f' }, 'total mass', el('b', null, rep.total_mass_g ? (rep.total_mass_g >= 1000 ? fmt(rep.total_mass_g / 1000) + ' kg' : fmt(rep.total_mass_g) + ' g') : '—')));
    sm.append(el('div', { class: 'f' }, 'centre of gravity', el('span', { class: 'mono' }, xyz(rep.cog))));
    if (rep.balance) sm.append(el('div', { class: 'f' }, 'stands?', el('span', { class: rep.balance.stands ? 'ok' : 'warnline' }, rep.balance.stands ? `yes · ${fmt(rep.balance.margin_mm)} mm inside the base` : `no · tips toward ${rep.balance.tips_toward}`)));
    if (rep.inertia_kg_mm2) sm.append(el('div', { class: 'f' }, 'inertia kg·mm²', el('span', { class: 'mono' }, rep.inertia_kg_mm2.slice(0, 3).map(v => fmt(v)).join(' / '))));
    if (rep.unassigned.length) sm.append(el('div', { class: 'warnline' }, `No material: ${rep.unassigned.slice(0, 4).join(', ')}${rep.unassigned.length > 4 ? '…' : ''}`));
    sm.append(el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => download(new Blob([bomCSV()], { type: 'text/csv' }), slug() + '-parts.csv') }, 'Parts list (CSV)'), el('button', { class: 'btn' + (views.showCoG ? ' pri' : ''), onclick: () => { views.showCoG = !views.showCoG; renderProps(); syncBar(); views.draw(); } }, views.showCoG ? 'Hide CoG' : 'Show CoG')));
    const sa = sec('Add-ons');
    for (const a of listAddons()) sa.append(el('div', { class: 'f' }, a.name, el('span', { class: 'btns' }, ...Object.entries(a.actions).map(([k]) => el('button', { class: 'btn', onclick: () => openAddonForm(a.id, k) }, k)))));
    if (!ADDONS.size) sa.append(el('div', { class: 'empty' }, 'No add-ons loaded.'));
    return;
  }
  addToPartSection(o, sec);
  const s1 = sec(TYPES[o.type] ? TYPES[o.type].label : o.type);
  s1.append(field('Name', textInput(o.name, v => apply([{ op: 'set', id: o.id, name: v }]))));
  const keys = o.type === 'pattern' ? PATTERN_KEYS[o.params.kind] || Object.keys(o.params)
    : o.type === 'extrude' ? (o.params.shape && o.params.shape !== 'points' ? ['shape', ...SKETCH_SHAPES[o.params.shape], 'length', 'end', 'draft', 'thin', 'twist', 'scale'] : ['length', 'end', 'draft', 'thin', 'open', 'twist', 'scale', 'direction'])
      : ['revolve', 'loft'].includes(o.type) ? Object.keys(o.params).filter(k => !['profile', 'constraints', 'arcs', 'splines', 'profile2', 'sections', 'guides'].includes(k) && !/^d\d+$/.test(k))
      : o.type === 'drape' ? (o.params.text ? ['text', 'size', 'weight', 'depth', 'mode', 'cell'] : ['depth', 'mode', 'cell'])
      : THREAD_KEYS[o.type] ? THREAD_KEYS[o.type](o.params)
        : o.type === 'sweep' && o.params.helix ? [] : o.type === 'wrap' ? (o.params.text ? ['text', 'size', 'weight', 'depth', 'radius', 'mode'] : ['depth', 'radius', 'mode']) : Object.keys(o.params);
  for (const k of keys) { if (k === 'segments' || k === 'detail' && o.type !== 'gear') continue; s1.append(paramField(o, k, o.params[k])); }
  if (o.type === 'sweep' && o.params.helix) {
    /* a helix sweep (spring): its coil sizes */
    const hx = o.params.helix, setH = (k, v) => apply([{ op: 'set', id: o.id, params: { helix: Object.assign({}, hx, { [k]: v }) } }]);
    for (const [k, lab] of [['radius', 'coil radius'], ['pitch', 'pitch'], ['turns', 'turns']]) s1.append(field(lab, numInput(hx[k], v => setH(k, v))));
    const lh = el('input', { type: 'checkbox' }); lh.checked = !!hx.left; lh.onchange = () => setH('left', lh.checked); s1.append(field('left-handed', lh));
  }
  if (o.type === 'plane') {
    const pc = worldConnectors(model.result, o.id).find(c => c.name === 'plane');
    s1.append(el('div', { class: 'btns' }, el('button', { class: 'btn pri', title: 'Draw a profile on this plane (the view turns square to it)', onclick: () => pc && startFaceSketch({ id: o.id, point: pc.o, normal: pc.n }) }, 'Sketch on it'), el('button', { class: 'btn', title: 'Cut a part with this plane', onclick: () => setTool('pick', { prompt: `Split: click the part to cut with ${o.name}`, then: (pid) => splitHint(rootOf(pid), o.id) }) }, 'Split a part…')));
    if (o.mate) s1.append(el('div', { class: 'note' }, 'Gap moves it along the face’s normal; tilt (in Placement) turns it about the face.'));
  }
  if (o.type === 'edge' && o._resolved) s1.append(el('div', { class: 'f' }, 'edge', el('span', null, (o._resolved.convex ? 'outer (convex) → removes' : 'inner (concave) → adds') + ' · ' + o._resolved.angle + '°' + (o._resolved.round ? ' · all round' : ''))));
  if (o.type === 'pattern') {
    const copies = [...(R.virtual || new Map()).values()].filter(v => v.pattern === o.id);
    s1.append(el('div', { class: 'f' }, 'repeats', el('span', null, (o.of || []).map(i => (model.get(i) || {}).name || i).join(', '))), el('div', { class: 'f' }, 'copies', el('span', null, String(new Set(copies.map(c => c.index)).size))));
    s1.append(el('div', { class: 'empty', style: 'padding:4px 0' }, 'Copies follow the original: change its size and every copy changes. about = {"obj": id, "conn": connector} sets the axis (circular) or plane (mirror).'));
  }
  if (o.type === 'weld') {
    const r = o._resolved || {};
    s1.append(el('div', { class: 'f' }, 'joins', el('span', null, ...(o.joins || []).map((id, i) => [i ? ' + ' : '', el('a', { href: '#', onclick: (e) => { e.preventDefault(); select(id); } }, (model.get(id) || {}).name || id)]).flat())));
    s1.append(el('div', { class: 'f' }, 'seam', el('span', null, r.seams ? `${fmt(r.length)} mm${r.round ? ' (round)' : ''}${r.seams > 1 ? ' · ' + r.seams + ' seams' : ''}` : '—')));
    s1.append(el('div', { class: 'empty', style: 'padding:4px 0' }, 'A weld joins parts that are made separately: they stay separate parts (an assembly). To blend one part into another, use a fillet: that merges them.'));
  }
  infoSection(o, sec);
  if (o.type === 'loft') loftSection(o, sec);
  if ((['extrude', 'revolve', 'loft'].includes(o.type) || ((o.type === 'wrap' || o.type === 'drape') && !o.params.text)) && Array.isArray(o.params.profile) && (!o.params.shape || o.params.shape === 'points')) { if (!Array.isArray(o.params.constraints)) o.params.constraints = []; sketchSection(o, sec); }
  if (o.type === 'text' && o.into && o.mate) {
    const eng = o.op === 'subtract', m = o.mate;
    s1.append(el('div', { class: 'note' }, eng ? 'Engraved: a boolean remove, cut in flush with the face' : 'Embossed: a boolean add, standing on the face'),
      el('button', { class: 'btn', style: 'width:100%;margin-top:4px', title: 'Switch between a boolean add (standing on the face) and a boolean remove (cut into it)', onclick: () => apply([{ op: 'boolean', target: o.into, tool: o.id, mode: eng ? 'union' : 'subtract' }, { op: 'mate', id: o.id, to: m.to, a: m.a, b: eng ? 'bottom' : 'top', flip: eng, slide: m.slide, angle: m.angle, offset: 0 }], eng ? 'Emboss text' : 'Engrave text') }, eng ? 'Emboss instead' : 'Engrave instead'));
  }
  if (o.type === 'hole') { try { s1.append(el('div', { class: 'note' }, holeSpec(o.params).label + (o.params.through ? ', through (follows the part’s thickness)' : ''))); } catch (e) { s1.append(el('div', { class: 'warnline' }, e.message)); } }
  /* a separate part sitting on another: one click joins it, cuts it, or intersects it */
  if (!o.into && o.mate && o.mate.to && o.mate.to !== 'origin' && !META.has(o.type) && model.result.bodies.some(b => b.id === o.id)) {
    const tb = model.bodyContaining(o.mate.to);
    if (tb && tb.id !== o.id) {
      const tg = model.get(tb.id), s5 = sec('Combine with ' + tg.name), bo = (mode, label) => el('button', { class: 'btn', onclick: () => { apply([{ op: 'boolean', target: tg.id, tool: o.id, mode }], `${label} ${o.name}`); select(o.id); } }, label);
      s5.append(el('div', { class: 'btns' }, bo('union', 'Join to it'), bo('subtract', 'Cut from it'), bo('intersect', 'Keep the overlap')), el('div', { class: 'note' }, `Join merges ${o.name} into ${tg.name} (one part); Cut removes its shape from ${tg.name}. It stays editable, and Separate undoes it.`));
    }
  }
  /* placement */
  if (!['edge', 'pattern', 'weld'].includes(o.type)) {
    const s2 = sec('Placement');
    if (o.mate && o.mate.kind) {
      const m = o.mate, mate = (patch) => apply([Object.assign({}, m, { op: 'mate', id: o.id }, patch)]);
      s2.append(el('div', { class: 'f' }, 'mate', el('span', null, `${m.kind} mesh with ${(model.get(m.to) || {}).name}`)), field('around °', numInput(m.around || 0, v => mate({ around: v }))), field('axial mm', numInput(m.axial || 0, v => mate({ axial: v }))), field('phase °', numInput(m.phase || 0, v => mate({ phase: v }))));
      s2.append(el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => apply([{ op: 'unmate', id: o.id }]) }, 'Unmate (keep where it is)')));
    } else if (o.mate) {
      const m = o.mate, targets = [['origin', 'World origin']].concat(model.doc.objects.filter(x => x.id !== o.id && !['edge', 'pattern', 'weld'].includes(x.type)).map(x => [x.id, x.name]));
      const to = el('select', null, ...targets.map(([id, n]) => el('option', { value: id, selected: m.to === id }, n))); to.onchange = () => apply([{ op: 'mate', id: o.id, to: to.value, a: m.a, b: m.b }]);
      /* the mate's values as they are stored: a formula stays a formula when another field changes */
      const mf = o.mexpr || {}, msl = m.slide || [0, 0], cur = { flip: m.flip, offset: mf.offset || m.offset, angle: mf.angle || m.angle, tilt: mf.tilt || m.tilt, slide: [mf['slide.0'] || msl[0], mf['slide.1'] || msl[1]] };
      const tc = el('select', null, ...worldConnectors(R, m.to).map(c => el('option', { value: c.name, selected: m.a === c.name }, c.name))); tc.onchange = () => apply([Object.assign({ op: 'mate', id: o.id, to: m.to, a: tc.value, b: m.b }, cur)]);
      const sc = el('select', null, ...worldConnectors(R, o.id).map(c => el('option', { value: c.name, selected: m.b === c.name }, c.name))); sc.onchange = () => apply([Object.assign({ op: 'mate', id: o.id, to: m.to, a: m.a, b: sc.value }, cur)]);
      const mate = (patch) => apply([Object.assign({ op: 'mate', id: o.id, to: m.to, a: m.a, b: m.b }, cur, patch)]);
      /* a mate value: a number, or =formula (e.g. =plate.width / 2 - 10, =#gap) that follows sizes */
      const mateIn = (key, v, put) => {
        const linked = mf[key], wrap = el('span', { class: 'pin' });
        const i = el('input', { value: linked || fmt(v || 0), inputmode: 'decimal', class: linked ? 'linked' : '', title: linked ? `follows ${linked.slice(1)} = ${fmt(v || 0)} · type a number to unlink` : 'a number, or =formula e.g. =plate.width / 2 - 10' });
        i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); });
        i.addEventListener('change', () => { const t = i.value.trim(); if (t.startsWith('=')) put(t); else if (t !== '' && isFinite(+t)) put(+t); else i.value = linked || fmt(v || 0); });
        wrap.append(i); if (linked) wrap.append(el('button', { class: 'chain on', title: 'Unlink (keep the value)', onclick: (e) => { e.preventDefault(); apply([{ op: 'unlink', id: o.id, param: 'mate.' + key }]); } }, icon('link')), el('span', { class: 'val' }, '= ' + fmt(v || 0)));
        return wrap;
      };
      const fl = el('input', { type: 'checkbox' }); fl.checked = !!m.flip; fl.onchange = () => mate({ flip: fl.checked });
      s2.append(field('mated to', to), field('their', tc), field('its', sc), field('gap', mateIn('offset', m.offset, v => mate({ offset: v }))), field('angle °', mateIn('angle', m.angle, v => mate({ angle: v }))), field('tilt °', mateIn('tilt', m.tilt, v => mate({ tilt: v }))),
        field('slide x', mateIn('slide.0', msl[0], v => mate({ slide: [v, cur.slide[1]] }))), field('slide y', mateIn('slide.1', msl[1], v => mate({ slide: [cur.slide[0], v] }))), field('face to face', fl));
      s2.append(el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => apply([{ op: 'unmate', id: o.id }]) }, 'Unmate (keep where it is)')));
      /* joint: how this mate may move */
      const sj = sec('Joint (motion)'), jt = el('select', null, ...[['fixed', 'Fixed (no motion)'], ['revolute', 'Revolute — spins about the mate axis'], ['slider', 'Slider — travels along an axis'], ['cylindrical', 'Cylindrical — spins and travels'], ['planar', 'Planar — slides on the face'], ['screw', 'Screw — turns along a thread (pitch per turn)']].map(([v, n]) => el('option', { value: v, selected: (m.joint || 'fixed') === v }, n)));
      jt.onchange = () => { try { apply([{ op: 'joint', id: o.id, joint: jt.value }]); } catch (e) { jt.value = m.joint || 'fixed'; } };
      sj.append(field('type', jt));
      if (m.joint === 'screw') sj.append(field('pitch mm', el('span', { class: 'pin' }, numInput(m.pitch, v => { if (v) apply([{ op: 'joint', id: o.id, joint: 'screw', pitch: v }]); }), el('span', { class: 'note' }, (m.pitch < 0 ? 'left-hand' : 'right-hand') + ' · per turn'))));
      if (m.joint === 'slider') { const ax = el('select', null, ...[['n', 'along the mate normal'], ['u', 'across the face (u)'], ['v', 'across the face (v)']].map(([v, n]) => el('option', { value: v, selected: (m.axis || 'n') === v }, n))); ax.onchange = () => apply([{ op: 'joint', id: o.id, joint: 'slider', axis: ax.value }]); sj.append(field('axis', ax)); }
      const jinfo = jointsOf(model.doc).find(q => q.id === o.id);
      if (jinfo) for (const dof of jinfo.dofs) {
        const lim = (m.limits || {})[dof.key], rng = el('input', { type: 'range', min: dof.min, max: dof.max, step: dof.unit === '°' ? 1 : 0.5, value: dof.value });
        rng.addEventListener('input', () => previewPose({ [o.id]: { [dof.key]: +rng.value } }));
        rng.addEventListener('change', () => { clearPreview(); apply([{ op: 'drive', id: o.id, key: dof.key, value: +rng.value }], `${o.name} ${dof.key} ${rng.value}${dof.unit}`); });
        sj.append(field(`${dof.key} ${dof.unit}`, el('span', { class: 'pin' }, rng, el('span', { class: 'mono' }, fmt(dof.value)))));
        const lo = textInput(lim ? lim[0] : '', () => {}, { type: 'number', step: 'any', placeholder: String(dof.min) }), hi = textInput(lim ? lim[1] : '', () => {}, { type: 'number', step: 'any', placeholder: String(dof.max) });
        const setLim = () => { const L = Object.assign({}, m.limits || {}); if (lo.value === '' && hi.value === '') delete L[dof.key]; else L[dof.key] = [lo.value === '' ? dof.min : +lo.value, hi.value === '' ? dof.max : +hi.value]; apply([{ op: 'joint', id: o.id, joint: m.joint, limits: Object.keys(L).length ? L : null }]); };
        lo.addEventListener('change', setLim); hi.addEventListener('change', setLim);
        sj.append(field('limits', el('span', { class: 'varadd' }, lo, hi, el('span', { class: 'note' }, dof.unit))));
      }
      if (m.joint) sj.append(el('div', { class: 'btns' }, el('button', { class: 'btn pri', onclick: () => openMotion(o.id) }, 'Animate…')));
    } else {
      const p = o.pose || { at: [0, 0, 0], rot: [0, 0, 0] }, setPose = (at, rot) => apply([{ op: 'set', id: o.id, at, rot }]);
      ['x', 'y', 'z'].forEach((ax, k) => s2.append(field(ax, numInput(+(p.at[k] - R.originPoint[k]).toFixed(3), v => { const at = p.at.slice(); at[k] = v + R.originPoint[k]; setPose(at, p.rot); }))));
      ['rx', 'ry', 'rz'].forEach((ax, k) => s2.append(field(ax + ' °', numInput(p.rot[k], v => { const rot = p.rot.slice(); rot[k] = v; setPose(p.at, rot); }))));
      s2.append(el('div', { class: 'btns' }, el('button', { class: 'btn pri', onclick: () => setTool('mate', o.id) }, 'Mate…'), o.id !== R.ground ? el('button', { class: 'btn', onclick: () => apply([{ op: 'ground', id: o.id }]) }, 'Make ground') : null, !o.fixed && o.id !== R.ground ? el('button', { class: 'btn', onclick: () => apply([{ op: 'fix', id: o.id }]) }, 'Fix in place') : null));
    }
    const og = el('select', null, el('option', { value: '' }, '— set as world origin —'), ...worldConnectors(R, o.id).map(c => el('option', { value: c.name }, c.name)));
    og.onchange = () => { if (og.value) apply([{ op: 'origin', obj: o.id, conn: og.value }]); };
    s2.append(field('origin', og));
  }
  /* boolean role */
  if (o.into && o.type !== 'edge') {
    const s3 = sec('Boolean'), mode = el('select', null, ...[['subtract', 'Subtract from'], ['add', 'Union with'], ['intersect', 'Intersect with']].map(([v, n]) => el('option', { value: v, selected: o.op === v }, n)));
    mode.onchange = () => apply([{ op: 'boolean', target: o.into, tool: o.id, mode: mode.value }]);
    s3.append(field('this tool', mode), el('div', { class: 'f' }, 'target', el('span', null, (model.get(o.into) || {}).name || '—')), el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => apply([{ op: 'separate', id: o.id }]) }, 'Separate')));
  }
  if (!['edge', 'pattern'].includes(o.type)) massSection(o, sec);
  const s4 = sec('Object');
  if (o.type !== 'edge' && o.type !== 'pattern') { const col = el('input', { type: 'color', value: o.color || (MATERIALS[(o.meta || {}).material] || {}).color || '#c7cbd8' }); col.onchange = () => apply([{ op: 'set', id: o.id, color: col.value }]); s4.append(field('colour', col)); }
  s4.append(el('div', { class: 'btns' },
    !['edge', 'pattern', 'weld'].includes(o.type) ? el('button', { class: 'btn', onclick: () => patternHint(o.id) }, 'Pattern…') : null,
    !['pattern', 'weld'].includes(o.type) ? el('button', { class: 'btn', title: 'A copy beside it, with its holes and edges', onclick: () => { try { const r = apply([{ op: 'duplicate', id: o.id }])[0]; select(r.id); } catch (e) { /* toast shown */ } } }, 'Duplicate') : null,
    !o.into && !META.has(o.type) && model.result.bodies.some(b => b.id === o.id) ? el('button', { class: 'btn', title: 'Hollow this part to an even wall thickness (any shape)', onclick: () => shellHint(o) }, 'Shell…') : null,
    el('button', { class: 'btn', onclick: () => apply([{ op: 'set', id: o.id, hidden: !o.hidden }]) }, o.hidden ? 'Show' : 'Hide'),
    el('button', { class: 'btn danger', onclick: () => { apply([{ op: 'delete', id: o.id }]); select(null); } }, 'Delete')));
}
/* ---------- add-on action forms (right panel) ---------- */
let addonForm = null;
function openAddonForm(addonId, action) { addonForm = { addonId, action, values: null, result: null }; setTool(null); selected = null; views.sel = null; renderProps(); }
function argInput(key, spec, value) {
  const v = value !== undefined ? value : spec.default;
  if (spec.options) { const sl = el('select', { 'data-k': key }, el('option', { value: '' }, '—'), ...spec.options.map(x => el('option', { value: x, selected: v === x }, x))); return sl; }
  if (typeof spec.default === 'boolean') { const c = el('input', { type: 'checkbox', 'data-k': key }); c.checked = !!v; return c; }
  const i = el('input', { 'data-k': key, value: v == null ? '' : Array.isArray(v) ? v.map(x => (Array.isArray(x) ? x.join(':') : x)).join(', ') : v, placeholder: spec.doc || '' }); i.addEventListener('keydown', e => e.stopPropagation()); return i;
}
function readArg(input, spec) {
  if (input.type === 'checkbox') return input.checked;
  const raw = input.value.trim(); if (raw === '') return null;
  if (Array.isArray(spec.default) || /[,:]/.test(raw)) { const parts = raw.split(/\s*,\s*/).map(x => (x.includes(':') ? x.split(':').map(Number) : (isFinite(+x) ? +x : x))); return parts; }
  return isFinite(+raw) && !spec.options ? +raw : raw;
}
function renderAddonForm(body) {
  const a = ADDONS.get(addonForm.addonId), act = a && a.actions[addonForm.action];
  if (!act) { addonForm = null; renderProps(); return; }
  const s = el('div', { class: 'sec' }, el('h4', null, `${a.name} · ${addonForm.action}`)); body.append(s);
  s.append(el('div', { class: 'empty', style: 'padding:4px 0' }, act.doc || ''));
  const inputs = Object.entries(act.args || {}).map(([k, spec]) => { const i = argInput(k, spec, addonForm.values ? addonForm.values[k] : undefined); s.append(field(label(k), i)); return [k, spec, i]; });
  const run = (extra) => {
    const args = Object.fromEntries(inputs.map(([k, spec, i]) => [k, readArg(i, spec)]).filter(([, v]) => v !== null)); Object.assign(args, extra || {});
    addonForm.values = args;
    try {
      if (act.query && !args.build) addonForm.result = act.run(args, model.addonContext()).info;
      else { const r = apply([{ op: 'addon', addon: a.id, action: addonForm.action, args }], `${a.name}: ${addonForm.action}`)[0]; addonForm.result = r.info || {}; const last = [...(r.results || [])].reverse().find(x => x && x.id); if (last) { views.sel = last.id; } views.fitAll(); toast(`${a.name}: ${addonForm.action} done`, 1600); }
    } catch (e) { addonForm.result = { error: e.message }; }
    renderProps();
  };
  s.append(el('div', { class: 'btns' }, el('button', { class: 'btn pri', onclick: () => run() }, act.query ? 'Advise' : 'Build'), act.query && act.args && 'build' in act.args ? el('button', { class: 'btn', onclick: () => run({ build: true }) }, 'Advise + build') : null, el('button', { class: 'btn', onclick: () => { addonForm = null; renderProps(); } }, 'Close')));
  if (addonForm.result) {
    const r = el('div', { class: 'sec' }, el('h4', null, addonForm.result.error ? 'Problem' : 'Result')); body.append(r);
    const show = (obj, into) => {
      for (const [k, v] of Object.entries(obj)) {
        if (v == null) continue;
        if (k === 'error') { into.append(el('div', { class: 'warnline' }, v)); continue; }
        if (Array.isArray(v) && v.every(x => typeof x === 'string') && v.some(x => x.length > 24)) { into.append(el('div', { class: 'f' }, label(k), el('ul', { class: 'why' }, ...v.map(x => el('li', null, x))))); continue; }
        if (v && typeof v === 'object' && !Array.isArray(v)) { const sub = el('div', { class: 'subsec' }, el('b', null, label(k))); into.append(sub); show(v, sub); continue; }
        into.append(el('div', { class: 'f' }, label(k), el('span', { class: 'mono' }, Array.isArray(v) ? v.join(', ') : typeof v === 'number' ? fmt(v) : String(v))));
      }
    };
    show(addonForm.result, r);
  }
}
function select(id) { id = model.resolveId(id); if (id) addonForm = null; selected = id; views.sel = id; refreshGhost(); renderTree(); renderProps(); views.draw(); }
function refreshGhost() {
  const o = selected && model.get(selected), R = model.result;
  if (o && (o.into || o.hidden) && R.local.has(o.id)) views.setGhost(R.local.get(o.id).transform(M4.mul(M4.translate(V.neg(R.originPoint)), R.world.get(o.id))).transform(M4.translate(R.originPoint)));
  else views.setGhost(null);
}

/* ---------- toolbar ---------- */
function syncBar() {
  $('#undo').disabled = !model.undoStack.length; $('#redo').disabled = !model.redoStack.length;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', tool && b.dataset.tool === tool.name));

  const cs = $('#cfgSel'), cfgs = model.doc.configs || [];
  cs.hidden = !cfgs.length; if (cfgs.length) { cs.innerHTML = ''; cs.append(el('option', { value: '' }, 'Default'), ...cfgs.map(c => el('option', { value: c.name, selected: model.doc.config === c.name ? true : null }, c.name))); }
  $('#sectionBtn').classList.toggle('on', !!views.section); $('#motionBtn').classList.toggle('on', !$('#motion').hidden); $('#checkBtn').classList.toggle('on', !$('#check').hidden);
  if (document.activeElement !== $('#name')) $('#name').value = model.doc.name;
}
document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addShape(b.dataset.add)));
/* a new shape lands on the selected part (on its top face), or on the ground part, or on the origin when it is the first */
function placeOn(id) { const o = id && model.get(id); if (!o || META.has(o.type)) return null; const root = rootOf(id); return worldConnectors(model.result, root).some(c => c.name === 'top' && c.kind === 'face') ? root : null; }
function addShape(type) {
  const g = model.result.ground, first = !g, on = !first ? placeOn(selected) : null;
  const r = apply([{ op: 'add', type, mate: first ? { to: 'origin', a: 'xy', b: 'bottom' } : on ? { to: on, a: 'top', b: 'bottom' } : undefined }])[0];
  select(r.id); if (first) setTimeout(() => views.fitAll(), 0);
  toast(first ? `${r.name} placed on the origin — it’s the ground` : on ? `${r.name} sits on ${model.get(on).name} — Join it or Cut it under “Combine” in Properties, or move it with slide x / y` : `${r.name} sits on ${model.get(g).name} — Mate to move it`, 2600);
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(tool && tool.name === b.dataset.tool ? null : b.dataset.tool)));
$('#undo').onclick = () => { const l = model.undo(); if (l) toast('Undo · ' + l, 900); };
$('#redo').onclick = () => { const l = model.redo(); if (l) toast('Redo · ' + l, 900); };
/* view settings: the View menu and the keys share these */
const VIEW = {
  layout: (l) => { views.layout = l; views.draw(); },
  hidden: () => { views.showHidden = !views.showHidden; syncBar(); views.draw(); },
  dims: () => { views.showDims = !views.showDims; syncBar(); views.draw(); },
  explode: () => { views.setExplode(views.explode > 0.5 ? 0 : 1); setTimeout(syncBar, 420); toast(views.explode > 0.5 ? 'Back together' : 'Pulled apart — welded and mated parts are separate components', 1600); },
  cog: () => { views.showCoG = !views.showCoG; syncBar(); renderProps(); views.draw(); },
  theme: () => { prefs.theme = isDark() ? 'light' : 'dark'; savePrefs(); document.documentElement.setAttribute('data-theme', prefs.theme); views.setTheme(isDark()); },
  zoom: (k) => { const ps = views.panes(), o = ps.find(q => q.id !== '3d'); if (o) views.zoomOrtho(o, o.x + o.w / 2, o.y + o.h / 2, k); if (ps.some(q => q.id === '3d')) views.zoom3d(k); views.draw(); }
};
$('#fit').onclick = () => views.fitAll();
$('#viewBtn').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect(), m = el('div', { class: 'menu viewmenu', style: `left:${Math.max(8, Math.min(r.left, innerWidth - 260))}px;top:${r.bottom + 4}px` });
  const item = (label, on, fn, key) => m.append(el('button', { class: 'mi', onclick: () => { m.remove(); fn(); } }, el('span', { class: 'ck' }, on == null ? '' : on ? '✓' : ''), el('span', { class: 'mt' }, label), el('span', { class: 'key' }, key || '')));
  m.append(el('div', { class: 'mh' }, 'Layout'));
  for (const [l, label, key] of [['4', 'All four views', '0'], ['front', 'FRONT only', '1'], ['top', 'TOP only', '2'], ['right', 'RIGHT only', '3'], ['3d', '3D only', '4']]) item(label, views.layout === l, () => VIEW.layout(l), key);
  item('Fit everything', null, () => views.fitAll(), 'F'); item('Zoom in', null, () => VIEW.zoom(1.25), 'wheel'); item('Zoom out', null, () => VIEW.zoom(0.8), 'wheel');
  m.append(el('div', { class: 'mh' }, 'Show'));
  item('Hidden lines (dashed)', views.showHidden, VIEW.hidden, 'H'); item('Dimensions', views.showDims, VIEW.dims, 'D'); item('Pulled apart (exploded)', views.explode > 0.5, VIEW.explode, 'E'); item('Centre of gravity', !!views.showCoG, VIEW.cog);
  m.append(el('div', { class: 'mh' }, 'Dragging in the 3D view'));
  item('Orbits (right-drag pans)', prefs.drag3d !== 'pan', () => { prefs.drag3d = 'orbit'; savePrefs(); }); item('Pans (right-drag orbits)', prefs.drag3d === 'pan', () => { prefs.drag3d = 'pan'; savePrefs(); });
  m.append(el('div', { class: 'mh' }, 'Theme')); item(isDark() ? 'Light theme' : 'Dark theme', null, VIEW.theme);
  document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
};
$('#shellBtn').onclick = () => { const id = placeOn(selected) || (selected && model.bodyContaining(selected) ? rootOf(selected) : null); if (id) shellHint(model.get(id)); else setTool('pick', { prompt: 'Shell: click the part to hollow', then: (pid) => { const rid = rootOf(pid); if (model.bodyContaining(rid)) shellHint(model.get(rid)); } }); };
$('#patternBtn').onclick = () => { if (selected) patternHint(selected); else setTool('pick', { prompt: 'Pattern / mirror: click the part or feature to repeat', then: (pid) => patternHint(pid) }); };
$('#checkBtn').onclick = () => { if (!$('#check').hidden) closeCheck(); else runInterference(); };
$('#sectionBtn').onclick = () => { if (views.section) { views.section = null; hint(null); views.draw(); syncBar(); } else sectionHint(); };
$('#motionBtn').onclick = () => { if ($('#motion').hidden) openMotion(); else closeMotion(); };
$('#moreBtn').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect(), m = el('div', { class: 'menu', style: `left:${r.left}px;top:${r.bottom + 4}px` });
  m.append(el('div', { class: 'mh' }, 'Shapes and reference'));
  for (const [t, f] of [['Bolt (threaded)…', () => fastenerHint('bolt')], ['Nut (threaded)…', () => fastenerHint('nut')], ['Spring / coil…', () => coilHint()], ['Plane on a face…', () => setTool('plane')], ['Fillet strip', () => addShape('fillet')]]) m.append(el('button', { onclick: () => { m.remove(); f(); } }, t));
  for (const a of listAddons()) {
    m.append(el('div', { class: 'mh' }, a.name));
    for (const [t, d] of Object.entries(a.types)) m.append(el('button', { onclick: () => { m.remove(); addShape(t); } }, 'Add ' + d.label.toLowerCase()));
    for (const k of Object.keys(a.actions)) m.append(el('button', { onclick: () => { m.remove(); openAddonForm(a.id, k); } }, k[0].toUpperCase() + k.slice(1) + '…'));
  }
  if (!ADDONS.size) m.append(el('div', { class: 'mh' }, 'No add-ons loaded'));
  document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
};

$('#name').addEventListener('change', () => apply([{ op: 'rename', name: $('#name').value }]));
$('#cfgSel').addEventListener('change', () => apply([{ op: 'config', name: $('#cfgSel').value || null }]));
$('#name').addEventListener('keydown', e => e.stopPropagation());
$('#fileBtn').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect(), m = el('div', { class: 'menu', style: `left:${r.left}px;top:${r.bottom + 4}px` });
  const item = (t, fn) => m.append(el('button', { onclick: () => { m.remove(); fn(); } }, t));
  item('New model', () => { if (model.doc.objects.length) model.load(newDoc('Model')); select(null); });
  item('Open model file…', () => $('#openIn').click());
  item('Save model file (.json)', () => download(new Blob([JSON.stringify(model.doc, null, 1)], { type: 'application/json' }), slug() + '.sf3d.json'));
  item('Export STL (3D print)', () => download(new Blob([exportSTL()], { type: 'model/stl' }), slug() + '.stl'));
  item('Export OBJ', () => download(new Blob([exportOBJ()], { type: 'text/plain' }), slug() + '.obj'));
  item('Export STEP (.step)…', stepHint);
  item('Export 4-view PNG', () => views.snapshot().toBlob(b => download(b, slug() + '-views.png')));
  item('Export parts list (CSV)', () => download(new Blob([bomCSV()], { type: 'text/csv' }), slug() + '-parts.csv'));
  item('Export drawing (SVG, A3)', () => { try { download(new Blob([drawingSVG(model, { sheet: 'A3', exploded: prefs.exploded !== false })], { type: 'image/svg+xml' }), slug() + '-drawing.svg'); } catch (e) { toast(e.message, 3000); } });
  item('Export drawing (DXF)', () => { try { download(new Blob([drawingDXF(model, { sheet: 'A3', exploded: prefs.exploded !== false })], { type: 'application/dxf' }), slug() + '-drawing.dxf'); } catch (e) { toast(e.message, 3000); } });
  item('Preview drawing', previewDrawing);
  item('Import STL / OBJ / STEP…', () => $('#meshIn').click());
  item('Save version…', () => { hint('Save a version of the model (you can go back to it any time):', [['Save', () => { const nm = document.querySelector('#hint input.vname').value; const v = model.saveVersion(nm); hint(null); toast(`Saved “${v.name}”`); save(); }]]); const i = el('input', { class: 'vname', placeholder: 'name, e.g. before shelling' }); i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') document.querySelector('#hint button').click(); }); $('#hint').insertBefore(i, $('#hint').children[1]); setTimeout(() => i.focus(), 0); });
  item('Versions…', showVersions);
  item('Load the demo model', demo);
  for (const ex of EXAMPLES) item('Example: ' + ex.name, () => loadExample(ex.id));
  if (/^\/3d\b/.test(location.pathname)) item('2D sketch board ↗', () => { location.href = '/'; });
  document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
};
/* STEP: an AP214 file with each part an exact planar B-rep, vetted by reading it back (closed shells, every edge once each
   way, planarity, genus, volume, area and bounding box against the model) before it is saved */
function exportStepFile(threads) {
  toast('Writing and vetting the STEP file…', 1500);
  setTimeout(() => {
    try {
      const { text, report } = exportStep(model, { threads, file: slug() + '.step' });
      download(new Blob([text], { type: 'model/step' }), slug() + '.step');
      const faces = report.parts.reduce((a, p) => a + p.faces, 0), mb = report.bytes / 1048576;
      if (report.ok) toast(`STEP saved and vetted ✓ — ${report.parts.length} part${report.parts.length > 1 ? 's' : ''}${report.placed_copies ? ` (+${report.placed_copies} placed copies)` : ''}, ${faces.toLocaleString()} faces, closed shells, volumes and areas match · ${mb < 1 ? Math.round(report.bytes / 1024) + ' KB' : mb.toFixed(1) + ' MB'}${(report.repairs || []).length ? ` · closed ${report.repairs.reduce((a, r) => a + r.hairline_holes_closed, 0)} hair-line gaps left by booleans` : ''}`, 5200);
      else toast('⚠ STEP saved, but vetting found: ' + report.errors.slice(0, 2).join('; '), 6000);
    } catch (e) { toast('Could not write STEP: ' + e.message, 4000); }
  }, 30);
}
function stepHint() {
  const big = model.doc.objects.some(o => ['bolt', 'nut'].includes(o.type) || (o.type === 'cylinder' && o.params.thread && o.params.thread !== 'none') || (o.type === 'hole' && o.params.modelled));
  hint(big ? 'Export STEP (AP214, solid B-rep, vetted). Threads:' : 'Export STEP (AP214, solid B-rep, vetted before it is saved):', big ? [['Plain threads (smaller)', () => { hint(null); exportStepFile('plain'); }], ['Modelled threads', () => { hint(null); exportStepFile('modelled'); }]] : [['Export STEP', () => { hint(null); exportStepFile('modelled'); }]]);
}
/* STEP in: each solid with planar faces becomes a mesh part, kept where it was in the file */
function importStepText(name, text, extra = {}) {
  const solids = stepToSolids(text), ops = [];
  for (const { name: pn, solid } of solids) {
    const bb = solid.bbox(), c = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, bb.min[2]], tri = [];
    for (const q of solid.polys) for (let i = 1; i < q.v.length - 1; i++) for (const v of [q.v[0], q.v[i], q.v[i + 1]]) tri.push(v.p[0] - c[0], v.p[1] - c[1], v.p[2] - c[2]);
    ops.push({ op: 'import', name: pn || name.replace(/\.(step|stp)$/i, ''), triangles: encodeTriangles(new Float32Array(tri)), count: tri.length / 9, at: c, fixed: true, material: extra.material });
  }
  return apply(ops, `Import ${name}`);
}
/* the drawing sheet in an overlay (works in the artifact viewer too, where downloads are blocked) */
function previewDrawing() {
  const dopts = () => ({ sheet: prefs.sheet || 'A3', exploded: prefs.exploded !== false });
  let svg; try { svg = drawingSVG(model, dopts()); } catch (e) { toast(e.message, 3000); return; }
  const parts = model.result.bodies.filter(b => !b.hidden && !b.solid.isEmpty()).length;
  const ov = el('div', { class: 'sheetov', onclick: (e) => { if (e.target === ov) ov.remove(); } });
  const bar = el('div', { class: 'sheetbar' }, el('b', null, 'Drawing'), el('span', { class: 'note' }, parts > 1 && prefs.exploded !== false ? 'Third-angle views, hidden lines dashed, exploded isometric with balloons numbered as the parts list' : 'Third-angle views, hidden lines dashed, dimensions from the model'),
    el('span', { style: 'flex:1' }),
    parts > 1 ? el('button', { class: 'btn' + (prefs.exploded !== false ? ' pri' : ''), title: 'Exploded isometric with numbered balloons tied to the parts list', onclick: () => { prefs.exploded = prefs.exploded === false; savePrefs(); ov.remove(); previewDrawing(); } }, 'Exploded') : null,
    ...['A4', 'A3', 'A2'].map(sz => el('button', { class: 'btn' + ((prefs.sheet || 'A3') === sz ? ' pri' : ''), onclick: () => { prefs.sheet = sz; savePrefs(); ov.remove(); previewDrawing(); } }, sz)),
    el('button', { class: 'btn', onclick: () => download(new Blob([svg], { type: 'image/svg+xml' }), slug() + '-drawing.svg') }, 'SVG'), el('button', { class: 'btn', onclick: () => download(new Blob([drawingDXF(model, dopts())], { type: 'application/dxf' }), slug() + '-drawing.dxf') }, 'DXF'), el('button', { class: 'btn', onclick: () => ov.remove() }, 'Close'));
  const img = el('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), alt: 'Drawing sheet' });
  ov.append(el('div', { class: 'sheetbox' }, bar, el('div', { class: 'sheetimg' }, img))); document.body.append(ov);
}
function showVersions() {
  const vs = model.listVersions();
  if (!vs.length) { toast('No versions yet: File → Save version… keeps a named copy'); return; }
  const h = $('#hint'); setTool(null); h.hidden = false; h.innerHTML = '';
  h.append(el('span', null, 'Versions:'));
  for (const v of vs.slice().reverse()) h.append(el('button', { title: new Date(v.at).toLocaleString() + ` · ${v.objects} features`, onclick: () => { model.restoreVersion(v.id); hint(null); select(null); views.fitAll(); toast(`Restored “${v.name}” (Undo to go back)`); } }, `${v.name} · ${new Date(v.at).toLocaleDateString()} ${new Date(v.at).toLocaleTimeString().slice(0, 5)}`));
  h.append(el('button', { onclick: () => hint(null) }, 'Close'));
}
$('#meshIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (/\.(step|stp)$/i.test(f.name)) { try { const r = importStepText(f.name, await f.text()); select(r[0].id); views.fitAll(); toast(`${f.name}: ${r.length} part${r.length > 1 ? 's' : ''} imported from STEP`, 3200); } catch (err) { toast('Could not import: ' + err.message, 5000); } return; }
  try {
    const parsed = parseMesh(f.name, await f.arrayBuffer());
    if (parsed.count > 60000) toast(`${parsed.count.toLocaleString()} triangles: booleans on it will be slow`, 3200);
    const big = Math.max(...parsed.size), scale = big < 2 ? 25.4 : 1;
    const r = apply([{ op: 'import', name: f.name, triangles: encodeTriangles(parsed.triangles), count: parsed.count, scale }], `Import ${f.name}`)[0];
    select(r.id); views.fitAll();
    toast(`${f.name}: ${parsed.count.toLocaleString()} triangles, ${parsed.size.map(v => fmt(v * scale)).join(' × ')} mm${scale !== 1 ? ' (looked like inches — scaled ×25.4; change scale in Properties)' : ''}`, 3600);
  } catch (err) { toast('Could not import: ' + err.message, 3600); }
});
$('#openIn').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { model.load(JSON.parse(await f.text())); select(null); views.fitAll(); toast('Opened ' + f.name); } catch (err) { toast('Could not open: ' + err.message); } e.target.value = ''; });
const slug = () => (model.doc.name || 'model').replace(/[^\w-]+/g, '-');
function download(blob, name) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); toast('Saved ' + name); }
/* exports use the repaired (T-junction free) mesh, so STL/OBJ are watertight; coordinates are mm from the model origin */
function meshTris(b, O) {
  const m = b.solid.toMesh(), P = m.positions, tris = [], weld = new Map();
  /* weld: points within 0.1 µm become one vertex with one spelling, so text files stay watertight */
  const pt = (i) => {
    const v = [P[i * 3] - O[0], P[i * 3 + 1] - O[1], P[i * 3 + 2] - O[2]].map(x => (Math.abs(x) < 5e-6 ? 0 : x)), k = v.map(x => Math.round(x * 1e4)).join(',');
    let c = weld.get(k); if (!c) weld.set(k, (c = v)); return c;
  };
  for (let i = 0; i < m.count; i += 3) {
    const a = pt(i), q = pt(i + 1), r = pt(i + 2); if (a === q || q === r || a === r) continue;
    const n = V.cross(V.sub(q, a), V.sub(r, a)), l = V.len(n); if (l < 1e-12) continue;
    tris.push([a, q, r, V.mul(n, 1 / l)]);
  }
  return tris;
}
export function exportSTL() {
  const R = model.result, out = ['solid ' + slug()], f = (v) => v.map(x => x.toFixed(5)).join(' ');
  for (const b of R.bodies) { if (b.hidden) continue; for (const [a, q, r, n] of meshTris(b, R.originPoint)) out.push(`facet normal ${f(n)}`, ' outer loop', `  vertex ${f(a)}`, `  vertex ${f(q)}`, `  vertex ${f(r)}`, ' endloop', 'endfacet'); }
  out.push('endsolid ' + slug()); return out.join('\n');
}
export function exportOBJ() {
  const R = model.result, out = ['# SketchFlow 3D · ' + model.doc.name, '# units: mm, origin: ' + (R.originRef ? R.originRef.obj + ' · ' + R.originRef.conn : 'world')]; let count = 0;
  for (const b of R.bodies) {
    if (b.hidden) continue; out.push('o ' + b.name.replace(/\s+/g, '_'));
    const index = new Map(), face = [];
    const vid = (v) => { const k = v.map(x => x.toFixed(5)).join(' '); let i = index.get(k); if (!i) { i = ++count; index.set(k, i); out.push('v ' + k); } return i; };
    for (const [a, q, r] of meshTris(b, R.originPoint)) face.push(`f ${vid(a)} ${vid(q)} ${vid(r)}`);
    out.push(...face);
  }
  return out.join('\n');
}

/* ---------- tools ---------- */
let tool = null;
/* the hint bar doubles as a tiny inline form: fields = [[key, label, value]], actions get the current values */
const hint = (t, actions, fields) => {
  const h = $('#hint'); if (!t) { h.hidden = true; return; } h.hidden = false; h.innerHTML = '';
  const inputs = (fields || []).map(([k, label, v, options]) => {
    const i = options ? el('select', { 'data-k': k, 'aria-label': label }, ...options.map(x => el('option', { value: x, selected: x === v }, x))) : typeof v === 'string' ? el('input', { type: 'text', value: v, 'data-k': k, 'data-str': '1', 'aria-label': label, class: 'htext' }) : el('input', { type: 'number', step: 'any', value: v, 'data-k': k, 'aria-label': label });
    i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && actions && actions[0]) actions[0][1](vals()); if (e.key === 'Escape') setTool(null); }); return [k, label, i, options];
  });
  const vals = () => Object.fromEntries(inputs.map(([k, , i, options]) => [k, options || i.dataset.str ? i.value : parseFloat(String(i.value).replace(',', '.'))]));
  const own = (actions || []).some(([l]) => l === 'Done' || l === 'Cancel');
  h.append(el('span', null, t), ...inputs.map(([, label, i]) => el('label', { class: 'hf' }, label, i)), ...(actions || []).map(([l, f]) => el('button', { class: l === 'Done' ? 'pri' : '', onclick: () => f(vals()) }, l)), own ? '' : el('button', { onclick: () => setTool(null) }, 'Cancel'));
  if (inputs[0] && !inputs[0][3]) setTimeout(() => { inputs[0][2].focus(); if (inputs[0][2].select) inputs[0][2].select(); }, 0);
};
let pendingLoft = null;
/* Boss / Cut: a cylinder or box joined onto (or cut into) the face you click, centred where you click */
function featureHint(kind) {
  const sh = prefs.featShape || 'cylinder', only = tool.data.only, dep = kind === 'cut' ? 'depth mm' : 'height mm';
  const fields = [['shape', 'shape', sh, ['cylinder', 'box']], ...(sh === 'box' ? [['width', 'width mm', prefs.featW || 10], ['depth', 'length mm', prefs.featL || 10]] : [['diameter', 'Ø mm', prefs.featDia || 10]]), ['height', dep, prefs.featH || 5]];
  hint(`${kind === 'boss' ? 'Boss — joined onto' : 'Cut — a pocket in'} ${only ? model.get(only).name : 'a part'}: set the size, then click the face where its centre goes`, [['Done', () => setTool(null)]], fields);
  document.querySelectorAll('#hint [data-k]').forEach(i => i.addEventListener('change', () => { const k = i.dataset.k; if (k === 'shape') { prefs.featShape = i.value; savePrefs(); featureHint(kind); return; } prefs[{ width: 'featW', depth: 'featL', diameter: 'featDia', height: 'featH' }[k]] = +i.value; savePrefs(); }));
}
/* split a part with a plane: which plane, and which side to keep */
function splitHint(target, planeId) {
  const planes = (model.result.planes || []).map(id => model.get(id)).filter(Boolean); if (!planes.length) { toast('Make a plane first (More ▾ → Plane on a face)'); return; }
  const t = model.get(target); if (!t) return;
  const go = (keep) => (v) => { try { const r = apply([{ op: 'split', target, plane: v.plane, keep }])[0]; hint(null); select(r.id); toast(keep === 'both' ? `${t.name} is now two parts` : `${t.name} cut: kept the side ${keep} the plane`, 2200); } catch (e) { /* toast shown */ } };
  hint(`Split ${t.name} with a plane (“above” is the side its arrow points to):`, [['Keep below', go('below')], ['Keep above', go('above')], ['Keep both', go('both')]], [['plane', 'plane', planeId || planes[planes.length - 1].id, planes.map(p => p.id)]]);
  const sel = document.querySelector('#hint select[data-k="plane"]'); if (sel) [...sel.options].forEach(op => { op.textContent = (model.get(op.value) || {}).name || op.value; });
}
/* bolts and nuts with modelled ISO threads: a bolt seats under its head on the selected part's top face; a nut sits on it */
function fastenerHint(kind) {
  setTool(null);
  const sizes = Object.keys(THREADS), fields = kind === 'bolt' ? [['size', 'size', prefs.boltSize || 'M8', sizes], ['length', 'length mm', prefs.boltL || 25], ['head', 'head', prefs.boltHead || 'hex', ['hex', 'socket']]] : [['size', 'size', prefs.boltSize || 'M8', sizes], ['shape', 'shape', 'hex', ['hex', 'round', 'knurled']]];
  hint(kind === 'bolt' ? 'Bolt with a modelled thread (ISO metric coarse):' : 'Nut with a modelled thread (ISO metric coarse):', [['Add ' + kind, (v) => {
    prefs.boltSize = v.size; if (kind === 'bolt') { prefs.boltL = v.length; prefs.boltHead = v.head; } savePrefs();
    const on = placeOn(selected), first = !model.result.ground, op = { op: 'add', type: kind, params: kind === 'bolt' ? { size: v.size, length: v.length || 25, head: v.head } : { size: v.size, shape: v.shape } };
    if (on) op.mate = kind === 'bolt' ? { to: on, a: 'top', b: 'seat' } : { to: on, a: 'top', b: 'bottom' }; else if (first) op.mate = { to: 'origin', a: 'xy', b: 'bottom' }; else op.fixed = true;
    try { const r = apply([op])[0]; hint(null); select(r.id); if (first) setTimeout(() => views.fitAll(), 0); toast(`${v.size} ${kind} added${on ? ' on ' + model.get(on).name : ''} — mate it into a hole (its seat / bottom connector)`, 2600); } catch (e) { /* toast shown */ }
  }]], fields);
}
/* a spring: wire diameter, coil radius, pitch, turns — on the selected part, or at the origin */
function coilHint() {
  setTool(null);
  hint('Spring / coil: a round wire swept along a helix (all sizes stay editable):', [['Add spring', (v) => {
    const on = placeOn(selected), first = !model.result.ground;
    const op = { op: 'helix', wire: v.wire, radius: v.radius, pitch: v.pitch, turns: v.turns, left: v.hand === 'left' };
    if (on) op.mate = { to: on, a: 'top', b: 'bottom' }; else if (first) op.mate = { to: 'origin', a: 'xy', b: 'bottom' }; else op.fixed = true;
    try { const r = apply([op])[0]; hint(null); select(r.id); if (first) setTimeout(() => views.fitAll(), 0); } catch (e) { /* toast shown */ }
  }]], [['wire', 'wire Ø mm', 2], ['radius', 'coil radius mm', 10], ['pitch', 'pitch mm', 5], ['turns', 'turns', 6], ['hand', 'hand', 'right', ['right', 'left']]]);
}
function hintValues() { return Object.fromEntries([...document.querySelectorAll('#hint [data-k]')].map(i => [i.dataset.k, i.dataset.str || i.tagName === 'SELECT' ? i.value : parseFloat(String(i.value).replace(',', '.'))])); }
const rootOf = (id) => (model.bodyContaining(id) || {}).id || id;
function setTool(name, arg) {
  if (tool && tool.data && tool.data.prevLayout) views.layout = tool.data.prevLayout;   /* a face sketch maximised its view: put the layout back */
  views.sketchGrid = 0; views.sketchPane = null; snapCache = null; document.querySelectorAll('.menu.snapmenu').forEach(m => m.remove());
  tool = name ? { name, step: 0, data: {} } : null; views.connectorsFor = null; views.preview = null;
  if (tool && typeof arg === 'string' && ['hole', 'text', 'boss', 'cut'].includes(name)) tool.data.only = arg;   /* from a part's Add to… buttons */
  if (!name) hint(null);
  else if (name === 'mate') { if (arg) { tool.data.moving = arg; tool.step = 1; views.connectorsFor = arg; hint('Mate: click the connector on ' + model.get(arg).name + ' to attach'); } else hint('Mate: click the object you want to move'); }
  else if (name.startsWith('bool-')) hint((name === 'bool-add' ? 'Union' : name === 'bool-subtract' ? 'Subtract' : 'Intersect') + ': click the target body, then the tool body');
  else if (name === 'edge-weld') {
    hint('Weld: click where two separate parts meet — the bead joins them, and they stay separate parts', [['Done', () => setTool(null)]], [['size', 'leg mm', prefs.weldSize || 4], ['profile', 'profile', prefs.weldProfile || 'flat', ['flat', 'convex', 'concave']]]);
    const [sz, pf] = document.querySelectorAll('#hint [data-k]');
    sz.addEventListener('input', () => { const v = parseFloat(sz.value); if (v > 0) { prefs.weldSize = v; savePrefs(); } }); pf.addEventListener('change', () => { prefs.weldProfile = pf.value; savePrefs(); }); setTimeout(() => sz.blur(), 0);
  }
  else if (name.startsWith('edge-')) {
    hint(`${name.slice(5)[0].toUpperCase() + name.slice(6)}: click near an edge — outer edges are trimmed, inner corners filled; where two parts meet it merges them into one`, [['Done', () => setTool(null)]], [['size', 'size mm', prefs.edgeSize || 4]]);
    const inp = $('#hint input'); if (inp) { inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (v > 0) { prefs.edgeSize = v; savePrefs(); } }); setTimeout(() => inp.blur(), 0); }
  }
  else if (name === 'hole') {
    hint(`Hole: click a face${tool.data.only ? ' of ' + model.get(tool.data.only).name : ''} to place it — it is dimensioned from the two nearest edges (click a dimension to change it)`, [['Done', () => setTool(null)]], [['size', 'size', prefs.holeSize || 'M6', Object.keys(HOLES)], ['kind', 'type', prefs.holeKind || 'simple', ['simple', 'counterbore', 'countersink', 'tapped', 'insert']], ['fit', 'fit', prefs.holeFit || 'normal', ['close', 'normal', 'loose', 'print']], ['depth', 'depth (0 = through)', prefs.holeDepth || 0], ['thread', 'thread (tapped)', prefs.holeThread || 'drill only', ['drill only', 'modelled']]]);
    document.querySelectorAll('#hint [data-k]').forEach(i => i.addEventListener('change', () => { const k = i.dataset.k; prefs['hole' + k[0].toUpperCase() + k.slice(1)] = k === 'depth' ? +i.value : i.value; savePrefs(); }));
  }
  else if (name === 'text') {
    hint(`Text: set the words, then click a flat face${tool.data.only ? ' of ' + model.get(tool.data.only).name : ''} — emboss stands it on the face, engrave cuts it in (change anything later in Properties)`, [], [['text', 'text', prefs.textText || 'TEXT'], ['height', 'height mm', prefs.textH || 8], ['depth', 'depth mm', prefs.textD || 1], ['mode', 'mode', prefs.textMode || 'emboss', ['emboss', 'engrave']], ['path', 'path', prefs.textPath || 'line', ['line', 'arc', 'arc-inside']], ['radius', 'arc radius', prefs.textR || 30]]);
    document.querySelectorAll('#hint [data-k]').forEach(i => i.addEventListener('change', () => { const k = { text: 'textText', height: 'textH', depth: 'textD', mode: 'textMode', path: 'textPath', radius: 'textR' }[i.dataset.k]; prefs[k] = i.dataset.str || i.tagName === 'SELECT' ? i.value : +i.value; savePrefs(); }));
  }
  else if (name === 'measure') { views.connectorsFor = 'all'; hint('Dimension: click two dots in FRONT / TOP / RIGHT — a hole centre, then a face dot (middle of an edge in this view) gives the off-edge distance'); }
  else if (name === 'sketch') {
    const d = tool.data; d.points = []; d.hist = []; d.arcs = []; d.tangents = []; d.splines = []; d.spl = []; d.mode = pendingLoft ? 'polyline' : (prefs.sketchMode || 'polyline'); d.seg = pendingLoft ? 'line' : (prefs.sketchSeg || 'line');
    if (arg && arg.on) { d.on = arg.on; d.prevLayout = arg.prevLayout; d.pane = arg.on.pane; d.basis = BASISof(arg.on.pane); }
    if (arg !== true) pendingLoft = null;
    sketchHint();
  }
  else if (name === 'sketch-face') { tool.data.only = arg && arg.only; hint(`Sketch on a face: click a flat face${tool.data.only ? ' of ' + model.get(tool.data.only).name : ' of a part'} — one facing front / back, up / down or left / right (any view, 3D too)`); }
  else if (name === 'boss' || name === 'cut') featureHint(name);
  else if (name === 'pick') { tool.data.then = arg.then; hint(arg.prompt); }
  else if (name === 'plane') {
    hint('Plane: click a flat face — the plane sits on it, moved out by the gap and turned by the tilt (both editable later)', [], [['offset', 'gap mm', prefs.planeOff || 0], ['tilt', 'tilt °', prefs.planeTilt || 0]]);
    document.querySelectorAll('#hint [data-k]').forEach(i => i.addEventListener('change', () => { prefs[i.dataset.k === 'offset' ? 'planeOff' : 'planeTilt'] = +i.value; savePrefs(); }));
  }
  else if (name === 'split') {
    if (!(model.result.planes || []).length) { tool = null; toast('Split cuts with a plane: make one first (click a face)', 2600); setTool('plane'); return; }
    hint('Split: click the part to cut');
  }
  syncBar(); views.draw();
}
/* ---------- sketch: lines, arcs, tangent arcs, shapes, snapping, open (thin) profiles, and sketching on any face ---------- */
const SNAP_DEFAULT = { grid: true, step: 5, points: true, mids: true, hv: false, angle: false, show: true };
const snapOpts = () => Object.assign({}, SNAP_DEFAULT, prefs.snap || {});
const setSnap = (patch) => { prefs.snap = Object.assign(snapOpts(), patch); savePrefs(); if (tool && tool.name === 'sketch' && tool.step < 9) sketchHint(); views.draw(); };
const snapLabel = (o) => { const p = []; if (o.grid) p.push(fmt(o.step) + ' mm grid'); if (o.points) p.push('points'); if (o.mids) p.push('midpoints'); if (o.hv) p.push('H/V'); if (o.angle) p.push('15°'); return p.length ? p.join(' · ') : 'off'; };
const SKETCH_STEP = { rect: 'Click one corner, then the opposite corner', circle: 'Click the centre, then a point on the circle', slot: 'Click one end, then the other', polygon: 'Click the centre, then a corner' };
function sketchStepText(d) {
  if (d.mode !== 'polyline') return SKETCH_STEP[d.mode];
  if (d.seg === 'arc') return !d.points.length ? 'Arc: click where it starts' : d.arcEnd ? 'Arc: click a point it passes through' : 'Arc: click where it ends';
  if (d.seg === 'spline') return !d.points.length ? 'Spline: click where it starts' : !d.spl.length ? 'Spline: click the points it runs through' : 'Spline: more points — or switch to Line / Arc, or Close shape, to end it here';
  if (d.seg === 'tarc') return d.points.length < 2 ? 'Tangent arc: draw a line (or arc) first — the arc then carries on smoothly from its end' : 'Tangent arc: click where it ends';
  return !d.points.length ? 'Line: click the first point' : d.points.length < 2 ? 'Line: click the next point' : d.points.length < 3 ? 'Click the next point — or Finish open for a rib / thin wall' : 'Click the next point — the first point (or Close shape) closes it; Finish open makes a rib / thin wall';
}
function snapMenu(anchor) {
  document.querySelectorAll('.menu.snapmenu').forEach(m => m.remove());
  const r = anchor.getBoundingClientRect(), o = snapOpts(), m = el('div', { class: 'menu snapmenu', style: `left:${Math.max(8, Math.min(innerWidth - 270, r.left))}px;top:${r.bottom + 6}px` });
  const reopen = () => { m.remove(); const b = document.querySelector('#hint .snapbtn'); if (b) snapMenu(b); };
  const check = (k, label, tip) => { const c = el('input', { type: 'checkbox' }); c.checked = !!o[k]; c.onchange = () => { setSnap({ [k]: c.checked }); reopen(); }; return el('label', { class: 'mchk', title: tip || '' }, c, el('span', null, label)); };
  m.append(el('div', { class: 'mh' }, 'Snap to'), check('grid', 'Grid', 'Points land on the grid'),
    el('div', { class: 'mstep' }, el('span', { class: 'note' }, 'step'), ...[0.5, 1, 2, 5, 10, 25].map(v => el('button', { class: o.step === v ? 'on' : '', onclick: () => { setSnap({ step: v, grid: true }); reopen(); } }, fmt(v))), el('span', { class: 'note' }, 'mm')),
    check('show', 'Show the grid'),
    check('points', 'Points, corners and centres', 'Your sketch points, part corners, face and hole centres, the origin'), check('mids', 'Edge midpoints'),
    el('div', { class: 'mh' }, 'Lock'), check('hv', 'Horizontal / vertical only', 'Each line goes straight across or straight up (holding Shift does the same)'), check('angle', '15° angles', 'Lines turn in 15° steps, lengths on the grid'));
  document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target) && !ev.target.closest('.snapbtn')) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
}
function sketchHint() {
  const h = $('#hint'), d = tool.data, o = snapOpts(); h.hidden = false; h.innerHTML = '';
  views.sketchGrid = o.grid && o.show ? o.step : 0; views.sketchPane = d.on ? d.on.pane : d.pane || null; views.sketchGridAt = d.on ? d.on.gridAt : null;
  const grp = (label, ...kids) => el('span', { class: 'skgrp' }, el('span', { class: 'sklbl' }, label), ...kids);
  const reset = () => { d.points = []; d.arcs = []; d.tangents = []; d.splines = []; d.spl = []; d.hist = []; d.arcEnd = null; if (!d.on) d.pane = null; views.preview = null; };
  const lineBtn = (seg, label, tip) => el('button', { class: d.mode === 'polyline' && (d.seg || 'line') === seg ? 'on' : '', title: tip, onclick: () => { commitSpline(d); prefs.sketchMode = 'polyline'; prefs.sketchSeg = seg; savePrefs(); if (d.mode !== 'polyline') reset(); d.mode = 'polyline'; d.seg = seg; d.arcEnd = null; sketchHint(); views.draw(); } }, label);
  const shapeBtn = (k, label) => el('button', { class: d.mode === k ? 'on' : '', disabled: pendingLoft ? true : null, onclick: () => { prefs.sketchMode = k; savePrefs(); d.mode = k; reset(); sketchHint(); views.draw(); } }, label);
  const where = d.on && d.on.wrap ? `on ${d.on.name} · ${d.on.faceName} — drawn unrolled (across = round the face, up = along it)` : d.on && d.on.drape ? `on ${d.on.name} · ${d.on.faceName} — drawn on the plane touching it, then projected onto the surface` : d.on ? `on ${d.on.name} · ${d.on.faceName} (the view is square to it)` : pendingLoft ? `the END profile, in the ${pendingLoft.pane.toUpperCase()} view` : d.pane ? `in the ${d.pane.toUpperCase()} view` : 'in FRONT, TOP or RIGHT';
  const row = el('div', { class: 'skrow' }, el('b', null, pendingLoft ? 'Loft' : 'Sketch'), el('span', { class: 'note' }, where));
  if (!d.on && !pendingLoft) row.append(el('button', { title: 'Sketch on a flat face of a part (any angle): the profile starts on that face, joins or cuts that part, and follows it', onclick: () => setTool('sketch-face') }, 'On a face…'));
  row.append(grp('Lines', lineBtn('line', 'Line', 'Straight segments, point after point'), lineBtn('arc', 'Arc', 'Three-point arc: its end, then a point it passes through'), lineBtn('tarc', 'Tangent arc', 'An arc that carries on smoothly from the last segment: click its end'), lineBtn('spline', 'Spline', 'A smooth curve through the points you click; switch to another line type (or close) to end it')),
    grp('Shapes', shapeBtn('rect', 'Rectangle'), shapeBtn('circle', 'Circle'), shapeBtn('slot', 'Slot'), shapeBtn('polygon', 'Polygon')));
  if (d.mode === 'polygon') { const i = el('input', { type: 'number', min: 3, step: 1, value: prefs.sides || 6, 'aria-label': 'sides', style: 'width:52px' }); i.addEventListener('keydown', e => e.stopPropagation()); i.addEventListener('change', () => { prefs.sides = Math.max(3, Math.round(+i.value)); savePrefs(); }); row.append(el('label', { class: 'hf' }, 'sides', i)); }
  if (d.mode === 'slot') { const i = el('input', { type: 'number', min: 1, step: 'any', value: prefs.slotW || 10, 'aria-label': 'slot width', style: 'width:52px' }); i.addEventListener('keydown', e => e.stopPropagation()); i.addEventListener('change', () => { prefs.slotW = +i.value; savePrefs(); }); row.append(el('label', { class: 'hf' }, 'width', i)); }
  row.append(el('button', { class: 'snapbtn', title: 'Snapping: grid, points, midpoints, horizontal / vertical, angles', onclick: (e) => snapMenu(e.currentTarget) }, 'Snap: ' + snapLabel(o) + ' ▾'));
  row.append(el('button', { disabled: d.points.length || d.arcEnd || d.spl.length ? null : true, title: 'Take back the last point (or arc)', onclick: () => undoSketchPoint() }, 'Undo point'));
  if (d.mode === 'polyline' && !pendingLoft) row.append(el('button', { disabled: d.points.length >= 2 && !d.arcEnd ? null : true, title: 'Leave the outline open: it becomes a rib or thin wall of a thickness you choose', onclick: () => { commitSpline(d); finishOpen(); } }, 'Finish open'));
  if (d.mode === 'polyline') row.append(el('button', { class: d.points.length >= 3 ? 'pri' : '', disabled: d.points.length >= 3 && !d.arcEnd ? null : true, title: 'Close the profile and make it 3D', onclick: () => { commitSpline(d); finishSketch(); } }, 'Close shape'));
  row.append(el('button', { onclick: () => setTool(null) }, 'Cancel'));
  h.append(row, el('div', { class: 'sknote' }, sketchStepText(d)));
}
const sk2 = (d) => { const B = d.basis || BASISof(d.pane); return { B, P2: (q) => [V.dot(q, B.r), V.dot(q, B.u)], P3: (q) => V.add(V.mul(B.r, q[0]), V.mul(B.u, q[1])) }; };
function pushHist(d) { d.hist.push({ n: d.points.length, a: d.arcs.length, t: d.tangents.length, s: d.splines.length, sp: d.spl.length }); }
/* end the spline being drawn: its last point becomes a corner of the outline (or closes it on the first point) */
function commitSpline(d) {
  if (!d.spl || !d.spl.length) return false;
  const pts = d.spl.slice(), end = pts.pop(), i = d.points.length - 1; d.spl = [];
  const closes = d.points.length >= 2 && V.len(V.sub(d.points[0], end)) < 1e-6;
  if (pts.length) d.splines.push({ i, pts });
  if (!closes) d.points.push(end);
  return closes;
}
function undoSketchPoint() {
  const d = tool.data;
  if (d.arcEnd) d.arcEnd = null;
  else if (d.hist.length) { const hh = d.hist.pop(); d.points.length = hh.n; d.arcs.length = hh.a; d.tangents.length = hh.t; d.splines.length = hh.s || 0; d.spl.length = hh.sp || 0; }
  else d.points.pop();
  if (!d.points.length && !d.on) d.pane = null;
  views.preview = d.points.length ? { pane: d.pane, points: sketchPath(d) } : null; sketchHint(); views.draw();
}
/* the outline drawn so far, arcs as short chords (3D, for the preview); closed adds the closing segment */
function sketchPath(d, closed, extra) {
  if (!d.points.length || !(d.basis || d.pane)) return d.points.slice();
  const { P2, P3 } = sk2(d), arcs = d.arcs.concat(extra && extra.arc ? [extra.arc] : []), spl = (d.splines || []).slice();
  const pts = d.points.slice();
  /* the spline being drawn runs on from the last corner through its points (and the cursor) */
  const pend = (d.spl || []).concat(extra && extra.p && d.seg === 'spline' ? [extra.p] : []);
  if (pend.length) { const end = pend[pend.length - 1]; if (pend.length > 1) spl.push({ i: pts.length - 1, pts: pend.slice(0, -1) }); pts.push(end); }
  else if (extra && extra.p) pts.push(extra.p);
  return expandArcs(pts.map(P2), arcs.map(a => ({ i: a.i, c: P2(a.c), ccw: a.ccw })), { open: !closed, splines: spl.map(q => ({ i: q.i, pts: q.pts.map(P2) })) }).pts.map(P3);
}
/* the direction the outline leaves its last point in: along the last line, or along the last arc at its end */
function lastTangent(d) {
  const n = d.points.length; if (n < 2) return null;
  const { P2 } = sk2(d), s = n - 2, a = P2(d.points[s]), b = P2(d.points[n - 1]), arc = d.arcs.find(x => x.i === s), sp = (d.splines || []).find(x => x.i === s);
  if (sp && sp.pts.length) { const q = P2(sp.pts[sp.pts.length - 1]); return [b[0] - q[0], b[1] - q[1]]; }
  if (!arc) return [b[0] - a[0], b[1] - a[1]];
  const c = P2(arc.c), rv = [b[0] - c[0], b[1] - c[1]]; return arc.ccw ? [-rv[1], rv[0]] : [rv[1], -rv[0]];
}
/* an arc segment from the last point to p (3-point arcs take a "through" point, tangent arcs the last direction) */
function arcTo(d, p, through) {
  const { P2, P3 } = sk2(d), a = P2(d.points[d.points.length - 1]), b = P2(p);
  const g = through ? arcThrough(a, b, P2(through)) : (lastTangent(d) ? arcTangent(a, lastTangent(d), b) : null);
  return g ? { i: d.points.length - 1, c: P3(g.c), ccw: g.ccw } : null;
}
let snapCache = null;
function snapTargets(paneId) {
  const R = model.result; if (snapCache && snapCache.R === R && snapCache.pane === paneId) return snapCache.list;
  const B = BASISof(paneId), O = R.originPoint, list = [], seen = new Set();
  const put = (w, kind, label) => { const q = V.sub(w, O), x = V.dot(q, B.r), y = V.dot(q, B.u), k = Math.round(x * 1e3) + ',' + Math.round(y * 1e3) + kind; if (seen.has(k) || list.length > 40000) return; seen.add(k); list.push({ x, y, kind, label }); };
  put(O, 'point', 'origin');
  for (const o of model.doc.objects) if (R.world.has(o.id) && !META.has(o.type)) for (const c of worldConnectors(R, o.id)) if (c.kind === 'center' || c.kind === 'face') put(c.o, 'point', c.kind === 'center' ? 'centre' : c.name + ' centre');
  for (const b of R.bodies) { if (b.hidden || b.solid.isEmpty()) continue; for (const [a, c] of K.creaseEdges(b.solid)) { put(a, 'point', 'corner'); put(c, 'point', 'corner'); put(V.lerp(a, c, 0.5), 'mid', 'midpoint'); } }
  snapCache = { R, pane: paneId, list }; return list;
}
/* snap a sketch point: points first (sketch points, corners, centres, midpoints), then the H / V or angle lock from the
   last point, then the grid. Returns the point and what it snapped to (for the marker and the length readout) */
function snapSketch(pane, pp, straight) {
  const d = tool.data, B = BASISof(pane.id), o = snapOpts(), pts = d.points;
  const ppm = Math.abs(views.project(pane, B.r).x - views.project(pane, [0, 0, 0]).x) || 1, tol = 10 / ppm;
  let x = pp.x, y = pp.y, snap = null;
  const lastP = d.arcEnd || (d.spl && d.spl.length ? d.spl[d.spl.length - 1] : null) || (pts.length ? pts[pts.length - 1] : null), last = lastP ? [V.dot(lastP, B.r), V.dot(lastP, B.u)] : null;
  const g0 = d.on && d.on.gridAt ? [V.dot(d.on.gridAt, B.r), V.dot(d.on.gridAt, B.u)] : [0, 0];   /* on a face the grid starts at the face's centre */
  if (o.points || o.mids) {
    let best = null, bd = tol;
    const cand = o.points ? pts.map((p, i) => ({ x: V.dot(p, B.r), y: V.dot(p, B.u), kind: 'point', label: i === 0 ? 'start' : 'point' })) : [];
    for (const t of snapTargets(pane.id)) if (t.kind === 'mid' ? o.mids : o.points) cand.push(t);
    for (const t of cand) { const dd = Math.hypot(t.x - x, t.y - y); if (dd < bd) { bd = dd; best = t; } }
    if (best) { x = best.x; y = best.y; snap = { kind: best.kind, label: best.label }; }
  }
  if (!snap && last && !d.arcEnd && (straight || o.hv || o.angle)) {
    const dx = x - last[0], dy = y - last[1], g = (v) => (o.grid ? Math.round(v / o.step) * o.step : v);
    if (straight || o.hv) { if (Math.abs(dx) >= Math.abs(dy)) { x = last[0] + g(dx); y = last[1]; } else { x = last[0]; y = last[1] + g(dy); } snap = { kind: 'grid', label: (Math.abs(dx) >= Math.abs(dy) ? 'horizontal ' : 'vertical ') + fmt(Math.hypot(x - last[0], y - last[1])), guide: true }; }
    else { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), L = Math.max(o.grid ? o.step : 0, g(Math.hypot(dx, dy))); x = last[0] + L * Math.cos(a); y = last[1] + L * Math.sin(a); snap = { kind: 'grid', label: `${Math.round(a * 180 / Math.PI)}° · ${fmt(L)}`, guide: true }; }
  } else if (!snap && o.grid) { x = g0[0] + Math.round((x - g0[0]) / o.step) * o.step; y = g0[1] + Math.round((y - g0[1]) / o.step) * o.step; snap = { kind: 'grid', label: last ? fmt(Math.hypot(x - last[0], y - last[1])) : null }; }
  const p = V.add(V.mul(B.r, x), V.mul(B.u, y));
  if (snap) { snap.p = p; if (snap.guide) snap.guide = lastP; else delete snap.guide; if (snap.kind !== 'grid' && last) snap.label += ' · ' + fmt(Math.hypot(x - last[0], y - last[1])); }
  return { p, snap };
}
/* a profile drawn on a face: its points (and arc centres) in the face's own frame, and the mate that puts them back where
   they were drawn, standing out of the face (boss, new part) or going into it (cut). Without a face connector: a fixed pose. */
function onFace(d, pts3, cut, centre3, arcs3, spl3) {
  const R = model.result, O = R.originPoint, on = d.on, B = BASISof(on.pane), depth = V.dot(V.sub(on.point, O), B.f);
  const Wd = (p) => V.add(V.add(O, p), V.mul(B.f, depth)), W = pts3.map(Wd);
  let c = [0, 0, 0]; if (centre3) c = Wd(centre3); else { for (const w of W) c = V.add(c, w); c = V.mul(c, 1 / W.length); }
  const n = on.n, yAx = V.cross(n, B.r), loc = (w) => [+V.dot(V.sub(w, c), B.r).toFixed(6), +V.dot(V.sub(w, c), yAx).toFixed(6)];
  let prof = W.map(loc), arcs = (arcs3 || []).map(a => ({ i: a.i, c: loc(Wd(a.c)), ccw: a.ccw })), splines = (spl3 || []).map(q => ({ i: q.i, pts: q.pts.map(pp => loc(Wd(pp))) }));
  if (on.conn) {
    const f = on.conn, v = V.cross(f.n, f.u), d0 = V.sub(c, f.o), slide = [+V.dot(d0, f.u).toFixed(4), +V.dot(d0, v).toFixed(4)];
    const ru = V.dot(B.r, f.u), rv = V.dot(B.r, v), angle = +(Math.atan2(cut ? rv : -rv, ru) * 180 / Math.PI).toFixed(6);
    return { prof, arcs, splines, centre: c, mate: cut ? { to: on.id, a: f.name, b: 'end', flip: false, slide, angle, offset: 0 } : { to: on.id, a: f.name, b: 'start', flip: true, slide, angle, offset: 0 } };
  }
  const frame = M4.frame(c, B.r, cut ? V.neg(n) : n), pose = poseFromMatrix(frame);
  if (cut) { prof = prof.map(([x, y]) => [x, -y]); arcs = arcs.map(a => ({ i: a.i, c: [a.c[0], -a.c[1]], ccw: !a.ccw })); splines = splines.map(q => ({ i: q.i, pts: q.pts.map(([x, y]) => [x, -y]) })); }
  return { prof, arcs, splines, centre: c, pose };
}
/* start a sketch on any flat face of a part: {id, point (world), normal}. A view square to that face opens for drawing */
function startFaceSketch(pk, only) {
  const id = pk.id; if (!id || !model.get(id)) { toast('Click on a flat face of a part'); return false; }
  const root = rootOf(id), o = model.get(id);
  if (only && root !== only && id !== only) { toast(`Click a face of ${model.get(only).name}`); return false; }
  const n = V.norm(pk.normal);
  let f = model.faceAt(id, pk.point, n), owner = id;
  if (!(f && f.off < 1e-3)) { const g = root !== id ? model.faceAt(root, pk.point, n) : null; if (g && g.off < 1e-3) { f = g; owner = root; } else f = null; }
  if (!f) {
    /* a round face: sketch on it unrolled, then wrap the result round it */
    const cyl = model.cylinderAt(id, pk.point, n);
    if (cyl) {
      const tid = cyl.primitive ? cyl.id : rootOf(id), nr = V.norm(V.sub(n, V.mul(cyl.axis, V.dot(n, cyl.axis)))), O = model.result.originPoint, name = model.get(tid).name;
      views.setFaceView(nr, `ON ${name.toUpperCase()} · ROUND FACE R${fmt(cyl.radius)} (UNROLLED)`, V.sub(pk.point, O), cyl.axis);
      const on = { id: tid, root: rootOf(tid), n: nr, point: pk.point, pane: 'face', conn: null, faceName: `round face R${fmt(cyl.radius)}`, name, gridAt: V.sub(pk.point, O), wrap: cyl };
      const prevLayout = views.layout; setTool('sketch', { on, prevLayout }); views.layout = 'face'; views.draw();
      toast(`Sketching on the round face of ${name}: draw it unrolled — it is wrapped round when you finish`, 3000);
      return true;
    }
    /* any other curved face (a sphere, a cone, a loft, a fillet…): sketch on the plane touching it there, then project onto it */
    if (model.bodyContaining(id)) {
      const tid = rootOf(id), O = model.result.originPoint, name = model.get(tid).name;
      views.setFaceView(n, `ON ${name.toUpperCase()} · CURVED FACE (PROJECTED)`, V.sub(pk.point, O));
      const on = { id: tid, root: tid, n, point: pk.point, pane: 'face', conn: null, faceName: 'curved face', name, gridAt: V.sub(pk.point, O), drape: true };
      const prevLayout = views.layout; setTool('sketch', { on, prevLayout }); views.layout = 'face'; views.draw();
      toast(`Sketching on the curved face of ${name}: draw it on the plane touching it — it is projected onto the surface when you finish`, 3200);
      return true;
    }
  }
  const name = model.get(owner).name, faceName = f ? (f.face === 'plane' ? 'plane' : f.face.replace(/^face:/, '') + ' face') : 'face';
  const O = model.result.originPoint, centre = V.sub(f && o.type !== 'plane' ? f.conn.o : pk.point, O);
  views.setFaceView(n, `ON ${name.toUpperCase()} · ${faceName.toUpperCase()}`, centre);
  const plane = model.get(owner).type === 'plane', joinTo = plane ? (model.get(owner).mate && model.get(owner).mate.to && model.bodyContaining(model.get(owner).mate.to) ? rootOf(model.get(owner).mate.to) : null) : root;
  const on = { id: owner, root: joinTo, n, point: pk.point, pane: 'face', conn: f ? f.conn : null, faceName, name, gridAt: centre };
  const prevLayout = views.layout; setTool('sketch', { on, prevLayout }); views.layout = 'face'; views.draw();
  toast(`Sketching on ${name} — the view is square to the ${faceName}. View menu → 4 views to see the rest`, 2600);
  return true;
}
/* a sketch on a round face: wrap it round and emboss (join) or engrave (cut). Its coordinates are measured from the
   point clicked: across = round the face, up = along its axis */
function wrapActions(d, geo, label) {
  const on = d.on, { P2 } = sk2(d), c = P2(V.sub(on.point, model.result.originPoint)), rel = (q) => [+(q[0] - c[0]).toFixed(5), +(q[1] - c[1]).toFixed(5)];
  const g = { profile: geo.profile.map(rel), arcs: (geo.arcs || []).map(a => ({ i: a.i, c: rel(a.c), ccw: a.ccw })), splines: (geo.splines || []).map(q => ({ i: q.i, pts: q.pts.map(rel) })) };
  const proj = !!on.drape, extra = proj ? { project: true, xdir: sk2(d).B.r } : {};
  const go = (mode) => (v) => { try { const r = apply([Object.assign({ op: 'wrap', target: on.id, at: on.point, normal: on.n, depth: Number.isFinite(v.depth) && v.depth > 0 ? v.depth : 1, mode }, extra, g)], `${label} ${proj ? 'projected' : 'wrapped'} (${mode})`)[0]; select(r.id); setTool(null); } catch (e) { /* toast shown */ } };
  if (proj) hint(`${label} on ${on.name} (${on.faceName}) — project it onto the surface:`, [['Project · emboss', go('emboss')], ['Project · engrave', go('engrave')]], [['depth', 'depth mm', 1]]);
  else hint(`${label} on ${on.name} (${on.faceName}) — wrap it round the face:`, [['Wrap · emboss', go('emboss')], ['Wrap · engrave', go('engrave')]], [['depth', 'depth mm', 1]]);
  tool.step = 9;
}
/* the choices for a profile on a face: join it to the part, cut it in, cut through, or make a new part there */
function faceActions(d, label, build, extraFields) {
  const on = d.on, ok = (v, dflt) => (Number.isFinite(v) && v > 0 ? v : dflt), rootName = on.root ? (model.get(on.root) || {}).name : null;
  const go = (kind, v) => {
    const cut = kind === 'cut' || kind === 'through', P = build(cut, v);
    const op = Object.assign(P.op, { length: ok(v.length, 10), draft: Number.isFinite(v.draft) ? v.draft : 0, name: `${label} ${kind === 'boss' ? 'boss' : kind === 'part' ? '' : 'cut'}`.trim() }, kind === 'through' ? { end: 'through' } : {},
      P.place.mate ? { mate: P.place.mate } : { at: P.place.pose.at, rot: P.place.pose.rot, fixed: true }, kind === 'part' ? {} : { into: on.root, mode: cut ? 'subtract' : 'union' });
    try { const r = apply([op], `${label} ${kind === 'boss' ? 'joined to' : kind === 'part' ? 'on' : 'cut into'} ${rootName || on.name}`)[0]; select(r.id); setTool(null); } catch (e) { /* toast shown */ }
  };
  const acts = on.root ? [['Extrude · join to ' + rootName, (v) => go('boss', v)], ['Cut into ' + rootName, (v) => go('cut', v)], ['Cut through', (v) => go('through', v)]] : [];
  return acts.concat([['New part', (v) => go('part', v)]]);
}
function shapeFrom(mode, a, b) {
  if (mode === 'rect') return { shape: 'rect', x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), radius: 0 };
  if (mode === 'circle') return { shape: 'circle', x: a[0], y: a[1], diameter: 2 * Math.hypot(b[0] - a[0], b[1] - a[1]) };
  if (mode === 'polygon') return { shape: 'polygon', x: a[0], y: a[1], diameter: 2 * Math.hypot(b[0] - a[0], b[1] - a[1]), sides: prefs.sides || 6 };
  if (mode === 'slot') { const h = prefs.slotW || 10; return { shape: 'slot', x: (a[0] + b[0]) / 2, y: a[1], width: Math.abs(b[0] - a[0]) + h, height: h }; }
  return null;
}
function shapePoints3(spec, B) { try { return shapeProfile(spec).map(([x, y]) => V.add(V.mul(B.r, x), V.mul(B.u, y))); } catch (e) { return []; } }
function finishShape(spec) {
  const d = tool.data, B = d.basis, pts2 = shapeProfile(spec);
  views.preview = { pane: d.pane, points: shapePoints3(spec, B), closed: true }; views.draw();
  const R = model.result, frame = M4.mul(M4.translate(R.originPoint), [B.r[0], B.r[1], B.r[2], 0, B.u[0], B.u[1], B.u[2], 0, B.f[0], B.f[1], B.f[2], 0, 0, 0, 0, 1]), pose = poseFromMatrix(frame);
  const ok = (v, dflt) => (Number.isFinite(v) ? v : dflt), name = { rect: 'Rectangle', circle: 'Circle', slot: 'Slot', polygon: 'Polygon' }[spec.shape];
  const sizeText = `${name} ${spec.shape === 'rect' || spec.shape === 'slot' ? fmt(spec.width) + ' × ' + fmt(spec.height) : 'Ø' + fmt(spec.diameter)}`;
  if (d.on && (d.on.wrap || d.on.drape)) { wrapActions(d, { profile: shapePoints3(spec, B).map(q => [V.dot(q, B.r), V.dot(q, B.u)]) }, name); return; }
  if (d.on) {
    /* on a face: the shape's sizes stay parameters; its centre goes where it was drawn, on that face */
    const centre3 = V.add(V.mul(B.r, spec.x), V.mul(B.u, spec.y)), local = Object.assign({}, spec, { x: 0, y: 0 });
    hint(`${sizeText} on ${d.on.name} (${d.on.faceName}) — its sizes stay editable dimensions:`, faceActions(d, name, (cut) => ({ place: onFace(d, [centre3], cut, centre3), op: Object.assign({ op: 'extrude' }, local) })), [['length', 'height / depth mm', 10], ['draft', 'draft °', 0]]);
    tool.step = 9; return;
  }
  /* the part under the shape (for Cut): pick through the shape's centre in that view */
  const pane = views.panes().find(q => q.id === d.pane), cs = views.project(pane, V.add(V.mul(B.r, spec.x), V.mul(B.u, spec.y))), under = views.pick(pane, cs.x, cs.y), target = under && model.resolveId(under.id);
  const actions = [['Extrude', (v) => { const L = ok(v.length, 10); const r = apply([Object.assign({ op: 'extrude', at: pose.at, rot: pose.rot, fixed: true, length: L, end: v.end === 'symmetric' ? 'symmetric' : 'blind', draft: ok(v.draft, 0), profile: pts2 }, spec)], `${name} extrude`)[0]; select(r.id); setTool(null); }]];
  if (target && !(R.virtual && R.virtual.has(under.id))) actions.push(['Cut through ' + (model.get(target) || {}).name, () => {
    const body = model.bodyContaining(target), bb = body.solid.bbox(), corners = []; for (const x of [bb.min[0], bb.max[0]]) for (const y of [bb.min[1], bb.max[1]]) for (const z of [bb.min[2], bb.max[2]]) corners.push(V.dot(V.sub([x, y, z], R.originPoint), B.f));
    const f0 = Math.min(...corners) - 1, f1 = Math.max(...corners) + 1, at = V.add(pose.at, V.mul(B.f, f0));
    const r = apply([Object.assign({ op: 'extrude', at, rot: pose.rot, fixed: true, length: f1 - f0, profile: pts2, into: body.id, mode: 'subtract', name: `${name} cut` }, spec)], `${name} cut through ${body.name}`)[0]; select(r.id); setTool(null);
  }]);
  actions.push(['Revolve', (v) => { const revFrame = M4.mul(M4.translate(R.originPoint), M4.frame([0, 0, 0], B.r, B.u)), rp = poseFromMatrix(revFrame); const r = apply([{ op: 'revolve', profile: pts2.map(([x, y]) => [Math.abs(x), y]), degrees: ok(v.degrees, 360), at: rp.at, rot: rp.rot, fixed: true }])[0]; select(r.id); setTool(null); }]);
  actions.push(['Back', () => { tool.step = 0; d.points = []; views.preview = null; sketchHint(); views.draw(); }]);
  hint(`${sizeText} — its sizes stay editable dimensions:`, actions, [['length', 'length', 10], ['end', 'direction', 'blind', ['blind', 'symmetric']], ['draft', 'draft °', 0], ['degrees', 'revolve °', 360]]);
  tool.step = 9;
}
/* the sketch's points and arcs in the view's 2D coordinates, and the constraints a fresh sketch gets */
function sketchData(d, open) {
  const { P2 } = sk2(d), pts2 = d.points.map(P2), arcs2 = d.arcs.map(a => ({ i: a.i, c: P2(a.c), ccw: a.ccw })), spl2 = (d.splines || []).map(q => ({ i: q.i, pts: q.pts.map(P2) }));
  const cons = autoConstraints(pts2, 4, arcs2.concat(spl2), open).concat(d.tangents.map(([i, j]) => ({ type: 'tangent', i, j })));
  return { pts2, arcs2, spl2, cons };
}
function finishSketch() {
  const d = tool.data; if (!d.points || d.points.length < ((d.arcs && d.arcs.length) || (d.splines && d.splines.length) ? 2 : 3)) { toast('A closed profile needs at least 3 points (or 2 with an arc or spline)'); return; }
  const B = d.basis, { pts2, arcs2, spl2, cons } = sketchData(d, false);
  views.preview = { pane: d.pane, points: sketchPath(d, true), closed: true }; views.draw();
  if (d.on && (d.on.wrap || d.on.drape)) { wrapActions(d, { profile: pts2, arcs: arcs2, splines: spl2 }, 'Sketch'); return; }
  const R = model.result, frame = M4.mul(M4.translate(R.originPoint), [B.r[0], B.r[1], B.r[2], 0, B.u[0], B.u[1], B.u[2], 0, B.f[0], B.f[1], B.f[2], 0, 0, 0, 0, 1]);
  const pose = poseFromMatrix(frame), revFrame = M4.mul(M4.translate(R.originPoint), M4.frame([0, 0, 0], B.r, B.u)), revPose = poseFromMatrix(revFrame);
  /* a fresh sketch gets horizontal / vertical constraints where it nearly is (not on its arcs), its first point fixed, and its tangent arcs tangent (edit them in Properties → Sketch) */
  const make = (op, extra) => { const prof = (extra && extra.profile) || pts2; const r = apply([Object.assign({ op, profile: prof, arcs: (extra && extra.arcs) || arcs2, splines: spl2, constraints: cons, at: (op === 'revolve' ? revPose : pose).at, rot: (op === 'revolve' ? revPose : pose).rot, fixed: true }, extra)])[0]; pendingLoft = null; select(r.id); setTool(null); };
  const ok = (v, dflt) => (Number.isFinite(v) ? v : dflt);
  if (pendingLoft) {
    if (pendingLoft.pane !== d.pane) toast('End profile was drawn in another view — it is used flat in the ' + pendingLoft.pane.toUpperCase() + ' view');
    const first = pendingLoft, end2 = expandArcs(pts2, arcs2).pts;
    hint('Loft between the two profiles (' + first.pts2.length + ' → ' + end2.length + ' points):', [
      ['Loft', (v) => { const L = ok(v.length, 30); if (L) { const r = apply([{ op: 'loft', profile: first.pts2, arcs: first.arcs2, profile2: end2, length: L, twist: ok(v.twist, 0), at: first.pose.at, rot: first.pose.rot, fixed: true }])[0]; pendingLoft = null; select(r.id); setTool(null); } }]
    ], [['length', 'length', 30], ['twist', 'twist °', 0]]);
    tool.step = 9; return;
  }
  if (d.on) {
    hint(`Profile on ${d.on.name} (${d.on.faceName}), ${pts2.length} points${d.arcs.length ? ', ' + d.arcs.length + ' arc' + (d.arcs.length > 1 ? 's' : '') : ''}:`, faceActions(d, 'Extrude', (cut) => { const place = onFace(d, d.points, cut, null, d.arcs, d.splines); return { place, op: { op: 'extrude', profile: place.prof, arcs: place.arcs, splines: place.splines, constraints: autoConstraints(place.prof, 4, place.arcs.concat(place.splines)).concat(d.tangents.map(([i, j]) => ({ type: 'tangent', i, j }))) } }; }), [['length', 'height / depth mm', 10], ['draft', 'draft °', 0]]);
    tool.step = 9; return;
  }
  hint('Profile closed (' + pts2.length + ' points' + (arcs2.length ? ', ' + arcs2.length + ' arc' + (arcs2.length > 1 ? 's' : '') : '') + ') — make it 3D:', [
    ['Extrude', (v) => { const L = ok(v.length, 20); if (L) make('extrude', { length: L, end: v.end === 'symmetric' ? 'symmetric' : 'blind', draft: ok(v.draft, 0), twist: ok(v.twist, 0), scale: ok(v.scale, 1) || 1 }); }],
    ['Revolve', (v) => { const dg = ok(v.degrees, 360); if (dg) make('revolve', { profile: pts2.map(([x, y]) => [Math.abs(x), y]), arcs: arcs2.map(a => ({ i: a.i, c: [Math.abs(a.c[0]), a.c[1]], ccw: a.c[0] < 0 ? !a.ccw : a.ccw })), degrees: dg }); }],
    ['Loft → end profile', (v) => { pendingLoft = { pts2, arcs2, pose, pane: d.pane }; const keep = pendingLoft; setTool('sketch', true); pendingLoft = keep; tool.data.pane = keep.pane; tool.data.basis = BASISof(keep.pane); sketchHint(); }]
  ], [['length', 'length', 20], ['end', 'direction', 'blind', ['blind', 'symmetric']], ['draft', 'draft °', 0], ['twist', 'twist °', 0], ['scale', 'end scale', 1], ['degrees', 'revolve °', 360]]);
  tool.step = 9;
}
/* an open outline: a rib or thin wall of a thickness, extruded (joined to a face's part, cut, or a new part) */
function finishOpen() {
  const d = tool.data; if (!d.points || d.points.length < 2) { toast('An open profile needs at least 2 points'); return; }
  if (d.on && (d.on.wrap || d.on.drape)) { toast(d.on.drape ? 'On a curved face, close the outline: it is projected onto it and embossed or engraved' : 'On a round face, close the outline: it is wrapped round and embossed or engraved'); return; }
  const B = d.basis, { pts2, arcs2, spl2, cons } = sketchData(d, true), ok = (v, dflt) => (Number.isFinite(v) && v > 0 ? v : dflt);
  views.preview = { pane: d.pane, points: sketchPath(d, false) }; views.draw();
  const fields = [['thin', 'thickness mm', prefs.ribT || 3], ['length', 'height mm', 10]];
  if (d.on) {
    hint(`Open profile on ${d.on.name} (${d.on.faceName}) — a rib or thin wall:`, faceActions(d, 'Rib', (cut, v) => { const place = onFace(d, d.points, cut, null, d.arcs, d.splines); prefs.ribT = ok(v.thin, 3); savePrefs(); return { place, op: { op: 'extrude', profile: place.prof, arcs: place.arcs, splines: place.splines, open: true, thin: ok(v.thin, 3), constraints: autoConstraints(place.prof, 4, place.arcs, true) } }; }), fields);
    tool.step = 9; return;
  }
  const R = model.result, frame = M4.mul(M4.translate(R.originPoint), [B.r[0], B.r[1], B.r[2], 0, B.u[0], B.u[1], B.u[2], 0, B.f[0], B.f[1], B.f[2], 0, 0, 0, 0, 1]), pose = poseFromMatrix(frame);
  hint(`Open profile (${pts2.length} points) — a thin wall:`, [['Extrude thin', (v) => { prefs.ribT = ok(v.thin, 3); savePrefs(); const r = apply([{ op: 'extrude', name: 'Thin wall', profile: pts2, arcs: arcs2, splines: spl2, open: true, thin: ok(v.thin, 3), length: ok(v.length, 10), end: v.end === 'symmetric' ? 'symmetric' : 'blind', constraints: cons, at: pose.at, rot: pose.rot, fixed: true }])[0]; select(r.id); setTool(null); }]], fields.concat([['end', 'direction', 'blind', ['blind', 'symmetric']]]));
  tool.step = 9;
}

/* ---------- pointer ---------- */
const stage = $('#stage');
let drag = null;
stage.addEventListener('contextmenu', e => e.preventDefault());
stage.addEventListener('pointerdown', (e) => {
  if (e.target !== $('#gl') && e.target !== stage) return;
  const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, pane = views.paneAt(x, y); if (!pane) return;
  stage.setPointerCapture(e.pointerId);
  const hit = views.hitOverlay(x, y);
  if (hit && hit.kind === 'cube') { views.setCubeView(hit.dir); return; }
  drag = { x, y, x0: x, y0: y, pane, button: e.button, moved: false, orbit: pane.id === '3d' && e.button === 0 && !e.shiftKey && !(tool && tool.name !== 'mate' && !tool.name.startsWith('bool') ) };
});
stage.addEventListener('pointermove', (e) => {
  const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (drag) {
    const dx = x - drag.x, dy = y - drag.y; drag.x = x; drag.y = y; if (Math.hypot(x - drag.x0, y - drag.y0) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.pane.id === '3d') { const alt = drag.button === 2 || drag.button === 1 || e.shiftKey; if (alt !== (prefs.drag3d === 'pan')) views.pan3d(drag.pane, dx, dy); else views.orbit(dx, dy); }
    else views.panOrtho(drag.pane, dx, dy);
    return;
  }
  const pane = views.paneAt(x, y); if (!pane) return;
  const h = views.hitOverlay(x, y);
  views.hover = h ? { conn: h.kind === 'conn' ? h.conn : null, cube: h.kind === 'cube' && h.name ? h.name : null, cubeDir: h.kind === 'cube' && !h.name ? h.dir : null } : null;
  if (tool && tool.name === 'sketch' && pane.id !== '3d' && tool.step < 9) {
    const d = tool.data, want = d.on ? d.on.pane : d.pane;
    const pp = views.planePoint(pane, x, y); if (!pp) return;
    if (want && want !== pane.id) { if (views.preview) views.preview.snap = null; views.draw(); return; }
    const { p, snap } = snapSketch(pane, pp, e.shiftKey), B = BASISof(pane.id), P2 = (q) => [V.dot(q, B.r), V.dot(q, B.u)];
    if (!d.basis) d.basis = B;
    if (d.mode && d.mode !== 'polyline' && d.points.length === 1) { const spec = shapeFrom(d.mode, P2(d.points[0]), P2(p)); views.preview = { pane: pane.id, points: shapePoints3(spec, B), closed: true, snap }; }
    else if (d.seg === 'arc' && d.arcEnd && d.points.length) { const arc = arcTo(d, d.arcEnd, p); views.preview = { pane: pane.id, points: sketchPath(d, false, { p: d.arcEnd, arc }), snap }; }
    else if (d.seg === 'tarc' && d.points.length >= 2) { const arc = arcTo(d, p, null); views.preview = { pane: pane.id, points: arc ? sketchPath(d, false, { p, arc }) : sketchPath(d), cursor: arc ? null : p, snap }; }
    else if (d.seg === 'spline' && d.points.length) views.preview = { pane: pane.id, points: sketchPath(d, false, { p }), snap };
    else views.preview = { pane: pane.id, points: sketchPath(d), cursor: d.seg === 'arc' && d.points.length ? null : p, snap };
  }
  stage.style.cursor = h && (h.kind === 'dim' || h.kind === 'conn' || h.kind === 'cube') ? 'pointer' : tool ? 'crosshair' : 'default';
  views.draw();
});
stage.addEventListener('pointerup', (e) => {
  const d = drag; drag = null; if (!d || d.moved) return;
  const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, pane = d.pane;
  const hit = views.hitOverlay(x, y);
  if (hit && hit.kind === 'plane' && tool && tool.name === 'sketch-face') { const pc = worldConnectors(model.result, hit.id).find(c => c.name === 'plane'); if (pc) startFaceSketch({ id: hit.id, point: pc.o, normal: pc.n }); return; }
  if (hit && hit.kind === 'plane' && !tool) { select(hit.id); return; }
  if (hit && hit.kind === 'dim' && !tool) { editDim(hit, x, y); return; }
  if (hit && hit.kind === 'measure' && !tool) { dimOptions(hit, x, y); return; }
  if (!tool) { const pk = views.pick(pane, x, y); select(pk ? pk.id : null); return; }
  clickTool(pane, x, y, hit, e);
});
stage.addEventListener('wheel', (e) => {
  e.preventDefault(); const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, pane = views.paneAt(x, y); if (!pane) return;
  const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
  if (pane.id === '3d') views.zoom3d(k); else views.zoomOrtho(pane, x, y, k);
}, { passive: false });
stage.addEventListener('dblclick', (e) => { const r = stage.getBoundingClientRect(), pane = views.paneAt(e.clientX - r.left, e.clientY - r.top); if (!pane || tool) return; views.layout = views.layout === '4' ? pane.id : '4'; views.draw(); });
function confirmRemove(hit) { if (!hit.measure) return false; apply([{ op: 'undim', id: hit.measure.id }]); toast('Measurement removed (Undo to restore)'); return true; }
/* a measured dimension: type a value to drive it, or change how it measures */
function dimOptions(hit, x, y) {
  const md = hit.measure, axis = (a) => () => { apply([{ op: 'dimaxis', id: md.id, axis: a }]); hint(null); };
  hint(`Dimension ${fmt(hit.value)} · ${md.drive != null ? 'driving: it holds ' + model.get(md.b.obj).name + ' / ' + model.get(md.a.obj).name + ' at this distance' : 'reference — type a value to make it drive'}`, [
    ['Set', (v) => { if (v.value >= 0) { try { apply([{ op: 'setdim', id: md.id, value: v.value }]); } catch (e) { /* toast */ } hint(null); } }],
    ['Off edge ⊥', axis('normal')], ['Horizontal', axis('h')], ['Vertical', axis('v')], ['Aligned', axis('aligned')],
    md.drive != null ? ['Reference', () => { apply([{ op: 'setdim', id: md.id, value: null }]); hint(null); }] : null,
    ['Delete', () => { confirmRemove(hit); hint(null); }]
  ].filter(Boolean), [['value', 'mm', +fmt(hit.value)]]);
}
function BASISof(id) { if (id === 'face') return views.basisOf('face'); return { front: { r: [1, 0, 0], u: [0, 0, 1], f: [0, -1, 0] }, top: { r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] }, right: { r: [0, 1, 0], u: [0, 0, 1], f: [1, 0, 0] } }[id]; }
function clickTool(pane, x, y, hit, e) {
  const t = tool, R = model.result;
  if (t.name === 'sketch') {
    if (t.step >= 9) return;
    if (pane.id === '3d') { toast(t.data.on ? `Draw this sketch in the ${t.data.on.pane.toUpperCase()} view` : 'Sketch in FRONT, TOP or RIGHT — or use On a face… to sketch on a part'); return; }
    const d = t.data, want = d.on ? d.on.pane : d.pane;
    if (want && want !== pane.id) { toast(d.on ? `This sketch is on ${d.on.name}: draw it in the ${want.toUpperCase()} view` : 'Keep the whole profile in one view'); return; }
    const pp = views.planePoint(pane, x, y), { p } = snapSketch(pane, pp, e.shiftKey);
    d.pane = pane.id; d.basis = BASISof(pane.id); d.hist = d.hist || []; d.arcs = d.arcs || []; d.tangents = d.tangents || [];
    const B = d.basis, P2 = (q) => [V.dot(q, B.r), V.dot(q, B.u)];
    if (d.mode && d.mode !== 'polyline') {
      if (!d.points.length) { d.points.push(p); views.preview = { pane: pane.id, points: [p] }; sketchHint(); views.draw(); return; }
      const spec = shapeFrom(d.mode, P2(d.points[0]), P2(p));
      if (!spec || (spec.width === 0 || spec.height === 0 || spec.diameter === 0)) { toast('Drag it out a little bigger'); return; }
      try { shapeProfile(spec); } catch (err) { toast(err.message); return; }
      finishShape(spec); return;
    }
    const closes = (q) => d.points.length >= 2 && V.len(V.sub(d.points[0], q)) < 1e-6;
    const addArc = (end, arc, tangentTo) => {
      if (!arc) { toast('Those points are in a line — that is a straight segment'); return; }
      pushHist(d); d.arcs.push(arc); if (tangentTo != null) d.tangents.push([tangentTo, arc.i]);
      if (closes(end)) { if (d.points.length >= 2) { finishSketch(); return; } }
      d.points.push(end); d.arcEnd = null; views.preview = { pane: pane.id, points: sketchPath(d) }; sketchHint(); views.draw();
    };
    if (d.seg === 'arc' && d.points.length) {
      if (!d.arcEnd) { d.arcEnd = p; sketchHint(); views.draw(); return; }
      const end = d.arcEnd; addArc(end, arcTo(d, end, p), null); return;
    }
    if (d.seg === 'spline') {
      if (!d.points.length) { pushHist(d); d.points.push(p); views.preview = { pane: pane.id, points: [p] }; sketchHint(); views.draw(); return; }
      /* clicking the first point closes the outline with this spline */
      const f0 = views.project(pane, d.points[0]);
      if (d.points.length + d.spl.length >= 2 && Math.hypot(f0.x - x, f0.y - y) < 10) { pushHist(d); d.spl.push(d.points[0]); if (commitSpline(d)) { finishSketch(); return; } }
      pushHist(d); d.spl.push(p); views.preview = { pane: pane.id, points: sketchPath(d) }; sketchHint(); views.draw(); return;
    }
    if (d.seg === 'tarc') {
      if (d.points.length < 2) { if (!d.points.length) { pushHist(d); d.points.push(p); views.preview = { pane: pane.id, points: [p] }; } toast('Tangent arc: draw a line first — the arc carries on from its end'); sketchHint(); views.draw(); return; }
      addArc(p, arcTo(d, p, null), d.points.length - 2); return;
    }
    if (d.points.length >= 3) { const f = views.project(pane, d.points[0]); if (Math.hypot(f.x - x, f.y - y) < 10) { finishSketch(); return; } }
    pushHist(d); d.points.push(p); views.preview = { pane: pane.id, points: sketchPath(d) }; sketchHint(); views.draw(); return;
  }
  if (t.name === 'sketch-face') {
    const pk = views.pick(pane, x, y); if (!pk) { toast('Click on a flat face of a part'); return; }
    if (R.virtual && R.virtual.has(pk.id)) { toast('That is a pattern copy: sketch on the original'); return; }
    startFaceSketch({ id: model.resolveId(pk.id), point: pk.point, normal: pk.normal }, t.data.only); return;
  }
  if (t.name === 'plane') {
    const pk = views.pick(pane, x, y); if (!pk) { toast('Click on a flat face of a part'); return; }
    const id = model.resolveId(pk.id), f = hintValues();
    try { const r = apply([{ op: 'plane', target: id, at: pk.point, normal: pk.normal, offset: f.offset || 0, tilt: f.tilt || 0 }])[0]; setTool(null); select(r.id); toast(`${r.name} made — Sketch on it or Split a part with it (Properties)`, 2400); } catch (e) { /* toast shown */ }
    return;
  }
  if (t.name === 'split') {
    const pk = views.pick(pane, x, y); if (!pk) { toast('Click on the part to cut'); return; }
    const id = model.resolveId(pk.id); setTool(null); splitHint(rootOf(id), selected && (model.get(selected) || {}).type === 'plane' ? selected : null); return;
  }
  if (t.name === 'pick') {
    const pk = views.pick(pane, x, y); if (!pk) { toast('Click on a part'); return; }
    const id = model.resolveId(pk.id), then = t.data.then; setTool(null); if (id) then(id); return;
  }
  if (t.name === 'boss' || t.name === 'cut') {
    const pk = views.pick(pane, x, y); if (!pk) { toast('Click on a flat face of a part'); return; }
    const id = model.resolveId(pk.id); if (!id || (R.virtual && R.virtual.has(pk.id))) { toast('That is a pattern copy: put it on the original'); return; }
    if (t.data.only && ((model.bodyContaining(id) || {}).id || id) !== t.data.only) { toast(`Click a face of ${model.get(t.data.only).name}`); return; }
    const f = hintValues(), shape = f.shape || 'cylinder', params = shape === 'box' ? { width: f.width || 10, depth: f.depth || 10, height: f.height || 5 } : { diameter: f.diameter || 10, height: f.height || 5 };
    const snap = (v) => Math.round(v * 2) / 2, O = R.originPoint, at = V.add(V.sub(pk.point, O).map(snap), O);
    try { const r = apply([{ op: 'feature', target: id, at, normal: pk.normal, shape, params, mode: t.name }])[0]; views.sel = r.id; renderTree(); views.draw(); toast(`${r.name} placed — click another face for one more, or Done. Its size and slide x / y are in Properties`, 2600); } catch (e) { /* toast shown */ }
    return;
  }
  if (t.name === 'mate') {
    if (t.step === 0) { const pk = views.pick(pane, x, y); if (!pk) return; const id = rootOrSelf(pk.id); t.data.moving = id; t.step = 1; views.connectorsFor = id; hint('Mate: click the connector on ' + model.get(id).name + ' to attach'); views.draw(); return; }
    if (!hit || hit.kind !== 'conn') { toast('Click one of the coloured connector dots'); return; }
    if (t.step === 1) { if (hit.conn.id !== t.data.moving) return; t.data.b = hit.conn.name; t.step = 2; views.connectorsFor = 'all'; hint(`Mate: now click where ${model.get(t.data.moving).name} · ${hit.conn.name} should go`); views.draw(); return; }
    if (t.step === 2) { if (hit.conn.id === t.data.moving) return; const r = apply([{ op: 'mate', id: t.data.moving, to: hit.conn.id, a: hit.conn.name, b: t.data.b }]); select(t.data.moving); setTool(null); toast('Mated · adjust gap / angle / slide in Properties', 1800); void r; return; }
  }
  if (t.name.startsWith('bool-')) {
    const pk = views.pick(pane, x, y); if (!pk) return; const id = pk.id;
    if (t.step === 0) { t.data.target = id; t.step = 1; select(id); hint('Now click the tool body (it will be ' + (t.name === 'bool-add' ? 'merged into' : t.name === 'bool-subtract' ? 'cut from' : 'intersected with') + ' ' + model.get(id).name + ')'); return; }
    if (id === t.data.target) return;
    apply([{ op: 'boolean', target: t.data.target, tool: id, mode: t.name.slice(5) }]); select(t.data.target); setTool(null); return;
  }
  if (t.name.startsWith('edge-')) {
    const pk = views.pick(pane, x, y); if (!pk) { toast('Click on a part, close to the edge'); return; }
    if (R.virtual && R.virtual.has(pk.id)) { toast('That is a pattern copy: change the original and every copy follows'); return; }
    const style = t.name.slice(5), own = nearestEdgePoint(pk), ownD = V.len(V.sub(own, pk.point)), seam = seamNear(pk);
    const onSeam = seam && seam.dist <= ownD + 0.5;
    try {
      if (style === 'weld') {
        if (!onSeam) { toast('A weld joins two separate parts: click where two parts meet. Inside one part, use Fillet (it blends the part).', 3200); return; }
        const r = apply([{ op: 'weld', a: pk.id, b: seam.other, near: seam.point, size: prefs.weldSize || 4, profile: prefs.weldProfile || 'flat' }], `Weld ${model.get(pk.id).name} to ${model.get(seam.other).name}`)[0];
        toast(r.material_advice ? `Welded, but: ${r.material_advice}` : `Welded: ${fmt(r.length)} mm seam${r.round ? ' (round)' : ''} — the parts stay separate${r.other_seams ? ` · ${r.other_seams} more seam${r.other_seams > 1 ? 's' : ''}: tick “all around” in Properties` : ''}`, r.material_advice ? 4200 : 2600); select(r.id);
        return;
      }
      if (onSeam) {
        const A = model.get(pk.id), B = model.get(seam.other);
        const r = apply([{ op: 'boolean', target: A.id, tool: B.id, mode: 'add' }, { op: 'edge', target: A.id, near: seam.point, style, size: prefs.edgeSize || 4 }], `${style === 'chamfer' ? 'Chamfer' : 'Fillet'} merges ${B.name} into ${A.name}`)[1];
        toast(`${B.name} is now part of ${A.name} (one piece) and the corner is ${style === 'chamfer' ? 'chamfered' : 'filleted'}. To keep them separate, Undo and use Weld.`, 3600); select(r.id);
        return;
      }
      const r = apply([{ op: 'edge', target: pk.id, near: own, style, size: prefs.edgeSize || 4 }])[0];
      toast(`${r.convex ? 'Outer edge → trimmed' : 'Inner corner → filled'} (${r.angle}°)${r.round ? ' · all the way round Ø' + fmt(r.round.diameter) : ''}`, 2000); select(r.id);
    } catch (err) { /* toast shown */ }
    return;
  }
  if (t.name === 'text') {
    const pk = views.pick(pane, x, y); if (!pk) { toast('Click on a flat face of a part'); return; }
    const id = model.resolveId(pk.id); if (!id || (model.result.virtual && model.result.virtual.has(pk.id))) { toast('That is a pattern copy: put the text on the original'); return; }
    if (t.data.only && rootOf(id) !== t.data.only) { toast(`Click a face of ${model.get(t.data.only).name}`); return; }
    const f = Object.fromEntries([...document.querySelectorAll('#hint [data-k]')].map(i => [i.dataset.k, i.dataset.str || i.tagName === 'SELECT' ? i.value : parseFloat(i.value)]));
    const snap = (v) => Math.round(v * 2) / 2, at = V.add(V.sub(pk.point, R.originPoint).map(snap), R.originPoint);
    const flatHere = (() => { const g = model.faceAt(id, pk.point, pk.normal); return g && g.off < 1e-3; })(), cyl = !flatHere && model.cylinderAt(id, pk.point, pk.normal);
    if (cyl) {
      try { const r = apply([{ op: 'wrap', target: cyl.primitive ? cyl.id : id, at: pk.point, normal: pk.normal, text: f.text || 'TEXT', size: f.height || 8, depth: f.depth || 1, mode: f.mode === 'engrave' ? 'engrave' : 'emboss' }])[0]; setTool(null); select(r.id); toast(`Text wrapped round the face (${f.mode === 'engrave' ? 'engraved' : 'embossed'}) — edit it in Properties`, 2400); } catch (e) { /* toast shown */ }
      return;
    }
    if (!flatHere) {
      try { const r = apply([{ op: 'wrap', project: true, target: id, at: pk.point, normal: pk.normal, text: f.text || 'TEXT', size: f.height || 8, depth: f.depth || 1, mode: f.mode === 'engrave' ? 'engrave' : 'emboss' }])[0]; setTool(null); select(r.id); toast(`Text projected onto the curved face (${f.mode === 'engrave' ? 'engraved' : 'embossed'}) — edit it in Properties`, 2400); } catch (e) { /* toast shown */ }
      return;
    }
    try {
      const r = apply([{ op: 'text', target: id, at, normal: pk.normal, text: f.text || 'TEXT', height: f.height || 8, depth: f.depth || 1, weight: +((f.height || 8) * 0.12).toFixed(2), mode: f.mode, path: f.path, radius: f.radius }])[0];
      setTool(null); select(r.id); toast(`${f.mode === 'engrave' ? 'Engraved' : 'Embossed'} — edit the words, size, path or radius in Properties`, 2400);
    } catch (e) { /* toast shown */ }
    return;
  }
  if (t.name === 'hole') {
    const pk = views.pick(pane, x, y); if (!pk) { toast('Click on a face of a part'); return; }
    const id = model.resolveId(pk.id); if (!id || (model.result.virtual && model.result.virtual.has(pk.id))) { toast('That is a pattern copy: put the hole on the original'); return; }
    if (t.data.only && rootOf(id) !== t.data.only) { toast(`Click a face of ${model.get(t.data.only).name}`); return; }
    const snap = (v) => Math.round(v * 2) / 2, at = V.add(V.sub(pk.point, R.originPoint).map(snap), R.originPoint), dep = +(prefs.holeDepth || 0);
    try {
      const r = apply([{ op: 'hole', target: id, at, normal: pk.normal, size: prefs.holeSize || 'M6', kind: prefs.holeKind || 'simple', fit: prefs.holeFit || 'normal', through: !(dep > 0), depth: dep > 0 ? dep : undefined, modelled: (prefs.holeKind || 'simple') === 'tapped' && prefs.holeThread === 'modelled' }], `Hole ${prefs.holeSize || 'M6'}`)[0];
      toast(`${r.spec}${r.dims && r.dims.length ? ` — ${r.dims.map(d => fmt(d.value) + ' from ' + d.from).join(', ')}` : ''}. Click a blue dimension to change it.`, 3200);
    } catch (e) { /* toast shown */ }
    return;
  }
  if (t.name === 'measure') {
    if (pane.id === '3d') { toast('Measure in FRONT, TOP or RIGHT'); return; }
    if (!hit || hit.kind !== 'conn') { toast('Click a connector dot'); return; }
    if (!t.data.a) { t.data.a = hit.conn; views.preview = { pane: pane.id, measureA: worldConnectors(R, hit.conn.id).find(c => c.name === hit.conn.name).o }; hint('Measure: now the second connector'); views.draw(); return; }
    const r = apply([{ op: 'dim', a: { obj: t.data.a.id, conn: t.data.a.name }, b: { obj: hit.conn.id, conn: hit.conn.name }, view: pane.id }])[0]; setTool(null);
    const md = model.doc.dims.find(q => q.id === r.id);
    dimOptions({ measure: md, value: r.value }, x, y);
    toast(r.axis === 'normal' ? 'Off-edge dimension (square to the face). Type a value to move the part and hold it there.' : 'Measured. Tip: pick a face dot (middle of an edge in this view) for an off-edge dimension.', 3200);
  }
}
const rootOrSelf = (id) => id;
/* the nearest inside-corner seam between the picked part and another separate part that touches it */
function seamNear(pk) {
  const R = model.result, A = R.bodies.find(b => b.id === pk.id); if (!A || A.weld) return null;
  const ba = A.solid.bbox(), touch = (b) => { const bb = b.solid.bbox(); for (let k = 0; k < 3; k++) if (bb.min[k] > ba.max[k] + 0.5 || bb.max[k] < ba.min[k] - 0.5) return false; return true; };
  let best = null;
  for (const B of R.bodies) {
    if (B.id === A.id || B.weld || B.hidden || B.virtual || !model.get(B.id) || !touch(B)) continue;
    let seams; try { seams = findSeams(A.solid, B.solid).seams; } catch (e) { continue; }
    for (const e of seams) {
      if (e.convex) continue;
      const pts = e.loop ? e.loop.map((q, i) => [q, e.loop[(i + 1) % e.loop.length]]) : [[e.a, e.b]];
      for (const [a, b] of pts) { const ab = V.sub(b, a), tt = Math.max(0, Math.min(1, V.dot(V.sub(pk.point, a), ab) / (V.dot(ab, ab) || 1))), q = V.add(a, V.mul(ab, tt)), d = V.len(V.sub(q, pk.point)); if (!best || d < best.dist) best = { other: B.id, point: q, dist: d }; }
    }
  }
  return best;
}
/* faces a shell can leave open: the part's own face connectors (top, end, …), or none */
function shellOpens(id) {
  const names = worldConnectors(model.result, id).filter(c => c.kind === 'face').map(c => c.name), pref = ['top', 'end', 'bottom', 'start'];
  names.sort((a, b) => (pref.indexOf(a) < 0 ? 9 : pref.indexOf(a)) - (pref.indexOf(b) < 0 ? 9 : pref.indexOf(b)));
  return [...new Set(names), 'none'];
}
function shellHint(o) {
  setTool(null);
  const opens = shellOpens(o.id);
  hint(`Shell ${o.name}: hollow it to a wall thickness`, [['Shell', (v) => { try { const r = apply([{ op: 'shell', target: o.id, thickness: v.thickness, open: v.open }])[0]; hint(null); select(r.id); toast('Shelled — change the wall thickness in Properties any time', 2000); } catch (e) { /* toast shown */ } }]],
    [['thickness', 'wall mm', prefs.shellT || 2], ['open', 'open face', opens[0], opens]]);
}
/* section view: cut the model with a plane; the cut faces show hatched */
function sectionHint() {
  const h = $('#hint'); setTool(null); h.hidden = false; h.innerHTML = '';
  const bbAll = (() => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const b of model.result.bodies) { if (b.solid.isEmpty()) continue; const bb = b.solid.bbox(); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], bb.min[k]); mx[k] = Math.max(mx[k], bb.max[k]); } } return { mn, mx }; })();
  const st = views.section ? Object.assign({}, views.section) : { axis: 'x', flip: false, at: null };
  const k = () => ({ x: 0, y: 1, z: 2 })[st.axis];
  const rng = el('input', { type: 'range', step: 0.5 }), lab = el('span', { class: 'mono' });
  const apply2 = () => { const i = k(), n = [0, 0, 0]; n[i] = st.flip ? -1 : 1; if (st.at == null || st.at < bbAll.mn[i] || st.at > bbAll.mx[i]) st.at = (bbAll.mn[i] + bbAll.mx[i]) / 2; rng.min = bbAll.mn[i]; rng.max = bbAll.mx[i]; rng.value = st.at; lab.textContent = `${st.axis.toUpperCase()} = ${fmt(st.at - model.result.originPoint[i])}`; views.section = { n, d: st.flip ? -st.at : st.at, axis: st.axis, flip: st.flip, at: st.at }; views.draw(); syncBar(); };
  rng.addEventListener('input', () => { st.at = +rng.value; apply2(); });
  const axb = (a) => el('button', { class: 'ax' + (st.axis === a ? ' on' : ''), onclick: () => { st.axis = a; st.at = null; apply2(); h.querySelectorAll('.ax').forEach(b => b.classList.toggle('on', b.textContent === a.toUpperCase())); } }, a.toUpperCase());
  const bx = axb('x'), by = axb('y'), bz = axb('z');
  h.append(el('span', null, 'Section'), bx, by, bz, rng, lab, el('button', { onclick: () => { st.flip = !st.flip; apply2(); } }, 'Flip'), el('button', { onclick: () => { views.section = null; hint(null); views.draw(); syncBar(); } }, 'Off'));
  apply2();
}
function patternHint(id) {
  const o = model.get(id); if (!o) return;
  const root = o.into ? (model.bodyContaining(o.id) || {}).id : null;
  setTool(null);
  const make = (extra) => { try { const r = apply([Object.assign({ op: 'pattern', of: id }, extra)])[0]; hint(null); select(r.id); toast(`${r.copies ? 'Pattern made' : 'Pattern'} · change ${o.name} and every copy follows`, 2000); } catch (e) { /* toast shown */ } };
  hint(`Pattern ${o.name}:`, [
    ['Row → X', (v) => make({ kind: 'linear', count: v.count, spacing: v.spacing, direction: [1, 0, 0] })],
    ['Row → Y', (v) => make({ kind: 'linear', count: v.count, spacing: v.spacing, direction: [0, 1, 0] })],
    ['Grid', (v) => make({ kind: 'linear', count: v.count, spacing: v.spacing, direction: [1, 0, 0], count2: v.count, spacing2: v.spacing, direction2: [0, 1, 0] })],
    ['Circular', (v) => make({ kind: 'circular', count: v.count, angle: v.angle, about: root ? { obj: root, conn: 'center' } : { obj: 'origin', conn: 'xy' } })],
    ['Mirror X', () => make({ kind: 'mirror', plane: 'yz' })], ['Mirror Y', () => make({ kind: 'mirror', plane: 'xz' })]
  ], [['count', 'count', 4], ['spacing', 'spacing mm', Math.round(Math.max(10, (o.params.width || o.params.diameter || 10) * 1.5))], ['angle', 'circle °', 360]]);
}
function bomCSV() {
  const b = bom(model.doc, model.result), q = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = ['item', 'part', 'part_no', 'type', 'material', 'quantity', 'mass_each_g', 'mass_total_g', 'volume_each_cm3', 'size', 'supplier', 'notes'];
  return [head.join(','), ...b.lines.map(L => head.map(k => q(L[k])).join(',')), ['', 'TOTAL', '', '', '', b.lines.reduce((n, L) => n + L.quantity, 0), '', b.total_mass_g, '', '', '', ''].join(',')].join('\n');
}
function nearestEdgePoint(pk) {
  const body = model.bodyContaining(pk.id); if (!body) return pk.point;
  let best = pk.point, bd = Infinity;
  for (const [a, b] of K.creaseEdges(body.solid)) { const ab = V.sub(b, a), t = Math.max(0, Math.min(1, V.dot(V.sub(pk.point, a), ab) / (V.dot(ab, ab) || 1))), q = V.add(a, V.mul(ab, t)), dd = V.len(V.sub(q, pk.point)); if (dd < bd) { bd = dd; best = q; } }
  return best;
}
function editDim(hit, x, y) {
  const ed = $('#dimEd'), linked = hit.ob && hit.ob.expr && hit.ob.expr[hit.param];
  ed.hidden = false; ed.value = linked || fmt(hit.value); ed.style.left = (x - 45) + 'px'; ed.style.top = (y - 14) + 'px'; ed.focus(); ed.select();
  const done = (ok) => {
    ed.hidden = true; ed.onkeydown = null; ed.onblur = null; if (!ok) return;
    if (hit.measure) { const v = parseFloat(ed.value.replace(',', '.')); if (v >= 0) { try { const r = apply([{ op: 'setdim', id: hit.measure.id, value: v }])[0]; toast(`${model.get(r.moved).name} moved: now held at ${fmt(v)} (driving)`, 2200); } catch (e) { /* toast shown */ } } return; }
    if (ed.value.trim() !== (linked || fmt(hit.value))) setParam(hit.ob, hit.param, ed.value);
  };
  ed.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  ed.onblur = () => done(true);
}
window.addEventListener('keydown', (e) => {
  const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? $('#redo').click() : $('#undo').click(); return; }
  if (mod && k === 'y') { e.preventDefault(); $('#redo').click(); return; }
  if (mod && k === 'd' && selected) { e.preventDefault(); try { const r = apply([{ op: 'duplicate', id: selected }])[0]; select(r.id); } catch (err) { /* toast shown */ } return; }
  if (mod) return;
  if (k === 'escape') { setTool(null); select(null); return; }
  if (k === 'enter' && tool && tool.name === 'sketch' && tool.step < 9) { finishSketch(); return; }
  if ((k === 'delete' || k === 'backspace') && selected) { apply([{ op: 'delete', id: selected }]); select(null); return; }
  const map = { b: 'box', w: 'wedge', c: 'cylinder', k: 'cone', o: 'sphere' }; if (map[k]) { addShape(map[k]); return; }
  if (k === 's') setTool('sketch'); if (k === 'm') setTool('mate'); if (k === 'f') views.fitAll(); if (k === 'h') VIEW.hidden(); if (k === 'd') VIEW.dims(); if (k === 'g') setTool('measure'); if (k === 'e') VIEW.explode(); if (k === 'j') $('#motionBtn').click(); if (k === 'x') $('#sectionBtn').click(); if (k === 'i') $('#checkBtn').click(); if (k === 't') setTool('text'); if (k === 'p' && selected) patternHint(selected);
  const lay = { 0: '4', 1: 'front', 2: 'top', 3: 'right', 4: '3d' }[k]; if (lay) VIEW.layout(lay);
});

/* ---------- demo ---------- */
function loadExample(id) {
  const ex = EXAMPLES.find(e => e.id === id);
  model.load(Object.assign(newDoc(ex.doc.name || ex.name), exampleDoc(id)));
  select(null); views.fitAll(); toast(ex.name + ' — ' + ex.blurb, 3600);
}
function demo() {
  model.load(newDoc('Bracket demo'));
  apply([
    { op: 'add', type: 'box', id: 'plate', name: 'Base plate', params: { width: 120, depth: 70, height: 10 }, mate: { to: 'origin', a: 'xy', b: 'bottom' }, meta: { material: 'steel', part_no: 'BR-001' } },
    { op: 'add', type: 'box', id: 'web', name: 'Upright', params: { width: 12, depth: 70, height: 60 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [-54, 0] }, meta: { material: 'steel', part_no: 'BR-002' } },
    { op: 'add', type: 'cylinder', id: 'hole1', name: 'Bolt hole', params: { diameter: 10, height: 12 }, mate: { to: 'plate', a: 'top', b: 'top', flip: false, offset: 1, slide: [40, 22] }, into: 'plate', mode: 'subtract' },
    { op: 'add', type: 'cylinder', id: 'boss', name: 'Boss', params: { diameter: 26, height: 18 }, mate: { to: 'plate', a: 'top', b: 'bottom', slide: [5, 0] }, color: '#7aa2ff', meta: { material: 'aluminium', part_no: 'BR-010' } },
    { op: 'add', type: 'cone', id: 'tip', name: 'Cap', params: { diameter: 26, top: 8, height: 14 }, mate: { to: 'boss', a: 'top', b: 'bottom' }, color: '#ff7b3d', meta: { material: 'brass' } }
  ], 'Demo bracket');
  apply([{ op: 'weld', id: 'weld1', a: 'plate', b: 'web', near: [-48, 0, 10], size: 6, profile: 'flat' }], 'Weld the upright to the plate');
  apply([{ op: 'edge', target: 'plate', near: [60, -35, 5], style: 'chamfer', size: 3 }, { op: 'edge', target: 'web', near: [-60, 0, 70], d: [0, 1, 0], style: 'fillet', size: 5 }, { op: 'edge', target: 'plate', near: [45, 22, 10], style: 'chamfer', size: 1.5 }], 'Round edges + countersink');
  apply([{ op: 'pattern', id: 'holes', of: 'hole1', kind: 'linear', count: 2, spacing: 44, direction: [0, -1, 0] }], 'Second bolt hole (array)');
  select(null); views.fitAll(); toast('Demo: a welded steel bracket (two separate parts), an arrayed countersunk hole, mates and materials — Properties shows mass and balance', 3200);
}

/* ---------- AI bridge (MCP) ---------- */
const bridge = { token: (document.querySelector('meta[name="sketchflow-bridge"]') || {}).content || '', cid: 'm' + Math.random().toString(36).slice(2, 9) };
async function post(path, body) { const r = await fetch(path + '?t=' + encodeURIComponent(bridge.token), { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-token': bridge.token }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('bridge ' + r.status); return r.json().catch(() => ({})); }
function chip(on, t) { const c = $('#aiChip'); c.classList.toggle('live', on); c.querySelector('span').textContent = t; }
function connectBridge() {
  if (!bridge.token || !/^https?:$/.test(location.protocol)) { chip(false, 'AI off'); return; }
  const es = new EventSource('/bridge/events?t=' + encodeURIComponent(bridge.token) + '&cid=' + bridge.cid + '&kind=model');
  es.addEventListener('hello', () => chip(true, 'AI linked'));
  es.addEventListener('role', (e) => { const d = JSON.parse(e.data); chip(true, d.primary ? 'AI linked' : 'AI on other tab'); });
  es.addEventListener('cmd', async (e) => { const { id, cmd, args } = JSON.parse(e.data); try { await post('/bridge/reply', { id, ok: true, result: await runCmd(cmd, args || {}) }); } catch (err) { await post('/bridge/reply', { id, ok: false, error: String(err && err.message || err) }).catch(() => {}); } });
  es.onerror = () => { chip(false, 'AI reconnecting'); es.close(); setTimeout(async () => { try { const h = await (await fetch(location.pathname, { cache: 'no-store' })).text(); const m = h.match(/name="sketchflow-bridge" content="([a-f0-9]+)"/); if (m) bridge.token = m[1]; } catch (err) { /* down */ } connectBridge(); }, 1500); };
}
const b64 = async (canvas) => { const blob = await new Promise(r => canvas.toBlob(r, 'image/png')); const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const r3 = (p) => p.map(v => +v.toFixed(3));
function connectorReport(id) {
  const O = model.result.originPoint;
  if (id !== 'origin' && !model.result.world.has(id)) throw new Error('No placed object “' + id + '”');
  return worldConnectors(model.result, id).map(c => ({ name: c.name, kind: c.kind, at: r3(V.sub(c.o, O)), normal: r3(c.n), u: r3(c.u), v: r3(V.cross(c.n, c.u)) }));
}
async function snapshotFor(a) {
  const keep = { layout: views.layout, yaw: views.cam.yaw, pitch: views.cam.pitch, hidden: views.showHidden, dims: views.showDims };
  const dirs = { front: [0, -1, 0], top: [0, 0, 1], right: [1, 0, 0], iso: [1, -1, 1], back: [0, 1, 0], left: [-1, 0, 0], bottom: [0, 0, -1] };
  try {
    if (a.layout) views.layout = a.layout;
    if (a.view && dirs[a.view]) { const d = V.norm(dirs[a.view]); views.cam.yaw = Math.atan2(d[0], -d[1]) * 180 / Math.PI; views.cam.pitch = Math.asin(d[2]) * 180 / Math.PI; }
    if (a.hidden_lines !== undefined) views.showHidden = !!a.hidden_lines;
    if (a.dimensions !== undefined) views.showDims = !!a.dimensions;
    if (a.section) { const ax = a.section.axis || 'x', i = { x: 0, y: 1, z: 2 }[ax], n = [0, 0, 0]; n[i] = a.section.flip ? -1 : 1; const at = (+a.section.offset || 0) + model.result.originPoint[i]; keep.section = views.section; views.section = { n, d: a.section.flip ? -at : at, axis: ax, at }; }
    if (a.joints) previewPose(Object.fromEntries(Object.entries(a.joints).map(([id, v]) => [id, typeof v === 'number' ? { [((jointsOf(model.doc).find(j => j.id === id) || { dofs: [{ key: 'angle' }] }).dofs[0].key)]: v } : v])));
    if (a.fit !== false) views.fitAll();
    views.draw(); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    const c = views.snapshot();
    return { png: await b64(c), width: c.width, height: c.height };
  } finally {
    if (a.joints && a.keep !== true) clearPreview();
    if (a.section && a.keep !== true) views.section = keep.section || null;
    if (a.keep !== true) { views.layout = keep.layout; views.cam.yaw = keep.yaw; views.cam.pitch = keep.pitch; views.showHidden = keep.hidden; views.showDims = keep.dims; syncBar(); views.draw(); }
  }
}
async function runCmd(cmd, a) {
  switch (cmd) {
    case 'ping': return { ok: true };
    case 'model.describe': { const d = model.describe(); if (a.connectors_of) d.connectors_detail = { [a.connectors_of]: connectorReport(a.connectors_of) }; return d; }
    case 'model.connectors': return { id: a.id, connectors: connectorReport(a.id) };
    case 'model.apply': {
      const res = model.apply(a.ops || [], a.label || 'AI build', { relative: a.relative !== false });
      if (a.select !== false) { const last = [...res].reverse().find(r => r && r.id && model.get(r.id)); if (last) select(last.id); }
      if (a.fit !== false) views.fitAll();
      toast('🤖 ' + (a.label || res.length + ' change' + (res.length === 1 ? '' : 's')), 1800);
      const out = { results: res, model: model.describe() };
      if (a.look) Object.assign(out, await snapshotFor(a));
      return out;
    }
    case 'model.snapshot': return Object.assign(await snapshotFor(a), { model: model.describe() });
    case 'model.export': { const f = a.format || 'stl'; if (f === 'step') { const r = exportStep(model, { threads: a.threads || 'modelled', file: slug() + '.step' }); return { name: slug() + '.step', text: r.text, report: r.report }; } return { name: slug() + (f === 'stl' ? '.stl' : f === 'obj' ? '.obj' : f === 'bom' ? '-parts.csv' : f === 'svg' ? '-drawing.svg' : f === 'dxf' ? '-drawing.dxf' : '.sf3d.json'), text: f === 'stl' ? exportSTL() : f === 'obj' ? exportOBJ() : f === 'bom' ? bomCSV() : f === 'svg' ? drawingSVG(model, { sheet: a.sheet || 'A3', exploded: a.exploded !== false }) : f === 'dxf' ? drawingDXF(model, { sheet: a.sheet || 'A3', exploded: a.exploded !== false }) : JSON.stringify(model.doc, null, 1) }; }
    case 'model.select': select(a.id || null); return { selected };
    case 'model.undo': { const n = Math.max(1, a.steps || 1), done = []; for (let i = 0; i < n; i++) { const l = model.undo(); if (!l) break; done.push(l); } return { undone: done, model: model.describe() }; }
    case 'model.redo': { const n = Math.max(1, a.steps || 1), done = []; for (let i = 0; i < n; i++) { const l = model.redo(); if (!l) break; done.push(l); } return { redone: done, model: model.describe() }; }
    case 'model.example': { if (!a.id) return { examples: EXAMPLES.map(e => ({ id: e.id, name: e.name, about: e.blurb })) }; loadExample(a.id); return { model: model.describe() }; }
    case 'model.new': model.load(newDoc(a.name || 'Untitled model')); select(null); views.fitAll(); return { model: model.describe() };
    case 'model.load': { const doc = typeof a.doc === 'string' ? JSON.parse(a.doc) : a.doc; if (!doc || !Array.isArray(doc.objects)) throw new Error('Not a SketchFlow 3D model (needs objects[])'); model.load(Object.assign(newDoc(doc.name || 'Model'), doc)); select(null); views.fitAll(); return { model: model.describe() }; }
    case 'model.demo': demo(); return { model: model.describe() };
    case 'model.say': toast('🤖 ' + String(a.text || ''), Math.max(1500, (a.seconds || 6) * 1000)); return { ok: true };
    case 'model.version': return a.restore ? model.restoreVersion(a.restore) : a.name !== undefined || a.save ? model.saveVersion(a.name) : { versions: model.listVersions() };
    case 'model.import': {
      let tri = a.triangles, count = a.count, data = a.data;
      if (a.file_b64 && /\.(step|stp)$/i.test(a.name || '')) { const bin = atob(a.file_b64); const r = importStepText(a.name, bin, { material: a.material }); views.fitAll(); return { result: r, model: model.describe() }; }
      if (a.file_b64) { const bin = atob(a.file_b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const parsed = parseMesh(a.name, u); tri = encodeTriangles(parsed.triangles); count = parsed.count; data = undefined; }
      const r = model.apply([{ op: 'import', name: a.name, triangles: tri, count, data, scale: a.scale, material: a.material }], `Import ${a.name}`, { relative: true })[0]; views.fitAll(); return { result: r, model: model.describe() };
    }
    case 'model.query': {
      const R = model.result, O = R.originPoint, r3 = (v) => v.map(x => +(+x).toFixed(3)), lim = Math.max(1, Math.min(500, a.limit || 60)), what = a.what || 'faces';
      const bodyIds = a.id ? [rootOf(a.id)] : R.bodies.filter(b => !b.hidden).map(b => b.id);
      const bodyOfId = (id) => R.bodies.find(b => b.id === id);
      if (a.id && !bodyOfId(rootOf(a.id)) && what !== 'connectors' && what !== 'measure') throw new Error(`${a.id} has no geometry (a plane or a tool?) — query its connectors instead`);
      if (what === 'faces') {
        return { parts: bodyIds.map(id => {
          const b = bodyOfId(id); if (!b) return null;
          const groups = new Map();
          for (const q2 of b.solid.polys) {
            const key = q2.sid + '|' + q2.plane.n.map(v => Math.round(v * 1e4)).join(',') + '|' + Math.round(q2.plane.w * 1e3);
            let g = groups.get(key); if (!g) groups.set(key, g = { sid: q2.sid, n: q2.plane.n, area: 0, c: [0, 0, 0] });
            const p0 = q2.v[0].p; for (let i = 1; i < q2.v.length - 1; i++) { const p1 = q2.v[i].p, p2 = q2.v[i + 1].p, ar = V.len(V.cross(V.sub(p1, p0), V.sub(p2, p0))) / 2; g.area += ar; g.c = V.add(g.c, V.mul(V.add(V.add(p0, p1), p2), ar / 3)); }
          }
          const flat = [], curved = new Map();
          for (const g of groups.values()) {
            const owner = g.sid.includes(':') ? g.sid.split(':')[0] : id, c = V.mul(g.c, 1 / (g.area || 1));
            const sameSid = [...groups.values()].filter(h => h.sid === g.sid).length;
            if (sameSid > 2 && /:(side|surface|arc\d*|rev\d+|teeth|bore|rim|mesh)$/.test(g.sid)) { const cv = curved.get(g.sid) || { surface: g.sid, owner, area: 0 }; cv.area += g.area; curved.set(g.sid, cv); continue; }
            const conns = model.get(owner) ? worldConnectors(R, owner).filter(k => k.kind === 'face') : [];
            const hitc = conns.find(k => V.dot(k.n, g.n) > 0.9999 && Math.abs(V.dot(V.sub(c, k.o), g.n)) < 1e-4);
            flat.push({ connector: hitc ? hitc.name : null, owner, surface: g.sid, normal: r3(g.n), centre: r3(V.sub(c, O)), area_mm2: +g.area.toFixed(2) });
          }
          flat.sort((x, y) => y.area_mm2 - x.area_mm2);
          return { part: id, name: b.name, flat_faces: flat.slice(0, lim), curved_surfaces: [...curved.values()].map(cv => Object.assign(cv, { area_mm2: +cv.area.toFixed(2) })).map(({ area, ...rest }) => rest), note: flat.length > lim ? `${flat.length - lim} smaller faces left out (limit)` : undefined };
        }).filter(Boolean) };
      }
      if (what === 'edges') {
        return { parts: bodyIds.map(id => { const b = bodyOfId(id); if (!b) return null; const es = K.creaseEdges(b.solid).map(([p, q2]) => ({ a: r3(V.sub(p, O)), b: r3(V.sub(q2, O)), length: +V.len(V.sub(q2, p)).toFixed(3) })).sort((x, y) => y.length - x.length); return { part: id, name: b.name, count: es.length, edges: es.slice(0, lim) }; }).filter(Boolean) };
      }
      if (what === 'measure') {
        const pt = (q2) => { if (Array.isArray(q2)) return { p: V.add(q2.map(Number), O), n: null }; if (q2 && q2.obj) { const c = worldConnectors(R, q2.obj).find(k => k.name === (q2.conn || 'center')); if (!c) throw new Error(`no connector ${q2.conn} on ${q2.obj}`); return { p: c.o, n: c.kind === 'face' ? c.n : null }; } throw new Error('from / to: {obj, conn} or [x,y,z]'); };
        const A = pt(a.from), B = pt(a.to), dv = V.sub(B.p, A.p), out = { distance: +V.len(dv).toFixed(4), delta: r3(dv) };
        if (A.n && B.n) { out.angle_between_normals_deg = +(Math.acos(Math.max(-1, Math.min(1, V.dot(A.n, B.n)))) * 180 / Math.PI).toFixed(3); out.gap_along_from_normal = +V.dot(dv, A.n).toFixed(4); }
        return out;
      }
      if (what === 'section') {
        const ax = { x: 0, y: 1, z: 2 }[a.axis || 'z']; if (ax == null) throw new Error('axis is x, y or z');
        const at = (+a.offset || 0) + O[ax], th = 0.01, parts = [];
        for (const id of bodyIds) {
          const b = bodyOfId(id); if (!b) continue; const bb = b.solid.bbox(); if (at < bb.min[ax] || at > bb.max[ax]) { parts.push({ part: id, name: b.name, area_mm2: 0 }); continue; }
          const size = [bb.max[0] - bb.min[0] + 2, bb.max[1] - bb.min[1] + 2, bb.max[2] - bb.min[2] + 2]; size[ax] = th;
          const c = V.lerp(bb.min, bb.max, 0.5); c[ax] = at - (ax === 2 ? th / 2 : 0);
          let slab = K.box(size[0], size[1], size[2]); slab = slab.transform(M4.translate([c[0], c[1], ax === 2 ? c[2] : c[2] - size[2] / 2]));
          parts.push({ part: id, name: b.name, area_mm2: +(b.solid.intersect(slab).volume() / th).toFixed(2) });
        }
        return { axis: a.axis || 'z', offset: +a.offset || 0, total_area_mm2: +parts.reduce((s2, x) => s2 + x.area_mm2, 0).toFixed(2), parts };
      }
      if (what === 'bbox') {
        const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, parts = [];
        for (const id of bodyIds) { const b = bodyOfId(id); if (!b || b.solid.isEmpty()) continue; const bb = b.solid.bbox(); for (let k = 0; k < 3; k++) { all.min[k] = Math.min(all.min[k], bb.min[k]); all.max[k] = Math.max(all.max[k], bb.max[k]); } parts.push({ part: id, name: b.name, min: r3(V.sub(bb.min, O)), max: r3(V.sub(bb.max, O)), size: r3(V.sub(bb.max, bb.min)) }); }
        return { overall: isFinite(all.min[0]) ? { min: r3(V.sub(all.min, O)), max: r3(V.sub(all.max, O)), size: r3(V.sub(all.max, all.min)) } : null, parts };
      }
      if (what === 'connectors') { if (!a.id) throw new Error('give id'); return { id: a.id, connectors: worldConnectors(R, a.id).map(c => ({ name: c.name, kind: c.kind, at: r3(V.sub(c.o, O)), normal: r3(c.n), u: r3(c.u) })) }; }
      throw new Error('what is faces, edges, measure, section, bbox or connectors');
    }
    case 'model.check': {
      const res = interference(model); if (a.look) views.setHighlights(res.map(r => r.region));
      const out = { overlaps: res.map(r => ({ a: r.a, b: r.b, parts: r.names, volume_mm3: r.volume, exact: r.exact, bbox: r.bbox && { min: V.sub(r.bbox.min, model.result.originPoint).map(v => +v.toFixed(2)), max: V.sub(r.bbox.max, model.result.originPoint).map(v => +v.toFixed(2)) } })) };
      if (a.motion && a.motion.id) {
        /* sweep a joint and report the first contact */
        const j = jointsOf(model.doc).find(q => q.id === a.motion.id); if (!j) throw new Error(`${a.motion.id} is not a joint`);
        const dof = j.dofs.find(d => d.key === (a.motion.key || j.dofs[0].key)), from = a.motion.from != null ? a.motion.from : dof.min, to = a.motion.to != null ? a.motion.to : dof.max, steps = Math.max(2, Math.min(720, a.motion.steps || 120));
        collisionBase = null; let first = null;
        for (let k = 0; k <= steps && !first; k++) { const v = from + (to - from) * k / steps, hit = previewPose({ [j.id]: { [dof.key]: v } }); if (hit) first = { value: +v.toFixed(3), parts: hit.map(h => h.names) }; }
        clearPreview(); out.motion = { joint: j.id, key: dof.key, from, to, steps, first_contact: first || null, clear: !first };
      }
      if (a.look) { Object.assign(out, await snapshotFor(a)); views.setHighlights([]); }
      return out;
    }
    case 'model.mass': return { mass: massReport(model.doc, model.result), parts_list: bom(model.doc, model.result), materials: Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, `${m.name} ${m.density} g/cm³`])) };
    case 'model.addon': {
      if (!a.addon) return { addons: listAddons() };
      const ad = ADDONS.get(a.addon); if (!ad) throw new Error(`No add-on “${a.addon}”. Loaded: ${[...ADDONS.keys()].join(', ')}`);
      if (!a.action) return { addon: listAddons().find(x => x.id === a.addon) };
      const act = ad.actions[a.action]; if (!act) throw new Error(`${ad.name} has no action “${a.action}”. Try: ${Object.keys(ad.actions).join(', ')}`);
      if (act.query && !(a.args || {}).build) {
        const args = Object.assign({}, ...Object.entries(act.args || {}).map(([k, v]) => ({ [k]: v && v.default !== undefined ? v.default : undefined })), a.args || {});
        return { info: act.run(args, model.addonContext()).info };
      }
      const r = model.apply([{ op: 'addon', addon: a.addon, action: a.action, args: a.args || {} }], a.label || `${ad.name}: ${a.action}`, { relative: true })[0];
      if (a.fit !== false) views.fitAll();
      const out = { info: r.info, results: r.results, model: model.describe() };
      if (a.look) Object.assign(out, await snapshotFor(a));
      return out;
    }
  }
  throw new Error('Unknown command ' + cmd);
}
window.SF3 = { model, views, apply: (ops) => model.apply(ops), select, setTool, startFaceSketch, demo, exportSTL, exportOBJ, runCmd, bomCSV, patternHint, openAddonForm, seamNear };
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
/* the 2D board link only makes sense when both are served by the SketchFlow server */
if (!bridge.token || !/^https?:$/.test(location.protocol)) { const a = document.querySelector('a[href="/"]'); if (a) a.remove(); }
/* side-built add-ons: any .js file in model/addons/ (or SKETCHFLOW_ADDONS) is loaded when served */
async function loadAddons() {
  if (!/^https?:$/.test(location.protocol) || !bridge.token) return;
  let files = []; try { files = await (await fetch('addons/index.json', { cache: 'no-store' })).json(); } catch (e) { return; }
  let n = 0;
  for (const f of files) {
    try { const mod = await import('../addons/' + encodeURIComponent(f)); const a = mod.default || mod.addon; if (a && a.id && !ADDONS.has(a.id)) { registerAddon(a); n++; } }
    catch (e) { toast(`Add-on ${f} did not load: ${e.message}`, 4000); }
  }
  if (n) { model.recompute(); views.rebuild(); views.draw(); renderTree(); renderProps(); toast(`${n} add-on${n > 1 ? 's' : ''} loaded`, 1500); }
}
renderTree(); renderProps(); syncBar(); connectBridge(); loadAddons();
if (!model.doc.objects.length) demo();
