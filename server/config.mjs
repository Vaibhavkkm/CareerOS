// server/config.mjs — load .careeros.config.json from repo root
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG_PATH = join(ROOT, '.careeros.config.json');

// Supported LLM providers
export const PROVIDERS = ['claude-cli', 'ollama', 'openai-compat'];

const DEFAULTS = {
  provider: 'claude-cli',  // use the user's Claude Code subscription
  model: null,             // null = each adapter picks its own default
  endpoint: null,          // required for ollama / openai-compat
  apiKey: null,            // required for openai-compat
  pollIntervalMs: 15_000,
  maxContextChars: 80_000, // truncate injected context above this
};

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (e) {
    console.warn(`[daemon] bad .careeros.config.json: ${e.message} — using defaults`);
    return { ...DEFAULTS };
  }
}
