# Contributing to CareerOS

Thanks for your interest in improving CareerOS. This guide explains how the
project is laid out, how to set up a dev environment, and the conventions a change
needs to follow to be merged.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## What CareerOS is (and the rules that follow from it)

CareerOS is a **Claude Code-native, LaTeX-first** CV + cover-letter builder fused
with a job-application pipeline. The "AI" is the in-session Claude Code agent —
**there is no server and no API key.** Deterministic, mechanical work lives in
`scripts/*.mjs` (zero tokens); judgment and writing live in `modes/*.md` playbooks;
every document is a `.tex` compiled to PDF by `tectonic`.

Three non-negotiables for any contribution:

1. **Never commit personal data.** Everything under `data/` (a user's profile, CV,
   letters, tracker) is private and **git-ignored**. Don't add real CVs, emails,
   phone numbers, or generated PDFs to the repo. See [DATA_CONTRACT.md](DATA_CONTRACT.md).
2. **Never fabricate.** The system grounds every claim in the user's own data and
   refuses to invent experience, metrics, employers, or dates. Keep it that way.
3. **Human-in-the-loop, local-first.** CareerOS generates and recommends; it never
   auto-submits an application, and it never phones home. No new network dependency
   should be added without a strong reason and the SSRF-guarded transport in
   `scripts/providers/_http.mjs`.

## Repository layout

| Path | What it is |
|------|------------|
| `.claude/skills/careeros/SKILL.md` | The `/cos` command router |
| `modes/*.md` | Prompt-as-program playbooks (the judgement layer) |
| `modes/_shared.md` | Shared rubric, archetypes, guardrails, LaTeX/ATS rules |
| `scripts/*.mjs` | Deterministic zero-token tools; each ships a `--self-test` |
| `scripts/providers/*.mjs` | ATS source plugins (see the provider contract below) |
| `lib/*.mjs` | Shared deterministic libraries |
| `templates/*` | LaTeX templates, JSON schemas, `states.yml`, example configs |
| `data/**` | The user's private layer — **git-ignored**, never committed |

## Development setup

```bash
npm install                     # only dependency: js-yaml
node scripts/doctor.mjs --fix   # checks tools, scaffolds the data/ structure
npm test                        # all script + library self-tests must pass
```

You also need `tectonic` (`brew install tectonic`) to compile documents and
`poppler` (`brew install poppler`, provides `pdftotext`) for the ATS smoke test and
PDF reading. Node 20+ is required.

## Conventions

- **Node ESM** (`"type": "module"`). The only runtime dependency is `js-yaml`.
- **Every script ships a `--self-test`** and is added to the `test` script in
  `package.json`. Scripts print JSON to stdout (a `--summary` flag may add a
  human-readable view) and guard their CLI entry with
  `import.meta.url === pathToFileURL(process.argv[1]).href`.
- **`npm test` must stay green.** Add tests for new behaviour; prefer pure,
  testable functions with the I/O at the edges.
- **Status strings** always go through `lib/states.mjs` (`templates/states.yml` is
  the single source). **Tracker I/O + dedup** always go through `lib/records.mjs`.
- **LaTeX:** fill `<<PLACEHOLDERS>>` only — never alter a template's preamble; keep
  the `\defaultfontfeatures{Ligatures={NoCommon}}` line (ATS-critical); never add
  `\input{glyphtounicode}`, `\pdfgentounicode`, or microtype `DisableLigatures`
  (they error under tectonic). Escape raw data with `lib/text.mjs`.
- A generated document is "good" only when `node scripts/compile-latex.mjs … --json`
  reports `ok: true`.

## How to add things

- **A new mode** — write `modes/<name>.md` as a playbook (state the trigger, load
  order, numbered steps, and a "Never" list), then add a row to the router table in
  `.claude/skills/careeros/SKILL.md`.
- **A new script/tool** — follow the conventions above, register it in
  `scripts/cli.mjs` (`COMMANDS` + the self-test's `expected` list) and in
  `package.json` (`scripts` + `test`).
- **A new ATS provider** — add `scripts/providers/<id>.mjs` with a default export
  `{ id, detect?(entry), async fetch(entry, ctx) }` returning
  `{ title, url, company, location }[]`; use `ctx.fetchJson/fetchText` so the
  timeout + User-Agent + SSRF guard apply. Files prefixed `_` are shared helpers,
  never loaded as providers.

## Submitting changes

1. Branch from `main`. Keep changes focused.
2. Run `npm test` (and `node scripts/doctor.mjs`) — both should be clean.
3. Write a clear commit message describing *what* changed and *why*. Don't include
   generated artifacts or anything from `data/`.
4. Open a pull request describing the change, how you tested it, and any follow-ups.

## Reporting bugs & proposing features

Open an issue with steps to reproduce (for bugs) or the problem you're trying to
solve (for features). For anything security-related, please follow
[SECURITY.md](SECURITY.md) if present, or flag it privately rather than in a public
issue.
