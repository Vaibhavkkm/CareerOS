#!/usr/bin/env node
// scripts/liveness.mjs — detect EXPIRED job postings and keep them off the board.
//
// Conservative by design: a posting is hidden ONLY when we are SURE it's gone —
//   • HTTP 404 / 410, or
//   • the page text says so ("no longer available", "n'est plus disponible", …).
// A timeout, a 5xx, a robots block, or any other error is treated as UNKNOWN and
// the job is KEPT — we never hide a valid opening on a transient failure.
//
// Results are cached in data/ui/liveness.json so the board filter is instant and
// each URL is only re-checked after a TTL. The /api/board route filters by this
// cache and refreshes it with a bounded background `prune`.
//
//   node scripts/liveness.mjs expired --json   # → { urls: [...] }  (cached, instant)
//   node scripts/liveness.mjs prune  [--limit N] [--json]           # check a stale batch
//   node scripts/liveness.mjs --self-test

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { fetchText } from './providers/_http.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_PATH = join(ROOT, 'data', 'ui', 'liveness.json');
const TTL_MS = 3 * 24 * 60 * 60 * 1000; // re-check a cached verdict after 3 days
const DEFAULT_PRUNE_LIMIT = 12;         // URLs checked per background prune (bounded)
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 8_000;

// Specific "this posting is gone" phrases (EN/FR/DE/NL). Kept specific so ordinary
// job copy ("no longer than 2 years") can't trip the filter.
const EXPIRED_MARKERS = [
  'no longer available', 'no longer accepting', 'no longer be available',
  'position has been filled', 'this position is closed', 'this job is no longer',
  'posting has expired', 'job posting has expired', 'vacancy is closed',
  'applications are closed', 'application period has ended', 'this job is closed',
  'job not found', 'page not found', 'offer not found', 'job has expired',
  "n'est plus disponible", 'offre expir', 'poste pourvu', 'candidatures closes',
  "cette offre n'existe plus", "cette offre n'est plus",
  'nicht mehr verfügbar', 'stelle ist besetzt', 'bewerbungsfrist abgelaufen',
  'niet meer beschikbaar', 'vacature is gesloten',
];

// Pure: does the page body say the posting is gone? Exported for the self-test.
export function hasExpiredMarker(body) {
  const t = String(body || '').toLowerCase();
  return EXPIRED_MARKERS.some((m) => t.includes(m));
}

// Pure: classify a fetch outcome. status = HTTP status (or null on network error);
// body = response text (or '' on error). Returns 'expired' | 'alive' | 'unknown'.
// Exported for the self-test.
export function classify({ status, body }) {
  if (status === 404 || status === 410) return 'expired';
  if (status == null) return 'unknown';                 // timeout / network / blocked
  if (status >= 500) return 'unknown';                  // server hiccup, not an expiry
  if (status >= 200 && status < 400) return hasExpiredMarker(body) ? 'expired' : 'alive';
  return 'unknown';                                      // 401/403/429/… → don't hide
}

// Network: fetch the URL once and classify it. Never throws.
export async function classifyUrl(url) {
  try {
    const body = await fetchText(url, { timeoutMs: REQUEST_TIMEOUT_MS, redirect: 'follow' });
    return classify({ status: 200, body });
  } catch (e) {
    return classify({ status: typeof e?.status === 'number' ? e.status : null, body: '' });
  }
}

// ── cache ────────────────────────────────────────────────────────────
export function readCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try { const o = JSON.parse(readFileSync(CACHE_PATH, 'utf8')); return o && typeof o === 'object' ? o : {}; }
  catch { return {}; }
}
function writeCache(cache) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// The set of URLs currently known-expired (used by the board filter). Pure over the
// cache object so it's testable without I/O.
export function expiredUrlsFrom(cache) {
  return Object.entries(cache || {})
    .filter(([, v]) => v && v.state === 'expired')
    .map(([url]) => url);
}

