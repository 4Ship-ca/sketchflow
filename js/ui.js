/* SketchFlow UI: icons, rail, sliders, context strips, palette dock, layers drawer, hub sheet, radial wheel, toasts, AI bubbles, focus mode, boot. */
(function (SF) {
'use strict';
const U = SF.U, $ = U.$, $$ = U.$$, el = U.el;
const P = () => SF.prefs;
const ui = SF.ui = {};

/* =============== icons =============== */
const I = {
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  space: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  magnet: 'M6 4v7a6 6 0 0 0 12 0V4M6 4h3v7a3 3 0 0 0 6 0V4h3M6 8h3M15 8h3',
  lightbox: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z',
  copy: 'M8 8h11v11H8zM5 16H4V5h11v1', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  layers: 'M12 4l8 4.5-8 4.5-8-4.5zM4 12.5l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5', hub: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 7l3 3', shapes: 'M4 13h7v7H4zM17.5 3.5l4 7h-8zM14 17a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  text: 'M5 6V4h14v2M12 4v16M9 20h6', bucket: 'M5 11l7-7 7 7-7 7zM5 11h14M20 15s2 2.5 2 3.5a2 2 0 0 1-4 0c0-1 2-3.5 2-3.5z',
  eraser: 'M7 20h13M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H7zM9 11l5 5', select: 'M5 3l14 7-6 2-2 6z',
  joint: 'M6 18L12 8l6 6M10 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0M4 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 14a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  dim: 'M4 7v10M20 7v10M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3', pipette: 'M14 4l6 6M17 7l-9 9-4 1 1-4 9-9',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6.5a1.5 1.5 0 0 1 3 0V14M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.8-2.4L5 14.5a1.6 1.6 0 0 1 2.4-2L8 13',
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
  ref: 'M4 4h11v11H4zM9 9h11v11H9z', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  play: 'M7 4l13 8-13 8z', stop: 'M6 6h12v12H6z', pin: 'M12 3v4M12 17v4M3 12h4M17 12h4M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  motor: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12l5-3M15 4.5l2 3.5-4 .5', motion: 'M3 12h4l3-7 4 14 3-7h4',
  pencil: 'M4 20l2-6L16 4l4 4L10 18zM14 6l4 4', marker: 'M7 21l1-5L17 7l3 3-9 9zM4 21h5', brush: 'M18 3l3 3-9 9-3-3zM9 12c-3 0-4 2-4 4s-1 3-3 4c4 1 8 0 8-4',
  line: 'M5 19L19 5', arrow: 'M5 19L19 5M10 5h9v9', rect: 'M4 6h16v12H4z', ellipse: 'M3 12a9 6 0 1 0 18 0a9 6 0 1 0-18 0',
  triangle: 'M12 4l9 16H3z', diamond: 'M12 3l9 9-9 9-9-9z', star: 'M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 16.8 6.4 20l1.4-6.2L3 9.5l6.4-.6z',
  hexagon: 'M7 4h10l5 8-5 8H7l-5-8z',
  cylinder: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6',
  cone: 'M12 3L5 18M12 3l7 15M5 18c0 1.7 3.1 3 7 3s7-1.3 7-3-3.1-3-7-3-7 1.3-7 3z',
  sphere: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5',
  pyramid: 'M12 3L3 17l9 4 9-4zM12 3v18',
  prism: 'M3 17l5-11 13 3-5 11zM8 6l-5 11M16 20l5-11M8 6l8 14',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  flip: 'M12 3v18M8 7L3 12l5 5zM16 7l5 5-5 5z', flipv: 'M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z', front: 'M9 9h11v11H9zM4 4h11v3M4 4v11h3', back: 'M4 4h11v11H4zM20 9v11H9v-3M20 9h-3',
  dup: 'M8 8h12v12H8zM16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3', download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6', file: 'M6 3h8l5 5v13H6zM14 3v5h5', folder: 'M3 6h6l2 2h10v11H3z',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z', italic: 'M10 4h8M6 20h8M14 4L10 20', path: 'M3 17c4-8 8 4 12-4 2-4 4-5 6-5'
};
ui.icon = (name, size) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; } const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', I[name] || I.x); s.append(p); return s; };
ui.ICONS = I;
function hydrateIcons(root) { $$('[data-icon]', root).forEach(b => { if (!b.querySelector('svg')) b.prepend(ui.icon(b.dataset.icon)); }); }

/* =============== toasts / bubbles / banner =============== */
SF.toast = (msg, ms, action) => {
  const box = $('#toasts'); while (box.children.length > 2) box.firstChild.remove();
  const t = el('div', { class: 'toast' }, msg);
  if (action) t.append(el('button', { onclick: () => { action.fn(); t.remove(); } }, action.label));
  box.append(t); setTimeout(() => t.remove(), ms || (action ? 5000 : 2200));
};
ui.say = (text, secs) => {
  const b = el('div', { class: 'say' }, el('b', null, 'AI'), el('span', null, text), el('button', { 'aria-label': 'Dismiss', onclick: () => b.remove() }, '×'));
  const box = $('#aiSay'); box.append(b); while (box.children.length > 3) box.firstChild.remove();
  if (secs !== 0) setTimeout(() => b.remove(), (secs || 20) * 1000);
};
ui.banner = (text) => {
  const b = $('#banner');
  if (!text) { b.hidden = true; $('#sendBtn').classList.remove('pulse'); return; }
  b.innerHTML = ''; b.append(el('span', null, 'AI is waiting: ' + text), el('button', { onclick: () => ui.openSend() }, 'Send sketch'));
  b.hidden = false; $('#sendBtn').classList.add('pulse');
};

/* =============== rail & top bars =============== */
function bindRail() {
  $$('#rail [data-tool]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === P().tool && t === 'pen') { const br = ['pen', 'pencil', 'marker', 'brush']; P().brush = br[(br.indexOf(P().brush) + 1) % 4]; SF.toast('Brush · ' + P().brush, 800); }
    if (t === P().tool && t === 'shape') { const i = SF.SHAPES.indexOf(P().shape); P().shape = SF.SHAPES[(i + 1) % SF.SHAPES.length]; SF.toast('Shape · ' + P().shape, 800); }
    SF.setTool(t);
  }));
  $('#undoBtn').onclick = () => SF.undo(); $('#redoBtn').onclick = () => SF.redo();
  $('#fUndo').onclick = () => SF.undo(); $('#fRedo').onclick = () => SF.redo();
  $('#scrub').addEventListener('input', (e) => SF.goHistory(+e.target.value));
  $('#spaceBtn').onclick = () => ui.openHub('space');
  $('#snapBtn').onclick = () => ui.toggle('snap');
  $('#lightBtn').onclick = () => ui.toggle('lightbox');
  $('#zoomLbl').onclick = () => SF.fit();
  $('#copyBtn').onclick = () => SF.io.copy('flat');
  $('#importBtn').onclick = () => $('#fileIn').click();
  $('#layersBtn').onclick = () => ui.toggleLayers();
  $('#hubBtn').onclick = () => ui.openHub();
  $('#sendBtn').onclick = () => ui.openSend();
  $('#aiChip').onclick = () => ui.openHub('help');
  $('#focusExit').onclick = () => ui.toggleFocus(false);
  const bn = $('#boardName');
  bn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); bn.blur(); } });
  bn.addEventListener('blur', () => { const v = bn.textContent.trim().slice(0, 80) || 'Board'; if (v !== SF.doc.name) { SF.doc.name = v; SF.emit('change', 'rename'); } bn.textContent = v; });
}
ui.toggle = (what) => {
  const g = SF.doc.guides;
  if (what === 'snap') { P().snap = !P().snap; SF.savePrefs(); SF.toast(P().snap ? 'Snap & join on' : 'Snap off — free drawing', 900); }
  if (what === 'lightbox') { g.lightbox = !g.lightbox; SF.toast(g.lightbox ? 'Lightbox on: layers below are faded' : 'Lightbox off', 1000); SF.emit('change', 'guides'); }
  if (what === 'grid') { g.space = g.space === 'grid' ? 'free' : 'grid'; SF.emit('change', 'guides'); SF.toast('Space · ' + SF.SPACES[g.space].name, 800); }
  syncTop(); SF.requestRender();
};
ui.cycleSpace = (dir) => {
  const g = SF.doc.guides, o = SF.SPACE_ORDER; g.space = o[(o.indexOf(g.space) + (dir || 1) + o.length) % o.length];
  SF.toast('Space · ' + SF.SPACES[g.space].name, 900); SF.emit('change', 'guides'); syncTop(); SF.requestRender();
};
ui.setSpace = (s) => { SF.doc.guides.space = s; SF.emit('change', 'guides'); syncTop(); SF.requestRender(); };
function syncTop() {
  const H = SF.history, g = SF.doc.guides;
  $('#undoBtn').disabled = H.i <= 0; $('#redoBtn').disabled = H.i >= H.states.length - 1;
  const s = $('#scrub'); s.max = Math.max(0, H.states.length - 1); s.value = H.i;
  $('#snapBtn').classList.toggle('soft-on', !!P().snap);
  $('#lightBtn').classList.toggle('soft-on', !!g.lightbox);
  $('#spaceBtn').classList.toggle('soft-on', g.space !== 'free');
  $('#spaceBadge').textContent = { free: '', grid: '#', iso: 'ISO', p1: '1P', p2: '2P', p3: '3P', v3: '3V', v4: '4V' }[g.space] || '';
  $('#zoomLbl').textContent = Math.round(SF.view.z * 100) + '%';
  $$('#rail [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === P().tool));
  const pb = $('#rail [data-tool="pen"]'); if (pb) { pb.innerHTML = ''; pb.append(ui.icon(P().brush === 'pen' ? 'pen' : P().brush)); }
  const sb = $('#rail [data-tool="shape"]'); if (sb) { sb.innerHTML = ''; sb.append(ui.icon(P().shape)); }
}
ui.syncTop = syncTop;

/* =============== vertical sliders =============== */
function sliderKey() {
  const t = P().tool;
  if (t === 'pen') return P().brush; if (t === 'shape') return 'shape'; if (t === 'eraser') return 'eraser'; if (t === 'text') return 'text'; if (t === 'dim') return 'dim';
  if (t === 'select' && SF.sel.ids.size) return '_sel';
  return P().brush;
}
const SIZE_MIN = 0.5, SIZE_MAX = 240;
const sizeToT = (v) => Math.log(v / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN), tToSize = (t) => SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, t);
function selSize() { const it = SF.sel.items()[0]; if (!it) return 4; return it.t === 'text' ? it.size : it.t === 'path' ? it.width : it.t === 'dim' ? it.width : 4; }
function selOp() { const it = SF.sel.items()[0]; return it ? (it.opacity == null ? 1 : it.opacity) : 1; }
function slider(elm, get, set, fmt, done) {
  const fill = $('.fill', elm), knob = $('.knob', elm), bub = $('.bubble', elm);
  const draw = () => { const t = U.clamp(get(), 0, 1); fill.style.height = (t * 100) + '%'; knob.style.bottom = `calc(${t * 100}% - 3px)`; bub.textContent = fmt(); bub.style.bottom = `calc(${t * 100}% - 10px)`; };
  let drag = false;
  const at = (e) => { const r = elm.getBoundingClientRect(); set(U.clamp(1 - (e.clientY - r.top) / r.height, 0, 1)); draw(); };
  elm.addEventListener('pointerdown', (e) => { drag = true; elm.classList.add('drag'); elm.setPointerCapture(e.pointerId); at(e); });
  elm.addEventListener('pointermove', (e) => { if (drag) at(e); });
  const end = () => { if (!drag) return; drag = false; elm.classList.remove('drag'); done && done(); };
  elm.addEventListener('pointerup', end); elm.addEventListener('pointercancel', end);
  return { draw };
}
let sizeS, opS;
function bindSliders() {
  sizeS = slider($('#sizeS'), () => { const k = sliderKey(); return sizeToT(k === '_sel' ? selSize() : P().sizes[k]); },
    (t) => { const k = sliderKey(), v = Math.round(tToSize(t) * 10) / 10; if (k === '_sel') ui._selSize = v; else { P().sizes[k] = v; SF.savePrefs(); SF.restyleText && SF.restyleText({ size: v }); } SF.requestRender(); },
    () => { const k = sliderKey(); return (k === '_sel' ? (ui._selSize || selSize()) : P().sizes[k]).toFixed(1) + ' px'; },
    () => { if (sliderKey() === '_sel' && ui._selSize) { const v = ui._selSize; ui._selSize = null; SF.applyToSelection(it => it.t === 'path' ? Object.assign({}, it, { width: v }) : it.t === 'text' ? Object.assign({}, it, { size: v }) : it.t === 'dim' ? Object.assign({}, it, { width: v }) : it, 'Resize stroke'); } });
  opS = slider($('#opS'), () => { const k = sliderKey(); return k === '_sel' ? (ui._selOp == null ? selOp() : ui._selOp) : P().opac[k]; },
    (t) => { const k = sliderKey(), v = Math.round(U.clamp(t, 0.03, 1) * 100) / 100; if (k === '_sel') ui._selOp = v; else { P().opac[k] = v; SF.savePrefs(); SF.restyleText && SF.restyleText({ opacity: v }); } },
    () => { const k = sliderKey(); return Math.round((k === '_sel' ? (ui._selOp == null ? selOp() : ui._selOp) : P().opac[k]) * 100) + '%'; },
    () => { if (sliderKey() === '_sel' && ui._selOp != null) { const v = ui._selOp; ui._selOp = null; SF.applyToSelection(it => Object.assign({}, it, { opacity: v }), 'Opacity'); } });
}
ui.nudge = (which, dir) => {
  const k = sliderKey(); if (k === '_sel') return;
  if (which === 'size') { const v = P().sizes[k]; P().sizes[k] = U.clamp(Math.round((dir > 0 ? v * 1.2 + 0.5 : v / 1.2 - 0.2) * 10) / 10, SIZE_MIN, SIZE_MAX); SF.toast('Size ' + P().sizes[k] + ' px', 600); }
  else { P().opac[k] = U.clamp(Math.round((P().opac[k] + dir * 0.1) * 10) / 10, 0.1, 1); SF.toast('Opacity ' + Math.round(P().opac[k] * 100) + '%', 600); }
  SF.savePrefs(); sizeS.draw(); opS.draw(); SF.requestRender();
};

