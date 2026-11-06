#!/usr/bin/env node
/*
 * Release prep: ties the package to its GitHub repository and writes server.json for the MCP Registry.
 *   node scripts/release-prep.mjs --owner <github-user-or-org> [--repo sketchflow] [--author "Your Name"]
 *       sets package.json repository / homepage / bugs / author / mcpName (io.github.<owner>/sketchflow) and writes server.json
 *   node scripts/release-prep.mjs --version 2.0.0-beta.2
 *       sets the version in package.json and server.json (add a CHANGELOG.md section for it too)
 *   node scripts/release-prep.mjs --check
 *       checks that everything a release needs is in place (npm runs it before every publish)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_FILE = path.join(ROOT, 'package.json'), SERVER_FILE = path.join(ROOT, 'server.json');
const SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const argv = process.argv.slice(2), arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : undefined; };
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const die = (m) => { console.error('release-prep: ' + m); process.exit(1); };
const pkg = readJSON(PKG_FILE);

/* server.json (MCP Registry): what the registry lists, and how a client runs it from npm */
function serverJson(p) {
  const name = p.mcpName, repo = p.repository && p.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  return {
    $schema: SCHEMA,
    name,
    title: 'SketchFlow',
    description: 'Sketch board + parametric 3D CAD (mates, features, STEP export) that AI builds in your browser.',
    repository: { url: repo, source: 'github' },
    websiteUrl: p.homepage,
    version: p.version,
    packages: [{
      registryType: 'npm',
      identifier: p.name,
      version: p.version,
      transport: { type: 'stdio' },
      environmentVariables: [
        { name: 'SKETCHFLOW_TOOLS', description: 'Tool set: all (default), 3d (only the 3D model) or 2d (only the sketch board)', isRequired: false, format: 'string', default: 'all', choices: ['all', '3d', '2d'] },
        { name: 'SKETCHFLOW_BRIEF', description: 'Set to 1 for short server instructions (small context windows)', isRequired: false, format: 'string' },
        { name: 'SKETCHFLOW_EXPORT_DIR', description: 'Folder for exports (default ~/Pictures/SketchFlow)', isRequired: false, format: 'filepath' },
        { name: 'SKETCHFLOW_PORT', description: 'First local port to try (default 7777)', isRequired: false, format: 'number' }
      ]
    }]
  };
}

function check() {
  const p = readJSON(PKG_FILE), errs = [];
  if (!p.mcpName || !/^io\.github\.[A-Za-z0-9-]+\/[a-z0-9._-]+$/.test(p.mcpName)) errs.push('package.json has no mcpName — run: npm run release:prep -- --owner <github-user>');
  if (!p.repository || !p.repository.url) errs.push('package.json has no repository — run release:prep with --owner');
  if (!fs.existsSync(SERVER_FILE)) errs.push('server.json is missing — run release:prep with --owner');
  else {
    const s = readJSON(SERVER_FILE);
    if (s.name !== p.mcpName) errs.push(`server.json name ${s.name} is not package.json mcpName ${p.mcpName}`);
    if (s.version !== p.version || !s.packages || s.packages[0].version !== p.version) errs.push(`server.json version is not ${p.version} — run release:prep with --version ${p.version}`);
    if (s.packages && s.packages[0].identifier !== p.name) errs.push(`server.json package is ${s.packages[0].identifier}, not ${p.name}`);
    if ((s.description || '').length > 100) errs.push('server.json description is over 100 characters');
  }
  const cl = fs.existsSync(path.join(ROOT, 'CHANGELOG.md')) ? fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8') : '';
  if (!cl.includes('## ' + p.version)) errs.push(`CHANGELOG.md has no "## ${p.version}" section`);
  for (const f of p.files) if (!f.includes('*') && !fs.existsSync(path.join(ROOT, f.replace(/\/$/, '')))) errs.push(`package.json files lists ${f}, which is missing`);
  if (errs.length) { console.error('release-prep --check failed:\n  - ' + errs.join('\n  - ')); process.exit(1); }
  console.log(`release-prep: ${p.name}@${p.version} (${p.mcpName}) is ready to publish`);
}

if (arg('check')) check();
else if (arg('owner') || arg('version')) {
  if (arg('owner')) {
    const owner = String(arg('owner')), repo = typeof arg('repo') === 'string' ? arg('repo') : 'sketchflow';
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) die(`"${owner}" is not a GitHub user or organisation name`);
    if (!/^[A-Za-z0-9._-]+$/.test(repo)) die(`"${repo}" is not a repository name`);
    const url = `https://github.com/${owner}/${repo}`;
    pkg.repository = { type: 'git', url: `git+${url}.git` };
    pkg.homepage = `${url}#readme`;
    pkg.bugs = { url: `${url}/issues` };
    pkg.author = typeof arg('author') === 'string' ? arg('author') : pkg.author || owner;
    pkg.mcpName = `io.github.${owner}/sketchflow`;
  }
  if (typeof arg('version') === 'string') {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(arg('version'))) die(`"${arg('version')}" is not a version like 2.0.0-beta.2`);
    pkg.version = arg('version');
  }
  /* keep the keys in a readable order */
  const order = ['name', 'version', 'description', 'mcpName', 'author', 'license', 'homepage', 'repository', 'bugs', 'type', 'bin', 'main', 'files', 'scripts', 'keywords', 'engines', 'os'];
  const sorted = Object.fromEntries([...order.filter(k => k in pkg).map(k => [k, pkg[k]]), ...Object.entries(pkg).filter(([k]) => !order.includes(k))]);
  writeJSON(PKG_FILE, sorted);
  if (sorted.mcpName && sorted.repository) writeJSON(SERVER_FILE, serverJson(sorted));
  console.log(`package.json: ${sorted.name}@${sorted.version}${sorted.mcpName ? ` · ${sorted.mcpName} · ${sorted.repository.url}` : ''}${fs.existsSync(SERVER_FILE) ? '\nserver.json written' : ''}`);
  if (!fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').includes('## ' + sorted.version)) console.log(`next: add a "## ${sorted.version}" section to CHANGELOG.md`);
} else {
  console.log('usage:\n  npm run release:prep -- --owner <github-user> [--repo sketchflow] [--author "Your Name"]\n  npm run release:prep -- --version <x.y.z[-beta.n]>\n  npm run release:prep -- --check');
}
