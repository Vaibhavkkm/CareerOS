#!/usr/bin/env node
// scripts/ui-queue.mjs — the web-UI ↔ agent request queue (the Class-A/B handshake).
//
// A hosted/local web app has NO LLM and NO MCP access, so it cannot run the
// judgment work (evaluate, build-cv, build-cl, apply) or call the MCP job boards
// (hunt). Instead the UI ENQUEUES a request here; the in-session `/cos` agent
// drains the queue (see modes/ui.md), runs the real mode, and marks the request
// done. The UI polls and reflects status live.
//
// This script is the SINGLE reader/writer of data/ui/requests.jsonl (the truth).
// Zero tokens, deterministic, no deps. Same shape as every other tool: JSON to
// stdout by default, --summary for humans, guarded by import.meta.url, --self-test.
//
// GUARDRAIL: the queue carries ONLY generation / setup work. `kind` is whitelisted
// to {evaluate, build-cv, build-cl, apply, hunt, onboard}. A tracker status flip to
// `applied` is Class A (goes through scripts/tracker.mjs after the human confirms)
// and is REJECTED here — it can never travel through the queue. (`onboard` carries
// only POINTERS to uploaded files under data/ui/uploads/ for the agent to parse +
// merge into the master CV — it writes no user facts itself.)
//
// Usage:
//   node scripts/ui-queue.mjs enqueue --kind build-cv --args '{"report":7}'
//   node scripts/ui-queue.mjs list [--status queued] [--summary]
//   node scripts/ui-queue.mjs get --id <id>
//   node scripts/ui-queue.mjs claim --id <id>
//   node scripts/ui-queue.mjs complete --id <id> --result '{"pdf":"data/output/..."}'
//   node scripts/ui-queue.mjs fail --id <id> --error "tectonic failed"
//   node scripts/ui-queue.mjs --self-test

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, rmSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_QUEUE = join(ROOT, 'data', 'ui', 'requests.jsonl');

// The ONLY request kinds the queue accepts — agent-judgment / MCP / setup work.
export const KINDS = ['evaluate', 'build-cv', 'build-cl', 'apply', 'hunt', 'onboard'];
export const STATUSES = ['queued', 'claimed', 'done', 'failed'];

// ─── pure helpers ─────────────────────────────────────────────────────

// A short, sortable, collision-resistant id. now=epoch ms, rnd in [0,1).
export function genId(now = Date.now(), rnd = Math.random()) {
  const ms = Math.floor(now).toString(36);
  const tail = Math.floor(rnd * 0x10000).toString(36).padStart(4, '0').slice(-4);
  return `req_${ms}_${tail}`;
}

// Parse the JSONL queue into records, skipping blank/corrupt lines (never throws).
export function parseQueue(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { const r = JSON.parse(s); if (r && typeof r === 'object') out.push(r); }
    catch { /* skip a corrupt line rather than lose the whole queue */ }
  }
  return out;
}

// Build a fresh queued record. Throws on an invalid/forbidden kind.
export function makeRequest({ kind, args = {}, origin = 'web' }, { now, id } = {}) {
  if (!KINDS.includes(kind)) {
    throw new Error(`invalid kind "${kind}" — must be one of ${KINDS.join(', ')} (status flips go through tracker.mjs, not the queue)`);
  }
  const created = now || new Date().toISOString();
  return {
    id: id || genId(),
    kind,
    args: args && typeof args === 'object' ? args : {},
    status: 'queued',
    created,
    claimed_at: null,
    completed_at: null,
    result: null,
    error: null,
    origin: typeof origin === 'string' && origin ? origin : 'web',
  };
}

// ─── I/O ──────────────────────────────────────────────────────────────

export function readQueue(path = DEFAULT_QUEUE) {
  return existsSync(path) ? parseQueue(readFileSync(path, 'utf8')) : [];
}

