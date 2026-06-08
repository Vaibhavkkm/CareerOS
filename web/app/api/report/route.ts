import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { safeDataPath } from '@/lib/paths';
import { extractMachineSummary, reportProse } from '@/lib/report';
import { bad } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/report?path=data/reports/NNN-...md — Machine Summary + prose.
export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get('path') || '';
  const abs = safeDataPath(rel);
  if (!abs) return bad('path not allowed');
  if (!existsSync(abs)) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  try {
    const md = readFileSync(abs, 'utf8');
    return NextResponse.json({ ok: true, summary: extractMachineSummary(md), prose: reportProse(md) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
