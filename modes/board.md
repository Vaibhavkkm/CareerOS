# mode: board — rank open roles by how well they match YOUR CV

Trigger: `/og board` (or "show me my matches", "which jobs fit me"). Produces a
ranked board of openings — each labelled with a match band (STRONGEST / Very
strong / Strong / Moderate / Weak), how recently it was posted, and the skills
you HAVE vs the GAPs — then lets the user tailor a CV+CL for any pick in one step.

> Load order: `_shared.md` → this file → `data/profile.yml` + `data/cv.master.md`.
> Needs a real `data/cv.master.md` (run `onboard` first if missing).

## What the board is (and isn't)
The board uses a **fast, deterministic match score** (`scripts/match-score.mjs`:
keyword coverage + TF-IDF similarity of the posting against the master CV) so it
can rank MANY postings cheaply. It's a *pre-rank to triage* — the deep, judged
score is still `evaluate`, which you run on the ones worth a closer look.

## Step 1 — Gather openings
Run `node scripts/board.mjs --json` (pass through any filters the user gave):
- `--urls "<u1>,<u2>"` — specific postings the user shared (each is scraped via
  `fetch-jd` and saved to `data/jds/`).
- `--min <band>` — only that band or better (e.g. `--min strong`).
- `--recent <days>` — only postings dated within N days (recency filter).

With no `--urls`, the board draws from everything already scraped in `data/jds/`
plus the scan queue `data/inbox.md` (URLs there are fetched and saved). If both are
empty, tell the user to run `/og scan`, share a URL, or pass `--urls`.

## Step 2 — Present the board
Render the rows (the script's `--json` gives you `company, role, url, posted,
score, band, have[], gap[], jd_path`), best match first, newest first on ties:

```
★★★★ STRONGEST   Acme — Senior ML Engineer      2d ago   match 0.91
       has: Python, Airflow, XBRL    gap: Kubernetes
★★★  Very strong Beta — Data Engineer           5d ago   match 0.74
★★   Strong      Gamma — ML Platform Engineer    9d ago   match 0.58
```

Number the rows. For each, show band + stars, company — role, "X ago", the match
score, and the top HAVE skills + the top GAP skills (so the user sees fit and
missing requirements at a glance). Note the legitimacy/recency caveats honestly
(a deterministic pre-rank can miss nuance; `evaluate` is the real judge).

## Step 3 — One-click tailor
Tell the user they can tailor for any row in one step: **`/og build-cv <number>`**
(and `/og build-cl <number>` for a letter). When they pick a number:
1. Map it to that row's posting (`jd_path` if saved, else its `url` → ensure it's
   fetched to `data/jds/` via `fetch-jd`).
2. Run **`evaluate`** on it first if there's no report yet (so the build reuses the
   archetype/keywords and you respect the score gate), then run **`build-cv`** (and
   `build-cl` if asked) per their playbooks — including the Step 3.5 self-check and
   the warm-started example bank. One command, a tailored, ATS-safe PDF out.

## Step 4 — Offptional follow-ups
Suggest: narrow with `--min`/`--recent`, add more sources with `/og scan`, or
deep-evaluate a specific one with `/og evaluate <n>`.

## Never
Present the deterministic match score as a final verdict (it's a pre-rank — say so)
· auto-apply or auto-submit · fabricate a posting, a date, or a match · build a CV
for a role below the user's gate without saying so · invent skills the CV lacks to
inflate a match (the GAP list must be honest).
