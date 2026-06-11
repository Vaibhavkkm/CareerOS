// Public/demo-mode flag + fork-gate helpers. Client-safe (no server-only imports),
// so both client components and server routes can import it.
//
// CareerOS is agent-native: the "LLM" is the in-session agent, so a publicly
// hosted instance cannot run a visitor's generation on the owner's machine. In demo
// mode the board stays browsable (read-only showcase) but every MUTATING action
// (generate / fetch / scan) is gated → the visitor is asked to fork the repo and run
// it with their OWN AI agent. Enforcement lives server-side (see lib/gate.ts); this
// module powers the matching client UX.
//
// Enable by building/deploying with NEXT_PUBLIC_CAREEROS_PUBLIC=1.

export const IS_PUBLIC = process.env.NEXT_PUBLIC_CAREEROS_PUBLIC === '1';

export const REPO_URL = (process.env.NEXT_PUBLIC_CAREEROS_REPO || 'https://github.com/Vaibhavkkm/CareerOS')
  .replace(/\/+$/, '');
export const FORK_URL = `${REPO_URL}/fork`;

// Broadcast that a mutating action was blocked; ForkGateHost listens and opens the
// modal. Used by both the proactive client guards and api() on a 403 {gated:true}.
export const GATE_EVENT = 'careeros:gated';

export function openForkGate(detail?: { error?: string }): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(GATE_EVENT, { detail: detail || {} }));
  }
}
