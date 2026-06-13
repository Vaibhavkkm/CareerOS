#!/usr/bin/env node
// lib/skills.mjs — recognize tech skills (and required experience) in CV / JD text.
//
// Pure, deterministic, zero-token. The match-score engine uses this to score a CV
// against a job posting by the skills that actually MATTER (the role's primary
// build stack), not by shared boilerplate — so a Node/React candidate stops
// reading as a "Very strong" fit for a Spring/Java job.
//
// Design (mirrors lib/languages.mjs's precision-over-recall philosophy):
//   • Skills come from a curated taxonomy (skills.data.mjs): canonical name,
//     aliases, ecosystem `family`, and `stackDefining` (a language/framework that
//     defines the role's primary stack vs. a cross-cutting tool every stack uses).
//   • Recognition is alias matching on the RAW text (not the stemmed token space,
//     which mangles "Node.js" → "node.j"), word-boundaried via lookarounds that
//     respect tech punctuation (c++, c#, .net, node.js).
//   • Ambiguous English-word aliases (go, spring, swift, echo, less, …) match only
//     when the line carries a tech anchor — another recognized skill or a context
//     word — so prose never registers as a skill.
//   • CV recognition is PROFICIENCY-WEIGHTED: a skill anchoring real experience
//     bullets counts full; one mention in a skills list counts partial; a skill
//     seen only behind "exposure to / familiar with / basic / no" counts little.
//     This is what separates "lists Spring Boot once" from "is a Spring engineer".
//   • JD recognition is SEGMENTED into required vs. nice-to-have, so a "React a
//     plus" line on a data-science JD never gets treated as a core requirement.

import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

import { SKILLS, AMBIGUOUS } from './skills.data.mjs';

// ─── precompiled lookups (built ONCE) ─────────────────────────────────────────
const BY_ALIAS = new Map(); // alias -> canonical
const META = new Map();     // canonical -> { family, stackDefining }
for (const s of SKILLS) {
  META.set(s.canonical, { family: s.family, stackDefining: !!s.stackDefining });
  for (const a of s.aliases) {
    const k = String(a).toLowerCase();
    if (!BY_ALIAS.has(k)) BY_ALIAS.set(k, s.canonical); // first wins; canonicals are unique anyway
  }
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// One alternation, LONGEST alias first so "asp.net core" wins over "asp.net" / "net",
// and "spring boot" wins over "spring". Lookarounds use tech-aware boundaries: a
// match can't be glued to an identifier char, '#', or '+' (so "react" ≠ "reactor",
// "c" ≠ "c++"), but a trailing '.' is fine (sentence-final "…Node.").
const ALIAS_RE = new RegExp(
  `(?<![\\w#+.])(${[...BY_ALIAS.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\w#+])`,
  'gi',
);

// A line "anchors" an ambiguous alias if it reads like tech (or already holds a
// non-ambiguous skill — handled per-line in recognize()).
const TECH_CONTEXT = /\b(develop\w*|engineer\w*|programm\w*|framework|backend|back-end|frontend|front-end|full[- ]?stack|micro-?service\w*|api|apis|sdk|library|libraries|stack|language|coding|codebase|proficien\w*|expertise|experience|skills?|technolog\w*|building|built|using|written in|implement\w*|deploy\w*|server-?side|web app|application|software|runtime|ecosystem)\b/i;

// On the CV side, a mention sitting inside one of these windows is weak evidence.
// NB: deliberately NOT a bare "learning" — that collides with "Machine Learning" /
// "Deep Learning" (topics, not exposure cues) and wrongly demoted real ML skills.
const CV_EXPOSURE = /\b(exposure to|familiar(?:ity)? with|familiar|basic(?:s of)?|beginner|some knowledge|some experience with|currently learning|willing to learn|self[- ]?taught|no experience|without|introductory)\b/i;

// JD nice-to-have markers (line-level + section-header level).
const NICE = /\b(nice to have|nice-to-have|nice to haves|preferred|preferable|preferred qualifications|bonus|a plus|is a plus|would be a plus|good to have|desirable|desired|optional|advantageous|an advantage|pluses|ideally|bonus points)\b/i;
// Headers that re-open the "required" region after a nice-to-have section.
const REQ_HEADER = /\b(requirements?|required|qualifications|responsibilities|what you('|’)?ll do|must have|must-have|essential|about the role|the role|key skills|minimum|who you are)\b/i;

// ─── section classification (for CV proficiency) ──────────────────────────────
function sectionKind(headerText) {
  const h = String(headerText || '').toLowerCase();
  if (/\b(experience|employment|work history|professional|career|projects?|portfolio)\b/.test(h)) return 'experience';
  if (/\b(skills?|technolog|tech stack|tooling|tools|competenc|proficienc|expertise)\b/.test(h)) return 'skills';
  if (/\b(education|academic|qualification|degree|coursework|certification)\b/.test(h)) return 'education';
  return 'other';
}
// Map every line index to the kind of the markdown section it sits under.
function buildSectionMap(lines) {
  const map = new Array(lines.length).fill('other');
  let cur = 'other';
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) {
      const kind = sectionKind(m[2]);
      // A top-level header (#/##) starts a real section even if it's "other".
      // A deep sub-header (###+, e.g. a "### Company — Role" entry) must NOT reset
      // its parent section to "other" — it lives WITHIN it (Experience › Company).
      if (m[1].length <= 2 || kind !== 'other') cur = kind;
    }
    map[i] = cur;
  });
  return map;
}

