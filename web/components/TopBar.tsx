'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { QueueIndicator } from './QueueIndicator';
import { OnboardDialog } from './OnboardDialog';
// Step 9: TopBar no longer hosts its own Toaster — it receives push via prop
// so that the single toaster in the page/layout can handle all toasts.
import { IS_PUBLIC, openForkGate } from '@/lib/public';
import { api } from './util';

const TABS = [
  { href: '/', label: 'Board' },
  { href: '/hunt', label: 'Hunt' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/saved', label: 'Saved' },
];

export function TopBar({
  onToast,
}: {
  /** Optional: receives a push callback so TopBar can emit toasts to the single host */
  onToast?: (msg: string, kind?: 'ok' | 'err' | 'info') => void;
}) {
  const path = usePathname();
  const [onboard, setOnboard] = useState(false);
  const [running, setRunning] = useState(false);

  // Process whatever is queued NOW (build CV/CL, evaluate, …) without waiting for the
  // background daemon's poll. Fires a one-shot drain server-side; the QueueIndicator
  // reflects progress. CareerOS still never auto-submits an application.
  const runQueue = async () => {
    if (IS_PUBLIC) { openForkGate(); return; }
    setRunning(true);
    const r = await api<{ ok: boolean; queued?: number; started?: boolean; error?: string }>(
      '/api/run-queue', { method: 'POST' },
    );
    setRunning(false);
    if (r.ok) onToast?.(r.queued ? `processing ${r.queued} queued item(s)…` : 'queue is empty — nothing to run', r.queued ? 'ok' : 'info');
    else onToast?.(r.error || 'could not run the queue', 'err');
  };

  return (
    <header className="topbar">
      <div className="brand">
        <b>CAREER</b>
        {/* Step 10: renamed brand__forge → brand__os */}
        <span className="brand__os">OS</span>
        <span className="brand__cursor" />
      </div>
      <nav className="nav">
        {TABS.map((t) => {
          const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={`nav__item ${active ? 'nav__item--active' : ''}`}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="topbar__spacer" />
      {IS_PUBLIC && (
        <button className="demo-badge" onClick={() => openForkGate()} title="Public demo — fork the repo to run CareerOS with your own AI agent">
          DEMO · fork to run
        </button>
      )}
      <button
        className="btn"
        onClick={runQueue}
        disabled={running}
        title="Process queued work now (build CV/CL, evaluate, onboard…) — runs your queue without waiting for the daemon"
      >
        {running ? '▶ running…' : '▶ run queue'}
      </button>
      <button
        className="btn"
        onClick={() => (IS_PUBLIC ? openForkGate() : setOnboard(true))}
        title="Upload your CV + cover letter — CareerOS learns your facts & voice, then ranks jobs by YOUR CV"
      >
        ⤴ my CV/CL
      </button>
      <QueueIndicator />
      <span className="kbd">⌘K</span>
      {onboard && (
        <OnboardDialog
          onClose={() => setOnboard(false)}
          onQueued={(m) => onToast ? onToast(m, 'ok') : undefined}
        />
      )}
    </header>
  );
}
