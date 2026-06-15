import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { readJson } from '@/lib/http';
import { gateMutation } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CORS: the bookmarklet / extension POSTs here from a THIRD-PARTY job page
// (linkedin.com, greenhouse.io, …), so this receive endpoint must allow any
// origin. That is safe because the server only ever binds 127.0.0.1 (never the
// network) and the only effect is appending the user's OWN job link to their OWN
// inbox via the engine — no secrets are returned. Every other route stays
// same-origin; this is the one deliberate cross-origin entry point.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

// POST /api/inbox { url, title?, company?, description? }
// "Send this job to CareerOS": capture the current job page from a bookmarklet or
// the browser extension and drop it onto the board. The write goes through the
// engine (`hunt-ingest.mjs`), which dedups it against everything `scan`/`hunt`/
// `fetch-recent` already saw and writes the JD + inbox entry — so the web app never
// touches `data/` directly (DATA_CONTRACT guardrail). It NEVER applies or marks
// anything; it only queues the posting for the user to review and tailor.
export async function POST(request: Request) {
  const gate = gateMutation();
  if (gate) return cors(gate);

  const body = await readJson(request);
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  const url = str('url');

  // Only accept a real http(s) job URL — never a javascript:/data: or empty value.
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return cors(NextResponse.json({ ok: false, error: 'a valid http(s) job url is required' }, { status: 400 }));
  }

  const posting = {
    title: str('title') || 'Saved job',
    company: str('company'),
    url,
    description: str('description').slice(0, 8000),
    source: 'bookmarklet',
  };

  // Pass the posting to hunt-ingest over stdin as a JSON array (argv is never a
  // shell, stdin carries the data → no injection surface). hunt-ingest dedups +
  // saves and prints a JSON envelope with the counts.
  const r = await runScript('hunt-ingest.mjs', ['--json', '--source', 'bookmarklet'], {
    input: JSON.stringify([posting]),
    timeoutMs: 30_000,
  });

  if (!r.ok) {
    const dataErr = r.data && typeof r.data === 'object' && 'error' in r.data ? (r.data as { error?: string }).error : undefined;
    return cors(NextResponse.json({ ok: false, error: r.error || dataErr || 'could not save the job' }, { status: 200 }));
  }
  // Surface a friendly added/duplicate hint to the extension popup.
  const data = (r.data ?? {}) as { counts?: { added?: number; dup?: number } };
  const added = data.counts?.added ?? 0;
  const dup = data.counts?.dup ?? 0;
  return cors(NextResponse.json({
    ok: true,
    saved: added > 0,
    duplicate: added === 0 && dup > 0,
    message: added > 0 ? 'Saved to your CareerOS board.' : dup > 0 ? 'Already on your board.' : 'Received.',
    ...data,
  }));
}
