# SketchFlow 3D — architecture

SketchFlow v2 adds a parametric 3D model layer next to the 2D board (v1). It is modelled on Onshape's Part Studio. The aim is a different speed: ideas go in fast, and an LLM drives it through the same JSON operations the mouse produces.

```
model/
├── index.html        workspace UI (toolbar · feature list · 4 linked views · properties)
├── js/kernel.js      geometry kernel: BSP solids, primitives, extrude / loft / revolve / sweep, edge pieces, edge extraction
├── js/model.js       parametric document, evaluation, connectors, mates, edge references, the ops API
├── js/views.js       WebGL2 renderer: TOP | 3D / FRONT | RIGHT, hidden lines, carried dimensions, view cube
├── js/app.js         tools, panels, autosave, export, AI bridge
└── test/             node model/test/kernel.test.mjs · node model/test/model.test.mjs
```

Served by `server.mjs` at `http://localhost:7777/3d/`. `node build.mjs` also writes `dist/sketchflow-3d.html`, a single offline file.

## The layers

| Layer | What it holds | Rebuilt when |
|---|---|---|
| **Document** (`doc`) | An ordered list of objects. Each object is a *shape + its own parameters*, plus how it is placed: a **mate** to another object's connector, or a fixed pose. Booleans are `into` + `op` on the tool. Edge treatments are objects too. Also holds the world origin choice, the ground object and measured dimensions. | Every edit. Snapshot undo keeps 150 steps, and each batch is one step. |
| **Local solids** | Each shape built in its own frame: base centred on its XY plane, Z up. Cached by `type + params`. | Its parameters change. |
| **Placement** | World matrices solved outward from the ground object along the mate graph. Loops, orphans and floating objects become warnings. | Any mate, pose or size changes. A bigger box moves everything stacked on it. |
| **Bodies** | Root objects with their boolean tools and edge treatments applied in feature-list order. Cached per body by a signature of everything they are made of. | Only bodies whose inputs changed. Under 1 ms on a cache hit. |
| **Views** | Four panes sharing one orthographic scale and centre (third-angle). The 3D pane has its own orbit camera. GPU buffers and silhouettes are kept per unchanged body. | Only changed bodies are re-uploaded. |

**Ephemeral origin.** There is no fixed world zero. The origin is a connector, by default the bottom of the ground object (the first one placed), or any connector the user or AI picks. Every coordinate shown, exported or sent to the AI is relative to it, so moving the origin re-references the readouts without moving geometry.

## Mapping to Onshape

| Onshape | SketchFlow 3D | Tweak for rapid prototyping / LLMs |
|---|---|---|
| Part Studio feature list | `doc.objects`, in order | Each feature is a self-contained object, so an LLM can add, edit or delete one without replaying a script |
| Parasolid kernel (exact B-rep) | Own BSP CSG over faceted polygons with surface ids | Zero dependencies and runs everywhere. Precision is that of the faceted surfaces (48 segments) |
| Sketch + constraint solver | *Profile* tool: click points on a view plane with grid and Shift-straight snapping | No solver yet (see gaps) |
| Extrude / Revolve / Loft / Sweep | `extrude {length, twist, scale, direction}`, `revolve {degrees}`, `loft {profile2, twist}`, `sweep {path}` | Loft is "extrude with a different end": scale, twist, or a second profile of any point count |
| Mate connectors | Connectors on every object: faces, centre, corners, edge midpoints, round sides, feature start/end, bbox faces | Named, so the AI can say `a: 'top', b: 'bottom'`. Errors list the valid names |
| Fastened mate | `mate {to, a, b, offset, slide:[u,v], angle, flip}` | Face-to-face mates flip automatically. With no mate, a new object stacks on the ground's top face |
| Boolean (union / subtract / intersect) | `into` + `mode` on the tool | Tools stay live, editable objects (`separate` undoes the boolean) |
| Fillet / Chamfer | `edge {near, style: fillet \| weld \| chamfer, size}` | Add or remove is decided automatically by convexity, and round edges are treated all the way round |
| Topological naming | An edge is stored as **the two surface ids it lies between** (e.g. `plate:front | plate:right`) plus a point | It survives size changes. If the faces disappear it falls back to the nearest edge, then warns |
| Variables / expressions | — | (gap) |
| Drawings | The 4 views always show each object's own dimensions. Click one to edit it. Measure adds driven dimensions between connectors. | Dimensions are carried automatically, not placed by hand |
| FeatureScript / API | `model.apply(ops)`. The UI and the MCP bridge call the same function | Batches are atomic and roll back on error. Positions can be origin-relative |
| Versions & branches | Undo/redo, `.sf3d.json` files, git | — |

### The fillet / chamfer rule ("proper math")

