---
description: CareerOS — route a cos command (onboard, board, build-cv, a pasted job URL, …) through the CareerOS dispatcher
---

You were invoked as the CareerOS `/cos` command. Read **`modes/_router.md`** at
the repo root and follow it exactly, treating everything after `/cos` as the
router input. Everything — the preflight `doctor` check, the mode-routing table,
the context-load order, and the guardrails — lives in that file. Do not
duplicate logic here; defer to it.
