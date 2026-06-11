# mode: followup — nudge the right applications, in your own voice

Trigger: `/cos followup [--overdue-only]`. Surfaces which live applications are due
for a nudge, drafts the follow-up messages (never auto-sends), and — only after
you confirm you sent one — bumps the tracker record so the cadence resets.

Also check the PEOPLE ledger: `node scripts/contacts.mjs list --due` surfaces
recruiters/referrers whose `next_followup` has arrived — include them in the
plan, and after the user confirms an outreach, log it with
`node scripts/contacts.mjs touch --id <id> [--status replied] [--next <date>]`.
(NEVER share the user's phone number in these messages — `_shared.md` rule.)

> Load order (router did this): `modes/_shared.md` → this file →
> `data/profile.yml` + `data/cv.master.md` (+ `data/_profile.md` last). Tracker
> truth is `data/tracker.jsonl`; never hand-edit the rendered `tracker.md`.

## Cadence (defined in `scripts/followup.mjs` — do not restate elsewhere)
`CADENCE` = days until the next nudge per status: `applied` 7, `responded` 1,
`interview` 1. Only those statuses are actionable; terminal/dormant ones are
skipped. Anchor = `last_action` (else `date`). Past `COLD_DAYS` (21) quiet, a
lead is `cold` regardless of due date. Buckets: **cold · overdue · urgent ·
waiting**.

## Step 1 — Show the dashboard
Run:
`node scripts/followup.mjs --summary`
(add `--overdue-only` to keep only **overdue + cold** — the filter intentionally
drops urgent/waiting). For a deterministic "today" in tests use
`--today=YYYY-MM-DD`; for machine output use `--json` (default; `--summary`
suppresses it). Read the grouped output: each row gives `#id company — role
[status]`, the due date / days overdue, days quiet, nudge count, and any `✉`
contacts parsed from the record's `notes`.

If nothing is actionable, say so and stop — don't manufacture a reason to ping.

## Step 2 — Pick targets
Default to the most pressing buckets first (cold, then overdue, then urgent).
Tell the user the shortlist and ask which ones to draft for. Don't draft for
`waiting` rows unless the user asks. If a row is `cold`, flag it: a 21-day-silent
lead may warrant a final, graceful note rather than a routine nudge.

## Step 3 — Gather per-target context
For each chosen `#id`, pull from `data/tracker.jsonl`: company, role, status,
`last_action`, `follow_ups`, contacts. Then read its report
`data/reports/NNN-*.md` (the `report` field / Machine Summary) for the specific
hook — `top_strengths`, the role's must-haves, the company signal that scored it
well. That report context is what makes the note *specific*, not generic.

## Step 4 — Draft the follow-up (candidate voice, no filler)
Write each message in the user's voice (`data/profile.yml narrative.voice` +
active rules in `data/style/profile.json`; see `_shared.md` Voice & quality).
Per message:
- **Subject** (if email): concrete — role + a specific anchor, never "Following up".
- **3–5 sentences max**: reference a real, specific signal from the report/JD;
  restate one quantified proof point that maps to their need (grounded in
  `data/cv.master.md` — never invent); make ONE clear ask (timeline / next step).
- Reflect the bucket: `responded`/`interview` (1-day cadence) = fast, warm reply;
  `applied` (7-day) = a value-add nudge; `cold` = a brief, no-pressure close-out.
- Address a real contact from `contacts` when present; otherwise keep it routable
  to a generic recruiting alias — do **not** address by a name you don't have.
- Show the draft(s) and stop. The user sends; you never send or auto-submit.

## Step 5 — Bump the record (ONLY after the user confirms they sent it)
Wait for explicit confirmation ("sent #3"). Then, for each sent one:
`node scripts/tracker.mjs update --id N --notes "followed up YYYY-MM-DD: <1-line gist>" --follow_ups <prev+1>`
`update` auto-stamps `last_action` to today, which re-anchors the cadence so the
next run recomputes the due date. Append to `notes` (don't clobber prior history);
read the current `notes`/`follow_ups` first. Re-run Step 1 to confirm the row
moved out of its bucket. If they got a reply, advance status instead
(e.g. `--status responded`) — but never flip to `applied`/any status the user
hasn't confirmed.

## Output
This mode drafts; it doesn't produce an evaluation, so no report/Machine Summary
is required. If the user wants a written record, append a short log line to the
target's `notes` via Step 5 — the tracker is the durable trail.

## Never
Auto-send or auto-submit · write "just checking in" / "just following up" /
"circling back" / "I wanted to reach out" · fabricate a metric, contact name, or
prior interaction · address someone by a name you don't have · share the user's
phone number · bump `last_action`/`follow_ups` before the user confirms they sent
it · advance status (esp. to `applied`) without confirmation · nudge a terminal or
non-actionable lead · hand-edit `tracker.md`.
