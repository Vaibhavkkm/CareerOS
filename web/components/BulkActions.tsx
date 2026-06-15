'use client';
import { useCallback, useRef, useState } from 'react';
import type { BoardRow } from '@/lib/types';
import { IS_PUBLIC, openForkGate } from '@/lib/public';
import { api } from './util';

type BulkKind = 'evaluate' | 'build-cv' | 'build-cl';

interface Props {
  rows: BoardRow[];
  /** Only queue rows at or above this band — '' means all visible rows */
  minBand?: string;
}

const BAND_RANK: Record<string, number> = {
  strongest: 5, verystrong: 4, strong: 3, moderate: 2, weak: 1,
};
function bandRank(b: string) { return BAND_RANK[b.toLowerCase().replace(/[^a-z]/g, '')] ?? 0; }

export function BulkActions({ rows, minBand = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const eligible = minBand
    ? rows.filter((r) => bandRank(r.band) >= bandRank(minBand))
    : rows;

  const queueAll = useCallback(async (kind: BulkKind, subset: BoardRow[]) => {
    if (IS_PUBLIC) { openForkGate(); return; }
    if (!subset.length) { setStatus('No matching rows'); return; }
    setBusy(true);
    setOpen(false);
    setStatus(`Queuing ${kind} for ${subset.length} jobs…`);
    let ok = 0, fail = 0;
    for (const row of subset) {
      const args = { url: row.url, jd_path: row.jd_path, company: row.company, role: row.role };
      const r = await api<{ ok: boolean }>('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ kind, args }),
      });
      if (r?.ok) ok++; else fail++;
    }
    setBusy(false);
    setStatus(`${ok} queued${fail ? ` · ${fail} failed` : ''} — daemon will process`);
    setTimeout(() => setStatus(null), 5000);
  }, []);

  if (!rows.length) return null;

  const visibleRows = rows.filter((r) => r.jd_path || r.url);
  const strongestRows = visibleRows.filter((r) => bandRank(r.band) >= bandRank('strongest'));
  const veryStrongRows = visibleRows.filter((r) => bandRank(r.band) >= bandRank('verystrong'));

  return (
    <div className="bulkbar">
      <span className="bulkbar__label">{visibleRows.length} jobs shown</span>

      <div style={{ position: 'relative' }} ref={menuRef}>
        <button
          className="btn btn--ghost"
          onClick={() => setOpen((o) => !o)}
          disabled={busy}
          title="Queue CV / CL / Evaluate for multiple jobs at once"
        >
          Bulk build ▾
        </button>

        {open && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onMouseDown={() => setOpen(false)} />
            <div className="bulkmenu">
              <div className="bulkmenu__head">Build for all visible</div>
              <button className="bulkmenu__item" onClick={() => queueAll('build-cv', visibleRows)}>
                Build CV — all {visibleRows.length} jobs
              </button>
              <button className="bulkmenu__item" onClick={() => queueAll('build-cl', visibleRows)}>
                Build Cover Letter — all {visibleRows.length} jobs
              </button>
              <button className="bulkmenu__item" onClick={() => queueAll('evaluate', visibleRows)}>
                Evaluate — all {visibleRows.length} jobs
              </button>

              {veryStrongRows.length > 0 && veryStrongRows.length < visibleRows.length && (
                <>
                  <div className="bulkmenu__divider" />
                  <div className="bulkmenu__head">Very strong+ only ({veryStrongRows.length})</div>
                  <button className="bulkmenu__item" onClick={() => queueAll('build-cv', veryStrongRows)}>
                    Build CV — very strong+
                  </button>
                  <button className="bulkmenu__item" onClick={() => queueAll('build-cl', veryStrongRows)}>
                    Build Cover Letter — very strong+
                  </button>
                  <button className="bulkmenu__item" onClick={() => queueAll('evaluate', veryStrongRows)}>
                    Evaluate — very strong+
                  </button>
                </>
              )}

              {strongestRows.length > 0 && strongestRows.length < veryStrongRows.length && (
                <>
                  <div className="bulkmenu__divider" />
                  <div className="bulkmenu__head">Strongest only ({strongestRows.length})</div>
                  <button className="bulkmenu__item" onClick={() => queueAll('build-cv', strongestRows)}>
                    Build CV — strongest
                  </button>
                  <button className="bulkmenu__item" onClick={() => queueAll('build-cl', strongestRows)}>
                    Build Cover Letter — strongest
                  </button>
                  <button className="bulkmenu__item" onClick={() => queueAll('evaluate', strongestRows)}>
                    Evaluate — strongest
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {status && <span className="bulkbar__status">{status}</span>}
    </div>
  );
}
