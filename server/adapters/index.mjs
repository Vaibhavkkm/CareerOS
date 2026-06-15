// server/adapters/index.mjs — factory: pick adapter from config.provider
import * as claudeCli from './claude-cli.mjs';
import * as ollama from './ollama.mjs';
import * as openaiCompat from './openai-compat.mjs';

const MAP = {
  'claude-cli': claudeCli,
  'ollama': ollama,
  'openai-compat': openaiCompat,
};

// Returns a bound `generate(system, user) → string` function
export function getAdapter(config) {
  const adapter = MAP[config.provider];
  if (!adapter) throw new Error(`Unknown provider "${config.provider}". Use: ${Object.keys(MAP).join(', ')}`);
  return (systemPrompt, userMessage) =>
    adapter.call(systemPrompt, userMessage, {
      model: config.model,
      endpoint: config.endpoint,
      apiKey: config.apiKey,
    });
}
