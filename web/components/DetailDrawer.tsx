'use client';
import { useEffect, useState } from 'react';
import type { BoardRow, JdDetail } from '@/lib/types';
import { BandStars } from './BandStars';
import { ageLabel, api } from './util';
import { IconClose, IconExternal, IconBolt, IconDoc } from './Icons';

function shorten(u: string): string {
  try {
    const x = new URL(u);
    return x.hostname + (x.pathname.length > 1 ? x.pathname.slice(0, 30) : '');
  } catch {
    return u.slice(0, 44);
  }
}

export function DetailDrawer({
  row,
  today,
  onClose,
  onEnqueue,
}: {
  row: BoardRow;
  today: string;
  onClose: () => void;
  onEnqueue: (kind: string, args: Record<string, unknown>) => void;
}) {
  const [jd, setJd] = useState<JdDetail | null>(null);

  // Resolve the saved posting by jd_path; fall back to URL lookup for rows that
  // were fetched live (no saved file yet) so the description still shows.
  const query = row.jd_path
    ? `path=${encodeURIComponent(row.jd_path)}`
    : row.url
      ? `url=${encodeURIComponent(row.url)}`
      : '';

  useEffect(() => {
    let live = true;
    setJd(null);
    if (query) {
      api<JdDetail>(`/api/jd?${query}`).then((d) => {
        if (live) setJd(d);
      });
    }
    return () => {
      live = false;
    };
  }, [query]);

  const args = { url: row.url, jd_path: row.jd_path, company: row.company, role: row.role };

  return (
    <div className="drawer">
      <div className="drawer__scrim" onClick={onClose} />
      <div className="drawer__panel">
        <div className="drawer__head">
          <button className="drawer__close" onClick={onClose} aria-label="close">
            <IconClose size={16} />
          </button>
          <div className="drawer__eyebrow">
            <BandStars band={row.band} />
            <span title={`raw score ${row.score}`}>fit {Number.isFinite(row.fit) ? row.fit.toFixed(1) : '—'}/10</span>
            <span className="sep">·</span>
            <span>{ageLabel(row.posted, today)}</span>
          </div>
          <div className="drawer__title">{row.role || '—'}</div>
          <div className="drawer__sub">
            {row.company || '—'}
            {row.source ? `  ·  ${row.source}` : ''}
          </div>
        </div>

        <div className="drawer__body">
          <div className="section">
            <div className="section__h">Match · has / gap</div>
            <div className="chips">
              {(row.have || []).map((h, i) => (
                <span key={`h${i}`} className="chip chip--have">
                  {h}
                </span>
              ))}
              {(row.gap || []).map((g, i) => (
                <span key={`g${i}`} className="chip chip--gap">
                  {g}
                </span>
              ))}
              {(row.have || []).length === 0 && (row.gap || []).length === 0 && (
                <span className="faint">no keyword data</span>
              )}
            </div>
            {(row.stack_mismatch || (row.exp_note && row.exp_note !== 'unverified')) && (
              <div className="faint" style={{ marginTop: 6, fontSize: '0.85em' }}>
                {row.stack_mismatch ? `⚠ stack mismatch: this role centres on ${row.stack_mismatch}, not your primary stack. ` : ''}
                {row.exp_note && row.exp_note !== 'unverified' ? `experience: ${row.exp_note}.` : ''}
              </div>
            )}
          </div>

          <div className="section">
            <div className="section__h">Posting</div>
            <dl className="kv">
              <dt>URL</dt>
              <dd>
                {row.url ? (
                  <a href={row.url} target="_blank" rel="noreferrer" style={{ color: 'var(--signal)' }}>
                    {shorten(row.url)}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
              {jd?.location && (
                <>
                  <dt>Location</dt>
                  <dd>{jd.location}</dd>
                </>
              )}
              <dt>Posted</dt>
              <dd>{row.posted || 'date n/a'}</dd>
              {row.experience && (
                <>
                  <dt>Experience</dt>
                  <dd>{row.experience} required</dd>
                </>
              )}
              {row.languages && (
                <>
                  <dt>Language</dt>
                  <dd>{row.languages}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="section">
            <div className="section__h">Job description</div>
            {jd === null && query ? (
              <div className="faint">Loading…</div>
            ) : jd?.body ? (
              <div className="jdbody">{jd.body}</div>
            ) : (
              <div className="faint">
                No description captured for this posting
                {row.url ? ' — open the original posting to read it.' : '.'}
              </div>
            )}
          </div>
        </div>

        <div className="drawer__actions">
          <button className="btn btn--primary" onClick={() => onEnqueue('evaluate', args)}>
            <IconBolt /> evaluate
          </button>
          <button className="btn" onClick={() => onEnqueue('build-cv', args)}>
            <IconDoc /> build cv
          </button>
          <button className="btn" onClick={() => onEnqueue('build-cl', args)}>
            <IconDoc /> build cl
          </button>
          <button className="btn" onClick={() => onEnqueue('apply', args)}>
            apply
          </button>
          <div style={{ flex: 1 }} />
          {row.url && (
            <button className="btn btn--ghost" onClick={() => window.open(row.url, '_blank', 'noreferrer')}>
              <IconExternal /> open posting
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