// Which URLs need a (re)check: never seen, or older than the TTL. `now` injected for tests.
export function staleUrls(cache, urls, now, ttlMs = TTL_MS) {
  return urls.filter((u) => {
    const v = cache[u];
    return !v || typeof v.ts !== 'number' || now - v.ts > ttlMs;
  });
}

// Bounded, concurrency-limited prune. Checks up to `limit` stale URLs and updates
// the cache. `nowFn`/`classifyFn` injectable for the self-test.
export async function prune(urls, { limit = DEFAULT_PRUNE_LIMIT, now = Date.now(), classifyFn = classifyUrl, ttlMs = TTL_MS } = {}) {
  const cache = readCache();
  const todo = staleUrls(cache, urls, now, ttlMs).slice(0, limit);
  let expired = 0, alive = 0, unknown = 0;
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const url = todo[i++];
      const state = await classifyFn(url);
      if (state === 'unknown') { unknown++; continue; }   // don't cache uncertainty
      cache[url] = { state, ts: now };
      if (state === 'expired') expired++; else alive++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  writeCache(cache);
  return { checked: todo.length, expired, alive, unknown };
}

// Pull the current board's URLs (so prune knows what to check).
function boardUrls() {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'board.mjs'), '--json'], {
      cwd: ROOT, timeout: 90_000, maxBuffer: 32 * 1024 * 1024,
    }).toString();
    const o = JSON.parse(out);
    return [...new Set((o.rows || []).map((r) => r.url).filter(Boolean))];
  } catch { return []; }
}

// ── CLI ──────────────────────────────────────────────────────────────
async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const json = argv.includes('--json');
  if (cmd === 'expired') {
    const urls = expiredUrlsFrom(readCache());
    console.log(JSON.stringify({ ok: true, urls }, null, json ? 0 : 2));
    return;
  }
  if (cmd === 'prune') {
    const li = argv.indexOf('--limit');
    const limit = li !== -1 ? Number(argv[li + 1]) || DEFAULT_PRUNE_LIMIT : DEFAULT_PRUNE_LIMIT;
    const res = await prune(boardUrls(), { limit });
    console.log(JSON.stringify({ ok: true, ...res }));
    return;
  }
  console.error('usage: liveness.mjs <expired|prune> [--limit N] [--json]');
  process.exit(1);
}

// ── self-test ──────────────────────────────────────────────────────────
export function selfTest() {
  let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  eq(classify({ status: 404, body: '' }), 'expired', '404 → expired');
  eq(classify({ status: 410, body: '' }), 'expired', '410 → expired');
  eq(classify({ status: 200, body: 'Apply now! Great role.' }), 'alive', '200 + normal copy → alive');
  eq(classify({ status: 200, body: 'This position is closed.' }), 'expired', '200 + marker → expired');
  eq(classify({ status: 200, body: "Cette offre n'est plus disponible." }), 'expired', 'FR marker → expired');
  eq(classify({ status: null, body: '' }), 'unknown', 'network error → unknown (kept)');
  eq(classify({ status: 503, body: '' }), 'unknown', '5xx → unknown (kept)');
  eq(classify({ status: 403, body: '' }), 'unknown', '403 robots → unknown (kept)');
  ok(!hasExpiredMarker('We offer no longer than a 2-year contract.'), 'ordinary "no longer" not a marker');
  ok(hasExpiredMarker('Sorry, this job is no longer available.'), 'specific phrase IS a marker');

  // cache helpers
  const cache = { 'a': { state: 'expired', ts: 1000 }, 'b': { state: 'alive', ts: 1000 } };
  assert.deepEqual(expiredUrlsFrom(cache), ['a']); n++;
  assert.deepEqual(staleUrls(cache, ['a', 'b', 'c'], 1000 + TTL_MS + 1), ['a', 'b', 'c'], 'all stale past TTL'); n++;
  assert.deepEqual(staleUrls(cache, ['a', 'b', 'c'], 1500), ['c'], 'only the unseen url is stale within TTL'); n++;

  console.log(`liveness self-test: ${n} checks passed ✅`);
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
