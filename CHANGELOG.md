# Changelog

All notable changes to CareerOS are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.0] - 2026-06-15

### Added

- **Board search / fetch omnibox.** A search box filters the loaded board by company,
  role, skill, or location; paste a job URL into the same box and press Enter to fetch
  that posting onto the board instead.
- **Resizable detail drawer.** Drag the drawer's left edge to resize it (double-click
  resets); a toggle in the stat bar collapses the stats + filter bar for a focused board.
- **View generated docs in the drawer.** A job's drawer shows the tailored CV/CL PDF,
  eval report, and raw LaTeX inline; clicking a document also opens it in a new tab.
- **Saved tab.** A `/saved` page listing your ★-bookmarked jobs with open / build CV /
  build CL / remove per row.

### Changed

- Removed the redundant bottom status line on the board (its counts live in the stat bar).

### Fixed

- **Generic job-page fetch now extracts the real job, not the nav.** Pages that render
  the job server-side but wrap it in heavy menu chrome (e.g. Odoo career sites) used to
  scrape as nav-junk (a bogus "Job Detail" posting) or get punted to an agent. The
  scraper now strips nav/header/footer, reads the body from the main content region,
  and falls back to the page `<h1>` when the `<title>` is a placeholder — so these URLs
  fetch **directly** onto the board.
- **Full salary range.** A stated range worded as "$36 – $50 an hour" now shows whole,
  not just the first figure.

## [0.5.0] - 2026-06-15

### Added

- **Skill-gap roadmap (`gaps`).** Aggregates the skill gaps across every saved
  posting and ranks which single skill would unlock the most roles — weighted toward
  the near-misses you're already close on. Zero-token (`node scripts/gaps.mjs`).
- **CV bullet linter (`cv-lint`).** Deterministically flags weak bullets
  (un-quantified, weak-verb, passive, filler, too long/short) using the same signals
  as the learning loop. Zero-token; `--min-score` works as a CI gate.
- **Stated-salary reader (`salary`).** Extracts the pay band a posting actually
  *discloses* (never estimates) — surfaced as a `· €…` column on the board and used
  as an anchor in `negotiate`.
- **Interview scheduler (`interviews`).** Tracks interview rounds, exports an
  `.ics` calendar for Google/Apple/Outlook, and flags follow-ups that are due.
- **CV theme picker.** `build-cv --theme classic|modern|academic|compact` resolves a
  theme through a new registry (`scripts/templates.mjs`); adds **Academic** and
  **Compact** themes (your existing Modern theme is unchanged). All share the same
  ATS-safe single-column preamble.
- **Multi-CV onboarding.** `parse-cv --file … --file …` / `--dir <folder>` parses
  several CVs at once and `onboard` merges them into one richer master (union +
  dedup, conflicts surfaced for your approval — never fabricated). Keeps the
  structured-JSON parser (PDF via pdftotext, DOCX via unzip, LinkedIn export).
- **Warm-referral mode (`referral`).** Maps the warmest realistic path into a
  company and drafts the ask + a forwardable blurb; `outreach` is now explicitly the
  *cold* (strangers) path.
- **Region-aware multi-board fetch.** When you search a region without naming boards,
  the sweep auto-adds the local board (Naukri for India, Bayt for the Gulf/Egypt,
  bdjobs for Bangladesh), deduped.
- **"Send to CareerOS" browser extension + bookmarklet.** Capture a job page from any
  site straight onto your board via a local-only `POST /api/inbox` (routes through
  `hunt-ingest`; never auto-applies; 127.0.0.1-bound, off in public mode).
- **Multi-CV drag-drop upload.** The existing "⤴ my CV/CL" dialog now takes several
  CVs at once (drag-drop or multi-pick) plus the optional cover letter — in your
  theme, still safely queuing for the agent (writes only `data/ui/`). The agent merges
  them into one richer master.
- **View generated docs inside the job drawer.** A "Documents" section appears in a
  job's drawer once you've built something for it — the tailored CV/CL PDF shown
  inline, plus the eval report and raw LaTeX. Sourced from your tracker and the daemon
  manifest, so it works however the doc was generated.
- **Board search / fetch omnibox.** A search box on the board filters the loaded
  openings instantly by company, role, skill, location, or band. Paste a job URL into
  the same box and press Enter (or the ↵ fetch button) to **fetch** that posting onto
  the board instead.
- **Optional AI daemon (`npm run daemon`).** A local background worker that can drain
  the web queue *without* a live agent session, using **any** AI you choose —
  `claude-cli` (your Claude Code login, no key), **Ollama** (local), or any
  **OpenAI-compatible** endpoint (OpenRouter, Groq, Together, the Anthropic API,
  LM Studio, …). Fully optional and additive — the agent-native model (the in-session
  agent drains the queue) stays the default. Configure with `npm run daemon:setup`;
  `.careeros.config.json` (may hold an API key) is git-ignored.

