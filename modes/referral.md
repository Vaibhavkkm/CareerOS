# mode: referral — find a warm path into a company and draft the referral ask

Trigger: `/cos referral <company>` (optionally `<company> for report#` / a role).
A referral beats a cold application — it gets the résumé read. This mode maps the
**warmest realistic path** to someone who could refer the user, then drafts the ask
in the candidate's voice. Pure agent playbook — no script of its own. Sibling of
`modes/outreach.md` (cold contact); use **referral** when a connection might exist,
**outreach** when contacting strangers.

> Load order (the router did this): `modes/_shared.md` → this file →
> `data/profile.yml` + `data/cv.master.md` (+ `data/_profile.md`). If a report# is
> given, also read `data/reports/NNN-*.md` for the role, archetype, and proof points.

## Inputs you need
- The **company** (+ the **role**/req URL if known — a referrer needs the exact req).
- The user's **network signals** from `data/profile.yml` + `data/_profile.md` +
  `data/cv.master.md`: past employers, schools/almae matres, communities, OSS
  projects, prior teams. These are the seeds of a referral path. NEVER invent a
  relationship the user didn't state.
- **Voice**: `narrative.voice` + active `data/style/profile.json` rules.
- **Proof points**: real, quantified bullets in `cv.master.md` — what the referrer
  will vouch for must be TRUE.

## Step 1 — Map the referral paths (warmest first)
Reason from the user's real history to propose concrete paths, ranked by warmth:
1. **Direct 1st-degree** — a former colleague/manager/report now at the company
   (cross past employers in `cv.master.md` against the target). The strongest path.
2. **Alumni** — someone from the same university/bootcamp/employer-alumni network now
   there. Suggest the exact LinkedIn filter: company + school.
3. **Community / OSS** — a maintainer, meetup, Slack/Discord, or conference contact
   in the user's stated niche who works there.
4. **2nd-degree** — a mutual connection who could introduce the user to an insider.
For each path name the **likely person-type** and the **exact way to find them**
(LinkedIn "People" filtered by company + a past employer or school; the alumni tool;
a team page). Do NOT fabricate a specific name/handle — if unknown, give the filter
("search: <Company> + <your university> on LinkedIn"). If the user has NO plausible
path, say so honestly and route them to `modes/outreach.md` (cold) instead.

## Step 2 — Confirm the connection with the user
Before drafting, ask the user to confirm which proposed contacts are **real** people
they actually know (or a real shared affiliation). A referral ask sent on a
fabricated tie backfires. Use only confirmed/真实 ties + genuine shared affiliations.

## Step 3 — Draft the referral ask (make it easy to say yes)
A good referral ask is short, gives the referrer everything they need to forward in
one click, and makes a NO easy. Per confirmed contact, write, in the candidate's
voice:
- **Warm 1st-degree (you know them)** — a LinkedIn DM / message, 4–6 sentences:
  (1) genuine reconnect line (reference the real shared context — not "hope you're
  well"); (2) the specific role + req link; (3) ONE quantified, TRUE proof point that
  maps to it; (4) the explicit, low-friction ask ("would you be comfortable referring
  me, or pointing me to whoever owns the req?"); (5) an out ("totally fine if not");
  (6) offer to send a blurb + the CV so it's one click for them.
- **Alumni / loose tie** — a connection note (≤300 chars) that leads with the shared
  affiliation, then the role + one hook, then a soft ask for a chat or a referral.
- **The "forwardable blurb"** — ALSO provide a 3–4 sentence self-contained paragraph
  the referrer can paste into their internal referral form / send to the hiring
  manager verbatim: who the user is, the one standout proof point, the role, and a
  line on fit. This is the single highest-value artifact — it removes the referrer's
  effort. Keep every claim grounded in `cv.master.md`.
Apply `narrative.voice` + the `avoid`/banned-verb lists. Never share the user's phone.

## Step 4 — Offer alternates + timing
- List 1–2 **alternate paths** if the first contact goes cold.
- Note etiquette: ask AFTER a brief reconnect (don't open cold with "refer me"),
  give the referrer the req link + blurb + CV so it's effortless, and a one-line
  **follow-up** to send after ~5 business days if no reply (see `modes/followup.md`).

## Step 5 — Write the report + Machine Summary
Write `data/reports/NNN-<company>-referral-<YYYY-MM-DD>.md` (next free NNN; never
clobber). Include the ranked paths table, the confirmed contacts, every drafted
message + the forwardable blurb verbatim, alternates, and a fenced ```yaml
**Machine Summary** per `templates/schemas/machine-summary.schema.json`
(`final_decision` = the eval band if a report drove this; `next_action` = who to ask
first + via which channel). If a tracker record exists, log it via
`node scripts/tracker.mjs update --id <id> --notes "referral path: <contact> via <channel>"`
(stamps `last_action`); do NOT change `status`.

## Step 6 — Hand off
Give the user the report path, the recommended first contact + channel, the
forwardable blurb, and remind them: **you draft, they send** — and a referral is a
favour, so make it easy and gracious. Nothing is sent from here.

## Never
Send/auto-connect anything · invent a person, a relationship, a shared employer/
school, a handle, or an email · ask for a referral on a fabricated tie · share the
user's phone · fabricate a proof point in the blurb · use a templated opener · exceed
300 chars on a connection note · flip a tracker status.