// ─── core recognizer ──────────────────────────────────────────────────────────
// Returns { hits:[{canonical, alias, index, li, line, ambiguous, meta}], lines }.
export function recognize(text) {
  const src = String(text || '');
  const lines = src.split(/\n/);
  const hits = [];
  lines.forEach((line, li) => {
    const lower = line.toLowerCase();
    ALIAS_RE.lastIndex = 0;
    const lineHits = [];
    for (const m of lower.matchAll(ALIAS_RE)) {
      const canonical = BY_ALIAS.get(m[1]);
      if (!canonical) continue;
      lineHits.push({ canonical, alias: m[1], index: m.index, li, line, ambiguous: AMBIGUOUS.has(m[1]), meta: META.get(canonical) });
    }
    const hasUnambig = lineHits.some((h) => !h.ambiguous);
    const techCtx = TECH_CONTEXT.test(line);
    for (const h of lineHits) {
      // An ambiguous alias survives only when the line is tech-anchored.
      if (h.ambiguous && !hasUnambig && !techCtx) continue;
      hits.push(h);
    }
  });
  return { hits, lines };
}

// ─── CV skills (proficiency-weighted) ─────────────────────────────────────────
// Map(canonical -> { family, stackDefining, weight in (0,1], count }).
// weight: experience-anchored 1.0 · skills-list / repeated 0.75 · single prose 0.55
//         · exposure/negation-only 0.30. Education-only mentions are dropped
//         (coursework shouldn't read as professional skill).
export function cvSkills(cvText) {
  const { hits, lines } = recognize(cvText);
  const sec = buildSectionMap(lines);
  const agg = new Map();
  for (const h of hits) {
    const where = sec[h.li];
    if (where === 'education') continue;
    const around = h.line.slice(Math.max(0, h.index - 45), h.index + h.alias.length + 30);
    const exposure = CV_EXPOSURE.test(around);
    const cur = agg.get(h.canonical) || { family: h.meta.family, stackDefining: h.meta.stackDefining, count: 0, exp: false, list: false, solid: false };
    cur.count += 1;
    // Experience-anchored ONLY when the mention is real work, not an exposure
    // phrase ("Familiarity with Spring Boot from a tutorial" in the Experience
    // section must NOT promote Spring Boot to full weight).
    if (where === 'experience' && !exposure) cur.exp = true;
    if (where === 'skills') cur.list = true;
    if (!exposure) cur.solid = true; // at least one non-exposure mention
    agg.set(h.canonical, cur);
  }
  const out = new Map();
  for (const [c, v] of agg) {
    let weight;
    if (!v.solid) weight = 0.3;             // every mention was exposure/negation
    else if (v.exp) weight = 1.0;           // anchors real experience/projects
    else if (v.list || v.count >= 2) weight = 0.75;
    else weight = 0.55;                     // a single plain prose mention
    out.set(c, { family: v.family, stackDefining: v.stackDefining, weight, count: v.count });
  }
  return out;
}