/* =============== context strip =============== */
function seg(items, cur, onPick) {
  const s = el('div', { class: 'seg' });
  for (const [val, label, icon] of items) {
    const b = el('button', { class: val === cur ? 'on' : '', title: label, 'aria-label': label, onclick: () => { onPick(val); } });
    if (icon) b.append(ui.icon(icon)); if (label && !icon) b.append(label); else if (label && icon && items.length <= 4) b.append(label);
    s.append(b);
  }
  return s;
}
function mini(label, input) { return el('label', { class: 'mini' }, label, input); }
function range(min, max, step, val, oninput, onchange) { const r = el('input', { type: 'range', min, max, step, value: val }); r.addEventListener('input', () => oninput(+r.value)); if (onchange) r.addEventListener('change', () => onchange(+r.value)); r.addEventListener('pointerdown', e => e.stopPropagation()); return r; }
function tbtn(label, icon, fn, cls) { const b = el('button', { class: 'tbtn ' + (cls || ''), onclick: fn }); if (icon) b.append(ui.icon(icon)); b.append(label); return b; }
function buildCtx() {
  const c = $('#ctx'); c.innerHTML = '';
  const t = P().tool, add = (...n) => c.append(...n);
  if (t === 'pen') {
    add(el('span', { class: 'lbl' }, 'Brush'), seg([['pen', 'Pen', 'pen'], ['pencil', 'Pencil', 'pencil'], ['marker', 'Marker', 'marker'], ['brush', 'Brush', 'brush']], P().brush, (v) => { P().brush = v; SF.savePrefs(); refresh(); }));
    add(mini('Steady', range(0, 0.95, 0.05, P().steady, v => { P().steady = v; SF.savePrefs(); })));
    add(tbtn('Hold → shape', 'shapes', () => { P().holdSnap = !P().holdSnap; SF.savePrefs(); refresh(); }, P().holdSnap ? 'on' : ''));
    add(lineTypeSeg(), snapChips());
  } else if (t === 'shape') {
    add(seg(SF.SHAPES2D.map(s => [s, s, s]), P().shape, (v) => { P().shape = v; SF.savePrefs(); refresh(); }));
    add(el('div', { style: 'display:flex;align-items:center;gap:4px' }, el('span', { class: 'lbl' }, '3D'), seg(SF.PRIMS.map(s => [s, s === 'box' ? 'Box' : s, s]), P().shape, (v) => { P().shape = v; SF.savePrefs(); refresh(); const sp = SF.doc.guides.space; SF.toast(sp === 'v3' || sp === 'v4' ? 'Drag in the FRONT view — top and side views draw themselves' + (sp === 'v4' ? ', plus the 3D view' : '') : 'Drag a box to size it · Shift = equal sides', 1800); })));
    add(seg([['outline', 'Line'], ['fill', 'Fill'], ['both', 'Both']], P().shapeFill, (v) => { P().shapeFill = v; SF.savePrefs(); refresh(); }));
    add(lineTypeSeg());
    if (SF.PRIMS.includes(P().shape)) {
      add(el('div', { style: 'display:flex;align-items:center;gap:4px' }, el('span', { class: 'lbl' }, 'Base from'),
        seg([['auto', 'Auto'], ['corner', 'Corner'], ['centre', 'Centre']], P().primBase || 'auto', (v) => { P().primBase = v; SF.savePrefs(); refresh(); SF.toast(v === 'corner' ? 'Drag from a corner to the opposite corner — the base stretches to fit' : v === 'centre' ? 'Drag out from the centre — the base grows equally both ways' : 'Starts on a centre ⊕ → from centre, otherwise from a corner', 1800); })));
      add(tbtn('Hidden edges', 'eye', () => { P().showHidden = P().showHidden === false; SF.savePrefs(); refresh(); }, P().showHidden !== false ? 'on' : ''));
      add(tbtn('Height dim', 'dim', () => { P().primDim = P().primDim === false; SF.savePrefs(); refresh(); }, P().primDim !== false ? 'on' : ''));
      add(el('span', { class: 'mini' }, '1 · drag the base  2 · move up + click, or type the height'));
    }
    if (P().shape === 'line' || P().shape === 'arrow') add(snapChips());
  } else if (t === 'eraser') {
    add(el('span', { class: 'lbl' }, 'Erase'), seg([['cut', 'Cut lines'], ['whole', 'Whole items'], ['pixels', 'Photo pixels']], P().eraseMode, (v) => { P().eraseMode = v; SF.savePrefs(); refresh(); }));
    add(tbtn('Clear layer', 'trash', () => { const L = SF.layer(); if (!L || !L.items.length) return; SF.setItems(L, []); SF.commit('Clear layer'); SF.toast('Layer cleared', 3000, { label: 'Undo', fn: SF.undo }); }, 'danger'));
  } else if (t === 'fill') {
    add(mini('Tolerance', range(0, 80, 1, P().fillTol, v => { P().fillTol = v; SF.savePrefs(); })));
    add(seg([['all', 'All layers'], ['layer', 'This layer']], P().fillAll ? 'all' : 'layer', (v) => { P().fillAll = v === 'all'; SF.savePrefs(); refresh(); }));
    add(el('span', { class: 'mini' }, 'Tap = fill · Hold = shape fill that follows its lines · tap a fill or line to recolour'));
  } else if (t === 'text') {
    add(seg(Object.keys(SF.FONTS).map(k => [k, SF.FONTS[k].name]), P().font, (v) => { P().font = v; SF.savePrefs(); SF.restyleText({ font: v }); refresh(); }));
    add(seg([['b', '', 'bold'], ['i', '', 'italic']], '', (v) => { if (v === 'b') { P().bold = !P().bold; SF.restyleText({ bold: P().bold }); } else { P().italic = !P().italic; SF.restyleText({ italic: P().italic }); } SF.savePrefs(); refresh(); }));
    $$('.seg', c)[1].children[0].classList.toggle('on', P().bold); $$('.seg', c)[1].children[1].classList.toggle('on', P().italic);
    const tmode = P().textMode || (P().onPath ? 'path' : 'free');
    add(seg([['free', 'Free'], ['path', 'Along a line'], ['surface', 'On a surface']], tmode, (v) => {
      P().textMode = v; P().onPath = v === 'path'; SF.savePrefs(); refresh();
      SF.toast(v === 'path' ? 'Tap a line to write along it' : v === 'surface' ? 'Tap inside a 4-sided face (box side, plane, rectangle) to write on it' : 'Text goes where you tap', 1600);
    }));
  } else if (t === 'select') {
    const has = SF.sel.ids.size > 0;
    add(el('span', { class: 'lbl' }, has ? SF.sel.ids.size + ' selected' : 'Tap or drag a box'));
    if (has) {
      add(tbtn('Duplicate', 'dup', SF.selectionActions.dup), tbtn('Front', 'front', SF.selectionActions.front), tbtn('Back', 'back', SF.selectionActions.back),
        tbtn('Flip', 'flip', () => SF.selectionActions.flip(true)), tbtn('Flip', 'flipv', () => SF.selectionActions.flip(false)), tbtn('Delete', 'trash', SF.selectionActions.del, 'danger'));
      const selItems = SF.sel.items(), tx = selItems.find(i => i.t === 'text');
      const selPaths = selItems.filter(i => i.t === 'path' && i.stroke !== false);
      if (selPaths.length) add(lineTypeSeg(SF.lineType(selPaths[0]), (v) => SF.applyToSelection(it => (it.t === 'path' && it.stroke !== false ? Object.assign({}, it, { lt: v === 'solid' ? undefined : v, dash: false }) : it), 'Line type · ' + SF.LINE_TYPES[v])));
      if (tx) add(seg(Object.keys(SF.FONTS).map(k => [k, SF.FONTS[k].name]), tx.font, (v) => SF.applyToSelection(it => it.t === 'text' ? Object.assign({}, it, { font: v }) : it, 'Font')));
      const onLine = selItems.filter(i => i.t === 'text' && i.pathId), lines = selItems.filter(i => i.t === 'path' && i.stroke !== false && i.pts.length >= 6);
      const onSurf = selItems.filter(i => i.t === 'text' && i.quad), faces = selItems.filter(i => SF.faceOfItem(i)), texts = selItems.filter(i => i.t === 'text');
      if (onSurf.length) {
        add(el('span', { class: 'mini' }, 'Drag to slide it across the face'));
        add(tbtn('Turn on face', 'redo', () => SF.applyToSelection(it => (it.t === 'text' && it.quad ? SF.turnOnSurface(it) : it), 'Turn text on face')));
        add(tbtn('Take off surface', 'path', () => SF.applyToSelection(it => (it.t === 'text' && it.quad ? SF.detachSurfaceText(it) : it), 'Take text off surface')));
      } else if (texts.length === 1 && faces.length === 1 && !texts[0].pathId) {
        const f = SF.faceOfItem(faces[0]);
        add(tbtn('Put on surface', 'box', () => SF.applyToSelection(it => (it.t === 'text' ? Object.assign({}, it, { quad: f.quad, surf: f.refs, su: 0, sv: 0, align: 'center', pathId: null }) : it), 'Put text on surface')));
      }
      if (onLine.length) {
        add(el('span', { class: 'mini' }, 'Drag text to slide it along / lift it off its line'));
        add(tbtn('Detach from line', 'path', () => SF.applyToSelection(it => (it.t === 'text' && it.pathId ? SF.detachPathText(it) : it), 'Detach text')));
      } else if (tx && lines.length === 1 && selItems.filter(i => i.t === 'text').length === 1) {
        add(tbtn('Attach to line', 'path', () => SF.applyToSelection(it => (it.t === 'text' ? Object.assign({}, it, { pathId: lines[0].id, offset: 0, lift: 0, align: 'center' }) : it), 'Attach text to line')));
      } else if (tx) add(el('span', { class: 'mini' }, 'Shift-tap a line too to attach the text to it'));
    } else add(tbtn('Select all', 'select', SF.selectionActions.all));
  } else if (t === 'joint') {
    add(el('span', { class: 'mini' }, 'Drag a dot to bend · drop on another to join · drop on a midpoint ▲ or centre ⊕ to connect · drag a line to add a bend · double-tap to remove · Alt = detach'));
    add(snapChips());
  } else if (t === 'dim') {
    add(el('span', { class: 'mini' }, 'Drag between joints · tap the number to set it · drag the number to move it (and pick the plane)'));
    add(el('span', { class: 'lbl' }, 'Ext lines'), seg([['planes', 'Follow planes'], ['square', 'Square']], P().dimPlanes === false ? 'square' : 'planes', (v) => { P().dimPlanes = v === 'planes'; SF.savePrefs(); refresh(); }));
    const us = el('select', null, ...['px', 'mm', 'cm', 'm', 'in', 'ft'].map(u => el('option', { value: u, selected: P().units === u }, u)));
    us.onchange = () => { P().units = us.value; SF.savePrefs(); SF.invalidate(); };
    const sc = el('input', { type: 'number', step: 'any', min: '0', value: P().unitScale });
    sc.onchange = () => { P().unitScale = Math.max(1e-6, +sc.value || 1); SF.savePrefs(); SF.invalidate(); };
    sc.addEventListener('keydown', e => e.stopPropagation());
    add(mini('Units', us), mini('per px', sc));
    const pr = el('select', null, ...[0, 1, 2, 3].map(n => el('option', { value: n, selected: (P().dimPrec || 0) === n }, n + ' dp'))); pr.onchange = () => { P().dimPrec = +pr.value; SF.savePrefs(); SF.invalidate(); };
    add(pr);
  } else if (t === 'pick') add(el('span', { class: 'mini' }, 'Tap anywhere to pick its colour (or hold Alt while drawing)'));
  else if (t === 'hand') add(el('span', { class: 'mini' }, 'Drag to pan · pinch or Ctrl+wheel to zoom'));
  if (SF.motion && (t === 'joint' || t === 'select')) add(tbtn('Motion', 'motion', () => SF.motion.toggle(), SF.motion.editing ? 'on' : ''));
}

