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

// One request under a single timeout that ALSO covers reading the body — aborting
// the controller cancels an in-flight body stream, so a server that returns 200
// then slow-drips a huge body can't hang us. When maxRedirects > 0 we follow
// redirects MANUALLY and re-run the SSRF guard on every hop, so a 3xx pointing at
// a private/internal host can't slip past the initial assertSafeUrl(url).
async function fetchParsed(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers = {},
  method = 'GET',
  body = null,
  redirect = 'follow',
  maxRedirects = 0,
  parse = 'text',
} = {}) {
  assertSafeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const hdrs = { 'user-agent': DEFAULT_USER_AGENT, ...headers };
  try {
    let res;
    if (maxRedirects > 0) {
      let current = String(url);
      let hops = 0;
      for (;;) {
        res = await fetch(current, { method, headers: hdrs, body, redirect: 'manual', signal: controller.signal });
        const loc = (res.status >= 300 && res.status < 400) ? res.headers.get('location') : null;
        if (!loc) break;
        if (++hops > maxRedirects) throw new Error(`too many redirects (>${maxRedirects}): ${url}`);
        current = new URL(loc, current).toString();
        assertSafeUrl(current); // re-validate EVERY hop — closes the redirect SSRF hole
      }
    } else {
      res = await fetch(url, { method, headers: hdrs, body, redirect, signal: controller.signal });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 300);
      const err = new Error(snippet ? `HTTP ${res.status}: ${snippet}` : `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return parse === 'json' ? await res.json() : await res.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) { return fetchParsed(url, { ...opts, parse: 'json' }); }
export async function fetchText(url, opts = {}) { return fetchParsed(url, { ...opts, parse: 'text' }); }

// The ctx object handed to every provider.fetch(entry, ctx).
export function makeHttpCtx() {
  return { transport: 'http', fetchJson, fetchText };
}
