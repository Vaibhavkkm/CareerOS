import yaml from 'js-yaml';

// Mirror of scripts/analyze.mjs `extractMachineSummary`: pull the fenced YAML
// "Machine Summary" block out of a report's markdown. Prefer the fence that
// follows a "Machine Summary" heading; otherwise take the last yaml fence.
export function extractMachineSummary(markdown: string): Record<string, unknown> | null {
  if (!markdown) return null;
  let raw: string | null = null;
  const headed = markdown.match(/Machine Summary[^\n]*\n+```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/i);
  if (headed) raw = headed[1];
  if (raw == null) {
    const fences = [...markdown.matchAll(/```(?:yaml|yml)\s*\n([\s\S]*?)\n```/gi)];
    if (fences.length) raw = fences[fences.length - 1][1];
  }
  if (raw == null || !raw.trim()) return null;
  try {
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// The prose body, with the Machine Summary fence stripped (so the drawer shows the
// human-readable A–G report without the trailing data block).
export function reportProse(markdown: string): string {
  return String(markdown || '')
    .replace(/#*\s*Machine Summary[^\n]*\n+```(?:yaml|yml)?\s*\n[\s\S]*?\n```/i, '')
    .trim();
}
