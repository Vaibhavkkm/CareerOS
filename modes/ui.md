# mode: ui — launch the local web control panel + drain its request queue

Trigger: `/cos ui` (alias `web`). Two jobs: (1) get the dashboard running, and
(2) act on anything the user queued from the browser. The web app is a LOCAL
control panel (runs on `127.0.0.1`) — a high-contrast dark board over your real
engine. It runs the zero-token scripts itself, but it has **no LLM and no MCP
access**, so judgment/MCP work (evaluate, build-cv, build-cl, apply, hunt) is
**queued** to `data/ui/requests.jsonl` for you to run here. That queue is the
handshake; this mode is the agent half of it.

## Step 1 — Launch (first run + every run)
1. `node scripts/doctor.mjs --fix` — ensures `data/ui/` exists and the engine is healthy.
2. If `web/node_modules` is missing, tell the user to install once:
   `cd web && npm install`.
3. Start it: `npm run --prefix web dev` (or `cd web && npm run dev`), then open
   **http://127.0.0.1:4317**. It binds to localhost only — it is not exposed to the network.
4. Explain the split in one line: the board, filters, scan, fetch, tracker updates,
   and PDF previews run instantly in the browser; **Evaluate / Build CV / Build CL /
   Apply / Hunt** buttons queue work for you (the `/cos` agent) to run — come back here
   and run `/cos ui` (or `/cos ui drain`) to process them.

## Step 2 — Drain the queue (the handshake)
Run this whenever the user returns from the browser, or asks to "process the queue".

1. List what's waiting: `node scripts/ui-queue.mjs list --status queued`.
2. For EACH queued request, in order:
   a. **Claim it** (idempotent — skip if already claimed by you):
      `node scripts/ui-queue.mjs claim --id <id>`. If it reports `already-claimed`/
      `already-done`, skip — don't double-run.
   b. **Route by `kind`** to the real mode and run it EXACTLY as if the user invoked
      it, honoring every gate and guardrail in that playbook:
      - `onboard`  → `modes/onboard.md`. `args` carries the repo-relative paths of files
        the user uploaded in the browser (e.g. `{cv:"data/ui/uploads/<ts>/cv-….pdf",
        cl:"data/ui/uploads/<ts>/cl-….pdf"}`). Read those (PDF → `pdftotext`), run the
        full onboarding (profile.yml + cv.master.md + learned voice). Then kick off an
        initial CV-matched fetch (`npm run fetch` or `scripts/jobspy.mjs`) so the board
        fills with jobs ranked against the new profile, and say so in the result notes.
      - `evaluate` → `modes/evaluate.md` (writes report NNN + Machine Summary + tracker row)
      - `build-cv` → `modes/build-cv.md` (style context → draft → snapshot → compile)
      - `build-cl` → `modes/build-cl.md`
      - `apply`    → `modes/apply.md` (draft answers / references — present, don't submit)
      - `hunt`     → `modes/hunt.md` (MCP discovery → ingest → board)
      Resolve the target from `args` (e.g. `{report:7}`, `{company:"Acme"}`, `{url:"…"}`,
      `{id:3}`, a hunt `{query, location}`, or an onboard `{cv, cl}`).
   c. **Record the outcome:**
      - success → `node scripts/ui-queue.mjs complete --id <id> --result '{"cv_pdf":"data/output/<company>--<role>/cv-….pdf","cl_pdf":"data/output/<company>--<role>/cl-….pdf","report":"data/reports/…","notes":"what you did"}'`.
        ALWAYS put the per-job folder PDF path(s) in the result — the browser's queue
        popover turns `cv_pdf`/`cl_pdf` into clickable links so the user opens the doc
        without leaving the dashboard. (Legacy `pdf` is still accepted.)
      - failure → `node scripts/ui-queue.mjs fail --id <id> --error "<one-line reason>"`
   The browser polls and flips each request's status pill live as you advance it.
   **Staged uploads are auto-purged:** `complete`/`fail` delete any `data/ui/uploads/`
   files the request referenced (PII hygiene — see `ui-queue.mjs purgeStagedUploads`),
   so you never manually `rm` an uploaded CV/CL.
3. Summarize: which requests you completed, the artifacts produced, and anything that
   needs the user (e.g. "CV built — review `data/output/cv-…pdf`, then mark Applied in
   the UI once you've actually submitted").

## Step 3 — Auto-drain (optional, lowest-friction)
The browser has no LLM, so queued work only runs when an agent session drains it.
To make a click in the UI execute on its own — no manual `/cos ui` each time — leave
a drain loop running in an open agent session. In Claude Code:

```
/loop 30s /cos ui drain
```

(`/loop` is Claude Code-specific; stop it with `/loop stop` or by ending the
session. In any other agent tool, use that tool's recurring-task feature if it
has one, or simply re-issue `cos ui drain` whenever the user has queued clicks.)

This re-runs the Step-2 drain every 30s, so anything you queue in the browser starts
within seconds and its status pill flips live. Notes:
- **Safe to fully auto-run:** `evaluate`, `build-cv`, `build-cl`, `hunt` — they produce
  an artifact (report / draft PDF / board rows) that IS the review point; nothing is sent.
- **Pauses for the human even under the loop:** `onboard` shows the extracted/diffed
  facts before overwriting `profile.yml` (never blind-overwrites a set-up profile), and
  `apply` drafts answers but **never submits**. The loop starts these and stops at the
  checkpoint — it does not bypass any guardrail below.
- The loop is opt-in and costs tokens each pass; recommend it when the user is actively
  clicking, not as an always-on default.

## Guardrails (absolute — same as every mode)
- **NEVER auto-submit** an application. You generate; the human applies in the browser.
- **NEVER flip a tracker record to `applied` from the queue.** Status flips happen only
  when the human confirms in the UI (a Class-A `tracker update` behind a confirm dialog).
  The queue carries generation work ONLY — `ui-queue.mjs` itself rejects an `applied` kind.
- **NEVER fabricate** experience, metrics, employers, dates, or a listing.
- Respect each mode's score gate (`compile_score_threshold`, `draft_answers_threshold`) —
  ask before spending a compile on a clearly sub-threshold role.
- The web app writes to `data/` ONLY under `data/ui/`; everything else flows through the
  engine scripts. If you ever see it doing otherwise, stop and flag it.

## Notes
- No database: the dashboard reads your real files (`tracker.jsonl`, `data/jds/`,
  `data/reports/`, board output) live. Editing the truth (e.g. `tracker.mjs`) updates
  the board on the next refresh.
- The queue is append-only truth at `data/ui/requests.jsonl`; `data/ui/results/` holds
  optional per-request payloads. All of `data/` is git-ignored (your data, your machine).
- The UI's "clear completed" button (or `node scripts/ui-queue.mjs clear`) moves
  done/failed requests to `data/ui/requests.archive.jsonl` (history kept) and trims the
  active queue — it never hard-deletes a record.
- Uploaded CVs/cover letters stage under `data/ui/uploads/<ts>/` and are deleted the
  moment their request completes/fails, so PII doesn't linger.
