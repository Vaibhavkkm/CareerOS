# mode: build-cv — generate a tailored, ATS-safe LaTeX CV

Trigger: `/cos build-cv <report# | company | JD>`. Produces a tailored CV `.tex`,
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

## Step 0.5 — Pick the template theme
Resolve which visual theme to build from (all themes share the SAME placeholder
contract and the SAME ATS-safe preamble — only the look differs):
- Precedence: a `--theme <name>` on the command → `data/profile.yml` `cv.theme`
  → default `classic`.
- Resolve it to a file deterministically:
  `node scripts/templates.mjs resolve --theme "<name>" --kind cv --json`
  (use the returned `file`; if `fellBack:true`, tell the user you used the default).
- Themes: **classic** (neutral, safest), **modern** (slate-accent sans), **academic**
  (education-first + Publications, for PhD/post-doc/research), **compact** (denser,
  fits a long history on one page). List them with `node scripts/templates.mjs list`.
- A genuine two-column layout is intentionally NOT offered — it reorders badly in
  many ATS parsers and would break the keyword-extraction guarantee.
Use the resolved file as the template in Step 2/Step 3 instead of the hardcoded
`templates/cv.tex.tmpl`.

## Step 1 — Analyze the JD (if not already in a report)
1. Detect the **archetype** (see `_shared.md`).
2. Extract **15–20 keywords/phrases** the ATS will likely screen on (skills,
   tools, domain terms), preserving the JD's exact casing/phrasing.
3. List the role's **top 5 must-haves**.

## Step 2 — Build the learning-loop context (THE differentiator)
Gather, in this exact order — you will inject them into your drafting below:
1. **Base rules** — this file + `_shared.md` (LaTeX/ATS hard constraints).
2. **Template contract** — the theme file resolved in Step 0.5 (its macros/sections;
   default `templates/cv.tex.tmpl`).
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
Working from the theme file resolved in Step 0.5 (default `templates/cv.tex.tmpl`):
- **Summary**: 2–3 sentences, keyword-rich, third person, mirrors the role.
- **Experience**: include/reorder roles by archetype relevance; most relevant
  first. Rewrite each bullet as **strong verb + quantified, REAL outcome**, woven
  with JD keywords *only where truthful*. Pull metrics from `cv.master.md` /
  `article-digest.md` — never fabricate a number.
- **Projects/Education/Skills**: include Projects only if relevant; Skills line
  aligned to the JD's keywords.
- Apply the active style rules (Step 5) and imitate the few-shots' voice (Step 6).
- Apply the candidate's **house formatting** from `data/profile.yml`
  `narrative.voice.formatting` (e.g. en dashes `--` not em dashes `---`; **bold** the
  key metric/named system in each experience bullet; include a **References** section
  when the master CV lists references; render an in-progress degree as a date range
  with `(expected)`; quantify high output over short tenure with the timeframe).
- **Escape every raw value** per the `_shared.md` LaTeX table (the `lib/text.mjs`
  `latexEscape` rules) — `& % $ # _ { } ~ ^ \`, smart quotes, dashes. Do not alter
  the preamble. Leave **no** `<<PLACEHOLDER>>` behind.
- Keep it **one page** unless the user is clearly senior enough for two.

## Step 3.5 — Self-check & revise (REQUIRED, before the snapshot)
Before treating the draft as done, critique YOUR OWN output against this checklist
and **revise until it passes** — the user should rarely have to fix these. This
self-correction is the single biggest driver of a first draft that lands:
1. **Truth** — every bullet, metric, employer, title, and date traces to
   `data/cv.master.md` / `data/profile.yml`. Cut or soften anything you can't ground.
2. **ATS keywords** — the role's must-have keywords (Step 1) appear, in the JD's
   casing, but ONLY inside real achievements. Name any required keyword you truthfully
   can't include (a genuine gap — never fake it).
3. **Voice** — matches `narrative.voice` (tone, sentence length, signature phrases)
   and the active style rules (Step 5); contains **no** word from the `avoid`/banned list.
4. **Bullets** — each is strong-verb + quantified real outcome; no filler ("worked on",
   "responsible for", "passionate"); most JD-relevant first.
5. **Format** — one page (unless senior), zero `<<PLACEHOLDER>>` left, every special
   char escaped per `_shared.md`.
Do at least one revision pass. Briefly note to yourself what you changed (or "clean").

## Step 4 — Snapshot for the learning loop (REQUIRED, before compiling)
1. Choose an `app-id` (e.g. `acme-backend`) and a timestamp `ts` (`YYYYMMDD-HHMMSS`).
2. Create `data/style/edits/<ts>__<app-id>/` and write:
   - `ai_draft.tex` — your exact draft.
   - `context.json` —
     `{app_id, created, doc_kind:"cv", archetype, jd_path, target_role, seniority, required_skills:[...], template_id:"<resolved template path>", model_id:"<your model>"}`.
3. Also write the working copy into the job's own output folder (see `_shared.md`
   "Output location & file naming"):
   `data/output/<company-slug>--<role-slug>/cv-<company-slug>-<role-slug>-<YYYY-MM-DD>.tex`
   (this is the file the user edits). Create the folder if needed.

## Step 5 — Compile + ATS smoke test
Run:
`node scripts/compile-latex.mjs data/output/<company-slug>--<role-slug>/cv-<...>.tex --kind cv --keywords "<5 JD keywords>" --json`
- If `ok:true`: report the PDF path, page count, and the keywords confirmed
  extractable.
- If `ok:false`: read `issues`, fix the `.tex` (common: an unescaped special, a
  leftover `<<...>>`, a too-long page), and recompile. Never present a CV whose
  smoke test failed.

## Step 6 — Hand off + invite the loop
Tell the user: the **per-job folder and exact PDF path** (e.g. "CV ready →
`data/output/<company>--<role>/cv-….pdf`"), what you tailored (1–3 lines), and that
they can edit the `.tex` in that folder directly. When they're done editing, they say
**"learn from my edits"** (or `/cos style-learn`) and the system will diff their
changes and get better next time.
- **Register the doc for the web UI (ALWAYS):**
  `node scripts/job-docs.mjs add --jd "<jd_path>" --url "<url>" --type cv --path "<pdf path>"`
  (and `--type tex` for the `.tex`). This is what makes the CV show up in the Board/Saved
  **detail drawer** (`/api/docs` reads `data/ui/job-docs.jsonl`). Do this even when there is
  NO tracker record — e.g. a *saved-but-not-tracked* job — otherwise the drawer can't find it.
- If a tracker record exists, ALSO update its `cv_pdf`:
  `node scripts/tracker.mjs update --id <id> --cv_pdf "<path>"` (this makes the Pipeline tab link it).

## Never
Fabricate experience/metrics/dates · break the template preamble · leave a
placeholder · skip the snapshot · present an un-smoke-tested PDF.
