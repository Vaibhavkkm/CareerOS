'use client';
import { useEffect, useRef, useState } from 'react';
import type { BoardRow, JdDetail } from '@/lib/types';
import { BandStars } from './BandStars';
import { ageLabel, ageDays, api } from './util';
import { IconClose, IconExternal, IconBolt, IconDoc } from './Icons';

function shorten(u: string): string {
  try {
    const x = new URL(u);
    return x.hostname + (x.pathname.length > 1 ? x.pathname.slice(0, 30) : '');
  } catch {
    return u.slice(0, 44);
  }
}

function cleanLine(s: string): string {
  return s
    .replace(/^[\s>*•·▪‣◦\-–—]+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\\([-&%$#_~.()[\]])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const WANT_HEAD =
  /(requirements?|qualifications?|we['']?re looking for|what we['']?re looking for|who you are|you (have|bring|are|will have)|you['']ll bring|must[- ]?have|your profile|skills|essential|preferred|nice[- ]to[- ]have|what you['']ll need|experience|competenc|ideal candidate)/i;

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
  if (!sawHeader && other.length && !wants.length) return { wants: other.slice(0, 10), other: [] };
  return { wants: wants.slice(0, 10), other: other.slice(0, 6) };
}

function extractSalary(body: string): string {
  const text = body || '';
  const MONEY =
    /([€£$]\s?\d[\d.,]*\s?[kK]?(?:\s?(?:–|-|to)\s?[€£$]?\s?\d[\d.,]*\s?[kK]?)?(?:\s?(?:per|\/|a)\s?(?:year|yr|annum|month|mo|hour|hr|day))?|\b(?:EUR|USD|GBP|CHF)\s?\d[\d.,]*\s?[kK]?)/g;
  const SCALE = /^\s*(?:bn|billion|million|mn|trillion|m\b)/i;
  const REVENUE =
    /\b(?:in sales|sales|revenue|turnover|valuation|funding|raised|market\s*cap|customers|users|employees|arr|mrr|profit|assets under management|aum|budget|contract worth|deal)\b/i;
  const SALARY_CTX =
    /\b(?:salary|salaries|compensation|remuneration|package|base pay|gross|net|RAL|per\s*(?:year|annum|month|hour)|\/\s*(?:yr|year|hr|hour|month)|annual\s*(?:salary|pay)|stipend|wage)\b/i;
  const SELF_PAY = /[kK]\b|(?:per|\/|a)\s?(?:year|yr|annum|month|mo|hour|hr|day)/i;
  let m: RegExpExecArray | null;
  while ((m = MONEY.exec(text))) {
    const match = m[0];
    const end = m.index + match.length;
    const after = text.slice(end, end + 24);
    const around = text.slice(Math.max(0, m.index - 40), end + 40);
    if (SCALE.test(after) || REVENUE.test(around)) continue;
    if (SELF_PAY.test(match) || SALARY_CTX.test(around)) return cleanLine(match);
  }
  if (/\bcompetitive\b/i.test(text) && /\b(salary|compensation|package|remuneration|pay)\b/i.test(text)) {
    return 'Competitive (see posting)';
  }
  return '';
}

// Step 2: fit color ramp — <7 raised to #C9A86A (AA on surface-2)
function fitColor(fit: number): { color: string; glow: string } {
  if (fit >= 9) return { color: '#FFCB6B', glow: 'rgba(255,203,107,0.5)' };
  if (fit >= 8) return { color: '#F2B33D', glow: 'rgba(242,179,61,0.45)' };
  if (fit >= 7) return { color: '#C9923A', glow: 'rgba(201,146,58,0.38)' };
  return { color: '#C9A86A', glow: 'rgba(201,168,106,0.3)' }; // was #8A7140 — bumped for AA
}

// Step 8: snap big meter (208px, 13 segs × 16px)
const BIG_SEG_COUNT = 13;
function snapPct(fit: number, segCount = BIG_SEG_COUNT): number {
  const raw = Math.max(0, Math.min(10, fit)) * 10;
  const snapped = Math.round((raw / 100) * segCount) / segCount * 100;
  return Math.round(snapped * 10) / 10;
}

// Breakdown meters — REAL fields only. Step 10: meters use signal-dim (CSS handles color).
function breakdownMeters(
  row: BoardRow,
  today: string,
): Array<{ label: string; pct: number; note: string }> {
  const have = (row.have || []).length;
  const gap = (row.gap || []).length;
  const total = have + gap;
  const skillsPct = total > 0 ? Math.round((have / total) * 100) : 0;

  const days = ageDays(row.posted, today);
  const recencyPct = days !== null ? Math.max(0, Math.round(((90 - Math.min(90, days)) / 90) * 100)) : 0;
  const recencyNote = days !== null ? (days === 0 ? 'today' : `${days}d ago`) : 'n/a';

  const meters: Array<{ label: string; pct: number; note: string }> = [
    { label: 'Skills match', pct: skillsPct, note: `${have}/${total}` },
    { label: 'Recency', pct: recencyPct, note: recencyNote },
  ];

  if (row.experience) {
    meters.push({ label: 'Experience', pct: row.exp_note && row.exp_note !== 'unverified' ? 50 : 75, note: row.experience });
  }
  if (row.stack_mismatch) {
    meters.push({ label: 'Stack fit', pct: 20, note: `mismatch: ${row.stack_mismatch}` });
  }

  return meters;
}

// Generated documents (CV/CL PDF, eval report, raw LaTeX) for this job, shown inline.
// Sources /api/docs (daemon manifest + tracker). Renders nothing until a doc exists,
// so drawers for jobs you haven't built yet are unchanged.
type Doc = { type: 'cv' | 'cl' | 'report' | 'tex'; path: string; name: string };
const docLabel = (t: Doc['type']) =>
  t === 'cv' ? 'CV' : t === 'cl' ? 'Cover letter' : t === 'report' ? 'Report' : 'LaTeX';

function DocumentsSection({ jdPath, url }: { jdPath?: string; url?: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sel, setSel] = useState('');
  const [text, setText] = useState('');
  const [loadingText, setLoadingText] = useState(false);

  const query = jdPath
    ? `jd_path=${encodeURIComponent(jdPath)}`
    : url
      ? `url=${encodeURIComponent(url)}`
      : '';

  useEffect(() => {
    let live = true;
    setDocs([]);
    setSel('');
    if (!query) return;
    api<{ ok: boolean; docs: Doc[] }>(`/api/docs?${query}`).then((d) => {
      if (!live) return;
      const list = d?.docs || [];
      setDocs(list);
      if (list.length) setSel(list[0].path);
    });
    return () => { live = false; };
  }, [query]);

  const current = docs.find((d) => d.path === sel);
  const isPdf = !!current && (current.type === 'cv' || current.type === 'cl');
  const href = current
    ? `${isPdf ? '/api/pdf' : '/api/render'}?path=${encodeURIComponent(current.path)}`
    : '';

  // Load raw text for report/tex (PDFs render in the iframe).
  useEffect(() => {
    let live = true;
    setText('');
    if (!current || isPdf) return;
    setLoadingText(true);
    fetch(`/api/render?path=${encodeURIComponent(current.path)}`)
      .then((r) => (r.ok ? r.text() : '(could not load this file)'))
      .then((t) => { if (live) { setText(t); setLoadingText(false); } })
      .catch(() => { if (live) { setText('(could not load this file)'); setLoadingText(false); } });
    return () => { live = false; };
  }, [current?.path, isPdf]);

  if (!docs.length) return null;

  const frameStyle: React.CSSProperties = {
    width: '100%', height: 460,
    border: '1px solid var(--hairline)', borderRadius: 'var(--r-control, 6px)',
    background: 'var(--bg-raised)',
  };

  return (
    <div className="section">
      <div className="section__h">Documents</div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {docs.map((d) => (
          <button
            key={d.path}
            className={`chip ${d.path === sel ? 'chip--have' : ''}`}
            onClick={() => setSel(d.path)}
            title={d.name}
            style={{ cursor: 'pointer', border: 'none' }}
          >
            {docLabel(d.type)}
          </button>
        ))}
      </div>
      {current && (
        <>
          {isPdf ? (
            <iframe src={href} title={current.name} style={frameStyle} />
          ) : (
            <pre
              className="jdbody"
              style={{
                ...frameStyle, height: 'auto', maxHeight: 460, overflow: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: 12, margin: 0, fontSize: 12,
              }}
            >
              {loadingText ? 'Loading…' : text}
            </pre>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
            <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)', fontSize: 12 }}>
              Open {docLabel(current.type)} in new tab ↗
            </a>
            <span className="faint" style={{ fontSize: 11 }}>{current.name}</span>
          </div>
        </>
      )}
    </div>
  );
}

// The content of the detail panel — shared between inline desktop and mobile slide-over
function DrawerContent({
  row,
  today,
  onClose,
  onEnqueue,
  saved,
  savedCount,
  onToggleSave,
  closeBtnRef,
}: {
  row: BoardRow;
  today: string;
  onClose: () => void;
  onEnqueue: (kind: string, args: Record<string, unknown>) => void;
  saved: boolean;
  savedCount: number;
  onToggleSave?: () => void;
  closeBtnRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const [jd, setJd] = useState<JdDetail | null>(null);

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
    return () => { live = false; };
  }, [query]);

  const args = { url: row.url, jd_path: row.jd_path, company: row.company, role: row.role };
  const { wants, other } = extractExpectations(jd?.body || '');
  const salary = extractSalary(jd?.body || '');

  const fit = Number.isFinite(row.fit) ? row.fit : 0;
  const pct = snapPct(fit);
  const { color: fitCol, glow: fitGlow } = fitColor(fit);
  const meters = breakdownMeters(row, today);

  const cssVars = { '--fit-color': fitCol, '--fit-glow': fitGlow } as React.CSSProperties;

  return (
    <div className="drawer__panel-content">
      <div className="drawer__head">
        <button
          className="drawer__close"
          onClick={onClose}
          aria-label="close"
          ref={closeBtnRef as React.RefObject<HTMLButtonElement>}
        >
          <IconClose size={16} />
        </button>

        {/* Big fit hero */}
        <div className="drawer__fit-hero" style={cssVars}>
          <span className="drawer__fit-num">{fit.toFixed(1)}</span>
          <span className="drawer__fit-denom">/10</span>
          <div className="drawer__fit-meta">
            <BandStars band={row.band} />
            {/* Step 6: sig--big has role=img + aria-label; board meter stays aria-hidden */}
            <span
              className="sig sig--big"
              style={cssVars}
              role="img"
              aria-label={`Signal meter: ${pct}% (fit ${fit.toFixed(1)} / 10)`}
            >
              <span className="sig-fill" style={{ '--fit-pct': `${pct}%` } as React.CSSProperties} />
            </span>
          </div>
        </div>

        <div className="drawer__eyebrow">
          <span title={`raw score ${row.score}`}>signal {fit.toFixed(1)} / 10</span>
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
        {/* Generated CV/CL/report/LaTeX for this job — appears once you've built one */}
        <DocumentsSection jdPath={row.jd_path} url={row.url} />

        {/* Signal breakdown — REAL fields only. Meters use --signal-dim (neutral) per Step 10 */}
        <div className="section">
          <div className="section__h">Signal breakdown</div>
          <div className="breakdown">
            {meters.map((m) => (
              <div key={m.label} className="breakdown__row">
                <span className="breakdown__label">{m.label}</span>
                {/* Step 10: breakdown meters don't get --fit-color; CSS .breakdown .sig-fill uses --signal-dim */}
                <span
                  className="sig sig--sm"
                  aria-label={`${m.label}: ${m.pct}%`}
                  role="img"
                >
                  <span className="sig-fill" style={{ '--fit-pct': `${m.pct}%` } as React.CSSProperties} />
                </span>
                <span className="breakdown__val">{m.note}</span>
              </div>
            ))}
            {row.languages && (
              <div className="breakdown__row">
                <span className="breakdown__label">Languages</span>
                <span className="breakdown__val" style={{ gridColumn: '2 / -1', textAlign: 'left' }}>{row.languages}</span>
              </div>
            )}
          </div>
          {(row.stack_mismatch || (row.exp_note && row.exp_note !== 'unverified')) && (
            <div className="faint" style={{ marginTop: 8, fontSize: '0.85em' }}>
              {row.stack_mismatch ? `⚠ stack mismatch: this role centres on ${row.stack_mismatch}, not your primary stack. ` : ''}
              {row.exp_note && row.exp_note !== 'unverified' ? `experience: ${row.exp_note}.` : ''}
            </div>
          )}
        </div>

        <div className="section">
          <div className="section__h">Skills you bring · gaps</div>
          <div className="chips">
            {(row.have || []).map((h, i) => (
              <span key={`h${i}`} className="chip chip--have">{h}</span>
            ))}
            {(row.gap || []).map((g, i) => (
              <span key={`g${i}`} className="chip chip--gap">{g}</span>
            ))}
            {(row.have || []).length === 0 && (row.gap || []).length === 0 && (
              <span className="faint">no keyword data</span>
            )}
          </div>
        </div>

        <div className="section">
          <div className="section__h">Posting</div>
          <dl className="kv">
            <dt>URL</dt>
            <dd>
              {row.url ? (
                <a href={row.url} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
                  {shorten(row.url)}
                </a>
              ) : '—'}
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

      {/* Step 6: save star with aria-pressed + aria-label; glyph aria-hidden */}
      {onToggleSave && (
        <div className="drawer__save">
          <button
            className={`btn ${saved ? 'btn--saved' : ''}`}
            onClick={onToggleSave}
            aria-pressed={saved}
            aria-label={saved ? 'Remove from saved shortlist' : 'Save this job to shortlist'}
            title={saved ? 'Remove from your saved shortlist' : 'Save this job to build a CV + CL for it later'}
          >
            <span aria-hidden>{saved ? '★' : '☆'}</span>
            {saved ? ' saved' : ' save'}
          </button>
          {savedCount > 0 && (
            <span className="drawer__save-hint">
              {savedCount} saved · build them all with <code>/cos saved build-all</code>
            </span>
          )}
        </div>
      )}

      <div className="drawer__actions">
        {/* Primary CTA: actually builds the tailored CV (build-cv). */}
        <button className="btn btn--primary" onClick={() => onEnqueue('build-cv', args)}>
          <IconDoc /> Tailor my CV
        </button>
        <button className="btn" onClick={() => onEnqueue('build-cl', args)}>
          <IconDoc /> Cover letter
        </button>
        {/* Score the role + write a fit report (a separate step from building). */}
        <button className="btn" onClick={() => onEnqueue('evaluate', args)}>
          <IconBolt /> Evaluate fit
        </button>
        <button className="btn" onClick={() => onEnqueue('apply', args)}>
          Draft answers
        </button>
        <div style={{ flex: 1 }} />
        {row.url && (
          <button className="btn btn--ghost" onClick={() => window.open(row.url, '_blank', 'noreferrer')}>
            <IconExternal /> Open posting
          </button>
        )}
      </div>
    </div>
  );
}

export function DetailDrawer({
  row,
  today,
  onClose,
  onEnqueue,
  saved = false,
  savedCount = 0,
  onToggleSave,
  inline = false,
}: {
  row: BoardRow;
  today: string;
  onClose: () => void;
  onEnqueue: (kind: string, args: Record<string, unknown>) => void;
  saved?: boolean;
  savedCount?: number;
  onToggleSave?: () => void;
  /** Step 4: true = render as inline desktop pane; false = mobile slide-over overlay */
  inline?: boolean;
}) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevFocusRef = useRef<Element | null>(null);

  // Step 6: mobile only — focus trap + restore
  useEffect(() => {
    if (inline) return; // desktop inline pane needs none of this

    prevFocusRef.current = document.activeElement;
    // Focus the close button on mount
    const t = setTimeout(() => closeBtnRef.current?.focus(), 50);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      // Basic focus trap: find all focusable in panel
      const panel = closeBtnRef.current?.closest('.drawer__panel-content') as HTMLElement | null;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      (prevFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, [inline, onClose]);

  // Desktop inline pane: content renders directly inside .detail-pane
  if (inline) {
    return (
      <DrawerContent
        row={row}
        today={today}
        onClose={onClose}
        onEnqueue={onEnqueue}
        saved={saved}
        savedCount={savedCount}
        onToggleSave={onToggleSave}
        closeBtnRef={closeBtnRef}
      />
    );
  }

  // Mobile slide-over: fixed overlay with scrim + real dialog semantics (Step 6)
  return (
    <div className="drawer">
      <div className="drawer__scrim" onClick={onClose} />
      <div
        className="drawer__panel-content"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.role || 'Job'} at ${row.company || 'company'}`}
        tabIndex={-1}
      >
        <DrawerContent
          row={row}
          today={today}
          onClose={onClose}
          onEnqueue={onEnqueue}
          saved={saved}
          savedCount={savedCount}
          onToggleSave={onToggleSave}
          closeBtnRef={closeBtnRef}
        />
      </div>
    </div>
  );
}