### Fixed

- **JS-rendered career sites no longer save garbage.** A plain fetch of a
  JavaScript-rendered posting (e.g. Odoo career pages) used to capture only the nav
  shell and save it as a bogus "Job Detail" posting. The fetcher now detects thin /
  nav-only / placeholder-title scrapes and flags `needs_agent_fetch`, so the
  in-session agent fetches the rendered page properly instead.

## [0.4.0] - 2026-06-15

### Added

- **Amber "Signal Console" web app.** A full redesign of the local web panel:
  segmented amber **signal meters** for every fit score, a stat bar with count-up
  totals, and a board that stays full-width until you click a role — then a detail
  pane docks in with the score breakdown and one-click Tailor CV / Cover letter /
  Evaluate / Draft answers. WCAG-AA contrast and `prefers-reduced-motion` throughout.
- **LinkedIn in the default fetch set.** Multi-board fetch now pulls Indeed,
  ZipRecruiter, Glassdoor, Google Jobs, and **LinkedIn** (anonymously, no login) by
  default; LinkedIn degrades gracefully when it throttles.
- **Country column** on the board, shown automatically when you browse more than one
  country (derived from each posting's location).
- **Cancel a queued request** from the web app's queue popover (only while still
  queued; archived for audit, staged uploads purged).
- **`COMMANDS.md`** — a dedicated command/CLI reference, so the README can stay simple.

### Changed

- **Relicensed from MIT to GNU AGPL-3.0-or-later** — modified versions that are
  distributed *or run as a network service* must stay open and keep attribution.
- **README simplified** and UI-first; the "still being built" banner removed; the
  full command reference moved to `COMMANDS.md`.

### Fixed

- Board postings now show their **real source** (indeed/greenhouse/lever/…) instead
  of being mislabeled "saved" for every row.
