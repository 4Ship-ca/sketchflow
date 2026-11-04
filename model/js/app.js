/* SketchFlow 3D workspace: feature tree, properties, tools (add · sketch→extrude/revolve/loft · mate · booleans ·
   edge treatments · measure), editable carried dimensions, autosave, export, and the AI (MCP) bridge. */
import { Model, TYPES, worldConnectors, newDoc, poseFromMatrix, K, MATERIALS, massReport, bom, registerAddon, listAddons, ADDONS, findSeams, dimsOf, measureDim, parseExpr } from './model.js';
import { Views, fmt } from './views.js';
import gears from '../addons/gears.js';
const { V, M4 } = K;
/* built-in add-ons are registered before the saved model is evaluated (it may use their shapes) */
registerAddon(gears);
const $ = (s) => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) { const v = attrs[k]; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v != null && v !== false) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
const toast = (t, ms) => { const d = el('div', { class: 'toast' }, t); $('#toasts').append(d); setTimeout(() => d.remove(), ms || 2200); };
/* a toast with buttons (stays until used, dismissed or timed out) */
const toastAct = (t, actions, ms) => {
  const d = el('div', { class: 'toast act' }, el('span', null, t), ...actions.map(([label, fn]) => el('button', { onclick: () => { d.remove(); fn(); } }, label)), el('button', { class: 'x', onclick: () => d.remove(), 'aria-label': 'Dismiss' }, '×'));
  $('#toasts').append(d); setTimeout(() => d.remove(), ms || 9000); return d;
};

