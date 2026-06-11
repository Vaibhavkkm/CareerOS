# CareerOS — project memory (Claude Code)

@AGENTS.md

> The canonical, agent-neutral project brief lives in `AGENTS.md` (imported
> above — if your tool didn't inline it, read it now). CareerOS works with any
> AI coding agent; this file only adds what is specific to Claude Code.

## Claude Code specifics
- `/careeros` and `/cos` are native skills (`.claude/skills/`); both defer to
  the agent-neutral router at `modes/_router.md`.
- The `mcp__claude_ai_Indeed__*` / `mcp__claude_ai_Dice__*` job-board connectors
  used by `modes/hunt.md` are Claude connectors — optional; the mode's fallback
  ladder (jobspy sidecar, ATS scan, pasted URLs) covers every other setup.
- Optional auto-drain of the web panel's queue: `/loop 30s /cos ui drain`
  (`/loop` is a Claude Code feature; see `modes/ui.md` Step 3).
