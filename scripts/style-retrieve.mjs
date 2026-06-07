#!/usr/bin/env node
// scripts/style-retrieve.mjs — Algorithm C: pull the most relevant past-accepted
// bullets/paras to ground a new draft in the user's real voice.
//
// Usage:
//   node scripts/style-retrieve.mjs --jd <file|text> --archetype X --skills a,b \
//        --kind cv|cl [--k 6] [--dir <style-dir>] [--json]
//   node scripts/style-retrieve.mjs --self-test
//
// Builds a query bag from JD + role + skills (lib/text.stemTokens), scores
// examples.jsonl by TF-IDF cosine (lib/tfidf, using idf.json) plus boosts
// (archetype match *1.5, skill Jaccard *1.3, recency tiebreak), then applies
// MMR (lambda 0.7) so the picks aren't near-duplicates. Cold start (empty bank)
// returns { results: [] }.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { stemTokens, jaccard } from '../lib/text.mjs';
import { buildTf, emptyIdf, tfidfVec, cosine } from '../lib/tfidf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STYLE_DIR = join(ROOT, 'data', 'style');

const ARCH_BOOST = 1.5;
const SKILL_BOOST = 1.3;
const MMR_LAMBDA = 0.7;

// ---------- arg parsing ----------
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next != null && !next.startsWith('--')) { out.flags[key] = next; i++; }
        else out.flags[key] = true;
      }
    } else out._.push(a);
  }
  return out;
}

