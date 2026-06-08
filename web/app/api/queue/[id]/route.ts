import { runScript } from '@/lib/run';
import { fromRun } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/queue/<id> — one request's live status (poll a specific request).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const r = await runScript('ui-queue.mjs', ['get', '--id', params.id], { timeoutMs: 10_000 });
  return fromRun(r, 'request not found');
}
