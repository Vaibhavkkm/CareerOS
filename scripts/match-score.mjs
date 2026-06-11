#!/usr/bin/env node
// scripts/match-score.mjs — fast, deterministic CV ↔ JD match score + band.
//
// Powers the job-match board: scores how well the user's master CV fits a job
// posting WITHOUT spending tokens, so the board can rank many postings cheaply.
// (The agent's `evaluate` mode is the deep, judged score for the postings the
// user actually cares about — this is the cheap pre-rank.)
//
// Score = 0.45*coverage(JD→CV) + 0.35*relevance(CV→JD) + 0.2*TF-IDF cosine, in
// [0,1], mapped to a band:
//   STRONGEST >=0.48 · Very strong >=0.42 · Strong >=0.36 · Moderate >=0.28 · Weak
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
// CALIBRATED to the score's REAL range: score = 0.6*coverage + 0.4*cosine only
// approaches 1.0 for near-identical text. For real CV↔JD pairs, coverage tops out
// ~0.5 (a JD always has many terms a CV won't) and cosine ~0.35, so even an
// excellent on-paper match lands ~0.45–0.55, a solid match ~0.38–0.45. The old
// floors (0.85/0.70/0.55) were unreachable in practice, so every real posting read
// as "Weak". These floors map the achievable range to bands that actually
// discriminate your best fits. (Absolute fit still depends on how relevant the
// fetched jobs are — target the search to raise real matches, not just the label.)
export const BANDS = [
  ['STRONGEST', 0.48],
  ['Very strong', 0.42],
  ['Strong', 0.36],
  ['Moderate', 0.28],
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

// Calibrated 0–10 "fit" for DISPLAY. The raw score is a lexical-overlap proxy whose
// realistic ceiling is ~0.5 (a CV and a JD are different document types — a JD is
// half boilerplate no CV contains), so a raw 0.50 is an EXCELLENT match, not "5/10".
// This maps the raw score's real range onto 0–10 anchored to the band floors, so a
// STRONGEST match reads ~8.5–10 and the number is interpretable. Monotonic, so it
// never changes the ranking. It is NOT a probability of getting hired.
const FIT_ANCHORS = [[0, 0], [0.20, 3], [0.28, 4], [0.36, 5.5], [0.42, 7], [0.48, 8.5], [0.55, 9.5], [0.70, 10]];
export function fitScore(raw) {
  const x = Math.max(0, Math.min(1, Number(raw) || 0));
  for (let i = 1; i < FIT_ANCHORS.length; i++) {
    const [x0, y0] = FIT_ANCHORS[i - 1];
    const [x1, y1] = FIT_ANCHORS[i];
    if (x <= x1) return +(y0 + (y1 - y0) * ((x - x0) / (x1 - x0))).toFixed(1);
  }
  return 10;
}

// stemTokens can leave trailing sentence punctuation stuck to a token ("aws."
// vs "aws", "etl." vs "etl"), which silently breaks matching. Strip edge
// punctuation so the JD and CV token spaces line up. Keeps tech punctuation that
// is INTERNAL (c++, c#, node.js) — only leading/trailing junk is removed.
const stripEdge = (s) => String(s).replace(/^[("'\[]+/, '').replace(/[.,;:!?'")\]]+$/, '');
// Exported so board.mjs can tokenize each JD ONCE and share the tokens between
// buildCorpusIdf and scoreMatch (tokenizing/stemming is the scoring hot path).
export function normTokens(text) {
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
  return keywordsFromToks(normTokens(jdText), topK);
}
// Same ranking from ALREADY-tokenized text, so a caller holding the tokens
// doesn't pay for a second tokenize+stem pass.
export function keywordsFromToks(toks, topK = 18) {
  const k = Math.max(0, Math.floor(Number(topK) || 0)); // a negative --top must mean "none", not slice(0,-1) dropping the last
  const freq = new Map();
  for (const t of toks) {
    if (JD_BOILERPLATE.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length) || (a[0] < b[0] ? -1 : 1))
    .slice(0, k)
    .map(([t]) => t);
}

// Build ONE TF-IDF document-frequency index across MANY documents (every JD on the
// board + the CV). Pass it to scoreMatch({ idf }) so the cosine term becomes
// discriminative board-wide: terms common across the corpus are down-weighted and
// rare, specific skills shared by a JD and the CV dominate. This lets a genuinely
// strong match score well above the ~0.45 ceiling that a per-JD 2-document corpus
// imposes (where a shared term gets df==N and the minimum idf weight).
export function buildCorpusIdf(texts) {
  const idf = emptyIdf();
  // Each entry is raw text OR an already-tokenized array (so the board can
  // tokenize each JD once and reuse the tokens for scoring).
  for (const t of texts) indexAdd(idf, buildTf(Array.isArray(t) ? t : normTokens(t || '')));
  return idf;
}

