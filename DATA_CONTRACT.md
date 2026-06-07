# Data Contract

OfferForge separates **System** files (shipped, safe to overwrite/update) from
**User** files (your data — *never* auto-modified without your say-so). This is
the single most important rule in the system: an update or regeneration must
never clobber your work.

## System Layer — safe to regenerate / update
These are part of OfferForge itself. Edit them to customize behavior, but an
"update the system" action may overwrite them.

| Path | What it is |
|------|------------|
| `.claude/skills/offerforge/SKILL.md` | The router skill (dispatches `/og <mode>`) |
| `CLAUDE.md` | Project memory: data contract, routing, guardrails |
| `modes/*.md` | Prompt-as-program playbooks (the "intelligence") |
| `modes/_shared.md` | Shared rubric, archetypes, guardrails, LaTeX rules |
| `templates/*` | LaTeX templates, `states.yml`, example configs, JSON schemas |
| `lib/*.mjs` | Shared deterministic libraries |
| `scripts/*.mjs` | Deterministic, zero-token tools |
| `scripts/providers/*.mjs` | ATS source plugins |

> `modes/_profile.template.md` is System, but its **copy** at `data/_profile.md` is User.

## User Layer — NEVER auto-modified
Everything under `data/`. This is yours. Back it up with your own git.

| Path | What it is |
|------|------------|
| `data/profile.yml` | Your master profile (identity, archetypes, comp, voice) |
| `data/_profile.md` | Prose overrides / framing |
| `data/cv.master.md` | Source-of-truth CV content (seeded from your real CV) |
| `data/article-digest.md` | Optional extra proof points / metrics |
| `data/portals.yml` | Companies + filters for the scanner |
| `data/tracker.jsonl` | **Source of truth** for applications (one JSON/line) |
| `data/tracker.md`, `data/progress.md` | **Generated views** (disposable; rebuilt from JSONL) |
| `data/inbox.md` | URL queue for the pipeline |
| `data/scan-history.tsv` | Append-only dedup ledger for the scanner |
| `data/reports/NNN-*.md` | Evaluation reports (with embedded YAML Machine Summary) |
| `data/output/*.{tex,pdf}` | Generated CVs and cover letters |
| `data/writing-samples/*` | Your prose corpus (voice cold-start) |
| `data/interview-prep/*` | Story bank + per-process prep |
| `data/style/*` | The hybrid learning-loop state (profile, examples, edits) |
| `data/batch/*` | Batch input/state |

## The two generated-vs-truth pairs
1. **Tracker**: `tracker.jsonl` is truth → `tracker.md` + `progress.md` are rendered. Edit the JSONL (via `tracker` mode), never the markdown.
2. **Style profile**: `style/profile.json` is truth → `style/profile.md` is rendered. The learning loop writes the JSON; the markdown is for your eyes.

## Rollback philosophy
Nothing in the learning loop is ever deleted — rules are *status-flipped*
(`provisional → active → superseded → retired`) and every change is logged to
`data/style/CHANGELOG.style.md`. Raw `.tex` edit snapshots are kept forever, so
`style-profile.mjs --rebuild` can re-derive the whole profile from scratch.
