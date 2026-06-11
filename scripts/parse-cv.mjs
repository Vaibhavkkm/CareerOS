#!/usr/bin/env node
// scripts/parse-cv.mjs — deterministic CV/résumé parser (zero tokens).
//
// Turns an uploaded CV (PDF via pdftotext, DOCX via unzip, TXT/MD/TEX native)
// — or a LinkedIn data-export folder of CSVs — into structured JSON the
// onboarding flow reviews: contact, summary, experience entries (title/company/
// dates/bullets), education, skills, languages, certifications. The agent
// reviews and fills gaps; this script makes extraction reproducible across
// agents and models instead of depending on how well each one free-reads a PDF.
//
// It NEVER writes into data/ on its own — output goes to stdout (JSON), or to
// an explicit --out path. Headers/titles it could not split cleanly are kept
// raw under `header` so a human (or the agent) can correct them; nothing is
// invented.
//
// Usage:
//   node scripts/parse-cv.mjs <cv-file> [--emit-master] [--out <file>] [--summary]
//   node scripts/parse-cv.mjs --linkedin <export-dir> [--emit-master] [--out <file>]
//   node scripts/parse-cv.mjs --self-test
//
// Exit codes: 0 ok · 1 bad input/extraction failure/self-test failure.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// ---------- text extraction ----------

// Extract plain text from a CV file based on its extension. Returns
// { ok, text?, source, error?, hint? } — never throws on a missing tool.
export function extractText(file) {
  const ext = extname(file).toLowerCase();
  const source = basename(file);
  if (!existsSync(file)) return { ok: false, source, error: `file not found: ${file}` };

  if (['.txt', '.md', '.tex', '.rtf'].includes(ext) || ext === '') {
    let text = readFileSync(file, 'utf8');
    if (ext === '.tex') text = stripLatex(text);
    return { ok: true, text, source };
  }
  if (ext === '.pdf') {
    const r = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      return {
        ok: false, source, error: 'pdftotext failed or is not installed',
        hint: 'brew install poppler (or apt-get install poppler-utils), or paste the CV as text',
      };
    }
    return { ok: true, text: r.stdout, source };
  }
  if (ext === '.docx' || ext === '.doc') {
    const r = spawnSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' });
    if (r.error || r.status !== 0 || !r.stdout) {
      return {
        ok: false, source, error: `could not read ${ext} (needs \`unzip\`; legacy .doc is unsupported)`,
        hint: 'export the CV as PDF or paste it as text',
      };
    }
    return { ok: true, text: docxXmlToText(r.stdout), source };
  }
  return { ok: false, source, error: `unsupported extension "${ext}"`, hint: 'use pdf, docx, txt, md or tex' };
}

// Minimal WordprocessingML → text: paragraphs to newlines, tabs to spaces.
export function docxXmlToText(xml) {
  return xml
    .replace(/<w:tab[^>]*\/>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#?\w+;/g, ' ');
}

function stripLatex(tex) {
  return tex
    .replace(/%.*$/gm, '')
    .replace(/\\(item|resumeitem)\b\s*/gi, '• ')
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ');
}

// ---------- CV text parsing ----------

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const DATE_POINT = String.raw`(?:${MONTH}\s+\d{4}|\d{1,2}[\/.]\d{4}|\d{4})`;
const DATE_END = String.raw`(?:${DATE_POINT}|present|current|now|ongoing|today)`;
export const DATE_RANGE_RE = new RegExp(`(${DATE_POINT})\\s*(?:[–—-]|to|until)\\s*(${DATE_END})`, 'i');

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /(?:\+|\(?\d{2,4}\)?[ \-.])\d[\d ()\-.\/]{6,}\d/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s|•]+|(?:linkedin\.com|github\.com)\/[^\s|•]+/gi;

const SECTION_ALIASES = [
  ['summary', /^(?:professional\s+|executive\s+)?(?:summary|profile|about(?:\s+me)?|objective)$/i],
  ['experience', /^(?:work|professional|employment|relevant)?\s*(?:experience|history|employment)$/i],
  ['education', /^(?:education|academic(?:\s+background)?|qualifications)$/i],
  ['skills', /^(?:technical\s+|core\s+|key\s+)?(?:skills|competencies|technologies|tech\s+stack)$/i],
  ['projects', /^(?:personal\s+|selected\s+|key\s+)?projects$/i],
  ['languages', /^languages?$/i],
  ['certifications', /^certifi(?:cations?|cates?)(?:\s*&?\s*licen[cs]es)?$/i],
  ['publications', /^publications?$/i],
  ['awards', /^(?:awards?|honou?rs?)(?:\s*&?\s*awards?)?$/i],
  ['interests', /^(?:interests?|hobbies)$/i],
  ['references', /^references?$/i],
];

