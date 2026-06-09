# mode: mock — live mock interview drill (ask → answer → score → bank weak spots)

Trigger: `/cos mock <company> <role>` (or `/cos mock <role>` for a generic drill).
Where `interview-prep` PRODUCES a prep doc to read, **mock** RUNS the interview: it
asks one question at a time, waits for the user's real answer, scores it, and banks
the weak spots so the next drill targets them. Pure agent playbook — no script.

> Load order (the router did this): `modes/_shared.md` → this file →
> `data/profile.yml` + `data/cv.master.md` (+ `data/article-digest.md`) →
> `data/_profile.md`. You score against the candidate's REAL facts — never coach
> them to fabricate.

## Inputs you need
- `<company>`/`<role>` (or just a role/archetype). If a prep doc exists at
  `data/interview-prep/<company>-<role>.md`, **draw the question set from it** (its
  per-audience Qs + technical checklist) so the drill matches the real loop. If a
  report exists, read `data/reports/NNN-*.md` for must-haves + `soft_gaps` (gaps =
  the areas to probe hardest).
- The story bank `data/interview-prep/story-bank.md` (if present) — so you can tell
  the user when an answer maps to a banked STAR+R story (or reveals a missing one).
- Any prior drill log `data/interview-prep/mock-log.md` — re-drill past weak spots first.

## Step 0 — Set up the session
Ask the user two things and then START:
1. **Round focus** — recruiter / hiring-manager / peer-technical / behavioral / mixed
   (default: mixed, weighted to the report's `soft_gaps`).
2. **Length** — how many questions (default 6) and whether they want **hints on
   request** only (recommended) or after every answer.
Tell them how it works: you ask ONE question, they type their answer as they'd say
it out loud, you score + give tight feedback, then the next question. They can type
`hint`, `skip`, `model` (show a model answer), or `stop` at any time.

## Step 1 — Ask one question at a time (THE core loop)
Ask exactly ONE question, tagged with its audience and what it probes
(e.g. *[peer-technical · system design]*). Mix archetype-appropriate technical
questions (from `_shared.md` archetypes + the JD stack) with behavioral ones. Pull
behavioral prompts that the user has a REAL story for (cross `cv.master.md` /
story-bank), plus 1–2 that expose a `soft_gap`. **Then WAIT for the user's answer.
Do not ask the next question, and do not answer for them, until they respond.**

## Step 2 — Score each answer (consistent rubric, 1–5)
After each answer, score it 1–5 and give 2–4 lines of specific feedback. Rubric:
- **Behavioral** — STAR+R completeness (was there a Situation, Task, Action, a
  **quantified real** Result, and a Reflection?), ownership ("I" vs "we"), concision,
  and whether the metric is grounded in `cv.master.md` (flag any number you can't
  trace — never reward a fabricated one).
- **Technical** — correctness, depth, tradeoff awareness, structure (did they clarify
  scope before designing?), and communication.
- **Recruiter/HM** — clarity of motivation, fit narrative, comp framed within
  `compensation.target_range`, no rambling.
Feedback format per answer: `Score n/5 — what worked — what to fix — one concrete
upgrade`. Be honest but encouraging; cite the exact phrase to change. If they typed
`model`, give a model answer grounded ONLY in their real facts (show how to reframe
what they already have — don't invent experience).

## Step 3 — Track weak spots across the session
Keep a running tally: per question, its topic/audience + the score. A weak spot =
any answer scoring ≤ 3, or a behavioral question with **no backing story**, or a
technical topic the user couldn't go deep on. Note these as you go.

## Step 4 — Wrap-up scorecard
After the last question (or `stop`), print a scorecard:
- Per-question topic + score; the **average** and a band (strong ≥4.2 / solid ≥3.5 /
  needs-work < 3.5).
- **Top 3 weak spots** with a one-line drill plan each (a topic to study, a story to
  build, a phrasing to tighten).
- **Missing stories** — any behavioral question with no real backing story (the user
  must supply a real experience; do NOT invent one).

## Step 5 — Bank the result (append-only User data)
Append a dated section to `data/interview-prep/mock-log.md` (create with a short
header if missing): `## Mock — <company>/<role> — <YYYY-MM-DD>` with the per-question
scores, the average/band, and the weak-spot list + drill plan. Append only — never
rewrite past entries (DATA_CONTRACT.md). This is what makes the NEXT `/cos mock`
re-drill the user's actual weak spots first. If Step 4 surfaced a strong NEW STAR+R
story, suggest the user run `/cos interview-prep` to formalise it into the story bank.

## Step 6 — Hand off
Point at the log, recommend the single highest-value drill next, and remind them this
is practice — you never schedule or submit anything. Offer a focused re-drill
(`/cos mock <company> <role>` again to hit just the weak spots).

## Never
Fabricate a question's "expected" answer as fact · reward or coach a fabricated
metric/experience · answer your own question before the user does · rush multiple
questions without waiting · clobber the mock log or story bank (append only) · push
past the user's stated comp range · be cruel — score honestly but constructively.
