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
const VERSION = '1.0.0';
const ARGS = process.argv.slice(2);
const SERVE_ONLY = ARGS.includes('--serve');
const NO_OPEN = process.env.SKETCHFLOW_NO_OPEN === '1' || ARGS.includes('--no-open');
const LAN = process.env.SKETCHFLOW_LAN === '1' || ARGS.includes('--lan');
const BASE_PORT = Number(process.env.SKETCHFLOW_PORT || 7777);
const TOKEN = crypto.randomBytes(16).toString('hex');
const PAIR = crypto.randomBytes(3).toString('hex');
const log = (...a) => process.stderr.write('[sketchflow] ' + a.join(' ') + '\n');

let PORT = 0;
const clients = new Map();      /* cid -> {res, at} */
let primary = null;
const pending = new Map();      /* request id -> {resolve, reject, timer} */
let inbox = null;               /* last sketch the user pressed Send on */
const sketchWaiters = new Set();
let lastOpen = 0;

/* ======================= HTTP + SSE bridge ======================= */
const isLoop = (addr) => !addr || addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
const lanIPs = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const sse = (c, event, data) => { try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } };
const broadcastRoles = () => { for (const [cid, c] of clients) sse(c, 'role', { primary: cid === primary }); };
function readBody(req, limit = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

async function pageHtml() {
  let html = await fsp.readFile(path.join(ROOT, 'index.html'), 'utf8');
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
    const js = url.pathname.match(/^\/js\/([\w-]+\.js)$/);
    if (req.method === 'GET' && js) {
      const f = path.join(ROOT, 'js', js[1]);
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
        const c = { res, at: Date.now() }; clients.set(cid, c); primary = cid;
        sse(c, 'hello', { primary: true, version: VERSION }); broadcastRoles();
        const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { /* closed */ } }, 20000);
        req.on('close', () => { clearInterval(ka); clients.delete(cid); if (primary === cid) { primary = [...clients.keys()].pop() || null; broadcastRoles(); } });
        log('board connected', cid);
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
      if (url.pathname === '/bridge/claim') { if (clients.has(body.cid)) { primary = body.cid; broadcastRoles(); } return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'unknown bridge route' });
    }
    send(res, 404, 'not found', 'text/plain');
  } catch (e) { log('http error', e.message); try { send(res, 500, { error: e.message }); } catch { /* already sent */ } }
});

function listen(port, tries = 0) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => { server.off('listening', onOk); if (e.code === 'EADDRINUSE' && tries < 25) resolve(listen(port + 1, tries + 1)); else reject(e); };
    const onOk = () => { server.off('error', onErr); resolve(port); };
    server.once('error', onErr); server.once('listening', onOk);
    server.listen(port, LAN ? '0.0.0.0' : '127.0.0.1');
  });
}
const boardUrl = () => `http://localhost:${PORT}/`;
const lanUrls = () => (LAN ? lanIPs().map(ip => `http://${ip}:${PORT}/?k=${PAIR}`) : []);

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
async function ensureBoard(waitMs = 20000) {
  if (primary && clients.has(primary)) return;
  if (Date.now() - lastOpen > 25000) { lastOpen = Date.now(); openBrowser(boardUrl()); }
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) { if (primary && clients.has(primary)) return; await new Promise(r => setTimeout(r, 250)); }
  throw new Error(`The SketchFlow board isn't open. Ask the user to open ${boardUrl()} in a browser${LAN ? ' (or on a tablet: ' + lanUrls().join(' , ') + ')' : ''}, then try again.`);
}
async function board(cmd, args = {}, timeoutMs = 60000) {
  await ensureBoard();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`The board did not answer "${cmd}" in time.`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    sse(clients.get(primary), 'cmd', { id, cmd, args });
  });
}

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
      if (!(primary && clients.has(primary))) { lastOpen = Date.now(); openBrowser(boardUrl()); }
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
const INSTRUCTIONS = `SketchFlow is a live vector sketch board the user draws on with mouse, stylus or finger while you watch and draw too.
- Start with open_board, then look to see what is there (it returns an image plus board size, layers and drawing space).
- When the user wants to show you an idea, call wait_for_sketch (they press Send on the board).
- Coordinates are board pixels, origin top-left. Lines whose endpoints share exact coordinates are joined (joints) and move together.
- drawing_space sets isometric, 1/2/3-point perspective, 3-view or 4-view layouts; draw along those directions.
- Dimensions are parametric: edit_items set_dimension changes geometry to match.
- For "make this move like this": build links with draw (shared endpoints = pin joints), then mechanism with pins + a motor, simulate to check the joint paths, and play to show the user.
- Everything you do is undoable by the user (board undo).`;
function out(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
async function handle(msg) {
  const { id, method, params } = msg;
  const isReq = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      const want = params && params.protocolVersion;
      return isReq && out({ jsonrpc: '2.0', id, result: { protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[1], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sketchflow', title: 'SketchFlow sketch board', version: VERSION }, instructions: INSTRUCTIONS } });
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
