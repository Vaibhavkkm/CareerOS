# mode: scan — discover open roles from tracked portals (zero-token)

Trigger: `/cos scan [--company X]`. Runs the pure-script portal scanner: it reads
`data/portals.yml`, fetches open roles via provider plugins, filters by title +
location, dedups against everything already seen, and appends the survivors to
`data/inbox.md` (the pipeline's URL queue). **No AI tokens are spent** — this
is plain HTTP + JSON. Your job is to run it and narrate the result.

> Prereq: `data/portals.yml` must exist. If the script reports it's missing, copy
> `templates/portals.example.yml` to `data/portals.yml` and tell the user to add
> their companies (see "Adding companies" below) — never fabricate portal entries.

## Step 1 — Run the scanner
Default run (scans every enabled company; emits machine JSON):
`node scripts/scan.mjs`

Flags (verified in `scripts/scan.mjs`):
- `--company NAME` — scan a single company (case-insensitive **substring** match
  on the entry's `name`). Use this when the user passes `--company X`.
- `--dry-run` — fetch, filter, dedup, and report, but **write nothing**. Good for
  a first look or after editing `portals.yml`.
- `--summary` — human-readable counts + the new-offers list (instead of JSON).
- `--json` — machine summary (this is the **default**, so you rarely pass it).
- `--self-test` — built-in tests against temp files only; for debugging the script.

Typical first invocation, then commit for real:
`node scripts/scan.mjs --company "Acme" --dry-run --summary` → review → drop
`--dry-run` to actually append.

## Step 2 — What it does (so you can explain it)
1. Loads `data/portals.yml` → `title_filter`, `location_filter`, `tracked_companies`.
2. Resolves a provider per enabled company: explicit `provider:` wins, else
   `local-parser` if `parser:` is set, else the first provider whose `detect()`
   matches. Companies with `enabled: false` or no matching provider are skipped.
3. Fetches roles concurrently (pool of 8) via `scripts/providers/<id>.mjs`.
4. **Filters** each role: `title_filter` (positive substring required unless the
   positive list is empty; any negative excludes) then `location_filter`
   (`always_allow` short-circuits → pass; `block` excludes; non-empty `allow`
   requires a match; blank location passes).
5. **Dedups** by URL **and** by `company::normalized-title` against the union of
   `data/scan-history.tsv` + `data/inbox.md` + `data/tracker.jsonl` (and within the
   scan itself), so the same opening never re-enters the queue.
6. Appends survivors to `data/inbox.md` as `- [ ] <url> | <company> | <title>` and
   logs every decision (`added` / `skipped_dup` / `skipped_filter`) to the
   append-only `data/scan-history.tsv` ledger. **Dry-run does neither.**

## Step 3 — Summarize what landed
Read the script's output and tell the user, concisely:
- counts: companies scanned, jobs found, filtered (title / location), duplicates,
  and **new offers added** (`counts.added` / `inbox_appended`).
- the new offers themselves: `company | title | location` for each in `added`.
- any `errors[]` (a provider 404, bad `api` token, unknown provider) and the
  `skipped_no_provider` count — surface these so the user can fix `portals.yml`.
- if `added == 0`: say nothing new landed (likely all dups/filtered) — this is the
  normal idempotent re-scan case, not an error.

This mode produces **no evaluation**, so there is no report and no Machine Summary
to embed — those belong to `evaluate`/`pipeline`. Don't write to `data/reports/`.

## Step 4 — Hand off to the pipeline
New offers are queued but **not yet evaluated**. Tell the user to run
**`/cos pipeline`** to process `data/inbox.md` (extract → evaluate → recommend) and
only then decide whether to build a CV. Never auto-advance or treat a queued URL
as "applied" — see guardrails in `_shared.md`.

## Adding companies to data/portals.yml
Each entry: `{ name, provider, api, enabled }`. Supported providers and the
`api`/board token each needs are documented in `templates/portals.example.yml` and
the provider files under `scripts/providers/`. Tune the global `title_filter` /
`location_filter` there too. Edits to `data/portals.yml` are the user's data —
confirm before changing it, and prefer a `--dry-run` after any edit.

**Two lists, two scopes.** `data/portals.yml` is the user's PRIVATE, git-ignored list —
edit it (with a confirm) to fetch a company for *themselves*. `templates/portals.example.yml`
is the PUBLIC seed shipped in the repo; adding a company there via a PR makes it
discoverable for *every* CareerOS user. When someone pastes a link from a company that
isn't tracked yet, offer **both** — see `_shared.md` → "Grow the auto-fetch list". A
custom career page with no public ATS endpoint can't be a one-line add; it needs a new
`scripts/providers/<id>.mjs` (or a `local-parser` entry) — point them at `CONTRIBUTING.md`.

## Escape hatch — JS-heavy career pages (no Playwright)
For sites with no public ATS endpoint, use the `local-parser` provider: set
`provider: local-parser` and `parser: { command: "...", script: "..." }` on the
entry. The script shells out to that command and expects it to print a JSON
`Job[]` (`{ title, url, company, location }`) on stdout. This keeps scanning
zero-token and dependency-light — there is **no** headless browser shipped.

## Never
Spend tokens scanning (it's a pure script) · fabricate portal entries, `api`
tokens, or job postings · write the survivors anywhere but `data/inbox.md` via the
script · flip a queued offer to `applied` · auto-run `pipeline` without the user ·
hand-edit `data/scan-history.tsv` (it's the append-only dedup ledger).