// ─── JD skills (required vs. nice-to-have) ────────────────────────────────────
// Returns { required:Map, nice:Map, all:Map } of canonical -> { family, stackDefining }.
// A skill required ANYWHERE outranks a nice mention (required wins on conflict).
export function jdSkills(jdText) {
  const { hits, lines } = recognize(jdText);
  // Per-line nice flag: the line itself reads nice-to-have, OR we're inside a
  // nice-to-have section (a short header-like line matched NICE and no REQ header
  // has re-opened the required region since).
  const niceLine = new Array(lines.length).fill(false);
  let niceMode = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    const headerish = t.length <= 60 && (/^#{1,6}\s/.test(line) || /[:?]\s*$/.test(t) || /^[-*•]/.test(t) === false);
    if (REQ_HEADER.test(line) && headerish) niceMode = false;
    if (NICE.test(line) && headerish) niceMode = true;
    niceLine[i] = niceMode || NICE.test(line);
  });
  const required = new Map();
  const nice = new Map();
  const all = new Map();
  for (const h of hits) {
    const meta = { family: h.meta.family, stackDefining: h.meta.stackDefining };
    all.set(h.canonical, meta);
    if (niceLine[h.li]) {
      if (!required.has(h.canonical)) nice.set(h.canonical, meta);
    } else {
      required.set(h.canonical, meta);
      nice.delete(h.canonical);
    }
  }
  return { required, nice, all };
}

// Sum of weights (CV) or count (JD) per family. Accepts a Map whose values carry
// an optional numeric `weight` (defaults to 1 — JD skills are unweighted).
export function familyMass(skillMap) {
  const m = Object.create(null);
  for (const [, v] of skillMap) m[v.family] = (m[v.family] || 0) + (typeof v.weight === 'number' ? v.weight : 1);
  return m;
}

// Display helper: canonical names for a Map / iterable of canonicals.
export function canonicalsOf(skillMap) {
  return [...skillMap.keys ? skillMap.keys() : skillMap];
}

// ─── experience extraction ────────────────────────────────────────────────────
const SENIORITY = [
  [/\b(intern(ship)?|trainee|working student|apprentice|graduate program|new ?grad|werkstudent|praktik\w*)\b/i, 0],
  [/\b(junior|jr\.?|entry[- ]?level|entry|associate|graduate)\b/i, 0],
  [/\b(senior|sr\.?|lead|principal|staff|architect|head of|director|vp|chief)\b/i, 6],
  [/\b(mid[- ]?level|intermediate)\b/i, 3],
];
// Title -> imputed minimum years floor (only used when the JD states no number).
export function seniorityFloor(title) {
  const t = String(title || '');
  // Senior family wins over a co-mentioned "associate"/"graduate" qualifier.
  if (/\b(senior|sr\.?|lead|principal|staff|architect|head of|director|vp|chief)\b/i.test(t)) return 6;
  if (/\b(mid[- ]?level|intermediate)\b/i.test(t)) return 3;
  if (/\b(intern(ship)?|trainee|working student|apprentice|graduate program|new ?grad|junior|jr\.?|entry)\b/i.test(t)) return 0;
  return null; // unknown
}
export function isEntryLevelJd(title, text) {
  const t = `${title || ''} ${text || ''}`;
  return /\b(intern(ship)?|trainee|working student|apprentice|graduate program|new ?grad|entry[- ]?level|junior)\b/i.test(t);
}

