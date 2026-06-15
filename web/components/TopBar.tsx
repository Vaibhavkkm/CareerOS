'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { QueueIndicator } from './QueueIndicator';
import { OnboardDialog } from './OnboardDialog';
// Step 9: TopBar no longer hosts its own Toaster — it receives push via prop
// so that the single toaster in the page/layout can handle all toasts.
import { IS_PUBLIC, openForkGate } from '@/lib/public';

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
