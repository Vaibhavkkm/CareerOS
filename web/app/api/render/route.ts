import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { runScript } from '@/lib/run';
import { fromRun } from '@/lib/http';
import { gateMutation, isPublicMode } from '@/lib/gate';
import { safeDataPath } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/render?path=data/reports/... — serve raw text of a report or .tex file
export async function GET(request: Request) {
  if (isPublicMode()) return new NextResponse('not found', { status: 404 });
  const rel = new URL(request.url).searchParams.get('path') || '';
  const allowed = rel.endsWith('.md') || rel.endsWith('.tex') || rel.endsWith('.txt');
  if (!allowed) return new NextResponse('only .md/.tex/.txt', { status: 400 });
  const abs = safeDataPath(rel);
  if (!abs || !existsSync(abs)) return new NextResponse('not found', { status: 404 });
  const text = readFileSync(abs, 'utf8');
  return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// POST /api/render — regenerate data/tracker.md + data/progress.md from the JSONL truth.
export async function POST() {
  const gate = gateMutation();
  if (gate) return gate;
  const r = await runScript('render-views.mjs', ['--json'], { timeoutMs: 10_000 });
  return fromRun(r, 'render failed');
}
