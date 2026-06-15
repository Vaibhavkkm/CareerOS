import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@/lib/repo';
import { runScript } from '@/lib/run';
import { bad, fromRun } from '@/lib/http';
import { gateMutation } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/upload — multipart form with one or more `cv` files and/or a `cl` file.
// Saves them under data/ui/uploads/ (the ONLY data/ area the web app may write — see
// DATA_CONTRACT) and enqueues an `onboard` request so the /cos agent (or the optional
// daemon) learns the user's facts + voice from them (modes/onboard.md). Multiple CVs
// are merged into one richer master by the agent. The route writes NO user facts and
// NEVER flips a tracker record.

const EXT_ALLOW = new Set(['.pdf', '.docx', '.doc', '.txt', '.md', '.tex', '.rtf']);
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_CVS = 8; // a reasonable batch cap

// Keep only filename-safe characters; never trust a client-supplied path.
function safeName(original: string, fallback: string): string {
  const base = path.basename(original || fallback);
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.replace(/^\.+/, '') || fallback;
}

export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad('multipart form-data with one or more `cv` files and/or a `cl` file expected');
  }

  // Gather all CV files (repeated `cv` field) + an optional single cover letter.
  const cvFiles = form.getAll('cv').filter((f): f is File => f instanceof File && f.size > 0);
  const clRaw = form.get('cl');
  const clFile = clRaw instanceof File && clRaw.size > 0 ? clRaw : null;

  if (cvFiles.length === 0 && !clFile) return bad('attach at least one CV and/or a cover letter');
  if (cvFiles.length > MAX_CVS) return bad(`too many CVs (max ${MAX_CVS} at once)`);

  // Validate EVERYTHING before writing anything, so a bad file never leaves a
  // half-saved upload behind.
  const validate = (f: File, slot: string) => {
    const ext = path.extname(f.name || '').toLowerCase();
    if (!EXT_ALLOW.has(ext)) return `${slot}: unsupported file type "${ext || '(none)'}" — use pdf, docx, txt, md or tex`;
    if (f.size > MAX_BYTES) return `${slot}: "${f.name}" is too large (max 15 MB)`;
    return null;
  };
  for (const f of cvFiles) { const e = validate(f, 'cv'); if (e) return bad(e); }
  if (clFile) { const e = validate(clFile, 'cl'); if (e) return bad(e); }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const relDir = `data/ui/uploads/${stamp}`;
  const absDir = path.join(repoRoot(), relDir);
  mkdirSync(absDir, { recursive: true });

  // Save each file with a slot-prefixed name so a human/agent can tell a CV from a
  // cover letter; multiple CVs get a numeric suffix to avoid name collisions.
  const cvRel: string[] = [];
  for (let i = 0; i < cvFiles.length; i++) {
    const file = cvFiles[i];
    const ext = path.extname(file.name || '').toLowerCase();
    const prefix = cvFiles.length > 1 ? `cv${i + 1}` : 'cv';
    const name = `${prefix}-${safeName(file.name, `${prefix}${ext}`)}`;
    writeFileSync(path.join(absDir, name), Buffer.from(await file.arrayBuffer()));
    cvRel.push(`${relDir}/${name}`);
  }
  let clRel: string | null = null;
  if (clFile) {
    const ext = path.extname(clFile.name || '').toLowerCase();
    const name = `cl-${safeName(clFile.name, `cl${ext}`)}`;
    writeFileSync(path.join(absDir, name), Buffer.from(await clFile.arrayBuffer()));
    clRel = `${relDir}/${name}`;
  }

  // Enqueue an onboard request. `dir` drives the deterministic parse
  // (`parse-cv --dir <dir>`) used by both modes/onboard.md and the optional daemon;
  // `cv`/`cl` keep the explicit mapping for the agent.
  const args = {
    dir: relDir,
    files: [...cvRel, ...(clRel ? [clRel] : [])],
    cv: cvRel,
    cl: clRel,
    mode: 'merge',
  };

  const r = await runScript(
    'ui-queue.mjs',
    ['enqueue', '--kind', 'onboard', '--args', JSON.stringify(args), '--origin', 'web'],
    { timeoutMs: 10_000 },
  );
  return fromRun(r, 'files saved but the onboard request could not be queued');
}
