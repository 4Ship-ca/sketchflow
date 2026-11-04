# SketchFlow 3D add-ons

An add-on brings specialist know-how into the 3D workspace: gears, fasteners, sheet metal, bearings, pipework, a supplier's catalogue. Write it once and it works for everyone:
- The person at the screen gets it under **Add-ons** in the toolbar, with a form built from your action's arguments.
- An LLM gets it through the `model_addon` MCP tool, which lists your shapes, mates and actions along with your docs.
- Your shapes behave like built-in ones. They take mates, booleans, fillets and welds; they can be patterned; they carry dimensions, materials and mass; they export to STL, OBJ and the parts list.

Two add-ons ship with SketchFlow:
- **Gears** (`model/addons/gears.js`) is built in.
- **Fasteners** (`model/addons/examples/fasteners.js`) is an example you can copy.

## Installing one

| Where | When it loads |
|---|---|
| `model/addons/*.js` | Every time the workspace is served by `server.mjs` |
| The folder named in `SKETCHFLOW_ADDONS` (env) | Same, so you can keep your own add-ons outside the repo |
| Imported in `model/js/app.js` and listed in `MODS` in `build.mjs` | Built in: always present, including in `dist/sketchflow-3d.html` |

Reload the page after adding a file. A file that fails to load shows a message and leaves the rest alone.

## The contract

An add-on is one ES module whose default export is a plain object. It needs **no imports**: the host passes the geometry kernel in `api`. That keeps it working the same served, bundled, in Node tests and in other hosts.

```js
export default {
  id: 'fasteners',                 // unique, used in ops and by the AI
  name: 'Fasteners', version: '1.0.0', description: 'What it is for, in one sentence.',
  types:   { /* new shapes */ },
  mates:   { /* new mate kinds */ },
  actions: { /* things a person or an AI can ask for */ }
};
```

### Shapes: `types`

```js
types: {
  hex_nut: {
    label: 'Hex nut',
    doc: 'ISO 4032 regular nut.',                  // shown to the AI
    params: { size: 'M6' },                        // defaults; numbers, strings, booleans and arrays are all editable in Properties
    build(p, api) { return api.K.ringExtrude(hexagon(p), circle(p), [{ z: 0, rot: 0 }, { z: h(p), rot: 0 }], { sidOuter: 'flats' }); },
    connectors(p, api) { return [api.conn('bottom', [0, 0, 0], [0, 0, -1], [1, 0, 0]), api.conn('top', [0, 0, h(p)], [0, 0, 1], [1, 0, 0])]; },
    dims(p, api) { return [api.dim('height', [s(p) / 2, 0, 0], [s(p) / 2, 0, h(p)], 'front')]; },   // optional: carried, editable dimensions
    info(p, api) { return { across_flats: s(p) }; }                                                   // optional: read-only data for Properties and the AI
  }
}
```

- `build` returns a solid in the shape's **own frame**: base on the XY plane, Z up, centred on the axis. Throw an `Error` with a plain sentence for bad parameters. The model shows it as a warning and keeps the rest of the model working.
- `connectors` are what mates attach to: name, origin, outward normal, an in-plane `u` direction and a kind (`face`, `center`, `corner`, `edge` or `side`). Connectors you leave out are still added for you: bounding-box faces `bbox±x/y/z`, plus `center`, `top` and `bottom`.
- Surface ids (the last argument of the builders) are how edges are remembered. Give each face a stable name, such as `flats`, `bore` or `teeth`.

### Mate kinds: `mates`

A mate kind turns two objects' live parameters into an ordinary mate. The workspace re-solves it whenever either object changes, which is how two gears stay in mesh when the module changes.

```js
mates: {
  gear: {
    doc: 'Keeps this gear in mesh with the target gear.',
    solve({ self, target, mate, api, targetWorld }) {
      // return { a, b, flip, offset, angle, slide }  (target connector, own connector, as in a normal mate)
    }
  }
}
```

Use it with `{ op: 'mate', id, to, kind: 'gear', ...your fields }`. Your fields are stored with the mate (for example `around`, `axial` and `phase`). `targetWorld` is the target's world matrix, so directions can be world-relative.

