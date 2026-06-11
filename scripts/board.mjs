#!/usr/bin/env node
// scripts/board.mjs — the job-match board.
//
// Pulls openings (already-scraped data/jds/*.md, the scan inbox, and any --urls),
// scores each against the user's master CV with match-score.mjs, then filters and
// ranks by match band + recency and prints a board. The agent then offers a
// one-command tailor (`/cos build-cv <n>`). Deterministic + zero-token except for
// fetching URLs that aren't already saved locally.
//
// Usage:
//   node scripts/board.mjs                       # board from data/jds/* + inbox
//   node scripts/board.mjs --urls "u1,u2"        # add specific postings (fetched)
//   node scripts/board.mjs --min strong          # only Strong+ matches
//   node scripts/board.mjs --recent 14           # only posted within 14 days
//   node scripts/board.mjs --json | --self-test

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import assert from 'node:assert/strict';

import { scoreMatch, bandRank, STARS, buildCorpusIdf, prepCv, normTokens, fitScore } from './match-score.mjs';
import { fetchPosting, saveJd } from './fetch-jd.mjs';
import { runPool } from './scan.mjs';
import { extractLanguages, formatLanguages } from '../lib/languages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CV_PATH = join(ROOT, 'data', 'cv.master.md');
const JDS_DIR = join(ROOT, 'data', 'jds');
const INBOX = join(ROOT, 'data', 'inbox.md');

// ─── pure parsing/format helpers (exported for tests) ─────────────────

