# mode: evaluate — score ONE posting into an A–G report + Machine Summary

Trigger: `/cos evaluate <JD-text | url | jds/file>`. Produces a numbered report at
`data/reports/NNN-slug-DATE.md` ending in a fenced `yaml` Machine Summary, then
registers/advances the tracker. No CV is built here — that's `build-cv`.

> Load order (router did this): `modes/_shared.md` → this file → `data/profile.yml`
> + `data/cv.master.md` (+ `data/article-digest.md`) → `data/_profile.md` (last wins).

## Inputs you need
- The **JD**: pasted text, a `data/jds/<file>`, or a URL. For a URL, scrape the
  WHOLE posting with `node scripts/fetch-jd.mjs "<url>" --json` (it works via the
  ATS API or the page HTML and saves the full posting to `data/jds/`); if it
  returns `needs_agent_fetch: true`, WebFetch the URL yourself and save it to
  `data/jds/`. Capture everything the employer posted — comp, benefits, team,
  application questions, not just requirements. Keep the source `url`.
- **Master facts**: `data/cv.master.md` + `data/profile.yml` (identity,
  `target_roles`, `compensation`, `location`, `narrative`). Ground truth — these
  win every conflict. **Never invent** experience, metrics, or qualifications.

## Step 0 — Detect archetype
Identify 1–2 **archetypes** from JD signals (see `_shared.md`) and map to the
user's `target_roles.archetypes` `fit` (primary/secondary/adjacent). Adjacent fits
start one band lower on North Star. This drives scoring emphasis.

## Step 1 — Write the report blocks (A–G)
- **A. Role Summary** — company, role, level, location/remote, the role's top 5
  must-haves and key nice-to-haves, in your words.
- **B. CV Match + Gaps** — map JD requirements to REAL evidence in
  `data/cv.master.md`. List hits, then honest gaps. Mark any gap that is a
  non-negotiable the user can't meet as a **hard stop**.
- **C. Level & Strategy** — is this a step up / lateral / down vs `target_roles`?
  How to position; what to lead with.
- **D. Comp & Demand** — JD pay (or market estimate, labeled) vs
  `profile.yml compensation.target_range`/`minimum`. Below `minimum` = hard stop.
  Note demand signals (urgency, reposts, headcount).
- **E. Personalization angle** — one specific, researched hook for `build-cl`
  (a product, value, eng-blog detail) — not generic praise.
- **F. STAR+R interview plan** — 3–5 likely questions; for each, name the real
  story from `cv.master.md` to tell as **Situation·Task·Action·Result + Reflection**.
- **G. Legitimacy** — assign a tier (**High Confidence / Proceed with Caution /
  Suspicious**, see `_shared.md`). Non-scoring; if Suspicious, warn explicitly.

## Step 2 — Score (rubric in `_shared.md`)
Score all 6 dimensions 1–5 (Match·North Star·Comp·Culture·Risk·Global/Logistics),
compute the **weighted** overall, round to one decimal. Show the per-dim table.
**Apply hard-stop caps**: any hard stop caps overall at **3.4** regardless of the
weighted math — never score around a missing non-negotiable. State each hard stop.

## Step 3 — ATS keywords
Extract **15–20 keywords/phrases** the ATS will screen on (skills, tools, domain
terms), preserving the JD's exact casing/phrasing. Put them in the report — they
seed `build-cv`.

## Step 4 — Write the report file
Next number = (max `NNN` prefix in `data/reports/` ) + 1; if the dir is
empty/missing, start at `001`. Slug from the company/role; `DATE` = today
(`YYYY-MM-DD`). Write `data/reports/NNN-slug-DATE.md` with blocks A–G, the score
table, and the keyword list. **Never overwrite** an existing report — bump NNN.

The report MUST end with this fenced `yaml` **Machine Summary** (the ONLY
structured contract; `analyze.mjs` reads only this block — schema
`templates/schemas/machine-summary.schema.json`). Required keys:
`company, role, score, archetype, final_decision, report_num`; include the rest:

````
```yaml
# Machine Summary
company: "<Company>"
role: "<Role title>"
score: 4.2                      # weighted overall /5, capped if hard stop; null if N/A
archetype: "<detected archetype>"
legitimacy_tier: "High Confidence"   # | Proceed with Caution | Suspicious
final_decision: "Apply"        # Apply | Consider | Research first | Skip (per band)
risk_level: "Low"              # Low | Medium | High
confidence: "High"             # Low | Medium | High (your certainty in this eval)
hard_stops: []                 # [] if none; else each capping reason
soft_gaps: ["<missing nice-to-have>"]
top_strengths: ["<strongest match>", "..."]
next_action: "build-cv"        # suggested next mode
url: "<source url or ''>"
report_num: <NNN as integer>
```
````

Map `final_decision` from the decision bands in `_shared.md` (≥4.0 Apply ·
3.5–3.9 Consider/Research first · <3.5 Skip).

## Step 5 — Register/advance the tracker (status `evaluated`)
Run (flags verified in `scripts/tracker.mjs` — `add` dedups by company+role, so it
advances an existing opening instead of duplicating):

```
node scripts/tracker.mjs add --json '{"company":"<Co>","role":"<Role>","score":4.2,"status":"evaluated","archetype":"<archetype>","legitimacy":"<tier>","url":"<url>","report":"reports/NNN-slug-DATE.md","notes":"<one-liner>"}'
```

`date` and `id` auto-fill; `report` is the path relative to `data/`. Do **not**
flip status beyond `evaluated` here.

## Step 6 — Hand off
Report the **score, decision band, and the report path**. If overall is
**≥ `compile_score_threshold`** (default 3.0 — see `_shared.md` Gates), suggest
**`/cos build-cv <NNN>`**; otherwise recommend **Skip** and ask before building.

## Never
Fabricate experience/metrics/qualifications to lift a score · score around a hard
stop (apply the 3.4 cap) · auto-submit or flip the tracker past `evaluated` ·
overwrite an existing report (bump NNN) · omit or malform the Machine Summary ·
share the user's phone in the personalization angle.