const ICON = {
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', wedge: 'M4 18h16L4 6zM4 6l4-2 12 12', cylinder: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6',
  cone: 'M12 3L5 18M12 3l7 15M5 18c0 1.7 3.1 3 7 3s7-1.3 7-3-3.1-3-7-3-7 1.3-7 3z', sphere: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5',
  fillet: 'M4 20V4M4 20h16M4 8c0 7 5 12 12 12', weld: 'M4 20V4M4 20h16M4 12a8 8 0 0 0 8 8', chamfer: 'M4 20V4M4 20h16M4 10l10 10', sketch: 'M4 18l5-12 6 8 5-6M4 18h16',
  mate: 'M7 7h4v4H7zM13 13h4v4h-4zM11 11l2 2', union: 'M9 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12M15 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12', subtract: 'M9 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12M15 6a6 6 0 0 1 0 12',
  intersect: 'M12 7.5a6 6 0 0 1 0 9a6 6 0 0 1 0-9M9 6a6 6 0 1 0 0 12M15 6a6 6 0 1 1 0 12', dim: 'M4 7v10M20 7v10M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3', undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', hidden: 'M3 12h3M9 12h3M15 12h3M21 12h0M4 6h16M4 18h16', sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5', board: 'M4 5h16v12H4zM8 21h8M12 17v4', extrude: 'M6 18h8l4-4H10zM6 18V8l4-4v10M14 18V8l4-4', revolve: 'M12 3v18M8 6a4 9 0 1 0 8 0', loft: 'M5 19h10l4-4M7 7h6l2-2M5 19L7 7M15 19l-2-12', sweep: 'M5 19c4 0 4-14 14-14',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  pattern: 'M4 9h4v4H4zM10 9h4v4h-4zM16 9h4v4h-4zM4 15l16 0', circular: 'M12 4a8 8 0 1 0 8 8M20 4v5h-5M11 11h2v2h-2z', mirror: 'M12 3v18M9 7L4 17h5zM15 7l5 10h-5z',
  explode: 'M9 9h6v6H9zM4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3', cog: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 3v9h9M12 21v-9H3',
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
model.on(() => { views.rebuild(); refreshGhost(); views.draw(); renderTree(); renderProps(); save(); syncBar(); });
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
    case 'extrude': case 'loft': return `${p.profile.length} pts · ${fmt(p.length)}${p.twist ? ' · ' + p.twist + '°' : ''}`;
    case 'revolve': return `${p.profile.length} pts · ${fmt(p.degrees)}°`;
    case 'sweep': return `${p.profile.length} pts · ${p.path.length - 1} segments`;
    case 'gear': return `${p.internal ? 'ring · ' : ''}m${fmt(p.module)} · ${p.teeth}T · ${p.style}${p.style !== 'spur' && p.helix ? ' ' + p.helix + '°' : ''}`;
    case 'pattern': { const n = [...(model.result.virtual || new Map()).values()].filter(v => v.pattern === o.id && v.source === (o.of || [])[0]).length + 1; return `${p.kind} ×${n} · ${(o.of || []).filter(i => (model.get(i) || {}).type !== 'edge').map(name).join(', ')}`; }
    case 'weld': return `${fmt(p.size)} ${p.profile}${p.all_around ? ' all round' : ''} · ${(o.joins || []).map(name).join(' + ')}`;
    default: return TYPES[o.type] ? TYPES[o.type].label : o.type;
  }
}
const iconOf = (o) => (o.type === 'edge' ? o.params.style : o.type === 'pattern' ? (o.params.kind === 'circular' ? 'circular' : o.params.kind === 'mirror' ? 'mirror' : 'pattern') : ICON[o.type] ? o.type : TYPES[o.type] && TYPES[o.type].addon ? 'addon' : o.type);
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
  for (const { o, depth } of treeOrder()) {
    const sub = subOf(o) + (o.expr && Object.keys(o.expr).length ? ' · 🔗' : '');
    const row = el('div', { class: 'row' + (o.id === selected ? ' on' : '') + (depth ? ' tool' : ''), onclick: () => select(o.id), title: o.mate ? `mated ${o.mate.b} → ${o.mate.to === 'origin' ? 'origin' : (model.get(o.mate.to) || {}).name} · ${o.mate.a}` : '' },
      el('span', { class: 'ic' }, icon(iconOf(o))),
      el('div', { style: 'min-width:0' }, el('div', { class: 'nm' }, o.name), el('div', { class: 'sub' }, sub)),
      el('div', { style: 'display:flex;gap:3px' }, ...statusOf(o).map(([t, c]) => el('span', { class: 'badge ' + c }, t))));
    list.append(row);
  }
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
const OPTIONS = { style: { edge: ['fillet', 'chamfer'], fillet: ['fillet', 'weld', 'chamfer'], gear: ['spur', 'helical', 'herringbone'] }, mode: { '*': ['auto', 'add', 'subtract'] }, kind: { pattern: ['linear', 'circular', 'mirror'] }, plane: { pattern: ['yz', 'xz', 'xy'] }, profile: { weld: ['flat', 'convex', 'concave'] } };
const optionsFor = (type, k) => { const o = OPTIONS[k]; return o ? (o[type] || o['*'] || null) : null; };
const label = (k) => k.replace(/_/g, ' ');
function textInput(v, on, attrs) { const i = el('input', Object.assign({ value: v == null ? '' : v }, attrs || {})); i.addEventListener('keydown', e => e.stopPropagation()); i.addEventListener('change', () => on(i.value)); return i; }
function paramField(o, k, v) {
  const set = (val) => apply([{ op: 'set', id: o.id, params: { [k]: val } }]), opts = optionsFor(o.type, k);
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
function infoSection(o, sec) {
  const T = TYPES[o.type]; if (!T || !T.def || !T.def.info) return;
  let info; try { info = T.def.info(o.params, { K, V, M4 }); } catch (e) { info = { warning: e.message }; }
  const s = sec(T.label + ' data');
  for (const [k, v] of Object.entries(info || {})) s.append(k === 'warning' ? el('div', { class: 'warnline' }, '⚠ ' + v) : el('div', { class: 'f' }, label(k), el('span', { class: 'mono' }, typeof v === 'number' ? fmt(v) : String(v))));
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
  const s1 = sec(TYPES[o.type] ? TYPES[o.type].label : o.type);
  s1.append(field('Name', textInput(o.name, v => apply([{ op: 'set', id: o.id, name: v }]))));
  const keys = o.type === 'pattern' ? PATTERN_KEYS[o.params.kind] || Object.keys(o.params) : Object.keys(o.params);
  for (const k of keys) { if (k === 'segments' || k === 'detail' && o.type !== 'gear') continue; s1.append(paramField(o, k, o.params[k])); }
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
      const tc = el('select', null, ...worldConnectors(R, m.to).map(c => el('option', { value: c.name, selected: m.a === c.name }, c.name))); tc.onchange = () => apply([{ op: 'mate', id: o.id, to: m.to, a: tc.value, b: m.b, flip: m.flip, offset: m.offset, angle: m.angle, slide: m.slide }]);
      const sc = el('select', null, ...worldConnectors(R, o.id).map(c => el('option', { value: c.name, selected: m.b === c.name }, c.name))); sc.onchange = () => apply([{ op: 'mate', id: o.id, to: m.to, a: m.a, b: sc.value, flip: m.flip, offset: m.offset, angle: m.angle, slide: m.slide }]);
      const mate = (patch) => apply([Object.assign({ op: 'mate', id: o.id, to: m.to, a: m.a, b: m.b, flip: m.flip, offset: m.offset, angle: m.angle, slide: m.slide }, patch)]);
      const fl = el('input', { type: 'checkbox' }); fl.checked = !!m.flip; fl.onchange = () => mate({ flip: fl.checked });
      s2.append(field('mated to', to), field('their', tc), field('its', sc), field('gap', numInput(m.offset || 0, v => mate({ offset: v }))), field('angle °', numInput(m.angle || 0, v => mate({ angle: v }))),
        field('slide x', numInput((m.slide || [0, 0])[0], v => mate({ slide: [v, (m.slide || [0, 0])[1]] }))), field('slide y', numInput((m.slide || [0, 0])[1], v => mate({ slide: [(m.slide || [0, 0])[0], v] }))), field('face to face', fl));
      s2.append(el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => apply([{ op: 'unmate', id: o.id }]) }, 'Unmate (keep where it is)')));
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
  $('#hiddenBtn').classList.toggle('on', views.showHidden); $('#dimsBtn').classList.toggle('on', views.showDims);
  $('#explodeBtn').classList.toggle('on', views.explode > 0.5); $('#cogBtn').classList.toggle('on', !!views.showCoG);
  if (document.activeElement !== $('#name')) $('#name').value = model.doc.name;
}
document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addShape(b.dataset.add)));
function addShape(type) {
  const g = model.result.ground, first = !g;
  const r = apply([{ op: 'add', type, mate: first ? { to: 'origin', a: 'xy', b: 'bottom' } : undefined }])[0];
  select(r.id); if (first) setTimeout(() => views.fitAll(), 0);
  toast(first ? `${r.name} placed on the origin — it’s the ground` : `${r.name} sits on ${model.get(g).name} — Mate to move it`, 1800);
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(tool && tool.name === b.dataset.tool ? null : b.dataset.tool)));
$('#undo').onclick = () => { const l = model.undo(); if (l) toast('Undo · ' + l, 900); };
$('#redo').onclick = () => { const l = model.redo(); if (l) toast('Redo · ' + l, 900); };
$('#layout').onclick = () => { views.layout = views.layout === '4' ? '3d' : '4'; views.draw(); };
$('#fit').onclick = () => views.fitAll();
$('#explodeBtn').onclick = () => { views.setExplode(views.explode > 0.5 ? 0 : 1); setTimeout(syncBar, 420); toast(views.explode > 0.5 ? 'Back together' : 'Pulled apart — welded and mated parts are separate components', 1600); };
$('#cogBtn').onclick = () => { views.showCoG = !views.showCoG; syncBar(); renderProps(); views.draw(); };
$('#addonBtn').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect(), m = el('div', { class: 'menu', style: `left:${r.left}px;top:${r.bottom + 4}px` });
  for (const a of listAddons()) {
    m.append(el('div', { class: 'mh' }, a.name));
    for (const [t, d] of Object.entries(a.types)) m.append(el('button', { onclick: () => { m.remove(); addShape(t); } }, 'Add ' + d.label.toLowerCase()));
    for (const k of Object.keys(a.actions)) m.append(el('button', { onclick: () => { m.remove(); openAddonForm(a.id, k); } }, k[0].toUpperCase() + k.slice(1) + '…'));
  }
  if (!ADDONS.size) m.append(el('div', { class: 'mh' }, 'No add-ons loaded'));
  document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
};
$('#hiddenBtn').onclick = () => { views.showHidden = !views.showHidden; syncBar(); views.draw(); };
$('#dimsBtn').onclick = () => { views.showDims = !views.showDims; syncBar(); views.draw(); };
$('#theme').onclick = () => { prefs.theme = isDark() ? 'light' : 'dark'; savePrefs(); document.documentElement.setAttribute('data-theme', prefs.theme); views.setTheme(isDark()); };
$('#name').addEventListener('change', () => apply([{ op: 'rename', name: $('#name').value }]));
$('#name').addEventListener('keydown', e => e.stopPropagation());
$('#fileBtn').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect(), m = el('div', { class: 'menu', style: `left:${r.left}px;top:${r.bottom + 4}px` });
  const item = (t, fn) => m.append(el('button', { onclick: () => { m.remove(); fn(); } }, t));
  item('New model', () => { if (model.doc.objects.length) model.load(newDoc('Model')); select(null); });
  item('Open model file…', () => $('#openIn').click());
  item('Save model file (.json)', () => download(new Blob([JSON.stringify(model.doc, null, 1)], { type: 'application/json' }), slug() + '.sf3d.json'));
  item('Export STL (3D print)', () => download(new Blob([exportSTL()], { type: 'model/stl' }), slug() + '.stl'));
  item('Export OBJ', () => download(new Blob([exportOBJ()], { type: 'text/plain' }), slug() + '.obj'));
  item('Export 4-view PNG', () => views.snapshot().toBlob(b => download(b, slug() + '-views.png')));
  item('Export parts list (CSV)', () => download(new Blob([bomCSV()], { type: 'text/csv' }), slug() + '-parts.csv'));
  item('Load the demo model', demo);
  document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
};
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
    const i = options ? el('select', { 'data-k': k, 'aria-label': label }, ...options.map(x => el('option', { value: x, selected: x === v }, x))) : el('input', { type: 'number', step: 'any', value: v, 'data-k': k, 'aria-label': label });
    i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && actions && actions[0]) actions[0][1](vals()); if (e.key === 'Escape') setTool(null); }); return [k, label, i, options];
  });
  const vals = () => Object.fromEntries(inputs.map(([k, , i, options]) => [k, options ? i.value : parseFloat(String(i.value).replace(',', '.'))]));
  h.append(el('span', null, t), ...inputs.map(([, label, i]) => el('label', { class: 'hf' }, label, i)), ...(actions || []).map(([l, f]) => el('button', { onclick: () => f(vals()) }, l)), el('button', { onclick: () => setTool(null) }, 'Esc'));
  if (inputs[0] && !inputs[0][3]) setTimeout(() => { inputs[0][2].focus(); if (inputs[0][2].select) inputs[0][2].select(); }, 0);
};
let pendingLoft = null;
function setTool(name, arg) {
  tool = name ? { name, step: 0, data: {} } : null; views.connectorsFor = null; views.preview = null;
  if (!name) hint(null);
  else if (name === 'mate') { if (arg) { tool.data.moving = arg; tool.step = 1; views.connectorsFor = arg; hint('Mate: click the connector on ' + model.get(arg).name + ' to attach'); } else hint('Mate: click the object you want to move'); }
  else if (name.startsWith('bool-')) hint((name === 'bool-add' ? 'Union' : name === 'bool-subtract' ? 'Subtract' : 'Intersect') + ': click the target body, then the tool body');
  else if (name === 'edge-weld') {
    hint('Weld: click where two separate parts meet — the bead joins them, and they stay separate parts', [], [['size', 'leg mm', prefs.weldSize || 4], ['profile', 'profile', prefs.weldProfile || 'flat', ['flat', 'convex', 'concave']]]);
    const [sz, pf] = document.querySelectorAll('#hint [data-k]');
    sz.addEventListener('input', () => { const v = parseFloat(sz.value); if (v > 0) { prefs.weldSize = v; savePrefs(); } }); pf.addEventListener('change', () => { prefs.weldProfile = pf.value; savePrefs(); }); setTimeout(() => sz.blur(), 0);
  }
  else if (name.startsWith('edge-')) {
    hint(`${name.slice(5)[0].toUpperCase() + name.slice(6)}: click near an edge — outer edges are trimmed, inner corners filled; where two parts meet it merges them into one`, [], [['size', 'size mm', prefs.edgeSize || 4]]);
    const inp = $('#hint input'); if (inp) { inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (v > 0) { prefs.edgeSize = v; savePrefs(); } }); setTimeout(() => inp.blur(), 0); }
  }
  else if (name === 'measure') { views.connectorsFor = 'all'; hint('Dimension: click two dots in FRONT / TOP / RIGHT — a hole centre, then a face dot (middle of an edge in this view) gives the off-edge distance'); }
  else if (name === 'sketch') { tool.data.points = []; if (!arg) pendingLoft = null; hint(pendingLoft ? 'Loft: now sketch the END profile in the ' + pendingLoft.pane.toUpperCase() + ' view (any number of points)' : 'Sketch: click points in FRONT, TOP or RIGHT · click the first point (or Enter) to close · Shift = straight'); }
  syncBar(); views.draw();
}
function finishSketch() {
  const d = tool.data; if (!d.points || d.points.length < 3) { toast('A profile needs at least 3 points'); return; }
  const B = d.basis, pts2 = d.points.map(p => [V.dot(p, B.r), V.dot(p, B.u)]);
  views.preview = { pane: d.pane, points: d.points.slice(), closed: true }; views.draw();
  const R = model.result, frame = M4.mul(M4.translate(R.originPoint), [B.r[0], B.r[1], B.r[2], 0, B.u[0], B.u[1], B.u[2], 0, B.f[0], B.f[1], B.f[2], 0, 0, 0, 0, 1]);
  const pose = poseFromMatrix(frame), revFrame = M4.mul(M4.translate(R.originPoint), M4.frame([0, 0, 0], B.r, B.u)), revPose = poseFromMatrix(revFrame);
  const make = (op, extra) => { const r = apply([Object.assign({ op, profile: pts2, at: (op === 'revolve' ? revPose : pose).at, rot: (op === 'revolve' ? revPose : pose).rot, fixed: true }, extra)])[0]; pendingLoft = null; select(r.id); setTool(null); };
  const ok = (v, dflt) => (Number.isFinite(v) ? v : dflt);
  if (pendingLoft) {
    if (pendingLoft.pane !== d.pane) toast('End profile was drawn in another view — it is used flat in the ' + pendingLoft.pane.toUpperCase() + ' view');
    const first = pendingLoft;
    hint('Loft between the two profiles (' + first.pts2.length + ' → ' + pts2.length + ' points):', [
      ['Loft', (v) => { const L = ok(v.length, 30); if (L) { const r = apply([{ op: 'loft', profile: first.pts2, profile2: pts2, length: L, twist: ok(v.twist, 0), at: first.pose.at, rot: first.pose.rot, fixed: true }])[0]; pendingLoft = null; select(r.id); setTool(null); } }]
    ], [['length', 'length', 30], ['twist', 'twist °', 0]]);
    tool.step = 9; return;
  }
  hint('Profile closed (' + pts2.length + ' points) — make it 3D:', [
    ['Extrude', (v) => { const L = ok(v.length, 20); if (L) make('extrude', { length: L, twist: ok(v.twist, 0), scale: ok(v.scale, 1) || 1 }); }],
    ['Revolve', (v) => { const dg = ok(v.degrees, 360); if (dg) make('revolve', { profile: pts2.map(([x, y]) => [Math.abs(x), y]), degrees: dg }); }],
    ['Loft → end profile', (v) => { pendingLoft = { pts2, pose, pane: d.pane }; const keep = pendingLoft; setTool('sketch', true); pendingLoft = keep; hint('Loft: now sketch the END profile in the ' + keep.pane.toUpperCase() + ' view (any number of points)'); }]
  ], [['length', 'length', 20], ['twist', 'twist °', 0], ['scale', 'end scale', 1], ['degrees', 'revolve °', 360]]);
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
    if (drag.pane.id === '3d') { if (drag.button === 2 || drag.button === 1 || e.shiftKey) views.pan3d(drag.pane, dx, dy); else views.orbit(dx, dy); }
    else views.panOrtho(drag.pane, dx, dy);
    return;
  }
  const pane = views.paneAt(x, y); if (!pane) return;
  const h = views.hitOverlay(x, y);
  views.hover = h ? { conn: h.kind === 'conn' ? h.conn : null, cube: h.kind === 'cube' && h.name ? h.name : null, cubeDir: h.kind === 'cube' && !h.name ? h.dir : null } : null;
  if (tool && tool.name === 'sketch' && pane.id !== '3d' && tool.step < 9) {
    let pp = views.planePoint(pane, x, y); if (!pp) return;
    if (tool.data.pane && tool.data.pane !== pane.id) { views.draw(); return; }
    let p = snapSketch(pane, pp, e.shiftKey);
    views.preview = { pane: pane.id, points: tool.data.points, cursor: p };
  }
  stage.style.cursor = h && (h.kind === 'dim' || h.kind === 'conn' || h.kind === 'cube') ? 'pointer' : tool ? 'crosshair' : 'default';
  views.draw();
});
stage.addEventListener('pointerup', (e) => {
  const d = drag; drag = null; if (!d || d.moved) return;
  const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, pane = d.pane;
  const hit = views.hitOverlay(x, y);
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
function snapSketch(pane, pp, straight) {
  const B = BASISof(pane.id), pts = tool.data.points; let x = pp.x, y = pp.y;
  const grid = prefs.grid || 5; x = Math.round(x / grid) * grid; y = Math.round(y / grid) * grid;
  if (straight && pts.length) { const l = pts[pts.length - 1], lx = V.dot(l, B.r), ly = V.dot(l, B.u); if (Math.abs(x - lx) > Math.abs(y - ly)) y = ly; else x = lx; }
  return V.add(V.mul(B.r, x), V.mul(B.u, y));
}
function BASISof(id) { return { front: { r: [1, 0, 0], u: [0, 0, 1], f: [0, -1, 0] }, top: { r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] }, right: { r: [0, 1, 0], u: [0, 0, 1], f: [1, 0, 0] } }[id]; }
function clickTool(pane, x, y, hit, e) {
  const t = tool, R = model.result;
  if (t.name === 'sketch') {
    if (pane.id === '3d' || t.step >= 9) return;
    if (t.data.pane && t.data.pane !== pane.id) { toast('Keep the whole profile in one view'); return; }
    const pp = views.planePoint(pane, x, y), p = snapSketch(pane, pp, e.shiftKey);
    t.data.pane = pane.id; t.data.basis = BASISof(pane.id);
    if (t.data.points.length >= 3) { const f = views.project(pane, t.data.points[0]); if (Math.hypot(f.x - x, f.y - y) < 10) { finishSketch(); return; } }
    t.data.points.push(p); views.preview = { pane: pane.id, points: t.data.points }; views.draw(); return;
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
  if (mod) return;
  if (k === 'escape') { setTool(null); select(null); return; }
  if (k === 'enter' && tool && tool.name === 'sketch' && tool.step < 9) { finishSketch(); return; }
  if ((k === 'delete' || k === 'backspace') && selected) { apply([{ op: 'delete', id: selected }]); select(null); return; }
  const map = { b: 'box', w: 'wedge', c: 'cylinder', k: 'cone', o: 'sphere' }; if (map[k]) { addShape(map[k]); return; }
  if (k === 's') setTool('sketch'); if (k === 'm') setTool('mate'); if (k === 'f') views.fitAll(); if (k === 'h') $('#hiddenBtn').click(); if (k === 'd') $('#dimsBtn').click(); if (k === 'g') setTool('measure'); if (k === 'e') $('#explodeBtn').click(); if (k === 'p' && selected) patternHint(selected);
  if (k === '0') { views.layout = '4'; views.draw(); } if (k === '1') { views.layout = 'front'; views.draw(); } if (k === '2') { views.layout = 'top'; views.draw(); } if (k === '3') { views.layout = 'right'; views.draw(); } if (k === '4') { views.layout = '3d'; views.draw(); }
});

/* ---------- demo ---------- */
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
    if (a.fit !== false) views.fitAll();
    views.draw(); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    const c = views.snapshot();
    return { png: await b64(c), width: c.width, height: c.height };
  } finally {
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
    case 'model.export': { const f = a.format || 'stl'; return { name: slug() + (f === 'stl' ? '.stl' : f === 'obj' ? '.obj' : f === 'bom' ? '-parts.csv' : '.sf3d.json'), text: f === 'stl' ? exportSTL() : f === 'obj' ? exportOBJ() : f === 'bom' ? bomCSV() : JSON.stringify(model.doc, null, 1) }; }
    case 'model.select': select(a.id || null); return { selected };
    case 'model.undo': { const n = Math.max(1, a.steps || 1), done = []; for (let i = 0; i < n; i++) { const l = model.undo(); if (!l) break; done.push(l); } return { undone: done, model: model.describe() }; }
    case 'model.redo': { const n = Math.max(1, a.steps || 1), done = []; for (let i = 0; i < n; i++) { const l = model.redo(); if (!l) break; done.push(l); } return { redone: done, model: model.describe() }; }
    case 'model.new': model.load(newDoc(a.name || 'Untitled model')); select(null); views.fitAll(); return { model: model.describe() };
    case 'model.load': { const doc = typeof a.doc === 'string' ? JSON.parse(a.doc) : a.doc; if (!doc || !Array.isArray(doc.objects)) throw new Error('Not a SketchFlow 3D model (needs objects[])'); model.load(Object.assign(newDoc(doc.name || 'Model'), doc)); select(null); views.fitAll(); return { model: model.describe() }; }
    case 'model.demo': demo(); return { model: model.describe() };
    case 'model.say': toast('🤖 ' + String(a.text || ''), Math.max(1500, (a.seconds || 6) * 1000)); return { ok: true };
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
window.SF3 = { model, views, apply: (ops) => model.apply(ops), select, setTool, demo, exportSTL, exportOBJ, runCmd, bomCSV, patternHint, openAddonForm, seamNear };
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
