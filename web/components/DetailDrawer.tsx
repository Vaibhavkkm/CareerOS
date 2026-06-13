'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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

interface DocEntry {
  type: 'cv' | 'cl' | 'report' | 'tex';
  path: string;
  ts: string;
}

const TYPE_LABEL: Record<string, string> = { cv: 'CV', cl: 'Cover Letter', report: 'Report', tex: 'LaTeX source' };

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
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocEntry | null>(null);
  const [tab, setTab] = useState<'jd' | 'docs'>('jd');
  const [listWidth, setListWidth] = useState(140);
  const [panelWidth, setPanelWidth] = useState(640);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startW: number; kind: 'list' | 'panel' } | null>(null);

  const onResizerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: listWidth, kind: 'list' };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
  }, [listWidth]);

  const onResizerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientX - dragRef.current.startX;
    const next = Math.max(80, Math.min(320, dragRef.current.startW + delta));
    setListWidth(next);
  }, []);

  const onResizerUp = useCallback(() => { dragRef.current = null; }, []);

  const onPanelResizerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelWidth, kind: 'panel' };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
  }, [panelWidth]);

  const onPanelResizerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.kind !== 'panel') return;
    // dragging left edge: moving left = wider panel
    const delta = dragRef.current.startX - e.clientX;
    const maxW = Math.floor(window.innerWidth * 0.92);
    const next = Math.max(380, Math.min(maxW, dragRef.current.startW + delta));
    setPanelWidth(next);
  }, []);

  const onPanelResizerUp = useCallback(() => { dragRef.current = null; }, []);

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

  // Poll for generated docs — auto-switches to docs tab when first doc arrives
  const pollDocs = useCallback(() => {
    if (!row.jd_path) return;
    api<{ ok: boolean; docs: DocEntry[] }>(`/api/docs?jd_path=${encodeURIComponent(row.jd_path)}`).then((r) => {
      if (!r?.ok) return;
      setDocs(r.docs);
      setActiveDoc((prev) => {
        if (prev) return r.docs.find((d) => d.path === prev.path) || r.docs[0] || null;
        if (r.docs.length) {
          setTab('docs');
          return r.docs[0];
        }
        return null;
      });
    });
  }, [row.jd_path]);

  useEffect(() => {
    pollDocs();
    const t = setInterval(pollDocs, 8000);
    return () => clearInterval(t);
  }, [pollDocs]);

  // Focus / focus-trap
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    panel.addEventListener('keydown', handleKeyDown);
    return () => panel.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const args = { url: row.url, jd_path: row.jd_path, company: row.company, role: row.role };
  const hasDocs = docs.length > 0;

  return (
    <div className="drawer" style={{ gridTemplateColumns: `1fr ${panelWidth}px` }}>
      <div className="drawer__scrim" onClick={onClose} />
      <div
        className="drawer__panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        style={{ outline: 'none', display: 'flex', flexDirection: 'column', position: 'relative' }}
      >
        {/* ── panel resize handle (left edge) ── */}
        <div
          className="drawer__panel-resizer"
          onPointerDown={onPanelResizerDown}
          onPointerMove={onPanelResizerMove}
          onPointerUp={onPanelResizerUp}
        />
        {/* ── header ── */}
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
          <div className="drawer__title" id="drawer-title">{row.role || '—'}</div>
          <div className="drawer__sub">
            {row.company || '—'}
            {row.source ? `  ·  ${row.source}` : ''}
          </div>
        </div>

        {/* ── tab bar ── */}
        <div className="drawer__tabs">
          <button
            className={`drawer__tab${tab === 'jd' ? ' is-active' : ''}`}
            onClick={() => setTab('jd')}
          >
            Job Description
          </button>
          <button
            className={`drawer__tab${tab === 'docs' ? ' is-active' : ''}${hasDocs ? ' has-badge' : ''}`}
            onClick={() => setTab('docs')}
          >
            Documents
            {hasDocs && <span className="drawer__tabcount">{docs.length}</span>}
          </button>
        </div>

        {/* ── split body ── */}
        <div className="drawer__split" style={{ flex: 1, minHeight: 0 }}>

          {/* JD panel */}
          <div className={`drawer__pane drawer__pane--jd${tab === 'jd' ? ' is-visible' : ''}`}>
            <div className="drawer__body">
              <div className="section">
                <div className="section__h">Match · has / gap</div>
                <div className="chips">
                  {(row.have || []).map((h, i) => <span key={`h${i}`} className="chip chip--have">{h}</span>)}
                  {(row.gap || []).map((g, i) => <span key={`g${i}`} className="chip chip--gap">{g}</span>)}
                  {!(row.have?.length) && !(row.gap?.length) && <span className="faint">no keyword data</span>}
                </div>
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
                    ) : '—'}
                  </dd>
                  {jd?.location && <><dt>Location</dt><dd>{jd.location}</dd></>}
                  <dt>Posted</dt><dd>{row.posted || 'date n/a'}</dd>
                  {row.experience && <><dt>Experience</dt><dd>{row.experience} required</dd></>}
                  {row.languages && <><dt>Language</dt><dd>{row.languages}</dd></>}
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
                    No description captured{row.url ? ' — open the original posting to read it.' : '.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Documents panel */}
          <div className={`drawer__pane drawer__pane--docs${tab === 'docs' ? ' is-visible' : ''}`}>
            {!hasDocs ? (
              <div className="drawer__nodocs">
                <div className="faint" style={{ marginBottom: 8 }}>No documents yet.</div>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-ghost)' }}>
                  Click <b>Evaluate</b>, <b>Build CV</b>, or <b>Build CL</b> below — generated PDFs appear here automatically.
                </div>
              </div>
            ) : (
              <div className="drawer__docsplit">
                {/* Doc selector sidebar */}
                <div className="drawer__doclist" style={{ width: listWidth, minWidth: listWidth }}>
                  {docs.map((d) => (
                    <button
                      key={d.path}
                      className={`drawer__docitem${activeDoc?.path === d.path ? ' is-active' : ''}`}
                      onClick={() => setActiveDoc(d)}
                    >
                      <span className="drawer__doctype">{TYPE_LABEL[d.type] || d.type}</span>
                      <span className="drawer__docdate">{d.ts.slice(0, 10)}</span>
                    </button>
                  ))}
                </div>
                {/* Drag resizer */}
                <div
                  className="drawer__resizer"
                  onPointerDown={onResizerDown}
                  onPointerMove={onResizerMove}
                  onPointerUp={onResizerUp}
                />
                {/* PDF / report viewer */}
                <div className="drawer__docviewer">
                  {activeDoc ? (
                    activeDoc.type === 'report' ? (
                      <ReportViewer path={activeDoc.path} />
                    ) : activeDoc.type === 'tex' ? (
                      <TexViewer path={activeDoc.path} />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--hairline)', alignItems: 'center' }}>
                          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-dim)' }}>{activeDoc.path.split('/').pop()}</span>
                          <a
                            href={`/api/pdf?path=${encodeURIComponent(activeDoc.path)}`}
                            download
                            className="btn btn--ghost"
                            style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 'var(--fs-micro)' }}
                          >
                            Download PDF
                          </a>
                        </div>
                        <iframe
                          src={`/api/pdf?path=${encodeURIComponent(activeDoc.path)}#toolbar=1`}
                          style={{ flex: 1, border: 'none', width: '100%', background: '#fff' }}
                          title={TYPE_LABEL[activeDoc.type]}
                        />
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── actions ── */}
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

