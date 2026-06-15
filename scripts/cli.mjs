#!/usr/bin/env node
// scripts/cli.mjs — thin dispatcher for the careeros toolchain.
//
// Forwards `node scripts/cli.mjs <cmd> [...args]` (and the `careeros` bin)
// to the matching script in scripts/, preserving stdio and exit status.
//
// Usage:
//   node scripts/cli.mjs <cmd> [...args]
//   careeros <cmd> [...args]            # via package "bin"
//   node scripts/cli.mjs                   # prints the command list
//   node scripts/cli.mjs --self-test       # asserts the routing table
//
// Exit code: forwards the child's status; 0 when printing help; 1 on self-test failure.

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Command name -> script file under scripts/. Single source of truth.
export const COMMANDS = {
  doctor: 'doctor.mjs',
  compile: 'compile-latex.mjs',
  'fetch-jd': 'fetch-jd.mjs',
  'parse-cv': 'parse-cv.mjs',
  backup: 'backup.mjs',
  board: 'board.mjs',
  contacts: 'contacts.mjs',
  digest: 'digest.mjs',
  'match-score': 'match-score.mjs',
  'cv-lint': 'cv-lint.mjs',
  gaps: 'gaps.mjs',
  salary: 'salary.mjs',
  interviews: 'interviews.mjs',
  templates: 'templates.mjs',
  scan: 'scan.mjs',
  merge: 'merge-tracker.mjs',
  tracker: 'tracker.mjs',
  render: 'render-views.mjs',
  verify: 'verify-pipeline.mjs',
  followup: 'followup.mjs',
  analyze: 'analyze.mjs',
  batch: 'batch.mjs',
  'seed-examples': 'seed-examples.mjs',
  'style:diff': 'style-diff.mjs',
  'style:profile': 'style-profile.mjs',
  'style:retrieve': 'style-retrieve.mjs',
  'hunt-ingest': 'hunt-ingest.mjs',
  'ui-queue': 'ui-queue.mjs',
};

// Resolve a command name to an absolute script path, or null if unknown.
export function resolveScript(cmd, root = ROOT) {
  const file = COMMANDS[cmd];
  return file ? join(root, 'scripts', file) : null;
}

export function helpText() {
  const names = Object.keys(COMMANDS);
  const width = Math.max(...names.map((n) => n.length));
  const lines = [
    'careeros — agent-native CV + cover-letter pipeline (works with any AI coding agent)',
    '',
    'Usage: careeros <command> [...args]',
    '',
    'Commands:',
    ...names.map((n) => `  ${n.padEnd(width)}  ->  scripts/${COMMANDS[n]}`),
    '',
    'Run any command with --help (or see its header) for its own options.',
  ];
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(helpText());
    process.exit(0);
  }

  const scriptPath = resolveScript(cmd);
  if (!scriptPath) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(helpText());
    process.exit(1);
  }

  const res = spawnSync(process.execPath, [scriptPath, ...rest], { stdio: 'inherit' });
  if (res.error) {
    console.error(`Failed to launch ${scriptPath}: ${res.error.message}`);
    process.exit(1);
  }
  // spawnSync sets `signal` when the child was killed by a signal (status is null).
  if (res.signal) process.exit(1);
  process.exit(res.status == null ? 1 : res.status);
}

// ---------- self-test ----------
async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  const { existsSync } = await import('node:fs');
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

  // 1) The routing table covers exactly the documented commands.
  const expected = [
    'doctor', 'compile', 'fetch-jd', 'parse-cv', 'backup', 'board', 'contacts', 'digest', 'match-score',
    'cv-lint', 'gaps', 'salary', 'interviews', 'templates', 'scan',
    'merge', 'tracker', 'render', 'verify', 'followup', 'analyze', 'batch', 'seed-examples', 'style:diff',
    'style:profile', 'style:retrieve', 'hunt-ingest', 'ui-queue',
  ];
  eq(COMMANDS.backup, 'backup.mjs', 'backup -> backup.mjs');
  eq(COMMANDS.contacts, 'contacts.mjs', 'contacts -> contacts.mjs');
  eq(COMMANDS['parse-cv'], 'parse-cv.mjs', 'parse-cv -> parse-cv.mjs');
  eq(COMMANDS.digest, 'digest.mjs', 'digest -> digest.mjs');
  eq(Object.keys(COMMANDS).length, expected.length, 'command count matches');
  for (const c of expected) ok(COMMANDS[c], `command "${c}" is mapped`);

  // 2) Specific mappings are correct.
  eq(COMMANDS.doctor, 'doctor.mjs', 'doctor -> doctor.mjs');
  eq(COMMANDS.compile, 'compile-latex.mjs', 'compile -> compile-latex.mjs');
  eq(COMMANDS.merge, 'merge-tracker.mjs', 'merge -> merge-tracker.mjs');
  eq(COMMANDS.verify, 'verify-pipeline.mjs', 'verify -> verify-pipeline.mjs');
  eq(COMMANDS['style:diff'], 'style-diff.mjs', 'style:diff -> style-diff.mjs');
  eq(COMMANDS['style:retrieve'], 'style-retrieve.mjs', 'style:retrieve -> style-retrieve.mjs');
  eq(COMMANDS['hunt-ingest'], 'hunt-ingest.mjs', 'hunt-ingest -> hunt-ingest.mjs');
  eq(COMMANDS['ui-queue'], 'ui-queue.mjs', 'ui-queue -> ui-queue.mjs');

  // 3) resolveScript returns absolute paths inside scripts/ for known cmds, null otherwise.
  const p = resolveScript('doctor');
  ok(p && p.endsWith(join('scripts', 'doctor.mjs')), 'resolveScript resolves into scripts/');
  ok(p && p.startsWith(ROOT), 'resolveScript path is rooted at repo root');
  eq(resolveScript('nope'), null, 'unknown command resolves to null');
  eq(resolveScript(''), null, 'empty command resolves to null');

  // 4) Routing is a pure name->path mapping; we don't require every target to
  //    exist on disk (some scripts are built later — the dispatcher still routes
  //    to them and the child reports a missing-module error at runtime). But the
  //    scripts present in this repo MUST be reachable through a command name.
  const reverse = new Map(Object.entries(COMMANDS).map(([c, f]) => [f, c]));
  for (const f of ['doctor.mjs', 'compile-latex.mjs', 'analyze.mjs', 'followup.mjs']) {
    if (existsSync(join(ROOT, 'scripts', f))) {
      ok(reverse.has(f), `existing script ${f} is routable`);
    }
  }

  // 5) Help text mentions every command name.
  const help = helpText();
  for (const c of Object.keys(COMMANDS)) ok(help.includes(c), `help lists "${c}"`);

  console.log(`cli self-test: ${checks} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).includes('--self-test')) {
    selfTest().then(() => process.exit(0)).catch((e) => {
      console.error(`cli self-test FAILED: ${e.message}`);
      process.exit(1);
    });
  } else {
    main();
  }
}
