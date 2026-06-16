#!/usr/bin/env node
// scripts/job-docs.mjs — register a generated CV / CL / report / LaTeX file for a job
// so the web drawer can surface it. Appends to data/ui/job-docs.jsonl (the manifest
// /api/docs reads). A built doc shows in the UI only if it is on the tracker OR in
// this manifest — so the agent build flow (build-cv / build-cl / saved / ui drain)
// calls `add` right after compiling, which is what makes a doc appear for a SAVED job
// that has no tracker record. Read/append only; never touches user CVs. Zero tokens.
//
// Usage:
//   node scripts/job-docs.mjs add --jd <jd_path> [--url <url>] --type cv|cl|report|tex --path <relpath>
//   node scripts/job-docs.mjs list [--jd <jd_path>] [--json]
//   node scripts/job-docs.mjs --self-test
import { existsSync, mkdirSync, readFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = join(ROOT, 'data', 'ui', 'job-docs.jsonl');
const TYPES = new Set(['cv', 'cl', 'report', 'tex']);

export function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return [];
  return readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e !== null);
}

// Append an entry unless an identical {jd_path,type,path} already exists (idempotent,
// so re-running a build never duplicates a row). Returns { ok, added, entry }.
export function addDoc({ jd_path = '', url = '', type, path } = {}, { manifestPath = DEFAULT_MANIFEST, now } = {}) {
  if (!type || !TYPES.has(type)) throw new Error(`--type must be one of ${[...TYPES].join('|')}`);
  if (!path) throw new Error('--path is required');
  if (!jd_path && !url) throw new Error('need --jd or --url to key the doc');
  const existing = readManifest(manifestPath);
  const dupe = existing.some((e) => e.jd_path === jd_path && e.type === type && e.path === path);
  const entry = { jd_path, url, type, path, ts: now || new Date().toISOString() };
  if (!dupe) {
    mkdirSync(dirname(manifestPath), { recursive: true });
    appendFileSync(manifestPath, JSON.stringify(entry) + '\n', 'utf8');
  }
  return { ok: true, added: !dupe, entry };
}

export function listDocs({ jd_path } = {}, { manifestPath = DEFAULT_MANIFEST } = {}) {
  const all = readManifest(manifestPath);
  return jd_path ? all.filter((e) => e.jd_path === jd_path) : all;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (cmd === 'add') {
    const r = addDoc({ jd_path: args.jd || '', url: args.url || '', type: args.type, path: args.path });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (cmd === 'list') {
    const rows = listDocs({ jd_path: args.jd });
    if (args.json) console.log(JSON.stringify({ ok: true, docs: rows }, null, 2));
    else rows.forEach((r) => console.log(`${r.type}\t${r.path}`));
    return;
  }
  console.error('Usage: node scripts/job-docs.mjs add --jd <jd_path> [--url <url>] --type cv|cl|report|tex --path <relpath>\n       node scripts/job-docs.mjs list [--jd <jd_path>] [--json]');
  process.exit(2);
}

export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
  const tmp = join(tmpdir(), `job-docs-selftest-${process.pid}.jsonl`);
  try {
    const opts = { manifestPath: tmp, now: '2026-06-16T00:00:00.000Z' };
    const jd = 'data/jds/acme-data-scientist.md';
    eq(readManifest(tmp).length, 0, 'empty manifest reads as []');
    const a1 = addDoc({ jd_path: jd, url: 'https://x/y', type: 'cv', path: 'data/output/acme--ds/cv.pdf' }, opts);
    ok(a1.ok && a1.added, 'add cv → added');
    const a2 = addDoc({ jd_path: jd, type: 'cv', path: 'data/output/acme--ds/cv.pdf' }, opts);
    ok(a2.ok && a2.added === false, 'identical {jd,type,path} → deduped (not added)');
    addDoc({ jd_path: jd, type: 'cl', path: 'data/output/acme--ds/cl.pdf' }, opts);
    eq(listDocs({ jd_path: jd }, opts).length, 2, 'list by jd_path returns cv + cl');
    eq(listDocs({ jd_path: 'data/jds/other.md' }, opts).length, 0, 'list filters by jd_path');
    eq(listDocs({}, opts).length, 2, 'list (no filter) returns all');
    assert.throws(() => addDoc({ jd_path: jd, type: 'bogus', path: 'x' }, opts), /type must be/); n++;
    assert.throws(() => addDoc({ jd_path: jd, type: 'cv' }, opts), /path is required/); n++;
    assert.throws(() => addDoc({ type: 'cv', path: 'x' }, opts), /need --jd or --url/); n++;
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
  console.log(`job-docs self-test: ${n} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`job-docs self-test FAILED: ${e.message}`); process.exit(1); }
  } else {
    try { main(); } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
  }
}
