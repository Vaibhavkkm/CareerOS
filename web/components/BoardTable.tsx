'use client';
import type { BoardRow } from '@/lib/types';
import { BandStars } from './BandStars';
import { ageLabel, ageDays } from './util';

// Step 2: fit color ramp — <7 raised from #8A7140 to #C9A86A (AA on surface-2)
function fitColor(fit: number): { color: string; glow: string } {
  if (fit >= 9) return { color: '#FFCB6B', glow: 'rgba(255,203,107,0.45)' };
  if (fit >= 8) return { color: '#F2B33D', glow: 'rgba(242,179,61,0.4)' };
  if (fit >= 7) return { color: '#C9923A', glow: 'rgba(201,146,58,0.35)' };
  return { color: '#C9A86A', glow: 'rgba(201,168,106,0.3)' }; // was #8A7140 — bumped for AA
}

// Step 8: snap fill pct to segment boundaries so meter doesn't flicker mid-segment.
// .sig row meter: 121px wide, 11px per seg = 11 segments.
const ROW_SEG_COUNT = 11;
function snapPct(fit: number, segCount = ROW_SEG_COUNT): number {
  const raw = Math.max(0, Math.min(10, fit)) * 10; // 0-100
  const snapped = Math.round((raw / 100) * segCount) / segCount * 100;
  return Math.round(snapped * 10) / 10;
}

export function BoardTable({
  rows,
  today,
  selected,
  onSelect,
  showCountry = false,
  entered = false,
}: {
  rows: BoardRow[];
  today: string;
  selected: number;
  onSelect: (i: number) => void;
  showCountry?: boolean;
  /** Step 1: true after first load — gates stagger to first paint only */
  entered?: boolean;
}) {
  return (
    // Step 1: add board--static once entered to cancel the stagger replay
    <table className={`board${entered ? ' board--static' : ''}`}>
      <thead>
        <tr className="board__headrow">
          <th className="num">#</th>
          {/* Step 8: reference rhythm — Fit/Signal, Role/Company, Skills */}
          <th className="col-fit">Fit / Signal</th>
          <th className="col-match">Match</th>
          <th className="col-role">Role / Company</th>
          {showCountry && <th className="col-country">Country</th>}
          <th className="col-exp">Exp.</th>
          <th className="col-posted">Posted</th>
          <th className="col-lang">Language</th>
          <th className="col-skills">Skills</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const fit = Number.isFinite(r.fit) ? r.fit : 0;
          // Step 8: snap to segment boundaries
          const pct = snapPct(fit);
          const { color, glow } = fitColor(fit);
          const have = r.have || [];
          const days = ageDays(r.posted, today);
          const isFresh = days !== null && days <= 3;
          // Step 1: stable key — url or jd_path WITHOUT index suffix when available
          const stableKey = r.url || r.jd_path || `row-${i}`;
          return (
            <tr
              key={stableKey}
              className={`board__row ${selected === i ? 'is-sel' : ''} ${r.pinned ? 'is-pinned' : ''}`}
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
              {/* Step 8: cell-fit overflow:hidden in CSS, sig is 100% of cell */}
              <td className="cell-fit">
                <div
                  className="fit"
                  title={`fit ${fit.toFixed(1)} / 10 · raw ${r.score}`}
                  style={{ '--fit-color': color, '--fit-glow': glow } as React.CSSProperties}
                >
                  <span className="fit__num">{fit.toFixed(1)}</span>
                  <span
                    className="sig"
                    style={{ '--fit-color': color, '--fit-glow': glow } as React.CSSProperties}
                    aria-hidden
                  >
                    <span className="sig-fill" style={{ '--fit-pct': `${pct}%` } as React.CSSProperties} />
                  </span>
                </div>
              </td>
              {/* Match/BandStars — folds below 1100px */}
              <td className="cell-band">
                <BandStars band={r.band} />
              </td>
              <td className="cell-role">
                <div>
                  {r.pinned && <span className="pin-badge">JUST&nbsp;ADDED</span>}
                  {isFresh && <span className="fresh-dot" title="posted ≤ 3 days ago" />}
                  <span className="role">{r.role || '—'}</span>
                </div>
                <div>
                  <span className="company">{r.company || '—'}</span>
                  {r.source && <span className="src">{r.source}</span>}
                </div>
                {/* Step 8: inline meta visible <1100px where secondary cols are hidden */}
                <div className="row-meta" aria-hidden>
                  {r.band && <span>{r.band}</span>}
                  {r.experience && <><span>·</span><span>{r.experience}</span></>}
                  {ageLabel(r.posted, today) !== '—' && <><span>·</span><span>{ageLabel(r.posted, today)}</span></>}
                </div>
              </td>
              {showCountry && <td className="cell-country">{r.country || '—'}</td>}
              <td className="cell-exp">{r.experience || '—'}</td>
              <td className="cell-age">{ageLabel(r.posted, today)}</td>
              <td className="cell-lang" title={r.languages || ''}>{r.languages || '—'}</td>
              <td className="cell-skills">
                <div className="chips chips--clip">
                  <span className="chips__row">
                    {have.slice(0, 3).map((h, j) => (
                      <span key={`h${j}`} className="chip chip--have">
                        {h}
                      </span>
                    ))}
                  </span>
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
