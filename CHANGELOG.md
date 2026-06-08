# Changelog

All notable changes to CareerOS are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-08

First public release. CareerOS is a Claude Code-native, LaTeX-first CV +
cover-letter builder fused with a job-application pipeline that learns from your
own documents — no server, no API key.

### Added

- **Tailored documents.** ATS-safe LaTeX CV and cover-letter generation compiled to
  PDF with `tectonic`, validated by an automated ATS smoke test (selectable text,
  extractable keywords, no ligature contamination, sensible reading order).
- **Job evaluation.** A six-dimension weighted scoring rubric producing an A–G
  report with an embedded machine-readable summary.
- **Hybrid learning loop.** Edits to a draft are diffed, distilled into a versioned
  style profile (confidence/recency/supersede mechanics), and banked as TF-IDF
  retrievable examples — so each draft sounds more like you. Fully local; nothing
  deleted, everything rebuildable from saved snapshots.
- **Guided onboarding (`onboard`).** Turns an uploaded CV + cover letter into a
  profile, a master CV, and a learned writing voice.
- **Warm-start example bank (`seed-examples`).** Seeds the style bank from existing
  CV bullets and cover-letter paragraphs so the first draft is already in-voice.
- **Self-correcting drafts.** `build-cv`/`build-cl` grade their own output against
  the user's voice, the job's must-have keywords, and the no-fabrication/no-filler
  rules, then revise before presenting.
- **Full-posting URL scraping (`fetch-jd`).** Resolves a single job URL into the
  complete posting via the ATS's own API (Greenhouse, Lever, Recruitee,
  SmartRecruiters) or the page HTML/JSON-LD, captures the posting date, saves it
  locally, and falls back to an in-session fetch for JS-rendered pages.
- **Job-match board (`board`).** Ranks open roles by how well they match your CV into
  bands (STRONGEST / Very strong / Strong / Moderate / Weak) with posting recency
  and have/gap skills, and one-command tailoring. Filter by match band, recency,
  country/city, and **job type** — full-time, internship, **PhD**, **post-doc**,
  contract or temp. Job type is classified from the role title (not loose prose), so
  a posting that merely mentions interns won't pollute the Internship filter, and a
  genuine "PhD Internship" lists under **both** the PhD and Internship filters. Each
  row also surfaces any **language requirement** the posting states
  (e.g. *English (req), French (plus)*).
- **Multi-board fetch.** Zero-token, no-MCP fetch across Indeed, ZipRecruiter,
  Glassdoor and Google Jobs via an optional `python-jobspy` sidecar, deduped into
  the board through the same engine as `scan`/`hunt`.
- **Company-direct ATS scan (`scan`).** Pulls roles straight from company career
  pages across seven providers (Greenhouse, Lever, Ashby, Workable, Recruitee,
  SmartRecruiters, plus a generic parser).
- **Local web control panel.** A dark "trading-desk" dashboard (Next.js, bound to
  `127.0.0.1`) over the board, application pipeline and hunt flows; zero-token
  scripts run directly while judgment work is queued for the in-session agent.
- **Public-demo fork-gate.** With `NEXT_PUBLIC_CAREEROS_PUBLIC=1` the board becomes a
  read-only showcase: every mutating action is refused server-side (HTTP 403) and a
  modal invites visitors to fork the repo and run it in their own Claude Code.
- **Job-pipeline tooling.** A JSONL application tracker with rendered views,
  follow-up cadence, outcome analytics, multi-role comparison, interview
  preparation, and offer negotiation.
- **Community / meta files.** Issue forms (bug + feature), an issue-template config
  that routes security reports privately, a pull-request template, and `SUPPORT.md`.
- **Privacy by default.** All personal data lives under a git-ignored `data/`
  directory and never enters the repository.

### Security

- The shared HTTP transport enforces an SSRF host guard, re-validating **every**
  redirect hop, with timeouts that also cover response-body reading.

### Quality

- Deterministic, zero-token engine with broad self-test coverage — `npm test` →
  **478 checks green** — plus a `tectonic` + ATS compile check and an end-to-end
  learning-loop integration test. Scripts default to JSON output, accept
  `--help`/`-h`, use standard exit codes, and emit JSON on error under `--json`.
