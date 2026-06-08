import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { isPublicMode } from '@/lib/gate';
import type { BoardResponse } from '@/lib/types';
import demoBoard from '@/lib/demo/board.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/board?min=Strong&recent=14&urls=u1,u2 — the ranked match board.
export async function GET(request: Request) {
  // Public demo: serve the bundled snapshot (the engine scripts + private data/
  // aren't on a serverless host). Filters are inert here — it's a showcase.
  // `today` advances to the current date so the recency framing stays honest.
  if (isPublicMode()) {
    return NextResponse.json({ ...demoBoard, today: new Date().toISOString().slice(0, 10) });
  }

  const sp = new URL(request.url).searchParams;
  const args = ['--json'];
  const BANDS = new Set(['STRONGEST', 'Very strong', 'Strong', 'Moderate', 'Weak']);
  const min = sp.get('min');
  if (min && BANDS.has(min)) args.push('--min', min);
  const recent = sp.get('recent');
  if (recent && /^\d+$/.test(recent)) args.push('--recent', recent);
  // Reject a leading dash so a crafted value can't be promoted to a flag by
  // board.mjs's own arg parser (execFile gives no shell, but argv flags still re-parse).
  const urls = sp.get('urls');
  if (urls && !urls.startsWith('-')) args.push('--urls', urls);
  // Display filters: country / city / type actually filter the rendered board.
  const country = sp.get('country');
  if (country && !country.startsWith('-')) args.push('--country', country);
  const city = sp.get('city');
  if (city && !city.startsWith('-')) args.push('--city', city);
  const type = sp.get('type');
  if (type && !type.startsWith('-')) args.push('--type', type);
  const limit = sp.get('limit');
  if (limit && /^\d+$/.test(limit)) args.push('--limit', limit);

  const r = await runScript<BoardResponse>('board.mjs', args, { timeoutMs: 90_000 });
  if (!r.ok) {
    const err =
      r.error || (r.data && typeof r.data === 'object' && (r.data as { error?: string }).error) || 'board failed';
    return NextResponse.json({ ok: false, error: err, today: '', count: 0, rows: [] });
  }
  return NextResponse.json(r.data);
}