/* line type picker (new strokes by default; pass value + handler to restyle a selection) */
function lineTypeSeg(cur, onPick) {
  const v = cur || P().lineType || 'solid';
  return el('div', { style: 'display:flex;align-items:center;gap:4px' }, el('span', { class: 'lbl' }, 'Line'),
    seg(Object.keys(SF.LINE_TYPES).map(k => [k, SF.LINE_TYPES[k]]), v, onPick || ((t) => { P().lineType = t; SF.savePrefs(); refresh(); if (t === 'construction') SF.toast('Construction lines are guides: they snap, but never print, export or block fills', 2200); })));
}
/* connector snap toggles */
function snapChips() {
  const chip = (key, label, tip) => { const on = P()[key] !== false; return el('button', { class: on ? 'on' : '', title: tip, 'aria-pressed': on ? 'true' : 'false', onclick: () => { P()[key] = !on; SF.savePrefs(); refresh(); } }, label); };
  const s2 = el('div', { class: 'seg' }, chip('snapMid', '▲ Mid', 'Snap to segment midpoints (lines stay connected)'), chip('snapCtr', '⊕ Centre', 'Snap to shape centres (lines stay connected)'), chip('snapPerp', '⊥ Perp', 'Square off a line, or land perpendicular on another line'));
  return el('div', { style: 'display:flex;align-items:center;gap:4px' }, el('span', { class: 'lbl' }, 'Snap'), s2);
}
function refresh() { buildCtx(); syncTop(); sizeS && sizeS.draw(); opS && opS.draw(); }
ui.refresh = refresh;

