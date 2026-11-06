# Installing SketchFlow (beta)

SketchFlow is an MCP server. Your AI app (Claude Code, Claude Desktop, Cursor, VS Code, LM Studio, an Ollama client…) starts it in the background. The server opens SketchFlow in your browser: the sketch board at `http://localhost:7777`, the 3D workspace at `/3d/`. The AI then sees and builds in the same page you are editing.

**You need:** Node.js 20 or newer (`node -v`) and a current Chrome, Edge, Firefox or Safari (the 3D views use WebGL 2). It runs on macOS, Windows and Linux. It has no dependencies, so there is no `npm install` step. Your drawings and models stay on your computer.

The beta is published on npm as **`sketchflow-mcp`** under the `beta` tag. `npx -y sketchflow-mcp@beta` downloads it on first use and runs it.

---

## Claude Code

```bash
claude mcp add --scope user sketchflow -- npx -y sketchflow-mcp@beta
```

Then ask *"open the 3D model and build a 100 × 60 × 8 plate with four M5 holes"* or *"open the sketch board"*. Run `/mcp` inside Claude Code to see that it is connected.

## Claude Desktop

**One-click:** download `sketchflow-<version>.mcpb` from the GitHub release, and double-click it. You can also use Settings → Extensions → Advanced settings → Install Extension…. Its settings let you choose the export folder, the tool set, tablet drawing and short instructions.

**Or by config:** in Settings → Developer → Edit config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sketchflow": {
      "command": "npx",
      "args": ["-y", "sketchflow-mcp@beta"]
    }
  }
}
```

Restart Claude Desktop afterwards.

## Cursor, Windsurf and other `mcpServers` clients

Cursor uses `~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project. Most other clients take the same block:

```json
{
  "mcpServers": {
    "sketchflow": { "command": "npx", "args": ["-y", "sketchflow-mcp@beta"] }
  }
}
```

