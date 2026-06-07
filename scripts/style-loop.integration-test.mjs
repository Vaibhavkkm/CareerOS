#!/usr/bin/env node
// scripts/style-loop.integration-test.mjs — END-TO-END test of the learning loop.
// Builds a real edit folder in os.tmpdir() (NEVER touches data/), then runs the
// three scripts wired together exactly as production would:
//     style-diff (runOnDir)  ->  style-profile apply  ->  style-profile bank
// and asserts the profile + example bank actually learned from the edit.
//
// Usage: node scripts/style-loop.integration-test.mjs   (exit 0 = pass)

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import { runOnDir as diffRunOnDir } from './style-diff.mjs';
import { cmdApply, cmdBank, readProfile } from './style-profile.mjs';
import { loadExamples, loadIdf, buildQuery, retrieve } from './style-retrieve.mjs';
import { stem } from '../lib/text.mjs';

const AI = String.raw`\documentclass{article}
\begin{document}
\section{Experience}
\begin{itemize}
\item Worked on the payments platform to reduce checkout latency for customers
\item Mentored a team of engineers and ran the weekly design review
\end{itemize}
\end{document}`;

// user_final: bullet 1 swaps banned verb "worked on" -> "built" and ADDS a % metric;
// bullet 2 kept verbatim.
const FINAL = String.raw`\documentclass{article}
\begin{document}
\section{Experience}
\begin{itemize}
\item Built the payments platform, cutting checkout latency 42\% for customers
\item Mentored a team of engineers and ran the weekly design review
\end{itemize}
\end{document}`;

function makeEditDir(styleDir, name, created) {
  const ed = join(styleDir, 'edits', name);
  mkdirSync(ed, { recursive: true });
  writeFileSync(join(ed, 'ai_draft.tex'), AI);
  writeFileSync(join(ed, 'user_final.tex'), FINAL);
  writeFileSync(join(ed, 'context.json'), JSON.stringify({
    app_id: name, created, doc_kind: 'cv', archetype: 'platform',
    jd_path: 'jd.txt', target_role: 'Payments Engineer', seniority: 'senior',
    required_skills: ['payments', 'latency'], template_id: 'cv.tex.tmpl', model_id: 'opus',
  }));
  return ed;
}

function main() {
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const styleDir = mkdtempSync(join(tmpdir(), 'aw-style-integration-'));
  const T = '2026-06-07';

  try {
    // ----- EDIT 1 -----
    const ed1 = makeEditDir(styleDir, 'edit1', '2026-06-07T09:00:00Z');

    // 1) style-diff: produce diff.json from the two .tex files.
    const diff = diffRunOnDir(ed1, { write: true });
    ok(existsSync(join(ed1, 'diff.json')), 'style-diff wrote diff.json');
    ok(diff.summary.reworded === 1, `diff has one reworded unit (got ${diff.summary.reworded})`);
    ok(diff.summary.kept === 1, `diff has one kept unit (got ${diff.summary.kept})`);
    const rew = diff.units.find((u) => u.op === 'reworded');
    ok(rew.deltas.verb[0] === 'work' && rew.deltas.verb[1] === 'built', 'reworded verb work -> built');
    ok(rew.deltas.added_quant.includes('percent'), 'reworded unit added a percent metric');

    // 2) style-profile apply: derive + merge rules.
    const a1 = cmdApply(styleDir, ed1, T);
    ok(existsSync(join(styleDir, 'profile.json')), 'apply wrote profile.json');
    ok(existsSync(join(styleDir, 'profile.md')), 'apply rendered profile.md');
    ok(existsSync(join(styleDir, 'CHANGELOG.style.md')), 'apply appended CHANGELOG.style.md');

    // After one edit the action_verbs rules exist but are still provisional.
    {
      const prof = readProfile(styleDir, T);
      const ban = prof.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'ban' && r.value === stem('worked'));
      const prefer = prof.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'prefer' && r.value === stem('built'));
      ok(ban, 'action_verbs BAN("work") rule created');
      ok(prefer, 'action_verbs PREFER("built") rule created');
      ok(ban.status === 'provisional' && ban.confidence === 1, 'rules provisional at confidence 1 after first edit');
      const cut = prof.rules.find((r) => r.category === 'always_cut' && (r.value === 'worked' || r.value === 'worked on'));
      ok(cut, 'always_cut rule created from removed banned verb');
      const quant = prof.rules.find((r) => r.category === 'quantification' && r.polarity === 'prefer');
      ok(quant, 'quantification PREFER rule created from added metric');
    }

    // 3) style-profile bank: write examples + idf from the kept/reworded units.
    const b1 = cmdBank(styleDir, ed1, T);
    ok(existsSync(join(styleDir, 'examples.jsonl')), 'bank wrote examples.jsonl');
    ok(existsSync(join(styleDir, 'idf.json')), 'bank wrote idf.json');
    ok(b1.added >= 1, `bank added at least one example (got ${b1.added})`);
    {
      const ex = loadExamples(styleDir);
      ok(ex.length >= 1, `examples.jsonl is non-empty (${ex.length} rows)`);
      ok(ex.some((e) => /payments platform/i.test(e.text)), 'banked the reworded "built" bullet');
      ok(ex.every((e) => e.archetype === 'platform'), 'examples tagged with the context archetype');
      ok(ex.every((e) => Array.isArray(e.skills) && e.skills.includes('payments')), 'examples tagged with required_skills');
    }

    // ----- EDIT 2 (same correction) => rules PROMOTE to active at confidence 2 -----
    const ed2 = makeEditDir(styleDir, 'edit2', '2026-06-07T11:00:00Z');
    diffRunOnDir(ed2, { write: true });
    cmdApply(styleDir, ed2, T);
    cmdBank(styleDir, ed2, T);

    {
      const prof = readProfile(styleDir, T);
      const ban = prof.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'ban' && r.value === stem('worked'));
      const prefer = prof.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'prefer' && r.value === stem('built'));
      ok(ban.confidence >= 2 && ban.status === 'active', `BAN("work") promoted to active (conf ${ban.confidence})`);
      ok(prefer.confidence >= 2 && prefer.status === 'active', `PREFER("built") promoted to active (conf ${prefer.confidence})`);
      ok(prof.edits_seen === 2, 'edits_seen == 2 after two applies');
      ok(prof.constants.PROMOTE === 2 && prof.constants.KEEP_HI === 0.92, 'profile constants honored');
    }

    // ----- retrieve round-trip: the bank is queryable -----
    {
      const examples = loadExamples(styleDir);
      const idf = loadIdf(styleDir);
      const q = buildQuery({ jd: 'own our payments platform and checkout latency', role: 'Payments Engineer', skills: ['payments', 'latency'] });
      const out = retrieve(examples, idf, q, { archetype: 'platform', skills: ['payments', 'latency'], kind: 'cv', k: 3 });
      ok(out.results.length >= 1, 'retrieve found at least one relevant example');
      ok(/payments platform/i.test(out.results[0].text), 'on-topic payments bullet ranks first in retrieval');
    }

    console.log(`style-loop integration test: ${checks} checks passed`);
    process.exit(0);
  } catch (e) {
    console.error(`style-loop integration test FAILED: ${e.message}\n${e.stack}`);
    process.exit(1);
  } finally {
    try { rmSync(styleDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main();
