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
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return bad('a valid http(s) url is required');
  const r = await runScript('fetch-jd.mjs', [url, '--json'], { timeoutMs: 60_000 });
  return fromRun(r, 'could not fetch posting (it may be JS-rendered — let the agent WebFetch it)');
}
