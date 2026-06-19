#!/usr/bin/env node
// lib/languages.mjs — extract SPOKEN-language requirements from a job description.
//
// Pure, deterministic, zero-token. scripts/board.mjs uses it to add a
// "Language requirement" signal to each board row; the web UI surfaces it as a
// column + a Posting field.
//
// Precision over recall, by design:
//   • Only languages on an explicit whitelist match — so programming languages
//     (Go, R, C, Rust, Java, Python, …) can never be mistaken for spoken ones.
//   • A bare mention is ignored unless the sentence is ANCHORED by language
//     context (a "Languages:" label, a level word, "fluent", a CEFR token, …).
//     This kills false positives like "polish your communication" or "Spanish flu".
//   • Each mention's LEVEL is the NEAREST level-signal in the same sentence, so
//     "English required, German is a plus" classifies each one correctly.

import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Canonical name -> alias forms (English name + common demonyms/endonyms seen in
// EU job ads). Matched word-boundaried + case-insensitively.
export const LANGUAGES = [
  ['English',       ['english', 'anglais', 'englisch', 'englischkenntnisse', 'inglés', 'inglese', 'engels']],
  ['French',        ['french', 'français', 'francais', 'französisch', 'franzosisch', 'französischkenntnisse', 'franzosischkenntnisse', 'francés', 'francese', 'frans']],
  ['German',        ['german', 'allemand', 'deutsch', 'deutschkenntnisse', 'alemán', 'tedesco', 'duits']],
  ['Luxembourgish', ['luxembourgish', 'luxemburgish', 'lëtzebuergesch', 'letzebuergesch', 'luxembourgeois']],
  ['Dutch',         ['dutch', 'flemish', 'néerlandais', 'nederlands']],
  ['Italian',       ['italian', 'italien', 'italiano', 'italienisch']],
  ['Spanish',       ['spanish', 'castilian', 'español', 'espanol', 'espagnol', 'spanisch']],
  ['Portuguese',    ['portuguese', 'português', 'portugues', 'portugais']],
  ['Mandarin',      ['mandarin']],
  ['Chinese',       ['chinese', 'cantonese']],
  ['Japanese',      ['japanese']],
  ['Korean',        ['korean']],
  ['Arabic',        ['arabic']],
  ['Russian',       ['russian']],
  ['Polish',        ['polish']],
  ['Swedish',       ['swedish']],
  ['Danish',        ['danish']],
  ['Norwegian',     ['norwegian']],
  ['Finnish',       ['finnish']],
  ['Greek',         ['greek']],
  ['Turkish',       ['turkish']],
  ['Romanian',      ['romanian']],
  ['Czech',         ['czech']],
  ['Slovak',        ['slovak']],
  ['Hungarian',     ['hungarian']],
  ['Ukrainian',     ['ukrainian']],
  ['Hebrew',        ['hebrew']],
  ['Hindi',         ['hindi']],
  ['Catalan',       ['catalan']],
];

// Display + sort priority (EU-common first), then anything else alphabetically.
const PRIORITY = ['English', 'French', 'German', 'Luxembourgish', 'Dutch'];

const STRENGTH = { required: 3, asset: 2, mentioned: 1 };

// A sentence "counts" only if it carries language context. The label line
// (`Languages:`) always counts.
const LABEL_LINE = /^\s*(languages?|langues?|sprachen?|idiomas?|talen|lingue)\s*[:\-]/i;
const ANCHOR = new RegExp(
  '\\b(' +
  'languages?|langues?|sprachen?|fluent|fluency|fluently|native|speaker|speaking|spoken|' +
  'proficient|proficiency|command of|mother\\s*tongue|bilingual|trilingual|multilingual|' +
  'written and spoken|verbal|mandatory|required|requirement|essential|compulsory|' +
  'asset|advantage|advantageous|desirable|preferred|nice to have|a plus|' +
  '[abc][12]' +
  ')\\b',
  'i',
);
// Non-English anchor cues so a JD written in FR/DE/NL/ES/IT still gets its language
// requirements detected (the English ANCHOR above misses them entirely). Stems +
// \w* keep accented endings and German compounds (…kenntnisse) matchable.
const ANCHOR_INTL =
  /\b(couramment|courant|ma[ií]tris\w*|exig\w*|requis\w*|obligatoire|souhait\w*|appr[ée]ci\w*|atout|maternel\w*|bilingue|trilingue|niveau|connaissance\w*|\w*kenntniss\w*|flie[sß]end|verhandlungssicher|erforderlich|zwingend|voraussetzung|muttersprach\w*|w[üu]nschenswert|vorteil\w*|vloeiend|vereist|verplicht|moedertaal|voordeel\w*|talenkennis\w*|fluido|nativo|dominio|requerid\w*|imprescindible|obligatori\w*|valorable|deseable|conocimiento\w*|fluente|madrelingua|richiest\w*|obbligatori\w*|gradito|conoscenza)/i;

// ── level signals (with their position) ─────────────────────────────────────
// CEFR tokens are also level signals: B2/C1/C2 => required-grade, A1/A2/B1 => asset-grade.
function levelSignals(sentence) {
  const out = [];
  const scan = (re, level) => {
    for (const m of sentence.matchAll(re)) out.push({ level, index: m.index, cefr: null });
  };
  // CEFR first (carries an explicit level label we want to display).
  for (const m of sentence.matchAll(/\b([abc][12])\b/gi)) {
    const cefr = m[1].toUpperCase();
    const level = (cefr === 'B2' || cefr === 'C1' || cefr === 'C2') ? 'required' : 'asset';
    out.push({ level, index: m.index, cefr });
  }
  scan(/\b(required|mandatory|essential|compulsory|imperative|requirement|fluent|fluency|fluently|native|proficient|proficiency|mother\s*tongue|bilingual|trilingual)\b/gi, 'required');
  scan(/\b(excellent|strong|good|professional|working)\s+(command|knowledge|proficiency)\b/gi, 'required');
  scan(/\b(asset|advantage|advantageous|desirable|preferred|beneficial|appreciated|valued|welcome)\b/gi, 'asset');
  scan(/\b(a plus|is a plus|plus point|nice to have|considered a plus|would be a plus)\b/gi, 'asset');
  // Non-English level cues (FR / DE / NL / ES / IT). Stems + \w* absorb inflections.
  scan(/\b(exig\w*|requis\w*|obligatoire|ma[ií]tris\w*|couramment|courant|maternel\w*|bilingue|trilingue|erforderlich|zwingend|voraussetzung|flie[sß]end|verhandlungssicher|muttersprach\w*|vereist|verplicht|vloeiend|moedertaal|requerid\w*|imprescindible|obligatori\w*|fluid\w*|nativ\w*|dominio|richiest\w*|obbligatori\w*|fluente|madrelingua)\b/gi, 'required');
  scan(/\b(souhait\w*|appr[ée]ci\w*|atout|avantage\w*|w[üu]nschenswert|vorteil\w*|gewenst|voordeel\w*|valorable|deseable|gradito|preferibile)\b/gi, 'asset');
  return out;
}

// Split into sentences without breaking on ":" (keeps "Languages: …" intact).
function sentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[•·▪►‣◦]/g, '\n')
    .split(/\n+|(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Precompiled ONCE: alias -> canonical name, and a single combined alternation.
// Building ~70 RegExps per sentence (every alias, every sentence, every posting)
// was the board's hottest path — seconds of CPU over a few thousand postings.
// Longest-first ordering so e.g. "englisch" can't be shadowed by "english".
const ALIAS_TO_CANON = new Map();
for (const [canon, aliases] of LANGUAGES) {
  for (const a of aliases) ALIAS_TO_CANON.set(a.toLowerCase(), canon);
}
const ALIAS_RE = new RegExp(
  `\\b(${[...ALIAS_TO_CANON.keys()]
    .sort((x, y) => y.length - x.length)
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b`,
  'gi',
);

// Find every whitelisted language in a sentence: [{ lang, index }].
function languageHits(sentence) {
  const hits = [];
  ALIAS_RE.lastIndex = 0; // matchAll clones the regex WITH its current lastIndex
  for (const m of sentence.matchAll(ALIAS_RE)) {
    hits.push({ lang: ALIAS_TO_CANON.get(m[1].toLowerCase()), index: m.index });
  }
  return hits;
}

// ── public: extract ──────────────────────────────────────────────────────────
// Returns [{ lang, level, cefr }] sorted strongest-first, deduped per language.
export function extractLanguages(text) {
  // Fast bail: a posting that never mentions ANY whitelisted language skips the
  // sentence split + per-sentence scans entirely. (Reset lastIndex — ALIAS_RE is
  // sticky-global and .test() advances it.)
  ALIAS_RE.lastIndex = 0;
  if (!ALIAS_RE.test(String(text || ''))) return [];
  const best = new Map(); // lang -> { level, cefr, strength }
  for (const s of sentences(text)) {
    const hits = languageHits(s);
    if (!hits.length) continue;
    const anchored = LABEL_LINE.test(s) || ANCHOR.test(s) || ANCHOR_INTL.test(s);
    if (!anchored) continue;
    const signals = levelSignals(s);
    // Clause delimiters: a signal on the FAR side of a comma/semicolon belongs to
    // a different clause, so it's only a fallback (keeps "English required, French
    // is an asset" from leaking "required" onto French).
    const boundaries = [...s.matchAll(/[,;]/g)].map((m) => m.index);
    const separated = (i, j) =>
      boundaries.some((b) => b > Math.min(i, j) && b < Math.max(i, j));
    for (const h of hits) {
      // nearest level-signal in the SAME clause wins; else nearest in the sentence.
      const same = signals.filter((sig) => !separated(h.index, sig.index));
      const pool = same.length ? same : signals;
      let level = 'mentioned';
      let cefr = null;
      let bestDist = Infinity;
      for (const sig of pool) {
        // On a tie, prefer the signal AFTER the language — CEFR/level words usually
        // follow their language ("German B1"), so nudge before-signals slightly back.
        const d = Math.abs(sig.index - h.index) + (sig.index < h.index ? 0.5 : 0);
        if (d < bestDist) { bestDist = d; level = sig.level; cefr = sig.cefr; }
      }
      const strength = STRENGTH[level];
      const prev = best.get(h.lang);
      if (!prev || strength > prev.strength || (strength === prev.strength && cefr && !prev.cefr)) {
        best.set(h.lang, { level, cefr, strength });
      }
    }
  }
  return [...best.entries()]
    .map(([lang, v]) => ({ lang, level: v.level, cefr: v.cefr }))
    .sort((a, b) => {
      const sd = STRENGTH[b.level] - STRENGTH[a.level];
      if (sd) return sd;
      const pa = PRIORITY.indexOf(a.lang), pb = PRIORITY.indexOf(b.lang);
      const ra = pa === -1 ? 99 : pa, rb = pb === -1 ? 99 : pb;
      if (ra !== rb) return ra - rb;
      return a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0;
    });
}

// ── public: format ───────────────────────────────────────────────────────────
// [{lang,level,cefr}] -> "English (req), French (plus), German (C1)" capped at `max`.
export function formatLanguages(list, { max = 4 } = {}) {
  const arr = Array.isArray(list) ? list : [];
  const label = (x) => {
    const tag = x.cefr ? x.cefr : x.level === 'required' ? 'req' : x.level === 'asset' ? 'plus' : '';
    return tag ? `${x.lang} (${tag})` : x.lang;
  };
  if (!arr.length) return '';
  const shown = arr.slice(0, max).map(label);
  if (arr.length > max) shown.push(`+${arr.length - max}`);
  return shown.join(', ');
}

// Convenience: text -> short string (what board rows store).
export function languageRequirement(text, opts) {
  return formatLanguages(extractLanguages(text), opts);
}

// ── self-test ────────────────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
  const find = (list, lang) => list.find((x) => x.lang === lang);

  // 1) explicit label line: required vs asset, split by nearest signal
  {
    const r = extractLanguages('Language: English is required, French is an asset.');
    eq(find(r, 'English')?.level, 'required', 'English required');
    eq(find(r, 'French')?.level, 'asset', 'French asset');
    eq(formatLanguages(r), 'English (req), French (plus)', 'format req/plus');
  }
  // 2) shared signal applies to several languages
  {
    const r = extractLanguages('Fluent in English and French; German is a plus.');
    eq(find(r, 'English')?.level, 'required', 'English fluent->required');
    eq(find(r, 'French')?.level, 'required', 'French fluent->required');
    eq(find(r, 'German')?.level, 'asset', 'German plus->asset');
  }
  // 3) CEFR captured + displayed
  {
    const r = extractLanguages('Proficiency in German (C1). English is mandatory.');
    eq(find(r, 'German')?.cefr, 'C1', 'German CEFR C1');
    eq(find(r, 'English')?.level, 'required', 'English mandatory');
    ok(formatLanguages(r).includes('German (C1)'), 'format shows CEFR');
  }
  // 3b) CEFR isn't cross-assigned across "and" — German keeps B1, not English's C1
  {
    const r = extractLanguages('English C1 and German B1 required.');
    eq(find(r, 'English')?.cefr, 'C1', 'English CEFR C1');
    eq(find(r, 'German')?.cefr, 'B1', 'German CEFR B1 (not cross-assigned)');
  }
  // 4) adjacent clauses: nearest signal disambiguates
  {
    const r = extractLanguages('English required, German nice to have.');
    eq(find(r, 'English')?.level, 'required', 'adjacent: English required');
    eq(find(r, 'German')?.level, 'asset', 'adjacent: German asset');
  }
  // 5) NO false positives from programming languages / unanchored mentions
  {
    eq(extractLanguages('Experience with Go, Rust, R, C++ and Java.').length, 0, 'no prog-lang hits');
    eq(extractLanguages('Please polish your communication and writing.').length, 0, 'unanchored "polish" ignored');
    eq(extractLanguages('The 1918 Spanish flu pandemic.').length, 0, 'unanchored "Spanish" ignored');
    eq(extractLanguages('We value diversity and inclusion.').length, 0, 'no language => empty');
  }
  // 6) native speaker + advantage
  {
    const r = extractLanguages('Native German speaker required; knowledge of Luxembourgish is an advantage.');
    eq(find(r, 'German')?.level, 'required', 'native German required');
    eq(find(r, 'Luxembourgish')?.level, 'asset', 'Luxembourgish advantage');
  }
  // 7) bare anchored mention => "mentioned" (still surfaced)
  {
    const r = extractLanguages('This is an English-speaking work environment.');
    eq(find(r, 'English')?.level, 'mentioned', 'English-speaking -> mentioned');
    eq(formatLanguages(r), 'English', 'mentioned shows no tag');
  }
  // 8) sort: required before asset; cap + overflow marker
  {
    const r = extractLanguages('Languages: English required, French required, German required, Dutch required, Italian is an asset.');
    eq(r[0].level, 'required', 'required sorts first');
    eq(find(r, 'Italian')?.level, 'asset', 'Italian asset');
    ok(formatLanguages(r, { max: 2 }).endsWith(`+${r.length - 2}`), 'overflow marker');
  }
  // 9) empty/garbage input is safe
  {
    eq(formatLanguages(extractLanguages('')), '', 'empty input');
    eq(formatLanguages(extractLanguages(null)), '', 'null input');
  }
  // 10) NON-ENGLISH postings: anchored by the local language's own cues
  {
    // French
    const fr = extractLanguages("Maîtrise du français et de l'anglais exigée. Le luxembourgeois est un atout.");
    eq(find(fr, 'French')?.level, 'required', 'FR: français exigé -> required');
    eq(find(fr, 'English')?.level, 'required', 'FR: anglais exigé -> required');
    eq(find(fr, 'Luxembourgish')?.level, 'asset', 'FR: luxembourgeois atout -> asset');
    // German (incl. compound "…kenntnisse")
    const de = extractLanguages('Verhandlungssichere Deutschkenntnisse erforderlich, Englisch von Vorteil.');
    eq(find(de, 'German')?.level, 'required', 'DE: Deutschkenntnisse erforderlich -> required');
    eq(find(de, 'English')?.level, 'asset', 'DE: Englisch von Vorteil -> asset');
    // Dutch
    const nl = extractLanguages('Vloeiend Nederlands vereist; kennis van het Frans is een voordeel.');
    eq(find(nl, 'Dutch')?.level, 'required', 'NL: Nederlands vereist -> required');
    eq(find(nl, 'French')?.level, 'asset', 'NL: Frans voordeel -> asset');
    // still no false positives on a non-language sentence in another language
    eq(extractLanguages('Expérience avec Go, R et Java.').length, 0, 'FR: prog langs not matched');
  }

  console.log(`languages self-test: ${n} checks passed ✅`);
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) { selfTest(); }
  else {
    // ad-hoc: read stdin, print the extracted requirement
    let buf = '';
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => {
      console.log(JSON.stringify({ languages: extractLanguages(buf), formatted: languageRequirement(buf) }, null, 2));
    });
  }
}
