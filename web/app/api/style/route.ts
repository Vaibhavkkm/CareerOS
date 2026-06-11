import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '@/lib/repo';
import { isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/style — the learned style profile, read-only. The path is FIXED
// server-side (never client input), so this deliberately bypasses the
// safeDataPath whitelist rather than widening it. Writes NEVER happen here:
// rule accept/retire goes through the queue (kind "style") and is applied by
// the agent via `style-profile.mjs set-status` (see modes/ui.md).
export async function GET() {
  // Public demo: the learned profile is the owner's data — serve an empty one.
  if (isPublicMode()) return NextResponse.json({ ok: true, rules: [], edits_seen: 0 });

  const file = join(repoRoot(), 'data', 'style', 'profile.json');
  if (!existsSync(file)) {
    return NextResponse.json({ ok: true, rules: [], edits_seen: 0, missing: true });
  }
  try {
    const profile = JSON.parse(readFileSync(file, 'utf8'));
    return NextResponse.json({
      ok: true,
      rules: Array.isArray(profile.rules) ? profile.rules : [],
      edits_seen: profile.edits_seen ?? 0,
      updated: profile.updated ?? null,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'could not parse data/style/profile.json' }, { status: 500 });
  }
}
