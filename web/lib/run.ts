import { execFile } from 'node:child_process';
import path from 'node:path';
import { repoRoot } from './repo';

// The ONLY engine scripts the web app may spawn. A client never supplies a path;
// routes pick a name from this set. This is the RCE / path-traversal guard.
const ALLOW = new Set([
  'board.mjs',
  'scan.mjs',
  'fetch-jd.mjs',
  'tracker.mjs',
  'render-views.mjs',
  'ui-queue.mjs',
  'doctor.mjs',
  'hunt-ingest.mjs',
  'jobspy.mjs',
]);

export interface RunResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: number;
  stderr?: string;
}

// Spawn an engine script (never a shell), capture stdout, parse JSON. Engine
// scripts print a JSON envelope on stdout and use exit codes for status; many
// print a useful `{ok:false,error}` even on a non-zero exit, so we trust the
// parsed `ok` field when present rather than the exit code alone.
export function runScript<T = unknown>(
  script: string,
  args: string[] = [],
  opts: { timeoutMs?: number; input?: string } = {},
): Promise<RunResult<T>> {
  return new Promise((resolve) => {
    if (!ALLOW.has(script)) {
      resolve({ ok: false, error: `script not allowed: ${script}` });
      return;
    }
    const root = repoRoot();
    const file = path.join(root, 'scripts', script);
    const child = execFile(
      process.execPath,
      [file, ...args],
      { cwd: root, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        let data: unknown;
        if (out) {
          try { data = JSON.parse(out); } catch { /* not JSON — leave undefined */ }
        }
        const hasOk =
          data !== null && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'ok');
        if (data !== undefined) {
          const ok = hasOk ? (data as { ok: boolean }).ok !== false : !err;
          resolve({ ok, data: data as T, code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0, stderr: String(stderr || '') });
          return;
        }
        resolve({
          ok: false,
          error: err ? err.message : 'script produced no JSON output',
          code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0,
          stderr: String(stderr || ''),
          data: out as T,
        });
      },
    );
    if (opts.input != null && child.stdin) {
      child.stdin.end(opts.input);
    }
  });
}
