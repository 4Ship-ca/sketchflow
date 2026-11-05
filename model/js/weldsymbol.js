/* SketchFlow — weld and joint symbols (ISO 2553, system A) as drawing primitives, so the views, the wizard and the
   drawing sheets all draw the same thing.

   spec = {
     sym: 'fillet' | 'square' | 'V' | 'bevel' | 'U' | 'J' | 'Y' | 'HY' (single-V / bevel with broad root face) |
          'adhesive' | 'tab' (fibre overlay) | 'filled' (filler fillet),
     both: true            symbol on both sides of the reference line (a double-sided weld: X, K, double fillet…)
     other: true           weld on the other side (symbol on the dashed-line side)
     size: 'a5'            left of the symbol (throat a / leg z / penetration s / bond line…)
     length: '100' | '3 × 50 (100)'   right of the symbol (length, or count × length (pitch) for intermittent)
     contour: 'flat' | 'convex' | 'concave'     finish: 'G' (ground) | 'M' (machined)
     toes: true            toes blended (ISO 2553 supplementary symbol)
     backing: 'M' | 'MR'   permanent / removable backing strip on the other side
     seal: true            sealing (back) run on the other side
     allAround, field      the circle and the flag at the knee
     tail: ['135', 'ISO 5817-C', 'UT']   process, quality level, testing — in the fork at the end
   }

   weldSymbol(spec, {left}) → { lines: [[x1, y1, x2, y2, dashed]], arcs: [[cx, cy, r, a0, a1]], texts: [{x, y, text, anchor, size}],
   flag: [[x, y]…] | null, box: {x0, w, h} }. Units: the symbol is 4 units tall; y up; the knee (where the arrow line meets
   the reference line) is at (0, 0); the reference line runs to the right — or to the left with left: true (when the
   arrow comes from the right). The elementary symbols are never mirrored (ISO 2553: a bevel's or fillet's upright leg
   is always on the left) and the text always reads left to right. */

const H = 4;   /* height of an elementary symbol */

function glyph(sym, flip) {
  /* an elementary symbol standing on the reference line at x = 0 (upwards; flip draws it under the line) */
  const s = flip ? -1 : 1, L = [], A = [];
  const ln = (x1, y1, x2, y2) => L.push([x1, s * y1, x2, s * y2, false]);
  switch (sym) {
    case 'fillet': ln(0, 0, 0, H); ln(0, H, H, 0); break;
    case 'square': ln(-0.8, 0, -0.8, H); ln(0.8, 0, 0.8, H); break;
    case 'V': ln(0, 0, -H * 0.58, H); ln(0, 0, H * 0.58, H); break;
    case 'bevel': ln(0, 0, 0, H); ln(0, 0, H * 0.75, H); break;
    case 'Y': ln(0, 0, 0, H * 0.35); ln(0, H * 0.35, -H * 0.55, H); ln(0, H * 0.35, H * 0.55, H); break;
    case 'HY': ln(0, 0, 0, H); ln(0, H * 0.35, H * 0.7, H); break;
    case 'U': { ln(-1.1, H * 0.55, -1.4, H); ln(1.1, H * 0.55, 1.4, H); A.push([0, s * H * 0.55, 1.1, flip ? 0 : Math.PI, flip ? Math.PI : 2 * Math.PI]); ln(0, 0, 0, H * 0.55 - 1.1); break; }
    case 'J': { ln(0, 0, 0, H); ln(1.1, H * 0.55, 1.5, H); A.push([0, s * H * 0.55, 1.1, flip ? 0 : 1.5 * Math.PI, flip ? 0.5 * Math.PI : 2 * Math.PI]); break; }
    case 'adhesive': { ln(-H * 0.7, H * 0.25, H * 0.7, H * 0.25); ln(-H * 0.7, H * 0.85, H * 0.7, H * 0.85); for (let k = -2; k <= 2; k++) ln(k * 0.5 - 0.4, H * 0.25, k * 0.5 + 0.2, H * 0.85); break; }
    case 'tab': { A.push([0, 0, H * 0.75, flip ? Math.PI : 0, flip ? 2 * Math.PI : Math.PI]); A.push([0, 0, H * 0.45, flip ? Math.PI : 0, flip ? 2 * Math.PI : Math.PI]); break; }
    case 'filled': { ln(0, 0, 0, H); A.push([H, s * H, H, flip ? 0.5 * Math.PI : Math.PI, flip ? Math.PI : 1.5 * Math.PI]); ln(0, 0, H, 0); break; }
    default: ln(-1, 0, 1, H);
  }
  /* arcs flipped: mirror the angles */
  return { L, A: flip ? A.map(([cx, cy, r, a0, a1]) => [cx, cy, r, a0, a1]) : A };
}

