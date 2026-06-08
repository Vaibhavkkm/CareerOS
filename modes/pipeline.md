# mode: pipeline — work the `data/inbox.md` URL queue end-to-end

Trigger: `/cos pipeline`. Drains the human's bookmarked queue: for every unchecked
item in `data/inbox.md`, run the full auto-pipeline, tick the item, and report a
roll-up table. This is the *light* queue runner; for tens/hundreds of URLs that
need a resumable TSV state machine, use `batch` instead.

> Load order (the router already did this): `modes/_shared.md` → this file →
> `data/profile.yml` + `data/cv.master.md`. Per-item work is delegated to
> `modes/auto-pipeline.md`; read it once before you start the loop.

## The queue format
`data/inbox.md` is a markdown checklist the user maintains by hand. Each task line:

```
- [ ] <url> | <company> | <title>
```

`company`/`title` are optional hints (use them; the JD is still ground truth).
`- [ ]` = pending, `- [x]` = done. **This is USER data** — never reorder, rewrite,
or clobber it. Your only write is flipping a leading `[ ]` to `[x]` on a line you
just finished, preserving the rest of the line verbatim (see Step 3).

## Step 0 — Read and plan
1. Read `data/inbox.md`. If missing/empty, tell the user to add `- [ ] url | …`
   lines (or run `scan`/`batch`) and stop.
2. Collect the **unchecked** items in file order. Ignore `[x]` lines and any line
   not matching the task shape. Report the count, e.g. "5 pending, 0 done".
3. Skim for obvious dupes of existing `data/reports/` (same company+role). Dedup is
   ultimately enforced by `lib/records.mjs` when tracking — don't pre-skip, just note.

## Step 1 — Process each item (delegate to auto-pipeline)
For each unchecked item, run the **`modes/auto-pipeline.md`** playbook on its URL:
extract → evaluate (A–G report with the embedded ```yaml Machine Summary) → write
`data/reports/NNN-slug-DATE.md` → **build a tailored CV iff score ≥
`compile_score_threshold`** (from `data/profile.yml`, default 3.0; see `_shared.md`
"Gates") → **pre-draft answers iff score ≥ `draft_answers_threshold`** (default 4.5)
→ track. auto-pipeline owns the compile-gate, the `compile-latex.mjs` smoke test,
the learning-loop snapshot, and the tracker write (`scripts/tracker.mjs add`,
dedup via `lib/records.mjs`). Don't re-implement any of that here.

Carry the line's `company`/`title` hints into auto-pipeline as a head start, but let
the fetched JD override them. If extraction fails (dead link, login wall), record a
`Skip`/error row, leave the checkbox **unchecked**, and move on — never invent a JD.

## Step 2 — Parallelism (optional, ONLY if 3+ items)
With 3+ pending items you MAY fan out to subagents to amortize the work, BUT:
- **Never run 2+ browser/`WebFetch` agents concurrently.** Fetch/extraction is the
  one strictly-serial stage — run all live retrievals one at a time (or pre-fetch
  serially into per-item JD text, then parallelize the rest).
- Only the token-heavy *judgment/drafting* stages (evaluate, draft, compile) may run
  in parallel subagents, each scoped to one already-fetched item.
- Reserve a distinct report number per item BEFORE fanning out so two agents can't
  collide on `NNN` (max existing `data/reports/NNN-*` + 1, allocated up front).
- Each subagent returns its Machine Summary fields + report path; the parent does all
  inbox/tracker writes (Step 3) **serially** to avoid corrupting USER files.

If in doubt, run serially. Correctness and the no-concurrent-fetch rule beat speed.

## Step 3 — Tick the queue (USER file — surgical edit only)
After an item's report is written and tracked, flip **only that line's** `- [ ]`
to `- [x]`, leaving `url | company | title` byte-for-byte unchanged. Edit per item
(or batch the flips at the end) — but only tick lines that truly completed. A
skipped/errored item stays `[ ]` so the user (or a re-run) can retry it. Never
delete lines, never re-sort, never touch `[x]` lines.

## Step 4 — Roll-up summary
Print one table over everything processed this run:

| Company | Role | Score | Decision | Report | Status |
|---|---|---|---|---|---|
| Acme | Staff SWE | 4.3 | Apply | `reports/007-acme-2026-06-07.md` | ticked |
| Globex | Backend | 2.8 | Skip | `reports/008-globex-2026-06-07.md` | ticked |
| Initech | (fetch failed) | — | error | — | left `[ ]` |

Pull `score`/`final_decision` from each report's Machine Summary. Then state, per
`_shared.md` decision bands: which CVs were built (≥ compile threshold) vs gated, any
**Suspicious** legitimacy tiers to warn on, and the queue tally (e.g. "4 done, 1 left
for retry"). Recommend next actions (e.g. `/cos build-cl <report#>` for the priority
Applys); do not act on them unprompted.

## Never
Auto-submit or flip any tracker record to `applied` (human confirms — see
`_shared.md` Guardrails) · fabricate a JD/metric when a fetch fails · run 2+
browser/WebFetch agents at once · reorder, rewrite, or delete `data/inbox.md` lines
(only `[ ]`→`[x]` on completed items) · tick a skipped/errored item · bypass
auto-pipeline's compile-gate or its `compile-latex.mjs` smoke test.
