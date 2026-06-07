# mode: build-cl — generate a tailored, ATS-safe LaTeX cover letter

Trigger: `/og build-cl <report# | company | JD>`. Produces a tailored cover-letter
`.tex`, compiles it, and snapshots the draft for the learning loop. Same loop as
`build-cv`, tuned for prose voice.

> Load order: `_shared.md` → this file → `data/profile.yml` + `data/cv.master.md`
> → `data/_profile.md`, then the learning-loop context below.

## Inputs
- The JD + company (from a report, paste, or `data/jds/<file>`).
- `data/profile.yml` (`candidate`, `narrative.voice`, `compensation`/`location`
  only for judgment — never put comp on the letter).
- A specific, researched **hook signal** about the company (from the report's
  Block D/E, the `research` mode, or ask the user for one). No generic flattery.

## Step 0 — Gate
Same threshold gate as `build-cv` (Step 0). A cover letter is most worth it for
≥4.0 fits or when the JD explicitly requests one.

## Step 1 — Learning-loop context (voice-weighted)
Same 7-tier gather as `build-cv` Step 2, with these differences:
- Style rules scope filter includes `doc:cl` (not `doc:cv`).
- Few-shots: `node scripts/style-retrieve.mjs --jd <jd-file> --archetype "<arch>" --skills "<skills>" --kind cl --k 4 --json` → these are past **cover-letter paragraphs** in the candidate's voice. Match voice, not facts.
- Lean harder on `data/profile.yml narrative.voice` (tone, sentence length,
  signature phrases, the `avoid` list) and `data/writing-samples/` if present.

## Step 2 — Draft (exactly 3 body paragraphs)
Fill `templates/cl.tex.tmpl`:
- **Para 1 — hook**: why *this* company/role specifically; open with the
  concrete researched signal. No "I am writing to apply", no "To Whom It May Concern".
- **Para 2 — proof**: 1–2 quantified achievements from `cv.master.md` mapped to the
  JD's top needs. Real numbers only.
- **Para 3 — close**: confident fit statement + a forward-looking line. Not pleading.
- Recipient: use a real name if known, else "Hiring Manager" and delete the
  street-address placeholder lines. Set `<<DATE_LONG>>` to today (e.g. "June 7, 2026").
- `<<FONT_FILE>>` = `data/profile.yml cv.font` (default `texgyretermes`).
- Escape every raw value (the `_shared.md` LaTeX table). No `<<...>>` left behind.

## Step 3 — Snapshot (REQUIRED, before compiling)
Create `data/style/edits/<ts>__<app-id>/` with `ai_draft.tex` (this letter) and
`context.json` (`doc_kind:"cl"`, archetype, jd_path, target_role, etc.). Write the
working copy to `data/output/cl-<candidate>-<company>-<YYYY-MM-DD>.tex`.
*(If a CV was built in the same session, use a separate edit folder for the CL.)*

## Step 4 — Compile
`node scripts/compile-latex.mjs data/output/cl-<...>.tex --kind cl --json`.
Fix any `issues` and recompile; never hand off a failed build.

## Step 5 — Hand off + invite the loop
Give the PDF path, note the hook you used, and remind the user they can edit the
`.tex` and then say **"learn from my edits"**. Update the tracker `cl_pdf` if a
record exists.

## Never
Fabricate · put compensation or the user's phone-only context on the letter ·
generic flattery · break the preamble · skip the snapshot · hand off an
un-compiled letter.
