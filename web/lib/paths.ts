import path from 'node:path';
import { realpathSync } from 'node:fs';
import { repoRoot } from './repo';

// The web app may READ files only from these repo-relative dirs. Everything else
// (profile.yml, tracker.jsonl, the rest of the disk) is off-limits to the read
// routes — the LFI / path-traversal guard.
const READ_DIRS = ['data/jds', 'data/reports', 'data/output'];

// Resolve a client-supplied repo-relative path and confirm it stays inside one of
// the allowed dirs. Returns the absolute path, or null if it escapes the sandbox.
export function safeDataPath(rel: string): string | null {
  if (!rel || typeof rel !== 'string') return null;
  // Reject obviously hostile input early.
  if (rel.includes('\0')) return null;
  const root = repoRoot();
  const resolved = path.resolve(root, rel);
  // Resolve symlinks before the boundary check: a symlink placed inside an allowed
  // dir could point OUTSIDE the sandbox, and the lexical resolve above only sees the
  // link's own path. If the target doesn't exist yet, realpath throws and we fall
  // back to the lexical path (a non-existent path can't be a malicious symlink, and
  // the caller's existsSync handles the miss).
  let real = resolved;
  try { real = realpathSync(resolved); } catch { /* not present — use lexical path */ }
  for (const dir of READ_DIRS) {
    let base = path.resolve(root, dir);
    try { base = realpathSync(base); } catch { /* dir may not exist */ }
    const r = path.relative(base, real);
    if (r !== '' && !r.startsWith('..') && !path.isAbsolute(r)) {
      return resolved;
    }
  }
  return null;
}
