#!/usr/bin/env node
// scripts/backup.mjs — one-command private backup of the user's data/ layer.
//
// data/ is git-ignored by the (public) CareerOS repo on purpose — it holds the
// user's CV, tracker, and learned style. DATA_CONTRACT.md tells users to back
// it up with their OWN private git; this script makes that one command:
// it maintains a NESTED git repo inside data/ (init on first run), commits a
// snapshot, and — only on an explicit --push — pushes to the user's private
// remote. It never touches the CareerOS repo itself and never pushes unasked.
//
// Usage:
//   node scripts/backup.mjs [--message "<msg>"] [--remote <url>] [--push] [--summary]
//   node scripts/backup.mjs --self-test
//
// Exit codes: 0 ok (including "nothing to back up") · 1 git failure.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');

// Run git in `dir`; returns { ok, out, err }. Never throws.
function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// Snapshot `dataDir` into its nested backup repo. Pure-ish: all effects are
// inside dataDir (plus the optional remote on --push). Returns a report object.
export function backupData(dataDir, { message = null, remote = null, push = false } = {}) {
  if (!existsSync(dataDir)) return { ok: false, error: `data dir not found: ${dataDir}` };

  if (!existsSync(join(dataDir, '.git'))) {
    const init = git(dataDir, 'init', '-b', 'main');
    if (!init.ok) return { ok: false, error: `git init failed: ${init.err}` };
  }
  // A backup repo needs an identity; set a local (repo-only) fallback if unset.
  if (!git(dataDir, 'config', 'user.email').out) {
    git(dataDir, 'config', 'user.name', 'CareerOS Backup');
    git(dataDir, 'config', 'user.email', 'backup@careeros.local');
  }
  if (remote) {
    const has = git(dataDir, 'remote', 'get-url', 'origin').ok;
    const set = git(dataDir, ...(has ? ['remote', 'set-url', 'origin', remote] : ['remote', 'add', 'origin', remote]));
    if (!set.ok) return { ok: false, error: `setting remote failed: ${set.err}` };
  }

  git(dataDir, 'add', '-A');
  const dirty = git(dataDir, 'status', '--porcelain').out !== '';
  let committed = false, hash = git(dataDir, 'rev-parse', '--short', 'HEAD').out || null;
  if (dirty) {
    const msg = message || `careeros backup ${new Date().toISOString()}`;
    const c = git(dataDir, 'commit', '-m', msg);
    if (!c.ok) return { ok: false, error: `commit failed: ${c.err}` };
    committed = true;
    hash = git(dataDir, 'rev-parse', '--short', 'HEAD').out;
  }

  let pushed = false;
  if (push) {
    if (!git(dataDir, 'remote', 'get-url', 'origin').ok) {
      return { ok: false, committed, hash, error: 'no remote configured — pass --remote <url> once first' };
    }
    const p = git(dataDir, 'push', '-u', 'origin', 'HEAD');
    if (!p.ok) return { ok: false, committed, hash, error: `push failed: ${p.err.slice(0, 300)}` };
    pushed = true;
  }
  return { ok: true, committed, hash, pushed, clean: !dirty };
}

function main(args) {
  const flag = (f) => args.includes(f);
  const opt = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith('--') ? v : null; };
  const report = backupData(DATA_DIR, { message: opt('--message'), remote: opt('--remote'), push: flag('--push') });
  console.log(JSON.stringify(report, null, 2));
  if (flag('--summary')) {
    console.error(report.ok
      ? `backup: ${report.committed ? `committed ${report.hash}` : 'nothing new'}${report.pushed ? ', pushed to origin' : ' (local only — use --push to sync)'}`
      : `backup FAILED: ${report.error}`);
  }
  return report.ok ? 0 : 1;
}

// ---------- self-test (real git repos in a temp dir) ----------
async function selfTest() {
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) throw new Error(`check failed: ${what}`); };
  const base = mkdtempSync(join(tmpdir(), 'cosbackup-'));
  try {
    const data = join(base, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'tracker.jsonl'), '{"id":1}\n');

    // 1) first run: init + commit
    const r1 = backupData(data, { message: 'snap 1' });
    ok(r1.ok && r1.committed && r1.hash, `first backup commits (${JSON.stringify(r1)})`);
    ok(existsSync(join(data, '.git')), 'nested repo created');

    // 2) clean run: no commit, still ok
    const r2 = backupData(data);
    ok(r2.ok && !r2.committed && r2.clean, 'clean tree → no commit, ok');

    // 3) change + push to a local bare "private remote"
    const bare = join(base, 'remote.git');
    git(base, 'init', '--bare', '-b', 'main', bare);
    writeFileSync(join(data, 'profile.yml'), 'name: x\n');
    const r3 = backupData(data, { message: 'snap 2', remote: pathToFileURL(bare).href, push: true });
    ok(r3.ok && r3.committed && r3.pushed, `commit+push to file remote (${JSON.stringify(r3)})`);
    ok(git(bare, 'rev-parse', 'main').ok, 'bare remote received the branch');

    // 4) push without a remote is a clean, actionable error
    const lonely = join(base, 'lonely');
    mkdirSync(lonely);
    writeFileSync(join(lonely, 'a.txt'), 'a');
    const r4 = backupData(lonely, { push: true });
    ok(!r4.ok && /no remote configured/.test(r4.error) && r4.committed, 'push w/o remote: commit kept, clear error');

    // 5) missing dir
    ok(!backupData(join(base, 'nope')).ok, 'missing dir is a clean error');
  } finally { rmSync(base, { recursive: true, force: true }); }
  console.log(`backup self-test: ${checks} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch((e) => { console.error(`backup self-test FAILED: ${e.message}`); process.exit(1); });
  } else {
    process.exit(main(process.argv.slice(2)));
  }
}
