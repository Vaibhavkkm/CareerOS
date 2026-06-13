import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { repoRoot } from '@/lib/repo';
import { isPublicMode } from '@/lib/gate';
import { bad, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/onboard/extract { text: string }
// Use the configured LLM to extract structured profile fields from parsed CV text.
// Falls back to regex heuristics when no LLM is configured or the call fails.
export async function POST(request: Request) {
  if (isPublicMode()) return NextResponse.json({ ok: false, error: 'runs on your local instance' }, { status: 403 });

  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return bad('text is required');

  const config = loadDaemonConfig();

  let extracted: ExtractedProfile | null = null;

  if (config) {
    try {
      const raw = await callLLM(text, config);
      extracted = parseJSON(raw);
    } catch {
      // LLM call failed — fall through to regex
    }
  }

  if (!extracted) {
    extracted = regexExtract(text);
  }

  return NextResponse.json({ ok: true, extracted });
}

// ── config ─────────────────────────────────────────────────────────────
interface DaemonConfig {
  provider: string;
  model?: string | null;
  endpoint?: string | null;
  apiKey?: string | null;
}

function loadDaemonConfig(): DaemonConfig | null {
  const path = join(repoRoot(), '.careeros.config.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// ── LLM extraction prompt ───────────────────────────────────────────────
const SYSTEM = `You are a CV data extractor. Extract structured profile information from the CV text provided.
Return ONLY a single valid JSON object with these exact keys — no markdown, no explanation, just JSON:
{
  "full_name": "candidate's full name",
  "email": "email address",
  "phone": "phone number with country code if shown",
  "location": "City, Country (full location string)",
  "country": "country name only",
  "city": "city name only",
  "linkedin": "linkedin.com/in/... (path only, no https://)",
  "github": "github.com/... (path only, no https://)",
  "portfolio_url": "personal website or portfolio URL if present",
  "current_title": "most recent or current job title",
  "suggested_roles": ["3-5 roles this person should target based on their experience"],
  "visa_status": "visa or work authorisation status if explicitly mentioned, else empty string",
  "years_experience": "estimated total years of professional experience as a number string, e.g. 5"
}
If a field is not found in the CV, use an empty string. For suggested_roles, always return 3-5 relevant titles.`;

function buildUserMsg(text: string) {
  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n\n[truncated]' : text;
  return `Extract profile fields from this CV:\n\n${truncated}`;
}

// ── LLM callers ─────────────────────────────────────────────────────────
async function callLLM(text: string, cfg: DaemonConfig): Promise<string> {
  if (cfg.provider === 'claude-cli') return callClaudeCli(text);
  if (cfg.provider === 'ollama') return callOllama(text, cfg);
  if (cfg.provider === 'openai-compat') return callOpenAI(text, cfg);
  throw new Error(`unknown provider: ${cfg.provider}`);
}

function callClaudeCli(text: string): Promise<string> {
  const full = `${SYSTEM}\n\n${buildUserMsg(text)}`;
  return new Promise((resolve, reject) => {
    const proc = execFile('claude', ['--print'], {
      timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err && !stdout?.trim()) reject(new Error(`claude: ${stderr?.slice(0, 200)}`));
      else resolve(stdout?.trim() || '');
    });
    proc.stdin?.end(full);
  });
}

async function callOllama(text: string, cfg: DaemonConfig): Promise<string> {
  const base = (cfg.endpoint || 'http://localhost:11434').replace(/\/$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model || 'llama3.2',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUserMsg(text) }],
      stream: false,
      options: { num_ctx: 8192 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json() as { message?: { content?: string } };
  return data?.message?.content || '';
}

async function callOpenAI(text: string, cfg: DaemonConfig): Promise<string> {
  if (!cfg.endpoint) throw new Error('openai-compat needs endpoint');
  const base = cfg.endpoint.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model || 'gpt-3.5-turbo',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUserMsg(text) }],
      temperature: 0.1,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data?.choices?.[0]?.message?.content || '';
}

// ── JSON parse (strip markdown fences if model wrapped it) ───────────────
function parseJSON(raw: string): ExtractedProfile | null {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}

// ── regex fallback ───────────────────────────────────────────────────────
interface ExtractedProfile {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  country: string;
  city: string;
  linkedin: string;
  github: string;
  portfolio_url: string;
  current_title: string;
  suggested_roles: string[];
  visa_status: string;
  years_experience: string;
}

function regexExtract(text: string): ExtractedProfile {
  const email = text.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/)?.[0] || '';
  const phone = text.match(/(?:\+?\d[\d\s\-().]{6,18}\d)/)?.[0]?.trim() || '';
  const linkedinM = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([\w\-]+)/i);
  const linkedin = linkedinM ? `linkedin.com/in/${linkedinM[1]}` : '';
  const githubM = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([\w\-]+)/i);
  const github = githubM ? `github.com/${githubM[1]}` : '';
  const portfolioM = text.match(/(?:https?:\/\/(?!.*(?:linkedin|github))[^\s,)>]+)/i);
  const portfolio_url = portfolioM ? portfolioM[0] : '';

  // Name: first short non-email line
  const lines = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).filter(Boolean);
  const nameLine = lines.find((l) => l.length <= 50 && !l.includes('@') && !l.includes(':') && !l.includes('http')) || '';

  // Location: "City, Country" — avoid \s so newlines don't bleed in
  const locationM = text.match(/\b([A-Z][a-zA-Z ]{1,25}),[ \t]*([A-Z][a-zA-Z ]{1,25})\b/);
  const location = locationM ? locationM[0].trim() : '';
  const [city = '', country = ''] = location ? location.split(',').map((s) => s.trim()) : ['', ''];

  // Current title: line after "Experience" or first title-like line
  const expIdx = lines.findIndex((l) => /^experience|work history/i.test(l));
  const current_title = expIdx >= 0 ? (lines[expIdx + 1] || '') : '';

  return {
    full_name: nameLine,
    email, phone, linkedin, github,
    portfolio_url,
    location, country, city,
    current_title,
    suggested_roles: [],
    visa_status: '',
    years_experience: '',
  };
}
