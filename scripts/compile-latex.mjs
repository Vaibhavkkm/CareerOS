#!/usr/bin/env node
// scripts/compile-latex.mjs — validate, compile with tectonic, ATS smoke-test.
// Usage:
//   node scripts/compile-latex.mjs <file.tex> [--kind cv|cl] [--keywords a,b,c] [--json]
// Prints a JSON report; exit 0 only if the build is genuinely good.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';
import { leftoverPlaceholders, sectionsIn } from '../lib/tex.mjs';

const FORBIDDEN = [
  { re: /\\input\{glyphtounicode\}/, name: '\\input{glyphtounicode} (errors on tectonic)' },
  { re: /\\pdfgentounicode/, name: '\\pdfgentounicode (errors on tectonic)' },
  { re: /DisableLigatures/, name: 'microtype DisableLigatures (errors on tectonic)' },
];
const CV_REQUIRED_SECTIONS = ['summary', 'experience', 'skills'];

function parseArgs(argv) {
  const out = { _: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--kind') out.kind = argv[++i];
    else if (a.startsWith('--kind=')) out.kind = a.slice(7);
    else if (a === '--keywords') out.keywords = argv[++i];
    else if (a.startsWith('--keywords=')) out.keywords = a.slice(11);
    else out._.push(a);
  }
  return out;
}

function cmdOk(cmd, vArgs) { try { execFileSync(cmd, vArgs, { stdio: 'pipe' }); return true; } catch { return false; } }

