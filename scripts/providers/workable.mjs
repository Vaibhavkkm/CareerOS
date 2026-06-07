// @ts-check
// scripts/providers/workable.mjs
// Workable provider — public v3 accounts jobs API.
//   https://apply.workable.com/api/v3/accounts/<token>/jobs
//
// `entry.api` is the account subdomain/slug (e.g. "exampleco"). `entry.careers_url`
// is an optional fallback we auto-detect the slug from (apply.workable.com/<slug>).
//
// The v3 endpoint is a POST that returns { results: [...], nextPage|paging }.
// We page until exhausted (with a safety cap) and tolerate field variation.
//
// Contract: default export { id, detect?, async fetch(entry, ctx) } -> Job[]
// where Job = { title, url, company, location }.

const API_HOST = 'apply.workable.com';
const PAGE_LIMIT = 100;
const MAX_PAGES = 50; // safety cap (5000 postings @ 100/page)

function tokenFromCareersUrl(careersUrl) {
  if (typeof careersUrl !== 'string' || !careersUrl) return null;
  let parsed;
  try { parsed = new URL(careersUrl); } catch { return null; }
  if (parsed.hostname !== API_HOST) return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0];
  return slug || null;
}

function resolveToken(entry) {
  if (entry && typeof entry.api === 'string' && entry.api.trim()) return entry.api.trim();
  return tokenFromCareersUrl(entry && entry.careers_url);
}

function apiUrlFor(token) {
  return `https://${API_HOST}/api/v3/accounts/${encodeURIComponent(token)}/jobs`;
}

// Build a public posting URL from a job record + account slug.
function jobUrl(j, token) {
  if (typeof j?.url === 'string' && j.url) return j.url;
  if (typeof j?.application_url === 'string' && j.application_url) return j.application_url;
  if (typeof j?.shortcode === 'string' && j.shortcode) {
    return `https://${API_HOST}/${encodeURIComponent(token)}/j/${j.shortcode}/`;
  }
  return '';
}

function jobLocation(j) {
  const loc = j?.location || {};
  if (typeof loc === 'string') return loc;
  const parts = [loc.city, loc.region, loc.country].filter(Boolean);
  const base = parts.join(', ');
  const remote = loc.workplace_type === 'remote' || j?.remote ? 'Remote' : '';
  return [base, remote].filter(Boolean).join(', ');
}

/**
 * Parse one v3 jobs page payload into Job[]. Exported for unit tests.
 * @param {any} json
 * @param {string} companyName
 * @param {string} token
 */
export function parseWorkableJobs(json, companyName, token) {
  const items = Array.isArray(json?.results) ? json.results
    : Array.isArray(json?.jobs) ? json.jobs
    : [];
  return items.map((j) => ({
    title: (j.title || j.full_title || '').trim(),
    url: jobUrl(j, token),
    company: companyName || '',
    location: jobLocation(j),
  }));
}

export default {
  id: 'workable',

  detect(entry) {
    const token = resolveToken(entry);
    return token ? { url: apiUrlFor(token) } : null;
  },

  async fetch(entry, ctx) {
    const token = resolveToken(entry);
    if (!token) throw new Error(`workable: cannot derive account slug for ${entry?.name || '(unnamed)'}`);
    const url = apiUrlFor(token);

    const all = [];
    let nextToken = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = JSON.stringify(nextToken ? { limit: PAGE_LIMIT, token: nextToken } : { limit: PAGE_LIMIT });
      const json = await ctx.fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        redirect: 'error',
      });
      const parsed = parseWorkableJobs(json, entry?.name || '', token);
      all.push(...parsed);
      // Workable cursor pagination exposes the next-page token a few ways.
      nextToken = json?.nextPage || json?.paging?.next || json?.next || null;
      if (!nextToken || parsed.length === 0) break;
    }
    return all;
  },
};
