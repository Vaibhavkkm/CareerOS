#!/usr/bin/env node
// scripts/setup-daemon.mjs — interactive wizard to create .careeros.config.json
// Usage: node scripts/setup-daemon.mjs  OR  npm run daemon:setup
import { createInterface } from 'node:readline';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, '.careeros.config.json');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.log('\n\x1b[1mCareerOS daemon setup\x1b[0m');
  console.log('─'.repeat(50));
  console.log('This wizard creates .careeros.config.json so the daemon');
  console.log('knows which LLM to use when draining your queue.\n');

  if (existsSync(CONFIG_PATH)) {
    const existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    console.log(`Existing config found (provider: ${existing.provider}).`);
    const overwrite = await ask('Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Keeping existing config. Done.');
      rl.close(); return;
    }
  }

  console.log('\nChoose your LLM provider:\n');
  console.log('  1) claude-cli      — uses your Claude Code subscription (recommended, free for subscribers)');
  console.log('  2) ollama          — local model via Ollama (free, private, needs ollama running)');
  console.log('  3) openai-compat   — any OpenAI-compatible API (OpenRouter, Groq, Anthropic API, LM Studio…)\n');

  let provider;
  while (!provider) {
    const choice = (await ask('Enter 1, 2, or 3: ')).trim();
    if (choice === '1') provider = 'claude-cli';
    else if (choice === '2') provider = 'ollama';
    else if (choice === '3') provider = 'openai-compat';
    else console.log('  Please enter 1, 2, or 3.');
  }

  const config = { provider };

  if (provider === 'claude-cli') {
    console.log('\n✓ claude-cli selected. No API key needed — uses your Claude Code login.');
    const model = (await ask('Model override? (press Enter for default): ')).trim();
    if (model) config.model = model;
  }

  if (provider === 'ollama') {
    console.log('\n✓ ollama selected. Make sure `ollama serve` is running.');
    console.log('  Good free models: llama3.2, qwen2.5:14b, mistral, gemma3:12b');
    console.log('  Pull with: ollama pull <model>');
    const model = (await ask('Model name (default: llama3.2): ')).trim() || 'llama3.2';
    config.model = model;
    const ep = (await ask('Endpoint (default: http://localhost:11434): ')).trim();
    config.endpoint = ep || 'http://localhost:11434';
  }

  if (provider === 'openai-compat') {
    console.log('\n✓ openai-compat selected.');
    console.log('  Examples:');
    console.log('    OpenRouter  — https://openrouter.ai/api  (free models available)');
    console.log('    Groq        — https://api.groq.com/openai (fast, cheap)');
    console.log('    LM Studio   — http://localhost:1234');
    console.log('    Anthropic   — https://api.anthropic.com');
    const ep = (await ask('API endpoint URL: ')).trim();
    if (!ep) { console.log('Endpoint required.'); rl.close(); process.exit(1); }
    config.endpoint = ep;
    const model = (await ask('Model name (e.g. meta-llama/llama-3.2-3b-instruct:free): ')).trim();
    if (model) config.model = model;
    const key = (await ask('API key (leave blank if not needed): ')).trim();
    if (key) config.apiKey = key;
  }

  const intervalStr = (await ask('\nPoll interval in seconds (default: 15): ')).trim();
  const interval = parseInt(intervalStr, 10);
  config.pollIntervalMs = (!isNaN(interval) && interval > 0) ? interval * 1000 : 15_000;

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`\n\x1b[32m✓ Config saved to .careeros.config.json\x1b[0m`);
  console.log('\nStart the daemon:');
  console.log('  npm run start      — web dashboard + daemon together');
  console.log('  npm run daemon     — daemon only');
  rl.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
