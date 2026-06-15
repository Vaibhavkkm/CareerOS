// server/run.mjs — run a CareerOS engine script, return { ok, data, error, stderr }
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './config.mjs';

const SCRIPTS_DIR = join(ROOT, 'scripts');

export function runScript(script, args = [], { timeoutMs = 30_000, input } = {}) {
  return new Promise((resolve) => {
    const file = join(SCRIPTS_DIR, script);
    const child = execFile(
      process.execPath,
      [file, ...args],
      { cwd: ROOT, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        let data;
        if (out) { try { data = JSON.parse(out); } catch { /* not JSON */ } }
        const hasOk = data !== null && typeof data === 'object' && 'ok' in data;
        if (data !== undefined) {
          resolve({ ok: hasOk ? data.ok !== false : !err, data, stderr: String(stderr || '') });
          return;
        }
        resolve({ ok: false, error: err?.message || 'no JSON output', stderr: String(stderr || ''), raw: out });
      },
    );
    if (input != null && child.stdin) { child.stdin.end(input); }
  });
}
