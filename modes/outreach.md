# mode: outreach — draft cold LinkedIn/email messages to real people at a company

Trigger: `/cos outreach <company>` (optionally `<company> for report#` / a role).
Identifies likely human targets and drafts a short, specific message for each, in
the candidate's voice. Pure agent playbook — no script of its own.

> Load order (the router did this): `modes/_shared.md` → this file →
> `data/profile.yml` + `data/cv.master.md` (+ `data/_profile.md`). If a report# is
> given, also read `data/reports/NNN-*.md` for the role, archetype, and proof points.

## Inputs you need
- The **company** (and the **role** the user is targeting, if known).
- **Voice**: `data/profile.yml narrative.voice` (tone, sentence length, `avoid`)
  + learned rules in `data/style/profile.json` (active rules, `scope:doc:cl`/global).
- **Proof points**: `narrative.superpowers` / `narrative.proof_points` and real
  bullets in `data/cv.master.md` — the candidate's hooks must be TRUE.
- The user's **email + LinkedIn** from `data/profile.yml contact` (to sign off /
  cite their profile). NEVER pull or send their `phone` — see `_shared.md` guardrails.

## Step 1 — Identify likely targets
Without a directory, reason from role + org shape and propose **3 archetypes** of
contact, most-leverage first:
1. **Hiring manager** — the lead of the team the role reports into (e.g. "Eng
   Manager, Payments"). Highest leverage; address the team's actual problem.
2. **Recruiter / talent** — owns the req; good for process, timeline, and a fast
   intro. Lower-friction but lower-signal.
3. **Peer on the team** — an engineer at the user's level on that team; best for
   honest culture/scope intel and a warm referral.
For each, name the **likely title** and **how to find them** (LinkedIn "People"
filtered by company + team/title; the JD's hiring-manager name; team pages;
conference talks/GitHub for the named niche). Do NOT invent a specific person's
name, handle, or email — if you don't have it, say "search for: <filter>".

## Step 2 — Research the hook (so it isn't generic)
For each target, find ONE **specific, recent** signal to open on: a shipped
product, a public talk/blog/RFC, a team initiative in the JD, an OSS repo, a
funding/launch event. If `research` mode output or a report exists, mine it. A hook
you can't source is not a hook — fall back to a concrete detail from the JD itself,
never a templated opener.

## Step 3 — Draft each message (the 3-sentence framework)
Per target, write a message **≤300 characters** (LinkedIn connection-note safe),
in the candidate's voice, as exactly three sentences:
1. **Specific hook** — the Step-2 signal, naming the real thing ("Saw your talk on
   cutting Kafka p99…"). No "I hope this finds you well", no "I came across…".
2. **Proof point** — ONE quantified, TRUE achievement from `cv.master.md` /
   `proof_points` that maps to *their* problem. One metric, not a résumé dump.
3. **Soft ask** — a low-pressure, specific request: a 15-min chat, a pointer to the
   right person, or "open to a quick note?" Never "please refer me" / "are you hiring".
Apply `narrative.voice` and the `avoid` list; obey active style rules + banned/filler
verbs from `_shared.md`. Tailor register per target (peer = casual; recruiter =
crisp/process; manager = problem-focused). Provide BOTH a LinkedIn version (≤300
chars) and a short **email** variant (subject line + 4–5 sentences) for the manager.

## Step 4 — Offer alternates + a follow-up
- List **alternate targets** (2nd-degree connections, an adjacent-team lead, the
  JD's named contact) so the user has options if the first goes cold.
- Note the right channel per target (InMail vs connection note vs email) and a
  one-line **follow-up** to send after ~5 business days if no reply (see `followup`).

## Step 5 — Write the report + Machine Summary
Write `data/reports/NNN-<company>-outreach-<YYYY-MM-DD>.md` (next free NNN; never
clobber an existing file). Include the targets table, every drafted message
verbatim, the alternates, and a fenced ```yaml **Machine Summary** per
`templates/schemas/machine-summary.schema.json` — set `final_decision` to the eval
band if a report drove this (else omit `score`), and `next_action` to the channel +
who to contact first. If a tracker record exists for this company/role, log the
outreach via
`node scripts/tracker.mjs update --id <id> --notes "outreach drafted: <target> via <channel>"`
(this stamps `last_action`); do NOT change `status`.

## Step 6 — Hand off
Give the user the report path, the recommended first contact + channel, and remind
them: **you draft, they send** — paste into LinkedIn/email and edit freely. Nothing
is sent from here.

## Never
Send anything · auto-connect/message · invent a person's name, title, handle, or
email · share the user's phone number · fabricate a hook or a metric · use a
templated opener ("I hope this finds you well", "I came across your profile") or
corporate-speak · exceed 300 chars on the LinkedIn note · flip a tracker status.
