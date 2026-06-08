// scripts/providers/_http.mjs — shared HTTP transport for ATS providers.
//
// Files prefixed with _ are NEVER loaded as providers by scan.mjs; they are
// shared helpers. Providers receive a ctx with { fetchJson, fetchText } from
// makeHttpCtx() and use those instead of calling global fetch directly, so the
// timeout + User-Agent + SSRF guard are applied consistently.
//
// Zero external deps — uses the global fetch + AbortController (Node >= 18).

import net from 'node:net';
import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = 'careeros-scan/1.0 (+https://github.com/Vaibhavkkm/CareerOS)';

// SSRF guard. We are a job scanner that only ever talks to public ATS APIs, so we
// hard-reject anything that isn't http(s) and any host that resolves to a
// private/loopback/link-local/metadata target. This is a best-effort guard on the
// host LITERAL (it does not resolve DNS, so a DNS-rebinding name still gets through
// — a documented limitation), but it must catch every IP-literal foot-gun: a
// malicious portals.yml, an inbox/JD URL, or an attacker-controlled 3xx redirect.

// True if a dotted-quad IPv4 string is in a private/loopback/link-local/reserved range.
export function isPrivateIPv4(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return false;
  const n = parts.map((p) => Number(p));
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = n;
  if (a === 0) return true;                       // 0.0.0.0/8  "this network"
  if (a === 10) return true;                      // 10/8       private
  if (a === 127) return true;                     // 127/8      loopback
  if (a === 169 && b === 254) return true;        // 169.254/16 link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private (incl. Docker bridge 172.17.x)
  if (a === 192 && b === 168) return true;        // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

// True if an IPv6 literal (no brackets) is loopback/unspecified/ULA/link-local, or
// an IPv4-mapped/compatible address whose embedded IPv4 is private. Handles both
// the dotted form (::ffff:127.0.0.1) and the hex form the URL parser normalizes to
// (::ffff:7f00:1).
export function isPrivateIPv6(ip) {
  let h = String(ip).toLowerCase();
  const zone = h.indexOf('%');
  if (zone >= 0) h = h.slice(0, zone);            // strip scope id (fe80::1%eth0)
  if (h === '::1' || h === '::') return true;     // loopback / unspecified
  const dotted = h.match(/(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return isPrivateIPv4(dotted[1]);
  const hex = h.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // ::ffff:7f00:1
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIPv4([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.'));
  }
  const firstGroup = h.split(':')[0];             // '' for a leading '::'
  if (firstGroup) {
    const word = parseInt(firstGroup, 16);
    if (Number.isFinite(word)) {
      const firstByte = (word >> 8) & 0xff;
      if (firstByte === 0xfc || firstByte === 0xfd) return true; // fc00::/7 unique-local
      if (word >= 0xfe80 && word <= 0xfebf) return true;         // fe80::/10 link-local
    }
  }
  return false;
}

// True if a URL hostname must be blocked (private/loopback target or localhost).
export function isBlockedHost(rawHost) {
  let host = String(rawHost || '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1); // [::1] -> ::1
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const kind = net.isIP(host);
  if (kind === 4) return isPrivateIPv4(host);
  if (kind === 6) return isPrivateIPv6(host);
  return false; // a DNS name we don't resolve — left to the network layer (documented)
}

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
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`blocked private/loopback host: ${parsed.hostname}`);
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

// ─── self-test ────────────────────────────────────────────────────────
// `node scripts/providers/_http.mjs --self-test` — exercises the SSRF guard.
export async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  const blocked = [
    'http://localhost/x', 'http://api.localhost/x',
    'http://127.0.0.1/x', 'http://127.255.255.254/x',
    'http://10.0.0.1/x', 'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://172.16.0.1/x', 'http://172.17.0.1/x', 'http://172.31.255.255/x', // 172.16/12 (Docker)
    'http://100.64.0.1/x', 'http://0.0.0.0/x', 'http://0.1.2.3/x',
    'http://[::1]/x', 'http://[::]/x',
    'http://[::ffff:127.0.0.1]/x', 'http://[::ffff:10.0.0.1]/x', // IPv4-mapped IPv6
    'http://[fc00::1]/x', 'http://[fd12:3456::1]/x',             // ULA
    'http://[fe80::1]/x',                                        // link-local
  ];
  for (const u of blocked) {
    assert.throws(() => assertSafeUrl(u), /blocked private\/loopback|unsupported|invalid/, `should block ${u}`);
  }
  const allowed = [
    'https://boards.greenhouse.io/acme', 'https://example.com/jobs',
    'http://172.15.0.1/x', 'http://172.32.0.1/x',  // just outside 172.16/12
    'http://8.8.8.8/x', 'http://[2606:4700:4700::1111]/x', // public IPv6 (Cloudflare)
  ];
  for (const u of allowed) {
    assert.doesNotThrow(() => assertSafeUrl(u), `should allow ${u}`);
  }
  // protocol guard
  assert.throws(() => assertSafeUrl('file:///etc/passwd'), /unsupported protocol/);
  assert.throws(() => assertSafeUrl('ftp://example.com'), /unsupported protocol/);
  console.log(`_http.mjs self-test: ${blocked.length + allowed.length + 2} checks passed`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    selfTest().then((c) => process.exit(c)).catch((e) => { console.error(`_http self-test FAILED: ${e.message}`); process.exit(1); });
  }
}
