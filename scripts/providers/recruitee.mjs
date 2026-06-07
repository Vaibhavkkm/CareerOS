// @ts-check
// scripts/providers/recruitee.mjs
// Recruitee provider — public per-tenant offers API.
//   https://<token>.recruitee.com/api/offers/
//
// `entry.api` is the tenant slug (e.g. "exampleco"). `entry.careers_url` is an
// optional fallback we auto-detect the slug from (<slug>.recruitee.com).
//
// Per-tenant subdomains are the variable part — we validate both the derived
// API host and each offer URL against <safe-slug>.recruitee.com.
//
// Contract: default export { id, detect?, async fetch(entry, ctx) } -> Job[]
// where Job = { title, url, company, location }.

const RECRUITEE_HOST_RE = /^[a-z0-9][a-z0-9-]*\.recruitee\.com$/;
// A bare slug must be a valid subdomain label (so the assembled host is valid).
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function tokenFromCareersUrl(careersUrl) {
  if (typeof careersUrl !== 'string' || !careersUrl) return null;
  let parsed;
  try { parsed = new URL(careersUrl); } catch { return null; }
  if (!RECRUITEE_HOST_RE.test(parsed.hostname)) return null;
  return parsed.hostname.split('.')[0];
}

function resolveToken(entry) {
  if (entry && typeof entry.api === 'string') {
    const t = entry.api.trim().toLowerCase();
    if (SLUG_RE.test(t)) return t;
  }
  return tokenFromCareersUrl(entry && entry.careers_url);
}

function apiUrlFor(token) {
  return `https://${token}.recruitee.com/api/offers/`;
}

/**
 * Parse a Recruitee /api/offers/ response into Job[]. Exported for unit tests.
 *
 * Response shape: { offers: [{ title, careers_url?, url?, city?, country?, remote?, location? }] }
 * - url: prefer careers_url, fall back to url; validated against
 *   https://<safe-slug>.recruitee.com — off-domain/non-HTTPS is dropped (empty).
 * - location: prefer explicit location; else assemble city/country, appending
 *   "Remote" when remote is true.
 *
 * @param {any} json
 * @param {string} companyName
 */
export function parseRecruiteeResponse(json, companyName) {
  const offers = json?.offers;
  if (!Array.isArray(offers)) return [];
  return offers.map((j) => {
    const city = j.city || '';
    const country = j.country || '';
    const remote = j.remote ? 'Remote' : '';
    const location = j.location || [city, country, remote].filter(Boolean).join(', ');

    let url = '';
    const rawUrl = j.careers_url || j.url || '';
    if (typeof rawUrl === 'string' && rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:' && RECRUITEE_HOST_RE.test(parsed.hostname)) {
          url = parsed.href;
        }
      } catch {
        // malformed URL -> leave url = ''
      }
    }

    return { title: (j.title || '').trim(), url, company: companyName || '', location };
  });
}

export default {
  id: 'recruitee',

  detect(entry) {
    const token = resolveToken(entry);
    return token ? { url: apiUrlFor(token) } : null;
  },

  async fetch(entry, ctx) {
    const token = resolveToken(entry);
    if (!token) throw new Error(`recruitee: cannot derive tenant slug for ${entry?.name || '(unnamed)'}`);
    const json = await ctx.fetchJson(apiUrlFor(token), { redirect: 'error' });
    return parseRecruiteeResponse(json, entry?.name || '');
  },
};
