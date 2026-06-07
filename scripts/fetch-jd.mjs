#!/usr/bin/env node
// scripts/fetch-jd.mjs — give it ONE job URL, get the WHOLE posting.
//
// Unlike scan.mjs (which lists many jobs from a board), this resolves a single
// posting URL into the full job: title, company, location, the complete
// description text, departments, comp (when the ATS exposes it), and application
// questions. For known ATS hosts it calls the ATS's own JSON API (the most
// complete, reliable source); for anything else it fetches the page and strips
// it to clean text. It ALWAYS saves the full capture to data/jds/ so nothing the
// employer posted is lost. Pure HTTP + JSON — no Claude tokens.
//
// Layered robustness: ATS API → generic HTML scrape → (on total failure) emit
// needs_agent_fetch:true so the in-session agent can WebFetch as a last resort.
//
// Usage:
//   node scripts/fetch-jd.mjs <url> [--out data/jds/<file>.md] [--no-save] [--json]
//   node scripts/fetch-jd.mjs --self-test
//
// Output (--json, default): { ok, source, posting:{...}, saved_to|null, needs_agent_fetch }

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { makeHttpCtx, assertSafeUrl } from './providers/_http.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JDS_DIR = join(ROOT, 'data', 'jds');

// ─── HTML → text ─────────────────────────────────────────────────────
// Decode the HTML entities we actually see in ATS payloads (named + numeric).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', bull: '•', middot: '·', trade: '™',
  reg: '®', copy: '©', deg: '°', eacute: 'é', egrave: 'è',
};
export function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m);
}
function safeCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

// Turn an HTML fragment/page into readable plain text: drop script/style, turn
// block-level tags into line breaks, list items into "- ", strip the rest, then
// decode entities and tidy whitespace. Tolerant — never throws on weird markup.
export function htmlToText(html) {
  // Strip tags FIRST, decode entities AFTER — the correct order. Decoding first
  // would turn an entity-encoded ">" inside an attribute (e.g. data-x="&gt;") into
  // a literal ">" and corrupt the tag-strip regex. Content that arrives FULLY
  // entity-encoded (e.g. Greenhouse's `content`, where the tags themselves are
  // "&lt;p&gt;") must be decodeEntities()'d ONCE by the caller before reaching
  // here — see normalizeGreenhouse.
  let s = String(html == null ? '' : html);
  s = s.replace(/<\s*(script|style|noscript|svg|head)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  s = s.replace(/<\s*(br|hr)\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*li[^>]*>/gi, '\n- ');
  s = s.replace(/<\s*\/\s*(p|div|li|ul|ol|tr|h[1-6]|section|article|header|footer)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ''); // strip any remaining tags
  s = decodeEntities(s);         // decode entities now that the tags are gone
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ─── small text helpers ──────────────────────────────────────────────
export function slugify(s, max = 40) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '') || '';
}

export function buildFilename(company, role, date) {
  const co = slugify(company) || 'company';
  const ro = slugify(role) || 'role';
  return `${co}-${ro}-${date}.md`;
}

