// server/handlers/onboard.mjs — parse uploaded CVs, write to data/cv-sources/
// IMPORTANT: does NOT write to data/cv.master.md autonomously.
// Guardrail: master CV merge requires human review. Daemon parses the files,
// writes parsed output to data/cv-sources/, and marks done with a review prompt.
// User then runs `/cos onboard` (or uses Setup page) to review + confirm the merge.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { runScript } from '../run.mjs';

export async function handle(args /*, generate — not needed, zero-token */) {
  // args: { dir: 'data/ui/uploads/<id>', files: [...], mode: 'merge'|'replace' }
  const { dir, files = [], mode = 'merge' } = args;
  if (!dir) throw new Error('onboard: missing dir in args');

  const absDir = join(ROOT, dir);
  if (!existsSync(absDir)) {
    throw new Error(`Upload directory not found: ${dir}`);
  }

  // Parse the uploaded CVs — zero-token, deterministic
  const r = await runScript('parse-cv.mjs', ['--dir', absDir, '--json'], { timeoutMs: 60_000 });

  if (!r.ok) {
    throw new Error(`parse-cv failed: ${r.error || r.stderr || 'unknown error'}`);
  }

  // Write parsed output to data/cv-sources/ for human review
  const sourcesDir = join(ROOT, 'data', 'cv-sources');
  mkdirSync(sourcesDir, { recursive: true });

  const batchId = dir.split('/').pop() || Date.now().toString(36);
  const outPath = join(sourcesDir, `${batchId}-parsed.json`);
  writeFileSync(outPath, JSON.stringify(r.data, null, 2), 'utf8');

  const count = r.data?.count || files.length;
  const reviewNote = [
    `Parsed ${count} CV file(s) from ${dir}.`,
    `Review → data/cv-sources/${batchId}-parsed.json`,
    `Then run /cos onboard in Claude Code to review and ${mode === 'replace' ? 'rebuild' : 'merge into'} your master CV.`,
    `The Setup tab (http://127.0.0.1:4317/setup) also shows pending uploads.`,
  ].join(' ');

  return { parsed: count, source: `data/cv-sources/${batchId}-parsed.json`, mode, note: reviewNote };
}