// Best-effort REQUIRED years for SCORING (distinct from board.extractExperience's
// display label). Rule: required = MAX low-end across all year-requirements that are
// NOT in a nice-to-have window. Ranges ("0–2", "3-5") use the LOW end as the bar;
// "5+" → 5. Rejects ages ("18 years old") and implausible (>15) values.
// title is optional; when no number is stated we fall back to the title's floor.
export function jdRequiredYears(jdText, title = '') {
  const t = String(jdText || '');
  const bars = [];
  // <lo>[-–to <hi>] [+] years[/of experience]; capture some trailing context for nice/age checks.
  const re = /(\d{1,2})\s*(?:(?:-|–|—|to)\s*(\d{1,2}))?\s*(\+)?\s*(years?|yrs?)\b([^.\n]{0,28})/gi;
  for (const m of t.matchAll(re)) {
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : null;
    const tail = (m[5] || '');
    const head = t.slice(Math.max(0, m.index - 18), m.index);
    if (/\bold\b|\bof age\b|\bage\b/i.test(tail) || /\bage\b/i.test(head)) continue; // "18 years old"
    if (NICE.test(tail) || NICE.test(head)) continue;                                 // "2+ years X a plus"
    const bar = lo; // low end of a range is the minimum-to-be-considered bar
    if (bar >= 0 && bar <= 15 && (hi == null || hi <= 20)) bars.push(bar);
  }
  if (bars.length) return { years: Math.max(...bars), confident: true, source: 'stated' };
  const floor = seniorityFloor(title) ?? seniorityFloor(t.split('\n')[0]);
  if (floor != null) return { years: floor, confident: floor > 0, source: 'title' };
  return { years: 0, confident: false, source: 'none' };
}

// Candidate's total PROFESSIONAL years, estimated from the CV's experience section.
// Merges overlapping date ranges (union, not sum), excludes education and
// internship/trainee/student roles, resolves "Present" to `today`. Returns
// { years, confident }. Unknown / unparseable → { years: 0, confident: false } so
// the scorer can stay NEUTRAL rather than inventing a penalty.
export function candidateYears(cvText, { profileYears = null, today = null } = {}) {
  if (profileYears != null && Number.isFinite(Number(profileYears))) {
    return { years: Number(profileYears), confident: true, source: 'profile' };
  }
  const now = today ? new Date(today) : new Date();
  const { lines } = recognize(cvText);
  const sec = buildSectionMap(lines.map((l) => l)); // section per line
  const intervals = [];
  lines.forEach((line, i) => {
    if (sec[i] !== 'experience') return;
    // Only ROLE/ENTRY lines carry employment dates. Skip bullets — a narrative
    // bullet like "…12-station network (2007–2015 data)" holds a year range that
    // is NOT a job (this over-counted the real CV to ~11y; the red-team's case).
    if (/^\s*[-•]\s/.test(line)) return;
    if (/\b(intern(ship)?|trainee|working student|apprentice|student assistant|praktik\w*|teaching assistant)\b/i.test(line)) return;
    // MM/YYYY – MM/YYYY | Present, or YYYY – YYYY | Present
    const m = line.match(/(?:(\d{1,2})\/)?(\d{4})\s*(?:-|–|—|to)\s*(present|current|now|(?:(\d{1,2})\/)?(\d{4}))/i);
    if (!m) return;
    const start = new Date(Number(m[2]), m[1] ? Number(m[1]) - 1 : 0, 1);
    let end;
    if (/present|current|now/i.test(m[3])) end = now;
    else end = new Date(Number(m[5]), m[4] ? Number(m[4]) - 1 : 11, 28);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return;
    intervals.push([start.getTime(), end.getTime()]);
  });
  if (!intervals.length) return { years: 0, confident: false, source: 'none' };
  // Union of overlapping intervals.
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s <= ce) ce = Math.max(ce, e);
    else { total += ce - cs; [cs, ce] = [s, e]; }
  }
  total += ce - cs;
  const years = total / (365.25 * 24 * 3600 * 1000);
  return { years: +years.toFixed(2), confident: true, source: 'cv-dates' };
}