// First non-empty value among candidates.
function firstStr(...vals) {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

// ─── ATS detection (pure) ────────────────────────────────────────────
// Returns { ats, board?, jobId?, site?, org?, account?, shortcode?, company?,
// slug?, postingId? } or null. Parses both board URLs and single-posting URLs.
export function detectAts(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);

  // Greenhouse: boards.greenhouse.io/<board>[/jobs/<id>], job-boards[.eu].greenhouse.io/...,
  // and the embed form boards.greenhouse.io/embed/job_app?token=<id>&for=<board>.
  if (host.endsWith('greenhouse.io')) {
    if (segs[0] === 'embed') {
      const board = u.searchParams.get('for') || '';
      const jobId = u.searchParams.get('token') || '';
      return { ats: 'greenhouse', board, jobId };
    }
    const board = segs[0] || '';
    const jobsIdx = segs.indexOf('jobs');
    const jobId = jobsIdx >= 0 ? (segs[jobsIdx + 1] || '') : '';
    if (board) return { ats: 'greenhouse', board, jobId };
  }

  // Lever: jobs.lever.co/<site>[/<id>], jobs.eu.lever.co/<site>/<id>
  if (host.endsWith('lever.co')) {
    const site = segs[0] || '';
    const jobId = segs[1] || '';
    if (site) return { ats: 'lever', site, jobId };
  }

  // Ashby: jobs.ashbyhq.com/<org>[/<jobId>]
  if (host.endsWith('ashbyhq.com')) {
    const org = segs[0] || '';
    const jobId = segs[1] || '';
    if (org) return { ats: 'ashby', org, jobId };
  }

  // Workable: apply.workable.com/<account>/j/<shortcode>/, or <account>.workable.com
  if (host === 'apply.workable.com') {
    const account = segs[0] || '';
    const shortcode = segs[0] && segs[1] === 'j' ? (segs[2] || '') : '';
    if (account) return { ats: 'workable', account, shortcode };
  }
  if (host.endsWith('.workable.com')) {
    const account = host.slice(0, -'.workable.com'.length);
    if (account && account !== 'apply' && account !== 'www') return { ats: 'workable', account, shortcode: '' };
  }

  // Recruitee: <company>.recruitee.com/o/<slug> (or /career/...)
  if (host.endsWith('.recruitee.com')) {
    const company = host.slice(0, -'.recruitee.com'.length);
    const oIdx = segs.indexOf('o');         // .../o/<slug>
    const careerIdx = segs.indexOf('career'); // .../career/<id>-<slug>
    const slug = oIdx >= 0 ? (segs[oIdx + 1] || '')
      : (careerIdx >= 0 ? (segs[careerIdx + 1] || '') : '');
    if (company && company !== 'www') return { ats: 'recruitee', company, slug };
  }

  // SmartRecruiters: jobs.smartrecruiters.com/<company>/<postingId>-<slug>
  if (host.endsWith('smartrecruiters.com')) {
    const company = segs[0] || '';
    const last = segs[segs.length - 1] || '';
    const m = last.match(/^(\d{6,})/); // posting id is a long leading number
    const postingId = m ? m[1] : '';
    if (company && postingId) return { ats: 'smartrecruiters', company, postingId };
  }

  return null;
}

// Which detections we trust to a JSON API. Others (and any API failure) fall
// back to a generic HTML scrape, so coverage degrades gracefully, never breaks.
// Returns { url, method, body?, headers? } or null (=> use generic HTML).
export function buildApiRequest(d) {
  if (!d) return null;
  switch (d.ats) {
    case 'greenhouse':
      if (d.jobId) return { url: `https://boards-api.greenhouse.io/v1/boards/${enc(d.board)}/jobs/${enc(d.jobId)}?questions=true` };
      return null; // board-only URL: let the agent pick a posting; generic scrape the board page
    case 'lever':
      if (d.jobId) return { url: `https://api.lever.co/v0/postings/${enc(d.site)}/${enc(d.jobId)}?mode=json` };
      return null;
    case 'recruitee':
      if (d.slug) return { url: `https://${enc(d.company)}.recruitee.com/api/offers/${enc(d.slug)}` };
      return null;
    case 'smartrecruiters':
      if (d.postingId) return { url: `https://api.smartrecruiters.com/v1/companies/${enc(d.company)}/postings/${enc(d.postingId)}` };
      return null;
    // ashby single-job + workable single-job need authed/GraphQL endpoints to get
    // the full body, so we scrape the public HTML page instead (more reliable).
    default:
      return null;
  }
}
const enc = encodeURIComponent;