export function weldSymbol(spec = {}, opts = {}) {
  const lines = [], arcs = [], texts = [], ref = 34, D = opts.left ? -1 : 1, sx = 12 * D;   /* reference line length; the symbol's place along it */
  const T = (x, y, text, anchor = 'start', size = 2.6) => { if (text != null && text !== '') texts.push({ x, y, text: String(text), anchor, size }); };
  lines.push([0, 0, D * ref, 0, false]);
  /* identification (dashed) line — ISO system A — unless the weld is symmetric about the reference line */
  if (!spec.both && !['adhesive', 'tab'].includes(spec.sym)) lines.push([0, -1.2, D * (ref - 6), -1.2, true]);
  const sides = spec.both ? [false, true] : [!!spec.other];
  for (const under of sides) {
    const g = glyph(spec.sym, under), base = under ? (spec.both ? 0 : -1.2) : 0, sgn = under ? -1 : 1;
    for (const [x1, y1, x2, y2] of g.L) lines.push([sx + x1, base + y1, sx + x2, base + y2, false]);
    for (const [cx, cy, r, a0, a1] of g.A) arcs.push([sx + cx, base + cy, r, a0, a1]);
    /* contour over the symbol, finish letter above it */
    const top = base + sgn * (H + 0.8);
    if (spec.contour === 'flat') lines.push([sx - 2.2, top, sx + 2.2, top, false]);
    if (spec.contour === 'convex') arcs.push([sx, top - sgn * 1.4, 2.4, under ? 1.2 * Math.PI : 0.2 * Math.PI, under ? 1.8 * Math.PI : 0.8 * Math.PI]);
    if (spec.contour === 'concave') arcs.push([sx, top + sgn * 1.6, 2.4, under ? 0.2 * Math.PI : 1.2 * Math.PI, under ? 0.8 * Math.PI : 1.8 * Math.PI]);
    /* toes blended smoothly: a small cupped arc at each toe */
    if (spec.toes) for (const e of [-2.6, 2.6]) arcs.push([sx + e, top + sgn * 0.7, 0.7, under ? 0 : Math.PI, under ? Math.PI : 2 * Math.PI]);
    if (spec.finish) T(sx, top + sgn * (spec.contour ? 2.6 : 1.4) - (under ? 2.4 : 0), spec.finish, 'middle', 2.4);
    /* size to the left, length / pitch to the right, at the symbol's height */
    const ty = under ? base - H + 0.2 : base + 1;
    T(sx - H * 0.8 - 1, ty, spec.size, 'end');
    T(sx + H * 0.8 + 1.4, ty, spec.length, 'start');
  }
  /* the other side: a sealing run (half circle) or a backing strip */
  if (spec.seal && !spec.both) { const y = spec.other ? 0 : -1.2; arcs.push([sx, y, 1.4, spec.other ? 0 : Math.PI, spec.other ? Math.PI : 2 * Math.PI]); }
  if (spec.backing && !spec.both) { const y = spec.other ? 0 : -1.2, d = spec.other ? 1 : -1; lines.push([sx - 2, y, sx - 2, y + d * 1.6, false], [sx - 2, y + d * 1.6, sx + 2, y + d * 1.6, false], [sx + 2, y + d * 1.6, sx + 2, y, false]); T(sx + 3, y + d * 1.6 + (d < 0 ? -2 : 0.4), spec.backing, 'start', 2.2); }
  /* all around: a circle at the knee; field weld: a flag */
  if (spec.allAround) arcs.push([0, 0, 1.6, 0, 2 * Math.PI]);
  let flag = null; if (spec.field) { lines.push([0, 0, 0, 5, false]); flag = [[0, 5], [D * 3.4, 4.1], [0, 3.2]]; }
  /* tail: process, quality, testing */
  const tail = (spec.tail || []).filter(Boolean), tt = tail.join(' / ');
  if (tail.length) { lines.push([D * ref, 0, D * (ref + 2.4), 2.4, false], [D * ref, 0, D * (ref + 2.4), -2.4, false]); T(D * (ref + 3.2), -0.9, tt, opts.left ? 'end' : 'start', 2.4); }
  const w = ref + (tail.length ? 4 + tt.length * 1.45 : 2);
  return { lines, arcs, texts, flag, box: { x0: opts.left ? -w : 0, w, h: 2 * H + 4 }, left: !!opts.left };
}