- Salary detection no longer reads company revenue figures (e.g. "$6.9 billion in
  sales") as a salary; it requires real pay context.
- Drawer action buttons are correctly wired and labeled (the primary CTA now actually
  builds the CV; the duplicate/mislabeled buttons are fixed).

## [0.3.2] - 2026-06-14

### Added

- Country column on the board (shown when browsing more than one country), a
  cancel button for queued requests, and the elegant CV format as the default.

## [0.3.1] - 2026-06-13

### Added

- ★ Saved-jobs shortlist; multi-select country and job-type filters.

### Fixed

- Match accuracy: experience/seniority now actually count, stopping a class of
  wrongly "strong" matches.

## [0.3.0] - 2026-06-13

### Added

- **Skill- and experience-aware match scoring** — the job-match score no longer
  relies on raw keyword overlap (which let off-stack roles rank as strong fits);
  broader job sourcing and clearer parsed postings.

## [0.2.0] - 2026-06-12

### Added

- **Bot-blocked job URLs hand off to the agent.** Pasting a URL the engine can't
  scrape (Cloudflare challenge, JS-rendered page) no longer dead-ends on an error
  toast: the web panel auto-queues a new `fetch-jd` request and the agent fetches
  the posting with its own tools (`/cos ui` drains it through `hunt-ingest`).
  HTTP errors are now human-readable one-liners ("the site is behind bot
  protection…") instead of raw HTML dumps.

- **Web "Style" tab — see and steer what it learned.** The learned style rules
  (`data/style/profile.json`) are now browsable in the control panel: grouped by
  category with status pills, confidence and scope. **Accept** promotes a
  provisional rule immediately, **retire** stops one (reversibly), and every click
  is queued (new `style` request kind) for the agent to apply via the new
  `style-profile.mjs set-status` command — manual flips are logged to
  `CHANGELOG.style.md`, nothing is deleted, and the browser still never writes
  user data directly.

- **Mailbox drafts for follow-ups (optional).** Where the agent session has an
  email-draft connector (e.g. Gmail MCP), `followup` can place an approved message
  into the user's mailbox as a *draft* — never sent, never auto-counted as sent;
  the copy-paste block remains the portable default.

- **Document themes.** A second matched CV + cover-letter theme, **modern** (Latin
  Modern Sans, slate accent rules, left-aligned header), alongside the default
  **classic**. All themes share the same placeholder/REPEAT contract; select via
  `profile.yml cv.theme` (or by asking for one), explicit `cv_template`/`cl_template`
  paths still win. Both new templates verified through the tectonic + ATS pipeline.

### Fixed

- **Web board loads in ~0.3–3 s instead of ~20 s.** Three compounding causes:
  the board render live-fetched every not-yet-saved inbox URL on every page load
  (hundreds of dead, bot-blocked links retried forever — board renders are now
  network-free via `--no-fetch`, which the web `/api/board` always passes);
  the CV was re-tokenized once per posting and every posting was tokenized
  twice (now tokenized once and shared — `prepCv`/`jdToks` fast paths, plus a
  memoized stemmer); and the spoken-language extractor compiled ~70 regexes per
  sentence (now one combined matcher, precompiled once, with a whole-text bail).

- **TF-IDF scores could exceed 1.0 and fake a STRONGEST band.** A posting whose
  text contains the literal word "constructor" hit `Object.prototype` through the
  term-frequency map, NaN'd the vector norm, and silently skipped L2
  normalization (`NaN || 1`), so its cosine blew past 1. Term maps are now
  prototype-less and the idf lookups hasOwnProperty-guarded.

- **Pinning a just-pasted posting survives dedup.** When a pasted URL is the same
  job already saved from another board (cross-board syndication), the pin now
  resolves to the surviving deduped row instead of silently missing.

- **compile-latex false positive on template headers.** Validation now strips LaTeX
  comments first, so a filled document keeping its template's instruction header
  (which *mentions* `glyphtounicode`/`DisableLigatures`/`<<...>>` as warnings) no
  longer hard-fails; real uncommented offenders still do.

- **Contacts ledger (`scripts/contacts.mjs`, `npm run contacts`).** The tracker knows
  applications; this knows *people* — recruiters, referrers, hiring managers — in
  `data/contacts.jsonl` (same one-JSON-per-line philosophy as the tracker), linkable
  to tracker records, with statuses, dated notes, and `--due` follow-up surfacing.
  The `followup` mode now covers "ping the recruiter" alongside "chase the application".

- **One-command private backup (`scripts/backup.mjs`, `cos backup`).** Maintains a
  nested git repo inside the git-ignored `data/` layer (init on first run, local
  identity fallback), commits a snapshot, and pushes **only** on an explicit
  `--push` to the user's own private remote. Losing the tracker + learned style
  profile was the single worst failure a user could hit; now it's one command away
  from impossible.

- **Mock-interview mode (`cos mock`).** Live rehearsal against a real JD: the agent
  plays the interviewer for that company/round, one question per turn, grades each
  answer (STAR+R, specificity, length, JD-relevance), coaches from the user's real
  facts, flags invented claims, and debriefs — optionally banking polished stories.
- **Multilingual cover letters.** `build-cl` now has an explicit language step: detect
  a non-English posting/requirement, ask the user, use the JD's own vocabulary as the
  ATS keyword set, apply that language's formal register, and carry over the learned
  voice's structure (not literal phrasing) — facts still translated, never embellished.
- **Market learning in `patterns`.** Outcome analytics now also groups results by
  archetype × CV variant (via the tracker's per-job `cv_pdf` folders) to surface
  "which framing gets callbacks" hypotheses and propose the next single-variable A/B.

- **Job digest (`scripts/digest.mjs`, `cos digest`).** Diffs the current match board
  against a seen-ledger (`data/digest-state.json`) and reports only the delta — new
  postings and band *upgrades* (downgrades stay quiet). `--write` renders a markdown
  digest to `data/digest-latest.md`; pair with the jobspy fetch in a cron for a daily
  "N new strong matches" tap on the shoulder.

- **Deterministic CV parser (`scripts/parse-cv.mjs`).** Onboarding no longer depends
  on how well a given agent/model free-reads a PDF: the parser extracts contact,
  experience (title/company/dates/bullets, wrapped lines re-joined), education,
  skills, languages and certifications from PDF/DOCX/txt/md/tex — or from an
  **unzipped LinkedIn data export** (`--linkedin <dir>`) — into structured JSON, and
  can render a draft master CV (`--emit-master`). The agent reviews/corrects instead
  of re-extracting; unsplittable headers are kept raw, nothing is invented.

- **CI + devcontainer.** GitHub Actions now runs the full engine self-test suite and
  the web-panel build on every push/PR (`.github/workflows/ci.yml`), and a
  devcontainer (`.devcontainer/`) gives Codespaces users a zero-install setup —
  Node 20, tectonic, poppler, and the optional jobspy sidecar preinstalled, web
  port forwarded.

- **Works with ANY AI coding agent — no longer Claude Code-only.** The canonical
  project brief now lives in the cross-tool [`AGENTS.md`](AGENTS.md) standard (read
  natively by Codex CLI, Cursor, Zed, Google Antigravity, and others), and the
  `/cos` mode router moved from the Claude skill into the agent-neutral
  `modes/_router.md`. `CLAUDE.md`, `GEMINI.md` (also read by Antigravity), and
  `.github/copilot-instructions.md` are thin per-tool shims that defer to
  `AGENTS.md`; the `.claude/skills/` entries defer to the router, and
  `.agents/workflows/cos.md` gives Antigravity a native `/cos` command.
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
