# SketchFlow

A vector sketch board for fast idea capture. You draw with a mouse, stylus or finger, and an AI connected over MCP can see your board and draw on it too.

Everything you draw stays editable: lines, shapes and text are vectors. Endpoints and corners **snap together and join**, and joined points move together when you drag them. On top of that you get drawing spaces (isometric, 1/2/3-point perspective, 3-view and 4-view), parametric dimensions, layers, collage and tracing, background cut-out, and a first linkage/motion simulator.

**v2 adds a parametric 3D model workspace** at `/3d/`. You build solids from primitives, sketch-and-extrude, loft, revolve and sweep, then combine them with mates and booleans. Fillets and chamfers decide for themselves whether to add or remove material. The model is shown in four linked views (TOP · 3D · FRONT · RIGHT) that carry each object's dimensions, and you can edit those dimensions in place. The AI builds with the same operations through six `model_*` MCP tools. See [model/ARCHITECTURE.md](model/ARCHITECTURE.md). The 2D board is unchanged: it is frozen as **v1** (git tag `v1.5.0`, branch `v1`).

```
sketchflow/
├── index.html        2D board UI + styles (v1)
├── js/               core · render · tools · input · ui · io · motion · bridge
├── model/            3D workspace (v2): index.html, js/kernel · model · views · app, tests, ARCHITECTURE.md
├── server.mjs        MCP server + local web server (Node 18+, zero dependencies): / = board, /3d/ = model
├── build.mjs         makes single-file versions in dist/
└── dist/             sketchflow.html · sketchflow-3d.html — double-click to use offline (no AI link)
```

## 1 · Run it with Claude (MCP)

You need **Node 18 or newer**. There is no `npm install`; the server has zero dependencies.

**Claude Code**

```bash
claude mcp add sketchflow -- node /absolute/path/to/sketchflow/server.mjs
```

Then ask: *"open the sketch board"*. Claude calls `open_board`, which opens **http://localhost:7777** in your browser.

**Claude Desktop** (Settings → Developer → Edit config):

```json
{
  "mcpServers": {
    "sketchflow": {
      "command": "node",
      "args": ["/absolute/path/to/sketchflow/server.mjs"]
    }
  }
}
```

**Draw on a tablet or phone while Claude runs on your computer:**

```json
"env": { "SKETCHFLOW_LAN": "1" }
```

With this set, `open_board` returns a `http://<your-ip>:7777/?k=<code>` link. Open it on the tablet. The pairing code stops other devices on your network from connecting.

