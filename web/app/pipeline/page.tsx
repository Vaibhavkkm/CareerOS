'use client';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { TrackerRecord } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Toaster, useToasts } from '@/components/Toast';
import { api } from '@/components/util';
import './pipeline.css';

// Canonical statuses the tracker API accepts. RANK drives the funnel/KPI maths;
// ALL_STATUSES drives the per-row selector (move a row in ANY direction).
const STATUS_LABEL: Record<string, string> = {
  evaluated: 'Evaluated', applied: 'Applied', responded: 'Responded',
  interview: 'Interview', offer: 'Offer', rejected: 'Rejected',
  discarded: 'Discarded', skip: 'Skip',
};
const ALL_STATUSES = ['evaluated', 'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'skip'];
const RANK: Record<string, number> = { evaluated: 1, applied: 2, responded: 3, interview: 4, offer: 5 };
const FUNNEL = ['evaluated', 'applied', 'responded', 'interview', 'offer'] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

function DocLinks({ cv, cl }: { cv?: string; cl?: string }) {
  const items: [string, string][] = [];
  if (cv && cv.toLowerCase().endsWith('.pdf')) items.push(['CV', cv]);
  if (cl && cl.toLowerCase().endsWith('.pdf')) items.push(['CL', cl]);
  if (!items.length) return null;
  return (
    <div className="docs">
      {items.map(([label, path]) => (
        <a key={label} className="doc" href={`/api/pdf?path=${encodeURIComponent(path)}`} target="_blank" rel="noopener noreferrer" title={path}>
          {label} <span className="a">↗</span>
        </a>
      ))}
    </div>
  );
}

export default function PipelinePage() {
  const [records, setRecords] = useState<TrackerRecord[] | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<number | null>(null);
  const [booted, setBooted] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    const r = await api<{ ok: boolean; records?: TrackerRecord[]; error?: string }>('/api/tracker');
    if (r.ok && Array.isArray(r.records)) setRecords(r.records);
    else { push(r.error || 'could not read tracker', 'err'); setRecords([]); }
  }, [push]);
  useEffect(() => { load(); }, [load]);

  // boot sequence: fade the panels in + sweep the meters/channels to their values.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setBooted(true)));
    const t = setTimeout(() => setBootDone(true), 1800);
    return () => { cancelAnimationFrame(id); clearTimeout(t); };
  }, []);

  const update = useCallback(async (id: number, status: string, confirmApplied = false) => {
    const r = await api<{ ok: boolean; error?: string }>('/api/tracker', {
      method: 'POST', body: JSON.stringify({ id, status, confirmApplied }),
    });
    if (r.ok) { push(`#${id} → ${STATUS_LABEL[status] || status}`, 'ok'); load(); }
    else if (r.error === 'needs_confirm') setConfirm(id);
    else push(r.error || 'update failed', 'err');
  }, [load, push]);

  const remove = useCallback(async (id: number) => {
    const r = await api<{ ok: boolean; error?: string }>(`/api/tracker?id=${id}`, { method: 'DELETE' });
    if (r.ok) { push(`#${id} removed from tracker`, 'ok'); load(); }
    else push(r.error || 'remove failed', 'err');
  }, [load, push]);

  const recs = records || [];
  const total = recs.length;
  const applied = recs.filter((r) => (RANK[r.status] || 0) >= 2).length;
  const interviews = recs.filter((r) => (RANK[r.status] || 0) >= 4).length;
  const offers = recs.filter((r) => r.status === 'offer').length;

  const gauges: { key: string; label: string; sub: string; val: number; pct: number; teal?: boolean }[] = [
    { key: 'total', label: 'Tracked', sub: 'in pipeline', val: total, pct: 100 },
    { key: 'applied', label: 'Applied', sub: `of ${pad2(total)} tracked`, val: applied, pct: total ? Math.round(applied / total * 100) : 0 },
    { key: 'interviews', label: 'Interviews', sub: `of ${pad2(total)} tracked`, val: interviews, pct: total ? Math.round(interviews / total * 100) : 0 },
    { key: 'offers', label: 'Offers', sub: `of ${pad2(total)} tracked`, val: offers, pct: total ? Math.round(offers / total * 100) : 0, teal: true },
  ];

  const funnelCounts = Object.fromEntries(FUNNEL.map((k) => [k, recs.filter((r) => r.status === k).length])) as Record<string, number>;
  const funnelMax = Math.max(1, ...FUNNEL.map((k) => funnelCounts[k]));

  return (
    <div className={`app pipe${booted ? ' booted' : ''}${bootDone ? ' boot-done' : ''}`}>
      <TopBar onToast={push} />

      <div className="page-scroll">
        <div className="console">
          {/* ---- head ---- */}
          <div className="head">
            <div className="reveal" style={{ '--rd': '.05s' } as CSSProperties}>
              <div className="eyebrow"><span className="ring" /> Application funnel</div>
              <h1 className="title">Pipeline</h1>
              <p className="lead">
                Your application funnel, live from the tracker. Moving a row to <b>Applied</b> asks you to confirm
                you actually submitted it. CareerOS never marks an application for you.
              </p>
            </div>
            <div className="live reveal" style={{ '--rd': '.12s' } as CSSProperties}>
              <span className="live__lamp"><i /> Live</span>
              <span className="live__src">reading data/tracker.jsonl</span>
            </div>
          </div>

          {/* ---- kpi gauges ---- */}
          <section className="gauges" aria-label="Pipeline metrics">
            {gauges.map((g, i) => (
              <article
                key={g.key}
                className={`gauge reveal${g.teal ? ' gauge--teal' : ''}`}
                style={{ '--rd': `${0.12 + i * 0.05}s` } as CSSProperties}
              >
                <div className="gauge__cap"><b />{g.label}</div>
                <div className="gauge__num">{pad2(g.val)}</div>
                <div className="meter"><div className="meter__fill" style={{ '--w': `${g.pct}%` } as CSSProperties} /></div>
                <div className="gauge__sub">{g.sub}</div>
              </article>
            ))}
          </section>

          {/* ---- signal flow ---- */}
          <section className="panel signal reveal" style={{ '--rd': '.2s' } as CSSProperties} aria-label="Signal flow">
            <span className="panel__sweep" aria-hidden />
            <div className="panel__head">
              <div className="panel__label"><span>⏻</span> Signal flow</div>
              <div className="panel__meta">current stage · <b>{funnelMax}</b> peak</div>
            </div>
            <div className="chans">
              {FUNNEL.map((k) => {
                const count = funnelCounts[k];
                const pct = Math.round(count / funnelMax * 100);
                const offer = k === 'offer';
                return (
                  <div key={k} className={`chan${offer ? ' chan--offer' : ''}${count > 0 ? ' is-on' : ''}`}>
                    <div className="chan__label">{STATUS_LABEL[k]}</div>
                    <div className="chan__track">
                      <div className="chan__fill" style={{ '--w': `${pct}%` } as CSSProperties} />
                      <div className="chan__shine" />
                    </div>
                    <div className="chan__val">{pad2(count)}</div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- ledger ---- */}
          <section className="panel ledger reveal" style={{ '--rd': '.28s' } as CSSProperties} aria-label="Applications">
            <div className="panel__head">
              <div className="panel__label"><span>▦</span> Applications</div>
              <div className="panel__meta"><b>{pad2(total)}</b> tracked</div>
            </div>
            <table className="tbl">
              {/* table-layout:fixed + colgroup → headers always sit exactly over their
                  columns (no auto-layout compression skew). Mobile (≤780px) stacks to
                  cards and ignores these widths. */}
              <colgroup>
                <col className="col-id" />
                <col className="col-date" />
                <col className="col-co" />
                <col className="col-role" />
                <col className="col-status" />
                <col className="col-act" />
              </colgroup>
              <thead>
                <tr>
                  <th>ID</th><th>Date</th><th>Company</th><th>Role</th>
                  <th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records == null ? (
                  <tr><td colSpan={6} style={{ color: 'var(--pdim)' }}>loading…</td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={6} style={{ color: 'var(--pdim)' }}>No applications yet. Evaluate or mark a role Applied from the Board to start tracking.</td></tr>
                ) : records.map((r) => {
                  return (
                    <tr key={r.id} data-id={r.id}>
                      <td className="c-id" data-label="ID">{pad2(r.id)}</td>
                      <td className="c-date" data-label="Date">{r.date}</td>
                      <td className="c-co" data-label="Company">{r.company}</td>
                      <td className="c-role" data-label="Role">{r.role}</td>
                      <td className="c-status" data-label="Status">
                        <span className={`pill pill--${r.status}`}><i />{STATUS_LABEL[r.status] || r.status}</span>
                      </td>
                      <td className="c-act" data-label="Actions">
                        <div className="act">
                          <div className="selectw">
                            <select
                              aria-label="Change status (any direction)"
                              value={r.status}
                              onChange={(e) => update(r.id, e.target.value)}
                            >
                              {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                            </select>
                          </div>
                          <button className="remove" aria-label={`Remove ${r.company} from tracker`} title="Remove" onClick={() => setRemoveConfirm(r.id)}>×</button>
                        </div>
                        {/* CV/CL as proper buttons BELOW the action controls */}
                        <DocLinks cv={r.cv_pdf} cl={r.cl_pdf} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>

      <div className="statusline">
        <span><b>{total}</b> applications tracked</span>
        <div className="statusline__right"><span>truth · data/tracker.jsonl</span></div>
      </div>

      {confirm != null && (
        <ConfirmDialog
          title="Confirm you applied"
          body={<>Mark <b>#{confirm}</b> as <b>Applied</b>? Only do this if you personally submitted the application — CareerOS will not submit anything for you.</>}
          confirmLabel="Yes, I submitted it"
          onConfirm={() => { const id = confirm; setConfirm(null); update(id, 'applied', true); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {removeConfirm != null && (
        <ConfirmDialog
          title="Remove from tracker"
          body={<>Remove <b>#{removeConfirm}</b> from your tracker? This deletes the record from <code>data/tracker.jsonl</code>. Any generated CV/CL files are left untouched.</>}
          confirmLabel="Remove"
          onConfirm={() => { const id = removeConfirm; setRemoveConfirm(null); remove(id); }}
          onCancel={() => setRemoveConfirm(null)}
        />
      )}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
