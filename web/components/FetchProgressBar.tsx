'use client';
export function FetchProgressBar({ total, done, current, onCancel }: { total: number; done: number; current: string; onCancel?: () => void }) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="fetchbar">
      <div className="fetchbar__track">
        <div className="fetchbar__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="fetchbar__label">
        {done}/{total} countries · fetching {current}…
      </span>
      {onCancel && (
        <button className="btn btn--ghost" style={{ padding: '2px 8px', fontSize: 'var(--fs-micro)' }} onClick={onCancel}>
          cancel
        </button>
      )}
    </div>
  );
}
