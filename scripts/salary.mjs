#!/usr/bin/env node
// scripts/salary.mjs — deterministic salary-band extraction from a JD (zero tokens).
//
// Pulls a stated pay range out of a posting's text and normalises it to a compact
// label the board can show and the `negotiate` mode can anchor on. It reads ONLY
// what the posting states — it never estimates or invents a number (guardrail: no
// fabrication). When a JD names no pay, it says so ("" / disclosed:false).
//
// Handles: ranges and single figures, k-suffixes (90k), thousands separators
// (120,000), currency symbols ($ € £ ₹) and codes (USD/EUR/GBP/CHF/INR), and the
// pay PERIOD (year/month/day/hour), defaulting to annual for large figures.
//
// Used by board.mjs (a `salary` column) and modes/negotiate.md (the anchor).
//
// Usage:
//   node scripts/salary.mjs --jd <file|text> [--summary]   # one posting
//   node scripts/salary.mjs                                 # scan data/jds/*
//   node scripts/salary.mjs --self-test

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { parseJdMarkdown } from './board.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JDS_DIR = join(ROOT, 'data', 'jds');

// Currency symbol / ISO code → a short display symbol.
const SYMBOLS = { '$': '$', '€': '€', '£': '£', '₹': '₹', 'chf': 'CHF', 'usd': '$', 'eur': '€', 'gbp': '£', 'inr': '₹', 'cad': 'C$', 'aud': 'A$' };
const CODE_RE = /\b(usd|eur|gbp|chf|inr|cad|aud)\b/i;
const PERIOD_RE = /\b(per\s+(year|annum|yr|month|mo|week|day|hour|hr)|p\.?a\.?|\/(year|yr|month|mo|day|hour|hr)|annually|annual|hourly|monthly|weekly|daily)\b/i;

// ─── pure core (exported for --self-test) ─────────────────────────────

// Parse one money token ("$120,000", "90k", "1.2k", "€85K") → a number, or null.
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase().replace(/[, ]/g, '');
  const k = /k$/.test(s);
  const m = /m$/.test(s);
  s = s.replace(/[km]$/, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return k ? n * 1_000 : m ? n * 1_000_000 : n;
}

function normPeriod(text) {
  const m = String(text || '').match(PERIOD_RE);
  if (!m) return null;
  const t = m[0].toLowerCase();
  if (/hour|hr|hourly/.test(t)) return 'hour';
  if (/day|daily/.test(t)) return 'day';
  if (/week|weekly/.test(t)) return 'week';
  if (/month|\bmo\b|monthly/.test(t)) return 'month';
  return 'year';
}

function detectCurrency(window) {
  const w = String(window || '');
  const sym = w.match(/[$€£₹]/);
  if (sym) return SYMBOLS[sym[0]];
  const code = w.match(CODE_RE);
  if (code) return SYMBOLS[code[0].toLowerCase()] || code[0].toUpperCase();
  return '';
}

const fmt = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

// Extract the salary band from a posting's text → a structured result.
// { disclosed, currency, min, max, period, label, raw }. Never estimates.
export function extractSalary(text) {
  const src = String(text || '');
  const none = { disclosed: false, currency: '', min: null, max: null, period: null, label: '', raw: '' };
  if (!src.trim()) return none;

  // Anchor near a money cue (symbol, code, or the word salary/compensation/pay) so
  // we don't grab a random "5,000 users" number from the prose.
  const MONEY = '(?:[$€£₹]|\\b(?:usd|eur|gbp|chf|inr|cad|aud)\\b)';
  const NUM = '\\d{1,3}(?:[,.]\\d{3})*(?:\\.\\d+)?\\s?[kKmM]?';
  // Range: "$120,000 - $150,000", "90k–110k EUR", "€80K to €100K".
  const rangeRe = new RegExp(
    `(${MONEY})?\\s?(${NUM})\\s?(?:${MONEY})?\\s?(?:-|–|—|to)\\s?(${MONEY})?\\s?(${NUM})`, 'i');
  // Single: "Salary: $130,000", "up to €95k", "₹2,500,000 per annum".
  const singleRe = new RegExp(
    `(?:salary|compensation|pay|package|remuneration|up to|from)[^\\d$€£₹]{0,18}(${MONEY})?\\s?(${NUM})`, 'i');

  let mn = null, mx = null, currency = '', windowStart = 0;
  let rm = src.match(rangeRe);
  // Reject a "range" whose numbers are tiny (e.g. "3-5 years") — require a money cue
  // or a plausible pay magnitude.
  if (rm) {
    const a = parseAmount(rm[2]), b = parseAmount(rm[4]);
    const hasCue = rm[1] || rm[3] || CODE_RE.test(rm[0]) || /[$€£₹]/.test(rm[0]);
    const plausible = a != null && b != null && b >= a && (hasCue || a >= 1000);
    if (plausible) { mn = a; mx = b; windowStart = rm.index; }
    else rm = null;
  }
  if (mn == null) {
    const sm = src.match(singleRe);
    if (sm) {
      const v = parseAmount(sm[2]);
      const hasCue = sm[1] || /[$€£₹]/.test(sm[0]) || CODE_RE.test(sm[0]);
      if (v != null && (hasCue || v >= 1000)) { mn = v; mx = v; windowStart = sm.index; }
    }
  }
  if (mn == null) {
    // A money SYMBOL/CODE directly attached to a figure, with no cue word
    // ("CTC ₹2,500,000", "€85k package"). Require a real pay magnitude so a "$5
    // gift card" mention can't read as salary.
    const symRe = new RegExp(`(${MONEY})\\s?(${NUM})`, 'i');
    const xm = src.match(symRe);
    if (xm) {
      const v = parseAmount(xm[2]);
      if (v != null && v >= 1000) { mn = v; mx = v; windowStart = xm.index; }
    }
  }
  if (mn == null) return none;

  // Currency + period from a window around the match (cue may sit just before/after).
  const win = src.slice(Math.max(0, windowStart - 12), windowStart + 60);
  currency = detectCurrency(win) || detectCurrency(src);
  let period = normPeriod(win) || normPeriod(src);
  // Heuristic: a bare number ≥ 1000 with no period is almost always annual; a small
  // one (< 1000) with no period reads as hourly only if a money cue is present.
  if (!period) period = mx >= 1000 ? 'year' : 'hour';

  const perLabel = { year: '/yr', month: '/mo', week: '/wk', day: '/day', hour: '/hr' }[period] || '';
  const body = mn === mx ? `${currency}${fmt(mn)}` : `${currency}${fmt(mn)}–${currency}${fmt(mx)}`;
  const label = `${body}${perLabel}`;
  return { disclosed: true, currency, min: mn, max: mx, period, label, raw: (rm || src.match(singleRe))?.[0]?.trim() || '' };
}