## VS Code (Copilot agent mode)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "sketchflow": { "type": "stdio", "command": "npx", "args": ["-y", "sketchflow-mcp@beta"] }
  }
}
```

## Local models: Ollama

Ollama runs the model, but it is not an MCP client itself. Use a client that speaks to both, such as [mcp-client-for-ollama](https://github.com/jonigl/mcp-client-for-ollama) (`ollmcp`, Python 3.11+).

1. Install Ollama and pull a model that can call tools. ollmcp's docs list gemma4, qwen3.5, llama3.2 and mistral. An 8B or larger model handles `model_build` batches; 1–3B models struggle with them.
   ```bash
   ollama pull qwen3.5
   ```
2. Give the model room. SketchFlow's tools and instructions need about 3.5k tokens with the settings below, and about 12k with everything. Start Ollama with a larger context, e.g. `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`, or set *Context Window (num_ctx)* in ollmcp with `/model-config`.
3. Save `sketchflow-servers.json`. `--tools=3d --brief` sends only the 3D tools and short instructions; the model reads `model_reference` when it needs an op:
   ```json
   {
     "mcpServers": {
       "sketchflow": { "command": "npx", "args": ["-y", "sketchflow-mcp@beta", "--tools=3d", "--brief"] }
     }
   }
   ```
4. Install the client and run it:
   ```bash
   pip install --upgrade ollmcp        # or: uv tool install --upgrade ollmcp
   ollmcp -j sketchflow-servers.json -m qwen3.5
   ```

`model_view` and `look` return pictures. A text-only model can't use them, but it can still read the model with `model_describe` and `model_query`. For the sketch board, use `--tools=2d` instead. Other Ollama-capable MCP clients (LM Studio, Open WebUI, Continue, goose, mcphost) take the same `npx -y sketchflow-mcp@beta` command in their own MCP settings.

## LM Studio

Open the Program tab, then Install → Edit `mcp.json`, and add the same `mcpServers` block as for Cursor. For small models, add `"--tools=3d", "--brief"` to `args`.

---

## Settings

Pass these as flags in `args`, or as environment variables in the client's `env` block:

| Flag | Environment | What it does |
|---|---|---|
| `--tools=3d` / `--tools=2d` | `SKETCHFLOW_TOOLS` | only the 3D model tools / only the sketch board tools (default `all`) |
| `--brief` | `SKETCHFLOW_BRIEF=1` | short server instructions, for small context windows |
| `--no-open` | `SKETCHFLOW_NO_OPEN=1` | never open a browser; open the URL from the server log yourself |
| `--lan` | `SKETCHFLOW_LAN=1` | also serve on your network, so a tablet or phone can draw (it asks for a pairing code) |
| `--port=7777` | `SKETCHFLOW_PORT` | first port to try (it moves to the next free one) |
| `--export-dir=PATH` | `SKETCHFLOW_EXPORT_DIR` | where exports go (default `~/Pictures/SketchFlow`, else `~/SketchFlow`) |
| | `SKETCHFLOW_ADDONS` | an extra folder of 3D add-ons (`*.js`, see `model/ADDONS.md`) |
| | `SKETCHFLOW_ROOMS` | where shared-editing rooms are kept (default `~/.sketchflow/rooms`) |

`npx -y sketchflow-mcp@beta --help` prints the same list.

## Without an AI

```bash
npx -y sketchflow-mcp@beta --serve
```

This hosts the app and opens it. The package also has `dist/sketchflow.html` and `dist/sketchflow-3d.html`, single files that work offline when double-clicked.

---

## Try a build before it is published (testers and contributors)

From a checkout of the repository:

```bash
npm test                 # the model, kernel, STEP, collaboration… test suites
npm run smoke            # starts the MCP server like a client would and checks it (no browser needed)
```

**Point your client at the checkout:** this runs your working copy directly.

```bash
claude mcp add sketchflow-dev -- node /absolute/path/to/sketchflow/server.mjs
```

**Install it as a package, exactly as users will get it:**

```bash
npm pack                                          # → sketchflow-mcp-<version>.tgz
npm install -g ./sketchflow-mcp-<version>.tgz
sketchflow-mcp --version
npm run smoke -- --bin sketchflow-mcp             # the smoke test against the installed copy
```

Then use `"command": "sketchflow-mcp"` with no `args` (or `args: ["--tools=3d", "--brief"]`) in any client above. Remove it with `npm uninstall -g sketchflow-mcp`.

**The Claude Desktop bundle:** `npm run bundle` writes `release/sketchflow-<version>.mcpb`. Double-click it to install it in Claude Desktop.

## Troubleshooting

- **Nothing opens in the browser** (WSL, SSH, a headless box): the server logs `board at http://localhost:7777` on stderr. Open that URL yourself, or set `--no-open` and open it.
- **A tool waits and then times out:** the page has to be open. Keep the SketchFlow tab open. If several tabs are open, only the one showing *AI linked* answers. Close the extra tabs, or press *Use this tab* when the board offers it.
- **Windows: the client can't start `npx`:** use `"command": "cmd", "args": ["/c", "npx", "-y", "sketchflow-mcp@beta"]`.
- **Port 7777 is taken:** it moves to the next free port and logs it. Set `--port=` to choose.
- **An old version keeps running:** `npx` caches packages. Use `sketchflow-mcp@beta` (or an exact version such as `sketchflow-mcp@2.0.0-beta.1`) and restart the client.

## Privacy and safety

The server listens on `localhost` only, unless you turn on `--lan`, which asks for a pairing code. It refuses requests that name another host, and each page carries a fresh secret for the bridge. The background cut-out tool on the sketch board loads its model from a CDN the first time you use it. Nothing else leaves your computer. Exports and imports use the paths you or the AI give, and exports default to your export folder.

Report bugs and ideas on the GitHub repository's Issues page. Include your client, OS, `sketchflow-mcp --version`, and what you asked the AI.
