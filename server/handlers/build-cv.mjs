// server/handlers/build-cv.mjs — generate a tailored LaTeX CV + compile to PDF
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';

function loadTemplate(name) {
  try { return readFileSync(join(ROOT, 'templates', name), 'utf8'); } catch { return null; }
}
import {
  collectMode, collectProfile, collectJD, collectReport,
  truncate, buildContextBlock, slugify, registerDoc,
} from './collect.mjs';
import { runScript } from '../run.mjs';

export async function handle(args, generate) {
  // args: { report?, company?, url?, target? }
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
    throw new Error(`No JD found for "${target}". Pass a URL, report number, or company name.`);
  }

  // Load CV template
  const templateR = await runScript('templates.mjs', ['--list', '--json'], { timeoutMs: 10_000 });
  const selectedTemplate = profile.profile?.match(/cv\.template:\s*(\w+)/)?.[1] || 'default';

  const systemPrompt = collectMode('build-cv');
  const contextBlock = buildContextBlock({
    profile,
    jd: truncate(jd || '', 6000),
    report: truncate(report || '', 4000),
    extra: selectedTemplate !== 'default'
      ? `## CV Template\nUse template: ${selectedTemplate}`
      : null,
  });

  const slug = slugify(args.company || args.target || 'cv');
  const dateStr = new Date().toISOString().slice(0, 10);
  const texFilename = `cv-${slug}-${dateStr}.tex`;
  const texRel = `data/output/${texFilename}`;
  const texAbs = join(ROOT, texRel);

  // Inject the actual template so local models (Ollama) cannot deviate from structure
  const cvTemplate = loadTemplate('cv.tex.tmpl');
  const templateSection = cvTemplate
    ? `## LaTeX Template — COPY THIS STRUCTURE EXACTLY\n\nYou MUST use this exact template as the base. Fill in the <<PLACEHOLDERS>> with the user's real data. Do NOT change \\documentclass, do NOT use moderncv, beamer, or any class other than article.\n\n\`\`\`latex\n${cvTemplate}\n\`\`\``
    : '';

  const userMessage = [
    contextBlock,
    templateSection,
    '',
    '## Task',
    'Generate a complete, tailored, ATS-safe LaTeX CV using the template above.',
    `Output filename: ${texFilename}`,
    '⚠ CRITICAL: Use ONLY \\documentclass[a4paper,10pt]{article} — NEVER use moderncv, beamer, or any other class (they crash the compiler).',
    'Output ONLY valid LaTeX source code starting with \\documentclass.',
    'Do NOT wrap in markdown code fences. Do NOT add any text before or after the LaTeX.',
    'Every claim must be grounded in data/cv.master.md — never fabricate.',
  ].join('\n');

  let texContent = await generate(systemPrompt, userMessage);

  // Strip markdown fences, then strip any leading prose before \documentclass
  texContent = stripFences(texContent, 'latex', 'tex');
  texContent = stripLeadingProse(texContent);

  mkdirSync(join(ROOT, 'data', 'output'), { recursive: true });
  writeFileSync(texAbs, texContent, 'utf8');

  // Compile with tectonic if available
  const compileR = await runScript('compile-latex.mjs', [texAbs], { timeoutMs: 120_000 });
  // Use compiled flag (PDF produced) not ok flag (ATS checks passed) — ok can be
  // false due to ATS warnings even when the PDF was successfully created.
  const compiled = compileR.data?.compiled === true;
  const pdfPath = compiled ? texRel.replace('.tex', '.pdf') : null;

  if (args.jd_path) {
    registerDoc(args.jd_path, 'tex', texRel);
    if (pdfPath) registerDoc(args.jd_path, 'cv', pdfPath);
  }

  return { tex: texRel, pdf: pdfPath, compiled };
}

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
