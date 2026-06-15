# CareerOS

**Give it a job post, your CV, and a cover letter you wrote. It learns how *you*
write, then builds a new CV and cover letter tailored to that job — as clean,
ATS-safe PDFs.**

CareerOS runs *inside* the AI coding agent you already use —
[Claude Code](https://claude.com/claude-code), [Cursor](https://cursor.com),
Codex CLI, Gemini CLI, Windsurf, and others. There's **no separate AI service, no
API key, and no server**: the "AI" is your agent, the mechanical work is done by
small Node scripts (which cost nothing to run), and every document is a LaTeX file
turned into a PDF by [`tectonic`](https://tectonic-typesetting.github.io/). It also
ships a **local web app** so you can do most of it by clicking, not typing commands.

---

## What it does, in plain words

1. **You bring three things:** a job posting (paste the text, *or just share the
   URL* — it scrapes the whole posting for you), your own CV, and a cover letter
   you've written before.
2. **It learns from you.** It reads your CV for the *facts* (where you worked, what
   you did, your real numbers) and your cover letter for your *voice* (your tone,
   your phrasing, the words you'd never use).
3. **It tailors for the job.** It writes a new CV and cover letter that highlight the
   parts of *your real experience* that match the role and slot in the keywords an
   applicant-tracking system (ATS) screens for — **without ever inventing experience
   you don't have**. Then it proofreads its own draft and revises before you see it.
4. **It gets better the more you use it.** Every time you edit a draft, it notices
   what you changed and remembers your preferences for next time.
5. **It helps with the whole hunt:** find and rank jobs, score a role before you
   apply, track your applications, schedule follow-ups, and prep for interviews.

**You are always in control.** CareerOS writes and recommends — it never submits an
application for you, and it never makes up facts.

---

## Features

**Find & rank jobs**
- **Job-match board** — every open role scored against *your* CV (STRONGEST → Weak),
  with how recently it was posted, the skills you have vs. the gaps, and any language
  requirement the posting states.
- **Multi-board fetch** — pull fresh openings from **Indeed, ZipRecruiter, Glassdoor,
  Google Jobs, and LinkedIn** (anonymously, no login), filtered by **country**
  (~30 markets, or *all countries* in one sweep), **city**, and **job type**
  (full-time, internship, PhD, post-doc, contract, temp). A **Country column** appears
  when you browse more than one country.
- **Share a URL → it scrapes the whole posting** from the ATS's own API (Greenhouse,
  Lever, Recruitee, SmartRecruiters) or the page HTML (Ashby, Workable, and more).
- **Saved shortlist** — ★ bookmark jobs and build a CV + cover letter for every one at once.

**Tailor your documents**
- **Tailored CV + cover letter** in your real voice, matched to the job, ATS-safe,
  compiled to PDF through `tectonic` and checked automatically (selectable text,
  keywords extractable, sane section order).
- **Self-correcting drafts** — graded against your voice, the job's must-have keywords,
  and a no-fabrication/no-filler rule, then revised before you ever see them.
- **It learns your style** — edit a draft and it remembers your wording for next time.
  Plain, inspectable local files; no trained model, no black box. (See below.)

**Run the whole hunt**
- Score a job, compare several, scan companies you're watching, track applications,
  follow-up reminders, a daily "what's new" digest, interview prep, and live mock interviews.

**The local web app**
- A fast **"Signal Console"** dashboard — see the board section below.

**Private & safe by design**
- Everything you feed it stays **on your machine** (`data/` is git-ignored); no API
  key, no server-side AI, uploaded files auto-deleted after onboarding. It **never
  auto-submits** an application or marks one "applied" without your confirmation.

---

## Your privacy

This is a **public** repository, so it ships with **no personal data**. Everything
CareerOS learns about you — your profile, master CV, generated documents, your
application tracker — lives in a local `data/` folder that is **git-ignored**. It
stays on your computer and is never part of this repo.

There's **no API key and no server-side AI** to leak data to — the model is whichever
AI agent you already run. A CV/cover letter you upload through the web app is staged
under `data/ui/uploads/` and **deleted automatically** once onboarding finishes, so
raw documents don't linger. Back up your `data/` to your own private git anytime
(see [`COMMANDS.md`](COMMANDS.md)).

---

## Getting started

**You need:**
- **An agentic AI coding tool** — Claude Code, Cursor, Codex CLI, Gemini CLI,
  Windsurf, … anything that reads the repo's [`AGENTS.md`](AGENTS.md).
- **Node.js 20+** (the only dependency is `js-yaml`).
- **tectonic** (the LaTeX engine): `brew install tectonic`.
- **poppler** (`brew install poppler`) — for the ATS check and reading PDF CVs.

**Set up:**
```bash
npm install                    # installs js-yaml
node scripts/doctor.mjs --fix  # checks your tools and creates the data/ folders
```

> **Zero-install option:** open the repo in a **devcontainer / GitHub Codespaces**
> (`.devcontainer/`) — Node, tectonic, poppler, and the optional Python job-fetch
> sidecar are set up for you, and the web app's port (4317) is forwarded automatically.

**Then get set up by uploading your CV + cover letter** — either tell your agent
`/cos onboard`, or start the web app and click **⤴ my CV/CL**. It pulls your facts
and your voice out of them and gets you ready to build your first tailored application.

> Optional: to enable live job fetching, install the small Python sidecar once with
> `npm run jobspy:install` (needs Python 3.10+). Everything else works without it.

---

## The web app — a "Signal Console" you can click

```bash
cd web && npm install      # first run only
npm run dev                # → http://127.0.0.1:4317   (or: /cos ui)
```

An amber-on-black **dashboard** for everything above — fast, keyboard-friendly, and
designed so you rarely need to type a command:

- **A match board** where every fit score is a segmented **signal meter**, with match
  bands, recency, and a **Country column** when you browse multiple countries.
- **Click a role** and a detail pane docks in on the right: the score breakdown,
  the skills you have vs. the gaps, and one-click **Tailor my CV / Cover letter /
  Evaluate fit / Draft answers**.
- **Fetch recent** openings, **scan** the companies you watch, or **paste a job URL**
  — all from the browser.
- **Upload your CV + cover letter** (**⤴ my CV/CL**) to onboard; staged files are
  auto-purged afterward.
- A live **queue** of agent work you can **cancel** if you queued something by mistake,
  and a **Pipeline** tab that links each application's CV + cover letter PDFs.

It runs only on `127.0.0.1` (never exposed to the network), has **no database** (it
reads your real files live), and is accessible (WCAG-AA contrast, respects reduced
motion). Because a browser has no AI, the heavier judgment work (Evaluate, Build CV/CL,
Apply, Hunt, onboarding) is **queued** for your `/cos` agent to run — click in the
browser, then run `/cos ui` in your agent to process it. It can **never** auto-submit
an application or mark a role "applied" without your explicit confirmation.

> Prefer the keyboard? Everything is also driveable from your AI agent or the CLI —
> see **[`COMMANDS.md`](COMMANDS.md)** for the full command reference.

---

## What makes it different: it learns your style

Most CV tools give everyone the same generic output. CareerOS adapts to *you*:

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
  style — so it changes *wording*, never *facts*.
- **Warm start.** During onboarding it banks your existing CV bullets and cover-letter
  paragraphs as examples, so the very first draft already sounds like you.
- **Not a black box.** There's no trained model and no hidden memory. A frontier AI
  (whichever powers your agent) phrases the rules; plain readable JSON in `data/style/`
  remembers them, and example reuse is classic **TF-IDF** keyword math on your machine.
  You can open the files and read exactly what it learned, and rebuild it anytime.

---

## Project status

CareerOS is **usable today** and under active development. The core engine is mature
and tested — `npm test` runs **600+ self-test checks** (green, in CI on every push):
the match board, multi-board fetch, URL scraping, CV/cover-letter tailoring with the
ATS check, the learning loop, the job-pipeline tools, and the web app all work
end-to-end. Personal data is git-ignored, so the repo ships clean.

**Still being polished:** onboarding against the full variety of real-world CV
formats, and richer automatic "is this bullet vague?" quality checks. A *hosted*
multi-user version is intentionally **not** a goal — v1 is local-first and file-backed,
running on your machine over your own data.

---

## License & community

- **License:** [GNU AGPL-3.0-or-later](LICENSE) — © 2026 Vaibhav Mangroliya
  (VaibhavKKM). CareerOS is free software: use it, study it, and build on it. The
  AGPL keeps it **open** — any modified version you distribute **or run as a network
  service** must also be released under the AGPL with its source available, and must
  keep this attribution. In short: contribute back; don't fork it closed or pass it
  off as your own.
- **Commands & CLI:** [`COMMANDS.md`](COMMANDS.md).
- **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md) · **Conduct:** [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- **Security:** report privately per [`SECURITY.md`](SECURITY.md).
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md) · **Cite it:** [`CITATION.cff`](CITATION.cff).
- **How it's built:** [`AGENTS.md`](AGENTS.md) (agent brief) · [`DATA_CONTRACT.md`](DATA_CONTRACT.md) (data rules).
