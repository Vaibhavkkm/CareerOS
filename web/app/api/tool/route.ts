import { NextResponse } from 'next/server';
import { runScript } from '@/lib/run';
import { readJson, fromRun, bad } from '@/lib/http';
import { isPublicMode } from '@/lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The zero-token analysis tools the browser can run DIRECTLY — they need no LLM, so
// there's no reason to bounce them through the agent. Each maps a friendly name to
// an allow-listed engine script (run.ts also guards the script set). Read-only:
// they read data/ files and print a JSON envelope; they never mutate user data, so
// no mutation gate is needed (only the public-demo engine backstop in runScript).
const TOOLS: Record<string, string> = {
  gaps: 'gaps.mjs',
  salary: 'salary.mjs',
  'cv-lint': 'cv-lint.mjs',
};

// POST /api/tool { tool: 'gaps' | 'salary' | 'cv-lint' }
export async function POST(request: Request) {
  if (isPublicMode()) return NextResponse.json({ ok: false, error: 'tools run on your local instance — fork the repo to use them' }, { status: 403 });
  const body = await readJson(request);
  const tool = typeof body.tool === 'string' ? body.tool : '';
  const script = TOOLS[tool];
  if (!script) return bad(`unknown tool "${tool}" — one of ${Object.keys(TOOLS).join(', ')}`);
  const r = await runScript(script, ['--json'], { timeoutMs: 30_000 });
  return fromRun(r, `${tool} failed`);
}
