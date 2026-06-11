#!/usr/bin/env node
// scripts/digest.mjs — "what's new since I last looked?" (zero tokens).
//
// Compares the current match board against a seen-ledger and reports only the
// delta: postings that are NEW, and postings whose match band IMPROVED (e.g. a
// JD was re-fetched with a fuller description). This is what turns CareerOS
// from a tool you remember to open into one that taps you on the shoulder:
// run it from cron right after a fetch —
//
//   node scripts/jobspy.mjs --country Luxembourg --recent 3 && node scripts/digest.mjs --summary
//
// State lives in data/digest-state.json (system-managed ledger, like
// scan-history.tsv). The digest itself goes to stdout as JSON, or to a
// markdown file with --write (default data/digest-latest.md) for the web panel
// or a mail body. Read-only with respect to every other file.
//
// Usage:
//   node scripts/digest.mjs [--min <band>] [--write [file]] [--summary] [--reset]
//   node scripts/digest.mjs --self-test

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bandRank } from './match-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = join(ROOT, 'data', 'digest-state.json');
const DEFAULT_MD = join(ROOT, 'data', 'digest-latest.md');

// Stable identity for a posting: URL when present, else company|role.
export function rowKey(row) {
  return (row.url || `${(row.company || '').toLowerCase()}|${(row.role || '').toLowerCase()}`).trim();
}

// Pure core: diff board rows against the seen-state.
// Returns { fresh, upgraded, state } — `state` is the new ledger to persist.
export function computeDigest(rows, state = {}, today = '') {
  const seen = { ...(state.seen || {}) };
  const fresh = [];
  const upgraded = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (!key) continue;
    const prev = seen[key];
    if (!prev) {
      fresh.push(row);
      seen[key] = { band: row.band, first_seen: today };
    } else if (bandRank(row.band) < bandRank(prev.band)) {
      upgraded.push({ ...row, previous_band: prev.band });
      seen[key] = { ...prev, band: row.band };
    }
  }
  return { fresh, upgraded, state: { version: 1, updated: today, seen } };
}

export function renderDigestMarkdown({ fresh, upgraded }, { today = '', minBand = null } = {}) {
  const keep = (r) => minBand == null || bandRank(r.band) <= bandRank(minBand);
  const shown = fresh.filter(keep);
  const L = [`# CareerOS digest — ${today}`, ''];
  L.push(`**${shown.length} new match${shown.length === 1 ? '' : 'es'}**` +
    (minBand ? ` at ${minBand} or better` : '') +
    ` (${fresh.length} new posting${fresh.length === 1 ? '' : 's'} total, ${upgraded.length} band upgrade${upgraded.length === 1 ? '' : 's'}).`);
  const line = (r, i) => `${String(i + 1).padStart(2)}. **${r.band}** — ${r.company || '?'} — ${r.role || '?'}` +
    (r.posted ? ` _(posted ${r.posted})_` : '') + (r.url ? `\n    <${r.url}>` : '');
  if (shown.length) {
    L.push('', '## New');
    shown.sort((a, b) => bandRank(a.band) - bandRank(b.band)).forEach((r, i) => L.push(line(r, i)));
  }
  if (upgraded.length) {
    L.push('', '## Band upgrades');
    upgraded.forEach((r, i) => L.push(`${String(i + 1).padStart(2)}. ${r.previous_band} → **${r.band}** — ${r.company || '?'} — ${r.role || '?'}`));
  }
  if (!shown.length && !upgraded.length) L.push('', '_Nothing new since the last digest._');
  L.push('', '> Review on the board (`cos board`) — nothing is ever applied for you.');
  return L.join('\n') + '\n';
}

function loadState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

function fetchBoardRows() {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'board.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`board.mjs failed: ${(r.stderr || '').slice(0, 300)}`);
  const parsed = JSON.parse(r.stdout);
  return parsed.rows || [];
}

