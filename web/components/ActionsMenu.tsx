'use client';
import { useCallback, useState } from 'react';
import { api } from './util';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

// A visible, discoverable launcher for EVERYTHING CareerOS can do — so a user never
// has to remember terminal commands. Opened from the top bar. Three kinds of action:
//   • run   — a deterministic, zero-AI script the browser can execute itself
//             (scan, fetch recent) → runs instantly, result shown inline.
//   • queue — agent/MCP work the browser can't run (it has no LLM) → enqueued for
//             the /cos agent; the global QueueWatcher notifies you when it's done.
//   • link  — navigate to a page in the panel.
//   • cmd   — work that is per-job or agent-only; we show the exact `/cos` command
//             with a one-click copy, so you paste it into Claude Code.
// This makes the website the discovery surface; the agent stays the engine.

type Item =
  | { type: 'run'; id: string; label: string; desc: string; route: string; body?: Record<string, unknown> }
  | { type: 'queue'; id: string; label: string; desc: string; kind: string; args?: Record<string, unknown> }
  | { type: 'link'; id: string; label: string; desc: string; href: string }
  | { type: 'cmd'; id: string; label: string; desc: string; cmd: string };

interface Group {
  title: string;
  note?: string;
  items: Item[];
}

const GROUPS: Group[] = [
  {
    title: 'Runs now · no AI needed',
    note: 'Executes instantly in the panel.',
    items: [
      { type: 'run', id: 'scan', label: 'Scan ATS portals', desc: 'Pull new postings from your tracked companies onto the board.', route: '/api/scan' },
      { type: 'run', id: 'fetch', label: 'Fetch recent jobs', desc: 'Indeed · ZipRecruiter · Google — CV-matched, for your country.', route: '/api/fetch-recent', body: {} },
      { type: 'link', id: 'refresh', label: 'Refresh board', desc: 'Re-rank the board against your master CV.', href: '/' },
    ],
  },
  {
    title: 'Queue for the agent',
    note: 'Enqueued now; run /cos ui in Claude Code to execute — you’ll be notified here when done.',
    items: [
      { type: 'queue', id: 'hunt', label: 'Hunt from my profile', desc: 'Auto-fetch roles matched to your target roles + locations.', kind: 'hunt', args: {} },
    ],
  },
  {
    title: 'Open',
    items: [
      { type: 'link', id: 'setup', label: 'Upload my CV', desc: 'Add one or more CVs → merged into your master.', href: '/setup' },
      { type: 'link', id: 'hunt-page', label: 'Hunt page', desc: 'Target a specific search and review recent hunts.', href: '/hunt' },
      { type: 'link', id: 'pipeline', label: 'Pipeline', desc: 'Your application funnel and tracker.', href: '/pipeline' },
    ],
  },
  {
    title: 'In Claude Code · per-job or AI work',
    note: 'These need the agent or a chosen job. Copy the command into Claude Code — or on the Board, click a job for its Evaluate / Build CV / Build CL / Apply actions.',
    items: [
      { type: 'cmd', id: 'evaluate', label: 'Evaluate a job', desc: 'Score one posting out of 5 with a written report.', cmd: '/cos evaluate <job url or file>' },
      { type: 'cmd', id: 'build-cv', label: 'Build a tailored CV', desc: 'ATS-safe CV PDF for a job (add --theme modern/academic/compact).', cmd: '/cos build-cv <job or company>' },
      { type: 'cmd', id: 'build-cl', label: 'Build a cover letter', desc: 'Tailored cover-letter PDF in your voice.', cmd: '/cos build-cl <job or company>' },
      { type: 'cmd', id: 'cv-lint', label: 'Lint my CV', desc: 'Flag weak / un-quantified / passive bullets.', cmd: '/cos lint' },
      { type: 'cmd', id: 'gaps', label: 'Skill-gap roadmap', desc: 'Which skill unlocks the most roles on your board.', cmd: '/cos gaps' },
      { type: 'cmd', id: 'salary', label: 'Salary scan', desc: 'Stated pay bands across your saved postings.', cmd: '/cos salary' },
      { type: 'cmd', id: 'interview-prep', label: 'Interview prep', desc: 'Audience-segmented prep + STAR story map.', cmd: '/cos interview-prep <company> <role>' },
      { type: 'cmd', id: 'mock', label: 'Mock interview', desc: 'Live ask → answer → score drill.', cmd: '/cos mock <company> <role>' },
      { type: 'cmd', id: 'referral', label: 'Referral path', desc: 'Find a warm intro + a forwardable blurb.', cmd: '/cos referral <company>' },
      { type: 'cmd', id: 'interviews', label: 'Schedule an interview', desc: 'Track a round + export an .ics calendar.', cmd: '/cos interviews add --company <c> --when <ISO>' },
      { type: 'cmd', id: 'negotiate', label: 'Negotiate an offer', desc: 'Strategy + scripts in your voice.', cmd: '/cos negotiate <company>' },
      { type: 'cmd', id: 'learn', label: 'Learn from my edits', desc: 'Distil your edits into your style profile.', cmd: '/cos style-learn' },
    ],
  },
];

export function ActionsMenu({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<{ id: string; msg: string; kind: 'ok' | 'err' | 'muted' } | null>(null);
  const [copied, setCopied] = useState('');

  const run = useCallback(async (it: Item) => {
    if (IS_PUBLIC && it.type !== 'link' && it.type !== 'cmd') { openForkGate(); return; }
    if (it.type === 'link') { window.location.href = it.href; return; }
    if (it.type === 'cmd') {
      try {
        await navigator.clipboard.writeText(it.cmd);
        setCopied(it.id);
        setTimeout(() => setCopied(''), 1500);
      } catch { /* clipboard blocked — the command is visible to copy by hand */ }
      return;
    }
    setStatus({ id: it.id, msg: 'working…', kind: 'muted' });
    if (it.type === 'run') {
      const r = await api<{ ok: boolean; counts?: { added?: number }; received?: number; error?: string }>(it.route, {
        method: 'POST', body: JSON.stringify(it.body || {}),
      });
      setStatus(r.ok
        ? { id: it.id, msg: `done · ${r.counts?.added ?? 0} new${r.received != null ? ` (${r.received} seen)` : ''}`, kind: 'ok' }
        : { id: it.id, msg: r.error || 'failed', kind: 'err' });
    } else if (it.type === 'queue') {
      const r = await api<{ ok: boolean; error?: string }>('/api/queue', {
        method: 'POST', body: JSON.stringify({ kind: it.kind, args: it.args || {} }),
      });
      setStatus(r.ok
        ? { id: it.id, msg: 'queued — run /cos ui; you’ll be notified when done', kind: 'ok' }
        : { id: it.id, msg: r.error || 'could not queue', kind: 'err' });
    }
  }, []);

  return (
    <div className="actions" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="actions__panel" role="dialog" aria-label="Actions">
        <div className="actions__head">
          <span>Actions · everything CareerOS can do</span>
          <button className="btn btn--ghost" onClick={onClose}>close</button>
        </div>
        <div className="actions__body">
          {GROUPS.map((g) => (
            <div className="actions__group" key={g.title}>
              <div className="actions__gtitle">{g.title}</div>
              {g.note && <div className="actions__gnote">{g.note}</div>}
              {g.items.map((it) => (
                <button key={it.id} className="actions__item" onClick={() => run(it)}>
                  <div className="actions__itemmain">
                    <span className="actions__label">{it.label}</span>
                    <span className="actions__desc">{it.desc}</span>
                    {it.type === 'cmd' && <code className="actions__cmd">{it.cmd}</code>}
                    {status?.id === it.id && (
                      <span className={`actions__status ${status.kind === 'ok' ? 'ok' : status.kind === 'err' ? 'err' : 'muted'}`}>
                        {status.msg}
                      </span>
                    )}
                  </div>
                  <span className="actions__cta">
                    {it.type === 'cmd'
                      ? (copied === it.id ? 'copied!' : 'copy')
                      : it.type === 'link' ? 'open'
                      : (it.type === 'run' ? 'run' : 'queue')}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
