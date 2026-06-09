#!/usr/bin/env node
// scripts/gaps.mjs — skill-gap roadmap across the whole board (zero tokens).
//
// The board scores each posting and lists, per job, the skills you HAVE vs the
// GAPS. This aggregates those gaps across EVERY open role you're tracking and
// answers the question the per-job view can't: "which ONE skill, if I learned it,
// would unlock the most roles?" It ranks missing skills by how many postings ask
// for them — and, crucially, weights the ones that show up in roles you're already
// close on (Moderate/Strong), because those are the realistic unlocks.
//
// Pipeline-compatible with board.mjs: it reads the same saved JDs (data/jds/*.md)
// and scores with the same match-score engine, so the gap list is consistent with
// what the board shows.
//
// Usage:
//   node scripts/gaps.mjs                     # roadmap from data/jds/* vs your CV
//   node scripts/gaps.mjs --top 15            # show the top N skills (default 20)
//   node scripts/gaps.mjs --min-jobs 2        # only skills wanted by >= N roles
//   node scripts/gaps.mjs --summary           # human report (default: JSON)
//   node scripts/gaps.mjs --self-test

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { scoreMatch, jdKeywords, buildCorpusIdf, bandRank } from './match-score.mjs';
import { parseJdMarkdown } from './board.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CV_PATH = join(ROOT, 'data', 'cv.master.md');
const JDS_DIR = join(ROOT, 'data', 'jds');

// A gap appearing in a job you're CLOSE on is a more valuable unlock than one in a
// job you're far from — so weight each occurrence by the job's band. (STRONGEST is
// already a fit; the sweet spot is the near-misses one skill could lift.)
const BAND_WEIGHT = { STRONGEST: 0.5, 'Very strong': 1.5, Strong: 2, Moderate: 1.5, Weak: 0.5 };

// ─── pure core (exported for --self-test) ─────────────────────────────

// Given scored postings [{ company, role, band, gap:[skill] }], aggregate the gaps
// into a ranked roadmap. Returns [{ skill, jobs, weight, bands, examples }].
export function buildRoadmap(scored, { top = 20, minJobs = 1 } = {}) {
  const bySkill = new Map();
  for (const job of scored) {
    for (const raw of job.gap || []) {
      const skill = String(raw).trim();
      if (!skill) continue;
      const key = skill.toLowerCase();
      if (!bySkill.has(key)) bySkill.set(key, { skill, jobs: 0, weight: 0, bands: {}, examples: [] });
      const e = bySkill.get(key);
      e.jobs += 1;
      e.weight += BAND_WEIGHT[job.band] ?? 1;
      e.bands[job.band] = (e.bands[job.band] || 0) + 1;
      if (e.examples.length < 5) e.examples.push({ company: job.company || '?', role: job.role || '?', band: job.band });
    }
  }
  return [...bySkill.values()]
    .filter((e) => e.jobs >= minJobs)
    .map((e) => ({ ...e, weight: +e.weight.toFixed(2) }))
    // rank by weighted impact, then raw job count, then alphabetical for stability
    .sort((a, b) => (b.weight - a.weight) || (b.jobs - a.jobs) || (a.skill < b.skill ? -1 : 1))
    .slice(0, Math.max(0, top));
}

// Score saved postings against the CV → [{ company, role, band, score, gap }].
export function scorePostings(candidates, cv) {
  const cvKw = jdKeywords(cv, 24);
  const corpusIdf = buildCorpusIdf([...candidates.map((c) => c.content || ''), cv]);
  return candidates
    .filter((c) => (c.content || '').trim())
    .map((c) => {
      const s = scoreMatch(c.content || '', cv, { idf: corpusIdf, cvKeywords: cvKw });
      return { company: c.company, role: c.role, band: s.band, score: s.score, have: s.have, gap: s.gap };
    });
}

// ─── I/O ──────────────────────────────────────────────────────────────
function readSavedJds() {
  if (!existsSync(JDS_DIR)) return [];
  return readdirSync(JDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseJdMarkdown(readFileSync(join(JDS_DIR, f), 'utf8')))
    .filter((p) => p.content);
}

