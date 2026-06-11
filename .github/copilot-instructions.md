# CareerOS — Copilot shim

All project instructions live in **AGENTS.md** at the repo root — read that
file and follow it exactly. It defines what CareerOS is, the data contract
(`data/` is the user's private layer — never auto-modify), the guardrails
(never fabricate, never auto-submit), and the command router
(`modes/_router.md`) that dispatches `cos <mode>` requests to the playbooks
in `modes/`.
