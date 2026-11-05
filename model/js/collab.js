/* SketchFlow — shared editing: document diffs, merging and conflict rules. Pure data (no geometry), so the server and
   every browser run exactly the same code.

   A change travels as a DIFF of the document, not as the operations that made it: an operation can make fresh ids or
   read geometry, so replaying it elsewhere may not give the same result, while a diff always does.

   diff = {
     objects: [ {id, add: state, after: id|null}            a new object, placed after `after` (null: first)
              | {id, del: true}                             an object removed
              | {id, set: {path: value}, unset: [path]} ],  fields changed — path is a top-level key ('name', 'mate')
                                                            or one level down in params / meta / expr ('params.width')
     order: [ids] | undefined,                              the whole feature order, when the order itself changed
     fields: {path: value}, unsetFields: [path]             document fields ('name', 'vars.wall', 'meshes.<id>', 'dims'…)
   }

   Two changes made at the same time MERGE when they touch different things (different objects, or different fields
   of one object — one person's width and another's depth), and CONFLICT when they touch the same field, both reorder
   the features, or one deletes what the other changes or relies on. A conflict is refused, never resolved silently. */

const DEEP_OBJ = new Set(['params', 'meta', 'expr']);        /* object fields diffed one level down */
const DEEP_DOC = new Set(['vars', 'meshes']);                 /* document fields diffed one level down */
const SKIP_DOC = new Set(['objects', 'updated']);             /* not shared: the object list (diffed itself), the local save time */
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
/* equal as data, whatever order the keys were written in */
const canon = (v) => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v === undefined ? null : v);
const same = (a, b) => canon(a) === canon(b);
export const sameDoc = (a, b) => { const x = Object.assign({}, a, { updated: 0 }), y = Object.assign({}, b, { updated: 0 }); return same(x, y); };

/* the fields of one object (or of the document) as {path: value} */
function flat(o, deep) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v === undefined) continue;
    if (deep.has(k) && v && typeof v === 'object' && !Array.isArray(v)) { for (const [k2, v2] of Object.entries(v)) if (v2 !== undefined) out[k + '.' + k2] = v2; }   /* an empty container is no field at all */
    else out[k] = v;
  }
  return out;
}
function setPath(o, path, v) {
  const i = path.indexOf('.');
  if (i < 0 || !DEEP_OBJ.has(path.slice(0, i)) && !DEEP_DOC.has(path.slice(0, i))) { o[path] = clone(v); return; }
  const a = path.slice(0, i), b = path.slice(i + 1); if (!o[a] || typeof o[a] !== 'object' || Array.isArray(o[a])) o[a] = {}; o[a][b] = clone(v);
}
function unsetPath(o, path) {
  const i = path.indexOf('.');
  if (i < 0 || !DEEP_OBJ.has(path.slice(0, i)) && !DEEP_DOC.has(path.slice(0, i))) { delete o[path]; return; }
  const a = path.slice(0, i), b = path.slice(i + 1); if (o[a] && typeof o[a] === 'object') { delete o[a][b]; }
}