// Precompute everything about the CV that scoreMatch would otherwise redo PER JD
// (tokenize+stem, term frequencies, keywords, and — when a corpus idf is given —
// the tf-idf vector). On a 2,700-posting board this is the difference between
// stemming the CV once and stemming it 2,700 times.
export function prepCv(cvText, { idf = null, topK = 24 } = {}) {
  const toks = normTokens(cvText);
  const tf = buildTf(toks);
  return {
    toks,
    set: new Set(toks),
    tf,
    keywords: keywordsFromToks(toks, topK),
    vec: idf ? tfidfVec(tf, idf) : null, // only valid against that same idf
  };
}

// The core: returns { score, band, coverage, cosine, have:[surface], gap:[surface] }.
// Perf knobs (all optional, results identical): `jdToks` = pre-tokenized JD text;
// `cv` = a prepCv() object so the CV isn't re-tokenized/re-vectorized per JD.
export function scoreMatch(jdText, cvText, { topK = 18, idf = null, cvKeywords = null, jdToks = null, cv = null } = {}) {
  const jdT = jdToks || normTokens(jdText);
  const cvP = cv || prepCv(cvText, { idf, topK: Math.max(topK, 24) });
  if (!jdT.length || !cvP.toks.length) {
    return { score: 0, band: 'Weak', coverage: 0, cosine: 0, have: [], gap: [], keywords: [] };
  }
  const cvSet = cvP.set;
  const jdSet = new Set(jdT);
  const keywords = keywordsFromToks(jdT, topK);
  const matched = keywords.filter((k) => cvSet.has(k));
  // coverage (JD→CV): of the JD's salient asks, how many does the candidate have.
  const coverage = keywords.length ? matched.length / keywords.length : 0;
  // relevance (CV→JD): of the candidate's OWN salient terms (skills/domains), how
  // many does this JD mention. A job in the candidate's field hits many; an
  // off-field job hits few. This is the half the old score ignored — without it a
  // perfect-domain match and a vaguely-overlapping one scored nearly the same.
  // cvKeywords is the same for every JD scored against one CV — the caller (board)
  // precomputes it ONCE and passes it in, instead of re-tokenizing the CV per JD.
  const cvKw = cvKeywords || cvP.keywords;
  const relevance = cvKw.length ? cvKw.filter((k) => jdSet.has(k)).length / cvKw.length : 0;

  // TF-IDF cosine as a lexical-similarity proxy. A caller (board.mjs) can pass a
  // CORPUS idf built over every posting + the CV so shared rare skills carry real
  // weight; without one we fall back to a 2-doc (JD, CV) corpus for standalone use.
  const jdTf = buildTf(jdT);
  let useIdf = idf;
  if (!useIdf) {
    useIdf = emptyIdf();
    indexAdd(useIdf, jdTf);
    indexAdd(useIdf, cvP.tf);
  }
  // cvP.vec was built against the corpus idf — only reuse it when scoring with
  // that same idf (the fallback 2-doc idf above is a different space).
  const cvVec = (idf && cvP.vec) ? cvP.vec : tfidfVec(cvP.tf, useIdf);
  const cos = cosine(tfidfVec(jdTf, useIdf), cvVec);

  // Bidirectional blend: qualification (coverage) + field-relevance (relevance) +
  // overall lexical similarity (cosine).
  const score = +(0.45 * coverage + 0.35 * relevance + 0.2 * cos).toFixed(4);
  const jdSurface = surfaceMap(jdText);
  const display = (stems) => stems.map((s) => jdSurface.get(s) || s);
  return {
    score,
    band: bandFor(score),
    coverage: +coverage.toFixed(4),
    relevance: +relevance.toFixed(4),
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

  // bands (calibrated floors: STRONGEST 0.52 · Very strong 0.45 · Strong 0.38 · Moderate 0.30)
  eq(bandFor(0.90), 'STRONGEST', 'band STRONGEST'); eq(bandFor(0.48), 'STRONGEST', 'band STRONGEST at floor');
  eq(bandFor(0.44), 'Very strong', 'band Very strong'); eq(bandFor(0.38), 'Strong', 'band Strong');
  eq(bandFor(0.30), 'Moderate', 'band Moderate'); eq(bandFor(0.1), 'Weak', 'band Weak');

  // fitScore: calibrated 0–10, monotonic, anchored to band floors
  eq(fitScore(0), 0, 'fit 0 → 0'); eq(fitScore(1), 10, 'fit 1 caps at 10');
  ok(fitScore(0.48) >= 8.4 && fitScore(0.48) <= 8.6, `fit at STRONGEST floor ≈ 8.5 (got ${fitScore(0.48)})`);
  ok(fitScore(0.50) > fitScore(0.40) && fitScore(0.40) > fitScore(0.30), 'fit is monotonic in raw score');
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
  ok(bandRank(strong.band) <= bandRank('Strong'), `well-matched JD reaches at least Strong (got ${strong.score} ${strong.band})`);
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
