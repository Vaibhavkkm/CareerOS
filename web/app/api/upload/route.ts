import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@/lib/repo';
import { runScript } from '@/lib/run';
import { bad, fromRun } from '@/lib/http';
import { gateMutation } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/upload — multipart form with a `cv` and/or `cl` file. Saves them under
// data/ui/uploads/ (the ONLY data/ area the web app may write — see DATA_CONTRACT)
// and enqueues an `onboard` request so the /cos agent learns the user's facts +
// voice from them (modes/onboard.md), after which the board ranks jobs by THIS CV.

// What the onboarding agent can actually read.
const EXT_ALLOW = new Set(['.pdf', '.docx', '.doc', '.txt', '.md', '.tex', '.rtf']);
const MAX_BYTES = 15 * 1024 * 1024;
const SLOTS = ['cv', 'cl'] as const;

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
    return bad('multipart form-data with a `cv` and/or `cl` file expected');
  }

  // Validate everything BEFORE writing anything, so a bad CL never leaves a
  // half-saved upload behind.
  const picked: { slot: (typeof SLOTS)[number]; file: File; ext: string }[] = [];
  for (const slot of SLOTS) {
    const f = form.get(slot);
    if (!(f instanceof File) || f.size === 0) continue;
    const ext = path.extname(f.name || '').toLowerCase();
    if (!EXT_ALLOW.has(ext)) {
      return bad(`${slot}: unsupported file type "${ext || '(none)'}" — use pdf, docx, txt, md or tex`);
    }
    if (f.size > MAX_BYTES) return bad(`${slot}: file too large (max 15 MB)`);
    picked.push({ slot, file: f, ext });
  }
  if (picked.length === 0) return bad('attach a CV and/or a cover letter');

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const relDir = `data/ui/uploads/${stamp}`;
  const absDir = path.join(repoRoot(), relDir);
  mkdirSync(absDir, { recursive: true });

  const saved: Record<string, string> = {};
  for (const { slot, file, ext } of picked) {
    const name = `${slot}-${safeName(file.name, `${slot}${ext}`)}`;
    writeFileSync(path.join(absDir, name), Buffer.from(await file.arrayBuffer()));
    saved[slot] = `${relDir}/${name}`;
  }

  const r = await runScript(
    'ui-queue.mjs',
    ['enqueue', '--kind', 'onboard', '--args', JSON.stringify(saved), '--origin', 'web'],
    { timeoutMs: 10_000 },
  );
  return fromRun(r, 'files saved but the onboard request could not be queued');
}
