# mode: build-cv — generate a tailored, ATS-safe LaTeX CV

Trigger: `/og build-cv <report# | company | JD>`. Produces a tailored CV `.tex`,
compiles it to PDF, and snapshots the draft so the learning loop can run later.

> Load order (the router already did this): `modes/_shared.md` → this file →
> `data/profile.yml` + `data/cv.master.md` (+ `data/article-digest.md`) →
> `data/_profile.md`. Then build the learning-loop context in Step 2.

## Inputs you need
- The **JD** (from the named report's source, a pasted JD, or `data/jds/<file>`).
- The **master facts**: `data/cv.master.md` (every real bullet + metric) and
  `data/profile.yml` (identity, archetypes, voice, font).
- If a report number is given, read `data/reports/NNN-*.md` for the archetype,
  score, extracted keywords, and gaps already computed by `evaluate`.

## Step 0 — Gate
If an eval score exists and is **below `compile_score_threshold`** (default 3.0),
say so and ask the user to confirm before spending a compile. Don't auto-build
documents for roles the system recommends skipping.

## Step 1 — Analyze the JD (if not already in a report)
1. Detect the **archetype** (see `_shared.md`).
2. Extract **15–20 keywords/phrases** the ATS will likely screen on (skills,
   tools, domain terms), preserving the JD's exact casing/phrasing.
3. List the role's **top 5 must-haves**.

## Step 2 — Build the learning-loop context (THE differentiator)
Gather, in this exact order — you will inject them into your drafting below:
1. **Base rules** — this file + `_shared.md` (LaTeX/ATS hard constraints).
2. **Template contract** — `templates/cv.tex.tmpl` macros/sections.
3. **Master facts** — `data/cv.master.md` + `data/profile.yml`
   (+ `article-digest.md`). *Ground truth. These win every conflict. Never invent.*
4. **Job context** — the JD text + extracted keywords + archetype + must-haves.
5. **Active style rules** — read `data/style/profile.json` (if present); take rules
   with `status == "active"` whose `scope` ∈ {`global`, `archetype:<this>`,
   `doc:cv`}. Render them as a short imperative checklist (sorted by confidence).
6. **Few-shot examples** — run:
   `node scripts/style-retrieve.mjs --jd <jd-file> --archetype "<archetype>" --skills "<top skills>" --kind cv --k 6 --json`
   Use the returned bullets as *voice/structure* demos — **match the style, do NOT
   copy their facts.**
7. **Negatives** — high-confidence `always_cut` rules + banned verbs from
   `_shared.md` and the style profile; plus one `before→after` pair from a past
   diff if available.

> Steps 5–7 are simply skipped if `data/style/` is empty (cold start) — the output
> is then a clean template-only CV. The loop improves it over time.

## Step 3 — Draft the CV
Working from `templates/cv.tex.tmpl`:
- **Summary**: 2–3 sentences, keyword-rich, third person, mirrors the role.
- **Experience**: include/reorder roles by archetype relevance; most relevant
  first. Rewrite each bullet as **strong verb + quantified, REAL outcome**, woven
  with JD keywords *only where truthful*. Pull metrics from `cv.master.md` /
  `article-digest.md` — never fabricate a number.
- **Projects/Education/Skills**: include Projects only if relevant; Skills line
  aligned to the JD's keywords.
- Apply the active style rules (Step 5) and imitate the few-shots' voice (Step 6).
- **Escape every raw value** per the `_shared.md` LaTeX table (the `lib/text.mjs`
  `latexEscape` rules) — `& % $ # _ { } ~ ^ \`, smart quotes, dashes. Do not alter
  the preamble. Leave **no** `<<PLACEHOLDER>>` behind.
- Keep it **one page** unless the user is clearly senior enough for two.

## Step 4 — Snapshot for the learning loop (REQUIRED, before compiling)
1. Choose an `app-id` (e.g. `acme-backend`) and a timestamp `ts` (`YYYYMMDD-HHMMSS`).
2. Create `data/style/edits/<ts>__<app-id>/` and write:
   - `ai_draft.tex` — your exact draft.
   - `context.json` —
     `{app_id, created, doc_kind:"cv", archetype, jd_path, target_role, seniority, required_skills:[...], template_id:"templates/cv.tex.tmpl", model_id:"<your model>"}`.
3. Also write the working copy to `data/output/cv-<candidate>-<company>-<YYYY-MM-DD>.tex`
   (this is the file the user edits).

## Step 5 — Compile + ATS smoke test
Run:
`node scripts/compile-latex.mjs data/output/cv-<...>.tex --kind cv --keywords "<5 JD keywords>" --json`
- If `ok:true`: report the PDF path, page count, and the keywords confirmed
  extractable.
- If `ok:false`: read `issues`, fix the `.tex` (common: an unescaped special, a
  leftover `<<...>>`, a too-long page), and recompile. Never present a CV whose
  smoke test failed.

## Step 6 — Hand off + invite the loop
Tell the user: the PDF path, what you tailored (1–3 lines), and that they can edit
`data/output/cv-<...>.tex` directly. When they're done editing, they say **"learn
from my edits"** (or `/og style-learn`) and the system will diff their changes and
get better next time. If a tracker record exists, update its `cv_pdf` via
`node scripts/tracker.mjs update --id <id> --cv_pdf "<path>"`.

## Never
Fabricate experience/metrics/dates · break the template preamble · leave a
placeholder · skip the snapshot · present an un-smoke-tested PDF.
