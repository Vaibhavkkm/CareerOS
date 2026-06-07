#!/usr/bin/env node
// scripts/match-score.mjs — fast, deterministic CV ↔ JD match score + band.
//
// Powers the job-match board: scores how well the user's master CV fits a job
// posting WITHOUT spending tokens, so the board can rank many postings cheaply.
// (The agent's `evaluate` mode is the deep, judged score for the postings the
// user actually cares about — this is the cheap pre-rank.)
//
// Score = 0.6 * keyword-coverage + 0.4 * TF-IDF cosine, in [0,1], mapped to a band:
//   STRONGEST >=0.85 · Very strong >=0.70 · Strong >=0.55 · Moderate >=0.40 · Weak
// Also returns `have` (JD keywords found in the CV) and `gap` (JD keywords missing).
//
// Usage:
//   node scripts/match-score.mjs --jd <file|text> --cv <file|text> [--top 18] [--summary]
//   node scripts/match-score.mjs --self-test

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { stem, stemTokens } from '../lib/text.mjs';
import { buildTf, emptyIdf, tfidfVec, cosine, indexAdd } from '../lib/tfidf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CV = join(ROOT, 'data', 'cv.master.md');

// Bands, best → worst. A score maps to the first band whose floor it clears.
export const BANDS = [
  ['STRONGEST', 0.85],
  ['Very strong', 0.70],
  ['Strong', 0.55],
  ['Moderate', 0.40],
  ['Weak', 0],
];
export function bandFor(score) {
  for (const [label, floor] of BANDS) if (score >= floor) return label;
  return 'Weak';
}
// 0 = STRONGEST (best). Used for `--min <band>` filtering on the board.
export function bandRank(label) {
  const i = BANDS.findIndex(([l]) => l.toLowerCase() === String(label).toLowerCase());
  return i === -1 ? BANDS.length : i;
}
export const STARS = { STRONGEST: '★★★★', 'Very strong': '★★★', Strong: '★★', Moderate: '★', Weak: '·' };

// stemTokens can leave trailing sentence punctuation stuck to a token ("aws."
// vs "aws", "etl." vs "etl"), which silently breaks matching. Strip edge
// punctuation so the JD and CV token spaces line up. Keeps tech punctuation that
// is INTERNAL (c++, c#, node.js) — only leading/trailing junk is removed.
const stripEdge = (s) => String(s).replace(/^[("'\[]+/, '').replace(/[.,;:!?'")\]]+$/, '');
function normTokens(text) {
  return stemTokens(text || '').map(stripEdge).filter((t) => t.length >= 2);
}

// Generic recruiting boilerplate (stemmed) that isn't a real "skill" keyword, so
// it shouldn't count for or against coverage.
const JD_BOILERPLATE = new Set([
  'look', 'seek', 'join', 'team', 'role', 'candid', 'year', 'experi', 'requir',
  'prefer', 'abil', 'work', 'want', 'ideal', 'strong', 'plus', 'nice', 'must',
  'responsibl', 'opportun', 'compani', 'help', 'includ', 'etc', 'job', 'posit',
  // common non-skill noise that slips past the stemmer's stopword list
  'if', 'range', 'value', 'various', 'tool', 'comfort', 'need', 'someone', 'who',
  'player', 'align', 'well', 'great', 'good', 'new', 'around', 'within', 'able',
  'level', 'technology', 'across',
]);

