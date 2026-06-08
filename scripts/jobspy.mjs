#!/usr/bin/env node
// scripts/jobspy.mjs — zero-token multi-board job fetch (Indeed, ZipRecruiter,
// Google Jobs) via the python-jobspy sidecar (scripts/jobspy_fetch.py), folded
// into the SAME dedup + persistence engine as `scan` and `hunt`:
//
//   jobspy_fetch.py  → raw postings (stdout JSON, per-board diagnostics on stderr)
//   hunt-ingest.mjs  → coerce + dedup (scan-history + inbox + tracker) + save JDs
//   board.mjs        → ranks them (run separately, or refresh the web board)
//
// Because it ingests through hunt-ingest, a posting found here is deduped against
// everything `scan` and the MCP `hunt` already saw — you never get it twice.
//
// Country + city are first-class filters (JobSpy country_indeed + location).
// LinkedIn is DEFERRED by default (rate-limited/blocked); enable via --boards.
// Search terms default to your data/profile.yml target_roles. The Python sidecar
// is the only non-Node dependency in the project — install it once with
// `npm run jobspy:install`. Without it, this script fails with a clear hint
// (it never fabricates listings).
//
// Usage:
//   node scripts/jobspy.mjs                                  # profile-driven, JSON
//   node scripts/jobspy.mjs --country Germany --city Berlin --recent 7
//   node scripts/jobspy.mjs --search "data engineer,ml engineer" --results 25
//   node scripts/jobspy.mjs --boards indeed,zip_recruiter,google,linkedin
//   node scripts/jobspy.mjs --remote
//   node scripts/jobspy.mjs --dry-run          # fetch + preview, write nothing
//   node scripts/jobspy.mjs --summary          # human-readable output
//   node scripts/jobspy.mjs --self-test

import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import { ingest, coerceItem } from './hunt-ingest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PY_SCRIPT = join(ROOT, 'scripts', 'jobspy_fetch.py');
const PROFILE = join(ROOT, 'data', 'profile.yml');

// Glassdoor added to the default sweep for breadth (it covers EU/UK/CA well where
// ZipRecruiter is US/CA-only). LinkedIn stays deferred (rate-limits hardest) but is
// available via --boards. Per-board failures degrade gracefully in the sidecar.
const DEFAULT_BOARDS = ['indeed', 'zip_recruiter', 'glassdoor', 'google'];
const DEFAULT_COUNTRY = 'Luxembourg';
const DEFAULT_RESULTS = 40; // per board per search term (was 20) — pull more per role

// ─── pure helpers (exported for --self-test) ──────────────────────────

// A board recency window in days → JobSpy hours_old (null = no limit).
export function recentToHours(days) {
  const n = Number(days);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) * 24 : null;
}

