#!/usr/bin/env node
// scripts/hunt-ingest.mjs — turn a list of discovered job postings into deduped,
// saved JDs the board can rank. Source-agnostic: the array can come from the MCP
// job boards (Indeed/Dice, via modes/hunt.md), an ATS export, or a pasted list.
//
// It REUSES the existing engine — it does not reinvent dedup or persistence:
//   • scan.mjs   → buildSeen / classifyJobs / persist / makeTitleFilter /
//                  makeLocationFilter   (same dedup ledger + filters as `scan`)
//   • fetch-jd.mjs → saveJd / toISODate / htmlToText   (same data/jds/*.md format)
//   • records.mjs  → readTracker   (dedup against applications already tracked)
//
// Because it writes to the SAME inbox + scan-history ledger as `scan`, hunt and
// scan dedup against each other — you never get a posting twice. Saved JDs carry
// the full description, so `board.mjs` scores them with zero further network.
//
// Zero tokens, deterministic, only dep js-yaml (transitively, for portals.yml).
//
// Usage:
//   node scripts/hunt-ingest.mjs --file jobs.json            # array of postings
//   cat jobs.json | node scripts/hunt-ingest.mjs             # via stdin
//   node scripts/hunt-ingest.mjs --file jobs.json --dry-run  # preview, write nothing
//   node scripts/hunt-ingest.mjs --file jobs.json --source indeed
//   node scripts/hunt-ingest.mjs --strict       # apply portals.yml positive title filter too
//   node scripts/hunt-ingest.mjs --no-filter    # ignore portals.yml filters entirely
//   node scripts/hunt-ingest.mjs --self-test
//
// Input item shape (all but title+url optional; many aliases accepted):
//   { title, company, location, url, posted, description, source }

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import {
  buildSeen, classifyJobs, persist, makeTitleFilter, makeLocationFilter,
} from './scan.mjs';
import { saveJd, toISODate, htmlToText } from './fetch-jd.mjs';
import { readTracker } from '../lib/records.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PATHS = {
  portals: join(ROOT, 'data', 'portals.yml'),
  inbox: join(ROOT, 'data', 'inbox.md'),
  history: join(ROOT, 'data', 'scan-history.tsv'),
  tracker: join(ROOT, 'data', 'tracker.jsonl'),
  jds: join(ROOT, 'data', 'jds'),
};

// ─── pure helpers ─────────────────────────────────────────────────────

function firstStr(...vals) {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

// Accept the raw array, or a common envelope ({results|jobs|data|postings:[...]}).
export function unwrapItems(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const k of ['results', 'jobs', 'data', 'postings', 'items']) {
      if (Array.isArray(parsed[k])) return parsed[k];
    }
  }
  return [];
}

// Normalize one raw posting (whatever its source's field names) to the engine's
// Job shape + a description. Returns null if it lacks a title or url.
export function coerceItem(raw, fallbackSource = 'hunt') {
  if (!raw || typeof raw !== 'object') return null;
  const title = firstStr(raw.title, raw.role, raw.position, raw.jobTitle, raw.name);
  const url = firstStr(raw.url, raw.link, raw.apply_url, raw.applyUrl, raw.jobUrl, raw.job_url, raw.detailsUrl);
  if (!title || !url) return null;
  const postedRaw = raw.posted ?? raw.date ?? raw.posted_at ?? raw.postedAt ?? raw.datePosted ?? raw.postedDate ?? '';
  return {
    title,
    url,
    company: firstStr(raw.company, raw.employer, raw.organization, raw.companyName, raw.company_name) || '',
    location: firstStr(raw.location, raw.city, raw.place, raw.region, raw.formattedLocation) || '',
    posted: toISODate(postedRaw),
    description: firstStr(raw.description, raw.content, raw.summary, raw.snippet, raw.jobDescription, raw.body) || '',
    source: firstStr(raw.source, fallbackSource) || 'hunt',
  };
}

