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

  return (
    <div className="app">
      <TopBar />
      <div className="statusline">
        <span>
          <b>{recs.length}</b> applications tracked
        </span>
        <div className="statusline__right">
          <span>truth · data/tracker.jsonl</span>
        </div>
      </div>
      <div className="main">
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
                      <td colSpan={7} className="dim" style={{ padding: '24px 10px' }}>
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
