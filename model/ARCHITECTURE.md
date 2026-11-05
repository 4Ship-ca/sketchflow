# SketchFlow 3D — architecture

SketchFlow v2 adds a parametric 3D model layer next to the 2D board (v1). It is modelled on Onshape's Part Studio. The aim is a different speed: ideas go in fast, and an LLM drives it through the same JSON operations the mouse produces.

```
model/
├── index.html        workspace UI (toolbar · feature list · 4 linked views · properties)
├── js/kernel.js      geometry kernel: BSP solids (culled lazy trees), primitives, extrude / loft / revolve / sweep, radial solids (threads), wrap, edge pieces
├── js/sketch.js      sketch solver (constraints, arcs), arc and spline geometry, auto-constraints
├── js/text.js        the single-stroke engraving font and text layout (straight, arc, path)
├── js/model.js       parametric document, evaluation, connectors, mates, joints, links and formulas, edge references, the ops API
├── js/collide.js     interference (exact, voxel fallback) and collision detection during motion
├── js/drawing.js     drawing sheets: SVG / DXF, hidden lines, dimensions, exploded isometric with balloons
├── js/views.js       WebGL2 renderer: TOP | 3D / FRONT | RIGHT, hidden lines, carried dimensions, view cube
├── js/examples.js    bundled example models (File → Example)
├── js/app.js         tools, panels, autosave, export, AI bridge, add-on loading
├── addons/           gears.js (built in) · examples/fasteners.js — see ADDONS.md
└── test/             kernel · model · gears · addons · collide · reference  (npm test)
```

