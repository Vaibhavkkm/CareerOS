# Changelog

All notable changes to CareerOS are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Community/meta files: issue forms (bug + feature), an issue-template config that
  routes security reports privately, a pull-request template, and `SUPPORT.md`.

### Changed / Hardened
- CLI robustness pass across the toolchain:
  - `tracker`/`fetch-jd` now create parent directories when writing to custom
    paths (no more `ENOENT` on a nested `--file`/`--out`).
  - `parseScore` no longer silently turns a negative input into a positive score.
  - The match board filters recruiting boilerplate (e.g. "if", "range", "value")
    out of the skill keyword/gap lists.
  - Consistent CLI surface: scripts default to JSON output, accept `--help`/`-h`,
    use standard exit codes, and emit JSON (not plain text) on error under `--json`.
  - `htmlToText` strips zero-width / format / bidi / surrogate characters.
  - `doctor` prints ASCII status markers when output isn't a TTY (or with `--plain`).
- Test coverage raised to ~380 checks, including a new `compile-latex` self-test
  and mocked-network tests for the URL scraper's fallback logic.

> The hosted web UI and large-scale multi-company discovery remain on the roadmap.

## [0.1.0] — 2026-06-07

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
- **Guided onboarding (`onboard`).** Turns a user's uploaded CV + cover letter into
  a profile, a master CV, and a learned writing voice.
- **Warm-start example bank (`seed-examples`).** Seeds the style bank from the
  user's existing CV bullets and cover-letter paragraphs so the first draft is
  already in-voice.
- **Self-correcting drafts.** `build-cv`/`build-cl` grade their own output against
  the user's voice, the job's must-have keywords, and the no-fabrication/no-filler
  rules, then revise before presenting.
- **Full-posting URL scraping (`fetch-jd`).** Resolves a single job URL into the
  complete posting via the ATS's own API (Greenhouse, Lever, Recruitee,
  SmartRecruiters) or the page HTML/JSON-LD, captures the posting date, saves it
  locally, and falls back to an in-session fetch for JS-rendered pages.
- **Job-match board (`board`).** Ranks open roles by how well they match your CV
  into bands (STRONGEST / Very strong / Strong / Moderate / Weak) with posting
  recency and your have/gap skills, filterable by band and recency, with
  one-command tailoring.
- **Job-pipeline tooling.** Portal scanning across seven sources, a JSONL
  application tracker with rendered views, follow-up cadence, outcome analytics,
  multi-role comparison, interview preparation, and offer negotiation.
- **Privacy by default.** All personal data lives under a git-ignored `data/`
  directory and never enters the repository.

### Security

- The shared HTTP transport enforces an SSRF host guard, re-validating **every**
  redirect hop, with timeouts that also cover response-body reading.
