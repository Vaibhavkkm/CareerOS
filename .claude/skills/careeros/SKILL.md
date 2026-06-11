---
name: careeros
description: >-
  Tailored LaTeX CV + cover-letter builder and job-application pipeline that
  learns from YOUR uploaded CV and cover letter. Use when the user pastes a job
  description or URL, uploads their own CV/cover letter to tailor from, or asks
  to onboard, evaluate a role, build/tailor a CV or cover letter, scan job
  portals, track or follow up on applications, prep for an interview, compare
  offers, or "learn from my edits". Invoke as /careeros (alias /cos),
  optionally with a mode and arguments.
---

# /careeros — CareerOS (Claude Code entry point)

CareerOS is agent-agnostic; this skill is just Claude Code's doorway into it.

**Do this:** read **`modes/_router.md`** and follow it exactly, treating the
ARGUMENTS passed to `/careeros` as the router input. Everything — the preflight
`doctor` check, the mode-routing table, the context-load order, and the
guardrails — lives in that file. Do not duplicate logic here; defer to it.
