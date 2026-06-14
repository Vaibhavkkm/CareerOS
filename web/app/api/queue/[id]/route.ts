import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { fromRun } from '@/lib/http';
import { gateMutation, isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/queue/<id> — one request's live status (poll a specific request).
// `params` is a Promise as of Next 15.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isPublicMode()) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const { id } = await params;
  const r = await runScript('ui-queue.mjs', ['get', '--id', id], { timeoutMs: 10_000 });
  return fromRun(r, 'request not found');
}

// DELETE /api/queue/<id> — cancel a request the user enqueued by mistake. The
// engine only cancels a STILL-QUEUED request (refuses once the agent has
// claimed/run it), archives it, and purges any staged uploads.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = gateMutation();
  if (gate) return gate;
  const { id } = await params;
  const r = await runScript('ui-queue.mjs', ['cancel', '--id', id], { timeoutMs: 10_000 });
  return fromRun(r, 'could not cancel the request');
}
