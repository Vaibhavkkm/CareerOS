# mode: board — rank open roles by how well they match YOUR CV

Trigger: `/cos board` (or "show me my matches", "which jobs fit me"). Produces a
ranked board of openings — each labelled with a match band (STRONGEST / Very
strong / Strong / Moderate / Weak), how recently it was posted, and the skills
you HAVE vs the GAPs — then lets the user tailor a CV+CL for any pick in one step.

> Load order: `_shared.md` → this file → `data/profile.yml` + `data/cv.master.md`.
> Needs a real `data/cv.master.md` (run `onboard` first if missing).

## What the board is (and isn't)
The board uses a **fast, deterministic, skill-aware match score**
(`scripts/match-score.mjs` + the `lib/skills.mjs` taxonomy) so it can rank MANY
postings cheaply. Rather than raw keyword overlap, it scores whether the candidate
has the role's **primary build stack** — its *stack-defining* skills (React, Spring
Boot, Django, …) as opposed to cross-cutting tools every stack shares (Docker, AWS,
SQL) — at real proficiency, plus the **years of experience** the role wants. So a
Node/React CV is no longer rated a strong fit for a Spring/Java job just because
both mention "REST APIs, microservices, Docker, Agile"; an off-stack posting is
driven down and the row explains why (`stack_mismatch`, missing core skills). A
TF-IDF lexical blend is kept as a low-weight backstop (and carries prose-heavy,
non-engineering roles). It's still a *pre-rank to triage* — the deep, judged score
is `evaluate`, which you run on the ones worth a closer look.

## Step 1 — Gather openings
Run `node scripts/board.mjs --json` (pass through any filters the user gave):
- `--urls "<u1>,<u2>"` — specific postings the user shared (each is scraped via
  `fetch-jd` and saved to `data/jds/`).
- `--min <band>` — only that band or better (e.g. `--min strong`).
- `--recent <days>` — only postings dated within N days (recency filter).

With no `--urls`, the board draws from everything already scraped in `data/jds/`
plus the scan queue `data/inbox.md` (URLs there are fetched and saved). If both are
empty, tell the user to run `/cos scan`, share a URL, or pass `--urls`.

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
Tell the user they can tailor for any row in one step: **`/cos build-cv <number>`**
(and `/cos build-cl <number>` for a letter). When they pick a number:
1. Map it to that row's posting (`jd_path` if saved, else its `url` → ensure it's
   fetched to `data/jds/` via `fetch-jd`).
2. Run **`evaluate`** on it first if there's no report yet (so the build reuses the
   archetype/keywords and you respect the score gate), then run **`build-cv`** (and
   `build-cl` if asked) per their playbooks — including the Step 3.5 self-check and
   the warm-started example bank. One command, a tailored, ATS-safe PDF out.

## Step 4 — Offptional follow-ups
Suggest: narrow with `--min`/`--recent`, add more sources with `/cos scan`, or
deep-evaluate a specific one with `/cos evaluate <n>`.

## Never
Present the deterministic match score as a final verdict (it's a pre-rank — say so)
· auto-apply or auto-submit · fabricate a posting, a date, or a match · build a CV
for a role below the user's gate without saying so · invent skills the CV lacks to
inflate a match (the GAP list must be honest).
