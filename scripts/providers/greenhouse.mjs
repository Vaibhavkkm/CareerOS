// @ts-check
// scripts/providers/greenhouse.mjs
// Greenhouse provider — public Boards API JSON endpoint.
//   https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true
//
// `entry.api` is the board token (e.g. "anthropic"). `entry.careers_url` is an
// optional fallback we can auto-detect the token from.
//
// Contract: default export { id, detect?, async fetch(entry, ctx) } -> Job[]
// where Job = { title, url, company, location }.

const API_HOST = 'boards-api.greenhouse.io';

// Pull a board token out of a careers_url like:
//   https://boards.greenhouse.io/<token>
//   https://job-boards.greenhouse.io/<token>
//   https://job-boards.eu.greenhouse.io/<token>
function tokenFromCareersUrl(careersUrl) {
  if (typeof careersUrl !== 'string' || !careersUrl) return null;
  const m = careersUrl.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function resolveToken(entry) {
  if (entry && typeof entry.api === 'string' && entry.api.trim()) return entry.api.trim();
  return tokenFromCareersUrl(entry && entry.careers_url);
}

function apiUrlFor(token) {
  return `https://${API_HOST}/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
}

export default {
  id: 'greenhouse',

  detect(entry) {
    const token = resolveToken(entry);
    return token ? { url: apiUrlFor(token) } : null;
  },

  async fetch(entry, ctx) {
    const token = resolveToken(entry);
    if (!token) throw new Error(`greenhouse: cannot derive board token for ${entry?.name || '(unnamed)'}`);
    const json = await ctx.fetchJson(apiUrlFor(token), { redirect: 'error' });
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs
      .filter((j) => j && j.absolute_url)
      .map((j) => ({
        title: (j.title || '').trim(),
        url: j.absolute_url,
        company: entry?.name || '',
        location: j.location?.name || '',
      }));
  },
};
