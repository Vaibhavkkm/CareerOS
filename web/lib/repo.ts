import { existsSync } from 'node:fs';
import path from 'node:path';

// Locate the CareerOS repo root (the dir that holds scripts/board.mjs).
// `next dev` runs with cwd = web/, so the root is normally one level up — but we
// walk up defensively so the app works no matter where it's launched from.
let cached: string | null = null;

export function repoRoot(): string {
  if (cached) return cached;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'scripts', 'board.mjs'))) {
      cached = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cached = path.resolve(process.cwd(), '..');
  return cached;
}
