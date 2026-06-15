'use client';
import { useCallback, useEffect, useState } from 'react';
import type { TrackerRecord } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { Pipeline } from '@/components/Pipeline';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Toaster, useToasts } from '@/components/Toast';
import { api } from '@/components/util';

const NEXT_STATUS: Record<string, string> = {
  evaluated: 'applied',
  applied: 'responded',
  responded: 'interview',
  interview: 'offer',
};
const STATUS_LABEL: Record<string, string> = {
  evaluated: 'Evaluated',
  applied: 'Applied',
  responded: 'Responded',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  discarded: 'Discarded',
  skip: 'Skip',
};

function statusPill(s: string): string {
  if (s === 'offer') return 'pill--done';
  if (s === 'rejected' || s === 'discarded' || s === 'skip') return 'pill--failed';
  if (s === 'applied' || s === 'responded' || s === 'interview') return 'pill--claimed';
  return 'pill--queued';
}

function DocLinks({ cv, cl }: { cv?: string; cl?: string }) {
  const items: [string, string][] = [];
  if (cv && cv.toLowerCase().endsWith('.pdf')) items.push(['CV', cv]);
  if (cl && cl.toLowerCase().endsWith('.pdf')) items.push(['CL', cl]);
  if (items.length === 0) return <span className="dim">—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 10 }}>
      {items.map(([label, path]) => (
        <a
          key={label}
          href={`/api/pdf?path=${encodeURIComponent(path)}`}
          target="_blank"
          rel="noopener noreferrer"
          title={path}
          style={{ color: 'var(--signal)', textDecoration: 'underline' }}
        >
          {label} ↗
        </a>
      ))}
    </span>
  );
}

export default function PipelinePage() {
  const [records, setRecords] = useState<TrackerRecord[] | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    const r = await api<{ ok: boolean; records?: TrackerRecord[]; error?: string }>('/api/tracker');
    if (r.ok && Array.isArray(r.records)) setRecords(r.records);
    else {
      push(r.error || 'could not read tracker', 'err');
      setRecords([]);
    }
  }, [push]);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    async (id: number, status: string, confirmApplied = false) => {
      const r = await api<{ ok: boolean; error?: string }>('/api/tracker', {
        method: 'POST',
        body: JSON.stringify({ id, status, confirmApplied }),
      });
      if (r.ok) {
        push(`#${id} → ${STATUS_LABEL[status] || status}`, 'ok');
        load();
      } else if (r.error === 'needs_confirm') {
        setConfirm(id);
      } else {
        push(r.error || 'update failed', 'err');
      }
    },
    [load, push],
  );

  const recs = records || [];

  // Step 10: stat bar values for Pipeline
  const applied = recs.filter((r) => ['applied', 'responded', 'interview', 'offer'].includes(r.status)).length;
  const interviews = recs.filter((r) => ['interview', 'offer'].includes(r.status)).length;
  const offers = recs.filter((r) => r.status === 'offer').length;

  return (
    // Step 10: same 5-row shell
    <div className="app">
      {/* Row 1: top bar */}
      <TopBar onToast={push} />

      {/* Row 2: stat bar — Pipeline: tracked / applied / interviews / offers */}
      <div className="statbar">
        <div className="statbar__stat">
          <span className="statbar__num">{recs.length}</span>
          <span className="statbar__label">tracked</span>
        </div>
        <div className="statbar__sep" />
        <div className="statbar__stat">
          <span className="statbar__num">{applied}</span>
          <span className="statbar__label">applied</span>
        </div>
        <div className="statbar__sep" />
        <div className="statbar__stat">
          <span className="statbar__num">{interviews}</span>
          <span className="statbar__label">interviews</span>
        </div>
        <div className="statbar__sep" />
        <div className="statbar__stat">
          <span className="statbar__num">{offers}</span>
          <span className="statbar__label">offers</span>
        </div>
        <div className="statbar__right">
          <span className="live">
            <span className="live__dot" />
            live
          </span>
        </div>
      </div>

      {/* Row 3: empty filter bar */}
      <div style={{ height: 0, borderBottom: '1px solid var(--hair)', background: 'var(--bg)' }} />

      {/* Row 4: scrollable content */}
      <div className="page-scroll">
        <div className="page">
          <div className="page__h">Pipeline</div>
          <div className="page__lead">
            Your application funnel, live from the tracker. Advancing a row to <b>Applied</b> asks you to confirm
            you actually submitted it — CareerOS never marks an application for you.
          </div>
          {!records ? (
            <div className="placeholder">loading…</div>
          ) : (
            <>
              <Pipeline records={records} />
              <table className="ttable">
                <thead>
                  <tr>
                    <th className="num">ID</th>
                    <th>Date</th>
                    <th>Company</th>
                    <th>Role</th>
                    <th className="num">Score</th>
                    <th>Status</th>
                    <th>Docs</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="num dim">{r.id}</td>
                      <td className="dim">{r.date}</td>
                      <td>{r.company}</td>
                      <td className="dim">{r.role}</td>
                      <td className="num">{Number.isFinite(Number(r.score)) ? Number(r.score).toFixed(1) : '—'}</td>
                      <td>
                        <span className={`pill ${statusPill(r.status)}`}>{STATUS_LABEL[r.status] || r.status}</span>
                      </td>
                      <td>
                        <DocLinks cv={r.cv_pdf} cl={r.cl_pdf} />
                      </td>
                      <td className="num">
                        {NEXT_STATUS[r.status] && (
                          <button className="btn btn--ghost" onClick={() => update(r.id, NEXT_STATUS[r.status])}>
                            → {STATUS_LABEL[NEXT_STATUS[r.status]]}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={8} className="dim" style={{ padding: '24px 10px' }}>
                        No applications yet. Evaluate a role from the Board to start tracking.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {/* Row 5: bottom status line */}
      <div className="statusline">
        <span><b>{recs.length}</b> applications tracked</span>
        <div className="statusline__right">
          <span>truth · data/tracker.jsonl</span>
        </div>
      </div>

      {confirm != null && (
        <ConfirmDialog
          title="Confirm you applied"
          body={
            <>
              Mark <b>#{confirm}</b> as <b>Applied</b>? Only do this if you personally submitted the application —
              CareerOS will not submit anything for you.
            </>
          }
          confirmLabel="Yes, I submitted it"
          onConfirm={() => {
            const id = confirm;
            setConfirm(null);
            update(id, 'applied', true);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