// Atomic full rewrite: write a temp file in the same dir, then rename over the
// target (rename is atomic on the same filesystem). Used by claim/complete/fail.
export function writeQueue(records, path = DEFAULT_QUEUE) {
  mkdirSync(dirname(path), { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}

// Append a new request (append-only — the cheap, race-safe common path).
export function enqueue(input, { path = DEFAULT_QUEUE, now, id } = {}) {
  const rec = makeRequest(input, { now, id });
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(rec) + '\n');
  return rec;
}

export function list({ status = null } = {}, { path = DEFAULT_QUEUE } = {}) {
  const all = readQueue(path);
  return status ? all.filter((r) => r.status === status) : all;
}

export function get(id, { path = DEFAULT_QUEUE } = {}) {
  return readQueue(path).find((r) => r.id === id) || null;
}

// Internal: load, find, validate a transition, mutate, atomic-write. Returns
// { ok, record?, reason? }. `expect` is the status the record must currently be in.
function transition(id, expect, mutate, { path = DEFAULT_QUEUE, now } = {}) {
  const records = readQueue(path);
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return { ok: false, reason: 'not-found' };
  const rec = records[idx];
  if (rec.status !== expect) {
    // Idempotency / double-drain guard: surface the current state, don't clobber.
    return { ok: false, reason: `already-${rec.status}`, record: rec };
  }
  mutate(rec, now || new Date().toISOString());
  records[idx] = rec;
  writeQueue(records, path);
  return { ok: true, record: rec };
}

// queued → claimed. A second claim returns { ok:false, reason:'already-claimed' }.
export function claim(id, opts = {}) {
  return transition(id, 'queued', (rec, ts) => { rec.status = 'claimed'; rec.claimed_at = ts; }, opts);
}

// claimed → done (+ result).
export function complete(id, result = null, opts = {}) {
  return transition(id, 'claimed', (rec, ts) => {
    rec.status = 'done'; rec.completed_at = ts; rec.result = result == null ? null : result;
  }, opts);
}

// claimed → failed (+ error).
export function fail(id, error = '', opts = {}) {
  return transition(id, 'claimed', (rec, ts) => {
    rec.status = 'failed'; rec.completed_at = ts; rec.error = String(error || 'unspecified error');
  }, opts);
}

// ─── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { cmd: argv[0] || '', json: true, status: null, id: null, kind: null, args: null, result: null, error: null, origin: 'web' };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--json') out.json = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--status') out.status = val();
    else if (a.startsWith('--status=')) out.status = a.slice(9);
    else if (a === '--id') out.id = val();
    else if (a.startsWith('--id=')) out.id = a.slice(5);
    else if (a === '--kind') out.kind = val();
    else if (a.startsWith('--kind=')) out.kind = a.slice(7);
    else if (a === '--args') out.args = val();
    else if (a.startsWith('--args=')) out.args = a.slice(7);
    else if (a === '--result') out.result = val();
    else if (a.startsWith('--result=')) out.result = a.slice(9);
    else if (a === '--error') out.error = val();
    else if (a.startsWith('--error=')) out.error = a.slice(8);
    else if (a === '--origin') out.origin = val();
    else if (a.startsWith('--origin=')) out.origin = a.slice(9);
  }
  return out;
}

function parseJsonArg(s, label) {
  if (!s) return {};
  try { return JSON.parse(s); }
  catch (e) { throw new Error(`--${label} is not valid JSON: ${e.message}`); }
}

const USAGE = `ui-queue — the web-UI ↔ agent request queue.
Usage:
  ui-queue enqueue --kind <${KINDS.join('|')}> --args '<json>' [--origin web]
  ui-queue list [--status <${STATUSES.join('|')}>] [--summary]
  ui-queue get --id <id>
  ui-queue claim --id <id>
  ui-queue complete --id <id> --result '<json>'
  ui-queue fail --id <id> --error "<msg>"
  ui-queue --self-test`;

function out(json, obj, human) {
  if (json) console.log(JSON.stringify(obj, null, 2));
  else console.log(human != null ? human : JSON.stringify(obj, null, 2));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) { console.log(USAGE); process.exit(0); }
  const a = parseArgs(argv);
  try {
    switch (a.cmd) {
      case 'enqueue': {
        const rec = enqueue({ kind: a.kind, args: parseJsonArg(a.args, 'args'), origin: a.origin });
        out(a.json, { ok: true, request: rec }, `queued ${rec.id} (${rec.kind})`);
        return process.exit(0);
      }
      case 'list': {
        const rows = list({ status: a.status });
        if (a.json) out(true, { ok: true, count: rows.length, requests: rows });
        else {
          const lines = [`ui-queue — ${rows.length} request${rows.length === 1 ? '' : 's'}${a.status ? ` (${a.status})` : ''}`, ''];
          for (const r of rows) lines.push(`  ${r.status.padEnd(8)} ${r.id}  ${r.kind}  ${JSON.stringify(r.args)}`);
          out(false, null, lines.join('\n'));
        }
        return process.exit(0);
      }
      case 'get': {
        const rec = get(a.id);
        out(a.json, rec ? { ok: true, request: rec } : { ok: false, error: 'not-found' });
        return process.exit(rec ? 0 : 1);
      }
      case 'claim': {
        const r = claim(a.id);
        out(a.json, r, r.ok ? `claimed ${a.id}` : `cannot claim ${a.id}: ${r.reason}`);
        return process.exit(r.ok ? 0 : 1);
      }
      case 'complete': {
        const r = complete(a.id, a.result ? parseJsonArg(a.result, 'result') : null);
        out(a.json, r, r.ok ? `completed ${a.id}` : `cannot complete ${a.id}: ${r.reason}`);
        return process.exit(r.ok ? 0 : 1);
      }
      case 'fail': {
        const r = fail(a.id, a.error || 'unspecified error');
        out(a.json, r, r.ok ? `failed ${a.id}` : `cannot fail ${a.id}: ${r.reason}`);
        return process.exit(r.ok ? 0 : 1);
      }
      default:
        console.error(`unknown subcommand "${a.cmd}"\n`);
        console.log(USAGE);
        return process.exit(2);
    }
  } catch (e) {
    out(a.json, { ok: false, error: e.message });
    return process.exit(1);
  }
}

