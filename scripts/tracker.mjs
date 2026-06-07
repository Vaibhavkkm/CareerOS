#!/usr/bin/env node
// scripts/tracker.mjs — CLI over data/tracker.jsonl (the SOURCE OF TRUTH).
// All status logic goes through lib/states.mjs; all I/O + dedup through lib/records.mjs.
//
// Usage:
//   node scripts/tracker.mjs add --json '<record>'
//   node scripts/tracker.mjs add --company Acme --role "Staff SWE" --score 4.2 --status evaluated [--url --report --archetype --legitimacy --notes]
//   node scripts/tracker.mjs update --id 3 --status applied [--score=4.5 --notes="..." ...]
//   node scripts/tracker.mjs list [--status applied] [--json|--summary]
//   node scripts/tracker.mjs stats [--json|--summary]
//   node scripts/tracker.mjs --self-test
//
// Default file: data/tracker.jsonl (override with --file=PATH for tests).
// Prints JSON to stdout by default; pass --summary for a human view.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { readTracker, writeTracker, upsert, stats as recordStats, parseScore } from '../lib/records.mjs';
import { normalizeStatus, labelFor, STATUSES_BY_RANK } from '../lib/states.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = join(ROOT, 'data', 'tracker.jsonl');

// ---------- arg parsing ----------
// Supports: --flag value, --flag=value, and bare --flag (boolean true).
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next != null && !next.startsWith('--')) { out.flags[key] = next; i++; }
        else out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function today(flags = {}) {
  const t = flags.today;
  if (t && t !== true && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Scalar fields a user may set directly on add/update via flags.
const SCALAR_FIELDS = [
  'company', 'role', 'url', 'report', 'archetype', 'legitimacy',
  'notes', 'cv_pdf', 'cl_pdf',
];

// Build a record from --json '<obj>' and/or individual flags. Flags override JSON.
export function recordFromFlags(flags, theToday) {
  let rec = {};
  if (flags.json && flags.json !== true) {
    let parsed;
    try { parsed = JSON.parse(flags.json); }
    catch (e) { throw new Error(`--json is not valid JSON: ${e.message}`); }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('--json must be a single JSON object');
    }
    rec = { ...parsed };
  }
  for (const k of SCALAR_FIELDS) {
    if (flags[k] != null && flags[k] !== true) rec[k] = flags[k];
  }
  if (flags.score != null && flags.score !== true) rec.score = parseScore(flags.score);
  if (flags.status != null && flags.status !== true) rec.status = flags.status;
  if (flags.id != null && flags.id !== true) rec.id = Number(flags.id);
  if (flags.date != null && flags.date !== true) rec.date = flags.date;
  if (rec.date == null) rec.date = theToday;
  return rec;
}

// ---------- add ----------
export function cmdAdd(records, flags, theToday) {
  const rec = recordFromFlags(flags, theToday);
  if (!rec.company || !rec.role) {
    throw new Error('add requires at least --company and --role (or a --json with both)');
  }
  if (rec.status) {
    const canon = normalizeStatus(rec.status);
    if (!canon) throw new Error(`invalid status: ${rec.status}`);
    rec.status = canon;
  }
  const res = upsert(records, rec);
  return { action: res.action, record: records[res.index], index: res.index };
}

// ---------- update ----------
export function cmdUpdate(records, flags, theToday) {
  if (flags.id == null || flags.id === true) throw new Error('update requires --id N');
  const id = Number(flags.id);
  if (!Number.isInteger(id)) throw new Error(`--id must be an integer, got: ${flags.id}`);
  const idx = records.findIndex((r) => Number(r.id) === id);
  if (idx === -1) throw new Error(`no record with id ${id}`);
  const cur = records[idx];

  let changed = false;
  if (flags.status != null && flags.status !== true) {
    const canon = normalizeStatus(flags.status);
    if (!canon) throw new Error(`invalid status: ${flags.status}`);
    if (cur.status !== canon) { cur.status = canon; changed = true; }
  }
  for (const k of SCALAR_FIELDS) {
    if (flags[k] != null && flags[k] !== true) { cur[k] = flags[k]; changed = true; }
  }
  if (flags.score != null && flags.score !== true) { cur.score = parseScore(flags.score); changed = true; }
  if (flags.date != null && flags.date !== true) { cur.date = flags.date; changed = true; }
  if (flags.follow_ups != null && flags.follow_ups !== true) {
    const n = Number(flags.follow_ups);
    if (Number.isInteger(n)) { cur.follow_ups = n; changed = true; }
  }

  cur.last_action = theToday;
  return { action: changed ? 'updated' : 'touched', record: cur, index: idx };
}

// ---------- list ----------
export function cmdList(records, flags) {
  let filterId = null;
  if (flags.status != null && flags.status !== true) {
    filterId = normalizeStatus(flags.status);
    if (!filterId) throw new Error(`invalid status filter: ${flags.status}`);
  }
  const rows = filterId
    ? records.filter((r) => normalizeStatus(r.status) === filterId)
    : records.slice();
  return { rows, filterId };
}

// ---------- stats ----------
export function cmdStats(records) {
  const s = recordStats(records);
  // Ordered by-status view with human labels, further-along first.
  const byStatusLabeled = {};
  const ids = [...STATUSES_BY_RANK, 'unknown'];
  for (const id of ids) {
    if (s.byStatus[id]) byStatusLabeled[labelFor(id)] = s.byStatus[id];
  }
  // Catch any ids not in the canonical ordering (defensive).
  for (const id of Object.keys(s.byStatus)) {
    if (!ids.includes(id)) byStatusLabeled[labelFor(id)] = s.byStatus[id];
  }
  return { ...s, byStatusLabeled };
}

// ---------- human views ----------
function pad(s, n) { s = String(s == null ? '' : s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

function printListSummary(rows, filterId) {
  const header = filterId ? `tracker — ${labelFor(filterId)} (${rows.length})` : `tracker (${rows.length})`;
  console.log(header + '\n');
  if (!rows.length) { console.log('  (no records)'); return; }
  console.log('  ' + pad('ID', 4) + pad('DATE', 12) + pad('COMPANY', 22) + pad('ROLE', 28) + pad('SCORE', 7) + 'STATUS');
  console.log('  ' + '-'.repeat(4 + 12 + 22 + 28 + 7 + 8));
  for (const r of rows) {
    const sc = parseScore(r.score);
    console.log('  ' + pad(r.id, 4) + pad(r.date, 12) + pad(r.company, 22) + pad(r.role, 28) +
      pad(sc == null ? 'N/A' : sc, 7) + labelFor(normalizeStatus(r.status) || r.status));
  }
}

function printStatsSummary(s) {
  console.log('tracker stats\n');
  console.log(`  total:      ${s.total}`);
  console.log(`  avg score:  ${s.avgScore == null ? 'N/A' : s.avgScore}`);
  console.log(`  with PDF:   ${s.pctPdf}%`);
  console.log(`  with report:${s.pctReport}%`);
  console.log('\n  by status:');
  const entries = Object.entries(s.byStatusLabeled);
  if (!entries.length) console.log('    (none)');
  for (const [label, n] of entries) console.log(`    ${pad(label, 14)} ${n}`);
}

// ---------- main ----------
export function main(argv = process.argv.slice(2)) {
  const { _, flags } = parseArgs(argv);

  if (flags['self-test']) return selfTest();

  const cmd = _[0];
  const file = (flags.file && flags.file !== true) ? flags.file : DEFAULT_FILE;
  const theToday = today(flags);
  const wantSummary = !!flags.summary && !flags.json;

  if (!cmd) {
    console.error('usage: tracker.mjs <add|update|list|stats> [options]  (see --self-test)');
    process.exit(1);
  }

  try {
    if (cmd === 'add') {
      const records = readTracker(file);
      const res = cmdAdd(records, flags, theToday);
      writeTracker(file, records);
      if (wantSummary) console.log(`${res.action}: #${res.record.id} ${res.record.company} — ${res.record.role} [${labelFor(normalizeStatus(res.record.status) || res.record.status)}]`);
      else console.log(JSON.stringify({ action: res.action, record: res.record }, null, 2));
      process.exit(0);
    }

    if (cmd === 'update') {
      const records = readTracker(file);
      const res = cmdUpdate(records, flags, theToday);
      writeTracker(file, records);
      if (wantSummary) console.log(`${res.action}: #${res.record.id} -> ${labelFor(normalizeStatus(res.record.status) || res.record.status)} (last_action ${res.record.last_action})`);
      else console.log(JSON.stringify({ action: res.action, record: res.record }, null, 2));
      process.exit(0);
    }

    if (cmd === 'list') {
      const records = readTracker(file);
      const { rows, filterId } = cmdList(records, flags);
      if (wantSummary) printListSummary(rows, filterId);
      else console.log(JSON.stringify(rows, null, 2));
      process.exit(0);
    }

    if (cmd === 'stats') {
      const records = readTracker(file);
      const s = cmdStats(records);
      if (wantSummary) printStatsSummary(s);
      else console.log(JSON.stringify(s, null, 2));
      process.exit(0);
    }

    console.error(`unknown command: ${cmd} (expected add|update|list|stats)`);
    process.exit(1);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

// ---------- self-test ----------
export function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'aw-tracker-'));
  const file = join(dir, 'tracker.jsonl');
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const T = '2026-06-07';
  const T2 = '2026-06-08';

  try {
    // --- add two distinct records ---
    {
      const records = readTracker(file);
      cmdAdd(records, { company: 'Acme', role: 'Staff Software Engineer, Payments', score: '4.2', status: 'evaluated' }, T);
      writeTracker(file, records);
    }
    {
      const records = readTracker(file);
      cmdAdd(records, { company: 'Globex', role: 'Senior Backend Engineer, Search', score: '3.9', status: 'evaluated' }, T);
      writeTracker(file, records);
    }
    let recs = readTracker(file);
    ok(recs.length === 2, 'two distinct records added');
    ok(recs[0].id === 1 && recs[1].id === 2, 'sequential ids assigned');
    ok(recs[0].date === T, 'default date applied');
    ok(recs.every((r) => r.follow_ups === 0), 'follow_ups defaulted to 0');
    ok(recs[0].status === 'evaluated', 'status normalized/stored canonical');

    // --- dedup: re-add same opening (different role wording) -> no new row, advances status ---
    {
      const records = readTracker(file);
      const res = cmdAdd(records, { company: 'Acme Inc.', role: 'Staff Software Engineer - Payments Platform', status: 'applied' }, T);
      writeTracker(file, records);
      ok(res.action === 'updated', 'dedup matched existing Acme opening (updated, not added)');
    }
    recs = readTracker(file);
    ok(recs.length === 2, 'dedup did not create a duplicate row');
    const acme = recs.find((r) => r.id === 1);
    ok(acme.status === 'applied', 'dedup advanced Acme status evaluated -> applied');

    // --- add with --json ---
    {
      const records = readTracker(file);
      const res = cmdAdd(records, { json: JSON.stringify({ company: 'Initech', role: 'Platform Engineer, Infra', status: 'evaluated', score: 4.7 }) }, T);
      writeTracker(file, records);
      ok(res.action === 'added' && res.record.id === 3, '--json add created record id 3');
    }
    recs = readTracker(file);
    ok(recs.length === 3, 'three records after --json add');

    // --- invalid status rejected on add ---
    {
      const records = readTracker(file);
      let threw = false;
      try { cmdAdd(records, { company: 'X', role: 'Y', status: 'bogus-status' }, T); }
      catch { threw = true; }
      ok(threw, 'invalid status rejected on add');
    }

    // --- update: advance Globex to applied, set last_action ---
    {
      const records = readTracker(file);
      const res = cmdUpdate(records, { id: '2', status: 'applied' }, T2);
      writeTracker(file, records);
      ok(res.record.status === 'applied', 'update set Globex status applied');
      ok(res.record.last_action === T2, 'update set last_action to today');
    }

    // --- update: invalid status rejected ---
    {
      const records = readTracker(file);
      let threw = false;
      try { cmdUpdate(records, { id: '2', status: 'nope' }, T2); }
      catch { threw = true; }
      ok(threw, 'invalid status rejected on update');
    }

    // --- update: missing id rejected ---
    {
      const records = readTracker(file);
      let threw = false;
      try { cmdUpdate(records, { id: '999', status: 'applied' }, T2); }
      catch { threw = true; }
      ok(threw, 'update on unknown id rejected');
    }

    // --- list filter (normalized alias) ---
    {
      const records = readTracker(file);
      const { rows, filterId } = cmdList(records, { status: 'submitted' }); // alias of applied
      ok(filterId === 'applied', 'list status filter normalized via alias');
      ok(rows.length === 2 && rows.every((r) => r.status === 'applied'), 'list filtered to applied records');
    }
    {
      const records = readTracker(file);
      const { rows, filterId } = cmdList(records, {});
      ok(filterId === null && rows.length === 3, 'list with no filter returns all');
    }
    {
      const records = readTracker(file);
      let threw = false;
      try { cmdList(records, { status: 'garbage' }); } catch { threw = true; }
      ok(threw, 'invalid list filter rejected');
    }

    // --- stats ---
    {
      const records = readTracker(file);
      const s = cmdStats(records);
      ok(s.total === 3, 'stats total = 3');
      ok(s.byStatus.applied === 2 && s.byStatus.evaluated === 1, 'stats by-status counts correct');
      ok(s.byStatusLabeled.Applied === 2 && s.byStatusLabeled.Evaluated === 1, 'stats labeled by-status uses states.labelFor');
      // avg of scores present: Acme 4.2 (kept; applied add had no score), Globex 3.9, Initech 4.7
      ok(Math.abs(s.avgScore - +((4.2 + 3.9 + 4.7) / 3).toFixed(2)) < 1e-9, 'stats avgScore correct');
    }

    // --- argv parsing sanity ---
    {
      const p = parseArgs(['add', '--company', 'Foo Bar', '--score=4.1', '--json', '{"role":"R"}', '--summary']);
      ok(p._[0] === 'add', 'parseArgs positional');
      ok(p.flags.company === 'Foo Bar' && p.flags.score === '4.1' && p.flags.summary === true, 'parseArgs flag forms');
      ok(p.flags.json === '{"role":"R"}', 'parseArgs preserves --json value');
    }

    console.log(`tracker self-test: ${checks} checks passed`);
    process.exit(0);
  } catch (e) {
    console.error(`tracker self-test FAILED: ${e.message}`);
    process.exit(1);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }
