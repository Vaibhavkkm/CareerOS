# mode: auto-pipeline — paste a JD/URL, get the full chain

Trigger: a bare job posting (URL, or pasted text with role/responsibilities/
requirements signals) with **no** recognized mode token — the router routes here.
This chains: extract → evaluate → (build CV/CL if worth it) → (pre-draft answers if
worth it) → ensure tracker row. You orchestrate the other modes; you do not
restate them.

> Load order (router already did it): `_shared.md` → this file → `data/profile.yml`
> + `data/cv.master.md` (+ `data/article-digest.md`) → `data/_profile.md`. Read the
> gates (`compile_score_threshold` default 3.0, `draft_answers_threshold` default
> 4.5) from `data/profile.yml`; see `_shared.md`.

## Operating rule — never abort the chain
Run the steps in order. If a step fails (bad fetch, compile error, missing fact),
**mark it failed, capture the reason, and continue** to the next step. Surface
every failure in the final hand-off. Human-in-the-loop throughout: you stop at
"present results + recommended action" — you NEVER submit (see `_shared.md`).

## Step 0 — Scrape the FULL posting
1. If the input is a **URL**: run `node scripts/fetch-jd.mjs "<url>" --json` FIRST.
   It scrapes the entire posting — via the ATS's own API for Greenhouse / Lever /
   Ashby / Workable / Recruitee / SmartRecruiters, else the page HTML — and saves
   the full text to `data/jds/`. Use its `saved_to` file as the JD.
   - If it returns `needs_agent_fetch: true` (JS-rendered / login-walled / blocked),
     **WebFetch the URL yourself** as a fallback, then save what you captured to
     `data/jds/<company>-<role>-<DATE>.md` and continue.
   - If both fail, say so, ask the user to paste the JD, and mark Step 0 degraded.
2. If the input is **pasted text** or a `data/jds/<file>`: use it directly.
3. Capture EVERYTHING the employer posted — not just the requirements: company,
   role, location/remote, comp + benefits, responsibilities, must-haves AND
   nice-to-haves, tech stack, team, application questions, deadlines, and any
   company blurb. Keep the source `url`. If you can't identify company or role, ask
   once; don't guess into a tracker row.

## Step 1 — Evaluate (always runs)
Run the **`evaluate.md`** playbook on the extracted JD. That produces the A–G
report at `data/reports/NNN-slug-DATE.md` (next free `NNN`; `DATE` = today),
its embedded fenced ```yaml **Machine Summary** (schema:
`templates/schemas/machine-summary.schema.json`), and the `evaluated` tracker row.
Carry forward from the Machine Summary: `score`, `archetype`, `final_decision`,
`legitimacy_tier`, `report_num`, `hard_stops`, `soft_gaps`, `next_action`.
If evaluate fails to produce a score, mark Step 1 failed, treat `score` as unknown
(gates below are NOT met), and continue.

## Step 2 — Build documents (gated)
IF `score >= compile_score_threshold` **and** no hard stop:
1. Run the **`build-cv.md`** playbook for this report# (it snapshots + compiles +
   smoke-tests the CV). Pass the report number so it reuses the archetype/keywords.
2. A cover letter only if the JD **requests** one or the user wants one (ask if
   unsure, or if `score >= 4.0`): run **`build-cl.md`** for the same report#.
ELSE: skip building, state the score is below the compile gate, and recommend
against spending a compile (offer to build anyway if the user insists).
If a build step's compile fails, keep the failed `.tex` path, mark the step failed,
and continue — do not abort.

## Step 3 — Pre-draft application answers (gated)
IF `score >= draft_answers_threshold` **and** no hard stop:
- Pre-draft answers to the posting's common application questions (e.g. "why this
  company", "why you", salary expectation framing, work-authorization, notice
  period) grounded ONLY in `data/cv.master.md` / `data/profile.yml`. Use the
  **`apply.md`** voice/answer rules.
- Append them to the report under a new **`## Block H — Pre-drafted answers`**
  section. These are DRAFTS for the user to review and paste — **never submit**,
  never auto-fill a form, never put the user's phone in outreach (`_shared.md`).
ELSE: skip; note answers will be drafted live via `apply.md` if/when they apply.

## Step 4 — Ensure the tracker row (always)
`evaluate` (Step 1) normally writes the `evaluated` row. Verify it exists; if Step 1
failed or skipped it, create it now (status `evaluated`, never `applied`):
`node scripts/tracker.mjs update --id <id> --report "reports/NNN-slug-DATE.md"` to
backfill the report path, and if a CV/CL was built:
`node scripts/tracker.mjs update --id <id> --cv_pdf "<path>" --cl_pdf "<path>"`.
If no row exists at all:
`node scripts/tracker.mjs add --company "<co>" --role "<role>" --score <X.X> --status evaluated --archetype "<arch>" --legitimacy "<tier>" --url "<url>" --report "reports/NNN-slug-DATE.md"`.
Report path is relative (e.g. `reports/007-acme-2026-06-07.md`), score is X.X.
NEVER flip status to `applied` here — only the user confirming a real submission does that.

## Step 5 — Hand off (human-in-the-loop)
Present in a few lines:
- **Verdict**: score `X.X/5` → `final_decision` (band from `_shared.md`),
  legitimacy tier, and any hard stops / top soft gaps.
- **Artifacts produced**: report path, CV/CL PDF paths (or "skipped — below gate"),
  and whether Block H answers were pre-drafted.
- **Step status line**: e.g. `extract ok · eval ok · cv ok · cl skipped · answers
  skipped (score<gate) · tracker ok` — list any failure reasons.
- **Recommended next action** (the user decides): for an Apply-band fit, "review
  the CV, then run `/og apply` when you submit"; for a Skip, recommend against and
  stop. Offer to override any gate on request.

## Never
Auto-submit or auto-fill any form · fabricate facts/metrics/dates to clear a gate ·
flip a tracker row to `applied` · abort the chain on a single step's failure ·
build documents below the compile gate without the user's say-so · re-run
`evaluate` if a fresh report for this posting already exists (offer to reuse it).