// Build a stem→surface-form map so we can DISPLAY readable keywords (e.g. "Airflow"
// for the stem "airflow", "Kubernetes" not "kubernet").
function surfaceMap(text) {
  const map = new Map();
  for (const raw of String(text || '').split(/[^A-Za-z0-9+#.]+/)) {
    const surface = stripEdge(raw);
    if (!surface) continue;
    const s = stripEdge(stem(surface.toLowerCase()));
    if (s && !map.has(s)) map.set(s, surface);
  }
  return map;
}

// The most salient JD keywords: distinct content stems (minus boilerplate),
// ranked by frequency then length (longer terms tend to be specific skills).
export function jdKeywords(jdText, topK = 18) {
  const freq = new Map();
  for (const t of normTokens(jdText)) {
    if (JD_BOILERPLATE.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length) || (a[0] < b[0] ? -1 : 1))
    .slice(0, topK)
    .map(([t]) => t);
}

// The core: returns { score, band, coverage, cosine, have:[surface], gap:[surface] }.
export function scoreMatch(jdText, cvText, { topK = 18 } = {}) {
  const jdToks = normTokens(jdText);
  const cvToks = normTokens(cvText);
  if (!jdToks.length || !cvToks.length) {
    return { score: 0, band: 'Weak', coverage: 0, cosine: 0, have: [], gap: [], keywords: [] };
  }
  const cvSet = new Set(cvToks);
  const keywords = jdKeywords(jdText, topK);
  const matched = keywords.filter((k) => cvSet.has(k));
  const coverage = keywords.length ? matched.length / keywords.length : 0;

  // TF-IDF cosine over a 2-doc corpus (JD, CV) as a lexical-similarity proxy.
  const idf = emptyIdf();
  const jdTf = buildTf(jdToks);
  const cvTf = buildTf(cvToks);
  indexAdd(idf, jdTf);
  indexAdd(idf, cvTf);
  const cos = cosine(tfidfVec(jdTf, idf), tfidfVec(cvTf, idf));

  const score = +(0.6 * coverage + 0.4 * cos).toFixed(4);
  const jdSurface = surfaceMap(jdText);
  const display = (stems) => stems.map((s) => jdSurface.get(s) || s);
  return {
    score,
    band: bandFor(score),
    coverage: +coverage.toFixed(4),
    cosine: +cos.toFixed(4),
    have: display(matched),
    gap: display(keywords.filter((k) => !cvSet.has(k))),
    keywords: display(keywords),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { jd: null, cv: null, top: 18, json: true, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (a === '--jd') out.jd = val();
    else if (a.startsWith('--jd=')) out.jd = a.slice(5);
    else if (a === '--cv') out.cv = val();
    else if (a.startsWith('--cv=')) out.cv = a.slice(5);
    else if (a === '--top') out.top = parseInt(val(), 10) || 18;
    else if (a.startsWith('--top=')) out.top = parseInt(a.slice(6), 10) || 18;
  }
  return out;
}
function readArg(v, fallback) {
  if (!v) return fallback != null && existsSync(fallback) ? readFileSync(fallback, 'utf8') : '';
  if (existsSync(v)) return readFileSync(v, 'utf8');
  return String(v);
}

const USAGE = `match-score — fast CV↔JD match score + band.
Usage: node scripts/match-score.mjs --jd <file|text> --cv <file|text> [--top 18] [--summary]
  --jd / --cv accept either a file path (if it exists) OR literal text.
  --summary  human-readable output (default: JSON)
  --self-test  run built-in tests`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();
  const jd = readArg(args.jd, null);
  const cv = readArg(args.cv, DEFAULT_CV);
  if (!jd) { console.error('error: --jd <file|text> required'); process.exit(2); }
  if (!cv) { console.error(`error: --cv <file|text> required (or create ${DEFAULT_CV})`); process.exit(2); }
  const res = scoreMatch(jd, cv, { topK: args.top });
  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`${STARS[res.band]} ${res.band}  (match ${res.score})`);
    console.log(`  have: ${res.have.join(', ') || '—'}`);
    console.log(`  gap:  ${res.gap.join(', ') || '—'}`);
  }
  process.exit(0);
}

// ─── self-test ───────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // bands
  eq(bandFor(0.90), 'STRONGEST', 'band STRONGEST'); eq(bandFor(0.72), 'Very strong', 'band Very strong');
  eq(bandFor(0.6), 'Strong', 'band Strong'); eq(bandFor(0.45), 'Moderate', 'band Moderate');
  eq(bandFor(0.1), 'Weak', 'band Weak');
  ok(bandRank('STRONGEST') < bandRank('Strong') && bandRank('Strong') < bandRank('Weak'), 'bandRank orders best→worst');

  // jdKeywords surfaces the salient terms
  const kws = jdKeywords('We need Python, Airflow and Kubernetes. Python Python.', 5);
  ok(kws.includes(stem('python')), 'jdKeywords includes repeated salient term');

  const cv = 'Built data pipelines in Python and Airflow, productionising ML models on AWS; cut latency 40%. SQL, pandas, ETL.';
  const strongJd = 'Looking for a data engineer strong in Python, Airflow, SQL and ETL to build ML data pipelines on AWS.';
  const weakJd = 'Seeking a frontend designer skilled in Figma, typography, brand identity and motion graphics for marketing.';

  const strong = scoreMatch(strongJd, cv);
  const weak = scoreMatch(weakJd, cv);
  ok(strong.score > weak.score, `strong JD scores higher than weak (${strong.score} > ${weak.score})`);
  ok(strong.score >= 0.55, `well-matched JD reaches at least Strong (got ${strong.score} ${strong.band})`);
  ok(strong.have.some((h) => /python/i.test(h)), 'have[] surfaces a matched skill (Python)');
  ok(weak.gap.length > 0, 'weak JD reports gaps');
  ok(weak.band === 'Weak' || weak.band === 'Moderate', `mismatched JD lands low (got ${weak.band})`);

  // display uses readable surface forms, not bare stems
  ok(strong.keywords.some((k) => k === 'Python' || k === 'Airflow' || k === 'Kubernetes' || /[A-Z]/.test(k) || k.length > 3), 'keywords shown as surface forms');

  // empty inputs are safe
  eq(scoreMatch('', cv).score, 0, 'empty JD → 0'); eq(scoreMatch(strongJd, '').score, 0, 'empty CV → 0');

  // jdKeywords edge cases
  eq(jdKeywords(strongJd, 0).length, 0, 'topK=0 returns no keywords');
  const boilerplateJd = 'We are looking for someone who wants to join a great team and work on various tools.';
  ok(jdKeywords(boilerplateJd, 8).every((k) => !JD_BOILERPLATE.has(k)), 'pure-boilerplate JD yields no skill keywords');
  ok(!scoreMatch(strongJd, cv).gap.some((g) => /^(if|range|value|various|who)$/i.test(g)), 'noise words no longer surface as gaps');

  // identical text → top score; boilerplate-only JD → low
  ok(scoreMatch(cv, cv).score >= 0.85, `identical CV/JD scores STRONGEST (got ${scoreMatch(cv, cv).score})`);
  ok(scoreMatch(boilerplateJd, cv).score < 0.4, 'boilerplate-only JD scores low (no real overlap)');

  console.log(`match-score self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`match-score self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main();
  }
}
