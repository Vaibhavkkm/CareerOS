import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { runScript } from '@/lib/run';
import { gateMutation } from '@/lib/gate';
import { repoRoot } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/run-queue — process whatever is queued NOW (the "Run queue" button).
// The browser can't run the agent itself, so this spawns a one-shot drainer
// (server/run-once.mjs) detached and returns immediately. The drainer uses the
// configured provider (default: your Claude Code login) and ui-queue `claim`, so
// it's safe to run alongside the persistent daemon. Gated like any mutation.
export async function POST() {
  const gate = gateMutation();
  if (gate) return gate;

  // How much is queued right now (so the UI can say "processing N…")?
  const list = await runScript<{ requests?: unknown[] } | unknown[]>(
    'ui-queue.mjs',
    ['list', '--status', 'queued', '--json'],
    { timeoutMs: 10_000 },
  );
  const reqs = Array.isArray(list.data)
    ? list.data
    : ((list.data as { requests?: unknown[] })?.requests ?? []);
  const queued = Array.isArray(reqs) ? reqs.length : 0;

  if (!queued) return NextResponse.json({ ok: true, queued: 0 });

  // Fire-and-forget: the drain spawns `claude` per item and can take minutes, so we
  // detach and let the queue's own status (polled by the UI) report progress.
  try {
    const root = repoRoot();
    const child = spawn(process.execPath, [join(root, 'server', 'run-once.mjs')], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, queued, started: true });
}
