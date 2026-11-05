/* shared editing rooms on the server: node model/test/rooms.test.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCollab } from '../../collab-server.mjs';
import { Model } from '../js/model.js';
import { docDiff } from '../js/collab.js';
let pass = 0, fail = 0;
const ok = (name, cond, info) => { cond ? pass++ : fail++; console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-rooms-'));

const sent = [];
const C = createCollab({ dir, broadcast: (room, data) => sent.push({ room, data }) });
const base = new Model(); base.apply([{ op: 'add', type: 'box', id: 'plate', name: 'Plate', params: { width: 100, depth: 60, height: 8 } }, { op: 'add', type: 'cylinder', id: 'post', name: 'Post', params: { diameter: 10, height: 20 }, mate: { to: 'plate', a: 'top', b: 'bottom' } }]);
const D0 = JSON.parse(JSON.stringify(base.doc));
const edit = (doc, ops) => { const m = new Model(JSON.parse(JSON.stringify(doc))); m.apply(ops); return docDiff(doc, JSON.parse(JSON.stringify(m.doc))); };

const { room } = await C.create(D0, 'Alex');
ok('a room is made from a model', /^[A-Za-z0-9_-]{6,}$/.test(room));
const j0 = await C.join(room, 'cA');
ok('joining gives the whole model at revision 0', j0.rev === 0 && j0.doc.objects.length === 2);
const c1 = await C.commit(room, { base: 0, batch: { id: 'b1', label: 'Wider', by: 'Alex', session: 'cA', diff: edit(D0, [{ op: 'set', id: 'plate', params: { width: 140 } }]) } });
ok('a change on the latest revision is accepted and broadcast', c1.ok && c1.rev === 1 && sent.some(s => s.data.type === 'batch' && s.data.batch.id === 'b1'));
const again = await C.commit(room, { base: 0, batch: { id: 'b1', label: 'Wider', by: 'Alex', session: 'cA', diff: edit(D0, [{ op: 'set', id: 'plate', params: { width: 140 } }]) } });
ok('…sent twice (a retry), it is taken once', again.ok && again.duplicate && again.rev === 1);
/* Bea started from revision 0 too */
const c2 = await C.commit(room, { base: 0, batch: { id: 'b2', label: 'Deeper', by: 'Bea', session: 'cB', diff: edit(D0, [{ op: 'set', id: 'plate', params: { depth: 80 } }]) } });
ok('a change from an older revision that touches something else is merged', c2.ok && c2.merged && c2.rev === 2);
const c3 = await C.commit(room, { base: 0, batch: { id: 'b3', label: 'Narrower', by: 'Bea', session: 'cB', diff: edit(D0, [{ op: 'set', id: 'plate', params: { width: 90 } }]) } });
ok('…one that would overwrite a change since is refused, saying who changed what', !c3.ok && c3.conflict && /Alex/.test(c3.conflict[0]) && /width/.test(c3.conflict[0]), c3.conflict);
const c4 = await C.commit(room, { base: 1, batch: { id: 'b4', label: 'Wider still', by: 'Alex', session: 'cA', diff: edit(D0, [{ op: 'set', id: 'plate', params: { width: 160 } }]) } });
ok('a person\'s own earlier change never counts against their next one', c4.ok, c4);
const j1 = await C.join(room, 'cC', 1);
ok('catching up from a revision gives just the changes since', !j1.doc && j1.batches.map(b => b.id).join() === 'b2,b4', j1.batches.map(b => b.id));
const full = await C.join(room, 'cC');
const pl = full.doc.objects.find(o => o.id === 'plate');
ok('the room\'s model has every accepted change and none of the refused one', pl.params.width === 160 && pl.params.depth === 80 && full.rev === 3);
let bad = ''; try { await C.commit(room, { base: 9, batch: { id: 'b5', diff: {} } }); } catch (e) { bad = e.message; }
ok('a revision the room never had is an error', /not one this room has had/.test(bad), bad);
await C.presence(room, 'cA', { user: { id: 'u1', name: 'Alex', color: '#e8590c' }, sel: 'post' });
const pres = sent.filter(s => s.data.type === 'presence').pop();
ok('presence: who is here and what they have selected reaches the room', pres && pres.data.users.some(u => u.name === 'Alex' && u.sel === 'post'));
C.gone('cA');
ok('…and leaving (the tab closes) is broadcast too', !sent.filter(s => s.data.type === 'presence').pop().data.users.some(u => u.name === 'Alex'));
/* persistence: a new server process finds the room on disk */
await wait(500);
const C2 = createCollab({ dir, broadcast: () => {} }), back = await C2.join(room, 'cD');
ok('a room survives a server restart (written to disk)', back.rev === 3 && back.doc.objects.find(o => o.id === 'plate').params.width === 160);
let nf = ''; try { await C2.join('nosuchroom', 'x'); } catch (e) { nf = e.message; }
ok('an unknown room is reported', /no such room/.test(nf), nf);

/* the same over HTTP, through server.mjs */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), PORT = 7900 + Math.floor(Math.random() * 80);
const srv = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), '--serve'], { env: Object.assign({}, process.env, { SKETCHFLOW_NO_OPEN: '1', SKETCHFLOW_PORT: String(PORT), SKETCHFLOW_ROOMS: dir }), stdio: ['ignore', 'ignore', 'pipe'] });
let port = null; srv.stderr.on('data', d => { const m = String(d).match(/localhost:(\d+)\//); if (m && !port) port = +m[1]; });
for (let i = 0; i < 100 && !port; i++) await wait(50);
try {
  const page = await (await fetch(`http://localhost:${port}/3d/`)).text(), token = (page.match(/name="sketchflow-bridge" content="([a-f0-9]+)"/) || [])[1];
  const call = async (act, body, tok = token) => { const r = await fetch(`http://localhost:${port}/bridge/collab/${act}?t=${tok}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  const cr = await call('create', { doc: D0, by: 'Alex' });
  ok('over HTTP: a room is created', cr.status === 200 && cr.json.room);
  const cm = await call('commit', { room: cr.json.room, base: 0, batch: { id: 'h1', label: 'Wider', by: 'Alex', session: 's1', diff: edit(D0, [{ op: 'set', id: 'plate', params: { width: 120 } }]) } });
  ok('…a change committed', cm.status === 200 && cm.json.ok && cm.json.rev === 1);
  const jn = await call('join', { room: cr.json.room, cid: 'x' });
  ok('…and seen by the next to join', jn.json.rev === 1 && jn.json.doc.objects.find(o => o.id === 'plate').params.width === 120);
  const no = await call('create', { doc: D0 }, 'wrong');
  ok('…but not without the page\'s token', no.status === 403);
} finally { srv.kill(); }
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
