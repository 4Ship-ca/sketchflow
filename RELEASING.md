# Releasing SketchFlow

How a beta gets from this repository to users:

- **npm** (`sketchflow-mcp`): what every client runs with `npx -y sketchflow-mcp@beta`.
- **GitHub release**: carries the Claude Desktop bundle (`.mcpb`) and the offline single-file apps.
- **MCP Registry**: the official directory that clients and community catalogues read; its record is `server.json`.

Once the one-time setup is done, a release is: bump the version, write the changelog, push a tag. `.github/workflows/release.yml` does the rest.

## One-time setup

### 1. Decide what becomes public

- **Commit author email:** every commit so far is authored as `SketchFlow <your4ship@gmail.com>`, and a public repository shows it. To use GitHub's private address instead, find yours under GitHub → Settings → Emails ("Keep my email addresses private" shows it as `ID+username@users.noreply.github.com`). Then, **before the first push**, run this from the repository with your address:

  ```bash
  NEW='ID+username@users.noreply.github.com'
  git config user.email "$NEW"
  git filter-branch --env-filter "export GIT_AUTHOR_EMAIL='$NEW' GIT_COMMITTER_EMAIL='$NEW'" --tag-name-filter cat -- --all
  git log --format='%an <%ae>' | sort -u      # check
  ```

  This rewrites the history (main, v1, v2 and the v1.5.0 tag). That is harmless before the first push, and messy after it.
- **npm account email:** npm lists each package's maintainers with their account email. Use an npm account whose email you're happy to show.
- **License:** `LICENSE` is MIT ("SketchFlow contributors"). Change it now if you want another.

### 2. GitHub repository

Create an empty public repository, e.g. `github.com/<you>/sketchflow`, with no README or license; this repository has them. Then:

```bash
npm run release:prep -- --owner <you> --author "Your Name"
#   package.json: repository, homepage, bugs, author, mcpName = io.github.<you>/sketchflow
#   server.json:  the MCP Registry record
git add -A && git commit -m "Release prep: repository and registry name"
git remote add origin https://github.com/<you>/sketchflow.git
git push -u origin main v1 v2 --tags
```

`main` is still the v1.5 sketch board, and `v2` (current work) is simply ahead of it. Bring `main` up to date before the push, so visitors land on the current version, and release from `main`:

```bash
git checkout main && git merge --ff-only v2 && git checkout v2
```

The `v1` branch and `v1.5.0` tag keep the old version.

CI (`.github/workflows/ci.yml`) then runs the test suites, the smoke test, and an install of the packed package on macOS, Windows and Linux with Node 20, 22 and 24.

### 3. npm

1. Create an account on npmjs.com with two-factor authentication.
2. Publish the first version **from your machine**. A token can only be scoped to a package once the package exists.
   ```bash
   npm login
   npm publish --tag beta --access public     # runs release-prep --check, the tests and the smoke test first
   ```
3. On npmjs.com → Access Tokens, create a **granular token** with read and write access to `sketchflow-mcp` only. Add it to the GitHub repository as the secret `NPM_TOKEN` (Settings → Secrets and variables → Actions). Later releases publish from CI with provenance.

### 4. MCP Registry

There is nothing to set up. The release workflow signs in with GitHub's OIDC: the `io.github.<you>/` namespace is proven by the workflow running in your repository. To publish by hand instead:

```bash
brew install mcp-publisher        # or the binary from github.com/modelcontextprotocol/registry/releases
mcp-publisher login github
mcp-publisher publish             # reads server.json; the npm version must already be published
```

## Every release

```bash
npm run release:prep -- --version 2.0.0-beta.2   # package.json + server.json
#   add a "## 2.0.0-beta.2" section at the top of CHANGELOG.md (it becomes the GitHub release notes)
npm test && npm run smoke
git commit -am "2.0.0-beta.2" && git tag v2.0.0-beta.2 && git push && git push --tags
```

The tag starts `release.yml`, which:

1. checks that the tag matches `package.json` and that `release-prep --check` passes (mcpName, server.json, changelog);
2. runs the tests and the smoke test;
3. runs `npm publish --provenance`. A version with a `-` (beta) goes out under the `beta` tag, so `npx sketchflow-mcp` without `@beta` keeps the last stable version;
4. builds `release/sketchflow-<version>.mcpb` and creates the GitHub release (marked pre-release for betas) with it and `dist/sketchflow.html`, `dist/sketchflow-3d.html`;
5. publishes `server.json` to the MCP Registry.

**Leaving beta:** release `2.0.0` the same way. It goes to npm's `latest` tag, and the docs can then drop `@beta`.

## Checks you can run any time

| Command | What it checks |
|---|---|
| `npm test` | the kernel, model, gears, welding, add-ons, collisions, reference, STEP, shared editing and room suites |
| `npm run smoke` | starts the server like an MCP client: handshake, tool sets, `--brief`, a tool call, the pages and add-ons it serves, host check |
| `npm pack && npm i -g ./sketchflow-mcp-*.tgz && npm run smoke -- --bin sketchflow-mcp` | the package exactly as users install it |
| `npm run bundle` | builds the `.mcpb`. Double-click it to try it in Claude Desktop; `npx @anthropic-ai/mcpb validate release/manifest.json` checks it with the official tool |
| `node scripts/release-prep.mjs --check` | everything a release needs is in place |

## Where people find it

- **npm**: `npx -y sketchflow-mcp@beta`. Searching npm for "mcp cad" or "sketchflow" finds it by its keywords.
- **The MCP Registry**: clients with a server browser read it, and so do several community catalogues.
- **GitHub**: the README, the releases with the `.mcpb`, and Issues (the bug report template asks for the client, model, flags and the saved model).
- **Community directories** (Smithery, Glama, PulseMCP, mcp.so and others) list servers from the registry or GitHub. Check their submission pages if you want a listing sooner.
