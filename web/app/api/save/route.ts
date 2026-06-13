import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { readJson, fromRun, bad } from '@/lib/http';
import { gateMutation, isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/save — list the user's saved (bookmarked) jobs. The board polls this to
// render the ★ state and the "Saved (N)" count.
export async function GET() {
  if (isPublicMode()) return NextResponse.json({ ok: true, count: 0, saved: [] });
  const r = await runScript('saved.mjs', ['list', '--json'], { timeoutMs: 10_000 });
  return fromRun(r, 'could not read saved jobs');
}

// POST /api/save
//   {action:"add", job:{url, company, role, jd_path, location, posted, band, score}}
//   {action:"remove", url|id}
//   {action:"clear"}
// Saving is a private shortlist — it never touches the tracker or marks anything
// applied (that stays a Class-A, human-confirmed action).
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;
  const body = await readJson(request);
  const action = typeof body.action === 'string' ? body.action : 'add';

  if (action === 'clear') {
    const r = await runScript('saved.mjs', ['clear', '--json'], { timeoutMs: 10_000 });
    return fromRun(r, 'could not clear saved jobs');
  }
  if (action === 'remove') {
    const args = ['remove', '--json'];
    if (typeof body.url === 'string' && body.url) args.push('--url', body.url);
    else if (typeof body.id === 'string' && body.id) args.push('--id', body.id);
    else return bad('remove needs a url or id');
    const r = await runScript('saved.mjs', args, { timeoutMs: 10_000 });
    return fromRun(r, 'could not remove saved job');
  }
  if (action === 'add') {
    const job = body.job && typeof body.job === 'object' ? (body.job as Record<string, unknown>) : null;
    if (!job || (!job.url && !job.jd_path && !(job.company && job.role))) {
      return bad('add needs a job with a url, jd_path, or company+role');
    }
    const r = await runScript('saved.mjs', ['add', '--data', JSON.stringify(job), '--json'], { timeoutMs: 10_000 });
    return fromRun(r, 'could not save job');
  }
  return bad('action must be add, remove, or clear');
}
