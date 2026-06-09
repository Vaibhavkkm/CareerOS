#!/usr/bin/env node
// scripts/parse-cv.mjs — deterministic "uploaded CV/cover-letter → Markdown".
//
// README lists this as planned: job POSTINGS from a URL are already scraped
// deterministically (fetch-jd), but turning the USER's uploaded CV/Word/PDF into
// text was still the agent reading the file by hand. This makes it reproducible.
//
// Extraction strategy, best tool first, graceful fallback (never fabricates):
//   • .txt / .md / .markdown            → read directly (no dependency at all)
//   • .pdf / .docx / .doc / .rtf / .html / .pptx / .epub / …
//        1. Microsoft markitdown (python sidecar parse_cv.py) — best fidelity
//        2. if markitdown absent AND it's a .pdf AND pdftotext exists → pdftotext
//        3. else: ok:false with a clear install hint (npm run jobspy:install)
//
// It prints the extracted text (or JSON envelope); it does NOT write under data/.
// The onboard flow takes this text and distills profile.yml + cv.master.md from it.
//
// Usage:
//   node scripts/parse-cv.mjs --file path/to/cv.pdf            # JSON envelope
//   node scripts/parse-cv.mjs --file a.pdf --file b.docx       # MULTIPLE CVs at once
//   node scripts/parse-cv.mjs --dir data/ui/uploads/<id>       # every CV in a folder
//   node scripts/parse-cv.mjs --file path/to/cv.docx --raw     # just the Markdown
//   node scripts/parse-cv.mjs --file path/to/cv.pdf --summary  # human preview
//   node scripts/parse-cv.mjs --self-test
//
// With ONE file the JSON envelope is { ok, file, ext, method, chars, text }.
// With MULTIPLE files (or --dir) it is { ok, count, docs:[<envelope>...] } so the
// onboard merge step can fold several CVs into one master without losing a source.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import assert from 'node:assert/strict';

import { pythonBin } from './jobspy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PY_SCRIPT = join(ROOT, 'scripts', 'parse_cv.py');

// Extensions we can read as plain text with no external tool.
const PLAINTEXT = new Set(['.txt', '.md', '.markdown', '.text']);
// Document extensions worth parsing when sweeping a folder (--dir).
const DOC_EXTS = new Set([...PLAINTEXT, '.pdf', '.docx', '.doc', '.rtf', '.html', '.htm', '.odt', '.pptx', '.epub']);

// ─── pure helpers (exported for --self-test) ──────────────────────────

export function classify(file) {
  const ext = extname(String(file || '')).toLowerCase();
  if (PLAINTEXT.has(ext)) return { ext, method: 'plaintext' };
  if (ext === '.pdf') return { ext, method: 'markitdown', fallback: 'pdftotext' };
  return { ext, method: 'markitdown', fallback: null };
}

// Collapse markitdown/pdftotext noise: trim trailing spaces, squeeze 3+ blank
// lines to one, drop a leading BOM. Keeps the document otherwise intact.
export function tidy(text) {
  return String(text || '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseDiagnostics(stderr) {
  let chars = null, fatal = null;
  for (const line of String(stderr || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t);
      if (o.fatal) fatal = o;
      if (o.chars != null) chars = o.chars;
    } catch { /* ignore non-JSON */ }
  }
  return { chars, fatal };
}

// ─── sidecar / tool bridges (I/O) ─────────────────────────────────────

function pdftotextAvailable() {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'pipe' }); return true; } catch { return false; }
}

function runMarkitdown(path, { bin = pythonBin(), script = PY_SCRIPT, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      bin, [script],
      { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }),
    );
    if (child.stdin) child.stdin.end(JSON.stringify({ path }));
  });
}

