# CareerOS

**Give it a job post, your CV, and a cover letter you wrote. It learns how *you*
write, then builds a new CV and cover letter tailored to that job — as clean,
ATS-safe PDFs.**

CareerOS runs *inside* the AI coding agent you already use —
[Claude Code](https://claude.com/claude-code), [Cursor](https://cursor.com),
[Codex CLI](https://github.com/openai/codex),
[Gemini CLI](https://github.com/google-gemini/gemini-cli), or any other tool that
can read files and run commands (it picks up its instructions from the standard
[`AGENTS.md`](AGENTS.md)). There's no website, no sign-up, and no API key — the
"AI" is the agent you're already running, whichever model powers it. The boring,
mechanical work is done by small Node scripts (which cost nothing to run), and
every document is a LaTeX file turned into a PDF by
[`tectonic`](https://tectonic-typesetting.github.io/).

> ⚠️ **This project is still being built.** The core engine works and is tested,
> but the "anyone can use it" onboarding is new and still being polished. See
> **[Project status](#project-status)** below for an honest done / in-progress list.

---

## What it does, in plain words

1. **You bring three things:** a job posting (paste the text, *or just share the
   URL* — it scrapes the whole posting for you), your own CV, and a cover letter
   you've written before.
2. **It learns from you.** It reads your CV for the *facts* (where you worked, what
   you did, your real numbers) and reads your cover letter for your *voice* (how you
   actually write — your tone, your phrasing, the words you'd never use).
3. **It tailors for the job.** For a specific posting, it writes a new CV and cover
   letter that highlight the parts of *your real experience* that match the job, and
   slot in the keywords an applicant-tracking system (ATS) screens for — without
   ever making up experience you don't have. It then **proofreads its own draft**
   against your voice and the job's must-haves and revises before showing you.
4. **It gets better the more you use it.** Every time you edit a draft, it notices
   what you changed and remembers your preferences for next time (see
   [how the learning works](#how-the-learning-works-its-not-a-black-box) below).
5. **It helps with the whole hunt, not just documents:** score a job before you
   apply, scan job boards, track your applications, schedule follow-ups, and prep
   for interviews.

**You are always in control.** CareerOS writes and recommends — it never submits
an application for you, and it never invents facts.

---

## Your privacy

This is a **public** repository, so it ships with **no personal data**. Everything
CareerOS learns about you — your profile, your master CV, your generated
documents, your application tracker — lives in a local `data/` folder that is
**git-ignored**. It stays on your computer and is never part of this repo. Back it
up with your *own* private git — one command keeps a nested snapshot repo inside
`data/` (and only pushes when you say so):
```bash
node scripts/backup.mjs --summary                                  # local snapshot
node scripts/backup.mjs --remote git@github.com:you/my-careeros-data.git --push
```

There's **no API key and no server-side AI** to leak data to — the model is whichever
AI agent you already run. A CV/cover letter you upload through the web panel is staged
under `data/ui/uploads/` and **deleted automatically** once the agent has onboarded from
it, so raw documents don't linger.

---

## Getting started

**You need:**
- **An agentic AI coding tool** — Claude Code, Cursor, Codex CLI, Gemini CLI,
  Google Antigravity, Windsurf, … anything that reads the repo's `AGENTS.md`
  (or can be told to read it).
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

> **Zero-install option:** open the repo in a **devcontainer / GitHub Codespaces**
> (`.devcontainer/`) — Node, tectonic, poppler, and the optional Python sidecar are
> set up for you, and the web panel's port (4317) is forwarded automatically.

**Optional — multi-board fetch (Indeed / ZipRecruiter / Google Jobs):** the one
non-Node piece is a small Python sidecar ([python-jobspy](https://github.com/speedyapply/JobSpy)).
Install it once to enable the **"fetch recent"** button and `npm run fetch`:
```bash
npm run jobspy:install         # creates ./.venv and installs python-jobspy (needs Python 3.10+)
```
Skip this and everything else still works; `node scripts/doctor.mjs` tells you if it's missing.

**Then tell your agent:**
```
/cos onboard
```
…and follow along. It'll ask for your CV (PDF, Word, or text) and a cover letter,
pull your facts and your voice out of them, and get you ready to build your first
tailored application. (`/cos` is short for `/careeros`. In Claude Code it's a
native slash command; in any other tool just type `cos onboard` — the agent picks
up the routing from `AGENTS.md`.)

---

## How to use it (from your AI agent)

Run the tool with `/careeros` (or the short alias `/cos`; in tools other than
Claude Code, type the same command without the slash):

| Command | What it does |
|---|---|
| `/cos onboard` | **Start here.** Turn your uploaded CV + cover letter into a profile, a master CV, and a learned writing voice (or upload them from the web panel's **⤴ my CV/CL** button) |
| `/cos hunt [role] [location]` | **Auto-fetch jobs from multiple portals** matched to *your* profile — searches Indeed + Dice (and your tracked ATS companies), dedups, and drops the matches on your board |
| `/cos board [--min strong] [--recent 14]` | Rank open roles by how well they match *your* CV (STRONGEST → Weak), with how recently each was posted and your has/gap skills — then tailor any one in a click |
| `/cos ui` | Launch the **local web control panel** (a dark trading-desk dashboard) and process anything you queued from the browser |
| `/cos` *(paste a job post or URL)* | Auto-pilot: read the job → score it → build a tailored CV (if it's a good fit) → draft answers → track it |
| `/cos evaluate <job/url/file>` | Score one job out of 5 across 6 things that matter, with a written report |
| `/cos compare <2+ jobs>` | Rank several postings and recommend which to chase |
| `/cos build-cv <job/company>` | Build a tailored, ATS-safe CV → PDF (saved to a per-job folder `data/output/<company>--<role>/`) |
| `/cos build-cl <job/company>` | Build a tailored cover letter → PDF (alongside the CV in the same per-job folder) |
| `/cos` *"learn from my edits"* | Look at how you edited a draft and remember your style |
| `/cos apply <job/company>` | Draft answers for an application form (never auto-submits) |
| `/cos scan` | Find new postings from the companies you're watching |
| `/cos tracker` | See and update where each application stands |
| `/cos followup` | Who to follow up with, and a draft message |
| `/cos patterns` | What's working in your search, and retune the scoring |
| `/cos interview-prep <co> <role>` | Interview prep tailored to the company and role |
| `/cos research <company> <role>` | Deep-dive research on a company and role |

---

## Auto-fetch jobs from multiple portals (`/cos hunt`)

`/cos hunt` reads your **profile** (target roles, locations, seniority) and pulls fresh
openings from **Indeed + Dice** and your tracked **ATS** companies, dedups them against
everything you've already seen, and drops the matches straight onto your board — ranked
by how well they fit your CV. You can also target a specific search: `/cos hunt "ML engineer" remote`.
Nothing is ever applied for you; you review the matches and tailor with one command.

> The job-board connectors run inside the agent (Claude Code ships Indeed/Dice MCP
> connectors), so `/cos hunt` does the search; a zero-token script
> (`scripts/hunt-ingest.mjs`) does the dedup + saving. No connectors in your tool?
> It degrades gracefully to the jobspy fetch below, the ATS scanner, and pasted URLs.

**No-agent option — the "fetch recent" button (and `npm run fetch`).** Once the Python
sidecar is installed (see Getting started), the board's **fetch recent** control pulls live
openings from **Indeed + ZipRecruiter + Google Jobs** straight from the browser — no agent,
no MCP — filtered by **country** (Luxembourg, United States, Canada, United Kingdom, Germany,
France, Belgium, Netherlands, Switzerland, Italy, India — or **all countries** in one sweep),
**city**, and **job type**, deduped and ranked onto your board in one click. Same from the CLI:
```bash
node scripts/jobspy.mjs --country Germany --city Berlin --recent 7 --summary
```
Because it's a plain script, it can also run from a **cron** — pair it with the
**digest** for a daily "what's new" report (new matches + band upgrades only):
```bash
node scripts/jobspy.mjs --country Luxembourg --recent 3 && node scripts/digest.mjs --write --summary
```
(`cos digest` from your agent does the same check on demand; the markdown lands in
`data/digest-latest.md`.) **LinkedIn is deferred**
(it rate-limits scrapers); enable it explicitly with `--boards indeed,zip_recruiter,google,linkedin`
and expect partial results, or paste a LinkedIn job URL for a one-off.

## The web control panel (`/cos ui`)

A local, **dark "trading-desk" dashboard** for everything above — a filterable match
board, application pipeline funnel, and a one-page hunt form. It runs on `127.0.0.1`
(never exposed to the network), has **no database** (it reads your real files live), and
lives in its own `web/` folder so the core engine stays zero-dependency.

```bash
cd web && npm install      # first run only
npm run dev                # → http://127.0.0.1:4317   (or: /cos ui)
```

Because a browser has no LLM, the panel runs the zero-token scripts itself (scan, board,
fetch, paste-a-URL, tracker, PDF preview) and **queues** the judgment work — Evaluate,
Build CV/CL, Apply, Hunt, and **onboarding** — for the `/cos` agent to run. Click a button
in the browser, then run `/cos ui` in your agent to process the queue; status updates live.
It can never auto-submit an application or mark a role "applied" without your explicit confirmation.

**From the browser you can also:**
- **Upload your CV + cover letter** — the **⤴ my CV/CL** button saves them locally and queues
  an onboarding job; the agent learns your facts + voice, then fills the board with CV-matched
  jobs. Uploaded files are **deleted automatically** the moment onboarding finishes (PII hygiene).
- **Drop a job URL** in the paste box → **fetch URL** scrapes the whole posting onto the board.
- **Open each application's CV & cover letter** as one-click links on the **Pipeline** tab — each
  job gets its **own output folder** (`data/output/<company>--<role>/`) holding both PDFs.
- **Auto-drain (optional):** in Claude Code, leave `/loop 30s /cos ui drain` running and clicks
  execute within seconds — no manual `/cos ui` each time (in other tools, use their recurring-task
  feature or just re-run `cos ui drain`). A **clear completed** button tidies the
  queue (finished requests are archived, never hard-deleted).

### Hosting a public demo (`NEXT_PUBLIC_CAREEROS_PUBLIC=1`)

You can host the board as a **read-only showcase** (e.g. `careeros.example.com`). Because
CareerOS is agent-native — the AI is the agent in _your_ editor, not a server — a
public instance can't run a visitor's generation. Set the flag at build/deploy time:

```bash
NEXT_PUBLIC_CAREEROS_PUBLIC=1 npm run build   # demo mode
```

In demo mode the board stays browsable, but every **mutating** action (generate, fetch,
scan, enqueue) is **gated server-side** (HTTP 403) and a **fork-gate** modal invites the
visitor to fork the repo, ⭐ it, and run it with their own AI agent. Enforcement lives in
`web/lib/gate.ts` (not just hidden buttons). Locally, with the flag unset, you get the full
tool. See `web/.env.example`.

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

- **Facts always win.** Your real CV and profile are loaded first and override
  anything the tool learned about style — so it changes *wording*, never *facts*.
- **It needs to see a preference twice** before acting on it, so one stray edit
  doesn't throw off your style.
- **Warm start.** During onboarding it banks your *existing* CV bullets and
  cover-letter paragraphs as examples, so the very first draft is already in your
  voice — no cold start, no "train it a few times first."
- **Self-correcting.** Before you ever see a draft, CareerOS grades it against
  your voice + the job's must-have keywords + the no-fabrication/no-filler rules,
  and revises until it passes.
- **Nothing is lost.** Style preferences are versioned and logged, and the whole
  learned profile can be rebuilt from scratch from your saved drafts.
- **You can steer it.** The web panel's **Style** tab shows every learned rule;
  accept a provisional rule early, or retire one you disagree with — flips are
  applied by the agent, logged, and reversible (rules are never deleted).

### How the learning works (it's not a black box)

There's **no trained ML model and no neural network of its own**, and it is **not**
some hidden "memory." Two simple, inspectable parts:

1. **A frontier AI model does the writing and the judgement** — whichever one
   powers your agent (Claude, GPT, Gemini, …) — reading your edits and phrasing
   a rule like *"prefer 'built' over 'worked on'."*
2. **Plain local files remember it.** Your preferences live as readable JSON in
   `data/style/` (rules + your banked example bullets). Picking which of your past
   examples to reuse is done with **TF-IDF** — classic keyword-matching arithmetic,
   run on your machine. No training, no API, no cloud, no vendor lock-in. You can
   open the files and read exactly what it learned, and rebuild it any time.

> Why not "train a custom model"? For one person's handful of documents that would
> overfit and actually write *worse* than a frontier model guided by your real
> examples. Showing your examples in-context is the stronger, state-of-the-art
> approach here.

---

## Project status

CareerOS is in **active development**. Here's the honest picture:

### ✅ Working and tested
- **The engine.** ~24 "mode" playbooks (onboard, board, hunt, ui, evaluate, build-cv,
  build-cl, scan, track, follow-up, interview-prep, compare, negotiate, and more), 21
  helper scripts, and shared libraries. Automated self-tests pass (`npm test` → **500 checks green**).
- **Share a URL → it scrapes the whole posting.** `fetch-jd` pulls the *complete*
  job from the ATS's own API (Greenhouse, Lever, Recruitee, SmartRecruiters) or the
  page HTML (Ashby, Workable, and any other site), saves it locally, and falls back
  to an in-session fetch for JS-heavy pages. Verified live against a real posting.
- **In-voice from draft #1.** Onboarding warm-starts the example bank from *your*
  existing CV bullets + cover-letter paragraphs (`seed-examples`), so the first
  draft already sounds like you.
- **Job-match board.** `/cos board` ranks open roles by how well they fit *your*
  CV — STRONGEST / Very strong / Strong / Moderate / Weak — with how recently each
  was posted, the skills you have vs. the gaps, any **language requirement** the
  posting states (e.g. *English (req), French (plus)*), and one-command tailoring
  for any pick. Filter by match band (`--min`), recency (`--recent`), country/city,
  and **job type** — full-time, internship, **PhD**, **post-doc**, contract or temp.
  Job type is read from the role title (not loose prose), so a "Senior Engineer"
  whose blurb merely mentions interns won't show under *Internship*; a genuine
  "PhD Internship" correctly shows under **both** the PhD and Internship filters.
- **Self-correcting drafts.** Every CV/cover letter is graded against your voice,
  the job's must-have keywords, and the no-fabrication/no-filler rules, then revised
  before you see it.
- **Clean LaTeX → PDF output, in your choice of theme.** CVs and cover letters
  compile through `tectonic` and pass an automated ATS check (real selectable
  text, keywords extractable, no broken characters, sensible section order).
  Two matched CV+CL themes ship today — **classic** (serif) and **modern**
  (sans, slate accent) — selected via `profile.yml cv.theme` or by asking
  ("build it with the modern theme"); every theme shares the same placeholder
  contract, so tailoring works identically.
- **The learning loop.** Edit a draft → it diffs your changes → distills your style
  → banks your wording → uses it in the next draft. Verified end-to-end.
- **Job-pipeline tools.** Scoring, multi-job comparison, portal scanning (7
  sources — Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters, plus a
  generic parser), a JSON application tracker, follow-up cadence, and analytics.
- **Auto-fetch from multiple portals.** `/cos hunt` pulls live openings from Indeed +
  Dice (and your ATS companies) based on your profile, dedups them through the same
  ledger as the scanner (`hunt-ingest`), and ranks them on your board.
- **Local web control panel.** A dark "trading-desk" dashboard (`web/`, `/cos ui`) over
  the engine: filterable match board, pipeline funnel, hunt form. Zero-token scripts run
  in the browser; judgment work queues for the agent. **Upload your CV/cover letter** from
  the browser (queues onboarding; staged files auto-purged after), **fetch** any job URL onto
  the board, **open each application's CV/CL** from the Pipeline tab (per-job folders), and
  **clear completed** queue items (archived, not deleted). Optional `/loop`-based **auto-drain**
  runs queued clicks without a manual `/cos ui`. Next.js 15 + React 19, builds clean, `npm audit`
  clean; guardrails (no auto-submit, no silent "applied", sandboxed file reads) verified.
- **Public-ready.** Rebranded to CareerOS, and all personal data is git-ignored
  so the repo ships clean.

### 🚧 In progress
- **Onboarding for anyone.** The `/cos onboard` flow (upload your CV + cover letter,
  from the CLI **or the web panel's ⤴ my CV/CL button** → it sets you up) is built and
  wired end-to-end; it still needs testing against many real CV formats and layouts.
- **Reading your uploaded CV/cover letter.** Job *postings* from a URL are now
  scraped deterministically (`fetch-jd`). Turning *your* uploaded CV/Word doc into
  `cv.master.md` is still done by the agent reading the file (with `pdftotext` for
  PDFs) — reliable, but a dedicated parser script would make it reproducible.
- **CV quality checks.** Flagging vague, un-quantified bullets is partly manual
  right now.

### ⏳ Planned / nice-to-have
- A standalone parser for the user's uploaded CV/Word document.
- Optional semantic (embedding) example search, for when an example bank grows large.
- More hunt sources (beyond Indeed + Dice) and more document templates/themes.
- A *hosted*, multi-user version of the web panel (auth + a database). v1 is
  deliberately local-only and file-backed — it runs on your machine over your own data.

---

## For developers

```bash
npm test                       # run all script + library self-tests (500 checks)
node scripts/doctor.mjs        # check your environment and setup
node scripts/fetch-jd.mjs "https://boards.greenhouse.io/acme/jobs/123" --summary   # scrape a posting
node scripts/compile-latex.mjs data/output/cv-*.tex --kind cv --keywords "Python,SQL" --json
echo '[{"title":"Data Engineer","company":"Acme","url":"https://x/1"}]' | node scripts/hunt-ingest.mjs --dry-run --summary
npm run web:dev                # the local web control panel → http://127.0.0.1:4317
```

A generated document is only considered "good" if `compile-latex.mjs` reports
`ok: true` — meaning it compiled, has no leftover placeholders, no broken
characters, the requested keywords come out as plain text, and the sections read
in a sensible order.

### Layout
```
AGENTS.md                             the agent brief — works with ANY AI coding tool
CLAUDE.md  GEMINI.md  .github/copilot-instructions.md    per-tool shims pointing at AGENTS.md
modes/_router.md                      the /cos command router (agent-neutral)
.claude/skills/                       Claude Code's /careeros + /cos skills (defer to the router)
DATA_CONTRACT.md                      the data rules
modes/                                the playbooks the agent follows (incl. onboard.md, hunt.md, ui.md)
templates/                            CV/cover-letter LaTeX templates, schemas, example configs
lib/                                  shared helper code
scripts/                              the zero-cost tools (fetch-jd, hunt-ingest, ui-queue, compile, scan, track, learn, …)
web/                                  the local web control panel (own package.json; Next.js; not part of the core engine)
scripts/providers/                    job-board sources (greenhouse, ashby, lever, …)
data/                                 YOUR private layer — git-ignored, never committed
```

See [`DATA_CONTRACT.md`](DATA_CONTRACT.md) for exactly which files are yours vs. the
system's, and [`AGENTS.md`](AGENTS.md) for how the agent is expected to behave.

---

## License & community

- **License:** [MIT](LICENSE) — © 2026 VaibhavKKM.
- **Contributing:** see [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Code of Conduct:** [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- **Security:** report privately per [`SECURITY.md`](SECURITY.md).
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md).
- **Cite it:** [`CITATION.cff`](CITATION.cff).
