// server/adapters/ollama.mjs — call a local Ollama instance
// Default endpoint: http://localhost:11434
// Requires: ollama running + a pulled model (e.g. `ollama pull llama3.2`)
// Good free models: llama3.2, qwen2.5:14b, mistral, gemma3:12b
// Minimum: a model with ≥8k context (profile + CV + playbook can be ~6k tokens)

export async function call(systemPrompt, userMessage, { model, endpoint } = {}) {
  const base = (endpoint || 'http://localhost:11434').replace(/\/$/, '');
  const url = `${base}/api/chat`;
  const body = {
    model: model || 'llama3.2',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    stream: false,
    options: { num_ctx: 16384 },  // request larger context window
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.message?.content;
  if (!content) throw new Error(`Ollama returned no content: ${JSON.stringify(data).slice(0, 200)}`);
  return content.trim();
}
