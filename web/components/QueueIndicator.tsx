'use client';
import { useCallback, useEffect, useState } from 'react';
import type { QueueRequest } from '@/lib/types';
import { api } from './util';
import { IS_PUBLIC } from '@/lib/public';
import { IconPulse } from './Icons';

// Polls the request queue and shows how many agent tasks are waiting. Clicking
// opens a popover with the latest requests + the hint to drain them via /cos ui.
export function QueueIndicator() {
  const [reqs, setReqs] = useState<QueueRequest[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ ok: boolean; requests?: QueueRequest[] }>('/api/queue');
    if (r && Array.isArray(r.requests)) setReqs(r.requests);
  }, []);

  useEffect(() => {
    // The public demo has no queue (always empty) — don't poll a serverless
    // function every few seconds for nothing.
    if (IS_PUBLIC) return;
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const active = reqs.filter((r) => r.status === 'queued' || r.status === 'claimed').length;
  const recent = [...reqs].reverse().slice(0, 12);

  return (
    <div className="queue">
      <button className="queue__btn" onClick={() => setOpen((o) => !o)} title="Agent request queue">
        <IconPulse />
        <span className="upper">queue</span>
        <span className="qcount" style={{ color: active ? 'var(--signal)' : 'var(--fg-faint)' }}>
          {active}
        </span>
      </button>
      {open && (
        <div className="qpop">
          <div className="qpop__head">
            <span>Agent queue · {reqs.length}</span>
            <button className="btn btn--ghost" onClick={() => setOpen(false)}>
              close
            </button>
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
              {r.status === 'done' && <ResultLinks result={r.result} />}
            </div>
          ))}
          {recent.length > 0 && (
            <div className="qpop__hint">
              Run <b>/cos ui</b> in Claude Code to drain the queue — status updates here live.
            </div>
          )}
        </div>
      )}
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

// A completed build/apply request reports its artifacts in `result`. Surface any
// generated PDFs as links the user can open right here — /api/pdf streams them
// from data/output/ (sandboxed). The agent stores cv_pdf/cl_pdf (legacy: pdf).
function ResultLinks({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const links: { label: string; path: string }[] = [];
  for (const [key, label] of [['cv_pdf', 'CV'], ['cl_pdf', 'CL'], ['pdf', 'PDF']] as const) {
    const v = r[key];
    if (typeof v === 'string' && v.toLowerCase().endsWith('.pdf')) links.push({ label, path: v });
  }
  if (links.length === 0) return null;
  return (
    <span className="qrow__links">
      {links.map((l) => (
        <a
          key={l.path}
          href={`/api/pdf?path=${encodeURIComponent(l.path)}`}
          target="_blank"
          rel="noopener noreferrer"
          title={l.path}
          style={{ color: 'var(--signal)', marginLeft: 8, textDecoration: 'underline' }}
        >
          {l.label} ↗
        </a>
      ))}
    </span>
  );
}
