/* SketchFlow I/O: import + background cut-out, exports (PNG, transparent PNG, JPG, SVG, ZIP, ORA, board file), clipboard, share, sessions (IndexedDB). */
(function (SF) {
'use strict';
const U = SF.U, G = SF.G, $ = U.$, el = U.el;
const P = () => SF.prefs;
const io = SF.io = {};

/* =============== helpers =============== */
const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not encode image'))), type || 'image/png', q));
const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const safeName = (s) => String(s || 'sketch').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'sketch';
io.download = (blob, name) => {
  const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  SF.toast('Saved ' + name, 1800);
};
io.loadImage = (src) => new Promise((res, rej) => {
  const im = new Image(); im.decoding = 'async';
  im.onload = () => res(im); im.onerror = () => rej(new Error('That file is not an image this browser can read'));
  im.src = typeof src === 'string' ? src : URL.createObjectURL(src);
});
io.imageToCanvas = (im, max) => {
  const w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height;
  const s = Math.min(1, (max || 2560) / Math.max(w0, h0));
  const c = U.canvas(w0 * s, h0 * s); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height); return c;
};

/* =============== serialization =============== */
const encCache = new WeakMap();
async function encImg(c, as) {
  let e = encCache.get(c); if (!e) { e = {}; encCache.set(c, e); }
  if (!e.blob) e.blob = await toBlob(c);
  if (as === 'blob') return e.blob;
  if (!e.url) e.url = await blobToDataURL(e.blob);
  return e.url;
}
io.serialize = async (doc, as) => {
  const layers = [];
  for (const L of doc.layers) {
    const items = [];
    for (const it of L.items) { if (it.t === 'image') { const o = Object.assign({}, it); delete o.img; o.src = await encImg(it.img, as); items.push(o); } else items.push(it); }
    layers.push(Object.assign({}, L, { items }));
  }
  return { format: 'sketchflow', version: 1, id: doc.id, name: doc.name, w: doc.w, h: doc.h, paper: doc.paper, created: doc.created, updated: doc.updated, guides: doc.guides, active: doc.active, motion: doc.motion || null, paperHidden: doc.paperHidden || null, layers };
};
io.deserialize = async (data) => {
  if (!data || !Array.isArray(data.layers)) throw new Error('Not a SketchFlow board');
  const layers = [];
  for (const L of data.layers) {
    const items = [];
    for (const it of L.items || []) {
      if (it.t === 'image') {
        try { const im = await io.loadImage(it.src instanceof Blob ? it.src : String(it.src)); const c = io.imageToCanvas(im, 8192); const o = Object.assign({}, it, { img: c, iw: c.width, ih: c.height }); delete o.src; if (it.iw && c.width !== it.iw) o.s = it.s * it.iw / c.width; items.push(o); } catch (e) { console.warn('image skipped', e); }
      } else items.push(it);
    }
    layers.push(Object.assign(SF.mkLayer(L.name), L, { items }));
  }
  const g = Object.assign(SF.defaultGuides(data.w, data.h), data.guides || {});
  return { id: data.id || U.uid('b'), name: data.name || 'Board', w: data.w, h: data.h, paper: data.paper || '#ffffff', created: data.created || Date.now(), updated: data.updated || Date.now(), guides: g, motion: data.motion || null, paperHidden: data.paperHidden || null, active: layers.some(l => l.id === data.active) ? data.active : layers[layers.length - 1].id, layers };
};

/* =============== sessions (IndexedDB with memory fallback) =============== */
let db = null; const mem = { meta: new Map(), docs: new Map() };
function idb() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('sketchflow', 1);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' }); if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
}
const tx = (store, mode, fn) => new Promise((res, rej) => {
  if (!db) { try { res(fn(null)); } catch (e) { rej(e); } return; }
  try { const t = db.transaction(store, mode), s = t.objectStore(store); const r = fn(s); t.oncomplete = () => res(r && r.result !== undefined ? r.result : r); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); } catch (e) { rej(e); }
});
const put = (store, v) => (db ? tx(store, 'readwrite', s => s.put(v)) : Promise.resolve(mem[store].set(v.id, v)));
const get = (store, id) => (db ? new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }) : Promise.resolve(mem[store].get(id)));
const all = (store) => (db ? new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }) : Promise.resolve([...mem[store].values()]));
const del = (store, id) => (db ? tx(store, 'readwrite', s => s.delete(id)) : Promise.resolve(mem[store].delete(id)));

