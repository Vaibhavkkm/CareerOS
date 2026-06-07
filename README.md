# OfferForge

**Give it a job post, your CV, and a cover letter you wrote. It learns how *you*
write, then builds a new CV and cover letter tailored to that job — as clean,
ATS-safe PDFs.**

OfferForge runs *inside* [Claude Code](https://claude.com/claude-code). There's no
website, no sign-up, and no API key — the "AI" is the Claude Code agent you're
already running. The boring, mechanical work is done by small Node scripts (which
cost nothing to run), and every document is a LaTeX file turned into a PDF by
[`tectonic`](https://tectonic-typesetting.github.io/).

> ⚠️ **This project is still being built.** The core engine works and is tested,
> but the "anyone can use it" onboarding is new and still being polished. See
> **[Project status](#project-status)** below for an honest done / in-progress list.

---

## What it does, in plain words

1. **You bring three things:** a job description, your own CV, and a cover letter
   you've written before.
2. **It learns from you.** It reads your CV for the *facts* (where you worked, what
   you did, your real numbers) and reads your cover letter for your *voice* (how you
   actually write — your tone, your phrasing, the words you'd never use).
3. **It tailors for the job.** For a specific posting, it writes a new CV and cover
   letter that highlight the parts of *your real experience* that match the job, and
   slot in the keywords an applicant-tracking system (ATS) screens for — without
   ever making up experience you don't have.
4. **It gets better the more you use it.** Every time you edit a draft, it notices
   what you changed and remembers your preferences for next time.
5. **It helps with the whole hunt, not just documents:** score a job before you
   apply, scan job boards, track your applications, schedule follow-ups, and prep
   for interviews.

**You are always in control.** OfferForge writes and recommends — it never submits
an application for you, and it never invents facts.

---

## Your privacy

This is a **public** repository, so it ships with **no personal data**. Everything
OfferForge learns about you — your profile, your master CV, your generated
documents, your application tracker — lives in a local `data/` folder that is
**git-ignored**. It stays on your computer and is never part of this repo. Back it
up with your *own* private git if you want a backup.

---

## Getting started

**You need:**
- **Claude Code** (this is a Claude Code skill).
- **Node.js 20 or newer.** The only dependency is `js-yaml`.
- **tectonic** (the LaTeX engine): `brew install tectonic`. The first build
  downloads fonts/packages (~1–2 min, online once); after that it's offline and fast.
- **poppler** (`brew install poppler`) — gives `pdftotext`, used for the ATS check
  and for reading an uploaded PDF CV.

**Set up:**
```bash
npm install                    # installs js-yaml
node scripts/doctor.mjs --fix  # checks your tools and creates the data/ folders
```

**Then, in Claude Code, just say:**
```
/og onboard
```
…and follow along. It'll ask for your CV (PDF, Word, or text) and a cover letter,
pull your facts and your voice out of them, and get you ready to build your first
tailored application. (`/og` is short for `/offerforge`.)

---

## How to use it (inside Claude Code)

Run the tool with `/offerforge` (or the short alias `/og`):

| Command | What it does |
|---|---|
| `/og onboard` | **Start here.** Turn your uploaded CV + cover letter into a profile, a master CV, and a learned writing voice |
| `/og` *(paste a job post or URL)* | Auto-pilot: read the job → score it → build a tailored CV (if it's a good fit) → draft answers → track it |
| `/og evaluate <job/url/file>` | Score one job out of 5 across 6 things that matter, with a written report |
| `/og compare <2+ jobs>` | Rank several postings and recommend which to chase |
| `/og build-cv <job/company>` | Build a tailored, ATS-safe CV → PDF |
| `/og build-cl <job/company>` | Build a tailored cover letter → PDF |
| `/og` *"learn from my edits"* | Look at how you edited a draft and remember your style |
| `/og apply <job/company>` | Draft answers for an application form (never auto-submits) |
| `/og scan` | Find new postings from the companies you're watching |
| `/og tracker` | See and update where each application stands |
| `/og followup` | Who to follow up with, and a draft message |
| `/og patterns` | What's working in your search, and retune the scoring |
| `/og interview-prep <co> <role>` | Interview prep tailored to the company and role |
| `/og research <company> <role>` | Deep-dive research on a company and role |

---

## What makes it different: it learns your style

Most CV tools give everyone the same generic output. OfferForge adapts to *you*:

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

- **Facts always win.** Your real CV and profile are loaded first and override
  anything the tool learned about style — so it changes *wording*, never *facts*.
- **It needs to see a preference twice** before acting on it, so one stray edit
  doesn't throw off your style.
- **Nothing is lost.** Style preferences are versioned and logged, and the whole
  learned profile can be rebuilt from scratch from your saved drafts.
- **No cloud, no API.** The matching uses simple, transparent math on your machine.

---

## Project status

OfferForge is in **active development**. Here's the honest picture:

### ✅ Working and tested
- **The engine.** ~20 "mode" playbooks (evaluate, build-cv, build-cl, scan, track,
  follow-up, interview-prep, compare, negotiate, and more), 15 helper scripts, and
  shared libraries. Automated self-tests pass (`npm test` → 160 checks green).
- **Clean LaTeX → PDF output.** CVs and cover letters compile through `tectonic`
  and pass an automated ATS check (real selectable text, keywords extractable,
  no broken characters, sensible section order).
- **The learning loop.** Edit a draft → it diffs your changes → distills your style
  → banks your wording → uses it in the next draft. Verified end-to-end.
- **Job-pipeline tools.** Scoring, multi-job comparison, portal scanning (7
  sources — Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters, plus a
  generic parser), a JSON application tracker, follow-up cadence, and analytics.
- **Public-ready.** Rebranded to OfferForge, and all personal data is git-ignored
  so the repo ships clean.

### 🚧 In progress
- **Onboarding for anyone.** The new `/og onboard` flow (upload your CV + cover
  letter → it sets you up) is freshly built and needs testing against many real CV
  formats and layouts.
- **Reading uploaded files.** Today the agent reads your CV/cover letter directly
  (with `pdftotext` for PDFs). A dedicated, deterministic parser script is planned
  for more reliable extraction.
- **CV quality checks.** Flagging vague, un-quantified bullets is partly manual
  right now.

### ⏳ Planned / nice-to-have
- A standalone CV/cover-letter parsing script.
- Seeding your example bank directly from an uploaded cover letter (not just from
  edits over time).
- More job-board sources and more document templates/themes.

---

## For developers

```bash
npm test                       # run all script + library self-tests
node scripts/doctor.mjs        # check your environment and setup
node scripts/compile-latex.mjs data/output/cv-*.tex --kind cv --keywords "Python,SQL" --json
```

A generated document is only considered "good" if `compile-latex.mjs` reports
`ok: true` — meaning it compiled, has no leftover placeholders, no broken
characters, the requested keywords come out as plain text, and the sections read
in a sensible order.

### Layout
```
.claude/skills/offerforge/SKILL.md   the /og command router
CLAUDE.md   DATA_CONTRACT.md          project notes + the data rules
modes/                                the playbooks the agent follows (incl. onboard.md)
templates/                            CV/cover-letter LaTeX templates, schemas, example configs
lib/                                  shared helper code
scripts/                              the zero-cost tools (compile, scan, track, learn, …)
scripts/providers/                    job-board sources (greenhouse, ashby, lever, …)
data/                                 YOUR private layer — git-ignored, never committed
```

See [`DATA_CONTRACT.md`](DATA_CONTRACT.md) for exactly which files are yours vs. the
system's, and [`CLAUDE.md`](CLAUDE.md) for how the agent is expected to behave.
