#!/usr/bin/env node
// scripts/render-views.mjs — render human views FROM data/tracker.jsonl (truth).
// Generates:
//   data/tracker.md   — pipe table sorted by status rank desc, then date desc.
//   data/progress.md  — funnel: per-status counts grouped by states group,
//                       conversion rates, avg score, score buckets.
// tracker.jsonl is TRUTH; these files are disposable, rebuilt views. Idempotent.
//
// Usage:
//   node scripts/render-views.mjs [--file <tracker.jsonl>] [--json] [--summary]
//   node scripts/render-views.mjs --self-test
//
// Default: writes data/tracker.md and data/progress.md next to the source, and
// prints a JSON summary. --summary prints a human view instead.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

import { readTracker, parseScore, stats } from '../lib/records.mjs';
import { STATES, normalizeStatus, labelFor, rankFor, groupFor } from '../lib/states.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN_NOTE = 'GENERATED — do not edit by hand; source is tracker.jsonl';

// Group display order + headings for the funnel.
const GROUP_ORDER = ['pipeline', 'active', 'won', 'closed', 'unknown'];
const GROUP_LABEL = {
  pipeline: 'Pipeline',
  active: 'Active',
  won: 'Won',
  closed: 'Closed',
  unknown: 'Unknown',
};

// ---------- small helpers ----------