let saving = Promise.resolve(), dirty = false;
io.saveNow = (show) => {
  saving = saving.then(async () => {
    if (!SF.doc) return;
    try {
      const data = await io.serialize(SF.doc, 'blob');
      const th = SF.thumb(360, 240); const thumb = th.toDataURL('image/jpeg', 0.75);
      await put('docs', { id: SF.doc.id, data });
      await put('meta', { id: SF.doc.id, name: SF.doc.name, updated: SF.doc.updated, created: SF.doc.created, w: SF.doc.w, h: SF.doc.h, thumb });
      dirty = false;
      if (show) SF.toast(db ? 'Saved to Recall ✓' : 'Saved for this session (browser storage is blocked)', 1400);
    } catch (e) { console.error(e); if (show) SF.toast('Could not save: ' + e.message); }
  });
  return saving;
};
const autosave = U.debounce(() => { if (P().autosave) io.saveNow(); }, 1500);
io.listBoards = async () => (await all('meta')).sort((a, b) => b.updated - a.updated);
io.openBoard = async (id) => { const r = await get('docs', id); if (!r) { SF.toast('That board could not be found'); return false; } const doc = await io.deserialize(r.data); SF.loadDoc(doc); SF.toast('Opened “' + doc.name + '”', 1200); return true; };
io.deleteBoard = async (id) => {
  await del('docs', id); await del('meta', id);
  if (SF.doc && id === SF.doc.id) { const list = await io.listBoards(); if (list.length) await io.openBoard(list[0].id); else SF.loadDoc(SF.newDoc(SF.doc.w, SF.doc.h)); }
  SF.toast('Board deleted', 1200);
};
io.init = async () => {
  db = await idb();
  if (!db) SF.toast('Browser storage is blocked — boards last until you close this tab', 3500);
  SF.on('change', () => { dirty = true; autosave(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) io.saveNow(); });
  window.addEventListener('pagehide', () => { if (dirty) io.saveNow(); });
  const last = P().lastBoard;
  if (last) { try { const r = await get('docs', last); if (r) { SF.loadDoc(await io.deserialize(r.data)); } } catch (e) { console.warn('could not restore last board', e); } }
  if (!SF.doc) { const list = await io.listBoards().catch(() => []); if (list.length) { try { await io.openBoard(list[0].id); } catch (e) { console.warn(e); } } }
  bindImport();
};

/* =============== clipboard & share =============== */
io.copy = (kind, msg) => {
  let c;
  if (kind === 'layer') { const L = SF.layer(); c = SF.renderLayer(L, 1); } else c = SF.renderDoc({ scale: 1 });
  const blobP = toBlob(c);
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('no clipboard');
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]).then(() => SF.toast(msg || (kind === 'layer' ? 'Layer copied ✓' : 'Image copied ✓'), 1400)).catch(() => blobP.then(b => { SF.toast('The browser blocked the clipboard — saving a file instead', 2200); io.download(b, safeName(SF.doc.name) + '.png'); }));
  } catch (e) { blobP.then(b => { SF.toast('The browser blocked the clipboard — saving a file instead', 2200); io.download(b, safeName(SF.doc.name) + '.png'); }); }
};
io.share = async () => {
  const b = await toBlob(SF.renderDoc({ scale: 1 })), f = new File([b], safeName(SF.doc.name) + '.png', { type: 'image/png' });
  try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: SF.doc.name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  SF.toast('Sharing isn’t available here — saving the PNG instead', 2000); io.download(b, f.name);
};

