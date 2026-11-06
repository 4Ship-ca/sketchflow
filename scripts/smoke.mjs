#!/usr/bin/env node
/*
 * Smoke test for the MCP server, no browser needed: starts it over stdio the way an MCP client does, checks the
 * handshake, the tool sets (all / 3d / 2d, --brief), a tool that answers on its own (model_reference), and that the
 * app pages, scripts and add-ons are served. Exits 1 on the first failure.
 *   node scripts/smoke.mjs                      test this checkout
 *   node scripts/smoke.mjs --bin sketchflow-mcp test an installed copy (a command on PATH, or a path to server.mjs)
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), bi = argv.indexOf('--bin'), BIN = bi >= 0 ? argv[bi + 1] : null;
let failed = 0;
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && !cond ? ' → ' + JSON.stringify(detail).slice(0, 300) : ''}`); if (!cond) failed++; };

function start(extra = []) {
  const port = String(17000 + Math.floor(Math.random() * 20000));
  const env = { ...process.env, SKETCHFLOW_NO_OPEN: '1', SKETCHFLOW_PORT: port, SKETCHFLOW_ROOMS: path.join(ROOT, '.smoke-rooms') };
  const cmd = !BIN ? [process.execPath, [path.join(ROOT, 'server.mjs'), ...extra]] : /\.m?js$/.test(BIN) ? [process.execPath, [BIN, ...extra]] : [BIN, extra];
  const child = spawn(cmd[0], cmd[1], { env, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && !/\.m?js$/.test(cmd[0]) });
  let buf = '', err = '', nextId = 1; const waiting = new Map(); let urlResolve; const url = new Promise(r => { urlResolve = r; });
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } } });
  child.stderr.on('data', d => { err += d; const m = err.match(/board at (http:\/\/\S+)/); if (m) urlResolve(m[1]); });
  const rpc = (method, params) => new Promise((resolve, reject) => { const id = nextId++; const t = setTimeout(() => reject(new Error(`${method}: no answer in 15 s · stderr: ${err.slice(-400)}`)), 15000); waiting.set(id, (m) => { clearTimeout(t); resolve(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  const stop = () => new Promise(r => { child.on('exit', r); child.stdin.end(); setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 3000); });
  return { rpc, notify, stop, url, stderr: () => err };
}
/* the installed server.mjs, to find the files it serves */
function resolveBin() {
  if (/\.m?js$/.test(BIN)) return BIN;
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) for (const ext of process.platform === 'win32' ? ['.cmd', ''] : ['']) {
    const p = path.join(d, BIN + ext); if (!fs.existsSync(p)) continue;
    if (ext === '.cmd') { const m = fs.readFileSync(p, 'utf8').match(/"%dp0%\\([^"]*server\.mjs)"/); if (m) return path.join(d, m[1]); }
    return p;
  }
  throw new Error(`${BIN} is not on PATH`);
}
const init = async (s) => { const r = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sketchflow-smoke', version: '1' } }); s.notify('notifications/initialized'); return r.result; };

try {
  /* everything */
  const s = start(), info = await init(s);
  ok('initialize: server info and protocol', info && info.serverInfo && info.serverInfo.name === 'sketchflow' && info.protocolVersion === '2025-06-18', info && info.serverInfo);
  ok('initialize: instructions for the model', info && typeof info.instructions === 'string' && info.instructions.length > 2000);
  const all = (await s.rpc('tools/list', {})).result.tools, names = all.map(t => t.name);
  ok('tools/list: board and model tools', ['open_board', 'draw', 'look', 'open_model', 'model_build', 'model_view', 'model_export', 'model_reference'].every(n => names.includes(n)), names);
  ok('tools/list: every tool has a description and an object schema', all.every(t => t.description && t.inputSchema && t.inputSchema.type === 'object'));
  const ref = await s.rpc('tools/call', { name: 'model_reference', arguments: { topic: 'extend' } });
  ok('tools/call model_reference answers without a browser', ref.result && !ref.result.isError && /upTo/.test(ref.result.content[0].text), ref.result);
  const bad = await s.rpc('tools/call', { name: 'no_such_tool', arguments: {} });
  ok('tools/call of an unknown tool is an error', !!bad.error);
  const ping = await s.rpc('ping', {}); ok('ping', ping.result && !ping.error);
  /* the app it serves */
  const base = await Promise.race([s.url, new Promise((_, rej) => setTimeout(() => rej(new Error('no "board at" line on stderr')), 10000))]);
  const get = async (p) => { const r = await fetch(new URL(p, base)); return { status: r.status, text: await r.text() }; };
  const board = await get('/'), model = await get('/3d/'), mjs = await get('/3d/js/model.js'), ad = await get('/3d/addons/index.json'), bjs = await get('/js/' + fs.readdirSync(path.join(BIN ? path.dirname(fs.realpathSync(resolveBin())) : ROOT, 'js')).find(f => f.endsWith('.js')));
  ok('serves the sketch board page (with its bridge token)', board.status === 200 && /sketchflow-bridge" content="[0-9a-f]{32}"/.test(board.text), board.status);
  ok('serves the 3D workspace page', model.status === 200 && /<html/i.test(model.text), model.status);
  ok('serves the app scripts', mjs.status === 200 && /export function evaluate/.test(mjs.text) && bjs.status === 200, [mjs.status, bjs.status]);
  ok('serves the built-in add-ons (gears, welding)', ad.status === 200 && /gears/.test(ad.text) && /welding/.test(ad.text), ad.text);
  const foreign = await new Promise((resolve) => { const u = new URL('/', base); const r = http.get({ host: u.hostname, port: u.port, path: '/', headers: { host: 'example.com' } }, (res) => { res.resume(); resolve(res.statusCode); }); r.on('error', () => resolve(0)); });
  ok('refuses a request for another host name (DNS rebinding)', foreign === 403, foreign);
  await s.stop();
  /* 3D only, brief: the small set for local models */
  const s3 = start(['--tools=3d', '--brief']), i3 = await init(s3), t3 = (await s3.rpc('tools/list', {})).result.tools.map(t => t.name);
  ok('--tools=3d: only the model tools', t3.length >= 10 && t3.every(n => n === 'open_model' || n.startsWith('model_')), t3);
  ok('--brief: short instructions', i3.instructions.length < 2000, i3.instructions.length);
  const hidden = await s3.rpc('tools/call', { name: 'draw', arguments: {} });
  ok('--tools=3d: board tools are not callable', !!hidden.error);
  await s3.stop();
  const s2 = start(['--tools=2d']); await init(s2); const t2 = (await s2.rpc('tools/list', {})).result.tools.map(t => t.name);
  ok('--tools=2d: only the board tools', t2.length >= 8 && !t2.some(n => n === 'open_model' || n.startsWith('model_')), t2);
  await s2.stop();
} catch (e) { ok('smoke run', false, e.message); }
console.log(failed ? `\n${failed} failed` : '\nall smoke checks passed');
process.exit(failed ? 1 : 0);