The rule doesn't use angle thresholds. At the picked edge, take the two faces' outward normals `n1, n2` and the directions `u1, u2` that run along each face away from the edge. The edge is **convex** (an outside edge, enclosed angle < 180°) when `u1 · n2 < 0`. A convex edge gets the piece **subtracted** (it is trimmed or rounded). Otherwise the edge is **concave** (an inside corner, > 180° seen from the material) and the piece is **added** (filled).

The piece is the cross-section `corner → leg1 → curve → leg2`, with each leg the given size along its face:
- **fillet** = concave arc, tangent to both faces (indent);
- **weld** = convex bead centred on the corner (bulge, used on inside corners);
- **chamfer** = straight.

For a round edge, the same cross-section is swept along the actual faceted loop, so it meets the surfaces exactly:
- chamfering a hole rim gives a countersink;
- filleting a boss base fills it.

`mode: add | subtract` overrides the automatic choice.

## Driving it from an LLM (MCP)

| Tool | Does |
|---|---|
| `open_model` | Opens `/3d/` and returns the model summary |
| `model_build` | A batch of ops (atomic, one undo step). Returns per-op results; `look:true` adds a picture of the 4 views |
| `model_describe` | Objects, parameters, origin-relative positions, mates, booleans, connector names, body volumes and bounding boxes, warnings. `connectors_of` adds connector positions, normals and u/v axes |
| `model_view` | PNG of the views (4-up or one pane, any 3D direction). The user's view is restored afterwards |
| `model_session` | undo / redo / new / demo / load / select / say |
| `model_export` | STL (watertight), OBJ, `.sf3d.json` |

Example: a flange with a bore and a 4-hole bolt circle in one call.

```json
{ "label": "Flange", "ops": [
  { "op": "add", "type": "cylinder", "id": "disc", "params": { "diameter": 80, "height": 8 } },
  { "op": "add", "type": "cylinder", "id": "neck", "params": { "diameter": 36, "height": 30 }, "mate": { "to": "disc", "a": "top", "b": "bottom" }, "into": "disc", "mode": "add" },
  { "op": "add", "type": "cylinder", "id": "bore", "params": { "diameter": 20, "height": 42 }, "mate": { "to": "disc", "a": "bottom", "b": "bottom", "flip": false, "offset": 1 }, "into": "disc", "mode": "subtract" },
  { "op": "add", "type": "cylinder", "id": "b1", "params": { "diameter": 7, "height": 10 }, "mate": { "to": "disc", "a": "top", "b": "top", "flip": false, "offset": 1, "slide": [29, 0] }, "into": "disc", "mode": "subtract" },
  { "op": "edge", "target": "disc", "near": [40, 0, 8], "style": "chamfer", "size": 1 }
] }
```

## What is not there yet

Roughly in order of how much each unlocks:

1. **Sketch constraints**: coincident, parallel, perpendicular, tangent, equal, driving dimensions. They need a small Newton/LM solver; the 2D board's joints are a start.
2. **Variables and expressions**: `#wall = 3`, `depth = width / 2`, used in any parameter.
3. **Patterns and mirror**: linear and circular patterns of features, and mirror about a plane. Today a bolt circle is four ops.
4. **Shell, draft, hole wizard (counterbore / tapped), rib.**
5. **Mate degrees of freedom**: revolute, slider, cylindrical, planar, ball (today only fastened). With limits and a drive, these feed the v1 motion simulator, so "make it move like this" works in 3D.
6. **Part Studio vs Assembly**: separate part definition from instances, so a part can be reused many times with its own mates.
7. **Configurations**: one model, several size tables (S / M / L).
8. **Rollback bar and suppress**: edit "as of" any feature, and turn features off temporarily.
9. **Mass properties and materials**: density, mass, centre of mass. Volume is already exact for the faceted solid.
10. **Section views, exploded views, drawing annotations** (GD&T, notes, title block), and DXF/PDF drawing export.
11. **STEP / exact geometry**: needs a B-rep kernel. The `Solid` interface (union / subtract / intersect / transform / mesh) is small on purpose, so the BSP kernel can be swapped for Manifold (Apache-2.0, WASM) or OpenCascade.js. Both would also make booleans 10–100× faster on large models.
12. **Imports**: STL/OBJ/glTF as reference bodies; 2D board sketches as profiles.
13. **Versions and branches, and multi-user editing**, as Onshape has them.

## Testing

```bash
node model/test/kernel.test.mjs   # volumes against closed forms: primitives, booleans, extrude/loft/revolve/sweep, edge pieces
node model/test/model.test.mjs    # stacking, mates, booleans, auto fillet add/subtract, topological edges, round edges, warnings, undo
node build.mjs                    # single-file builds in dist/
```
