# Changelog

All notable changes to CareerOS are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Works with ANY AI coding agent — no longer Claude Code-only.** The canonical
  project brief now lives in the cross-tool [`AGENTS.md`](AGENTS.md) standard (read
  natively by Codex CLI, Cursor, Zed, and others), and the `/cos` mode router moved
  from the Claude skill into the agent-neutral `modes/_router.md`. `CLAUDE.md`,
  `GEMINI.md`, and `.github/copilot-instructions.md` are thin per-tool shims that
  defer to `AGENTS.md`; the `.claude/skills/` entries defer to the router.
  Tool-specific features (Claude Code's Indeed/Dice MCP connectors, `/loop`
  auto-drain, the `claude-api` reference skill) are documented as optional
  enhancements with portable fallbacks (jobspy multi-board fetch, ATS scan, web
  search), and all docs + web-panel copy now say "your AI agent" instead of
  assuming Claude Code.

- **Upload your CV + cover letter from the web panel.** A **⤴ my CV/CL** button stages
  the files under `data/ui/uploads/` and enqueues an `onboard` request for the agent to
  learn your facts + voice from; then the board fills with CV-matched jobs.
- **Per-job output folders.** Each posting's CV and cover letter are written together in
  `data/output/<company-slug>--<role-slug>/` with self-describing filenames, so a job's
  documents are easy to find. The web **Pipeline** tab links each application's CV/CL, and
  the queue popover links a finished build's PDFs.
- **"Clear completed" queue control.** Archives done/failed requests to
  `data/ui/requests.archive.jsonl` (history kept) and trims the active queue — never a hard delete.
- **Optional auto-drain.** Documented `/loop 30s /cos ui drain` so work queued in the
  browser executes within seconds without a manual `/cos ui` (with per-mode safety: onboard
  shows a profile diff before overwriting, apply never submits).
- **Explicit "fetch URL" control** next to the paste-a-job-URL box (it previously only
  submitted on Enter, with no button, beside the unrelated "scan").

### Changed

- **Web panel upgraded to Next.js 15 + React 19** (resolves all open `npm audit` advisories;
  async route params; `outputFileTracingRoot` set to silence the multi-lockfile warning).
- **Generic-HTML job scraping** now splits a `Role - Company` / `Role | Company` page title,
  so postings from unknown ATSes (e.g. skeeled) land on the board with a real employer.

### Fixed

- **Workable provider HTTP 400** (`{"limit":"Not allowed"}`) — the v3 jobs API stopped
  accepting a `limit` field; `scan` now completes all companies again.
- **Paste-a-URL flow** strips trailing junk (surrounding quotes, a dragged-in file path)
  from pasted text before fetching, both client- and server-side.

### Security

- **Staged uploads are auto-purged.** A request reaching a terminal state (done/failed)
  deletes any CV/CL it referenced under `data/ui/uploads/` — hard-fenced so only paths
  strictly inside that staging dir can ever be removed.
- **Hardened `.gitignore`** for `.env*.local`, `*.key`, and `*.pem` (the full `data/`
  layer, including all uploaded PII, was already git-ignored).

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
