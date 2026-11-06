# Changelog

## 2.0.0-beta.1 — first public beta

SketchFlow is now an installable MCP server: `npx -y sketchflow-mcp@beta` (npm), a one-click Claude Desktop bundle (`.mcpb`), and a listing in the MCP Registry. See [INSTALL.md](INSTALL.md).

**3D parametric workspace (`/3d/`, the `model_*` tools)**
- Solids from primitives, extrudes (profiles with arcs, splines and constraints, or rectangle / circle / slot / polygon shapes), revolves, multi-section lofts with guide curves, and sweeps with twist and scale.
- Mates on any connector, including faces, corners, edges and inclined faces. Booleans stay editable, and a cut can go through several parts. Holes cover ISO clearance, counterbore, countersink, tapped and heat-set sizes. Also fillets and chamfers, shells, patterns, text emboss and engrave, wraps onto curved faces, and modelled threads, bolts and nuts.
- Parametric throughout: formulas, variables, leader/follower links, driving dimensions and configurations.
- Shapes sketched on a face can follow other parts' corners, and your own sizes win.
- Sizes can extend to another part: heights up to it, and widths and depths sideways with one face held.
- History: suppress, roll back, reorder and duplicate. Saved versions, linked instances, joints with motion and limits, interference and motion collision checks.
- Exports: STEP AP214 (exact solid B-reps, vetted on every export), STL, OBJ, and drawing sheets in SVG/DXF (with welding symbols and exploded views with balloons). STEP, STL and OBJ import.
- Add-ons: gears (involute spur, helical and herringbone, meshing mates, trains, planetary sets) and welding and joining. The welding add-on reads the joint, advises a prep to ISO 9692 / 5817 with time and cost, and adds ISO 2553 symbols and a weld schedule.
- Mass, centre of gravity and balance, parts lists, materials, and live shared editing rooms.

**Sketch board (`/`, the board tools)**
- Vector drawing that snaps and joins, layers, isometric and 1/2/3-point perspective, 3- and 4-view spaces, parametric dimensions, collage and tracing, background cut-out, linkage simulation.

**MCP server**
- Zero dependencies, Node 20+, macOS, Windows and Linux.
- New in this release:
  - `--tools=3d|2d` and `--brief`, so local models with small context windows (Ollama) get a smaller tool set. The 3D set with brief instructions is about 3.5k tokens; everything together is about 12k.
  - `--help`, `--version` and `--port=`.
  - Settings that take `1` also take `true`.
- `npm run smoke` checks the MCP handshake, the tool sets, and that the app is served.
- The server is localhost-only by default, rejects requests for other host names, and needs a pairing code for LAN drawing.