/* as an SVG group: x, y = where the knee goes (SVG units, y down), scale = SVG units per symbol unit */
export function weldSymbolSVG(spec, x, y, scale = 2, color = 'currentColor', font = 'Inter, system-ui, sans-serif', opts = {}) {
  const P = weldSymbol(spec, opts), X = (u) => (x + u * scale).toFixed(2), Y = (v) => (y - v * scale).toFixed(2), out = [];
  for (const [x1, y1, x2, y2, dashed] of P.lines) out.push(`<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}"${dashed ? ` stroke-dasharray="${(1.6 * scale).toFixed(1)} ${(1 * scale).toFixed(1)}"` : ''}/>`);
  for (const [cx, cy, r, a0, a1] of P.arcs) {
    if (a1 - a0 >= 2 * Math.PI - 1e-6) { out.push(`<circle cx="${X(cx)}" cy="${Y(cy)}" r="${(r * scale).toFixed(2)}" fill="none"/>`); continue; }
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], large = a1 - a0 > Math.PI ? 1 : 0;
    out.push(`<path d="M${X(p0[0])} ${Y(p0[1])} A${(r * scale).toFixed(2)} ${(r * scale).toFixed(2)} 0 ${large} 0 ${X(p1[0])} ${Y(p1[1])}" fill="none"/>`);
  }
  if (P.flag) out.push(`<polygon points="${P.flag.map(([u, v]) => X(u) + ',' + Y(v)).join(' ')}" fill="${color}"/>`);
  for (const t of P.texts) out.push(`<text x="${X(t.x)}" y="${Y(t.y)}" font-size="${(t.size * scale).toFixed(1)}" text-anchor="${t.anchor}" fill="${color}" stroke="none" font-family="${font}">${String(t.text).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
  return `<g stroke="${color}" stroke-width="${(0.25 * scale).toFixed(2)}" fill="none" stroke-linecap="round">${out.join('')}</g>`;
}

/* onto a 2D canvas context: x, y in pixels (y down), scale = pixels per symbol unit */
export function weldSymbolCanvas(ctx, spec, x, y, scale = 3, color = '#1a1a1a', opts = {}) {
  const P = weldSymbol(spec, opts), X = (u) => x + u * scale, Y = (v) => y - v * scale;
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1, 0.28 * scale); ctx.lineCap = 'round';
  for (const [x1, y1, x2, y2, dashed] of P.lines) { ctx.setLineDash(dashed ? [1.6 * scale, scale] : []); ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke(); }
  ctx.setLineDash([]);
  for (const [cx, cy, r, a0, a1] of P.arcs) { ctx.beginPath(); ctx.arc(X(cx), Y(cy), r * scale, -a1, -a0); ctx.stroke(); }
  if (P.flag) { ctx.beginPath(); P.flag.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v)))); ctx.closePath(); ctx.fill(); }
  for (const t of P.texts) { ctx.font = `600 ${Math.round(t.size * scale)}px Inter, system-ui, sans-serif`; ctx.textAlign = t.anchor === 'middle' ? 'center' : t.anchor === 'end' ? 'right' : 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(t.text, X(t.x), Y(t.y)); }
  ctx.restore();
  return P.box;
}

const escX = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/* the symbol as one line of text (ISO 2553 order: size, symbol, length, then the tail) — for lists and the feature tree */
export function weldSymbolText(s = {}) {
  const glyph = { fillet: '◺', square: '‖', V: 'V', bevel: '⊿', Y: 'Y', HY: 'K-Y', U: 'U', J: 'J', adhesive: 'ADH', tab: 'TAB', filled: 'FILL' }[s.sym] || s.sym || '';
  return [s.ref, s.size, glyph + (s.both ? ' both sides' : ''), s.length, s.contour === 'flat' ? 'flush' : s.contour || '', s.finish ? `(${s.finish})` : '', s.toes ? 'toes ground' : '', s.backing ? `backing ${s.backing}` : '', s.seal ? '+ sealing run' : '', s.allAround ? 'all round' : '', s.field ? 'site weld' : '', s.tail && s.tail.filter(Boolean).length ? `< ${s.tail.filter(Boolean).join(' / ')}` : ''].filter(Boolean).join(' ');
}

/* a whole symbol as a stand-alone SVG: the arrow line from the joint (bottom left) to the knee, the reference line with
   its symbol, sizes and tail. opts: {scale (px per unit, 4), color, arrow: false to leave the arrow off} */
export function weldSymbolBlockSVG(spec, opts = {}) {
  const k = opts.scale || 4, color = opts.color || 'currentColor', P = weldSymbol(spec), arrow = opts.arrow !== false;
  let x0 = arrow ? -7.5 : -1, y0 = arrow ? -7.5 : -6, x1 = P.box.w, y1 = 7;
  const grow = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const [a, b, c, d] of P.lines) { grow(a, b); grow(c, d); }
  for (const [cx, cy, r] of P.arcs) { grow(cx - r, cy - r); grow(cx + r, cy + r); }
  for (const t of P.texts) { const w = String(t.text).length * t.size * 0.56, xa = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x; grow(xa, t.y - t.size * 0.3); grow(xa + w, t.y + t.size); }
  const pad = 1.2; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const W = (x1 - x0) * k, H = (y1 - y0) * k, kx = -x0 * k, ky = y1 * k, out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" role="img" aria-label="${escX(opts.label || weldSymbolText(spec))}">`);
  if (arrow) {
    const tx = kx - 6.5 * k, ty = ky + 6.5 * k, ux = Math.SQRT1_2, s = 1.6 * k, w = 0.55 * k;
    out.push(`<g stroke="${color}" stroke-width="${(0.25 * k).toFixed(2)}" fill="${color}" stroke-linecap="round"><line x1="${kx.toFixed(2)}" y1="${ky.toFixed(2)}" x2="${tx.toFixed(2)}" y2="${ty.toFixed(2)}"/><polygon stroke="none" points="${tx.toFixed(2)},${ty.toFixed(2)} ${(tx + ux * s - ux * w).toFixed(2)},${(ty - ux * s - ux * w).toFixed(2)} ${(tx + ux * s + ux * w).toFixed(2)},${(ty - ux * s + ux * w).toFixed(2)}"/></g>`);
  }
  out.push(weldSymbolSVG(spec, kx, ky, k, color));
  out.push('</svg>');
  return out.join('');
}

