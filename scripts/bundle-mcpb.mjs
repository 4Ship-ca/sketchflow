#!/usr/bin/env node
/*
 * Builds release/sketchflow-<version>.mcpb — an MCP Bundle (a zip with manifest.json at its root) that Claude Desktop
 * installs with a double-click (Settings → Extensions). It holds the same files as the npm package (package.json
 * "files"), so the server runs from the bundle with the Node that Claude Desktop ships; it has no dependencies.
 *   node scripts/bundle-mcpb.mjs            → release/sketchflow-<version>.mcpb and release/manifest.json
 * Optional check with the official tool:  npx @anthropic-ai/mcpb validate release/manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OUT = path.join(ROOT, 'release');

/* the package's files: "dir/" (everything under it), "dir/*.ext" and plain paths */
function packageFiles() {
  const out = new Set(['package.json']);
  const walk = (rel) => { for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) { const r = path.posix.join(rel, e.name); if (e.isDirectory()) walk(r); else out.add(r); } };
  for (const f of pkg.files) {
    if (f.endsWith('/')) walk(f.slice(0, -1));
    else if (f.includes('*')) { const dir = path.posix.dirname(f), re = new RegExp('^' + path.posix.basename(f).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'); for (const n of fs.readdirSync(path.join(ROOT, dir))) if (re.test(n)) out.add(path.posix.join(dir, n)); }
    else if (fs.existsSync(path.join(ROOT, f))) out.add(f);
    else throw new Error(`package.json files lists ${f}, which does not exist`);
  }
  return [...out].sort();
}

/* the tools, for the listing Claude Desktop shows before install (first sentence of each description) */
async function toolList() {
  const src = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8'), out = [];
  for (const m of src.matchAll(/\{ name: '([a-z_]+)', description: '((?:[^'\\]|\\.)*)'/g)) out.push({ name: m[1], description: m[2].replace(/\\'/g, "'").split(/(?<=\.)\s/)[0].slice(0, 200) });
  if (out.length < 10) throw new Error('could not read the tool list from server.mjs');
  return out;
}

function manifest(tools) {
  const repo = pkg.repository && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url);
  const author = typeof pkg.author === 'string' ? { name: pkg.author } : pkg.author && pkg.author.name ? pkg.author : { name: 'SketchFlow contributors' };
  return Object.assign({
    manifest_version: '0.3',
    name: 'sketchflow',
    display_name: 'SketchFlow',
    version: pkg.version,
    description: 'Sketch board + parametric 3D modeller in your browser that Claude draws and builds in with you.',
    long_description: 'SketchFlow opens in your browser: a vector sketch board (layers, perspective guides, linkages) and a parametric 3D workspace (mates, extrudes, holes, fillets, patterns, gears, welding, drawings, STEP export). Claude sees what you draw, draws and builds with you, and you edit the same model by hand. Everything stays on your computer; exports go to the folder you choose.',
    author
  }, repo ? { repository: { type: 'git', url: repo.replace(/^git\+/, '') } } : {}, pkg.homepage ? { homepage: pkg.homepage } : {}, {
    license: pkg.license,
    keywords: pkg.keywords,
    server: {
      type: 'node',
      entry_point: 'server.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server.mjs'],
        env: {
          SKETCHFLOW_EXPORT_DIR: '${user_config.export_dir}',
          SKETCHFLOW_TOOLS: '${user_config.tools}',
          SKETCHFLOW_LAN: '${user_config.lan}',
          SKETCHFLOW_BRIEF: '${user_config.brief}'
        }
      }
    },
    user_config: {
      export_dir: { type: 'directory', title: 'Export folder', description: 'Where PNG / SVG / STEP / STL / drawing exports are saved (empty: ~/Pictures/SketchFlow)', required: false },
      tools: { type: 'string', title: 'Tool set', description: 'all (sketch board + 3D), 3d (only the 3D model) or 2d (only the sketch board)', default: 'all', required: false },
      lan: { type: 'boolean', title: 'Draw from a tablet or phone', description: 'Also serve the board on your local network (a pairing code is required)', default: false, required: false },
      brief: { type: 'boolean', title: 'Short instructions', description: 'Send Claude short instructions (it reads the full reference when it needs it)', default: false, required: false }
    },
    tools,
    tools_generated: false,
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: pkg.engines.node.replace(/^>=(\d+)$/, '>=$1.0.0') } }
  });
}

/* a plain zip (deflate), no dependencies */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(entries) {
  const parts = [], central = []; let off = 0;
  const now = new Date(), dt = ((now.getFullYear() - 1980) << 25) | ((now.getMonth() + 1) << 21) | (now.getDate() << 16) | (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const { name, data } of entries) {
    const nm = Buffer.from(name, 'utf8'), z = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(dt >>> 0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(z.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nm, z);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(dt >>> 0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(z.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    central.push(ch, nm); off += 30 + nm.length + z.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

const files = packageFiles(), man = manifest(await toolList());
fs.mkdirSync(OUT, { recursive: true });
const manText = JSON.stringify(man, null, 2) + '\n';
fs.writeFileSync(path.join(OUT, 'manifest.json'), manText);
const entries = [{ name: 'manifest.json', data: Buffer.from(manText) }, ...files.map(f => ({ name: f, data: fs.readFileSync(path.join(ROOT, f)) }))];
const file = path.join(OUT, `sketchflow-${pkg.version}.mcpb`), buf = zip(entries);
fs.writeFileSync(file, buf);
console.log(`built ${path.relative(ROOT, file)} — ${files.length + 1} files, ${(buf.length / 1024 / 1024).toFixed(2)} MB (${man.tools.length} tools listed)`);
