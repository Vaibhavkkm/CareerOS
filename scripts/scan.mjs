#!/usr/bin/env node
// scripts/scan.mjs — zero-token portal scanner with a plugin provider layer.
//
// Loads data/portals.yml, fetches open roles from each enabled company via a
// provider plugin (scripts/providers/<id>.mjs), filters by title + location,
// dedups against the existing queue/ledger/tracker, and appends survivors to
// data/inbox.md (the pipeline's URL queue) + data/scan-history.tsv (append-only
// dedup ledger). Pure HTTP + JSON — no AI tokens.
//
// Provider contract (default export of every scripts/providers/*.mjs, except
// files starting with '_'):
//   { id: string,
//     detect?(entry): boolean,                       // optional auto-detection
//     async fetch(entry, ctx): Promise<Job[]> }       // required
// where Job = { title, url, company, location } and ctx = { fetchJson, fetchText }.
//
// Usage:
//   node scripts/scan.mjs                 # scan all enabled companies
//   node scripts/scan.mjs --dry-run       # preview; write nothing
//   node scripts/scan.mjs --company Acme  # scan a single company (substring)
//   node scripts/scan.mjs --json          # machine-readable summary (default)
//   node scripts/scan.mjs --summary       # human-readable summary
//   node scripts/scan.mjs --self-test     # built-in tests (temp files only)

import {
  existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync, rmSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import { makeHttpCtx } from './providers/_http.mjs';
import { readTracker, normalizeCompany } from '../lib/records.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDERS_DIR = join(ROOT, 'scripts', 'providers');
const DEFAULT_PATHS = {
  portals: join(ROOT, 'data', 'portals.yml'),
  inbox: join(ROOT, 'data', 'inbox.md'),
  history: join(ROOT, 'data', 'scan-history.tsv'),
  tracker: join(ROOT, 'data', 'tracker.jsonl'),
};

const HISTORY_HEADER = 'url\tcompany\ttitle\tstatus\tdate';
const CONCURRENCY = 8;

// ─── pure helpers (exported for tests) ───────────────────────────────

// Normalize a title for the company+title dedup key: lowercase, strip
// punctuation to spaces, collapse whitespace.
export function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// company + normalized-title dedup key. Company uses records.normalizeCompany so
// "Acme Inc" and "Acme" collide the same way the tracker dedups openings.
export function dedupKey(company, title) {
  return `${normalizeCompany(company)}::${normalizeTitle(title)}`;
}

// Coerce a portals.yml keyword list: tolerate a bare string or null, drop
// non-strings and empties (an empty keyword would match everything via
// includes('')), lowercase + trim survivors.
function normKeywords(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter((k) => typeof k === 'string').map((k) => k.toLowerCase().trim()).filter(Boolean);
}

// title_filter: positive substring required unless the positive list is empty;
// any negative substring excludes. Returns true if the title passes.
export function makeTitleFilter(titleFilter) {
  const positive = normKeywords(titleFilter?.positive);
  const negative = normKeywords(titleFilter?.negative);
  return (title) => {
    const lower = String(title || '').toLowerCase();
    const okPositive = positive.length === 0 || positive.some((k) => lower.includes(k));
    const hasNegative = negative.some((k) => lower.includes(k));
    return okPositive && !hasNegative;
  };
}

// location_filter: always_allow short-circuits to pass; block excludes; allow
// (if non-empty) requires a match. Missing/blank location passes (don't punish
// providers that omit it). Returns true if the location passes.
export function makeLocationFilter(locationFilter) {
  if (!locationFilter) return () => true;
  const alwaysAllow = normKeywords(locationFilter.always_allow);
  const allow = normKeywords(locationFilter.allow);
  const block = normKeywords(locationFilter.block);
  return (location) => {
    if (typeof location !== 'string' || location.trim() === '') return true;
    const lower = location.toLowerCase();
    if (alwaysAllow.length && alwaysAllow.some((k) => lower.includes(k))) return true;
    if (block.length && block.some((k) => lower.includes(k))) return false;
    if (allow.length === 0) return true;
    return allow.some((k) => lower.includes(k));
  };
}

// Build the dedup index from prior scan-history.tsv + inbox.md + tracker.jsonl.
// Returns { urls:Set, keys:Set } where keys are company+normalized-title.
// Pure w.r.t. its string/array inputs so tests can drive it directly.
export function buildSeen({ historyText = '', inboxText = '', trackerRecords = [] } = {}) {
  const urls = new Set();
  const keys = new Set();

  // scan-history.tsv: url<TAB>company<TAB>title<TAB>status<TAB>date (skip header)
  for (const line of historyText.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('url\t')) continue; // header
    const [url, company, title] = line.split('\t');
    if (url) urls.add(url);
    if (company && title) keys.add(dedupKey(company, title));
  }

  // inbox.md: "- [ ] <url> | <company> | <title>"
  for (const line of inboxText.split('\n')) {
    const m = line.match(/^\s*-\s*\[[ xX]\]\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/);
    if (m) {
      urls.add(m[1]);
      keys.add(dedupKey(m[2], m[3]));
    } else {
      // Fall back to grabbing any bare URL so plain links still dedup.
      const u = line.match(/https?:\/\/\S+/);
      if (u) urls.add(u[0]);
    }
  }

  // tracker.jsonl records: url + company/role
  for (const r of trackerRecords) {
    if (r && r.url) urls.add(r.url);
    if (r && r.company && r.role) keys.add(dedupKey(r.company, r.role));
  }

  return { urls, keys };
}

