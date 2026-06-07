#!/usr/bin/env node
// scripts/batch.mjs — resumable batch driver for evaluating a queue of offers.
//
// The AGENT does the actual per-offer evaluation; THIS script only orchestrates
// state and reserves report numbers so a batch run can be stopped and resumed.
//
// Input : data/batch/batch-input.tsv   (columns: url \t company \t title; header optional)
// State : data/batch/batch-state.tsv   (columns: url \t status \t report_num \t score \t retries \t updated)
//         status ∈ pending | processing | completed | failed
//
// Subcommands:
//   init                          seed state from input (new rows -> pending)
//   next                          print next pending row as JSON AND atomically reserve
//                                 a report number (= max(existing NNN in data/reports/,
//                                 max report_num in state) + 1) and mark the row 'processing'
//   complete --url U --report N --score S   mark a row completed
//   fail --url U                  increment retries, mark the row failed
//   status [--summary]            counts by state
//
// Flags:
//   --retry-failed   reset all failed rows -> pending (with init or standalone)
//   --start-from N   when seeding/iterating, skip input rows before 1-based index N
//   --dry-run        compute + print, but don't write the state file
//   --today=YYYY-MM-DD  override the clock (deterministic self-tests)
//   --json | --summary  output style (JSON is the default for machine callers)
//   --self-test      run in os.tmpdir(), assert, print "<name> self-test: N checks passed"
//
// Exit 0 on success, 1 on failure. Only dependency-free Node stdlib.

import {
  existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const STATE_HEADER = ['url', 'status', 'report_num', 'score', 'retries', 'updated'];
export const VALID_STATES = ['pending', 'processing', 'completed', 'failed'];

// ---------- arg parsing ----------
export function parseArgs(argv) {
  const out = {
    _: [], json: false, summary: false, selfTest: false,
    dryRun: false, retryFailed: false, startFrom: null,
    url: null, report: null, score: null, today: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--summary') out.summary = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--retry-failed') out.retryFailed = true;
    else if (a === '--start-from') out.startFrom = Number(argv[++i]);
    else if (a.startsWith('--start-from=')) out.startFrom = Number(a.slice('--start-from='.length));
    else if (a === '--url') out.url = argv[++i];
    else if (a.startsWith('--url=')) out.url = a.slice('--url='.length);
    else if (a === '--report') out.report = argv[++i];
    else if (a.startsWith('--report=')) out.report = a.slice('--report='.length);
    else if (a === '--score') out.score = argv[++i];
    else if (a.startsWith('--score=')) out.score = a.slice('--score='.length);
    else if (a === '--today') out.today = argv[++i];
    else if (a.startsWith('--today=')) out.today = a.slice('--today='.length);
    else out._.push(a);
  }
  return out;
}

function todayStr(override) {
  if (override) return override;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- TSV I/O ----------
// Split a TSV line into trimmed cells.
function splitTsv(line) {
  return line.split('\t').map((c) => c.trim());
}

// True if the first cell of a row looks like the literal column header "url"
// (so an optional header line in either input or state is ignored, not parsed).
function looksLikeHeader(cells) {
  return (cells[0] || '').toLowerCase() === 'url';
}

// Parse batch-input.tsv -> [{ url, company, title }]. Header optional.
// Blank lines skipped; rows missing a url are skipped.
export function parseInput(text) {
  const rows = [];
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const c = splitTsv(line);
    if (looksLikeHeader(c)) continue;
    const url = c[0] || '';
    if (!url) continue;
    rows.push({ url, company: c[1] || '', title: c[2] || '' });
  }
  return rows;
}

// Parse batch-state.tsv -> [{ url, status, report_num, score, retries, updated }].
// Header optional. report_num/score are numbers|null; retries is an int.
export function parseState(text) {
  const rows = [];
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const c = splitTsv(line);
    if (looksLikeHeader(c)) continue;
    const url = c[0] || '';
    if (!url) continue;
    rows.push({
      url,
      status: VALID_STATES.includes(c[1]) ? c[1] : 'pending',
      report_num: numOrNull(c[2]),
      score: numOrNull(c[3]),
      retries: Number.isFinite(Number(c[4])) ? Number(c[4]) : 0,
      updated: c[5] || '',
    });
  }
  return rows;
}