// ── minimal markdown → HTML (no external dep) ────────────────────────
function mdToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // fenced code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // hr
    .replace(/^---+$/gm, '<hr>')
    // bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bullet lists (group consecutive lines)
    .replace(/((?:^[*\-] .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map((l) => `<li>${l.replace(/^[*\-] /, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    })
    // numbered lists
    .replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `<ol>${items}</ol>`;
    })
    // blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // paragraphs (blank-line separated, skip already-tagged lines)
    .replace(/\n\n(?!<)/g, '</p><p>')
    .replace(/^(?!<)/, '<p>').replace(/(?!>)$/, '</p>');
}

// ── inline report markdown viewer ────────────────────────────────────
function ReportViewer({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/render?path=${encodeURIComponent(path)}`)
      .then((r) => r.ok ? r.text() : null)
      .then((t) => setText(t))
      .catch(() => setText(null));
  }, [path]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--hairline)', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-dim)' }}>{path.split('/').pop()}</span>
        <a
          href={`/api/render?path=${encodeURIComponent(path)}`}
          download
          className="btn btn--ghost"
          style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 'var(--fs-micro)' }}
        >
          Download .md
        </a>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {text === null ? (
          <div className="faint">Loading report…</div>
        ) : (
          <div
            className="report-md"
            dangerouslySetInnerHTML={{ __html: mdToHtml(text) }}
          />
        )}
      </div>
    </div>
  );
}

// ── LaTeX source viewer ───────────────────────────────────────────────
function TexViewer({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/render?path=${encodeURIComponent(path)}`)
      .then((r) => r.ok ? r.text() : null)
      .then((t) => setText(t))
      .catch(() => setText(null));
  }, [path]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--hairline)', fontSize: 'var(--fs-micro)', color: 'var(--fg-dim)' }}>
        {path.split('/').pop()} · LaTeX source
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {text === null ? (
          <div className="faint">Loading…</div>
        ) : (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, color: 'var(--fg-dim)', lineHeight: 1.5 }}>{text}</pre>
        )}
      </div>
    </div>
  );
}
