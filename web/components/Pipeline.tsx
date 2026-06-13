'use client';
import type { TrackerRecord } from '@/lib/types';

const ORDER: { id: string; label: string; won?: boolean; lost?: boolean }[] = [
  { id: 'evaluated', label: 'Evaluated' },
  { id: 'applied', label: 'Applied' },
  { id: 'responded', label: 'Responded' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer', won: true },
  { id: 'rejected', label: 'Rejected', lost: true },
  { id: 'discarded', label: 'Discarded', lost: true },
];

function Stat({ n, k }: { n: number; k: string }) {
  return (
    <div className="stat">
      <div className="stat__n">{n}</div>
      <div className="stat__k">{k}</div>
    </div>
  );
}

export function Pipeline({ records }: { records: TrackerRecord[] }) {
  const counts: Record<string, number> = {};
  for (const r of records) counts[r.status] = (counts[r.status] || 0) + 1;
  const topOfFunnel = Math.max(1, counts.evaluated || 0, ...ORDER.map((o) => counts[o.id] || 0));

  const total = records.length;
  const applied = (counts.applied || 0) + (counts.responded || 0) + (counts.interview || 0) + (counts.offer || 0);
  const interviews = (counts.interview || 0) + (counts.offer || 0);
  const offers = counts.offer || 0;

  return (
    <>
      <div className="stat-grid">
        <Stat n={total} k="tracked" />
        <Stat n={applied} k="applied" />
        <Stat n={interviews} k="interviews" />
        <Stat n={offers} k="offers" />
      </div>
      <div className="funnel">
        {ORDER.map((o) => {
          const n = counts[o.id] || 0;
          const pct = topOfFunnel > 0 && n > 0 ? Math.round((n / topOfFunnel) * 100) : 0;
          return (
            <div className="funnel__row" key={o.id}>
              <span className={`funnel__label ${o.lost ? 'is-lost' : ''}`}>{o.label}</span>
              <div className="funnel__bar">
                <div
                  className={`funnel__fill ${o.won ? 'is-won' : ''} ${o.lost ? 'is-lost' : ''}`}
                  style={{ width: `${Math.round((n / topOfFunnel) * 100)}%` }}
                />
              </div>
              <span className={`funnel__n ${o.lost ? 'is-lost' : ''}`}>{n}</span>
              <span className="funnel__pct">{pct > 0 ? `${pct}%` : ''}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