Other settings: `SKETCHFLOW_PORT` (default 7777), `SKETCHFLOW_NO_OPEN=1` (don't open a browser), `SKETCHFLOW_EXPORT_DIR` (default `~/Pictures/SketchFlow`).

### The loop

| You | Claude |
|---|---|
| Sketch, then press **Send** (Ctrl+Enter) with an optional note | `wait_for_sketch` / `look` gets the image + layers + note |
| "Clean this up as a 3-view" | `drawing_space v4` + `draw` (joined vector lines, dimensions, text) |
| "Make this crank move the arm up and down" | `draw` links → `mechanism` pins + motor → `simulate` (joint paths, lock check) → `play` |
| "Fill the left panel, keep it attached" | `draw` with `{type:"fill", x, y}`: a shape fill that follows its outline |
| "Colour-code everything" | `edit_items color_by_type` |
| "Set that to 120 mm" | `edit_items set_dimension`: the geometry stretches and joined lines follow |
| "Put this photo in and trace it" | `place_image` with `as_reference` (or `remove_background`) |
| "Save it" | `export` → PNG, transparent PNG, SVG, ORA, layers ZIP, board file |

**MCP tools:**
- `open_board`
- `look`
- `wait_for_sketch`
- `draw`
- `edit_items`
- `layers`
- `drawing_space`
- `board`
- `place_image`
- `export`
- `mechanism`
- `say`

### 3D models with Claude

Ask: *"open the 3D model and make a flange: Ø80 × 8 disc, Ø36 neck 30 tall, Ø20 bore, four Ø7 holes on a 58 mm circle, 1 mm chamfer on the rim"*. Claude opens **http://localhost:7777/3d/** and builds it in one undoable step. You watch it appear in all four views. Then change any dimension yourself, and everything mated to it follows.

| Tool | What it does |
|---|---|
| `open_model` | open the 3D workspace and read the model |
| `model_build` | add / set / mate / boolean / edge / extrude / loft / revolve / sweep / delete / origin / ground / fix / cleanup / dim, as one atomic batch; `look:true` returns a picture |
| `model_describe` | parameters, positions from the origin, mates, connector names (with positions and normals on request), volumes, warnings |
| `model_view` | a picture of the four views or one view, from any direction |
| `model_session` | undo, redo, new, demo, example (the bundled pump housing), load a `.sf3d.json`, select, say |
| `model_mass` | mass, centre of gravity and inertia per part and for the assembly, whether it stands, and the parts list |
| `model_addon` | list add-ons, or run one: e.g. `gears/advise` (module, teeth and form for a ratio and a process) or `gears/pair` |
| `model_import` | an STL / OBJ file from disk as a mesh part |
| `model_check` | interference (which parts overlap, by how much, exact for moderate parts) and a motion sweep that reports the first contact of a joint |
| `model_query` | geometry questions: every face of a part with the connector name to target it by, its normal, centre and area; edges; distances and angles between faces; section areas; bounding boxes |
| `model_reference` | the op reference: every op in one line, or one op / topic in full with a worked example (works without the browser) |
| `model_export` | STL (watertight, for printing), OBJ, `.sf3d.json`, parts list CSV, drawing sheet SVG / DXF (an assembly gets an exploded isometric with balloons numbered as the parts list) |

**The pump housing example** ([examples/](examples/README.md)). Claude built it in one session using nothing but MCP calls. Load it from File → *Example: Pump housing*, or with `model_session {action:"example", id:"pump-housing"}`. It shows:
- a fully constrained flange sketch, with arcs, tangents, equal radii and driving dimensions (0 degrees of freedom);
- spline-profile gussets in a circular pattern, and a counterbored M6 hole pattern;
- a wedge pad with a modelled M5 tapped hole. Claude placed the hole after asking `model_query` for the pad's sloped face;
- text engraved flat (PUMP-01) and wrapped round the housing (SKETCHFLOW);
- a threaded neck with a knurled screw cap on a **screw joint**, with "TURN TO OPEN" embossed on an arc;
- four stainless M6 socket screws.

The checks Claude ran: no interference; a motion sweep of two turns of the cap with no contact; section areas; a measured 80 mm from the flange underside to the cap top; mass 600.6 g; drawing and parts-list exports.

**In the browser:**
- Add a shape with the toolbar: Box, Wedge, Cylinder, Cone, Sphere, Strip (a fillet strip). If a part is selected, the new shape lands on top of it, and Properties → **Combine** joins it, cuts it or keeps the overlap.
- **Putting features on a part:** select the part, then use **Add to *part*** at the top of Properties. Each one asks you to click the face (or edge) it goes on:
  - Boss: a cylinder or box joined onto a face
  - Cut: a round or square pocket
  - Hole, Text
  - Sketch on face
  - Fillet, Chamfer
  - Shell, Pattern

  The Features group in the toolbar has the same tools. Bosses, cuts, holes, text and face sketches are mated to their face, so they follow it when the part changes.
- **Sketch**: draw in FRONT, TOP or RIGHT with the sketch bar.
  - **Lines:** Line, Arc, Tangent arc and **Spline**, mixed freely.
    - An arc is its end point, then a point it passes through.
    - A tangent arc carries on smoothly from the last segment and stays tangent.
    - Arcs are real sketch arcs, not short segments: give them an **R dimension**, make two **tangent** or **concentric**, set radii **equal**, or turn any segment into an arc (⌒ in Properties → Sketch).
    - A spline is a smooth curve through the points you click. It leaves the last segment tangent and blends into the next one. Switch back to Line or Arc, or close the shape, to end it. Its fit points are editable in Properties → Sketch, and one spline is one smooth face on the solid.
  - **Shapes:** Rectangle, Circle, Slot, Polygon.
  - **Snap ▾:** grid on or off, with a step of 0.5–25 mm; points, corners and centres; edge midpoints; horizontal / vertical only; 15° angles. A green marker shows what you snapped to, with the length so far.
  - **Undo point**, **Close shape**, **Cancel**.

  Then choose Extrude, Revolve or Loft (Loft asks for the end profile).
  - Extrude options: **symmetric** (half each way), **through all** (for cuts, and it stays through as the part grows), **draft** (taper °), and **thin** (a wall of that thickness).
  - **Finish open** leaves the outline open: a **rib** or thin plate of a thickness you choose.
- **Sketch on a face** (*On face* in the toolbar, or *On a face…* in the sketch bar): click **any** flat face, inclined ones included, and a view square to it opens with the grid on the face. Then choose *Extrude · join*, *Cut into*, *Cut through* or *New part*. The result is mated to that face.
- Every flat face of a shape can be a target: a wedge's slope, an extrude's side faces, the flat ring of a revolve. That covers holes, text, bosses, cuts, sketches and mates.
- **Sketching on a curved face:** click the round side of a cylinder, a tube, a revolve or any extruded circle. The face opens **unrolled**: across is the distance round it, up is along it. Draw lines, arcs, splines, shapes or text as on a flat face. When you finish, it is **wrapped** round the face and either **embossed** (joined, standing out by the depth) or **engraved** (cut in). The face doesn't have to be a cylinder primitive: its axis and radius are fitted from the facets. On a cylinder part, the wrap follows the diameter when it changes.
- **Threads are real geometry:** an ISO 60° profile with a chamfered lead-in, so they print, mesh and show in sections.
  - **More ▾ → Bolt (threaded)…:** M2–M24, length, hex or socket head, thread length. Mate its *seat* to the face it goes into.
  - **More ▾ → Nut (threaded)…:** hex, round or knurled. It can be custom (any diameter and pitch), e.g. a screw cap for a bottle neck.
  - **Thread a cylinder or tube:** Properties → Thread, an ISO size or a custom pitch, over all or part of its length, from the top or bottom. *Bore* makes it a tube.
  - **Tapped holes:** the hole wizard's *thread* choice is *drill only* (just the tap-drill hole) or *modelled* (the thread is cut).
  - A nut on its bolt, or a cap on its neck, meshes with 0.1 mm clearance and doesn't count as interference.
- **More ▾** (in the Add bar):
  - **Spring / coil**: wire Ø, coil radius, pitch, turns, hand.
  - **Plane on a face**: a reference plane on a face, with a gap and a tilt. Sketch on it, mate to it, or split with it.
  - Fillet strip, and the add-ons (gears).
- **Split** (Features): cut a part with a plane, keeping the side below, above, or both as two parts.
- Mates take a **tilt** too, so parts and planes can sit at an angle to a face.
- **Sketch constraints**: a drawn polyline gets horizontal / vertical relations and its first point fixed automatically, so a sloppy sketch comes out square. In Properties → Sketch, give any segment a driving dimension, or relate two segments (parallel, perpendicular, equal, angle). The status line says how many degrees of freedom are left and names any conflicting constraint.
- *Mate* (M): click the part, then its connector, then the target connector.
- *Union / Subtract / Intersect*: click the target, then the tool.
- *Fillet / Chamfer*: set the size and click near an edge. Outer edges are trimmed and inner corners are filled; round edges get the treatment all the way round. On the seam between two parts, a fillet merges them into one piece.
- *Weld*: click where two separate parts meet. The bead joins them and they stay separate parts (**E** pulls the assembly apart to show it). Mixing materials that can't be welded gets a warning.
- *Pattern* (**P**, or Properties → Pattern…): a row, grid, circle or mirror of the selected part or feature. Copies follow the original.
- *Material & mass* in Properties: pick a material, or set density, fill %, part no., supplier and notes. With nothing selected you see the total mass, the centre of gravity (the toolbar button marks it in the views), whether the model stands, and a parts list button.
- *Add-ons* menu: gears (single, pair, train, planetary, and an advisor that picks the right gear for the job and the process). Drop your own into `model/addons/`: see [model/ADDONS.md](model/ADDONS.md).
- Click any orange dimension in the 2D views to change it. If another part had the same size running the same way, you're offered **Make it follow**: from then on it keeps step with the leader (shown teal, as =90).
- Any size can be a formula: type `=plate.depth`, `=plate.depth - 10` or `=#wall * 2` in Properties (the link button beside each size picks a leader from a list). Model variables (#wall…) are in Properties with nothing selected.
- *Measure* (**G**): click two dots in a 2D view. A hole centre then a face dot (the middle of an edge in that view) gives the off-edge distance, measured square to the edge; two points offer horizontal / vertical / aligned. Type a value to make it **driving**: the hole moves and stays at that distance from the edge when the part changes size.
- The feature list shows **By part** (each part with its holes, edges, welds and arrays) or **History** (the order you made things). In History, drag rows to reorder and drag the blue **rollback bar** to see the model as it was (new features go in at the bar). The ⋯ / right-click menu: suppress, duplicate (Ctrl D), linked instance, pattern, move, delete.
- *Profile* sketches: Polyline, **Rectangle** (rounded corners), **Circle**, **Slot**, **Polygon** (two clicks). Then Extrude, **Cut through** the part underneath, or Revolve. The shape's sizes stay editable dimensions.
- *Hole*: pick a size (M2–M16) and type (simple, counterbore, countersink, tapped, heat-set insert) and fit (close / normal / loose / print), then click faces. Each hole is dimensioned from its nearest edges; click a dimension to move it.
- *Shell…* (Properties) hollows **any** part to an even wall thickness, open on one of its faces or closed. This includes booleans, filleted parts and imported meshes. Every face moves inward by the wall (an offset, not a scale), so walls stay even on any shape, with mitred corners. A rounding smaller than the wall gets a sharp inner corner. A boss or rib thinner than two walls stays solid, and a note names it. A cut that would leave a section thinner than two walls is refused, by name.
- **Text** (T): type the words, the height and depth, then pick emboss (a boolean add standing on the face) or engrave (a boolean remove cut into it), and a path: straight, round an arc (reading over the top), or the inside of an arc (reading along the bottom, as on a badge). Click a flat face to place it. The words, sizes, radius, angle, alignment, or a polyline path are all editable later. The built-in font is a single-stroke engraving font, the kind CNC engravers and laser markers use. It covers capitals, digits and the usual symbols, including Ø ± ° ×; lower case prints as capitals.
- **Interference check** (I): one click lists every pair of parts that overlap, with the overlap volume, and shows the overlap in red. Parts that only touch, and welds on the parts they join, don't count.
- **Motion** (J): make a mated part a joint (Properties → Joint: revolute, slider, cylindrical, planar or **screw**, with limits), then drag its slider or press play. A screw joint turns and advances by its pitch per turn, so a nut or cap runs along its thread in step (keeping the thread phase). Meshed gears turn with it. *Keep this pose* makes it the model's position. **Collisions** are checked as it moves: parts that hit turn red, and *stop at contact* halts play at the first touch.
- **Section** (X): cut the model along X, Y or Z with a slider; the cut shows hatched.
- **Configurations**: add variables, use them in sizes (=#len), then *Add configuration* for each size; switch from the toolbar. Configurations can also switch features off.
- File → *Save version…* / *Versions…*; *Import STL / OBJ…*; *Preview drawing* / *Export drawing (SVG, DXF)*: an A4/A3/A2 sheet with TOP / FRONT / RIGHT + isometric, hidden lines, dimensions, parts list and title block. With two or more parts the isometric becomes an **exploded isometric with numbered balloons** tied to the parts list (repeated parts are one item, with their quantity). *Exploded* in the preview bar turns it off.
- **View ▾** holds:
  - layouts: all four views, or one view;
  - fit, zoom in and out;
  - hidden lines, dimensions, pulled apart, centre of gravity;
  - whether dragging in 3D orbits or pans;
  - the theme.

  The view cube: click a face, edge or corner. **Check** has Clashes (interference), Section and Motion.
- Everything has a button or menu item; keys are only shortcuts:
  - 0–4 layouts, F fit, H hidden lines, D dimensions, E pull apart
  - S sketch, M mate, G measure, T text, P pattern
  - J motion, X section, I clashes
  - Ctrl D duplicate (also in Properties), Delete (also in Properties)

## 2 · Or just draw

Open `dist/sketchflow.html` (works offline). Or run `node server.mjs --serve` and open http://localhost:7777. Without the AI link, **Send** copies your sketch to the clipboard so you can paste it into any chat.

## How it flows

- **Pen:** hold still at the end of a stroke and it snaps to a clean line, arc, circle, ellipse, triangle, rectangle or polygon. Keep dragging to adjust it. Tap the Pen button again to cycle Pen → Pencil → Marker → Brush (pressure-sensitive with a stylus).
- **Snap & join (M):** starts and ends lock onto existing joints (ring = join) or onto a line (✕ = T-junction).
- **3D primitives (Shapes → 3D):** box, cylinder, cone, sphere, pyramid, prism.
  - Built from real 3D geometry. Visible faces are separate closed faces, so Fill shading and *text on a surface* work on them. Hidden edges are dashed (toggle *Hidden edges*), and round shapes get centre lines.
  - Drag to size; Shift gives equal sides. Clicking any part selects the whole primitive (Alt-click picks one part).
  - In **3-view / 4-view**, drag inside the FRONT view and the top and side views draw themselves, aligned. 4-view also adds the object to a shared 3D scene in the top-right quadrant.
- **Placing 3D primitives (two steps):**
  1. **Base.** Start on a snapped point.
     - *From a corner* (joint, grid or any point): drag to the opposite corner, and the base stretches to fit exactly between them on the isometric ground plane. Snap both to a box's top-face corners and the base matches that face.
     - *From a centre* (start on a ⊕): the base grows equally in every direction. Round shapes take the radius from your drag.
     - *Base from: Auto / Corner / Centre* in the strip. Alt forces centre and Shift makes the base square.
  2. **Height.** Move up and click (it snaps to other objects' points and levels so heights can match), or just type a number and press Enter. Esc cancels.
  - A **height dimension** is added that *drives* the primitive: tap its number, type a new height, and the primitive rebuilds from its stored sizes. Connected lines, shape fills and surface text stay attached. Toggle *Height dim* off if you don't want it.
  - Moving or scaling a primitive keeps its sizes. Rotating or mirroring it, or drawing it in 3-view, turns it into plain lines.
  - 2D shapes started on a centre ⊕ also grow equally both ways.
- **Snaps & connectors:**
  - Ends snap to joints, **▲ midpoints** of lines and **⊕ centres** of shapes (circles, faces, polygons, arcs).
  - A line that lands on a midpoint or centre stays **connected**: move the shape and the line follows. Drop a dragged end somewhere else to disconnect.
  - **⊥ Perp** lands a line perpendicular on another line, or squares off a line you start on a line.
  - Toggle each in the Pen, Shapes and Joints strips.
- **Line types:** Solid, Dashed (hidden edges), Centre (dash-dot), and **Construction**. Construction lines are guides: they snap and show on screen, but never print or export (unless you tick *Include construction lines*) and never block fills. Dashed and Centre lines don't block fills either. Change a selection's line type from the Select strip.
- **Joints (J):**
  - drag a dot to bend; everything joined there follows
  - drop it on another dot to join them
  - drag along a line to add a bend
  - double-tap a dot to remove it
  - hold Alt to detach
- **Select (V):** tap or box-select, drag, scale from a corner, rotate with the top dot. Lines joined to the selection stretch to stay attached. With items selected, tapping a colour recolours them.
- **Drawing spaces (P):**
  - Free
  - Flat grid
  - Isometric
  - 1-, 2- or 3-point perspective (drag the coloured vanishing-point pips)
  - 3-view (Top / Front / Right side with alignment guides)
  - 4-view (3-view + an isometric quadrant)

  Strokes you draw roughly along a guide direction lock to it.
- **Dimensions (D):** drag between joints. Tap the number and type a value, and the geometry moves to match. Horizontal and vertical dimensions stretch the whole edge. Set units and scale in the strip (px, mm, cm, m, in, ft). In a drawing space, extension lines **follow the planes**: isometric axes, or the vanishing point in perspective. The number lies in that plane. Drag the number to switch planes, or set *Ext lines → Square* for classic perpendicular dimensions.
- **Text (T):** six fonts, bold/italic, size and colour, in three modes:
  - *Free*: text goes where you tap.
  - *Along a line*: tap a stroke to write along it. Drag it with Select to slide it along or lift it off; *Detach* / *Attach to line* switch between modes.
  - *On a surface*: tap inside any 4-sided face (an isometric box side, a perspective plane, a rectangle) and the text is mapped flat onto that plane. It auto-fits the face and stays attached when you drag the face's corners. Drag it with Select to slide it across the face. *Turn on face* rotates it 90°; *Take off surface* makes it free text. You can also select a text and a 4-sided shape and press *Put on surface*.
  - Isometric and flat faces keep the text as crisp vectors (also in SVG). Perspective faces warp it through a fine mesh (embedded as an image in SVG).
- **Fill (F):**
  - *Tap* fills any enclosed region, even one formed by several lines.
  - *Press and hold* (watch the ring) makes a **shape fill**. It's a vector tied to the surrounding outline's corners, curve points and line crossings, so it reshapes when you drag, bend or move those lines. Holes inside stay empty.
  - Tap an existing fill or line to recolour it.
  - Dimensions and text don't block fills: a fill flows straight through them.
  - Moving a shape fill on its own lets go of the outline.
- **Eraser (E):**
  - *Cut lines* splits vectors exactly where you erase
  - *Whole items* removes anything you touch
  - *Photo pixels* erases inside images
- **Import (drop, paste or button):**
  - *As is*
  - *Remove background* (instant and offline; tap to remove more)
  - *AI cut-out* (online, loads `@imgly/background-removal`, AGPL-licensed, ~40 MB the first time)
  - *Trace over it*: a faded reference layer plus an ink layer, with the lightbox on
- **Layers:** a tree of layer → type group → item.
  - Every item you draw gets its own row automatically, grouped as Lines, Strokes, Rectangles, Circles, Triangles, Polygons, Fills, Text, Dimensions and Images.
  - Each row shows a thumbnail of the shape, its size or font, a colour swatch, hide, lock and delete. Double-click a name to rename it.
  - Clicking a row selects that item and highlights it on the canvas; hovering a row highlights it too. Clicking a group header selects the whole group.
  - Recolour from the swatches at any level (one item, a whole group, or the whole layer) using a pop-up of the current palette, recent colours or a custom colour.
  - **Colour by type** gives each type its own colour from the selected palette, chosen to be as different as possible from each other and readable on the paper. **Auto** keeps new items colour-coded as you draw. **Palette** switches presets.
  - Layer-level options: visibility, lock, *reference* (shown on screen, left out of exports), opacity, 8 blend modes, duplicate, merge, reorder.
  - **Background** is a pinned layer that always sits under everything and fills the canvas. It has a colour swatch, paper presets, and an eye that makes the canvas transparent while remembering the colour. It exports as its own layer in SVG, ORA and the layers ZIP.
  - **Lightbox (L)** fades the layers below the one you're on.
- **Motion (X):**
  - every item is a rigid link; joints shared by two items are pins
  - *Pin* fixes joints to the ground
  - *Motor* drives a link around its pivot
  - *Trace* records a joint's path
  - press ▶; *Keep path* saves the traced curve as a dashed line
  - the board warns you if the mechanism locks up
- **Recall:** every board autosaves in this browser (IndexedDB) and stays in **Hub → Recall**. A new board never replaces the old one. Settings, palette, brush sizes and theme are remembered too.
- **Undo everything:**
  - Ctrl+Z / Ctrl+Shift+Z, 2-finger tap / 3-finger tap
  - or drag the **history scrubber** at the top

### Menus that stay out of the way

| Where | What |
|---|---|
| Left rail | Tools. Warm colours draw, cool colours edit. |
| Slim vertical sliders | Size and opacity of the current tool (or of the selection). |
| Strip beside the rail | Only the current tool's options. |
| Bottom | Palette (11 presets; tap the name to switch), recent colours, custom colour. Presets: Ink, Bright, Pastel, Earth, Neon, Skin, Blueprint, Marker greys, BlackOps, Cyberpunk, Chill. |
| Right-click / pen button / long-press / **Q** | Radial wheel at your pointer. |
| **Tab** | Focus mode: only the canvas and undo. |
| Hub (⊞) | Big tiles for Make, Spaces, Export, Recall, Feel and Help. |

### Keys

| Key | Action |
|---|---|
| B | Pen |
| S | Shapes |
| T | Text |
| F | Fill |
| E | Eraser |
| V | Select |
| J | Joints |
| D | Dimension |
| I / Alt | Pick colour |
| H / Space | Pan |
| [ ] | Size |
| Shift + [ ] | Opacity |
| P | Next drawing space |
| M | Snap on/off |
| L | Lightbox |
| G | Grid |
| N | New layer |
| Shift+N | New board |
| X | Motion mode |
| Ctrl+C | Copy image (Ctrl+Shift+C copies the layer) |
| Ctrl+D | Duplicate |
| Ctrl+S | Save to Recall (Ctrl+Shift+S saves a PNG) |
| Ctrl+Enter | Send to AI |
| 0 | Fit to screen |
| Shift (while drawing) | Straight line / square shape / 15° steps |
| Alt (while drawing) | Draw shape from its centre |

## Export formats

| Format | What you get |
|---|---|
| PNG / Transparent PNG / JPG | Flattened picture, at 0.5×–3× scale |
| SVG | True vectors. Layers become Inkscape layers (`<g inkscape:groupmode="layer">`). Text stays text, including text on a path. |
| ORA (OpenRaster) | Layered file for Krita, GIMP and MyPaint, with opacity and blend modes kept |
| Layers ZIP | One PNG per layer + flat + transparent + SVG + `layers.json` |
| Items ZIP | Every item as its own cropped PNG, in folders by layer and type, + `items.json` with positions and colours |
| .sketchflow | The full editable board. Re-open it with Hub → Make → Open. |
| Clipboard / Share | Copy pastes into any app. Share uses your device's share sheet. |

## Privacy

Everything runs on your machine. The server listens on `127.0.0.1` only, unless you turn on LAN mode, which requires the pairing code. Board commands need a random per-run token. Boards are stored only in your browser. The only network request the app makes is the optional AI cut-out download.

## Roadmap

These build on the same joint model:
- an animation timeline (keyframes of joint positions, onion skin)
- smart connectors that stay attached to shapes
- slider and prismatic joints, gears and springs in the motion solver
- the 3D profile sketcher's geometric constraints (parallel, perpendicular, equal length) on the 2D board too
- sending a 2D board sketch to the 3D workspace as a profile, and projecting 3D views back onto the board
- 3D: see "What is not there yet" in [model/ARCHITECTURE.md](model/ARCHITECTURE.md): STEP exchange, sketching on doubly-curved faces (spheres, tori), constraints on spline fit points

## Tests

```bash
npm test                                                            # 3D kernel, model (incl. the pump housing example), gears, add-ons, collisions
node build.mjs                                                      # rebuild dist/
```
