#!/usr/bin/env node
// scripts/match-score.mjs — fast, deterministic CV ↔ JD match score + band.
//
// Powers the job-match board: scores how well the user's master CV fits a job
// posting WITHOUT spending tokens, so the board can rank many postings cheaply.
// (The agent's `evaluate` mode is the deep, judged score for the postings the
// user actually cares about — this is the cheap pre-rank.)
//
// SKILL- & EXPERIENCE-AWARE score (not bag-of-words). The old pure lexical blend
// rated a Node/React CV a "Very strong" fit for a Spring/Java job because both
// share generic full-stack vocabulary. This scorer instead asks: does the
// candidate have the role's PRIMARY build stack (its stack-defining skills), at
// real proficiency, with the years of experience the role wants?
//
//   base = 0.50*coreCoverage + 0.30*skillCoverage + 0.20*lexScore   (recognized)
//   score = base · combinedPenalty                                  (clamped [0,1])
// where coreCoverage is over the JD's REQUIRED stack-defining skills (proficiency-
// weighted, with same-family sibling credit), skillCoverage is over all JD skills
// (nice-to-haves at half weight), lexScore is the legacy TF-IDF blend (a backstop,
// blended in fully when the JD names no recognized skills so prose-heavy roles stay
// on the same scale), and combinedPenalty = max(0.40, min(stackConflict, expFit)) —
// a Node dev × Spring job is crushed; a 4-yr candidate × "8+ yrs senior" is damped;
// the two never compound. See lib/skills.mjs for recognition + experience parsing.
// Returns `have`/`gap` (matched / missing JD skills) and `reasons` (why).
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
import { cvSkills, jdSkills, familyMass, jdRequiredYears, candidateYears, isManagerialJd, functionFit } from '../lib/skills.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CV = join(ROOT, 'data', 'cv.master.md');

