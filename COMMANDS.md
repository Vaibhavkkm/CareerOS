# CareerOS — command reference

Most of CareerOS is **clickable in the web panel** (`/cos ui` → http://127.0.0.1:4317) —
fetch jobs, browse the match board, build CVs and cover letters, track applications.
You don't need this file to use the tool.

This is the **full reference for power users** who'd rather drive it from their AI
coding agent or the command line. `/cos` is short for `/careeros`. In Claude Code
they're native slash commands; in any other agent (Cursor, Codex CLI, Gemini CLI,
Windsurf, …) type the same thing **without** the slash — the agent picks up the
routing from [`AGENTS.md`](AGENTS.md). The router lives in [`modes/_router.md`](modes/_router.md).

---

## Agent commands (`/cos …`)

| Command | What it does |
|---|---|
| `/cos onboard` | **Start here.** Turn your uploaded CV + cover letter into a profile, a master CV, and a learned writing voice (or use the web panel's **⤴ my CV/CL** button) |
| `/cos hunt [role] [location]` | Auto-fetch jobs matched to *your* profile — searches the job boards + your tracked ATS companies, dedups, and drops matches on your board |
| `/cos board [--min strong] [--recent 14]` | Rank open roles by how well they match your CV (STRONGEST → Weak), with recency and has/gap skills — then tailor any one in a click |
| `/cos ui` | Launch the **local web control panel** and process anything you queued from the browser |
| `/cos` *(paste a job post or URL)* | Auto-pilot: read the job → score it → build a tailored CV (if it's a good fit) → draft answers → track it |
| `/cos evaluate <job/url/file>` | Score one job out of 5 across 6 dimensions, with a written report |
| `/cos compare <2+ jobs>` | Rank several postings and recommend which to chase |
| `/cos build-cv <job/company> [--theme classic\|modern\|academic\|compact]` | Build a tailored, ATS-safe CV → PDF (saved to a per-job folder `data/output/<company>--<role>/`); pick a theme or set `cv.theme` in your profile |
| `/cos build-cl <job/company>` | Build a tailored cover letter → PDF (alongside the CV in the same folder) |
| `/cos cv-lint` | Flag weak CV bullets (un-quantified, weak-verb, passive, filler) — zero-token, no AI |
| `/cos gaps` | Skill-gap roadmap across your board: the one skill that unlocks the most roles — zero-token |
| `/cos saved` | Your ★ bookmarked jobs; `/cos saved build-all` makes a CV+CL for every one |
| `/cos` *"learn from my edits"* | Look at how you edited a draft and remember your style |
| `/cos apply <job/company>` | Draft answers for an application form (never auto-submits) |
| `/cos scan` | Find new postings from the companies you're watching |
| `/cos tracker` | See and update where each application stands |
| `/cos followup` | Who to follow up with (applications *and* people), and a draft message |
| `/cos digest` | What's new since you last looked — fresh matches + band upgrades only |
| `/cos mock <company>` | Live mock interview: one question at a time, graded, with a debrief |
| `/cos interview-prep <co> <role>` | Interview prep tailored to the company and role |
| `/cos interviews` | Schedule interview rounds, export an `.ics` calendar, time follow-ups — zero-token |
| `/cos research <company> <role>` | Deep-dive research on a company and role |
| `/cos referral <company>` | Find a warm path into a company + draft the referral ask + a forwardable blurb |
| `/cos outreach <company>` | Cold LinkedIn/email outreach to strangers |
| `/cos negotiate` | Offer/salary negotiation strategy + scripts |
| `/cos salary <job/url>` | Read the posting's OWN stated pay band (never estimates) — zero-token |
| `/cos patterns` | What's working in your search, and retune the scoring |
| `/cos backup` | Snapshot your private `data/` into its own git (push only when you say) |

---

## Multi-board fetch (CLI / cron)

The **fetch recent** button in the web panel runs this under the hood, but it's a
plain script you can run yourself or from a cron. It pulls live openings from
**Indeed, ZipRecruiter, Glassdoor, Google Jobs, and LinkedIn** (no login), dedups
them, and ranks them onto your board. Needs the optional Python sidecar
(`npm run jobspy:install`).

```bash
node scripts/jobspy.mjs --country Germany --city Berlin --recent 7 --summary
node scripts/jobspy.mjs --country Luxembourg --recent 3           # default boards
node scripts/jobspy.mjs --boards indeed,linkedin --country France # pick boards
npm run fetch                                                     # profile defaults
```

Pair it with the **digest** for a daily "what's new" report (new matches + band
upgrades only) — ideal in a cron:
```bash
node scripts/jobspy.mjs --country Luxembourg --recent 3 && node scripts/digest.mjs --write --summary
```
(`/cos digest` does the same on demand; the markdown lands in `data/digest-latest.md`.)

> LinkedIn is fetched **anonymously, with no login** — it rate-limits scrapers
> harder than the others, so on heavy use it returns fewer rows, but it degrades
> gracefully (it never fails the whole fetch). Your own LinkedIn session is never
> touched.

---

## Optional: an AI daemon that drains the queue for you

By default CareerOS is **agent-native** — the AI is the agent in *your* editor, and
the in-session agent drains anything you queue from the web panel (`/cos ui`). No
server, no API key. That stays the default and always works.

If you'd rather the web panel process generation on its own **without** an open
agent session, run the optional background **daemon**. It works with **whatever AI
you want to plug in**:

```bash
npm run daemon:setup     # pick a provider + model (writes .careeros.config.json)
npm run daemon           # start the worker; it drains data/ui/requests.jsonl
npm start                # or: launch the web panel AND the daemon together
```

| Provider | How | Key needed? |
|---|---|---|
| `claude-cli` *(default)* | Shells out to `claude --print` using your Claude Code login | No |
| `ollama` | Local models via Ollama (`npm run daemon:ollama --model llama3.2`) | No |
| `openai-compat` | Any OpenAI-compatible endpoint — OpenRouter, Groq, Together, the **Anthropic API**, LM Studio, vLLM… | Yes (yours) |

> `.careeros.config.json` may hold an API key, so it is **git-ignored** — only the
> key-free `.careeros.config.example.json` is tracked. The daemon never auto-applies
> (`apply`/`hunt` still require you) and respects every data-contract guardrail.

---

## Capture a job from any site (browser extension / bookmarklet)

`extension/` ships a tiny **"Send to CareerOS"** Chrome/Edge extension (and a
no-install `bookmarklet.js`). On any job page it scrapes the title/company/description
and posts it to your locally-running panel (`POST /api/inbox` on 127.0.0.1) — which
routes it through `hunt-ingest` onto your board. It only *captures* a posting (never
applies), is bound to localhost, and is disabled in public-demo mode. See
[`extension/README.md`](extension/README.md) to install.

---

## Back up your private data

Everything CareerOS learns about you lives in the git-ignored `data/` folder.
Snapshot it into its own nested git (pushes only when you say so):
```bash
node scripts/backup.mjs --summary                                  # local snapshot
node scripts/backup.mjs --remote git@github.com:you/my-careeros-data.git --push
```

---

## Hosting a read-only public demo

You can host the board as a **read-only showcase** (e.g. `careeros.example.com`).
Because CareerOS is agent-native — the AI is the agent in *your* editor, not a
server — a public instance can't run a visitor's generation. Set the flag at
build/deploy time:
```bash
NEXT_PUBLIC_CAREEROS_PUBLIC=1 npm run build   # demo mode
```
In demo mode the board stays browsable, but every **mutating** action (generate,
fetch, scan, enqueue) is **gated server-side** (HTTP 403) and a **fork-gate** modal
invites the visitor to fork + ⭐ the repo and run it with their own AI agent.
Enforcement lives in `web/lib/gate.ts`. Locally, with the flag unset, you get the
full tool. See `web/.env.example`.

---

## For developers

```bash
npm test                       # all script + library self-tests (600+ checks)
node scripts/doctor.mjs        # check your environment and setup
node scripts/fetch-jd.mjs "https://boards.greenhouse.io/acme/jobs/123" --summary   # scrape a posting
node scripts/compile-latex.mjs data/output/cv-*.tex --kind cv --keywords "Python,SQL" --json
echo '[{"title":"Data Engineer","company":"Acme","url":"https://x/1"}]' | node scripts/hunt-ingest.mjs --dry-run --summary
npm run web:dev                # the local web control panel → http://127.0.0.1:4317
```

A generated document is only "good" if `compile-latex.mjs` reports `ok: true` —
it compiled, has no leftover placeholders, no broken characters, the requested
keywords come out as plain text, and the sections read in a sensible order.

### Layout
```
AGENTS.md                             the agent brief — works with ANY AI coding tool
CLAUDE.md  GEMINI.md  .github/copilot-instructions.md    per-tool shims → AGENTS.md
modes/_router.md                      the /cos command router (agent-neutral)
.claude/skills/                       Claude Code's /careeros + /cos skills
DATA_CONTRACT.md                      the data rules (yours vs the system's)
modes/                                the playbooks the agent follows (onboard, hunt, ui, …)
templates/                            CV/cover-letter LaTeX templates + example configs
lib/                                  shared helper code
scripts/                              the zero-cost tools (fetch-jd, jobspy, ui-queue, compile, …)
scripts/providers/                    job-board sources (greenhouse, ashby, lever, …)
web/                                  the local web control panel (own package.json; Next.js)
data/                                 YOUR private layer — git-ignored, never committed
```

See [`DATA_CONTRACT.md`](DATA_CONTRACT.md) for which files are yours vs. the
system's, and [`AGENTS.md`](AGENTS.md) for how the agent is expected to behave.
