import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { runScript } from '@/lib/run';
import { bad, fromRun } from '@/lib/http';
import { gateMutation, isPublicMode } from '@/lib/gate';
import { safeDataPath } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/render?path=data/reports/x.md — return the raw text of a generated
// report (.md) or LaTeX source (.tex/.txt) so the drawer can show it inline.
// Read-only and sandboxed via safeDataPath (data/reports, data/output, data/jds).
export async function GET(request: Request) {
  // Public demo: never reveal the owner's generated reports/letters (PII).
  if (isPublicMode()) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const rel = new URL(request.url).searchParams.get('path') || '';
  if (!/\.(md|tex|txt)$/i.test(rel)) return bad('only .md, .tex or .txt files can be read');
  const abs = safeDataPath(rel);
  if (!abs) return bad('path not allowed');
  if (!existsSync(abs)) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  try {
    const text = readFileSync(abs, 'utf8');
    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/render — regenerate data/tracker.md + data/progress.md from the JSONL truth.
export async function POST() {
  const gate = gateMutation();
  if (gate) return gate;
  const r = await runScript('render-views.mjs', ['--json'], { timeoutMs: 10_000 });
  return fromRun(r, 'render failed');
}
