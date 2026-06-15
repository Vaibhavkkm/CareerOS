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
//   node scripts/jobspy.mjs --countries "Germany,France,Italy" --concurrency 3   # sweep, one ingest
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
// ZipRecruiter is US/CA-only). LinkedIn is now in the default set too (it returns
// strong EU results); it rate-limits harder than the others, so per-board failures
// degrade gracefully in the sidecar and just yield fewer rows when throttled.
const DEFAULT_BOARDS = ['indeed', 'zip_recruiter', 'glassdoor', 'google', 'linkedin'];
const DEFAULT_COUNTRY = 'Luxembourg';
const DEFAULT_RESULTS = 40; // per board per search term (was 20) — pull more per role

// Region-specific boards JobSpy supports that only make sense in their geography —
// auto-added (deduped) to the default sweep when the target country matches, so an
// India search also hits Naukri and a Gulf search also hits Bayt without the user
// having to know the board names. Only applied when the user hasn't named boards.
const REGION_BOARDS = {
  india: ['naukri'],
  'united arab emirates': ['bayt'], uae: ['bayt'], 'saudi arabia': ['bayt'],
  qatar: ['bayt'], kuwait: ['bayt'], bahrain: ['bayt'], oman: ['bayt'], egypt: ['bayt'],
  bangladesh: ['bdjobs'],
};
export function regionBoardsFor(country) {
  return REGION_BOARDS[String(country || '').trim().toLowerCase()] || [];
}

// Multi-country sweeps fetch this many countries at once. Kept deliberately low: the
// job boards rate-limit aggressive scraping, so a small pool is meaningfully faster
// than one-at-a-time without risking a temporary block. Override with --concurrency.
const DEFAULT_CONCURRENCY = 3;

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
    // extras FIRST so the curated academic anchors survive the cap even when the
    // profile has many primary roles (the prefixed roles fill the remaining slots).
    search_terms = [...new Set([...a.extra, ...search_terms.map((t) => `${a.prefix} ${t}`)])].slice(0, 6);
  }
  const job_type = JOBSPY_TYPES.has(rawType) ? rawType : null;

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

  // Boards: an explicit --boards or a profile jobspy.sites wins verbatim. Otherwise
  // start from the default sweep and auto-add any region board for the target
  // country (e.g. Naukri for India, Bayt for the Gulf) so coverage follows location.
  const sites = args.boards?.length
    ? args.boards
    : (jp.sites && jp.sites.length
      ? jp.sites
      : [...new Set([...DEFAULT_BOARDS, ...regionBoardsFor(country)])]);
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

// Run the sidecar for ONE config and return its raw postings — NO ingest. Shared by
// the single- and multi-country paths so every invocation dedups + persists in
// exactly one ingest() call. (The multi path ingests once for the whole sweep, which
// is what lets it fetch countries in parallel without racing the dedup ledger.)
async function fetchPostings(config, { runner = runSidecar } = {}) {
  const { err, stdout, stderr } = await runner(config);
  const { diag, fatal } = parseDiagnostics(stderr);

  if (fatal) {
    return { ok: false, postings: [], diag, error: `${fatal.fatal}${fatal.hint ? ' — ' + fatal.hint : ''}` };
  }

  // A spawn failure (no python on PATH and no .venv) returns an exec error with
  // EMPTY stdout. Surface it as a clear install hint instead of falling through to
  // JSON.parse('[]') and silently reporting "received 0 / 0 new" as if it worked.
  if (err && !String(stdout).trim()) {
    const enoent = /ENOENT/.test(String(err.message || ''));
    return {
      ok: false, postings: [], diag,
      error: enoent
        ? 'python not found — run `npm run jobspy:install` (creates .venv + installs python-jobspy)'
        : `jobspy sidecar failed to run: ${String(err.message || err).slice(0, 200)}`,
    };
  }

  let postings;
  try {
    postings = JSON.parse(stdout.trim() || '[]');
  } catch {
    const hint = err && /ENOENT/.test(String(err.message)) ? ' — python not found; run npm run jobspy:install' : '';
    return { ok: false, postings: [], diag, error: `jobspy sidecar produced no JSON${hint}` };
  }
  if (!Array.isArray(postings)) postings = [];
  return { ok: true, postings, diag };
}

