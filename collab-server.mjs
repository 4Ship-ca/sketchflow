/* SketchFlow — shared editing rooms, served by server.mjs.
   A room holds the model (plain JSON, no geometry), a revision number and the log of changes. Every change is a diff
   (model/js/collab.js). A change made on the latest revision is accepted as it is; one made on an older revision is
   merged when it touches different things from the changes since, and refused — with the reasons, naming who changed
   what — when it would overwrite them. Rooms are written to disk (atomically) so a restart loses nothing. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { applyDiff, conflicts, isEmpty } from './model/js/collab.js';

const LOG_KEEP = 1000;          /* changes kept per room (a client further behind reloads the whole model) */
const PRESENCE_TTL = 45000;     /* a person not heard from in this long has gone */

export function createCollab({ dir, broadcast, log = () => {} }) {
  const rooms = new Map();
  const file = (id) => path.join(dir, id + '.json');
  const valid = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(id);
  const users = (r) => { const now = Date.now(), out = []; for (const [cid, u] of r.users) { if (now - u.at > PRESENCE_TTL) { r.users.delete(cid); continue; } out.push(Object.assign({ cid }, u)); } return out; };
  async function load(id) {
    if (!valid(id)) throw Object.assign(new Error('not a room id'), { code: 400 });
    if (rooms.has(id)) return rooms.get(id);
    let j; try { j = JSON.parse(await fsp.readFile(file(id), 'utf8')); } catch { throw Object.assign(new Error('no such room (it may have been on another SketchFlow server)'), { code: 404 }); }
    const r = { id, doc: j.doc, rev: j.rev || 0, log: j.log || [], created: j.created || Date.now(), users: new Map(), saveT: null };
    rooms.set(id, r); return r;
  }
  function save(r) {
    clearTimeout(r.saveT);
    r.saveT = setTimeout(async () => {
      try { await fsp.mkdir(dir, { recursive: true }); const tmp = file(r.id) + '.' + process.pid + '.tmp'; await fsp.writeFile(tmp, JSON.stringify({ doc: r.doc, rev: r.rev, log: r.log.slice(-LOG_KEEP), created: r.created })); await fsp.rename(tmp, file(r.id)); }
      catch (e) { log('could not save room ' + r.id + ': ' + e.message); }
    }, 300);
  }
  const people = (r) => broadcast(r.id, { type: 'presence', users: users(r) });
  return {
    /* a new room from a model */
    async create(doc, by) {
      if (!doc || !Array.isArray(doc.objects)) throw Object.assign(new Error('give the model (doc with objects)'), { code: 400 });
      const id = crypto.randomBytes(6).toString('base64url');
      const r = { id, doc, rev: 0, log: [], created: Date.now(), users: new Map(), saveT: null };
      rooms.set(id, r); save(r); log(`room ${id} created by ${by || 'someone'}`);
      return { room: id, rev: 0 };
    },
    /* join (or catch up): the changes since `since` when the log still has them, otherwise the whole model */
    async join(id, cid, since) {
      const r = await load(id), first = r.log.length ? r.log[0].rev : r.rev + 1;
      const out = { room: id, rev: r.rev, users: users(r) };
      if (since != null && since >= first - 1 && since <= r.rev) out.batches = r.log.filter(b => b.rev > since);
      else out.doc = r.doc;
      return out;
    },
    /* a change: {base, batch: {id, label, by, user, session, diff}} */
    async commit(id, body) {
      const r = await load(id), b = body.batch || {}, base = +body.base;
      if (!b.id || !b.diff) throw Object.assign(new Error('give batch {id, diff}'), { code: 400 });
      const dup = r.log.find(x => x.id === b.id); if (dup) return { ok: true, rev: dup.rev, duplicate: true };
      if (!(base >= 0 && base <= r.rev)) throw Object.assign(new Error(`base revision ${body.base} is not one this room has had (it is at ${r.rev})`), { code: 409 });
      const later = r.log.filter(x => x.rev > base);
      if (later.length < r.rev - base) return { ok: false, stale: true, rev: r.rev };
      if (isEmpty(b.diff)) return { ok: true, rev: r.rev, empty: true };
      /* a person's own earlier changes are already under this one */
      const others = later.filter(x => !b.session || x.session !== b.session);
      const why = others.length ? conflicts(b.diff, others, r.doc) : [];
      if (why.length) { log(`room ${id}: refused “${b.label || 'a change'}” by ${b.by || 'someone'} — ${why[0]}`); return { ok: false, conflict: why, rev: r.rev }; }
      r.doc = applyDiff(r.doc, b.diff); r.rev++;
      const entry = { rev: r.rev, id: b.id, label: String(b.label || 'Edit').slice(0, 200), by: String(b.by || 'Someone').slice(0, 80), user: b.user || null, session: b.session || null, at: Date.now(), diff: b.diff, merged: others.length > 0 };
      r.log.push(entry); if (r.log.length > LOG_KEEP) r.log.splice(0, r.log.length - LOG_KEEP);
      save(r); broadcast(id, { type: 'batch', batch: entry });
      return { ok: true, rev: r.rev, merged: entry.merged };
    },
    /* who is here and what they are doing: {user: {id, name, color}, sel, tool, on} */
    async presence(id, cid, p) {
      const r = await load(id);
      r.users.set(cid, { id: (p.user || {}).id || cid, name: String((p.user || {}).name || 'Someone').slice(0, 40), color: /^#[0-9a-f]{6}$/i.test((p.user || {}).color || '') ? p.user.color : '#888888', sel: p.sel || null, tool: p.tool || null, on: p.on || null, at: Date.now() });
      people(r); return { ok: true };
    },
    async leave(id, cid) { const r = rooms.get(id); if (r && r.users.delete(cid)) people(r); return { ok: true }; },
    gone(cid) { for (const r of rooms.values()) if (r.users.delete(cid)) people(r); },
    /* for the tests and the session tool */
    info(id) { const r = rooms.get(id); return r ? { room: id, rev: r.rev, objects: r.doc.objects.length, users: users(r) } : null; }
  };
}
