// @ts-check
// scripts/providers/lih.mjs
// Luxembourg Institute of Health (LIH) — custom, self-hosted careers board.
//
// LIH has no Greenhouse/Lever/Ashby/etc. API: its open roles are server-rendered
// into https://www.lih.lu/en/jobs/ as a WordPress "ia-block-jobs" list —
//   <a class="ia-block-jobs__title" href="https://www.lih.lu/en/job/?value=CODE">Title</a>
// The whole list lives in the static HTML (the page-number widget only toggles
// client-side visibility), so we fetch the page ONCE and parse the anchors — no
// headless browser, no pagination loop, zero extra deps.
//
// This is the repo's first HTML-scraping provider; it shows the pattern for any
// custom career page with no public ATS endpoint. `entry.careers_url` (or an
// http(s) `entry.api`) overrides the listing URL; otherwise the canonical LIH jobs
// page is used. Wire it on a portals entry as:
//   { name: "Luxembourg Institute of Health", provider: lih, enabled: true }
//
// Contract: default export { id, detect?, async fetch(entry, ctx) } -> Job[]
// where Job = { title, url, company, location }.

import { pathToFileURL } from 'node:url';

const DEFAULT_LISTING_URL = 'https://www.lih.lu/en/jobs/';
const DEFAULT_COMPANY = 'Luxembourg Institute of Health';
const LOCATION = 'Luxembourg';

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function safeCodePoint(n) {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

// Strip tags + decode the handful of HTML entities LIH emits. Pure; exported for tests.
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

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

// The explicit listing URL on an entry (careers_url or an http(s) api), else null.
function explicitListingUrl(entry) {
  if (!entry) return null;
  if (typeof entry.careers_url === 'string' && /^https?:\/\//i.test(entry.careers_url)) return entry.careers_url.trim();
  if (typeof entry.api === 'string' && /^https?:\/\//i.test(entry.api)) return entry.api.trim();
  return null;
}

function listingUrl(entry) {
  return explicitListingUrl(entry) || DEFAULT_LISTING_URL;
}

// Pure: parse the LIH listing HTML into Job[]. Exported for the self-test.
export function parseJobs(html, { baseUrl = DEFAULT_LISTING_URL, company = DEFAULT_COMPANY } = {}) {
  const out = [];
  const seen = new Set();
  // Match every anchor, then filter by class — robust to attribute order.
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const attrs = m[1];
    if (!/\bclass="[^"]*\bia-block-jobs__title\b[^"]*"/i.test(attrs)) continue;
    const hrefMatch = attrs.match(/\bhref="([^"]+)"/i);
    const title = cleanText(m[2]);
    if (!hrefMatch || !title) continue;
    let url;
    try { url = new URL(hrefMatch[1].trim(), baseUrl).toString(); } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url, company, location: LOCATION });
  }
  return out;
}

const provider = {
  id: 'lih',

  // Auto-claim only entries that EXPLICITLY point at lih.lu — never via the default
  // fallback (that would swallow any URL-less entry). An explicit `provider: lih`
  // bypasses detect() entirely in scan.mjs.
  detect(entry) {
    const explicit = explicitListingUrl(entry);
    if (!explicit) return null;
    return /(^|\.)lih\.lu$/i.test(hostOf(explicit)) ? { url: explicit } : null;
  },

  async fetch(entry, ctx) {
    const url = listingUrl(entry);
    const html = await ctx.fetchText(url, { redirect: 'follow', maxRedirects: 3 });
    return parseJobs(html, { baseUrl: url, company: (entry && entry.name) || DEFAULT_COMPANY });
  },
};

export default provider;

// ─── self-test ────────────────────────────────────────────────────────
// `node scripts/providers/lih.mjs --self-test` — offline, deterministic.
export async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  // Fixture mirrors the real ia-block-jobs markup: entities, a slash-laden ?value=
  // code, a non-job anchor to ignore, and a relative href with class in any position.
  const FIXTURE = `
    <ul class="ia-block-jobs__list">
      <li class="ia-block-jobs__list-item is-visible" data-type="">
        <a class="ia-block-jobs__title" href="https://www.lih.lu/en/job/?value=AL">Master&#8217;s Student in Leukemia Research (AL)</a><br>
        <span class="ia-block-jobs__dpt">Department of Cancer Research &#8211; Tumor Stroma</span>
      </li>
      <li class="ia-block-jobs__list-item is-visible" data-type="">
        <a class="ia-block-jobs__title" href="https://www.lih.lu/en/job/?value=JA/DS0326/PN/DMIDII">Data Scientist in AI &#038; Immunity (JA/DS0326/PN/DMIDII)</a>
      </li>
      <li><a class="some-other-link" href="https://www.lih.lu/en/contact/">Contact</a></li>
      <li class="ia-block-jobs__list-item" data-type="">
        <a href="/en/job/?value=REL" class="x ia-block-jobs__title y">Relative-href Role (REL)</a>
      </li>
    </ul>`;
  const jobs = parseJobs(FIXTURE);
  assert.equal(jobs.length, 3, 'parses exactly the 3 job-title anchors (ignores the contact link)');
  assert.equal(jobs[0].title, 'Master’s Student in Leukemia Research (AL)', 'decodes &#8217; and trims');
  assert.equal(jobs[0].url, 'https://www.lih.lu/en/job/?value=AL');
  assert.equal(jobs[0].company, 'Luxembourg Institute of Health');
  assert.equal(jobs[0].location, 'Luxembourg');
  assert.equal(jobs[1].title, 'Data Scientist in AI & Immunity (JA/DS0326/PN/DMIDII)', 'decodes &#038; to &');
  assert.equal(jobs[1].url, 'https://www.lih.lu/en/job/?value=JA/DS0326/PN/DMIDII', 'keeps slashes in the ?value= query');
  assert.equal(jobs[2].url, 'https://www.lih.lu/en/job/?value=REL', 'resolves a relative href + matches class in any position');

  // company + listing-URL override
  const j2 = parseJobs('<a class="ia-block-jobs__title" href="/en/job/?value=X">Role X</a>', { baseUrl: 'https://www.lih.lu/fr/emplois/', company: 'LIH' });
  assert.equal(j2[0].company, 'LIH');
  assert.equal(j2[0].url, 'https://www.lih.lu/en/job/?value=X');

  // cleanText edge cases
  assert.equal(cleanText('A &amp; B &#187;  C'), 'A & B » C');
  assert.equal(cleanText('<b>x</b>  y'), 'x y');

  // detect(): only claims explicit lih.lu URLs, never the default fallback
  assert.deepEqual(provider.detect({ careers_url: 'https://www.lih.lu/en/jobs/' }), { url: 'https://www.lih.lu/en/jobs/' });
  assert.equal(provider.detect({ api: 'anthropic' }), null, 'does not swallow a bare-token entry');
  assert.equal(provider.detect({}), null, 'no explicit lih.lu URL → no claim');
  assert.equal(provider.detect({ careers_url: 'https://boards.greenhouse.io/acme' }), null, 'other hosts not claimed');

  console.log('lih provider self-test: 16 checks passed');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    selfTest().then((c) => process.exit(c)).catch((e) => { console.error(`lih self-test FAILED: ${e.message}`); process.exit(1); });
  }
}
