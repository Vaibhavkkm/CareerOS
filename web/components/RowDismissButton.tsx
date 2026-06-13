'use client';
import { useState } from 'react';
import { api } from './util';

export function RowDismissButton({ url, jdPath, onDismiss }: { url: string; jdPath?: string; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const dismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    await api('/api/inbox', { method: 'DELETE', body: JSON.stringify({ url, jd_path: jdPath }) });
    setBusy(false);
    onDismiss();
  };
  return (
    <button
      className="row-dismiss"
      onClick={dismiss}
      disabled={busy}
      aria-label="Dismiss — not interested"
      title="Not interested — remove from board"
    >
      ×
    </button>
  );
}