// ─── ATS response normalizers (pure) ─────────────────────────────────
// Each maps a parsed JSON payload to a Posting. Tolerant of field variation;
// returns content:'' when it can't find a body so the caller can fall back.
export function normalizeGreenhouse(json, url = '') {
  const j = json || {};
  return {
    source: 'greenhouse',
    role: firstStr(j.title),
    company: firstStr(j.company_name),
    location: firstStr(j.location && j.location.name),
    url: firstStr(j.absolute_url, url),
    departments: (j.departments || []).map((d) => d && d.name).filter(Boolean),
    content: htmlToText(j.content || ''),
    questions: (j.questions || []).map((q) => q && q.label).filter(Boolean),
  };
}
export function normalizeLever(json, url = '') {
  const j = json || {};
  const lists = Array.isArray(j.lists)
    ? j.lists.map((l) => `${(l && l.text) || ''}\n${htmlToText((l && l.content) || '')}`).join('\n\n')
    : '';
  const body = firstStr(j.descriptionPlain, htmlToText(j.description || ''));
  return {
    source: 'lever',
    role: firstStr(j.text),
    company: '',
    location: firstStr(j.categories && j.categories.location, j.workplaceType),
    url: firstStr(j.hostedUrl, j.applyUrl, url),
    departments: [firstStr(j.categories && j.categories.team)].filter(Boolean),
    content: [body, lists, htmlToText(j.additionalPlain || j.additional || '')].filter(Boolean).join('\n\n').trim(),
    questions: [],
  };
}
export function normalizeRecruitee(json, url = '') {
  const o = (json && json.offer) || json || {};
  const locParts = [o.city, o.country].filter(Boolean);
  return {
    source: 'recruitee',
    role: firstStr(o.title),
    company: firstStr(o.company_name),
    location: firstStr(o.location, locParts.join(', ')),
    url: firstStr(o.careers_url, o.url, url),
    departments: [firstStr(o.department)].filter(Boolean),
    content: [htmlToText(o.description || ''), htmlToText(o.requirements || '')].filter(Boolean).join('\n\n').trim(),
    questions: [],
  };
}
export function normalizeSmartRecruiters(json, url = '') {
  const j = json || {};
  const sec = (j.jobAd && j.jobAd.sections) || {};
  const pick = (s) => htmlToText((s && s.text) || '');
  const loc = j.location || {};
  const locParts = [loc.city, loc.region, loc.country].filter(Boolean);
  return {
    source: 'smartrecruiters',
    role: firstStr(j.name),
    company: firstStr(j.company && j.company.name),
    location: firstStr(loc.fullLocation, locParts.join(', '), loc.remote ? 'Remote' : ''),
    url: firstStr(j.applyUrl, j.ref, url),
    departments: [firstStr(j.department && j.department.label)].filter(Boolean),
    content: [pick(sec.companyDescription), pick(sec.jobDescription), pick(sec.qualifications), pick(sec.additionalInformation)]
      .filter(Boolean).join('\n\n').trim(),
    questions: [],
  };
}

// Generic HTML page → Posting (best effort). Pulls <title> for the role and the
// full page text as content. Used for unknown hosts and as the ATS fallback.
export function normalizeGenericHtml(html, url = '') {
  const titleMatch = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? htmlToText(titleMatch[1]) : '';
  return {
    source: 'generic-html',
    role: title,
    company: '',
    location: '',
    url,
    departments: [],
    content: htmlToText(html),
    questions: [],
  };
}

function normalizeByAts(ats, json, url) {
  switch (ats) {
    case 'greenhouse': return normalizeGreenhouse(json, url);
    case 'lever': return normalizeLever(json, url);
    case 'recruitee': return normalizeRecruitee(json, url);
    case 'smartrecruiters': return normalizeSmartRecruiters(json, url);
    default: return null;
  }
}

// ─── Posting → markdown (pure) ───────────────────────────────────────
export function toMarkdown(posting, fetchedDate) {
  const p = posting || {};
  const lines = [
    `# ${p.role || 'Job posting'}${p.company ? ` — ${p.company}` : ''}`,
    '',
    `- Source: ${p.source || 'unknown'}`,
    `- URL: ${p.url || ''}`,
    `- Location: ${p.location || '(not stated)'}`,
  ];
  if (p.departments && p.departments.length) lines.push(`- Department: ${p.departments.join(', ')}`);
  if (fetchedDate) lines.push(`- Fetched: ${fetchedDate}`);
  lines.push('', '## Full posting', '', (p.content || '').trim() || '(no body text captured — open the URL)');
  if (p.questions && p.questions.length) {
    lines.push('', '## Application questions', '', ...p.questions.map((q) => `- ${q}`));
  }
  return lines.join('\n') + '\n';
}

