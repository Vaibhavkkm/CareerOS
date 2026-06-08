'use client';
import { useEffect, useRef, useState } from 'react';
import { GATE_EVENT, REPO_URL, FORK_URL } from '@/lib/public';
import { IconExternal } from './Icons';

// Mounted once (in the root layout). Opens the fork-gate whenever any mutating
// action is blocked — fired either proactively by the client (openForkGate) or by
// api() when a server route returns 403 {gated:true}. Self-contained: no props.
export function ForkGateHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onGate = () => setOpen(true);
    window.addEventListener(GATE_EVENT, onGate as EventListener);
    return () => window.removeEventListener(GATE_EVENT, onGate as EventListener);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return <ForkGate onClose={() => setOpen(false)} />;
}

const STEPS: [string, string][] = [
  ['Fork the repo', 'Make your own copy on GitHub — CareerOS is open-source and works for anyone.'],
  ['Star it ⭐', 'A star helps the project (and keeps your fork easy to find).'],
  ['Run it in your own Claude Code', 'Clone your fork, open it in Claude Code, then run /careeros onboard with your CV + cover letter. Everything runs locally on your machine — your data never leaves it.'],
];

function ForkGate({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Move focus into the dialog on open; restore it to the trigger on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  return (
    <div
      className="modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Run CareerOS in your own Claude Code"
    >
      <div className="modal__card forkgate" ref={cardRef} tabIndex={-1}>
        <div className="modal__h">Run CareerOS in your own Claude Code</div>
        <div className="modal__p">
          This is a public demo. CareerOS is <b>Claude Code-native</b> — the AI that reads your CV
          and writes your documents is the agent running in <i>your</i> editor, not a server here.
          So generating, fetching and scanning happen on <b>your</b> machine. Browse the board freely;
          to actually use it, set it up in three steps:
        </div>
        <ol className="forkgate__steps">
          {STEPS.map(([title, desc], i) => (
            <li key={i} className="forkgate__step">
              <span className="forkgate__num">{i + 1}</span>
              <span>
                <b>{title}</b>
                <span className="forkgate__desc">{desc}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="modal__row">
          <button className="btn btn--ghost" onClick={onClose}>browse demo</button>
          <a className="btn" href={REPO_URL} target="_blank" rel="noreferrer">
            <IconExternal /> ⭐ Star
          </a>
          <a className="btn btn--primary" href={FORK_URL} target="_blank" rel="noreferrer">
            <IconExternal /> Fork &amp; set up
          </a>
        </div>
      </div>
    </div>
  );
}
