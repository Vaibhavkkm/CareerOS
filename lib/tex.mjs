// lib/tex.mjs — parse a .tex document into ordered, comparable UNITS.
// Used by style-diff (alignment) and any structural validation.
// A unit = { section, kind, order_index, raw, norm, args? }

import { normalize } from './text.mjs';

function stripComments(tex) {
  return String(tex)
    .split('\n')
    .map((line) => line.replace(/(?<!\\)%.*$/, ''))
    .join('\n');
}

export function extractBody(tex) {
  const m = stripComments(tex).match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  return m ? m[1] : stripComments(tex);
}

// Pull the {..}{..} arguments immediately following a macro at index i.
function readBraceArgs(s, fromIdx, max = 8) {
  const args = [];
  let i = fromIdx;
  while (args.length < max) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== '{') break;
    let depth = 0, start = ++i;
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') {
        if (depth === 0) break;
        depth--;
      }
    }
    args.push(s.slice(start, i));
    i++; // past closing }
  }
  return args;
}

function parseCvUnits(body) {
  const units = [];
  let section = '(preamble)';
  let order = 0;
  const lines = body.split('\n');
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;

    const sec = line.match(/\\section\*?\{([^}]*)\}/);
    if (sec) { section = sec[1].trim(); continue; }

    const entryIdx = line.indexOf('\\entry');
    if (entryIdx !== -1) {
      const args = readBraceArgs(line, entryIdx + '\\entry'.length);
      units.push({
        section, kind: 'entry', order_index: order++, raw: line,
        norm: normalize(line), args,
      });
      continue;
    }

    // itemize bullets (may be "\item text" possibly multiple per line)
    if (line.includes('\\item')) {
      const parts = line.split(/\\item\b/).slice(1);
      for (const p of parts) {
        const txt = p.trim();
        if (!txt) continue;
        units.push({
          section, kind: 'item', order_index: order++, raw: `\\item ${txt}`,
          norm: normalize(txt),
        });
      }
      continue;
    }
  }
  return units;
}

function parseClUnits(body) {
  const blocks = body.split(/\n\s*\n/);
  const units = [];
  let order = 0;
  for (const b of blocks) {
    const norm = normalize(b);
    if (norm.split(' ').filter(Boolean).length < 8) continue; // skip boilerplate/short lines
    units.push({ section: 'body', kind: 'cl_para', order_index: order++, raw: b.trim(), norm });
  }
  return units;
}

export function parseTexUnits(tex, docKind = 'cv') {
  const body = extractBody(tex);
  return docKind === 'cl' ? parseClUnits(body) : parseCvUnits(body);
}

// Validation helpers used by compile-latex.mjs.
export function leftoverPlaceholders(tex) {
  const m = stripComments(tex).match(/<<[^>]*>>|\{\{[^}]*\}\}/g);
  return m ? [...new Set(m)] : [];
}

export function sectionsIn(tex) {
  const out = [];
  const re = /\\section\*?\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(stripComments(tex)))) out.push(m[1].trim());
  return out;
}
