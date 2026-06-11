# CareerOS — Gemini shim (Gemini CLI & Google Antigravity)

All project instructions live in **[AGENTS.md](AGENTS.md)** — read that file
now and follow it exactly. (Antigravity also reads `AGENTS.md` natively and
gives this file higher priority; there is nothing to override here — defer
fully to `AGENTS.md`. Antigravity users additionally get a native `/cos`
command via `.agents/workflows/cos.md`.) It defines what CareerOS is, the data contract
(`data/` is the user's private layer — never auto-modify), the guardrails
(never fabricate, never auto-submit), and the command router
(`modes/_router.md`) that dispatches `cos <mode>` requests to the playbooks
in `modes/`.
