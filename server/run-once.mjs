#!/usr/bin/env node
// server/run-once.mjs — drain the UI queue ONCE, then exit.
//
// Powers the web "Run queue" button: /api/run-queue spawns this detached so the
// browser can process queued work (build CV/CL, evaluate, onboard, command) on
// demand instead of waiting for the persistent daemon's poll. It reuses the SAME
// config / provider adapter / dispatch as server/daemon.mjs, and the ui-queue
// `claim` step is atomic, so running this alongside a live daemon is safe — neither
// will process the same item twice.
//
// Usage: node server/run-once.mjs   (provider comes from .careeros.config.json,
// default claude-cli — your Claude Code login, no API key).

import { loadConfig, PROVIDERS } from './config.mjs';
import { getAdapter } from './adapters/index.mjs';
import { dispatch } from './handlers/index.mjs';
import { runScript } from './run.mjs';

const config = loadConfig();
if (!PROVIDERS.includes(config.provider)) {
  console.log(JSON.stringify({ ok: false, error: `unknown provider "${config.provider}"` }));
  process.exit(1);
}
const generate = getAdapter(config);

async function listQueued() {
  const r = await runScript('ui-queue.mjs', ['list', '--status', 'queued', '--json'], { timeoutMs: 10_000 });
  return r.ok ? (r.data?.requests || r.data || []) : [];
}
const claim = (id) => runScript('ui-queue.mjs', ['claim', '--id', id], { timeoutMs: 10_000 }).then((r) => r.ok);
const complete = (id, result) => runScript('ui-queue.mjs', ['complete', '--id', id, '--result', JSON.stringify(result)], { timeoutMs: 10_000 });
const fail = (id, error) => runScript('ui-queue.mjs', ['fail', '--id', id, '--error', String(error).slice(0, 300)], { timeoutMs: 10_000 });

const queued = await listQueued();
let done = 0;
let failed = 0;
for (const req of queued) {
  if (!(await claim(req.id))) continue; // already claimed (e.g. by the daemon) → skip
  try {
    const result = await dispatch(req, generate);
    await complete(req.id, result);
    done++;
  } catch (e) {
    await fail(req.id, e?.message || String(e));
    failed++;
  }
}
console.log(JSON.stringify({ ok: true, processed: queued.length, done, failed }));