// ---------- load the bank ----------
export function loadExamples(styleDir) {
  const p = join(styleDir, 'examples.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function loadIdf(styleDir) {
  const p = join(styleDir, 'idf.json');
  if (!existsSync(p)) return emptyIdf();
  const obj = JSON.parse(readFileSync(p, 'utf8'));
  if (!obj.df) obj.df = {};
  if (obj.N == null) obj.N = 0;
  return obj;
}

// ---------- query construction ----------
// JD text + role + skills => a stemmed query bag (TF). Skills are repeated so
// they weigh a little more in the raw term frequency.
export function buildQuery({ jd = '', role = '', skills = [] }) {
  const parts = [jd, jd, role]; // jd twice: it's the primary signal
  for (const s of skills) parts.push(s, s); // emphasize skills
  const text = parts.join(' \n ');
  const toks = stemTokens(text);
  return { tokens: toks, tf: buildTf(toks) };
}

// ---------- scoring ----------
// Returns examples annotated with a base relevance score and their tf-idf vector.
function scoreAll(examples, idf, query, { archetype = '', skills = [] } = {}) {
  const qVec = tfidfVec(query.tf, idf);
  const qSkill = new Set((skills || []).map((s) => s.toLowerCase()));
  const arch = (archetype || '').toLowerCase();

  return examples.map((ex) => {
    const tf = ex.tf && Object.keys(ex.tf).length ? ex.tf : buildTf(ex.text || '');
    const vec = tfidfVec(tf, idf);
    let score = cosine(qVec, vec);

    if (arch && ex.archetype && ex.archetype.toLowerCase() === arch) score *= ARCH_BOOST;

    const exSkills = new Set((ex.skills || []).map((s) => s.toLowerCase()));
    if (qSkill.size && exSkills.size) {
      const j = jaccard(qSkill, exSkills);
      if (j > 0) score *= (1 + (SKILL_BOOST - 1) * j); // up to *1.3 at full overlap
    }

    return { ex, vec, score, created: ex.created || '' };
  });
}

// ---------- MMR diversity selection ----------
// Maximal Marginal Relevance: balance query relevance against novelty vs picks.
export function mmrSelect(scored, k, lambda = MMR_LAMBDA) {
  const pool = scored.slice().sort((a, b) =>
    (b.score - a.score) || (b.created < a.created ? -1 : b.created > a.created ? 1 : 0));
  const picked = [];
  while (picked.length < k && pool.length) {
    let bestIdx = 0, bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let maxSimToPicked = 0;
      for (const p of picked) {
        const s = cosine(cand.vec, p.vec);
        if (s > maxSimToPicked) maxSimToPicked = s;
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxSimToPicked;
      if (mmr > bestVal) { bestVal = mmr; bestIdx = i; }
    }
    picked.push(pool.splice(bestIdx, 1)[0]);
  }
  return picked;
}

// Map a requested doc-kind (cv|cl) to the unit kinds it owns, so a `--kind cv`
// query matches examples banked with unit kind 'entry'/'item' (and `--kind cl`
// matches 'cl_para'). An exact unit-kind match (e.g. --kind item) also passes.
const DOC_UNIT_KINDS = { cv: new Set(['entry', 'item']), cl: new Set(['cl_para']) };
function kindMatches(exKind, requested) {
  if (!requested) return true;
  if (!exKind) return true; // untyped example: keep it (don't drop on filter)
  if (exKind === requested) return true;
  const set = DOC_UNIT_KINDS[requested];
  return set ? set.has(exKind) : false;
}

// ---------- the pure retrieve() ----------
// examples: [{text,latex,kind,section,archetype,skills,created,tf?}]
// idf: {N, df}. opts: {archetype, skills, kind, k}  (kind = doc kind: cv|cl)
export function retrieve(examples, idf, query, opts = {}) {
  const { archetype = '', skills = [], kind = null, k = 6 } = opts;
  const pool = kind ? examples.filter((e) => kindMatches(e.kind, kind)) : examples;
  if (!pool.length) return { query_terms: query.tokens || [], results: [] };

  const scored = scoreAll(pool, idf, query, { archetype, skills })
    .filter((s) => s.score > 0);
  if (!scored.length) return { query_terms: query.tokens || [], results: [] };

  const picked = mmrSelect(scored, k, MMR_LAMBDA);
  return {
    query_terms: query.tokens || [],
    results: picked.map((p) => ({
      text: p.ex.text,
      latex: p.ex.latex || '',
      kind: p.ex.kind || '',
      section: p.ex.section || '',
      archetype: p.ex.archetype || '',
      score: +p.score.toFixed(4),
    })),
  };
}

// ---------- read JD arg (file path or literal text) ----------
function readJdArg(val) {
  if (!val || val === true) return '';
  if (existsSync(val)) return readFileSync(val, 'utf8');
  return String(val);
}

// ---------- main ----------
export function main(argv = process.argv.slice(2)) {
  const { flags } = parseArgs(argv);
  if (flags['self-test']) return selfTest();

  const styleDir = (flags.dir && flags.dir !== true) ? flags.dir : DEFAULT_STYLE_DIR;
  const jd = readJdArg(flags.jd);
  const role = (flags.role && flags.role !== true) ? flags.role : '';
  const archetype = (flags.archetype && flags.archetype !== true) ? flags.archetype : '';
  const kind = (flags.kind && flags.kind !== true) ? flags.kind : null;
  const skills = (flags.skills && flags.skills !== true)
    ? String(flags.skills).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const k = (flags.k && flags.k !== true) ? Math.max(1, parseInt(flags.k, 10) || 6) : 6;

  try {
    const examples = loadExamples(styleDir);
    const idf = loadIdf(styleDir);
    const query = buildQuery({ jd, role, skills });
    const out = retrieve(examples, idf, query, { archetype, skills, kind, k });

    if (flags.json || !flags.summary) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`style-retrieve: ${out.results.length} pick(s) for ${kind || 'any'}${archetype ? ` / ${archetype}` : ''}`);
      if (!out.results.length) console.log('  (cold start — example bank is empty or nothing matched)');
      for (const r of out.results) {
        console.log(`  [${r.score}] (${r.section || r.kind}) ${r.text.slice(0, 100)}`);
      }
    }
    process.exit(0);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

// ---------- self-test ----------
export function selfTest() {
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

  // Build an inline idf from a small corpus, then a few examples on different topics.
  const corpus = [
    'Rebuilt the billing payments service cutting latency forty percent',
    'Designed a distributed rate limiter for forty million requests per second',
    'Led the hiring committee and mentored five junior engineers',
    'Wrote a quarterly marketing newsletter for the growth team',
    'Migrated the kubernetes cluster to a hermetic build cache',
  ];
  const idf = emptyIdf();
  const examples = corpus.map((text, i) => {
    const tf = buildTf(text);
    // index each into idf
    idf.N += 1;
    for (const t of Object.keys(tf)) idf.df[t] = (idf.df[t] || 0) + 1;
    return {
      id: `e${i}`, text, latex: `\\item ${text}`, kind: 'cv', section: 'Experience',
      archetype: i === 0 ? 'platform' : (i === 2 ? 'manager' : 'generic'),
      skills: i === 0 ? ['billing', 'latency'] : ['general'],
      created: `2026-01-0${i + 1}`, tf,
    };
  });

  try {
    // On-topic query about billing/latency/payments should rank the billing bullet #1.
    const query = buildQuery({ jd: 'We need an engineer to own our billing and payments latency', role: 'Payments Engineer', skills: ['billing', 'latency'] });
    const out = retrieve(examples, idf, query, { archetype: 'platform', skills: ['billing', 'latency'], kind: 'cv', k: 3 });
    ok(out.results.length > 0, 'retrieve returned results for an on-topic query');
    ok(/billing/i.test(out.results[0].text), `on-topic billing bullet ranks first (got: "${out.results[0].text}")`);
    ok(out.query_terms.includes('bill'), 'query_terms include the stemmed JD term');
    ok(out.results.every((r) => r.kind === 'cv'), 'kind filter respected');

    // Boosts: same query, the billing example also wins archetype+skill boosts.
    const top = out.results[0];
    ok(top.archetype === 'platform', 'top result carries its archetype tag');

    // Diversity: ask for k=3, results should not be three near-identical bullets.
    ok(new Set(out.results.map((r) => r.text)).size === out.results.length, 'MMR returned distinct picks');

    // Cold start: empty bank => { results: [] }.
    const cold = retrieve([], emptyIdf(), buildQuery({ jd: 'anything' }), { kind: 'cv', k: 5 });
    ok(Array.isArray(cold.results) && cold.results.length === 0, 'cold start returns empty results');

    // Off-topic query (marketing) should surface the newsletter bullet near the top.
    const mkt = retrieve(examples, idf, buildQuery({ jd: 'quarterly marketing newsletter growth', skills: [] }), { kind: 'cv', k: 2 });
    ok(mkt.results.length && /newsletter|marketing/i.test(mkt.results[0].text), 'off-topic query retrieves the relevant marketing bullet');

    // k respected.
    const two = retrieve(examples, idf, query, { archetype: 'platform', skills: ['billing'], kind: 'cv', k: 2 });
    ok(two.results.length <= 2, 'k caps the number of results');

    console.log(`style-retrieve self-test: ${checks} checks passed`);
    process.exit(0);
  } catch (e) {
    console.error(`style-retrieve self-test FAILED: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }
