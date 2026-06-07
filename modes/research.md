# mode: research — deep company/role research for a specific candidate

Trigger: `/og research <company> <role>`. Builds a structured **6-axis research
plan**, runs your own WebSearch/WebFetch to fill it, and returns a sourced brief.
Output feeds `evaluate` (Block D company signals + Block G legitimacy), the
`build-cl` hook, and `interview-prep`. No script — this is a pure agent playbook.

> Load order: `_shared.md` → this file → `data/profile.yml` + `data/cv.master.md`
> (+ `data/article-digest.md`) → `data/_profile.md`. You need the candidate's
> ground truth to compute Axis 6 (their angle).

## Inputs you need
- `<company>` and `<role>` (from args, a named report's source, or a JD).
- If a report exists, read `data/reports/NNN-*.md` for the archetype, score, and
  any company signals `evaluate` already gathered — extend, don't redo.
- The candidate's facts: `narrative` (superpowers, proof_points, exit_story),
  `target_roles`, and matching bullets/metrics in `data/cv.master.md`.

## Step 1 — Detect archetype + frame the angle
Detect the role's archetype (see `_shared.md`) and map it to the user's
`target_roles.archetypes` fit (primary/secondary/adjacent). This frames every
axis below toward what *this candidate* should learn and say.

## Step 2 — Generate the 6-axis research plan
Lay out these six axes as the plan. Under each, write 2–4 specific questions
**named for this company/role** (never generic), then fill them in Step 3.
1. **AI/tech strategy** — stack, build-vs-buy, where AI/ML sits in the product,
   public eng decisions. (If LLM/agent/RAG work is in scope, ground model facts
   in the `claude-api` skill — don't answer model/pricing/limits from memory.)
2. **Recent moves / funding / news** — last ~12 months: funding round + stage,
   launches, pivots, leadership changes, layoffs/hiring freezes (feeds Risk).
3. **Eng culture & team** — team size/structure, on-call, review/ship cadence,
   values, who the likely hiring manager and teammates are.
4. **Likely challenges this role solves** — read the JD between the lines: what
   pain created this opening? What would the first 90 days own?
5. **Competitors / market** — 2–3 named competitors, the company's wedge, market
   tailwinds/headwinds.
6. **The candidate's specific angle** — for THIS profile only: which 1–2
   `narrative.superpowers` / `proof_points` map to Axis 4's challenges, how the
   `exit_story` lines up, and the single sharpest hook for a cover letter / first
   message. Ground every claimed metric in `data/cv.master.md` — never invent.

## Step 3 — Fill it (your own web tools)
Run WebSearch/WebFetch to answer each axis's questions. Prefer the company's own
site, eng blog, careers page, the real ATS posting, recent news, and the founders'
posts. **Cite every external claim with its URL.** Mark anything you couldn't
confirm as *Unverified* — never guess to fill a gap. Note conflicting comp/details
or a thin company footprint; these are legitimacy signals (see `_shared.md` tiers).

## Step 4 — Synthesize the brief (return in chat)
Output, tight:
- **Snapshot** — one line per axis: the single most decision-relevant finding.
- **For `evaluate`** — Block D inputs (culture/risk/market signals) and a
  proposed Block G legitimacy tier (`_shared.md`) with the reason.
- **For `build-cl` / outreach** — the one researched hook signal (with its URL),
  phrased for Para 1. No generic flattery.
- **For `interview-prep`** — 3–5 smart questions to ask them + 2 likely areas
  they'll probe, each mapped to a real story from `data/cv.master.md`.
- **Sources** — bulleted URLs with a one-line note each.

## Step 5 — Save (optional, ask first)
Offer to persist the brief to `data/interview-prep/<company>-<role>.md` (slugify
both; this is User data — see DATA_CONTRACT.md — so confirm before writing and
never clobber an existing file; append a dated section instead). Tell the user
they can now run `/og evaluate`, `/og build-cl`, or `/og interview-prep`, which
will reuse this brief.

## Never
Invent funding/headcount/news/metrics or a hook you can't cite · present an
Unverified claim as fact · skip Axis 6 (this is what makes the brief the
*candidate's*, not a wiki dump) · write to `data/` without the user's say-so ·
share the user's phone in any outreach hook · embed a Machine Summary (this mode
plans research, it does not score — `evaluate` owns the score + schema).
