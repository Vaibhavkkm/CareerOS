---
name: og
description: >-
  Short alias for /offerforge. The OfferForge CV + cover-letter builder and
  job-application pipeline. Use exactly like /offerforge (e.g. /og apply 1,
  /og board, /og build-cv 1, or paste a job URL). Routes to the OfferForge
  dispatcher.
---

# /og — OfferForge (short alias)

You were invoked through the short alias **`/og`**. This is identical to
`/offerforge`.

**Do this:** read `.claude/skills/offerforge/SKILL.md` and follow it exactly,
treating the ARGUMENTS passed to `/og` as the router input. Everything — the
preflight `doctor` check, the mode-routing table, the context-load order, and the
guardrails — lives in that file. Do not duplicate logic here; defer to it.