// ─── network orchestration ───────────────────────────────────────────
// Resolve a URL into a Posting. Tries the ATS API, then a generic HTML scrape.
// Returns { ok, posting?, source, needs_agent_fetch, error? }. Never throws.
export async function fetchPosting(url, ctx = makeHttpCtx()) {
  try { assertSafeUrl(url); } catch (e) { return { ok: false, needs_agent_fetch: true, error: e.message, source: 'none' }; }

  const detected = detectAts(url);
  const apiReq = buildApiRequest(detected);

  // 1) ATS JSON API (most complete).
  if (apiReq) {
    try {
      const json = await ctx.fetchJson(apiReq.url, { method: apiReq.method || 'GET', headers: apiReq.headers, body: apiReq.body, redirect: 'error' });
      const posting = normalizeByAts(detected.ats, json, url);
      if (posting && posting.content) return { ok: true, posting, source: posting.source, needs_agent_fetch: false };
    } catch { /* fall through to HTML */ }
  }

  // 2) Generic HTML scrape of the page itself. Follow up to 5 redirects, each
  //    re-checked against the SSRF guard (see _http.mjs fetchParsed).
  try {
    const html = await ctx.fetchText(url, { maxRedirects: 5 });
    const posting = normalizeGenericHtml(html, url);
    if (posting.content && posting.content.length > 40) {
      // tag the ATS we detected even though we scraped HTML, for transparency
      if (detected) posting.source = `${detected.ats}-html`;
      return { ok: true, posting, source: posting.source, needs_agent_fetch: false };
    }
    // Page loaded but had almost no text (likely JS-rendered) → let the agent try.
    return { ok: false, needs_agent_fetch: true, error: 'page had little/no extractable text (likely JS-rendered)', source: posting.source, posting };
  } catch (e) {
    return { ok: false, needs_agent_fetch: true, error: e.message, source: detected ? detected.ats : 'generic-html' };
  }
}

