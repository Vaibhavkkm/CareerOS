import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runScript } from '@/lib/run';
import { gateMutation } from '@/lib/gate';
import { repoRoot } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// File types the CV parser (scripts/parse-cv.mjs) can handle.
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.doc', '.rtf', '.html', '.htm', '.odt', '.txt', '.md', '.markdown', '.tex']);
const MAX_FILES = 6;
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB per file

// Keep only a safe basename: no path separators, no traversal, a conservative
// charset. This is the path-injection guard for the one place the web app writes
// user-named files. A name that sanitises to empty is rejected by the caller.
function safeName(name: string): string {
  const base = path.basename(String(name || '')).replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').trim();
  return base.slice(0, 120);
}

// A short folder id from time + randomness (this is a normal Next route, not a
// workflow script, so Date.now()/Math.random() are fine here).
function batchId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x10000).toString(36).padStart(4, '0')}`;
}

// POST /api/upload-cv  (multipart/form-data: files[], mode?=merge|replace)
// "Upload your CV(s)": the browser sends the raw files; we save them under
// data/ui/uploads/<id>/ (the ONLY directory the web app may write — DATA_CONTRACT
// guardrail) and ENQUEUE an `onboard` request pointing at that folder. The web app
// never parses the CV or writes cv.master.md itself (no LLM here): the in-session
// `/cos` agent drains the queue (modes/ui.md → onboard merge), parses every file
// with scripts/parse-cv.mjs, and merges them into the master — with the user's
// approval. Nothing is fabricated and no facts are written from here.
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected multipart/form-data with file(s)' }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const mode = form.get('mode') === 'replace' ? 'replace' : 'merge';

  if (!files.length) return NextResponse.json({ ok: false, error: 'attach at least one CV file' }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ ok: false, error: `at most ${MAX_FILES} files at once` }, { status: 400 });

  const id = batchId();
  const relDir = path.posix.join('data', 'ui', 'uploads', id);
  const absDir = path.join(repoRoot(), 'data', 'ui', 'uploads', id);

  const saved: string[] = [];
  try {
    await mkdir(absDir, { recursive: true });
    for (const file of files) {
      const name = safeName(file.name);
      const ext = path.extname(name).toLowerCase();
      if (!name || !ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ ok: false, error: `unsupported file: ${file.name} (allowed: ${[...ALLOWED_EXT].join(', ')})` }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        return NextResponse.json({ ok: false, error: `${file.name} is too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 400 });
      }
      await writeFile(path.join(absDir, name), buf);
      saved.push(name);
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: `could not save upload: ${(e as Error).message}` }, { status: 500 });
  }

  // Enqueue an onboard request pointing at the saved folder. The agent merges.
  const args = JSON.stringify({ dir: relDir, files: saved, mode });
  const r = await runScript('ui-queue.mjs', ['enqueue', '--kind', 'onboard', '--args', args, '--origin', 'web'], { timeoutMs: 10_000 });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error || 'saved the files but could not queue onboarding', saved, dir: relDir }, { status: 200 });
  }

  const data = (r.data ?? {}) as { request?: { id?: string } };
  return NextResponse.json({
    ok: true,
    saved,
    dir: relDir,
    mode,
    request: data.request,
    message: `Uploaded ${saved.length} file(s). Run /cos ui (or /cos onboard) in Claude Code to ${mode === 'replace' ? 'rebuild' : 'merge into'} your master CV.`,
  });
}