/* =============== SVG =============== */
const n2 = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function dString(P0, closed, smooth) { let s = ''; SF.tracePts({ M: (x, y) => { s += `M${n2(x)} ${n2(y)}`; }, L: (x, y) => { s += `L${n2(x)} ${n2(y)}`; }, Q: (a, b, x, y) => { s += `Q${n2(a)} ${n2(b)} ${n2(x)} ${n2(y)}`; }, Z: () => { s += 'Z'; } }, P0, closed, smooth); return s; }
const BLEND_CSS = { 'source-over': 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', difference: 'difference' };
async function svgItem(it) {
  const op = it.opacity == null ? 1 : it.opacity;
  if (it.t === 'path') {
    const smooth = it.mode !== 'poly'; let out = '';
    if (it.fill && it.closed) out += `<path d="${dString(it.pts, true, smooth)}${(it.holes || []).map(h => dString(h.pts, true, false)).join('')}" fill="${it.fill}" fill-opacity="${n2((it.fillOpacity == null ? 1 : it.fillOpacity))}"${it.holes ? ' fill-rule="evenodd"' : ''} stroke="none"/>`;
    if (it.stroke !== false) {
      const sop = it.brush === 'pencil' ? 0.85 : 1;
      if (it.pts.length === 3) out += `<circle cx="${n2(it.pts[0])}" cy="${n2(it.pts[1])}" r="${n2(Math.max(0.5, it.width * SF.pfac(it.brush, it.pts[2]) / 2))}" fill="${it.color}" fill-opacity="${sop}"/>`;
      else if (SF.isPV(it) && SF.lineType(it) === 'solid') out += `<path d="${dString(SF.outline(it), true, true)}" fill="${it.color}" fill-opacity="${sop}"/>`;
      else out += `<path d="${dString(it.pts, it.closed, smooth)}" fill="none" stroke="${it.color}" stroke-opacity="${sop}" stroke-width="${n2(it.width)}" stroke-linecap="round" stroke-linejoin="round"${SF.dashFor(it) ? ` stroke-dasharray="${SF.dashFor(it).map(n2).join(' ')}"` : ''}${SF.lineType(it) === 'construction' ? ' stroke-opacity="0.55"' : ''}/>`;
      if (it.arrow) {
        const n = it.pts.length / 3, P0 = it.pts; let i = n - 2; while (i > 0 && Math.hypot(P0[(n - 1) * 3] - P0[i * 3], P0[(n - 1) * 3 + 1] - P0[i * 3 + 1]) < it.width * 2) i--;
        const ex = P0[(n - 1) * 3], ey = P0[(n - 1) * 3 + 1], a = Math.atan2(ey - P0[i * 3 + 1], ex - P0[i * 3]), L = Math.max(10, it.width * 4.2), W = L * 0.55;
        const pts = [[ex + Math.cos(a) * it.width * 0.6, ey + Math.sin(a) * it.width * 0.6], [ex - Math.cos(a) * L + Math.cos(a + Math.PI / 2) * W, ey - Math.sin(a) * L + Math.sin(a + Math.PI / 2) * W], [ex - Math.cos(a) * L - Math.cos(a + Math.PI / 2) * W, ey - Math.sin(a) * L - Math.sin(a + Math.PI / 2) * W]];
        out += `<path d="M${pts.map(p => n2(p[0]) + ' ' + n2(p[1])).join('L')}Z" fill="${it.color}"/>`;
      }
    }
    return `<g id="${esc(it.id)}" opacity="${n2(op)}">${out}</g>`;
  }
  if (it.t === 'image') {
    const href = await encImg(it.img, 'url');
    return `<image id="${esc(it.id)}" href="${href}" width="${it.iw}" height="${it.ih}" opacity="${n2(op)}" transform="translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2((it.r || 0) * 180 / Math.PI)}) scale(${n2(it.s * (it.fx ? -1 : 1))} ${n2(it.s * (it.fy ? -1 : 1))}) translate(${n2(-it.iw / 2)} ${n2(-it.ih / 2)})"/>`;
  }
  if (it.t === 'text') {
    const fam = esc((SF.FONTS[it.font] || SF.FONTS.sans).css), common = `font-family="${fam}" font-size="${n2(it.size)}" font-weight="${it.bold ? 700 : 500}" font-style="${it.italic ? 'italic' : 'normal'}" fill="${it.color}" opacity="${n2(op)}"`;
    if (it.quad) {
      const S = SF.surfaceLayout(it);
      if (S && S.affine) {
        const size = it.size * S.k, lh = size * 1.2, anchor = it.align === 'left' ? 'start' : it.align === 'right' ? 'end' : 'middle';
        const ax = it.align === 'left' ? S.bx0 : it.align === 'right' ? S.bx0 + S.bw : S.bx0 + S.bw / 2;
        return `<text font-family="${fam}" font-size="${n2(size)}" font-weight="${it.bold ? 700 : 500}" font-style="${it.italic ? 'italic' : 'normal'}" fill="${it.color}" opacity="${n2(op)}" text-anchor="${anchor}" transform="matrix(${[S.ax, S.ay, S.bx, S.by, S.Q[0], S.Q[1]].map(n2).join(' ')})">${S.m.lines.map((l, i) => `<tspan x="${n2(ax)}" y="${n2(S.by0 + i * lh + size * 0.9)}">${esc(l) || ' '}</tspan>`).join('')}</text>`;
      }
      if (S) { /* perspective face: embed the warped text as an image */
        const b = G.bbox(it), sc = 2, c = U.canvas(Math.max(1, b.w * sc), Math.max(1, b.h * sc)), g = c.getContext('2d');
        g.setTransform(sc, 0, 0, sc, -b.x * sc, -b.y * sc); SF.drawItem(g, it, { z: sc });
        return `<image href="${c.toDataURL('image/png')}" x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}"/>`;
      }
    }
    const path = it.pathId ? SF.findItem(it.pathId) : null;
    if (path && path.it.t === 'path') {
      const pid = 'tp-' + it.id, Lay = SF.pathTextLayout(it, path.it);
      return `<defs><path id="${esc(pid)}" d="${dString(path.it.pts, false, path.it.mode !== 'poly')}"/></defs><text ${common} text-anchor="start" dy="${n2(-(Lay ? Lay.lift : 0))}"><textPath href="#${esc(pid)}" startOffset="${n2(Math.max(0, Lay ? Lay.start : 0))}">${esc(String(it.text).replace(/\n/g, ' '))}</textPath></text>`;
    }
    const lines = String(it.text).split('\n'), anchor = it.align === 'center' ? 'middle' : it.align === 'right' ? 'end' : 'start';
    return `<text ${common} text-anchor="${anchor}" transform="translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2((it.r || 0) * 180 / Math.PI)})">${lines.map((l, i) => `<tspan x="0" y="${n2(i * it.size * 1.2 + it.size * 0.9)}">${esc(l) || ' '}</tspan>`).join('')}</text>`;
  }
  if (it.t === 'dim') {
    const g = SF.dimGeom(it); if (!g) return '';
    const col = it.color || '#e8672c', w = it.width || 1.5, label = it.label || SF.fmtLen(Math.hypot(g.b2.x - g.a2.x, g.b2.y - g.a2.y));
    let ang = Math.atan2(g.b2.y - g.a2.y, g.b2.x - g.a2.x) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    const fs = it.size || 14;
    return `<g stroke="${col}" stroke-width="${n2(w)}" fill="none" opacity="${n2(op)}"><path d="M${n2(g.a.x)} ${n2(g.a.y)}L${n2(g.a2.x)} ${n2(g.a2.y)}M${n2(g.b.x)} ${n2(g.b.y)}L${n2(g.b2.x)} ${n2(g.b2.y)}" stroke-opacity="0.7"/><path d="M${n2(g.a2.x)} ${n2(g.a2.y)}L${n2(g.b2.x)} ${n2(g.b2.y)}"/><text x="${n2(g.lx)}" y="${n2(g.ly - (fs * 0.62 + w))}" transform="rotate(${n2(ang)} ${n2(g.lx)} ${n2(g.ly)})" fill="${col}" stroke="none" font-family="JetBrains Mono, monospace" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" paint-order="stroke" style="paint-order:stroke;stroke:${SF.doc.paper === 'transparent' ? '#ffffff' : SF.doc.paper};stroke-width:3px">${esc(label)}</text></g>`;
  }
  return '';
}
io.svg = async (opt) => {
  opt = opt || {}; const d = SF.doc;
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}">\n<title>${esc(d.name)}</title>\n`;
  if (d.paper !== 'transparent' && !opt.transparent) s += `<g inkscape:groupmode="layer" inkscape:label="Background" id="background"><rect width="${d.w}" height="${d.h}" fill="${d.paper}"/></g>\n`;
  for (const L of d.layers) {
    if (L.ref && !opt.ref) continue;
    const parts = []; for (const it of SF.layerItems(L)) { if (it.hidden) continue; if (it.t === 'path' && SF.lineType(it) === 'construction' && !opt.construction) continue; const k = SF.kindOf(it); parts.push((await svgItem(it)).replace(/^<(g|image|text|defs)/, (m0) => m0 + ` data-type="${esc(k.group)}" data-name="${esc(it.name || k.label)}"`)); }
    s += `<g inkscape:groupmode="layer" inkscape:label="${esc(L.name)}" id="${esc(L.id)}" opacity="${n2(L.opacity)}"${L.blend !== 'source-over' ? ` style="mix-blend-mode:${BLEND_CSS[L.blend] || 'normal'}"` : ''}${L.visible ? '' : ' display="none"'}>\n${parts.join('\n')}\n</g>\n`;
  }
  return s + '</svg>\n';
};