// Resolve which provider handles a company entry:
//   1. explicit entry.provider wins;
//   2. else 'local-parser' if entry.parser is set;
//   3. else first provider whose detect(entry) returns truthy (load order).
// `providers` is a Map<id, provider>. Returns { provider } | { error } | null.
export function resolveProvider(entry, providers) {
  if (entry.provider) {
    const p = providers.get(entry.provider);
    return p ? { provider: p } : { error: `unknown provider: ${entry.provider}` };
  }
  if (entry.parser) {
    const lp = providers.get('local-parser');
    if (lp) return { provider: lp };
    return { error: 'parser configured but local-parser provider not loaded' };
  }
  for (const p of providers.values()) {
    let hit = false;
    try { hit = typeof p.detect === 'function' && !!p.detect(entry); }
    catch { hit = false; }
    if (hit) return { provider: p };
  }
  return null;
}

// Run async tasks with a bounded concurrency pool. Each task is a () => Promise.
// Results are returned in task order.
export async function runPool(tasks, limit = CONCURRENCY) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  const n = Math.max(1, Math.min(limit, tasks.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

// Format one inbox.md queue line.
export function inboxLine(job) {
  return `- [ ] ${job.url} | ${job.company} | ${job.title}`;
}

// Format one scan-history.tsv ledger line.
export function historyLine(job, status, date) {
  return [job.url, job.company, job.title, status, date].join('\t');
}

// Core pipeline over already-fetched jobs: apply filters + dedup, classify each
// job as added | skipped_dup | skipped_filter, and dedup intra-scan too. Pure —
// takes data in, returns decisions out; no I/O.
//   jobs: Job[] (each tagged with its source company is not required)
// Returns { added:Job[], ledger:[{job,status}], counts }.
export function classifyJobs(jobs, { titleFilter, locationFilter, seen }) {
  const added = [];
  const ledger = [];
  const counts = { found: jobs.length, added: 0, dup: 0, filteredTitle: 0, filteredLocation: 0 };

  for (const job of jobs) {
    if (!job || !job.title || !job.url) {
      counts.filteredTitle++;
      ledger.push({ job: job || {}, status: 'skipped_filter' });
      continue;
    }
    if (!titleFilter(job.title)) {
      counts.filteredTitle++;
      ledger.push({ job, status: 'skipped_filter' });
      continue;
    }
    if (!locationFilter(job.location)) {
      counts.filteredLocation++;
      ledger.push({ job, status: 'skipped_filter' });
      continue;
    }
    const key = dedupKey(job.company, job.title);
    // A blank company makes the key title-only (`::title`), which over-merges two
    // DIFFERENT employers' same-titled roles into one false duplicate. URLs are
    // unique per posting, so for blank-company rows rely on URL dedup alone.
    const hasCompanyKey = normalizeCompany(job.company).length > 0;
    if (seen.urls.has(job.url) || (hasCompanyKey && seen.keys.has(key))) {
      counts.dup++;
      ledger.push({ job, status: 'skipped_dup' });
      continue;
    }
    // mark seen to block intra-scan dupes
    seen.urls.add(job.url);
    if (hasCompanyKey) seen.keys.add(key);
    added.push(job);
    ledger.push({ job, status: 'added' });
    counts.added++;
  }
  return { added, ledger, counts };
}

// ─── provider loading ────────────────────────────────────────────────

export async function loadProviders(dir = PROVIDERS_DIR) {
  const providers = new Map();
  if (!existsSync(dir)) return providers;
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
  for (const file of files) {
    let mod;
    try {
      mod = await import(pathToFileURL(join(dir, file)).href);
    } catch (err) {
      process.stderr.write(`warn: ${file}: failed to load — ${err.message}\n`);
      continue;
    }
    const p = mod.default;
    if (!p || !p.id || typeof p.fetch !== 'function') {
      process.stderr.write(`warn: ${file}: default export must be { id, fetch } — skipping\n`);
      continue;
    }
    if (providers.has(p.id)) {
      process.stderr.write(`warn: ${file}: duplicate provider id "${p.id}" — keeping first\n`);
      continue;
    }
    providers.set(p.id, p);
  }
  return providers;
}

// ─── orchestration ──────────────────────────────────────────────────

function loadConfig(portalsPath) {
  const cfg = yaml.load(readFileSync(portalsPath, 'utf8')) || {};
  return cfg;
}

function readIfExists(p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

// Fetch + filter + dedup across all enabled companies. Returns a result object.
export async function scan({ paths = DEFAULT_PATHS, providers, today, companyFilter = null, ctxFactory = makeHttpCtx } = {}) {
  const config = loadConfig(paths.portals);
  const titleFilter = makeTitleFilter(config.title_filter);
  const locationFilter = makeLocationFilter(config.location_filter);
  const date = today || new Date().toISOString().slice(0, 10);

  const seen = buildSeen({
    historyText: readIfExists(paths.history),
    inboxText: readIfExists(paths.inbox),
    trackerRecords: existsSync(paths.tracker) ? readTracker(paths.tracker) : [],
  });

  // resolve a provider for each enabled, name-bearing, filter-matching company
  const targets = [];
  const errors = [];
  let skippedNoProvider = 0;
  for (const entry of (config.tracked_companies || [])) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.enabled === false) continue;
    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      errors.push({ company: '(unnamed)', error: 'missing or non-string name' });
      continue;
    }
    if (companyFilter && !entry.name.toLowerCase().includes(companyFilter.toLowerCase())) continue;
    const resolved = resolveProvider(entry, providers);
    if (!resolved) { skippedNoProvider++; continue; }
    if (resolved.error) { errors.push({ company: entry.name, error: resolved.error }); continue; }
    targets.push({ entry, provider: resolved.provider });
  }

  // fetch with a bounded pool; collect jobs tagged with their company name
  const tasks = targets.map(({ entry, provider }) => async () => {
    try {
      const ctx = ctxFactory();
      const jobs = await provider.fetch(entry, ctx);
      if (!Array.isArray(jobs)) throw new Error(`${provider.id}: fetch() did not return an array`);
      // ensure company is populated from the entry when the provider omits it
      return jobs.map((j) => ({ ...j, company: (j && j.company) || entry.name }));
    } catch (err) {
      errors.push({ company: entry.name, error: err.message });
      return [];
    }
  });
  const fetched = (await runPool(tasks, CONCURRENCY)).flat();

  const { added, ledger, counts } = classifyJobs(fetched, { titleFilter, locationFilter, seen });

  return {
    date,
    companies: targets.length,
    skippedNoProvider,
    added,
    ledger,
    counts,
    errors,
  };
}

