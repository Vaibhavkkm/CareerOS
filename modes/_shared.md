# _shared.md — rules every mode loads first

This file is auto-loaded before any mode. It holds the scoring rubric, role
archetypes, legitimacy tiers, guardrails, and the ATS/LaTeX/voice rules. Modes
reference these by name instead of redefining them.

---

## Scoring rubric (6 dimensions → overall /5)
Score each dimension 1–5, then take a **weighted** overall. Round to one decimal.

| Dim | Weight | What it measures | 5 = | 1 = |
|---|---|---|---|---|
| **Match** | 0.30 | CV ↔ JD requirement overlap (skills, level, domain) | Hits all must-haves + most nice-to-haves | Missing multiple must-haves |
| **North Star** | 0.25 | Fit with the user's stated direction (`target_roles`, `narrative.exit_story`) | Squarely on-path, a step up | Off-path / a step back |
| **Comp** | 0.15 | Pay vs `compensation.target_range`/`minimum` | At/above target, transparent | Below minimum or opaque |
| **Culture** | 0.10 | Team/eng-culture/values signals | Strong, evidenced positives | Red flags (churn, chaos) |
| **Risk** | 0.10 | Stability, role clarity, layoff/funding risk | Low risk, clear charter | High risk / vague scope |
| **Global/Logistics** | 0.10 | Location, timezone, visa, remote policy vs `location` | Fully compatible | Incompatible (e.g. needs sponsorship, none offered) |

**Decision bands** (from overall): **≥4.5 Apply (priority)** · **4.0–4.4 Apply** ·
**3.5–3.9 Consider / research first** · **<3.5 Skip** (recommend against). A hard
stop (see below) caps the overall at 3.4 regardless of other dimensions.

**Gates** (from `data/profile.yml`, retunable by `patterns` mode):
- `compile_score_threshold` (default 3.0): only compile a tailored CV at/above this.
- `draft_answers_threshold` (default 4.5): only pre-draft application answers at/above this.

