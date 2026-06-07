# mode: batch — resumable mass evaluation of a queue of postings

Trigger: `/og batch`. Drives `scripts/batch.mjs` to evaluate a whole list of
postings one at a time, reserving report numbers so the run can be **stopped and
resumed at any point** without losing or colliding work. The script only
orchestrates state — YOU do each per-row evaluation by running the `evaluate`
playbook (`modes/evaluate.md`).

> Load order (router did this): `modes/_shared.md` → this file → `modes/evaluate.md`
> → `data/profile.yml` + `data/cv.master.md` (+ `data/article-digest.md`) →
> `data/_profile.md`. The rubric, archetypes, legitimacy tiers, and guardrails all
> live in `_shared.md` — reference them, don't restate.

## Inputs you need
- `data/batch/batch-input.tsv` — one posting per line, **tab-separated**:
  `url<TAB>company<TAB>title` (a `url\tcompany\ttitle` header is optional; blank
  lines and rows with no url are skipped). USER data — never auto-clobber it; if it
  is missing or empty, ask the user to fill it and stop.
- Everything `evaluate` needs (master facts + profile). Ground truth — never invent.

State lives in `data/batch/batch-state.tsv`
(`url status report_num score retries updated`, `status ∈ pending|processing|completed|failed`).
The script writes this file; treat it as the source of truth for progress.

## Step 1 — Seed / refresh the queue
`node scripts/batch.mjs init` — adds new input urls as `pending`; existing rows are
**kept as-is** (this is what makes re-running safe). Add `--retry-failed` to also
reset `failed` rows back to `pending`, or `--start-from N` to skip input rows before
1-based index N. Use `--dry-run` to preview without writing.
Then `node scripts/batch.mjs status --summary` to show the counts.

## Step 2 — The loop (repeat until no pending rows)
For each row:
1. **Reserve + claim:** `node scripts/batch.mjs next --json`. This atomically
   reserves the next report number (= max NNN in `data/reports/` and max in state,
   +1), marks the row `processing`, and **persists before returning** — so a crash
   mid-row can't double-assign a number. It prints `{url, company, title,
   report_num, status}`. If it prints `{row:null, message:"no pending rows"}`, the
   queue is drained — go to Step 4.
2. **Evaluate that row:** run the full `evaluate` playbook (`modes/evaluate.md`) on
   `url`, but write the report to the **reserved** number: `data/reports/<report_num>-<slug>-<DATE>.md`,
   ending in the fenced `yaml` Machine Summary (schema
   `templates/schemas/machine-summary.schema.json`; do not invent — score honestly,
   apply hard-stop caps from `_shared.md`).
3. **Stage the tracker record (don't write `tracker.jsonl` directly):** append the
   `evaluate` record as one JSON line to `data/batch/tracker-additions/<report_num>.jsonl`
   (`status:"evaluated"`, with `report:"reports/<report_num>-slug-DATE.md"`, score,
   archetype, legitimacy, url). `merge-tracker.mjs` folds these in at the end.
4. **Record the outcome:**
   - Success: `node scripts/batch.mjs complete --url <U> --report <N> --score <S>`
     (`S` = the weighted overall from the Machine Summary; `N` = the reserved number).
   - Failure (couldn't fetch the JD, eval blocked, etc.):
     `node scripts/batch.mjs fail --url <U>` — bumps `retries`, marks `failed`. Note
     why; do not fabricate a report to "succeed".
5. `node scripts/batch.mjs status --summary`, then go back to (1).

> **Resumability:** the whole loop is restartable. If the session ends, `/og batch`
> again and just resume from Step 2 — `next` only ever hands out `pending` rows and a
> fresh report number, and `completed` rows are never revisited. Re-running `init`
> never disturbs in-flight or finished rows.

## Step 3 — Requeue failures (optional)
`node scripts/batch.mjs --retry-failed` (or `init --retry-failed`) resets all
`failed` rows to `pending` while **preserving their retry counter**, then return to
Step 2 for them. Don't retry a genuine hard stop (e.g. comp below `minimum`,
unmeetable visa) — those are honest `Skip`s, not failures.

## Step 4 — Merge + verify (run once the queue is drained)
1. `node scripts/batch.mjs status --summary` — confirm `pending` and `processing`
   are both 0 (a stuck `processing` row means an interrupted eval — re-run its `next`
   work or `fail` it).
2. `node scripts/merge-tracker.mjs --summary` — upserts every
   `data/batch/tracker-additions/*.jsonl` into `data/tracker.jsonl` (dedup by
   report# → id → company+role) and moves processed files to `data/batch/merged/`.
   Use `--dry-run` first if you want a preview.
3. `node scripts/merge-tracker.mjs` is the only thing that touches `tracker.jsonl`
   here; rebuild the human views afterward with `node scripts/render-views.mjs` if
   the user wants `tracker.md`/`progress.md` refreshed.
4. `node scripts/verify-pipeline.mjs --summary` — read-only lint of
   `tracker.jsonl` (canonical statuses, no duplicate openings, required fields,
   scores in 0..5, report links resolve, unique ids). Fix any reported errors before
   handing off; exit 1 means the pipeline is dirty.

## Step 5 — Hand off
Report: how many evaluated, the score distribution / decision bands, the top
**Apply** candidates (company · score · report path), and any `failed` rows with the
reason. Suggest `/og build-cv <NNN>` for the priority hits (≥ `compile_score_threshold`).
Do **not** auto-build CVs, auto-submit, or flip any record past `evaluated` — that
stays a per-application, human-confirmed decision.

## Never
Auto-submit or flip a record to `applied` · fabricate a report/score to clear a row
(use `fail`) · write `data/tracker.jsonl` directly (stage to `tracker-additions/`,
then `merge-tracker`) · overwrite an existing report or reuse a report number (always
take the one `next` reserved) · clobber the user's `batch-input.tsv` · skip the final
`merge-tracker` + `verify-pipeline` · share the user's phone.
