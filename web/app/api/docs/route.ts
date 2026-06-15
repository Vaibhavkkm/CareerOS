import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { repoRoot } from '@/lib/repo';
import { safeDataPath } from '@/lib/paths';
import { isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/docs?jd_path=…&url=… — list the generated CV/CL PDFs, eval report, and
// raw LaTeX for one job, so the drawer can show them inline. Read-only. Sources
// BOTH the daemon manifest (data/ui/job-docs.jsonl) and the tracker record
// (cv_pdf/cl_pdf/report) so a doc shows up however it was generated. Every returned
// path is sandboxed to the readable dirs (data/output, data/reports) so the client
// can load it via /api/pdf and /api/render.

type Doc = { type: 'cv' | 'cl' | 'report' | 'tex'; path: string; name: string };

const ORDER: Record<Doc['type'], number> = { cv: 0, cl: 1, report: 2, tex: 3 };

// Normalize a stored path to a repo-relative one under data/ (the tracker stores
// reports as "reports/…" without the data/ prefix).
function normalize(p: unknown): string | null {
  if (!p || typeof p !== 'string') return null;
  let s = p.replace(/^\.?\//, '').trim();
  if (!s) return null;
  if (s.startsWith('data/')) return s;
  if (/^(reports|output|jds)\//.test(s)) return `data/${s}`;
  return s;
}

function readJsonl(rel: string): Record<string, unknown>[] {
  const abs = `${repoRoot()}/${rel}`;
  if (!existsSync(abs)) return [];
  return readFileSync(abs, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
    .filter((r): r is Record<string, unknown> => r !== null);
}

export async function GET(request: Request) {
  // Public demo: never reveal the owner's generated documents (PII).
  if (isPublicMode()) return NextResponse.json({ ok: true, docs: [] });

  const sp = new URL(request.url).searchParams;
  const jdPath = sp.get('jd_path') || '';
  const url = sp.get('url') || '';
  if (!jdPath && !url) return NextResponse.json({ ok: true, docs: [] });

  const docs: Doc[] = [];
  const add = (type: Doc['type'], raw: unknown) => {
    const rel = normalize(raw);
    if (!rel) return;
    const abs = safeDataPath(rel); // also enforces the read sandbox
    if (!abs || !existsSync(abs)) return;
    if (docs.some((d) => d.path === rel)) return;
    docs.push({ type, path: rel, name: rel.split('/').pop() || rel });
  };

  // 1) Daemon manifest — entries are { jd_path, type, path, ts }.
  for (const e of readJsonl('data/ui/job-docs.jsonl')) {
    const ejd = String(e.jd_path || '');
    if ((jdPath && ejd === jdPath) || (url && String(e.url || '') === url)) {
      const t = String(e.type || '');
      if (t === 'cv' || t === 'cl' || t === 'report' || t === 'tex') add(t, e.path);
    }
  }

  // 2) Tracker record (cv_pdf / cl_pdf / report) — matched by jd_path or url.
  for (const r of readJsonl('data/tracker.jsonl')) {
    const matches = (jdPath && String(r.jd_path || '') === jdPath) || (url && String(r.url || '') === url);
    if (!matches) continue;
    add('cv', r.cv_pdf);
    add('cl', r.cl_pdf);
    add('report', r.report);
  }

  docs.sort((a, b) => ORDER[a.type] - ORDER[b.type] || a.name.localeCompare(b.name));
  return NextResponse.json({ ok: true, docs });
}
