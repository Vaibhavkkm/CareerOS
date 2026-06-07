// @ts-check
// scripts/providers/ashby.mjs
// Ashby provider — public posting-api job board endpoint.
//   https://api.ashbyhq.com/posting-api/job-board/<token>
//
// `entry.api` is the job-board token/slug (e.g. "exampleco"). `entry.careers_url`
// is an optional fallback we auto-detect the token from (jobs.ashbyhq.com/<slug>).
//
// Ashby's public posting-api carries a high server-side latency floor and
// rate-limits repeated unauthenticated hits, so we use a longer timeout plus a
// backoff+jitter retry.
//
// Contract: default export { id, detect?, async fetch(entry, ctx) } -> Job[]
// where Job = { title, url, company, location }.

const API_HOST = 'api.ashbyhq.com';
const ASHBY_TIMEOUT_MS = 30_000;
const ASHBY_RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tokenFromCareersUrl(careersUrl) {
  if (typeof careersUrl !== 'string' || !careersUrl) return null;
  const m = careersUrl.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function resolveToken(entry) {
  if (entry && typeof entry.api === 'string' && entry.api.trim()) return entry.api.trim();
  return tokenFromCareersUrl(entry && entry.careers_url);
}

function apiUrlFor(token) {
  return `https://${API_HOST}/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
}

export default {
  id: 'ashby',

  detect(entry) {
    const token = resolveToken(entry);
    return token ? { url: apiUrlFor(token) } : null;
  },

  async fetch(entry, ctx) {
    const token = resolveToken(entry);
    if (!token) throw new Error(`ashby: cannot derive job-board token for ${entry?.name || '(unnamed)'}`);
    const url = apiUrlFor(token);

    let lastErr;
    for (let attempt = 0; attempt <= ASHBY_RETRIES; attempt++) {
      if (attempt > 0) {
        // exponential backoff + jitter — spaces out retries to dodge rate-limiting
        const backoff = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
        await sleep(backoff);
      }
      try {
        const json = await ctx.fetchJson(url, { timeoutMs: ASHBY_TIMEOUT_MS, redirect: 'error' });
        const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
        return jobs.map((j) => ({
          title: (j.title || '').trim(),
          url: j.jobUrl || j.applyUrl || '',
          company: entry?.name || j.organizationName || '',
          location: j.location || j.locationName || '',
        }));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },
};
