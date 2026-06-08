# mode: interview-prep — audience-segmented prep + STAR+R story mapping

Trigger: `/cos interview-prep <company> <role>`. Auto-suggest this when a tracker
record reaches status `interview` (see `templates/states.yml`). Produces an
audience-segmented prep doc (round breakdown, likely Qs per audience, a technical
checklist, behavioral-Q → story map) and grows an append-only story bank. No
script — this is a pure agent playbook.

> Load order: `_shared.md` → this file → `data/profile.yml` + `data/cv.master.md`
> (+ `data/article-digest.md`) → `data/_profile.md`. You need the candidate's
> ground truth to build STAR+R stories — never invent one.

## Inputs you need
- `<company>` and `<role>` (from args, or the tracker record at status `interview`).
- If a report exists, read `data/reports/NNN-*.md` for archetype, score, must-haves,
  and `soft_gaps` (gaps = likely probe areas).
- If a research brief exists at `data/interview-prep/<company>-<role>.md` or from
  `modes/research.md` output, reuse its findings (interviewers, eng culture,
  challenges, smart questions) — extend, don't redo. Run WebSearch/WebFetch only to
  fill gaps (interview format from Glassdoor/blog, named interviewers from LinkedIn).
- The candidate's facts: `narrative` (superpowers, proof_points, exit_story) +
  matching bullets/metrics in `data/cv.master.md` / `data/article-digest.md`.

## Step 1 — Detect archetype + round breakdown
Detect the role's archetype (see `_shared.md`); it drives the technical checklist.
Lay out the likely loop as rounds, each tagged with its **audience**: recruiter /
hiring-manager / peer-technical / panel. Note format (phone/onsite/take-home),
duration, and order if known. Label each fact **sourced** (with URL) or
**[inferred]** from the archetype/JD — never present a guess as confirmed.

## Step 2 — Likely questions, per audience
For each audience present, list 4–8 likely questions. Tag every one **sourced**
(cite the URL) or **[inferred]**.
- **Recruiter** — motivation, comp expectations (use `compensation.target_range`),
  timeline, logistics/visa, the exit-story narrative. Never volunteer the phone
  number; comp talk stays in the user's stated range.
- **Hiring-manager** — ownership, scope, the role's first-90-days challenges (from
  research Axis 4), tradeoffs, why-this-company/why-now.
- **Peer-technical** — archetype-specific depth (see `_shared.md` archetypes:
  Backend → systems design/latency/data; Platform → k8s/CI-CD/observability;
  Data/ML → pipelines/features/inference; etc.), debugging, collaboration.
- **Panel** — cross-functional, conflict, leadership/influence, values fit; map
  each to the company's stated values where sourced.

## Step 3 — Technical checklist
A focused, archetype-driven checklist of what to drill before the loop: 6–12
concrete topics (concepts, tools, a likely system-design prompt, the company's own
stack from research). Mark each topic the candidate is **strong** / **brush up** /
**gap** by comparing the JD must-haves against `data/cv.master.md`. Be honest about
gaps (see `_shared.md` guardrails) — surface them so the user can prep, don't paper
over them.

## Step 4 — Behavioral-Q → STAR+R story map (the differentiator)
Each story is **STAR+R**: Situation, Task, Action, Result (quantified, REAL — pull
from `cv.master.md` / `article-digest.md`, never fabricate a metric), **+ Reflection**
(what you learned / would do differently). Then map the likely behavioral questions
(conflict, failure, leadership, ambiguity, biggest impact, disagreement with a
manager) → the specific story that best answers each. Reuse stories across questions;
flag any question with **no** backing story as a prep gap (the user must supply a
real one — do not invent it). Keep stories in the candidate's voice (see `_shared.md`).

## Step 5 — Append new stories to the story bank (append-only)
Maintain `data/interview-prep/story-bank.md` (create it if missing, with a short
header). For any NEW STAR+R story you surfaced in Step 4 that isn't already banked,
**append** it under a dated `## <story title> — <YYYY-MM-DD>` section with its S/T/A/R+R
and `tags:` (archetype + skills + behavioral themes it covers). Never rewrite or
delete existing entries — this is User data (see DATA_CONTRACT.md), append only.
Skip a story already present (dedup by title/result).

## Step 6 — Write the prep doc
Write to `data/interview-prep/<company>-<role>.md` (slugify both). This is User data:
if the file exists (e.g. a research brief), **append a dated `## Interview prep —
<YYYY-MM-DD>` section** rather than clobbering it. Include the round breakdown,
per-audience Qs, technical checklist, behavioral→story map, and a short
**Questions to ask them** list (3–5, from research; smart, specific, never generic).
Embed the Machine Summary below so the prep is machine-readable. End with: re-read
the story bank, drill the brush-up/gap topics, and that you never auto-submit or
schedule anything — the user drives.

## Step 7 — Machine Summary (REQUIRED)
The prep doc MUST embed a fenced ```yaml Machine Summary per
`templates/schemas/machine-summary.schema.json` (`company`, `role`, `score` [from
the report or `null`], `archetype`, `final_decision`, `report_num`; set
`next_action: "interview-prep"`). Then offer to update the tracker:
`node scripts/tracker.mjs update --id <id> --status interview --last_action <YYYY-MM-DD> --notes "prep: <company>-<role>"`.
Only flip status with the user's confirmation (see `_shared.md` guardrails).

## Never
Fabricate a story, metric, interviewer name, or interview format · present
**[inferred]** as **sourced** · paper over a technical/story gap · clobber or rewrite
the story bank or an existing prep file (append only) · share the user's phone or
go off the user's stated comp range · auto-submit/schedule/confirm anything ·
flip a record's status without the user's say-so.
