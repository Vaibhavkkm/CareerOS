#!/usr/bin/env node
// server/daemon.mjs — CareerOS background daemon
// Polls data/ui/requests.jsonl, drains queued items using the configured LLM,
// writes heartbeat so the dashboard shows "agent live".
//
// Supported providers (set in .careeros.config.json):
//   claude-cli     — user's Claude Code subscription (default, no API key needed)
//   ollama         — local models via Ollama (free, private)
//   openai-compat  — any OpenAI-compatible endpoint (OpenRouter, Groq, Together.ai…)
//
// Usage:
//   node server/daemon.mjs             # use .careeros.config.json
//   node server/daemon.mjs --provider ollama --model llama3.2
//   node server/daemon.mjs --provider openai-compat --endpoint https://openrouter.ai/api --key sk-or-... --model meta-llama/llama-3.2-3b-instruct:free

import { execFileSync, execFile } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, loadConfig, PROVIDERS } from './config.mjs';
import { getAdapter } from './adapters/index.mjs';
import { dispatch } from './handlers/index.mjs';
import { runScript } from './run.mjs';

// ─── CLI args override config ────────────────────────────────────────
function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider' && argv[i + 1]) out.provider = argv[++i];
    if (argv[i] === '--model'    && argv[i + 1]) out.model    = argv[++i];
    if (argv[i] === '--endpoint' && argv[i + 1]) out.endpoint = argv[++i];
    if (argv[i] === '--key'      && argv[i + 1]) out.apiKey   = argv[++i];
    if (argv[i] === '--interval' && argv[i + 1]) out.pollIntervalMs = parseInt(argv[++i], 10) * 1000;
  }
  return out;
}

const cliOverrides = parseCliArgs(process.argv.slice(2));
const config = { ...loadConfig(), ...cliOverrides };

if (!PROVIDERS.includes(config.provider)) {
  console.error(`[daemon] unknown provider "${config.provider}". Use: ${PROVIDERS.join(', ')}`);
  process.exit(1);
}

const generate = getAdapter(config);
const POLL_MS = config.pollIntervalMs ?? 15_000;

log(`CareerOS daemon starting`);
log(`provider: ${config.provider}${config.model ? ` / ${config.model}` : ''}${config.endpoint ? ` @ ${config.endpoint}` : ''}`);
log(`polling every ${POLL_MS / 1000}s — queue: data/ui/requests.jsonl`);

// ─── heartbeat ───────────────────────────────────────────────────────
function writeHeartbeat() {
  runScript('ui-queue.mjs', ['heartbeat'], { timeoutMs: 5_000 }).catch(() => {});
}
function stopHeartbeat() {
  runScript('ui-queue.mjs', ['heartbeat', 'stop'], { timeoutMs: 5_000 }).catch(() => {});
}

// ─── graceful shutdown ────────────────────────────────────────────────
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal} — stopping daemon, clearing heartbeat`);
  await stopHeartbeat();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── queue helpers (via ui-queue.mjs CLI) ─────────────────────────────
async function listQueued() {
  const r = await runScript('ui-queue.mjs', ['list', '--status', 'queued', '--json'], { timeoutMs: 10_000 });
  if (!r.ok) return [];
  return (r.data?.requests || r.data || []);
}

async function claimRequest(id) {
  const r = await runScript('ui-queue.mjs', ['claim', '--id', id], { timeoutMs: 10_000 });
  return r.ok;
}

async function completeRequest(id, result) {
  await runScript('ui-queue.mjs', [
    'complete', '--id', id,
    '--result', JSON.stringify(result),
  ], { timeoutMs: 10_000 });
}

async function failRequest(id, error) {
  await runScript('ui-queue.mjs', [
    'fail', '--id', id,
    '--error', String(error).slice(0, 300),
  ], { timeoutMs: 10_000 });
}

// ─── drain one cycle ──────────────────────────────────────────────────
async function drainCycle() {
  const queued = await listQueued();
  if (!queued.length) return;

  log(`${queued.length} queued item(s) found`);

  for (const req of queued) {
    if (stopping) break;
    const { id, kind, args } = req;
    log(`→ [${id}] kind=${kind}${args?.cmd ? ` cmd=${args.cmd}` : ''}${args?.target ? ` target=${args.target}` : ''}`);

    const claimed = await claimRequest(id);
    if (!claimed) { log(`  skip ${id} (already claimed)`); continue; }

    try {
      const result = await dispatch(req, generate);
      await completeRequest(id, result);
      log(`  ✓ [${id}] done — ${summarize(result)}`);
    } catch (e) {
      const msg = e?.message || String(e);
      await failRequest(id, msg);
      log(`  ✗ [${id}] failed — ${msg}`);
    }
  }
}

function summarize(result) {
  if (!result) return 'ok';
  if (result.pdf) return `pdf → ${result.pdf}`;
  if (result.report) return `report → ${result.report}`;
  if (result.parsed !== undefined) return `parsed ${result.parsed} file(s)`;
  if (result.output) return `output (${String(result.output).slice(0, 60)}…)`;
  return JSON.stringify(result).slice(0, 80);
}

// ─── main loop ────────────────────────────────────────────────────────
async function main() {
  // Ensure data/ui/ exists
  await runScript('doctor.mjs', [], { timeoutMs: 15_000 }).catch(() => {});

  writeHeartbeat();
  log('heartbeat written — dashboard shows agent live');

  // Initial drain
  await drainCycle().catch((e) => log(`drain error: ${e.message}`));

  // Poll loop
  const interval = setInterval(async () => {
    if (stopping) { clearInterval(interval); return; }
    writeHeartbeat();
    await drainCycle().catch((e) => log(`drain error: ${e.message}`));
  }, POLL_MS);

  log(`watching queue (Ctrl+C to stop)`);
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[daemon ${ts}] ${msg}`);
}

main().catch((e) => {
  console.error('[daemon] fatal:', e.message);
  process.exit(1);
});
