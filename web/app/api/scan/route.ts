import { runScript } from '@/lib/run';
import { readJson, fromRun } from '@/lib/http';
import { gateMutation } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/scan {company?, dryRun?} — run the zero-token ATS portal scanner.
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return gate;
  const body = await readJson(request);
  const args = ['--json'];
  if (typeof body.company === 'string' && body.company.trim()) args.push('--company', body.company.trim());
  if (body.dryRun === true) args.push('--dry-run');
  const r = await runScript('scan.mjs', args, { timeoutMs: 90_000 });
  return fromRun(r, 'scan failed (is data/portals.yml set up?)');
}
