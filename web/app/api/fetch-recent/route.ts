import { runScript } from '@/lib/run';
import { readJson, fromRun } from '@/lib/http';
import { gateMutation } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/fetch-recent {country?, countries?, city?, search?, boards?, recent?, remote?}
// — zero-token, zero-MCP multi-board fetch (Indeed / ZipRecruiter / Google Jobs)
// via the python-jobspy sidecar (scripts/jobspy.mjs), ingested straight into the
// board through the same dedup engine as `scan` and `hunt`. Fully synchronous:
// no LLM, no agent, no queue — the button gets live results in one round-trip.
// Pass `countries: string[]` to sweep them all in ONE request: the engine fetches
// them with bounded concurrency and dedups + persists in a single ingest (no ledger
// race, so the page no longer loops one country per round-trip). City is ignored for
// a sweep (whole-country by definition).
// Values are passed as argv (execFile, never a shell), so a leading '-' in a
// user string is treated as a flag VALUE, not a new flag — no injection.
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;
  const body = await readJson(request);
  const args = ['--json'];

  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  const countries = Array.isArray(body.countries)
    ? (body.countries as unknown[]).map((c) => String(c ?? '').trim()).filter(Boolean)
    : [];
  const sweep = countries.length > 0;

  if (sweep) {
    args.push('--countries', countries.join(','));
    args.push('--concurrency', '3');
  } else {
    if (str('country')) args.push('--country', str('country'));
    if (str('city')) args.push('--city', str('city'));
  }
  if (str('search')) args.push('--search', str('search'));
  if (str('boards')) args.push('--boards', str('boards'));
  if (str('jobType')) args.push('--job-type', str('jobType'));
  if (body.remote === true) args.push('--remote');

  const recent = Number(body.recent);
  if (Number.isFinite(recent) && recent > 0) args.push('--recent', String(Math.floor(recent)));

  // Scraping three boards can take a while; a whole-country sweep multiplies that by
  // the country count (throttled to `concurrency` at a time), so give the sweep a
  // much larger ceiling than a single fetch.
  const timeoutMs = sweep ? 900_000 : 180_000;
  const r = await runScript('jobspy.mjs', args, { timeoutMs });
  return fromRun(r, 'fetch failed — is python-jobspy installed? run `npm run jobspy:install`');
}
