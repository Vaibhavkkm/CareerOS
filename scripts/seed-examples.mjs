#!/usr/bin/env node
// scripts/seed-examples.mjs — WARM-START the style example bank from the user's
// OWN existing CV bullets / cover-letter paragraphs (no edits needed yet).
//
// The learning loop normally banks examples from diffs between an AI draft and
// the user's edited final (style-profile.mjs `bank`). But on day one there are no
// edits. This seeds the bank directly from documents the user already wrote, so
// the very FIRST tailored draft retrieves real in-voice examples instead of a
// cold start. It reuses style-profile's bankFromDiff() verbatim (same TF/IDF,
// same 0.93 near-dup guard) so seeded examples are indistinguishable from learned
// ones to style-retrieve.mjs.
//
// Usage:
//   node scripts/seed-examples.mjs --kind cv|cl --from <file> \
//        [--archetype X] [--skills a,b,c] [--source user_cv] [--dir <style-dir>] [--summary]
//   node scripts/seed-examples.mjs --self-test
//
// Output (--json default): { ok, kind, units, added, skipped, idfN, source }

import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { bankFromDiff } from './style-profile.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STYLE_DIR = join(ROOT, 'data', 'style');

const MIN_BULLET_WORDS = 4;   // skip headers/contact lines
const MIN_PARA_WORDS = 12;    // skip salutations / sign-offs in a cover letter

const wc = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// Strip a leading bullet/list marker (-, *, •, ·, \item, "1.") from a line.
function stripMarker(line) {
  return String(line)
    .replace(/^\s*\\item\s+/, '')
    .replace(/^\s*[-*•·▪]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim();
}

// A line that's a section header / contact line, not a bullet (ALL CAPS, ends
// with ':', or looks like an email/phone/URL).
function looksLikeHeaderOrContact(line) {
  const t = String(line).trim();
  if (!t) return true;
  if (/^[A-Z0-9 &/]+:?$/.test(t) && t.length < 40) return true;  // SUMMARY, SKILLS, EXPERIENCE
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) return true;             // email
  if (/https?:\/\//.test(t)) return true;                        // url
  if (/^\+?\d[\d\s()-]{6,}$/.test(t)) return true;               // phone
  return false;
}

// Split a CV/markdown blob into bullet-like units.
export function splitCvUnits(text) {
  const lines = String(text || '').split('\n');
  const markered = [];
  const plain = [];
  for (const raw of lines) {
    if (/^\s*(\\item|[-*•·▪]|\d+[.)])\s+/.test(raw)) {
      const t = stripMarker(raw);
      if (wc(t) >= MIN_BULLET_WORDS) markered.push(t);
    } else if (!looksLikeHeaderOrContact(raw) && wc(raw) >= MIN_BULLET_WORDS + 1) {
      plain.push(raw.trim());
    }
  }
  // Prefer explicit bullets; fall back to long plain lines only if no bullets found.
  const units = markered.length ? markered : plain;
  return dedupeExact(units);
}

// Split a cover letter into prose paragraphs (blank-line separated).
export function splitClUnits(text) {
  const paras = String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => wc(p) >= MIN_PARA_WORDS)
    // drop greeting/sign-off lines that slipped through
    .filter((p) => !/^(dear|hi|hello|sincerely|regards|best|warm regards|kind regards|thank you|thanks|yours|cheers)\b/i.test(p) || wc(p) >= MIN_PARA_WORDS + 8);
  return dedupeExact(paras);
}

