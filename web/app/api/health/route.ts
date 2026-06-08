import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/health — doctor readiness (doctor exits 1 when not ready, but still
// prints its JSON, so we return whatever it produced).
export async function GET() {
  // Public demo: never spawn doctor.mjs or reveal the owner's setup — static OK.
  if (isPublicMode()) return NextResponse.json({ ready: true, demo: true, checks: [] });
  const r = await runScript('doctor.mjs', ['--json'], { timeoutMs: 15_000 });
  if (r.data) return NextResponse.json(r.data);
  return NextResponse.json({ ready: false, error: r.error || 'doctor failed', checks: [] });
}
