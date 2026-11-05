/* SketchFlow v2 views: four linked viewports (TOP · 3D / FRONT · RIGHT) on plain WebGL2.
   Ortho panes share one scale + centre, so projections line up (third-angle layout). Visible edges solid,
   hidden edges dashed, curved-surface silhouettes per view. 3D pane: orbit + corner-cube navigation. */
import * as K from './kernel.js';
import { dimsOf, worldConnectors, massReport, measureDim } from './model.js';
const { V } = K, M4point = (m, p) => K.M4.point(m, p);

const PANES = ['top', '3d', 'front', 'right'];
/* ortho bases: right, up, toward-viewer */
/* in-face reading directions for the view-cube labels, as seen from outside each face */
const CUBE_FACE_AXES = { FRONT: { r: [1, 0, 0], u: [0, 0, 1] }, BACK: { r: [-1, 0, 0], u: [0, 0, 1] }, RIGHT: { r: [0, 1, 0], u: [0, 0, 1] }, LEFT: { r: [0, -1, 0], u: [0, 0, 1] }, TOP: { r: [1, 0, 0], u: [0, 1, 0] }, BOTTOM: { r: [1, 0, 0], u: [0, -1, 0] } };
const BASIS = { front: { r: [1, 0, 0], u: [0, 0, 1], f: [0, -1, 0] }, top: { r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] }, right: { r: [0, 1, 0], u: [0, 0, 1], f: [1, 0, 0] } };
const LABEL = { top: 'TOP', front: 'FRONT', right: 'RIGHT', '3d': '3D' };

const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mat4mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function viewMat(r, u, f, eye) { return new Float32Array([r[0], u[0], f[0], 0, r[1], u[1], f[1], 0, r[2], u[2], f[2], 0, -V.dot(r, eye), -V.dot(u, eye), -V.dot(f, eye), 1]); }
function ortho(hw, hh, n, f) { return new Float32Array([1 / hw, 0, 0, 0, 0, 1 / hh, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1]); }
function persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); }

/* uM: per-part transform (motion, exploded view); uClip: section plane (world normal, offset) — inside faces show as a hatched cut */
const MESH_VS = `#version 300 es
in vec3 aP; in vec3 aN; uniform mat4 uVP; uniform mat4 uM; uniform vec3 uO; out vec3 vN; out vec3 vW;
void main(){ vec4 w = uM * vec4(aP, 1.0); vW = w.xyz; vN = mat3(uM) * aN; gl_Position = uVP * vec4(w.xyz - uO, 1.0); }`;
const MESH_FS = `#version 300 es
precision highp float; in vec3 vN; in vec3 vW; uniform vec3 uC; uniform vec3 uL; uniform float uA; uniform float uFlat; uniform vec4 uClip; uniform float uClipOn; uniform vec3 uCap; out vec4 o;
void main(){
  if (uClipOn > 0.5 && dot(vW, uClip.xyz) > uClip.w) discard;
  if (uClipOn > 0.5 && !gl_FrontFacing) { float s = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 10.0)); o = vec4(mix(uCap, uCap * 0.62, s), 1.0); return; }
  vec3 n = normalize(vN); float d = max(dot(n, uL), 0.0); float h = 0.5 + 0.5 * n.z;
  vec3 c = uC * (mix(0.42 + 0.58 * d + 0.12 * h, 0.94 + 0.06 * d, uFlat)); o = vec4(c, uA); }`;
/* thick lines: each segment is a screen-space quad */
const LINE_VS = `#version 300 es
in vec3 aA; in vec3 aB; in float aS; in float aT; uniform mat4 uVP; uniform mat4 uM; uniform vec3 uO; uniform vec2 uVp; uniform float uW; out float vD; out vec3 vW;
void main(){ vec3 wa = (uM * vec4(aA, 1.0)).xyz, wb = (uM * vec4(aB, 1.0)).xyz; vW = aT < 0.5 ? wa : wb; vec4 a = uVP * vec4(wa - uO, 1.0), b = uVP * vec4(wb - uO, 1.0); vec2 sa = a.xy / a.w * uVp, sb = b.xy / b.w * uVp;
  vec2 d = normalize(sb - sa + vec2(1e-6)); vec2 n = vec2(-d.y, d.x); vec4 p = aT < 0.5 ? a : b;
  vec2 off = n * aS * uW / uVp; p.xy += off * p.w; vD = (aT < 0.5 ? 0.0 : length(sb - sa)); gl_Position = p; }`;
const LINE_FS = `#version 300 es
precision highp float; in float vD; in vec3 vW; uniform vec4 uC; uniform float uDash; uniform vec4 uClip; uniform float uClipOn; out vec4 o;
void main(){ if (uClipOn > 0.5 && dot(vW, uClip.xyz) > uClip.w + 1e-3) discard; if (uDash > 0.0 && mod(vD, uDash) > uDash * 0.55) discard; o = uC; }`;

