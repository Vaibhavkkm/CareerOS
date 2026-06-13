import { NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '@/lib/repo';
import { isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/onboard/status — is the user set up?
export async function GET() {
  if (isPublicMode()) return NextResponse.json({ ok: true, hasProfile: false, hasMaster: false, pendingBatches: [] });

  const root = repoRoot();
  const profilePath = join(root, 'data', 'profile.yml');
  const masterPath = join(root, 'data', 'cv.master.md');
  const sourcesDir = join(root, 'data', 'cv-sources');

  const hasProfile = existsSync(profilePath) && readFileSync(profilePath, 'utf8').trim().length > 20;
  const hasMaster = existsSync(masterPath) && readFileSync(masterPath, 'utf8').trim().length > 50;

  // Pending parsed batches (daemon parsed but wizard hasn't confirmed yet)
  const pendingBatches: string[] = [];
  if (existsSync(sourcesDir)) {
    readdirSync(sourcesDir)
      .filter((f) => f.endsWith('-parsed.json'))
      .forEach((f) => pendingBatches.push(f.replace('-parsed.json', '')));
  }

  return NextResponse.json({ ok: true, hasProfile, hasMaster, pendingBatches });
}