export function splitList(s) {
  return String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// Resolve the interpreter: prefer the project venv, else the platform python.
export function pythonBin(root = ROOT, platform = process.platform) {
  const posix = join(root, '.venv', 'bin', 'python');
  const win = join(root, '.venv', 'Scripts', 'python.exe');
  if (existsSync(posix)) return posix;
  if (existsSync(win)) return win;
  return platform === 'win32' ? 'python' : 'python3';
}

// Build the sidecar config from profile defaults + CLI overrides. Pure: the
// profile object is injected so this is unit-testable without touching disk.
export function deriveConfig(profile, args) {
  const p = profile || {};
  const roles = (((p.target_roles || {}).primary) || []).filter((x) => typeof x === 'string' && x.trim());
  const loc = p.location || {};
  const jp = p.jobspy || {}; // optional user override block in profile.yml

  let search_terms = args.search?.length
    ? args.search
    : (jp.search_terms && jp.search_terms.length ? jp.search_terms : (roles.length ? roles : ['data engineer']));

  // Job type: JobSpy only understands fulltime|parttime|internship|contract. PhD
  // and Post-Doc aren't JobSpy types, so we DON'T pass them as job_type — instead
  // we widen the search terms (e.g. "PhD Data Scientist", "Postdoctoral researcher")
  // so the fetch actually returns academic postings; the board's display filter then
  // narrows them by title. "temporary" likewise isn't a JobSpy type → left unset.
  const rawType = String(args.jobType || jp.job_type || '').trim().toLowerCase();
  const JOBSPY_TYPES = new Set(['fulltime', 'parttime', 'internship', 'contract']);
  const ACADEMIC = {
    phd: { prefix: 'PhD', extra: ['PhD position', 'Doctoral researcher'] },
    postdoc: { prefix: 'Postdoctoral', extra: ['Postdoctoral researcher', 'Postdoc'] },
  };
  if (ACADEMIC[rawType]) {
    const a = ACADEMIC[rawType];
    search_terms = [...new Set([...search_terms.map((t) => `${a.prefix} ${t}`), ...a.extra])].slice(0, 6);
  }
  const job_type = JOBSPY_TYPES.has(rawType) ? rawType : null;

  const sites = args.boards?.length
    ? args.boards
    : (jp.sites && jp.sites.length ? jp.sites : DEFAULT_BOARDS);

  // Trim the caller's country first: a whitespace-only --country (' ') must count as
  // "not provided", not become a mis-scoped country string that still inherits the
  // profile city. When the caller names a country explicitly (e.g. the web filter
  // picking "United States"), DON'T inherit the profile's city — that city belongs
  // to the profile's country and would mis-scope the search. An explicit --city
  // always wins; an explicit country with no city means "whole country".
  const argCountry = typeof args.country === 'string' ? args.country.trim() : '';
  const explicitCountry = argCountry.length > 0;
  const country = explicitCountry ? argCountry : (jp.country || loc.country || DEFAULT_COUNTRY);
  const city = args.city != null ? args.city : (explicitCountry ? '' : (jp.city || loc.city || ''));
  const results_wanted = args.results || jp.results_wanted || DEFAULT_RESULTS;
  const hours_old = args.recent != null ? recentToHours(args.recent) : (jp.hours_old || null);

  return {
    sites,
    search_terms,
    location: city, // JobSpy `location` is the city/area; country_indeed is the country
    country,
    results_wanted,
    hours_old,
    is_remote: !!(args.remote || jp.is_remote),
    job_type,
    proxies: jp.proxies || null,
  };
}

function readProfile() {
  try {
    return existsSync(PROFILE) ? (yaml.load(readFileSync(PROFILE, 'utf8')) || {}) : {};
  } catch {
    return {};
  }
}

// Pull the last JSON object from the sidecar's stderr that carries `received`
// (the diagnostics line), plus any `fatal`. Tolerant of non-JSON noise.
export function parseDiagnostics(stderr) {
  let diag = null;
  let fatal = null;
  for (const line of String(stderr || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t);
      if (o.fatal) fatal = o;
      if (o.received != null || o.boards) diag = o;
    } catch { /* ignore non-JSON */ }
  }
  return { diag, fatal };
}

// ─── sidecar bridge (I/O) ─────────────────────────────────────────────

function runSidecar(config, { timeoutMs = 170_000, bin = pythonBin(), script = PY_SCRIPT } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      [script],
      { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }),
    );
    if (child.stdin) child.stdin.end(JSON.stringify(config));
  });
}

// ─── main ─────────────────────────────────────────────────────────────

// Fetch → ingest. Returns the JSON envelope. `runner` is injectable for tests.
export async function fetchAndIngest(args, { runner = runSidecar, dryRun = false } = {}) {
  const config = deriveConfig(readProfile(), args);
  const { err, stdout, stderr } = await runner(config);
  const { diag, fatal } = parseDiagnostics(stderr);

  if (fatal) {
    return { ok: false, error: `${fatal.fatal}${fatal.hint ? ' — ' + fatal.hint : ''}`, config };
  }

  // A spawn failure (no python on PATH and no .venv) returns an exec error with
  // EMPTY stdout. Surface it as a clear install hint instead of falling through to
  // JSON.parse('[]') and silently reporting "received 0 / 0 new" as if it worked.
  if (err && !String(stdout).trim()) {
    const enoent = /ENOENT/.test(String(err.message || ''));
    return {
      ok: false,
      error: enoent
        ? 'python not found — run `npm run jobspy:install` (creates .venv + installs python-jobspy)'
        : `jobspy sidecar failed to run: ${String(err.message || err).slice(0, 200)}`,
      config,
    };
  }

  let postings;
  try {
    postings = JSON.parse(stdout.trim() || '[]');
  } catch {
    const hint = err && /ENOENT/.test(String(err.message)) ? ' — python not found; run npm run jobspy:install' : '';
    return { ok: false, error: `jobspy sidecar produced no JSON${hint}`, stderr: stderr.slice(0, 500), config };
  }
  if (!Array.isArray(postings)) postings = [];

  // Ingest through the shared engine (dedup + save JDs). source per-item already
  // set by the sidecar (indeed/zip_recruiter/google); 'jobspy' is the fallback.
  const res = ingest(postings, { source: 'jobspy', mode: 'default', dryRun });

  return {
    ok: true,
    source: 'jobspy',
    country: config.country,
    city: config.location,
    boards: config.sites,
    search_terms: config.search_terms,
    received: postings.length,
    perBoard: (diag && diag.boards) || [],
    counts: res.counts,
    added: res.added,
    saved_jds: res.saved_jds,
    dryRun,
  };
}

