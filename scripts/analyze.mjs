#!/usr/bin/env node
// scripts/analyze.mjs — outcome analytics over the application pipeline.
//
// Reads data/tracker.jsonl (TRUTH) and each linked report's embedded
// ```yaml Machine Summary``` (parsed with js-yaml — that block ONLY, never prose),
// classifies outcomes, and computes a funnel, score distribution, conversion by
// archetype / legitimacy tier, blocker frequency, and a recommended
// compile_score_threshold (the lowest score among positive outcomes).
//
// Usage:
//   node scripts/analyze.mjs                 # JSON to stdout
//   node scripts/analyze.mjs --summary       # human-readable view
//   node scripts/analyze.mjs --json          # force JSON (default already JSON)
//   node scripts/analyze.mjs --today=YYYY-MM-DD
//   node scripts/analyze.mjs --no-snapshot   # don't write the snapshot .md
//   node scripts/analyze.mjs --self-test
//
// When run for real (not --self-test) it writes a snapshot to
// data/reports/pattern-analysis-<today>.md (suppress with --no-snapshot).
// Exit 0 on success, 1 on failure.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { readTracker, parseScore } from '../lib/records.mjs';
import { normalizeStatus } from '../lib/states.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Refuse strong claims below this many classified applications.
export const MIN_THRESHOLD = 5;

// Outcome buckets keyed by canonical status id.
const OUTCOME_OF = {
  offer: 'positive', interview: 'positive', responded: 'positive',
  rejected: 'negative',
  skip: 'self_filtered', discarded: 'self_filtered',
  evaluated: 'pending', applied: 'pending',
};
export const OUTCOMES = ['positive', 'negative', 'self_filtered', 'pending'];

export function classifyOutcome(status) {
  const id = normalizeStatus(status);
  return (id && OUTCOME_OF[id]) || 'pending';
}

// ---------- arg parsing ----------
export function parseArgs(argv) {
  const out = { summary: false, json: false, selfTest: false, snapshot: true, today: null };
  for (const a of argv) {
    if (a === '--summary') out.summary = true;
    else if (a === '--json') out.json = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--no-snapshot') out.snapshot = false;
    else if (a.startsWith('--today=')) out.today = a.slice('--today='.length);
  }
  return out;
}

