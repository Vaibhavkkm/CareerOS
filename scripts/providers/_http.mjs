// scripts/providers/_http.mjs — shared HTTP transport for ATS providers.
//
// Files prefixed with _ are NEVER loaded as providers by scan.mjs; they are
// shared helpers. Providers receive a ctx with { fetchJson, fetchText } from
// makeHttpCtx() and use those instead of calling global fetch directly, so the
// timeout + User-Agent + SSRF guard are applied consistently.
//
// Zero external deps — uses the global fetch + AbortController (Node >= 18).

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = 'offerforge-scan/1.0 (+https://github.com/Vaibhavkkm/OfferForge)';

// Basic SSRF guard. We are a job scanner that only ever talks to public ATS
// APIs, so we hard-reject anything that isn't http(s) and any host that looks
// private/loopback/link-local. This is a best-effort string guard, not a full
// network-layer defense (it does not resolve DNS), but it stops the obvious
// foot-guns of a malicious portals.yml pointing at internal services.
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?)/i;

// Validate + parse a URL, throwing on anything that fails the SSRF guard.
// Exported so providers / tests can reuse the exact same policy.
export function assertSafeUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${parsed.protocol} (only http/https allowed)`);
  }
  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host)) {
    throw new Error(`blocked private/loopback host: ${host}`);
  }
  return parsed;
}

async function fetchWithTimeout(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers = {},
  method = 'GET',
  body = null,
  redirect = 'follow',
} = {}) {
  assertSafeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': DEFAULT_USER_AGENT, ...headers },
      body,
      redirect,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 300);
      const err = new Error(snippet ? `HTTP ${res.status}: ${snippet}` : `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  return res.json();
}

export async function fetchText(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  return res.text();
}

// The ctx object handed to every provider.fetch(entry, ctx).
export function makeHttpCtx() {
  return { transport: 'http', fetchJson, fetchText };
}