const BULLET_RE = /^\s*(?:[-•▪◦‣·*–]|\d{1,2}[.)])\s+/;

function sectionKeyFor(line) {
  const t = line.trim().replace(/[:：]\s*$/, '').trim();
  if (!t || t.length > 42) return null;
  for (const [key, re] of SECTION_ALIASES) if (re.test(t)) return key;
  return null;
}

// Parse raw CV text into a structured, review-ready object.
export function parseCv(text) {
  const rawLines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const lines = rawLines.filter((_, i) => rawLines[i].trim() !== '' || true); // keep blanks for boundaries

  // 1) contact (scan whole doc; name from the top block)
  const all = text;
  const email = (all.match(EMAIL_RE) || [null])[0];
  const phone = (all.match(PHONE_RE) || [null])[0]?.trim() || null;
  const links = [...new Set((all.match(URL_RE) || []).map((u) => u.replace(/[.,;)\]]+$/, '')))];
  let name = null;
  for (const l of lines.slice(0, 8)) {
    const t = l.trim();
    if (!t || sectionKeyFor(t) || EMAIL_RE.test(t) || /\d/.test(t) || URL_RE.test(t)) { URL_RE.lastIndex = 0; continue; }
    URL_RE.lastIndex = 0;
    const words = t.split(/\s+/);
    if (words.length >= 2 && words.length <= 5) { name = t; break; }
  }

  // 2) split into sections
  const sections = {}; // key -> array of lines
  let current = 'preamble';
  sections[current] = [];
  for (const l of lines) {
    const key = sectionKeyFor(l);
    if (key) { current = key; sections[current] ||= []; continue; }
    sections[current].push(l);
  }

  const out = {
    contact: { name, email, phone, links },
    summary: collapse(sections.summary),
    experience: parseEntries(sections.experience || []),
    projects: parseEntries(sections.projects || []),
    education: parseEntries(sections.education || []),
    skills: splitList(sections.skills),
    languages: parseLanguages(sections.languages),
    certifications: splitList(sections.certifications),
    sections_found: Object.keys(sections).filter((k) => k !== 'preamble' && sections[k].some((l) => l.trim())),
  };
  return out;
}

function collapse(sectionLines) {
  if (!sectionLines) return null;
  const t = sectionLines.map((l) => l.trim()).filter(Boolean).join(' ').trim();
  return t || null;
}

// Entries are anchored on date-range lines; up to two preceding non-bullet
// lines become the header (title/company). Unsplittable headers stay raw.
export function parseEntries(sectionLines) {
  const entries = [];
  let entry = null;
  let pendingHeader = [];

  const flush = () => { if (entry && (entry.header || entry.bullets.length)) entries.push(entry); entry = null; };

  for (const raw of sectionLines) {
    const line = raw.trim();
    if (!line) continue;
    const dates = line.match(DATE_RANGE_RE);
    if (dates) {
      flush();
      const headerOnLine = line.replace(DATE_RANGE_RE, '').replace(/[|,•·]\s*$/, '').trim();
      const headerLines = [...pendingHeader, headerOnLine].filter(Boolean);
      pendingHeader = [];
      entry = { ...splitHeader(headerLines), dates: `${dates[1]} – ${dates[2]}`, bullets: [] };
    } else if (BULLET_RE.test(line)) {
      if (!entry) entry = { header: pendingHeader.join(' — ') || null, title: null, company: null, dates: null, bullets: [] };
      pendingHeader = [];
      entry.bullets.push(line.replace(BULLET_RE, '').trim());
    } else if (entry && entry.bullets.length && (/^[a-z]/.test(line) || line.length > 60)) {
      entry.bullets[entry.bullets.length - 1] += ` ${line}`; // wrapped continuation
    } else {
      if (entry && entry.bullets.length) { flush(); }
      pendingHeader.push(line);
      if (pendingHeader.length > 2) pendingHeader.shift();
    }
  }
  flush();
  if (!entries.length && pendingHeader.length) entries.push({ ...splitHeader(pendingHeader), dates: null, bullets: [] });
  return entries;
}

