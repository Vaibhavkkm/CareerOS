// @ts-check
// scripts/providers/lever.mjs
// Lever provider — public postings endpoint (JSON mode).
//   https://api.lever.co/v0/postings/<token>?mode=json
//
// `entry.api` is the Lever account slug (e.g. "leverdemo"). `entry.careers_url`
// is an optional fallback we auto-detect the slug from (jobs.lever.co/<slug>).
//
// Contract: default export { id, detect?, async fetch(entry, ctx) } -> Job[]
// where Job = { title, url, company, location }.

const API_HOST = 'api.lever.co';

function tokenFromCareersUrl(careersUrl) {
  if (typeof careersUrl !== 'string' || !careersUrl) return null;
  const m = careersUrl.match(/jobs\.lever\.co\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function resolveToken(entry) {
  if (entry && typeof entry.api === 'string' && entry.api.trim()) return entry.api.trim();
  return tokenFromCareersUrl(entry && entry.careers_url);
}

function apiUrlFor(token) {
  return `https://${API_HOST}/v0/postings/${encodeURIComponent(token)}?mode=json`;
}

export default {
  id: 'lever',

  detect(entry) {
    const token = resolveToken(entry);
    return token ? { url: apiUrlFor(token) } : null;
  },

  async fetch(entry, ctx) {
    const token = resolveToken(entry);
    if (!token) throw new Error(`lever: cannot derive account slug for ${entry?.name || '(unnamed)'}`);
    const json = await ctx.fetchJson(apiUrlFor(token), { redirect: 'error' });
    if (!Array.isArray(json)) return [];
    return json.map((j) => ({
      title: (j.text || '').trim(),
      url: j.hostedUrl || j.applyUrl || '',
      company: entry?.name || '',
      location: j.categories?.location || j.workplaceType || '',
    }));
  },
};
