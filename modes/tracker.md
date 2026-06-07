# mode: tracker — view & update the application pipeline

Trigger: `/og tracker [status <X>]` (also "show my tracker", "what have I applied
to", "mark #N as ...", "move Acme to interview"). View the pipeline, filter by
status, and update a record's status/notes — then refresh the generated views.

> Load order (the router already did this): `modes/_shared.md` → this file →
> `data/tracker.jsonl` (TRUTH). The status enum and guardrails come from there.

## What's truth, what's generated (do NOT confuse them)
- `data/tracker.jsonl` is the **SOURCE OF TRUTH** — one record per line
  (`templates/schemas/tracker-record.schema.json`). All edits go **through the
  script**, never by hand.
- `data/tracker.md` and `data/progress.md` are **generated views** — rebuilt from
  the jsonl by `render-views.mjs`. **Never hand-edit them**; your edits get
  overwritten on the next render and they're not read by anything.

## Step 1 — Show the pipeline
- Full table (human view):
  `node scripts/tracker.mjs list --summary`
- Filtered by status (the `[status X]` arg — accepts any alias from
  `templates/states.yml`, e.g. `applied`, `submitted`, `interview`, `offer`):
  `node scripts/tracker.mjs list --status <X> --summary`
- Funnel + averages:
  `node scripts/tracker.mjs stats --summary`
- For your own reasoning (counts, ids, scores), use `--json` instead of
  `--summary` on either; default output is JSON. Present a tight summary to the
  user — don't dump raw JSON unless asked.

## Step 2 — Update a record (when the user reports a change)
Resolve which record first: `list --json`, find the row, note its `id`. Then:

`node scripts/tracker.mjs update --id <N> --status <X> --notes "<one line>"`

(Flags verified in `scripts/tracker.mjs` `update`: requires `--id N`; `--status`
is normalized to a canonical id via `lib/states.mjs` (invalid → error); also
accepts `--score`, `--notes`, `--url`, `--report`, `--archetype`, `--legitimacy`,
`--cv_pdf`, `--cl_pdf`, `--follow_ups`, `--date`. It stamps `last_action`
automatically. Add `--summary` for a human line instead of JSON.)

**Status flow** (per `templates/states.yml`, by rank): `evaluated → applied →
responded → interview → offer`; terminal off-ramps `rejected` / `discarded` /
`skip`. Don't invent statuses; pass what the user means and let the script
normalize the alias. Skipping forward (e.g. `evaluated → interview`) is allowed,
but confirm it's not a typo.

## Step 3 — Confirm before `applied` (HARD GUARDRAIL)
Never flip a record to `applied` unless the user **confirms in their own words**
that they personally submitted (see `_shared.md` guardrails). "Did it go through?"
is not confirmation — wait for "yes, submitted". The same applies to claiming an
`offer` or marking `interview` — set it only on the user's word, never inferred.
You never auto-submit and never advance status on your own.

## Step 4 — Refresh the generated views (after ANY write)
Any `update` (or `add`) changes the truth, so re-render the views:

`node scripts/render-views.mjs --summary`

(writes `data/tracker.md` + `data/progress.md` from the jsonl; idempotent —
re-running yields identical files. `--summary` prints what it wrote + record
count; default is JSON.)

## Step 5 — Lint the pipeline
`node scripts/verify-pipeline.mjs --summary`

Read-only linter (exit 1 on any error). Flags: non-canonical status, duplicate
opening (same company+role), missing required field (`id/date/company/role/status`),
score out of `0..5`, a `report` path that doesn't resolve on disk, duplicate ids.
If it reports errors, fix the offending record via `tracker.mjs update` (or, for a
true duplicate, tell the user — don't silently delete a line), then re-render and
re-lint until clean.

## Step 6 — Report back
Give the user: what changed (`#id` old → new status), the refreshed counts /
funnel from Step 1, and any lint warnings. Point them at `data/tracker.md`
(table) and `data/progress.md` (funnel) as the human-readable views. This mode
views/edits records — it does NOT write an eval report, so no Machine Summary is
produced here (that's `evaluate`).

## Never
Hand-edit `tracker.md` / `progress.md` (they're generated) · edit `tracker.jsonl`
by hand (go through the script) · flip a record to `applied`/`interview`/`offer`
without the user's explicit confirmation · invent a non-canonical status · skip the
re-render or the lint after a write · delete a record line to "fix" a lint error.