function main(args) {
  const flag = (f) => args.includes(f);
  const opt = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith('--') ? v : null; };
  const today = new Date().toISOString().slice(0, 10);

  if (flag('--reset')) {
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
    console.log(JSON.stringify({ ok: true, reset: true }));
    return 0;
  }

  const rows = fetchBoardRows();
  const result = computeDigest(rows, loadState(STATE_FILE), today);
  writeFileSync(STATE_FILE, JSON.stringify(result.state, null, 2));

  const minBand = opt('--min');
  if (flag('--write')) {
    const file = opt('--write') || DEFAULT_MD;
    writeFileSync(file, renderDigestMarkdown(result, { today, minBand }));
    console.log(JSON.stringify({ ok: true, today, new: result.fresh.length, upgraded: result.upgraded.length, wrote: file }));
  } else {
    console.log(JSON.stringify({
      ok: true, today, new: result.fresh.length, upgraded: result.upgraded.length,
      rows: result.fresh, upgrades: result.upgraded,
    }, null, 2));
  }
  if (flag('--summary')) {
    console.error(`digest ${today}: ${result.fresh.length} new, ${result.upgraded.length} upgraded (board total ${rows.length})`);
  }
  return 0;
}

// ---------- self-test ----------
async function selfTest() {
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) throw new Error(`check failed: ${what}`); };

  const rows1 = [
    { url: 'https://x/1', company: 'Acme', role: 'DE', band: 'Strong', posted: '2d ago' },
    { url: 'https://x/2', company: 'Beta', role: 'MLE', band: 'Weak' },
  ];
  // First run: everything is new.
  const d1 = computeDigest(rows1, {}, '2026-06-11');
  ok(d1.fresh.length === 2 && d1.upgraded.length === 0, 'first run: all new');
  ok(d1.state.seen['https://x/1'].band === 'Strong', 'state records band');

  // Second run, same rows: nothing new.
  const d2 = computeDigest(rows1, d1.state, '2026-06-12');
  ok(d2.fresh.length === 0 && d2.upgraded.length === 0, 'unchanged board: empty digest');

  // Third run: one new row, one band upgrade, one (ignored) downgrade.
  const rows3 = [
    { url: 'https://x/1', company: 'Acme', role: 'DE', band: 'Moderate' },          // downgrade → ignored
    { url: 'https://x/2', company: 'Beta', role: 'MLE', band: 'STRONGEST' },        // upgrade
    { url: 'https://x/3', company: 'Gamma', role: 'DS', band: 'Very strong' },      // new
  ];
  const d3 = computeDigest(rows3, d2.state, '2026-06-13');
  ok(d3.fresh.length === 1 && d3.fresh[0].url === 'https://x/3', 'new row detected');
  ok(d3.upgraded.length === 1 && d3.upgraded[0].previous_band === 'Weak', 'upgrade detected with previous band');
  ok(d3.state.seen['https://x/2'].band === 'STRONGEST', 'upgrade persisted');
  ok(d3.state.seen['https://x/1'].band === 'Strong', 'downgrade NOT persisted');

  // URL-less rows key on company|role.
  ok(rowKey({ company: 'Acme', role: 'DE' }) === 'acme|de', 'fallback key');

  // Markdown rendering + --min filter.
  const md = renderDigestMarkdown(d3, { today: '2026-06-13', minBand: 'Strong' });
  ok(md.includes('1 new match'), 'md headline respects --min');
  ok(md.includes('Gamma'), 'md lists new row');
  ok(md.includes('Weak → **STRONGEST**'), 'md lists upgrade');
  ok(md.includes('nothing is ever applied'), 'md keeps the human-in-the-loop note');
  const empty = renderDigestMarkdown({ fresh: [], upgraded: [] }, { today: 'x' });
  ok(empty.includes('Nothing new'), 'md empty state');

  // State survives a JSON round-trip on disk.
  const dir = mkdtempSync(join(tmpdir(), 'digest-'));
  try {
    const f = join(dir, 's.json');
    writeFileSync(f, JSON.stringify(d3.state));
    const re = computeDigest(rows3, JSON.parse(readFileSync(f, 'utf8')), '2026-06-14');
    ok(re.fresh.length === 0 && re.upgraded.length === 0, 'persisted state round-trips');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  console.log(`digest self-test: ${checks} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch((e) => { console.error(`digest self-test FAILED: ${e.message}`); process.exit(1); });
  } else {
    try { process.exit(main(process.argv.slice(2))); }
    catch (e) { console.error(JSON.stringify({ ok: false, error: e.message })); process.exit(1); }
  }
}