function parseArgs(argv) {
  const out = { json: true, selfTest: false, dryRun: false, remote: false,
    search: null, boards: null, country: null, city: null, results: null, recent: null, jobType: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i] ?? '';
    if (a === '--json') out.json = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--remote') out.remote = true;
    else if (a === '--search') out.search = splitList(val());
    else if (a.startsWith('--search=')) out.search = splitList(a.slice(9));
    else if (a === '--boards') out.boards = splitList(val());
    else if (a.startsWith('--boards=')) out.boards = splitList(a.slice(9));
    else if (a === '--country') out.country = val();
    else if (a.startsWith('--country=')) out.country = a.slice(10);
    else if (a === '--city') out.city = val();
    else if (a.startsWith('--city=')) out.city = a.slice(7);
    else if (a === '--results') out.results = Number(val()) || null;
    else if (a.startsWith('--results=')) out.results = Number(a.slice(10)) || null;
    else if (a === '--recent') out.recent = val();
    else if (a.startsWith('--recent=')) out.recent = a.slice(9);
    else if (a === '--job-type') out.jobType = val();
  }
  return out;
}

function printSummary(r) {
  if (!r.ok) {
    process.stderr.write(`jobspy: ${r.error}\n`);
    return;
  }
  const where = [r.city, r.country].filter(Boolean).join(', ');
  console.log(`careeros jobspy — ${where} (boards: ${r.boards.join(', ')})`);
  console.log('');
  console.log(`  received:           ${r.received}`);
  for (const b of r.perBoard) {
    const tag = b.error ? `ERROR ${b.error}` : `${b.count} hit(s)`;
    console.log(`    · ${b.site} "${b.term}": ${tag}`);
  }
  console.log(`  new openings added: ${r.counts?.added ?? 0}${r.dryRun ? '  (dry run — nothing written)' : ''}`);
  console.log(`  duplicates:         ${r.counts?.dup ?? 0}`);
  console.log(`  filtered:           ${(r.counts?.filteredTitle ?? 0) + (r.counts?.filteredLocation ?? 0)}`);
  if (r.added?.length) {
    console.log('');
    console.log('  new openings:');
    for (const j of r.added) console.log(`    + ${j.company} | ${j.title} | ${j.location} | ${j.posted || ''}`);
  }
  if (!r.dryRun) console.log('\n  → see the ranked board:  node scripts/board.mjs --summary');
}

