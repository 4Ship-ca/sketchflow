#!/usr/bin/env node
/*
 * SketchFlow 3D setup — what SF3d_setup.bat runs (it works the same on macOS and Linux: node scripts/setup.mjs).
 * Reads SF3d_setup.env (made from SF3d_setup.env.template) and, as it asks:
 *   1. checks the tools it needs (Node 20+, npm; git and the GitHub CLI to publish; Ollama and uv for a local model),
 *      offering to install missing ones with winget on Windows
 *   2. DO_LOCAL_INSTALL     tests, packs and installs sketchflow-mcp on this computer, builds the Claude Desktop bundle
 *   3. DO_PUBLISH           commit identity, email in history, release prep, main branch; then (1) the GitHub repository,
 *                           push, npm publish, the NPM_TOKEN secret, the release tag, and waits for the GitHub release
 *   4. DO_CONFIGURE_CLIENTS adds SketchFlow to Claude Desktop / Claude Code / Cursor / VS Code / LM Studio
 *   5. DO_OLLAMA            Ollama + a model + ollmcp, sketchflow-servers.json and SF3d_ollama.bat
 * Every upload and every history change is shown first and asked for (ASSUME_YES=1 skips the questions);
 * DRY_RUN=1 shows them without doing them. It can be run again: finished steps are recognised and skipped.
 *   node scripts/setup.mjs [--env SF3d_setup.env] [--dry-run] [--yes]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const argv = process.argv.slice(2), argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const ENV_FILE = path.resolve(ROOT, argOf('--env') || 'SF3d_setup.env');
const LOG_FILE = path.join(ROOT, 'SF3d_setup.log');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/* ------------------------------------------------ output and log ------------------------------------------------ */
const secrets = [];
const mask = (t) => secrets.reduce((s, x) => (x ? s.split(x).join('***') : s), String(t));
fs.writeFileSync(LOG_FILE, `SketchFlow setup ${new Date().toISOString()} · ${process.platform} · node ${process.version}\n`);
const log = (t) => fs.appendFileSync(LOG_FILE, mask(t) + '\n');
const say = (t) => { console.log(mask(t)); log(t); };
const results = [];
const note = (status, what, detail = '') => { results.push({ status, what, detail }); say(`  ${{ ok: '✓', skip: '·', warn: '!', fail: '✗', dry: '~' }[status]} ${what}${detail ? ' — ' + detail : ''}`); };
const heading = (t) => say(`\n== ${t} ==`);
class Stop extends Error {}

