#!/usr/bin/env node
// scripts/doctor.mjs — preflight + onboarding gate.
// Usage: node scripts/doctor.mjs [--fix] [--json]
//   --fix  create missing data dirs and copy the _profile template
// Exit 0 = ready; exit 1 = something blocks normal operation.

import { existsSync, mkdirSync, readFileSync, copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const JSON_OUT = args.includes('--json');
// ASCII status markers for non-interactive/piped output (or with --plain); emoji on a TTY.
const PLAIN = args.includes('--plain') || !process.stdout.isTTY;

const DATA_DIRS = [
  'data', 'data/jds', 'data/reports', 'data/output', 'data/writing-samples',
  'data/interview-prep', 'data/style', 'data/style/edits', 'data/cv-sources',
  'data/batch', 'data/batch/tracker-additions', 'data/batch/merged',
  'data/ui', 'data/ui/results', 'data/ui/uploads',
];

const checks = [];
const add = (name, ok, detail, level = 'error') => checks.push({ name, ok, detail, level });

function cmdOk(cmd, vArgs = ['--version']) {
  try { execFileSync(cmd, vArgs, { stdio: 'pipe' }); return true; } catch { return false; }
}

// --- runtime ---
const major = Number(process.versions.node.split('.')[0]);
add('node >= 20', major >= 20, `node ${process.versions.node}`);
add('tectonic installed', cmdOk('tectonic'), 'brew install tectonic');
add('pdftotext installed (ATS smoke test)', cmdOk('pdftotext', ['-v']),
    'brew install poppler — without it the ATS smoke test is skipped', 'warn');

// --- data dirs ---
let dirsOk = true;
for (const d of DATA_DIRS) {
  const p = join(ROOT, d);
  if (!existsSync(p)) {
    if (FIX) { mkdirSync(p, { recursive: true }); }
    else dirsOk = false;
  }
}
add('data directories present', dirsOk, dirsOk ? 'ok' : 'run: node scripts/doctor.mjs --fix');

// --- _profile.md (copy template if missing) ---
const profileMdPath = join(ROOT, 'data', '_profile.md');
const profileTpl = join(ROOT, 'modes', '_profile.template.md');
if (!existsSync(profileMdPath) && FIX && existsSync(profileTpl)) {
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  copyFileSync(profileTpl, profileMdPath);
}
add('data/_profile.md present', existsSync(profileMdPath),
    'copied from template on --fix', 'warn');

// --- profile.yml present & not example ---
const profileYml = join(ROOT, 'data', 'profile.yml');
if (existsSync(profileYml)) {
  const txt = readFileSync(profileYml, 'utf8');
  const isExample = txt.includes('Jane Q. Candidate') || txt.includes('jane@example.com');
  add('data/profile.yml is real (not example)', !isExample,
      isExample ? 'still contains example data — fill in your details' : 'ok');
} else {
  add('data/profile.yml present', false,
      'run /cos onboard (or copy templates/profile.example.yml -> data/profile.yml and fill it in)');
}

// --- cv.master.md present & non-trivial ---
const cvMaster = join(ROOT, 'data', 'cv.master.md');
if (existsSync(cvMaster) && statSync(cvMaster).size > 200) {
  add('data/cv.master.md present', true, 'ok');
} else {
  add('data/cv.master.md present', false,
      'run /cos onboard — drop in your CV (PDF/Word/text) and it seeds this from your real experience');
}

// --- templates present (system integrity) ---
const tplOk = ['templates/cv.tex.tmpl', 'templates/cl.tex.tmpl', 'templates/states.yml']
  .every((f) => existsSync(join(ROOT, f)));
add('core templates present', tplOk, 'system files intact');

// --- web UI deps (optional; only needed to run the local control panel) ---
add('web UI deps installed', existsSync(join(ROOT, 'web', 'node_modules')),
    'optional — run `cd web && npm install` then `npm run dev` (or /cos ui) for the dashboard', 'warn');

// --- python-jobspy sidecar (optional; powers the multi-board "fetch recent") ---
const venvPy = existsSync(join(ROOT, '.venv', 'bin', 'python'))
  ? join(ROOT, '.venv', 'bin', 'python')
  : existsSync(join(ROOT, '.venv', 'Scripts', 'python.exe'))
    ? join(ROOT, '.venv', 'Scripts', 'python.exe')
    : null;
let jobspyOk = false;
if (venvPy) { try { execFileSync(venvPy, ['-c', 'import jobspy'], { stdio: 'pipe' }); jobspyOk = true; } catch { /* not installed */ } }
add('job-board fetch (python-jobspy) ready', jobspyOk,
    'optional — run `npm run jobspy:install` to enable multi-board Fetch recent (Indeed/ZipRecruiter/Google)', 'warn');

// --- markitdown CV parser (optional; deterministic uploaded-CV → Markdown) ---
let markitdownOk = false;
if (venvPy) { try { execFileSync(venvPy, ['-c', 'import markitdown'], { stdio: 'pipe' }); markitdownOk = true; } catch { /* not installed */ } }
add('CV parser (markitdown) ready', markitdownOk,
    'optional — run `npm run jobspy:install` for the best uploaded-CV → Markdown parse (PDFs fall back to pdftotext)', 'warn');

const errors = checks.filter((c) => !c.ok && c.level === 'error');
const warns = checks.filter((c) => !c.ok && c.level === 'warn');
const ready = errors.length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({ ready, checks }, null, 2));
} else {
  console.log('careeros doctor\n');
  for (const c of checks) {
    const icon = PLAIN
      ? (c.ok ? '[OK]  ' : c.level === 'warn' ? '[WARN]' : '[FAIL]')
      : (c.ok ? '✅' : c.level === 'warn' ? '⚠️ ' : '❌');
    console.log(`  ${icon} ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
  }
  console.log('');
  if (ready && warns.length === 0) console.log(PLAIN ? 'Ready.' : 'Ready. ✅');
  else if (ready) console.log(PLAIN ? 'Ready (with warnings).' : 'Ready (with warnings). ⚠️');
  else console.log(`Not ready: ${errors.length} blocking issue(s). Fix above, or run with --fix for the auto-fixable ones.`);
}

process.exit(ready ? 0 : 1);
