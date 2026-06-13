// server/handlers/build-cl.mjs — generate a tailored cover letter + compile to PDF
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import {
  collectMode, collectProfile, collectJD, collectReport,
  truncate, buildContextBlock, slugify, registerDoc,
} from './collect.mjs';
import { runScript } from '../run.mjs';

function stripFences(text, ...langs) {
  const patterns = langs.map((l) => new RegExp(`^\`\`\`${l}\\s*\\n([\\s\\S]*?)\\n\`\`\`\\s*$`, 'i'));
  patterns.push(/^```\s*\n([\s\S]*?)\n```\s*$/);
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1];
  }
  return text;
}

function stripLeadingProse(text) {
  const idx = text.indexOf('\\documentclass');
  return idx > 0 ? text.slice(idx) : text;
}

export async function handle(args, generate) {
  const target = args.report || args.company || args.url || args.target || '';

  const profile = collectProfile();
  if (!profile.profile && !profile.master) {
    throw new Error('No profile found. Run /cos onboard first.');
  }

  // jd_path from drawer is most direct — use it first
  let jd = null;
  if (args.jd_path) {
    const abs = join(ROOT, String(args.jd_path));
    if (existsSync(abs)) jd = readFileSync(abs, 'utf8');
  }
  if (!jd) jd = collectJD(target);
  let report = null;
  if (args.report) report = collectReport(args.report);
  if (!jd && args.url) {
    const r = await runScript('fetch-jd.mjs', [args.url, '--json'], { timeoutMs: 30_000 });
    if (r.ok && r.data?.text) jd = r.data.text;
  }
  if (!jd && !report) {
    throw new Error(`No JD found for "${target}".`);
  }

  const systemPrompt = collectMode('build-cl');
  const contextBlock = buildContextBlock({
    profile,
    jd: truncate(jd || '', 6000),
    report: truncate(report || '', 3000),
  });

  const slug = slugify(args.company || args.target || 'cl');
  const dateStr = new Date().toISOString().slice(0, 10);
  const texFilename = `cl-${slug}-${dateStr}.tex`;
  const texRel = `data/output/${texFilename}`;
  const texAbs = join(ROOT, texRel);

  const userMessage = [
    contextBlock,
    '',
    '## Task',
    'Generate a complete tailored cover letter in LaTeX following your system instructions.',
    `Output filename: ${texFilename}`,
    "Write in the user's voice as learned from their writing samples.",
    'Output ONLY valid LaTeX. Do NOT wrap in markdown fences.',
    'Every fact must come from data/cv.master.md or data/profile.yml — never fabricate.',
  ].join('\n');

  let texContent = await generate(systemPrompt, userMessage);
  texContent = stripFences(texContent, 'latex', 'tex');
  texContent = stripLeadingProse(texContent);

  mkdirSync(join(ROOT, 'data', 'output'), { recursive: true });
  writeFileSync(texAbs, texContent, 'utf8');

  const compileR = await runScript('compile-latex.mjs', [texAbs], { timeoutMs: 120_000 });
  // Use compiled flag not ok — ATS warnings set ok=false even when PDF was created.
  const compiled = compileR.data?.compiled === true;
  const pdfPath = compiled ? texRel.replace('.tex', '.pdf') : null;

  if (args.jd_path) {
    if (pdfPath) registerDoc(args.jd_path, 'cl', pdfPath);
  }

  return { tex: texRel, pdf: pdfPath, compiled };
}