function todayStr(override) {
  if (override) return override;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- Machine Summary extraction ----------
// Read ONLY the fenced ```yaml block under a "Machine Summary" heading.
// Falls back to the LAST fenced yaml block if no heading is present.
export function extractMachineSummary(markdown) {
  if (!markdown) return null;
  let raw = null;
  // Prefer a fence that follows a "Machine Summary" heading.
  const headed = markdown.match(
    /Machine Summary[^\n]*\n+```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/i,
  );
  if (headed) raw = headed[1];
  if (raw == null) {
    // Otherwise take the last yaml fence in the file.
    const fences = [...markdown.matchAll(/```(?:yaml|yml)\s*\n([\s\S]*?)\n```/gi)];
    if (fences.length) raw = fences[fences.length - 1][1];
  }
  if (raw == null || !raw.trim()) return null;
  try {
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Load + parse the Machine Summary for one tracker record (by its report path).
export function loadSummary(record, root = ROOT) {
  const rel = record && record.report;
  if (!rel) return null;
  const abs = join(root, 'data', rel);
  if (!existsSync(abs)) return null;
  try {
    return extractMachineSummary(readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- helpers ----------
function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v == null || v === '') return [];
  if (typeof v === 'object') return [];
  return [String(v).trim()].filter(Boolean);
}

function asScalar(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function scoreStats(arr) {
  if (!arr.length) return { count: 0, avg: null, min: null, max: null };
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    count: arr.length,
    avg: Math.round((sum / arr.length) * 100) / 100,
    min: Math.min(...arr),
    max: Math.max(...arr),
  };
}

// Conversion table keyed by some dimension (archetype, legitimacy tier, ...).
function conversionTable(enriched, keyFn) {
  const map = new Map();
  for (const e of enriched) {
    const key = keyFn(e) || 'Unknown';
    if (!map.has(key)) {
      map.set(key, { total: 0, positive: 0, negative: 0, self_filtered: 0, pending: 0 });
    }
    const row = map.get(key);
    row.total++;
    row[e.outcome]++;
  }
  return [...map.entries()]
    .map(([key, data]) => ({
      key,
      ...data,
      // Conversion among DECIDED applications (exclude pending), so a backlog of
      // not-yet-applied evals doesn't artificially depress the rate.
      decided: data.total - data.pending,
      conversion_rate:
        data.total - data.pending > 0
          ? Math.round((data.positive / (data.total - data.pending)) * 100)
          : null,
    }))
    .sort((a, b) => b.total - a.total);
}

// ---------- core analysis (pure; exported for tests) ----------
// records: array of tracker records.
// summaries: parallel array (same length/order) of Machine Summary objects (or null).
export function analyze(records, summaries = []) {
  const total = records.length;
  if (total === 0) {
    return {
      ok: false,
      reason: 'no applications in tracker',
      total: 0,
      min_threshold: MIN_THRESHOLD,
      sufficient: false,
    };
  }

  const enriched = records.map((r, i) => {
    const s = summaries[i] || null;
    const status = normalizeStatus(r.status) || 'unknown';
    const outcome = classifyOutcome(r.status);
    // Prefer the tracker score; fall back to the report's score.
    const trackerScore = parseScore(r.score);
    const sumScore = s ? parseScore(s.score) : null;
    const score = trackerScore != null ? trackerScore : sumScore;
    const archetype =
      asScalar(s && s.archetype) || asScalar(r.archetype) || 'Unknown';
    const legitimacy =
      asScalar(s && s.legitimacy_tier) || asScalar(r.legitimacy) || 'Unknown';
    const hardStops = s ? asList(s.hard_stops) : [];
    const softGaps = s ? asList(s.soft_gaps) : [];
    return { record: r, summary: s, status, outcome, score, archetype, legitimacy, hardStops, softGaps };
  });

  // --- funnel: count by canonical status + by outcome bucket ---
  const funnel = {};
  for (const e of enriched) funnel[e.status] = (funnel[e.status] || 0) + 1;

  const byOutcome = { positive: 0, negative: 0, self_filtered: 0, pending: 0 };
  for (const e of enriched) byOutcome[e.outcome]++;

  // Applications that reached a decision (anything but pending) gate strong claims.
  const decidedCount = total - byOutcome.pending;
  const sufficient = decidedCount >= MIN_THRESHOLD;

  // --- score distribution by outcome ---
  const scoresByOutcome = { positive: [], negative: [], self_filtered: [], pending: [] };
  for (const e of enriched) {
    if (e.score != null) scoresByOutcome[e.outcome].push(e.score);
  }
  const scoreDistribution = {
    positive: scoreStats(scoresByOutcome.positive),
    negative: scoreStats(scoresByOutcome.negative),
    self_filtered: scoreStats(scoresByOutcome.self_filtered),
    pending: scoreStats(scoresByOutcome.pending),
  };

  // --- conversion by archetype & legitimacy tier ---
  const byArchetype = conversionTable(enriched, (e) => e.archetype);
  const byLegitimacy = conversionTable(enriched, (e) => e.legitimacy);

  // --- blocker frequency (hard_stops + soft_gaps tallied across reports) ---
  const blockerMap = new Map();
  let reportsWithSummary = 0;
  for (const e of enriched) {
    if (e.summary) reportsWithSummary++;
    const add = (text, kind) => {
      const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!norm) return;
      if (!blockerMap.has(norm)) {
        blockerMap.set(norm, { blocker: text.trim(), kind, count: 0 });
      }
      blockerMap.get(norm).count++;
    };
    for (const h of e.hardStops) add(h, 'hard_stop');
    for (const g of e.softGaps) add(g, 'soft_gap');
  }
  const blockers = [...blockerMap.values()].sort(
    (a, b) => b.count - a.count || a.blocker.localeCompare(b.blocker),
  );

  // --- recommended compile_score_threshold = lowest score among POSITIVE outcomes ---
  const positiveScores = scoresByOutcome.positive;
  let compileScoreThreshold;
  if (positiveScores.length === 0) {
    compileScoreThreshold = {
      value: null,
      reason: 'insufficient data: no scored positive outcomes yet',
      positive_score_count: 0,
    };
  } else {
    const minPos = Math.min(...positiveScores);
    compileScoreThreshold = {
      value: minPos,
      reason: sufficient
        ? `lowest score among positive outcomes is ${minPos}; no scored application below this has produced a positive outcome`
        : `provisional (only ${decidedCount}/${MIN_THRESHOLD} decided applications): lowest positive score so far is ${minPos}`,
      positive_score_count: positiveScores.length,
    };
  }

  const dates = enriched
    .map((e) => e.record.date)
    .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  return {
    ok: true,
    total,
    min_threshold: MIN_THRESHOLD,
    decided: decidedCount,
    sufficient,
    reports_with_summary: reportsWithSummary,
    date_range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    funnel,
    by_outcome: byOutcome,
    score_distribution: scoreDistribution,
    conversion_by_archetype: byArchetype,
    conversion_by_legitimacy: byLegitimacy,
    blockers,
    compile_score_threshold: compileScoreThreshold,
  };
}

// ---------- human-readable view ----------
export function renderSummary(result) {
  const L = [];
  if (!result.ok) {
    L.push('offerforge analyze');
    L.push('');
    L.push(`  ${result.reason}`);
    return L.join('\n');
  }
  const dr = result.date_range ? ` (${result.date_range.from} to ${result.date_range.to})` : '';
  L.push('offerforge analyze');
  L.push('');
  L.push(`  ${result.total} applications${dr}`);
  L.push(
    `  decided: ${result.decided}/${result.min_threshold} ` +
      (result.sufficient ? '(enough for strong claims)' : '(below threshold — claims are provisional)'),
  );
  L.push('');

  L.push('FUNNEL (by status)');
  const order = ['evaluated', 'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'skip'];
  for (const s of order) {
    if (result.funnel[s]) {
      const pct = Math.round((result.funnel[s] / result.total) * 100);
      L.push(`  ${s.padEnd(12)} ${String(result.funnel[s]).padStart(3)}  (${pct}%)`);
    }
  }
  L.push('');
  L.push('OUTCOMES');
  for (const o of OUTCOMES) {
    L.push(`  ${o.padEnd(14)} ${String(result.by_outcome[o]).padStart(3)}`);
  }
  L.push('');

  L.push('SCORE BY OUTCOME');
  for (const o of OUTCOMES) {
    const st = result.score_distribution[o];
    if (st.count > 0) {
      L.push(`  ${o.padEnd(14)} avg ${st.avg}  (n=${st.count}, range ${st.min}-${st.max})`);
    }
  }
  L.push('');

  L.push('CONVERSION BY ARCHETYPE  (positive / decided)');
  for (const row of result.conversion_by_archetype) {
    const rate = row.conversion_rate == null ? 'n/a' : `${row.conversion_rate}%`;
    L.push(`  ${String(row.key).slice(0, 32).padEnd(34)} ${row.positive}/${row.decided} (${rate})  [${row.total} total]`);
  }
  L.push('');

  L.push('CONVERSION BY LEGITIMACY TIER  (positive / decided)');
  for (const row of result.conversion_by_legitimacy) {
    const rate = row.conversion_rate == null ? 'n/a' : `${row.conversion_rate}%`;
    L.push(`  ${String(row.key).slice(0, 32).padEnd(34)} ${row.positive}/${row.decided} (${rate})  [${row.total} total]`);
  }
  L.push('');

  if (result.blockers.length) {
    L.push('TOP BLOCKERS (hard_stops + soft_gaps)');
    for (const b of result.blockers.slice(0, 15)) {
      L.push(`  ${String(b.count).padStart(2)}x [${b.kind}] ${b.blocker}`);
    }
    L.push('');
  }

  const t = result.compile_score_threshold;
  L.push('RECOMMENDED compile_score_threshold');
  L.push(`  ${t.value == null ? 'insufficient data' : t.value}`);
  L.push(`  ${t.reason}`);
  L.push('');
  if (!result.sufficient) {
    L.push(`NOTE: fewer than ${result.min_threshold} decided applications — treat all rates above as directional, not conclusive.`);
  }
  return L.join('\n');
}

// ---------- snapshot markdown ----------
export function renderSnapshot(result, today) {
  const L = [];
  L.push(`# Pattern Analysis — ${today}`);
  L.push('');
  L.push('Generated by `scripts/analyze.mjs`. Source: `data/tracker.jsonl` + embedded report Machine Summaries.');
  L.push('');
  L.push('```');
  L.push(renderSummary(result));
  L.push('```');
  L.push('');
  L.push('## Machine Summary');
  L.push('');
  L.push('```yaml');
  L.push(yaml.dump({ generated: today, ...result }).trimEnd());
  L.push('```');
  L.push('');
  return L.join('\n');
}

// ---------- self-test ----------
async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

  // 1) extractMachineSummary reads ONLY the fenced yaml block under the heading.
  const md = [
    '# Eval: Acme — Staff AI Engineer',
    '',
    'Some prose. score: 9.9 (this MUST be ignored — it is prose, not yaml).',
    '',
    '## Machine Summary',
    '',
    '```yaml',
    'company: Acme',
    'role: Staff AI Engineer',
    'score: 4.2',
    'archetype: AI Platform / LLMOps',
    'legitimacy_tier: High Confidence',
    'final_decision: Apply',
    'hard_stops: []',
    'soft_gaps:',
    '  - No direct healthcare domain experience',
    'report_num: 1',
    '```',
    '',
  ].join('\n');
  const ms = extractMachineSummary(md);
  ok(ms && ms.score === 4.2, 'machine summary score parsed from yaml block');
  ok(ms.company === 'Acme', 'machine summary company parsed');
  eq(ms.soft_gaps, ['No direct healthcare domain experience'], 'soft_gaps list parsed');
  ok(extractMachineSummary('no fences here') === null, 'returns null when no yaml block');

  // 2) classifyOutcome maps statuses to buckets (incl. aliases).
  eq(classifyOutcome('interview'), 'positive', 'interview -> positive');
  eq(classifyOutcome('offer'), 'positive', 'offer -> positive');
  eq(classifyOutcome('responded'), 'positive', 'responded -> positive');
  eq(classifyOutcome('rejected'), 'negative', 'rejected -> negative');
  eq(classifyOutcome('skip'), 'self_filtered', 'skip -> self_filtered');
  eq(classifyOutcome('discarded'), 'self_filtered', 'discarded -> self_filtered');
  eq(classifyOutcome('applied'), 'pending', 'applied -> pending');
  eq(classifyOutcome('evaluated'), 'pending', 'evaluated -> pending');
  eq(classifyOutcome('phone-screen'), 'positive', 'alias phone-screen -> responded -> positive');

  // 3) analyze() over synthetic records + summaries.
  const records = [
    { id: 1, date: '2026-01-01', company: 'Acme', role: 'Staff AI', score: 4.5, status: 'offer', archetype: 'LLMOps', legitimacy: 'High Confidence' },
    { id: 2, date: '2026-01-02', company: 'Beta', role: 'ML Eng', score: 3.8, status: 'interview', archetype: 'LLMOps', legitimacy: 'High Confidence' },
    { id: 3, date: '2026-01-03', company: 'Gamma', role: 'Data Eng', score: 4.1, status: 'responded', archetype: 'Data', legitimacy: 'Proceed with Caution' },
    { id: 4, date: '2026-01-04', company: 'Delta', role: 'AI Eng', score: 2.9, status: 'rejected', archetype: 'LLMOps', legitimacy: 'Proceed with Caution' },
    { id: 5, date: '2026-01-05', company: 'Epsilon', role: 'SWE', score: 2.0, status: 'skip', archetype: 'Backend', legitimacy: 'Suspicious' },
    { id: 6, date: '2026-01-06', company: 'Zeta', role: 'AI Eng', score: 4.0, status: 'applied', archetype: 'LLMOps', legitimacy: 'High Confidence' },
  ];
  const summaries = [
    { company: 'Acme', score: 4.5, hard_stops: [], soft_gaps: ['No k8s in prod'] },
    { company: 'Beta', score: 3.8, hard_stops: [], soft_gaps: ['No k8s in prod'] },
    { company: 'Gamma', score: 4.1, hard_stops: ['Requires US residency'], soft_gaps: [] },
    { company: 'Delta', score: 2.9, hard_stops: ['Requires US residency'], soft_gaps: ['Limited NLP depth'] },
    { company: 'Epsilon', score: 2.0, hard_stops: [], soft_gaps: [] },
    null, // record 6 has no parsed summary
  ];

  const res = analyze(records, summaries);
  ok(res.ok, 'analyze returns ok');
  eq(res.total, 6, 'total counted');

  // Recommended threshold = lowest score among positive outcomes (offer/interview/responded):
  // scores 4.5, 3.8, 4.1 => min 3.8.
  eq(res.compile_score_threshold.value, 3.8, 'recommended threshold = lowest positive score (3.8)');

  // Outcome buckets.
  eq(res.by_outcome, { positive: 3, negative: 1, self_filtered: 1, pending: 1 }, 'outcome buckets');

  // Decided = total - pending = 5 => sufficient (>= MIN_THRESHOLD of 5).
  eq(res.decided, 5, 'decided count excludes pending');
  ok(res.sufficient === true, 'sufficient at 5 decided');

  // Conversion by archetype: LLMOps decided = {offer, interview, rejected} = 3, positive = 2 => 67%.
  const llmops = res.conversion_by_archetype.find((r) => r.key === 'LLMOps');
  ok(llmops, 'LLMOps archetype row present');
  eq(llmops.total, 4, 'LLMOps total includes the pending applied one');
  eq(llmops.decided, 3, 'LLMOps decided excludes pending');
  eq(llmops.conversion_rate, 67, 'LLMOps conversion = 2/3 = 67%');

  // Conversion by legitimacy: High Confidence decided = {offer, interview} = 2 (Zeta is pending), positive = 2 => 100%.
  const hc = res.conversion_by_legitimacy.find((r) => r.key === 'High Confidence');
  ok(hc, 'High Confidence tier row present');
  eq(hc.conversion_rate, 100, 'High Confidence conversion = 2/2 = 100%');

  // Blocker tally: "No k8s in prod" appears 2x, "Requires US residency" 2x.
  const k8s = res.blockers.find((b) => /k8s/i.test(b.blocker));
  const geo = res.blockers.find((b) => /residency/i.test(b.blocker));
  eq(k8s.count, 2, '"No k8s in prod" tallied twice');
  eq(k8s.kind, 'soft_gap', 'k8s classified as soft_gap');
  eq(geo.count, 2, '"Requires US residency" tallied twice');
  eq(geo.kind, 'hard_stop', 'residency classified as hard_stop');

  // Score distribution by outcome.
  eq(res.score_distribution.positive.min, 3.8, 'positive min score');
  eq(res.score_distribution.negative.count, 1, 'one negative score');

  // 4) insufficient-data path: a single decided application.
  const small = analyze(
    [{ id: 1, date: '2026-02-01', company: 'X', role: 'Y', score: 4.4, status: 'offer' }],
    [null],
  );
  ok(small.sufficient === false, 'one decided app is below threshold');
  eq(small.compile_score_threshold.value, 4.4, 'still reports lowest positive score when present');
  ok(/provisional/i.test(small.compile_score_threshold.reason), 'reason flagged provisional');

  // 5) no positive outcomes => insufficient-data threshold message.
  const noPos = analyze(
    [{ id: 1, date: '2026-03-01', company: 'X', role: 'Y', score: 3.0, status: 'rejected' }],
    [null],
  );
  eq(noPos.compile_score_threshold.value, null, 'no positives => null threshold');
  ok(/insufficient data/i.test(noPos.compile_score_threshold.reason), 'insufficient data noted');

  // 6) empty tracker.
  const empty = analyze([], []);
  ok(empty.ok === false && empty.total === 0, 'empty tracker handled');

  // 7) snapshot/summary render without throwing.
  ok(typeof renderSummary(res) === 'string' && renderSummary(res).includes('compile_score_threshold'), 'summary renders');
  ok(renderSnapshot(res, '2026-06-07').includes('Pattern Analysis — 2026-06-07'), 'snapshot renders with date');

  console.log(`analyze self-test: ${checks} checks passed`);
  return 0;
}

// ---------- CLI ----------
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest().then((code) => process.exit(code)).catch((e) => {
      console.error(`analyze self-test FAILED: ${e.message}`);
      process.exit(1);
    });
    return;
  }

  const today = todayStr(args.today);
  const trackerPath = join(ROOT, 'data', 'tracker.jsonl');
  const records = readTracker(trackerPath);
  const summaries = records.map((r) => loadSummary(r, ROOT));
  const result = analyze(records, summaries);

  if (args.summary) {
    console.log(renderSummary(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  // Write a snapshot when run for real (skipped in self-test path above).
  if (args.snapshot && result.ok) {
    const reportsDir = join(ROOT, 'data', 'reports');
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
    const snapPath = join(reportsDir, `pattern-analysis-${today}.md`);
    writeFileSync(snapPath, renderSnapshot(result, today));
    if (args.summary) console.log(`\nsnapshot written: ${snapPath}`);
  }

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