### Actions: `actions`

Actions return **operations**; they never edit the document themselves. The host applies the operations as one undoable step and rolls them all back if any fails. That keeps every add-on safe for undo, history and the AI.

```js
actions: {
  fasten: {
    doc: 'Bolt two stacked parts together through a hole…',
    args: { on: { default: null, doc: 'part id' }, size: { default: 'M6', options: ['M3', 'M4', 'M5', 'M6'] }, grip: { default: 10 } },
    run(args, ctx) {
      const ops = [{ op: 'add', type: 'washer', params: { size: args.size }, mate: { to: args.on, a: 'top', b: 'bottom' }, material: 'steel' } /* … */];
      return { ops, label: 'Fasten M6×30', info: { length: 30 } };   // info is shown to the person and returned to the AI
    }
  },
  advise: { query: true, doc: '…', args: { /* … */ }, run(args) { return { info: { /* recommendation */ } }; } }   // query: changes nothing
}
```

- `args` drive the UI form and the AI's documentation. Each one has a `default` (its type picks the input: a number, text, an array such as `15, 45` or `12:36, 12:36`, or a checkbox), an optional `doc`, and an optional `options` (which makes a select).
- `ctx`:
  - `ctx.get(id)` and `ctx.doc` give read access to the model.
  - `ctx.result` holds the evaluated world matrices, bodies and warnings.
  - `ctx.describe()` gives the AI summary.
  - `ctx.api` is the same kernel `api`.
- Ops can use everything `model_build` accepts: `add` (any shape, including yours), `mate`, `boolean`, `edge`, `weld`, `pattern`, `set` and so on. `meta` and `material` on `add` give your parts a material, so they get a mass.

### `api`

| | |
|---|---|
| `api.K` | The kernel. **Builders**: `box`, `wedge`, `cylinder`, `sphere`, `extrude`, `loft`, `revolve`, `sweep`, `ringExtrude(outer, inner, stations, {sidOuter, sidInner})` (star-shaped profiles with a hole and twist, built without booleans), `edgePiece`, `loopPiece`. **Solids**: `union`, `subtract`, `intersect`, `transform`, `bbox`, `volume`, `massProps`. **Helpers**: `triangulate`, `area2`, `resample` |
| `api.V`, `api.M4` | Vectors and 4×4 matrices (column-major, degrees for rotations) |
| `api.conn(name, o, n, u, kind)` | A connector |
| `api.dim(param, a, b, view, kind)` | A carried dimension that edits `param` |

## Testing an add-on

Add-ons run in Node unchanged:

```js
import { Model, registerAddon } from '../js/model.js';
import mine from '../addons/mine.js';
registerAddon(mine);
const m = new Model();
const [r] = m.apply([{ op: 'addon', addon: 'mine', action: 'build_it', args: { size: 10 } }]);
console.log(r.info, m.result.warnings, m.describe().mass);
```

See `model/test/addons.test.mjs` (the contract plus the fasteners example) and `model/test/gears.test.mjs`. The gears tests check meshing by measuring the overlap volume between gears, and a half-tooth phase error must show up.

## The gears add-on in brief

- **Shape `gear`**: involute spur, helical or herringbone, external or internal (ring). It has profile shift, backlash and clearance allowances, a bore and a rim, and reports pitch, outside, root and base diameters plus an undercut warning.
- **Mate kind `gear`**: keeps the centre distance (`m·(z1 + z2)/2`, or the difference for a ring) and the tooth phase, so a tooth always meets a gap. `around` is a world direction. Helix hands are checked: opposite for external pairs, the same for a ring and its pinion.
- **Actions**:
  - `advise`: picks module, teeth, form, pressure angle, backlash, clearance and face width from the ratio, process (FDM, SLA, CNC, laser, injection, hobbed), priority and optional torque (Lewis bending, 1.5 service factor), and says why. It prefers hunting-tooth pairs unless precision is asked for.
  - `pair`, `train` (simple or compound), `planetary` (checks the assembly condition) and `gear`.
  - Parts get the material their process implies.
