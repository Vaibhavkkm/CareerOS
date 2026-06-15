// server/adapters/openai-compat.mjs — any OpenAI-compatible /v1/chat/completions endpoint
// Works with: Anthropic API, OpenRouter, Together.ai, Groq, LM Studio, vLLM, etc.
//
// Config examples:
//   OpenRouter:   endpoint=https://openrouter.ai/api, apiKey=sk-or-..., model=meta-llama/llama-3.2-3b-instruct:free
//   Anthropic:    endpoint=https://api.anthropic.com, apiKey=sk-ant-..., model=claude-haiku-4-5-20251001
//   Groq (fast):  endpoint=https://api.groq.com/openai, apiKey=gsk_..., model=llama-3.3-70b-versatile
//   LM Studio:    endpoint=http://localhost:1234, apiKey=lm-studio, model=<loaded-model>

export async function call(systemPrompt, userMessage, { model, endpoint, apiKey } = {}) {
  if (!endpoint) throw new Error('openai-compat adapter needs config.endpoint');
  const base = endpoint.replace(/\/$/, '');
  const url = `${base}/v1/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body = {
    model: model || 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${base} ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`API returned no content: ${JSON.stringify(data).slice(0, 200)}`);
  return content.trim();
}
