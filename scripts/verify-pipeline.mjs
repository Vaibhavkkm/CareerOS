#!/usr/bin/env node
// scripts/verify-pipeline.mjs — READ-ONLY linter over data/tracker.jsonl.
// Usage:
//   node scripts/verify-pipeline.mjs [--json] [--summary] [--self-test]
// Checks (per templates/schemas/tracker-record.schema.json + lib/states + lib/records):
//   - every status is canonical (states.isValidStatus)
//   - no two records describe the same opening (records.sameOpening) — reported as dups
//   - required fields present: id, date, company, role, status
//   - score is null or a number in 0..5
//   - report link (if present) resolves on disk relative to data/
//   - ids are unique
// Default output is JSON; --summary prints a human view. Exit 1 if any error.

import { existsSync, readFileSync } from 'node:fs';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { readTracker, sameOpening } from '../lib/records.mjs';
import { isValidStatus } from '../lib/states.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FIELDS = ['id', 'date', 'company', 'role', 'status'];

// ---------- pure linter ----------
// records: array of tracker records. opts.dataDir: dir the `report` path is relative to.
// Returns { errors:[], warnings:[] } (each entry a string).
export function lint(records, { dataDir } = {}) {
  const errors = [];
  const warnings = [];
  const recs = Array.isArray(records) ? records : [];

  // --- per-record checks ---
  const idSeen = new Map(); // id -> first line index
  recs.forEach((r, i) => {
    const where = `record ${i + 1}`;
    const tag = recordTag(r, i);

    // required fields present (non-empty)
    for (const f of REQUIRED_FIELDS) {
      const v = r?.[f];
      if (v == null || v === '') errors.push(`${tag}: missing required field "${f}"`);
    }

    // status canonical
    if (r?.status != null && r.status !== '' && !isValidStatus(r.status)) {
      errors.push(`${tag}: status "${r.status}" is not a canonical state (see templates/states.yml)`);
    }

    // score null or 0..5
    if (r && 'score' in r) {
      const s = r.score;
      if (s !== null && s !== undefined) {
        if (typeof s !== 'number' || !Number.isFinite(s)) {
          errors.push(`${tag}: score must be a number or null (got ${JSON.stringify(s)})`);
        } else if (s < 0 || s > 5) {
          errors.push(`${tag}: score ${s} out of range 0..5`);
        }
      }
    }

    // id unique
    if (r?.id != null && r.id !== '') {
      if (idSeen.has(r.id)) {
        errors.push(`${tag}: duplicate id ${r.id} (also at record ${idSeen.get(r.id) + 1})`);
      } else {
        idSeen.set(r.id, i);
      }
    }

    // report resolves on disk (relative to dataDir)
    if (r?.report != null && r.report !== '') {
      if (!dataDir) {
        warnings.push(`${tag}: report "${r.report}" present but no dataDir given to resolve it`);
      } else if (!existsSync(join(dataDir, r.report))) {
        errors.push(`${tag}: report "${r.report}" does not resolve on disk (${join(dataDir, r.report)})`);
      }
    }
  });

  // --- cross-record: same opening (dups) ---
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i];
      const b = recs[j];
      if (!a || !b || !a.company || !a.role || !b.company || !b.role) continue;
      if (sameOpening(a, b)) {
        errors.push(
          `duplicate opening: ${recordTag(a, i)} and ${recordTag(b, j)} ` +
          `(same company+role: "${a.company}" / "${a.role}" ~ "${b.company}" / "${b.role}")`,
        );
      }
    }
  }

  return { errors, warnings };
}

function recordTag(r, i) {
  const idPart = r?.id != null && r.id !== '' ? `id ${r.id}` : `record ${i + 1}`;
  const co = r?.company ? ` ${r.company}` : '';
  const role = r?.role ? ` / ${r.role}` : '';
  return `${idPart}${co}${role}`.trim();
}

// ---------- CLI ----------
function parseArgs(argv) {
  const out = { json: false, summary: false, selfTest: false };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--summary') out.summary = true;
    else if (a === '--self-test') out.selfTest = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  const dataDir = join(ROOT, 'data');
  const trackerPath = join(dataDir, 'tracker.jsonl');

  let records = [];
  let loadError = null;
  try {
    records = readTracker(trackerPath);
  } catch (e) {
    loadError = e.message;
  }

  const { errors, warnings } = loadError
    ? { errors: [loadError], warnings: [] }
    : lint(records, { dataDir });
  const ok = errors.length === 0;

  if (args.summary && !args.json) {
    console.log('careeros verify-pipeline\n');
    console.log(`  tracker: ${trackerPath}`);
    console.log(`  records: ${records.length}`);
    console.log(`  errors: ${errors.length}, warnings: ${warnings.length}\n`);
    for (const e of errors) console.log(`  ❌ ${e}`);
    for (const w of warnings) console.log(`  ⚠️  ${w}`);
    if (!errors.length && !warnings.length) console.log('  ✅ all checks passed');
    console.log('');
    console.log(ok ? 'OK ✅' : `FAILED — ${errors.length} error(s) ❌`);
  } else {
    console.log(JSON.stringify({ ok, errors, warnings }, null, 2));
  }

  process.exit(ok ? 0 : 1);
}

