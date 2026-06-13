import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runScript } from '@/lib/run';
import { repoRoot } from '@/lib/repo';
import { gateMutation, isPublicMode } from '@/lib/gate';
import { bad } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/onboard/parse { dir: "data/ui/uploads/<id>" }
// Run parse-cv on the uploaded files and return the combined text + simple extractions.
// Called by the wizard after upload to get parsed content for review.
export async function POST(request: Request) {
  if (isPublicMode()) return NextResponse.json({ ok: false, error: 'parse runs on your local instance' }, { status: 403 });
  const gate = gateMutation();
  if (gate) return gate;

  let body: { dir?: string };
  try { body = await request.json(); } catch { return bad('expected JSON body'); }
  const dir = typeof body.dir === 'string' ? body.dir : '';
  if (!dir) return bad('dir is required');

  // Path-safety: only allow paths under data/ui/uploads/
  if (!dir.startsWith('data/ui/uploads/') || dir.includes('..')) {
    return bad('dir must be under data/ui/uploads/');
  }

  const absDir = join(repoRoot(), dir);
  if (!existsSync(absDir)) return bad(`directory not found: ${dir}`);

  const r = await runScript('parse-cv.mjs', ['--dir', absDir, '--json'], { timeoutMs: 60_000 });

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error || 'parse-cv failed', stderr: r.stderr }, { status: 200 });
  }

  // parse-cv returns single-file envelope {ok,text,...} when dir has one file,
  // multi-file envelope {ok,count,docs:[...]} when dir has multiple files.
  const data = r.data as {
    ok?: boolean; count?: number;
    docs?: Array<{ text?: string; file?: string }>;
    text?: string; file?: string;  // single-file shape
  };
  let combined: string;
  if (data?.docs) {
    combined = data.docs.map((d) => d.text || '').filter(Boolean).join('\n\n---\n\n');
  } else if (data?.text) {
    combined = data.text;
  } else {
    return NextResponse.json({ ok: false, error: 'parse-cv returned no text' }, { status: 200 });
  }
  // Extract simple fields from combined text for pre-filling the form
  const extracted = extractFields(combined);

  return NextResponse.json({ ok: true, count: data?.count ?? (data?.docs?.length ?? 1), text: combined, extracted });
}

function extractFields(text: string) {
  const email = text.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/)?.[0] || '';
  const phone = text.match(/(?:\+?\d[\d\s\-().]{6,18}\d)/)?.[0]?.trim() || '';
  const linkedin = text.match(/linkedin\.com\/in\/[\w\-]+/i)?.[0] || '';
  const github = text.match(/github\.com\/[\w\-]+/i)?.[0] || '';
  // Name heuristic: first non-empty short line (≤50 chars, no @/:)
  const lines = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).filter(Boolean);
  const nameLine = lines.find((l) => l.length <= 50 && !l.includes('@') && !l.includes(':') && !l.includes('http'));
  return { email, phone, linkedin, github, name: nameLine || '' };
}
