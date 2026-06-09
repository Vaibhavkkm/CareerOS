'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { QueueIndicator } from './QueueIndicator';
import { ActionsMenu } from './ActionsMenu';
import { useAgentStatus } from './useAgentStatus';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

const TABS = [
  { href: '/', label: 'Board' },
  { href: '/hunt', label: 'Hunt' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/setup', label: 'Setup' },
];

export function TopBar() {
  const path = usePathname();
  const [actions, setActions] = useState(false);
  const { watching } = useAgentStatus();
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
      <span
        className={`agentdot ${watching ? 'is-live' : 'is-off'}`}
        title={watching ? 'Agent watching — actions you click run automatically in your Claude Code' : 'Agent not watching — run /cos ui watch so actions run automatically (or /cos ui to drain once)'}
      >
        <span className="agentdot__dot" />
        {watching ? 'agent live' : 'agent off'}
      </span>
      <button className="actions-btn" onClick={() => setActions(true)} title="All actions — everything CareerOS can do">
        ⚡ Actions
      </button>
      <QueueIndicator />
      <span className="kbd">⌘K</span>
      {actions && <ActionsMenu onClose={() => setActions(false)} />}
    </header>
  );
}
