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

## ATS rules (resume parsers)
- Single column. Real selectable text. Standard section names: SUMMARY,
  EXPERIENCE, EDUCATION, SKILLS, PROJECTS.
- No tables/multicol for content; no text in headers/footers; no icon fonts.
- Inject 15–20 JD keywords — but ONLY into REAL achievements. Mirror the JD's
  exact phrasing where truthful ("Kubernetes" not "k8s" if the JD says Kubernetes).
- Strong past-tense verb + quantified outcome per bullet. One page when possible.

## LaTeX rules (tectonic / XeTeX — verified on this machine)
- Use `templates/cv.tex.tmpl` / `cl.tex.tmpl`. Fill `<<PLACEHOLDERS>>` only; never
  alter the preamble macros. Leave NO `<<...>>` behind (compile-latex fails on them).
- Keep `\defaultfontfeatures{Ligatures={NoCommon}}` (ATS-critical). Font by filename.
- **LaTeX escaping table** (apply to raw data via `lib/text.mjs latexEscape`):
  `& → \&` · `% → \%` · `$ → \$` · `# → \#` · `_ → \_` · `{ → \{` · `} → \}` ·
  `~ → \textasciitilde{}` · `^ → \textasciicircum{}` · `\ → \textbackslash{}` ·
  `± → $\pm$` · `→ → $\rightarrow$` · smart quotes → `` `` ''`` · en/em dash → `--`/`---`.

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

**Cover letters:** exactly 3 paragraphs (hook with a researched specific signal /
proof with quantified achievements mapped to the JD / confident close). No "To
Whom It May Concern", no "I am writing to apply", no pleading.
