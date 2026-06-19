'use client';
import { useCallback, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { api } from './util';
import type { ToastKind } from './Toast';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

// The minimal shape needed to log an application: a board row, a saved job, etc.
export interface AppliedTarget {
  company?: string;
  role?: string;
  url?: string;
}

type Push = (msg: string, kind?: ToastKind) => void;

// Shared "✓ I applied" flow used by BOTH the Board and the Saved view (and anywhere
// else a job can be marked applied). Owns the Class-A confirm gate and the toast so
// the two surfaces can never drift apart. POSTs the create-or-advance shape to
// /api/tracker (no id → tracker.mjs `add` upserts: creates a new record or advances
// an already-tracked opening). CareerOS never marks an application for you — hence
// the confirm.
export function useMarkApplied(push: Push): {
  markApplied: (job: AppliedTarget) => void;
  dialog: ReactNode;
} {
  const [target, setTarget] = useState<AppliedTarget | null>(null);

  const markApplied = useCallback((job: AppliedTarget) => {
    if (IS_PUBLIC) { openForkGate(); return; }
    setTarget(job);
  }, []);

  const confirmApplied = useCallback(async (job: AppliedTarget) => {
    const r = await api<{ ok: boolean; action?: string; record?: { id?: number }; error?: string }>(
      '/api/tracker',
      {
        method: 'POST',
        body: JSON.stringify({
          company: job.company,
          role: job.role,
          url: job.url,
          status: 'applied',
          confirmApplied: true,
        }),
      },
    );
    if (r.ok) {
      // `add` is an upsert — report what actually happened, not always "added".
      const id = r.record?.id ? ` (#${r.record.id})` : '';
      const msg =
        r.action === 'added' ? `added to your pipeline as Applied${id}`
        : r.action === 'skipped' ? `already in your pipeline${id} — no change`
        : `marked Applied in your pipeline${id}`; // 'updated'/other → status advanced
      push(msg, r.action === 'skipped' ? 'info' : 'ok');
    } else {
      push(r.error || 'could not mark applied', 'err');
    }
  }, [push]);

  const dialog: ReactNode = target ? (
    <ConfirmDialog
      title="Confirm you applied"
      body={
        <>
          Mark <b>{target.role || 'this role'}</b>
          {target.company ? <> at <b>{target.company}</b></> : null} as <b>Applied</b> in your Pipeline? Only do
          this if you personally submitted the application — CareerOS will not submit anything for you.
        </>
      }
      confirmLabel="Yes, I submitted it"
      onConfirm={() => { const j = target; setTarget(null); confirmApplied(j); }}
      onCancel={() => setTarget(null)}
    />
  ) : null;

  return { markApplied, dialog };
}