/* =============== ZIP (store) + ORA =============== */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
io.zip = (files) => {
  const enc = new TextEncoder(), chunks = [], central = []; let off = 0;
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff, dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    chunks.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
};
io.unzip = async (buf) => {
  const u8 = new Uint8Array(buf), dv = new DataView(buf); let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip/ORA file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = {};
  for (let k = 0; k < count; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + xlen + clen;
    const ln = dv.getUint16(lo + 26, true), lx = dv.getUint16(lo + 28, true), start = lo + 30 + ln + lx, raw = u8.subarray(start, start + csize);
    if (method === 0) out[name] = raw.slice();
    else if (method === 8) { if (!window.DecompressionStream) throw new Error('This browser cannot unpack compressed files'); const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')); out[name] = new Uint8Array(await new Response(ds).arrayBuffer()); }
  }
  return out;
};
const pngBytes = async (c) => new Uint8Array(await (await toBlob(c)).arrayBuffer());
const COMP = { 'source-over': 'svg:src-over', multiply: 'svg:multiply', screen: 'svg:screen', overlay: 'svg:overlay', darken: 'svg:darken', lighten: 'svg:lighten', 'color-dodge': 'svg:color-dodge', difference: 'svg:difference' };
io.ora = async (opt) => {
  const d = SF.doc, s = opt.scale || 1, files = [{ name: 'mimetype', data: new TextEncoder().encode('image/openraster') }];
  const W = Math.round(d.w * s), Hh = Math.round(d.h * s);
  let stack = `<?xml version='1.0' encoding='UTF-8'?>\n<image version="0.0.3" w="${W}" h="${Hh}">\n <stack>\n`;
  const layers = d.layers.filter(L => !L.ref || opt.ref).slice().reverse();
  let i = 0;
  for (const L of layers) { const name = `data/layer${i++}.png`; files.push({ name, data: await pngBytes(SF.renderLayer(L, s, null, { construction: !!opt.construction })) }); stack += `  <layer name="${esc(L.name)}" src="${name}" x="0" y="0" opacity="${L.opacity.toFixed(3)}" visibility="${L.visible ? 'visible' : 'hidden'}" composite-op="${COMP[L.blend] || 'svg:src-over'}"/>\n`; }
  if (d.paper !== 'transparent') { const pc = U.canvas(W, Hh), g = pc.getContext('2d'); g.fillStyle = d.paper; g.fillRect(0, 0, W, Hh); files.push({ name: 'data/background.png', data: await pngBytes(pc) }); stack += `  <layer name="Background" src="data/background.png" x="0" y="0" opacity="1.000" visibility="visible" composite-op="svg:src-over"/>\n`; }
  stack += ' </stack>\n</image>\n';
  files.push({ name: 'stack.xml', data: new TextEncoder().encode(stack) });
  const merged = SF.renderDoc({ scale: s, includeRef: opt.ref, construction: !!opt.construction }); files.push({ name: 'mergedimage.png', data: await pngBytes(merged) });
  const ts = Math.min(1, 256 / Math.max(W, Hh)), tc = U.canvas(W * ts, Hh * ts); tc.getContext('2d').drawImage(merged, 0, 0, tc.width, tc.height); files.push({ name: 'Thumbnails/thumbnail.png', data: await pngBytes(tc) });
  return io.zip(files);
};
io.layersZip = async (opt) => {
  const d = SF.doc, s = opt.scale || 1, files = [], meta = [];
  let i = 1;
  if (d.paper !== 'transparent') { const bc = U.canvas(d.w * s, d.h * s), bg = bc.getContext('2d'); bg.fillStyle = d.paper; bg.fillRect(0, 0, bc.width, bc.height); files.push({ name: 'layers/00-Background.png', data: await pngBytes(bc) }); meta.push({ file: 'layers/00-Background.png', name: 'Background', color: d.paper, opacity: 1, blend: 'source-over', visible: true, reference: false }); }
  for (const L of d.layers) { if (L.ref && !opt.ref) continue; const nm = String(i++).padStart(2, '0') + '-' + safeName(L.name) + '.png'; files.push({ name: 'layers/' + nm, data: await pngBytes(SF.renderLayer(L, s, null, { construction: !!opt.construction })) }); meta.push({ file: 'layers/' + nm, name: L.name, opacity: L.opacity, blend: L.blend, visible: L.visible, reference: L.ref }); }
  files.push({ name: 'flat.png', data: await pngBytes(SF.renderDoc({ scale: s, includeRef: opt.ref, construction: !!opt.construction })) });
  files.push({ name: 'transparent.png', data: await pngBytes(SF.renderDoc({ scale: s, includeRef: opt.ref, construction: !!opt.construction, transparent: true })) });
  files.push({ name: 'drawing.svg', data: new TextEncoder().encode(await io.svg(opt)) });
  files.push({ name: 'layers.json', data: new TextEncoder().encode(JSON.stringify({ name: d.name, width: d.w * s, height: d.h * s, order: 'bottom-to-top', layers: meta }, null, 2)) });
  return io.zip(files);
};

io.itemsZip = async (opt) => {
  const s = opt.scale || 1, files = [], meta = [], d = SF.doc;
  for (const L of d.layers) {
    if (L.ref && !opt.ref) continue;
    const counters = {};
    for (const it of SF.layerItems(L)) {
      if (it.hidden) continue;
      if (it.t === 'path' && SF.lineType(it) === 'construction' && !opt.construction) continue;
      const k = SF.kindOf(it); counters[k.label] = (counters[k.label] || 0) + 1;
      const label = it.name || (k.label + ' ' + counters[k.label]);
      const b = G.bbox(it), pad = 2, x0 = Math.floor(b.x - pad), y0 = Math.floor(b.y - pad), w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
      if (w < 1 || h < 1) continue;
      const c = U.canvas(w * s, h * s), g = c.getContext('2d'); g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
      SF.drawItem(g, it, { z: s, paper: d.paper === 'transparent' ? '#ffffff' : d.paper });
      const name = `items/${safeName(L.name)}/${safeName(k.group)}/${String(meta.length + 1).padStart(3, '0')}-${safeName(label)}.png`;
      files.push({ name, data: await pngBytes(c) });
      meta.push({ file: name, layer: L.name, type: k.group, label, id: it.id, x: x0, y: y0, width: w, height: h, color: SF.itemColor(it) });
    }
  }
  files.push({ name: 'items.json', data: new TextEncoder().encode(JSON.stringify({ board: d.name, width: d.w, height: d.h, scale: s, note: 'x/y/width/height are board pixels; PNGs are cropped to each item', items: meta }, null, 2)) });
  return io.zip(files);
};

/* =============== exports =============== */
io.exportBlob = async (kind, opt) => {
  opt = Object.assign({ scale: 1, ref: false }, opt || {});
  const d = SF.doc, base = safeName(d.name);
  switch (kind) {
    case 'png': return { blob: await toBlob(SF.renderDoc({ scale: opt.scale, includeRef: opt.ref, construction: !!opt.construction })), name: base + '.png' };
    case 'tpng': return { blob: await toBlob(SF.renderDoc({ scale: opt.scale, includeRef: opt.ref, construction: !!opt.construction, transparent: true })), name: base + '-transparent.png' };
    case 'jpg': return { blob: await toBlob(SF.renderDoc({ scale: opt.scale, includeRef: opt.ref, construction: !!opt.construction, paper: d.paper === 'transparent' ? '#ffffff' : d.paper }), 'image/jpeg', 0.92), name: base + '.jpg' };
    case 'svg': return { blob: new Blob([await io.svg(opt)], { type: 'image/svg+xml' }), name: base + '.svg' };
    case 'zip': return { blob: await io.layersZip(opt), name: base + '-layers.zip' };
    case 'ora': return { blob: await io.ora(opt), name: base + '.ora' };
    case 'items': return { blob: await io.itemsZip(opt), name: base + '-items.zip' };
    case 'board': return { blob: new Blob([JSON.stringify(await io.serialize(d, 'url'))], { type: 'application/json' }), name: base + '.sketchflow' };
  }
  throw new Error('Unknown export ' + kind);
};
io.exportFile = async (kind, opt) => {
  try { SF.toast('Preparing ' + kind.toUpperCase() + '…', 900); const r = await io.exportBlob(kind, opt); io.download(r.blob, r.name); }
  catch (e) { console.error(e); SF.toast('Export failed: ' + e.message); }
};

/* =============== open files =============== */
io.openBoardFile = async (file) => {
  const data = JSON.parse(await file.text());
  const doc = await io.deserialize(data);
  if (await get('meta', doc.id).catch(() => null)) doc.id = U.uid('b');
  await io.saveNow(); SF.loadDoc(doc); await io.saveNow(); SF.toast('Opened “' + doc.name + '”');
};
io.openOra = async (file) => {
  const files = await io.unzip(await file.arrayBuffer());
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(files['stack.xml'] || new Uint8Array()), 'application/xml');
  const img = xml.querySelector('image'); if (!img) throw new Error('ORA has no stack.xml');
  const W = +img.getAttribute('w'), Hh = +img.getAttribute('h');
  const doc = SF.newDoc(W, Hh, file.name.replace(/\.ora$/i, '')); doc.layers = []; doc.paper = 'transparent';
  const nodes = [...xml.querySelectorAll('layer')].reverse();
  for (const n of nodes) {
    const src = n.getAttribute('src'); if (!files[src]) continue;
    const im = await io.loadImage(new Blob([files[src]], { type: 'image/png' })); const c = io.imageToCanvas(im, 8192);
    const L = SF.mkLayer(n.getAttribute('name') || 'Layer');
    L.opacity = +(n.getAttribute('opacity') || 1); L.visible = n.getAttribute('visibility') !== 'hidden';
    const op = Object.entries(COMP).find(([, v]) => v === n.getAttribute('composite-op')); if (op) L.blend = op[0];
    const x = +(n.getAttribute('x') || 0), y = +(n.getAttribute('y') || 0);
    L.items = [{ t: 'image', id: U.uid('m'), img: c, iw: c.width, ih: c.height, x: x + c.width / 2, y: y + c.height / 2, s: 1, r: 0, opacity: 1, name: L.name }];
    doc.layers.push(L);
  }
  if (!doc.layers.length) doc.layers.push(SF.mkLayer('Sketch'));
  doc.active = doc.layers[doc.layers.length - 1].id;
  await io.saveNow(); SF.loadDoc(doc); await io.saveNow(); SF.toast('Opened ORA · ' + doc.layers.length + ' layers');
};
io.handleFiles = async (files) => {
  for (const f of files) {
    const n = (f.name || '').toLowerCase();
    try {
      if (n.endsWith('.sketchflow') || n.endsWith('.json') || f.type === 'application/json') await io.openBoardFile(f);
      else if (n.endsWith('.ora')) await io.openOra(f);
      else if ((f.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(n)) await io.importImage(f, f.name);
      else SF.toast('Can’t open ' + f.name);
    } catch (e) { console.error(e); SF.toast('Could not open ' + (f.name || 'file') + ': ' + e.message); }
  }
};

/* =============== import & cut-out =============== */
let imp = null, queue = [];
io.importImage = (src, name) => new Promise((resolve) => { queue.push({ src, name, resolve }); if (!imp) nextImport(); });
async function nextImport() {
  const job = queue.shift(); if (!job) { imp = null; return; }
  let im;
  try { im = await io.loadImage(job.src); } catch (e) { SF.toast(e.message); job.resolve(null); nextImport(); return; }
  const c = io.imageToCanvas(im, 2560);
  const g = c.getContext('2d', { willReadFrequently: true });
  imp = { job, name: (job.name || 'Image').replace(/\.[a-z0-9]+$/i, ''), orig: g.getImageData(0, 0, c.width, c.height), base: null, mode: 'asis', taps: [], w: c.width, h: c.height, result: c };
  imp.base = imp.orig;
  $('#imp').hidden = false; $('#scrim').hidden = false;
  $('#impTrace').checked = false;
  setMode(imp.orig && hasAlpha(imp.orig) ? 'asis' : 'asis');
  draw();
}
function hasAlpha(id) { const d = id.data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) n++; return n > 10; }
function setMode(m) { if (!imp) return; imp.mode = m; [...$('#impModes').children].forEach(b => b.classList.toggle('on', b.dataset.m === m)); }
function draw() {
  if (!imp) return;
  const cvs = $('#impCanvas'); cvs.width = imp.w; cvs.height = imp.h;
  const out = io.cutout(imp.mode === 'ai' && imp.ai ? imp.ai : imp.orig, { auto: imp.mode === 'auto', tol: +$('#impTol').value, soft: +$('#impSoft').value, holes: $('#impHoles').checked, taps: imp.taps, ref: imp.orig });
  cvs.getContext('2d').putImageData(out, 0, 0);
  imp.result = cvs;
}
const redraw = U.debounce(draw, 90);
/* auto background removal from the edges, plus tap-to-remove regions */
io.cutout = (src, o) => {
  const w = src.width, h = src.height, d = src.data, ref = (o.ref || src).data, N = w * h;
  const remove = new Uint8Array(N);
  const th = (o.tol / 100) * (o.tol / 100) * 3 * 255 * 255;
  const near = (i, c) => { const j = i * 4, dr = ref[j] - c[0], dg = ref[j + 1] - c[1], db = ref[j + 2] - c[2]; return dr * dr + dg * dg + db * db <= th; };
  const flood = (seeds, c) => {
    const st = new Int32Array(N); let sp = 0;
    for (const s of seeds) if (!remove[s] && near(s, c)) { remove[s] = 1; st[sp++] = s; }
    while (sp) {
      const i = st[--sp], x = i % w;
      if (x > 0 && !remove[i - 1] && near(i - 1, c)) { remove[i - 1] = 1; st[sp++] = i - 1; }
      if (x < w - 1 && !remove[i + 1] && near(i + 1, c)) { remove[i + 1] = 1; st[sp++] = i + 1; }
      if (i >= w && !remove[i - w] && near(i - w, c)) { remove[i - w] = 1; st[sp++] = i - w; }
      if (i < N - w && !remove[i + w] && near(i + w, c)) { remove[i + w] = 1; st[sp++] = i + w; }
    }
  };
  let bg = null;
  if (o.auto) {
    const border = []; for (let x = 0; x < w; x++) { border.push(x, (h - 1) * w + x); } for (let y = 1; y < h - 1; y++) { border.push(y * w, y * w + w - 1); }
    const buckets = new Map(); let opaque = 0;
    for (const i of border) { const j = i * 4; if (ref[j + 3] < 128) continue; opaque++; const k = (ref[j] >> 4) << 8 | (ref[j + 1] >> 4) << 4 | (ref[j + 2] >> 4); const b = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += ref[j]; b.g += ref[j + 1]; b.b += ref[j + 2]; buckets.set(k, b); }
    if (opaque > border.length * 0.4) {
      const top = [...buckets.values()].sort((a, b) => b.n - a.n); const clusters = []; let cum = 0;
      for (const b of top) { clusters.push([b.r / b.n, b.g / b.n, b.b / b.n]); cum += b.n; if (cum > opaque * 0.7 || clusters.length >= 4) break; }
      bg = clusters[0];
      for (const c of clusters) flood(border, c);
      if (o.holes) for (let i = 0; i < N; i++) if (!remove[i]) for (const c of clusters) if (near(i, c)) { remove[i] = 1; break; }
    }
  }
  for (const t of o.taps || []) { const i = (U.clamp(t.y | 0, 0, h - 1)) * w + U.clamp(t.x | 0, 0, w - 1), j = i * 4; const c = [ref[j], ref[j + 1], ref[j + 2]]; if (!bg) bg = c; flood([i], c); }
  const out = new ImageData(new Uint8ClampedArray(d), w, h);
  if (!o.auto && !(o.taps && o.taps.length)) return out;
  let keep = new Float32Array(N); for (let i = 0; i < N; i++) keep[i] = remove[i] ? 0 : 1;
  const soft = o.soft | 0;
  if (soft > 0) {
    const ch = new Float32Array(N); for (let i = 0; i < N; i++) { const x = i % w; ch[i] = keep[i] && (x === 0 || keep[i - 1]) && (x === w - 1 || keep[i + 1]) && (i < w || keep[i - w]) && (i >= N - w || keep[i + w]) ? 1 : 0; }
    keep = ch;
    const tmp = new Float32Array(N);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) { let s = 0; const row = y * w; for (let x = -soft; x <= soft; x++) s += keep[row + U.clamp(x, 0, w - 1)]; for (let x = 0; x < w; x++) { tmp[row + x] = s / (2 * soft + 1); s += keep[row + U.clamp(x + soft + 1, 0, w - 1)] - keep[row + U.clamp(x - soft, 0, w - 1)]; } }
      for (let x = 0; x < w; x++) { let s = 0; for (let y = -soft; y <= soft; y++) s += tmp[U.clamp(y, 0, h - 1) * w + x]; for (let y = 0; y < h; y++) { keep[y * w + x] = s / (2 * soft + 1); s += tmp[U.clamp(y + soft + 1, 0, h - 1) * w + x] - tmp[U.clamp(y - soft, 0, h - 1) * w + x]; } }
    }
  }
  const od = out.data;
  for (let i = 0; i < N; i++) {
    const a = keep[i], j = i * 4;
    if (a >= 0.999) continue;
    if (a > 0.02 && bg) { for (let k = 0; k < 3; k++) od[j + k] = U.clamp((od[j + k] - bg[k] * (1 - a)) / a, 0, 255); }
    od[j + 3] = od[j + 3] * a;
  }
  return out;
};
async function aiCut() {
  if (imp.ai) { setMode('ai'); draw(); return; }
  $('#impBusy').hidden = false; $('#impBusy').textContent = 'Loading AI cut-out…';
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
    const fn = mod.removeBackground || (mod.default && mod.default.removeBackground) || mod.default;
    const src = U.canvas(imp.w, imp.h); src.getContext('2d').putImageData(imp.orig, 0, 0);
    const blob = await fn(await toBlob(src), { model: 'isnet_quint8', output: { format: 'image/png' }, progress: (k, cur, tot) => { $('#impBusy').textContent = 'AI cut-out · ' + (tot ? Math.round(cur / tot * 100) + '%' : '…'); } });
    const im = await io.loadImage(blob); const c = U.canvas(imp.w, imp.h); c.getContext('2d').drawImage(im, 0, 0, imp.w, imp.h);
    imp.ai = c.getContext('2d').getImageData(0, 0, imp.w, imp.h); setMode('ai'); draw();
  } catch (e) {
    console.warn(e); SF.toast('AI cut-out isn’t reachable here (offline or blocked) — using the auto cut-out', 3200); setMode('auto'); draw();
  } finally { $('#impBusy').hidden = true; }
}
function place() {
  if (!imp) return;
  const c = U.copyCanvas(imp.result), trace = $('#impTrace').checked, cut = imp.mode !== 'asis' || imp.taps.length > 0;
  io.placeCanvas(c, { name: imp.name, cut, trace });
  const j = imp.job; closeImp(); j.resolve(true); setTimeout(nextImport, 50);
}
io.placeCanvas = (c, o) => {
  o = o || {}; const d = SF.doc;
  const center = o.x != null ? { x: o.x, y: o.y } : (() => { const p = SF.toDoc(innerWidth / 2, innerHeight / 2); return { x: U.clamp(p.x, 0, d.w), y: U.clamp(p.y, 0, d.h) }; })();
  let s = Math.min(1, (d.w * 0.7) / c.width, (d.h * 0.7) / c.height);
  if (o.width) s = o.width / c.width; else if (o.height) s = o.height / c.height;
  const item = { t: 'image', id: U.uid('m'), img: c, iw: c.width, ih: c.height, x: center.x, y: center.y, s, r: o.rotation || 0, opacity: 1, cut: !!o.cut, name: o.name || 'Image' };
  const idx = SF.layerIndex();
  let L;
  if (o.trace) {
    L = SF.mkLayer('Ref · ' + (o.name || 'image')); L.ref = true; L.opacity = 0.5; L.items = [item];
    SF.doc.layers.splice(idx + 1, 0, L);
    const ink = SF.mkLayer('Ink'); SF.doc.layers.splice(idx + 2, 0, ink); SF.doc.active = ink.id;
    SF.doc.guides.lightbox = true;
    SF.commit('Trace image'); SF.emit('layers'); SF.ui.syncTop();
    SF.toast('Tracing: photo is a faded reference, draw on “Ink”', 2200);
  } else {
    L = o.layer || SF.mkLayer(o.name || 'Image'); L.items = L.items.concat([item]);
    if (!o.layer) { SF.doc.layers.splice(idx + 1, 0, L); }
    SF.doc.active = L.id; SF.commit('Place image'); SF.emit('layers');
    SF.setTool('select'); SF.sel.set([item.id], L.id);
    SF.toast('Placed · drag to move, corners to scale, top dot to rotate', 2000);
  }
  return { layer: L, item };
};
function closeImp() { $('#imp').hidden = true; $('#scrim').hidden = true; imp = null; }
function bindImport() {
  $('#impModes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || !imp) return; if (b.dataset.m === 'ai') aiCut(); else { setMode(b.dataset.m); draw(); } });
  ['impTol', 'impSoft', 'impHoles'].forEach(id => $('#' + id).addEventListener('input', () => { if (imp && imp.mode === 'asis' && !imp.taps.length && id !== 'impSoft') setMode('auto'); redraw(); }));
  $('#impCanvas').addEventListener('pointerdown', (e) => { if (!imp) return; const r = e.target.getBoundingClientRect(); imp.taps.push({ x: (e.clientX - r.left) / r.width * imp.w, y: (e.clientY - r.top) / r.height * imp.h }); draw(); });
  $('#impUndoTap').onclick = () => { if (imp && imp.taps.length) { imp.taps.pop(); draw(); } };
  $('#impCancel').onclick = () => { const j = imp && imp.job; closeImp(); j && j.resolve(null); setTimeout(nextImport, 50); };
  $('#impPlace').onclick = place;
  $('#fileIn').addEventListener('change', (e) => { io.handleFiles([...e.target.files]); e.target.value = ''; });
  $('#openIn').addEventListener('change', (e) => { io.handleFiles([...e.target.files]); e.target.value = ''; });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => { e.preventDefault(); const f = [...(e.dataTransfer && e.dataTransfer.files || [])]; if (f.length) io.handleFiles(f); });
  document.addEventListener('paste', (e) => {
    const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable)) return;
    const files = [...(e.clipboardData && e.clipboardData.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); io.handleFiles(files); return; }
    const txt = e.clipboardData && e.clipboardData.getData('text/plain');
    if (txt && txt.trim()) {
      const L = SF.drawTarget(); if (!L) return;
      const c = SF.toDoc(innerWidth / 2, innerHeight / 2);
      SF.addItems(L, [{ t: 'text', id: U.uid('t'), x: c.x, y: c.y, text: txt.slice(0, 2000), size: P().sizes.text, font: P().font, bold: P().bold, italic: P().italic, color: P().color, opacity: 1, align: 'left', r: 0 }]);
      SF.commit('Paste text');
    }
  });
}

})(window.SF);