export class Views {
  constructor(canvas, overlay, model) {
    this.cv = canvas; this.ov = overlay; this.model = model;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.meshProg = this.prog(MESH_VS, MESH_FS); this.lineProg = this.prog(LINE_VS, LINE_FS);
    this.layout = '4'; this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.ortho = { s: 3, c: [0, 0, 0] };            /* px per mm, shared centre (display coords) */
    this.cam = { yaw: -35, pitch: 28, dist: 400, target: [0, 0, 0], fov: 38 };
    this.buffers = new Map(); this.sel = null; this.hover = null; this.overlayHits = []; this.showDims = true; this.showHidden = true; this.explode = 0; this.showCoG = false; this.offsets = new Map(); this.motion = null; this.section = null; this.highlights = []; this.collide = null;
    this.dark = true; this.tool = null; this.connectorsFor = null; this.preview = null;
    this.colors = { bg: [0.08, 0.085, 0.1], grid: 'rgba(255,255,255,0.06)', edge: [0.9, 0.92, 0.95, 1], hidden: [0.6, 0.66, 0.75, 0.75], sel: [1, 0.48, 0.24], ink: '#e8eaf0', dim: '#ff7b3d', label: '#8d93a3' };
    this.resize(); this.rebuild(); this.fitAll();
    new ResizeObserver(() => { this.resize(); this.draw(); }).observe(canvas.parentElement);
  }
  setTheme(dark) {
    this.dark = dark;
    this.colors = dark ? { bg: [0.08, 0.085, 0.1], grid: 'rgba(255,255,255,0.06)', edge: [0.9, 0.92, 0.95, 1], hidden: [0.6, 0.66, 0.75, 0.75], sel: [1, 0.48, 0.24], ink: '#e8eaf0', dim: '#ff7b3d', label: '#8d93a3' }
      : { bg: [0.965, 0.965, 0.955], grid: 'rgba(0,0,0,0.06)', edge: [0.12, 0.13, 0.16, 1], hidden: [0.35, 0.38, 0.45, 0.8], sel: [0.91, 0.4, 0.17], ink: '#1d1c1a', dim: '#d2551f', label: '#6b6862' };
    this.draw();
  }
  prog(vs, fs) {
    const gl = this.gl, mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name] = gl.getUniformLocation(p, u.name); }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); loc[a.name] = gl.getAttribLocation(p, a.name); }
    return { p, loc };
  }
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect(); this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr); this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
    this.ov.width = this.cv.width; this.ov.height = this.cv.height; this.ov.style.width = this.W + 'px'; this.ov.style.height = this.H + 'px';
  }
  panes() {
    const W = this.W, H = this.H, g = 2;
    if (this.layout !== '4') return [{ id: this.layout, x: 0, y: 0, w: W, h: H }];
    const hw = Math.floor(W / 2), hh = Math.floor(H / 2);
    return [{ id: 'top', x: 0, y: 0, w: hw - g / 2, h: hh - g / 2 }, { id: '3d', x: hw + g / 2, y: 0, w: W - hw - g / 2, h: hh - g / 2 }, { id: 'front', x: 0, y: hh + g / 2, w: hw - g / 2, h: H - hh - g / 2 }, { id: 'right', x: hw + g / 2, y: hh + g / 2, w: W - hw - g / 2, h: H - hh - g / 2 }];
  }
  paneAt(x, y) { return this.panes().find(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) || null; }
  /* a view square to any face (normal n, pointing at the viewer): the 'face' pane, for sketching on that face */
  setFaceView(n, label, centre, up) {
    const f = V.norm(n), up0 = up || (Math.abs(f[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1]), u = V.norm(V.sub(up0, V.mul(f, V.dot(up0, f)))), r = V.cross(u, f);
    BASIS.face = { r, u, f }; LABEL.face = label || 'FACE'; if (centre) this.ortho.c = centre.slice();
    return BASIS.face;
  }
  basisOf(id) { return BASIS[id]; }
  /* ---------- cameras ---------- */
  camDir3d() { const y = this.cam.yaw * Math.PI / 180, p = this.cam.pitch * Math.PI / 180; return [Math.cos(p) * Math.sin(y), -Math.cos(p) * Math.cos(y), Math.sin(p)]; }  /* from target toward eye */
  vp(pane) {
    const asp = pane.w / pane.h;
    if (pane.id === '3d') {
      const f = this.camDir3d(), eye = V.add(this.cam.target, V.mul(f, this.cam.dist)), up0 = Math.abs(f[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
      const r = V.norm(V.cross(up0, f)), u = V.cross(f, r);
      return { M: mat4mul(persp(this.cam.fov * Math.PI / 180, asp, this.cam.dist * 0.02, this.cam.dist * 20), viewMat(r, u, f, eye)), r, u, f, eye, persp: true };
    }
    const B = BASIS[pane.id], s = this.ortho.s, c = this.ortho.c, eye = V.add(c, V.mul(B.f, 5000));
    return { M: mat4mul(ortho(pane.w / 2 / s, pane.h / 2 / s, 1, 10000), viewMat(B.r, B.u, B.f, eye)), r: B.r, u: B.u, f: B.f, eye, persp: false };
  }
  /* display coords → pane pixel */
  project(pane, p, cam) {
    cam = cam || this.vp(pane); const M = cam.M, x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
    return { x: pane.x + (x / w * 0.5 + 0.5) * pane.w, y: pane.y + (1 - (y / w * 0.5 + 0.5)) * pane.h, behind: w <= 0 };
  }
  /* pane pixel → ray in display coords */
  ray(pane, px, py) {
    const cam = this.vp(pane), nx = ((px - pane.x) / pane.w) * 2 - 1, ny = 1 - ((py - pane.y) / pane.h) * 2;
    if (!cam.persp) { const s = this.ortho.s, o = V.add(V.add(cam.eye, V.mul(cam.r, nx * pane.w / 2 / s)), V.mul(cam.u, ny * pane.h / 2 / s)); return { o, d: V.neg(cam.f), cam }; }
    const t = Math.tan(this.cam.fov * Math.PI / 360), asp = pane.w / pane.h;
    const d = V.norm(V.add(V.add(V.neg(cam.f), V.mul(cam.r, nx * t * asp)), V.mul(cam.u, ny * t)));
    return { o: cam.eye, d, cam };
  }
  /* point on the pane's base plane (through the world origin) under the cursor — for sketching */
  planePoint(pane, px, py) { if (pane.id === '3d') return null; const r = this.ray(pane, px, py), B = BASIS[pane.id]; const t = -V.dot(r.o, B.f) / V.dot(r.d, B.f); const p = V.add(r.o, V.mul(r.d, t)); return { p, x: V.dot(p, B.r), y: V.dot(p, B.u), basis: B }; }
  /* ---------- geometry upload ---------- */
  rebuild() {
    const gl = this.gl, R = this.model.result, O = R.originPoint;
    /* bodies whose solid did not change (the model caches them) keep their GPU buffers and silhouettes */
    const old = this.buffers, keep = new Set(); this.buffers = new Map(); this.silCache = this.silCache || new Map();
    for (const body of R.bodies) {
      if (body.hidden || body.solid.isEmpty()) continue;
      const prev = old.get(body.id);
      if (prev && prev.solid === body.solid) { prev.body = body; prev.color = hex3(body.color); this.buffers.set(body.id, prev); keep.add(body.id); }
      else this.buffers.set(body.id, this.upload(body.solid, body));
    }
    for (const [id, b] of old) if (!keep.has(id)) { gl.deleteBuffer(b.mesh); gl.deleteBuffer(b.nrm); this.freeLines(b.edges); }
    for (const [k, sc] of [...this.silCache]) if (!keep.has(k.split('|')[0])) { this.freeLines(sc.buf); this.silCache.delete(k); }
    this.O = O; this.ghosts = null; this.computeOffsets();
  }
  /* exploded view: each part slides away from the assembly centre (view only — the model is untouched) */
  computeOffsets() {
    this.offsets = new Map(); if (!this.explode) return;
    const cs = []; for (const [id, b] of this.buffers) { const bb = b.solid.bbox(); cs.push([id, V.lerp(bb.min, bb.max, 0.5), V.len(V.sub(bb.max, bb.min))]); }
    if (cs.length < 2) return;
    let C = [0, 0, 0]; for (const [, c] of cs) C = V.add(C, c); C = V.mul(C, 1 / cs.length);
    const size = Math.max(...cs.map(x => x[2]));
    for (const [id, c] of cs) { let d = V.sub(c, C); if (V.len(d) < 1e-6) d = [0, 0, 1]; this.offsets.set(id, V.mul(V.norm(d), this.explode * (0.35 * size + V.len(d) * 0.6))); }
  }
  setExplode(target) {
    const from = this.explode, t0 = performance.now(), dur = 380;
    const step = () => { const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3); this.explode = from + (target - from) * e; this.computeOffsets(); this.drawNow(); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  offsetO(id) { return this.O; }
  /* a part's display transform: its motion pose (joints being moved) and its exploded-view offset */
  bodyMatrix(id) {
    let M = this.motion && this.motion.get(id); const off = this.offsets.get(id);
    if (!M && !off) return IDENT;
    M = M ? Float32Array.from(M) : Float32Array.from(IDENT);
    if (off) { M[12] += off[0]; M[13] += off[1]; M[14] += off[2]; }
    return M;
  }
  setClip(prog) {
    const gl = this.gl, S = this.section;
    gl.uniform1f(prog.loc.uClipOn, S ? 1 : 0);
    if (S) { gl.uniform4fv(prog.loc.uClip, [S.n[0], S.n[1], S.n[2], S.d]); if (prog.loc.uCap) gl.uniform3fv(prog.loc.uCap, this.dark ? [0.86, 0.44, 0.25] : [0.93, 0.48, 0.27]); }
  }
  upload(solid, body) {
    const gl = this.gl, mesh = solid.toMesh();
    const mb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    const creases = K.creaseEdges(solid);
    return { mesh: mb, nrm: nb, count: mesh.count, tris: mesh, creases, edges: this.lineBuf(creases), solid, body, color: hex3(body && body.color) };
  }
  lineBuf(segs) {
    const gl = this.gl, n = segs.length, A = new Float32Array(n * 6 * 3), B = new Float32Array(n * 6 * 3), S = new Float32Array(n * 6), T = new Float32Array(n * 6);
    const pat = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];
    segs.forEach(([a, b], i) => { pat.forEach(([s, t], k) => { const j = i * 6 + k; A.set(a, j * 3); B.set(b, j * 3); S[j] = s; T[j] = t; }); });
    const mk = (arr) => { const bf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bf); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return bf; };
    return { a: mk(A), b: mk(B), s: mk(S), t: mk(T), count: n * 6 };
  }
  freeLines(lb) { if (!lb) return; for (const k of ['a', 'b', 's', 't']) if (lb[k]) this.gl.deleteBuffer(lb[k]); }
  silhouettes(id, buf, dir) {
    const key = id + '|' + dir.map(v => v.toFixed(2)).join(','); let s = this.silCache.get(key);
    if (!s) { const segs = K.silhouetteEdges(buf.solid, dir, (sid) => /:(side|surface|arc\d*|rev\d+|teeth|bore|rim)$/.test(sid) || /side$/.test(sid)); s = { segs, buf: this.lineBuf(segs) }; this.silCache.set(key, s); if (this.silCache.size > 64) { const k0 = this.silCache.keys().next().value; this.freeLines(this.silCache.get(k0).buf); this.silCache.delete(k0); } }
    return s;
  }
  /* ---------- drawing ---------- */
  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.drawNow(); });
  }
  drawNow() {
    const gl = this.gl, dpr = this.dpr, C = this.colors;
    gl.enable(gl.SCISSOR_TEST); gl.enable(gl.DEPTH_TEST);
    gl.clearColor(...C.bg.map(v => v * 0.85), 1); gl.viewport(0, 0, this.cv.width, this.cv.height); gl.scissor(0, 0, this.cv.width, this.cv.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const pane of this.panes()) {
      const x = Math.round(pane.x * dpr), y = Math.round((this.H - pane.y - pane.h) * dpr), w = Math.round(pane.w * dpr), h = Math.round(pane.h * dpr);
      gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
      gl.clearColor(...C.bg, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const cam = this.vp(pane), ortho = pane.id !== '3d';
      /* faces */
      const mp = this.meshProg; gl.useProgram(mp.p); gl.uniformMatrix4fv(mp.loc.uVP, false, cam.M); gl.uniform3fv(mp.loc.uO, this.O); this.setClip(mp);
      gl.uniform3fv(mp.loc.uL, V.norm(V.add(V.mul(cam.f, 0.6), [0.3, 0.2, 0.75])));
      gl.uniform1f(mp.loc.uFlat, ortho ? 0.55 : 0); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2);
      const selBody = this.sel ? this.model.bodyContaining(this.sel) : null;
      for (const [id, b] of this.buffers) {
        const col = this.collide && this.collide.has(id) ? [0.95, 0.25, 0.22] : selBody && selBody.id === id ? mix(b.color, C.sel, 0.35) : b.color;
        gl.uniform3fv(mp.loc.uC, col); gl.uniform1f(mp.loc.uA, 1); gl.uniformMatrix4fv(mp.loc.uM, false, this.bodyMatrix(id));
        this.bindAttr(mp.loc.aP, b.mesh, 3); this.bindAttr(mp.loc.aN, b.nrm, 3); gl.drawArrays(gl.TRIANGLES, 0, b.count);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      /* edges: visible solid, hidden dashed (drawings) */
      const lp = this.lineProg; gl.useProgram(lp.p); gl.uniformMatrix4fv(lp.loc.uVP, false, cam.M); gl.uniform3fv(lp.loc.uO, this.O); gl.uniform2fv(lp.loc.uVp, [w / 2, h / 2]); this.setClip(lp);
      const passes = ortho && this.showHidden ? ['hidden', 'visible'] : ['visible'];
      for (const pass of passes) {
        gl.depthFunc(pass === 'hidden' ? gl.GREATER : gl.LEQUAL); gl.depthMask(false);
        gl.uniform4fv(lp.loc.uC, pass === 'hidden' ? C.hidden : C.edge); gl.uniform1f(lp.loc.uDash, pass === 'hidden' ? 9 * dpr : 0); gl.uniform1f(lp.loc.uW, (pass === 'hidden' ? 0.9 : 1.25) * dpr);
        for (const [id, b] of this.buffers) {
          const BM = this.bodyMatrix(id); gl.uniformMatrix4fv(lp.loc.uM, false, BM);
          this.drawLines(lp, b.edges);
          let vd = cam.persp ? V.norm(V.sub(cam.eye, this.cam.target)) : cam.f;
          if (BM !== IDENT) vd = [BM[0] * vd[0] + BM[1] * vd[1] + BM[2] * vd[2], BM[4] * vd[0] + BM[5] * vd[1] + BM[6] * vd[2], BM[8] * vd[0] + BM[9] * vd[1] + BM[10] * vd[2]];   /* view direction in the part's own pose */
          this.drawLines(lp, this.silhouettes(id, b, vd).buf);
        }
      }
      gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.uniformMatrix4fv(lp.loc.uM, false, IDENT);
      if (this.highlights.length) {
        gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        const mp2 = this.meshProg; gl.useProgram(mp2.p); gl.uniformMatrix4fv(mp2.loc.uVP, false, cam.M); gl.uniform3fv(mp2.loc.uO, this.O); gl.uniformMatrix4fv(mp2.loc.uM, false, IDENT); gl.uniform1f(mp2.loc.uClipOn, 0);
        for (const h of this.highlights) { gl.uniform3fv(mp2.loc.uC, [1, 0.23, 0.23]); gl.uniform1f(mp2.loc.uA, 0.55); this.bindAttr(mp2.loc.aP, h.mesh, 3); this.bindAttr(mp2.loc.aN, h.nrm, 3); gl.drawArrays(gl.TRIANGLES, 0, h.count); }
        gl.disable(gl.BLEND); gl.useProgram(lp.p); gl.uniform4fv(lp.loc.uC, [0.85, 0.1, 0.1, 1]); gl.uniform1f(lp.loc.uDash, 0); gl.uniform1f(lp.loc.uW, 1.6 * dpr); gl.uniform1f(lp.loc.uClipOn, 0);
        for (const h of this.highlights) this.drawLines(lp, h.edges);
        gl.enable(gl.DEPTH_TEST);
      }
      /* ghost of a selected tool / consumed object: drawn through everything */
      if (this.ghost) { gl.disable(gl.DEPTH_TEST); gl.uniform4fv(lp.loc.uC, [...C.sel, 0.95]); gl.uniform1f(lp.loc.uDash, 0); gl.uniform1f(lp.loc.uW, 1.4 * dpr); this.drawLines(lp, this.ghost.edges); gl.enable(gl.DEPTH_TEST); }
    }
    this.drawOverlay();
  }
  bindAttr(loc, buf, size) { const gl = this.gl; if (loc < 0 || loc == null) return; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); }
  drawLines(lp, L) { if (!L || !L.count) return; const gl = this.gl; this.bindAttr(lp.loc.aA, L.a, 3); this.bindAttr(lp.loc.aB, L.b, 3); this.bindAttr(lp.loc.aS, L.s, 1); this.bindAttr(lp.loc.aT, L.t, 1); gl.drawArrays(gl.TRIANGLES, 0, L.count); }
  /* overlap regions from the interference check: red, seen through everything */
  setHighlights(solids) {
    const gl = this.gl; for (const h of this.highlights) { gl.deleteBuffer(h.mesh); gl.deleteBuffer(h.nrm); this.freeLines(h.edges); }
    this.highlights = (solids || []).filter(x => x && !x.isEmpty()).map(sol => this.upload(sol, { color: '#ff3b3b' })); this.draw();
  }
  setGhost(solid) { if (this.ghost) this.freeLines(this.ghost.edges); this.ghost = solid && !solid.isEmpty() ? { edges: this.lineBuf(K.creaseEdges(solid)) } : null; this.draw(); }
  /* ---------- overlay: labels, origin, dims, connectors, cube, tool previews ---------- */
  drawOverlay() {
    const c = this.ov.getContext('2d'), dpr = this.dpr, C = this.colors; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, this.W, this.H);
    this.overlayHits = [];
    const R = this.model.result, O = this.O;
    for (const pane of this.panes()) {
      c.save(); c.beginPath(); c.rect(pane.x, pane.y, pane.w, pane.h); c.clip();
      const cam = this.vp(pane);
      if (this.sketchGrid && pane.id !== '3d' && (!this.sketchPane || this.sketchPane === pane.id)) this.drawGrid(c, pane, cam, this.sketchGrid);
      c.font = '700 11px "Figtree", system-ui, sans-serif'; c.fillStyle = C.label; c.fillText(LABEL[pane.id], pane.x + 10, pane.y + 18);
      /* origin triad */
      const o = this.project(pane, [0, 0, 0], cam), ax = [[1, 0, 0, '#e5484d'], [0, 1, 0, '#2fa86b'], [0, 0, 1, '#3e7bfa']];
      const axLen = cam.persp ? this.cam.dist * 0.06 : 16 / this.ortho.s;
      for (const [x, y, z, col] of ax) { const p = this.project(pane, [x * axLen, y * axLen, z * axLen], cam); if (Math.hypot(p.x - o.x, p.y - o.y) < 2) continue; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(p.x, p.y); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); }
      c.beginPath(); c.arc(o.x, o.y, 3, 0, Math.PI * 2); c.fillStyle = C.ink; c.fill();
      const still = !this.explode && !this.motion;
      if (pane.id !== '3d' && this.showDims && still) this.drawDims(c, pane, cam, R, O);
      if (this.connectorsFor && still) this.drawConnectors(c, pane, cam);
      if (this.showCoG && still) this.drawCoG(c, pane, cam);
      if (still && pane.id !== '3d') this.drawSketchGlyphs(c, pane, cam);
      if (still) this.drawPlanes(c, pane, cam);
      if (this.preview && this.preview.pane === pane.id) this.drawPreview(c, pane, cam);
      if (pane.id === '3d') this.drawCube(c, pane, cam);
      c.restore();
      c.strokeStyle = C.grid; c.lineWidth = 1; c.strokeRect(pane.x + 0.5, pane.y + 0.5, pane.w - 1, pane.h - 1);
    }
    if (this.onOverlay) this.onOverlay(c);
  }
  drawDims(c, pane, cam, R, O) {
    const C = this.colors, doc = this.model.doc, list = [];
    for (const ob of doc.objects) {
      if (ob.type === 'edge' || !R.world.has(ob.id)) continue;
      const M = R.world.get(ob.id);
      for (const d of dimsOf(ob)) {
        const a = V.sub(K.M4.point(M, d.a), O), b = V.sub(K.M4.point(M, d.b), O), dir = V.norm(V.sub(b, a));
        let view = d.view;
        if (view === 'auto') { let best = 'front', bs = -1; for (const v of ['front', 'top', 'right']) { const f = BASIS[v].f, s = 1 - Math.abs(V.dot(dir, f)); if (s > bs) { bs = s; best = v; } } view = best; }
        if (view !== pane.id) continue;
        if (Math.abs(V.dot(dir, BASIS[pane.id].f)) > 0.2) continue;
        list.push({ ob, d, a, b, value: ob.params[d.param] });
      }
    }
    for (const md of doc.dims || []) {
      if ((md.view || 'front') !== pane.id) continue;
      const m = measureDim(R, md); if (!m) continue;
      list.push({ measure: md, a: V.sub(m.from, O), b: V.sub(m.to, O), dir: m.dir, value: m.value });
    }
    const counts = new Map();
    for (const it of list) {
      const A = this.project(pane, it.a, cam), Bp = this.project(pane, it.b, cam);
      /* measuring direction on screen: the dimension's own axis (horizontal / vertical / square to a face) or the line between the points */
      let ux, uy;
      if (it.dir) { const o0 = this.project(pane, [0, 0, 0], cam), o1 = this.project(pane, it.dir, cam), l = Math.hypot(o1.x - o0.x, o1.y - o0.y); if (l < 1e-9) continue; ux = (o1.x - o0.x) / l; uy = (o1.y - o0.y) / l; }
      else { const L0 = Math.hypot(Bp.x - A.x, Bp.y - A.y); if (L0 < 6) continue; ux = (Bp.x - A.x) / L0; uy = (Bp.y - A.y) / L0; }
      let nx = -uy, ny = ux;
      const lb = it.ob && R.local.get(it.ob.id), lc = lb && !lb.isEmpty() ? V.lerp(lb.bbox().min, lb.bbox().max, 0.5) : [0, 0, 0];   /* dimensions go outside the part's middle */
      const bc = it.ob ? this.project(pane, V.sub(K.M4.point(R.world.get(it.ob.id), lc), O), cam) : { x: pane.x + pane.w / 2, y: pane.y + pane.h / 2 };
      const mid = { x: (A.x + Bp.x) / 2, y: (A.y + Bp.y) / 2 }; if (!it.measure && (mid.x - bc.x) * nx + (mid.y - bc.y) * ny < 0) { nx = -nx; ny = -ny; }
      /* both extension lines reach a common dimension line, beyond the further point */
      const da = A.x * nx + A.y * ny, db = Bp.x * nx + Bp.y * ny, far = Math.max(da, db);
      const key = (it.ob ? it.ob.id : 'm') + ':' + Math.round(nx * 2) + Math.round(ny * 2), k = counts.get(key) || 0; counts.set(key, k + 1);
      const off = 18 + k * 16, a2 = { x: A.x + nx * (far - da + off), y: A.y + ny * (far - da + off) }, b2 = { x: Bp.x + nx * (far - db + off), y: Bp.y + ny * (far - db + off) };
      if (Math.hypot(b2.x - a2.x, b2.y - a2.y) < 4) continue;
      const linked = it.ob && it.ob.expr && it.d && it.ob.expr[it.d.param], driving = it.measure && it.measure.drive != null;
      const col = it.measure ? (driving ? '#2f7cf6' : '#7aa7e8') : linked ? '#16a394' : C.dim;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
      c.globalAlpha = 0.6; c.beginPath(); c.moveTo(A.x + nx * 3, A.y + ny * 3); c.lineTo(a2.x + nx * 4, a2.y + ny * 4); c.moveTo(Bp.x + nx * 3, Bp.y + ny * 3); c.lineTo(b2.x + nx * 4, b2.y + ny * 4); c.stroke(); c.globalAlpha = 1;
      ux = (b2.x - a2.x) / Math.hypot(b2.x - a2.x, b2.y - a2.y); uy = (b2.y - a2.y) / Math.hypot(b2.x - a2.x, b2.y - a2.y);
      c.beginPath(); c.moveTo(a2.x, a2.y); c.lineTo(b2.x, b2.y); c.stroke();
      const head = (p, s) => { c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + s * ux * 7 - uy * 2.6, p.y + s * uy * 7 + ux * 2.6); c.lineTo(p.x + s * ux * 7 + uy * 2.6, p.y + s * uy * 7 - ux * 2.6); c.closePath(); c.fill(); };
      head(a2, 1); head(b2, -1);
      const txt = (linked ? '=' : '') + (it.d && it.d.kind === 'diameter' ? 'Ø' : it.d && it.d.kind === 'radius' ? 'R' : '') + (it.measure && !driving ? '(' + fmt(it.value) + ')' : fmt(it.value)), lx = (a2.x + b2.x) / 2 + nx * 9, ly = (a2.y + b2.y) / 2 + ny * 9;
      c.font = '600 11.5px "JetBrains Mono", ui-monospace, monospace'; const tw = c.measureText(txt).width;
      c.fillStyle = this.dark ? 'rgba(20,21,25,0.85)' : 'rgba(255,255,255,0.88)'; c.fillRect(lx - tw / 2 - 4, ly - 8, tw + 8, 16);
      c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, lx, ly); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      this.overlayHits.push({ kind: it.measure ? 'measure' : 'dim', x: lx - tw / 2 - 4, y: ly - 8, w: tw + 8, h: 16, ob: it.ob, param: it.d && it.d.param, measure: it.measure, value: it.value, pane: pane.id });
    }
  }
  resolveRef(ref) {
    if (!ref) return null; if (Array.isArray(ref)) return ref;
    const R = this.model.result; if (ref.obj && ref.conn) { const c = worldConnectors(R, ref.obj).find(x => x.name === ref.conn); return c ? c.o : null; }
    return ref.p || null;
  }
  /* the selected profile's constraints, as small badges on its segments (in the views that see its plane) */
  /* reference planes: a dashed square with its name (click the name to select it) */
  drawPlanes(c, pane, cam) {
    const R = this.model.result, O = this.O; if (!R.planes || !R.planes.length) return;
    for (const id of R.planes) {
      const o = this.model.get(id), M = R.world.get(id); if (!o || !M || o.hidden) continue;
      const h = (+o.params.size || 60) / 2, P = (x, y) => this.project(pane, V.sub(M4point(M, [x, y, 0]), O), cam), q = [P(-h, -h), P(h, -h), P(h, h), P(-h, h)];
      const area = Math.abs((q[1].x - q[0].x) * (q[3].y - q[0].y) - (q[3].x - q[0].x) * (q[1].y - q[0].y)), sel = this.sel === id;
      c.save(); c.strokeStyle = sel ? '#ff7b3d' : '#5b8def'; c.lineWidth = sel ? 2 : 1.3; c.setLineDash([6, 4]);
      c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.stroke();
      if (area > 30) { c.fillStyle = sel ? 'rgba(255,123,61,0.07)' : 'rgba(91,141,239,0.06)'; c.fill(); }
      c.setLineDash([]); c.font = '600 10.5px "Figtree", system-ui, sans-serif'; c.fillStyle = sel ? '#ff7b3d' : '#5b8def';
      const lx = Math.min(...q.map(p => p.x)), ly = Math.min(...q.map(p => p.y)), tw = c.measureText(o.name).width;
      c.fillText(o.name, lx + 3, ly - 4); this.overlayHits.push({ kind: 'plane', id, x: lx, y: ly - 15, w: tw + 8, h: 14, pane: pane.id });
      c.restore();
    }
  }
  drawSketchGlyphs(c, pane, cam) {
    const o = this.sel && this.model.get(this.sel); if (!o || !o.params || !Array.isArray(o.params.constraints) || !o.params.constraints.length || !Array.isArray(o.params.profile)) return;
    const R = this.model.result, M = R.world.get(o.id); if (!M) return;
    const rz = o.type === 'revolve', nrm = V.norm(K.M4.dir(M, rz ? [0, 1, 0] : [0, 0, 1])); if (Math.abs(V.dot(nrm, cam.f)) < 0.9) return;
    const P = o.params.profile, n = P.length, W = (q) => this.project(pane, V.sub(K.M4.point(M, rz ? [q[0], 0, q[1]] : [q[0], q[1], 0]), this.O), cam);
    const G = { h: 'H', v: 'V', parallel: '∥', perpendicular: '⊥', equal: '=', angle: '∠', fix: '⚓' }, per = new Map();
    c.save(); c.font = '700 10px "Figtree", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const k of o.params.constraints) {
      const g = G[k.type]; if (!g) continue;
      const segs = k.type === 'fix' ? [k.i] : k.j != null ? [k.i, k.j] : [k.i];
      for (const i of segs) {
        const a = W(P[i % n]), b = k.type === 'fix' ? a : W(P[(i + 1) % n]), cnt = per.get(i) || 0; per.set(i, cnt + 1);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, l = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l, x = mx + nx * (12 + cnt * 13), y = my + ny * (12 + cnt * 13);
        c.fillStyle = this.dark ? '#22252b' : '#ffffff'; c.strokeStyle = '#16a394'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill(); c.stroke();
        c.fillStyle = '#16a394'; c.fillText(g, x, y + 0.5);
      }
    }
    c.restore();
  }
  /* centre of gravity: the assembly's (large) and the selected part's (small), as the drafting symbol */
  drawCoG(c, pane, cam) {
    let rep; try { rep = massReport(this.model.doc, this.model.result); } catch (e) { return; }
    const mark = (pt, r, labelText) => {
      const p = this.project(pane, pt, cam); if (p.behind) return;
      c.save(); c.lineWidth = 1.4; c.strokeStyle = this.dark ? '#ecebe8' : '#1c1d21';
      for (let q = 0; q < 4; q++) { c.beginPath(); c.moveTo(p.x, p.y); c.arc(p.x, p.y, r, q * Math.PI / 2 - Math.PI / 2, (q + 1) * Math.PI / 2 - Math.PI / 2); c.closePath(); c.fillStyle = q % 2 ? (this.dark ? '#ecebe8' : '#1c1d21') : (this.dark ? '#141519' : '#ffffff'); c.fill(); }
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke();
      if (labelText) { c.font = '700 11px "Figtree", sans-serif'; c.fillStyle = this.dark ? '#ecebe8' : '#1c1d21'; c.fillText(labelText, p.x + r + 5, p.y + 4); }
      c.restore();
    };
    if (rep.cog) mark(rep.cog, 8, pane.id === '3d' ? (rep.total_mass_g >= 1000 ? (rep.total_mass_g / 1000).toFixed(2) + ' kg' : rep.total_mass_g.toFixed(0) + ' g') : 'CoG');
    const body = this.sel ? this.model.bodyContaining(this.sel) : null, part = body && rep.parts.find(x => x.id === body.id);
    if (part && rep.parts.length > 1) mark(part.centroid, 5, null);
  }
  drawConnectors(c, pane, cam) {
    const R = this.model.result, ids = this.connectorsFor === 'all' ? [...R.world.keys()] : [this.connectorsFor];
    for (const id of ids) {
      for (const cn of worldConnectors(R, id)) {
        const p = this.project(pane, V.sub(cn.o, this.O), cam); if (p.behind) continue;
        const hot = this.hover && this.hover.conn && this.hover.conn.id === id && this.hover.conn.name === cn.name;
        c.beginPath();
        if (cn.kind === 'corner') c.rect(p.x - 3.5, p.y - 3.5, 7, 7); else if (cn.kind === 'edge') { c.moveTo(p.x, p.y - 5); c.lineTo(p.x + 5, p.y); c.lineTo(p.x, p.y + 5); c.lineTo(p.x - 5, p.y); c.closePath(); } else c.arc(p.x, p.y, cn.kind === 'center' ? 5 : 4, 0, Math.PI * 2);
        c.fillStyle = hot ? '#ff7b3d' : cn.kind === 'face' ? '#3fd0bf' : cn.kind === 'center' ? '#f2c94c' : '#7aa2ff'; c.fill();
        c.strokeStyle = this.dark ? '#0b0c0e' : '#ffffff'; c.lineWidth = 1.2; c.stroke();
        if (hot) { c.font = '700 11px "Figtree", sans-serif'; c.fillStyle = '#ff7b3d'; c.fillText(cn.name, p.x + 8, p.y - 8); }
        /* several connectors can land on one pixel in a flat view (left face + its two edges…): rank them for clicks */
        const facing = V.dot(cn.n, cam.f), rank = cn.kind === 'face' ? (facing > 0.5 ? 0 : facing > -0.5 ? 0.5 : 2) : cn.kind === 'side' ? 0.5 : cn.kind === 'center' ? 1 : cn.kind === 'edge' ? 3 : 4;
        this.overlayHits.push({ kind: 'conn', x: p.x - 7, y: p.y - 7, w: 14, h: 14, cx: p.x, cy: p.y, rank, depth: V.dot(V.sub(cn.o, this.O), cam.f), conn: { id, name: cn.name, kind: cn.kind }, pane: pane.id });
      }
    }
  }
  /* the sketch grid (snap step), thinned out until lines are at least 8 px apart, every fifth line a little stronger */
  drawGrid(c, pane, cam, step) {
    const B = BASIS[pane.id], g0 = this.sketchGridAt && pane.id === 'face' ? this.sketchGridAt : [0, 0, 0], o = this.project(pane, g0, cam), px = this.project(pane, V.add(g0, B.r), cam).x - o.x; if (!(Math.abs(px) > 1e-9)) return;
    let st = step; while (Math.abs(px) * st < 8) st *= 5;
    const s = Math.abs(px) * st, x0 = o.x + Math.ceil((pane.x - o.x) / s) * s, y0 = o.y + Math.ceil((pane.y - o.y) / s) * s;
    c.save(); c.lineWidth = 1;
    for (let x = x0, k = Math.round((x0 - o.x) / s); x < pane.x + pane.w; x += s, k++) { c.strokeStyle = k % 5 ? this.colors.grid : this.colors.grid.replace(/0\.06\)/, '0.13)'); c.beginPath(); c.moveTo(Math.round(x) + 0.5, pane.y); c.lineTo(Math.round(x) + 0.5, pane.y + pane.h); c.stroke(); }
    for (let y = y0, k = Math.round((y0 - o.y) / s); y < pane.y + pane.h; y += s, k++) { c.strokeStyle = k % 5 ? this.colors.grid : this.colors.grid.replace(/0\.06\)/, '0.13)'); c.beginPath(); c.moveTo(pane.x, Math.round(y) + 0.5); c.lineTo(pane.x + pane.w, Math.round(y) + 0.5); c.stroke(); }
    c.restore();
  }
  drawPreview(c, pane, cam) {
    const pv = this.preview; c.save(); c.strokeStyle = '#ff7b3d'; c.fillStyle = 'rgba(255,123,61,0.15)'; c.lineWidth = 2;
    /* what the cursor snapped to: a square on a point, a diamond on a midpoint, a cross on the grid; a guide line for H / V / angle */
    if (pv.snap) {
      const q = this.project(pane, pv.snap.p, cam), k = pv.snap.kind; c.save(); c.strokeStyle = '#2f9e6a'; c.lineWidth = 1.6;
      if (pv.snap.guide) { const g = this.project(pane, pv.snap.guide, cam); c.setLineDash([4, 4]); c.beginPath(); c.moveTo(g.x, g.y); c.lineTo(q.x, q.y); c.stroke(); c.setLineDash([]); }
      c.beginPath();
      if (k === 'point') c.rect(q.x - 5, q.y - 5, 10, 10); else if (k === 'mid') { c.moveTo(q.x, q.y - 6); c.lineTo(q.x + 6, q.y); c.lineTo(q.x, q.y + 6); c.lineTo(q.x - 6, q.y); c.closePath(); } else { c.moveTo(q.x - 5, q.y); c.lineTo(q.x + 5, q.y); c.moveTo(q.x, q.y - 5); c.lineTo(q.x, q.y + 5); }
      c.stroke();
      if (pv.snap.label) { c.font = '600 10.5px "Figtree", system-ui, sans-serif'; c.fillStyle = '#2f9e6a'; c.fillText(pv.snap.label, q.x + 9, q.y - 8); }
      c.restore();
    }
    if (pv.points && pv.points.length) {
      c.beginPath(); pv.points.forEach((p, i) => { const q = this.project(pane, p, cam); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); });
      if (pv.cursor) { const q = this.project(pane, pv.cursor, cam); c.lineTo(q.x, q.y); }
      if (pv.closed) c.closePath(); c.fill(); c.stroke();
      pv.points.forEach((p, i) => { const q = this.project(pane, p, cam); c.beginPath(); c.arc(q.x, q.y, i === 0 ? 6 : 3.5, 0, Math.PI * 2); c.fillStyle = i === 0 ? '#ff7b3d' : '#ffffff'; c.fill(); c.stroke(); });
    }
    if (pv.measureA) { const a = this.project(pane, V.sub(pv.measureA, this.O), cam); c.beginPath(); c.arc(a.x, a.y, 5, 0, Math.PI * 2); c.stroke(); }
    c.restore();
  }
  /* corner cube: faces, edges and corners are all clickable views */
  cubeGeom(pane, cam) {
    const S = 34, cx = pane.x + pane.w - 58, cy = pane.y + 58, P = (x, y, z) => { const v = [x, y, z]; return { x: cx + V.dot(v, cam.r) * S, y: cy - V.dot(v, cam.u) * S, z: V.dot(v, cam.f) }; };
    const faces = [['TOP', [0, 0, 1]], ['BOTTOM', [0, 0, -1]], ['FRONT', [0, -1, 0]], ['BACK', [0, 1, 0]], ['RIGHT', [1, 0, 0]], ['LEFT', [-1, 0, 0]]];
    return { cx, cy, S, P, faces };
  }
  drawCube(c, pane, cam) {
    const g = this.cubeGeom(pane, cam), C = this.colors;
    const quads = g.faces.map(([name, n]) => {
      const a = n.findIndex(v => v !== 0), s = n[a], idx = [0, 1, 2].filter(i => i !== a);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => { const v = [0, 0, 0]; v[a] = s * 0.5; v[idx[0]] = p * 0.5; v[idx[1]] = q * 0.5; return g.P(...v); });
      return { name, n, corners, z: V.dot(n, cam.f) };
    }).filter(q => q.z > 0).sort((p, q) => p.z - q.z);
    for (const q of quads) {
      c.beginPath(); q.corners.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
      const hot = this.hover && this.hover.cube === q.name;
      c.fillStyle = hot ? '#ff7b3d' : (this.dark ? 'rgba(40,43,52,0.92)' : 'rgba(255,255,255,0.92)'); c.fill(); c.strokeStyle = this.dark ? '#5b6170' : '#b4b0a8'; c.lineWidth = 1; c.stroke();
      /* label painted onto the face plane (foreshortens with it, never collides with its neighbours) */
      if (q.z > 0.22) {
        const F = CUBE_FACE_AXES[q.name], h = (v) => g.P(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5);
        const O = h(q.n), Rr = h(V.add(q.n, F.r)), Uu = h(V.add(q.n, F.u)), k = 20;
        c.save(); c.transform((Rr.x - O.x) / k, (Rr.y - O.y) / k, (O.x - Uu.x) / k, (O.y - Uu.y) / k, O.x, O.y);
        c.font = '800 10px "Figtree", sans-serif'; const w = c.measureText(q.name).width, fs = Math.min(10, 10 * 33 / w);
        c.font = `800 ${fs.toFixed(2)}px "Figtree", sans-serif`; c.fillStyle = hot ? '#1a1206' : C.ink; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(q.name, 0, 0.5);
        c.restore();
      }
    }
    /* edge + corner hot spots */
    const hs = [];
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
      const nz = (x !== 0) + (y !== 0) + (z !== 0); if (nz < 2) continue;
      const v = [x, y, z], p = g.P(x * 0.5, y * 0.5, z * 0.5); if (V.dot(V.norm(v), this.vp(pane).f) < 0.15) continue;
      hs.push({ v, p });
      c.beginPath(); c.arc(p.x, p.y, nz === 3 ? 4 : 3, 0, Math.PI * 2); c.fillStyle = this.hover && this.hover.cubeDir && this.hover.cubeDir.join() === v.join() ? '#ff7b3d' : (this.dark ? '#8d93a3' : '#8f8a82'); c.fill();
    }
    for (const q of quads) this.overlayHits.push({ kind: 'cube', poly: q.corners, name: q.name, dir: q.n, pane: pane.id });
    for (const h of hs) this.overlayHits.push({ kind: 'cube', x: h.p.x - 6, y: h.p.y - 6, w: 12, h: 12, dir: h.v, pane: pane.id });
    this.overlayHits.push({ kind: 'cubeZone', x: g.cx - 46, y: g.cy - 46, w: 92, h: 92, pane: pane.id });
  }
  hitOverlay(x, y) {
    let best = null, bs = Infinity;
    for (let i = this.overlayHits.length - 1; i >= 0; i--) {
      const h = this.overlayHits[i];
      if (h.kind === 'cubeZone') continue;
      if (h.poly) { if (pointInPoly2(x, y, h.poly)) { if (!best) return h; } continue; }
      if (!(x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)) continue;
      if (h.kind !== 'conn') { if (!best) return h; continue; }
      /* connectors: nearest dot wins, then the most useful kind (a face toward you > centre > edge > corner), then the one nearest the eye */
      const sc = Math.hypot(x - h.cx, y - h.cy) / 3 + h.rank - h.depth * 1e-6;
      if (sc < bs) { bs = sc; best = h; }
    }
    return best;
  }
  inCube(x, y) { return this.overlayHits.some(h => h.kind === 'cubeZone' && x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h); }
  setCubeView(dir) {
    const d = V.norm(dir), pitch = Math.asin(Math.max(-1, Math.min(1, d[2]))) * 180 / Math.PI;
    let yaw = Math.atan2(d[0], -d[1]) * 180 / Math.PI; if (Math.abs(d[0]) < 1e-6 && Math.abs(d[1]) < 1e-6) yaw = this.cam.yaw;
    this.animateCam(yaw, Math.max(-89.9, Math.min(89.9, pitch)));
  }
  animateCam(yaw, pitch) {
    const y0 = this.cam.yaw, p0 = this.cam.pitch; let dy = ((yaw - y0 + 540) % 360) - 180; const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 280), e = k * (2 - k); this.cam.yaw = y0 + dy * e; this.cam.pitch = p0 + (pitch - p0) * e; this.draw(); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  /* ---------- picking ---------- */
  pick(pane, px, py) {
    const r = this.ray(pane, px, py); let best = null;
    for (const [id, b] of this.buffers) {
      const P = b.tris.positions, O = this.O, BM = this.bodyMatrix(id), moved = BM !== IDENT;
      const X = (k) => (moved ? [BM[0] * P[k] + BM[4] * P[k + 1] + BM[8] * P[k + 2] + BM[12] - O[0], BM[1] * P[k] + BM[5] * P[k + 1] + BM[9] * P[k + 2] + BM[13] - O[1], BM[2] * P[k] + BM[6] * P[k + 1] + BM[10] * P[k + 2] + BM[14] - O[2]] : [P[k] - O[0], P[k + 1] - O[1], P[k + 2] - O[2]]);
      for (let i = 0; i < P.length; i += 9) {
        const a = X(i), bb = X(i + 3), cc = X(i + 6);
        if (this.section) { const S = this.section, cen = [(a[0] + bb[0] + cc[0]) / 3 + O[0], (a[1] + bb[1] + cc[1]) / 3 + O[1], (a[2] + bb[2] + cc[2]) / 3 + O[2]]; if (V.dot(cen, S.n) > S.d) continue; }
        const t = rayTri(r.o, r.d, a, bb, cc);
        if (t != null && (!best || t < best.t)) { const poly = b.tris.polysOfTri[i / 9]; best = { t, id, point: V.add(V.add(r.o, V.mul(r.d, t)), O), normal: poly.plane.n, sid: poly.sid }; }
      }
    }
    return best;
  }
  /* ---------- view control ---------- */
  fitAll() {
    const R = this.model.result; let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const b of R.bodies) { if (b.solid.isEmpty() || b.hidden) continue; const bb = b.solid.bbox(); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], bb.min[k]); mx[k] = Math.max(mx[k], bb.max[k]); } }
    if (!isFinite(mn[0])) { mn = [-50, -50, 0]; mx = [50, 50, 50]; }
    const O = R.originPoint, c = V.sub(V.lerp(mn, mx, 0.5), O), size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 20);
    const p = this.panes().find(q => q.id === 'front') || this.panes()[0];
    this.ortho.c = c; this.ortho.s = Math.min(p.w, p.h) * 0.7 / size;
    this.cam.target = c; this.cam.dist = size * 2.6;
    this.draw();
  }
  zoomOrtho(pane, px, py, k) {
    const B = BASIS[pane.id], before = this.planeXY(pane, px, py);
    this.ortho.s = Math.max(0.02, Math.min(200, this.ortho.s * k));
    const after = this.planeXY(pane, px, py);
    this.ortho.c = V.add(this.ortho.c, V.add(V.mul(B.r, before.x - after.x), V.mul(B.u, before.y - after.y)));
    this.draw();
  }
  planeXY(pane, px, py) { const B = BASIS[pane.id], s = this.ortho.s; return { x: V.dot(this.ortho.c, B.r) + (px - pane.x - pane.w / 2) / s, y: V.dot(this.ortho.c, B.u) - (py - pane.y - pane.h / 2) / s }; }
  panOrtho(pane, dx, dy) { const B = BASIS[pane.id], s = this.ortho.s; this.ortho.c = V.add(this.ortho.c, V.add(V.mul(B.r, -dx / s), V.mul(B.u, dy / s))); this.draw(); }
  orbit(dx, dy) { this.cam.yaw += dx * 0.4; this.cam.pitch = Math.max(-89.9, Math.min(89.9, this.cam.pitch + dy * 0.4)); this.draw(); }
  pan3d(pane, dx, dy) { const cam = this.vp(pane), s = this.cam.dist * Math.tan(this.cam.fov * Math.PI / 360) * 2 / pane.h; this.cam.target = V.add(this.cam.target, V.add(V.mul(cam.r, -dx * s), V.mul(cam.u, dy * s))); this.draw(); }
  zoom3d(k) { this.cam.dist = Math.max(5, Math.min(1e5, this.cam.dist / k)); this.draw(); }
  snapshot() { this.drawNow(); const c = document.createElement('canvas'); c.width = this.cv.width; c.height = this.cv.height; const g = c.getContext('2d'); g.drawImage(this.cv, 0, 0); g.drawImage(this.ov, 0, 0); return c; }
}
function rayTri(o, d, a, b, c) {
  const e1 = V.sub(b, a), e2 = V.sub(c, a), p = V.cross(d, e2), det = V.dot(e1, p); if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det, t0 = V.sub(o, a), u = V.dot(t0, p) * inv; if (u < 0 || u > 1) return null;
  const qv = V.cross(t0, e1), v = V.dot(d, qv) * inv; if (v < 0 || u + v > 1) return null;
  const t = V.dot(e2, qv) * inv; return t > 1e-6 ? t : null;
}
function pointInPoly2(x, y, ps) { let ins = false; for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) { const a = ps[i], b = ps[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) ins = !ins; } return ins; }
function hex3(h) { if (!h) return [0.78, 0.8, 0.85]; const n = parseInt(String(h).replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function fmt(v) { return (Math.round(v * 100) / 100).toString(); }
