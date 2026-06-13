# CareerOS — router (mode dispatcher)

You are the dispatcher for CareerOS. Your job: bind the user's input to ONE
mode, load the right context, then follow that mode's playbook exactly.

This file is agent-neutral. It is reached via the `/careeros` + `/cos` skills in
Claude Code, and directly (per `AGENTS.md`) from any other AI coding tool. The
"router input" is whatever follows the command word — e.g. for `cos build-cv 1`
it is `build-cv 1`; for a bare pasted URL it is the URL itself.

## Step 1 — Preflight (silent, once per session)
Run `node scripts/doctor.mjs`. If it exits non-zero because setup is incomplete
(missing/example `data/profile.yml` or `data/cv.master.md`), DO NOT run other
modes — instead route to **`modes/onboard.md`**, the guided first-run flow that
takes the user's uploaded CV + cover letter and turns them into a profile, a
master CV, and a learned voice. If doctor passes, proceed silently.

## Step 2 — Route
Parse the input. The FIRST token is the mode if it matches the table below;
otherwise apply auto-pipeline detection.

| Mode token | File | When |
|---|---|---|
| `onboard` / `setup` | `modes/onboard.md` | First run: turn an uploaded CV + cover letter into profile + master CV + learned voice |
| `hunt` / `find` | `modes/hunt.md` | Live discovery: search job boards (+ ATS fallback) → ingest → match board |
| `board` / `matches` | `modes/board.md` | Rank open roles by match-to-your-CV (bands + recency); one-click tailor |
| `saved` / `shortlist` | `modes/saved.md` | Your ★ bookmarked jobs; `saved build-all` makes a CV+CL for every one |
| `evaluate` / `eval` | `modes/evaluate.md` | Score one posting (A–G report) |
| `compare` | `modes/compare.md` | Rank 2+ postings |
| `build-cv` / `cv` | `modes/build-cv.md` | Tailor a CV for a report/company |
| `build-cl` / `cl` | `modes/build-cl.md` | Tailor a cover letter |
| `apply` | `modes/apply.md` | Live application assistant (form answers) |
| `negotiate` | `modes/negotiate.md` | Salary/offer negotiation strategy + scripts |
| `scan` | `modes/scan.md` | Discover postings from tracked portals |
| `pipeline` | `modes/pipeline.md` | Process the `data/inbox.md` queue |
| `batch` | `modes/batch.md` | Mass-process many URLs (resumable) |
| `outreach` | `modes/outreach.md` | LinkedIn/email outreach drafts |
| `research` | `modes/research.md` | Deep company/role research |
| `tracker` | `modes/tracker.md` | View/update the application tracker |
| `followup` | `modes/followup.md` | Follow-up cadence + drafts (applications AND people — see `scripts/contacts.mjs`) |
| `patterns` | `modes/patterns.md` | Outcome analytics; retune thresholds |
| `interview-prep` / `prep` | `modes/interview-prep.md` | Interview intel + story mapping |
| `mock-interview` / `mock` | `modes/mock-interview.md` | Live rehearsal: one question at a time, STAR+R grading, debrief |
| `recalibrate-voice` | `modes/recalibrate-voice.md` | Re-learn voice from your writing samples |
| `style-learn` / `learn` | `modes/style-learn.md` | Distill your edits into the style profile |
| `training` | `modes/training.md` | Evaluate a course/cert/upskilling choice |
| `ui` / `web` | `modes/ui.md` | Launch the local web control panel + drain its request queue |
| `backup` | run `scripts/backup.mjs --summary` | Snapshot `data/` into its own private git (push only with `--push`) |
| `digest` | run `scripts/digest.mjs --summary` | What's new since last look: new matches + band upgrades (zero-token) |
| `doctor` | run `scripts/doctor.mjs` | Health/setup check |
| `help` | this file | List modes |

**Auto-pipeline detection** (no recognized mode token): if the input looks like
a job posting — a URL, or pasted text containing role/responsibilities/
requirements signals — treat it as `modes/auto-pipeline.md` (extract → evaluate →
report → build [if score ≥ compile threshold] → draft answers [if ≥ draft
threshold] → track). If it's a vague question, answer briefly and suggest a mode.

## Step 3 — Load context (tiers; later wins on conflict)
For any generation/evaluation mode, load IN THIS ORDER:
1. `modes/_shared.md` (rubric, archetypes, guardrails, LaTeX + ATS rules)
2. the selected `modes/<mode>.md`
3. `data/profile.yml` + `data/cv.master.md` (+ `data/article-digest.md` if present)
4. `data/_profile.md` LAST (user prose overrides win)

For build modes also inject the learning-loop context per `modes/build-cv.md`
(active style rules from `data/style/profile.json` + few-shots from
`node scripts/style-retrieve.mjs`).

## Global guardrails (NEVER violate — see `modes/_shared.md` for the full list)
- NEVER auto-submit an application or click submit. Generate; the human acts.
- NEVER invent experience, metrics, employers, or dates. Facts come only from
  `data/cv.master.md` / `data/profile.yml`. If a JD needs something the user
  lacks, say so — don't fabricate.
- NEVER flip a tracker record to `applied` until the user confirms they submitted.
- ALWAYS keep the human in the loop; recommend against pursuing sub-threshold fits.