// Resolve the title + location filters from portals.yml per the chosen mode.
//   'default' → keep portals NEGATIVE title filter + location filter, but DON'T
//               require a positive title match (the hunt query is the positive
//               signal). This is the right default for broad discovery.
//   'strict'  → apply the full portals title filter (positive + negative).
//   'none'    → pass everything (ignore portals entirely).
export function resolveFilters(config, mode = 'default') {
  if (mode === 'none' || !config) {
    return { titleFilter: makeTitleFilter(undefined), locationFilter: makeLocationFilter(undefined) };
  }
  const locationFilter = makeLocationFilter(config.location_filter);
  if (mode === 'strict') {
    return { titleFilter: makeTitleFilter(config.title_filter), locationFilter };
  }
  // default: drop the positive requirement, keep negatives
  const negative = config.title_filter && config.title_filter.negative;
  return { titleFilter: makeTitleFilter({ positive: [], negative }), locationFilter };
}

// ─── core ─────────────────────────────────────────────────────────────

// Ingest a list of raw postings. Does the dedup + (unless dryRun) the writes.
// Returns a summary object. `paths`/`today`/`mode`/`source` injectable for tests.
export function ingest(rawItems, { paths = DEFAULT_PATHS, today, mode = 'default', source = 'hunt', dryRun = false } = {}) {
  const date = today || new Date().toISOString().slice(0, 10);

  const config = existsSync(paths.portals) ? (yaml.load(readFileSync(paths.portals, 'utf8')) || {}) : null;
  const { titleFilter, locationFilter } = resolveFilters(config, mode);

  const seen = buildSeen({
    historyText: existsSync(paths.history) ? readFileSync(paths.history, 'utf8') : '',
    inboxText: existsSync(paths.inbox) ? readFileSync(paths.inbox, 'utf8') : '',
    trackerRecords: existsSync(paths.tracker) ? readTracker(paths.tracker) : [],
  });

  const items = unwrapItems(rawItems);
  const jobs = items.map((it) => coerceItem(it, source)).filter(Boolean);
  const dropped = items.length - jobs.length; // missing title/url

  const { added, ledger, counts } = classifyJobs(jobs, { titleFilter, locationFilter, seen });

  // Save each survivor as a full data/jds/*.md (so the board scores it with no
  // network), then append to the inbox + history ledger via scan's persist().
  const savedJds = [];
  if (!dryRun) {
    for (const job of added) {
      const posting = {
        role: job.title,
        company: job.company || '(company n/a)',
        location: job.location || '',
        url: job.url,
        posted: job.posted || '',
        source: job.source || source,
        content: htmlToText(job.description || ''),
      };
      try {
        const p = saveJd(posting, date, { dir: paths.jds });
        savedJds.push(p.replace(ROOT + '/', ''));
      } catch { /* a bad single posting shouldn't abort the batch */ }
    }
  }

  const result = { date, added, ledger, counts };
  const persisted = persist(result, { paths, dryRun });

  return {
    ok: true,
    source,
    mode,
    date,
    counts: { ...counts, dropped },
    added: added.map((j) => ({ company: j.company, title: j.title, location: j.location, url: j.url, posted: j.posted || '' })),
    saved_jds: savedJds,
    wrote: persisted.wrote,
    inbox_appended: persisted.inboxAdds.length,
    history_appended: persisted.historyAdds.length,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { file: null, dryRun: false, json: true, source: 'hunt', mode: 'default', selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--strict') out.mode = 'strict';
    else if (a === '--no-filter') out.mode = 'none';
    else if (a === '--file') out.file = val();
    else if (a.startsWith('--file=')) out.file = a.slice(7);
    else if (a === '--source') out.source = val() || 'hunt';
    else if (a.startsWith('--source=')) out.source = a.slice(9) || 'hunt';
  }
  return out;
}

const USAGE = `hunt-ingest — normalize + dedup discovered job postings into the board queue.
Usage: node scripts/hunt-ingest.mjs (--file <jobs.json> | < jobs.json) [--source <name>] [--dry-run] [--strict|--no-filter] [--summary]
  Input: a JSON array of postings (or {results|jobs:[...]}). Each: {title,url,company?,location?,posted?,description?}.
  --strict     also require portals.yml positive title filter (default: keep only negatives)
  --no-filter  ignore portals.yml filters entirely
  --dry-run    compute counts but write nothing
  --self-test  run built-in tests`;

function readInput(file) {
  if (file) {
    if (!existsSync(file)) throw new Error(`--file not found: ${file}`);
    return readFileSync(file, 'utf8');
  }
  if (process.stdin.isTTY) throw new Error('no input — pass --file <jobs.json> or pipe JSON on stdin');
  return readFileSync(0, 'utf8'); // fd 0 = stdin
}

function printSummary(r) {
  const c = r.counts;
  const lines = [
    `careeros hunt-ingest — ${r.date} (source: ${r.source}, filters: ${r.mode})`,
    '',
    `  postings received:    ${c.found + (c.dropped || 0)}`,
    `  dropped (no title/url): ${c.dropped || 0}`,
    `  filtered (title):     ${c.filteredTitle}`,
    `  filtered (location):  ${c.filteredLocation}`,
    `  duplicates:           ${c.dup}`,
    `  new openings added:   ${c.added}`,
  ];
  if (r.added.length) {
    lines.push('', '  new openings:');
    for (const j of r.added) lines.push(`    + ${j.company || '(no company)'} | ${j.title} | ${j.location || 'N/A'}${j.posted ? ` | ${j.posted}` : ''}`);
  }
  lines.push('', r.wrote
    ? `  saved ${r.saved_jds.length} JD${r.saved_jds.length === 1 ? '' : 's'}, +${r.inbox_appended} inbox, +${r.history_appended} history. Run \`/cos board\`.`
    : '  (dry run — nothing written)');
  console.log(lines.join('\n'));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
  if (args.selfTest) process.exit(selfTest());
  let parsed;
  try { parsed = JSON.parse(readInput(args.file)); }
  catch (e) {
    const msg = `could not read JSON input: ${e.message}`;
    if (args.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    process.exit(1);
  }
  const result = ingest(parsed, { source: args.source, mode: args.mode, dryRun: args.dryRun });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printSummary(result);
  process.exit(0);
}

// ─── self-test ────────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (x, y, m) => { assert.equal(x, y, m); n++; };
  const tmp = join(tmpdir(), `of-hunt-${process.pid}-${Date.now()}`);
  const paths = {
    portals: join(tmp, 'data', 'portals.yml'),
    inbox: join(tmp, 'data', 'inbox.md'),
    history: join(tmp, 'data', 'scan-history.tsv'),
    tracker: join(tmp, 'data', 'tracker.jsonl'),
    jds: join(tmp, 'data', 'jds'),
  };
  mkdirSync(join(tmp, 'data'), { recursive: true });
  try {
    // coerceItem aliases + required fields
    ok(coerceItem({ title: 'X', url: 'https://a/1' }), 'coerce: minimal item ok');
    eq(coerceItem({ role: 'Dev', link: 'https://a/2', employer: 'Acme' }).company, 'Acme', 'coerce: aliases (role/link/employer)');
    eq(coerceItem({ title: 'X' }), null, 'coerce: missing url -> null');
    eq(coerceItem({ url: 'https://a/3' }), null, 'coerce: missing title -> null');
    eq(coerceItem({ title: 'X', url: 'https://a/4', posted: 1700000000 }).posted, toISODate(1700000000), 'coerce: epoch posted normalized');

    // unwrapItems envelopes
    eq(unwrapItems([{ a: 1 }]).length, 1, 'unwrap: array passthrough');
    eq(unwrapItems({ results: [{ a: 1 }, { b: 2 }] }).length, 2, 'unwrap: {results}');
    eq(unwrapItems({ jobs: [{ a: 1 }] }).length, 1, 'unwrap: {jobs}');
    eq(unwrapItems({ nope: 1 }).length, 0, 'unwrap: unknown -> []');

    // resolveFilters default keeps negatives, drops positive requirement
    const cfg = { title_filter: { positive: ['data engineer'], negative: ['intern'] }, location_filter: { block: ['europe'] } };
    const fDefault = resolveFilters(cfg, 'default');
    ok(fDefault.titleFilter('Senior ML Engineer'), 'filters default: non-positive title still passes');
    ok(!fDefault.titleFilter('Data Intern'), 'filters default: negative still excludes');
    ok(!fDefault.locationFilter('Berlin, Europe'), 'filters default: location block applies');
    const fStrict = resolveFilters(cfg, 'strict');
    ok(!fStrict.titleFilter('Senior ML Engineer'), 'filters strict: positive required');
    const fNone = resolveFilters(cfg, 'none');
    ok(fNone.titleFilter('anything at all') && fNone.locationFilter('Berlin, Europe'), 'filters none: pass-through');

    // seed dedup sources: history has /seen, tracker has Acme/Staff Engineer
    writeFileSync(paths.portals, yaml.dump(cfg));
    writeFileSync(paths.history, 'url\tcompany\ttitle\tstatus\tdate\nhttps://seen.example/old\tAcme\tBackend Engineer\tadded\t2026-06-01\n');
    writeFileSync(paths.tracker, JSON.stringify({ id: 1, date: '2026-06-01', company: 'Acme', role: 'Staff Engineer', status: 'applied' }) + '\n');

    const items = [
      { title: 'Senior Engineer', url: 'https://new.example/1', company: 'Acme', location: 'Remote', description: '<p>Build <b>pipelines</b> in Python &amp; SQL.</p>' }, // added
      { title: 'Backend Engineer', url: 'https://seen.example/old', company: 'Acme', location: 'Remote' }, // dup URL (history)
      { title: 'Staff Engineer', url: 'https://x.example/2', company: 'Acme', location: 'Remote' },        // dup key (tracker)
      { title: 'Frontend Engineer', url: 'https://eu.example/3', company: 'Acme', location: 'Berlin, Europe' }, // location filtered
      { title: 'Data Intern', url: 'https://int.example/4', company: 'Acme', location: 'Remote' },          // title filtered (negative)
      { title: 'Senior Engineer', url: 'https://intra.example/5', company: 'Acme', location: 'Remote' },    // intra-batch dup key of #1
      { url: 'https://noTitle.example/6' },                                                                 // dropped (no title)
    ];

    const r = ingest(items, { paths, today: '2026-06-07', source: 'indeed' });
    eq(r.counts.added, 1, `ingest: exactly 1 added (got ${r.counts.added})`);
    eq(r.counts.dup, 3, `ingest: 3 dups incl. intra-batch (got ${r.counts.dup})`);
    eq(r.counts.filteredTitle, 1, `ingest: 1 title-filtered (got ${r.counts.filteredTitle})`);
    eq(r.counts.filteredLocation, 1, `ingest: 1 location-filtered (got ${r.counts.filteredLocation})`);
    eq(r.counts.dropped, 1, 'ingest: 1 dropped (no title)');
    eq(r.saved_jds.length, 1, 'ingest: 1 JD saved');
    eq(r.added[0].url, 'https://new.example/1', 'ingest: correct survivor');

    // the saved JD has the heading, url, and decoded body (board can parse + score it)
    const jdFiles = readdirSync(paths.jds);
    eq(jdFiles.length, 1, 'ingest: one jd file on disk');
    const jd = readFileSync(join(paths.jds, jdFiles[0]), 'utf8');
    ok(jd.includes('# Senior Engineer — Acme'), 'jd: heading "Role — Company"');
    ok(jd.includes('- URL: https://new.example/1'), 'jd: url field present (board dedups on it)');
    ok(jd.includes('Build pipelines in Python & SQL') && !jd.includes('<p>'), 'jd: html decoded to text');

    // inbox + history appended
    ok(readFileSync(paths.inbox, 'utf8').includes('- [ ] https://new.example/1 | Acme | Senior Engineer'), 'inbox: survivor line appended');
    ok(readFileSync(paths.history, 'utf8').includes('https://new.example/1\tAcme\tSenior Engineer\tadded\t2026-06-07'), 'history: added row');

    // idempotent re-run adds nothing
    const r2 = ingest(items, { paths, today: '2026-06-07', source: 'indeed' });
    eq(r2.counts.added, 0, `ingest: re-run is idempotent (got ${r2.counts.added})`);
    eq(readdirSync(paths.jds).length, 1, 'ingest: re-run saves no new jd');

    // dry-run writes nothing new
    const before = readFileSync(paths.inbox, 'utf8');
    const r3 = ingest([{ title: 'Fresh Role', url: 'https://fresh.example/9', company: 'NewCo', location: 'Remote' }], { paths, today: '2026-06-07', dryRun: true });
    eq(r3.counts.added, 1, 'dry-run: would add 1');
    eq(r3.wrote, false, 'dry-run: wrote=false');
    eq(readFileSync(paths.inbox, 'utf8'), before, 'dry-run: inbox unchanged');

    console.log(`hunt-ingest self-test: ${n} checks passed`);
    return 0;
  } catch (e) {
    console.error(`hunt-ingest self-test FAILED: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    return 1;
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    process.exit(selfTest());
  } else {
    main();
  }
}
