'use client';
import { useCallback, useState } from 'react';
import { api } from './util';
import { useAgentStatus } from './useAgentStatus';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

// A visible launcher for EVERYTHING CareerOS can do — and it actually TRIGGERS the
// work, no copy-paste. Action kinds:
//   • run     — a deterministic engine route the browser runs itself (scan, fetch).
//   • tool    — a zero-LLM analysis script run via /api/tool (gaps, salary, lint):
//               runs instantly in the panel, result shown inline. No terminal at all.
//   • queue   — agent work enqueued for /cos (hunt). With /cos ui WATCH running, it
//               executes in your terminal automatically; otherwise run /cos ui once.
//   • command — generic agent command enqueued as {kind:'command',args:{cmd,target}}.
//               Needs the agent; many take a target (a job/company), entered inline.
//   • link    — navigate within the panel.
// The browser has no LLM, so agent work still runs in your Claude Code — but you
// TRIGGER it from here, and (in watch mode) never touch the terminal per task.

type Item =
  | { type: 'run'; id: string; label: string; desc: string; route: string; body?: Record<string, unknown> }
  | { type: 'tool'; id: string; label: string; desc: string; tool: string }
  | { type: 'queue'; id: string; label: string; desc: string; kind: string; args?: Record<string, unknown> }
  | { type: 'command'; id: string; label: string; desc: string; cmd: string; arg?: string }
  | { type: 'link'; id: string; label: string; desc: string; href: string };

interface Group { title: string; note?: string; items: Item[] }