The MCP server is `server.mjs`; its op reference (`model_reference`) is `mcp-reference.mjs`, and `test/reference.test.mjs` runs every worked example in it, so the reference can't drift from what the model accepts.

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
| Parasolid kernel (exact B-rep) | Own BSP CSG over faceted polygons with surface ids | Zero dependencies and runs everywhere. Precision is that of the faceted surfaces (48 segments). Booleans use lazy, bounding-box-culled classification trees (below), so a bolt against its nut (30k polygons) takes about 0.3 s |
| Sketch | The sketch bar: Line, Arc, Tangent arc, Spline, Rectangle, Circle, Slot, Polygon, on a view plane, any flat face, a reference plane or an unrolled round face; the Snap menu | Constraints and their solver: see *Sketch constraints* below |
| Extrude / Revolve / Loft / Sweep | `extrude {length, twist, scale, direction}`, `revolve {degrees}`, `loft {profile2, twist}`, `sweep {path}` | Loft is "extrude with a different end": scale, twist, or a second profile of any point count |
| Mate connectors | Connectors on every object: faces, centre, corners, edge midpoints, round sides, feature start/end, bbox faces | Named, so the AI can say `a: 'top', b: 'bottom'`. Errors list the valid names |
| Fastened mate | `mate {to, a, b, offset, slide:[u,v], angle, flip}` | Face-to-face mates flip automatically. With no mate, a new object stacks on the ground's top face |
| Boolean (union / subtract / intersect) | `into` + `mode` on the tool | Tools stay live, editable objects (`separate` undoes the boolean) |
| Fillet / Chamfer | `edge {near, style: fillet \| chamfer, size}` on one part | Add or remove is decided automatically by convexity, and round edges are treated all the way round. On the seam between two parts it merges them first (one piece) |
| Weld (Onshape: a weldment feature) | `weld {a, b, near, size, profile, all_around}` | A separate bead body between two parts that **stay separate** (an assembly you can pull apart). It warns when the materials can't be welded (aluminium to steel, plastic to metal…) |
| Linear / circular pattern, mirror | `pattern {of, kind, count, spacing, direction, about, plane}` | Live copies of features or parts; a hole's countersink comes along; copies count as quantity in the parts list |
| Part properties, mass properties | `meta {material, density, fill, part_no, supplier, notes, quantity}` | Mass, centre of gravity and inertia per part and for the assembly, a "does it stand" balance check, and a parts list (CSV) |
| Rollback bar, suppress, reorder | `rollback`, `suppress`, `move` ops; drag rows in History view; ⋯ / right-click menus | New features go in at the bar; order rules are checked (a hole stays after what it cuts) |
| Mate types (revolute, slider, cylindrical, planar) and animate | `joint` / `drive` ops, the Motion drawer (J) | Gear mates follow continuously; poses are previews until you keep one |
| Hole feature, shell | `hole` (ISO tables, click a face, auto edge dimensions), `shell` | Through holes stay through when the part changes. Shell works on any closed part: an inward offset of every face (see below) |
| Sketch arcs | `arcs: [{i, c, ccw}]` on a profile: segment i is an arc around centre c | Arcs are entities, not segments. The solver treats each centre as two unknowns held equidistant from both ends, so an arc adds one freedom: its radius. Profiles are cut into 6° chords only when the solid is built, and all chords of an arc share one surface id, so the arc is one smooth face |
| Sketch on a plane / any face, mate connectors | Every flat face of a shape's own geometry is a face connector (`face:<surface>`, besides the named ones). A sketch on a face opens a view square to it. Reference `plane` objects come from a face, a gap and a tilt | Faces that a named connector covers are skipped, and so are curved surfaces. Connector u axes are local X projected onto the face, so they stay put when sizes change |
| Extrude end conditions, draft, thin, rib | `end: blind / symmetric / through`, `draft`, `thin`, `open` | Through all is a fixed 4 m reach, so a cut stays through when the part grows. Draft offsets the end profile with mitred corners, refusing angles that close it. Thin subtracts the inward offset. Open thickens a polyline centred on its line |
| Splines (sketch) | `splines: [{i, pts}]` on any profile (extrude, loft, revolve, wrap): segment i runs from point i through the fit points to point i+1 | Centripetal Catmull–Rom, so there are no cusps or overshoot on uneven spacing. The end tangents lean on the neighbouring segments, so a spline blends into lines and arcs. It is chorded only when the solid is built, under one smooth surface id (`spl<i>`), so it shades and selects as one face |
| Threads (Onshape: cosmetic threads; here modelled) | `bolt`, `nut` types; `thread` op; cylinder `thread` / `bore`; `hole {kind: tapped, modelled: true}` | Built in one pass as a *radial solid*: star-shaped cross-sections stacked along z (the ISO 60° profile sampled at 16 stations per pitch, with a helical phase per angle). There are no booleans, so a thread costs about the same as a cylinder of the same facet count. Internal and external threads use the same table with 0.1 mm radial clearance, so they mesh without overlap |
| Wrap (Onshape: wrap / sketch on a curved face) | `wrap {target, at + normal | angle + height, profile | shape | text, depth, mode}` | The flat sketch is extruded to the depth, cut into strips by x planes every 2° of arc, and each vertex is mapped (s, t, d) → (angle s/R, height t, radius R ± d). The cylinder is fitted from the facet normals (an axis from their covariance null vector, then a least-squares circle), so any round face works. On a cylinder part, R is the expression `=id.diameter / 2`, so the wrap follows the size |
| Screw mate | `joint: 'screw'` with `pitch`; `drive {angle}`; Properties → Joint → Screw | Offset = base + pitch × angle / 360. The pitch is read from the part's thread (or the thread it is mated to) when not given, negative for left-hand. The thread phase is kept, so a nut stays meshed at every angle (the motion sweep checks it) |
| Helix / coil, split | `sweep` with `helix: {radius, pitch, turns, left}`, `helix` op; `split` op with `halfspace` tools | A split is a half-space block mated to the plane and subtracted, so it follows the plane. *Keep both* makes an in-place copy and cuts the other side |
| Sketch constraints | `constraints` on a polyline profile; `constrain` / `unconstrain` ops | Levenberg–Marquardt from the drawn shape (the smallest change that satisfies everything), degrees of freedom by Jacobian rank, conflicts named. Values are ordinary parameters (d1, d2…) so they link, take formulas and switch per configuration |
| Text (Onshape: sketch text + extrude) | `text {target, face \| at, text, height, depth, mode: emboss \| engrave, path: line \| arc \| arc-inside \| points}` | A single-stroke engraving font thickened to a stroke weight; characters placed rigidly along the path (each turned to its tangent). Emboss = boolean add, engrave = boolean remove. Anchored at its own origin, so editing the words never moves it |
| Interference check, collision detection | `model_check`, the Check button (I), Motion's *collisions* / *stop at contact* | Exact BSP intersection for moderate parts, a voxel estimate for big ones; motion frames use inset surface probes with grid-accelerated ray parity, so touching never counts as a hit |
| Configurations, versions | `config` op (variable tables + suppression), File → Save version / Versions | Switch sizes from the toolbar |
| Part instances (assembly reuse) | `instance` op: linked copies | The parts list counts them |
| Drawings | SVG/DXF sheet: third-angle views, hidden lines, dimensions, parts list, title block; an assembly gets an exploded isometric with balloons tied to the parts list | Generated from the live model in about 0.2 s. Balloons ring the view in the direction of their part and are spread so none overlap; item numbers are the parts list's own |
| Custom features (FeatureScript) | Add-ons: plain JS objects with shapes, mate kinds and actions | No imports; the same add-on serves the UI form and the AI tool (`model_addon`). See ADDONS.md |
| Topological naming | An edge is stored as **the two surface ids it lies between** (e.g. `plate:front | plate:right`) plus a point | It survives size changes. If the faces disappear it falls back to the nearest edge, then warns |
| Variables / expressions | `#name` model variables; any numeric parameter, and a mate's offset / angle / tilt / slide, can be `=formula` (`=plate.depth - 2*#wall`) | Editing a size offers to make same-size, same-direction sizes follow it (leader/follower), so links happen as a by-product of normal editing |
| Driving dimensions (sketch / mate dims) | Measured dimensions between connectors: off-edge (square to a face), horizontal, vertical, aligned. A value makes them driving, held after every change | The mover is chosen from the mate graph (the part that hangs off the other), so no solver setup is needed |
| Dimensions in the views | The 4 views always show each object's own dimensions. Click one to edit it. Measure adds driven dimensions between connectors. | Dimensions are carried automatically, not placed by hand |
| FeatureScript / API | `model.apply(ops)`. The UI and the MCP bridge call the same function | Batches are atomic and roll back on error. Positions can be origin-relative |
| Versions & branches | Undo/redo, `.sf3d.json` files, git | — |