// Write inbox + history. Honors dry-run by returning what *would* be written.
export function persist(result, { paths = DEFAULT_PATHS, dryRun = false } = {}) {
  const inboxAdds = result.added.map(inboxLine);
  const historyAdds = result.ledger.map(({ job, status }) => historyLine(job, status, result.date));

  if (dryRun) return { inboxAdds, historyAdds, wrote: false };

  mkdirSync(dirname(paths.inbox), { recursive: true });

  if (inboxAdds.length) {
    const prefix = existsSync(paths.inbox) ? '' : '# inbox — pipeline URL queue\n\n';
    appendFileSync(paths.inbox, prefix + inboxAdds.join('\n') + '\n');
  }
  if (historyAdds.length) {
    if (!existsSync(paths.history)) writeFileSync(paths.history, HISTORY_HEADER + '\n');
    appendFileSync(paths.history, historyAdds.join('\n') + '\n');
  }
  return { inboxAdds, historyAdds, wrote: true };
}

// ─── CLI ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { dryRun: false, json: true, selfTest: false, company: null, today: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--company') out.company = argv[++i] || null;
    else if (a.startsWith('--company=')) out.company = a.slice('--company='.length);
    else if (a.startsWith('--today=')) out.today = a.slice('--today='.length);
    else if (a === '--today') out.today = argv[++i] || null;
  }
  return out;
}

