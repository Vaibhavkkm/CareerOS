#!/usr/bin/env node
// scripts/merge-tracker.mjs — fold data/batch/tracker-additions/*.jsonl into data/tracker.jsonl.
// Reads every *.jsonl in data/batch/tracker-additions/, upserts each record into the
// loaded tracker array (dedup precedence: report# -> id -> company+fuzzy-role, see lib/records.mjs),
// writes tracker.jsonl back, then MOVES each processed file into data/batch/merged/.
//
// Usage:
//   node scripts/merge-tracker.mjs [--dry-run] [--json|--summary]
//   node scripts/merge-tracker.mjs --self-test
//
// Prints {files_processed, added, updated, skipped}. Exit 0 on success, 1 on failure.

import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { readTracker, writeTracker, upsert } from '../lib/records.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- arg parsing ----------
export function parseArgs(argv) {
  const out = { dryRun: false, json: false, summary: false, selfTest: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a === '--summary') out.summary = true;
    else if (a === '--self-test') out.selfTest = true;
  }
  return out;
}

// ---------- jsonl parsing ----------
// Tolerant per-line parse: skips blank lines, throws on a malformed record
// so a bad batch file fails loudly rather than silently dropping a row.
export function parseJsonlLines(text, label = 'additions') {
  const records = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try { records.push(JSON.parse(line)); }
    catch { throw new Error(`${label}: invalid JSON on line ${i + 1}`); }
  }
  return records;
}

// ---------- core helper (pure) ----------
// Fold addition records into trackerArr (mutated in place). Returns count summary.
export function mergeAll(trackerArr, additionRecords) {
  let added = 0, updated = 0, skipped = 0;
  for (const rec of additionRecords) {
    const { action } = upsert(trackerArr, rec);
    if (action === 'added') added++;
    else if (action === 'updated') updated++;
    else skipped++;
  }
  return { added, updated, skipped };
}

// ---------- filesystem orchestration ----------
// Discover *.jsonl addition files (sorted for deterministic order).
export function listAdditionFiles(additionsDir) {
  if (!existsSync(additionsDir)) return [];
  return readdirSync(additionsDir)
    .filter((f) => f.toLowerCase().endsWith('.jsonl'))
    .sort()
    .map((f) => join(additionsDir, f));
}

// Run the full merge against a set of directories. Pure-ish: only touches the
// paths handed to it, so self-tests can point it at a tmpdir.
export function runMerge({ trackerPath, additionsDir, mergedDir, dryRun = false }) {
  const files = listAdditionFiles(additionsDir);
  const tracker = readTracker(trackerPath);

  let added = 0, updated = 0, skipped = 0;
  const processed = [];

  for (const file of files) {
    const recs = parseJsonlLines(readFileSync(file, 'utf8'), basename(file));
    const r = mergeAll(tracker, recs);
    added += r.added; updated += r.updated; skipped += r.skipped;
    processed.push(file);
  }

  if (!dryRun) {
    if (processed.length) {
      writeTracker(trackerPath, tracker);
      mkdirSync(mergedDir, { recursive: true });
      for (const file of processed) {
        renameSync(file, join(mergedDir, basename(file)));
      }
    }
  }

  return {
    files_processed: processed.length,
    added,
    updated,
    skipped,
  };
}