/* =============== colour dock =============== */
SF.setColor = (c, fromUser) => {
  c = U.normColor(c); P().color = c;
  const r = P().recent.filter(x => x !== c); r.unshift(c); P().recent = r.slice(0, 8); SF.savePrefs();
  if (SF.restyleText && SF.restyleText({ color: c })) { /* recoloured text being typed */ }
  else if (P().tool === 'select' && SF.sel.ids.size && fromUser !== false) {
    SF.applyToSelection(it => {
      if (it.t === 'path') return Object.assign({}, it, { color: c }, it.fill ? { fill: c } : {});
      if (it.t === 'image' && it.fill) return Object.assign({}, it, { img: SF.retint(it.img, c), fill: c });
      if (it.t === 'text' || it.t === 'dim') return Object.assign({}, it, { color: c });
      return it;
    }, 'Recolour');
  }
  buildDock();
};
function buildDock() {
  const pal = SF.PALETTES[P().palette] || SF.PALETTES.ink;
  $('#well').style.background = P().color;
  const sw = $('#swatches'); sw.innerHTML = '';
  pal.c.forEach(c => sw.append(el('button', { class: 'sw' + (c === P().color ? ' on' : ''), style: 'background:' + c, title: c, 'aria-label': 'Colour ' + c, onclick: () => SF.setColor(c) })));
  const rc = $('#recent'); rc.innerHTML = '';
  P().recent.filter(c => !pal.c.includes(c)).slice(0, 6).forEach(c => rc.append(el('button', { class: 'sw' + (c === P().color ? ' on' : ''), style: 'background:' + c, title: c, 'aria-label': 'Recent ' + c, onclick: () => SF.setColor(c) })));
  $('#palName').textContent = pal.name;
}
function bindDock() {
  const ci = $('#colorIn');
  $('#well').onclick = () => { ci.value = P().color; ci.click(); };
  ci.addEventListener('input', () => { $('#well').style.background = ci.value; });
  ci.addEventListener('change', () => SF.setColor(ci.value));
  $('#palName').onclick = () => { const k = Object.keys(SF.PALETTES); P().palette = k[(k.indexOf(P().palette) + 1) % k.length]; SF.savePrefs(); buildDock(); SF.toast('Palette · ' + SF.PALETTES[P().palette].name, 800); };
}

/* =============== layers drawer =============== */
ui.toggleLayers = (open) => { const d = $('#layers'); const o = open == null ? d.classList.contains('closed') : open; d.classList.toggle('closed', !o); $('#layersBtn').classList.toggle('soft-on', o); if (o) buildLayers(); };
ui.addLayer = (name) => { const L = SF.mkLayer(name || ('Layer ' + (SF.doc.layers.length + 1))); const i = SF.layerIndex(); SF.doc.layers.splice(i + 1, 0, L); SF.doc.active = L.id; SF.commit('New layer'); SF.emit('layers'); SF.toast('New layer · ' + L.name, 900); return L; };
const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Dodge'], ['difference', 'Difference']];
const expanded = {}, openGroups = {}, showAll = {};
function colorPop(anchor, current, onPick) {
  let pop = $('#colorPop'); if (pop) pop.remove();
  pop = el('div', { id: 'colorPop', role: 'dialog', 'aria-label': 'Choose colour' });
  const pal = SF.PALETTES[P().palette] || SF.PALETTES.ink;
  const head = el('div', { class: 'row', style: 'justify-content:space-between' }, el('b', { style: 'font:700 13px var(--f-brand)' }, 'Colour'),
    el('button', { class: 'tbtn', onclick: (e) => { e.stopPropagation(); const k = Object.keys(SF.PALETTES); P().palette = k[(k.indexOf(P().palette) + 1) % k.length]; SF.savePrefs(); buildDock(); colorPop(anchor, current, onPick); } }, pal.name + ' ›'));
  const grid = el('div', { class: 'cgrid' });
  const pick = (c) => { pop.remove(); onPick(c); };
  pal.c.forEach(c => grid.append(el('button', { class: 'sw' + (U.normColor(c) === current ? ' on' : ''), style: 'background:' + c, title: c, 'aria-label': c, onclick: () => pick(U.normColor(c)) })));
  const rec = el('div', { class: 'cgrid' }); P().recent.slice(0, 6).forEach(c => rec.append(el('button', { class: 'sw', style: 'background:' + c, title: c, 'aria-label': 'Recent ' + c, onclick: () => pick(c) })));
  const ci = el('input', { type: 'color', value: current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000', 'aria-label': 'Custom colour' });
  ci.addEventListener('change', () => pick(ci.value));
  pop.append(head, grid, P().recent.length ? el('span', { class: 'mini', style: 'padding:0' }, 'Recent') : null, P().recent.length ? rec : null, el('label', { class: 'mini', style: 'padding:0;justify-content:space-between' }, 'Custom', ci));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = U.clamp(r.left - 240, 8, innerWidth - 248) + 'px'; pop.style.top = U.clamp(r.top - 10, 8, innerHeight - pop.offsetHeight - 8) + 'px';
  setTimeout(() => { const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0);
}
ui.colorPop = colorPop;
function recolor(L, ids, c, label) {
  const set = new Set(ids); SF.setItems(L, L.items.map(it => (set.has(it.id) ? SF.recolorItem(it, c) : it))); SF.commit(label);
  const r = P().recent.filter(x => x !== c); r.unshift(c); P().recent = r.slice(0, 8); SF.savePrefs(); buildDock();
}
SF.colorByType = () => {
  const tc = SF.typeColors(); let n = 0;
  for (const L of SF.doc.layers) { if (L.locked) continue; SF.setItems(L, L.items.map(it => { if (it.t === 'image' && !it.fill) return it; n++; return SF.recolorItem(it, tc[SF.kindOf(it).group]); })); }
  if (n) { SF.commit('Colour by type'); SF.toast('Each type now has its own colour from “' + (SF.PALETTES[P().palette] || {}).name + '”', 2000, { label: 'Undo', fn: SF.undo }); }
  else SF.toast('Nothing to colour yet');
};
function domColor(items) { const cnt = new Map(); for (const it of items) { const c = SF.itemColor(it); if (c) cnt.set(c, (cnt.get(c) || 0) + 1); } let best = null, bn = 0; for (const [c, n] of cnt) if (n > bn) { bn = n; best = c; } return best; }
function swatchBtn(color, tip, onPick) {
  const b = el('button', { class: 'sw-mini', 'data-tip': tip, 'aria-label': tip, style: color ? 'background:' + color : 'background:repeating-conic-gradient(#bbb 0 25%,#fff 0 50%) 0 0/8px 8px' });
  b.onclick = (e) => { e.stopPropagation(); colorPop(b, color, onPick); }; return b;
}
function actBtn(icon, tip, on, fn) { const b = el('button', { class: 'ib' + (on ? ' soft-on' : ''), 'data-tip': tip, 'aria-label': tip, onclick: (e) => { e.stopPropagation(); fn(); } }); b.append(ui.icon(icon)); return b; }
function buildLayers() {
  const box = $('#lList'); if ($('#layers').classList.contains('closed')) return;
  const keepScroll = box.scrollTop;
  box.innerHTML = '';
  const d = SF.doc, selIds = SF.sel.ids;
  [...d.layers].reverse().forEach(L => {
    const open = expanded[L.id] != null ? expanded[L.id] : L.id === d.active;
    const items = SF.layerItems(L);
    const th = SF.layerThumb(L, 104, 76); th.style.width = '52px'; th.style.height = '38px';
    const nm = el('div', { class: 'nm', title: 'Double-click to rename' }, L.name);
    nm.addEventListener('dblclick', (e) => { e.stopPropagation(); nm.contentEditable = 'true'; nm.focus(); document.execCommand && document.execCommand('selectAll', false, null); });
    nm.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } });
    nm.addEventListener('blur', () => { nm.contentEditable = 'false'; const v = nm.textContent.trim() || L.name; if (v !== L.name) { L.name = v; SF.commit('Rename layer'); } });
    const chev = el('button', { class: 'chev' + (open ? ' open' : ''), 'aria-label': open ? 'Collapse' : 'Expand', onclick: (e) => { e.stopPropagation(); expanded[L.id] = !open; buildLayers(); } }); chev.append(ui.icon('play', 10));
    const lc = domColor(items);
    const row = el('div', { class: 'lrow layer' + (L.id === d.active ? ' on' : ''), onclick: () => { d.active = L.id; SF.sel.clear(); SF.emit('layers'); SF.requestRender(); } },
      chev, th, el('div', { style: 'min-width:0' }, nm, el('div', { class: 'meta' }, `${items.length} items · ${Math.round(L.opacity * 100)}%${L.ref ? ' · ref' : ''}${L.blend !== 'source-over' ? ' · ' + (BLENDS.find(b => b[0] === L.blend) || [0, L.blend])[1] : ''}`)),
      el('div', { class: 'acts' },
        swatchBtn(lc, 'Recolour whole layer', (c) => recolor(L, L.items.filter(i => !(i.t === 'image' && !i.fill)).map(i => i.id), c, 'Recolour layer')),
        actBtn(L.visible ? 'eye' : 'eyeoff', L.visible ? 'Hide layer' : 'Show layer', !L.visible, () => { L.visible = !L.visible; SF.commit(L.visible ? 'Show layer' : 'Hide layer'); SF.emit('layers'); }),
        actBtn(L.locked ? 'lock' : 'unlock', L.locked ? 'Unlock layer' : 'Lock layer', L.locked, () => { L.locked = !L.locked; SF.commit(L.locked ? 'Lock layer' : 'Unlock layer'); SF.emit('layers'); }),
        actBtn('ref', L.ref ? 'Reference (not exported) — tap to make normal' : 'Make reference / underlay', L.ref, () => { L.ref = !L.ref; if (L.ref && L.opacity > 0.6) L.opacity = 0.5; SF.commit(L.ref ? 'Reference layer' : 'Normal layer'); SF.emit('layers'); })));
    box.append(row);
    if (!open) return;
    if (!items.length) { box.append(el('div', { class: 'lempty' }, 'Empty — draw something and it shows up here')); return; }
    /* type groups, newest item first inside each group */
    const groups = new Map(); const counters = {};
    items.forEach(it => { const k = SF.kindOf(it); counters[k.label] = (counters[k.label] || 0) + 1; const entry = { it, k, n: counters[k.label] }; if (!groups.has(k.group)) groups.set(k.group, []); groups.get(k.group).push(entry); });
    SF.GROUPS.filter(g => groups.has(g)).forEach(gname => {
      const list = groups.get(gname).slice().reverse(), key = L.id + ':' + gname;
      const gOpen = openGroups[key] != null ? openGroups[key] : list.length <= 14;
      const ids = list.map(e => e.it.id), allHidden = list.every(e => e.it.hidden), gc = domColor(list.map(e => e.it));
      const gch = el('button', { class: 'chev' + (gOpen ? ' open' : ''), 'aria-label': gOpen ? 'Collapse group' : 'Expand group', onclick: (e) => { e.stopPropagation(); openGroups[key] = !gOpen; buildLayers(); } }); gch.append(ui.icon('play', 9));
      const grow = el('div', { class: 'grow', title: 'Select all ' + gname.toLowerCase(), onclick: () => { d.active = L.id; SF.setTool('select'); SF.sel.set(ids.filter(id => { const f = list.find(e => e.it.id === id); return !f.it.hidden && !f.it.locked; }), L.id); } },
        gch, el('span', null, gname + ' · ' + list.length),
        el('div', { class: 'acts' },
          swatchBtn(gc, 'Recolour all ' + gname.toLowerCase(), (c) => recolor(L, ids, c, 'Recolour ' + gname.toLowerCase())),
          actBtn(allHidden ? 'eyeoff' : 'eye', allHidden ? 'Show group' : 'Hide group', allHidden, () => { const set = new Set(ids); SF.setItems(L, L.items.map(i => (set.has(i.id) ? Object.assign({}, i, { hidden: !allHidden }) : i))); SF.commit(allHidden ? 'Show ' + gname : 'Hide ' + gname); })));
      box.append(grow);
      if (!gOpen) return;
      const lim = showAll[key] ? list.length : Math.min(list.length, 60);
      list.slice(0, lim).forEach(({ it, k, n }) => {
        const label = it.name || (k.label + ' ' + n);
        const t = U.canvas(1, 1); const tc = SF.itemThumb(it, 44, 32); t.width = tc.width; t.height = tc.height; t.getContext('2d').drawImage(tc, 0, 0);
        const inm = el('div', { class: 'nm', title: 'Double-click to rename' }, label);
        inm.addEventListener('dblclick', (e) => { e.stopPropagation(); inm.contentEditable = 'true'; inm.focus(); document.execCommand && document.execCommand('selectAll', false, null); });
        inm.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); inm.blur(); } if (e.key === 'Escape') { inm.textContent = label; inm.blur(); } });
        inm.addEventListener('blur', () => { inm.contentEditable = 'false'; const v = inm.textContent.trim(); if (v && v !== label) { SF.replaceItem(L, Object.assign({}, it, { name: v })); SF.commit('Rename item'); } });
        const sub = it.t === 'path' ? (it.stroke === false ? 'fill' : (Math.round(it.width * 10) / 10) + ' px') : it.t === 'text' ? (SF.FONTS[it.font] || SF.FONTS.sans).name + ' ' + Math.round(it.size) : it.t === 'dim' ? SF.fmtLen(SF.dimGeom(it).len) : it.t === 'image' ? it.iw + '×' + it.ih : '';
        const irow = el('div', { class: 'irow' + (selIds.has(it.id) ? ' on' : '') + (it.hidden ? ' hid' : ''), 'data-id': it.id,
          onclick: (e) => {
            if (it.hidden || it.locked) { SF.toast(it.hidden ? 'Hidden — show it first' : 'Locked — unlock it first', 1200); return; }
            d.active = L.id; SF.setTool('select');
            if (e.shiftKey && SF.sel.layerId === L.id) { const s2 = new Set(SF.sel.ids); s2.has(it.id) ? s2.delete(it.id) : s2.add(it.id); SF.sel.set(s2, L.id); } else SF.sel.set([it.id], L.id);
          } },
          t, el('div', { style: 'min-width:0' }, inm, el('div', { class: 'meta' }, sub + (it.bind ? ' · follows outline' : '') + (it.locked ? ' · locked' : ''))),
          el('div', { class: 'acts' },
            swatchBtn(SF.itemColor(it), 'Colour', (c) => recolor(L, [it.id], c, 'Recolour ' + label)),
            actBtn(it.hidden ? 'eyeoff' : 'eye', it.hidden ? 'Show' : 'Hide', it.hidden, () => { SF.replaceItem(L, Object.assign({}, it, { hidden: !it.hidden })); if (!it.hidden) SF.sel.ids.delete(it.id); SF.commit(it.hidden ? 'Show item' : 'Hide item'); }),
            actBtn(it.locked ? 'lock' : 'unlock', it.locked ? 'Unlock' : 'Lock', it.locked, () => { SF.replaceItem(L, Object.assign({}, it, { locked: !it.locked })); if (!it.locked) SF.sel.ids.delete(it.id); SF.commit(it.locked ? 'Unlock item' : 'Lock item'); }),
            actBtn('trash', 'Delete', false, () => { SF.setItems(L, L.items.filter(i => i.id !== it.id)); SF.sel.ids.delete(it.id); SF.commit('Delete ' + label); SF.toast('Deleted ' + label, 3000, { label: 'Undo', fn: SF.undo }); })));
        irow.addEventListener('pointerenter', () => { SF.overlay.hl = it.id; SF.requestRender(); });
        irow.addEventListener('pointerleave', () => { if (SF.overlay.hl === it.id) { SF.overlay.hl = null; SF.requestRender(); } });
        box.append(irow);
      });
      if (lim < list.length) box.append(el('button', { class: 'tbtn', style: 'margin-left:30px', onclick: () => { showAll[key] = true; buildLayers(); } }, 'Show ' + (list.length - lim) + ' more'));
    });
  });
  /* pinned Background layer */
  {
    const vis = d.paper !== 'transparent', col = vis ? d.paper : (d.paperHidden || null);
    const th = U.canvas(104, 76), tg = th.getContext('2d');
    if (vis) { tg.fillStyle = d.paper; tg.fillRect(0, 0, 104, 76); } else { for (let y = 0; y < 76; y += 8) for (let x = 0; x < 104; x += 8) { tg.fillStyle = ((x + y) / 8) % 2 ? '#e4e4e4' : '#ffffff'; tg.fillRect(x, y, 8, 8); } }
    th.style.width = '52px'; th.style.height = '38px';
    const presets = el('div', { class: 'bgpresets' });
    PAPERS.forEach(([c, n]) => presets.append(el('button', { class: 'sw-mini' + ((c === 'transparent' ? !vis : vis && d.paper === c) ? ' on' : ''), title: n, 'aria-label': 'Background ' + n,
      style: 'background:' + (c === 'transparent' ? 'repeating-conic-gradient(#bbb 0 25%,#fff 0 50%) 0 0/8px 8px' : c),
      onclick: (e) => { e.stopPropagation(); if (c === 'transparent') SF.setBackgroundVisible(false); else SF.setBackgroundColor(c); } })));
    const row = el('div', { class: 'lrow layer bg', title: 'Background · fills the whole canvas, always at the bottom' },
      el('span', { class: 'chev', 'aria-hidden': 'true' }), th,
      el('div', { style: 'min-width:0' }, el('div', { class: 'nm' }, 'Background'), el('div', { class: 'meta' }, vis ? 'fills canvas · ' + d.paper : 'hidden · transparent'), presets),
      el('div', { class: 'acts' },
        swatchBtn(col, 'Background colour', (c) => SF.setBackgroundColor(c)),
        actBtn(vis ? 'eye' : 'eyeoff', vis ? 'Hide background (transparent)' : 'Show background', !vis, () => SF.setBackgroundVisible(!vis)),
        (() => { const b = actBtn('lock', 'Pinned at the bottom', true, () => SF.toast('The background always stays under everything', 1400)); b.style.opacity = '.55'; return b; })()));
    box.append(row);
  }
  box.scrollTop = keepScroll;
  const L = SF.layer(), pr = $('#lProps'); pr.innerHTML = '';
  if (L) {
    const op = range(0, 1, 0.01, L.opacity, v => { L.opacity = v; SF.requestRender(); }, () => { SF.commit('Layer opacity'); SF.emit('layers'); });
    op.style.width = '100%';
    const bl = el('select', null, ...BLENDS.map(([v, n]) => el('option', { value: v, selected: L.blend === v }, n))); bl.onchange = () => { L.blend = bl.value; SF.commit('Blend mode'); SF.emit('layers'); };
    pr.append(el('span', null, 'Opacity'), op, el('span', null, 'Blend'), bl);
  }
  const ty = $('#lType'); ty.innerHTML = '';
  const strip = el('span', { style: 'display:flex;gap:2px' }); const tcol = SF.typeColors(); ['Lines', 'Strokes', 'Rectangles', 'Circles', 'Fills', 'Text', 'Dimensions'].forEach(g => strip.append(el('i', { title: g + ' ' + tcol[g], style: `width:9px;height:14px;border-radius:2px;display:block;background:${tcol[g]};box-shadow:inset 0 0 0 1px #0002` })));
  const colBtn = el('button', { class: 'tbtn', onclick: SF.colorByType }, strip, 'Colour by type');
  const auto = el('button', { class: 'tbtn' + (P().autoTypeColor ? ' on' : ''), 'aria-pressed': P().autoTypeColor ? 'true' : 'false', onclick: () => { P().autoTypeColor = !P().autoTypeColor; SF.savePrefs(); buildLayers(); SF.toast(P().autoTypeColor ? 'New items get their type’s colour' : 'New items use the colour you pick', 1500); } }, P().autoTypeColor ? 'Auto ✓' : 'Auto');
  auto.title = 'Keep new items colour-coded by type';
  ty.append(colBtn, auto, el('button', { class: 'tbtn', onclick: () => { $('#palName').click(); buildLayers(); } }, 'Palette: ' + (SF.PALETTES[P().palette] || SF.PALETTES.ink).name));
}
function bindLayers() {
  $('#lAdd').onclick = () => ui.addLayer(); $('#lClose').onclick = () => ui.toggleLayers(false);
  $('#lDup').onclick = () => { const L = SF.layer(); const N = Object.assign({}, L, { id: U.uid('L'), name: L.name + ' copy', items: L.items.map(it => Object.assign({}, it, { id: U.uid(it.t[0]) })) }); SF.doc.layers.splice(SF.layerIndex() + 1, 0, N); SF.doc.active = N.id; SF.commit('Duplicate layer'); SF.emit('layers'); };
  $('#lMerge').onclick = () => { const i = SF.layerIndex(); if (i <= 0) { SF.toast('Nothing below to merge into'); return; } const up = SF.doc.layers[i], lo = SF.doc.layers[i - 1]; lo.items = lo.items.concat(up.items.map(it => Object.assign({}, it, { opacity: (it.opacity == null ? 1 : it.opacity) * up.opacity }))); SF.doc.layers.splice(i, 1); SF.doc.active = lo.id; SF.commit('Merge down'); SF.emit('layers'); };
  $('#lUp').onclick = () => { const i = SF.layerIndex(), a = SF.doc.layers; if (i >= a.length - 1) return; [a[i], a[i + 1]] = [a[i + 1], a[i]]; SF.commit('Move layer up'); SF.emit('layers'); };
  $('#lDown').onclick = () => { const i = SF.layerIndex(), a = SF.doc.layers; if (i <= 0) return; [a[i], a[i - 1]] = [a[i - 1], a[i]]; SF.commit('Move layer down'); SF.emit('layers'); };
  $('#lDel').onclick = () => { const a = SF.doc.layers; if (a.length <= 1) { SF.setItems(a[0], []); SF.commit('Clear layer'); return; } const i = SF.layerIndex(), L = a[i]; a.splice(i, 1); SF.doc.active = a[Math.max(0, i - 1)].id; SF.commit('Delete layer'); SF.emit('layers'); SF.toast('Deleted “' + L.name + '”', 4000, { label: 'Undo', fn: SF.undo }); };
}
const relayers = U.debounce(buildLayers, 120);

/* =============== hub sheet =============== */
let hubTab = 'make';
ui.openHub = (tab) => { if (tab) hubTab = tab; $('#hub').hidden = false; $('#scrim').hidden = false; buildHub(); };
ui.closeAll = () => { $('#hub').hidden = true; $('#imp').hidden = true; $('#scrim').hidden = true; $('#sendPop').hidden = true; ui.closeWheel(); };
function tile(icon, title, sub, fn, cls) { const t = el('button', { class: 'tile ' + (cls || ''), onclick: fn }); t.append(ui.icon(icon), el('b', null, title), el('span', null, sub)); return t; }
ui.newBoard = (w, h) => {
  const W = w || Math.round(Math.min(4096, innerWidth * Math.min(2, SF.dpr))), Hh = h || Math.round(Math.min(4096, innerHeight * Math.min(2, SF.dpr)));
  SF.io.saveNow().then(() => { SF.loadDoc(SF.newDoc(W, Hh)); SF.io.saveNow(); ui.closeAll(); SF.toast('New board · the last one is in Recall', 1800); });
};
const PAPERS = [['#ffffff', 'White'], ['#f6f1e7', 'Warm'], ['#e9ecef', 'Grey'], ['#1d2026', 'Night'], ['#0b0c0e', 'Black'], ['#0f2a52', 'Blueprint'], ['transparent', 'Clear']];
SF.setPaper = (p) => {
  SF.doc.paper = p;
  const dark = p !== 'transparent' && U.luma(p) < 0.4;
  if (dark && U.luma(P().color) < 0.35) SF.setColor('#f2f2f2', false);
  if (!dark && p !== 'transparent' && U.luma(P().color) > 0.85) SF.setColor('#1c1c1e', false);
  SF.commit('Paper'); SF.invalidate();
};
/* Background layer: always at the bottom, fills the canvas. Hiding it makes the canvas transparent and remembers the colour. */
SF.setBackgroundVisible = (on) => {
  const d = SF.doc;
  if (!on && d.paper !== 'transparent') { d.paperHidden = d.paper; d.paper = 'transparent'; SF.commit('Hide background'); SF.invalidate(); }
  else if (on && d.paper === 'transparent') { d.paper = d.paperHidden || '#ffffff'; d.paperHidden = null; SF.commit('Show background'); SF.invalidate(); }
};
SF.setBackgroundColor = (c) => { SF.doc.paperHidden = null; SF.setPaper(c); };
function buildHub() {
  $$('#hub .tab[data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === hubTab));
  const p = $('#hubPane'); p.innerHTML = '';
  const H = (h, s) => p.append(el('h2', null, h), el('p', { class: 'sub' }, s));
  const h4 = (t) => p.append(el('h4', null, t));
  if (hubTab === 'make') {
    H('Start something', 'New boards never replace old ones — everything stays in Recall.');
    const tiles = el('div', { class: 'tiles' });
    tiles.append(
      tile('plus', 'New · screen', 'Fits this display', () => ui.newBoard()),
      tile('rect', 'Landscape', '2400 × 1600', () => ui.newBoard(2400, 1600)),
      tile('rect', 'Portrait', '1600 × 2400', () => ui.newBoard(1600, 2400)),
      tile('rect', 'Square', '2048 × 2048', () => ui.newBoard(2048, 2048)),
      tile('rect', 'A4 · 300 dpi', '3508 × 2480', () => ui.newBoard(3508, 2480)),
      tile('image', 'Import image', 'Photo, scan or screenshot · cut-out', () => { ui.closeAll(); $('#fileIn').click(); }),
      tile('file', 'Open board file', '.sketchflow · .json · .ora', () => { ui.closeAll(); $('#openIn').click(); }));
    p.append(tiles);
    h4('Custom size');
    const w = el('input', { type: 'number', value: SF.doc.w, min: 64, max: 8192 }), hh = el('input', { type: 'number', value: SF.doc.h, min: 64, max: 8192 });
    [w, hh].forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
    p.append(el('div', { class: 'row' }, el('label', { class: 'field' }, 'Width', w), el('label', { class: 'field' }, 'Height', hh), el('button', { class: 'primary acc', style: 'align-self:flex-end', onclick: () => ui.newBoard(U.clamp(+w.value, 64, 8192), U.clamp(+hh.value, 64, 8192)) }, 'Create')));
    h4('Paper');
    const pr = el('div', { class: 'row' });
    PAPERS.forEach(([c, n]) => pr.append(el('button', { class: 'tbtn' + (SF.doc.paper === c ? ' on' : ''), onclick: () => { if (c === 'transparent') SF.setBackgroundVisible(false); else SF.setBackgroundColor(c); buildHub(); } }, el('i', { style: `width:14px;height:14px;border-radius:4px;display:inline-block;box-shadow:inset 0 0 0 1px #0003;background:${c === 'transparent' ? 'repeating-conic-gradient(#bbb 0 25%,#fff 0 50%) 0 0/8px 8px' : c}` }), n)));
    p.append(pr);
  } else if (hubTab === 'space') {
    H('Drawing spaces', 'Lines lock to the space’s directions when you draw roughly along them. Drag the coloured pips to move vanishing points.');
    const tiles = el('div', { class: 'tiles' });
    SF.SPACE_ORDER.forEach(k => { const t = tile(k === 'iso' || k === 'v4' ? 'box' : k[0] === 'p' ? 'triangle' : k[0] === 'v' ? 'hub' : k === 'grid' ? 'hub' : 'rect', SF.SPACES[k].name, SF.SPACES[k].desc, () => { ui.setSpace(k); buildHub(); }); if (SF.doc.guides.space === k) t.style.borderColor = 'var(--accent)'; tiles.append(t); });
    p.append(tiles);
    h4('Tuning');
    p.append(el('div', { class: 'prefgrid' },
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Grid size'), el('small', null, SF.doc.guides.grid + ' px')), range(10, 200, 5, SF.doc.guides.grid, v => { SF.doc.guides.grid = v; SF.requestRender(); }, () => { SF.emit('change', 'guides'); buildHub(); })),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Alignment guides'), el('small', null, 'Snap to other joints’ x/y — projection lines in 3-view')), cb(P().align, v => { P().align = v; SF.savePrefs(); })),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Lightbox strength'), el('small', null, 'How faded lower layers look')), range(0.05, 0.9, 0.05, P().lightboxAmt, v => { P().lightboxAmt = v; SF.savePrefs(); SF.requestRender(); })),
      el('button', { class: 'tile', onclick: () => { SF.doc.guides.vps = SF.defaultGuides(SF.doc.w, SF.doc.h).vps; SF.emit('change', 'guides'); SF.requestRender(); SF.toast('Vanishing points reset'); } }, ui.icon('pin'), el('b', null, 'Reset vanishing points'), el('span', null, 'Back to the default horizon'))));
  } else if (hubTab === 'send') {
    H('Export & share', 'Layers stay separate in SVG, ORA and ZIP — or flatten to one picture.');
    const opt = ui._exp || (ui._exp = { scale: 1, ref: false });
    const tiles = el('div', { class: 'tiles' });
    tiles.append(
      tile('copy', 'Copy image', 'Flattened PNG to clipboard', () => SF.io.copy('flat')),
      tile('copy', 'Copy layer', 'Active layer, transparent', () => SF.io.copy('layer')),
      tile('share', 'Share…', 'Send to another app', () => SF.io.share()),
      tile('download', 'PNG', 'Flattened with paper', () => SF.io.exportFile('png', opt)),
      tile('download', 'Transparent PNG', 'No paper behind', () => SF.io.exportFile('tpng', opt)),
      tile('download', 'JPG', 'Small, flattened', () => SF.io.exportFile('jpg', opt)),
      tile('download', 'SVG (vector)', 'Layers as groups · Inkscape/Figma', () => SF.io.exportFile('svg', opt)),
      tile('layers', 'Layers ZIP', 'Every layer as PNG + flat + SVG', () => SF.io.exportFile('zip', opt)),
      tile('layers', 'ORA', 'Layered file for Krita / GIMP', () => SF.io.exportFile('ora', opt)),
      tile('layers', 'Items ZIP', 'Every item as its own PNG, by type', () => SF.io.exportFile('items', opt)),
      tile('file', 'Board file', '.sketchflow — reopen & keep editing', () => SF.io.exportFile('board', opt)));
    p.append(tiles);
    h4('Options');
    const sc = el('select', null, ...[0.5, 1, 2, 3].map(s => el('option', { value: s, selected: opt.scale === s }, s + '×'))); sc.onchange = () => { opt.scale = +sc.value; };
    p.append(el('div', { class: 'prefgrid' }, el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Scale'), el('small', null, 'Pixel exports')), sc),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Include reference layers'), el('small', null, 'Underlays are left out by default')), cb(opt.ref, v => { opt.ref = v; })),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Include construction lines'), el('small', null, 'Guides are left out by default')), cb(opt.construction, v => { opt.construction = v; }))));
  } else if (hubTab === 'recall') {
    H('Recall', 'Boards save themselves as you work. Tap one to jump back in.');
    p.append(el('div', { class: 'row', style: 'margin-bottom:12px' }, tbtn('Save now', 'download', () => SF.io.saveNow(true).then(buildHub)), tbtn('New board', 'plus', () => ui.newBoard())));
    const grid = el('div', { class: 'boards' }, el('span', { class: 'sub' }, 'Loading…')); p.append(grid);
    SF.io.listBoards().then(list => {
      grid.innerHTML = '';
      if (!list.length) grid.append(el('p', { class: 'sub' }, 'No saved boards yet.'));
      list.forEach(b => {
        let armed = false;
        const del = el('button', { class: 'ib', 'data-tip': 'Delete', 'aria-label': 'Delete board', onclick: (e) => { e.stopPropagation(); if (!armed) { armed = true; del.style.color = 'var(--warn)'; SF.toast('Tap the bin again to delete “' + b.name + '”', 2200); return; } SF.io.deleteBoard(b.id).then(buildHub); } });
        del.append(ui.icon('trash'));
        grid.append(el('div', { class: 'bcard' + (b.id === SF.doc.id ? ' cur' : ''), onclick: () => { if (b.id === SF.doc.id) { ui.closeAll(); return; } SF.io.saveNow().then(() => SF.io.openBoard(b.id)).then(() => ui.closeAll()); } },
          el('img', { src: b.thumb || '', alt: '' }), el('div', { class: 'bi' }, el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'bn' }, b.name), el('div', { class: 'bt' }, U.ago(b.updated) + ' · ' + b.w + '×' + b.h)), del)));
      });
    });
  } else if (hubTab === 'feel') {
    H('Feel', 'Your choices are remembered on this device.');
    h4('Theme');
    p.append(el('div', { class: 'row' }, ...[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match system']].map(([v, n]) => el('button', { class: 'tbtn' + (P().theme === v ? ' on' : ''), onclick: () => { P().theme = v; SF.savePrefs(); ui.applyTheme(); buildHub(); } }, n))));
    h4('Palette');
    const pr = el('div', { class: 'row' });
    Object.keys(SF.PALETTES).forEach(k => { const pl = SF.PALETTES[k]; const b = el('button', { class: 'tbtn' + (P().palette === k ? ' on' : ''), onclick: () => { P().palette = k; SF.savePrefs(); buildDock(); buildHub(); } }); const strip = el('span', { style: 'display:flex;gap:2px' }); pl.c.slice(0, 6).forEach(c => strip.append(el('i', { style: `width:10px;height:14px;border-radius:2px;display:block;background:${c};box-shadow:inset 0 0 0 1px #0002` }))); b.append(strip, pl.name); pr.append(b); });
    p.append(pr);
    h4('Drawing');
    const hold = el('select', null, ...[[300, 'Quick'], [450, 'Normal'], [700, 'Relaxed']].map(([v, n]) => el('option', { value: v, selected: P().holdMs === v }, n))); hold.onchange = () => { P().holdMs = +hold.value; SF.savePrefs(); };
    const fing = el('select', null, ...[['auto', 'Draw until a stylus is seen'], ['draw', 'Always draw'], ['never', 'Pan & zoom only']].map(([v, n]) => el('option', { value: v, selected: P().fingers === v }, n))); fing.onchange = () => { P().fingers = fing.value; SF.savePrefs(); };
    const wh = el('select', null, ...[['auto', 'Mouse zooms, trackpad pans'], ['zoom', 'Always zoom'], ['pan', 'Always pan']].map(([v, n]) => el('option', { value: v, selected: P().wheel === v }, n))); wh.onchange = () => { P().wheel = wh.value; SF.savePrefs(); };
    p.append(el('div', { class: 'prefgrid' },
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Hold still to snap'), el('small', null, 'Rough line/circle/box → clean shape')), cb(P().holdSnap, v => { P().holdSnap = v; SF.savePrefs(); })),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Hold time')), hold),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Fingers')), fing),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Mouse wheel')), wh),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Autosave to Recall')), cb(P().autosave, v => { P().autosave = v; SF.savePrefs(); })),
      el('label', { class: 'toggle' }, el('span', null, el('b', null, 'Colour-code by type'), el('small', null, 'New lines, fills, text… each get their own palette colour')), cb(P().autoTypeColor, v => { P().autoTypeColor = v; SF.savePrefs(); }))));
    h4('Reset');
    p.append(tbtn('Restore default settings', 'undo', () => { const keep = { lastBoard: P().lastBoard }; SF.prefs = Object.assign(JSON.parse(JSON.stringify(SF.DEFAULT_PREFS)), keep); SF.store.set('prefs', SF.prefs); ui.applyTheme(); refresh(); buildDock(); buildHub(); SF.toast('Settings restored'); }));
  } else if (hubTab === 'help') {
    H('How it flows', 'Draw first, tidy later. Everything is undoable — scrub the timeline at the top to travel back.');
    h4('AI link');
    const live = SF.bridge && SF.bridge.connected;
    p.append(el('p', { class: 'sub', style: '-webkit-user-select:text;user-select:text' }, live ? 'Connected. Press Send (or Ctrl+Enter) to hand the AI your sketch, and it can draw, build mechanisms and place images here.' : 'Not connected. Run the SketchFlow MCP server and open the board it serves. In Claude Code:  claude mcp add sketchflow -- node /path/to/sketchflow/server.mjs   — then ask Claude to “open the sketch board”. Without the link, Send copies your sketch to the clipboard so you can paste it into any chat.'));
    h4('Gestures');
    p.append(kbd([['Hold still', 'mid-stroke → snaps to line, arc, circle, rectangle, triangle…'], ['Fill: hold', 'shape fill that follows its outline when lines move'], ['2-finger tap', 'undo'], ['3-finger tap', 'redo'], ['Pinch / 2 fingers', 'zoom & pan'], ['Long-press', 'radial tool wheel (finger)'], ['Right-click / pen button', 'radial tool wheel'], ['Drop / paste image', 'import with background removal']]));
    h4('Keys');
    p.append(kbd([['B', 'pen (again: next brush)'], ['S', 'shapes'], ['T', 'text'], ['F', 'fill'], ['E', 'eraser'], ['V', 'select & move'], ['J', 'joints'], ['D', 'dimension'], ['I · Alt', 'pick colour'], ['H · Space', 'pan'], ['[ ]', 'size'], ['Shift [ ]', 'opacity'], ['P', 'next drawing space'], ['M', 'snap & join on/off'], ['L', 'lightbox'], ['G', 'grid'], ['Q', 'tool wheel'], ['N · Shift N', 'new layer · new board'], ['X', 'motion mode'], ['Tab', 'focus mode'], ['Ctrl Z / Shift Z', 'undo / redo'], ['Ctrl C', 'copy image'], ['Ctrl D', 'duplicate'], ['Ctrl S', 'save to Recall'], ['Ctrl Enter', 'send to AI'], ['0', 'fit'], ['Shift', 'straight / square / 15°'], ['Alt', 'from centre · detach joint']]));
  }
}
function cb(v, fn) { const c = el('input', { type: 'checkbox' }); c.checked = !!v; c.onchange = () => fn(c.checked); return c; }
function kbd(rows) { const g = el('div', { class: 'kbd' }); rows.forEach(([k, d]) => g.append(el('kbd', null, k), el('span', null, d))); return g; }
function bindHub() {
  $$('#hub .tab[data-tab]').forEach(t => t.onclick = () => { hubTab = t.dataset.tab; buildHub(); });
  $('#hubClose').onclick = ui.closeAll; $('#scrim').onclick = ui.closeAll;
}