function numOrNull(s) {
  if (s == null || s === '' || /^(null|n\/?a|-)$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// Serialize state rows back to TSV (always with header). Stable column order.
export function serializeState(rows) {
  const cell = (v) => (v == null ? '' : String(v)).replace(/[\t\r\n]/g, ' ');
  const body = rows.map((r) => [
    cell(r.url),
    cell(r.status),
    r.report_num == null ? '' : String(r.report_num),
    r.score == null ? '' : String(r.score),
    String(r.retries == null ? 0 : r.retries),
    cell(r.updated || ''),
  ].join('\t'));
  return [STATE_HEADER.join('\t'), ...body].join('\n') + '\n';
}

function readState(statePath) {
  if (!existsSync(statePath)) return [];
  return parseState(readFileSync(statePath, 'utf8'));
}

function writeState(statePath, rows) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, serializeState(rows));
}

// ---------- report-number scanning ----------
// Highest NNN prefix among data/reports/NNN-slug-DATE.md files (0 if none).
export function maxReportNumInDir(reportsDir) {
  if (!existsSync(reportsDir)) return 0;
  let mx = 0;
  for (const f of readdirSync(reportsDir)) {
    const m = f.match(/^(\d{2,})[-_]/);
    if (m) mx = Math.max(mx, parseInt(m[1], 10));
  }
  return mx;
}

// Highest report_num recorded in the state rows (0 if none).
export function maxReportNumInState(stateRows) {
  return stateRows.reduce(
    (mx, r) => Math.max(mx, Number.isFinite(Number(r.report_num)) ? Number(r.report_num) || 0 : 0),
    0,
  );
}

// The number to hand out next = max(filesystem, state) + 1. Pure.
export function reserveReportNumber(stateRows, reportsDir) {
  return Math.max(maxReportNumInDir(reportsDir), maxReportNumInState(stateRows)) + 1;
}

// ---------- pure state transitions ----------
// Find a row by exact url; returns index or -1.
function findRow(rows, url) {
  return rows.findIndex((r) => r.url === url);
}

// Seed/refresh state from input rows. New input urls -> pending; existing rows
// are kept as-is (resumable). With retryFailed, failed rows reset to pending.
// startFrom (1-based) skips input rows before that index when adding new ones.
// Mutates and returns { rows, added, reset }.
export function applyInit(stateRows, inputRows, { retryFailed = false, startFrom = null } = {}, today = todayStr()) {
  const rows = stateRows.map((r) => ({ ...r }));
  const seen = new Set(rows.map((r) => r.url));
  let added = 0, reset = 0;

  const start = startFrom && startFrom > 1 ? startFrom - 1 : 0;
  inputRows.forEach((inp, i) => {
    if (i < start) return;
    if (seen.has(inp.url)) return;
    rows.push({ url: inp.url, status: 'pending', report_num: null, score: null, retries: 0, updated: today });
    seen.add(inp.url);
    added++;
  });

  if (retryFailed) {
    for (const r of rows) {
      if (r.status === 'failed') { r.status = 'pending'; r.updated = today; reset++; }
    }
  }
  return { rows, added, reset };
}

// Reset every failed row -> pending. Mutates copies; returns { rows, reset }.
export function applyRetryFailed(stateRows, today = todayStr()) {
  const rows = stateRows.map((r) => ({ ...r }));
  let reset = 0;
  for (const r of rows) {
    if (r.status === 'failed') { r.status = 'pending'; r.updated = today; reset++; }
  }
  return { rows, reset };
}

// Reserve the next report number, mark the next pending row 'processing', stamp
// its report_num. Returns { rows, row, reportNum } or { rows, row:null } if none.
// startFrom (1-based, by position in the state array) skips earlier rows.
export function applyNext(stateRows, reportsDir, { startFrom = null } = {}, today = todayStr()) {
  const rows = stateRows.map((r) => ({ ...r }));
  const start = startFrom && startFrom > 1 ? startFrom - 1 : 0;
  let idx = -1;
  for (let i = start; i < rows.length; i++) {
    if (rows[i].status === 'pending') { idx = i; break; }
  }
  if (idx === -1) return { rows, row: null, reportNum: null };

  const reportNum = reserveReportNumber(rows, reportsDir);
  rows[idx] = {
    ...rows[idx], status: 'processing', report_num: reportNum, updated: today,
  };
  return { rows, row: rows[idx], reportNum };
}

