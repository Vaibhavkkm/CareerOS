'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { QueueIndicator } from './QueueIndicator';
import { OnboardDialog } from './OnboardDialog';
import { Toaster, useToasts } from './Toast';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

const TABS = [
  { href: '/', label: 'Board' },
  { href: '/hunt', label: 'Hunt' },
  { href: '/pipeline', label: 'Pipeline' },
];

export function TopBar() {
  const path = usePathname();
  const [onboard, setOnboard] = useState(false);
  const { toasts, push, dismiss } = useToasts();
  return (
    <header className="topbar">
      <div className="brand">
        <b>CAREER</b>
        <span className="brand__forge">OS</span>
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
        <button className="demo-badge" onClick={() => openForkGate()} title="Public demo — fork the repo to run CareerOS in your own Claude Code">
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
      {onboard && <OnboardDialog onClose={() => setOnboard(false)} onQueued={(m) => push(m, 'ok')} />}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </header>
  );
}