// Parse a data/jds/*.md file (the format fetch-jd writes) back into fields.
export function parseJdMarkdown(text) {
  const src = String(text || '');
  const out = { role: '', company: '', url: '', location: '', posted: '', content: '' };
  const heading = src.match(/^#\s+(.+)$/m);
  if (heading) {
    // "Role — Company"; split on the LAST em-dash so a role containing an
    // em-dash isn't truncated (company is the final segment).
    const parts = heading[1].split(/\s+—\s+/);
    if (parts.length > 1) {
      out.company = parts.pop().trim();
      out.role = parts.join(' — ').trim();
    } else {
      out.role = heading[1].trim();
    }
  }
  const field = (label) => {
    const m = src.match(new RegExp(`^-\\s*${label}:\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : '';
  };
  out.url = field('URL');
  out.location = field('Location');
  out.posted = field('Posted');
  const body = src.split(/^##\s+Full posting\s*$/m)[1] || '';
  out.content = body.split(/^##\s+/m)[0].trim();
  return out;
}

// Parse an inbox.md line: "- [ ] <url> | <company> | <title>".
export function parseInboxLine(line) {
  const m = String(line).match(/^\s*-\s*\[[ xX]\]\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/);
  if (m) return { url: m[1], company: m[2].trim(), title: m[3].trim() };
  const u = String(line).match(/https?:\/\/\S+/);
  return u ? { url: u[0], company: '', title: '' } : null;
}

// Whole days between a posted date (YYYY-MM-DD) and today; null if unparseable.
export function ageDays(posted, today) {
  if (!posted) return null;
  const p = Date.parse(posted), t = Date.parse(today);
  if (Number.isNaN(p) || Number.isNaN(t)) return null;
  // Real age — may be NEGATIVE for a future-dated post (bad scrape / ATS go-live
  // date). Callers must not treat a negative age as "0 days old"; that would let
  // future posts slip through `--recent N` and sort to the very top.
  return Math.floor((t - p) / 86_400_000);
}
export function ageLabel(posted, today) {
  const d = ageDays(posted, today);
  if (d == null || d < 0) return 'date n/a'; // future-dated → treat the date as unknown
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// Score one candidate posting into a board row. Extracted so the pinned row (which
// may come from the pre-filter set) is built exactly like every other row.
// `jdToks` (optional) = the posting's pre-tokenized content, when the caller
// already tokenized it for the corpus idf.
function scoreRow(c, cv, scoreCtx, jdToks = null) {
  const s = scoreMatch(c.content || '', cv, jdToks ? { ...scoreCtx, jdToks } : scoreCtx);
  return {
    company: c.company, role: c.role, url: c.url, posted: c.posted || '',
    location: c.location || '', experience: extractExperience(c.content || ''),
    languages: formatLanguages(extractLanguages(c.content || ''), { max: 4 }),
    jd_path: c.jd_path || '', source: c.source,
    score: s.score, fit: fitScore(s.score), band: s.band, have: s.have, gap: s.gap,
  };
}

// Filter + rank rows. minBand keeps that band or better; recentDays keeps only
// postings with a known date within the window. Sort: best match first, then most
// recently posted (unknown dates sink).
export function assembleBoard(rows, { minBand = null, recentDays = null, today } = {}) {
  let r = rows.slice();
  if (minBand) {
    const lim = bandRank(minBand);
    r = r.filter((x) => bandRank(x.band) <= lim);
  }
  if (recentDays != null) {
    // a >= 0 excludes future-dated posts; a <= recentDays keeps the window.
    r = r.filter((x) => { const a = ageDays(x.posted, today); return a != null && a >= 0 && a <= recentDays; });
  }
  const tParsed = Date.parse(today);
  const cap = Number.isNaN(tParsed) ? Infinity : tParsed; // don't let future dates jump the queue
  r.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ap = a.posted ? Math.min(Date.parse(a.posted), cap) : -Infinity;
    const bp = b.posted ? Math.min(Date.parse(b.posted), cap) : -Infinity;
    return (bp || -Infinity) - (ap || -Infinity);
  });
  return r;
}

// Force a just-fetched posting to the very top so the user can find it instead of
// hunting for it among hundreds of score-ranked rows. `pinnedRow` is the already-
// resolved (and scored) row to pin, or null/undefined for a no-op. The CALLER resolves
// it from the FULL pre-filter set, so an explicit pin shows even when the active
// location / country / type / band / recency filters would otherwise hide it. The row
// is flagged `pinned:true`, placed first, de-duped from the rest, then capped to `limit`.
export function pinToTop(board, pinnedRow, limit) {
  const capped = (n) => (limit > 0 ? n.slice(0, limit) : n);
  if (!pinnedRow) return capped(board);
  pinnedRow.pinned = true;
  return capped([pinnedRow, ...board.filter((x) => x.url !== pinnedRow.url)]);
}

// Resolve a --pin URL to its candidate. Dedup-aware: the same job is often
// syndicated on several boards, so the URL the user just pasted may have been
// COLLAPSED into a richer duplicate saved under a different URL — in that case
// pin the surviving representative (matched by the same company+role signature
// dedupeCandidates uses), so "pinned to the top" never silently misses.
export function resolvePin(unique, candidates, pinUrl) {
  if (!pinUrl) return null;
  const direct = unique.find((c) => c.url && c.url === pinUrl);
  if (direct) return direct;
  const lost = candidates.find((c) => c.url === pinUrl);
  if (!lost) return null;
  const sig = dupSignature(lost.company, lost.role);
  return (sig && unique.find((c) => dupSignature(c.company, c.role) === sig)) || null;
}

export function renderBoard(rows, { today, total } = {}) {
  const n = rows.length;
  const head = (total && total !== n)
    ? `CareerOS — job match board (${total} openings; showing top ${n})`
    : `CareerOS — job match board (${n} opening${n === 1 ? '' : 's'})`;
  const lines = [head, ''];
  if (!n) {
    lines.push('  No openings to show. Run `/cos scan`, pass `--urls "<job url>"`, or share a job URL.');
    return lines.join('\n');
  }
  rows.forEach((r, i) => {
    const stars = (STARS[r.band] || '·').padEnd(4);
    const exp = r.experience ? ` · needs ${r.experience}` : '';
    const lang = r.languages ? ` · lang: ${r.languages}` : '';
    lines.push(`  ${String(i + 1).padStart(2)}. ${stars} ${r.band.padEnd(11)} ${r.company || '?'} — ${r.role || '?'}`);
    lines.push(`        ${ageLabel(r.posted, today).padEnd(10)} fit ${r.fit ?? '?'}/10${exp}${lang}   has: ${(r.have || []).slice(0, 8).join(', ') || '—'}`);
    if ((r.gap || []).length) lines.push(`        gap: ${r.gap.slice(0, 6).join(', ')}`);
  });
  lines.push('', '  → tailor any one in one command:  /cos build-cv <number>');
  return lines.join('\n');
}

// ─── candidate gathering (I/O) ────────────────────────────────────────
function readSavedJds() {
  if (!existsSync(JDS_DIR)) return [];
  return readdirSync(JDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const p = parseJdMarkdown(readFileSync(join(JDS_DIR, f), 'utf8'));
      return { ...p, jd_path: `data/jds/${f}`, source: 'saved' };
    })
    .filter((p) => p.content);
}
function readInboxUrls() {
  if (!existsSync(INBOX)) return [];
  return readFileSync(INBOX, 'utf8').split('\n').map(parseInboxLine).filter(Boolean);
}

// ─── dedup of saved postings ──────────────────────────────────────────
// The same job can be saved as MORE THAN ONE jd file — e.g. scraped from two
// boards under different URLs, or saved once with the company split out of the
// heading ("Role" / "Company") and once with it left in ("Role — Company" / "").
// Signature = the SORTED UNIQUE significant tokens of company+role, so both forms
// collapse to the same key regardless of split or token order.
export function dupSignature(company, role) {
  const toks = `${company || ''} ${role || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
  return [...new Set(toks)].sort().join(' ');
}

// Collapse duplicate postings, keeping the richest representative of each (one with
// a real posted date / a non-empty company / a fuller description).
export function dedupeCandidates(cands) {
  const byUrl = new Map();
  const bySig = new Map();
  const out = [];
  const rich = (x) => (x.posted ? 2 : 0) + (x.company ? 1 : 0) + ((x.content || '').length > 200 ? 1 : 0);
  for (const c of cands) {
    const url = c.url || '';
    const sig = dupSignature(c.company, c.role);
    let i = (url && byUrl.has(url)) ? byUrl.get(url) : (sig && bySig.has(sig) ? bySig.get(sig) : -1);
    if (i >= 0) {
      if (rich(c) > rich(out[i])) out[i] = c;
    } else {
      i = out.length;
      out.push(c);
    }
    if (url) byUrl.set(url, i);
    if (sig) bySig.set(sig, i);
  }
  return out;
}

// ─── display filters (country / city / type) ──────────────────────────
// JobSpy locations end with a country CODE ("Luxembourg, L0L, LU"), so match the
// chosen country by its code OR its full name; city is a plain substring.
const COUNTRY_CODES = {
  luxembourg: 'lu', 'united states': 'us', canada: 'ca', 'united kingdom': 'gb',
  germany: 'de', france: 'fr', belgium: 'be', netherlands: 'nl', switzerland: 'ch',
  italy: 'it', india: 'in',
};
export function matchesLocation(loc, { country = '', city = '' } = {}) {
  const L = String(loc || '').toLowerCase();
  const cty = String(city || '').trim().toLowerCase();
  if (cty && !L.includes(cty)) return false;
  const c = String(country || '').trim().toLowerCase();
  if (c && c !== 'all countries') {
    const code = COUNTRY_CODES[c];
    const hasName = L.includes(c);
    const hasCode = code ? new RegExp(`(^|[\\s,])${code}([\\s,]|$)`).test(L) : false;
    if (!hasName && !hasCode) return false;
  }
  return true;
}
// The text a job-type filter is tested against: the ROLE TITLE plus any
// explicitly-labelled employment-type line in the body. We deliberately do NOT
// scan the whole description — words like "intern", "contract", "stage", "PhD"
// appear in the prose of unrelated roles ("mentor our interns", "early-stage
// startup", "PhD preferred"), which made the filter leak non-matching jobs.
export function employmentTypeText(role, content) {
  const labels = /^\s*(employment type|type of employment|job type|position type|work type|contract type|type of contract|type d['’ ]?emploi|type de contrat|vertragsart|anstellungsart)\s*[:\-]/i;
  const lines = String(content || '').split('\n').filter((l) => labels.test(l));
  return `${role || ''} ${lines.slice(0, 4).join(' ')}`.trim();
}

// Job type isn't stored structurally per JD, so classify best-effort from the
// role title (+ an explicit employment-type line). "fulltime" means "permanent" →
// anything that ISN'T an internship/part-time/temp/academic-fixed-term role.
export function matchesType(text, type) {
  const ty = String(type || '').trim().toLowerCase();
  if (!ty) return true;
  const t = String(text || '').toLowerCase();
  const isPostdoc = /\b(post[-\s]?doc(?:s)?|post[-\s]?doctoral|postdoctoral|post[-\s]?doctorate)\b/.test(t);
  // PhD but NOT postdoc (a "postdoc" line also contains "doc"); exclude when postdoc matched.
  const isPhd = !isPostdoc && /\b(ph[\s.]?d|d\.?phil|doctoral|doctorate|doctoral researcher|doctoral candidate|doctorant|doktorand)\b/.test(t);
  // Internship is INDEPENDENT of phd/postdoc — a "PhD Internship" is genuinely both,
  // so it surfaces under the Internship filter AND the PhD filter (no precedence).
  const isIntern = /\b(intern|interns|internship|trainee|working student|praktik\w*|stage|stagiaire|apprentic\w*|placement|graduate program(?:me)?)\b/.test(t);
  const isPart = /\b(part[-\s]?time|teilzeit)\b/.test(t);
  const isTemp = /\b(fixed[-\s]?term|temporary|\btemp\b|cdd|interim|seasonal)\b/.test(t);
  // 'consultant' alone is dropped — it's a permanent job title at consulting firms
  // ("Senior Consultant"), not a contract signal. Keep contractor/freelance/b2b.
  const isContract = /\b(contract|contractor|freelance|freelancer|b2b)\b/.test(t);
  switch (ty) {
    case 'internship': return isIntern;
    case 'phd': return isPhd;
    case 'postdoc': return isPostdoc;
    case 'parttime': return isPart;
    case 'temporary': return isTemp;
    case 'contract': return isContract;
    // permanent = none of the non-permanent classes (incl. contract, so the bands
    // are mutually exclusive — a "Contract Engineer" is not full-time).
    case 'fulltime': return !isIntern && !isPart && !isTemp && !isPhd && !isPostdoc && !isContract;
    default: return true;
  }
}

// Best-effort "years of experience required", parsed from the JD text. Returns a
// short label ('3–5 yrs', '5+ yrs') or '' when none is stated. Prefers ranges, then
// explicit "N+ years", then a year-count in an experience context.
export function extractExperience(text) {
  const t = String(text || '').toLowerCase();
  // Reject implausible values (>15 yrs is almost always noise) and AGE requirements
  // ("at least 18 years old / of age"), which would otherwise read as experience.
  const ok = (lo, hi) => {
    const n = Number(lo);
    if (!(n >= 1 && n <= 15)) return '';
    return (hi && hi !== lo) ? `${lo}–${hi} yrs` : `${lo}+ yrs`;
  };
  const NOAGE = '(?!\\s*(?:old|of age))';
  let m = t.match(new RegExp(`(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\s*\\+?\\s*(?:years?|yrs?)${NOAGE}`));
  if (m) { const r = ok(m[1], m[2]); if (r) return r; }
  m = t.match(new RegExp(`(\\d{1,2})\\s*\\+\\s*(?:years?|yrs?)${NOAGE}`));     // "5+ years"
  if (m) { const r = ok(m[1]); if (r) return r; }
  m = t.match(/(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp|relevant|professional|work|industry)/);
  if (m) { const r = ok(m[1]); if (r) return r; }
  m = t.match(new RegExp(`(?:experience|minimum|at least|min\\.?)[^.\\d]{0,24}?(\\d{1,2})\\s*\\+?\\s*(?:years?|yrs?)${NOAGE}`));
  if (m) { const r = ok(m[1]); if (r) return r; }
  return '';
}

// ─── main ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  // JSON by default (consistent with the other scripts + how the board mode calls
  // it); --summary/--pretty renders the human board instead.
  const out = { urls: [], min: null, recent: null, country: '', city: '', type: '', limit: 0, pin: '', json: true, selfTest: false, save: true, fetch: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--json') out.json = true;
    else if (a === '--summary' || a === '--pretty') out.json = false;
    else if (a === '--no-save') out.save = false;
    else if (a === '--no-fetch') out.fetch = false;
    else if (a === '--urls') out.urls = String(val()).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--urls=')) out.urls = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--min') out.min = val();
    else if (a.startsWith('--min=')) out.min = a.slice(6);
    else if (a === '--recent') out.recent = parseInt(val(), 10);
    else if (a.startsWith('--recent=')) out.recent = parseInt(a.slice(9), 10);
    else if (a === '--country') out.country = val();
    else if (a.startsWith('--country=')) out.country = a.slice(10);
    else if (a === '--city') out.city = val();
    else if (a.startsWith('--city=')) out.city = a.slice(7);
    else if (a === '--type') out.type = val();
    else if (a.startsWith('--type=')) out.type = a.slice(7);
    else if (a === '--limit') out.limit = parseInt(val(), 10) || 0;
    else if (a.startsWith('--limit=')) out.limit = parseInt(a.slice(8), 10) || 0;
    else if (a === '--pin') out.pin = val();
    else if (a.startsWith('--pin=')) out.pin = a.slice(6);
  }
  return out;
}

const USAGE = `board — rank open roles by how well they match your CV.
Usage: node scripts/board.mjs [--urls "u1,u2"] [--min <band>] [--recent <days>] [--country <c>] [--city <c>] [--type <t>] [--limit <n>] [--summary]
  --min <band>     keep only that band or better (STRONGEST|Very strong|Strong|Moderate|Weak)
  --recent <days>  keep only postings dated within N days
  --country <c>    keep only postings in this country (matches the location code/name)
  --city <c>       keep only postings whose location contains this city
  --type <t>       keep only this job type (internship|phd|postdoc|fulltime|contract|temporary|parttime)
  --limit <n>      cap returned rows (default 200; full count still reported)
  --pin <url>      force this posting to the top of the board (e.g. a just-fetched URL)
  --summary        render the human board (default: JSON)
  --no-save        don't save fetched postings to data/jds/
  --no-fetch       render from saved postings only — never hit the network (web UI path)
  --self-test      run built-in tests`;

async function main() {
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
  const today = new Date().toISOString().slice(0, 10);

  // 1) postings already saved locally (zero network)
  const candidates = readSavedJds();
  const haveUrl = new Set(candidates.map((c) => c.url).filter(Boolean));

  // 2) URLs to fetch: explicit --urls + inbox entries we haven't saved yet.
  // --no-fetch (how the web /api/board calls this) skips the network stage
  // entirely: a board RENDER must never block on live fetches — unsaved inbox
  // URLs that 403 forever would otherwise be retried on every single page load.
  const toFetch = args.fetch
    ? [...args.urls, ...readInboxUrls().map((e) => e.url)]
        .filter((u, i, arr) => u && !haveUrl.has(u) && arr.indexOf(u) === i)
    : [];

  const fetched = await runPool(toFetch.map((u) => async () => {
    try {
      const res = await fetchPosting(u);
      if (!res.ok || !res.posting) return null;
      if (args.save) { try { saveJd(res.posting, today); } catch { /* ignore save error */ } }
      return { ...res.posting, jd_path: '', source: res.source };
    } catch { return null; }
  }), 6);
  candidates.push(...fetched.filter(Boolean));

  // Collapse duplicate saves of the same job (cross-board URLs, or company-split
  // heading variants) so it shows once on the board, not as several rows.
  const unique = dedupeCandidates(candidates);

  // Display filters: country/city/type restrict WHAT THE BOARD SHOWS (not just what a
  // fetch pulls), so the filter row actually filters the board.
  const filtered = unique.filter((c) =>
    matchesLocation(c.location, { country: args.country, city: args.city }) &&
    matchesType(employmentTypeText(c.role, c.content), args.type));

  // 3) score + assemble. ONE TF-IDF index across the shown postings + the CV makes the
  // cosine discriminative. Tokenize each JD ONCE (shared by the idf and the score)
  // and precompute every CV-side artifact ONCE (tokens/tf/keywords/vector) — on a
  // thousands-of-postings board this is most of the scoring CPU.
  const jdToksList = filtered.map((c) => normTokens(c.content || ''));
  const corpusIdf = buildCorpusIdf([...jdToksList, cv]);
  const cvPrep = prepCv(cv, { idf: corpusIdf });
  const scoreCtx = { idf: corpusIdf, cvKeywords: cvPrep.keywords, cv: cvPrep };
  const rows = filtered.map((c, i) => scoreRow(c, cv, scoreCtx, jdToksList[i]));
  const board = assembleBoard(rows, { minBand: args.min, recentDays: Number.isFinite(args.recent) ? args.recent : null, today });
  // Cap rendered rows for UI responsiveness; the full filtered count is still
  // reported as `count`, with `shown` = how many rows are returned. `--pin <url>`
  // forces a just-fetched posting to the top (and into the slice) regardless of rank
  // OR of the active filters: resolve it from `unique` (pre-filter) so a posting the
  // location/country/type filter would drop (e.g. one with no stated location) still pins.
  const limit = args.limit > 0 ? args.limit : 200;
  const pinHit = resolvePin(unique, candidates, args.pin);
  const pinnedRow = pinHit ? scoreRow(pinHit, cv, scoreCtx) : null;
  const shown = pinToTop(board, pinnedRow, limit);

  if (args.json) {
    console.log(JSON.stringify({ ok: true, today, count: board.length, shown: shown.length, rows: shown }, null, 2));
  } else {
    console.log(renderBoard(shown, { today, total: board.length }));
  }
  // Do NOT process.exit(0) here. stdout to a PIPE (how the web /api/board route
  // spawns this) is asynchronous; exiting before it drains truncates large
  // payloads at the ~64KB OS pipe buffer, so JSON.parse downstream fails with
  // "no JSON output". This bit only once the board grew past ~64KB (≈40+ rows).
  // Setting exitCode and returning lets Node flush stdout fully, then exit 0.
  process.exitCode = 0;
}

// ─── self-test ───────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // parseJdMarkdown round-trips the fetch-jd format
  const md = ['# Senior ML Engineer — Acme', '', '- Source: greenhouse', '- URL: https://x.io/j/1',
    '- Location: Remote', '- Posted: 2026-05-20', '- Fetched: 2026-06-07', '', '## Full posting', '',
    'Build ML pipelines in Python and Airflow.', '', '## Application questions', '', '- Why Acme?'].join('\n');
  const jd = parseJdMarkdown(md);
  eq(jd.role, 'Senior ML Engineer', 'parse role'); eq(jd.company, 'Acme', 'parse company');
  eq(jd.url, 'https://x.io/j/1', 'parse url'); eq(jd.posted, '2026-05-20', 'parse posted');
  ok(jd.content.includes('Build ML pipelines') && !jd.content.includes('Application questions'), 'parse body excludes later sections');
  // role containing an em-dash: company is the LAST segment, role keeps the rest
  const jd2 = parseJdMarkdown('# Senior — Staff Engineer — Acme Inc\n\n## Full posting\n\nx');
  eq(jd2.company, 'Acme Inc', 'multi-em-dash heading: company = last segment');
  eq(jd2.role, 'Senior — Staff Engineer', 'multi-em-dash heading: role = all but last');

  // parseInboxLine
  const il = parseInboxLine('- [ ] https://acme.io/jobs/1 | Acme Inc | Backend Engineer');
  ok(il && il.url === 'https://acme.io/jobs/1' && il.company === 'Acme Inc' && il.title === 'Backend Engineer', 'parse inbox line');
  ok(parseInboxLine('garbage no url') === null, 'inbox line without url → null');
  ok(parseInboxLine('see https://x.io/y here').url === 'https://x.io/y', 'inbox bare-url fallback');
  const il2 = parseInboxLine('-  [x]   https://x.io/j   |   Co   |   Role');
  ok(il2 && il2.url === 'https://x.io/j' && il2.company === 'Co' && il2.title === 'Role', 'inbox line tolerates extra whitespace');

  // age helpers
  eq(ageDays('2026-06-01', '2026-06-07'), 6, 'ageDays 6'); eq(ageDays('', '2026-06-07'), null, 'ageDays unknown');
  eq(ageLabel('2026-06-07', '2026-06-07'), 'today', 'ageLabel today');
  eq(ageLabel('2026-06-06', '2026-06-07'), '1d ago', 'ageLabel 1d');
  eq(ageLabel('', '2026-06-07'), 'date n/a', 'ageLabel unknown');

  // assembleBoard: filter by band + recency, sort by score then recency
  const today = '2026-06-10';
  const rows = [
    { company: 'A', role: 'r', score: 0.9, band: 'STRONGEST', posted: '2026-06-09' },
    { company: 'B', role: 'r', score: 0.5, band: 'Strong', posted: '2026-06-08' },
    { company: 'C', role: 'r', score: 0.3, band: 'Weak', posted: '2026-06-09' },
    { company: 'D', role: 'r', score: 0.62, band: 'Strong', posted: '2026-01-01' }, // old
    { company: 'E', role: 'r', score: 0.7, band: 'Very strong', posted: '' },       // unknown date
  ];
  const all = assembleBoard(rows, { today });
  eq(all[0].company, 'A', 'sort: highest score first');
  ok(all.findIndex((x) => x.company === 'E') > all.findIndex((x) => x.company === 'A'), 'unknown-date row sinks below dated higher-score');

  const strongPlus = assembleBoard(rows, { minBand: 'Strong', today });
  ok(strongPlus.every((x) => bandRank(x.band) <= bandRank('Strong')), 'min band filters out Weak');
  ok(!strongPlus.some((x) => x.company === 'C'), 'Weak row excluded by --min strong');

  const recent = assembleBoard(rows, { recentDays: 7, today });
  ok(!recent.some((x) => x.company === 'D'), 'old posting excluded by --recent 7');
  ok(!recent.some((x) => x.company === 'E'), 'unknown-date posting excluded by --recent');

  // pinToTop: the caller resolves the pinned row (filter-proof); it's forced first,
  // flagged, deduped, and survives the cap.
  const pinRows = [
    { company: 'A', role: 'r', score: 0.9, band: 'STRONGEST', posted: '2026-06-09', url: 'https://x/a' },
    { company: 'B', role: 'r', score: 0.5, band: 'Strong', posted: '2026-06-08', url: 'https://x/b' },
    { company: 'C', role: 'r', score: 0.3, band: 'Weak', posted: '2026-06-09', url: 'https://x/c' },
  ];
  const findRow = (url) => pinRows.find((r) => r.url === url); // mimic resolving from the pre-filter set
  const pinBoard = assembleBoard(pinRows, { today });
  const pinned = pinToTop(pinBoard, findRow('https://x/c'), 0);
  eq(pinned[0].url, 'https://x/c', 'pinToTop: pinned url is first even with the lowest score');
  ok(pinned[0].pinned === true, 'pinToTop: pinned row flagged');
  eq(pinned.filter((x) => x.url === 'https://x/c').length, 1, 'pinToTop: pinned row not duplicated');
  eq(pinned.length, pinBoard.length, 'pinToTop: no rows lost');
  // filter-proof: pin a row the band filter removed from `board`; resolved from the
  // full set, it still surfaces on top (this is the real bug fix — a location/band/
  // type filter must not be able to hide the posting the user explicitly fetched).
  const filtered = assembleBoard(pinRows, { minBand: 'Strong', today }); // drops C
  ok(!filtered.some((x) => x.url === 'https://x/c'), 'precondition: band filter dropped C from the board');
  const pinnedC = pinToTop(filtered, findRow('https://x/c'), 0);
  eq(pinnedC[0].url, 'https://x/c', 'pinToTop: surfaces a row the filter removed from the board');
  // limit still applies, pinned survives the cap
  const capped = pinToTop(pinBoard, findRow('https://x/c'), 1);
  eq(capped.length, 1, 'pinToTop: respects limit');
  eq(capped[0].url, 'https://x/c', 'pinToTop: pinned row survives the cap');
  eq(pinToTop(pinBoard, null, 0).length, pinBoard.length, 'pinToTop: null pinned row is a no-op');
  eq(pinToTop(pinBoard, undefined, 0)[0].url, pinBoard[0].url, 'pinToTop: undefined pinned row leaves order unchanged');

  // renderBoard produces a numbered board with the build-cv hint
  const out = renderBoard(strongPlus, { today });
  ok(out.includes('job match board') && /\b1\.\s/.test(out) && out.includes('/cos build-cv'), 'renderBoard shows numbered rows + tailor hint');
  ok(renderBoard([], { today }).includes('No openings'), 'renderBoard empty state');

  // dedupeCandidates: the same job split two ways (company in field vs in heading,
  // different URLs) collapses to ONE, keeping the representative WITH a posted date.
  ok(dupSignature('LIST', 'DataOps Engineer') === dupSignature('', 'DataOps Engineer — LIST'),
    'dupSignature: company-split variants share a signature');
  const deduped = dedupeCandidates([
    { company: 'LIST', role: 'DataOps Engineer', url: 'https://a/1', posted: '2026-06-01', content: 'x'.repeat(300) },
    { company: '', role: 'DataOps Engineer — LIST', url: 'https://b/2', posted: '', content: 'x' },
    { company: 'Acme', role: 'Data Engineer', url: 'https://c/3', posted: '2026-06-02', content: 'y'.repeat(300) },
  ]);
  eq(deduped.length, 2, 'dedupeCandidates: collapses the two LIST saves into one');
  ok(deduped.some((d) => d.company === 'LIST' && d.posted === '2026-06-01'), 'dedupeCandidates: keeps the richer (dated) representative');
  ok(deduped.some((d) => d.company === 'Acme'), 'dedupeCandidates: keeps the distinct job');

  // resolvePin: a pinned URL that dedup collapsed into a richer duplicate (same job,
  // different board) still resolves — to the surviving representative.
  const pinCands = [
    { company: 'LIST', role: 'DataOps Engineer', url: 'https://a/1', posted: '2026-06-01', content: 'x'.repeat(300) },
    { company: '', role: 'DataOps Engineer — LIST', url: 'https://b/2', posted: '', content: 'x' },
  ];
  const pinUniq = dedupeCandidates(pinCands);
  eq(resolvePin(pinUniq, pinCands, 'https://a/1').url, 'https://a/1', 'resolvePin: direct url hit');
  eq(resolvePin(pinUniq, pinCands, 'https://b/2').url, 'https://a/1', 'resolvePin: deduped url pins the surviving representative');
  eq(resolvePin(pinUniq, pinCands, 'https://nope/9'), null, 'resolvePin: unknown url → null');
  eq(resolvePin(pinUniq, pinCands, ''), null, 'resolvePin: empty pin → null');

  // display filters: country/city/type actually filter the board
  ok(matchesLocation('Luxembourg, L0L, LU', { country: 'Luxembourg' }), 'matchesLocation: LU by code');
  ok(matchesLocation('New York, NY, US', { country: 'United States' }), 'matchesLocation: US by code');
  ok(!matchesLocation('New York, NY, US', { country: 'Luxembourg' }), 'matchesLocation: excludes other country');
  ok(matchesLocation('Toronto, ON, CA', { city: 'toronto' }), 'matchesLocation: city substring');
  ok(!matchesLocation('Toronto, ON, CA', { city: 'berlin' }), 'matchesLocation: city excludes');
  ok(matchesLocation('anywhere', {}), 'matchesLocation: no filter passes');
  ok(matchesType('Data Science Intern', 'internship') && !matchesType('Senior Data Engineer', 'internship'), 'matchesType: internship');
  ok(matchesType('Senior Data Engineer', 'fulltime') && !matchesType('Summer Internship', 'fulltime'), 'matchesType: fulltime excludes internships');
  // employmentTypeText: a permanent role whose BODY merely mentions "intern" must NOT match internship
  ok(!matchesType(employmentTypeText('Senior Data Scientist', 'You will mentor our interns and run the internship program.'), 'internship'),
    'matchesType: body-only "intern" does not leak into internship filter');
  ok(matchesType(employmentTypeText('Data Analyst', 'Employment Type: Internship\n6-month placement.'), 'internship'),
    'matchesType: explicit "Employment Type: Internship" line matches');
  ok(matchesType(employmentTypeText('Senior Data Scientist', 'mentor our interns'), 'fulltime'),
    'matchesType: permanent role with body "interns" still counts as fulltime');
  // PhD / Post-Doc
  ok(matchesType('PhD Position in Machine Learning', 'phd') && !matchesType('Data Engineer', 'phd'), 'matchesType: phd');
  ok(matchesType('Doctoral Researcher in Climate Science', 'phd'), 'matchesType: doctoral -> phd');
  ok(matchesType('Postdoctoral Researcher in Genomics', 'postdoc') && !matchesType('Postdoctoral Researcher', 'phd'), 'matchesType: postdoc not phd');
  ok(!matchesType('PhD Candidate', 'internship') && !matchesType('Postdoc Fellow', 'fulltime'), 'matchesType: phd/postdoc without an intern keyword stay out of intern & fulltime');
  // a "PhD Internship" is genuinely both → it lists under the Internship filter AND the PhD filter
  ok(matchesType('PhD Internship - Summer 2026', 'internship') && matchesType('PhD Internship - Summer 2026', 'phd'),
    'matchesType: PhD Internship lists under BOTH internship and phd');
  ok(!matchesType('PhD Internship - Summer 2026', 'fulltime'), 'matchesType: PhD Internship is not fulltime');
  // contract vs fulltime are mutually exclusive; bare "consultant" stays permanent
  ok(matchesType('Contract Data Engineer', 'contract') && !matchesType('Contract Data Engineer', 'fulltime'),
    'matchesType: contract role excluded from fulltime');
  ok(matchesType('Senior Consultant', 'fulltime') && !matchesType('Senior Consultant', 'contract'),
    'matchesType: bare "consultant" is permanent, not contract');
  eq(extractExperience('We need 3-5 years of experience'), '3–5 yrs', 'experience: range');
  eq(extractExperience('Requires 5+ years in data'), '5+ yrs', 'experience: N+');
  eq(extractExperience('Join our great team'), '', 'experience: none');
  eq(extractExperience('You must be at least 18 years old to apply'), '', 'experience: ignores age requirement');
  eq(extractExperience('20+ years required'), '', 'experience: rejects implausible (>15)');
  // language requirement wired in (full coverage lives in lib/languages.mjs self-test)
  eq(formatLanguages(extractLanguages('Language: English is required, French is an asset.')),
    'English (req), French (plus)', 'languages: board wires extraction');
  eq(extractLanguages('Experience with Go, Rust and Java.').length, 0, 'languages: no prog-lang false positives');

  console.log(`board self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`board self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main().catch((e) => { console.error(`Fatal: ${e.message}`); process.exit(1); });
  }
}
