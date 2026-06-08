'use client';
import type { BoardRow } from '@/lib/types';
import { BandStars } from './BandStars';
import { ageLabel } from './util';

export function BoardTable({
  rows,
  today,
  selected,
  onSelect,
}: {
  rows: BoardRow[];
  today: string;
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <table className="board">
      <thead>
        <tr className="board__headrow">
          <th className="num">#</th>
          <th className="col-fit">Fit</th>
          <th className="col-match">Match</th>
          <th>Role / Company</th>
          <th className="col-exp">Exp.</th>
          <th className="col-posted">Posted</th>
          <th className="col-lang">Language</th>
          <th className="col-skills">Skills</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const fit = Number.isFinite(r.fit) ? r.fit : 0;
          const pct = Math.max(0, Math.min(100, (fit / 10) * 100));
          const have = r.have || [];
          return (
            <tr
              key={(r.url || r.jd_path || 'row') + i}
              className={`board__row ${selected === i ? 'is-sel' : ''}`}
              onClick={() => onSelect(i)}
              tabIndex={0}
              role="button"
              aria-label={`Open ${r.role || 'role'} at ${r.company || 'company'}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
            >
              <td className="cell-idx">{String(i + 1).padStart(2, '0')}</td>
              <td className="cell-fit">
                <div className="fit" title={`fit ${fit.toFixed(1)} / 10 · raw ${r.score}`}>
                  <span className="fit__num">{fit.toFixed(1)}</span>
                  <span className="fit__bar">
                    <span className={`fit__fill fit__fill--${r.band.replace(/\s+/g, '').toLowerCase()}`} style={{ width: `${pct}%` }} />
                  </span>
                </div>
              </td>
              <td className="cell-band">
                <BandStars band={r.band} />
              </td>
              <td className="cell-role">
                <div>
                  <span className="role">{r.role || '—'}</span>
                </div>
                <div>
                  <span className="company">{r.company || '—'}</span>
                  {r.source && <span className="src">{r.source}</span>}
                </div>
              </td>
              <td className="cell-exp">{r.experience || '—'}</td>
              <td className="cell-age">{ageLabel(r.posted, today)}</td>
              <td className="cell-lang" title={r.languages || ''}>{r.languages || '—'}</td>
              <td className="cell-skills">
                <div className="chips chips--clip">
                  {have.slice(0, 3).map((h, j) => (
                    <span key={`h${j}`} className="chip chip--have">
                      {h}
                    </span>
                  ))}
                  {have.length > 3 && <span className="chip chip--more">+{have.length - 3}</span>}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
