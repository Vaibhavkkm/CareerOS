# mode: hunt — live job discovery (Indeed + Dice + ATS) → your match board

Trigger: `/cos hunt [role] [location]` (or "find me jobs", "what's open for me").

Goal: pull fresh openings from the live job boards, fold them into the same queue
the ATS scanner uses, and hand you a ranked match board — without fabricating a
single listing. The MCP job boards are **agent-only** (a script can't call them),
so YOU (the in-session agent) do the search, then a zero-token script does the
dedup + persistence. Discovery is broad; the human still decides and applies.

> The MCP connectors in Step 2 are **tool-specific** (they ship with Claude
> Code). If your agent tool doesn't have them, that's fine — start directly at
> the **fallback ladder** (the jobspy multi-board fetch is a first-class path,
> not a degraded one) and skip Step 2.

Load order: `modes/_shared.md` → this file → `data/profile.yml` (target roles,
locations, seniority, remote/visa preferences). Honor explicit args over profile
defaults.

## Step 1 — Derive the search queries
From `data/profile.yml` (or the user's args) build 1–4 query tuples:
- the role/keywords (e.g. "Data Engineer", "ML Engineer") — from `target_roles` /
  archetypes, or the user's typed role;
- the location (a city/state, or `remote`) — from `location` / `location_flexibility`;
- a country (ISO-3166, e.g. `US`, `LU`, `IN`) for Indeed's `country_code`.
Tell the user the queries you're about to run. Don't over-fan-out — 2–3 focused
queries beat 10 noisy ones.

## Step 2 — Call the connectors (degrade gracefully; never invent results)
Call whichever are available in YOUR tool (the names below are Claude Code's; no
connectors at all → fallback ladder). **Wrap each call in your own error
handling** — if a connector is not connected / errors, say so plainly and
continue with the rest.

- **Indeed** — `mcp__claude_ai_Indeed__search_jobs({ search, location, country_code [, job_type] })`.
  `job_type` ∈ fulltime|parttime|contract|internship|temporary. Returns **markdown**
  with an apply link per job — keep URLs intact, don't strip params.
- **Dice** — `mcp__claude_ai_Dice__search_jobs({ keyword [, location, posted_date, workplace_types, employment_types] })`.
  `posted_date` ∈ ONE|THREE|SEVEN (days); `workplace_types` ⊆ ['Remote','On-Site','Hybrid'].
  Returns **markdown** with `detailsPageUrl` + `companyPageUrl` per job.
- Optionally enrich the top few Indeed hits with
  `mcp__claude_ai_Indeed__get_job_details({ job_id })` to capture the full
  description (better board scoring + a richer saved JD).

**AI-disclosure (required for Dice, good practice for all):** when you present the
results, include a line like — "These listings were found via AI-powered job search;
verify details with the employer before applying."

**Fallback ladder** if MCP is unavailable:
1. Run the **zero-token multi-board fetch** (no agent/MCP needed):
   `node scripts/jobspy.mjs --country Luxembourg --city "Luxembourg" --recent 7 --summary`
   (Indeed + ZipRecruiter + Google Jobs via the python-jobspy sidecar — see the
   section below). This already ingests; skip to Step 5.
2. Run the ATS scanner: `node scripts/scan.mjs --summary` (zero-token, from
   `data/portals.yml`).
3. Ask the user to paste any job URLs they have; route them through
   `node scripts/fetch-jd.mjs "<url>"` (which saves to `data/jds/`).
4. Then continue at Step 4 (board). Never fabricate a posting, company, date, or URL.

## Zero-token multi-board fetch (JobSpy) — no agent, no MCP
There is a second discovery engine that does NOT need the agent: `scripts/jobspy.mjs`
shells out to the `python-jobspy` sidecar (`scripts/jobspy_fetch.py`) to scrape
**Indeed, ZipRecruiter, and Google Jobs**, then ingests through the SAME
`hunt-ingest` dedup/persistence path as everything else. Because it's a plain
script (no LLM), it powers the web **"fetch recent"** button (`POST /api/fetch-recent`)
and can run from a plain system cron — neither of which can call the MCP boards.

- First-class filters: **country** (`--country Germany`, JobSpy `country_indeed`) and
  **city** (`--city Berlin`, JobSpy `location`); recency `--recent <days>`;
  `--boards`, `--search "a,b"`, `--results`, `--remote`.
- Search terms default to `data/profile.yml` `target_roles`; country/city default to
  the profile `location`. An optional `jobspy:` block in `profile.yml` overrides.
- **LinkedIn is deferred** (rate-limits/blocks scrapers). It is excluded from the
  default board set; enable explicitly with `--boards indeed,...,linkedin` and expect
  flaky/partial runs. For a one-off LinkedIn role, paste its URL (Step fallback #3).
- Setup once: `npm run jobspy:install` (creates `.venv`, installs `python-jobspy`).
  `node scripts/doctor.mjs` reports whether the sidecar is ready.
- Same guardrails: never auto-applies, never fabricates, dedups against scan + hunt.

## Step 3 — Normalize the results into the ingest shape
Parse the markdown into a JSON **array**, one object per real listing:
```json
[{ "title": "...", "company": "...", "location": "...", "url": "<apply/details URL, params intact>",
   "posted": "YYYY-MM-DD or ''", "description": "<job text if you have it>", "source": "indeed|dice" }]
```
Map fields honestly: Indeed apply link → `url`; Dice `detailsPageUrl` → `url`. Use
`''` for anything a listing doesn't provide (do NOT guess a posted date). Write this
array to a temp file you control **outside `data/`** (e.g. `/tmp/hunt-<timestamp>.json`).

## Step 4 — Ingest deterministically (zero tokens) + board
Hand the array to the engine — it dedups against everything already seen
(`scan-history.tsv` + `inbox.md` + `tracker.jsonl`), saves each survivor as a full
`data/jds/*.md`, and logs the ledger:

```
node scripts/hunt-ingest.mjs --file /tmp/hunt-<timestamp>.json --source indeed --summary
```
Flags: `--strict` (also require `portals.yml` positive title filter), `--no-filter`
(ignore portals filters), `--dry-run` (preview). By default it keeps your portals
NEGATIVE title filter (e.g. exclude "intern") + location filter, but does NOT require
a positive title match — your search query already encoded the positive intent.

Then show the ranked board:
```
node scripts/board.mjs --json        # or --summary for the human view
```
Present it exactly as `modes/board.md` describes — bands (★ STRONGEST → Weak),
"posted X ago", match score, top HAVE skills, honest GAP list, numbered rows — then
offer the one-command tailor: `/cos build-cv <n>` (and `/cos build-cl <n>`).

## Step 5 — Summarize
Tell the user: how many listings each source returned, how many were new vs already
seen/filtered, and the top matches. Repeat the AI-disclosure. Remind them these are
queued for review — nothing is applied. To go deeper on one, `/cos evaluate <n>` runs
the full A–G judged report.

## Never
Fabricate a listing/company/date/URL · strip apply-URL parameters · auto-apply or
auto-submit · flip a hunted role to `applied` · write to `data/` except via
`hunt-ingest`/`scan`/`fetch-jd` · present results without the AI-search disclosure ·
treat a deterministic match score as the final verdict (that's `evaluate`).
