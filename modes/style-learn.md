# mode: style-learn — distill your edits into the style profile + example bank

Trigger: `/cos style-learn` (or the user says **"learn from my edits"** / "I'm
done editing"). This is the brain of the learning loop: it turns the difference
between the AI draft and your hand-edited final into durable, reusable knowledge.

## When this runs
After `build-cv`/`build-cl` produced `data/style/edits/<id>/ai_draft.tex` and you
edited the working copy in `data/output/`. This mode captures your final and learns.

## Step 1 — Capture the final
1. Find the most recent `data/style/edits/<ts>__<app-id>/` (or the one the user
   names) that has an `ai_draft.tex` but no `user_final.tex`.
2. Read its `context.json` to learn which `data/output/...tex` it maps to.
3. Copy the user's edited working file to `user_final.tex` in that edit folder.
   - If the user pasted edits instead, write those as `user_final.tex`.
   - If `ai_draft.tex` and the final are identical, tell the user there's nothing
     to learn (they accepted the draft) and stop.

## Step 2 — Diff (deterministic)
Run `node scripts/style-diff.mjs <edit-dir> --json`. This writes `diff.json`
(unit-level kept/reworded/added/removed/reordered with feature deltas: word count,
first verb, quantification, removed filler, banned-verb hits). Read the summary.

## Step 3 — Distill (deterministic merge, your judgment gates it)
Run `node scripts/style-profile.mjs apply --edit <edit-dir>`. This updates
`data/style/profile.json` with confidence/recency/supersede mechanics and
re-renders `data/style/profile.md`. **Before** trusting it, sanity-check the
diff for noise:
- If an edit was a one-off (a company-specific fact, a typo fix), it should NOT
  become a style rule. The script's `provisional → active` gate (needs the same
  signal **twice**) already protects against this — but if you see the script
  proposing a clearly spurious rule, note it; rules are reversible (status-flip,
  never deleted) and you can tell the user to ignore/retire it.
- Watch for **contradictions** (you reworded toward something you previously cut):
  the script supersedes the older rule on recency — confirm that matches intent.

## Step 4 — Bank examples
Run `node scripts/style-profile.mjs bank --edit <edit-dir>`. Your accepted
bullets/paragraphs go into `data/style/examples.jsonl` (tagged by archetype +
skills) and update `data/style/idf.json`, so the next draft can few-shot on your
actual writing.

## Step 5 — Report what was learned
Summarize for the user, e.g.:
- "Banned **'spearheaded'** → prefer **'led'** (seen 2×, now active)."
- "New rule: lead every Experience bullet with a number (provisional, 1×)."
- "Banked 4 bullets to the example bank (now N total)."
Point them to `data/style/profile.md` (human view) and
`data/style/CHANGELOG.style.md` (audit log). Note that nothing is ever deleted —
`node scripts/style-profile.mjs --rebuild` can re-derive the whole profile from
the raw edit snapshots if needed.

## Relationship to the voice loop
`style-learn` learns from **edits** (precise, refinement). The separate
`recalibrate-voice` flow learns from your **prose corpus** in
`data/writing-samples/` (cold-start voice). They're complementary; both feed
`build-cv`/`build-cl`.

## Never
Promote a single-occurrence edit straight to an active rule (respect the gate) ·
delete rules (only status-flip) · learn from a final identical to the draft ·
treat company-specific facts as style.
