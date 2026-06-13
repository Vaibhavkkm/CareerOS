'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { QueueIndicator } from './QueueIndicator';
import { ActionsMenu } from './ActionsMenu';
import { LLMSettings } from './LLMSettings';
import { useAgentStatus } from './useAgentStatus';
import { IS_PUBLIC, openForkGate } from '@/lib/public';
import { IconBolt } from './Icons';

const TABS = [
  { href: '/', label: 'Board' },
  { href: '/hunt', label: 'Hunt' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/setup', label: 'Setup' },
];

export function TopBar() {
  const path = usePathname();
  const [actions, setActions] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
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
          const active = t.href === '/' ? path === '/' : path === t.href || path.startsWith(t.href + '/');
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
        title={watching ? 'Daemon live — actions process automatically' : 'Daemon not running — start with: npm run daemon (or npm run start for web + daemon together)'}
        tabIndex={0}
        role="button"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.blur(); }}
      >
        <span className="agentdot__dot" />
        {watching ? 'agent live' : 'agent off'}
      </span>
      <button className="actions-btn" onClick={() => setLlmOpen(true)} title="Configure LLM provider — Claude CLI, Ollama, or OpenAI-compatible">
        LLM
      </button>
      <button className="actions-btn" onClick={() => setActions(true)} title="All actions — everything CareerOS can do">
        <IconBolt size={12} /> Actions
      </button>
      <QueueIndicator />
      <span className="kbd">⌘K</span>
      {actions && <ActionsMenu onClose={() => setActions(false)} />}
      {llmOpen && <LLMSettings onClose={() => setLlmOpen(false)} />}
    </header>
  );
}
