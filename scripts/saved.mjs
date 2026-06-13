#!/usr/bin/env node
// scripts/saved.mjs — the user's SAVED jobs (a bookmark shortlist).
//
// Lets someone tick jobs on the board to "save for later", then generate a tailored
// CV + cover letter for the WHOLE shortlist in one command (`/cos saved build-all`).
// This is the single reader/writer of data/ui/saved.jsonl (under the web's allowed
// write zone). Zero tokens, deterministic, no deps. JSON to stdout by default,
// --summary for humans, guarded by import.meta.url, --self-test.
//
// NOTE: saving a job NEVER touches the tracker or marks anything `applied` — it's a
// private shortlist. The build step generates drafts; the human still applies.
//
// Usage:
//   node scripts/saved.mjs add --json '{"url":"…","company":"Acme","role":"…","jd_path":"data/jds/…"}'
//   node scripts/saved.mjs list [--summary]
//   node scripts/saved.mjs remove --url <url> | --id <id>
//   node scripts/saved.mjs has --url <url>
//   node scripts/saved.mjs clear
//   node scripts/saved.mjs --self-test

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { renameSync } from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PATH = join(ROOT, 'data', 'ui', 'saved.jsonl');

// ─── pure helpers ─────────────────────────────────────────────────────
export function genId(now = Date.now(), rnd = Math.random()) {
  return `s${now.toString(36)}${Math.floor(rnd * 1e6).toString(36)}`;
}

// A stable identity for de-duplication: prefer the URL, then the saved jd_path,
// then a normalized company+role signature (so the same job saved from two sources
// collapses to one).
export function savedKey(rec) {
  if (rec.url) return `u:${String(rec.url).trim()}`;
  if (rec.jd_path) return `p:${String(rec.jd_path).trim()}`;
  const sig = `${rec.company || ''} ${rec.role || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return sig ? `s:${sig}` : '';
}

export function parseSaved(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { const r = JSON.parse(s); if (r && typeof r === 'object') out.push(r); } catch { /* skip bad line */ }
  }
  return out;
}

export function readSaved(path = DEFAULT_PATH) {
  if (!existsSync(path)) return [];
  return parseSaved(readFileSync(path, 'utf8'));
}

export function writeSaved(records, path = DEFAULT_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  const tmp = join(tmpdir(), `saved-${process.pid}-${records.length}.tmp`);
  writeFileSync(tmp, body);
  renameSync(tmp, path);
  return records;
}

// Whitelist the fields we persist (don't store the whole board row — keep it small
// and free of transient scoring noise).
export function normalizeSaved(input, { now = Date.now(), id } = {}) {
  const pick = (k) => (input[k] == null ? '' : String(input[k]));
  return {
    id: id || genId(now),
    url: pick('url'),
    jd_path: pick('jd_path'),
    company: pick('company'),
    role: pick('role'),
    location: pick('location'),
    posted: pick('posted'),
    score: typeof input.score === 'number' ? input.score : null,
    band: pick('band'),
    saved_at: new Date(now).toISOString().slice(0, 10),
  };
}

// ─── operations ───────────────────────────────────────────────────────
// Idempotent: saving the same job twice keeps ONE entry.
export function add(input, { path = DEFAULT_PATH, now, id } = {}) {
  const rec = normalizeSaved(input, { now, id });
  const key = savedKey(rec);
  if (!key) return { ok: false, error: 'a saved job needs a url, jd_path, or company+role' };
  const all = readSaved(path);
  const idx = all.findIndex((r) => savedKey(r) === key);
  if (idx >= 0) return { ok: true, action: 'exists', record: all[idx], count: all.length };
  all.push(rec);
  writeSaved(all, path);
  return { ok: true, action: 'added', record: rec, count: all.length };
}

export function remove({ url = '', id = '' } = {}, { path = DEFAULT_PATH } = {}) {
  const all = readSaved(path);
  const wantKey = url ? `u:${url.trim()}` : '';
  const kept = all.filter((r) => !(id && r.id === id) && !(wantKey && savedKey(r) === wantKey) && !(url && r.url === url));
  writeSaved(kept, path);
  return { ok: true, action: 'removed', removed: all.length - kept.length, count: kept.length };
}

export function list({ path = DEFAULT_PATH } = {}) {
  return readSaved(path);
}
export function has(url, { path = DEFAULT_PATH } = {}) {
  if (!url) return false;
  const key = `u:${String(url).trim()}`;
  return readSaved(path).some((r) => savedKey(r) === key || r.url === url);
}
export function clear({ path = DEFAULT_PATH } = {}) {
  writeSaved([], path);
  return { ok: true, action: 'cleared', count: 0 };
}

// ─── CLI ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { cmd: '', json: true };
  if (argv[0] && !argv[0].startsWith('--')) out.cmd = argv[0];
  for (let i = out.cmd ? 1 : 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (a === '--url') out.url = val();
    else if (a === '--id') out.id = val();
    else if (a === '--json-data' || a === '--data') out.data = val();
    else if (a === '--company') out.company = val();
    else if (a === '--role') out.role = val();
    else if (a === '--jd_path' || a === '--jd-path') out.jd_path = val();
    else if (a === '--location') out.location = val();
    else if (a === '--posted') out.posted = val();
    else if (a === '--band') out.band = val();
    else if (a === '--score') out.score = Number(val());
  }
  return out;
}

const USAGE = `saved — your bookmarked jobs (shortlist to build CV+CL for later).
Usage:
  node scripts/saved.mjs add --data '{"url":"…","company":"Acme","role":"…","jd_path":"…"}'
  node scripts/saved.mjs add --url <url> --company <c> --role <r> [--jd_path p] [--band b] [--score n]
  node scripts/saved.mjs list [--summary]
  node scripts/saved.mjs remove --url <url> | --id <id>
  node scripts/saved.mjs has --url <url>
  node scripts/saved.mjs clear`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const a = parseArgs(argv);
  if (a.selfTest) return selfTest();
  const out = (o) => { console.log(a.json ? JSON.stringify(o, null, 2) : o); process.exit(o && o.ok === false ? 1 : 0); };
  switch (a.cmd) {
    case 'add': {
      let input = {};
      if (a.data) { try { input = JSON.parse(a.data); } catch { return out({ ok: false, error: 'bad --data JSON' }); } }
      for (const k of ['url', 'company', 'role', 'jd_path', 'location', 'posted', 'band']) if (a[k] != null) input[k] = a[k];
      if (Number.isFinite(a.score)) input.score = a.score;
      return out(add(input));
    }
    case 'remove': return out(remove({ url: a.url, id: a.id }));
    case 'has': return out({ ok: true, saved: has(a.url) });
    case 'clear': return out(clear());
    case 'list':
    case '': {
      const items = list();
      if (a.json) return out({ ok: true, count: items.length, saved: items });
      if (!items.length) { console.log('No saved jobs yet. Tick ★ on a board row to save one.'); process.exit(0); }
      items.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r.company || '?'} — ${r.role || '?'}  ${r.band ? `[${r.band}]` : ''}  ${r.url || r.jd_path || ''}`));
      console.log(`\n  → build a CV + cover letter for ALL ${items.length}:  /cos saved build-all`);
      process.exit(0);
    }
    default: console.error(`unknown command: ${a.cmd}\n${USAGE}`); process.exit(2);
  }
}

