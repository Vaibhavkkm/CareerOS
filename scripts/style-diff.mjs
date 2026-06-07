#!/usr/bin/env node
// scripts/style-diff.mjs — Algorithm A: diff an AI draft against the user's final.
// Usage:
//   node scripts/style-diff.mjs <edit-dir> [--json]
//   node scripts/style-diff.mjs --self-test
//
// Reads <edit-dir>/{ai_draft.tex,user_final.tex,context.json}, aligns the parsed
// units (lib/tex.parseTexUnits) by lib/text.unitSimilarity greedily highest-first,
// classifies each as kept / reworded / added / removed (+ reordered), computes
// per-unit deltas using lib/text features, then writes <edit-dir>/diff.json and
// prints it. Pure helper computeDiff() is exported for the learning loop + tests.
//
// Thresholds (must match profile.json constants): KEEP_HI 0.92, REWORD_LO 0.45.

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import assert from 'node:assert/strict';

import { parseTexUnits } from '../lib/tex.mjs';
import {
  words, firstVerb, quantSignals, bannedVerbHits, fillerHits, stemTokens, STOPWORDS,
  unitSimilarity,
} from '../lib/text.mjs';

const KEEP_HI = 0.92;   // >= => kept (essentially unchanged)
const REWORD_LO = 0.45; // [REWORD_LO, KEEP_HI) => reworded

// ---------- arg parsing (matches house style) ----------
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

// ---------- delta features ----------
// Tokens present in `before` (content words) that are gone from `after`.
function removedTokens(before, after) {
  const a = new Set(words(before).filter((t) => !STOPWORDS.has(t)));
  const b = new Set(words(after).filter((t) => !STOPWORDS.has(t)));
  return [...a].filter((t) => !b.has(t)).slice(0, 16);
}

