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

// Strip bullet markers, markdown bold, and latex-ish escapes from a JD line.
function cleanLine(s: string): string {
  return s
    .replace(/^[\s>*•·▪‣◦\-–—]+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\\([-&%$#_~.()[\]])/g, '$1') // Indeed/markdown escapes: service\-oriented, \(…\)
    .replace(/\s+/g, ' ')
    .trim();
}

// Headers that introduce the company's EXPECTATIONS of the candidate (vs. the
// "what you'll do" responsibilities, which go to `other`).
const WANT_HEAD =
  /(requirements?|qualifications?|we['’]?re looking for|what we['’]?re looking for|who you are|you (have|bring|are|will have)|you['’]ll bring|must[- ]?have|your profile|skills|essential|preferred|nice[- ]to[- ]have|what you['’]ll need|experience|competenc|ideal candidate)/i;

// Pull the expectation bullets out of a raw JD body, split into "wants" (under an
// expectations header) and "other" (responsibilities etc.). Falls back to all
// bullets when the posting isn't sectioned.
function extractExpectations(body: string): { wants: string[]; other: string[] } {
  const lines = (body || '').split('\n');
  const wants: string[] = [];
  const other: string[] = [];
  let inWant = false;
  let sawHeader = false;
  for (const raw of lines) {
    const t = raw.trim();
    const isHeader = /[:：]\s*$/.test(t) || /^#{1,6}\s/.test(raw) || /^\*\*[^*]+\*\*\s*[:：]?\s*$/.test(t);
    const isBullet = /^\s*([*•·▪‣◦\-–—]|\d+[.)])\s+/.test(raw);
    if (isHeader && t.length <= 80) { inWant = WANT_HEAD.test(t); sawHeader = true; continue; }
    if (!isBullet) continue;
    const c = cleanLine(raw);
    if (c.length < 4) continue;
    const item = c.length > 180 ? `${c.slice(0, 177)}…` : c;
    (inWant ? wants : other).push(item);
  }
  // Un-sectioned posting (no headers seen): treat every bullet as an expectation.
  if (!sawHeader && other.length && !wants.length) return { wants: other.slice(0, 10), other: [] };
  return { wants: wants.slice(0, 10), other: other.slice(0, 6) };
}

// Find a stated salary/compensation, if any (EU postings often omit it).
function extractSalary(body: string): string {
  const m = (body || '').match(
    /([€£$]\s?\d[\d.,]*\s?[kK]?(?:\s?(?:–|-|to)\s?[€£$]?\s?\d[\d.,]*\s?[kK]?)?(?:\s?(?:per|\/|a)\s?(?:year|yr|annum|month|mo|hour|hr|day))?|\b(?:EUR|USD|GBP|CHF)\s?\d[\d.,]*\s?[kK]?)/,
  );
  if (m) return cleanLine(m[0]);
  if (/\bcompetitive\b/i.test(body || '') && /\b(salary|compensation|package|remuneration|pay)\b/i.test(body || '')) {
    return 'Competitive (see posting)';
  }
  return '';
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
  const { wants, other } = extractExpectations(jd?.body || '');
  const salary = extractSalary(jd?.body || '');

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
            <div className="section__h">Skills they want · you have / gap</div>
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
            <div className="section__h">What they&rsquo;re looking for</div>
            {(row.experience || salary || row.languages) && (
              <ul className="expect expect--meta">
                {row.experience && (
                  <li><span className="expect__k">Experience</span><span>{row.experience} required</span></li>
                )}
                {salary && <li><span className="expect__k">Salary</span><span>{salary}</span></li>}
                {row.languages && <li><span className="expect__k">Languages</span><span>{row.languages}</span></li>}
              </ul>
            )}
            {jd === null && query ? (
              <div className="faint">Loading…</div>
            ) : wants.length ? (
              <ul className="expect">
                {wants.map((b, i) => (
                  <li key={`w${i}`}>{b}</li>
                ))}
              </ul>
            ) : (
              <div className="faint">
                No specific requirements captured
                {row.url ? ' — open the original posting to read it.' : '.'}
              </div>
            )}
            {other.length > 0 && (
              <details className="jd-more">
                <summary>Responsibilities ({other.length})</summary>
                <ul className="expect expect--muted">
                  {other.map((b, i) => (
                    <li key={`o${i}`}>{b}</li>
                  ))}
                </ul>
              </details>
            )}
            {jd?.body && (
              <details className="jd-more">
                <summary>Full description</summary>
                <div className="jdbody">{jd.body}</div>
              </details>
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
