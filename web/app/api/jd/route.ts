import { NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { safeDataPath } from '@/lib/paths';
import { repoRoot } from '@/lib/repo';
import { isPublicMode } from '@/lib/gate';
import { bad } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Parse a data/jds/*.md file (the format fetch-jd writes) — mirrors
// scripts/board.mjs `parseJdMarkdown`.
function parse(md: string) {
  const out = { role: '', company: '', url: '', location: '', posted: '', body: '' };
  const heading = md.match(/^#\s+(.+)$/m);
  if (heading) {
    const parts = heading[1].split(/\s+—\s+/);
    if (parts.length > 1) {
      out.company = parts.pop()!.trim();
      out.role = parts.join(' — ').trim();
    } else {
      out.role = heading[1].trim();
    }
  }
  const field = (label: string) => {
    const m = md.match(new RegExp(`^-\\s*${label}:\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : '';
  };
  out.url = field('URL');
  out.location = field('Location');
  out.posted = field('Posted');
  const bodyAll = md.split(/^##\s+Full posting\s*$/m)[1] || '';
  out.body = bodyAll.split(/^##\s+/m)[0].trim();
  return out;
}

// Find a saved data/jds/*.md whose "- URL:" matches `url` (for rows fetched live,
// which carry a URL but no saved jd_path). Returns the file's text, or null.
function findByUrl(url: string): string | null {
  if (!url) return null;
  const dir = path.resolve(repoRoot(), 'data/jds');
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); }
  catch { return null; }
  const want = url.trim();
  for (const f of files) {
    try {
      const text = readFileSync(path.join(dir, f), 'utf8');
      const m = text.match(/^-\s*URL:\s*(.+)$/mi);
      if (m && m[1].trim() === want) return text;
    } catch { /* skip unreadable file */ }
  }
  return null;
}

// GET /api/jd?path=data/jds/x.md — the saved posting (sandboxed read).
// GET /api/jd?url=<posting url> — fallback lookup by URL when no jd_path exists.
export async function GET(request: Request) {
  // Public demo: no private data/jds on a serverless host. The drawer renders its
  // "no description captured — open the original posting" fallback gracefully.
  if (isPublicMode()) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  const sp = new URL(request.url).searchParams;
  const rel = sp.get('path') || '';
  const url = sp.get('url') || '';

  if (rel) {
    const abs = safeDataPath(rel);
    if (!abs) return bad('path not allowed');
    if (existsSync(abs)) {
      try {
        return NextResponse.json({ ok: true, ...parse(readFileSync(abs, 'utf8')) });
      } catch (e) {
        return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }
  }

  if (url) {
    const text = findByUrl(url);
    if (text) return NextResponse.json({ ok: true, ...parse(text) });
  }

  return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
}
