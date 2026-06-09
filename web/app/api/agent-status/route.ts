import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '@/lib/repo';
import { isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// How fresh the heartbeat must be to count the agent as "watching". The watch-mode
// agent writes data/ui/agent.json each poll (~15–30s, see modes/ui.md); allow a
// generous window so a slightly slow poll doesn't flicker the status to offline.
const FRESH_MS = 90_000;

// GET /api/agent-status — is a `/cos ui watch` agent live right now?
// The website uses this to tell the user whether clicking an action will run
// AUTOMATICALLY in their terminal (watching) or just queue for a manual /cos ui.
// No API key, no LLM — it just reflects the agent's heartbeat file.
export async function GET() {
  if (isPublicMode()) return NextResponse.json({ ok: true, watching: false, public: true });
  try {
    const raw = await readFile(path.join(repoRoot(), 'data', 'ui', 'agent.json'), 'utf8');
    const hb = JSON.parse(raw) as { ts?: string; mode?: string };
    const ts = hb.ts ? Date.parse(hb.ts) : NaN;
    const ageMs = Number.isFinite(ts) ? Date.now() - ts : Infinity;
    return NextResponse.json({ ok: true, watching: ageMs >= 0 && ageMs < FRESH_MS, mode: hb.mode || null, ts: hb.ts || null, ageMs: Number.isFinite(ageMs) ? ageMs : null });
  } catch {
    // No heartbeat file → the agent isn't in watch mode (or never ran).
    return NextResponse.json({ ok: true, watching: false });
  }
}