/* =============== send popover =============== */
ui.openSend = () => {
  if (!(SF.bridge && SF.bridge.connected)) { SF.io.copy('flat', 'Copied — paste into your AI chat (AI link is off)'); return; }
  const p = $('#sendPop'); p.hidden = !p.hidden; if (!p.hidden) setTimeout(() => $('#sendNote').focus(), 30);
};
function bindSend() {
  const go = () => { const note = $('#sendNote').value.trim(); SF.bridge.send(note, $('#sendLayers').checked).then(() => { $('#sendPop').hidden = true; $('#sendNote').value = ''; ui.banner(null); SF.toast('Sent to AI ✓'); }).catch(err => SF.toast('Send failed: ' + err.message)); };
  $('#sendGo').onclick = go;
  $('#sendNote').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); go(); } if (e.key === 'Escape') $('#sendPop').hidden = true; });
}

/* =============== radial wheel =============== */
const WHEEL = [['pen', 'Pen'], ['shape', 'Shapes'], ['eraser', 'Eraser'], ['fill', 'Fill'], ['_redo', 'Redo'], ['_undo', 'Undo'], ['joint', 'Joints'], ['select', 'Select']];
let wheel = null;
ui.wheelOpen = () => !!wheel;
ui.openWheel = (x, y, pointerId) => {
  const w = $('#wheel'); w.hidden = false;
  x = U.clamp(x, 135, innerWidth - 135); y = U.clamp(y, 135, innerHeight - 135);
  w.style.left = x + 'px'; w.style.top = y + 'px';
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '-130 -130 260 260');
  const R = 124, r = 44, n = WHEEL.length;
  WHEEL.forEach(([k, label], i) => {
    const a0 = -Math.PI / 2 - Math.PI / n + i * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n;
    const pth = document.createElementNS(ns, 'path');
    pth.setAttribute('d', `M${Math.cos(a0) * r} ${Math.sin(a0) * r}L${Math.cos(a0) * R} ${Math.sin(a0) * R}A${R} ${R} 0 0 1 ${Math.cos(a1) * R} ${Math.sin(a1) * R}L${Math.cos(a1) * r} ${Math.sin(a1) * r}A${r} ${r} 0 0 0 ${Math.cos(a0) * r} ${Math.sin(a0) * r}Z`);
    pth.setAttribute('class', 'slice' + (P().tool === k ? ' hot' : '')); pth.dataset.k = k;
    const am = (a0 + a1) / 2, cx = Math.cos(am) * 84, cy = Math.sin(am) * 84;
    const g = document.createElementNS(ns, 'g'); g.setAttribute('transform', `translate(${cx - 12} ${cy - 18})`);
    const ic = document.createElementNS(ns, 'path'); ic.setAttribute('d', I[k === '_undo' ? 'undo' : k === '_redo' ? 'redo' : k === 'shape' ? 'shapes' : k] || I.x); ic.setAttribute('class', 'wi'); g.append(ic);
    const tx = document.createElementNS(ns, 'text'); tx.setAttribute('x', cx); tx.setAttribute('y', cy + 22); tx.textContent = label;
    svg.append(pth, g, tx);
  });
  const core = document.createElementNS(ns, 'circle'); core.setAttribute('r', r - 4); core.setAttribute('class', 'core'); svg.append(core);
  const ct = document.createElementNS(ns, 'text'); ct.setAttribute('y', 4); ct.textContent = 'close'; svg.append(ct);
  w.innerHTML = ''; w.append(svg);
  wheel = { x, y, pointerId, hot: null, t0: performance.now() };
  const pick = (k) => { ui.closeWheel(); if (!k) return; if (k === '_undo') SF.undo(); else if (k === '_redo') SF.redo(); else SF.setTool(k); };
  const hotAt = (ex, ey) => { const dx = ex - x, dy = ey - y, d = Math.hypot(dx, dy); if (d < r || d > R + 30) return null; let a = Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / n; a = (a + Math.PI * 4) % (Math.PI * 2); return WHEEL[Math.floor(a / (2 * Math.PI / n)) % n][0]; };
  const mv = (e) => { const k = hotAt(e.clientX, e.clientY); $$('.slice', svg).forEach(s => s.classList.toggle('hot', s.dataset.k === k)); wheel && (wheel.hot = k); };
  const up = (e) => { if (!wheel) return; if (performance.now() - wheel.t0 < 250 && !wheel.hot) return; const k = hotAt(e.clientX, e.clientY); if (k || Math.hypot(e.clientX - x, e.clientY - y) < r) pick(k); };
  wheel.mv = mv; wheel.up = up;
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
};
ui.closeWheel = () => { if (!wheel) return; window.removeEventListener('pointermove', wheel.mv); window.removeEventListener('pointerup', wheel.up); wheel = null; $('#wheel').hidden = true; };

