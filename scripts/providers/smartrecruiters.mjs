// @ts-check
// scripts/providers/smartrecruiters.mjs
// SmartRecruiters provider — public postings API.
//   https://api.smartrecruiters.com/v1/companies/<token>/postings
//
// `entry.api` is the company identifier (e.g. "exampleco"). `entry.careers_url`
// is an optional fallback we auto-detect the slug from
// ((careers|jobs).smartrecruiters.com/<slug>).
//
// The postings API paginates with limit/offset; we page until exhausted (cap).
//
// Contract: default export { id, detect?, async fetch(entry, ctx) } -> Job[]
// where Job = { title, url, company, location }.

const API_HOST = 'api.smartrecruiters.com';
const CAREERS_HOSTS = new Set(['careers.smartrecruiters.com', 'jobs.smartrecruiters.com']);
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // safety cap (5000 postings @ 100/page)

function tokenFromCareersUrl(careersUrl) {
  if (typeof careersUrl !== 'string' || !careersUrl) return null;
  let parsed;
  try { parsed = new URL(careersUrl); } catch { return null; }
  if (!CAREERS_HOSTS.has(parsed.hostname)) return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0];
  return slug || null;
}

function resolveToken(entry) {
  if (entry && typeof entry.api === 'string' && entry.api.trim()) return entry.api.trim();
  return tokenFromCareersUrl(entry && entry.careers_url);
}

function apiUrlFor(token, offset = 0) {
  return `https://${API_HOST}/v1/companies/${encodeURIComponent(token)}/postings?limit=${PAGE_SIZE}&offset=${offset}&status=PUBLIC`;
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Parse a SmartRecruiters /postings page into Job[]. Exported for unit tests.
 *
 * Response shape: { content: [{ id, name, ref, location: {...} }] }
 * - location: prefer fullLocation; else assemble city/region/country; append
 *   "Remote" when location.remote is true.
 * - url: rewrite the api `ref` to the public jobs.smartrecruiters.com URL; else
 *   synthesise from company slug + posting id.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} token
 */
export function parseSmartRecruitersResponse(json, companyName, token) {
  const items = json?.content;
  if (!Array.isArray(items)) return [];
  return items.map((j) => {
    const loc = j.location || {};
    const fullLocation = loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
    const remote = loc.remote ? 'Remote' : '';
    const location = [fullLocation, remote].filter(Boolean).join(', ');

    let url = '';
    if (typeof j.ref === 'string') {
      let parsedRef;
      try { parsedRef = new URL(j.ref); } catch { parsedRef = null; }
      if (parsedRef
          && parsedRef.protocol === 'https:'
          && parsedRef.hostname === API_HOST
          && parsedRef.pathname.startsWith('/v1/companies/')) {
        const restOfPath = parsedRef.pathname.slice('/v1/companies/'.length);
        url = `https://jobs.smartrecruiters.com/${restOfPath}`;
      }
    }
    if (!url && j.id) {
      const companySlug = slugify(token) || slugify(companyName);
      if (companySlug) {
        url = `https://jobs.smartrecruiters.com/${companySlug}/${j.id}-${slugify(j.name)}`;
      }
    }

    return { title: (j.name || '').trim(), url, company: companyName || '', location };
  });
}

export default {
  id: 'smartrecruiters',

  detect(entry) {
    const token = resolveToken(entry);
    return token ? { url: apiUrlFor(token, 0) } : null;
  },

  async fetch(entry, ctx) {
    const token = resolveToken(entry);
    if (!token) throw new Error(`smartrecruiters: cannot derive company id for ${entry?.name || '(unnamed)'}`);

    const all = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const json = await ctx.fetchJson(apiUrlFor(token, page * PAGE_SIZE), { redirect: 'error' });
      const parsed = parseSmartRecruitersResponse(json, entry?.name || '', token);
      if (parsed.length === 0) break;
      all.push(...parsed);
      if (parsed.length < PAGE_SIZE) break; // short last page
    }
    return all;
  },
};