### Fast booleans: culled, lazy classification trees

csg.js-style booleans build a BSP tree of each solid and clip one against the other. That is quadratic in the worst case, and threads are the worst case: 40k long, thin facets. Three changes made it about 400× faster on those parts:
1. **Splitter choice.** Seven candidate planes are scored on a 48-polygon sample: 4 × polygons split + |front − back|. A tree over a thread is then a few dozen levels deep, not thousands.
2. **Lazy trees.** A node sorts its polygons into front and back lists only when something is first clipped against it. Parts of a tree that no query reaches are never built, which is most of a bolt when only its tip touches a nut.
3. **Bounding-box culling.** Each tree keeps the box of its whole solid. A polygon that misses the box is classified at once (outside, or inside for an inverted tree) and never descends. When a nut meets a bolt, that is everything but the few turns they share.

A boolean is then the clip-list algebra itself (A clipped by B, plus B clipped by A, with the inversions for subtract and intersect), concatenated. There is no tree merge. Exact interference is therefore the default up to 150k polygons per pair, and the voxel estimate is only a fallback.

### Shell: an offset, not a scale

A scaled copy subtracted from the part gives uneven walls: a 100 × 20 box scaled to fit 2 mm walls on its long sides gets 0.4 mm walls on its short ones. It also breaks on anything non-convex, where the scaled copy pokes out through an inside corner. A shell has to move every face inward by the same distance along its own normal.

`K.offsetSolid` does that on the triangle mesh. Each face plane moves by its offset, and each vertex goes to where its faces' moved planes meet. Three planes give an exact point, so flat-faced parts get exact mitred walls. More than three (curved facets) are solved by least squares. The open face moves outward by a hair, so the cavity breaks through it. The inner solid is subtracted from the part.

The offset can fold over, and a fold is detected in two ways:
- **Inside one flat face:** a triangle fan across a seam between coplanar pieces can fold even though the face itself is fine. Such a face is rebuilt from its moved outline: loops chained, holes bridged, ear-clipped, and checked to be simple.
- **A real fold:** a section thinner than two walls, or a rounding tighter than the wall, moves vertices closer to the original surface than one wall. A distance check over a spatial grid finds them.

When there is a real fold, the model **replays the part's own feature history** without the steps that fold:
- **A rounding smaller than the wall** is left out of the cavity basis. That gives exactly the true erosion: a sharp inner corner.
- **A unioned boss or rib thinner than two walls** is left out too, so it stays solid, and a warning names it.
- **A cut cannot be left out** without thinning a wall, so a cut that folds is reported by name.

The walls themselves are always taken from the real part. Results are cached by shape. Typical times: 2–40 ms, about 250 ms for a 32-segment sphere.

### Merge or join: fillet vs weld

How a joint is made decides how it is modelled:

- **Fillet or chamfer: one part.** The corner is blended because the part is printed, cast or machined as one piece. Filleting where two parts meet first unions them (the tool says so), so they can no longer be pulled apart.
- **Weld: two parts.** The parts are made separately and joined. Each keeps its own definition, material and mass. The bead is its own body with its own mass, and **E** (pull apart) shows the components separately. Deleting the weld leaves both parts whole. A weld between parts that a boolean already merged is refused, and a weld across unweldable materials is flagged.

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
| `model_session` | undo / redo / new / demo / example (bundled models) / load / select / say / save_version / versions / restore_version |
| `model_mass` | Per part and assembly: mass, centre of gravity, inertia, balance; the parts list; the material library |
| `model_addon` | List add-ons, or run one of their actions (e.g. `gears/advise`, `gears/pair`) |
| `model_import` | An STL / OBJ file from disk as a mesh part |
| `model_check` | Interference (pairs, overlap volumes) and a motion sweep of a joint that reports the first contact |
| `model_query` | Geometry questions: faces with their connector names, normals, centres and areas; edges; distances and angles; section areas; bounding boxes |
| `model_reference` | The op reference: every op in one line, or one op / topic in full with a worked example. Works without the browser |
| `model_export` | STL (watertight), OBJ, `.sf3d.json`, parts list CSV, drawing sheet SVG / DXF |

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

Built so far, on top of the first version:
- patterns and mirror
- welds as assembly joints
- per-part metadata with mass and balance, and a parts list
- add-ons (gears)
- variables, formulas and leader/follower links
- driving dimensions
- suppress, rollback and reorder
- joints and motion
- section views
- the hole wizard and shell
- configurations and saved versions
- linked instances
- STL/OBJ import
- drawing sheets (SVG/DXF), with exploded isometrics and parts-list balloons for assemblies
- parametric sketch shapes
- the polyline sketch constraint solver
- interference checks and collision detection during motion
- shell on any shape (offset, with replay for features thinner than the walls)
- text: emboss / engrave, straight, on an arc or along a path
- splines in sketches; modelled threads (bolts, nuts, threaded cylinders and tubes, tapped holes) and a screw joint
- sketches and text wrapped onto round faces
- fast booleans (culled lazy trees); exact interference by default
- left-hand threads; a screw joint that reads its pitch from the thread
- formulas on mate offsets, angles, tilts and slides; re-mating keeps a part's joint
- spline fit points that move with their segment when dimensions change, and edit in Properties
- an op reference that covers every op, with examples checked by the tests

Still to come, roughly in order of how much each unlocks:

1. **More sketch relations**: point-on-curve, symmetric, midpoint, arc length; constraints on spline fit points (splines are free curves today, and h / v skip them).
2. **Loft guide curves**, and sweeps that twist or scale along their path. (Extrude draft and ribs are done.)
3. **Motion studies**: plots of position, speed and clearance over a sweep (first contact is reported today).
4. **Doubly-curved wraps** (spheres, tori, freeform) and projection of a sketch onto any surface. Cylinders and cones-as-cylinders are done. Outline fonts from a file.
5. **Constraints between parts' sketches** (a sketch point on another part's edge, projected geometry). Mate formulas and driving dimensions cover placement today.
6. **More on drawings**: section views on the sheet, GD&T and notes.
7. **STEP / exact geometry.** This needs a B-rep kernel. The `Solid` interface is small on purpose, so Manifold or OpenCascade.js could be swapped in; either would also be faster on very large booleans, though the culled trees close most of that gap for parts under about 50k polygons.
8. **Multi-user editing and branches**, as Onshape has them. Versions exist but are linear.
9. **More add-ons**: bearings and shafts, sheet metal, extrusion profiles, pipe and tube.

## Testing

```bash
node model/test/kernel.test.mjs   # volumes against closed forms: primitives, booleans, extrude/loft/revolve/sweep, edge pieces
node model/test/model.test.mjs    # stacking, mates, booleans, edges, patterns, welds, mass, sketch solver, general shell, text, exploded drawings, splines (and how they follow dimensions), threads (left- and right-hand), wrap, screw joint, mate formulas, path sweeps, the pump housing example, undo
node model/test/gears.test.mjs    # gears mesh (no overlap; a half-tooth error overlaps), helical/herringbone/ring, trains, planetary, advisor
node model/test/addons.test.mjs   # the add-on contract and the fasteners example
node model/test/collide.test.mjs  # interference volumes, touching ≠ overlapping, meshed vs clashing gears, motion first contact
node model/test/reference.test.mjs # every op has a reference entry, and every worked example in mcp-reference.mjs runs
node build.mjs                    # single-file builds in dist/
```
