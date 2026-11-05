#!/usr/bin/env node
/*
 * SketchFlow MCP server — zero dependencies (Node 18+).
 *  - Speaks MCP (JSON-RPC 2.0, newline-delimited) on stdin/stdout for Claude / any MCP client.
 *  - Serves the SketchFlow board on http://localhost:7777 and talks to it over Server-Sent Events.
 * Usage:
 *   claude mcp add sketchflow -- node /absolute/path/to/sketchflow/server.mjs
 *   node server.mjs --serve        (just host the board, no MCP)
 * Env:
 *   SKETCHFLOW_PORT=7777   first port to try (walks up if busy)
 *   SKETCHFLOW_NO_OPEN=1   never auto-open a browser
 *   SKETCHFLOW_LAN=1       also listen on your network so a tablet/phone can be the drawing surface (pairing code required)
 *   SKETCHFLOW_EXPORT_DIR  default folder for exports (else ~/Pictures/SketchFlow or ~/SketchFlow)
 *   SKETCHFLOW_ADDONS      extra folder of 3D add-ons (*.js, see model/ADDONS.md); model/addons/ is always loaded
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '2.0.0';
const ARGS = process.argv.slice(2);
const SERVE_ONLY = ARGS.includes('--serve');
const NO_OPEN = process.env.SKETCHFLOW_NO_OPEN === '1' || ARGS.includes('--no-open');
const LAN = process.env.SKETCHFLOW_LAN === '1' || ARGS.includes('--lan');
const BASE_PORT = Number(process.env.SKETCHFLOW_PORT || 7777);
const TOKEN = crypto.randomBytes(16).toString('hex');
const PAIR = crypto.randomBytes(3).toString('hex');
const log = (...a) => process.stderr.write('[sketchflow] ' + a.join(' ') + '\n');

let PORT = 0;
const clients = new Map();      /* cid -> {res, at, kind} ; kind = 'board' (2D) | 'model' (3D) */
const primaries = { board: null, model: null };
const kindOf = (k) => (k === 'model' ? 'model' : 'board');
const live = (kind) => { const p = primaries[kind]; return p && clients.has(p) ? p : null; };
const pending = new Map();      /* request id -> {resolve, reject, timer} */
let inbox = null;               /* last sketch the user pressed Send on */
const sketchWaiters = new Set();

/* ======================= HTTP + SSE bridge ======================= */
const isLoop = (addr) => !addr || addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
const lanIPs = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const sse = (c, event, data) => { try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } };
const broadcastRoles = (kind) => { for (const [cid, c] of clients) if (c.kind === kind) sse(c, 'role', { primary: cid === primaries[kind] }); };
function readBody(req, limit = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

async function pageHtml(file = 'index.html') {
  let html = await fsp.readFile(path.join(ROOT, file), 'utf8');
  html = html.replace('<meta name="sketchflow-bridge" content="">', `<meta name="sketchflow-bridge" content="${TOKEN}">`);
  /* index.html starts with head elements (title/meta/style), so the parser keeps them in <head> */
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${html}\n</html>\n`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const local = isLoop(req.socket.remoteAddress);
    if (!LAN && !['localhost', '127.0.0.1', '::1'].includes(host)) return send(res, 403, 'forbidden host', 'text/plain');
    if (req.method === 'POST' && req.headers.origin) {
      const o = new URL(req.headers.origin); if (o.host !== req.headers.host) return send(res, 403, 'forbidden origin', 'text/plain');
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      if (!local && url.searchParams.get('k') !== PAIR) return send(res, 403, `<p style="font:16px system-ui;padding:2em">Add the pairing code: <code>?k=…</code> (ask Claude to call <b>open_board</b> to see it).</p>`, 'text/html; charset=utf-8');
      return send(res, 200, await pageHtml(), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/3d') { res.writeHead(302, { location: '/3d/' + url.search }); return res.end(); }
    if (req.method === 'GET' && (url.pathname === '/3d/' || url.pathname === '/3d/index.html')) {
      if (!local && url.searchParams.get('k') !== PAIR) return send(res, 403, `<p style="font:16px system-ui;padding:2em">Add the pairing code: <code>?k=…</code> (ask Claude to call <b>open_model</b> to see it).</p>`, 'text/html; charset=utf-8');
      return send(res, 200, await pageHtml(path.join('model', 'index.html')), 'text/html; charset=utf-8');
    }
    /* 3D add-ons: model/addons/*.js plus SKETCHFLOW_ADDONS; the page loads every file listed here */
    if (req.method === 'GET' && url.pathname === '/3d/addons/index.json') return send(res, 200, await addonFiles().then(m => [...m.keys()]));
    const ad = url.pathname.match(/^\/3d\/addons\/([\w.-]+\.js)$/);
    if (req.method === 'GET' && ad) { const f = (await addonFiles()).get(ad[1]); if (!f) return send(res, 404, 'not found', 'text/plain'); return send(res, 200, await fsp.readFile(f), 'text/javascript; charset=utf-8'); }
    const js = url.pathname.match(/^\/(3d\/)?js\/([\w-]+\.js)$/);
    if (req.method === 'GET' && js) {
      const f = path.join(ROOT, js[1] ? path.join('model', 'js') : 'js', js[2]);
      if (!fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, await fsp.readFile(f), 'text/javascript; charset=utf-8');
    }
    if (url.pathname.startsWith('/bridge/')) {
      const tok = url.searchParams.get('t') || req.headers['x-bridge-token'];
      if (tok !== TOKEN) return send(res, 403, { error: 'bad token' });
      if (url.pathname === '/bridge/events' && req.method === 'GET') {
        const cid = String(url.searchParams.get('cid') || crypto.randomUUID());
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(': hi\n\n');
        const kind = kindOf(url.searchParams.get('kind'));
        const c = { res, at: Date.now(), kind }; clients.set(cid, c); primaries[kind] = cid;
        sse(c, 'hello', { primary: true, version: VERSION, kind }); broadcastRoles(kind);
        const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { /* closed */ } }, 20000);
        req.on('close', () => {
          clearInterval(ka); clients.delete(cid);
          if (primaries[kind] === cid) { primaries[kind] = [...clients].filter(([, v]) => v.kind === kind).map(([k]) => k).pop() || null; broadcastRoles(kind); }
        });
        log(kind === 'model' ? '3D workspace connected' : 'board connected', cid);
        return;
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      const body = await readBody(req);
      if (url.pathname === '/bridge/reply') {
        const p = pending.get(body.id);
        if (p) { pending.delete(body.id); clearTimeout(p.timer); body.ok ? p.resolve(body.result) : p.reject(new Error(body.error || 'board error')); }
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/bridge/push') {
        inbox = Object.assign({ at: Date.now() }, body);
        for (const w of sketchWaiters) w(inbox); sketchWaiters.clear();
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/bridge/claim') { const c = clients.get(body.cid); if (c) { primaries[c.kind] = body.cid; broadcastRoles(c.kind); } return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'unknown bridge route' });
    }
    send(res, 404, 'not found', 'text/plain');
  } catch (e) { log('http error', e.message); try { send(res, 500, { error: e.message }); } catch { /* already sent */ } }
});

async function addonFiles() {
  const out = new Map();
  for (const dir of [path.join(ROOT, 'model', 'addons'), process.env.SKETCHFLOW_ADDONS && process.env.SKETCHFLOW_ADDONS.replace(/^~(?=$|\/|\\)/, os.homedir())].filter(Boolean)) {
    try { for (const f of await fsp.readdir(dir)) if (/^[\w.-]+\.js$/.test(f) && !out.has(f)) out.set(f, path.join(dir, f)); } catch { /* folder missing */ }
  }
  return out;
}
function listen(port, tries = 0) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => { server.off('listening', onOk); if (e.code === 'EADDRINUSE' && tries < 25) resolve(listen(port + 1, tries + 1)); else reject(e); };
    const onOk = () => { server.off('error', onErr); resolve(port); };
    server.once('error', onErr); server.once('listening', onOk);
    server.listen(port, LAN ? '0.0.0.0' : '127.0.0.1');
  });
}
const boardUrl = () => `http://localhost:${PORT}/`;
const modelUrl = () => `http://localhost:${PORT}/3d/`;
const lanUrls = (p = '/') => (LAN ? lanIPs().map(ip => `http://${ip}:${PORT}${p}?k=${PAIR}`) : []);

function openBrowser(url) {
  if (NO_OPEN) return false;
  try {
    const p = process.platform;
    const child = p === 'darwin' ? spawn('open', [url], { stdio: 'ignore', detached: true })
      : p === 'win32' ? spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true, windowsVerbatimArguments: true })
        : spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => { /* no browser launcher */ }); child.unref(); return true;
  } catch { return false; }
}
const lastOpenAt = { board: 0, model: 0 };
async function ensureClient(kind, waitMs = 20000) {
  if (live(kind)) return;
  const url = kind === 'model' ? modelUrl() : boardUrl();
  if (Date.now() - lastOpenAt[kind] > 25000) { lastOpenAt[kind] = Date.now(); openBrowser(url); }
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) { if (live(kind)) return; await new Promise(r => setTimeout(r, 250)); }
  const what = kind === 'model' ? 'SketchFlow 3D workspace' : 'SketchFlow board';
  throw new Error(`The ${what} isn't open. Ask the user to open ${url} in a browser${LAN ? ' (or on a tablet: ' + lanUrls(kind === 'model' ? '/3d/' : '/').join(' , ') + ')' : ''}, then try again.`);
}
const ensureBoard = (w) => ensureClient('board', w);
const ensureModel = (w) => ensureClient('model', w);
async function call(kind, cmd, args = {}, timeoutMs = 60000) {
  await ensureClient(kind);
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`The ${kind === 'model' ? '3D workspace' : 'board'} did not answer "${cmd}" in time.`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    sse(clients.get(live(kind)), 'cmd', { id, cmd, args });
  });
}
const board = (cmd, args, t) => call('board', cmd, args, t);
const model = (cmd, args, t) => call('model', 'model.' + cmd, args, t);

