'use client';
import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQueue } from './QueueContext';
import { IconPulse } from './Icons';

// Polls the request queue and shows how many agent tasks are waiting. Clicking
// opens a popover with the latest requests + the hint to drain them via /cos ui.
// Uses the shared QueueContext so this component does not start its own poll.
export function QueueIndicator() {
  const { requests: reqs } = useQueue();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const active = reqs.filter((r) => r.status === 'queued' || r.status === 'claimed').length;
  const recent = [...reqs].reverse().slice(0, 12);

  // Position popover below the button using fixed coords derived at open time
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const toggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  };

  const popover = open ? (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 44 }} onMouseDown={() => setOpen(false)} />
      <div
        className="qpop"
        style={{ position: 'fixed', top: pos.top, right: pos.right, left: 'auto', zIndex: 45 }}
      >
        <div className="qpop__head">
          <span>Agent queue · {reqs.length}</span>
          <button className="btn btn--ghost" onClick={() => setOpen(false)}>close</button>
        </div>
        {recent.length === 0 && (
          <div className="qpop__hint">
            Nothing queued. Use a row&rsquo;s <b>Evaluate / Build</b> actions or the <b>Hunt</b> tab — they
            queue work the <b>/cos</b> agent runs (no LLM lives in the browser).
          </div>
        )}
        {recent.map((r) => (
          <div className="qrow" key={r.id}>
            <span className="qrow__kind">{r.kind}</span>
            <span className={`pill pill--${r.status}`}>{r.status}</span>
            <span className="qrow__args">{summarizeArgs(r.args)}</span>
          </div>
        ))}
        {recent.length > 0 && (
          <div className="qpop__hint">
            Daemon processes these automatically. Not running? Start with <b>npm run daemon</b> in your terminal.
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <div className="queue">
      <button
        ref={btnRef}
        className="queue__btn"
        onClick={toggle}
        title="Agent request queue"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <IconPulse />
        <span className="upper">queue</span>
        <span className="qcount" style={{ color: active ? 'var(--signal)' : 'var(--fg-faint)' }}>
          {active}
        </span>
      </button>
      {typeof document !== 'undefined' && createPortal(popover, document.body)}
    </div>
  );
}

function summarizeArgs(args: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v == null || v === '') continue;
    parts.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  return parts.join('  ');
}