function printSummary(result, persisted, dryRun) {
  const c = result.counts;
  const lines = [
    `careeros scan — ${result.date}${dryRun ? ' (dry run)' : ''}`,
    '',
    `  companies scanned:    ${result.companies}`,
    `  no provider matched:  ${result.skippedNoProvider}`,
    `  jobs found:           ${c.found}`,
    `  filtered (title):     ${c.filteredTitle}`,
    `  filtered (location):  ${c.filteredLocation}`,
    `  duplicates:           ${c.dup}`,
    `  new offers added:     ${c.added}`,
  ];
  if (result.errors.length) {
    lines.push('', `  errors (${result.errors.length}):`);
    for (const e of result.errors) lines.push(`    x ${e.company}: ${e.error}`);
  }
  if (result.added.length) {
    lines.push('', '  new offers:');
    for (const j of result.added) lines.push(`    + ${j.company} | ${j.title} | ${j.location || 'N/A'}`);
  }
  lines.push('', dryRun ? '  (dry run — nothing written)'
    : `  wrote ${persisted.inboxAdds.length} to inbox.md, ${persisted.historyAdds.length} to scan-history.tsv`);
  console.log(lines.join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  if (!existsSync(DEFAULT_PATHS.portals)) {
    const msg = `portals.yml not found at ${DEFAULT_PATHS.portals} — copy templates/portals.example.yml to data/portals.yml`;
    if (args.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    process.exit(1);
  }

  const providers = await loadProviders(PROVIDERS_DIR);
  if (providers.size === 0) {
    const msg = 'no providers loaded from scripts/providers/';
    if (args.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    process.exit(1);
  }

  const result = await scan({ providers, today: args.today, companyFilter: args.company });
  const persisted = persist(result, { dryRun: args.dryRun });

  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: args.dryRun,
      date: result.date,
      companies: result.companies,
      skipped_no_provider: result.skippedNoProvider,
      counts: result.counts,
      added: result.added,
      errors: result.errors,
      wrote: persisted.wrote,
      inbox_appended: persisted.inboxAdds.length,
      history_appended: persisted.historyAdds.length,
    }, null, 2));
  } else {
    printSummary(result, persisted, args.dryRun);
  }
  process.exit(0);
}

// ─── self-test ───────────────────────────────────────────────────────

