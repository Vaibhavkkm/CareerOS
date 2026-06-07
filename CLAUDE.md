# OfferForge — project memory

OfferForge is a Claude Code-native, **LaTeX-first** CV + cover-letter builder
fused with a job-application pipeline, with a **hybrid learning loop**. It is a
generic, **public** tool meant to work for ANY user: a person feeds in a job
description plus their own CV and cover letter; the system learns their facts and
voice from those uploads (and keeps adapting to their edits), then drafts a new CV
and cover letter tailored to the job, in that person's style. The "LLM" is *you*,
the in-session agent — there is no server and no API key. Deterministic mechanical
work lives in `scripts/*.mjs` (zero tokens); judgment and writing live in
`modes/*.md` playbooks; every candidate-facing artifact is a `.tex` compiled to
PDF by **tectonic**.

## How to operate
- The user drives this via the `/offerforge` (`/og`) skill — see
  `.claude/skills/offerforge/SKILL.md` for routing. When a request matches a
  mode, follow that mode's playbook.
- On session start, silently run `node scripts/doctor.mjs`. If setup is
  incomplete, run the `modes/onboard.md` flow (`/og onboard`) before anything
  else — it turns the user's uploaded CV + cover letter into `data/profile.yml`,
  `data/cv.master.md`, and a learned `narrative.voice`.

## Data contract (the #1 rule — see DATA_CONTRACT.md)
- **System layer** (regenerable): `modes/`, `templates/`, `lib/`, `scripts/`,
  `.claude/`, `CLAUDE.md`. Edit to customize; an update may overwrite.
- **User layer** (NEVER auto-modify): everything under `data/`. This is the
  user's data and work product. Because this repo is **public**, `data/` is
  **git-ignored** — a user's CV, contact details, profile, and letters stay on
  their own machine and never enter the public repo. Back it up via their own
  (private) git remote.
- Two truth/view pairs: `data/tracker.jsonl` → renders `tracker.md`/`progress.md`;
  `data/style/profile.json` → renders `style/profile.md`. Edit the truth, not the view.

## Guardrails (NEVER)
- NEVER auto-submit/click submit on any application. Generate; the human acts.
- NEVER fabricate experience, metrics, employers, titles, or dates. Ground every
  claim in `data/cv.master.md` / `data/profile.yml`. Missing requirement → say so.
- NEVER set a tracker record to `applied` before the user confirms submission.
- NEVER share the user's phone number in cold outreach.
- NEVER add `\input{glyphtounicode}`, `\pdfgentounicode`, or microtype
  `DisableLigatures` to a `.tex` — they ERROR under tectonic. Keep the
  `\defaultfontfeatures{Ligatures={NoCommon}}` line (load-bearing for ATS).

## Guardrails (ALWAYS)
- ALWAYS keep the human in the loop; recommend against sub-threshold fits.
- ALWAYS escape raw data with `lib/text.mjs` `latexEscape`/`latexSanitize` before
  putting it into a `.tex`.
- ALWAYS compile through `node scripts/compile-latex.mjs` so the validate +
  ATS smoke test runs; never declare a PDF good without it passing.
- ALWAYS snapshot the AI draft (`data/style/edits/<id>/ai_draft.tex` + `context.json`)
  at generation time so the learning loop can run later.

## Key paths
- Profile/CV: `data/profile.yml`, `data/cv.master.md`, `data/_profile.md`
- Reports: `data/reports/NNN-slug-DATE.md` (embed a fenced YAML Machine Summary)
- Output: `data/output/cv-*.{tex,pdf}`, `cl-*.{tex,pdf}`
- Tracker: `data/tracker.jsonl` (truth)
- Learning loop: `data/style/{profile.json,examples.jsonl,idf.json,edits/}`
- Tooling: `scripts/`, shared libs `lib/`, templates `templates/`

## Conventions
- Node ESM (`type: module`), the only dependency is `js-yaml`.
- Scripts print JSON to stdout (or `--summary` for humans), guard CLI with
  `import.meta.url`, and ship a `--self-test`. Run `npm test` to check them all.
- Status strings always go through `lib/states.mjs` (`templates/states.yml` is
  the single source). Tracker I/O + dedup always go through `lib/records.mjs`.
