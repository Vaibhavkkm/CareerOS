import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from '@/lib/repo';
import { isPublicMode } from '@/lib/gate';
import { bad, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIG_FILE = () => join(repoRoot(), '.careeros.config.json');

const DEFAULTS = {
  provider: 'claude-cli',
  model: '',
  endpoint: '',
  apiKey: '',
  pollIntervalMs: 15000,
};

// GET /api/config — return current daemon config (apiKey masked)
export async function GET() {
  const path = CONFIG_FILE();
  if (!existsSync(path)) return NextResponse.json({ ok: true, config: DEFAULTS, exists: false });
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    // Mask key: show last 4 chars only
    const masked = raw.apiKey ? `${'•'.repeat(Math.max(0, raw.apiKey.length - 4))}${raw.apiKey.slice(-4)}` : '';
    return NextResponse.json({
      ok: true,
      exists: true,
      config: { ...DEFAULTS, ...raw, apiKey: masked, _apiKeySet: !!raw.apiKey },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not read config' }, { status: 500 });
  }
}

// POST /api/config { provider, model, endpoint, apiKey, pollIntervalMs }
// apiKey === '__keep__' means don't overwrite existing key
export async function POST(request: Request) {
  if (isPublicMode()) return NextResponse.json({ ok: false, error: 'read-only demo' }, { status: 403 });

  const body = await readJson(request);
  const provider = String(body.provider ?? '');
  const model = String(body.model ?? '');
  const endpoint = String(body.endpoint ?? '');
  const apiKey = String(body.apiKey ?? '');
  const pollIntervalMs = typeof body.pollIntervalMs === 'number' ? body.pollIntervalMs : 15000;

  if (!['claude-cli', 'ollama', 'openai-compat'].includes(provider)) {
    return bad('provider must be claude-cli, ollama, or openai-compat');
  }

  // Read existing to preserve apiKey if user didn't change it
  const path = CONFIG_FILE();
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  }

  const existingKey = typeof existing.apiKey === 'string' ? existing.apiKey : null;
  const finalKey = apiKey === '__keep__' ? existingKey : (apiKey || null);

  const cfg = {
    provider,
    model: model || null,
    endpoint: endpoint || null,
    apiKey: finalKey,
    pollIntervalMs,
  };

  await writeFile(path, JSON.stringify(cfg, null, 2), 'utf8');
  return NextResponse.json({ ok: true });
}
