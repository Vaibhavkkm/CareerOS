#!/usr/bin/env node
// scripts/cv-lint.mjs — deterministic CV bullet quality linter (zero tokens).
//
// Flags the weak spots in a CV's experience bullets BEFORE the agent tailors —
// the mechanical half of "CV quality checks" that README lists as partly manual.
// It does NOT rewrite (that's the agent's job, grounded in the real facts); it
// SCORES each bullet and points at exactly what's soft, so a human or the agent
// can fix it. Every rule reuses lib/text.mjs so a flag here is the SAME signal the
// learning loop teaches against (FILLER / BANNED_VERBS / quantSignals).
//
// Checks per bullet:
//   • not-quantified  — no number/%/currency/×/time-range (quantSignals.any)
//   • weak-verb       — opens with a banned/weak verb (worked, helped, …) or a non-verb
//   • passive-voice   — "was/were/been <past-participle>" (ownership-hiding)
//   • filler          — buzzwords/padding (FILLER list)
//   • too-long        — > 32 words (a bullet, not a paragraph)
//   • too-short       — < 4 words (not a real accomplishment)
//
// Usage:
//   node scripts/cv-lint.mjs                       # lint data/cv.master.md
//   node scripts/cv-lint.mjs --cv <file|text>      # lint a specific CV
//   node scripts/cv-lint.mjs --min-score 70        # exit 1 if overall score below
//   node scripts/cv-lint.mjs --summary             # human report (default: JSON)
//   node scripts/cv-lint.mjs --self-test

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { words, firstVerb, stem, quantSignals, fillerHits, bannedVerbHits } from '../lib/text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CV = join(ROOT, 'data', 'cv.master.md');

// Words that legitimately OPEN a strong bullet but the stemmer/firstVerb might not
// see as a verb form; treated as acceptable openers so we don't false-flag them.
const STRONG_OPENERS = new Set(
  ['led', 'built', 'shipped', 'drove', 'grew', 'cut', 'saved', 'won', 'ran', 'set',
   'launched', 'created', 'designed', 'developed', 'delivered', 'owned', 'scaled',
   'reduced', 'increased', 'improved', 'automated', 'architected', 'founded',
   'spearheaded', 'mentored', 'negotiated'].map(stem),
);
// A non-verb opener (the bullet starts with a noun/adjective like "Responsible…",
// "Various…") is itself a weakness — strong bullets lead with an action verb.
const NON_VERB_OPENERS = new Set(
  ['responsible', 'various', 'numerous', 'several', 'duties', 'tasks', 'key', 'core',
   'proven', 'skilled', 'experienced', 'hardworking', 'motivated'].map(stem),
);

// Irregular past participles that don't end in -ed (for passive-voice detection).
const PARTICIPLES = new Set([
  'done', 'made', 'built', 'given', 'taken', 'written', 'run', 'led', 'kept', 'held',
  'set', 'put', 'sent', 'brought', 'driven', 'grown', 'shown', 'known', 'seen', 'left',
]);

// ─── pure helpers (exported for --self-test) ──────────────────────────

// Pull experience-style bullet lines out of a markdown CV: "- …", "* …", "• …".
// Skips sub-bullets that are pure skill lists / headers and very short fragments.
export function extractBullets(cvText) {
  const out = [];
  for (const raw of String(cvText || '').split('\n')) {
    const m = raw.match(/^\s*[-*•]\s+(.*\S)\s*$/);
    if (!m) continue;
    const text = m[1].trim();
    // Skip "Skills: …" / "Languages: …" inventory lines — they aren't accomplishments.
    if (/^[A-Z][\w /&-]{0,24}:\s/.test(text) && /[,;]/.test(text)) continue;
    if (words(text).length < 2) continue;
    out.push(text);
  }
  return out;
}

// Detect "was/were/is/are/been <past-participle>" passive constructions.
export function isPassive(text) {
  const ws = words(text);
  for (let i = 0; i < ws.length - 1; i++) {
    if (/^(was|were|is|are|been|being|be)$/.test(ws[i])) {
      const nxt = ws[i + 1];
      // "<be> responsible" is weak but caught by weak-verb; here require a participle.
      if (/ed$/.test(nxt) && nxt.length > 3) return true;
      if (PARTICIPLES.has(nxt)) return true;
    }
  }
  return false;
}

