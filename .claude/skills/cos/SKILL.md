---
name: cos
description: >-
  Short alias for /careeros. The CareerOS CV + cover-letter builder and
  job-application pipeline. Use exactly like /careeros (e.g. /cos apply 1,
  /cos board, /cos build-cv 1, or paste a job URL). Routes to the CareerOS
  dispatcher.
---

# /cos — CareerOS (short alias)

You were invoked through the short alias **`/cos`**. This is identical to
`/careeros`.

**Do this:** read **`modes/_router.md`** and follow it exactly, treating the
ARGUMENTS passed to `/cos` as the router input. Everything — the preflight
`doctor` check, the mode-routing table, the context-load order, and the
guardrails — lives in that file. Do not duplicate logic here; defer to it.
