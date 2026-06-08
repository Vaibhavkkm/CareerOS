import { runScript } from '@/lib/run';
import { fromRun } from '@/lib/http';
import { gateMutation } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/render — regenerate data/tracker.md + data/progress.md from the JSONL truth.
export async function POST() {
  const gate = gateMutation();
  if (gate) return gate;
  const r = await runScript('render-views.mjs', ['--json'], { timeoutMs: 10_000 });
  return fromRun(r, 'render failed');
}
