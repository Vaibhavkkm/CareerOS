// scripts/providers/local-parser.mjs — escape-hatch provider for JS-heavy
// career pages that no HTTP/API provider can reach.
//
// portals.yml entry:
//   - name: "Custom Inc"
//     provider: local-parser
//     parser: { command: "python3", script: "data/parsers/custom_inc.py" }
//
// scan.mjs shells out to `command script [...args]`, expects stdout to be a JSON
// array of Job objects ({ title, url, company, location }), and feeds those into
// the same filter/dedup pipeline as the HTTP providers. No Playwright dependency
// is shipped — the user owns the parser script.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 20_000;
const MAX_BUFFER_BYTES = 2_000_000; // 2 MB

// Interpolate {company} / {careers_url} placeholders into a parser arg.
function expand(value, entry) {
  return String(value)
    .replaceAll('{company}', entry.name || '')
    .replaceAll('{careers_url}', entry.url || entry.careers_url || '');
}

// Coerce a location-ish value (string | array | {name|text}) to a flat string.
function normLocation(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(normLocation).filter(Boolean).join(', ');
  if (typeof value === 'object') return String(value.name || value.text || '').trim();
  return String(value).trim();
}

// Resolve an absolute-ish URL against the company's careers page if relative.
function normUrl(raw, entry) {
  if (!raw) return '';
  const base = entry.url || entry.careers_url || undefined;
  try {
    return new URL(String(raw).trim(), base).href;
  } catch {
    return String(raw).trim();
  }
}

// Normalize one raw record from the parser's stdout into a Job, or null if it
// lacks the two required fields (title + url).
export function normalizeJob(raw, entry) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || raw.name || '').trim();
  const url = normUrl(raw.url || raw.jobUrl || raw.job_url || raw.applyUrl || raw.apply_url, entry);
  if (!title || !url) return null;
  return {
    title,
    url,
    company: String(raw.company || entry.name || '').trim(),
    location: normLocation(raw.location || raw.locations),
  };
}

const provider = {
  id: 'local-parser',

  // scan.mjs routes to local-parser when entry.parser exists; this detect()
  // lets URL-based auto-detection pick it up too, but only when the configured
  // script actually exists on disk.
  detect(entry) {
    const parser = entry?.parser;
    if (!parser || !parser.command || !parser.script) return false;
    const script = expand(parser.script, entry);
    return existsSync(script);
  },

  async fetch(entry, _ctx) {
    const parser = entry?.parser || {};
    if (!parser.command) throw new Error('local-parser: entry.parser.command is required');
    if (!parser.script) throw new Error('local-parser: entry.parser.script is required');

    const args = [expand(parser.script, entry)];
    if (Array.isArray(parser.args)) args.push(...parser.args.map((a) => expand(a, entry)));

    let stdout;
    try {
      ({ stdout } = await execFileAsync(parser.command, args, {
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      }));
    } catch (err) {
      if (err.killed) throw new Error(`local-parser: ${parser.command} timed out after ${TIMEOUT_MS}ms`);
      throw new Error(`local-parser: ${parser.command} failed — ${String(err.message).split('\n')[0]}`);
    }

    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new Error('local-parser: stdout was not valid JSON');
    }
    const rows = Array.isArray(payload) ? payload : (payload.jobs || payload.results);
    if (!Array.isArray(rows)) {
      throw new Error('local-parser: expected a JSON array of jobs (or { jobs: [] } / { results: [] })');
    }
    return rows.map((r) => normalizeJob(r, entry)).filter(Boolean);
  },
};

export default provider;
