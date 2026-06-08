import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/health — doctor readiness (doctor exits 1 when not ready, but still
// prints its JSON, so we return whatever it produced).
export async function GET() {
  const r = await runScript('doctor.mjs', ['--json'], { timeoutMs: 15_000 });
  if (r.data) return NextResponse.json(r.data);
  return NextResponse.json({ ready: false, error: r.error || 'doctor failed', checks: [] });
}
