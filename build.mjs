#!/usr/bin/env node
/* Builds single-file versions of the board:
 *   dist/sketchflow.html  – open by double-click, works offline (no AI link)
 *   dist/artifact.html    – body-only variant for hosts that add their own <html>/<head> skeleton
 *   dist/sketchflow-3d.html, dist/artifact-3d.html – the same for the v2 3D model workspace
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inlined = html.replace(/<script src="(js\/[\w-]+\.js)"><\/script>/g, (_, f) =>
  `<script>\n${fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
if (/<script src="js\//.test(inlined)) throw new Error('a script was not inlined');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
/* head elements (title/meta/link/style) come first in index.html, so the parser keeps them in <head> */
fs.writeFileSync(path.join(ROOT, 'dist', 'sketchflow.html'), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${inlined}\n</html>\n`);
fs.writeFileSync(path.join(ROOT, 'dist', 'artifact.html'), inlined);

/* v2 — the 3D workspace (ES modules) bundled into one classic-scope module script:
 * each module becomes an IIFE that returns its exports; imports become destructuring from the registry. */
const MODS = [['kernel', 'js'], ['sketch', 'js'], ['text', 'js'], ['model', 'js'], ['views', 'js'], ['collide', 'js'], ['drawing', 'js'], ['examples', 'js'], ['step', 'js'], ['gears', 'addons'], ['app', 'js']];
function bundleModule([name, dir]) {
  let src = fs.readFileSync(path.join(ROOT, 'model', dir, name + '.js'), 'utf8');
  const names = new Set();
  src = src.replace(/^export default /m, () => { names.add('default: __default'); return 'const __default = '; });
  src = src.replace(/^import (\w+) from '\.\.\/addons\/(\w+)\.js';/gm, (_, local, m) => `const ${local} = __sf3.${m}.default;`);
  src = src.replace(/^export \{([^}]+)\};?\s*$/gm, (_, list) => { list.split(',').map(x => x.trim()).filter(Boolean).forEach(n => { const m = n.split(/\s+as\s+/); names.add(m.length === 2 ? `${m[1]}: ${m[0]}` : n); }); return ''; });
  src = src.replace(/^export (const|let|function|class) (\w+)/gm, (_, kw, n) => { names.add(n); return `${kw} ${n}`; });
  src = src.replace(/^import \* as (\w+) from '\.\/(\w+)\.js';/gm, (_, ns, m) => `const ${ns} = __sf3.${m};`);
  src = src.replace(/^import \{([^}]+)\} from '\.\/(\w+)\.js';/gm, (_, list, m) => `const {${list.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}} = __sf3.${m};`);
  if (/^\s*(import|export)\b/m.test(src)) throw new Error(name + '.js: an import/export form the bundler does not handle');
  return `__sf3.${name} = (() => {\n${src}\nreturn { ${[...names].join(', ')} };\n})();\n`;
}
const bundle = 'const __sf3 = {};\n' + MODS.map(bundleModule).join('\n');
const html3 = fs.readFileSync(path.join(ROOT, 'model', 'index.html'), 'utf8');
const tag = '<script type="module" src="js/app.js"></script>';
if (!html3.includes(tag)) throw new Error('model/index.html: app.js script tag not found');
const inlined3 = html3.replace(tag, () => `<script type="module">\n${bundle.replace(/<\/script/gi, '<\\/script')}\n</script>`);
fs.writeFileSync(path.join(ROOT, 'dist', 'sketchflow-3d.html'), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${inlined3}\n</html>\n`);
fs.writeFileSync(path.join(ROOT, 'dist', 'artifact-3d.html'), inlined3);
for (const f of ['sketchflow.html', 'artifact.html', 'sketchflow-3d.html', 'artifact-3d.html']) console.log('built dist/' + f, (fs.statSync(path.join(ROOT, 'dist', f)).size / 1024).toFixed(0) + ' KB');