function dedupeExact(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const k = s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

export function splitUnits(text, kind) {
  return kind === 'cl' ? splitClUnits(text) : splitCvUnits(text);
}

// Build the synthetic diff that bankFromDiff() consumes: every unit is a "kept"
// final the user authored. unit kind 'item' (CV) maps to doc kind cv in
// style-retrieve's DOC_UNIT_KINDS; 'cl_para' maps to cl.
export function buildSeedDiff(units, kind, editId) {
  const unitKind = kind === 'cl' ? 'cl_para' : 'item';
  return {
    edit_id: editId,
    doc_kind: kind,
    summary: { kept: units.length, reworded: 0, added: 0, removed: 0, reordered: 0 },
    units: units.map((text) => ({ op: 'kept', section: '', kind: unitKind, before: '', after: text, deltas: {} })),
  };
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Seed the bank. styleDir is the data/style dir; opts: {kind, archetype, skills, source}.
export function seedExamples(styleDir, text, { kind = 'cv', archetype = '', skills = [], source = 'user_upload', date = null } = {}) {
  const units = splitUnits(text, kind);
  if (!units.length) return { units: 0, added: 0, skipped: 0, idfN: null };
  const editId = `seed-${source}`;
  const diff = buildSeedDiff(units, kind, editId);
  const ctx = { archetype, required_skills: skills };
  const res = bankFromDiff(styleDir, diff, ctx, editId, date || todayStr());
  return { units: units.length, added: res.added, skipped: res.skipped, idfN: res.idfN };
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { kind: 'cv', from: null, archetype: '', skills: [], source: null, dir: null, json: true, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (a === '--kind') out.kind = val() || 'cv';
    else if (a.startsWith('--kind=')) out.kind = a.slice(7);
    else if (a === '--from') out.from = val();
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a === '--archetype') out.archetype = val();
    else if (a.startsWith('--archetype=')) out.archetype = a.slice(12);
    else if (a === '--skills') out.skills = String(val()).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--skills=')) out.skills = a.slice(9).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--source') out.source = val();
    else if (a.startsWith('--source=')) out.source = a.slice(9);
    else if (a === '--dir') out.dir = val();
    else if (a.startsWith('--dir=')) out.dir = a.slice(6);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  const kind = args.kind === 'cl' ? 'cl' : 'cv';
  if (!args.from || !existsSync(args.from)) {
    console.error(`error: --from <file> required and must exist (got: ${args.from || 'none'})`);
    process.exit(2);
  }
  const styleDir = args.dir || DEFAULT_STYLE_DIR;
  const source = args.source || (kind === 'cl' ? 'user_cl' : 'user_cv');
  const text = readFileSync(args.from, 'utf8');
  const res = seedExamples(styleDir, text, { kind, archetype: args.archetype, skills: args.skills, source });

  if (args.json) {
    console.log(JSON.stringify({ ok: true, kind, source, ...res }, null, 2));
  } else {
    console.log(`seed-examples: ${kind} — found ${res.units} unit(s), banked ${res.added}, skipped ${res.skipped} dup(s); idf N=${res.idfN}`);
    if (!res.added) console.log('  (nothing banked — file had no qualifying bullets/paragraphs)');
  }
  process.exit(0);
}

// ─── self-test ───────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // splitCvUnits: bullets win; headers/contact dropped
  const cv = [
    'EXPERIENCE',
    'jane@example.com',
    '- Built a billing service that cut p99 latency 38% for 2M users',
    '\\item Designed a distributed rate limiter handling 40M requests/sec',
    '* Led a team of five engineers and shipped weekly',
    '- tiny',                       // too short -> dropped
  ].join('\n');
  const cvUnits = splitCvUnits(cv);
  eq(cvUnits.length, 3, `cv: 3 qualifying bullets (got ${cvUnits.length})`);
  ok(cvUnits[0].startsWith('Built a billing'), 'cv: marker stripped, content kept');
  ok(!cvUnits.some((u) => /example\.com|EXPERIENCE/.test(u)), 'cv: header + email excluded');

  // plain-line fallback when there are no bullet markers
  const plain = 'SUMMARY\nDesigned and shipped a fraud model that reduced chargebacks by twelve percent\nShort line';
  const plainUnits = splitCvUnits(plain);
  ok(plainUnits.length === 1 && /fraud model/.test(plainUnits[0]), 'cv: falls back to long plain lines');

  // splitClUnits: paragraphs by blank line; short greeting dropped
  const cl = 'Dear Hiring Manager,\n\nYour work on privacy-preserving ML is exactly the problem I want to keep solving, and your recent paper on federated evaluation is why I am writing today.\n\nAt LIST I built pipelines that cut model training time by forty percent while improving accuracy, and I would bring that same rigor to your team.\n\nThanks';
  const clUnits = splitClUnits(cl);
  eq(clUnits.length, 2, `cl: 2 real paragraphs (got ${clUnits.length})`);
  ok(clUnits[0].includes('privacy-preserving'), 'cl: first body paragraph kept');
  ok(!clUnits.some((u) => /^Thanks$/.test(u)), 'cl: short sign-off dropped');
  // a longer "Thanks ..." sign-off (18 words, < the keep-anyway threshold) is dropped
  const thanksSignoff = 'Thanks so much for taking the time to review my application and considering me for this role today.';
  eq(splitClUnits(thanksSignoff).length, 0, 'cl: a "Thanks ..." sign-off paragraph is dropped');

  // buildSeedDiff shape
  const d = buildSeedDiff(['a bullet here ok'], 'cv', 'seed-user_cv');
  eq(d.units[0].op, 'kept', 'seed diff units are kept');
  eq(d.units[0].kind, 'item', 'cv seed unit kind=item');
  eq(buildSeedDiff(['p'], 'cl', 'x').units[0].kind, 'cl_para', 'cl seed unit kind=cl_para');

  // end-to-end: seed into a temp style dir, verify examples.jsonl + idf.json,
  // then confirm style-retrieve can find a seeded bullet.
  const sd = join(tmpdir(), `aw-seed-selftest-${process.pid}-${Date.now()}`);
  mkdirSync(sd, { recursive: true });
  try {
    const res = seedExamples(sd, cv, { kind: 'cv', archetype: 'platform', skills: ['billing', 'latency'], source: 'user_cv', date: '2026-06-07' });
    eq(res.units, 3, 'seed: 3 units found');
    ok(res.added === 3, `seed: 3 banked (got ${res.added})`);
    ok(existsSync(join(sd, 'examples.jsonl')), 'seed wrote examples.jsonl');
    ok(existsSync(join(sd, 'idf.json')), 'seed wrote idf.json');
    const ex0 = JSON.parse(readFileSync(join(sd, 'examples.jsonl'), 'utf8').split('\n').filter(Boolean)[0]);
    ok(ex0.kind === 'item' && ex0.archetype === 'platform' && ex0.skills.includes('billing'), 'seeded example tagged correctly');
    ok(ex0.tf && Object.keys(ex0.tf).length > 0, 'seeded example has a tf bag');
    ok(ex0.source_edit === 'seed-user_cv', 'seeded example records its seed provenance');

    // re-seeding the same content is idempotent (0.93 near-dup guard)
    const res2 = seedExamples(sd, cv, { kind: 'cv', archetype: 'platform', skills: ['billing'], source: 'user_cv', date: '2026-06-07' });
    ok(res2.added === 0 && res2.skipped >= 3, `re-seed banks nothing new (added=${res2.added}, skipped=${res2.skipped})`);
  } finally {
    rmSync(sd, { recursive: true, force: true });
  }

  console.log(`seed-examples self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`seed-examples self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main();
  }
}
