# SketchFlow 3D add-ons

An add-on brings specialist know-how into the 3D workspace: gears, fasteners, sheet metal, bearings, pipework, a supplier's catalogue. Write it once and it works for everyone:
- The person at the screen gets it under **Add-ons** in the toolbar, with a form built from your action's arguments.
- An LLM gets it through the `model_addon` MCP tool, which lists your shapes, mates and actions along with your docs.
- Your shapes behave like built-in ones. They take mates, booleans, fillets and welds; they can be patterned; they carry dimensions, materials and mass; they export to STL, OBJ and the parts list.

Three add-ons ship with SketchFlow:
- **Gears** (`model/addons/gears.js`) is built in.
- **Welding & joining** (`model/addons/welding.js`) is built in, with its own wizard in the toolbar (**Weld wizard**).
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

An action's `ctx` also carries what an add-on that works *between* parts needs: `ctx.bodyOf(id)` (the evaluated body holding an object, with its solid in world coordinates), `ctx.world(id)` (its 4×4 world matrix), `ctx.material(id)` and `ctx.materials` (the material table), and `ctx.opPoint(p)` (a world point as the ops expect it, origin-relative when the batch is). Two ops help it build: a **frame mate** `{op:'mate', id, to, frame:[16 numbers]}` attaches a part rigidly to another at any pose (so a weld bead at an angle follows its plate), and **`callout`** `{op:'callout', on, at, dir, along, symbol, lines, kind}` pins a label — an ISO 2553 weld symbol or a note — to a part, shown in the views and on drawings.

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

See `model/test/addons.test.mjs` (the contract plus the fasteners example), `model/test/gears.test.mjs` and `model/test/welding.test.mjs`. The gears tests check meshing by measuring the overlap volume between gears, and a half-tooth phase error must show up.

## The welding & joining add-on in brief

Pick two parts (or click the seam between them) and the add-on reads the joint, then suggests how to join it for **light**, **regular** and **heavy** service, by common standards: ISO 9692-1 / -3 (edge preparations, steel and aluminium), AWS D1.1 (minimum fillet and lap sizes), EN 1993-1-8 (fillet throats), ISO 5817 (quality levels D / C / B), ISO 4063 (process numbers), ISO 6947 (positions), ISO 2553 (symbols), IIW fatigue practice (grinding flush, toe dressing), and adhesive-maker and marine FRP practice for joints that are not welded.

- **The joint** (`analyze`): butt, tee, corner or lap, from the contact between the two solids: both thicknesses, the seam length, and for each side whether it is an inside corner or flush, how well a torch reaches it (rays from points along the seam, round the approach direction: *open*, *restricted* or *blocked*, naming the part in the way) and its welding position (PA flat … PE overhead).
- **The advice** (`advise`): for each duty, the joint and its preparation (square, V, Y, X, U, double U, bevel, K, J; root face, root gap, backing strip, back gouge and sealing run), the process (135 MAG, 136 FCAW, 131 MIG, 141 TIG, 111 stick, 121 SAW — chosen by material, thickness, duty, position and length), filler and gas, sizes and passes, weld metal, the main and worst welding positions, the time (fit-up; preparation by thermal cutting and grinding, or machining for U / J; preheat for thick sections and cast iron; arc time over the operating factor at each run's position; back gouging, grinding flush, toe dressing, pickling; inspection), cost (labour at your rate, filler, gas), an ease score (1–5), the ISO 5817 level and NDT, the steps, the reasons, and what to watch out for. Light service is the smallest weld that does the job (one side, intermittent on long seams); regular is general structural (fillets both sides ≈ 0.5 t, or full penetration from both sides); heavy is fatigue / dynamic / pressure (full penetration, ground or dressed, 100 % UT/RT).
- **Materials**: alike weldable metals weld; carbon steel to stainless uses 309L filler; aluminium to steel, plastics, wood and glass are **bonded** (an adhesive chosen by the materials and the duty, the surface preparation it needs, a bond line and spew fillets, and bonded straps over butt joints); copper alloys are **brazed**; composites get a **filler fillet and fibre tabbing**, the plies counted from the panel thickness. `method` asks for any of them.
- **Building it** (`apply` with `duty`): one undoable step that cuts the preparation out of the parts (extrude cuts attached to each), opens the root gap or bond line (moving the stem of a tee, or *b*, through its mate), places the weld metal, adhesive, filler, laminate or straps as parts attached to *a* (`meta.joint` names the joint; they carry material and mass), and adds the ISO 2553 weld symbol as a callout. Everything follows the parts when they move. The weld metal is inset 0.02 mm from the parts so the interference check stays clean.
- **After a change** (`redo` with the joint's `id`): the weld metal is fixed geometry, sized for the parts as they were. After a thickness or size changes, `redo` builds the joint again in one step, with the same parts, duty, method and process (they are stored on its symbol). In the app this is *Redo for new sizes* on the weld symbol or its weld metal. On thin parts the throat is capped at 0.7 × t of the thinner part.
- **The wizard** (`ui.advise`, `ui.section`, `ui.publicOption`): the toolbar's **Weld wizard** asks what service the joint is for, shows the three suggestions side by side with a section through the joint (the parts as cut, the preparation hatched, the weld metal in place) and the symbol, and builds the one you choose. `model/js/weldsymbol.js` draws symbols and sections for the views, the wizard and the drawing sheets (which also get a weld schedule).

## The gears add-on in brief

- **Shape `gear`**: involute spur, helical or herringbone, external or internal (ring). It has profile shift, backlash and clearance allowances, a bore and a rim, and reports pitch, outside, root and base diameters plus an undercut warning.
- **Mate kind `gear`**: keeps the centre distance (`m·(z1 + z2)/2`, or the difference for a ring) and the tooth phase, so a tooth always meets a gap. `around` is a world direction. Helix hands are checked: opposite for external pairs, the same for a ring and its pinion.
- **Actions**:
  - `advise`: picks module, teeth, form, pressure angle, backlash, clearance and face width from the ratio, process (FDM, SLA, CNC, laser, injection, hobbed), priority and optional torque (Lewis bending, 1.5 service factor), and says why. It prefers hunting-tooth pairs unless precision is asked for.
  - `pair`, `train` (simple or compound), `planetary` (checks the assembly condition) and `gear`.
  - Parts get the material their process implies.
