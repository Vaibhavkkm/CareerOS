#!/usr/bin/env node
// scripts/board.mjs — the job-match board.
//
// Pulls openings (already-scraped data/jds/*.md, the scan inbox, and any --urls),
// scores each against the user's master CV with match-score.mjs, then filters and
// ranks by match band + recency and prints a board. The agent then offers a
// one-command tailor (`/og build-cv <n>`). Deterministic + zero-token except for
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

import { scoreMatch, bandRank, STARS } from './match-score.mjs';
import { fetchPosting, saveJd } from './fetch-jd.mjs';
import { runPool } from './scan.mjs';

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
    const parts = heading[1].split(' — ');
    out.role = (parts[0] || '').trim();
    out.company = (parts[1] || '').trim();
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
  return Math.max(0, Math.floor((t - p) / 86_400_000));
}
export function ageLabel(posted, today) {
  const d = ageDays(posted, today);
  if (d == null) return 'date n/a';
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
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
    r = r.filter((x) => { const a = ageDays(x.posted, today); return a != null && a <= recentDays; });
  }
  r.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ap = a.posted ? Date.parse(a.posted) : -Infinity;
    const bp = b.posted ? Date.parse(b.posted) : -Infinity;
    return (bp || -Infinity) - (ap || -Infinity);
  });
  return r;
}

export function renderBoard(rows, { today } = {}) {
  const n = rows.length;
  const lines = [`OfferForge — job match board (${n} opening${n === 1 ? '' : 's'})`, ''];
  if (!n) {
    lines.push('  No openings to show. Run `/og scan`, pass `--urls "<job url>"`, or share a job URL.');
    return lines.join('\n');
  }
  rows.forEach((r, i) => {
    const stars = (STARS[r.band] || '·').padEnd(4);
    lines.push(`  ${String(i + 1).padStart(2)}. ${stars} ${r.band.padEnd(11)} ${r.company || '?'} — ${r.role || '?'}`);
    lines.push(`        ${ageLabel(r.posted, today).padEnd(10)} match ${r.score}   has: ${(r.have || []).slice(0, 8).join(', ') || '—'}`);
    if ((r.gap || []).length) lines.push(`        gap: ${r.gap.slice(0, 6).join(', ')}`);
  });
  lines.push('', '  → tailor any one in one command:  /og build-cv <number>');
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

// ─── main ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { urls: [], min: null, recent: null, json: false, selfTest: false, save: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--json') out.json = true;
    else if (a === '--no-save') out.save = false;
    else if (a === '--urls') out.urls = String(val()).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--urls=')) out.urls = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--min') out.min = val();
    else if (a.startsWith('--min=')) out.min = a.slice(6);
    else if (a === '--recent') out.recent = parseInt(val(), 10);
    else if (a.startsWith('--recent=')) out.recent = parseInt(a.slice(9), 10);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  if (!existsSync(CV_PATH)) {
    console.error('error: data/cv.master.md not found — run `/og onboard` first.');
    process.exit(2);
  }
  const cv = readFileSync(CV_PATH, 'utf8');
  const today = new Date().toISOString().slice(0, 10);

  // 1) postings already saved locally (zero network)
  const candidates = readSavedJds();
  const haveUrl = new Set(candidates.map((c) => c.url).filter(Boolean));

  // 2) URLs to fetch: explicit --urls + inbox entries we haven't saved yet
  const toFetch = [...args.urls, ...readInboxUrls().map((e) => e.url)]
    .filter((u, i, arr) => u && !haveUrl.has(u) && arr.indexOf(u) === i);

  const fetched = await runPool(toFetch.map((u) => async () => {
    try {
      const res = await fetchPosting(u);
      if (!res.ok || !res.posting) return null;
      if (args.save) { try { saveJd(res.posting, today); } catch { /* ignore save error */ } }
      return { ...res.posting, jd_path: '', source: res.source };
    } catch { return null; }
  }), 6);
  candidates.push(...fetched.filter(Boolean));

  // 3) score + assemble
  const rows = candidates.map((c) => {
    const s = scoreMatch(c.content || '', cv);
    return {
      company: c.company, role: c.role, url: c.url, posted: c.posted || '',
      jd_path: c.jd_path || '', source: c.source,
      score: s.score, band: s.band, have: s.have, gap: s.gap,
    };
  });
  const board = assembleBoard(rows, { minBand: args.min, recentDays: Number.isFinite(args.recent) ? args.recent : null, today });

  if (args.json) {
    console.log(JSON.stringify({ ok: true, today, count: board.length, rows: board }, null, 2));
  } else {
    console.log(renderBoard(board, { today }));
  }
  process.exit(0);
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

  // parseInboxLine
  const il = parseInboxLine('- [ ] https://acme.io/jobs/1 | Acme Inc | Backend Engineer');
  ok(il && il.url === 'https://acme.io/jobs/1' && il.company === 'Acme Inc' && il.title === 'Backend Engineer', 'parse inbox line');
  ok(parseInboxLine('garbage no url') === null, 'inbox line without url → null');
  ok(parseInboxLine('see https://x.io/y here').url === 'https://x.io/y', 'inbox bare-url fallback');

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

  // renderBoard produces a numbered board with the build-cv hint
  const out = renderBoard(strongPlus, { today });
  ok(out.includes('job match board') && /\b1\.\s/.test(out) && out.includes('/og build-cv'), 'renderBoard shows numbered rows + tailor hint');
  ok(renderBoard([], { today }).includes('No openings'), 'renderBoard empty state');

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
