# CareerOS

CareerOS takes a job post, your CV, and a cover letter you've written, learns how
you write, and drafts a new CV and cover letter tailored to that job — as clean,
ATS-safe PDFs. It also helps you find, rank, and track jobs.

It runs inside an AI coding agent you already use —
[Claude Code](https://claude.com/claude-code), [Cursor](https://cursor.com),
Codex CLI, Gemini CLI, Windsurf, or anything that reads the repo's
[`AGENTS.md`](AGENTS.md). By default there's no separate AI service, no API key,
and no server: the "AI" is your agent, the mechanical work is small Node scripts,
and every document is a LaTeX file compiled to PDF by
[`tectonic`](https://tectonic-typesetting.github.io/). (An optional background
daemon — `npm run daemon` — can run a provider for you: your Claude Code login,
local Ollama, or any OpenAI-compatible endpoint. You don't need it.) There's also
a local web app for doing much of this by clicking instead of typing.

> **Status: early, and under active development.** It's usable, but it's solo-built
> and rough in places — expect sharp edges. See [Project status](#project-status).

---

## What it does

1. **You bring three things:** a job posting (paste the text, or share the URL — it
   scrapes the posting for you), your own CV, and a cover letter you've written.
2. **It learns from you.** Your CV for the *facts* (where you worked, your real
   numbers); your cover letter for your *voice* (tone, phrasing, words you'd avoid).
3. **It tailors for the job.** It drafts a CV and cover letter that surface the parts
   of *your real experience* that match the role and the keywords an ATS screens for —
   without inventing experience you don't have — then revises its own draft before
   you see it.
4. **It learns from your edits.** Change a draft and it remembers your preferences.
5. **It helps with the whole hunt:** find and rank jobs, score a role, track
   applications, schedule follow-ups, and prep for interviews.

You stay in control: CareerOS writes and recommends — it never submits an application,
and never makes up facts.

---

## What it can do

- **Rank jobs** — open roles scored against your CV (fit bands, strongest to weak),
  with recency and the skills you have vs. the gaps.
- **Fetch openings** — pull recent postings from several boards (Indeed, ZipRecruiter,
  Google Jobs, and others), filtered by country/city/job type. Needs the optional
  Python sidecar (`npm run jobspy:install`).
- **Scrape a URL** — share a job link and it pulls the posting from the ATS's own API
  (Greenhouse, Lever, Recruitee, SmartRecruiters) or the page HTML.
- **Tailor documents** — a CV + cover letter in your voice, ATS-checked and compiled
  to PDF via `tectonic` (selectable text, extractable keywords, sane section order).
- **Learn your style** — edit a draft and it remembers your wording. Plain local
  files; no trained model, no black box (see below).
- **Run the hunt** — score/compare roles, scan companies you watch, save a shortlist,
  track applications, follow-up reminders, a "what's new" digest, interview prep and
  mock interviews.

---

## The web app

```bash
cd web && npm install      # first run only
npm run dev                # → http://127.0.0.1:4317   (or: /cos ui)
```

A local browser dashboard for the steps above — keyboard-friendly, so you rarely
need to type a command:

- A match board with each role's fit score, match band, recency, and a country
  column when you browse more than one country.
- Click a role for a detail pane: the score breakdown, skills you have vs. gaps, and
  one-click Tailor CV / Cover letter / Evaluate / Draft answers. Generated documents
  show inline (and open in a new tab).
- Fetch recent openings, scan watched companies, or paste a job URL — from the browser.
- Upload your CV + cover letter (**⤴ my CV/CL**) to onboard; staged files are removed
  afterward.
- A cancellable queue of agent work, a **Pipeline** tab linking each application's
  PDFs, and a **Saved** shortlist tab.

It binds to `127.0.0.1` (local only) and has no database — it reads your files
directly. Because a browser has no AI, the heavier work (Evaluate, Build CV/CL, Apply,
Hunt, onboarding) is queued for your agent: click in the browser, then run `/cos ui`
in your agent to process it. It never auto-submits an application or marks a role
"applied" without your confirmation.

> Prefer the keyboard? Everything is also driveable from your AI agent or the CLI —
> see [`COMMANDS.md`](COMMANDS.md) for the full command reference.

---

## Getting started

**You need:**
- **An agentic AI coding tool** — Claude Code, Cursor, Codex CLI, Gemini CLI,
  Windsurf, … anything that reads the repo's [`AGENTS.md`](AGENTS.md).
- **Node.js 20+** (the only runtime dependency is `js-yaml`).
- **tectonic** (the LaTeX engine): `brew install tectonic`.
- **poppler** (`brew install poppler`) — for the ATS check and reading PDF CVs.

**Set up:**
```bash
npm install                    # installs js-yaml
node scripts/doctor.mjs --fix  # checks your tools and creates the data/ folders
```

> **Zero-install option:** open the repo in a devcontainer / GitHub Codespaces
> (`.devcontainer/`) — Node, tectonic, poppler, and the optional Python job-fetch
> sidecar are set up for you, and the web app's port (4317) is forwarded.

**Then onboard by uploading your CV + cover letter** — tell your agent `/cos onboard`,
or start the web app and click **⤴ my CV/CL**. It pulls your facts and your voice out
of them so you can build your first tailored application.

> Optional: to enable live job fetching, install the small Python sidecar once with
> `npm run jobspy:install` (needs Python 3.10+). Everything else works without it.

---

## Your privacy

This is a **public** repository, so it ships with **no personal data**. Everything
CareerOS learns about you — your profile, master CV, generated documents, your
application tracker — lives in a local `data/` folder that is **git-ignored**. It
stays on your computer and is never part of this repo.

By default there's no API key and no server-side AI to leak data to — the model is
whichever AI agent you already run. (If you opt into the background daemon, you choose
the provider; a config file holding any key is git-ignored.) A CV/cover letter you
upload through the web app is staged under `data/ui/uploads/` and removed once
onboarding finishes. Back up your `data/` to your own private git anytime
(see [`COMMANDS.md`](COMMANDS.md)).

---

## How it learns your style

Most CV tools give everyone the same generic output. CareerOS adapts to you:

```
your CV         ──► the facts it's allowed to use (never invents any)
your cover ─────┐
letter / samples├─► your voice (tone, phrasing, words you avoid)
                │
a job post  ────┴─► a NEW CV + cover letter, in your voice, matched to the job
                              │
you edit the draft  ──────────┘
"learn from my edits"  ──► it remembers your preference for next time
```

- **Facts always win.** Your real CV and profile override anything it learned about
  style — it changes *wording*, never *facts*.
- **Warm start.** During onboarding it banks your existing CV bullets and cover-letter
  paragraphs as examples, so the first draft already sounds like you.
- **Not a black box.** No trained model, no hidden memory. The agent phrases the rules;
  plain readable JSON in `data/style/` stores them, and example reuse is classic TF-IDF
  keyword math on your machine. You can open the files and read what it learned.

---

## Project status

CareerOS is usable and under active development, built solo. The core scripts ship
self-tests (`npm test`) that run in CI on every push — the match board, multi-board
fetch, URL scraping, CV/cover-letter tailoring with the ATS check, the learning loop,
the job-pipeline tools, and the web app work end-to-end. Personal data is git-ignored,
so the repo ships clean.

Still being worked on: onboarding across the full variety of real-world CV formats,
and richer automatic "is this bullet vague?" quality checks. A hosted multi-user
version is intentionally **not** a goal — it's local-first and file-backed, running on
your machine over your own data.

---

## License & community

- **License:** [GNU AGPL-3.0-or-later](LICENSE) — © 2026 Vaibhav Mangroliya
  (VaibhavKKM). CareerOS is free software: use it, study it, and build on it. The
  AGPL keeps it **open** — any modified version you distribute **or run as a network
  service** must also be released under the AGPL with its source available, and must
  keep this attribution. In short: contribute back; don't fork it closed.
- **Commands & CLI:** [`COMMANDS.md`](COMMANDS.md).
- **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md) · **Conduct:** [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- **Security:** report privately per [`SECURITY.md`](SECURITY.md).
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md) · **Cite it:** [`CITATION.cff`](CITATION.cff).
- **How it's built:** [`AGENTS.md`](AGENTS.md) (agent brief) · [`DATA_CONTRACT.md`](DATA_CONTRACT.md) (data rules).