// ─── self-test ────────────────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
  const has = (map, c) => map.has(c);

  // recognition: real skills, tech-punctuation intact, no prose false-positives
  const r1 = jdSkills('Build REST APIs in Node.js and Express with React and TypeScript.');
  ok(has(r1.all, 'Node.js'), 'recognizes Node.js (dotted)');
  ok(has(r1.all, 'Express') && has(r1.all, 'React') && has(r1.all, 'TypeScript'), 'recognizes Express/React/TypeScript');
  const r2 = jdSkills('Strong C++ and C# skills; some C as well.');
  ok(has(r2.all, 'C++') && has(r2.all, 'C#'), 'recognizes C++ and C# (punctuation)');

  // ambiguous aliases need an anchor
  eq(recognize('we will go to market in the spring and play it safe').hits.length, 0, 'unanchored go/spring/play ignored');
  ok(has(jdSkills('Backend in Go and Spring Boot.').all, 'Go'), 'anchored "Go" recognized (tech line)');
  ok(has(jdSkills('Skills: Go, Rust, Python, Docker').all, 'Go'), 'Go in a skills list recognized (co-skill anchor)');

  // CV proficiency weighting: experience-anchored > skills-list > exposure
  const cv = ['## Skills', '- React, Node.js, TypeScript, Java, Spring Boot',
    '## Experience', '### Acme — Senior React Developer 2021 – Present',
    '- Built React and Node.js apps with TypeScript.',
    '- Familiarity with Spring Boot from a tutorial.'].join('\n');
  const cs = cvSkills(cv);
  ok(cs.get('React').weight === 1.0, `React experience-anchored → 1.0 (got ${cs.get('React')?.weight})`);
  ok(cs.get('Spring Boot').weight <= 0.75, `Spring Boot (skills-list + exposure prose) not full weight (got ${cs.get('Spring Boot')?.weight})`);
  ok(cs.get('Java').weight <= 0.75, 'Java (skills-list only) is partial weight');

  // JD required vs nice
  const jd = jdSkills('Required: Python, PyTorch, machine learning.\nNice to have: exposure to React and some Node.js.');
  ok(has(jd.required, 'Python') && has(jd.required, 'PyTorch'), 'required core captured');
  ok(has(jd.nice, 'React') && !has(jd.required, 'React'), 'React under nice-to-have, not required');

  // family mass
  const fm = familyMass(cs);
  ok((fm['js-frontend'] || 0) > 0 && (fm['js-backend'] || 0) > 0, 'familyMass aggregates by family');

  // experience: max non-nice low-end; ranges use low end; nice excluded; ages rejected
  eq(jdRequiredYears('8+ years building distributed systems; 2+ years with React a plus.').years, 8, 'years: max non-nice (8, not the "2 a plus")');
  eq(jdRequiredYears('Requires 5 years Java AND 3 years Kubernetes.').years, 5, 'years: max across requirements (5)');
  eq(jdRequiredYears('Junior Developer, 0-2 years experience welcome.').years, 0, 'years: range low-end (0 → entry)');
  eq(jdRequiredYears('Must be at least 18 years old.').confident, false, 'years: ignores age requirement');
  eq(jdRequiredYears('Senior Engineer with deep expertise.', 'Senior Engineer').years, 6, 'years: senior title floor when no number');

  // candidate years: union of professional ranges, excludes internships/education
  const proCv = ['## Experience',
    '*Associate Systems Analyst* — 12/2022 – 06/2024',
    '*Research Intern* — 04/2026 – Present',
    '## Education', '*M.Sc.* — 09/2024 – Present'].join('\n');
  const cy = candidateYears(proCv, { today: '2026-06-13' });
  ok(cy.confident && cy.years >= 1.3 && cy.years <= 1.8, `candidateYears ~1.5 from NSE only (got ${cy.years})`);
  eq(candidateYears('no dates here', {}).confident, false, 'candidateYears unknown → not confident (neutral upstream)');
  eq(candidateYears('## Experience\n*Engineer* — 2018 – 2024', { profileYears: 3 }).years, 3, 'profileYears overrides CV estimate');

  console.log(`skills self-test: ${n} checks passed ✅`);
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) { selfTest(); }
  else {
    let buf = '';
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => {
      console.log(JSON.stringify({ cv: [...cvSkills(buf)], jd: [...jdSkills(buf).all] }, null, 2));
    });
  }
}