**Hard stops** (cap the score, never fabricate around them): missing a non-negotiable
requirement (e.g. clearance/visa the user can't meet), comp below `minimum`,
location incompatible with `location_flexibility`.

---

## Role archetypes (Step 0 of any evaluation: detect from JD signals)
Detect 1–2 archetypes; this drives scoring emphasis AND which CV fragments
`build-cv` includes. (Customize this list to the user's field — these are starters.)

| Archetype | JD signals |
|---|---|
| **Backend / Distributed Systems** | services, APIs, scale, latency, reliability, queues, databases |
| **Platform / Infra / SRE** | kubernetes, terraform, CI/CD, observability, cost, on-call |
| **Data / ML** | pipelines, models, training, features, SQL, warehouse, inference |
| **Full-Stack / Product** | React/frontend + backend, ship features, user-facing, A/B |
| **Lead / Staff** | technical direction, mentorship, cross-team, ambiguity, strategy |
| **Specialist** | a named niche (security, search, payments, LLMOps, etc.) |

Map the detected archetype to the user's `target_roles.archetypes` `fit`
(primary/secondary/adjacent) — adjacent fits start one band lower on North Star.

---

## Legitimacy tiers (non-scoring; report in Block G)
- **High Confidence** — known company, real ATS posting, consistent comp/details.
- **Proceed with Caution** — thin company footprint, vague comp, recruiter-only,
  or a too-good-to-be-true range.
- **Suspicious** — asks for payment/SSN/bank up front, off-platform "interviews"
  over chat only, generic domain email, copy-pasted JD. Warn the user explicitly.

---

## Guardrails
**NEVER:** auto-submit/click submit · fabricate experience, metrics, employers,
titles, or dates · flip a record to `applied` before the user confirms submission ·
share the user's phone in cold outreach · add `\input{glyphtounicode}`,
`\pdfgentounicode`, or microtype `DisableLigatures` to a `.tex`.

**ALWAYS:** keep the human in the loop · ground every claim in
`data/cv.master.md`/`data/profile.yml` · escape raw values with `latexEscape` ·
compile via `scripts/compile-latex.mjs` and require its smoke test to pass ·
snapshot the AI draft for the learning loop · state missing requirements honestly.

---

## Grow the auto-fetch list — when the user pastes a link from a NEW source
When a user hands you a job **link** (auto-pipeline Step 0, or a pasted URL in
`hunt` / `pipeline`), check whether that company is already auto-fetched — i.e. has a
`tracked_companies` entry in `data/portals.yml`. If it does, just proceed. If it does
**not**, after you've handled the posting, nudge them **once** (never nag, never block
the result) so they never have to paste that company again:

- **Supported ATS** (`fetch-jd.mjs` reported a `source` of greenhouse / lever / ashby /
  workable / recruitee / smartrecruiters): it's a one-line add. Show the exact entry —
  `{ name: "<Co>", provider: <ats>, api: "<token>", enabled: true }` (derive `<token>`
  from the URL; see each `scripts/providers/<id>.mjs`). Offer to:
  1. add it to **their own** `data/portals.yml` now (confirm first — it's their private,
     git-ignored data) so their next `/cos scan` pulls every open **and future** role; AND
  2. **contribute it upstream** — open a PR adding that line to the PUBLIC seed list
     `templates/portals.example.yml`, so every CareerOS user gets that company too.
- **Unsupported / custom source** (`fetch-jd.mjs` fell back to generic HTML or
  `needs_agent_fetch` — e.g. a self-hosted careers page): there's no provider for it yet,
  so it can't be auto-scanned. Point them at the bigger contribution — a new
  `scripts/providers/<id>.mjs` plugin (or a `local-parser` entry) per `CONTRIBUTING.md` —
  and offer to draft it.

Frame it as a win on both sides: more sources auto-fetched = a stronger, hands-off
pipeline for them, and a public-repo contribution that strengthens their own
open-source profile. You may **draft** the change (branch, edit, PR body), but — per the
guardrails — NEVER auto-open the PR, push, or edit anything under `data/` without an
explicit confirm; the human ships it.

---

## ATS rules (resume parsers)
- Single column. Real selectable text. Standard section names: SUMMARY,
  EXPERIENCE, EDUCATION, SKILLS, PROJECTS.
- No tables/multicol for content; no text in headers/footers; no icon fonts.
- Inject 15–20 JD keywords — but ONLY into REAL achievements. Mirror the JD's
  exact phrasing where truthful ("Kubernetes" not "k8s" if the JD says Kubernetes).
- Strong past-tense verb + quantified outcome per bullet. One page when possible.

## LaTeX rules (tectonic / XeTeX — verified on this machine)
- **Theme resolution** (same placeholders in every theme, so filling is identical):
  explicit `profile.yml cv.cv_template`/`cl_template` paths win; else `cv.theme`
  (or a theme the user names in the request) maps to
  `templates/cv.<theme>.tex.tmpl` / `cl.<theme>.tex.tmpl`; `classic` (default) =
  the bare `templates/cv.tex.tmpl` / `cl.tex.tmpl`. List themes with
  `ls templates/cv*.tex.tmpl`. CV and CL of one application use the SAME theme.
- Fill `<<PLACEHOLDERS>>` only; never alter a template's preamble macros.
  Leave NO `<<...>>` behind (compile-latex fails on them).
- Keep `\defaultfontfeatures{Ligatures={NoCommon}}` (ATS-critical). Font by filename.
- **LaTeX escaping table** (apply to raw data via `lib/text.mjs latexEscape`):
  `& → \&` · `% → \%` · `$ → \$` · `# → \#` · `_ → \_` · `{ → \{` · `} → \}` ·
  `~ → \textasciitilde{}` · `^ → \textasciicircum{}` · `\ → \textbackslash{}` ·
  `± → $\pm$` · `→ → $\rightarrow$` · smart quotes → `` `` ''`` · en/em dash → `--`/`---`.

## Output location & file naming (the #1 findability rule — apply in build-cv / build-cl / apply)
Every candidate-facing artifact for a job goes in **its own per-job folder** so the
user can find a posting's CV + cover letter together at a glance:

> `data/output/<company-slug>--<role-slug>/`

- `<company-slug>` and `<role-slug>` are `slugify`-style: lower-case, non-alphanumerics
  → `-`, trimmed, each capped ~40 chars (same rule as `scripts/fetch-jd.mjs slugify`).
  Unknown company → use `company`.
- Inside that folder, name files by **kind + company + role + date** so a file is still
  identifiable on its own once downloaded:
  - CV  → `cv-<company-slug>-<role-slug>-<YYYY-MM-DD>.tex` (compiles to the matching `.pdf`)
  - CL  → `cl-<company-slug>-<role-slug>-<YYYY-MM-DD>.tex`
  - apply answers / references keep the same folder.
- `compile-latex.mjs` writes the `.pdf` next to the `.tex`, so just point it at the path
  above — it creates nothing outside the folder.
- After compiling, **always tell the user the exact folder + PDF path** in the hand-off,
  and store it on the tracker record (`cv_pdf` / `cl_pdf`) so the Pipeline tab links it.

Example: Acme, "Senior Backend Engineer", 2026-06-10 →
`data/output/acme--senior-backend-engineer/cv-acme-senior-backend-engineer-2026-06-10.tex`.

---

## Voice & quality
Write in the candidate's voice (`data/profile.yml narrative.voice` + learned
`data/style/profile.json`). Default to: direct, concrete, metric-led, no first
person on the CV, no corporate filler.

**Banned/filler (seed list — the learning loop extends it):** worked on, helped,
assisted, responsible for, tasked with, utilize(d), leverage(d) (as verb), synergy,
results-driven, detail-oriented, team player, passionate about, various, several,
successfully, in order to, a variety of. Prefer specific strong verbs: designed,
built, shipped, cut, scaled, automated, led, migrated, reduced, increased, owned.

**Cover letters:** match the candidate's own reference letter's structure when they
have one (often 4–5 short paragraphs); otherwise 3 (hook with a researched specific
signal / proof with quantified achievements mapped to the JD / confident close). No
"To Whom It May Concern", no "I am writing to apply", no pleading. Use ONE honesty
cue if any; convert concessions into claims where there's real evidence.

**Document formatting (CV / cover letter / references):** when the candidate has a
reference document, MATCH its layout (letterhead alignment, justification, sign-off)
rather than imposing template defaults. **Bold the field labels and key items** —
Email:/LinkedIn:/Relationship: on a references sheet; named systems + metrics in CV
and cover-letter bodies. A per-position CV/cover letter should *try* to fit ONE page — by TRIMMING content
(cut the least-relevant skills/projects/bullets), never by compressing line spacing
or cramming the header; a SECOND page is acceptable when the remaining content is
genuinely important. The master/reference CV has NO page limit (it is the full
source — let it run several pages with readable spacing). Apply the candidate's saved
`data/profile.yml narrative.voice.formatting` every time. Stay strictly within the
user's explicit request — never edit, or offer to change, a document they didn't ask about.