function splitHeader(headerLines) {
  const header = headerLines.join(' — ').replace(/\s{2,}/g, ' — ').trim() || null;
  if (!header) return { header: null, title: null, company: null };
  const parts = header.split(/\s+(?:—|–|\||@|·)\s+|,\s+(?=[A-Z])|\s+at\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { header, title: parts[0], company: parts[1] };
  return { header, title: header, company: null };
}

export function splitList(sectionLines) {
  if (!sectionLines) return [];
  const items = sectionLines.join('\n')
    .split(/[,;•|\n]|·/)
    .map((s) => s.replace(BULLET_RE, '').replace(/^[a-z\s]+:\s*/i, '').trim())
    .filter((s) => s && s.length <= 40);
  return [...new Set(items)];
}

function parseLanguages(sectionLines) {
  if (!sectionLines) return [];
  return splitList(sectionLines).map((item) => {
    const m = item.match(/^([A-Za-zÀ-ÿ ]+?)\s*[—–(:-]\s*([A-Za-z0-9 ]+)\)?$/);
    return m ? { language: m[1].trim(), level: m[2].trim() } : { language: item, level: null };
  });
}

// ---------- LinkedIn data-export parsing ----------

// Minimal RFC-4180 CSV parser: quoted fields, embedded commas/newlines, "" escapes.
export function parseCsv(str) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQuotes) {
      if (c === '"') { if (str[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && str[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const readCsvIf = (dir, file) => {
  const p = join(dir, file);
  return existsSync(p) ? parseCsv(readFileSync(p, 'utf8')) : [];
};

// Map a LinkedIn data-export folder (unzipped) onto the same shape as parseCv.
export function parseLinkedInExport(dir) {
  if (!existsSync(dir)) return { ok: false, error: `directory not found: ${dir}` };
  const profile = readCsvIf(dir, 'Profile.csv')[0] || {};
  const emails = readCsvIf(dir, 'Email Addresses.csv');
  const positions = readCsvIf(dir, 'Positions.csv');
  const education = readCsvIf(dir, 'Education.csv');
  const skills = readCsvIf(dir, 'Skills.csv');
  const languages = readCsvIf(dir, 'Languages.csv');
  const certs = readCsvIf(dir, 'Certifications.csv');
  if (!Object.keys(profile).length && !positions.length) {
    return { ok: false, error: 'no Profile.csv/Positions.csv found — point --linkedin at the unzipped LinkedIn export folder' };
  }
  const span = (a, b) => [a, b || 'Present'].filter(Boolean).join(' – ') || null;
  return {
    ok: true,
    parsed: {
      contact: {
        name: [profile['First Name'], profile['Last Name']].filter(Boolean).join(' ') || null,
        email: emails[0]?.['Email Address'] || null,
        phone: null, // LinkedIn exports don't include a phone by default
        links: profile['Websites'] ? [profile['Websites']] : [],
      },
      summary: profile['Summary'] || profile['Headline'] || null,
      experience: positions.map((p) => ({
        header: [p['Title'], p['Company Name']].filter(Boolean).join(' — ') || null,
        title: p['Title'] || null,
        company: p['Company Name'] || null,
        dates: span(p['Started On'], p['Finished On']),
        bullets: (p['Description'] || '').split(/\n+/).map((s) => s.trim()).filter(Boolean),
      })),
      projects: [],
      education: education.map((e) => ({
        header: [e['School Name'], e['Degree Name']].filter(Boolean).join(' — ') || null,
        title: e['Degree Name'] || null,
        company: e['School Name'] || null,
        dates: span(e['Start Date'], e['End Date']),
        bullets: (e['Notes'] || '').split(/\n+/).map((s) => s.trim()).filter(Boolean),
      })),
      skills: skills.map((s) => s['Name']).filter(Boolean),
      languages: languages.map((l) => ({ language: l['Name'], level: l['Proficiency'] || null })),
      certifications: certs.map((c) => [c['Name'], c['Authority']].filter(Boolean).join(' — ')).filter(Boolean),
      sections_found: ['linkedin-export'],
    },
  };
}

// ---------- master CV draft rendering ----------

export function toMasterMarkdown(parsed, source = 'upload') {
  const L = [];
  const c = parsed.contact || {};
  L.push(`# Master CV — ${c.name || 'UNKNOWN (fill in)'}`);
  L.push('');
  L.push(`> DRAFT extracted by \`parse-cv\` from ${source} — review EVERY line before`);
  L.push('> adopting as data/cv.master.md. Facts only; fix anything mis-parsed.');
  L.push('');
  L.push('## Contact');
  if (c.email) L.push(`- Email: ${c.email}`);
  if (c.phone) L.push(`- Phone: ${c.phone}`);
  for (const u of c.links || []) L.push(`- Link: ${u}`);
  if (parsed.summary) L.push('', '## Summary', '', parsed.summary);
  const entrySection = (title, entries) => {
    if (!entries?.length) return;
    L.push('', `## ${title}`);
    for (const e of entries) {
      const head = e.title && e.company ? `${e.title} — ${e.company}` : e.header || 'UNKNOWN ROLE (fix)';
      L.push('', `### ${head}${e.dates ? ` (${e.dates})` : ''}`);
      for (const b of e.bullets) L.push(`- ${b}`);
    }
  };
  entrySection('Experience', parsed.experience);
  entrySection('Projects', parsed.projects);
  entrySection('Education', parsed.education);
  if (parsed.skills?.length) L.push('', '## Skills', '', parsed.skills.join(' · '));
  if (parsed.languages?.length) {
    L.push('', '## Languages', '');
    for (const l of parsed.languages) L.push(`- ${l.language}${l.level ? ` (${l.level})` : ''}`);
  }
  if (parsed.certifications?.length) {
    L.push('', '## Certifications', '');
    for (const cert of parsed.certifications) L.push(`- ${cert}`);
  }
  return L.join('\n') + '\n';
}

// ---------- CLI ----------

function main(argv) {
  const args = argv.slice(2);
  const flag = (f) => args.includes(f);
  const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  let result;
  let source;
  const linkedinDir = opt('--linkedin');
  if (linkedinDir) {
    const r = parseLinkedInExport(linkedinDir);
    if (!r.ok) { console.error(JSON.stringify(r)); return 1; }
    result = r.parsed; source = 'LinkedIn data export';
  } else {
    const file = args.find((a) => !a.startsWith('--') && a !== opt('--out'));
    if (!file) { console.error(JSON.stringify({ ok: false, error: 'usage: parse-cv <cv-file> | --linkedin <dir>' })); return 1; }
    const ext = extractText(file);
    if (!ext.ok) { console.error(JSON.stringify(ext)); return 1; }
    result = parseCv(ext.text); source = ext.source;
  }

  const output = flag('--emit-master') ? toMasterMarkdown(result, source) : JSON.stringify({ ok: true, source, parsed: result }, null, 2);
  const out = opt('--out');
  if (out) { writeFileSync(out, output); console.log(JSON.stringify({ ok: true, source, wrote: out })); }
  else console.log(output);

  if (flag('--summary')) {
    console.error(`parsed ${source}: name=${result.contact?.name ?? '?'} · ${result.experience.length} roles · ` +
      `${result.education.length} education · ${result.skills.length} skills · sections: ${result.sections_found.join(', ')}`);
  }
  return 0;
}

// ---------- self-test ----------

const SAMPLE_CV = `
Jane Q. Public
Senior Data Engineer
jane.public@example.com | +352 621 000 111 | linkedin.com/in/janeqpublic
Luxembourg City, Luxembourg

SUMMARY
Data engineer with 7 years building batch and streaming pipelines.

EXPERIENCE

Senior Data Engineer — Acme Analytics    Mar 2021 – Present
• Built a Spark ingestion platform processing 2 TB/day
• Cut warehouse costs 38% by tiering storage
  across hot and cold paths with lifecycle rules

Data Engineer | Beta Corp    2018 – 2021
- Designed dbt models powering 40+ dashboards
- Led migration from Oracle to BigQuery

EDUCATION
MSc Computer Science — University of Luxembourg    2016 – 2018

SKILLS
Python, SQL, Spark; Airflow • dbt | BigQuery

LANGUAGES
English – C2, French (B1)

CERTIFICATIONS
GCP Professional Data Engineer
`;

async function selfTest() {
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) throw new Error(`check failed: ${what}`); };

  const p = parseCv(SAMPLE_CV);
  ok(p.contact.name === 'Jane Q. Public', `name (got ${p.contact.name})`);
  ok(p.contact.email === 'jane.public@example.com', 'email');
  ok(p.contact.phone?.includes('621 000 111'), 'phone');
  ok(p.contact.links.some((l) => l.includes('linkedin.com/in/janeqpublic')), 'linkedin link');
  ok(p.summary?.includes('7 years'), 'summary');
  ok(p.experience.length === 2, `2 experience entries (got ${p.experience.length})`);
  ok(p.experience[0].title === 'Senior Data Engineer', `exp0 title (got ${p.experience[0].title})`);
  ok(p.experience[0].company === 'Acme Analytics', `exp0 company (got ${p.experience[0].company})`);
  ok(/Mar\w* 2021 – Present/i.test(p.experience[0].dates), `exp0 dates (got ${p.experience[0].dates})`);
  ok(p.experience[0].bullets.length === 2, `exp0 bullets (got ${p.experience[0].bullets.length})`);
  ok(p.experience[0].bullets[1].includes('lifecycle rules'), 'wrapped bullet joined');
  ok(p.experience[1].company === 'Beta Corp', `exp1 company (got ${p.experience[1].company})`);
  ok(p.education.length === 1 && p.education[0].dates === '2016 – 2018', 'education entry + dates');
  for (const s of ['Python', 'SQL', 'Spark', 'Airflow', 'dbt', 'BigQuery']) ok(p.skills.includes(s), `skill ${s}`);
  ok(p.languages.some((l) => l.language === 'English' && l.level === 'C2'), 'language level');
  ok(p.certifications.some((c) => c.includes('GCP')), 'certification');
  ok(p.sections_found.includes('experience') && p.sections_found.includes('skills'), 'sections found');

  const md = toMasterMarkdown(p, 'self-test');
  ok(md.startsWith('# Master CV — Jane Q. Public'), 'master md title');
  ok(md.includes('### Senior Data Engineer — Acme Analytics (Mar 2021 – Present)'), 'master md entry heading');
  ok(md.includes('DRAFT'), 'master md marked as draft');

  // CSV parser edge cases
  const rows = parseCsv('Name,Desc\n"Doe, Jane","said ""hi""\nsecond line"\r\nBob,plain');
  ok(rows.length === 2 && rows[0].Name === 'Doe, Jane', 'csv quoted comma');
  ok(rows[0].Desc === 'said "hi"\nsecond line', 'csv escaped quote + embedded newline');
  ok(rows[1].Desc === 'plain', 'csv plain row');

  // LinkedIn export mapping (real files in a temp dir)
  const dir = mkdtempSync(join(tmpdir(), 'cvparse-'));
  try {
    writeFileSync(join(dir, 'Profile.csv'), 'First Name,Last Name,Headline,Summary\nJane,Public,Data Engineer,Builds pipelines');
    writeFileSync(join(dir, 'Positions.csv'),
      'Company Name,Title,Description,Location,Started On,Finished On\n"Acme, Inc.",Senior DE,"Did X\nDid Y",LU,Mar 2021,');
    writeFileSync(join(dir, 'Skills.csv'), 'Name\nPython\nSQL');
    const li = parseLinkedInExport(dir);
    ok(li.ok, 'linkedin parse ok');
    ok(li.parsed.contact.name === 'Jane Public', 'linkedin name');
    ok(li.parsed.experience[0].company === 'Acme, Inc.', 'linkedin company with comma');
    ok(li.parsed.experience[0].dates === 'Mar 2021 – Present', 'linkedin open-ended dates');
    ok(li.parsed.experience[0].bullets.length === 2, 'linkedin description → bullets');
    ok(li.parsed.skills.join(',') === 'Python,SQL', 'linkedin skills');
    const empty = parseLinkedInExport(join(dir, 'nope'));
    ok(!empty.ok, 'missing dir is a clean error');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // docx XML conversion
  const txt = docxXmlToText('<w:p><w:r><w:t>Hello</w:t></w:r><w:tab/><w:r><w:t>World &amp; co</w:t></w:r></w:p>');
  ok(txt.includes('Hello World & co'), 'docx xml → text');

  console.log(`parse-cv self-test: ${checks} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch((e) => { console.error(`parse-cv self-test FAILED: ${e.message}`); process.exit(1); });
  } else {
    process.exit(main(process.argv));
  }
}
