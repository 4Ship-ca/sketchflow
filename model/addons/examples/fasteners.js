/* Example SketchFlow 3D add-on: ISO metric fasteners (hex bolt, hex nut, flat washer) and a "fasten" action that
   stacks washer + bolt + washer + nut through two parts. Copy this file into model/addons/ (or the folder named by
   SKETCHFLOW_ADDONS) and reload the 3D workspace: the shapes appear under Add-ons, and model_addon lists them.
   It uses only the api the host passes in — no imports — so it works unbundled and bundled alike. */

/* ISO 4014 / 4032 / 7089 key sizes, mm: thread d, across flats s, head height k, nut height m, washer OD × thickness */
const SIZES = {
  M3: { d: 3, s: 5.5, k: 2, m: 2.4, wd: 7, wt: 0.5 }, M4: { d: 4, s: 7, k: 2.8, m: 3.2, wd: 9, wt: 0.8 }, M5: { d: 5, s: 8, k: 3.5, m: 4.7, wd: 10, wt: 1 },
  M6: { d: 6, s: 10, k: 4, m: 5.2, wd: 12, wt: 1.6 }, M8: { d: 8, s: 13, k: 5.3, m: 6.8, wd: 16, wt: 1.6 }, M10: { d: 10, s: 16, k: 6.4, m: 8.4, wd: 20, wt: 2 },
  M12: { d: 12, s: 18, k: 7.5, m: 10.8, wd: 24, wt: 2.5 }, M16: { d: 16, s: 24, k: 10, m: 14.8, wd: 30, wt: 3 }
};
const STD_LENGTHS = [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120, 130, 140, 150];
const size = (p) => { const z = SIZES[String(p.size || 'M6').toUpperCase()]; if (!z) throw new Error(`size must be one of ${Object.keys(SIZES).join(', ')}`); return z; };
const hexagon = (s) => { const r = s / Math.sqrt(3); return Array.from({ length: 6 }, (_, i) => [r * Math.cos(Math.PI / 6 + i * Math.PI / 3), r * Math.sin(Math.PI / 6 + i * Math.PI / 3)]); };
const circle = (r, n = 32) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]);
const prism = (api, outer, inner, z0, z1, sid) => api.K.ringExtrude(outer, inner, [{ z: z0, rot: 0 }, { z: z1, rot: 0 }], { sidOuter: sid, sidInner: 'bore' });
const axisConns = (api, top) => [api.conn('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0]), api.conn('top', [0, 0, top], [0, 0, 1], [1, 0, 0]), api.conn('center', [0, 0, top / 2], [0, 0, 1], [1, 0, 0], 'center')];

export default {
  id: 'fasteners',
  name: 'Fasteners',
  version: '1.0.0',
  description: 'ISO metric hex bolts, nuts and washers (M3–M16), and a fasten action that picks a standard bolt length for a joint.',
  types: {
    hex_bolt: {
      label: 'Hex bolt', doc: 'Head on the bottom face (z = 0 … k), shank up to the tip. size M3–M16, length = under-head length in mm.',
      params: { size: 'M6', length: 20 },
      build(p, api) { const z = size(p); return prism(api, hexagon(z.s), null, 0, z.k, 'head').union(prism(api, circle(z.d / 2), null, z.k - 0.01, z.k + +p.length, 'shank')); },
      connectors(p, api) { const z = size(p); return [api.conn('head', [0, 0, 0], [0, 0, -1], [1, 0, 0]), api.conn('under-head', [0, 0, z.k], [0, 0, 1], [1, 0, 0]), api.conn('tip', [0, 0, z.k + +p.length], [0, 0, 1], [1, 0, 0]), api.conn('center', [0, 0, (z.k + +p.length) / 2], [0, 0, 1], [1, 0, 0], 'center')]; },
      dims(p, api) { const z = size(p); return [api.dim('length', [z.d / 2, 0, z.k], [z.d / 2, 0, z.k + +p.length], 'front')]; },
      info(p) { const z = size(p); return { thread: String(p.size).toUpperCase(), across_flats: z.s, head_height: z.k, clearance_hole: +(z.d * 1.1).toFixed(1) }; }
    },
    hex_nut: {
      label: 'Hex nut', doc: 'ISO 4032 regular nut.', params: { size: 'M6' },
      build(p, api) { const z = size(p); return prism(api, hexagon(z.s), circle(z.d / 2), 0, z.m, 'flats'); },
      connectors(p, api) { return axisConns(api, size(p).m); },
      info(p) { const z = size(p); return { thread: String(p.size).toUpperCase(), across_flats: z.s, height: z.m }; }
    },
    washer: {
      label: 'Washer', doc: 'ISO 7089 flat washer.', params: { size: 'M6' },
      build(p, api) { const z = size(p); return prism(api, circle(z.wd / 2, 48), circle(z.d * 0.54, 32), 0, z.wt, 'rim'); },
      connectors(p, api) { return axisConns(api, size(p).wt); },
      info(p) { const z = size(p); return { inner: +(z.d * 1.08).toFixed(2), outer: z.wd, thickness: z.wt }; }
    }
  },
  actions: {
    fasten: {
      doc: 'Bolt two stacked parts together through a hole: give the top part (bolt side), the connector the bolt head sits on (e.g. "top") and the grip (total thickness clamped). Picks the shortest standard length that leaves 2 threads past the nut.',
      args: { on: { default: null, doc: 'object id the bolt head sits on' }, at: { default: 'top', doc: 'connector on that object' }, grip: { default: 10, doc: 'mm of material clamped' }, size: { default: 'M6', options: Object.keys(SIZES) }, slide: { default: [0, 0], doc: 'position on the face' } },
      run(args, ctx) {
        if (!args.on || !ctx.get(args.on)) throw new Error('on: give the id of the part the bolt head sits on');
        const z = size(args), need = +args.grip + 2 * z.wt + z.m + 2 * (z.d * 0.25);
        const length = STD_LENGTHS.find(L => L >= need) || Math.ceil(need);
        const used = new Set(), n = (base) => { let i = 1; while (ctx.get(base + i) || used.has(base + i)) i++; used.add(base + i); return base + i; };
        const w1 = n('washer'), b = n('bolt'), w2 = n('washer'), nut = n('nut'), slide = Array.isArray(args.slide) ? args.slide : [0, 0];
        /* the stack hangs down from the face: washer, bolt (head on the washer, shank pointing into the part), washer + nut below */
        const ops = [
          { op: 'add', type: 'washer', id: w1, name: `Washer ${args.size}`, params: { size: args.size }, mate: { to: args.on, a: args.at, b: 'bottom', slide }, material: 'steel' },
          { op: 'add', type: 'hex_bolt', id: b, name: `Bolt ${args.size}×${length}`, params: { size: args.size, length }, mate: { to: w1, a: 'top', b: 'under-head' }, material: 'steel', meta: { part_no: `ISO 4014 ${args.size}×${length}` } },
          /* far side: the second washer's top meets the underside of the joint (washer + grip below the head), then the nut */
          { op: 'add', type: 'washer', id: w2, name: `Washer ${args.size}`, params: { size: args.size }, mate: { to: b, a: 'under-head', b: 'top', offset: z.wt + +args.grip }, material: 'steel' },
          { op: 'add', type: 'hex_nut', id: nut, name: `Nut ${args.size}`, params: { size: args.size }, mate: { to: w2, a: 'bottom', b: 'top' }, material: 'steel', meta: { part_no: `ISO 4032 ${args.size}` } }
        ];
        return { ops, label: `Fasten ${args.size}×${length}`, info: { bolt: b, nut, washers: [w1, w2], length, grip: +args.grip, protrusion: +(length - (+args.grip + 2 * z.wt + z.m)).toFixed(2) } };
      }
    }
  }
};
