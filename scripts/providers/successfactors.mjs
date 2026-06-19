// @ts-check
// scripts/providers/successfactors.mjs
// Generic SAP SuccessFactors "jobs2web" (j2w) career-site scraper.
//
// Many institutions (e.g. LISER — jobs.liser.lu) host their careers board on SAP
// SuccessFactors Recruiting. The search results are SERVER-RENDERED HTML: each
// opening is an <a class="…jobTitle-link…" href="/job/<slug>/<id>/">Title</a>
// (rendered twice — desktop + phone — so we dedupe by URL). Results paginate via a
// &startrow=N query param, so we walk pages (advancing by each page's own count)
// until one yields no new openings. No public API, no headless browser, zero deps.
//
// The host is the customer's own domain, so this can't auto-detect — wire it
// EXPLICITLY on a portals.yml entry with the SF search URL, e.g.:
//   { name: "LISER", provider: successfactors,
//     careers_url: "https://jobs.liser.lu/search/?q=", location: "Luxembourg", enabled: true }
//
// Contract: default export { id, detect?, async fetch(entry, ctx) } -> Job[]
// where Job = { title, url, company, location }.

import { pathToFileURL } from 'node:url';

const DEFAULT_LOCATION = 'Luxembourg';
const MAX_PAGES = 25; // hard cap (defends against a server that ignores startrow)

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function safeCodePoint(n) { if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return ''; try { return String.fromCodePoint(n); } catch { return ''; } }

// Strip tags + decode the handful of HTML entities SF emits. Pure; exported for tests.
export function cleanText(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => {
      const k = n.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, k) ? NAMED_ENTITIES[k] : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse ONE results page into Job[] (deduped within the page — SF renders a desktop
// + a phone anchor per opening). Exported for the self-test.
export function parseJobs(html, { baseUrl, company = 'Unknown', location = DEFAULT_LOCATION } = {}) {
  const out = [];
  const seen = new Set();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const attrs = m[1];
    if (!/\bclass="[^"]*\bjobTitle-link\b[^"]*"/i.test(attrs)) continue;
    const hrefMatch = attrs.match(/\bhref="([^"]+)"/i);
    const title = cleanText(m[2]);
    if (!hrefMatch || !title) continue;
    let url;
    try { url = new URL(hrefMatch[1].trim().replace(/&amp;/g, '&'), baseUrl).toString(); } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url, company, location });
  }
  return out;
}

// Set/replace the startrow query param on the search URL.
export function pageUrl(searchUrl, startrow) {
  try {
    const u = new URL(searchUrl);
    u.searchParams.set('startrow', String(startrow));
    return u.toString();
  } catch {
    const sep = searchUrl.includes('?') ? '&' : '?';
    return `${searchUrl}${sep}startrow=${startrow}`;
  }
}

function searchUrlOf(entry) {
  const u = entry && (entry.careers_url || entry.api);
  return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u.trim() : null;
}

const provider = {
  id: 'successfactors',

  // Custom-domain SF sites can't be identified from the host alone, so this never
  // auto-claims — wire it explicitly with `provider: successfactors` (resolveProvider
  // honours an explicit provider and skips detect()).
  detect() { return null; },

  async fetch(entry, ctx) {
    const search = searchUrlOf(entry);
    if (!search) throw new Error('successfactors: entry needs a careers_url (the SF search page URL)');
    const company = (entry && entry.name) || 'Unknown';
    const location = (entry && entry.location) || DEFAULT_LOCATION;
    const all = [];
    const seen = new Set();
    let startrow = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      let html;
      try { html = await ctx.fetchText(pageUrl(search, startrow), { redirect: 'follow', maxRedirects: 3 }); }
      catch { break; }
      const jobs = parseJobs(html, { baseUrl: search, company, location });
      let added = 0;
      for (const j of jobs) { if (!seen.has(j.url)) { seen.add(j.url); all.push(j); added++; } }
      if (added === 0) break;            // nothing new on this page → done
      startrow += jobs.length;           // advance by this page's own size (adapts to any page size)
    }
    return all;
  },
};

export default provider;

// ─── self-test ────────────────────────────────────────────────────────
// `node scripts/providers/successfactors.mjs --self-test` — offline, deterministic.
export async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  // Mirrors the real LISER markup: a desktop + a phone anchor per opening (dedupe),
  // a &amp; + %28..%29 in the href, and a non-job link to ignore.
  const FIXTURE = `
    <tr class="data-row">
      <td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Esch-Legal-Manager-Research-&amp;-Partnerships-%28fm%29-Ref-26-06/1342460755/">Legal Manager - Research &amp; Partnerships (f/m) - Ref: 26-06</a></td>
      <td class="jobTitle visible-phone"><a class="jobTitle-link" href="/job/Esch-Legal-Manager-Research-&amp;-Partnerships-%28fm%29-Ref-26-06/1342460755/">Legal Manager (phone view)</a></td>
    </tr>
    <tr class="data-row">
      <td class="jobTitle"><a class="x jobTitle-link y" href="/job/Esch-PhD-Urban-Noise/1342460999/">PhD Candidate in Urban Noise (f/m) - Ref: 26-18</a></td>
    </tr>
    <li><a class="some-other-link" href="/about/">About</a></li>`;
  const jobs = parseJobs(FIXTURE, { baseUrl: 'https://jobs.liser.lu/search/?q=', company: 'LISER', location: 'Esch-sur-Alzette, Luxembourg' });
  assert.equal(jobs.length, 2, 'dedupes desktop+phone anchors by URL → 2 openings (ignores non-job link)');
  assert.equal(jobs[0].title, 'Legal Manager - Research & Partnerships (f/m) - Ref: 26-06', 'decodes &amp; in the title');
  assert.equal(jobs[0].url, 'https://jobs.liser.lu/job/Esch-Legal-Manager-Research-&-Partnerships-%28fm%29-Ref-26-06/1342460755/', 'absolute url; &amp;->& kept, %28 preserved');
  assert.equal(jobs[0].company, 'LISER');
  assert.equal(jobs[0].location, 'Esch-sur-Alzette, Luxembourg');
  assert.equal(jobs[1].title, 'PhD Candidate in Urban Noise (f/m) - Ref: 26-18', 'class in any position still matches');

  assert.equal(pageUrl('https://jobs.liser.lu/search/?q=', 20), 'https://jobs.liser.lu/search/?q=&startrow=20', 'pageUrl adds startrow');
  assert.equal(pageUrl('https://jobs.liser.lu/search/?q=&startrow=0', 10), 'https://jobs.liser.lu/search/?q=&startrow=10', 'pageUrl replaces existing startrow');

  assert.equal(provider.detect({ careers_url: 'https://jobs.liser.lu/search/' }), null, 'never auto-claims (explicit wiring only)');
  assert.equal(cleanText('A &amp; B &#187; C'), 'A & B » C', 'cleanText decodes entities');

  console.log('successfactors provider self-test: 10 checks passed');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    selfTest().then((c) => process.exit(c)).catch((e) => { console.error(`successfactors self-test FAILED: ${e.message}`); process.exit(1); });
  }
}
