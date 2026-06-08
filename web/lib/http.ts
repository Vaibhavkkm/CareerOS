import { NextResponse } from 'next/server';
import type { RunResult } from './run';

// Best-effort JSON body parse — a malformed body yields {} rather than a 500.
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Turn a RunResult into a uniform JSON response. Engine-level failures come back
// as HTTP 200 with `{ok:false,error}` so the UI can surface them inline; only a
// genuine bridge crash should be a 5xx.
export function fromRun(r: RunResult, fallbackError = 'engine error', status = 200) {
  if (r.ok) return NextResponse.json(r.data);
  const dataErr =
    r.data && typeof r.data === 'object' && 'error' in r.data
      ? (r.data as { error?: string }).error
      : undefined;
  return NextResponse.json({ ok: false, error: r.error || dataErr || fallbackError }, { status });
}

export function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
