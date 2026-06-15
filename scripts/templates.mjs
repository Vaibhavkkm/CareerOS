#!/usr/bin/env node
// scripts/templates.mjs — the CV/cover-letter THEME registry (zero tokens).
//
// CareerOS templates are filled by the agent (it replaces <<PLACEHOLDER>> tokens
// and the %% REPEAT blocks), so "themes" = swappable .tex.tmpl files that share the
// SAME placeholder contract but differ in visual style. This registry is the single
// source of truth for which themes exist, what file each maps to, and an ATS note —
// so build-cv.md, the web panel, and doctor all agree.
//
// Every theme keeps the VERIFIED ATS preamble (fontspec + Latin Modern by filename +
// Ligatures={NoCommon}, no glyphtounicode/microtype). They are single-column on
// purpose: a true two-column CV reorders badly in many ATS parsers and would break
// the keyword-extraction guarantee, so it is intentionally NOT offered (see README).
//
// Usage:
//   node scripts/templates.mjs list [--summary]          # show themes
//   node scripts/templates.mjs resolve --theme modern    # theme -> file path (JSON)
//   node scripts/templates.mjs --self-test

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// kind → { theme → { file, label, desc, pages } }. `classic` is the default and is
// the original, battle-tested template. New themes reuse its ATS-safe preamble.
export const THEMES = {
  cv: {
    classic: { file: 'templates/cv.tex.tmpl', label: 'Classic', desc: 'The original single-column résumé — neutral, one page, maximally ATS-safe.', pages: 1 },
    modern: { file: 'templates/cv.modern.tex.tmpl', label: 'Modern', desc: 'Latin Modern sans, left-aligned name under a heavy rule, slate-accent section headings; same single-column body. Good for product/eng/design.', pages: 1 },
    academic: { file: 'templates/cv.academic.tex.tmpl', label: 'Academic', desc: 'Education-first with a Publications section; may run to two pages. For PhD/post-doc/research roles.', pages: 2 },
    compact: { file: 'templates/cv.compact.tex.tmpl', label: 'Compact', desc: 'Denser spacing + margins to fit a long history on one page. Same sections as Classic.', pages: 1 },
  },
  cl: {
    classic: { file: 'templates/cl.tex.tmpl', label: 'Classic', desc: 'The standard block cover-letter.', pages: 1 },
  },
};

export const DEFAULT_THEME = 'classic';

export function listThemes(kind = 'cv') {
  const set = THEMES[kind] || {};
  return Object.entries(set).map(([id, t]) => ({ id, ...t, exists: existsSync(join(ROOT, t.file)) }));
}

// Resolve a theme name → { ok, theme, file, abs, ... }. Unknown/empty → default,
// with `fellBack:true` so the caller can warn. Never throws.
export function resolveTheme(theme, kind = 'cv') {
  const set = THEMES[kind] || {};
  const want = String(theme || '').trim().toLowerCase();
  const id = set[want] ? want : DEFAULT_THEME;
  const t = set[id];
  if (!t) return { ok: false, error: `no themes for kind "${kind}"` };
  return {
    ok: true, kind, theme: id, fellBack: !!want && id !== want,
    file: t.file, abs: join(ROOT, t.file), label: t.label, desc: t.desc, pages: t.pages,
    exists: existsSync(join(ROOT, t.file)),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { cmd: null, kind: 'cv', theme: '', json: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.cmd = 'self-test';
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (a === '--kind') out.kind = val();
    else if (a.startsWith('--kind=')) out.kind = a.slice(7);
    else if (a === '--theme') out.theme = val();
    else if (a.startsWith('--theme=')) out.theme = a.slice(8);
    else if (!a.startsWith('--') && !out.cmd) out.cmd = a;
  }
  return out;
}

const USAGE = `templates — the CV/cover-letter theme registry.
Usage:
  node scripts/templates.mjs list [--kind cv|cl] [--summary]
  node scripts/templates.mjs resolve --theme <name> [--kind cv]
  node scripts/templates.mjs --self-test`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
  if (args.cmd === 'self-test') return selfTest();

  if (args.cmd === 'resolve') {
    const r = resolveTheme(args.theme, args.kind);
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.ok ? `${r.theme} → ${r.file}${r.fellBack ? '  (fell back to default)' : ''}${r.exists ? '' : '  [MISSING FILE]'}` : `error: ${r.error}`);
    process.exit(r.ok ? 0 : 2);
  }

  // default: list
  const themes = listThemes(args.kind);
  if (args.json) console.log(JSON.stringify({ ok: true, kind: args.kind, default: DEFAULT_THEME, themes }, null, 2));
  else {
    console.log(`CareerOS — ${args.kind} themes (default: ${DEFAULT_THEME})\n`);
    for (const t of themes) {
      console.log(`  ${t.id === DEFAULT_THEME ? '*' : ' '} ${t.id.padEnd(10)} ${t.label.padEnd(10)} ${t.exists ? '' : '[MISSING] '}${t.desc}`);
    }
    console.log('\n  Pick per build:  /cos build-cv <job> --theme <name>   (or set cv.theme in data/profile.yml)');
  }
  process.exit(0);
}

// ─── self-test ───────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // registry shape
  ok(THEMES.cv.classic && THEMES.cv.modern && THEMES.cv.academic && THEMES.cv.compact, 'four cv themes registered');
  eq(THEMES.cv.classic.file, 'templates/cv.tex.tmpl', 'classic maps to the original template');

  // resolveTheme: known, default fallback, unknown fallback
  eq(resolveTheme('modern').theme, 'modern', 'resolves a known theme');
  eq(resolveTheme('').theme, DEFAULT_THEME, 'empty → default');
  ok(resolveTheme('nope').fellBack, 'unknown theme falls back + flags it');
  eq(resolveTheme('MODERN').theme, 'modern', 'case-insensitive');

  // every registered theme file actually exists on disk (ships, not dangling)
  for (const kind of Object.keys(THEMES)) {
    for (const t of listThemes(kind)) ok(t.exists, `${kind}/${t.id} file exists: ${t.file}`);
  }

  // listThemes returns the default-marked set
  const ids = listThemes('cv').map((t) => t.id);
  ok(ids.includes('classic') && ids.includes('academic'), 'listThemes lists cv themes');

  console.log(`templates self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`templates self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main();
  }
}