// Un-escape the LaTeX metric specials (\%, \$, \&) so quantSignals can see
// `38\%` as `38%` and `$1.2M` as `$1.2M`. Normalize() strips these to spaces,
// so quant detection must run against the raw latex for accuracy.
function deLatexMetrics(s) {
  return String(s || '')
    .replace(/\\([%$&#_])/g, '$1')
    .replace(/\$\s*\\times\s*\$/g, 'x'); // \times -> multiplier hint
}

// Which quant signal flags newly appear in `after` vs `before`.
// `*Latex` args (when present) preserve escaped metrics; fall back to plain.
function addedQuant(before, after, beforeLatex, afterLatex) {
  const qa = quantSignals(deLatexMetrics(beforeLatex || before));
  const qb = quantSignals(deLatexMetrics(afterLatex || after));
  const keys = ['number', 'percent', 'currency', 'timeRange', 'multiplier'];
  return keys.filter((k) => qb[k] && !qa[k]);
}

// banned verbs + filler present in `before` (the thing the user edited away from).
function bannedHits(before) {
  return [...new Set([...bannedVerbHits(before), ...fillerHits(before)])].slice(0, 16);
}

export function deltasFor(before, after, beforeLatex, afterLatex) {
  const d = {
    wc: [words(before).length, words(after).length],
    verb: [firstVerb(before), firstVerb(after)],
    added_quant: addedQuant(before, after, beforeLatex, afterLatex),
    removed_tokens: removedTokens(before, after),
    banned_hits_before: bannedHits(before),
  };
  return d;
}

// Text used for feature extraction: prefer `norm` but fall back to raw.
function unitText(u) { return (u.norm && u.norm.trim()) ? u.norm : (u.raw || ''); }

// ---------- core alignment ----------
// Greedy highest-similarity matching between AI units and final units.
export function computeDiff(aiTex, finalTex, kind, editId = null) {
  const ai = parseTexUnits(aiTex, kind);
  const fin = parseTexUnits(finalTex, kind);

  // Build all candidate pairs with similarity, then take greedily from the top.
  const pairs = [];
  for (let i = 0; i < ai.length; i++) {
    for (let j = 0; j < fin.length; j++) {
      pairs.push({ i, j, sim: unitSimilarity(unitText(ai[i]), unitText(fin[j])) });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);

  const aiUsed = new Array(ai.length).fill(false);
  const finUsed = new Array(fin.length).fill(false);
  const matches = []; // {i, j, sim}
  for (const p of pairs) {
    if (p.sim < REWORD_LO) break; // nothing below the reword floor can match
    if (aiUsed[p.i] || finUsed[p.j]) continue;
    aiUsed[p.i] = true; finUsed[p.j] = true;
    matches.push(p);
  }

  const units = [];
  const summary = { kept: 0, reworded: 0, added: 0, removed: 0, reordered: 0 };

  // matched units: kept or reworded, with optional reorder note
  for (const m of matches) {
    const a = ai[m.i], f = fin[m.j];
    const op = m.sim >= KEEP_HI ? 'kept' : 'reworded';
    summary[op]++;
    const reordered = a.order_index !== f.order_index;
    if (reordered) summary.reordered++;
    const rec = {
      op,
      section: f.section || a.section,
      kind: f.kind || a.kind,
      before: unitText(a),
      after: unitText(f),
      before_latex: a.raw,
      after_latex: f.raw,
      sim: +m.sim.toFixed(4),
      reordered,
      deltas: deltasFor(unitText(a), unitText(f), a.raw, f.raw),
    };
    units.push(rec);
  }

  // unmatched AI units => removed
  for (let i = 0; i < ai.length; i++) {
    if (aiUsed[i]) continue;
    summary.removed++;
    const a = ai[i];
    units.push({
      op: 'removed',
      section: a.section,
      kind: a.kind,
      before: unitText(a),
      before_latex: a.raw,
      deltas: {
        wc: [words(unitText(a)).length, 0],
        verb: [firstVerb(unitText(a)), ''],
        added_quant: [],
        removed_tokens: removedTokens(unitText(a), ''),
        banned_hits_before: bannedHits(unitText(a)),
      },
    });
  }

  // unmatched final units => added
  for (let j = 0; j < fin.length; j++) {
    if (finUsed[j]) continue;
    summary.added++;
    const f = fin[j];
    units.push({
      op: 'added',
      section: f.section,
      kind: f.kind,
      after: unitText(f),
      after_latex: f.raw,
      deltas: {
        wc: [0, words(unitText(f)).length],
        verb: ['', firstVerb(unitText(f))],
        added_quant: addedQuant('', unitText(f), '', f.raw),
        removed_tokens: [],
        banned_hits_before: [],
      },
    });
  }

  return { edit_id: editId, doc_kind: kind, summary, units };
}

// ---------- context inference ----------
function inferKind(ctx, editDir) {
  if (ctx && (ctx.doc_kind === 'cv' || ctx.doc_kind === 'cl')) return ctx.doc_kind;
  return /(^|[-_/])cl([-_]|$)|cover/i.test(basename(editDir)) ? 'cl' : 'cv';
}

// ---------- run on a real edit dir ----------
export function runOnDir(editDir, { write = true } = {}) {
  const aiPath = join(editDir, 'ai_draft.tex');
  const finalPath = join(editDir, 'user_final.tex');
  const ctxPath = join(editDir, 'context.json');
  if (!existsSync(aiPath)) throw new Error(`missing ai_draft.tex in ${editDir}`);
  if (!existsSync(finalPath)) throw new Error(`missing user_final.tex in ${editDir}`);

  let ctx = {};
  if (existsSync(ctxPath)) {
    try { ctx = JSON.parse(readFileSync(ctxPath, 'utf8')); }
    catch (e) { throw new Error(`context.json invalid JSON: ${e.message}`); }
  }
  const kind = inferKind(ctx, editDir);
  const editId = ctx.app_id || basename(editDir);
  const aiTex = readFileSync(aiPath, 'utf8');
  const finalTex = readFileSync(finalPath, 'utf8');

  const diff = computeDiff(aiTex, finalTex, kind, editId);
  if (write) writeFileSync(join(editDir, 'diff.json'), JSON.stringify(diff, null, 2) + '\n');
  return diff;
}

// ---------- main ----------
export function main(argv = process.argv.slice(2)) {
  const { _, flags } = parseArgs(argv);
  if (flags['self-test']) return selfTest();

  const editDir = _[0];
  if (!editDir) {
    console.error('usage: style-diff.mjs <edit-dir> [--json]  (or --self-test)');
    process.exit(1);
  }
  try {
    const diff = runOnDir(editDir, { write: true });
    if (flags.json) {
      console.log(JSON.stringify(diff, null, 2));
    } else {
      const s = diff.summary;
      console.log(`style-diff: ${editDir} [${diff.doc_kind}] edit=${diff.edit_id}`);
      console.log(`  kept ${s.kept}  reworded ${s.reworded}  added ${s.added}  removed ${s.removed}  reordered ${s.reordered}`);
      console.log(`  -> wrote ${join(editDir, 'diff.json')}`);
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
  const dir = mkdtempSync(join(tmpdir(), 'aw-style-diff-'));
  try {
    // Three CV bullets. final: bullet 1 kept verbatim, bullet 2 reworded
    // (banned verb -> strong verb + metric), bullet 3 removed, one new bullet added.
    const ai = String.raw`
\documentclass{article}
\begin{document}
\section{Experience}
\begin{itemize}
\item Designed and shipped a distributed rate limiter serving forty million requests
\item Worked on the billing service to reduce latency for customers
\item Helped various teams with documentation and onboarding tasks
\end{itemize}
\end{document}`;
    const fin = String.raw`
\documentclass{article}
\begin{document}
\section{Experience}
\begin{itemize}
\item Designed and shipped a distributed rate limiter serving forty million requests
\item Rebuilt the billing service, cutting p99 latency 38\% for customers
\item Led the migration of CI to a hermetic build cache, saving 20 minutes per build
\end{itemize}
\end{document}`;

    const diff = computeDiff(ai, fin, 'cv', 'selftest-1');
    ok(diff.doc_kind === 'cv', 'doc_kind carried through');
    ok(diff.summary.kept === 1, `exactly one kept (got ${diff.summary.kept})`);
    ok(diff.summary.reworded === 1, `exactly one reworded (got ${diff.summary.reworded})`);
    ok(diff.summary.removed === 1, `exactly one removed (got ${diff.summary.removed})`);
    ok(diff.summary.added === 1, `exactly one added (got ${diff.summary.added})`);

    const rew = diff.units.find((u) => u.op === 'reworded');
    ok(rew, 'reworded unit present');
    ok(rew.deltas.verb[0] === 'work' && rew.deltas.verb[1] !== 'work',
       `reworded verb changed away from "work" (got ${JSON.stringify(rew.deltas.verb)})`);
    ok(rew.deltas.added_quant.includes('percent'),
       `reworded unit added a percent metric (got ${JSON.stringify(rew.deltas.added_quant)})`);
    ok(rew.deltas.banned_hits_before.includes('worked') || rew.deltas.banned_hits_before.includes('worked on'),
       `reworded captured banned "worked" before (got ${JSON.stringify(rew.deltas.banned_hits_before)})`);

    const kept = diff.units.find((u) => u.op === 'kept');
    ok(kept && kept.sim >= KEEP_HI, 'kept unit sim >= KEEP_HI');

    const removed = diff.units.find((u) => u.op === 'removed');
    ok(removed && removed.deltas.wc[1] === 0, 'removed unit has after wc 0');

    const added = diff.units.find((u) => u.op === 'added');
    ok(added && added.deltas.wc[0] === 0, 'added unit has before wc 0');

    // Cover-letter path: parse + a clear reword.
    const clAi = '\\begin{document}\nI worked on several backend systems and helped the team ship a variety of features over the last year of employment.\n\\end{document}';
    const clFin = '\\begin{document}\nI led the backend platform rewrite and shipped twelve customer-facing features in the last year, cutting onboarding time in half.\n\\end{document}';
    const clDiff = computeDiff(clAi, clFin, 'cl', 'selftest-cl');
    ok(clDiff.doc_kind === 'cl', 'cl doc_kind');
    ok(clDiff.summary.reworded + clDiff.summary.added + clDiff.summary.removed >= 1, 'cl produced at least one change op');

    // runOnDir writes diff.json
    writeFileSync(join(dir, 'ai_draft.tex'), ai);
    writeFileSync(join(dir, 'user_final.tex'), fin);
    writeFileSync(join(dir, 'context.json'), JSON.stringify({ app_id: 'e1', doc_kind: 'cv', archetype: 'platform' }));
    const d2 = runOnDir(dir, { write: true });
    ok(existsSync(join(dir, 'diff.json')), 'diff.json written to edit dir');
    ok(d2.edit_id === 'e1', 'edit_id taken from context.app_id');

    console.log(`style-diff self-test: ${checks} checks passed`);
    process.exit(0);
  } catch (e) {
    console.error(`style-diff self-test FAILED: ${e.message}`);
    process.exit(1);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }
