#!/usr/bin/env node
// start.mjs — launch web dashboard + daemon together
// Usage: node start.mjs [--no-daemon] [--no-web] [daemon flags...]
// Example: node start.mjs --provider ollama --model llama3.2
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const noWeb    = argv.includes('--no-web');
const noDaemon = argv.includes('--no-daemon');
const daemonArgs = argv.filter((a) => a !== '--no-web' && a !== '--no-daemon');

const procs = [];

function prefix(name, color) {
  // ANSI colors: web=cyan(36), daemon=yellow(33)
  const c = color === 'cyan' ? '36' : '33';
  return (line) => process.stdout.write(`\x1b[${c}m[${name}]\x1b[0m ${line}\n`);
}

function launch(label, color, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = prefix(label, color);
  const err = prefix(label, color);
  p.stdout.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(out));
  p.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(err));
  p.on('close', (code) => {
    out(`exited (${code})`);
    if (code !== 0) {
      procs.forEach((x) => x.kill());
      process.exit(code ?? 1);
    }
  });
  procs.push(p);
  return p;
}

if (!noWeb) {
  launch('web', 'cyan', process.execPath, ['node_modules/.bin/next', 'dev', '-H', '127.0.0.1', '-p', '4317'], join(ROOT, 'web'));
}

if (!noDaemon) {
  // Give the web server a moment to start before daemon tries to write heartbeat
  setTimeout(() => {
    launch('daemon', 'yellow', process.execPath, [join(ROOT, 'server', 'daemon.mjs'), ...daemonArgs], ROOT);
  }, 2000);
}

// Forward Ctrl+C to all children
process.on('SIGINT', () => { procs.forEach((p) => p.kill('SIGINT')); });
process.on('SIGTERM', () => { procs.forEach((p) => p.kill('SIGTERM')); });

console.log('\x1b[1mCareerOS\x1b[0m starting...');
if (!noWeb)    console.log('  \x1b[36m[web]\x1b[0m    http://127.0.0.1:4317');
if (!noDaemon) console.log('  \x1b[33m[daemon]\x1b[0m queue drain active');
console.log('  Ctrl+C to stop both\n');
