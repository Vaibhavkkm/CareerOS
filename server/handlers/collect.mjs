// server/handlers/collect.mjs — gather context data for LLM prompts
// Strategy: pre-run zero-token scripts + read data files, inject all into prompt.
// LLM does pure text generation — no tool calling needed.
import { readFileSync, existsSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { runScript } from '../run.mjs';

function read(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

// Read a mode playbook (always loads _shared.md first)
export function collectMode(modeName) {
  const shared = read('modes/_shared.md') || '';
  const mode = read(`modes/${modeName}.md`) || '';
  return `${shared}\n\n---\n\n${mode}`;
}

// Read user profile + master CV
export function collectProfile() {
  return {
    profile: read('data/profile.yml') || '',
    master: read('data/cv.master.md') || '',
    profileMd: read('data/_profile.md') || '',
    styleProfile: read('data/style/profile.json') || '',
  };
}

// Run board.mjs and return top N rows as JSON string
export async function collectBoard(limit = 20) {
  const r = await runScript('board.mjs', ['--json'], { timeoutMs: 15_000 });
  if (!r.ok || !r.data) return '[]';
  const rows = (r.data.rows || []).slice(0, limit);
  return JSON.stringify(rows, null, 2);
}

// Find a JD in data/jds/ — by report number, URL fragment, or filename prefix
export function collectJD(target) {
  if (!target) return null;
  const dir = join(ROOT, 'data', 'jds');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.json'));
  const t = String(target).toLowerCase();

  // 1. Filename substring match
  for (const f of files) {
    if (f.toLowerCase().includes(t)) return read(`data/jds/${f}`);
  }

  // 2. URL match inside file contents (handles indeed/job-board URLs)
  if (target.startsWith('http')) {
    for (const f of files) {
      const content = read(`data/jds/${f}`);
      if (content && content.includes(target)) return content;
    }
  }

  // 3. Fuzzy company/role match inside filename (slugified words)
  const words = t.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((w) => w.length > 3);
  if (words.length) {
    for (const f of files) {
      const slug = f.toLowerCase();
      if (words.every((w) => slug.includes(w))) return read(`data/jds/${f}`);
    }
  }

  return null;
}

// Find a report by number or slug
export function collectReport(target) {
  if (!target) return null;
  const dir = join(ROOT, 'data', 'reports');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const num = String(target).padStart(3, '0');
  for (const f of files) {
    if (f.startsWith(num) || f.includes(String(target))) {
      return read(`data/reports/${f}`);
    }
  }
  return null;
}

// Get next report number (max NNN + 1, minimum 1)
export function nextReportNumber() {
  const dir = join(ROOT, 'data', 'reports');
  if (!existsSync(dir)) return 1;
  const nums = readdirSync(dir)
    .map((f) => parseInt(f.slice(0, 3), 10))
    .filter((n) => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

// Slugify a string for report filenames
export function slugify(str) {
  return (str || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Truncate content to maxChars, marking the truncation
export function truncate(content, maxChars) {
  if (!content || content.length <= maxChars) return content || '';
  return content.slice(0, maxChars) + '\n\n[... truncated for context length ...]';
}

// Register a generated document in data/ui/job-docs.jsonl for the web UI to surface
// type: 'cv' | 'cl' | 'report' | 'tex'
export function registerDoc(jd_path, type, relPath) {
  const dir = join(ROOT, 'data', 'ui');
  mkdirSync(dir, { recursive: true });
  const entry = JSON.stringify({ jd_path, type, path: relPath, ts: new Date().toISOString() });
  appendFileSync(join(dir, 'job-docs.jsonl'), entry + '\n', 'utf8');
}

// Build a standard context block string for injection into user messages
export function buildContextBlock({ profile, jd, report, board, extra } = {}) {
  const parts = [];
  if (profile?.profile) parts.push(`## User Profile (data/profile.yml)\n${profile.profile}`);
  if (profile?.master) parts.push(`## Master CV (data/cv.master.md)\n${profile.master}`);
  if (profile?.profileMd) parts.push(`## Profile Supplement (data/_profile.md)\n${profile.profileMd}`);
  if (jd) parts.push(`## Job Description\n${jd}`);
  if (report) parts.push(`## Evaluation Report\n${report}`);
  if (board) parts.push(`## Job Board (top rows)\n\`\`\`json\n${board}\n\`\`\``);
  if (extra) parts.push(extra);
  return parts.join('\n\n');
}