/* what changed from doc a to doc b */
export function docDiff(a, b) {
  const A = new Map((a.objects || []).map(o => [o.id, o])), B = new Map((b.objects || []).map(o => [o.id, o])), objects = [];
  for (const o of a.objects || []) if (!B.has(o.id)) objects.push({ id: o.id, del: true });
  (b.objects || []).forEach((o, i) => {
    const before = i ? b.objects[i - 1].id : null;
    if (!A.has(o.id)) { objects.push({ id: o.id, add: clone(o), after: before }); return; }
    const fa = flat(A.get(o.id), DEEP_OBJ), fb = flat(o, DEEP_OBJ), set = {}, unset = [];
    for (const [k, v] of Object.entries(fb)) if (!(k in fa) || !same(fa[k], v)) set[k] = clone(v);
    for (const k of Object.keys(fa)) if (!(k in fb)) unset.push(k);
    if (Object.keys(set).length || unset.length) objects.push(Object.assign({ id: o.id }, Object.keys(set).length ? { set } : {}, unset.length ? { unset } : {}));
  });
  /* order: only when the features both docs have are in a different order */
  const common = (b.objects || []).map(o => o.id).filter(id => A.has(id)), wasOrder = (a.objects || []).map(o => o.id).filter(id => B.has(id));
  const order = same(common, wasOrder) ? undefined : (b.objects || []).map(o => o.id);
  const da = {}, db = {};
  for (const [k, v] of Object.entries(a)) if (!SKIP_DOC.has(k)) da[k] = v;
  for (const [k, v] of Object.entries(b)) if (!SKIP_DOC.has(k)) db[k] = v;
  const fa = flat(da, DEEP_DOC), fb = flat(db, DEEP_DOC), fields = {}, unsetFields = [];
  for (const [k, v] of Object.entries(fb)) if (!(k in fa) || !same(fa[k], v)) fields[k] = clone(v);
  for (const k of Object.keys(fa)) if (!(k in fb)) unsetFields.push(k);
  const d = {}; if (objects.length) d.objects = objects; if (order) d.order = order; if (Object.keys(fields).length) d.fields = fields; if (unsetFields.length) d.unsetFields = unsetFields;
  return d;
}
export const isEmpty = (d) => !d || (!(d.objects || []).length && !d.order && !Object.keys(d.fields || {}).length && !(d.unsetFields || []).length);

/* doc with diff applied (a new doc; the input is not changed) */
export function applyDiff(doc, d) {
  const out = clone(doc); out.objects = out.objects || [];
  for (const c of d.objects || []) {
    const i = out.objects.findIndex(o => o.id === c.id);
    if (c.del) { if (i >= 0) out.objects.splice(i, 1); continue; }
    if (c.add) {
      if (i >= 0) out.objects.splice(i, 1);
      const at = c.after == null ? 0 : out.objects.findIndex(o => o.id === c.after) + 1;
      out.objects.splice(at > 0 || c.after == null ? at : out.objects.length, 0, clone(c.add)); continue;
    }
    if (i < 0) continue;
    const o = out.objects[i];
    for (const [k, v] of Object.entries(c.set || {})) setPath(o, k, v);
    for (const k of c.unset || []) unsetPath(o, k);
  }
  if (d.order) { const pos = new Map(d.order.map((id, k) => [id, k])); out.objects.sort((x, y) => (pos.has(x.id) ? pos.get(x.id) : 1e9) - (pos.has(y.id) ? pos.get(y.id) : 1e9)); }
  for (const [k, v] of Object.entries(d.fields || {})) setPath(out, k, v);
  for (const k of d.unsetFields || []) unsetPath(out, k);
  return out;
}

