#!/usr/bin/env node
// scripts/compile-latex.mjs — validate, compile with tectonic, ATS smoke-test.
// Usage:
//   node scripts/compile-latex.mjs <file.tex> [--kind cv|cl] [--keywords a,b,c] [--json]
// Prints a JSON report; exit 0 only if the build is genuinely good.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, basename, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { leftoverPlaceholders, sectionsIn } from '../lib/tex.mjs';

const FORBIDDEN = [
  { re: /\\input\{glyphtounicode\}/, name: '\\input{glyphtounicode} (errors on tectonic)' },
  { re: /\\pdfgentounicode/, name: '\\pdfgentounicode (errors on tectonic)' },
  { re: /DisableLigatures/, name: 'microtype DisableLigatures (errors on tectonic)' },
];
const CV_REQUIRED_SECTIONS = ['summary', 'experience', 'skills'];

const USAGE = `compile-latex — validate, compile with tectonic, and ATS smoke-test a .tex.
Usage: node scripts/compile-latex.mjs <file.tex> [--kind cv|cl] [--keywords a,b,c] [--json]
  --self-test   run built-in validation tests`;

// Strip LaTeX comments (% to end-of-line, keeping escaped \%): commented text
// never reaches tectonic or the PDF, so placeholder/forbidden-macro mentions in
// a template's own instruction header must not fail validation.
export function stripComments(tex) {
  return tex.split('\n').map((line) => {
    let i = 0;
    while ((i = line.indexOf('%', i)) !== -1) {
      if (line[i - 1] === '\\') { i++; continue; }
      return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

// Pure structural validation — everything checkable WITHOUT compiling. Returns
// { leftover_placeholders, forbidden_macros, issues }. Exported for tests.
export function validate(rawTex, kind) {
  const tex = stripComments(rawTex);
  const out = { leftover_placeholders: [], forbidden_macros: [], issues: [] };
  out.leftover_placeholders = leftoverPlaceholders(tex);
  if (out.leftover_placeholders.length) out.issues.push(`unfilled placeholders: ${out.leftover_placeholders.join(', ')}`);
  out.forbidden_macros = FORBIDDEN.filter((f) => f.re.test(tex)).map((f) => f.name);
  if (out.forbidden_macros.length) out.issues.push(`forbidden macros: ${out.forbidden_macros.join('; ')}`);
  if (!/\\begin\{document\}/.test(tex) || !/\\end\{document\}/.test(tex)) out.issues.push('missing \\begin/\\end{document}');
  if (!/\\setmainfont/.test(tex)) out.issues.push('missing \\setmainfont (fontspec)');
  if (!/Ligatures=\{NoCommon\}/.test(tex)) out.issues.push('missing \\defaultfontfeatures{Ligatures={NoCommon}} (ATS-critical)');
  if (kind === 'cv') {
    const secs = sectionsIn(tex).map((s) => s.toLowerCase());
    const missing = CV_REQUIRED_SECTIONS.filter((r) => !secs.some((s) => s.includes(r)));
    if (missing.length) out.issues.push(`CV missing required sections: ${missing.join(', ')}`);
  }
  return out;
}

// A hard failure means don't even spend a tectonic compile.
export function hardFailed(v) {
  return Boolean(v.leftover_placeholders.length || v.forbidden_macros.length ||
    v.issues.some((i) => i.includes('document') || i.includes('setmainfont')));
}

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
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
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

  // --- validate (pure) ---
  const v = validate(tex, kind);
  report.leftover_placeholders = v.leftover_placeholders;
  report.forbidden_macros = v.forbidden_macros;
  report.issues.push(...v.issues);
  if (hardFailed(v)) return finish(report, args.json); // don't waste a tectonic run

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

// ─── self-test (pure validation logic — no tectonic needed) ──────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const goodCv = [
    '\\documentclass{article}', '\\usepackage{fontspec}',
    '\\defaultfontfeatures{Ligatures={NoCommon}}', '\\setmainfont{texgyretermes}',
    '\\begin{document}', '\\section{Summary} a', '\\section{Experience} b',
    '\\section{Skills} c', '\\end{document}',
  ].join('\n');

  let v = validate(goodCv, 'cv');
  ok(v.issues.length === 0, `clean CV validates with no issues (got: ${v.issues.join(' | ')})`);
  ok(!hardFailed(v), 'clean CV is not a hard fail');

  v = validate(goodCv.replace('\\end{document}', '<<NAME>>\n\\end{document}'), 'cv');
  ok(v.leftover_placeholders.includes('<<NAME>>') && hardFailed(v), 'leftover <<placeholder>> is a hard fail');

  v = validate(goodCv + '\n\\input{glyphtounicode}', 'cv');
  ok(v.forbidden_macros.length > 0 && hardFailed(v), 'forbidden macro is a hard fail');

  // Comments never reach tectonic — instruction headers must not false-positive.
  v = validate(goodCv + '\n% Never add \\input{glyphtounicode} or DisableLigatures\n% Leave NO <<PLACEHOLDER>> behind', 'cv');
  ok(v.forbidden_macros.length === 0 && v.leftover_placeholders.length === 0 && !hardFailed(v),
    'forbidden macros + placeholders in COMMENTS are ignored');
  ok(stripComments('a \\% literal % real comment') === 'a \\% literal ', 'escaped \\% is kept, comment stripped');
  ok(validate(goodCv.replace('\\end{document}', '50\\% uplift <<X>>\n\\end{document}'), 'cv').leftover_placeholders.length === 1,
    'code after an escaped \\% is still validated');

  ok(hardFailed(validate('\\setmainfont{x}\\defaultfontfeatures{Ligatures={NoCommon}}\\section{Summary}\\section{Experience}\\section{Skills}', 'cv')),
    'missing \\begin/\\end{document} is a hard fail');
  ok(hardFailed(validate(goodCv.replace('\\setmainfont{texgyretermes}', ''), 'cv')), 'missing \\setmainfont is a hard fail');

  v = validate(goodCv.replace('\\defaultfontfeatures{Ligatures={NoCommon}}', ''), 'cv');
  ok(v.issues.some((i) => i.includes('Ligatures')) && !hardFailed(v), 'missing NoCommon is flagged but not a hard fail');

  v = validate(goodCv.replace('\\section{Skills} c', ''), 'cv');
  ok(v.issues.some((i) => i.includes('missing required sections')), 'CV missing the Skills section is flagged');

  v = validate(['\\setmainfont{x}', '\\defaultfontfeatures{Ligatures={NoCommon}}', '\\begin{document}', 'Dear team', '\\end{document}'].join('\n'), 'cl');
  ok(!v.issues.some((i) => i.includes('required sections')), 'a cover letter has no required-section check');

  console.log(`compile-latex self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`compile-latex self-test FAILED: ${e.message}`); process.exit(1); }
  } else {
    run();
  }
}
