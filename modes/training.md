# mode: training — evaluate a course / certification / upskilling choice

Trigger: `/og training <course|cert|degree name or URL>`. Decides whether a piece
of training is worth the user's time/money given their target roles and current gaps.

> Load order: `_shared.md` → this file → `data/profile.yml` (`target_roles`,
> `narrative`) + `data/cv.master.md` (current skills) → recent `data/reports/*`
> (recurring `soft_gaps`/`hard_stops` are the real signal of what to learn).

## Step 1 — What does it actually teach?
Summarise the syllabus/skills (fetch the URL if given). Be concrete: which tools,
depth (intro vs production), and what artefact it leaves you with (cert, project,
portfolio piece).

## Step 2 — Gap fit
Map it against:
- The user's `target_roles.archetypes` and the skills those JDs keep demanding.
- **Recurring gaps** mined from past evaluation reports (if `patterns`/`analyze`
  has run, cite the most frequent `soft_gaps`). Training that closes a repeated
  gap scores high; training that duplicates existing strengths scores low.

## Step 3 — ROI verdict
Weigh time + cost vs benefit and give a clear call:
- **Do it now** — closes a high-frequency gap blocking target roles.
- **Later / only if** — useful but not the current bottleneck (state the condition).
- **Skip** — duplicates existing skills, or signal value < effort (a portfolio
  project would teach it better — suggest one).
Prefer building a real, showable project over collecting certificates when that
demonstrates the skill more credibly.

## Step 4 — If "do it now"
Suggest where the resulting skill/credential should surface (a `cv.master.md`
Skills line, a Projects entry, a Certifications entry) so a future `build-cv` can use
it. Optionally note it in `data/_profile.md` as a plan.

## Never
Recommend paid training that duplicates a demonstrated strength · ignore the user's
actual target roles · treat a certificate as equal to shipped, quantified work.
