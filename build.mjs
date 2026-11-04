#!/usr/bin/env node
/* Builds single-file versions of the board:
 *   dist/sketchflow.html  – open by double-click, works offline (no AI link)
 *   dist/artifact.html    – body-only variant for hosts that add their own <html>/<head> skeleton
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
for (const f of ['sketchflow.html', 'artifact.html']) console.log('built dist/' + f, (fs.statSync(path.join(ROOT, 'dist', f)).size / 1024).toFixed(0) + ' KB');