/* =============== focus & theme =============== */
ui.toggleFocus = (on) => { const b = document.body; const v = on == null ? !b.classList.contains('focus') : on; b.classList.toggle('focus', v); $('#focusExit').hidden = !v; if (v) SF.toast('Focus mode · Tab or • to bring tools back', 1400); };
ui.applyTheme = () => {
  const t = P().theme, r = document.documentElement;
  if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
  SF.readColors(); SF.invalidate();
};
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (P().theme === 'auto') ui.applyTheme(); }); } catch (e) { /* old browsers */ }

/* =============== doc loading & boot =============== */
SF.loadDoc = (doc) => {
  SF.doc = doc; SF.sel.clear(true); SF.override = null; SF.live = null;
  P().lastBoard = doc.id; SF.savePrefs();
  $('#boardName').textContent = doc.name;
  SF.invalidate(); SF.resetHistory(); SF.fit(); SF.emit('layers'); SF.emit('doc');
};
SF.boot = async () => {
  hydrateIcons(document);
  ui.applyTheme(); SF.resize();
  bindRail(); bindSliders(); bindDock(); bindLayers(); bindHub(); bindSend();
  SF.on('history', syncTop); SF.on('view', () => { $('#zoomLbl').textContent = Math.round(SF.view.z * 100) + '%'; });
  SF.on('tool', refresh); SF.on('selection', () => { if (P().tool === 'select') refresh(); relayers(); });
  $('#lList').addEventListener('pointerleave', () => { SF.overlay.hl = null; SF.requestRender(); });
  SF.on('layers', relayers); SF.on('change', relayers);
  SF.on('doc', () => { refresh(); buildDock(); });
  window.addEventListener('resize', U.debounce(() => { SF.resize(); }, 60));
  try { await SF.io.init(); } catch (e) { console.error(e); }
  if (!SF.doc) SF.loadDoc(SF.newDoc(Math.round(Math.min(4096, innerWidth * Math.min(2, SF.dpr))), Math.round(Math.min(4096, innerHeight * Math.min(2, SF.dpr)))));
  SF.setTool(P().tool && SF.tools[P().tool] ? P().tool : 'pen');
  refresh(); buildDock();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => SF.invalidate());
  Object.keys(SF.FONTS).forEach(k => { try { document.fonts && document.fonts.load('500 20px ' + SF.FONTS[k].css.split(',')[0]); } catch (e) { /* font api */ } });
  SF.bridge && SF.bridge.init();
  SF.emit('ready');
};

})(window.SF);