// ---------- self-test ----------
function selfTest() {
  let checks = 0;
  const ck = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const dir = mkdtempSync(join(tmpdir(), 'aw-verify-'));

  try {
    // a real report file so the report-link check can pass for the good set
    const reportsDir = join(dir, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const goodReport = 'reports/001-acme-2026-06-07.md';
    writeFileSync(join(dir, goodReport), '# eval\n');

    // --- good set: distinct openings, canonical statuses, valid scores, unique ids ---
    const good = [
      { id: 1, date: '2026-06-01', company: 'Acme Inc', role: 'Senior Backend Engineer, Payments', status: 'applied', score: 4.2, report: goodReport },
      { id: 2, date: '2026-06-02', company: 'Globex', role: 'Frontend Developer, Dashboard', status: 'evaluated', score: null },
      { id: 3, date: '2026-06-03', company: 'Initech', role: 'Data Engineer, Pipelines', status: 'rejected', score: 3 },
    ];
    const goodRes = lint(good, { dataDir: dir });
    ck(goodRes.errors.length === 0, `good set should have no errors, got: ${JSON.stringify(goodRes.errors)}`);
    ck(goodRes.warnings.length === 0, `good set should have no warnings, got: ${JSON.stringify(goodRes.warnings)}`);

    // --- bad set: a dup opening + bad status + missing field + bad score + dup id + missing report ---
    const bad = [
      // id 1 valid baseline
      { id: 1, date: '2026-06-01', company: 'Acme Inc', role: 'Senior Backend Engineer, Payments', status: 'applied', score: 4.2 },
      // dup opening of id 1 (same company+role) AND non-canonical status
      { id: 2, date: '2026-06-02', company: 'Acme', role: 'Senior Backend Engineer, Payments', status: 'totally-bogus-status', score: 3 },
      // missing required field "company"
      { id: 3, date: '2026-06-03', company: '', role: 'Data Engineer, Pipelines', status: 'evaluated', score: 2 },
      // score out of range + duplicate id (3)
      { id: 3, date: '2026-06-04', company: 'Umbrella', role: 'Site Reliability Engineer, Platform', status: 'evaluated', score: 9 },
      // report that does not resolve on disk
      { id: 5, date: '2026-06-05', company: 'Stark', role: 'ML Engineer, Vision', status: 'evaluated', score: null, report: 'reports/999-missing.md' },
    ];
    const badRes = lint(bad, { dataDir: dir });

    ck(badRes.errors.length > 0, 'bad set must produce errors');
    ck(badRes.errors.some((e) => /duplicate opening/.test(e)), 'bad set must flag the duplicate opening');
    ck(badRes.errors.some((e) => /not a canonical state/.test(e)), 'bad set must flag the non-canonical status');
    ck(badRes.errors.some((e) => /missing required field "company"/.test(e)), 'bad set must flag the missing company field');
    ck(badRes.errors.some((e) => /score 9 out of range/.test(e)), 'bad set must flag the out-of-range score');
    ck(badRes.errors.some((e) => /duplicate id 3/.test(e)), 'bad set must flag the duplicate id');
    ck(badRes.errors.some((e) => /does not resolve on disk/.test(e)), 'bad set must flag the missing report file');

    // --- score type check: non-number, non-null is an error ---
    const typed = lint([{ id: 1, date: '2026-06-01', company: 'A', role: 'X Engineer, Core', status: 'applied', score: 'high' }], { dataDir: dir });
    ck(typed.errors.some((e) => /score must be a number or null/.test(e)), 'string score must be flagged');

    // --- report present but no dataDir => warning, not error ---
    const noDir = lint([{ id: 1, date: '2026-06-01', company: 'A', role: 'X Engineer, Core', status: 'applied', score: null, report: 'reports/x.md' }], {});
    ck(noDir.errors.length === 0, 'report with no dataDir should not error');
    ck(noDir.warnings.some((w) => /no dataDir/.test(w)), 'report with no dataDir should warn');

    // --- empty set is clean ---
    const empty = lint([], { dataDir: dir });
    ck(empty.errors.length === 0 && empty.warnings.length === 0, 'empty set should be clean');

    console.log(`verify-pipeline self-test: ${checks} checks passed`);
    process.exit(0);
  } catch (e) {
    console.error(`verify-pipeline self-test FAILED: ${e.message}`);
    process.exit(1);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }
