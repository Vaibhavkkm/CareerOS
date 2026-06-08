import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { safeDataPath } from '@/lib/paths';
import { bad } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/pdf?path=data/output/x.pdf — stream a generated PDF (sandboxed read).
export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get('path') || '';
  if (!rel.toLowerCase().endsWith('.pdf')) return bad('only .pdf files can be served');
  const abs = safeDataPath(rel);
  if (!abs) return bad('path not allowed');
  if (!existsSync(abs)) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  try {
    const buf = readFileSync(abs);
    // Sanitize the filename before putting it in the header: a stray double-quote,
    // CR or LF in a basename would break the Content-Disposition (or inject a
    // header). Keep only filename-safe ASCII.
    const safeName = path.basename(abs).replace(/[^A-Za-z0-9._-]/g, '_') || 'document.pdf';
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