// Mark a url completed with a report number and score. Mutates copies.
// Returns { rows, row, ok } (ok=false if the url isn't in state).
export function applyComplete(stateRows, { url, report, score }, today = todayStr()) {
  const rows = stateRows.map((r) => ({ ...r }));
  const idx = findRow(rows, url);
  if (idx === -1) return { rows, row: null, ok: false };
  rows[idx] = {
    ...rows[idx],
    status: 'completed',
    report_num: numOrNull(report != null ? String(report) : rows[idx].report_num),
    score: numOrNull(score != null ? String(score) : rows[idx].score),
    updated: today,
  };
  return { rows, row: rows[idx], ok: true };
}

// Mark a url failed and bump its retry counter. Mutates copies.
// Returns { rows, row, ok }.
export function applyFail(stateRows, { url }, today = todayStr()) {
  const rows = stateRows.map((r) => ({ ...r }));
  const idx = findRow(rows, url);
  if (idx === -1) return { rows, row: null, ok: false };
  rows[idx] = {
    ...rows[idx],
    status: 'failed',
    retries: (Number(rows[idx].retries) || 0) + 1,
    updated: today,
  };
  return { rows, row: rows[idx], ok: true };
}

// Count rows by state.
export function statusCounts(stateRows) {
  const counts = { total: stateRows.length };
  for (const s of VALID_STATES) counts[s] = 0;
  for (const r of stateRows) {
    if (counts[r.status] == null) counts[r.status] = 0;
    counts[r.status]++;
  }
  return counts;
}

// ---------- output ----------
function out(obj, args) {
  if (args.summary && !args.json) return;
  console.log(JSON.stringify(obj, null, 2));
}

// ---------- main ----------
export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();

  const today = todayStr(args.today);
  const inputPath = join(ROOT, 'data', 'batch', 'batch-input.tsv');
  const statePath = join(ROOT, 'data', 'batch', 'batch-state.tsv');
  const reportsDir = join(ROOT, 'data', 'reports');

  const cmd = args._[0] || (args.retryFailed ? 'retry' : 'status');
  const state = readState(statePath);

  if (cmd === 'init') {
    const input = existsSync(inputPath) ? parseInput(readFileSync(inputPath, 'utf8')) : [];
    const { rows, added, reset } = applyInit(state, input, { retryFailed: args.retryFailed, startFrom: args.startFrom }, today);
    if (!args.dryRun) writeState(statePath, rows);
    const result = { command: 'init', added, reset, dry_run: args.dryRun, ...statusCounts(rows) };
    if (args.summary && !args.json) printStatus(result, `init${args.dryRun ? ' (dry-run)' : ''}`);
    else out(result, args);
    return 0;
  }

  if (cmd === 'next') {
    const { rows, row, reportNum } = applyNext(state, reportsDir, { startFrom: args.startFrom }, today);
    if (!row) {
      const result = { command: 'next', row: null, message: 'no pending rows' };
      if (args.summary && !args.json) console.log('next: no pending rows');
      else out(result, args);
      return 0;
    }
    if (!args.dryRun) writeState(statePath, rows); // reserve BEFORE returning
    // Enrich with company/title from input if available (best effort).
    let company = '', title = '';
    if (existsSync(inputPath)) {
      const inp = parseInput(readFileSync(inputPath, 'utf8')).find((r) => r.url === row.url);
      if (inp) { company = inp.company; title = inp.title; }
    }
    const result = {
      command: 'next', url: row.url, company, title,
      report_num: reportNum, status: row.status, dry_run: args.dryRun,
    };
    if (args.summary && !args.json) console.log(`next: ${row.url}  report ${reportNum}  -> processing`);
    else out(result, args);
    return 0;
  }

  if (cmd === 'complete') {
    if (!args.url) { console.error('complete: --url required'); return 1; }
    const { rows, row, ok } = applyComplete(state, { url: args.url, report: args.report, score: args.score }, today);
    if (!ok) { console.error(`complete: url not in state: ${args.url}`); return 1; }
    if (!args.dryRun) writeState(statePath, rows);
    const result = { command: 'complete', url: row.url, report_num: row.report_num, score: row.score, status: row.status, dry_run: args.dryRun };
    if (args.summary && !args.json) console.log(`complete: ${row.url}  report ${row.report_num}  score ${row.score} -> completed`);
    else out(result, args);
    return 0;
  }

  if (cmd === 'fail') {
    if (!args.url) { console.error('fail: --url required'); return 1; }
    const { rows, row, ok } = applyFail(state, { url: args.url }, today);
    if (!ok) { console.error(`fail: url not in state: ${args.url}`); return 1; }
    if (!args.dryRun) writeState(statePath, rows);
    const result = { command: 'fail', url: row.url, retries: row.retries, status: row.status, dry_run: args.dryRun };
    if (args.summary && !args.json) console.log(`fail: ${row.url}  retries ${row.retries} -> failed`);
    else out(result, args);
    return 0;
  }

  if (cmd === 'retry' || (cmd === 'status' && args.retryFailed)) {
    const { rows, reset } = applyRetryFailed(state, today);
    if (!args.dryRun) writeState(statePath, rows);
    const result = { command: 'retry-failed', reset, dry_run: args.dryRun, ...statusCounts(rows) };
    if (args.summary && !args.json) printStatus(result, `retry-failed (${reset} reset)${args.dryRun ? ' (dry-run)' : ''}`);
    else out(result, args);
    return 0;
  }

  if (cmd === 'status') {
    const result = { command: 'status', ...statusCounts(state) };
    if (args.summary && !args.json) printStatus(result, 'status');
    else out(result, args);
    return 0;
  }

  console.error(`batch: unknown command "${cmd}" (init|next|complete|fail|status)`);
  return 1;
}

