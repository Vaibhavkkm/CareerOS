# mode: saved — your bookmarked shortlist (build CV + CL for all of them at once)

Trigger: `/cos saved` (alias `shortlist`, `bookmarks`). The user ticks ★ on jobs in
the web board (or saves via `scripts/saved.mjs add`); this mode lists that shortlist
and, on request, generates a tailored CV **and** cover letter for **every** saved
posting in one go — so they can save 10 roles during the week and produce all the
applications together.

> Saved jobs live in `data/ui/saved.jsonl` (User layer). Saving NEVER touches the
> tracker or marks anything `applied` — it's a private shortlist. The build step
> produces drafts; the human still submits.

## Sub-commands
Parse the router input after `saved`:
- (none) / `list` → show the shortlist.
- `build-all` / `build` / `apply-all` → generate CV+CL for every saved job.
- `clear` → empty the shortlist (`node scripts/saved.mjs clear`), after confirming.
- `remove <url>` → `node scripts/saved.mjs remove --url <url>`.

## Step 1 — List (default)
Run `node scripts/saved.mjs list --json`. Render a numbered shortlist: company —
role, band, and the saved date. If empty, tell the user to tick ★ on a board row
(or paste a URL and save it) and stop. Always end the list by surfacing the
one-shot: **"build a tailored CV + cover letter for all N → `/cos saved build-all`"**.

## Step 2 — build-all (the headline)
For EACH saved job, in list order, run the normal pipeline EXACTLY as if the user
invoked it per job — honoring every gate and guardrail in those playbooks:

1. **Resolve the posting**: use `jd_path` if present; else fetch the `url` to
   `data/jds/` via `fetch-jd` first. Skip (with a noted reason) any job whose JD
   can't be resolved.
2. **Evaluate** (`modes/evaluate.md`) if there's no report yet — so the build
   reuses the archetype/keywords and respects the score gate. If a job scores below
   `compile_score_threshold`, SAY SO and ask before spending a compile on it (don't
   silently skip or silently build a sub-threshold fit).
3. **Build CV** (`modes/build-cv.md`) → style context → draft → snapshot
   (`data/style/edits/<id>/ai_draft.tex` + `context.json`) → `compile-latex.mjs`.
4. **Build CL** (`modes/build-cl.md`) the same way.
5. Record each output under its per-job folder
   `data/output/<company-slug>--<role-slug>/` and keep the paths.

Process them sequentially (each build reads/writes the shared example bank, so a
race would corrupt the learning loop). Show progress as you go ("3/10 — Acme Data
Scientist: CV + CL built").

## Step 3 — Summarize
Print a table: for each saved job → CV pdf · CL pdf · score/band · any skipped
reason. Point the user at the per-job folders to review, and remind them: review the
PDFs, then mark each **Applied** in the UI only once they've actually submitted
(applying stays a human, per-job confirm — never batch-flip the tracker).
Offer to `clear` the shortlist now that the drafts exist.

## Auto-drain note (web ★ → build)
The web "★ save" button only writes the shortlist; the BUILD is agent work. After
saving jobs in the browser, the user runs `/cos saved build-all` in this session (or
leaves `/loop 30s /cos ui drain` running and triggers builds from the queue). The
button's hint already tells them the command.

## Never
Fabricate a posting, a metric, or a match · build for a role below the user's gate
without saying so · mark anything `applied` from this mode (the queue/tracker rule
holds — applying is a separate human confirm) · build all in parallel (corrupts the
example bank) · invent skills to inflate a saved job's fit.