/* what a diff touches: object fields ('id|path', or 'id|*' for a whole object added / removed), document fields, order */
export function touched(d) {
  const t = { obj: new Set(), whole: new Set(), fields: new Set(Object.keys(d.fields || {}).concat(d.unsetFields || [])), order: !!d.order, added: new Set(), deleted: new Set() };
  for (const c of d.objects || []) {
    if (c.add) { t.whole.add(c.id); t.added.add(c.id); }
    else if (c.del) { t.whole.add(c.id); t.deleted.add(c.id); }
    else for (const k of Object.keys(c.set || {}).concat(c.unset || [])) t.obj.add(c.id + '|' + k);
  }
  return t;
}
/* the other objects an object relies on: any string field that is the id of an object in the doc */
export function refsOf(state, ids) {
  const out = new Set(), walk = (v) => { if (typeof v === 'string') { if (ids.has(v) && v !== state.id) out.add(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const [k, v] of Object.entries(state || {})) if (k !== 'id' && k !== 'name') walk(v); return out;
}
/* two fields overlap when they are the same, or one contains the other ('params' and 'params.width') */
const overlap = (a, b) => a === b || a.startsWith(b + '.') || b.startsWith(a + '.');

/* why diff `mine` cannot go on top of the changes made since it was started (`theirs`), or [] when it merges.
   doc = the document as it is now (with their changes), to see what mine relies on */
export function conflicts(mine, theirs, doc) {
  const out = [], m = touched(mine), ids = new Set((doc.objects || []).map(o => o.id)), byId = new Map((doc.objects || []).map(o => [o.id, o]));
  const name = (id) => (byId.get(id) && byId.get(id).name) || id;
  for (const t of theirs) {
    const o = touched(t.diff), who = t.by || 'someone', what = t.label ? ` (“${t.label}”)` : '';
    for (const id of m.whole) if (o.whole.has(id) || [...o.obj].some(k => k.startsWith(id + '|'))) out.push(`${who}${what} also changed ${name(id)}, which you ${m.deleted.has(id) ? 'deleted' : 'added'}`);
    for (const k of m.obj) {
      const [id, path] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      if (o.whole.has(id)) { out.push(`${who}${what} ${o.deleted.has(id) ? 'deleted' : 'replaced'} ${name(id)}, which you changed`); continue; }
      for (const k2 of o.obj) { const [id2, p2] = [k2.slice(0, k2.indexOf('|')), k2.slice(k2.indexOf('|') + 1)]; if (id2 === id && overlap(path, p2)) { out.push(`${who}${what} also changed ${name(id)} · ${path}`); break; } }
    }
    for (const f of m.fields) for (const f2 of o.fields) if (overlap(f, f2)) { out.push(`${who}${what} also changed the model's ${f}`); break; }
    if (m.order && o.order) out.push(`${who}${what} also reordered the features`);
  }
  /* what mine adds or changes must not rely on something their changes deleted */
  const gone = new Map(); for (const t of theirs) for (const d of touched(t.diff).deleted) gone.set(d, t.by || 'someone');
  if (gone.size) for (const c of mine.objects || []) {
    if (c.del) continue;
    const state = c.add || byId.get(c.id); if (!state) continue;
    const result = c.add ? c.add : applyDiff({ objects: [clone(state)] }, { objects: [c] }).objects[0];
    for (const r of refsOf(result, new Set(gone.keys()))) out.push(`${gone.get(r)} deleted ${r}, which your ${c.add ? 'new ' : 'change to '}${name(c.id)} relies on`);
  }
  return [...new Set(out)];
}

/* the inverse of diff d (taken from before → after): restores what d changed, and only that */
export function inverse(before, after, d) {
  const back = docDiff(after, before), t = touched(d), keep = (c) => t.whole.has(c.id) || Object.keys(c.set || {}).concat(c.unset || []).some(k => t.obj.has(c.id + '|' + k));
  const out = {};
  const objs = (back.objects || []).filter(keep).map(c => (c.set || c.unset) ? Object.assign({ id: c.id }, c.set ? { set: Object.fromEntries(Object.entries(c.set).filter(([k]) => t.obj.has(c.id + '|' + k))) } : {}, c.unset ? { unset: c.unset.filter(k => t.obj.has(c.id + '|' + k)) } : {}) : c);
  if (objs.length) out.objects = objs;
  if (d.order && back.order) out.order = back.order;
  const fields = Object.fromEntries(Object.entries(back.fields || {}).filter(([k]) => t.fields.has(k))), unsetF = (back.unsetFields || []).filter(k => t.fields.has(k));
  if (Object.keys(fields).length) out.fields = fields; if (unsetF.length) out.unsetFields = unsetF;
  return out;
}
/* is everything d set still as d left it in doc (so undoing it overwrites nobody)? the names of what has moved on */
export function changedSince(doc, after, d) {
  const out = [], t = touched(d), now = new Map((doc.objects || []).map(o => [o.id, o])), then = new Map((after.objects || []).map(o => [o.id, o]));
  for (const id of t.whole) if (!same(now.get(id), then.get(id))) out.push((then.get(id) || now.get(id) || {}).name || id);
  for (const k of t.obj) { const id = k.slice(0, k.indexOf('|')), path = k.slice(k.indexOf('|') + 1), a = flat(now.get(id) || {}, DEEP_OBJ)[path], b = flat(then.get(id) || {}, DEEP_OBJ)[path]; if (!same(a, b)) out.push(((now.get(id) || {}).name || id) + ' · ' + path); }
  const fn = flat(doc, DEEP_DOC), fa = flat(after, DEEP_DOC); for (const f of t.fields) if (!same(fn[f], fa[f])) out.push('the model\'s ' + f);
  return [...new Set(out)];
}
