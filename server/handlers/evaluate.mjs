// server/handlers/evaluate.mjs — evaluate a job posting, write a report
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import {
  collectMode, collectProfile, collectJD, collectReport,
  nextReportNumber, slugify, truncate, buildContextBlock, registerDoc,
} from './collect.mjs';
import { runScript } from '../run.mjs';

export async function handle(args, generate) {
  // args: { url?, report?, company?, target? }
  const target = args.report || args.url || args.company || args.target || '';

  const profile = collectProfile();
  if (!profile.profile && !profile.master) {
    throw new Error('No profile found. Run /cos onboard first to set up your data.');
  }

  // jd_path from the board drawer is the most direct lookup — use it first
  let jd = null;
  if (args.jd_path) {
    const abs = join(ROOT, String(args.jd_path));
    if (existsSync(abs)) jd = readFileSync(abs, 'utf8');
  }
  if (!jd) jd = collectJD(target);
  if (!jd && args.url) {
    const r = await runScript('fetch-jd.mjs', [args.url, '--json'], { timeoutMs: 30_000 });
    if (r.ok && r.data?.text) jd = r.data.text;
  }
  if (!jd && args.report) {
    const rpt = collectReport(args.report);
    if (rpt) jd = rpt;
  }
  if (!jd) {
    throw new Error(`No JD found for target "${target}". Pass a URL or report number.`);
  }

  const systemPrompt = collectMode('evaluate');
  const contextBlock = buildContextBlock({
    profile,
    jd: truncate(jd, 8000),
  });

  const reportNum = nextReportNumber();
  const dateStr = new Date().toISOString().slice(0, 10);
  const company = args.company || args.target || 'company';
  const slug = slugify(`${reportNum}-${company}`);
  const filename = `${String(reportNum).padStart(3, '0')}-${slug}-${dateStr}.md`;
  const relPath = `data/reports/${filename}`;
  const absPath = join(ROOT, relPath);

  const userMessage = [
    contextBlock,
    '',
    `## Task`,
    `Evaluate the job description above following your system instructions.`,
    `Report number: ${reportNum}`,
    `Output filename: ${filename}`,
    `Write the COMPLETE evaluation report (blocks A–G + scoring table + Machine Summary).`,
    `Output ONLY the report markdown. Do not add any preamble or closing remarks.`,
  ].join('\n');

  const reportContent = await generate(systemPrompt, userMessage);

  mkdirSync(join(ROOT, 'data', 'reports'), { recursive: true });
  writeFileSync(absPath, reportContent, 'utf8');
  if (args.jd_path) registerDoc(args.jd_path, 'report', relPath);

  // Register in tracker (best-effort — parse score from Machine Summary)
  const scoreMatch = reportContent.match(/overall[_\s]*score[:\s]+([0-9.]+)/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;
  if (score !== null && args.url) {
    await runScript('tracker.mjs', [
      'add', '--json',
      JSON.stringify({
        company: company,
        role: args.role || args.target || '',
        score,
        status: 'evaluated',
        url: args.url || '',
        report: relPath,
      }),
    ], { timeoutMs: 10_000 }).catch(() => {/* tracker optional */});
  }

  return { report: relPath, filename, score };
}
