# mode: onboard — turn an uploaded CV + cover letter into your profile, master CV, and voice

Trigger: `/og onboard` (or the user is new and `doctor` reports setup incomplete,
or they say **"set me up"** / **"here's my CV and cover letter"**). This is the
guided first run that makes OfferForge work for THIS user: it reads the documents
they already have, grounds the system in their real facts, and learns their
writing voice — so the very first tailored draft already sounds like them.

> Load order: `_shared.md` → this file. You will WRITE User-layer files
> (`data/profile.yml`, `data/cv.master.md`, `data/writing-samples/*`) from the
> user's own uploads — always show what you extracted and get a confirmation
> before writing. See `DATA_CONTRACT.md`: `data/` is the user's, never invented.

## The promise (what this mode delivers)
Given a job description + the user's **own CV** + their **own cover letter**, the
system learns from those uploads and drafts a NEW CV and cover letter tailored to
the job, in the user's style. This mode does the "learn from your CV + CL" half;
`build-cv`/`build-cl` then do the "draft for the job" half.

## Step 0 — Gather the uploads
Ask the user for (accept whatever they have; CV is required, the rest optional):
1. **Their CV** — PDF, Word, plain text, or `.tex`. Required (it's the factual
   ground truth). If they paste text instead of a file, that's fine.
2. **A cover letter they wrote** — any past one, even for a different job. Used to
   learn their prose voice. Optional but strongly encouraged.
3. **Any other writing in their voice** — a blog post, a long email, a bio.
   Optional; improves voice learning.

If they gave a file path, read it. For a PDF, extract text with
`pdftotext "<file>" -` (from poppler; if absent, ask them to paste the text or
run `node scripts/doctor.mjs` to see the install hint). Never guess at content you
cannot read — ask.

## Step 1 — Extract identity & contact (propose, don't assume)
From the CV, pull ONLY what is actually present: full name, email, phone,
location/city, country, LinkedIn, GitHub, portfolio/website. Show the user a short
list of what you found and ask them to confirm or correct. Never invent a field;
leave blanks for anything the CV doesn't state.

## Step 2 — Build `data/cv.master.md` (the factual source of truth)
Transcribe the CV into `data/cv.master.md` — this is the master record every
future tailored CV is grounded in. Preserve every real fact:
- Experience: each role with company, title, dates, and bullets.
- Education, skills, projects, certifications.
- **Rewrite nothing into fiction.** Keep the user's real numbers. Where a bullet
  has no metric, KEEP it but flag it: list which bullets lack a quantified outcome
  so the user can add real numbers. Do not fabricate metrics to fill the gap.
Show the user the structure and your "missing-metric" flags before writing.

## Step 3 — Propose `data/profile.yml`
Start from `templates/profile.example.yml`. Fill what you can ground in the CV and
the user's answers; leave judgment fields for the user:
- `candidate`: identity/contact from Step 1.
- `target_roles` + `archetypes`: infer candidate options from their experience
  (map to the archetypes in `_shared.md`) and ASK which they're actually aiming
  for — don't decide their direction for them.
- `narrative` (`headline`, `superpowers`, `proof_points`, `exit_story`): draft from
  the CV, mark as "please review".
- `narrative.voice`: leave for Step 4 to fill from their writing.
- `compensation` (`target_range`, `minimum`) and `location`/visa: leave BLANK with a
  comment for the user to fill — never guess someone's pay expectations or status.
- `cv.font`: default `texgyretermes` unless they prefer another installed font.
Show a diff/preview and get explicit approval before writing `data/profile.yml`.

## Step 4 — Learn the user's voice from their CV + cover letter (warm start)
This is the "learn from your uploaded CV and cover letter" step. It reuses the
verified machinery and means the FIRST draft is already in-voice — no cold start:

1. **Save prose samples.** Put each uploaded cover letter / writing sample into
   `data/writing-samples/` (e.g. `data/writing-samples/cover-letter-2026.md`).
   `build-cv`/`build-cl` read this folder directly.

2. **Warm-start the example bank** from what they wrote, so the loop has real
   in-voice few-shots before any edit happens:
   - From their CV bullets:
     `node scripts/seed-examples.mjs --kind cv --from <their-cv.md|jds-style text> --archetype "<primary archetype>" --skills "<their top skills>"`
   - From their cover letter (if uploaded):
     `node scripts/seed-examples.mjs --kind cl --from data/writing-samples/<their-cl>.md`
   This banks their real bullets/paragraphs into `data/style/examples.jsonl`
   (same TF/IDF + near-dup guard as the learning loop), so the first `build-cv`/
   `build-cl` retrieves THEIR wording as examples, not a generic template.

3. **Distil the voice rules.** Run the **`recalibrate-voice`** flow
   (`modes/recalibrate-voice.md`): infer `tone`, `sentence_length`,
   `signature_phrases`, and `avoid` from the samples, cite the evidence, show the
   diff, and (on approval) write ONLY the `narrative.voice` block of
   `data/profile.yml`.

4. If no CV/CL prose was provided, say so and proceed with a neutral default
   voice — the loop will sharpen it from the user's edits later via `style-learn`.

> Result: before the first generation, `narrative.voice` + `data/writing-samples/`
> + a warm `data/style/examples.jsonl` already encode how this user writes. The
> bank keeps growing as they edit drafts and run **"learn from my edits"**.

## Step 5 — Verify setup
Run `node scripts/doctor.mjs`. Resolve any remaining ❌ (most commonly: a still-
blank field in `profile.yml`, or `cv.master.md` too thin). Aim for **Ready**.

## Step 6 — First tailored draft (prove it works)
Invite the user to paste a real job description (or URL). Then run the normal
pipeline: `evaluate` → if it scores at/above threshold, `build-cv` (and `build-cl`
if they want one). Point out that the draft already reflects their voice, and that
editing the `.tex` and saying **"learn from my edits"** makes the next one better.

## Privacy note (this tool can be public)
Everything you extract lives under `data/`, which is the user's private layer and
is git-ignored by default — their CV, contact details, and letters stay on their
machine and are never part of the public repo. Tell a new user this so they trust
it with real data.

## Never
Fabricate any fact, metric, employer, title, or date · write `data/profile.yml` or
`data/cv.master.md` without showing the extraction and getting approval · guess a
user's compensation or visa status · invent a voice from zero samples · put the
user's phone number into any outreach. Ground everything in what they uploaded.