// Lint ONE bullet → { text, issues:[...], score } (0–100, higher = stronger).
export function lintBullet(text) {
  const issues = [];
  const ws = words(text);
  const n = ws.length;

  if (!quantSignals(text).any) issues.push({ rule: 'not-quantified', hint: 'add a number, %, $, ×, or timeframe' });

  const opener = firstVerb(text);
  const banned = bannedVerbHits(text);
  if (NON_VERB_OPENERS.has(opener)) {
    issues.push({ rule: 'weak-verb', hint: `opens with a non-action word ("${ws[0]}") — lead with a verb` });
  } else if (banned.length && (banned.includes(ws[0]?.toLowerCase()) || NON_VERB_OPENERS.has(stem(ws[0] || '')))) {
    issues.push({ rule: 'weak-verb', hint: `weak opener "${ws[0]}" — use a strong action verb` });
  } else if (banned.length) {
    issues.push({ rule: 'weak-verb', hint: `weak verb(s): ${banned.join(', ')}` });
  }

  if (isPassive(text)) issues.push({ rule: 'passive-voice', hint: 'rewrite in active voice — own the action' });

  const filler = fillerHits(text);
  if (filler.length) issues.push({ rule: 'filler', hint: `cut filler: ${filler.join(', ')}` });

  if (n > 32) issues.push({ rule: 'too-long', hint: `${n} words — split or tighten (aim ≤ 24)` });
  else if (n < 4) issues.push({ rule: 'too-short', hint: `${n} words — too thin to be an accomplishment` });

  // Score: start at 100, subtract a weighted penalty per issue, floor at 0.
  const WEIGHT = { 'not-quantified': 22, 'weak-verb': 20, 'passive-voice': 18, filler: 12, 'too-long': 10, 'too-short': 16 };
  const penalty = issues.reduce((s, it) => s + (WEIGHT[it.rule] || 10), 0);
  const score = Math.max(0, 100 - penalty);
  return { text, issues, score };
}

// Lint a whole CV → { score, bullets:[...], counts, weakest:[...] }.
export function lintCv(cvText) {
  const bullets = extractBullets(cvText).map(lintBullet);
  const counts = {};
  for (const b of bullets) for (const it of b.issues) counts[it.rule] = (counts[it.rule] || 0) + 1;
  const score = bullets.length
    ? Math.round(bullets.reduce((s, b) => s + b.score, 0) / bullets.length)
    : 0;
  const weakest = bullets
    .filter((b) => b.issues.length)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);
  return {
    score,
    total: bullets.length,
    clean: bullets.filter((b) => !b.issues.length).length,
    flagged: bullets.filter((b) => b.issues.length).length,
    counts,
    bullets,
    weakest,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { cv: null, json: true, selfTest: false, minScore: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (a === '--cv') out.cv = val();
    else if (a.startsWith('--cv=')) out.cv = a.slice(5);
    else if (a === '--min-score') out.minScore = parseInt(val(), 10);
    else if (a.startsWith('--min-score=')) out.minScore = parseInt(a.slice(12), 10);
  }
  return out;
}
function readArg(v, fallback) {
  if (!v) return fallback != null && existsSync(fallback) ? readFileSync(fallback, 'utf8') : '';
  if (existsSync(v)) return readFileSync(v, 'utf8');
  return String(v);
}

const USAGE = `cv-lint — flag weak CV bullets (un-quantified, weak-verb, passive, filler).
Usage: node scripts/cv-lint.mjs [--cv <file|text>] [--min-score N] [--summary]
  --cv         a CV file path OR literal text (default: data/cv.master.md)
  --min-score  exit 1 if the overall score is below N (for CI / gates)
  --summary    human-readable report (default: JSON)
  --self-test  run built-in tests`;

