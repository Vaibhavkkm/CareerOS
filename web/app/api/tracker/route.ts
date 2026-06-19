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

// POST /api/tracker — two shapes:
//   • {id, status?, notes?, cv_pdf?, cl_pdf?, confirmApplied?}     → UPDATE a record by id
//     (the Pipeline tab's per-row status selector).
//   • {company, role, url?, status, confirmApplied?}  (no id)      → CREATE-OR-ADVANCE from a
//     board row (the Board drawer's "I applied" button). tracker.mjs `add` is an
//     upsert: it dedups by company + fuzzy role and status only ever moves FORWARD,
//     so an already-tracked opening is advanced and an untracked one is created.
// Either way, setting `applied` ALWAYS requires the human confirm — CareerOS never
// records an application you didn't tell it you submitted yourself.
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;
  const body = await readJson(request);

  const status = typeof body.status === 'string' ? body.status.trim() : '';
  if (status && !CANONICAL_STATUS.has(status)) return bad(`unknown status: ${status}`);

  // The human must confirm they personally submitted — never auto-apply. Because
  // `status` is now strictly canonical, this single check can't be bypassed by an
  // alias spelling, and it guards BOTH the update and the create paths below.
  if (status === 'applied' && body.confirmApplied !== true) {
    return NextResponse.json(
      { ok: false, error: 'needs_confirm', message: 'Marking a role Applied requires confirming you submitted it yourself.' },
      { status: 409 },
    );
  }

  // ── UPDATE an existing record by id ──────────────────────────────────────
  if (body.id != null && body.id !== '') {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return bad('a valid integer id is required');

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

  // ── CREATE-OR-ADVANCE from a board row (no id) ───────────────────────────
  // The "I applied" button sends company + role (+ url) with status=applied.
  const company = safeValue(body.company);
  const role = safeValue(body.role);
  if (!company || !role) {
    // Distinguish a present-but-rejected value (leading dash — see safeValue) from a
    // genuinely missing one, so the 400 doesn't read as "missing" when it was filtered.
    const present = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
    if ((present(body.company) && !company) || (present(body.role) && !role)) {
      return bad('company and role must not start with a dash');
    }
    return bad('a record id, or both company and role, are required');
  }
  if (!status) return bad('a status is required to add a record');

  const args = ['add', '--company', company, '--role', role, '--status', status, '--json'];
  const url = safeValue(body.url);
  if (url) args.push('--url', url);

  const r = await runScript('tracker.mjs', args, { timeoutMs: 10_000 });
  return fromRun(r, 'could not add to tracker');
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
