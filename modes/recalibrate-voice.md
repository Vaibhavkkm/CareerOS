# mode: recalibrate-voice — cold-start your voice from your prose corpus

Trigger: `/cos recalibrate-voice` (or the user says **"recalibrate my writing
style"**). Re-scan `data/writing-samples/*`, infer how the user actually writes,
and propose an update to **only** the `narrative.voice` block of
`data/profile.yml`. Pure agent work — there is no script to run.

> Load order: `_shared.md` → this file → `data/profile.yml`. Then read the corpus.

## When to use this vs `style-learn`
Complementary, not competing — both feed `build-cv`/`build-cl`:
- **recalibrate-voice** (this mode) = **cold start**. Learns voice from your
  free **prose corpus** (`data/writing-samples/`) when there are few/no edits yet.
- **`style-learn`** = **refinement**. Learns from concrete **diffs** between an AI
  draft and your hand-edited final, with confidence/recency gates.
Run this first (or after adding new samples); let `style-learn` sharpen over time.
This mode never touches `data/style/*` — that's `style-learn`'s territory.

## Step 1 — Gather the corpus
List `data/writing-samples/*` (`.md`, `.txt`, emails, blog posts, past letters —
anything the user wrote in their own voice). If the folder is **empty**, say so
and ask the user to drop in 2-3 prose samples (a cover letter, a blog post, a long
Slack/email) — then stop. Don't infer a voice from zero evidence.
- Ignore obviously non-prose files (resumes/CVs are too terse; code dumps).
- Note the corpus you used (filenames) so the proposal is auditable.

## Step 2 — Infer the voice (evidence-based, not vibes)
Read the samples and derive, citing a line or two of evidence for each:
1. **tone** — e.g. direct/warm/understated/wry; first vs third person; how much
   the writing relies on metrics vs narrative. One concise phrase.
2. **sentence_length** — observe the actual range (short / short-to-medium /
   varied with occasional long). Don't impose a target the corpus contradicts.
3. **signature_phrases** — 3-8 recurring constructions/openers/transitions that
   are *distinctively this person* (not generic English). Verbatim where possible.
4. **avoid** — words/tics the user clearly never uses, PLUS the `_shared.md`
   banned/filler list, merged and de-duped. Keep it a tight, real list.
Stay honest: if the corpus is thin, say "low confidence" and narrow your claims.

## Step 3 — Show the diff and ASK (profile.yml is USER data)
`data/profile.yml` is the User layer (see DATA_CONTRACT.md) — **never** auto-write.
Render a unified-style diff of **only** the `narrative.voice` mapping
(`tone`, `sentence_length`, `signature_phrases`, `avoid`) — old values on the left,
proposed on the right — and a one-line rationale per field tied to Step 2 evidence.
Do **not** modify any other key (`headline`, `superpowers`, `proof_points`, comp,
etc.). Then ask the user to approve, edit, or reject.

## Step 4 — Apply (only on explicit approval)
On a clear "yes":
1. Edit `data/profile.yml` in place, replacing **only** the four `narrative.voice`
   fields with the approved values. Preserve all surrounding keys, comments,
   ordering, and indentation. Re-read the file after to confirm it still parses.
2. **Merge, don't clobber** `signature_phrases`/`avoid`: keep curated entries the
   user already had unless they ask to drop them; add the new ones.
On a "no"/partial: apply only what they accepted, or leave the file untouched.

## Step 5 — Hand off
Tell the user: which fields changed (1-3 lines), the corpus you learned from, and
that the new voice takes effect on the next `build-cv`/`build-cl` (those modes read
`narrative.voice` + `data/writing-samples/`). Remind them that ongoing precision
comes from editing drafts and running **"learn from my edits"** (`style-learn`).

## Never
Write `data/profile.yml` without showing a diff and getting explicit approval ·
touch any key outside `narrative.voice` · invent a voice from an empty/thin corpus
(ask for samples instead) · delete the user's curated `signature_phrases`/`avoid`
entries · write to `data/style/*` (that's `style-learn`) · fabricate evidence.