export async function selfTest() {
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
  const tmp = join(tmpdir(), `aw-scan-selftest-${process.pid}-${Date.now()}`);
  mkdirSync(join(tmp, 'data'), { recursive: true });
  const paths = {
    portals: join(tmp, 'data', 'portals.yml'),
    inbox: join(tmp, 'data', 'inbox.md'),
    history: join(tmp, 'data', 'scan-history.tsv'),
    tracker: join(tmp, 'data', 'tracker.jsonl'),
  };

  try {
    // --- title filter ---
    const tf = makeTitleFilter({ positive: ['engineer'], negative: ['intern', 'manager'] });
    ok(tf('Senior Backend Engineer'), 'title: positive match passes');
    ok(!tf('Engineering Intern'), 'title: negative excludes');
    ok(!tf('Product Designer'), 'title: missing positive fails');
    const tfEmpty = makeTitleFilter({ positive: [], negative: ['intern'] });
    ok(tfEmpty('Random Role'), 'title: empty positive allows all (non-negative)');
    ok(!tfEmpty('Summer Intern'), 'title: empty positive still applies negative');

    // --- location filter ---
    const lf = makeLocationFilter({ always_allow: ['remote'], allow: ['new york'], block: ['europe'] });
    ok(lf('Remote, Europe'), 'loc: always_allow short-circuits over block');
    ok(!lf('Berlin, Europe'), 'loc: block excludes');
    ok(lf('New York, NY'), 'loc: allow matches');
    ok(!lf('Austin, TX'), 'loc: non-allow fails when allow non-empty');
    ok(lf(''), 'loc: blank passes');
    ok(makeLocationFilter(undefined)('anywhere'), 'loc: no filter => pass');

    // --- dedup keys ---
    ok(dedupKey('Acme Inc', 'Senior Engineer') === dedupKey('Acme', 'senior  engineer'),
      'dedup: company noise + title whitespace collapse to same key');

    // --- buildSeen across all three sources ---
    const seen = buildSeen({
      historyText: `${HISTORY_HEADER}\nhttps://h.example/1\tHistCo\tBackend Engineer\tadded\t2026-06-01\n`,
      inboxText: '- [ ] https://i.example/2 | InboxCo | Platform Engineer\n',
      trackerRecords: [{ url: 'https://t.example/3', company: 'TrackCo', role: 'Staff Engineer' }],
    });
    ok(seen.urls.has('https://h.example/1') && seen.urls.has('https://i.example/2') && seen.urls.has('https://t.example/3'),
      'buildSeen: collects URLs from all three sources');
    ok(seen.keys.has(dedupKey('HistCo', 'Backend Engineer')), 'buildSeen: history company+title key');
    ok(seen.keys.has(dedupKey('TrackCo', 'Staff Engineer')), 'buildSeen: tracker company+role key');

    // --- classifyJobs: filter + dedup + intra-scan dedup ---
    const titleFilter = makeTitleFilter({ positive: ['engineer'], negative: ['intern'] });
    const locationFilter = makeLocationFilter({ always_allow: ['remote'], block: ['europe'] });
    const freshSeen = buildSeen({
      historyText: `${HISTORY_HEADER}\nhttps://seen.example/old\tAcme\tBackend Engineer\tadded\t2026-06-01\n`,
    });
    const jobs = [
      { title: 'Senior Engineer', url: 'https://new.example/1', company: 'Acme', location: 'Remote' },     // added
      { title: 'Backend Engineer', url: 'https://seen.example/old', company: 'Acme', location: 'Remote' }, // dup by URL
      { title: 'Backend Engineer', url: 'https://other.example/x', company: 'Acme', location: 'Remote' },  // dup by company+title key
      { title: 'Frontend Engineer', url: 'https://eu.example/2', company: 'Acme', location: 'Berlin, Europe' }, // filtered location
      { title: 'Engineering Intern', url: 'https://int.example/3', company: 'Acme', location: 'Remote' },   // filtered title
      { title: 'Senior Engineer', url: 'https://dup-intra.example/4', company: 'Acme', location: 'Remote' }, // intra-scan dup of #1's key
    ];
    const res = classifyJobs(jobs, { titleFilter, locationFilter, seen: freshSeen });
    ok(res.counts.added === 1, `classify: exactly 1 added (got ${res.counts.added})`);
    ok(res.added[0].url === 'https://new.example/1', 'classify: correct survivor');
    ok(res.counts.dup === 3, `classify: 3 dups incl. intra-scan (got ${res.counts.dup})`);
    ok(res.counts.filteredTitle === 1, `classify: 1 title-filtered (got ${res.counts.filteredTitle})`);
    ok(res.counts.filteredLocation === 1, `classify: 1 location-filtered (got ${res.counts.filteredLocation})`);
    ok(res.ledger.length === 6, 'classify: ledger has a row per input job');

    // --- resolveProvider precedence ---
    const fakeApi = { id: 'fake-api', detect: (e) => e.url?.includes('fakeats'), async fetch() { return []; } };
    const fakeLocal = { id: 'local-parser', async fetch() { return []; } };
    const provMap = new Map([[fakeApi.id, fakeApi], [fakeLocal.id, fakeLocal]]);
    ok(resolveProvider({ provider: 'fake-api' }, provMap).provider === fakeApi, 'resolve: explicit provider wins');
    ok(resolveProvider({ parser: { command: 'x' } }, provMap).provider === fakeLocal, 'resolve: parser => local-parser');
    ok(resolveProvider({ url: 'https://fakeats.io/acme' }, provMap).provider === fakeApi, 'resolve: detect() match');
    ok(resolveProvider({ name: 'nobody' }, provMap) === null, 'resolve: nothing matches => null');
    ok(resolveProvider({ provider: 'ghost' }, provMap).error, 'resolve: unknown provider => error');

    // --- end-to-end scan() with a fake in-memory provider list + temp files ---
    writeFileSync(paths.portals, yaml.dump({
      title_filter: { positive: ['engineer'], negative: ['intern'] },
      location_filter: { always_allow: ['remote'], block: ['europe'] },
      tracked_companies: [
        { name: 'AcmeFetch', provider: 'mem' },
        { name: 'DisabledCo', provider: 'mem', enabled: false },
      ],
    }));
    writeFileSync(paths.history, `${HISTORY_HEADER}\nhttps://acme.example/seen\tAcmeFetch\tBackend Engineer\tadded\t2026-06-01\n`);
    writeFileSync(paths.inbox, '- [ ] https://acme.example/inbox | AcmeFetch | Platform Engineer\n');
    writeFileSync(paths.tracker, JSON.stringify({ id: 1, date: '2026-06-01', company: 'AcmeFetch', role: 'Staff Engineer', status: 'applied' }) + '\n');

    const memProvider = {
      id: 'mem',
      async fetch(entry) {
        return [
          { title: 'Senior Engineer', url: 'https://acme.example/new1', company: entry.name, location: 'Remote' }, // survives
          { title: 'Backend Engineer', url: 'https://acme.example/seen', company: entry.name, location: 'Remote' }, // dup URL (history)
          { title: 'Staff Engineer', url: 'https://acme.example/new2', company: entry.name, location: 'Remote' },   // dup key (tracker)
          { title: 'Platform Engineer', url: 'https://acme.example/new3', company: entry.name, location: 'Remote' },// dup key (inbox)
          { title: 'Marketing Intern', url: 'https://acme.example/new4', company: entry.name, location: 'Remote' }, // title filtered
        ];
      },
    };
    const providers = new Map([[memProvider.id, memProvider]]);
    const result = await scan({ paths, providers, today: '2026-06-07', ctxFactory: () => ({}) });
    ok(result.companies === 1, `scan: only 1 enabled company scanned (got ${result.companies})`);
    ok(result.counts.added === 1, `scan: 1 survivor (got ${result.counts.added})`);
    ok(result.added[0].url === 'https://acme.example/new1', 'scan: correct survivor url');
    ok(result.date === '2026-06-07', 'scan: --today override honored');

    // dry-run writes nothing
    const dry = persist(result, { paths, dryRun: true });
    ok(dry.wrote === false && dry.inboxAdds.length === 1, 'persist: dry-run computes but does not write');
    ok(!readIfExists(paths.inbox).includes('new1'), 'persist: dry-run left inbox unchanged');

    // real persist appends
    const wrote = persist(result, { paths, dryRun: false });
    ok(wrote.wrote === true, 'persist: real write happened');
    const inboxAfter = readIfExists(paths.inbox);
    ok(inboxAfter.includes('- [ ] https://acme.example/new1 | AcmeFetch | Senior Engineer'), 'persist: inbox line appended');
    const histAfter = readIfExists(paths.history);
    ok(histAfter.includes('https://acme.example/new1\tAcmeFetch\tSenior Engineer\tadded\t2026-06-07'), 'persist: history added row');
    ok(histAfter.includes('skipped_dup'), 'persist: history records skipped_dup rows');
    ok(histAfter.includes('skipped_filter'), 'persist: history records skipped_filter rows');

    // re-scan after persist => the survivor is now deduped (idempotency)
    const result2 = await scan({ paths, providers, today: '2026-06-07', ctxFactory: () => ({}) });
    ok(result2.counts.added === 0, `scan: re-scan adds nothing (idempotent), got ${result2.counts.added}`);

    // --company filter
    const resultFiltered = await scan({ paths, providers, today: '2026-06-07', companyFilter: 'nomatch', ctxFactory: () => ({}) });
    ok(resultFiltered.companies === 0, 'scan: --company with no match scans 0');

    console.log(`scan self-test: ${n} checks passed`);
    return 0;
  } catch (err) {
    console.error(`scan self-test FAILED: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    return 1;
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const isSelfTest = process.argv.slice(2).includes('--self-test');
  if (isSelfTest) {
    selfTest().then((code) => process.exit(code)).catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
  } else {
    main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
  }
}
