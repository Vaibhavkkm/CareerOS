# mode: build-cl — generate a tailored, ATS-safe LaTeX cover letter

Trigger: `/cos build-cl <report# | company | JD>`. Produces a tailored cover-letter
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

## Layout & house style (apply EVERY time — do not regress between drafts)
- **If the candidate has a reference cover letter** in `data/writing-samples/`, MATCH
  its layout exactly: letterhead alignment, whether contact lines are **stacked**,
  body justification, paragraph count, and the sign-off. Their own letter — not this
  template's defaults — is the source of truth for formatting.
- **Apply `data/profile.yml narrative.voice.formatting` in full** every draft
  (dashes, bolding, plain openings, single honesty cue, concessions→claims, phone
  on/off, …). These are sticky preferences; never silently drop them.
- **Bold the key metrics and named systems in the body** when the house style calls
  for it — do not strip body bold unless the user's reference itself has none.
- **One page is mandatory.** Achieve it by TRIMMING CONTENT, never by compressing
  line spacing, shrinking the header, or cramming the contact onto one line. Verify
  with `compile-latex.mjs` page count before handing off.
- **Stay strictly within the user's explicit request.** Don't edit, remove from, or
  even *offer* to change other documents (e.g. the CV) that the user didn't ask about.

## Step 0 — Gate
Same threshold gate as `build-cv` (Step 0). A cover letter is most worth it for
≥4.0 fits or when the JD explicitly requests one.

## Step 1 — Learning-loop context (voice-weighted)
Same 7-tier gather as `build-cv` Step 2, with these differences:
- Style rules scope filter includes `doc:cl` (not `doc:cv`).
- Few-shots: `node scripts/style-retrieve.mjs --jd <jd-file> --archetype "<arch>" --skills "<skills>" --kind cl --k 4 --json` → these are past **cover-letter paragraphs** in the candidate's voice. Match voice, not facts.
- Lean harder on `data/profile.yml narrative.voice` (tone, sentence length,
  signature phrases, the `avoid` list) and `data/writing-samples/` if present.

## Step 2 — Draft the body
Paragraph count follows the candidate's reference letter when they have one (often
4–5 short paragraphs); otherwise default to 3 (hook / proof / close).
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

## Step 2.5 — Self-check & revise (REQUIRED, before the snapshot)
Critique your OWN letter against this checklist and **revise until it passes** —
this pass is what makes it sound like the user, not a template:
1. **Truth** — every claim and number is grounded in `cv.master.md` / `profile.yml`.
2. **Hook** — para 1 opens with the specific researched signal; no generic flattery,
   no "I am writing to apply", no "To Whom It May Concern".
3. **Proof** — para 2 maps 1–2 quantified REAL achievements to the JD's top needs.
4. **Voice** — matches `narrative.voice` + `data/writing-samples/` + `doc:cl` style
   rules; no word from the `avoid`/banned list; confident, not pleading.
5. **Format** — exactly 3 body paragraphs, one page, NO compensation and NO phone
   number on the letter, zero `<<PLACEHOLDER>>`, specials escaped per `_shared.md`.
Do at least one revision pass, then proceed.

## Step 3 — Snapshot (REQUIRED, before compiling)
Create `data/style/edits/<ts>__<app-id>/` with `ai_draft.tex` (this letter) and
`context.json` (`doc_kind:"cl"`, archetype, jd_path, target_role, etc.). Write the
working copy into the job's own output folder (see `_shared.md` "Output location &
file naming") — the SAME folder the CV uses, so a posting's CV + letter sit together:
`data/output/<company-slug>--<role-slug>/cl-<company-slug>-<role-slug>-<YYYY-MM-DD>.tex`.
*(If a CV was built in the same session, use a separate `data/style/edits/` snapshot
folder for the CL — but the `data/output/` job folder is shared.)*

## Step 4 — Compile
`node scripts/compile-latex.mjs data/output/<company-slug>--<role-slug>/cl-<...>.tex --kind cl --json`.
Fix any `issues` and recompile; never hand off a failed build.

## Step 5 — Hand off + invite the loop
Give the **per-job folder and exact PDF path**, note the hook you used, and remind the
user they can edit the `.tex` in that folder and then say **"learn from my edits"**.
Update the tracker `cl_pdf` if a record exists (this makes the Pipeline tab link it).

## Never
Fabricate · put compensation or the user's phone-only context on the letter ·
generic flattery · break the preamble · skip the snapshot · hand off an
un-compiled letter.
