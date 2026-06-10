import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { readJson, fromRun, bad } from '@/lib/http';
import { gateMutation, isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The only request kinds the UI may enqueue (all agent-judgment / MCP work).
// A tracker `applied` flip is NOT here — it is Class A and needs a human confirm.
const KINDS = new Set(['onboard', 'evaluate', 'build-cv', 'build-cl', 'apply', 'hunt']);

// GET /api/queue?status=queued — list requests (the UI polls this).
export async function GET(request: Request) {
  // Public demo: no queue file / engine on a serverless host — report an empty queue.
  if (isPublicMode()) return NextResponse.json({ ok: true, requests: [] });

  const status = new URL(request.url).searchParams.get('status');
  const args = ['list', '--json'];
  if (status) args.push('--status', status);
  const r = await runScript('ui-queue.mjs', args, { timeoutMs: 10_000 });
  return fromRun(r, 'could not read the queue');
}

// POST /api/queue {kind, args} — enqueue agent work; the /cos agent drains it.
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;
  const body = await readJson(request);
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!KINDS.has(kind)) return bad(`kind must be one of ${[...KINDS].join(', ')}`);
  const args = body.args && typeof body.args === 'object' ? body.args : {};
  const r = await runScript('ui-queue.mjs', ['enqueue', '--kind', kind, '--args', JSON.stringify(args), '--origin', 'web'], { timeoutMs: 10_000 });
  return fromRun(r, 'could not enqueue request');
}
