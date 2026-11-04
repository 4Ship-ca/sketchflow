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
| `model_session` | undo, redo, new, demo, load a `.sf3d.json`, select, say |
| `model_export` | STL (watertight, for printing), OBJ, `.sf3d.json` |

**In the browser:**
- Add a shape with the toolbar (B box, W wedge, C cylinder, K cone, O sphere).
- *Profile* (S): click points in FRONT, TOP or RIGHT, close the shape, then type a length, twist or end scale and choose Extrude, Revolve or Loft. Loft asks you to sketch the end profile.
- *Mate* (M): click the part, then its connector, then the target connector.
- *Union / Subtract / Intersect*: click the target, then the tool.
- *Fillet / Weld / Chamfer*: set the size and click near an edge. Outer edges are trimmed and inner corners are filled; round edges get the treatment all the way round.
- Click any orange dimension in the 2D views to change it.
- View cube: click a face, edge or corner. Double-click a view to maximise it. 0–4 switch layouts, F fits, H toggles hidden lines, D toggles dimensions, G measures between connectors.

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
- geometric constraints (parallel, perpendicular, equal length) alongside dimensions, shared with the 3D profile sketcher
- sending a 2D board sketch to the 3D workspace as a profile, and projecting 3D views back onto the board
- 3D: see "What is not there yet" in [model/ARCHITECTURE.md](model/ARCHITECTURE.md): variables, patterns, shell / holes, moving mates for the motion simulator, assemblies, configurations, STEP

## Tests

```bash
node model/test/kernel.test.mjs && node model/test/model.test.mjs   # 3D kernel + parametric model
node build.mjs                                                      # rebuild dist/
```