/* ======================= MCP tools ======================= */
const S = (props, req = []) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const layerRef = { type: ['string', 'integer'], description: 'Layer id, exact name, or index (0 = bottom). Defaults to the active layer.' };
const itemSchema = {
  type: 'object',
  description: 'One drawing item. Coordinates are board pixels, origin top-left. Shared endpoints become joints that snap together (joined lines move together in SketchFlow).',
  properties: {
    type: { type: 'string', enum: ['line', 'arrow', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'arc', 'star', 'box', 'cylinder', 'cone', 'sphere', 'pyramid', 'prism', 'freehand', 'path', 'text', 'dimension', 'fill'], description: 'fill = fill the closed region around (x,y); with follow (default true) the fill is tied to the surrounding lines and reshapes when they move' },
    follow: { type: 'boolean', description: 'fill only: tie the fill to its outline (default true)' },
    id: { type: 'string', description: 'Optional stable id so you can reference it later (e.g. text "along", motors).' },
    x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
    x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
    cx: { type: 'number' }, cy: { type: 'number' }, r: { type: 'number' }, rx: { type: 'number' }, ry: { type: 'number' },
    start: { type: 'number', description: 'arc start angle, degrees (0 = +x, clockwise on screen)' }, end: { type: 'number', description: 'arc end angle, degrees' },
    points: { description: 'polyline/polygon/freehand: [[x,y],...] (freehand may add pressure 0..1 as 3rd value). star: number of points.', anyOf: [{ type: 'array', items: { type: 'array', items: { type: 'number' } } }, { type: 'integer' }] },
    closed: { type: 'boolean' }, inner: { type: 'number', description: 'star inner radius ratio (0..1)' },
    d: { type: 'string', description: 'SVG path data for type "path" (M L H V C S Q T A Z, absolute or relative).' },
    text: { type: 'string' }, size: { type: 'number', description: 'font size px' }, font: { type: 'string', enum: ['sans', 'serif', 'hand', 'marker', 'mono', 'display'] },
    bold: { type: 'boolean' }, italic: { type: 'boolean' }, align: { type: 'string', enum: ['left', 'center', 'right'] }, rotation: { type: 'number', description: 'degrees' },
    along: { type: 'string', description: 'text only: id of a line/path to run the text along' },
    surface: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'text only: a point inside a 4-sided face (e.g. a side of an iso box) — the text is mapped onto that plane and follows it when the face moves' },
    on: { type: 'string', description: 'text only: id of a closed 4-corner shape to put the text on' },
    corners: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'text only: four [x,y] corners (top-left, top-right, bottom-right, bottom-left) of a plane to map the text onto' },
    turn: { type: 'integer', description: 'text on a surface: quarter turns on the face' },
    fit: { type: 'boolean', description: 'text on a surface: shrink to fit the face (default true)' },
    offset: { type: 'number', description: 'dimension: perpendicular offset of the dimension line (px)' }, axis: { type: 'string', enum: ['h', 'v', 'aligned'] }, label: { type: 'string' },
    color: { type: 'string', description: 'stroke/text colour, e.g. #1c1c1e' }, width: { type: 'number', description: 'stroke width px' }, opacity: { type: 'number' },
    fill: { type: 'string', description: 'fill colour for closed shapes, or "none"' }, fill_opacity: { type: 'number' }, dash: { type: 'boolean' },
    brush: { type: 'string', enum: ['pen', 'pencil', 'marker', 'brush'] }, stroke: { type: ['string', 'boolean'], description: '"none"/false for fill only' },
    snap: { type: 'boolean', description: 'snap endpoints to existing joints within 8px (default true); line ends placed exactly on a segment midpoint or shape centre stay connected to it' },
    line_type: { type: 'string', enum: ['solid', 'dashed', 'center', 'construction'], description: 'dashed = hidden edge, center = dash-dot centre line, construction = guide line (never printed/exported, never blocks fills)' },
    cube: { type: 'boolean', description: '3D primitives: equal width/depth/height' },
    hidden_edges: { type: 'boolean', description: '3D primitives: draw hidden edges dashed (default true)' },
    from: { type: 'string', enum: ['corner', 'centre'], description: '3D primitives, parametric placement: x,y is the base centre (centre) or the base back corner (corner); then width (iso X), depth (iso Y), height, radius are TRUE sizes in board px, and a height dimension that drives the primitive is added (height_dim:false to skip)' },
    depth: { type: 'number' }, radius: { type: 'number' }, height_dim: { type: 'boolean' },
    views: { type: 'boolean', description: '3D primitives in 3-view/4-view space: false = just the iso drawing. Otherwise x,y,w,h inside the FRONT quadrant draws front/top/side (+iso in 4-view) aligned' }
  },
  required: ['type']
};
const TOOLS = [
  { name: 'open_board', description: 'Open the SketchFlow sketch board in the user\'s browser (if it is not already open) and report its address and status. Call this first.', inputSchema: S({}),
    run: async () => {
      if (!live('board')) { lastOpenAt.board = Date.now(); openBrowser(boardUrl()); }
      try { await ensureBoard(15000); } catch (e) { return text(e.message + '\nBoard URL: ' + boardUrl()); }
      const i = await board('info');
      return text(`SketchFlow board is open at ${boardUrl()}${LAN ? '\nTablet/phone: ' + lanUrls().join('  ') : ''}\n` + JSON.stringify(i, null, 1));
    } },
  { name: 'look', description: 'See the board: returns a PNG of everything visible (or one layer) plus board info (size, layers, drawing space, units). Use this whenever the user says "look at this".', inputSchema: S({ layer: layerRef, max_size: { type: 'integer', description: 'longest side of returned image, px (default 1024)' }, transparent: { type: 'boolean' }, include_reference: { type: 'boolean', description: 'include tracing/reference layers (default true)' } }),
    run: async (a) => {
      const r = await board('snapshot', a);
      const note = inbox && !inbox.read ? `\nUser's last sent note: "${inbox.note || ''}"` : '';
      return { content: [{ type: 'image', data: r.png, mimeType: 'image/png' }, { type: 'text', text: `Image ${r.width}x${r.height} at scale ${r.scale.toFixed(4)} (board coords = image coords / ${r.scale.toFixed(4)}).${note}\n` + JSON.stringify(r.info) }] };
    } },
  { name: 'wait_for_sketch', description: 'Ask the user to sketch something and wait until they press "Send" on the board. Returns their sketch image and note. If they already sent one that you have not seen, it returns immediately.', inputSchema: S({ prompt: { type: 'string', description: 'Short request shown on the board, e.g. "sketch the bracket shape"' }, timeout_seconds: { type: 'integer', description: 'default 90, max 600' } }),
    run: async (a) => {
      if (inbox && !inbox.read) return sketchResult(inbox);
      await ensureBoard();
      if (a.prompt) await board('banner', { text: a.prompt }).catch(() => {});
      const secs = Math.min(600, Math.max(5, a.timeout_seconds || 90));
      const got = await new Promise((resolve) => { const w = (s) => { clearTimeout(t); resolve(s); }; const t = setTimeout(() => { sketchWaiters.delete(w); resolve(null); }, secs * 1000); sketchWaiters.add(w); });
      await board('banner', {}).catch(() => {});
      if (!got) return text(`No sketch yet after ${secs}s. The user can keep drawing; call wait_for_sketch again or use look to see the board now.`);
      return sketchResult(got);
    } },
  { name: 'draw', description: 'Draw vector items on the board (lines, polylines, shapes, 3D primitives box/cylinder/cone/sphere/pyramid/prism with shaded faces, dashed hidden edges and centre lines, freehand, SVG paths, text — including text along a path — parametric dimensions, and region fills that follow their outline). Endpoints that share coordinates become joined joints. Items animate in so the user can watch.', inputSchema: S({ items: { type: 'array', items: itemSchema }, layer: layerRef, new_layer: { type: 'string', description: 'create a new layer with this name and draw on it' }, animate: { type: 'boolean' }, label: { type: 'string', description: 'undo-history label' } }, ['items']),
    run: async (a) => json(await board('draw', a)) },
  { name: 'edit_items', description: 'List or change existing items. list → ids, type groups (Lines, Strokes, Rectangles, Circles, Triangles, Polygons, Fills, Text, Dimensions, Images), bboxes, vertices and joints of a layer. color_by_type gives each type its own palette colour. style can also set name, hidden, locked. delete/move/transform/style by ids. move_joint moves every vertex at (x,y) to (to_x,to_y) so joined lines follow. set_dimension sets a dimension to a value (in board units) and moves the geometry to match (parametric; the height dimension of a 3D primitive rebuilds the primitive). set_size changes the width/depth/height/radius of a parametric 3D primitive and rebuilds it.', inputSchema: S({ action: { type: 'string', enum: ['list', 'delete', 'move', 'transform', 'style', 'move_joint', 'set_dimension', 'color_by_type', 'set_size'] }, group_id: { type: 'string', description: 'set_size: a 3D primitive (or give id of any of its parts)' }, width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' }, radius: { type: 'number' }, layer: layerRef, ids: { type: 'array', items: { type: 'string' } }, dx: { type: 'number' }, dy: { type: 'number' }, cx: { type: 'number' }, cy: { type: 'number' }, scale: { type: 'number' }, rotate: { type: 'number', description: 'degrees' }, style: { type: 'object', description: '{color,width,opacity,fill,line_type,text,size,font,name,hidden,locked; text only: along (line id to attach, "" to detach), offset (slide along the line px), lift (raise off the line px)}' }, x: { type: 'number' }, y: { type: 'number' }, to_x: { type: 'number' }, to_y: { type: 'number' }, id: { type: 'string', description: 'dimension id for set_dimension' }, value: { type: 'number' } }, ['action']),
    run: async (a) => json(await board('items', a)) },
  { name: 'layers', description: 'Manage layers: list, add, update (name, visible, opacity 0-1, color — layer "Background" is the pinned bottom layer that fills the canvas: update it with color and/or visible, blend normal|multiply|screen|overlay|darken|lighten|color-dodge|difference, reference = tracing underlay excluded from export, locked, index), select, clear, delete.', inputSchema: S({ action: { type: 'string', enum: ['list', 'add', 'update', 'select', 'clear', 'delete'] }, layer: layerRef, name: { type: 'string' }, visible: { type: 'boolean' }, opacity: { type: 'number' }, blend: { type: 'string' }, reference: { type: 'boolean' }, locked: { type: 'boolean' }, index: { type: 'integer' }, color: { type: 'string', description: 'Background only: canvas colour' } }, ['action']),
    run: async (a) => json(await board('layers', a)) },
  { name: 'drawing_space', description: 'Set the drawing space and guides: free, grid (flat), iso (isometric), p1/p2/p3 (1/2/3-point perspective; set vanishing_points), v3 (front/top/side orthographic views: top-left=TOP, bottom-left=FRONT, bottom-right=RIGHT SIDE), v4 (3-view + isometric quadrant top-right). Also grid size, lightbox, snapping and dimension units.', inputSchema: S({ space: { type: 'string', enum: ['free', 'grid', 'iso', 'p1', 'p2', 'p3', 'v3', 'v4'] }, vanishing_points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } }, grid: { type: 'number' }, lightbox: { type: 'boolean' }, snap: { type: 'boolean' }, units: { type: 'string', enum: ['px', 'mm', 'cm', 'm', 'in', 'ft'] }, units_per_px: { type: 'number', description: 'e.g. 0.5 means 1px = 0.5 mm' } }),
    run: async (a) => json(await board('guides', a)) },
  { name: 'board', description: 'Board-level actions: info, new (width,height,name,paper), paper (colour or "transparent"), rename, undo/redo (steps), fit, list saved boards, open (id).', inputSchema: S({ action: { type: 'string', enum: ['info', 'new', 'paper', 'rename', 'undo', 'redo', 'fit', 'list', 'open'] }, width: { type: 'integer' }, height: { type: 'integer' }, name: { type: 'string' }, paper: { type: 'string' }, steps: { type: 'integer' }, id: { type: 'string' } }, ['action']),
    run: async (a) => json(await board('board', a)) },
  { name: 'place_image', description: 'Place an image on the board as its own layer (collage), optionally removing its background, or as a faded tracing reference with an ink layer above (lightbox). Give a local file path, a URL, or base64 data.', inputSchema: S({ path: { type: 'string' }, url: { type: 'string' }, base64: { type: 'string' }, mime: { type: 'string' }, x: { type: 'number', description: 'centre x (board px)' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, rotation: { type: 'number', description: 'degrees' }, remove_background: { type: 'boolean' }, tolerance: { type: 'number', description: 'background removal strength 2-60 (default 18)' }, as_reference: { type: 'boolean' }, name: { type: 'string' }, layer: layerRef }),
    run: async (a) => {
      let buf, mime = a.mime;
      if (a.path) { const p = a.path.replace(/^~(?=$|\/|\\)/, os.homedir()); buf = await fsp.readFile(p); mime = mime || mimeOf(p); }
      else if (a.url) { const r = await fetch(a.url); if (!r.ok) throw new Error('Could not download image: HTTP ' + r.status); buf = Buffer.from(await r.arrayBuffer()); mime = mime || r.headers.get('content-type') || mimeOf(a.url); }
      else if (a.base64) { const m = a.base64.match(/^data:([^;]+);base64,(.*)$/); buf = Buffer.from(m ? m[2] : a.base64, 'base64'); mime = mime || (m && m[1]) || 'image/png'; }
      else throw new Error('Give path, url or base64');
      const args = Object.assign({}, a, { data_url: `data:${mime || 'image/png'};base64,${buf.toString('base64')}`, name: a.name || (a.path ? path.basename(a.path).replace(/\.[^.]+$/, '') : 'Image') });
      delete args.path; delete args.url; delete args.base64; delete args.mime;
      return json(await board('image', args, 120000));
    } },
  { name: 'export', description: 'Save the board to disk: png (flattened), tpng (transparent), jpg, svg (vector, layers as groups), zip (every layer PNG + flat + SVG), items (every item as its own cropped PNG, grouped by type, + items.json), ora (layered, opens in Krita/GIMP), board (.sketchflow, re-openable), layers (one PNG per layer). Returns the file paths.', inputSchema: S({ dir: { type: 'string', description: 'folder to write into (default ~/Pictures/SketchFlow)' }, formats: { type: 'array', items: { type: 'string', enum: ['png', 'tpng', 'jpg', 'svg', 'zip', 'items', 'ora', 'board', 'layers'] } }, scale: { type: 'number' }, include_reference: { type: 'boolean' } }),
    run: async (a) => {
      const r = await board('export', { formats: a.formats, scale: a.scale, include_reference: a.include_reference }, 180000);
      const base = a.dir ? a.dir.replace(/^~(?=$|\/|\\)/, os.homedir()) : defaultExportDir();
      const folder = path.join(base, (r.board || 'sketch').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
      const written = [];
      for (const f of r.files) { const out = path.join(folder, f.name); await fsp.mkdir(path.dirname(out), { recursive: true }); await fsp.writeFile(out, Buffer.from(f.b64, 'base64')); written.push(out); }
      return text('Saved ' + written.length + ' file(s):\n' + written.join('\n'));
    } },
  { name: 'mechanism', description: 'Kinematics / linkages: every drawn item on the active layer is a rigid link; joints shared by two items are pin joints. Pin joints to ground, put a motor on a link (rotating about a pivot joint), trace joints, then simulate (returns joint paths and whether it locks) and/or play the animation for the user. Build the links with draw first (exact shared coordinates = pin joints).', inputSchema: S({ pins: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } }, motors: { type: 'array', items: { type: 'object', properties: { item: { type: 'string', description: 'id of the link that is driven' }, pivot_x: { type: 'number' }, pivot_y: { type: 'number' }, rpm: { type: 'number' } }, required: ['item', 'pivot_x', 'pivot_y'] } }, traces: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } }, watch: { type: 'array', description: 'joints whose paths to return', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } }, steps: { type: 'integer', description: 'samples per motor turn (default 72)' }, simulate: { type: 'boolean' }, play: { type: 'boolean' }, clear: { type: 'boolean' } }),
    run: async (a) => json(await board('mechanism', a)) },
  /* ---------------- 3D parametric model workspace (/3d/) ---------------- */
  { name: 'open_model', description: 'Open the SketchFlow 3D workspace (parametric solids shown in 4 linked views: TOP | 3D / FRONT | RIGHT) in the user\'s browser and describe the current model. Call this before the other model_* tools.', inputSchema: S({}),
    run: async () => {
      if (!live('model')) { lastOpenAt.model = Date.now(); openBrowser(modelUrl()); }
      try { await ensureModel(15000); } catch (e) { return text(e.message + '\n3D workspace URL: ' + modelUrl()); }
      const d = await model('describe');
      return text(`SketchFlow 3D is open at ${modelUrl()}${LAN ? '\nTablet/phone: ' + lanUrls('/3d/').join('  ') : ''}\n` + JSON.stringify(d, null, 1));
    } },
  { name: 'model_build', description: 'Build or change the 3D model with a batch of operations (atomic: all apply or none, one undo step for the user). Same operations the UI uses. Returns per-op results (new ids, edge convexity) and the model summary; look:true also returns a picture of the 4 views. See the server instructions for the op list, connector names and mate rules.', inputSchema: S({
      ops: { type: 'array', description: 'Operations, applied in order. Each is an object with "op": add | set | mate | unmate | boolean | separate | edge | weld | pattern | extrude | loft | revolve | sweep | delete | origin | ground | fix | cleanup | dim | setdim | dimaxis | undim | var | link | unlink | joint | drive | suppress | rollback | move | duplicate | rename | material | addon.', items: { type: 'object', additionalProperties: true, properties: { op: { type: 'string', enum: ['add', 'set', 'mate', 'unmate', 'boolean', 'separate', 'edge', 'weld', 'pattern', 'extrude', 'loft', 'revolve', 'sweep', 'delete', 'origin', 'ground', 'fix', 'cleanup', 'dim', 'setdim', 'dimaxis', 'undim', 'var', 'link', 'unlink', 'joint', 'drive', 'suppress', 'rollback', 'move', 'duplicate', 'hole', 'shell', 'text', 'feature', 'plane', 'split', 'helix', 'thread', 'wrap', 'config', 'instance', 'import', 'constrain', 'unconstrain', 'rename', 'material', 'addon'] } }, required: ['op'] } },
      label: { type: 'string', description: 'Undo-history label the user sees, e.g. "Add mounting holes"' },
      look: { type: 'boolean', description: 'also return a PNG of the views after building (default false)' },
      layout: { type: 'string', enum: ['4', '3d', 'top', 'front', 'right'], description: 'with look: which view(s) to picture' },
      relative: { type: 'boolean', description: 'positions (at, near) are measured from the model origin, like model_describe reports them (default true)' },
      fit: { type: 'boolean', description: 'zoom the user\'s views to fit afterwards (default true)' }
    }, ['ops']),
    run: async (a) => {
      const r = await model('apply', { ops: a.ops, label: a.label, look: !!a.look, layout: a.layout, relative: a.relative, fit: a.fit });
      const summary = text(JSON.stringify({ results: r.results, model: r.model }, null, 1));
      if (r.png) summary.content.unshift({ type: 'image', data: r.png, mimeType: 'image/png' });
      return summary;
    } },
  { name: 'model_describe', description: 'Read the 3D model: objects (id, type, parameters, position from the origin, mate, boolean role, connector names), bodies (volume, bounding box), warnings (floating / orphaned / empty / errors). connectors_of gives one object\'s connectors with positions and outward normals — use it to pick mate targets and edge points.', inputSchema: S({ connectors_of: { type: 'string', description: 'object id (or "origin")' } }),
    run: async (a) => json(await model('describe', a)) },
  { name: 'model_view', description: 'See the 3D model: returns a PNG of the linked views (default all four: TOP top-left, 3D top-right, FRONT bottom-left, RIGHT bottom-right, third-angle) with carried dimensions and dashed hidden edges, plus the model summary. The user\'s own view is restored afterwards.', inputSchema: S({
      layout: { type: 'string', enum: ['4', '3d', 'top', 'front', 'right'], description: 'default 4' },
      view: { type: 'string', enum: ['iso', 'front', 'top', 'right', 'back', 'left', 'bottom'], description: 'direction of the 3D pane camera' },
      hidden_lines: { type: 'boolean' }, dimensions: { type: 'boolean' },
      keep: { type: 'boolean', description: 'leave the user\'s screen on this view (default false)' },
      joints: { type: 'object', additionalProperties: true, description: 'show a motion pose without changing the model: {jointId: value} or {jointId: {angle: 30, travel: 10}}' },
      section: { type: 'object', additionalProperties: false, properties: { axis: { type: 'string', enum: ['x', 'y', 'z'] }, offset: { type: 'number' }, flip: { type: 'boolean' } }, description: 'cut the model with a plane (offset from the origin); cut faces show hatched' }
    }),
    run: async (a) => {
      const r = await model('snapshot', a);
      return { content: [{ type: 'image', data: r.png, mimeType: 'image/png' }, { type: 'text', text: `Image ${r.width}x${r.height}.\n` + JSON.stringify(r.model) }] };
    } },
  { name: 'model_import', description: 'Import an STL (binary or ASCII) or OBJ file from disk as a mesh part (re-centred on its base, stacked on the ground unless mated later). It takes mates, booleans, materials and mass like any part. scale e.g. 25.4 for a model in inches.', inputSchema: S({ path: { type: 'string' }, scale: { type: 'number' }, material: { type: 'string' } }, ['path']),
    run: async (a) => {
      const f = a.path.replace(/^~(?=$|\/|\\)/, os.homedir()), buf = await fsp.readFile(f);
      if (buf.length > 60 * 1024 * 1024) throw new Error('That file is over 60 MB');
      const r = await model('import', { name: path.basename(f), file_b64: buf.toString('base64'), scale: a.scale, material: a.material }, 180000);
      return json({ imported: r.result, model: r.model });
    } },
  { name: 'model_session', description: 'Model-level actions: undo / redo (steps), new (name), demo (load the bracket example), example (no id: list the bundled examples; id: load one, e.g. "pump-housing" — a flanged pump housing with spline gussets, wrapped text, modelled threads and a screw-jointed cap), load (a .sf3d.json file path or a doc object), select (id, highlights it for the user), say (short message shown to the user), save_version (name), versions (list), restore_version (id or name — undoable).', inputSchema: S({ action: { type: 'string', enum: ['undo', 'redo', 'new', 'demo', 'example', 'load', 'select', 'say', 'save_version', 'versions', 'restore_version'] }, steps: { type: 'integer' }, name: { type: 'string' }, path: { type: 'string' }, doc: { type: 'object' }, id: { type: 'string' }, text: { type: 'string' }, seconds: { type: 'integer' } }, ['action']),
    run: async (a) => {
      if (a.action === 'save_version') return json(await model('version', { save: true, name: a.name }));
      if (a.action === 'versions') return json(await model('version', {}));
      if (a.action === 'restore_version') return json(await model('version', { restore: a.id || a.name }));
      if (a.action === 'load') {
        let doc = a.doc;
        if (a.path) doc = JSON.parse(await fsp.readFile(a.path.replace(/^~(?=$|\/|\\)/, os.homedir()), 'utf8'));
        if (!doc) throw new Error('Give path or doc');
        return json(await model('load', { doc }));
      }
      return json(await model(a.action, a));
    } },
  { name: 'model_check', description: 'Interference check: which parts overlap and by how much (exact boolean volume for moderate parts, a voxel estimate for big ones; a weld bead and the parts it joins are ignored, touching faces do not count). With motion:{id, key?, from?, to?, steps?} it also sweeps that joint and reports the first contact (moving parts vs everything, ignoring overlaps that exist at rest). look:true returns a picture with the overlaps in red.', inputSchema: S({ motion: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, key: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' }, steps: { type: 'integer' } } }, look: { type: 'boolean' }, layout: { type: 'string', enum: ['4', '3d', 'top', 'front', 'right'] } }),
    run: async (a) => { const r = await model('check', a, 180000); const out = text(JSON.stringify({ overlaps: r.overlaps, motion: r.motion }, null, 1)); if (r.png) out.content.unshift({ type: 'image', data: r.png, mimeType: 'image/png' }); return out; } },
  { name: 'model_query', description: 'Ask the model about its geometry (read-only). what: "faces" (every face of a part — or of all parts — with the connector name to target it by (top, slope, face:side2…), owner, normal, centre and area; curved surfaces listed as such), "edges" (sharp edges of a part with end points and lengths), "measure" (from / to: {obj, conn} or [x,y,z]: distance, dx/dy/dz, and the angle between two face normals), "section" (axis x|y|z, offset: the cut area through the model there, per part), "bbox" (overall and per part), "connectors" (id: every connector with position and normal). Coordinates are mm from the model origin.', inputSchema: S({ what: { type: 'string', enum: ['faces', 'edges', 'measure', 'section', 'bbox', 'connectors'] }, id: { type: 'string' }, from: {}, to: {}, axis: { type: 'string', enum: ['x', 'y', 'z'] }, offset: { type: 'number' }, limit: { type: 'integer' } }),
    run: async (a) => json(await model('query', a, 120000)) },
  { name: 'model_reference', description: 'The 3D modelling reference: with no topic, every op and topic with one line each; with topic (an op name such as extrude, hole, plane, split, mate, constrain, text, feature, helix, pattern, weld, shell — or a topic: sketch, faces, arcs, planes, assemblies, workflow) the full description, parameters and a worked example to copy.', inputSchema: S({ topic: { type: 'string' } }),
    run: async (a) => text(reference(a.topic)) },
  { name: 'model_mass', description: 'Mass properties of the 3D model: per part material, density, volume, mass, centre of gravity and inertia; assembly total mass, centre of gravity, inertia and whether it stands on its base (or which way it tips); the parts list (quantities, part numbers, materials, masses); and the material library. Set materials with model_build {op:"set", id, material:"steel"} or meta:{material, density, fill, part_no, supplier, notes, quantity}, or a model default with {op:"material", material}.', inputSchema: S({}),
    run: async () => json(await model('mass')) },
  { name: 'model_addon', description: 'Use a 3D add-on (built-in: "gears"). With no addon: lists the loaded add-ons with their shapes, mate kinds and actions (with argument docs). With addon + action: runs it — query actions (e.g. gears/advise) return advice and change nothing; build actions (gears/pair, train, planetary, gear, or advise with build:true) add objects as one undoable step. look:true returns a picture.', inputSchema: S({ addon: { type: 'string' }, action: { type: 'string' }, args: { type: 'object', additionalProperties: true }, label: { type: 'string' }, look: { type: 'boolean' }, layout: { type: 'string', enum: ['4', '3d', 'top', 'front', 'right'] } }),
    run: async (a) => {
      const r = await model('addon', a, 120000);
      const out = text(JSON.stringify({ addons: r.addons, addon: r.addon, info: r.info, results: r.results, model: r.model }, null, 1));
      if (r.png) out.content.unshift({ type: 'image', data: r.png, mimeType: 'image/png' });
      return out;
    } },
  { name: 'model_export', description: 'Save the 3D model to disk: stl (watertight mesh for printing/slicers), obj (mesh, one object per body), json (.sf3d.json, the editable parametric model), bom (parts list CSV with quantities, materials and masses), svg / dxf (an engineering drawing sheet: third-angle TOP / FRONT / RIGHT + isometric, hidden lines dashed, the model\'s dimensions, parts list and title block with material and mass; an assembly of two or more parts gets an exploded isometric with balloons numbered as the parts list, unless exploded:false). Coordinates are mm from the model origin. Returns the file paths.', inputSchema: S({ formats: { type: 'array', items: { type: 'string', enum: ['stl', 'obj', 'json', 'bom', 'svg', 'dxf'] } }, sheet: { type: 'string', enum: ['A4', 'A3', 'A2'] }, exploded: { type: 'boolean', description: 'assemblies: exploded isometric with balloons (default true)' }, dir: { type: 'string', description: 'folder (default ~/Pictures/SketchFlow)' } }),
    run: async (a) => {
      const base = a.dir ? a.dir.replace(/^~(?=$|\/|\\)/, os.homedir()) : defaultExportDir();
      await fsp.mkdir(base, { recursive: true });
      const written = [];
      for (const f of (a.formats && a.formats.length ? a.formats : ['stl', 'json', 'bom'])) {
        const r = await model('export', { format: f, sheet: a.sheet, exploded: a.exploded }, 120000);
        const out = path.join(base, r.name.replace(/(\.[\w.]+)$/, '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '$1'));
        await fsp.writeFile(out, r.text, 'utf8'); written.push(out);
      }
      return text('Saved ' + written.length + ' file(s):\n' + written.join('\n'));
    } },
  { name: 'say', description: 'Show a short speech bubble from you on the board (does not draw).', inputSchema: S({ text: { type: 'string' }, seconds: { type: 'integer', description: '0 = until dismissed (default 20)' } }, ['text']),
    run: async (a) => json(await board('say', a)) }
];
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const json = (o) => text(JSON.stringify(o, null, 1));
function sketchResult(s) {
  s.read = true;
  const content = [{ type: 'image', data: s.png, mimeType: 'image/png' }, { type: 'text', text: `The user sent this sketch${s.note ? ' with the note: "' + s.note + '"' : ' (no note)'}. Image ${s.width}x${s.height}, scale ${Number(s.scale || 1).toFixed(4)} (board coords = image coords / scale).\n` + JSON.stringify(s.info || {}) }];
  for (const L of s.layers || []) content.push({ type: 'text', text: 'Layer: ' + L.name }, { type: 'image', data: L.png, mimeType: 'image/png' });
  return { content };
}
const mimeOf = (p) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif' })[path.extname(String(p).split('?')[0]).toLowerCase()] || 'image/png';
function defaultExportDir() {
  if (process.env.SKETCHFLOW_EXPORT_DIR) return process.env.SKETCHFLOW_EXPORT_DIR;
  const pics = path.join(os.homedir(), 'Pictures');
  return fs.existsSync(pics) ? path.join(pics, 'SketchFlow') : path.join(os.homedir(), 'SketchFlow');
}

/* ======================= MCP stdio (JSON-RPC 2.0) ======================= */
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
/* ---------- the modelling reference (model_reference): ops, topics and worked examples ---------- */
const REF = {
  add: ['A primitive part: box {width, depth, height} | wedge | cylinder {diameter, height} | cone {diameter, top, height} | sphere {diameter} | fillet (strip). New parts stack on the ground part unless mate / at is given.', [{ op: 'add', type: 'box', id: 'plate', params: { width: 120, depth: 80, height: 10 }, mate: { to: 'origin', a: 'xy', b: 'bottom' }, material: 'aluminium' }]],
  mate: ['Place a part by connector: {op:mate, id, to, a (their connector), b (its own), flip, offset (gap along the normal), angle (about the normal), tilt (about the face u axis), slide:[u,v] (along the face)}. Faces meet face to face by default.', [{ op: 'mate', id: 'post', to: 'plate', a: 'top', b: 'bottom', slide: [40, 0] }]],
  boolean: ['Combine: {op:boolean, target, tool, mode:union|subtract|intersect}. Or give into + mode when adding the tool. Tools stay live and editable; separate undoes it.', [{ op: 'add', type: 'cylinder', id: 'bore', params: { diameter: 20, height: 12 }, mate: { to: 'plate', a: 'top', b: 'top', flip: false }, into: 'plate', mode: 'subtract' }]],
  extrude: ['A profile pushed along its normal: profile [[x,y]…] (or shape: rect | circle | slot | polygon with their sizes), arcs [{i, c, ccw}], length, end: blind | symmetric | through, draft (°), thin (wall), open (rib / thin plate from an open polyline), twist, scale, constraints. Place it with at/rot (fixed), or mate it to a face: b:start (join, standing out) or b:end + flip:false (cut, going in).', [{ op: 'extrude', id: 'rib', profile: [[0, 0], [40, 0], [40, 25]], open: true, thin: 3, length: 8, mate: { to: 'plate', a: 'top', b: 'start', slide: [-20, -10] }, into: 'plate', mode: 'union' }, { op: 'extrude', id: 'slot', shape: 'slot', width: 30, height: 8, end: 'through', length: 5, mate: { to: 'plate', a: 'top', b: 'end', flip: false, slide: [0, 20] }, into: 'plate', mode: 'subtract' }]],
  revolve: ['A profile [[r, z]…] (with arcs) spun about the local Z axis: degrees.', [{ op: 'revolve', id: 'knob', profile: [[0, 0], [15, 0], [15, 8], [10, 12], [0, 12]], degrees: 360, at: [0, 0, 10], fixed: true }]],
  loft: ['Between two profiles: profile, profile2 (any point counts), length, twist.', [{ op: 'loft', id: 'nozzle', profile: [[-10, -10], [10, -10], [10, 10], [-10, 10]], profile2: [[-4, -4], [4, -4], [4, 4], [-4, 4]], length: 25, at: [0, 0, 10], fixed: true }]],
  sweep: ['A profile along a path [[x,y,z]…] (parallel-transport frames, mitred corners), or along helix:{radius, pitch, turns, left}.', [{ op: 'sweep', id: 'pipe', profile: [[-3, -3], [3, -3], [3, 3], [-3, 3]], path: [[0, 0, 0], [0, 0, 40], [40, 0, 40]], fixed: true }]],
  helix: ['A coil spring: wire (diameter), radius (to the wire centre), pitch, turns, left. Pitch must exceed the wire.', [{ op: 'helix', id: 'spring', wire: 1.5, radius: 8, pitch: 4, turns: 8, mate: { to: 'plate', a: 'top', b: 'bottom' } }]],
  constrain: ['Add a sketch constraint to a profile: {op:constrain, id, type, i, j?, value?}. Types: h, v, length, radius (arc), equal, parallel, perpendicular, angle, tangent, concentric, fix, fixx, fixy. Valued ones become parameters (d1, d2…) — dimensions you can set, link and configure. unconstrain {id, index} removes one.', [{ op: 'constrain', id: 'slot', type: 'radius', i: 1, value: 6 }]],
  hole: ['ISO holes on any flat face (inclined too): {op:hole, target, at:[x,y,z] on the face, normal?, size M2…M16, kind simple | counterbore | countersink | tapped | insert, fit close | normal | loose | print, through, depth}. Dimensioned from the nearest edges; they stay through when the part grows.', [{ op: 'hole', target: 'plate', at: [40, 25, 10], size: 'M5', kind: 'counterbore' }]],
  feature: ['A boss (join) or cut (pocket) of a simple shape on a face at a point: {op:feature, target, face | at+normal, shape cylinder | box | cone | wedge | sphere, params, mode boss | cut}. Mated to the face, so it follows it.', [{ op: 'feature', target: 'plate', face: 'top', slide: [30, 0], shape: 'cylinder', params: { diameter: 12, height: 15 }, mode: 'boss' }]],
  text: ['Emboss (add) or engrave (cut) text on a face: {op:text, target, face | at+normal, text, height, depth, mode emboss | engrave, path line | arc | arc-inside | points, radius, angle, align}. Single-stroke engraving font.', [{ op: 'text', target: 'plate', face: 'top', text: 'SKETCHFLOW', height: 8, depth: 0.6, mode: 'engrave' }]],
  edge: ['Fillet or chamfer an edge near a point: {op:edge, target, near:[x,y,z], style fillet | chamfer, size}. Outer edges are trimmed, inner corners filled; round edges go all the way round; on a seam between two parts it merges them.', [{ op: 'edge', target: 'plate', near: [0, -40, 10], style: 'fillet', size: 3 }]],
  shell: ['Hollow any part to even walls: {op:shell, target, thickness, open: <face connector> | none}. Roundings smaller than the wall get sharp inner corners; bosses thinner than two walls stay solid.', [{ op: 'shell', target: 'plate', thickness: 2, open: 'bottom' }]],
  pattern: ['Copies that follow the original: {op:pattern, of, kind linear | circular | mirror, count, spacing, direction, count2/spacing2/direction2 (grid), angle + about:{obj, conn} (circular), plane (mirror)}.', [{ op: 'pattern', of: 'post', kind: 'circular', count: 6, about: { obj: 'plate', conn: 'center' } }]],
  plane: ['A reference plane: {op:plane, target, face | at+normal, offset, tilt, angle} (or at/rot with no target). Sketch on it (mate a profile to its plane connector), mate parts to it, split with it.', [{ op: 'plane', id: 'mid', target: 'plate', face: 'top', offset: -5 }, { op: 'plane', id: 'cant', target: 'plate', face: 'top', tilt: 30 }]],
  split: ['Cut a part with a plane (or a face connector): {op:split, target, plane: <plane id> | {obj, conn}, keep below | above | both}. above = the side the plane normal points to; both makes two parts.', [{ op: 'split', target: 'plate', plane: 'mid', keep: 'both' }]],
  weld: ['A weld bead between two separate parts (they stay separate): {op:weld, a, b, near:[x,y,z], size, profile flat | convex | concave, all_around}.', [{ op: 'weld', a: 'plate', b: 'post', near: [40, 0, 10], size: 4 }]],
  joint: ['Let a mated part move: {op:joint, id, joint revolute | slider | cylindrical | planar | fixed, axis, limits:{angle:[min,max], travel:[min,max]}}; {op:drive, id, key, value} sets a pose. model_check motion:{id} sweeps it for collisions.', [{ op: 'joint', id: 'lid', joint: 'revolute', limits: { angle: [0, 110] } }]],
  thread: ['A modelled thread on a cylinder part: {op:thread, target, size M2…M24 (resizes the cylinder to it) | custom + pitch (+ diameter), length (0 = all), from bottom | top}. Cylinders also take bore (a tube). Threads are real geometry (ISO 60° profile, chamfered lead-in), so they mesh with nuts and print.', [{ op: 'add', type: 'cylinder', id: 'neck', params: { diameter: 56, height: 16, bore: 48 }, mate: { to: 'body', a: 'top', b: 'bottom' } }, { op: 'thread', target: 'neck', size: 'custom', pitch: 3, length: 12, from: 'top', resize: false }]],
  bolt: ['A bolt with a modelled thread: add type bolt {size M2…M24, length (under the head), head hex | socket, thread_length (0 = all)}. Connectors: bottom (tip), seat (under the head, facing down), top. Mate seat to the top face of the part it goes into.', [{ op: 'add', type: 'bolt', id: 'b1', params: { size: 'M6', length: 20, head: 'socket' }, mate: { to: 'plate', a: 'top', b: 'seat', slide: [40, 20] } }]],
  nut: ['A nut with a modelled internal thread: add type nut {size M2…M24 | custom + diameter + pitch, shape hex | round | knurled, thickness (0 = ISO), od (round / knurled outside)}. It screws onto a bolt or threaded cylinder of the same size without overlapping.', [{ op: 'add', type: 'nut', id: 'n1', params: { size: 'M6' }, mate: { to: 'b1', a: 'bottom', b: 'bottom', flip: false, offset: 4 } }]],
  wrap: ['A sketch or text wrapped onto a round face: {op:wrap, target, at + normal (a point on the face) | angle + height (cylinder parts), profile [[s,t]…] (s = distance round the face, t = along it, from that point; arcs, splines) | shape | text + size, depth, mode emboss | engrave}. Any cylindrical face works (it is fitted); on a cylinder part the wrap follows its diameter.', [{ op: 'wrap', target: 'cap', angle: 0, height: 0, text: 'OPEN', size: 6, depth: 0.6, mode: 'engrave' }, { op: 'wrap', target: 'body', angle: 90, height: 5, profile: [[-12, -4], [12, -4], [12, 4], [-12, 4]], splines: [{ i: 2, pts: [[0, 9]] }], depth: 1.5 }]],
  var: ['Model variables used in sizes: {op:var, name, value} then params like "=#wall*2" or "=plate.width - 10". Configurations: {op:config, action add, name, vars, suppress}.', [{ op: 'var', name: 'wall', value: 2 }, { op: 'set', id: 'plate', params: { height: '=#wall*5' } }]]
};
const TOPICS = {
  workflow: 'Build in small batches with model_build (each batch is atomic and undoable), check with look:true or model_view, read back exact numbers with model_describe and model_query. Typical part: a base (add or extrude), features placed on its faces (feature, hole, text, extrude mated to a face), edges (edge), then shell / pattern. Use ids you choose so later ops can refer to them. Finish with model_check (overlaps), model_mass, and model_export (STL for printing, SVG/DXF drawings).',
  sketch: 'Profiles are points [[x,y]…] in the feature\'s own XY plane (mm). Segment i runs from point i to point i+1 (closing back to 0 unless open:true). Arcs: arcs:[{i, c:[x,y], ccw}] makes segment i an arc around c. Constraints hold the shape: h / v, length, radius, equal, parallel, perpendicular, angle, tangent, concentric, fix / fixx / fixy; valued ones are parameters (d1…). The solver changes the drawn shape as little as possible. model_describe reports degrees of freedom left.',
  splines: 'A spline segment is a smooth curve through fit points: splines:[{i:2, pts:[[30,30],[10,26]]}] makes segment 2 run from point 2 through those points to point 3 (centripetal Catmull–Rom; it leans on the neighbouring straight segments so it blends in). Mix them with lines and arcs; h / v constraints skip them.',
  threads: 'Threads are modelled geometry: bolts and nuts (add type bolt / nut), threaded cylinders and tubes (op thread, or cylinder params thread / bore), and tapped holes with modelled:true. They are built as one solid each (no booleans), mesh without overlapping, and model_check treats them as ordinary parts. Keep fasteners as separate parts mated into holes; join a threaded cylinder only where you need it in one piece.',
  arcs: 'Give arcs as segments with a centre: arcs:[{i:1, c:[40,10], ccw:true}] turns segment 1 into an arc from point 1 to point 2 around (40,10), counter-clockwise. Add {type:"radius", i:1} to dimension it and {type:"tangent", i:0, j:1} to blend it into its neighbour; a slot is a rectangle with arcs on its two short sides and tangents at the four joins.',
  faces: 'Every flat face of a part is a connector: named ones (top, bottom, front, back, left, right, slope, start, end…) and face:<surface> for the rest (an extrude\'s side faces face:side0…, inclined faces). model_query what:"faces" lists them with normals, centres and areas. Put features on them by name (face:\'face:side2\') or by a point on the face (at:[x,y,z] + normal); mate profiles to them with slide:[u,v] for the position on the face.',
  planes: 'Reference planes come from faces: {op:plane, target, face, offset, tilt}. Their connectors: plane (its normal side), back, center. Sketch on one by mating a profile\'s start connector to plane (flip true); split parts with {op:split, plane:id}.',
  assemblies: 'Parts stay separate unless combined (boolean) or merged (fillet across a seam). Mate them (connectors), weld them (separate parts, bead between), give joints for motion, use instances (linked copies) and patterns. model_check finds overlaps and motion collisions; the drawing export gives an exploded view with balloons tied to the parts list.'
};
function reference(topic) {
  if (!topic) return 'Ops (model_build):\n' + Object.entries(REF).map(([k, [d]]) => `- ${k}: ${d.split('. ')[0]}.`).join('\n') + '\n\nTopics: ' + Object.keys(TOPICS).join(', ') + '\nCall model_reference with a topic or op name for the full text and a worked example.';
  const k = String(topic).toLowerCase().trim();
  if (TOPICS[k]) return `${k}\n\n${TOPICS[k]}`;
  if (REF[k]) return `${k}\n\n${REF[k][0]}\n\nExample (model_build ops):\n${JSON.stringify(REF[k][1], null, 1)}`;
  const near = Object.keys(REF).concat(Object.keys(TOPICS)).filter(x => x.includes(k) || k.includes(x));
  return `No reference for “${topic}”.` + (near.length ? ' Did you mean: ' + near.join(', ') + '?' : ' Topics: ' + Object.keys(TOPICS).concat(Object.keys(REF)).join(', '));
}
const INSTRUCTIONS = `SketchFlow is a live vector sketch board the user draws on with mouse, stylus or finger while you watch and draw too.
- Start with open_board, then look to see what is there (it returns an image plus board size, layers and drawing space).
- When the user wants to show you an idea, call wait_for_sketch (they press Send on the board).
- Coordinates are board pixels, origin top-left. Lines whose endpoints share exact coordinates are joined (joints) and move together.
- drawing_space sets isometric, 1/2/3-point perspective, 3-view or 4-view layouts; draw along those directions.
- Dimensions are parametric: edit_items set_dimension changes geometry to match.
- For "make this move like this": build links with draw (shared endpoints = pin joints), then mechanism with pins + a motor, simulate to check the joint paths, and play to show the user.
- Everything you do is undoable by the user (board undo).

3D PARAMETRIC MODEL (open_model, model_build, model_describe, model_view, model_session, model_export) — a separate page at /3d/ with 4 linked views (TOP | 3D / FRONT | RIGHT). Units mm. Z is up, X right, -Y towards the viewer (front).
Every object is a shape + its own parameters in its own local frame; its place comes from a mate to another object's connector (or a fixed pose). The world origin is ephemeral: by default the bottom of the ground object (the first one); "origin" can move it. All positions you send/receive are measured from it.
Shapes (op add, type + params): box {width,depth,height} (base-centred, sits on z=0), wedge {width,depth,height} (slope falls toward +x), cylinder {diameter,height}, cone {diameter,top,height} (top 0 = point), sphere {diameter}, fillet {size,length,style:fillet|weld|chamfer} (an edge strip you place yourself).
Features: extrude {profile:[[x,y],...], arcs:[{i, c:[x,y], ccw}] (segment i is an arc around centre c), splines:[{i, pts:[[x,y]…]}] (segment i is a smooth curve through those points), length, end:'blind'|'symmetric'|'through' (through all: for cuts), draft (taper °, inward), thin (wall thickness: a closed profile becomes a wall; with open:true an open polyline becomes a rib / thin plate), twist (deg), scale (end size ratio), direction [x,y,z]} — or a parametric sketch shape instead of a profile: shape:'rect' {x, y, width, height, radius (corner)} | 'circle' {x, y, diameter} | 'slot' {x, y, width (overall), height} | 'polygon' {x, y, diameter, sides}; those sizes stay editable dimensions (link them, put them in configurations). An extrude with into + mode:'subtract' is a cut / pocket; polyline profiles (extrude / revolve / loft) take sketch constraints: constraints:[{type:'h'|'v', i}, {type:'length', i, p:'d1'}, {type:'radius', i (an arc segment), p}, {type:'parallel'|'perpendicular'|'equal' (lines' lengths or arcs' radii)|'angle'|'tangent' (two segments that meet, line–arc or arc–arc)|'concentric' (two arcs), i, j}, {type:'fix', i, at:[x,y]}, {type:'fixx'|'fixy', i}] (segment i runs point i → i+1; arc centres are solved too); or {op:'constrain', id, type, i, j?, value?} adds one (valued ones become parameters d1, d2… = editable dimensions) and {op:'unconstrain', id, index} removes one; model_describe reports degrees of freedom left; loft {profile, profile2 (same or different point count), length, twist}; revolve {profile:[[r,z],...], degrees} around the object's local Z; sweep {profile, path:[[x,y,z],...]} or helix:{radius, pitch, turns, left} instead of path; {op:'helix', wire, radius, pitch, turns, left} is a coil spring. face:{obj,conn} starts the feature on that face and keeps it attached; to put a profile anywhere on a face (any angle), mate it: mate:{to, a:<face connector>, b:'start'} (join, flip true) or b:'end', flip:false (cut), slide:[u,v] = where on the face. Reference planes: {op:'plane', target, face | at+normal, offset (gap along the normal), tilt (° about the face's u axis), angle} — mate parts or sketches to its 'plane' connector; {op:'split', target, plane:<plane id> | {obj, conn}, keep:'below'|'above'|'both'} cuts a part with it ('above' = the side its normal points to; both = two parts). Any mate also takes tilt (°). Threads (modelled, ISO metric coarse M2…M24): add type bolt {size, length, head:'hex'|'socket', thread_length} (connectors bottom = tip, seat = under the head, top), type nut {size | size:'custom' + diameter + pitch, shape:'hex'|'round'|'knurled', thickness, od}, a threaded cylinder {op:'thread', target:<cylinder>, size, length, from:'bottom'|'top'} (or cylinder params thread, pitch, thread_length, thread_from, bore for a tube), and holes kind:'tapped' + modelled:true for real internal threads. Curved faces: {op:'wrap', target, at:[x,y,z] + normal (a point on the round face) | angle (°) + height (from the middle, on a cylinder part), profile [[s,t]…] (s round the face, t along it, from that point; arcs / splines too) or shape or text + size, depth, mode:'emboss'|'engrave'} wraps a sketch or text round a cylindrical face (any round face is found by fitting); on a cylinder part the wrap follows its diameter.
Connectors (mate targets): box: top, bottom, front (-y), back, left (-x), right, center, corners corner±x±y±z (e.g. corner-x-y-z = bottom-left-front), edge midpoints edge:top-front, edge:bottom-left, edge:front-right … (wedge: slope instead of top/right, no edge:*). Round shapes: bottom, top (cone: apex), center, side+x, side-x, side+y, side-y. Fillet strip: edge, leg-x, leg-z, end-a, end-b. Features: start, end, center, top, bottom, bbox+x/-x/+y/-y/+z/-z. Every other flat face of a shape is a face connector too, named face:<surface> (e.g. face:side2 — an extrude's side 2, an inclined face of a loft, a flat ring of a revolve), so holes, text, bosses, cuts, sketches and mates work on inclined and side faces. Planes: plane, back, center. World: origin, xy, xz, yz. model_describe connectors_of gives positions + normals; model_query what:'faces' lists every face of a part with its connector name, normal, centre and area.
Mate: {op:'mate', id, to, a: target connector, b: own connector, offset (gap along the target connector's outward normal; negative = sink in), slide:[u,v] (move along the target face, along its u and v axes; on a top face u=+x, v=+y — connectors_of lists u and v for every connector), angle (spin about the normal, deg), flip}. Face-to-face mates flip automatically so faces touch. "add" accepts mate:{to,a,b,...} inline; with no mate and no "at" a new object sits on top of the ground object.
Booleans: add with into:"targetId" + mode:"subtract"|"add"|"intersect" (or op boolean {target, tool, mode}); tools stay editable parametric objects (separate undoes it). A through-hole = {op:'add', type:'cylinder', params:{diameter:8, height: thickness+2}, mate:{to:'plate', a:'top', b:'top', flip:false, offset:1, slide:[x,y]}, into:'plate', mode:'subtract'} (its top sits 1 mm above the plate top and it reaches 1 mm below the bottom, so it cuts clean through).
Edges: {op:'edge', target, near:[x,y,z] (a point on the edge), style:'fillet'|'weld'|'chamfer', size}. The edge is found on the finished body; convex (outside) edges are trimmed, concave (inside corner) edges are filled — automatically, by the angle between the faces (override with mode add/subtract). Round edges (a flat face meeting a cylinder/cone/revolve: disc rims, hole rims, boss bases) are treated all the way round — e.g. chamfer a hole rim = countersink, fillet a boss base = filled. The edge is remembered by the two surfaces it lies between, so it is re-found after parameter changes.
Configurations (size variants): {op:'config', action:'add', name:'Large', vars:{len:200}, suppress:[ids]} saves a table of variable values (and features to switch off); {op:'config', name:'Large'} switches (name null = Default); action 'set' / 'delete' / 'rename'. Drive sizes with variables (=#len) so configurations can change them. Instances: {op:'instance', of: partId, mate|at} is a linked copy — edit the original and every instance follows; the parts list counts them. (op 'duplicate' makes an independent copy.)
Holes: {op:'hole', target, at:[x,y,z] (a point on a face), size:'M2'…'M16', kind:'simple'|'counterbore'|'countersink'|'tapped'|'insert' (heat-set), fit:'close'|'normal'|'loose'|'print' (FDM, +0.2), through (default) or depth, dims:true (default: driving dimensions from the two nearest edges)} — ISO 273 clearance, ISO 4762 counterbores, ISO 10642 countersinks, tap drills; through holes stay through when the part changes. Pattern a hole to repeat it.
Boss / cut on a face: {op:'feature', target, face:'top' (or at:[x,y,z] + normal), shape:'cylinder'|'box'|'cone'|'wedge'|'sphere', params:{diameter,height}|{width,depth,height}, mode:'boss'|'cut', slide:[u,v], angle} — a boss is a boolean add standing on the face, a cut a pocket of that depth sunk flush into it; both are mated to the face at that point, so they follow it when the part changes. For any other outline, extrude a profile with mate:{to, a:<face>, b:'start'} (boss) or b:'end', flip:false (cut), plus into + mode. Text: {op:'text', target, face:'top' (or at:[x,y,z] + normal from a click), text, height (cap height, mm), depth, mode:'emboss'|'engrave', path:'line'|'arc'|'arc-inside'|'points', radius (arc baseline radius, about the anchor), angle (deg, turns the whole text about its anchor), align:'center'|'start'|'end', points:[[x,y],…] (path in the face plane, mm), weight (stroke, default 0.12 × height), spacing (letter gap in font units), slide:[u,v] on the face} — emboss is a boolean add standing on the face, engrave a boolean remove cut in flush with it; 'arc' reads clockwise over the top with letter tops outward, 'arc-inside' reads along the bottom with tops toward the centre; edit the words or any size later with set. Built-in single-stroke engraving font: A–Z (lower case prints as capitals), 0–9 and . , : ; - _ + = / \\ ( ) [ ] # ! ? ' " ° % * & < > @ Ø ± ×; flat faces only (no wrapping onto curved faces). Without target it is a stand-alone text part. Shell: {op:'shell', target, thickness, open:<one of the part's face connectors, e.g. top | end>|'none'} hollows any closed part to even walls (an inward offset of every face, mitred at corners, not a scale), including booleans, edge-rounded parts and imported meshes; a rounding smaller than the wall gets a sharp inner corner and a boss or rib thinner than two walls stays solid (a warning says which); a cut that leaves a section thinner than two walls is an error naming it. Section view: model_view section:{axis:'x'|'y'|'z', offset, flip}.
History: {op:'suppress', id, on} keeps a feature but turns it off; {op:'rollback', to: index | id | null} shows the model as it was (new features are inserted at the bar); {op:'move', id, to | before | after} reorders (tools stay after what they cut); {op:'duplicate', id} copies a part with its holes and edges.
Other ops: set {id, params, name, color, at, rot, hidden, fixed}; delete {id}; ground {id}; origin {obj, conn}; fix {id} (freeze current place, drop mate); cleanup {fixFloating} (repairs orphans: tools or edges whose target is gone, mates to deleted objects, dimensions whose ends are gone); rename {name}.
Reference & queries: model_reference (no topic: every op in one line; topic: full text + a worked example — read it before using an op for the first time) and model_query (faces with their connector names, edges, measure, section areas, bounding boxes) — use them instead of guessing.
Checks: model_check finds overlapping parts (interference) and, with motion:{id}, sweeps a joint and reports the first contact; the Motion drawer stops at contact and turns colliding parts red.
Joints & motion: a mate can move. {op:'joint', id, joint:'revolute' (spins about the mate axis — its value is the mate angle) | 'slider' (axis 'n' along the mate normal, or 'u'/'v' across the face — value "travel") | 'cylindrical' (angle + offset) | 'planar' (u, v, angle) | 'fixed', limits:{angle:[lo,hi], travel:[lo,hi], …}}. {op:'drive', values:{id:{angle:30}}} moves joints (clamped to limits). Gears meshed by a gear mate turn with their partner automatically (continuous, at the ratio). model_view joints:{id: value} shows a pose without changing the model. Gear-meshed gears cannot be joints themselves — make the gear that drives them revolute.
Links (leader/follower) & formulas: any numeric param can be "=formula" instead of a number — "=plate.depth" (follow another part's size), "=plate.depth - 2*#wall", "=max(a.width, b.width)"; references are objectId.param (or Object_Name.param), #variables, pi; functions min max round floor ceil abs sqrt sin cos tan (degrees). Followers update whenever a leader changes; typing a plain number unlinks. {op:'var', name:'wall', value: 3 or "=formula"} sets a model variable (value null removes it). {op:'link', id, param, to:{obj, param}, factor, offset} is a shorthand.
Dimensions: {op:'dim', a:{obj,conn}, b:{obj,conn}, view:'top'|'front'|'right', axis?} measures between connectors in that view; axis 'normal' = square to a face/edge seen edge-on (hole centre → plate face = the usual off-edge dimension; chosen automatically when one end is such a face), 'h' / 'v' = horizontal / vertical in the view, 'aligned' = straight line. {op:'setdim', id, value} makes it DRIVING: the part that hangs off the other (by its mate) moves so the distance is value, and it is held there after every later change (value null makes it a reference again). {op:'dimaxis', id, axis}; undim {id}. model_describe lists dimensions with their values.
Every object's own parameters are shown as editable dimensions in the 2D views; the user can click one to change it, and mates keep everything attached. Warnings list floating (unmated, not fixed) and orphaned objects — fix them or tell the user.
Patterns (arrays): {op:'pattern', of: id or [ids], kind:'linear' (count, spacing, direction:[x,y,z], optional count2/spacing2/direction2 for a grid) | 'circular' (count, angle total°, about:{obj, conn} e.g. {obj:'disc', conn:'center'} for a bolt circle) | 'mirror' (plane:'yz'|'xz'|'xy' through the origin, or about:{obj, conn} = that face's plane)}. Copies are live (they follow the original's sizes and boolean role); a hole's countersink comes along. Revolve is the op 'revolve' (a profile around an axis); circular pattern repeats features around one.
Welds vs fillets — manufacturing logic: a WELD joins two parts that are made separately; they stay separate parts (an assembly) and can be pulled apart. {op:'weld', a, b, near:[x,y,z] (optional: the seam nearest this point; default the longest), size (leg mm), profile:'flat'|'convex'|'concave', all_around:true (every inside seam between them)}. The parts must touch (mate them first); the bead is its own body (material defaults to part a's). A FILLET/CHAMFER blends ONE part: to fillet where two parts meet, first union them ({op:'boolean', target, tool, mode:'add'}) — they are then one piece (cast, printed or machined together).
Metadata & mass: every part can carry meta {material, density (g/cm³, overrides the material), fill (0–1, e.g. 0.2 for 20% infill), part_no, supplier, notes, quantity}; shorthand material:'aluminium' on add/set; {op:'material', material} sets the model default. model_mass gives mass, centre of gravity, inertia per part and for the assembly, whether it stands, and the parts list. Materials: pla, petg, abs, asa, tpu, nylon, pa_cf, pom, acrylic, polycarbonate, resin, tough_resin, aluminium, steel, stainless, cast_iron, brass, bronze, copper, titanium, oak, pine, plywood, mdf, carbon_fibre, concrete, glass, rubber.
Add-ons: model_addon lists them. Built-in "gears": shape type 'gear' {module, teeth, width, bore, pressure_angle, style:'spur'|'helical'|'herringbone', helix (° — sign = hand; mating external gears need opposite signs), backlash (mm), clearance (×module), shift, internal (ring gear), rim}; mate kind 'gear' keeps two gears in mesh: {op:'mate', id, to, kind:'gear', around (direction °, world), axial, phase} — centre distance and tooth phase follow the live sizes. Actions: advise {ratio, process: fdm|sla|cnc|laser|injection|hobbed, priority: balanced|strength|quiet|compact|precision, torque N·m, rpm, material, centre_distance, build} (picks module, teeth with a hunting-tooth ratio, form, pressure angle, backlash, clearance, width and explains why), pair {teeth:[z1,z2], module, process, around, driver, ring}, train {teeth:[…] simple chain | stages:[[z1,z2],[z3,z4]] compound}, planetary {sun, planet, planets}, gear {teeth, module, process}. Ask the advisor first when the user names a purpose or a process.
Workflow: open_model → model_build (one batch per idea, with a clear label, look:true when it helps) → model_view to check → adjust with set/mate. Errors name the valid connectors/objects; the whole batch is rolled back on any error.`;
function out(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
async function handle(msg) {
  const { id, method, params } = msg;
  const isReq = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      const want = params && params.protocolVersion;
      return isReq && out({ jsonrpc: '2.0', id, result: { protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[1], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sketchflow', title: 'SketchFlow sketch board + 3D model', version: VERSION }, instructions: INSTRUCTIONS } });
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled' || (method && method.startsWith('notifications/'))) return;
    if (method === 'ping') return isReq && out({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return isReq && out({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    if (method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === (params && params.name));
      if (!tool) return isReq && out({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + (params && params.name) } });
      try { const result = await tool.run((params && params.arguments) || {}); return isReq && out({ jsonrpc: '2.0', id, result }); }
      catch (e) { return isReq && out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } }); }
    }
    if (method === 'resources/list') return isReq && out({ jsonrpc: '2.0', id, result: { resources: [] } });
    if (method === 'prompts/list') return isReq && out({ jsonrpc: '2.0', id, result: { prompts: [] } });
    if (isReq) out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
  } catch (e) { if (isReq) out({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }); }
}
function startStdio() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      (Array.isArray(msg) ? msg : [msg]).forEach(m => { handle(m); });
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

/* ======================= start ======================= */
PORT = await listen(BASE_PORT);
log(`board at ${boardUrl()}` + (LAN ? `  ·  LAN: ${lanUrls().join('  ')}` : ''));
if (SERVE_ONLY) { log('serve-only mode (no MCP). Ctrl+C to stop.'); openBrowser(boardUrl()); }
else startStdio();
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