async function selfTest() {
  // recentToHours
  assert.equal(recentToHours(7), 168);
  assert.equal(recentToHours(0), null);
  assert.equal(recentToHours(''), null);

  // splitList
  assert.deepEqual(splitList('a, b ,,c'), ['a', 'b', 'c']);

  // deriveConfig: profile defaults
  const profile = {
    target_roles: { primary: ['Data Scientist', 'Data Engineer'] },
    location: { country: 'Luxembourg', city: 'Luxembourg' },
  };
  const def = deriveConfig(profile, parseArgs([]));
  assert.deepEqual(def.sites, ['indeed', 'zip_recruiter', 'glassdoor', 'google'], 'default board set (LinkedIn excluded)');
  assert.ok(!def.sites.includes('linkedin'));
  assert.deepEqual(def.search_terms, ['Data Scientist', 'Data Engineer']);
  assert.equal(def.country, 'Luxembourg');
  assert.equal(def.location, 'Luxembourg');
  assert.equal(def.hours_old, null);

  // deriveConfig: CLI overrides win, country/city honored
  const ov = deriveConfig(profile, parseArgs(
    ['--country', 'Germany', '--city', 'Berlin', '--search', 'ml engineer', '--recent', '7', '--boards', 'indeed,linkedin'],
  ));
  assert.equal(ov.country, 'Germany');
  assert.equal(ov.location, 'Berlin');
  assert.deepEqual(ov.search_terms, ['ml engineer']);
  assert.equal(ov.hours_old, 168);
  assert.deepEqual(ov.boards ?? ov.sites, ['indeed', 'linkedin']);

  // job_type: native JobSpy types pass through; phd/postdoc become search terms.
  const intern = deriveConfig(profile, parseArgs(['--job-type', 'internship']));
  assert.equal(intern.job_type, 'internship', 'native job_type passes through');
  const phd = deriveConfig(profile, parseArgs(['--job-type', 'phd']));
  assert.equal(phd.job_type, null, 'phd is not a JobSpy job_type');
  assert.ok(phd.search_terms.includes('PhD Data Scientist') && phd.search_terms.includes('Doctoral researcher'),
    'phd widens search terms');
  const pd = deriveConfig(profile, parseArgs(['--job-type', 'postdoc']));
  assert.equal(pd.job_type, null, 'postdoc is not a JobSpy job_type');
  assert.ok(pd.search_terms.some((t) => /postdoc/i.test(t)), 'postdoc widens search terms');

  // Explicit country with NO city must NOT inherit the profile's city (that would
  // mis-scope the search, e.g. country=US but location=Luxembourg). It means "whole
  // country" → empty location. But with no explicit country, the profile city stays.
  const usNoCity = deriveConfig(profile, parseArgs(['--country', 'United States']));
  assert.equal(usNoCity.country, 'United States');
  assert.equal(usNoCity.location, '', 'explicit country without city clears the profile city');
  assert.equal(def.location, 'Luxembourg', 'no explicit country keeps the profile city');

  // A whitespace-only --country counts as "not provided": it must NOT become a
  // mis-scoped country string, and the profile city should still be inherited.
  const wsCountry = deriveConfig(profile, parseArgs(['--country', '   ']));
  assert.equal(wsCountry.country, 'Luxembourg', 'whitespace country falls back to profile country');
  assert.equal(wsCountry.location, 'Luxembourg', 'whitespace country still inherits profile city');

  // A sidecar-shaped row coerces into the engine's posting shape.
  const row = { title: 'Data Engineer', company: 'Acme', location: 'Luxembourg',
    url: 'https://example.test/jobspy-selftest', posted: '2026-06-01',
    description: 'pipelines', source: 'indeed' };
  const c = coerceItem(row, 'jobspy');
  assert.equal(c.title, 'Data Engineer');
  assert.equal(c.source, 'indeed');
  assert.equal(c.url, 'https://example.test/jobspy-selftest');

  // parseDiagnostics extracts the diag line + a fatal.
  const { diag, fatal } = parseDiagnostics(
    'noise\n{"where":"x","boards":[{"site":"indeed","count":3}],"received":3}\n{"fatal":"python-jobspy not installed","hint":"npm run jobspy:install"}',
  );
  assert.equal(diag.received, 3);
  assert.equal(fatal.fatal, 'python-jobspy not installed');

  // fetchAndIngest with a stubbed runner (no network, no python) — dry run so
  // nothing is written, and we assert the envelope shape + ingest wiring.
  const fakeStdout = JSON.stringify([{
    title: 'ML Engineer', company: 'TestCo', location: 'Berlin',
    url: 'https://example.test/jobspy-selftest-2', posted: '', description: 'x', source: 'indeed',
  }]);
  const stubRunner = async () => ({ err: null, stdout: fakeStdout, stderr: '{"received":1,"boards":[{"site":"indeed","term":"ml","count":1}]}' });
  const res = await fetchAndIngest(parseArgs(['--dry-run']), { runner: stubRunner, dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(res.received, 1);
  assert.equal(res.counts.added, 1);
  assert.equal(res.dryRun, true);

  // A fatal from the sidecar surfaces as ok:false with a hint.
  const fatalRunner = async () => ({ err: { message: 'exit 1' }, stdout: '[]', stderr: '{"fatal":"python-jobspy not installed","hint":"npm run jobspy:install"}' });
  const f = await fetchAndIngest(parseArgs([]), { runner: fatalRunner });
  assert.equal(f.ok, false);
  assert.match(f.error, /not installed/);

  console.log('jobspy.mjs self-test passed');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) { await selfTest(); return; }
  const r = await fetchAndIngest(args, { dryRun: args.dryRun });
  if (args.json) console.log(JSON.stringify(r));
  else printSummary(r);
  if (!r.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    process.exitCode = 1;
  });
}