// ─── I/O ──────────────────────────────────────────────────────────────
function readArg(v) {
  if (!v) return '';
  if (existsSync(v)) return readFileSync(v, 'utf8');
  return String(v);
}
function scanSavedJds() {
  if (!existsSync(JDS_DIR)) return [];
  return readdirSync(JDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const p = parseJdMarkdown(readFileSync(join(JDS_DIR, f), 'utf8'));
      return { company: p.company, role: p.role, salary: extractSalary(p.content) };
    });
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { jd: null, json: true, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (a === '--jd') out.jd = val();
    else if (a.startsWith('--jd=')) out.jd = a.slice(5);
  }
  return out;
}

const USAGE = `salary — extract a stated salary band from a posting (never estimates).
Usage: node scripts/salary.mjs [--jd <file|text>] [--summary]
  --jd <file|text>  one posting; omit to scan data/jds/*
  --summary         human-readable output (default: JSON)
  --self-test       run built-in tests`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();

  if (args.jd != null) {
    const res = extractSalary(readArg(args.jd));
    if (args.json) console.log(JSON.stringify(res, null, 2));
    else console.log(res.disclosed ? `salary: ${res.label} (${res.period})` : 'salary: not disclosed');
    process.exit(0);
  }
  const rows = scanSavedJds();
  const disclosed = rows.filter((r) => r.salary.disclosed);
  if (args.json) {
    console.log(JSON.stringify({ ok: true, total: rows.length, disclosed: disclosed.length, rows }, null, 2));
  } else {
    console.log(`CareerOS — salary scan (${disclosed.length}/${rows.length} postings disclose pay)\n`);
    for (const r of disclosed) console.log(`  ${r.salary.label.padEnd(16)} ${r.company || '?'} — ${r.role || '?'}`);
    if (!disclosed.length) console.log('  No saved postings disclose a salary.');
  }
  process.exit(0);
}

// ─── self-test ───────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // parseAmount
  eq(parseAmount('120,000'), 120000, 'parseAmount thousands separator');
  eq(parseAmount('90k'), 90000, 'parseAmount k-suffix');
  eq(parseAmount('1.2k'), 1200, 'parseAmount decimal k');
  eq(parseAmount('2.5m'), 2_500_000, 'parseAmount m-suffix');
  eq(parseAmount('abc'), null, 'parseAmount junk → null');

  // ranges with symbols
  const a = extractSalary('Compensation: $120,000 - $150,000 per year, plus equity.');
  ok(a.disclosed && a.min === 120000 && a.max === 150000, 'extracts a $ range');
  eq(a.currency, '$', 'detects $'); eq(a.period, 'year', 'detects annual');
  eq(a.label, '$120k–$150k/yr', 'formats a range label');

  const e = extractSalary('Salary range 80k–100k EUR.');
  ok(e.disclosed && e.min === 80000 && e.max === 100000, 'extracts a k-range');
  eq(e.currency, '€', 'detects EUR code → €');

  // single figure
  const s = extractSalary('We offer a salary of £95,000 depending on experience.');
  ok(s.disclosed && s.min === 95000 && s.max === 95000, 'extracts a single figure');
  eq(s.currency, '£', 'detects £');

  // hourly
  const h = extractSalary('Pay: $45 per hour.');
  ok(h.disclosed && h.period === 'hour', 'detects hourly');
  eq(h.label, '$45/hr', 'hourly label');

  // INR per annum, large with thousands separators
  const inr = extractSalary('CTC ₹2,500,000 per annum.');
  ok(inr.disclosed && inr.min === 2500000 && inr.currency === '₹', 'extracts INR');

  // NOT a salary: "3-5 years of experience" must not be read as pay
  const exp = extractSalary('We need 3-5 years of experience and 10,000 daily users.');
  ok(!exp.disclosed, 'does not mistake "3-5 years" / user counts for salary');

  // empty / no pay
  ok(!extractSalary('').disclosed, 'empty → not disclosed');
  ok(!extractSalary('A great role on a great team.').disclosed, 'no pay stated → not disclosed');

  // "up to" single bound
  const up = extractSalary('Base salary up to €110k.');
  ok(up.disclosed && up.max === 110000, 'handles "up to" single bound');

  console.log(`salary self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`salary self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main();
  }
}