// ---------- output ----------
function printResult(result, { json, summary, dryRun }) {
  if (summary && !json) {
    const tag = dryRun ? ' (dry-run — nothing moved)' : '';
    console.log(`merge-tracker${tag}`);
    console.log(`  files processed: ${result.files_processed}`);
    console.log(`  added:   ${result.added}`);
    console.log(`  updated: ${result.updated}`);
    console.log(`  skipped: ${result.skipped}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// ---------- main ----------
export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();

  const result = runMerge({
    trackerPath: join(ROOT, 'data', 'tracker.jsonl'),
    additionsDir: join(ROOT, 'data', 'batch', 'tracker-additions'),
    mergedDir: join(ROOT, 'data', 'batch', 'merged'),
    dryRun: args.dryRun,
  });

  printResult(result, args);
  return 0;
}

// ---------- self-test ----------
function selfTest() {
  let checks = 0;
  const work = join(tmpdir(), `aw-merge-test-${process.pid}-${Date.now()}`);
  const additionsDir = join(work, 'tracker-additions');
  const mergedDir = join(work, 'merged');
  const trackerPath = join(work, 'tracker.jsonl');

  const cleanup = () => {
    try { rmrf(work); } catch { /* best effort */ }
  };

  try {
    mkdirSync(additionsDir, { recursive: true });

    // --- pure mergeAll: added / updated / skipped semantics ---
    {
      const tracker = [];
      // brand new -> added
      const a = mergeAll(tracker, [{ company: 'Acme', role: 'Backend Platform Engineer', status: 'applied', score: 80 }]);
      assert.equal(a.added, 1, 'first insert is added'); checks++;
      assert.equal(tracker.length, 1, 'tracker has one record'); checks++;
      assert.equal(tracker[0].id, 1, 'auto-assigned id 1'); checks++;

      // same opening, advancing status + higher score -> updated
      const b = mergeAll(tracker, [{ company: 'Acme Inc', role: 'Backend Platform Engineer', status: 'interview', score: 90 }]);
      assert.equal(b.updated, 1, 'same opening with new info is updated'); checks++;
      assert.equal(tracker.length, 1, 'no new record on update'); checks++;
      assert.equal(tracker[0].status, 'interview', 'status advanced'); checks++;
      assert.equal(tracker[0].score, 90, 'higher score kept'); checks++;

      // identical no-op -> skipped (status would regress, score lower, no new fields)
      const c = mergeAll(tracker, [{ company: 'Acme', role: 'Backend Platform Engineer', status: 'applied', score: 70 }]);
      assert.equal(c.skipped, 1, 'no-change record is skipped'); checks++;
      assert.equal(tracker[0].status, 'interview', 'status did not regress'); checks++;

      // different company -> added
      const d = mergeAll(tracker, [{ company: 'Globex', role: 'Data Infrastructure Engineer', status: 'applied' }]);
      assert.equal(d.added, 1, 'different company is added'); checks++;
      assert.equal(tracker.length, 2, 'tracker now has two records'); checks++;
    }

    // --- runMerge end-to-end: reads files, writes tracker, moves files ---
    {
      writeFixture(join(additionsDir, 'batch-001.jsonl'), [
        { company: 'Initech', role: 'Site Reliability Engineer', status: 'applied', score: 75 },
        { company: 'Umbrella', role: 'Security Platform Engineer', status: 'screen' },
      ]);
      writeFixture(join(additionsDir, 'batch-002.jsonl'), [
        // updates the Initech record from batch-001 (same opening, advances status)
        { company: 'Initech LLC', role: 'Site Reliability Engineer', status: 'interview' },
        // brand new
        { company: 'Stark', role: 'Embedded Systems Engineer', status: 'applied' },
      ]);

      const res = runMerge({ trackerPath, additionsDir, mergedDir, dryRun: false });
      assert.equal(res.files_processed, 2, 'processed two files'); checks++;
      assert.equal(res.added, 3, 'three distinct openings added'); checks++;
      assert.equal(res.updated, 1, 'one opening updated across files'); checks++;
      assert.equal(res.skipped, 0, 'nothing skipped'); checks++;

      // tracker.jsonl written with the merged set
      const written = readTracker(trackerPath);
      assert.equal(written.length, 3, 'tracker has three records on disk'); checks++;
      const initech = written.find((r) => r.company.startsWith('Initech'));
      assert.equal(initech.status, 'interview', 'cross-file update persisted'); checks++;

      // files moved out of additions into merged
      assert.equal(listAdditionFiles(additionsDir).length, 0, 'additions dir emptied'); checks++;
      assert.ok(existsSync(join(mergedDir, 'batch-001.jsonl')), 'batch-001 moved to merged'); checks++;
      assert.ok(existsSync(join(mergedDir, 'batch-002.jsonl')), 'batch-002 moved to merged'); checks++;
    }

    // --- dry-run: counts reported, nothing moved, tracker untouched ---
    {
      rmrf(additionsDir); rmrf(mergedDir);
      mkdirSync(additionsDir, { recursive: true });
      writeFixture(join(additionsDir, 'pending.jsonl'), [
        { company: 'Hooli', role: 'Compiler Engineer', status: 'applied' },
      ]);
      const before = readTracker(trackerPath).length;
      const res = runMerge({ trackerPath, additionsDir, mergedDir, dryRun: true });
      assert.equal(res.files_processed, 1, 'dry-run reports file count'); checks++;
      assert.equal(res.added, 1, 'dry-run reports added count'); checks++;
      assert.ok(existsSync(join(additionsDir, 'pending.jsonl')), 'dry-run does not move files'); checks++;
      assert.ok(!existsSync(join(mergedDir, 'pending.jsonl')), 'dry-run leaves merged dir clean'); checks++;
      assert.equal(readTracker(trackerPath).length, before, 'dry-run does not rewrite tracker'); checks++;
    }

    // --- empty additions dir: zero everything, no throw ---
    {
      rmrf(additionsDir);
      mkdirSync(additionsDir, { recursive: true });
      const res = runMerge({ trackerPath, additionsDir, mergedDir, dryRun: false });
      assert.deepEqual(res, { files_processed: 0, added: 0, updated: 0, skipped: 0 }, 'empty dir is a clean no-op'); checks++;
    }

    cleanup();
    console.log(`merge-tracker self-test: ${checks} checks passed`);
    return 0;
  } catch (e) {
    cleanup();
    console.error(`merge-tracker self-test FAILED after ${checks} checks: ${e.message}`);
    process.exitCode = 1;
    return 1;
  }
}

// ---------- self-test fs helpers ----------
import { writeFileSync, rmSync } from 'node:fs';
function writeFixture(path, records) {
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
function rmrf(path) {
  rmSync(path, { recursive: true, force: true });
}

// ---------- CLI guard (import-safe) ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = main();
  if (typeof code === 'number' && code !== 0) process.exit(code);
}
