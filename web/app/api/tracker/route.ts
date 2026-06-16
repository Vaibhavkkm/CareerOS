import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { readJson, fromRun, bad } from '@/lib/http';
import { gateMutation, isPublicMode } from '@/lib/gate';
import type { TrackerRecord } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The canonical status ids the UI is allowed to set (the ones from
// templates/states.yml). We accept ONLY these — never free-form aliases — so the
// confirm gate below can't be defeated by an alias that the engine's
// normalizeStatus() would canonicalize to `applied` (e.g. "application sent").
const CANONICAL_STATUS = new Set([
  'evaluated', 'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'skip',
]);

// A user value that starts with "-" could be re-parsed as a FLAG by the engine
// script's own arg parser (e.g. notes="--file=/x" would redirect the write
// target). execFile gives us no shell, but same-argv flag promotion is still
// possible — so reject leading-dash free-text values defensively.
function safeValue(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (v.startsWith('-')) return null;
  return v;
}

// GET /api/tracker?status=applied — list records (the source of truth).
export async function GET(request: Request) {
  // Public demo: no tracker file on a serverless host — render an empty pipeline.
  if (isPublicMode()) return NextResponse.json({ ok: true, records: [] });

  const status = new URL(request.url).searchParams.get('status');
  const args = ['list', '--json'];
  if (status && CANONICAL_STATUS.has(status)) args.push('--status', status);
  const r = await runScript<TrackerRecord[]>('tracker.mjs', args, { timeoutMs: 10_000 });
  if (!r.ok) return fromRun(r, 'could not read tracker');
  return NextResponse.json({ ok: true, records: r.data ?? [] });
}

// POST /api/tracker {id, status?, notes?, cv_pdf?, cl_pdf?, confirmApplied?} — update.
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;
  const body = await readJson(request);
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return bad('a valid integer id is required');

  const status = typeof body.status === 'string' ? body.status.trim() : '';
  if (status && !CANONICAL_STATUS.has(status)) return bad(`unknown status: ${status}`);

  // The human must confirm they personally submitted — never auto-apply. Because
  // `status` is now strictly canonical, this single check can't be bypassed by an
  // alias spelling.
  if (status === 'applied' && body.confirmApplied !== true) {
    return NextResponse.json(
      { ok: false, error: 'needs_confirm', message: 'Marking a role Applied requires confirming you submitted it yourself.' },
      { status: 409 },
    );
  }

  const args = ['update', '--id', String(id), '--json'];
  if (status) args.push('--status', status);
  const notes = safeValue(body.notes);
  const cvPdf = safeValue(body.cv_pdf);
  const clPdf = safeValue(body.cl_pdf);
  if (notes) args.push('--notes', notes);
  if (cvPdf) args.push('--cv_pdf', cvPdf);
  if (clPdf) args.push('--cl_pdf', clPdf);

  const r = await runScript('tracker.mjs', args, { timeoutMs: 10_000 });
  return fromRun(r, 'tracker update failed');
}

// DELETE /api/tracker?id=N — remove a record from the tracker. Goes through the
// engine script (never a raw web write), and is gated like any other mutation.
export async function DELETE(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return bad('a valid integer id is required');
  const r = await runScript('tracker.mjs', ['remove', '--id', String(id), '--json'], { timeoutMs: 10_000 });
  return fromRun(r, 'tracker remove failed');
}
