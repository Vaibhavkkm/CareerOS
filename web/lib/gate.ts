import { NextResponse } from 'next/server';
import { REPO_URL } from './public';

// Server-side enforcement of demo mode. Computed independently from process.env at
// REQUEST time (not the build-inlined NEXT_PUBLIC_ client value) so the guard holds
// even if the public flag was only set at runtime. Accepts either env name.
function isPublic(): boolean {
  return process.env.CAREEROS_PUBLIC === '1' || process.env.NEXT_PUBLIC_CAREEROS_PUBLIC === '1';
}

const GATE_MESSAGE =
  'This is a public CareerOS demo — generating, fetching and scanning run in YOUR own Claude Code, not here. ' +
  'Fork the repo and run it locally to use it for real.';

// Call at the top of every MUTATING route. Returns a 403 response to short-circuit
// when in demo mode, or null to proceed normally on the owner's local instance.
export function gateMutation(): NextResponse | null {
  if (!isPublic()) return null;
  return NextResponse.json(
    { ok: false, gated: true, error: GATE_MESSAGE, repo: REPO_URL },
    { status: 403 },
  );
}
