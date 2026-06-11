import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { readJson, fromRun, bad } from '@/lib/http';
import { gateMutation } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/fetch-jd {url} — scrape one posting into data/jds/ (zero tokens).
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;
  const body = await readJson(request);
  const raw = typeof body.url === 'string' ? body.url.trim() : '';
  // Take only the first URL token: pasted text may carry trailing junk (quotes,
  // a dragged-in file path) that would otherwise be stored as part of the posting URL.
  const url = (raw.match(/^https?:\/\/[^\s'"<>]+/i) || [''])[0];
  if (!url) return bad('a valid http(s) url is required');
  const r = await runScript('fetch-jd.mjs', [url, '--json'], { timeoutMs: 60_000 });
  if (!r.ok) {
    // Surface `needs_agent_fetch` so the UI can hand the URL to the agent queue —
    // bot-protected (e.g. Cloudflare) and JS-rendered postings can't be scraped by
    // plain HTTP, but the agent's own fetch tools usually can.
    const d = (r.data && typeof r.data === 'object' ? r.data : {}) as { needs_agent_fetch?: boolean; error?: string };
    return NextResponse.json({
      ok: false,
      error: r.error || d.error || 'could not fetch posting',
      needs_agent_fetch: !!d.needs_agent_fetch,
      url,
    });
  }
  return fromRun(r, 'could not fetch posting (it may be JS-rendered — let the agent WebFetch it)');
}
