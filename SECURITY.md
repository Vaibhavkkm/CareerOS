# Security Policy

## Supported versions

CareerOS is in early, active development. Security fixes are applied to the latest
`main` and the most recent `0.1.x` release.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ |
| < 0.1   | ❌ |

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Email **vaibhavkkm@zohomail.in**, or
- Use GitHub's private vulnerability reporting ("Report a vulnerability") on the
  repository's **Security** tab.

Include as much as you can: a description, steps to reproduce, the affected file or
command, and the potential impact. You'll get an acknowledgement, and we'll keep you
updated as we investigate and fix. Please give us a reasonable window to release a
fix before any public disclosure.

## What's in scope

CareerOS runs locally inside Claude Code with **no server and no API key**, so its
attack surface is small. The areas most worth scrutiny:

- **Outbound fetching.** Job-posting scraping and portal scanning make HTTP requests.
  All requests go through `scripts/providers/_http.mjs`, which enforces an SSRF host
  guard (rejecting private/loopback/link-local hosts), re-validates **every** redirect
  hop, and applies timeouts that also cover response-body reading. Reports of ways to
  reach an internal host or hang the process are in scope.
- **Untrusted input parsing.** HTML/JSON from arbitrary job pages is parsed into text.
  Crashes, hangs (e.g. catastrophic backtracking), or resource exhaustion from a
  crafted page are in scope.
- **Data handling.** A user's personal data lives only under the git-ignored `data/`
  directory and must never be transmitted or committed. Any path that leaks it is a
  serious bug — please report it.

## Out of scope

- Issues requiring a malicious local user who already controls the machine.
- The behaviour of third-party ATS APIs or career sites themselves.
- LaTeX/tectonic engine internals (report those upstream).