/* ------------------------------------------------ settings ------------------------------------------------ */
function parseEnv(text) {
  const out = {};
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    let v = m[2];
    if (/^"/.test(v)) { const q = v.match(/^"((?:[^"\\]|\\.)*)"/); v = q ? q[1].replace(/\\(.)/g, '$1') : v.slice(1); }
    else if (/^'/.test(v)) { const q = v.match(/^'([^']*)'/); v = q ? q[1] : v.slice(1); }
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}
if (!fs.existsSync(ENV_FILE)) { console.error(`No settings file: ${ENV_FILE}\nCopy SF3d_setup.env.template to SF3d_setup.env and fill it in.`); process.exit(2); }
const E = Object.assign({
  DO_LOCAL_INSTALL: '1', DO_CONFIGURE_CLIENTS: '1', DO_OLLAMA: '0', DO_PUBLISH: '0', DRY_RUN: '0', ASSUME_YES: '0',
  GITHUB_USER: '', GITHUB_REPO: 'sketchflow', REPO_VISIBILITY: 'public', AUTHOR_NAME: '', GIT_EMAIL: '', REWRITE_EMAIL_IN_HISTORY: '0',
  NPM_TOKEN: '', SET_NPM_TOKEN_SECRET: '1', NPM_PUBLISH_ARGS: '', WAIT_FOR_RELEASE: '1', GIT_REMOTE_URL: '',
  CLIENT_CLAUDE_DESKTOP: '1', CLIENT_CLAUDE_CODE: '1', CLIENT_CURSOR: '0', CLIENT_VSCODE: '0', CLIENT_LM_STUDIO: '0',
  CLAUDE_DESKTOP_METHOD: 'config', SOURCE: 'local', TOOLS: 'all', BRIEF: '0', EXPORT_DIR: '', LAN: '0', PORT: '7777',
  OLLAMA_MODEL: 'qwen3.5', OLLAMA_CONTEXT: '32768', OLLAMA_TOOLS: '3d'
}, parseEnv(fs.readFileSync(ENV_FILE, 'utf8')));
if (argv.includes('--dry-run')) E.DRY_RUN = '1';
if (argv.includes('--yes')) E.ASSUME_YES = '1';
const on = (k) => E[k] === '1' || /^(true|yes|on)$/i.test(E[k] || '');
secrets.push(E.NPM_TOKEN);
const DRY = on('DRY_RUN'), YES = on('ASSUME_YES');

function checkSettings() {
  const bad = [];
  const oneOf = (k, list) => { if (!list.includes(String(E[k]).toLowerCase())) bad.push(`${k} must be ${list.join(' or ')} (it is "${E[k]}")`); else E[k] = String(E[k]).toLowerCase(); };
  for (const k of ['DO_LOCAL_INSTALL', 'DO_CONFIGURE_CLIENTS', 'DO_OLLAMA', 'DRY_RUN', 'ASSUME_YES', 'REWRITE_EMAIL_IN_HISTORY', 'SET_NPM_TOKEN_SECRET', 'WAIT_FOR_RELEASE', 'CLIENT_CLAUDE_DESKTOP', 'CLIENT_CLAUDE_CODE', 'CLIENT_CURSOR', 'CLIENT_VSCODE', 'CLIENT_LM_STUDIO', 'BRIEF', 'LAN'])
    if (!/^(0|1|true|false|yes|no|on|off)$/i.test(E[k] || '0')) bad.push(`${k} must be 0 or 1 (it is "${E[k]}")`);
  oneOf('DO_PUBLISH', ['0', 'prep', '1']); oneOf('TOOLS', ['all', '3d', '2d']); oneOf('OLLAMA_TOOLS', ['all', '3d', '2d']); oneOf('SOURCE', ['local', 'npm']); oneOf('CLAUDE_DESKTOP_METHOD', ['config', 'bundle']); oneOf('REPO_VISIBILITY', ['public', 'private']);
  if (!/^\d{2,5}$/.test(E.PORT)) bad.push(`PORT must be a number like 7777 (it is "${E.PORT}")`);
  if (!/^\d{3,7}$/.test(E.OLLAMA_CONTEXT)) bad.push(`OLLAMA_CONTEXT must be a number like 32768 (it is "${E.OLLAMA_CONTEXT}")`);
  if (on('DO_OLLAMA') && !/^[A-Za-z0-9._:/-]+$/.test(E.OLLAMA_MODEL)) bad.push(`OLLAMA_MODEL "${E.OLLAMA_MODEL}" is not a model name like qwen3.5`);
  if (E.DO_PUBLISH !== '0') {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(E.GITHUB_USER)) bad.push(E.GITHUB_USER ? `GITHUB_USER "${E.GITHUB_USER}" is not a GitHub user name (the name in github.com/<name>, not an email)` : 'GITHUB_USER is empty — your GitHub user name is needed to publish');
    if (!/^[A-Za-z0-9._-]+$/.test(E.GITHUB_REPO)) bad.push(`GITHUB_REPO "${E.GITHUB_REPO}" is not a repository name`);
    if (!E.AUTHOR_NAME.trim()) bad.push('AUTHOR_NAME is empty — your name is needed to publish');
    if (/["`$\\]/.test(E.AUTHOR_NAME)) bad.push('AUTHOR_NAME can\'t contain " ` $ or \\');
    if (!/^[^\s@"'`$\\]+@[^\s@"'`$\\]+\.[^\s@"'`$\\]+$/.test(E.GIT_EMAIL)) bad.push(E.GIT_EMAIL ? `GIT_EMAIL "${E.GIT_EMAIL}" is not an email address` : 'GIT_EMAIL is empty — the email for your commits is needed to publish');
    if (E.NPM_TOKEN && !/^[A-Za-z0-9_\-.]{20,}$/.test(E.NPM_TOKEN)) bad.push('NPM_TOKEN does not look like an npm token (npm_… from npmjs.com > Access Tokens)');
  }
  if (bad.length) { say('\nSF3d_setup.env needs a fix:\n  - ' + bad.join('\n  - ')); process.exit(2); }
}

/* ------------------------------------------------ running commands ------------------------------------------------ */
const qWin = (a) => (/^[A-Za-z0-9_\-+=.,:/\\@]+$/.test(a) ? a : '"' + String(a).replace(/"/g, '\\"') + '"');
/* run a command. capture: return its output instead of showing it; input: text for its stdin; allowFail: no throw */
function run(cmd, args = [], o = {}) {
  const opt = { cwd: o.cwd || ROOT, env: Object.assign({}, process.env, o.env || {}), encoding: 'utf8', input: o.input, maxBuffer: 64 * 1024 * 1024, stdio: o.capture ? ['pipe', 'pipe', 'pipe'] : o.input != null ? ['pipe', 'inherit', 'inherit'] : 'inherit' };
  log('$ ' + [cmd, ...args].join(' '));
  const r = WIN ? spawnSync([cmd, ...args].map(qWin).join(' '), [], Object.assign(opt, { shell: true })) : spawnSync(cmd, args, opt);
  const res = { ok: !r.error && r.status === 0, code: r.error ? -1 : r.status, out: String(r.stdout || '').trim(), err: r.error ? r.error.message : String(r.stderr || '').trim() };
  if (o.capture) log((res.out + (res.err ? '\n' + res.err : '')).slice(-4000));
  if (!res.ok && !o.allowFail) throw new Error(`${path.basename(cmd)} ${args.slice(0, 2).join(' ')} failed (exit ${res.code})${res.err && o.capture ? ': ' + mask(res.err).split('\n').slice(-6).join(' | ') : ''}`);
  return res;
}
const node = (args, o) => run(process.execPath, args, o);
/* where a command is: its name when it is on PATH, else the first of the known install paths that exists */
function find(name, paths = []) {
  const r = WIN ? spawnSync('where', [name], { encoding: 'utf8' }) : spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  if (r.status === 0 && String(r.stdout).trim()) return name;   /* by name: on Windows cmd then picks the .cmd / .exe, never npm's extensionless shim */
  return paths.find(p => p && fs.existsSync(p)) || null;
}
async function ask(question) {
  if (YES) { log(`? ${question} → yes (ASSUME_YES)`); return true; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise(r => rl.question(`\n? ${question} [y/N] `, r)); rl.close();
  log(`? ${question} → ${a}`); return /^y(es)?$/i.test(String(a).trim());
}
/* an upload or a change that is hard to undo: shown, asked for, and only shown in a dry run */
async function outward(what, fn) {
  if (DRY) { note('dry', `would ${what}`); return null; }
  if (!(await ask(`${what[0].toUpperCase() + what.slice(1)}?`))) throw new Stop(`stopped: you said no to "${what}"`);
  return fn();
}
/* a missing tool: offer winget on Windows, else say where to get it */
async function need(label, name, { winget, paths = [], url }) {
  let p = find(name, paths); if (p) return p;
  if (WIN && winget && find('winget') && await ask(`${label} is not installed. Install it now with winget (${winget})?`)) {
    run('winget', ['install', '--id', winget, '-e', '--accept-source-agreements', '--accept-package-agreements']);
    p = find(name, paths); if (p) return p;
    throw new Stop(`${label} was installed, but this window can't see it yet — close it and run SF3d_setup.bat again`);
  }
  throw new Stop(`${label} is needed for this step: ${url}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/* ------------------------------------------------ 1 · prerequisites ------------------------------------------------ */
function prerequisites() {
  heading('Checking this computer');
  const major = +process.versions.node.split('.')[0];
  if (major < 20) throw new Stop(`Node.js ${process.versions.node} is too old — SketchFlow needs 20 or newer (https://nodejs.org)`);
  note('ok', `Node.js ${process.versions.node}`);
  const npm = run('npm', ['--version'], { capture: true, allowFail: true });
  if (!npm.ok) throw new Stop('npm is missing — reinstall Node.js from https://nodejs.org (npm comes with it)');
  note('ok', `npm ${npm.out}`);
  note('ok', `SketchFlow ${PKG.version} in ${ROOT}`);
}

/* ------------------------------------------------ 2 · local install ------------------------------------------------ */
let installedServer = null, bundleFile = null;
function globalServerPath() {
  const r = run('npm', ['root', '-g'], { capture: true, allowFail: true });
  const p = r.ok && r.out ? path.join(r.out.split(/\r?\n/).pop().trim(), PKG.name, 'server.mjs') : null;
  return p && fs.existsSync(p) ? p : null;
}
function localInstall() {
  heading('Installing SketchFlow on this computer');
  say('  running the test suites (about a minute)…');
  const t = run('npm', ['test'], { capture: true, allowFail: true });
  const counts = (t.out.match(/^\d+ passed, \d+ failed.*$/gm) || []);
  if (!t.ok) throw new Error('the test suites failed — see SF3d_setup.log (' + counts.filter(l => !/ 0 failed/.test(l)).join('; ') + ')');
  note('ok', `test suites pass`, `${counts.length} suites, ${counts.reduce((n, l) => n + +l.split(' ')[0], 0)} checks`);
  const s = node([path.join(ROOT, 'scripts', 'smoke.mjs')], { capture: true, allowFail: true });
  if (!s.ok) throw new Error('the MCP smoke test failed — see SF3d_setup.log');
  note('ok', 'MCP server smoke test passes');
  fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true });
  const p = run('npm', ['pack', '--pack-destination', path.join(ROOT, 'release')], { capture: true });
  const tgz = path.join(ROOT, 'release', p.out.split(/\r?\n/).pop().trim());
  if (!fs.existsSync(tgz)) throw new Error('npm pack made no package');
  note('ok', 'packed', path.relative(ROOT, tgz));
  run('npm', ['install', '-g', tgz], { capture: true });
  installedServer = globalServerPath();
  if (!installedServer) throw new Error('installed, but npm root -g has no sketchflow-mcp');
  const v = node([installedServer, '--version'], { capture: true });
  if (v.out !== PKG.version) throw new Error(`the installed copy says ${v.out}, not ${PKG.version}`);
  const s2 = node([path.join(ROOT, 'scripts', 'smoke.mjs'), '--bin', installedServer], { capture: true, allowFail: true });
  if (!s2.ok) throw new Error('the installed copy failed the smoke test — see SF3d_setup.log');
  note('ok', `installed sketchflow-mcp ${v.out}`, installedServer);
  const b = node([path.join(ROOT, 'scripts', 'bundle-mcpb.mjs')], { capture: true });
  bundleFile = path.join(ROOT, 'release', `sketchflow-${PKG.version}.mcpb`);
  note('ok', 'Claude Desktop bundle', path.relative(ROOT, bundleFile) + ' (' + (b.out.match(/[\d.]+ MB/) || [''])[0] + ')');
}

/* ------------------------------------------------ 3 · publish ------------------------------------------------ */
const git = (args, o = {}) => run(gitBin, args, o);
let gitBin = 'git', ghBin = 'gh';
const clean = () => git(['status', '--porcelain'], { capture: true }).out.split(/\r?\n/).filter(Boolean);
async function publish() {
  const repo = `${E.GITHUB_USER}/${E.GITHUB_REPO}`, remoteUrl = E.GIT_REMOTE_URL || `https://github.com/${repo}.git`;
  heading(E.DO_PUBLISH === 'prep' ? 'Getting the repository ready to publish' : `Publishing the beta: github.com/${repo}, npm, MCP Registry`);
  gitBin = await need('Git', 'git', { winget: 'Git.Git', paths: [WIN && path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe')], url: 'https://git-scm.com/downloads' });
  if (!git(['rev-parse', '--is-inside-work-tree'], { capture: true, allowFail: true }).ok) throw new Stop(`${ROOT} is not a git repository — extract the full SketchFlow zip (it includes the .git folder)`);
  /* a: who the commits are from */
  git(['config', 'user.name', E.AUTHOR_NAME]); git(['config', 'user.email', E.GIT_EMAIL]);
  note('ok', 'commit identity', `${E.AUTHOR_NAME} <${E.GIT_EMAIL}>`);
  const origin = git(['remote', 'get-url', 'origin'], { capture: true, allowFail: true });
  const pushed = origin.ok && git(['ls-remote', '--heads', 'origin'], { capture: true, allowFail: true }).out.length > 0;
  /* b: the email on the commits already made */
  const emails = [...new Set(git(['log', '--all', '--format=%ae%n%ce'], { capture: true }).out.split(/\r?\n/).filter(Boolean))];
  const others = emails.filter(e => e.toLowerCase() !== E.GIT_EMAIL.toLowerCase());
  if (!others.length) note('ok', 'every commit already has ' + E.GIT_EMAIL);
  else if (!on('REWRITE_EMAIL_IN_HISTORY')) note('warn', `existing commits show ${others.join(', ')}`, 'a public repository shows it; set REWRITE_EMAIL_IN_HISTORY=1 to change it before the first push');
  else if (pushed) note('warn', `existing commits show ${others.join(', ')}`, 'the history is already on GitHub, so it is not rewritten now');
  else {
    if (clean().length) throw new Stop('there are uncommitted changes in this folder — commit or discard them first (git status), then run again');
    await outward(`change the email on all ${git(['rev-list', '--all', '--count'], { capture: true }).out} existing commits from ${others.join(', ')} to ${E.GIT_EMAIL} (a backup is saved first)`, () => {
      const backup = path.join(ROOT, 'release', `backup-before-email-change-${stamp()}.bundle`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      git(['bundle', 'create', backup, '--all'], { capture: true });
      git(['filter-branch', '-f', '--env-filter', `export GIT_AUTHOR_EMAIL='${E.GIT_EMAIL}'; export GIT_COMMITTER_EMAIL='${E.GIT_EMAIL}'`, '--tag-name-filter', 'cat', '--', '--all'], { capture: true, env: { FILTER_BRANCH_SQUELCH_WARNING: '1' } });
      for (const ref of git(['for-each-ref', '--format=%(refname)', 'refs/original/'], { capture: true }).out.split(/\r?\n/).filter(Boolean)) git(['update-ref', '-d', ref]);
      const left = git(['log', '--all', '--format=%ae%n%ce'], { capture: true }).out.split(/\r?\n/).filter(e => e && e.toLowerCase() !== E.GIT_EMAIL.toLowerCase());
      if (left.length) throw new Error('some commits still show another email: ' + [...new Set(left)].join(', '));
      note('ok', `commits now show ${E.GIT_EMAIL}`, `backup: ${path.relative(ROOT, backup)} (git clone it to get the old history back)`);
    });
  }
  /* c: tie the package to the repository, write server.json */
  const dirty = clean().filter(l => !/ (package\.json|server\.json)$/.test(l));
  if (dirty.length) throw new Stop('there are uncommitted changes in this folder (' + dirty.slice(0, 3).map(l => l.slice(3)).join(', ') + ') — commit or discard them first, then run again');
  node([path.join(ROOT, 'scripts', 'release-prep.mjs'), '--owner', E.GITHUB_USER, '--repo', E.GITHUB_REPO, '--author', E.AUTHOR_NAME], { capture: true });
  const prepChanged = clean().length > 0;
  if (prepChanged) { git(['add', 'package.json', 'server.json']); git(['commit', '-q', '-m', `Release prep: github.com/${repo}, npm ${PKG.name}, MCP Registry io.github.${E.GITHUB_USER}/sketchflow`]); }
  node([path.join(ROOT, 'scripts', 'release-prep.mjs'), '--check'], { capture: true });
  note('ok', prepChanged ? 'release prep committed' : 'release prep already done', `mcpName io.github.${E.GITHUB_USER}/sketchflow, server.json`);
  /* d: main = the current work */
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).out;
  const branches = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { capture: true }).out.split(/\r?\n/).filter(Boolean);
  let main = head;
  if (head !== 'main' && branches.includes('main')) {
    if (git(['merge-base', '--is-ancestor', 'main', 'HEAD'], { allowFail: true, capture: true }).ok) { git(['fetch', '-q', '.', `${head}:main`], { capture: true }); main = 'main'; note('ok', `main brought up to ${head}`); }
    else note('warn', `main has commits ${head} does not — releasing from ${head}`, 'main is left as it is');
  } else if (head === 'main') note('ok', 'on main');
  if (E.DO_PUBLISH === 'prep') { note('ok', 'ready to publish', 'look with git log; set DO_PUBLISH=1 and run again to upload'); return; }

  /* e: GitHub */
  ghBin = await need('The GitHub CLI', 'gh', { winget: 'GitHub.cli', paths: [WIN && path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe')], url: 'https://cli.github.com' });
  const gh = (args, o = {}) => run(ghBin, args, o);
  if (!gh(['auth', 'status', '--hostname', 'github.com'], { capture: true, allowFail: true }).ok) {
    say('  signing in to GitHub (a browser opens; follow it)…');
    gh(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
  }
  const login = gh(['api', 'user', '--jq', '.login'], { capture: true }).out.trim();
  if (login.toLowerCase() !== E.GITHUB_USER.toLowerCase() && !gh(['api', `orgs/${E.GITHUB_USER}`, '--jq', '.login'], { capture: true, allowFail: true }).ok)
    throw new Stop(`you are signed in to GitHub as ${login}, but GITHUB_USER is ${E.GITHUB_USER} — fix one of them (gh auth login) and run again`);
  note('ok', `signed in to GitHub as ${login}`);
  gh(['auth', 'setup-git'], { capture: true, allowFail: true });
  if (gh(['repo', 'view', repo, '--json', 'name'], { capture: true, allowFail: true }).ok) note('ok', `github.com/${repo} exists`);
  else await outward(`create the ${E.REPO_VISIBILITY} repository github.com/${repo}`, () => { gh(['repo', 'create', repo, `--${E.REPO_VISIBILITY}`, '--description', PKG.description.slice(0, 300)], { capture: true }); note('ok', `created github.com/${repo}`); });
  if (!origin.ok) git(['remote', 'add', 'origin', remoteUrl]);
  else if (origin.out.replace(/\.git$/, '').toLowerCase() !== remoteUrl.replace(/\.git$/, '').toLowerCase()) throw new Stop(`this folder's remote "origin" is ${origin.out}, not ${remoteUrl} — change it (git remote set-url origin ${remoteUrl}) or GITHUB_USER / GITHUB_REPO`);
  const toPush = ['main', 'v1', 'v2', head].filter((b, i, a) => branches.includes(b) && a.indexOf(b) === i);
  await outward(`push ${toPush.join(', ')} and the existing tags to github.com/${repo}`, () => {
    git(['push', '-u', 'origin', ...toPush]); git(['push', 'origin', '--tags']);
    note('ok', `pushed ${toPush.join(', ')}`);
    if (main === 'main' && !DRY) gh(['repo', 'edit', repo, '--default-branch', 'main'], { capture: true, allowFail: true });
  });

  /* f: npm */
  const npmrc = E.NPM_TOKEN ? path.join(os.tmpdir(), `sf3d-npmrc-${process.pid}-${Date.now()}`) : null;
  const npmEnv = npmrc ? { npm_config_userconfig: npmrc } : {};
  try {
    if (npmrc) fs.writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${E.NPM_TOKEN}\n`, { mode: 0o600 });
    const npm = (args, o = {}) => run('npm', args, Object.assign({ env: npmEnv }, o));
    const published = npm(['view', `${PKG.name}@${readVersion()}`, 'version'], { capture: true, allowFail: true });
    if (published.ok && published.out.trim() === readVersion()) note('ok', `${PKG.name}@${readVersion()} is already on npm`);
    else {
      let who = npm(['whoami'], { capture: true, allowFail: true });
      if (!who.ok && !npmrc && !DRY) { say('  signing in to npm (a browser opens; follow it)…'); npm(['login']); who = npm(['whoami'], { capture: true, allowFail: true }); }
      if (!who.ok && !DRY) throw new Stop(npmrc ? 'npm does not accept NPM_TOKEN — make a new granular token with read and write access (npmjs.com > Access Tokens)' : 'not signed in to npm');
      if (who.ok) note('ok', `npm user ${who.out}`);
      const exists = npm(['view', PKG.name, 'maintainers', '--json'], { capture: true, allowFail: true });
      if (exists.ok && exists.out && who.ok && !exists.out.includes(`"${who.out}`) && !exists.out.includes(`${who.out} <`)) throw new Stop(`the npm name ${PKG.name} belongs to someone else — change "name" in package.json`);
      const tag = readVersion().includes('-') ? 'beta' : 'latest';
      await outward(`publish ${PKG.name}@${readVersion()} to npm (tag ${tag}; it runs the tests first)`, () => {
        npm(['publish', '--access', 'public', '--tag', tag, ...E.NPM_PUBLISH_ARGS.split(/\s+/).filter(Boolean)]);
        note('ok', `published ${PKG.name}@${readVersion()}`, `https://www.npmjs.com/package/${PKG.name}`);
      });
    }
  } finally { if (npmrc && fs.existsSync(npmrc)) fs.rmSync(npmrc, { force: true }); }
  if (E.NPM_TOKEN && on('SET_NPM_TOKEN_SECRET')) await outward(`store NPM_TOKEN as the GitHub Actions secret of ${repo}`, () => { gh(['secret', 'set', 'NPM_TOKEN', '--repo', repo], { input: E.NPM_TOKEN, capture: true }); note('ok', 'NPM_TOKEN secret stored', 'later releases publish from GitHub'); });
  else if (!E.NPM_TOKEN) note('warn', 'no NPM_TOKEN secret on GitHub', `later releases from GitHub need it: github.com/${repo}/settings/secrets/actions`);

  /* g: the release tag → GitHub release with the .mcpb, MCP Registry */
  const tag = `v${readVersion()}`;
  const remoteTag = git(['ls-remote', '--tags', 'origin', tag], { capture: true, allowFail: true }).out;
  if (remoteTag) note('ok', `${tag} is already on GitHub`);
  else await outward(`push the release tag ${tag} (GitHub then makes the release with the .mcpb and lists it in the MCP Registry)`, () => {
    const at = git(['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`], { capture: true, allowFail: true }), headSha = git(['rev-parse', 'HEAD'], { capture: true }).out;
    if (!at.ok) git(['tag', tag]); else if (at.out !== headSha) git(['tag', '-f', tag]);   /* a tag left from an earlier run moves to the release commit */
    git(['push', 'origin', tag]); note('ok', `pushed ${tag}`);
  });
  if (on('WAIT_FOR_RELEASE') && !DRY) {
    say('  waiting for the release on GitHub…');
    let runId = null;
    for (let i = 0; i < 24 && !runId; i++) {
      const l = gh(['run', 'list', '--repo', repo, '--workflow', 'release.yml', '--limit', '10', '--json', 'databaseId,headBranch,status,conclusion'], { capture: true, allowFail: true });
      try { const hit = JSON.parse(l.out || '[]').find(r => r.headBranch === tag); if (hit) runId = String(hit.databaseId); } catch (e) { /* not JSON yet */ }
      if (!runId) await sleep(5000);
    }
    if (!runId) note('warn', 'the release workflow has not started yet', `see github.com/${repo}/actions`);
    else {
      const w = gh(['run', 'watch', runId, '--repo', repo, '--exit-status', '--interval', '10'], { allowFail: true });
      if (w.ok) note('ok', 'GitHub release and MCP Registry done', `https://github.com/${repo}/releases/tag/${tag}`);
      else note('fail', 'the release workflow failed', `https://github.com/${repo}/actions/runs/${runId}`);
    }
  }
  say(`\n  npm:          https://www.npmjs.com/package/${PKG.name}\n  GitHub:       https://github.com/${repo}\n  release:      https://github.com/${repo}/releases/tag/${tag}\n  MCP Registry: https://registry.modelcontextprotocol.io/v0/servers?search=io.github.${E.GITHUB_USER}/sketchflow`);
}
const readVersion = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/* ------------------------------------------------ 4 · AI apps ------------------------------------------------ */
function serverEntry(forOllama) {
  const tools = forOllama ? E.OLLAMA_TOOLS : E.TOOLS, flags = [];
  if (tools !== 'all') flags.push(`--tools=${tools}`);
  if (forOllama || on('BRIEF')) flags.push('--brief');
  if (on('LAN')) flags.push('--lan');
  if (E.PORT !== '7777') flags.push(`--port=${E.PORT}`);
  if (E.EXPORT_DIR) flags.push(`--export-dir=${E.EXPORT_DIR}`);
  if (E.SOURCE === 'npm') return WIN ? { command: 'cmd', args: ['/c', 'npx', '-y', `${PKG.name}@beta`, ...flags] } : { command: 'npx', args: ['-y', `${PKG.name}@beta`, ...flags] };
  const server = installedServer || globalServerPath() || path.join(ROOT, 'server.mjs');
  return { command: process.execPath, args: [server, ...flags] };
}
/* add SketchFlow to an app's JSON settings (backed up first; a file that is not valid JSON is left alone) */
function mergeConfig(label, file, key, entry) {
  let cfg = {};
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    if (text.trim()) { try { cfg = JSON.parse(text); } catch (e) { note('warn', `${label}: ${file} is not valid JSON`, 'left as it is — fix it and run again'); return; } }
    const backup = `${file}.bak-${stamp()}`; fs.copyFileSync(file, backup); log(`backup ${backup}`);
  }
  if (typeof cfg !== 'object' || Array.isArray(cfg) || cfg === null) { note('warn', `${label}: ${file} is not a settings object`, 'left as it is'); return; }
  cfg[key] = Object.assign({}, cfg[key] || {}, { sketchflow: entry });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  note('ok', label, file);
}
function openFile(f) { run(WIN ? 'explorer' : MAC ? 'open' : 'xdg-open', [f], { allowFail: true }); }   /* the app the file type belongs to */
function clients() {
  heading('Adding SketchFlow to your AI apps');
  if (E.SOURCE === 'npm') {
    const v = run('npm', ['view', `${PKG.name}@beta`, 'version'], { capture: true, allowFail: true });
    if (!v.ok) note('warn', `${PKG.name}@beta is not on npm yet`, 'the apps will fail to start it until it is published — use SOURCE=local until then');
  }
  const entry = serverEntry(false), home = os.homedir(), appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  say(`  command: ${[entry.command, ...entry.args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  if (on('CLIENT_CLAUDE_DESKTOP')) {
    if (E.CLAUDE_DESKTOP_METHOD === 'bundle') {
      const f = bundleFile && fs.existsSync(bundleFile) ? bundleFile : (node([path.join(ROOT, 'scripts', 'bundle-mcpb.mjs')], { capture: true }), path.join(ROOT, 'release', `sketchflow-${PKG.version}.mcpb`));
      openFile(f); note('ok', 'Claude Desktop: opened the bundle', 'press Install in Claude Desktop');
    } else {
      const files = [];
      if (WIN) {
        const pk = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
        if (fs.existsSync(pk)) for (const d of fs.readdirSync(pk)) if (/^(claude|anthropic)/i.test(d)) { const c = path.join(pk, d, 'LocalCache', 'Roaming', 'Claude'); if (fs.existsSync(c)) files.push(path.join(c, 'claude_desktop_config.json')); }
        if (!files.length || fs.existsSync(path.join(appData, 'Claude'))) files.push(path.join(appData, 'Claude', 'claude_desktop_config.json'));
      } else files.push(MAC ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') : path.join(home, '.config', 'Claude', 'claude_desktop_config.json'));
      for (const f of files) mergeConfig('Claude Desktop (restart it to load SketchFlow)', f, 'mcpServers', entry);
    }
  }
  if (on('CLIENT_CLAUDE_CODE')) {
    const claude = find('claude', [WIN && path.join(appData, 'npm', 'claude.cmd'), path.join(home, '.local', 'bin', WIN ? 'claude.exe' : 'claude')]);
    if (!claude) note('warn', 'Claude Code is not installed', 'skipped (https://claude.com/claude-code)');
    else {
      run(claude, ['mcp', 'remove', 'sketchflow', '--scope', 'user'], { capture: true, allowFail: true });
      run(claude, ['mcp', 'add', '--scope', 'user', 'sketchflow', '--', entry.command, ...entry.args], { capture: true });
      note('ok', 'Claude Code', 'all projects (claude mcp list shows it)');
    }
  }
  if (on('CLIENT_CURSOR')) mergeConfig('Cursor', path.join(home, '.cursor', 'mcp.json'), 'mcpServers', entry);
  if (on('CLIENT_VSCODE')) mergeConfig('VS Code', WIN ? path.join(appData, 'Code', 'User', 'mcp.json') : MAC ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json') : path.join(home, '.config', 'Code', 'User', 'mcp.json'), 'servers', Object.assign({ type: 'stdio' }, entry));
  if (on('CLIENT_LM_STUDIO')) mergeConfig('LM Studio', path.join(home, '.lmstudio', 'mcp.json'), 'mcpServers', entry);
}

/* ------------------------------------------------ 5 · Ollama ------------------------------------------------ */
async function ollama() {
  heading(`Local model: Ollama + ${E.OLLAMA_MODEL} + ollmcp`);
  const home = os.homedir(), local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  let ol = find('ollama', [WIN && path.join(local, 'Programs', 'Ollama', 'ollama.exe'), MAC && '/Applications/Ollama.app/Contents/Resources/ollama', '/usr/local/bin/ollama']);
  if (!ol) {
    if (WIN) ol = await need('Ollama', 'ollama', { winget: 'Ollama.Ollama', paths: [path.join(local, 'Programs', 'Ollama', 'ollama.exe')], url: 'https://ollama.com/download' });
    else throw new Stop(MAC ? 'Ollama is not installed — get it from https://ollama.com/download, then run again' : 'Ollama is not installed — see https://ollama.com/download/linux, then run again');
  }
  note('ok', 'Ollama', run(ol, ['--version'], { capture: true, allowFail: true }).out.split(/\r?\n/).pop());
  if (!run(ol, ['list'], { capture: true, allowFail: true }).ok) {
    say('  starting Ollama…'); spawn(ol, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 10 && !run(ol, ['list'], { capture: true, allowFail: true }).ok; i++) await sleep(1500);
  }
  const have = run(ol, ['list'], { capture: true, allowFail: true });
  if (!have.ok) throw new Error('Ollama is installed but not running — start the Ollama app, then run again');
  const base = E.OLLAMA_MODEL.includes(':') ? E.OLLAMA_MODEL : E.OLLAMA_MODEL + ':latest';
  if (have.out.split(/\r?\n/).some(l => l.split(/\s+/)[0] === base || l.split(/\s+/)[0] === E.OLLAMA_MODEL)) note('ok', `${E.OLLAMA_MODEL} is already downloaded`);
  else if (await ask(`Download the model ${E.OLLAMA_MODEL} (several GB)?`)) { run(ol, ['pull', E.OLLAMA_MODEL]); note('ok', `downloaded ${E.OLLAMA_MODEL}`); }
  else note('warn', `${E.OLLAMA_MODEL} not downloaded`, `run: ollama pull ${E.OLLAMA_MODEL}`);
  /* context window */
  if (WIN) { run('setx', ['OLLAMA_CONTEXT_LENGTH', E.OLLAMA_CONTEXT], { capture: true }); note('ok', `OLLAMA_CONTEXT_LENGTH=${E.OLLAMA_CONTEXT}`, 'quit Ollama from the tray and start it again to use it'); }
  else if (MAC) { run('launchctl', ['setenv', 'OLLAMA_CONTEXT_LENGTH', E.OLLAMA_CONTEXT], { capture: true, allowFail: true }); note('ok', `OLLAMA_CONTEXT_LENGTH=${E.OLLAMA_CONTEXT}`, 'quit Ollama and open it again to use it'); }
  else note('warn', 'context window', `start Ollama with OLLAMA_CONTEXT_LENGTH=${E.OLLAMA_CONTEXT} (e.g. in its systemd unit: Environment="OLLAMA_CONTEXT_LENGTH=${E.OLLAMA_CONTEXT}")`);
  /* ollmcp, through uv (it brings its own Python) or pip */
  let ollmcp = find('ollmcp');
  if (!ollmcp) {
    let uv = find('uv', [path.join(home, '.local', 'bin', WIN ? 'uv.exe' : 'uv'), path.join(home, '.cargo', 'bin', WIN ? 'uv.exe' : 'uv')]);
    if (!uv && WIN && find('winget') && await ask('ollmcp needs uv (a Python tool installer). Install uv with winget (astral-sh.uv)?')) { run('winget', ['install', '--id', 'astral-sh.uv', '-e', '--accept-source-agreements', '--accept-package-agreements']); uv = find('uv', [path.join(home, '.local', 'bin', 'uv.exe')]); }
    if (uv) {
      run(uv, ['tool', 'install', '--upgrade', 'ollmcp'], { capture: true });
      const bin = run(uv, ['tool', 'dir', '--bin'], { capture: true }).out.split(/\r?\n/).pop().trim();
      ollmcp = [path.join(bin, WIN ? 'ollmcp.exe' : 'ollmcp')].find(p => fs.existsSync(p)) || null;
    } else {
      const py = find(WIN ? 'py' : 'python3') || find('python');
      if (!py) throw new Stop('ollmcp needs Python 3.11+ or uv — install uv (https://docs.astral.sh/uv/) and run again');
      const pyArgs = WIN && /py(\.exe)?$/i.test(py) ? ['-3'] : [];
      if (run(py, [...pyArgs, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'], { capture: true, allowFail: true }).code !== 0) throw new Stop('ollmcp needs Python 3.11 or newer (or uv: https://docs.astral.sh/uv/)');
      run(py, [...pyArgs, '-m', 'pip', 'install', '--user', '--upgrade', 'ollmcp'], { capture: true });
      const scripts = run(py, [...pyArgs, '-c', `import sysconfig; print(sysconfig.get_path('scripts', '${WIN ? 'nt' : 'posix'}_user'))`], { capture: true }).out.trim();
      ollmcp = [path.join(scripts, WIN ? 'ollmcp.exe' : 'ollmcp')].find(p => fs.existsSync(p)) || find('ollmcp');
    }
  }
  if (!ollmcp) throw new Error('ollmcp was installed but can\'t be found — open a new window and run: ollmcp --help');
  note('ok', 'ollmcp', ollmcp);
  /* its settings and a starter */
  const servers = path.join(ROOT, 'sketchflow-servers.json');
  fs.writeFileSync(servers, JSON.stringify({ mcpServers: { sketchflow: serverEntry(true) } }, null, 2) + '\n');
  note('ok', 'ollmcp settings', servers);
  if (WIN) {
    const bat = path.join(ROOT, 'SF3d_ollama.bat');
    fs.writeFileSync(bat, ['@echo off', 'rem Starts the local model with SketchFlow (written by SF3d_setup.bat; run SF3d_setup.bat again to change it)', 'title SketchFlow + Ollama', `"${ollmcp}" -j "${servers}" -m ${E.OLLAMA_MODEL}`, 'pause', ''].join('\r\n'));
    note('ok', 'starter', `${bat} — double-click it, then ask: open the 3D model and build a 100 x 60 x 8 plate`);
  } else {
    const sh = path.join(ROOT, 'SF3d_ollama.sh');
    fs.writeFileSync(sh, `#!/bin/sh\n# Starts the local model with SketchFlow (written by the setup)\nexec "${ollmcp}" -j "${servers}" -m ${E.OLLAMA_MODEL}\n`, { mode: 0o755 });
    note('ok', 'starter', `${sh}`);
  }
}

/* ------------------------------------------------ run ------------------------------------------------ */
(async () => {
  say(`SketchFlow ${PKG.version} setup${DRY ? ' — DRY RUN: nothing is uploaded and the history is not changed' : ''}`);
  checkSettings();
  let code = 0;
  const steps = [['prerequisites', true, prerequisites], ['local install', on('DO_LOCAL_INSTALL'), localInstall], ['publish', E.DO_PUBLISH !== '0', publish], ['AI apps', on('DO_CONFIGURE_CLIENTS'), clients], ['Ollama', on('DO_OLLAMA'), ollama]];
  for (const [name, wanted, fn] of steps) {
    if (!wanted) continue;
    try { await fn(); }
    catch (e) {
      code = 1; note('fail', name, e.message);
      if (name === 'prerequisites' || e instanceof Stop) break;
    }
  }
  heading('Summary');
  const n = (s) => results.filter(r => r.status === s).length;
  say(`  ${n('ok')} done, ${n('warn')} to look at, ${n('fail')} failed${n('dry') ? `, ${n('dry')} shown only (dry run)` : ''} — the full log is ${LOG_FILE}`);
  for (const r of results.filter(r => r.status === 'warn' || r.status === 'fail')) say(`  ${r.status === 'fail' ? '✗' : '!'} ${r.what}${r.detail ? ' — ' + r.detail : ''}`);
  if (!code && on('DO_CONFIGURE_CLIENTS')) say('\n  Next: restart your AI app and ask it to "open the SketchFlow 3D model".');
  process.exit(code);
})();
