// lib/_selftest.mjs — fast assertions over the shared libraries.
// Run: node lib/_selftest.mjs   (also part of `npm test`)

import assert from 'node:assert/strict';
import * as T from './text.mjs';
import * as S from './states.mjs';
import * as F from './tfidf.mjs';
import * as X from './tex.mjs';
import * as R from './records.mjs';
import * as LG from './languages.mjs';
import * as SK from './skills.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; };

// ---- text ----
ok('latexEscape escapes specials', () => {
  assert.equal(T.latexEscape('100% & $5_000 #1 {x}'), '100\\% \\& \\$5\\_000 \\#1 \\{x\\}');
  assert.equal(T.latexEscape('a\\b'), 'a\\textbackslash{}b');
});
ok('latexSanitize fixes punctuation', () => {
  assert.equal(T.latexSanitize('“hi”—‘yo’'), "``hi''---`yo'");
});
ok('stem collapses inflections', () => {
  assert.equal(T.stem('migrations'), T.stem('migration'));
  assert.equal(T.stem('designing'), T.stem('designed'));
});
ok('quantSignals detects metrics', () => {
  assert.equal(T.quantSignals('cut latency 40%').percent, true);
  assert.equal(T.quantSignals('saved $200K/year').currency, true);
  assert.equal(T.quantSignals('plain text').any, false);
});
ok('unitSimilarity high for paraphrase, low for unrelated', () => {
  const hi = T.unitSimilarity('Designed an event pipeline processing 10M events/day',
                              'Designed event pipeline handling 10M events per day');
  const lo = T.unitSimilarity('Designed an event pipeline', 'Mentored three junior engineers');
  assert.ok(hi > 0.45, `paraphrase sim ${hi}`);
  assert.ok(lo < hi, `unrelated ${lo} < ${hi}`);
});

// ---- states ----
ok('normalizeStatus maps aliases', () => {
  assert.equal(S.normalizeStatus('Submitted'), 'applied');
  assert.equal(S.normalizeStatus('onsite'), 'interview');
  assert.equal(S.normalizeStatus('garbage'), null);
});
ok('rank ordering', () => {
  assert.ok(S.rankFor('offer') > S.rankFor('applied'));
  assert.ok(S.rankFor('applied') > S.rankFor('evaluated'));
});

// ---- tfidf ----
ok('tfidf cosine: relevant > irrelevant', () => {
  const docs = ['kubernetes migration cost savings', 'react frontend ui design', 'kubernetes reliability scaling'];
  const idf = F.emptyIdf();
  const tfs = docs.map((d) => F.buildTf(d));
  tfs.forEach((tf) => F.indexAdd(idf, tf));
  const q = F.tfidfVec(F.buildTf('kubernetes cost'), idf);
  const v = tfs.map((tf) => F.tfidfVec(tf, idf));
  const sims = v.map((vec) => F.cosine(q, vec));
  assert.ok(sims[0] > sims[1], `k8s doc ${sims[0]} > react doc ${sims[1]}`);
});

// ---- tex ----
ok('parseTexUnits splits CV into entry+item units', () => {
  const tex = `\\begin{document}
\\section{Experience}
\\entry{Senior Engineer}{Acme}{2022 -- Present}{SF}
\\begin{itemize}
\\item Designed a pipeline processing 10M events/day.
\\item Cut costs by \\$200K/year.
\\end{itemize}
\\end{document}`;
  const u = X.parseTexUnits(tex, 'cv');
  const items = u.filter((x) => x.kind === 'item');
  const entries = u.filter((x) => x.kind === 'entry');
  assert.equal(entries.length, 1);
  assert.equal(items.length, 2);
  assert.equal(entries[0].section, 'Experience');
});
ok('leftoverPlaceholders catches <<>> and {{}}', () => {
  assert.deepEqual(X.leftoverPlaceholders('hi <<NAME>> and {{X}} ok').sort(), ['<<NAME>>', '{{X}}']);
  assert.deepEqual(X.leftoverPlaceholders('all filled in'), []);
});

// ---- records ----
ok('normalizeCompany strips suffixes', () => {
  assert.equal(R.normalizeCompany('Acme, Inc.'), 'acme');
  assert.equal(R.normalizeCompany('Globex Technologies LLC'), 'globex');
});
ok('roleFuzzyMatch: true dup yes, distinct specialization no', () => {
  assert.equal(R.roleFuzzyMatch('Senior Backend Engineer', 'Sr. Backend Engineer (Platform)'), true);
  assert.equal(R.roleFuzzyMatch('Staff SWE, API', 'Staff SWE, K8s'), false);
});
ok('upsert adds then advances status, keeps higher score', () => {
  let recs = [];
  ({ records: recs } = R.upsert(recs, { company: 'Acme', role: 'Backend Engineer', status: 'evaluated', score: 4.0 }));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].id, 1);
  let action;
  ({ records: recs, action } = R.upsert(recs, { company: 'Acme Inc', role: 'Backend Engineer', status: 'applied', score: 3.5 }));
  assert.equal(action, 'updated');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].status, 'applied');
  assert.equal(recs[0].score, 4.0); // kept the higher
});

// ---- languages (full suite in lib/languages.mjs --self-test) ----
ok('extractLanguages: level + no prog-lang false positives', () => {
  const r = LG.extractLanguages('Language: English is required, French is an asset.');
  assert.equal(r.find((x) => x.lang === 'English')?.level, 'required');
  assert.equal(r.find((x) => x.lang === 'French')?.level, 'asset');
  assert.equal(LG.extractLanguages('Experience with Go, Rust, R and Java.').length, 0);
});
ok('formatLanguages: compact tags + CEFR', () => {
  assert.equal(LG.formatLanguages(LG.extractLanguages('Language: English is required, French is an asset.')),
    'English (req), French (plus)');
  assert.ok(LG.formatLanguages(LG.extractLanguages('German (C1) needed.')).includes('German (C1)'));
});

// ---- skills (full suite in lib/skills.mjs --self-test) ----
ok('recognizeSkills: stack-defining vs cross-cutting; proficiency weight', () => {
  const jd = SK.jdSkills('Build REST APIs in Node.js and Express with React. Docker and AWS too.');
  assert.ok(jd.all.has('Node.js') && jd.all.has('React') && jd.all.has('Express'), 'recognizes core stack');
  assert.equal(jd.all.get('React').stackDefining, true, 'React is stack-defining');
  assert.equal(jd.all.get('Docker').stackDefining, false, 'Docker is cross-cutting, not stack-defining');
  const cv = SK.cvSkills('## Experience\n### Acme — React Dev — 2021 – Present\n- Built React + Node.js apps.');
  assert.ok(cv.get('React').weight === 1.0, 'experience-anchored skill → full weight');
});
ok('jdRequiredYears: max non-nice low-end; candidateYears excludes interns/education', () => {
  assert.equal(SK.jdRequiredYears('8+ years overall; 2+ years React a plus.').years, 8, 'takes the real bar, not the nice-to-have');
  const cy = SK.candidateYears('## Experience\n*Analyst* — 12/2022 – 06/2024\n*Intern* — 04/2026 – Present', { today: '2026-06-13' });
  assert.ok(cy.confident && cy.years >= 1.3 && cy.years <= 1.8, `professional years only (got ${cy.years})`);
});

console.log(`lib self-test: ${n} checks passed ✅`);