/* a joint section (the welding add-on's ui.section) as SVG: the parts as cut, the edge preparation taken out of them
   (hatched red), the weld metal dark, adhesive / filler / laminate in their own colours, and a scale bar.
   opts: {width, height, dark, label, id (unique per page, for the hatch pattern)} */
export function jointSectionSVG(sec, opts = {}) {
  if (!sec) return '';
  const W = opts.width || 240, H = opts.height || 150, dark = !!opts.dark, [x0, y0, x1, y1] = sec.window, uid = opts.id || 'js' + Math.random().toString(36).slice(2, 8);
  const k = Math.min(W / (x1 - x0), H / (y1 - y0)), ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  const X = (x) => (ox + (x - x0) * k).toFixed(2), Y = (y) => (oy + (y1 - y) * k).toFixed(2);
  const C = dark
    ? { part: ['#353a43', '#3f4550'], line: '#d6d4cf', cut: '#ff6b5e', weld: '#8f99a4', weldLine: '#eef0f2', layer: '#e0c36a', tab: '#cfcc98', fill: '#e6dcc0', strap: '#56606c', ink: '#ecebe8', note: '#a9a7a2' }
    : { part: ['#e4e7ec', '#d5dae2'], line: '#2a2d33', cut: '#d93a2b', weld: '#5b6470', weldLine: '#1d2127', layer: '#d6ae35', tab: '#b9b47a', fill: '#d6c59a', strap: '#aeb6c1', ink: '#1d1c1a', note: '#5f5b55' };
  const d = (pts) => 'M' + pts.map(([x, y]) => X(x) + ' ' + Y(y)).join('L') + 'Z', o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escX(opts.label || 'joint section')}" font-family="Figtree, system-ui, sans-serif">`);
  o.push(`<defs><pattern id="${uid}h" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="${C.cut}" stroke-width="1.2" opacity="0.75"/></pattern></defs>`);
  sec.parts.forEach((p, i) => {
    if (p.loops.length) o.push(`<path d="${p.loops.map(d).join(' ')}" fill="${C.part[i % 2]}" fill-rule="evenodd" stroke="none"/>`);
    o.push(`<g stroke="${C.line}" stroke-width="1.1" stroke-linecap="round">${p.segs.map(([a, b]) => `<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}"/>`).join('')}</g>`);
  });
  for (const c of sec.cuts) o.push(`<path d="${d(c.pts)}" fill="url(#${uid}h)" stroke="${C.cut}" stroke-width="1" stroke-dasharray="3 2"/>`);
  for (const b of sec.beads) {
    const fill = b.kind === 'layer' ? C.layer : b.kind === 'tab' ? C.tab : b.kind === 'fill' ? C.fill : b.kind === 'strap' || b.kind === 'backing' ? C.strap : C.weld;
    o.push(`<path d="${d(b.pts)}" fill="${fill}" stroke="${b.kind === 'layer' ? C.layer : C.weldLine}" stroke-width="0.9" stroke-linejoin="round"/>`);
  }
  /* part names, inside each part's cut outline, toward its far side */
  sec.parts.forEach((p) => {
    let best = null, ba = 0;
    for (const l of p.loops) { let a = 0, cx = 0, cy = 0; for (let i = 0; i < l.length; i++) { const [xa, ya] = l[i], [xb, yb] = l[(i + 1) % l.length], c = xa * yb - xb * ya; a += c; cx += (xa + xb) * c; cy += (ya + yb) * c; } if (Math.abs(a) > ba) { ba = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; } }
    if (best && ba * k * k / 2 > 900) o.push(`<text x="${X(best[0])}" y="${Y(best[1])}" font-size="10" font-weight="600" fill="${C.note}" text-anchor="middle" dominant-baseline="middle">${escX(p.name)}</text>`);
  });
  /* scale bar */
  const L = [1, 2, 5, 10, 20, 50, 100, 200].find(v => v * k >= 28) || 200, bx = 8, by = H - 8;
  o.push(`<g stroke="${C.ink}" stroke-width="1.2"><line x1="${bx}" y1="${by}" x2="${(bx + L * k).toFixed(1)}" y2="${by}"/><line x1="${bx}" y1="${by - 3}" x2="${bx}" y2="${by + 2}"/><line x1="${(bx + L * k).toFixed(1)}" y1="${by - 3}" x2="${(bx + L * k).toFixed(1)}" y2="${by + 2}"/></g><text x="${(bx + L * k + 4).toFixed(1)}" y="${by + 3.5}" font-size="9.5" fill="${C.note}">${L} mm</text>`);
  const mv = sec.parts.find(p => p.mover);
  if (sec.gap > 0) o.push(`<text x="${W - 6}" y="12" font-size="9.5" fill="${C.note}" text-anchor="end">${sec.method === 'weld' ? 'root gap' : 'bond line'} ${sec.gap} mm${mv ? ` · ${escX(mv.name)} moves ${sec.moved} mm` : ''}</text>`);
  o.push('</svg>');
  return o.join('');
}