export function roadmap(cv, candidates, opts = {}) {
  const scored = scorePostings(candidates, cv);
  const skills = buildRoadmap(scored, opts);
  return {
    ok: true,
    jobs_considered: scored.length,
    bands: scored.reduce((m, j) => ((m[j.band] = (m[j.band] || 0) + 1), m), {}),
    skills,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { top: 20, minJobs: 1, json: true, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (a === '--top') out.top = parseInt(val(), 10) || 20;
    else if (a.startsWith('--top=')) out.top = parseInt(a.slice(6), 10) || 20;
    else if (a === '--min-jobs') out.minJobs = parseInt(val(), 10) || 1;
    else if (a.startsWith('--min-jobs=')) out.minJobs = parseInt(a.slice(11), 10) || 1;
  }
  return out;
}

const USAGE = `gaps — skill-gap roadmap: which skill unlocks the most roles.
Usage: node scripts/gaps.mjs [--top N] [--min-jobs N] [--summary]
  --top N        show the top N skills (default 20)
  --min-jobs N   only skills wanted by at least N roles (default 1)
  --summary      human-readable report (default: JSON)
  --self-test    run built-in tests`;

function printSummary(r) {
  const bandStr = Object.entries(r.bands).map(([b, n]) => `${b}:${n}`).join('  ') || '—';
  console.log(`CareerOS — skill-gap roadmap   (${r.jobs_considered} roles · ${bandStr})`);
  console.log('');
  if (!r.skills.length) {
    console.log('  No gaps found — either no saved postings, or your CV already covers them.');
    console.log('  Run `/cos hunt` or `/cos scan` to fill the board first.');
    return;
  }
  console.log('  Learn these to unlock the most roles:');
  r.skills.forEach((s, i) => {
    const near = (s.bands['Strong'] || 0) + (s.bands['Very strong'] || 0) + (s.bands['Moderate'] || 0);
    const nearStr = near ? `, ${near} you're close on` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${s.skill.padEnd(20)} wanted by ${s.jobs} role${s.jobs === 1 ? '' : 's'}${nearStr}`);
    const ex = s.examples.slice(0, 3).map((e) => `${e.company} (${e.band})`).join(', ');
    if (ex) console.log(`        e.g. ${ex}`);
  });
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();
  if (!existsSync(CV_PATH)) {
    const msg = 'data/cv.master.md not found — run /cos onboard first.';
    if (args.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(`error: ${msg}`);
    process.exit(2);
  }
  const cv = readFileSync(CV_PATH, 'utf8');
  const res = roadmap(cv, readSavedJds(), { top: args.top, minJobs: args.minJobs });
  if (args.json) console.log(JSON.stringify(res, null, 2));
  else printSummary(res);
  process.exit(0);
}

// ─── self-test ───────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // buildRoadmap aggregates + ranks. Kubernetes appears in 3 jobs (incl. a Strong
  // near-miss), Rust in 1 weak → Kubernetes must rank first.
  const scored = [
    { company: 'A', role: 'r', band: 'Strong', gap: ['Kubernetes', 'Terraform'] },
    { company: 'B', role: 'r', band: 'Moderate', gap: ['Kubernetes', 'Go'] },
    { company: 'C', role: 'r', band: 'Very strong', gap: ['Kubernetes'] },
    { company: 'D', role: 'r', band: 'Weak', gap: ['Rust'] },
  ];
  const rm = buildRoadmap(scored, { top: 10 });
  eq(rm[0].skill, 'Kubernetes', 'most-demanded skill ranks first');
  eq(rm[0].jobs, 3, 'Kubernetes counted in 3 jobs');
  ok(rm[0].weight > rm.find((s) => s.skill === 'Rust').weight, 'weighted impact beats a lone weak-job gap');
  ok(rm[0].examples.length === 3, 'examples captured per skill');

  // case-insensitive de-dup of the same skill
  const dup = buildRoadmap([
    { company: 'A', role: 'r', band: 'Strong', gap: ['SQL'] },
    { company: 'B', role: 'r', band: 'Strong', gap: ['sql'] },
  ], {});
  eq(dup.length, 1, 'same skill in different case merges to one');
  eq(dup[0].jobs, 2, 'merged skill counts both jobs');

  // minJobs filter + top cap
  eq(buildRoadmap(scored, { minJobs: 2 }).length, 1, 'minJobs=2 keeps only Kubernetes');
  eq(buildRoadmap(scored, { top: 2 }).length, 2, 'top caps the list');
  eq(buildRoadmap([], {}).length, 0, 'no postings → empty roadmap');

  // scorePostings + roadmap end-to-end against a tiny CV/JD set
  const cv = 'Built data pipelines in Python and SQL; ETL on AWS.';
  const cands = [
    { company: 'Acme', role: 'Data Engineer', content: 'Need Python, SQL, Airflow, Kubernetes for data pipelines on AWS.' },
    { company: 'Globex', role: 'ML Engineer', content: 'Python, Airflow, Spark and Kubernetes for ML pipelines.' },
    { company: 'Empty', role: 'x', content: '' }, // skipped (no content)
  ];
  const r = roadmap(cv, cands, { top: 10 });
  eq(r.jobs_considered, 2, 'roadmap skips the empty-content posting');
  ok(r.skills.some((s) => /airflow/i.test(s.skill)) && r.skills.some((s) => /kubernet/i.test(s.skill)),
    'roadmap surfaces real gaps (Airflow, Kubernetes) across both jobs');
  ok(r.skills.find((s) => /kubernet|airflow/i.test(s.skill)).jobs === 2, 'a gap in both jobs is counted twice');

  console.log(`gaps self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`gaps self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main();
  }
}