function runPdftotext(path) {
  // `-layout` preserves columns/spacing; `-` writes to stdout.
  return new Promise((resolve) => {
    execFile('pdftotext', ['-layout', path, '-'], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// ─── core ─────────────────────────────────────────────────────────────

// Convert a file to Markdown text. `deps` is injectable for tests (no disk/python).
export async function parseCv(file, {
  markitdown = runMarkitdown,
  pdftotext = runPdftotext,
  hasPdftotext = pdftotextAvailable,
  readPlain = (p) => readFileSync(p, 'utf8'),
  fileExists = existsSync,
} = {}) {
  if (!file) return { ok: false, error: 'no --file given' };
  if (!fileExists(file)) return { ok: false, error: `file not found: ${file}` };
  const { ext, method, fallback } = classify(file);

  // 1) plain text — no external tooling needed.
  if (method === 'plaintext') {
    const text = tidy(readPlain(file));
    return { ok: true, file: basename(file), ext, method: 'plaintext', chars: text.length, text };
  }

  // 2) markitdown sidecar.
  const { stdout, stderr } = await markitdown(file);
  const { chars, fatal } = parseDiagnostics(stderr);
  if (!fatal && stdout.trim()) {
    const text = tidy(stdout);
    return { ok: true, file: basename(file), ext, method: 'markitdown', chars: chars ?? text.length, text };
  }

  // 3) pdftotext fallback for PDFs when markitdown isn't installed.
  if (fallback === 'pdftotext' && hasPdftotext()) {
    const { stdout: pout, err } = await pdftotext(file);
    if (!err && pout.trim()) {
      const text = tidy(pout);
      return { ok: true, file: basename(file), ext, method: 'pdftotext', chars: text.length, text };
    }
  }

  const hint = fatal?.hint || 'install the parser: npm run jobspy:install (adds markitdown to ./.venv)';
  return { ok: false, error: `could not extract text from ${basename(file)} — ${fatal?.fatal || 'no extractor available'}`, hint, ext };
}

// List the document files inside a folder (one level), sorted for stable order.
export function listDocs(dir, { exists = existsSync, readdir = readdirSync, stat = statSync } = {}) {
  if (!exists(dir)) return [];
  return readdir(dir)
    .filter((f) => DOC_EXTS.has(extname(f).toLowerCase()))
    .map((f) => join(dir, f))
    .filter((p) => { try { return stat(p).isFile(); } catch { return false; } })
    .sort();
}

// Parse MANY files → { ok, count, docs:[envelope...] }. `ok` is true if at least
// one parsed; per-file failures are kept in `docs` as their own ok:false envelope
// so the caller sees exactly which source failed (never silently dropped).
export async function parseMany(files, deps = {}) {
  const docs = [];
  for (const f of files) docs.push(await parseCv(f, deps));
  return { ok: docs.some((d) => d.ok), count: docs.length, docs };
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { files: [], dir: null, json: true, raw: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (a === '--raw') { out.raw = true; out.json = false; }
    else if (a === '--file') out.files.push(val());
    else if (a.startsWith('--file=')) out.files.push(a.slice(7));
    else if (a === '--dir') out.dir = val();
    else if (a.startsWith('--dir=')) out.dir = a.slice(6);
  }
  return out;
}

const USAGE = `parse-cv — turn uploaded CV(s)/cover letter(s) (PDF/Word/…) into Markdown.
Usage: node scripts/parse-cv.mjs --file <path> [--file <path2> ...] [--raw|--summary]
       node scripts/parse-cv.mjs --dir <folder> [--raw|--summary]
  --file <path>  a document to parse (.pdf/.docx/.txt/.md/.rtf/.html/…); repeatable
  --dir <folder> parse every document in the folder (e.g. an upload batch)
  --raw          print only the extracted Markdown (concatenated for multiple)
  --summary      human-readable preview (default: JSON envelope)
  --self-test    run built-in tests`;

// Join several parsed docs into one Markdown blob with a clear per-source header,
// so a human or the agent can see which CV each section came from before merging.
function concatDocs(docs) {
  return docs.filter((d) => d.ok)
    .map((d) => `\n\n<!-- ===== source: ${d.file} (${d.method}) ===== -->\n\n${d.text}`)
    .join('\n').trim();
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();

  const files = [...args.files, ...(args.dir ? listDocs(args.dir) : [])];
  if (!files.length) {
    console.error(args.dir ? `error: no documents found in ${args.dir}` : 'error: --file <path> (or --dir <folder>) required');
    process.exit(2);
  }

  // Single file → the original flat envelope (back-compat with callers/onboard).
  if (files.length === 1) {
    const res = await parseCv(files[0]);
    if (!res.ok) {
      if (args.json) console.log(JSON.stringify(res, null, 2));
      else console.error(`parse-cv: ${res.error}${res.hint ? `\n  → ${res.hint}` : ''}`);
      process.exit(1);
    }
    if (args.raw) console.log(res.text);
    else if (args.json) console.log(JSON.stringify(res, null, 2));
    else {
      console.log(`parsed ${res.file} via ${res.method} — ${res.chars} chars`);
      console.log('─'.repeat(60));
      console.log(res.text.slice(0, 1200) + (res.text.length > 1200 ? '\n… (truncated preview)' : ''));
    }
    process.exit(0);
  }

  // Multiple files → { ok, count, docs:[...] }.
  const res = await parseMany(files);
  if (args.raw) { console.log(concatDocs(res.docs)); process.exit(res.ok ? 0 : 1); }
  if (args.json) { console.log(JSON.stringify(res, null, 2)); process.exit(res.ok ? 0 : 1); }
  console.log(`parse-cv — ${res.docs.filter((d) => d.ok).length}/${res.count} document(s) parsed`);
  for (const d of res.docs) {
    if (d.ok) console.log(`  ✓ ${d.file.padEnd(40)} ${d.method}  ${d.chars} chars`);
    else console.log(`  ✗ ${(d.file || '?')}  — ${d.error}`);
  }
  process.exit(res.ok ? 0 : 1);
}

// ─── self-test ───────────────────────────────────────────────────────
export async function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // classify routes by extension
  eq(classify('cv.txt').method, 'plaintext', 'txt → plaintext');
  eq(classify('cv.md').method, 'plaintext', 'md → plaintext');
  eq(classify('cv.pdf').method, 'markitdown', 'pdf → markitdown');
  eq(classify('cv.pdf').fallback, 'pdftotext', 'pdf has a pdftotext fallback');
  eq(classify('cv.docx').fallback, null, 'docx has no pdftotext fallback');

  // tidy collapses blank lines + trailing spaces + BOM
  eq(tidy('﻿a  \n\n\n\nb '), 'a\n\nb', 'tidy squeezes blanks, trims, strips BOM');

  // parseDiagnostics
  const d = parseDiagnostics('noise\n{"chars":1234}\n');
  eq(d.chars, 1234, 'parseDiagnostics reads chars');
  ok(parseDiagnostics('{"fatal":"markitdown not installed","hint":"x"}').fatal, 'parseDiagnostics reads fatal');

  // plaintext path: no python needed
  const plain = await parseCv('whatever.md', {
    fileExists: () => true,
    readPlain: () => '# Hi\n\n\n\nWorld   ',
  });
  ok(plain.ok && plain.method === 'plaintext' && plain.text === '# Hi\n\nWorld', 'plaintext extraction + tidy');

  // markitdown success path (stubbed sidecar)
  const viaMd = await parseCv('cv.pdf', {
    fileExists: () => true,
    markitdown: async () => ({ err: null, stdout: '# Jane\n\nExperience', stderr: '{"chars":17}' }),
  });
  ok(viaMd.ok && viaMd.method === 'markitdown' && /Jane/.test(viaMd.text), 'markitdown extraction');

  // markitdown missing → pdftotext fallback for a PDF
  const viaPdftotext = await parseCv('cv.pdf', {
    fileExists: () => true,
    markitdown: async () => ({ err: { message: 'x' }, stdout: '', stderr: '{"fatal":"markitdown not installed","hint":"npm run jobspy:install"}' }),
    hasPdftotext: () => true,
    pdftotext: async () => ({ err: null, stdout: 'Jane Doe\nEngineer', stderr: '' }),
  });
  ok(viaPdftotext.ok && viaPdftotext.method === 'pdftotext' && /Jane Doe/.test(viaPdftotext.text), 'pdftotext fallback');

  // markitdown missing + no pdftotext → ok:false with a hint, never fabricated text
  const fail = await parseCv('cv.docx', {
    fileExists: () => true,
    markitdown: async () => ({ err: { message: 'x' }, stdout: '', stderr: '{"fatal":"markitdown not installed","hint":"npm run jobspy:install"}' }),
    hasPdftotext: () => false,
  });
  ok(!fail.ok && /install/.test(fail.hint || ''), 'no extractor → ok:false + install hint');

  // missing file
  ok(!(await parseCv('nope.pdf', { fileExists: () => false })).ok, 'missing file → ok:false');

  // parseMany: folds several CVs, keeps a failed source as its own ok:false envelope
  const many = await parseMany(['a.md', 'b.md', 'c.pdf'], {
    fileExists: () => true,
    readPlain: (p) => `# ${p}\ncontent`,
    markitdown: async () => ({ err: { message: 'x' }, stdout: '', stderr: '{"fatal":"markitdown not installed","hint":"x"}' }),
    hasPdftotext: () => false,
  });
  eq(many.count, 3, 'parseMany parses all three');
  eq(many.docs.filter((d) => d.ok).length, 2, 'parseMany: the two plaintext CVs parse');
  ok(many.ok, 'parseMany ok when at least one parsed');
  ok(many.docs[2] && many.docs[2].ok === false, 'parseMany keeps the failed source visible (not dropped)');

  // listDocs filters a folder to document types, sorted
  const docs = listDocs('/x', {
    exists: () => true,
    readdir: () => ['b.pdf', 'a.docx', 'notes.png', 'c.txt', 'sub'],
    stat: (p) => ({ isFile: () => !p.endsWith('sub') }),
  });
  ok(docs.length === 3 && docs[0].endsWith('a.docx') && !docs.some((d) => d.endsWith('.png')), 'listDocs filters + sorts doc files, skips non-docs/dirs');

  console.log(`parse-cv self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    selfTest().catch((e) => { console.error(`parse-cv self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); });
  } else {
    main().catch((e) => { console.error(`Fatal: ${e.message}`); process.exit(1); });
  }
}