const GROUPS: Group[] = [
  {
    title: 'Runs now · instant, no terminal',
    note: 'Executed right here in the panel — no AI needed.',
    items: [
      { type: 'run', id: 'scan', label: 'Scan ATS portals', desc: 'Pull new postings from your tracked companies onto the board.', route: '/api/scan' },
      { type: 'run', id: 'fetch', label: 'Fetch recent jobs', desc: 'Indeed · ZipRecruiter · Google — CV-matched, for your country.', route: '/api/fetch-recent', body: {} },
      { type: 'tool', id: 'gaps', label: 'Skill-gap roadmap', desc: 'Which skill unlocks the most roles on your board.', tool: 'gaps' },
      { type: 'tool', id: 'salary', label: 'Salary scan', desc: 'Stated pay bands across your saved postings.', tool: 'salary' },
      { type: 'tool', id: 'cv-lint', label: 'Lint my CV', desc: 'Flag weak / un-quantified / passive bullets.', tool: 'cv-lint' },
      { type: 'link', id: 'refresh', label: 'Refresh board', desc: 'Re-rank the board against your master CV.', href: '/' },
    ],
  },
  {
    title: 'Run in my Claude Code · triggered from here',
    note: 'Tip: run /cos ui watch once in Claude Code — then these run in your terminal automatically when you click. Otherwise run /cos ui to drain.',
    items: [
      { type: 'queue', id: 'hunt', label: 'Hunt from my profile', desc: 'Auto-fetch roles matched to your target roles + locations.', kind: 'hunt', args: {} },
      { type: 'command', id: 'evaluate', label: 'Evaluate a job', desc: 'Score one posting out of 5 with a written report.', cmd: 'evaluate', arg: 'job URL or report#' },
      { type: 'command', id: 'build-cv', label: 'Build a tailored CV', desc: 'ATS-safe CV PDF for a job/company.', cmd: 'build-cv', arg: 'job or company' },
      { type: 'command', id: 'build-cl', label: 'Build a cover letter', desc: 'Tailored cover-letter PDF in your voice.', cmd: 'build-cl', arg: 'job or company' },
      { type: 'command', id: 'interview-prep', label: 'Interview prep', desc: 'Audience-segmented prep + STAR story map.', cmd: 'interview-prep', arg: 'company role' },
      { type: 'command', id: 'mock', label: 'Mock interview', desc: 'Live ask → answer → score drill.', cmd: 'mock', arg: 'company role' },
      { type: 'command', id: 'referral', label: 'Referral path', desc: 'Find a warm intro + a forwardable blurb.', cmd: 'referral', arg: 'company' },
      { type: 'command', id: 'negotiate', label: 'Negotiate an offer', desc: 'Strategy + scripts in your voice.', cmd: 'negotiate', arg: 'company' },
      { type: 'command', id: 'style-learn', label: 'Learn from my edits', desc: 'Distil your edits into your style profile.', cmd: 'style-learn' },
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
];

// Tiny inline summary of a tool result so the user sees the answer without leaving.
function toolSummary(tool: string, d: Record<string, unknown>): string {
  if (d.ok === false) return String(d.error || 'no data — upload your CV / fill the board first');
  if (tool === 'gaps') {
    const skills = (d.skills as { skill: string; jobs: number }[]) || [];
    return skills.length ? `top: ${skills.slice(0, 3).map((s) => s.skill).join(', ')}` : 'no gaps found yet';
  }
  if (tool === 'salary') return `${d.disclosed ?? 0}/${d.total ?? 0} postings disclose pay`;
  if (tool === 'cv-lint') return `score ${d.score ?? '?'}/100 · ${d.flagged ?? 0} bullets flagged`;
  return 'done';
}

export function ActionsMenu({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<{ id: string; msg: string; kind: 'ok' | 'err' | 'muted' } | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const { watching } = useAgentStatus(4000);
  const queuedMsg = watching ? 'sent — running in your Claude Code now' : 'queued — run /cos ui (or /cos ui watch to auto-run)';

  const run = useCallback(async (it: Item) => {
    if (IS_PUBLIC && it.type !== 'link') { openForkGate(); return; }
    if (it.type === 'link') { window.location.href = it.href; return; }
    setStatus({ id: it.id, msg: 'working…', kind: 'muted' });

    if (it.type === 'run') {
      const r = await api<{ ok: boolean; counts?: { added?: number }; received?: number; error?: string }>(it.route, { method: 'POST', body: JSON.stringify(it.body || {}) });
      setStatus(r.ok ? { id: it.id, msg: `done · ${r.counts?.added ?? 0} new${r.received != null ? ` (${r.received} seen)` : ''}`, kind: 'ok' } : { id: it.id, msg: r.error || 'failed', kind: 'err' });
      return;
    }
    if (it.type === 'tool') {
      const r = await api<Record<string, unknown>>('/api/tool', { method: 'POST', body: JSON.stringify({ tool: it.tool }) });
      setStatus({ id: it.id, msg: toolSummary(it.tool, r), kind: r && r.ok === false ? 'err' : 'ok' });
      return;
    }
    if (it.type === 'queue') {
      const r = await api<{ ok: boolean; error?: string }>('/api/queue', { method: 'POST', body: JSON.stringify({ kind: it.kind, args: it.args || {} }) });
      setStatus(r.ok ? { id: it.id, msg: queuedMsg, kind: 'ok' } : { id: it.id, msg: r.error || 'could not queue', kind: 'err' });
      return;
    }
    // command
    const target = (targets[it.id] || '').trim();
    if (it.arg && !target) { setStatus({ id: it.id, msg: `enter a ${it.arg} first`, kind: 'err' }); return; }
    const r = await api<{ ok: boolean; error?: string }>('/api/queue', { method: 'POST', body: JSON.stringify({ kind: 'command', args: { cmd: it.cmd, ...(target ? { target } : {}) } }) });
    setStatus(r.ok ? { id: it.id, msg: queuedMsg, kind: 'ok' } : { id: it.id, msg: r.error || 'could not queue', kind: 'err' });
  }, [targets]);

  return (
    <div className="actions" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="actions__panel" role="dialog" aria-label="Actions">
        <div className="actions__head">
          <span>Actions · everything CareerOS can do</span>
          <button className="btn btn--ghost" onClick={onClose}>close</button>
        </div>
        <div className={`actions__agent ${watching ? 'is-live' : 'is-off'}`}>
          <span className="agentdot__dot" />
          {watching
            ? 'Agent watching — what you trigger runs in your Claude Code automatically.'
            : 'Agent not watching — run /cos ui watch in Claude Code so clicks run automatically (or /cos ui to drain once).'}
        </div>
        <div className="actions__body">
          {GROUPS.map((g) => (
            <div className="actions__group" key={g.title}>
              <div className="actions__gtitle">{g.title}</div>
              {g.note && <div className="actions__gnote">{g.note}</div>}
              {g.items.map((it) => (
                <div key={it.id} className="actions__item">
                  <div className="actions__itemmain">
                    <span className="actions__label">{it.label}</span>
                    <span className="actions__desc">{it.desc}</span>
                    {it.type === 'command' && it.arg && (
                      <input
                        className="actions__target"
                        placeholder={it.arg}
                        value={targets[it.id] || ''}
                        onChange={(e) => setTargets((t) => ({ ...t, [it.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') run(it); }}
                      />
                    )}
                    {status?.id === it.id && (
                      <span className={`actions__status ${status.kind === 'ok' ? 'ok' : status.kind === 'err' ? 'err' : 'muted'}`}>{status.msg}</span>
                    )}
                  </div>
                  <button className="actions__cta" onClick={() => run(it)}>
                    {it.type === 'link' ? 'open' : it.type === 'tool' || it.type === 'run' ? 'run' : 'trigger'}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
