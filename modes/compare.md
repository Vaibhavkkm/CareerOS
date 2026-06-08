# mode: compare — rank 2+ postings into an apply-order

Trigger: `/cos compare <2+ JDs | report#s | tracker refs>`. Builds a weighted
scoring matrix across the 6 `_shared.md` dimensions, ranks the postings, names
the deciding factors, and recommends an apply-order. This is **analysis only** —
it writes no report and changes no tracker record.

> Load order (the router already did this): `modes/_shared.md` → this file →
> `data/profile.yml` + `data/cv.master.md` (+ `data/article-digest.md`) →
> `data/_profile.md`. The user's North Star + comp gates live in `profile.yml`.

## Inputs you need
At least **two** postings, given as any mix of:
- **Report numbers** (e.g. `#7 #12`) — read `data/reports/NNN-*.md` and **reuse
  the existing evaluation**. Parse the fenced ```yaml block under the
  **`## Machine Summary`** heading (the same block `scripts/analyze.mjs` reads).
- **Tracker refs** (id or company) — resolve via `node scripts/tracker.mjs list`
  (JSON), then read each record's `report` path and reuse its Machine Summary.
- **Raw JDs / URLs** — these have no evaluation yet (see Step 1).

## Step 1 — Normalize every entry to the 6 dimensions
For each posting, you need a 1–5 score on **Match, North Star, Comp, Culture,
Risk, Global/Logistics** (the `_shared.md` rubric — weights and band meanings
live there; do not restate them).
- **Has a report**: reuse its dimension scores. If a Machine Summary stores only
  the overall `score` + `archetype` + `final_decision`, back-fill any missing
  per-dimension scores from the report's prose blocks; never re-derive numbers
  that already exist.
- **Raw JD with no report**: detect the archetype (`_shared.md`) and score the 6
  dimensions inline here. Do **not** spin up a full `evaluate` run or write a
  report — keep it lightweight and say which scores are fresh vs. reused.
- Apply **hard stops** from `_shared.md` (missing non-negotiable, comp below
  `minimum`, incompatible location) — they cap that posting's overall at 3.4.
  Note the cap in the matrix.

## Step 2 — Build the weighted matrix
Compute each overall as the `_shared.md` weighted sum, rounded to one decimal.
Render one table, highest overall first:

| Rank | Posting (Company — Role) | Match | NS | Comp | Cult | Risk | Logi | **Overall** | Band | Source |
|---|---|---|---|---|---|---|---|---|---|---|

- `Source` = `report #N` (reused) or `fresh` (scored here).
- Show the `_shared.md` decision band per row; flag any hard-stop cap with `†`.
- Break overall ties with: North Star → Comp → lower Risk, in that order.

## Step 3 — Call out the deciding factors
In 3–6 bullets, explain *why the order came out this way* — the dimensions that
actually separated the top picks (not a row-by-row recap). Be concrete:
- "#7 wins on North Star (squarely on-path, a step up) despite #12's higher comp."
- Surface any **legitimacy** concern (`_shared.md` tiers) — a Suspicious posting
  is called out regardless of score; a Proceed-with-Caution is noted.
- Name the closest trade-off (the two postings a reasonable person might reorder).

## Step 4 — Recommend an apply-order
Give a clear, ranked recommendation:
1. **Apply first** — the top pick, with the one-line reason.
2. Then the next, etc. Group anything in the **Skip** band as "skip / revisit"
   and say why; do not pad the order with sub-threshold roles.
- If two are effectively tied, say so and let the user pick — don't fabricate a
  separator that isn't there.

## Step 5 — Hand off
- Suggest building for the top pick: `/cos build-cv #<top report#>` (or the company
  name). If the top pick was a raw JD with no report, suggest `/cos evaluate` on it
  first so there's a report + Machine Summary to build from and track.
- This mode does not create/modify reports or tracker records. If the user wants
  the comparison persisted, point them to `/cos evaluate` per posting.

## Never
Write a report or `pattern-analysis` file · flip or create a tracker record ·
re-score a posting that already has a report (reuse its Machine Summary) ·
fabricate a dimension score or a comp number · ignore a hard stop or a Suspicious
legitimacy tier · invent a ranking gap between effectively tied postings.
