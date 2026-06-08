import type { Band } from '@/lib/types';
import { openForkGate } from '@/lib/public';

// Thin JSON fetch helper. Always no-store (live data), always JSON in/out. The
// WHOLE call is guarded: a network failure (server restarting, connection
// refused) resolves to a structured {ok:false} so callers' error branches run and
// the UI never gets stuck in a "working" state on an unhandled rejection.
// A server route that ran in demo mode replies 403 {gated:true} — we open the
// fork-gate so the gate works even on pages whose buttons aren't proactively wired.
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    try {
      const parsed = (await res.json()) as T;
      if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).gated) {
        openForkGate({ error: String((parsed as Record<string, unknown>).error || '') });
      }
      return parsed;
    } catch {
      return { ok: false, error: `bad response (${res.status})` } as unknown as T;
    }
  } catch {
    return { ok: false, error: 'network error — is the server running?' } as unknown as T;
  }
}

export const STARS: Record<Band, string> = {
  STRONGEST: '★★★★',
  'Very strong': '★★★',
  Strong: '★★',
  Moderate: '★',
  Weak: '·',
};

const BAND_CLASS: Record<string, string> = {
  STRONGEST: 'band-strongest',
  'Very strong': 'band-very',
  Strong: 'band-strong',
  Moderate: 'band-moderate',
  Weak: 'band-weak',
};
export function bandClass(band: string): string {
  return BAND_CLASS[band] || 'band-weak';
}

// Mirror of scripts/board.mjs ageDays/ageLabel so the UI labels match the CLI.
export function ageDays(posted: string, today: string): number | null {
  if (!posted) return null;
  const p = Date.parse(posted);
  const t = Date.parse(today);
  if (Number.isNaN(p) || Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((t - p) / 86_400_000));
}
export function ageLabel(posted: string, today: string): string {
  const d = ageDays(posted, today);
  if (d == null) return 'date n/a';
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function scoreStr(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}