// Run async `task(item, i)` over `items` with at most `limit` calls in flight at
// once; results keep input order. Lets a multi-country sweep fetch a few countries
// concurrently without spawning one python process per country all at once (which
// would hammer the boards and risk a rate-limit block). Exported for --self-test.
export async function mapPool(items, limit, task) {
  const list = Array.from(items);
  const results = new Array(list.length);
  const workers = Math.max(1, Math.min(Number(limit) | 0 || 1, list.length || 1));
  let next = 0;
  async function worker() {
    for (let i = next++; i < list.length; i = next++) {
      results[i] = await task(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

// Fetch → ingest. Returns the JSON envelope. `runner` is injectable for tests.
export async function fetchAndIngest(args, { runner = runSidecar, dryRun = false } = {}) {
  const config = deriveConfig(readProfile(), args);
  const { ok, postings, diag, error } = await fetchPostings(config, { runner });
  if (!ok) return { ok: false, error, config };

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

// Multi-country sweep: fetch each country's boards with bounded concurrency, then
// dedup + persist the WHOLE pile in a SINGLE ingest() call. One ingest = one atomic
// read-modify-write of the dedup ledger, so concurrent fetches can't race or
// double-write (the bug the web UI used to dodge by looping one country per HTTP
// round-trip), and a posting that surfaces in several countries is deduped in one
// pass. A country whose sidecar fails is recorded and skipped — it never aborts the
// sweep. `runner` is injectable for tests.
export async function fetchManyAndIngest(countries, args, { runner = runSidecar, dryRun = false, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const profile = readProfile();
  const clean = [...new Set((countries || []).map((c) => String(c || '').trim()).filter(Boolean))];
  if (!clean.length) return { ok: false, error: 'no countries given' };

  const perCountry = await mapPool(clean, concurrency, async (country) => {
    // A multi-country sweep is whole-country by definition: force city empty so a
    // profile city can't mis-scope every country to one town.
    const config = deriveConfig(profile, { ...args, country, city: '' });
    const { ok, postings, error } = await fetchPostings(config, { runner });
    return { country, ok, error: ok ? undefined : error, received: postings.length, postings, boards: config.sites };
  });

  // Pool every country's postings and dedup/persist them in ONE ingest call.
  const allPostings = perCountry.flatMap((r) => r.postings);
  const res = ingest(allPostings, { source: 'jobspy', mode: 'default', dryRun });

  const failed = perCountry.filter((r) => !r.ok).length;
  return {
    ok: true,
    source: 'jobspy',
    countries: clean,
    perCountry: perCountry.map(({ country, ok, error, received }) => ({ country, ok, error, received })),
    boards: perCountry[0]?.boards || [],
    received: allPostings.length,
    perBoard: [],
    counts: res.counts,
    added: res.added,
    saved_jds: res.saved_jds,
    failed,
    concurrency,
    dryRun,
  };
}

function parseArgs(argv) {
  const out = { json: true, selfTest: false, dryRun: false, remote: false,
    search: null, boards: null, country: null, countries: null, concurrency: null,
    city: null, results: null, recent: null, jobType: null };
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
    else if (a === '--countries') out.countries = splitList(val());
    else if (a.startsWith('--countries=')) out.countries = splitList(a.slice(12));
    else if (a === '--concurrency') out.concurrency = Number(val()) || null;
    else if (a.startsWith('--concurrency=')) out.concurrency = Number(a.slice(14)) || null;
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
  // Multi-country sweep: per-country breakdown instead of per-board.
  if (r.perCountry) {
    console.log(`careeros jobspy — ${r.countries.length} countries (concurrency ${r.concurrency}, boards: ${r.boards.join(', ')})`);
    console.log('');
    console.log(`  received:           ${r.received}`);
    for (const c of r.perCountry) {
      console.log(`    · ${c.country}: ${c.ok ? `${c.received} seen` : `ERROR ${c.error}`}`);
    }
    console.log(`  new openings added: ${r.counts?.added ?? 0}${r.dryRun ? '  (dry run — nothing written)' : ''}`);
    console.log(`  duplicates:         ${r.counts?.dup ?? 0}`);
    if (r.failed) console.log(`  countries failed:   ${r.failed}`);
    if (!r.dryRun) console.log('\n  → see the ranked board:  node scripts/board.mjs --summary');
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
  assert.deepEqual(def.sites, ['indeed', 'zip_recruiter', 'glassdoor', 'google', 'linkedin'], 'default board set (LinkedIn included)');
  assert.ok(def.sites.includes('linkedin'));

  // region boards: India auto-adds Naukri, the Gulf auto-adds Bayt — but only when
  // the user hasn't named boards.
  assert.deepEqual(regionBoardsFor('India'), ['naukri'], 'regionBoardsFor India → naukri');
  assert.deepEqual(regionBoardsFor('United Arab Emirates'), ['bayt'], 'regionBoardsFor UAE → bayt');
  assert.deepEqual(regionBoardsFor('Germany'), [], 'regionBoardsFor non-region country → []');
  const india = deriveConfig(profile, parseArgs(['--country', 'India']));
  assert.ok(india.sites.includes('naukri') && india.sites.includes('indeed'), 'India sweep includes Naukri + defaults');
  const gulf = deriveConfig(profile, parseArgs(['--country', 'Qatar']));
  assert.ok(gulf.sites.includes('bayt'), 'Gulf sweep includes Bayt');
  // an explicit --boards is honoured verbatim (no region augmentation)
  const explicit = deriveConfig(profile, parseArgs(['--country', 'India', '--boards', 'indeed']));
  assert.deepEqual(explicit.sites, ['indeed'], 'explicit --boards wins, no region add');

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

  // mapPool: order preserved, never more than `limit` tasks in flight at once.
  let inFlight = 0, maxInFlight = 0;
  const pooled = await mapPool([1, 2, 3, 4, 5], 2, async (x) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight--;
    return x * 2;
  });
  assert.deepEqual(pooled, [2, 4, 6, 8, 10], 'mapPool preserves input order');
  assert.ok(maxInFlight <= 2, 'mapPool respects the concurrency limit');

  // fetchManyAndIngest: every country's postings dedup + persist in ONE ingest, so a
  // posting that appears in several countries is added exactly once. Each stubbed
  // country yields a unique own-posting plus a SHARED posting common to all.
  const manyRunner = async (config) => {
    const slug = config.country.replace(/\s+/g, '-');
    const own = { title: 'Data Engineer', company: `Co-${config.country}`, location: 'Berlin',
      url: `https://example.test/jobspy-many-${slug}`, posted: '', description: 'x', source: 'indeed' };
    const shared = { title: 'ML Engineer', company: 'GlobalCo', location: 'Berlin',
      url: 'https://example.test/jobspy-many-shared', posted: '', description: 'x', source: 'indeed' };
    return { err: null, stdout: JSON.stringify([own, shared]),
      stderr: '{"received":2,"boards":[{"site":"indeed","term":"x","count":2}]}' };
  };
  const many = await fetchManyAndIngest(['Germany', 'France', 'Spain'], parseArgs(['--dry-run']),
    { runner: manyRunner, dryRun: true, concurrency: 2 });
  assert.equal(many.ok, true);
  assert.equal(many.received, 6, '3 countries × 2 postings each = 6 received');
  assert.equal(many.perCountry.length, 3);
  assert.ok(many.perCountry.every((c) => c.ok && c.received === 2), 'every country reports its postings');
  assert.equal(many.counts.added, 4, '3 unique own + 1 shared (deduped across countries) = 4 added in one ingest');
  assert.equal(many.failed, 0);
  assert.equal(many.dryRun, true);

  // De-dups the country list and skips a failing country without aborting the sweep.
  const flakyRunner = async (config) => (config.country === 'France'
    ? { err: { message: 'boom' }, stdout: '', stderr: '' }
    : manyRunner(config));
  const flaky = await fetchManyAndIngest(['Germany', 'Germany', 'France'], parseArgs(['--dry-run']),
    { runner: flakyRunner, dryRun: true, concurrency: 3 });
  assert.deepEqual(flaky.countries, ['Germany', 'France'], 'duplicate countries collapsed');
  assert.equal(flaky.failed, 1, 'the failing country is counted, not fatal');
  assert.ok(flaky.perCountry.find((c) => c.country === 'France' && !c.ok), 'failed country flagged ok:false');

  // No countries → a clean ok:false, not a throw.
  const none = await fetchManyAndIngest([], parseArgs([]), { runner: manyRunner });
  assert.equal(none.ok, false);

  console.log('jobspy.mjs self-test passed');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) { await selfTest(); return; }
  const r = args.countries?.length
    ? await fetchManyAndIngest(args.countries, args, { dryRun: args.dryRun, concurrency: args.concurrency || DEFAULT_CONCURRENCY })
    : await fetchAndIngest(args, { dryRun: args.dryRun });
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