// ─── self-test ────────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (x, y, m) => { assert.equal(x, y, m); n++; };
  const tmp = join(tmpdir(), `of-uiqueue-${process.pid}-${Date.now()}`);
  const path = join(tmp, 'data', 'ui', 'requests.jsonl');
  try {
    // genId is unique + sortable-ish
    ok(genId(1, 0.5) !== genId(2, 0.5), 'genId varies with time');
    ok(/^req_[a-z0-9]+_[a-z0-9]{4}$/.test(genId(123456, 0.25)), 'genId shape');

    // invalid + forbidden kinds rejected
    assert.throws(() => makeRequest({ kind: 'nope' }), /invalid kind/); n++;
    assert.throws(() => makeRequest({ kind: 'applied' }), /invalid kind/); n++;
    assert.throws(() => makeRequest({ kind: 'tracker-applied' }), /invalid kind/); n++;

    // the onboard kind (CV upload → merge) is accepted; pointers only, no facts
    const onb = makeRequest({ kind: 'onboard', args: { dir: 'data/ui/uploads/abc', mode: 'merge' } });
    eq(onb.kind, 'onboard', 'onboard kind accepted');

    // enqueue appends + returns a queued record
    const r1 = enqueue({ kind: 'build-cv', args: { report: 7 } }, { path });
    eq(r1.status, 'queued', 'enqueue -> queued');
    eq(r1.kind, 'build-cv', 'enqueue keeps kind');
    eq(r1.args.report, 7, 'enqueue keeps args');
    const r2 = enqueue({ kind: 'hunt', args: { query: 'ml' } }, { path });
    eq(readQueue(path).length, 2, 'two records persisted');

    // list + filter
    eq(list({}, { path }).length, 2, 'list all');
    eq(list({ status: 'queued' }, { path }).length, 2, 'list queued');
    eq(list({ status: 'done' }, { path }).length, 0, 'list done empty');
    ok(get(r1.id, { path }) && get(r1.id, { path }).id === r1.id, 'get by id');
    eq(get('missing', { path }), null, 'get missing -> null');

    // claim is idempotent (second claim refused)
    const c1 = claim(r1.id, { path });
    ok(c1.ok && c1.record.status === 'claimed', 'first claim ok');
    ok(c1.record.claimed_at, 'claim sets claimed_at');
    const c2 = claim(r1.id, { path });
    ok(!c2.ok && c2.reason === 'already-claimed', 'second claim refused (double-drain guard)');

    // complete only from claimed
    const cmp = complete(r1.id, { pdf: 'data/output/cv-x.pdf' }, { path });
    ok(cmp.ok && cmp.record.status === 'done', 'complete -> done');
    eq(cmp.record.result.pdf, 'data/output/cv-x.pdf', 'complete stores result');
    const cmp2 = complete(r1.id, {}, { path });
    ok(!cmp2.ok && cmp2.reason === 'already-done', 'cannot complete a done request');

    // claim-missing + fail flow
    ok(!claim('missing', { path }).ok, 'claim missing -> not ok');
    const fc = claim(r2.id, { path });
    ok(fc.ok, 'claim r2');
    const fr = fail(r2.id, 'boom', { path });
    ok(fr.ok && fr.record.status === 'failed' && fr.record.error === 'boom', 'fail -> failed + error');
    ok(!fail(r2.id, 'again', { path }).ok, 'cannot fail a failed request');

    // corrupt-line tolerance
    appendFileSync(path, 'not json at all\n');
    eq(readQueue(path).length, 2, 'corrupt line skipped, others intact');

    console.log(`ui-queue self-test: ${n} checks passed`);
    return 0;
  } catch (e) {
    console.error(`ui-queue self-test FAILED: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    return 1;
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    process.exit(selfTest());
  } else {
    main();
  }
}