// Escape a cell for a markdown pipe table.
function cell(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

// Pull the NNN report number out of a report path like "reports/007-acme-2026-06-07.md".
function reportNum(path) {
  if (!path) return null;
  const m = String(path).match(/(\d{2,})/);
  return m ? m[1] : null;
}

function fmtScore(s) {
  const v = parseScore(s);
  return v == null ? 'N/A' : v.toFixed(1);
}

// Sort: status rank desc, then date desc, then id desc (stable-ish tiebreak).
function sortRecords(records) {
  return [...records].sort((a, b) => {
    const rb = rankFor(b.status) - rankFor(a.status);
    if (rb) return rb;
    const da = String(a.date || ''), db = String(b.date || '');
    if (da !== db) return db < da ? -1 : 1; // date desc
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

// ---------- tracker.md ----------
export function renderTrackerMd(records) {
  const rows = sortRecords(records);
  const lines = [];
  lines.push('# Tracker');
  lines.push('');
  lines.push(`<!-- ${GEN_NOTE} -->`);
  lines.push(`_${GEN_NOTE}_`);
  lines.push('');
  lines.push('| ID | Date | Company | Role | Score | Status | Report |');
  lines.push('|---:|------|---------|------|------:|--------|--------|');

  if (!rows.length) {
    lines.push('| | | _(no applications yet)_ | | | | |');
  } else {
    for (const r of rows) {
      const num = reportNum(r.report);
      const link = num && r.report ? `[${num}](${r.report})` : '';
      lines.push(
        `| ${cell(r.id)} | ${cell(r.date)} | ${cell(r.company)} | ${cell(r.role)} | ` +
        `${cell(fmtScore(r.score))} | ${cell(labelFor(normalizeStatus(r.status) || r.status))} | ${link} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ---------- progress.md ----------

// Score buckets, in display order. Each predicate runs on the parsed numeric score (or null).
const SCORE_BUCKETS = [
  { key: '>=4.5', test: (v) => v != null && v >= 4.5 },
  { key: '4.0–4.4', test: (v) => v != null && v >= 4.0 && v < 4.5 },
  { key: '3.5–3.9', test: (v) => v != null && v >= 3.5 && v < 4.0 },
  { key: '<3.5', test: (v) => v != null && v < 3.5 },
  { key: 'N/A', test: (v) => v == null },
];

function scoreBuckets(records) {
  const counts = Object.fromEntries(SCORE_BUCKETS.map((b) => [b.key, 0]));
  for (const r of records) {
    const v = parseScore(r.score);
    for (const b of SCORE_BUCKETS) {
      if (b.test(v)) { counts[b.key]++; break; }
    }
  }
  return counts;
}

function pct(n, d) {
  if (!d) return '0%';
  return `${Math.round((n / d) * 100)}%`;
}

// Count records whose status rank is >= the rank of the given status id.
// Used for funnel "reached this stage or beyond" conversion math.
function countAtOrBeyond(records, statusId) {
  const floor = rankFor(statusId);
  let n = 0;
  for (const r of records) {
    const id = normalizeStatus(r.status);
    if (id && rankFor(id) >= floor) n++;
  }
  return n;
}

export function renderProgressMd(records) {
  const s = stats(records);
  const total = s.total;

  // Stage reach counts (status rank >= stage rank), excluding closed/terminal
  // low-rank states like rejected/discarded/skip which sit below 'evaluated'.
  const applied = countAtOrBeyond(records, 'applied');
  const interview = countAtOrBeyond(records, 'interview');
  const offer = countAtOrBeyond(records, 'offer');

  const lines = [];
  lines.push('# Progress');
  lines.push('');
  lines.push(`<!-- ${GEN_NOTE} -->`);
  lines.push(`_${GEN_NOTE}_`);
  lines.push('');
  lines.push(`Total applications tracked: **${total}**`);
  lines.push('');

  // ---- Funnel: counts per status, grouped by states group ----
  lines.push('## Funnel');
  lines.push('');
  // Order statuses by group order, then by rank descending within a group.
  const byGroup = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const st of STATES) {
    const g = byGroup.has(st.group) ? st.group : 'unknown';
    byGroup.get(g).push(st);
  }
  for (const g of GROUP_ORDER) {
    const states = (byGroup.get(g) || []).slice().sort((a, b) => b.rank - a.rank);
    if (!states.length) continue;
    const groupTotal = states.reduce((acc, st) => acc + (s.byStatus[st.id] || 0), 0);
    // Only print groups that have a state present OR always-relevant pipeline groups.
    lines.push(`### ${GROUP_LABEL[g] || g} (${groupTotal})`);
    lines.push('');
    lines.push('| Status | Count |');
    lines.push('|--------|------:|');
    for (const st of states) {
      lines.push(`| ${st.label} | ${s.byStatus[st.id] || 0} |`);
    }
    lines.push('');
  }
  // Surface any unknown/unmapped statuses present in the data.
  const known = new Set(STATES.map((st) => st.id));
  const unknownEntries = Object.entries(s.byStatus).filter(([id]) => id === 'unknown' || !known.has(id));
  if (unknownEntries.length) {
    lines.push('### Unknown');
    lines.push('');
    lines.push('| Status | Count |');
    lines.push('|--------|------:|');
    for (const [id, n] of unknownEntries) lines.push(`| ${cell(id)} | ${n} |`);
    lines.push('');
  }

  // ---- Conversion rates ----
  lines.push('## Conversion rates');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Applied / total | ${applied} / ${total} = ${pct(applied, total)} |`);
  lines.push(`| Interview / applied | ${interview} / ${applied} = ${pct(interview, applied)} |`);
  lines.push(`| Offer / applied | ${offer} / ${applied} = ${pct(offer, applied)} |`);
  lines.push('');

  // ---- Scores ----
  lines.push('## Scores');
  lines.push('');
  lines.push(`Average score: **${s.avgScore == null ? 'N/A' : s.avgScore.toFixed(2)}**`);
  lines.push('');
  const buckets = scoreBuckets(records);
  lines.push('| Bucket | Count |');
  lines.push('|--------|------:|');
  for (const b of SCORE_BUCKETS) lines.push(`| ${b.key} | ${buckets[b.key]} |`);
  lines.push('');

  return lines.join('\n');
}

// ---------- CLI ----------
function parseArgs(argv) {
  const out = { _: [], json: false, summary: false, selfTest: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--summary') out.summary = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--file') out.file = argv[++i];
    else if (a.startsWith('--file=')) out.file = a.slice(7);
    else out._.push(a);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  const source = args.file || join(ROOT, 'data', 'tracker.jsonl');
  if (!existsSync(source)) {
    const msg = `tracker not found: ${source} (nothing to render)`;
    if (args.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    process.exit(1);
  }

  const records = readTracker(source);
  const dir = dirname(source);
  const trackerMdPath = join(dir, 'tracker.md');
  const progressMdPath = join(dir, 'progress.md');

  const trackerMd = renderTrackerMd(records);
  const progressMd = renderProgressMd(records);
  writeFileSync(trackerMdPath, trackerMd.endsWith('\n') ? trackerMd : trackerMd + '\n');
  writeFileSync(progressMdPath, progressMd.endsWith('\n') ? progressMd : progressMd + '\n');

  const s = stats(records);
  const summary = {
    ok: true,
    source,
    wrote: [trackerMdPath, progressMdPath],
    total: s.total,
    byStatus: s.byStatus,
    avgScore: s.avgScore,
  };

  if (args.summary) {
    console.log('render-views');
    console.log(`  source : ${source}`);
    console.log(`  wrote  : ${trackerMdPath}`);
    console.log(`           ${progressMdPath}`);
    console.log(`  records: ${s.total}, avg score: ${s.avgScore == null ? 'N/A' : s.avgScore}`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
  process.exit(0);
}

// ---------- self-test ----------
function selfTest() {
  let checks = 0;
  const dir = mkdtempSync(join(tmpdir(), 'render-views-'));
  try {
    const sample = [
      { id: 1, date: '2026-06-01', company: 'Acme Corp', role: 'Staff Software Engineer', score: 4.6, status: 'offer', report: 'reports/001-acme-2026-06-01.md' },
      { id: 2, date: '2026-06-02', company: 'Globex', role: 'Senior Backend Engineer', score: 4.1, status: 'interview', report: null },
      { id: 3, date: '2026-06-03', company: 'Initech', role: 'Platform Engineer', score: 3.7, status: 'applied', report: 'reports/003-initech-2026-06-03.md' },
      { id: 4, date: '2026-06-04', company: 'Umbrella', role: 'SRE', score: 2.9, status: 'rejected', report: null },
      { id: 5, date: '2026-06-05', company: 'Hooli', role: 'Data Engineer', score: null, status: 'skip', report: null },
      { id: 6, date: '2026-06-06', company: 'Stark Industries', role: 'ML Engineer', score: 4.3, status: 'evaluated', report: 'reports/006-stark-2026-06-06.md' },
    ];

    // --- renderTrackerMd ---
    const tmd = renderTrackerMd(sample);
    assert.ok(tmd.includes(GEN_NOTE), 'tracker.md has generated note'); checks++;
    assert.ok(tmd.includes('| ID | Date | Company | Role | Score | Status | Report |'), 'tracker.md header row'); checks++;
    assert.ok(tmd.includes('Acme Corp'), 'tracker.md contains a company'); checks++;
    assert.ok(tmd.includes('[001](reports/001-acme-2026-06-01.md)'), 'tracker.md report link rendered'); checks++;
    assert.ok(tmd.includes('| 4.6 |'), 'tracker.md score formatted to 1dp'); checks++;
    assert.ok(/\| N\/A \|/.test(tmd), 'tracker.md null score shows N/A'); checks++;
    assert.ok(tmd.includes('Offer'), 'tracker.md uses status label, not id'); checks++;

    // Sort: offer (rank 50) must come before evaluated (rank 10) and rejected (rank 5).
    const iOffer = tmd.indexOf('Acme Corp');
    const iInterview = tmd.indexOf('Globex');
    const iEval = tmd.indexOf('Stark Industries');
    const iRej = tmd.indexOf('Umbrella');
    assert.ok(iOffer < iInterview && iInterview < iEval, 'tracker.md sorted by status rank desc'); checks++;
    assert.ok(iEval < iRej, 'rejected (low rank) sorts last'); checks++;

    // Pipe in data must be escaped, not break the table.
    const piped = renderTrackerMd([{ id: 9, date: '2026-06-07', company: 'A|B Co', role: 'Dev', score: 4.0, status: 'applied' }]);
    assert.ok(piped.includes('A\\|B Co'), 'tracker.md escapes pipes in cells'); checks++;

    // --- renderProgressMd ---
    const pmd = renderProgressMd(sample);
    assert.ok(pmd.includes(GEN_NOTE), 'progress.md has generated note'); checks++;
    assert.ok(pmd.includes('Total applications tracked: **6**'), 'progress.md total count'); checks++;
    assert.ok(pmd.includes('### Pipeline'), 'progress.md has Pipeline group heading'); checks++;
    assert.ok(pmd.includes('### Active'), 'progress.md has Active group heading'); checks++;
    assert.ok(pmd.includes('### Won'), 'progress.md has Won group heading'); checks++;
    assert.ok(pmd.includes('### Closed'), 'progress.md has Closed group heading'); checks++;

    // Funnel counts: evaluated=1, applied=1, interview=1, offer=1, rejected=1, skip=1.
    assert.ok(/\| Evaluated \| 1 \|/.test(pmd), 'progress.md evaluated count'); checks++;
    assert.ok(/\| Offer \| 1 \|/.test(pmd), 'progress.md offer count'); checks++;
    assert.ok(/\| Rejected \| 1 \|/.test(pmd), 'progress.md rejected count'); checks++;

    // Conversion rate line present (and reflects at-or-beyond math).
    // applied = ranks >= 20: applied(1)+interview(1)+offer(1) = 3 of 6 total.
    assert.ok(/Applied \/ total \| 3 \/ 6 = 50%/.test(pmd), 'progress.md applied/total rate line'); checks++;
    // interview = ranks >= 40: interview(1)+offer(1) = 2; of applied(3) = 67%.
    assert.ok(/Interview \/ applied \| 2 \/ 3 = 67%/.test(pmd), 'progress.md interview/applied rate line'); checks++;
    // offer = ranks >= 50: offer(1); of applied(3) = 33%.
    assert.ok(/Offer \/ applied \| 1 \/ 3 = 33%/.test(pmd), 'progress.md offer/applied rate line'); checks++;

    // Avg score over the 5 scored records: (4.6+4.1+3.7+2.9+4.3)/5 = 3.92.
    assert.ok(pmd.includes('Average score: **3.92**'), 'progress.md avg score'); checks++;

    // Score buckets.
    assert.ok(/\| >=4\.5 \| 1 \|/.test(pmd), 'bucket >=4.5 count'); checks++;
    assert.ok(/\| 4\.0–4\.4 \| 2 \|/.test(pmd), 'bucket 4.0-4.4 count'); checks++;
    assert.ok(/\| 3\.5–3\.9 \| 1 \|/.test(pmd), 'bucket 3.5-3.9 count'); checks++;
    assert.ok(/\| <3\.5 \| 1 \|/.test(pmd), 'bucket <3.5 count'); checks++;
    assert.ok(/\| N\/A \| 1 \|/.test(pmd), 'bucket N/A count'); checks++;

    // --- empty input ---
    const emptyT = renderTrackerMd([]);
    assert.ok(emptyT.includes('no applications yet'), 'tracker.md empty placeholder'); checks++;
    const emptyP = renderProgressMd([]);
    assert.ok(emptyP.includes('Total applications tracked: **0**'), 'progress.md empty total'); checks++;
    assert.ok(/Applied \/ total \| 0 \/ 0 = 0%/.test(emptyP), 'progress.md empty rate has no NaN'); checks++;
    assert.ok(!emptyP.includes('NaN'), 'progress.md never emits NaN'); checks++;
    assert.ok(emptyP.includes('Average score: **N/A**'), 'progress.md empty avg score is N/A'); checks++;

    // --- idempotence: rendering twice yields identical output ---
    assert.equal(renderTrackerMd(sample), renderTrackerMd(sample), 'renderTrackerMd is deterministic'); checks++;
    assert.equal(renderProgressMd(sample), renderProgressMd(sample), 'renderProgressMd is deterministic'); checks++;

    // --- end-to-end via --file: write a tiny jsonl, render, read back ---
    const jsonl = join(dir, 'tracker.jsonl');
    writeFileSync(jsonl, sample.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const readBack = readTracker(jsonl);
    assert.equal(readBack.length, 6, 'readTracker round-trips fixture'); checks++;
    const tmd2 = renderTrackerMd(readBack);
    assert.ok(tmd2.includes('Acme Corp'), 'end-to-end tracker.md contains company'); checks++;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`render-views self-test: ${checks} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { main(); }
