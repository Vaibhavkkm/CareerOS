'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QueueRequest } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { Toaster, useToasts } from '@/components/Toast';
import { api } from '@/components/util';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

// One learned rule from data/style/profile.json (rendered defensively — the
// engine owns the schema; we show what's there).
type StyleRule = {
  id: string;
  category?: string;
  status: 'provisional' | 'active' | 'superseded' | 'retired';
  confidence?: number;
  value?: string;
  directive?: string;
  scope?: string;
  updated?: string;
};

const STATUS_ORDER: StyleRule['status'][] = ['active', 'provisional', 'superseded', 'retired'];
const STATUS_PILL: Record<StyleRule['status'], string> = {
  active: 'done', provisional: 'claimed', superseded: 'queued', retired: 'failed',
};

export default function StylePage() {
  const [rules, setRules] = useState<StyleRule[]>([]);
  const [editsSeen, setEditsSeen] = useState(0);
  const [pending, setPending] = useState<Record<string, string>>({}); // rule id -> requested status
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    const r = await api<{ ok: boolean; rules?: StyleRule[]; edits_seen?: number }>('/api/style');
    if (r.ok && Array.isArray(r.rules)) {
      setRules(r.rules);
      setEditsSeen(r.edits_seen || 0);
    }
    // Show in-flight style requests as pending pills until the agent drains them.
    const q = await api<{ ok: boolean; requests?: QueueRequest[] }>('/api/queue');
    if (q.ok && Array.isArray(q.requests)) {
      const p: Record<string, string> = {};
      for (const req of q.requests) {
        if (req.kind !== 'style' || req.status === 'done' || req.status === 'failed') continue;
        const a = (req.args || {}) as { rule?: string; status?: string };
        if (a.rule && a.status) p[a.rule] = a.status;
      }
      setPending(p);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const enqueue = useCallback(
    async (rule: string, status: 'active' | 'retired') => {
      if (IS_PUBLIC) { openForkGate(); return; }
      const r = await api<{ ok: boolean; error?: string }>('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ kind: 'style', args: { rule, status } }),
      });
      if (r.ok) {
        setPending((p) => ({ ...p, [rule]: status }));
        push(`${status === 'retired' ? 'retire' : 'accept'} queued — run /cos ui in your AI agent to apply`, 'ok');
      } else push(r.error || 'could not queue', 'err');
    },
    [push],
  );

  const byCategory = useMemo(() => {
    const groups = new Map<string, StyleRule[]>();
    const sorted = [...rules].sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (b.confidence || 0) - (a.confidence || 0),
    );
    for (const r of sorted) {
      const k = r.category || 'other';
      groups.set(k, [...(groups.get(k) || []), r]);
    }
    return [...groups.entries()];
  }, [rules]);

  return (
    <div className="app">
      <TopBar />
      <div className="statusline">
        <span>
          what it learned from <b>your edits</b> — {rules.length} rule{rules.length === 1 ? '' : 's'} from {editsSeen} edit{editsSeen === 1 ? '' : 's'}
        </span>
        <div className="statusline__right">
          <span>truth: data/style/profile.json</span>
        </div>
      </div>
      <div className="main">
        <div className="page">
          <div className="page__h">Style</div>
          <div className="page__lead">
            Every rule below was learned from how you edited a draft (or seeded at onboarding) — nothing is a
            black box. <b>Accept</b> promotes a provisional rule now instead of waiting for a second sighting;{' '}
            <b>retire</b> stops a rule without deleting it (everything stays logged and reversible).
          </div>
          <div className="note">
            Changes are <b>queued</b>, not written here: the agent applies them via{' '}
            <code>style-profile.mjs set-status</code> on the next <b>/cos ui</b> drain, so the browser never
            edits your data files directly.
          </div>

          {rules.length === 0 && (
            <div className="note" style={{ marginTop: 12 }}>
              No learned rules yet — onboard with your CV + cover letter, then edit a generated draft and say{' '}
              <b>&quot;learn from my edits&quot;</b>.
            </div>
          )}

          {byCategory.map(([category, rows]) => (
            <div key={category} style={{ marginTop: 18 }}>
              <div className="page__h" style={{ fontSize: 14, opacity: 0.85 }}>{category}</div>
              {rows.map((r) => {
                const queued = pending[r.id];
                return (
                  <div className="qrow" key={r.id}>
                    <span className="qrow__kind">{r.id}</span>
                    <span className={`pill pill--${STATUS_PILL[r.status] || 'queued'}`}>{r.status}</span>
                    <span className="qrow__args">
                      {r.directive || r.value || '—'}
                      {typeof r.confidence === 'number' ? `  · conf ${r.confidence}` : ''}
                      {r.scope ? `  · ${r.scope}` : ''}
                    </span>
                    {queued ? (
                      <span className="pill pill--queued">→ {queued} queued</span>
                    ) : (
                      <span style={{ display: 'flex', gap: 6 }}>
                        {r.status === 'provisional' && (
                          <button className="btn" onClick={() => enqueue(r.id, 'active')}>✓ accept</button>
                        )}
                        {(r.status === 'provisional' || r.status === 'active') && (
                          <button className="btn btn--ghost" onClick={() => enqueue(r.id, 'retired')}>✗ retire</button>
                        )}
                        {r.status === 'retired' && (
                          <button className="btn btn--ghost" onClick={() => enqueue(r.id, 'active')}>↩ reactivate</button>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