function printSummary(r) {
  console.log(`CareerOS — CV bullet lint   score ${r.score}/100   (${r.clean}/${r.total} bullets clean)`);
  if (Object.keys(r.counts).length) {
    console.log('');
    console.log('  issues found:');
    for (const [rule, n] of Object.entries(r.counts).sort((a, b) => b[1] - a[1])) {
      console.log(`    · ${rule.padEnd(16)} ${n}`);
    }
  }
  if (r.weakest.length) {
    console.log('');
    console.log('  weakest bullets:');
    for (const b of r.weakest) {
      const snip = b.text.length > 78 ? b.text.slice(0, 75) + '…' : b.text;
      console.log(`    [${String(b.score).padStart(3)}] ${snip}`);
      for (const it of b.issues) console.log(`          → ${it.rule}: ${it.hint}`);
    }
  }
  if (!r.total) console.log('  No bullet lines found. Is this a CV with "- " bullets?');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();
  const cv = readArg(args.cv, DEFAULT_CV);
  if (!cv) { console.error(`error: no CV (pass --cv <file|text> or create ${DEFAULT_CV})`); process.exit(2); }
  const res = lintCv(cv);
  if (args.json) console.log(JSON.stringify(res, null, 2));
  else printSummary(res);
  if (args.minScore != null && res.score < args.minScore) process.exit(1);
  process.exit(0);
}

// ─── self-test ───────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
  const has = (b, rule) => b.issues.some((it) => it.rule === rule);

  // extractBullets pulls bullet lines, skips skill-inventory lines
  const cv = [
    '# Experience', '',
    '## Acme — Engineer',
    '- Built a data pipeline in Python that cut nightly load time by 40%.',
    '- Responsible for various reporting tasks and helped the team.',
    '- Was promoted to lead after delivering the migration.',
    '- Led a team of 6 engineers, shipping 3 products in 12 months.',
    '- Skills: Python, SQL, Airflow, dbt, Spark, Kafka, AWS',
    '- Ran it.',
  ].join('\n');
  const bullets = extractBullets(cv);
  ok(bullets.length === 5, `extractBullets finds the 5 real bullets (got ${bullets.length})`);
  ok(!bullets.some((b) => /^Skills:/.test(b)), 'extractBullets skips the Skills inventory line');

  // a strong, quantified, active bullet scores high with no issues
  const strong = lintBullet('Built a data pipeline in Python that cut nightly load time by 40%.');
  ok(strong.score >= 85, `strong bullet scores high (got ${strong.score})`);
  ok(strong.issues.length === 0, 'strong bullet has no issues');

  // weak verb + filler + non-verb opener
  const weak = lintBullet('Responsible for various reporting tasks and helped the team.');
  ok(has(weak, 'weak-verb'), 'flags non-verb / weak opener');
  ok(has(weak, 'filler'), 'flags filler ("various")');
  ok(has(weak, 'not-quantified'), 'flags missing quantification');
  ok(weak.score < strong.score, 'weak bullet scores below strong');

  // passive voice
  ok(isPassive('Was promoted to lead after delivering the migration.'), 'isPassive: was promoted');
  ok(isPassive('The system was built by the team.'), 'isPassive: was built');
  ok(!isPassive('Built the system for the team.'), 'isPassive: active not flagged');
  ok(has(lintBullet('Was promoted to lead after delivering the migration.'), 'passive-voice'), 'lint flags passive');

  // quantified, active, strong opener → no not-quantified, no weak-verb
  const led = lintBullet('Led a team of 6 engineers, shipping 3 products in 12 months.');
  ok(!has(led, 'not-quantified'), 'quantified bullet not flagged for numbers');
  ok(!has(led, 'weak-verb'), 'strong opener "Led" not flagged');

  // too-short
  ok(has(lintBullet('Ran it.'), 'too-short'), 'flags too-short bullet');
  // too-long
  const longB = lintBullet('Built ' + 'word '.repeat(40) + 'thing in 2024.');
  ok(has(longB, 'too-long'), 'flags too-long bullet');

  // whole-CV roll-up
  const r = lintCv(cv);
  eq(r.total, 5, 'lintCv counts 5 bullets');
  ok(r.score > 0 && r.score < 100, `overall score in range (got ${r.score})`);
  ok(r.weakest[0].score <= r.weakest[r.weakest.length - 1].score, 'weakest sorted ascending by score');
  ok(r.counts['not-quantified'] >= 2, 'counts aggregates the not-quantified rule');

  // empty input is safe
  eq(lintCv('').total, 0, 'empty CV → 0 bullets'); eq(lintCv('').score, 0, 'empty CV → score 0');

  console.log(`cv-lint self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`cv-lint self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main();
  }
}