// Save a posting to data/jds/. Returns the absolute path written.
export function saveJd(posting, fetchedDate, { dir = JDS_DIR, out = null } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = out || join(dir, buildFilename(posting.company, posting.role, fetchedDate));
  writeFileSync(path, toMarkdown(posting, fetchedDate));
  return path;
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { url: null, outPath: null, save: true, json: true, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--no-save') out.save = false;
    else if (a === '--json') out.json = true;
    else if (a === '--summary') out.json = false;
    else if (a === '--out') out.outPath = argv[++i] || null;
    else if (a.startsWith('--out=')) out.outPath = a.slice('--out='.length);
    else if (!a.startsWith('--') && !out.url) out.url = a;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  if (!args.url) {
    console.error('usage: node scripts/fetch-jd.mjs <url> [--out <file>] [--no-save] [--summary]');
    process.exit(2);
  }
  const date = new Date().toISOString().slice(0, 10);
  const res = await fetchPosting(args.url);
  let savedTo = null;
  if (res.ok && args.save && res.posting) {
    try { savedTo = saveJd(res.posting, date, { out: args.outPath }); } catch (e) { res.save_error = e.message; }
  }

  if (args.json) {
    console.log(JSON.stringify({
      ok: res.ok, source: res.source, needs_agent_fetch: !!res.needs_agent_fetch,
      saved_to: savedTo ? savedTo.replace(ROOT + '/', '') : null,
      error: res.error || null,
      posting: res.posting || null,
    }, null, 2));
  } else if (res.ok) {
    const p = res.posting;
    console.log(`offerforge fetch-jd — ${res.source}\n`);
    console.log(`  role:     ${p.role || '(unknown)'}`);
    console.log(`  company:  ${p.company || '(unknown)'}`);
    console.log(`  location: ${p.location || '(not stated)'}`);
    console.log(`  text:     ${p.content.length} chars captured`);
    console.log(savedTo ? `  saved:    ${savedTo.replace(ROOT + '/', '')}` : '  (not saved)');
  } else {
    console.log(`offerforge fetch-jd — could not scrape: ${res.error}`);
    console.log('  → the in-session agent should WebFetch this URL as a fallback.');
  }
  process.exit(res.ok ? 0 : 3);
}

// ─── self-test (pure functions only — no network) ────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // entities
  eq(decodeEntities('a &amp; b &lt;x&gt; &#39;q&#39; &#x2014;'), "a & b <x> 'q' —", 'decodeEntities named + numeric');

  // htmlToText: tags → text, entity-encoded markup, lists, scripts dropped
  eq(htmlToText('<p>Hello <b>world</b></p>'), 'Hello world', 'htmlToText basic');
  eq(htmlToText('<script>var x=1<2;</script><p>Body</p>'), 'Body', 'htmlToText drops script');
  ok(htmlToText('<ul><li>One</li><li>Two</li></ul>').includes('- One'), 'htmlToText li → bullet');
  eq(htmlToText(decodeEntities('&lt;p&gt;Encoded&lt;/p&gt;')), 'Encoded', 'htmlToText after caller pre-decode (Greenhouse path)');
  eq(htmlToText('<div data-x="&gt;">text</div>'), 'text', 'htmlToText: entity-encoded > in an attribute does not corrupt output');

  // slug + filename
  eq(slugify('Senior Backend Engineer (Remote)!'), 'senior-backend-engineer-remote', 'slugify');
  eq(buildFilename('Acme Inc', 'Staff Engineer', '2026-06-07'), 'acme-inc-staff-engineer-2026-06-07.md', 'buildFilename');
  eq(buildFilename('', '', '2026-06-07'), 'company-role-2026-06-07.md', 'buildFilename defaults');

  // detectAts — board + single-posting URLs across every supported ATS
  const gh = detectAts('https://boards.greenhouse.io/acme/jobs/4012345');
  ok(gh && gh.ats === 'greenhouse' && gh.board === 'acme' && gh.jobId === '4012345', 'detect greenhouse job');
  ok(detectAts('https://job-boards.eu.greenhouse.io/acme').jobId === '', 'detect greenhouse board-only (no jobId)');
  const ghEmbed = detectAts('https://boards.greenhouse.io/embed/job_app?token=99&for=acme');
  ok(ghEmbed.board === 'acme' && ghEmbed.jobId === '99', 'detect greenhouse embed');
  const lv = detectAts('https://jobs.lever.co/acme/abc-123-uuid');
  ok(lv && lv.ats === 'lever' && lv.site === 'acme' && lv.jobId === 'abc-123-uuid', 'detect lever job');
  const ash = detectAts('https://jobs.ashbyhq.com/acme/uuid-1');
  ok(ash && ash.ats === 'ashby' && ash.org === 'acme' && ash.jobId === 'uuid-1', 'detect ashby job');
  const wk = detectAts('https://apply.workable.com/acme/j/ABC123/');
  ok(wk && wk.ats === 'workable' && wk.account === 'acme' && wk.shortcode === 'ABC123', 'detect workable job');
  const rc = detectAts('https://acme.recruitee.com/o/senior-engineer');
  ok(rc && rc.ats === 'recruitee' && rc.company === 'acme' && rc.slug === 'senior-engineer', 'detect recruitee job');
  const rcCareer = detectAts('https://acme.recruitee.com/career/12345-senior-engineer');
  ok(rcCareer && rcCareer.ats === 'recruitee' && rcCareer.slug === '12345-senior-engineer', 'detect recruitee /career/ job');
  const sr = detectAts('https://jobs.smartrecruiters.com/Acme/743999992-staff-engineer');
  ok(sr && sr.ats === 'smartrecruiters' && sr.company === 'Acme' && sr.postingId === '743999992', 'detect smartrecruiters job');
  ok(detectAts('https://example.com/careers/123') === null, 'detect unknown host → null');
  ok(detectAts('not a url') === null, 'detect garbage → null');

  // buildApiRequest — API for confident ATS, null (→ generic) otherwise
  ok(buildApiRequest(gh).url === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345?questions=true', 'api greenhouse');
  ok(buildApiRequest(lv).url === 'https://api.lever.co/v0/postings/acme/abc-123-uuid?mode=json', 'api lever');
  ok(buildApiRequest(rc).url === 'https://acme.recruitee.com/api/offers/senior-engineer', 'api recruitee');
  ok(buildApiRequest(sr).url === 'https://api.smartrecruiters.com/v1/companies/Acme/postings/743999992', 'api smartrecruiters');
  ok(buildApiRequest(ash) === null, 'ashby single-job → generic (null api)');
  ok(buildApiRequest(detectAts('https://job-boards.greenhouse.io/acme')) === null, 'greenhouse board-only → generic');

  // normalizers — feed fixture payloads
  const ghP = normalizeGreenhouse({
    title: 'Staff Engineer', company_name: 'Acme', location: { name: 'Remote' },
    absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
    departments: [{ name: 'Eng' }], content: '&lt;p&gt;Build &amp; ship.&lt;/p&gt;',
    questions: [{ label: 'Why Acme?' }],
  });
  eq(ghP.role, 'Staff Engineer', 'gh role'); eq(ghP.company, 'Acme', 'gh company');
  eq(ghP.location, 'Remote', 'gh location'); ok(ghP.content.includes('Build & ship.'), 'gh content decoded');
  ok(ghP.questions[0] === 'Why Acme?', 'gh question'); ok(ghP.departments[0] === 'Eng', 'gh dept');

  const lvP = normalizeLever({
    text: 'Backend Engineer', categories: { location: 'Berlin', team: 'Platform' },
    descriptionPlain: 'Own the API.', lists: [{ text: 'Reqs', content: '<li>Go</li>' }],
    hostedUrl: 'https://jobs.lever.co/acme/1',
  });
  eq(lvP.role, 'Backend Engineer', 'lever role'); eq(lvP.location, 'Berlin', 'lever location');
  ok(lvP.content.includes('Own the API.') && lvP.content.includes('Go'), 'lever content + lists');

  const rcP = normalizeRecruitee({ offer: { title: 'SRE', city: 'NYC', country: 'US', description: '<p>Run things</p>' } });
  eq(rcP.role, 'SRE', 'recruitee role'); eq(rcP.location, 'NYC, US', 'recruitee location');
  ok(rcP.content.includes('Run things'), 'recruitee content');

  const srP = normalizeSmartRecruiters({
    name: 'Data Engineer', company: { name: 'Acme' }, location: { city: 'Paris', country: 'FR' },
    jobAd: { sections: { jobDescription: { text: '<p>ETL pipelines</p>' }, qualifications: { text: '<p>SQL</p>' } } },
  });
  eq(srP.role, 'Data Engineer', 'sr role'); eq(srP.location, 'Paris, FR', 'sr location');
  ok(srP.content.includes('ETL pipelines') && srP.content.includes('SQL'), 'sr content joins sections');

  const gen = normalizeGenericHtml('<html><head><title>Cool Role - Acme</title></head><body><p>Do work</p></body></html>', 'https://x.io/j/1');
  ok(gen.role === 'Cool Role - Acme' && gen.content.includes('Do work') && gen.source === 'generic-html', 'generic html parse');

  // toMarkdown
  const md = toMarkdown(ghP, '2026-06-07');
  ok(md.startsWith('# Staff Engineer — Acme'), 'md heading');
  ok(md.includes('## Full posting') && md.includes('Build & ship.'), 'md body');
  ok(md.includes('## Application questions') && md.includes('- Why Acme?'), 'md questions');

  console.log(`fetch-jd self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`fetch-jd self-test FAILED: ${e.message}`); process.exit(1); }
  } else {
    main().catch((e) => { console.error(`Fatal: ${e.message}`); process.exit(1); });
  }
}