function printStatus(result, label) {
  console.log(`batch ${label}`);
  console.log(`  total:      ${result.total}`);
  for (const s of VALID_STATES) console.log(`  ${(s + ':').padEnd(11)} ${result[s] || 0}`);
}

// ---------- self-test ----------
function selfTest() {
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

  const work = join(tmpdir(), `aw-batch-test-${process.pid}-${Date.now()}`);
  const inputPath = join(work, 'batch-input.tsv');
  const statePath = join(work, 'batch-state.tsv');
  const reportsDir = join(work, 'reports');
  const TODAY = '2026-06-07';

  const cleanup = () => { try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } };

  try {
    mkdirSync(work, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });

    // --- parseInput: header optional, blanks/headerless tolerated ---
    {
      const a = parseInput('url\tcompany\ttitle\nhttp://a\tAcme\tSWE\nhttp://b\tGlobex\tSRE\n');
      eq(a.length, 2, 'parseInput skips header');
      eq(a[0], { url: 'http://a', company: 'Acme', title: 'SWE' }, 'parseInput first row');
      const b = parseInput('http://c\tInitech\tPlatform\n\n');
      eq(b.length, 1, 'parseInput headerless + blank lines');
    }

    // --- init seeds 2 rows pending ---
    writeFileSync(inputPath, 'url\tcompany\ttitle\nhttp://a\tAcme\tSWE\nhttp://b\tGlobex\tSRE\n');
    {
      const input = parseInput(readFileSync(inputPath, 'utf8'));
      const { rows, added } = applyInit([], input, {}, TODAY);
      eq(added, 2, 'init added 2 rows');
      eq(statusCounts(rows), { total: 2, pending: 2, processing: 0, completed: 0, failed: 0 }, 'init -> 2 pending');
      ok(rows.every((r) => r.report_num == null && r.retries === 0), 'init rows have no report_num / 0 retries');
      writeState(statePath, rows);
    }

    // --- init is idempotent (re-seeding adds nothing) ---
    {
      const state = parseState(readFileSync(statePath, 'utf8'));
      const input = parseInput(readFileSync(inputPath, 'utf8'));
      const { added } = applyInit(state, input, {}, TODAY);
      eq(added, 0, 'init is idempotent on existing urls');
    }

    // --- reserveReportNumber respects both the dir and the state ---
    {
      eq(reserveReportNumber([], reportsDir), 1, 'empty -> reserve 1');
      writeFileSync(join(reportsDir, '003-acme-2026-06-01.md'), '# r');
      eq(maxReportNumInDir(reportsDir), 3, 'dir max from NNN- prefix');
      eq(reserveReportNumber([], reportsDir), 4, 'dir of max 3 -> reserve 4');
      eq(reserveReportNumber([{ report_num: 9 }], reportsDir), 10, 'state max 9 beats dir -> reserve 10');
    }

    // --- next reserves a number, marks processing, writes BEFORE returning ---
    let firstUrl;
    {
      const state = parseState(readFileSync(statePath, 'utf8'));
      const { rows, row, reportNum } = applyNext(state, reportsDir, {}, TODAY);
      // dir has 003 from above => next free is 004
      eq(reportNum, 4, 'next reserves 4 (max dir 3)');
      eq(row.status, 'processing', 'next marks row processing');
      eq(row.report_num, 4, 'next stamps report_num on the row');
      firstUrl = row.url;
      writeState(statePath, rows);
      // persisted?
      const persisted = parseState(readFileSync(statePath, 'utf8'));
      const pr = persisted.find((r) => r.url === firstUrl);
      eq(pr.status, 'processing', 'processing persisted to disk');
      eq(pr.report_num, 4, 'reserved number persisted to disk');
      eq(statusCounts(persisted), { total: 2, pending: 1, processing: 1, completed: 0, failed: 0 }, 'after next: 1 pending 1 processing');
    }

    // --- a subsequent next reserves the NEXT number (no collision) ---
    {
      const state = parseState(readFileSync(statePath, 'utf8'));
      const { row, reportNum } = applyNext(state, reportsDir, {}, TODAY);
      eq(reportNum, 5, 'second next reserves 5 (4 already in state)');
      ok(row.url !== firstUrl, 'second next picks the other pending row');
    }

    // --- complete marks completed with report+score ---
    {
      const state = parseState(readFileSync(statePath, 'utf8'));
      const { rows, row, ok: cok } = applyComplete(state, { url: firstUrl, report: '4', score: '4.6' }, TODAY);
      ok(cok, 'complete found the url');
      eq(row.status, 'completed', 'complete -> completed');
      eq(row.report_num, 4, 'complete keeps report_num');
      eq(row.score, 4.6, 'complete records numeric score');
      writeState(statePath, rows);
      eq(statusCounts(parseState(readFileSync(statePath, 'utf8'))),
        { total: 2, pending: 1, processing: 0, completed: 1, failed: 0 }, 'after complete counts');
    }

    // --- fail bumps retries and marks failed ---
    {
      const state = parseState(readFileSync(statePath, 'utf8'));
      const pendingUrl = state.find((r) => r.status === 'pending').url;
      const { rows, row, ok: fok } = applyFail(state, { url: pendingUrl }, TODAY);
      ok(fok, 'fail found the url');
      eq(row.status, 'failed', 'fail -> failed');
      eq(row.retries, 1, 'fail bumps retries to 1');
      writeState(statePath, rows);
      eq(statusCounts(parseState(readFileSync(statePath, 'utf8'))),
        { total: 2, pending: 0, processing: 0, completed: 1, failed: 1 }, 'after fail counts');
    }

    // --- retry-failed resets failed -> pending (keeps retries) ---
    {
      const state = parseState(readFileSync(statePath, 'utf8'));
      const { rows, reset } = applyRetryFailed(state, TODAY);
      eq(reset, 1, 'retry-failed reset 1 row');
      eq(statusCounts(rows), { total: 2, pending: 1, processing: 0, completed: 1, failed: 0 }, 'failed -> pending');
      const wasFailed = rows.find((r) => r.retries === 1);
      eq(wasFailed.status, 'pending', 'reset row is pending again');
      eq(wasFailed.retries, 1, 'retry-failed preserves the retry counter');
    }

    // --- next returns null when nothing is pending ---
    {
      const allDone = [
        { url: 'http://x', status: 'completed', report_num: 1, score: 4, retries: 0, updated: TODAY },
        { url: 'http://y', status: 'processing', report_num: 2, score: null, retries: 0, updated: TODAY },
      ];
      const { row } = applyNext(allDone, reportsDir, {}, TODAY);
      eq(row, null, 'next is null when no pending rows');
    }

    // --- start-from skips earlier input rows on init ---
    {
      const input = parseInput('http://a\tA\tt\nhttp://b\tB\tt\nhttp://c\tC\tt\n');
      const { rows, added } = applyInit([], input, { startFrom: 2 }, TODAY);
      eq(added, 2, 'start-from=2 seeds rows 2..3');
      ok(!rows.some((r) => r.url === 'http://a'), 'start-from skipped row 1');
    }

    // --- serialize/parse round-trips ---
    {
      const rows = [{ url: 'http://a', status: 'completed', report_num: 7, score: 3.5, retries: 2, updated: TODAY }];
      const back = parseState(serializeState(rows));
      eq(back, rows, 'serialize -> parse round-trips');
      ok(serializeState(rows).startsWith('url\tstatus\treport_num\tscore\tretries\tupdated\n'), 'serialize emits header');
    }

    cleanup();
    console.log(`batch self-test: ${checks} checks passed`);
    return 0;
  } catch (e) {
    cleanup();
    console.error(`batch self-test FAILED after ${checks} checks: ${e.message}`);
    process.exitCode = 1;
    return 1;
  }
}

// self-test fs helper
import { rmSync } from 'node:fs';

// ---------- CLI guard (import-safe) ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = main();
  if (typeof code === 'number' && code !== 0) process.exit(code);
}