function run() {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  const report = {
    file, kind: null, ok: false, compiled: false, pdf: null, pages: null,
    leftover_placeholders: [], forbidden_macros: [], ats_keywords_found: [],
    ats_keywords_missing: [], ligatures: null, reading_order_ok: null, issues: [],
  };

  if (!file) { report.issues.push('no .tex file given'); return finish(report, args.json); }
  if (!existsSync(file)) { report.issues.push(`file not found: ${file}`); return finish(report, args.json); }

  const abs = resolve(file);
  const dir = dirname(abs);
  const tex = readFileSync(abs, 'utf8');
  const kind = args.kind || (/(^|\/)cl-|cover/i.test(basename(abs)) ? 'cl' : 'cv');
  report.kind = kind;

  // --- validate ---
  report.leftover_placeholders = leftoverPlaceholders(tex);
  if (report.leftover_placeholders.length) report.issues.push(`unfilled placeholders: ${report.leftover_placeholders.join(', ')}`);
  report.forbidden_macros = FORBIDDEN.filter((f) => f.re.test(tex)).map((f) => f.name);
  if (report.forbidden_macros.length) report.issues.push(`forbidden macros: ${report.forbidden_macros.join('; ')}`);
  if (!/\\begin\{document\}/.test(tex) || !/\\end\{document\}/.test(tex)) report.issues.push('missing \\begin/\\end{document}');
  if (!/\\setmainfont/.test(tex)) report.issues.push('missing \\setmainfont (fontspec)');
  if (!/Ligatures=\{NoCommon\}/.test(tex)) report.issues.push('missing \\defaultfontfeatures{Ligatures={NoCommon}} (ATS-critical)');
  if (kind === 'cv') {
    const secs = sectionsIn(tex).map((s) => s.toLowerCase());
    const missing = CV_REQUIRED_SECTIONS.filter((r) => !secs.some((s) => s.includes(r)));
    if (missing.length) report.issues.push(`CV missing required sections: ${missing.join(', ')}`);
  }
  // Block compile if structural validation already failed hard.
  const hardFail = report.leftover_placeholders.length || report.forbidden_macros.length ||
    report.issues.some((i) => i.includes('document') || i.includes('setmainfont'));
  if (hardFail) return finish(report, args.json);

  // --- compile ---
  if (!cmdOk('tectonic', ['--version'])) { report.issues.push('tectonic not installed'); return finish(report, args.json); }
  const pdf = abs.replace(/\.tex$/, '.pdf');
  try {
    execFileSync('tectonic', ['--keep-logs', '--chatter', 'minimal', abs], { cwd: dir, stdio: 'pipe' });
  } catch (e) {
    const log = pdf.replace(/\.pdf$/, '.log');
    let bangs = [];
    if (existsSync(log)) bangs = readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('!')).slice(0, 8);
    report.issues.push('tectonic compile error' + (bangs.length ? `:\n  ${bangs.join('\n  ')}` : ` (${String(e.message).split('\n')[0]})`));
  }
  // tectonic can exit 0 with no PDF; confirm the file actually exists.
  if (existsSync(pdf) && statSync(pdf).size > 0) { report.compiled = true; report.pdf = pdf; }
  else { if (!report.issues.length) report.issues.push('no PDF produced (despite exit 0 — check .log)'); return finish(report, args.json); }

  // --- ATS smoke test ---
  if (cmdOk('pdftotext', ['-v'])) {
    let text = '';
    try { text = execFileSync('pdftotext', [pdf, '-'], { stdio: 'pipe' }).toString('utf8'); } catch { /* ignore */ }
    const ff = (text.match(/\f/g) || []).length; // pdftotext emits one form-feed per page
    report.pages = ff > 0 ? ff : (text.trim() ? 1 : 0);
    report.ligatures = [...text].filter((c) => { const n = c.codePointAt(0); return n >= 0xFB00 && n <= 0xFB04; }).length;
    if (report.ligatures > 0) report.issues.push(`${report.ligatures} ligature char(s) found — ATS keyword search would miss them`);
    if (args.keywords) {
      const kws = args.keywords.split(',').map((k) => k.trim()).filter(Boolean);
      const low = text.toLowerCase();
      for (const k of kws) (low.includes(k.toLowerCase()) ? report.ats_keywords_found : report.ats_keywords_missing).push(k);
      if (report.ats_keywords_missing.length) report.issues.push(`keywords not extractable: ${report.ats_keywords_missing.join(', ')}`);
    }
    if (kind === 'cv') {
      const lo = text.toLowerCase();
      const iS = lo.indexOf('summary'), iE = lo.indexOf('experience'), iEd = lo.indexOf('education');
      // Detect genuine scrambling (e.g. multi-column/table interleaving), NOT a
      // specific section order — Education-before-Experience is perfectly valid.
      // Flag only if a Summary exists but extracts AFTER both other sections.
      report.reading_order_ok = !(iS > -1 && iE > -1 && iEd > -1 && iS > iE && iS > iEd);
      if (!report.reading_order_ok) report.issues.push('section reading order looks scrambled in extracted text (Summary not near the top)');
    }
  } else {
    report.issues.push('pdftotext missing — ATS smoke test skipped (install poppler)');
  }

  report.ok = report.compiled &&
    !report.leftover_placeholders.length &&
    !report.forbidden_macros.length &&
    (report.ligatures === null || report.ligatures === 0) &&
    report.ats_keywords_missing.length === 0 &&
    (report.reading_order_ok === null || report.reading_order_ok === true);

  return finish(report, args.json);
}

function finish(report, json) {
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`compile-latex: ${report.file || '(none)'} [${report.kind || '?'}]`);
    console.log(`  compiled: ${report.compiled ? 'yes' : 'NO'}${report.pdf ? ` -> ${report.pdf}` : ''}`);
    if (report.pages != null) console.log(`  pages: ${report.pages}, ligatures: ${report.ligatures}`);
    if (report.ats_keywords_found.length) console.log(`  ATS keywords found: ${report.ats_keywords_found.join(', ')}`);
    if (report.issues.length) console.log('  issues:\n    - ' + report.issues.join('\n    - '));
    console.log(report.ok ? '  RESULT: OK ✅' : '  RESULT: FAILED ❌');
  }
  process.exit(report.ok ? 0 : 1);
}

run();
