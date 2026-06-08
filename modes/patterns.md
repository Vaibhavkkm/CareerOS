# mode: patterns — outcome analytics + threshold retune (close the loop)

Trigger: `/cos patterns`. Read what actually happened across your pipeline —
funnel, conversion by archetype, blocker frequency, score-vs-outcome — then
recommend (and, with your OK, write back) a tuned `compile_score_threshold`.
This is the analytics half of the learning loop: `style-learn` learns from your
*edits*; `patterns` learns from your *outcomes*.

> Load order (the router did this): `modes/_shared.md` → this file →
> `data/profile.yml`. The script reads `data/tracker.jsonl` (truth) + each linked
> report's embedded ```yaml Machine Summary``` — it never scrapes report prose.

## What it needs
- `data/tracker.jsonl` with **≥5 DECIDED applications** (anything past `evaluated`/
  `applied` — i.e. responded/interview/offer/rejected/skip/discarded). `analyze.mjs`
  `MIN_THRESHOLD` is 5 and gates on *decided* count, not total. Below it, every
  rate is still computed but flagged **provisional** — present, don't over-claim.
- Reports linked from records via their `report` field, each carrying a valid
  Machine Summary (`templates/schemas/machine-summary.schema.json`) so `archetype`,
  `legitimacy_tier`, `hard_stops`, `soft_gaps` can be tallied. Records with no
  parsed summary still count in the funnel — note `reports_with_summary` coverage.

## Step 1 — Run the analysis
Run:
`node scripts/analyze.mjs --summary`
This prints the human view AND (default) writes a snapshot to
`data/reports/pattern-analysis-<today>.md` with both the rendered text and a
```yaml Machine Summary``` of the full result. Use `--today=YYYY-MM-DD` to pin
the date; `--no-snapshot` to inspect without writing (the snapshot is a System-
generated report, not hand-edited USER content, so writing it is fine by default).
For the structured object instead, drop `--summary` (JSON is the default) or add
`--json`. If it reports `no applications in tracker`, stop — there's nothing yet.

## Step 2 — Read the numbers honestly
From the output, surface for the user (don't just dump the block):
1. **Funnel + outcomes** — where applications stall; positive / negative /
   self_filtered / pending split.
2. **Score vs outcome** — avg/range of scores that converted vs got rejected.
   Big overlap = the score isn't separating well; large gap = the gate is working.
3. **Conversion by archetype** — which `target_roles.archetypes` (see `_shared.md`)
   actually convert. Low rate on a "primary" fit is a strong signal worth naming.
4. **Conversion by legitimacy tier** — confirm `Suspicious`/`Proceed with Caution`
   postings are underperforming (expected); if `High Confidence` converts poorly,
   the problem is fit or documents, not sourcing.
5. **Top blockers** — the most frequent `hard_stops` (structural — usually not
   fixable by editing) and `soft_gaps` (often addressable in `cv.master.md` framing
   or by re-targeting). Recurring hard stops mean you're applying off-North-Star.
If `sufficient: false`, lead with that caveat — call everything directional.

## Step 3 — The recommended threshold
The script computes `compile_score_threshold` as the **lowest eval score among
positive outcomes** (offer/interview/responded): no scored application below it has
ever converted, so compiling below it has historically wasted effort. Report
`value` and `reason`. Edge cases the script already encodes — relay them as-is:
- no scored positive outcomes yet → `value: null`, insufficient data → **do not
  propose a change**.
- decided `< MIN_THRESHOLD` → reason is `provisional`; offer it as a suggestion
  only, not a confident retune.
Sanity-check it against `_shared.md`'s decision bands before suggesting: don't push
the gate so high it would have skipped roles the user *wants* (a high recommendation
can mean too few applications, not a real signal).

## Step 4 — OFFER the write-back (ASK FIRST — `profile.yml` is USER data)
`data/profile.yml` is the User layer (see `DATA_CONTRACT.md`) and is **never
auto-modified**. Show the user the diff in plain terms — current
`compile_score_threshold` (default 3.0, the gate `build-cv`/`auto-pipeline` use)
vs the recommended value — and ask explicitly whether to apply it. Only on a clear
yes, edit the single top-level `compile_score_threshold:` line in `data/profile.yml`
(keep the trailing comment), changing nothing else. Then confirm the new value and
note it takes effect on the next build/evaluate. If they decline, leave the file
untouched — the snapshot already records the recommendation for later.

## Step 5 — Hand off
Point the user to `data/reports/pattern-analysis-<today>.md`. Suggest the obvious
next moves the data implies, e.g.: re-target away from a low-converting archetype,
address a recurring `soft_gap` in `data/cv.master.md`, stop sourcing `Suspicious`
postings, or run `/cos patterns` again after the next batch of decisions lands.

## Never
Treat <5 decided apps as conclusive · scrape report prose instead of the Machine
Summary · write `compile_score_threshold` into `profile.yml` without explicit
confirmation · edit any other line of `profile.yml` · recommend a change when
`value` is null · flip any tracker record's status here (this mode is read-only on
the tracker) · propose a gate that would skip the user's stated target roles.