// Bands, best → worst. A score maps to the first band whose floor it clears.
// RE-CALIBRATED for the skill-aware score, whose realistic range is far wider than
// the old lexical blend's (~0.2–0.55): an in-field match where the candidate has
// the role's core stack now reaches ~0.85–0.95, a solid-but-partial fit ~0.55–0.70,
// and an off-stack job is driven down by the conflict penalty to ~0.05–0.25. These
// floors were derived from a histogram of the real board (data/jds/*) plus
// controlled fixtures so the bands actually discriminate. The five LABELS are kept
// (the web UI's CSS depends on them); only the floors moved. (Absolute fit still
// depends on how relevant the fetched jobs are — target the search to raise real
// matches, not just the label.)
export const BANDS = [
  ['STRONGEST', 0.78],
  ['Very strong', 0.62],
  ['Strong', 0.46],
  ['Moderate', 0.30],
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

// Calibrated 0–10 "fit" for DISPLAY, anchored to the NEW band floors so a STRONGEST
// match reads ~8.5–10 and the number is interpretable. Monotonic in the raw score,
// so it never changes the ranking. It is NOT a probability of getting hired.
const FIT_ANCHORS = [[0, 0], [0.15, 2], [0.30, 4], [0.46, 5.5], [0.62, 7], [0.78, 8.5], [0.90, 9.5], [1.0, 10]];
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
export function prepCv(cvText, { idf = null, topK = 24, profileYears = null, today = null } = {}) {
  const toks = normTokens(cvText);
  const tf = buildTf(toks);
  const skills = cvSkills(cvText);                 // proficiency-weighted recognized skills
  return {
    toks,
    set: new Set(toks),
    tf,
    keywords: keywordsFromToks(toks, topK),
    vec: idf ? tfidfVec(tf, idf) : null, // only valid against that same idf
    skills,
    famMass: familyMass(skills),                   // mass per ecosystem family
    candYears: candidateYears(cvText, { profileYears, today }),
  };
}

// ─── scoring tunables (all in one place so calibration is auditable) ──────────
const W_CORE = 0.50;   // weight on the role's PRIMARY-stack coverage (the discriminator)
const W_SKILL = 0.30;  // weight on overall recognized-skill coverage
const W_LEX = 0.20;    // weight on the legacy lexical blend (a backstop)
const MIN_SKILLS = 4;  // JD recognized-skill count for FULL skill-regime confidence
const SIBLING_CREDIT = 0.5;  // max core credit for a same-family substitute (Vue≈React)
const FAM_UNIT = 1.0;  // family-mass that counts as "solidly in this ecosystem"
const CORE_CUT = 0.5;  // coreCoverage below which a stack-conflict penalty can apply
const ALIGN_VETO = 0.6; // familyAlignment at/above which the conflict penalty is vetoed
const PENALTY_FLOOR = 0.45; // hardest stack-conflict multiplier (at coreCoverage 0)
const COMBINED_FLOOR = 0.25; // a single confident penalty can reach Weak; combine is min() (no compounding)
const LEX_FULL = 0.55; // lexScore value treated as "1.0" when rescaling the fallback

// The core: returns { score, band, coverage, relevance, cosine, coreCoverage,
// skillCoverage, have:[skill], gap:[skill], reasons:{...} }. Perf knobs (optional,
// results identical): `jdToks` = pre-tokenized JD; `cv` = a prepCv() object so the
// CV isn't re-recognized/re-vectorized per JD. `title`/`profileYears`/`today` feed
// the experience-fit multiplier (all optional — it stays neutral when unknown).
export function scoreMatch(jdText, cvText, { topK = 18, idf = null, cvKeywords = null, jdToks = null, cv = null, title = '', profileYears = null, today = null, targets = null } = {}) {
  const jdT = jdToks || normTokens(jdText);
  const cvP = cv || prepCv(cvText, { idf, topK: Math.max(topK, 24), profileYears, today });
  if (!jdT.length || !cvP.toks.length) {
    return { score: 0, band: 'Weak', coverage: 0, relevance: 0, cosine: 0, coreCoverage: 0, skillCoverage: 0, have: [], gap: [], keywords: [], reasons: {} };
  }

  // ── 1) legacy lexical blend (now a backstop, not the whole score) ──
  const cvSet = cvP.set;
  const jdSet = new Set(jdT);
  const keywords = keywordsFromToks(jdT, topK);
  const matchedKw = keywords.filter((k) => cvSet.has(k));
  const coverage = keywords.length ? matchedKw.length / keywords.length : 0;
  const cvKw = cvKeywords || cvP.keywords;
  const relevance = cvKw.length ? cvKw.filter((k) => jdSet.has(k)).length / cvKw.length : 0;
  const jdTf = buildTf(jdT);
  let useIdf = idf;
  if (!useIdf) { useIdf = emptyIdf(); indexAdd(useIdf, jdTf); indexAdd(useIdf, cvP.tf); }
  const cvVec = (idf && cvP.vec) ? cvP.vec : tfidfVec(cvP.tf, useIdf);
  const cos = cosine(tfidfVec(jdTf, useIdf), cvVec);
  const lexScore = 0.45 * coverage + 0.35 * relevance + 0.2 * cos;

  // ── 2) skill recognition: candidate (proficiency-weighted) vs JD (required/nice) ──
  const cvSk = cvP.skills;                  // Map canonical -> { family, stackDefining, weight }
  const cvFam = cvP.famMass;                // { family: summed weight }
  const jd = jdSkills(jdText);
  const R = jd.required, Nc = jd.nice, A = jd.all;

  // candidate's credit for a specific JD skill: exact match (proficiency weight) OR
  // a same-family substitute (a Vue dev gets partial credit toward a React ask).
  const credit = (canonical, family) => {
    const hit = cvSk.get(canonical);
    if (hit) return Math.min(1, hit.weight);
    const mass = cvFam[family] || 0;
    return mass > 0 ? Math.min(SIBLING_CREDIT, SIBLING_CREDIT * Math.min(1, mass / FAM_UNIT)) : 0;
  };

  // coreCoverage: over the JD's REQUIRED stack-defining skills only (per-JD core).
  const jdCore = [...R].filter(([, m]) => m.stackDefining).map(([c, m]) => ({ c, family: m.family }));
  const matchedCore = [], missingCore = [];
  let coreCoverage;
  if (jdCore.length) {
    let s = 0;
    for (const { c, family } of jdCore) { const cr = credit(c, family); s += cr; (cr >= 0.75 ? matchedCore : missingCore).push(c); }
    coreCoverage = s / jdCore.length;
  } else {
    coreCoverage = null; // no stack-defining requirement → neutral; set to skillCoverage below
  }

  // skillCoverage: all JD skills, required full weight, nice-to-have half weight.
  let num = 0, den = 0;
  for (const [c, m] of R) { num += credit(c, m.family); den += 1; }
  for (const [c, m] of Nc) { if (R.has(c)) continue; num += 0.5 * credit(c, m.family); den += 0.5; }
  const skillCoverage = den ? num / den : 0;
  if (coreCoverage === null) coreCoverage = skillCoverage;

  // ── 3) compose base; blend toward lexical as recognition confidence drops ──
  const conf = Math.min(1, A.size / MIN_SKILLS);          // 0 (no skills) → 1 (≥MIN_SKILLS)
  const lexScaled = Math.min(1, lexScore / LEX_FULL);     // legacy score on the SAME 0–1 scale
  const baseRecognized = W_CORE * coreCoverage + W_SKILL * skillCoverage + W_LEX * lexScore;
  let base = conf * baseRecognized + (1 - conf) * lexScaled;

  // ── 4) stack-conflict penalty: continuous ramp, family-MASS gated, align-vetoed ──
  let stackPenalty = 1, stackMismatch = null;
  if (jdCore.length) {
    const famCount = Object.create(null);
    for (const { family } of jdCore) famCount[family] = (famCount[family] || 0) + 1;
    const domFamily = Object.keys(famCount).sort((a, b) => famCount[b] - famCount[a])[0];
    const candDomMass = cvFam[domFamily] || 0;
    // familyAlignment: graded share of the JD core whose family the candidate is in.
    let align = 0;
    for (const { family } of jdCore) align += Math.min(1, (cvFam[family] || 0) / FAM_UNIT);
    align /= jdCore.length;
    // Fires only when the candidate is genuinely OUT of the dominant ecosystem
    // (low core coverage AND little mass in that family AND low overall alignment).
    if (coreCoverage < CORE_CUT && candDomMass < FAM_UNIT && align < ALIGN_VETO) {
      stackPenalty = Math.max(PENALTY_FLOOR, Math.min(1, PENALTY_FLOOR + (1 - PENALTY_FLOOR) * (coreCoverage / CORE_CUT)));
      stackMismatch = { family: domFamily, missing: missingCore.slice(0, 4) };
    }
  }

  // ── 5) experience-fit multiplier: neutral when unknown, but BITES on a confident gap ──
  const reqY = jdRequiredYears(jdText, title);
  const candY = cvP.candYears;
  const managerial = isManagerialJd(title, jdText);
  let expFit = 1, expNote = 'unverified';
  if (candY.confident) {
    const bar = Math.max(0, reqY.years);
    if (reqY.confident && bar > 1 && candY.years < bar) {
      // under-experienced: ramp scaled to the gap. A modest gap (1.5y vs 3y) stays
      // reachable (~0.64); a large gap (1.5y vs 8y) is damped (~0.46) — and a manager
      // / senior-leadership role is capped harder below. Egregious gaps don't bury the
      // board wholesale, but they can't read STRONGEST either.
      const ratio = candY.years / bar;
      expFit = Math.max(0.3, Math.min(1, 0.35 + 0.55 * ratio));
      expNote = `~${candY.years}y vs ${bar}+y wanted`;
    } else if (reqY.confident && bar > 1) {
      expNote = `meets ${bar}+y`;
    } else if (reqY.confident && bar <= 1) {
      if (candY.years >= 6 && !managerial) { expFit = 0.92; expNote = `overqualified (~${candY.years}y, entry role)`; }
      else expNote = 'entry-level';
    }
    // A people-management / senior-leadership role is years of seniority away from a
    // junior IC even when the technical skills match — cap it hard.
    if (managerial && candY.years < 3) {
      expFit = Math.min(expFit, 0.3);
      expNote = expNote === 'unverified' ? `management role vs ~${candY.years}y exp` : `${expNote} · mgmt role`;
    }
  }

  // ── 5b) job-function fit: a role that shares the candidate's TOOLS but is a
  // different FUNCTION than their target roles (e.g. a Reliability Engineer using
  // Python/SQL/ML for a Data Scientist) is damped. Neutral when no profile/targets. ──
  const fn = functionFit(title, targets);

  // ── 6) combine WITHOUT compounding (single worst penalty, floored), then clamp ──
  const combined = Math.max(COMBINED_FLOOR, Math.min(stackPenalty, expFit, fn.fit));
  let score = base * combined;
  score = Number.isFinite(score) ? +Math.max(0, Math.min(1, score)).toFixed(4) : 0;

  // thin JD (almost no recognized skills) → don't emit a confident top band.
  const thin = A.size < 2;
  let band = bandFor(score);
  if (thin && bandRank(band) < bandRank('Moderate')) band = 'Moderate';

  // ── display: matched / missing JD skills (skill-based have/gap), with lexical fallback ──
  const jdSurface = surfaceMap(jdText);
  const display = (stems) => stems.map((s) => jdSurface.get(s) || s);
  const allJd = [...A.keys()];
  const have = allJd.filter((c) => credit(c, A.get(c).family) >= 0.75);
  const gap = allJd.filter((c) => credit(c, A.get(c).family) < 0.3);
  return {
    score,
    band,
    coverage: +coverage.toFixed(4),
    relevance: +relevance.toFixed(4),
    cosine: +cos.toFixed(4),
    coreCoverage: +coreCoverage.toFixed(4),
    skillCoverage: +skillCoverage.toFixed(4),
    // skill-based have/gap when the JD names skills; else fall back to keyword overlap.
    have: A.size ? have : display(matchedKw),
    gap: A.size ? gap : display(keywords.filter((k) => !cvSet.has(k))),
    keywords: A.size ? allJd : display(keywords),
    reasons: {
      matchedCore, missingCore, stackMismatch,
      experience: { required: reqY.years, candidate: candY.confident ? candY.years : null, note: expNote, multiplier: +expFit.toFixed(3) },
      functionMismatch: fn.onTarget ? null : true,
      stackPenalty: +stackPenalty.toFixed(3),
      confidence: +conf.toFixed(2),
    },
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

  // bands (re-calibrated floors: STRONGEST 0.78 · Very strong 0.62 · Strong 0.46 · Moderate 0.30)
  eq(bandFor(0.90), 'STRONGEST', 'band STRONGEST'); eq(bandFor(0.78), 'STRONGEST', 'band STRONGEST at floor');
  eq(bandFor(0.70), 'Very strong', 'band Very strong'); eq(bandFor(0.50), 'Strong', 'band Strong');
  eq(bandFor(0.30), 'Moderate', 'band Moderate'); eq(bandFor(0.1), 'Weak', 'band Weak');

  // fitScore: calibrated 0–10, monotonic, anchored to the new band floors
  eq(fitScore(0), 0, 'fit 0 → 0'); eq(fitScore(1), 10, 'fit 1 caps at 10');
  ok(fitScore(0.78) >= 8.4 && fitScore(0.78) <= 8.6, `fit at STRONGEST floor ≈ 8.5 (got ${fitScore(0.78)})`);
  ok(fitScore(0.80) > fitScore(0.60) && fitScore(0.60) > fitScore(0.40), 'fit is monotonic in raw score');
  ok(bandRank('STRONGEST') < bandRank('Strong') && bandRank('Strong') < bandRank('Weak'), 'bandRank orders best→worst');

  // jdKeywords surfaces the salient terms (lexical layer unchanged)
  const kws = jdKeywords('We need Python, Airflow and Kubernetes. Python Python.', 5);
  ok(kws.includes(stem('python')), 'jdKeywords includes repeated salient term');

  // ── THE HEADLINE FIX: a Node/React CV must rank a Node JD FAR above a Spring/Java JD ──
  const nodeCv = ['## Skills', '- React, Redux, TypeScript, Node.js, Express, NestJS, MongoDB, Docker, Kubernetes, AWS',
    '## Experience', '### Acme — Senior Full Stack Developer — 2021 – Present',
    '- Built React + TypeScript SPAs and Node.js/Express REST APIs; deployed on AWS with Docker.'].join('\n');
  const nodeJd = 'Full Stack Developer (Node.js / React). Build REST APIs in Node.js and Express and React/TypeScript frontends. MongoDB, Docker, Kubernetes, AWS. 3+ years.';
  const springJd = 'Java Full Stack Developer (Spring Boot). Build REST APIs in Java with Spring Boot, Hibernate and JPA, frontends in Angular. Microservices, Docker, Kubernetes, AWS, PostgreSQL. Senior, 8+ years.';
  const onNode = scoreMatch(nodeJd, nodeCv, { title: 'Full Stack Developer' });
  const onSpring = scoreMatch(springJd, nodeCv, { title: 'Java Full Stack Developer' });
  eq(onNode.band, 'STRONGEST', `Node CV × Node JD is STRONGEST (got ${onNode.score} ${onNode.band})`);
  ok(bandRank(onSpring.band) >= bandRank('Moderate'), `Node CV × Spring JD lands Moderate-or-Weak, NOT Very strong (got ${onSpring.score} ${onSpring.band})`);
  ok(onNode.score - onSpring.score > 0.4, `huge separation between right and wrong stack (${onNode.score} vs ${onSpring.score})`);
  ok(onSpring.reasons.stackMismatch && onSpring.reasons.stackMismatch.family === 'java-jvm', 'Spring mismatch flags the java-jvm stack conflict');
  ok(onSpring.reasons.missingCore.includes('Spring Boot') && onSpring.reasons.missingCore.includes('Java'), 'missingCore lists the unmet core stack');
  ok(onNode.reasons.matchedCore.includes('React') && onNode.reasons.matchedCore.includes('Node.js'), 'matchedCore lists the met core stack');

  // proficiency / polyglot: a CV that only LISTS the stack (no real experience) must NOT
  // score like a specialist who BUILT with it.
  const polyglotCv = ['## Skills', '- Python, pandas, PyTorch, Java, Spring Boot',
    '## Experience', '### DataCo — Data Scientist — 2020 – Present', '- Built ML models in Python with PyTorch and pandas.'].join('\n');
  const realSpringCv = ['## Skills', '- Java, Spring Boot, Hibernate',
    '## Experience', '### BankCo — Backend Engineer — 2018 – Present', '- Built microservices in Java with Spring Boot and Hibernate; designed JPA schemas.'].join('\n');
  const polyOnSpring = scoreMatch(springJd, polyglotCv, { title: 'Java Full Stack Developer' });
  const realOnSpring = scoreMatch(springJd, realSpringCv, { title: 'Java Full Stack Developer' });
  ok(realOnSpring.score > polyOnSpring.score, `a real Spring engineer outranks a Python dev who merely lists Spring (${realOnSpring.score} > ${polyOnSpring.score})`);

  // required vs nice-to-have: a "React a plus" line on a DS JD must not make a React dev a top fit
  const dsJd = 'Senior Data Scientist. Required: Python, PyTorch, machine learning. Nice to have: exposure to React and some Node.js. 5+ years.';
  const dsCv = '## Skills\n- Python, PyTorch, scikit-learn, pandas, SQL\n## Experience\n### X — Data Scientist — 2018 – Present\n- ML in Python with PyTorch.';
  ok(scoreMatch(dsJd, dsCv, { title: 'Senior Data Scientist' }).score > scoreMatch(dsJd, nodeCv, { title: 'Senior Data Scientist' }).score,
    'a data scientist outranks a React dev for a DS role (React is only nice-to-have)');

  // experience multiplier: damps an under-experienced candidate; neutral when unknown
  const seniorJd = 'Senior Engineer, 8+ years. Build React and Node.js apps.';
  const juniorCv = '## Experience\n### Y — React Developer — 2024 – Present\n- React and Node.js.\n## Skills\n- React, Node.js, TypeScript';
  const expR = scoreMatch(seniorJd, juniorCv, { title: 'Senior Engineer', today: '2026-06-13' });
  ok(expR.reasons.experience.multiplier < 1, 'under-experienced candidate gets an experience damp');
  eq(scoreMatch('Build React apps with Node.js.', nodeCv).reasons.experience.note, 'unverified', 'experience neutral when no years stated');

  // ── REGRESSION: 8+ year MANAGER role (Indeed-escaped) must NOT be a strong match for a junior ──
  const jrDsCv = '## Skills\n- Python, pandas, scikit-learn, SQL, machine learning\n## Experience\n### Co — Data Analyst — 01/2023 – 06/2024\n- Built ML models in Python with scikit-learn.';
  const mgrJd = 'Manager, Data Science. 8\\+ years of experience in data science, with 3\\+ years in a people management role. Lead and manage a team. Python, machine learning, SQL.';
  const entryDsJd = 'Data Scientist (Entry). 0-2 years experience. Python, machine learning, SQL.';
  const onMgr = scoreMatch(mgrJd, jrDsCv, { title: 'Manager, Data Science', today: '2026-06-14' });
  const onEntry = scoreMatch(entryDsJd, jrDsCv, { title: 'Data Scientist', today: '2026-06-14' });
  eq(onMgr.reasons.experience.required, 8, 'parses "8\\+ years" despite Indeed backslash-escaping (the WAVE-Manager bug)');
  ok(bandRank(onMgr.band) >= bandRank('Moderate'), `8+y manager role is Weak/Moderate for a junior, not STRONGEST (got ${onMgr.score} ${onMgr.band})`);
  ok(onEntry.score - onMgr.score > 0.3, `entry DS role ranks far above the 8+y manager role for a junior (${onEntry.score} vs ${onMgr.score})`);

  // degenerate inputs are finite + safe
  eq(scoreMatch('', nodeCv).score, 0, 'empty JD → 0'); eq(scoreMatch(nodeJd, '').score, 0, 'empty CV → 0');
  ok(Number.isFinite(scoreMatch('We value teamwork and growth.', nodeCv).score), 'pure-prose JD yields a finite score');
  const thin = scoreMatch('React.', nodeCv);
  ok(bandRank(thin.band) >= bandRank('Moderate'), 'a one-skill JD is capped (no confident STRONGEST off one token)');

  // identical text still tops out; off-domain prose stays low
  ok(scoreMatch(nodeCv, nodeCv).score >= 0.85, `identical CV/JD scores STRONGEST (got ${scoreMatch(nodeCv, nodeCv).score})`);
  ok(scoreMatch('Seeking a florist with floral design and customer service skills.', nodeCv).score < 0.4, 'unrelated JD scores low');

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