// ─── self-test ──────────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
  const path = join(tmpdir(), `saved-selftest-${process.pid}.jsonl`);
  try {
    const a1 = add({ url: 'https://x/1', company: 'Acme', role: 'Data Scientist', band: 'STRONGEST', score: 0.8 }, { path, now: 1 });
    eq(a1.action, 'added', 'first save adds'); eq(a1.count, 1, 'count 1');
    const a2 = add({ url: 'https://x/1', company: 'Acme', role: 'Data Scientist' }, { path, now: 2 });
    eq(a2.action, 'exists', 'saving same url again is idempotent'); eq(a2.count, 1, 'still 1');
    add({ jd_path: 'data/jds/beta.md', company: 'Beta', role: 'ML Engineer' }, { path, now: 3 });
    eq(list({ path }).length, 2, 'two distinct saved');
    ok(has('https://x/1', { path }), 'has() true for saved url');
    ok(!has('https://x/none', { path }), 'has() false for unsaved url');
    const rm = remove({ url: 'https://x/1' }, { path });
    eq(rm.removed, 1, 'remove drops one'); eq(list({ path }).length, 1, 'one left');
    // normalize keeps only whitelisted fields + a saved_at date
    const rec = normalizeSaved({ url: 'u', company: 'C', role: 'R', junk: 'DROP' }, { now: 0, id: 'fixed' });
    ok(!('junk' in rec), 'normalize drops unknown fields'); ok(rec.saved_at && rec.id === 'fixed', 'normalize sets id + saved_at');
    eq(savedKey({ url: 'https://a' }), 'u:https://a', 'savedKey prefers url');
    eq(savedKey({ jd_path: 'data/jds/x.md' }), 'p:data/jds/x.md', 'savedKey falls back to jd_path');
    clear({ path }); eq(list({ path }).length, 0, 'clear empties');
    // bad lines are skipped, not fatal
    writeFileSync(path, '{"id":"a","url":"https://ok"}\nnot json\n');
    eq(readSaved(path).length, 1, 'parseSaved skips malformed lines');
  } finally {
    try { writeFileSync(path, ''); } catch { /* ignore */ }
  }
  console.log(`saved self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`saved self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main();
  }
}
