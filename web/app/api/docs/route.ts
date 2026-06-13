import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '@/lib/repo';
import { isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DocEntry {
  jd_path: string;
  type: 'cv' | 'cl' | 'report' | 'tex';
  path: string;
  ts: string;
}

// GET /api/docs?jd_path=data/jds/...
// Return all generated documents (CV PDFs, CL PDFs, reports) for a job posting.
export async function GET(request: Request) {
  if (isPublicMode()) return NextResponse.json({ ok: true, docs: [] });

  const jd_path = new URL(request.url).searchParams.get('jd_path') || '';
  if (!jd_path) return NextResponse.json({ ok: true, docs: [] });

  const root = repoRoot();
  const manifestPath = join(root, 'data', 'ui', 'job-docs.jsonl');
  if (!existsSync(manifestPath)) return NextResponse.json({ ok: true, docs: [] });

  const lines = readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean);
  const docs: DocEntry[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as DocEntry;
      if (entry.jd_path === jd_path) {
        // Only include PDFs and reports that still exist on disk
        const abs = join(root, entry.path);
        if (existsSync(abs)) docs.push(entry);
      }
    } catch { /* skip malformed */ }
  }

  // Deduplicate: for same type+path keep latest
  const seen = new Map<string, DocEntry>();
  for (const d of docs) {
    const key = `${d.type}:${d.path}`;
    if (!seen.has(key) || d.ts > seen.get(key)!.ts) seen.set(key, d);
  }

  // Sort: newest first, PDF before tex
  const sorted = [...seen.values()].sort((a, b) => {
    if (a.type === 'tex' && b.type !== 'tex') return 1;
    if (b.type === 'tex' && a.type !== 'tex') return -1;
    return b.ts.localeCompare(a.ts);
  });

  return NextResponse.json({ ok: true, docs: sorted });
}
