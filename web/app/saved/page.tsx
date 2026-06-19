'use client';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { TopBar } from '@/components/TopBar';
import { BandStars } from '@/components/BandStars';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Toaster, useToasts } from '@/components/Toast';
import { useMarkApplied } from '@/components/useMarkApplied';
import { api } from '@/components/util';
import { IS_PUBLIC, openForkGate } from '@/lib/public';
import type { Band, BoardRow } from '@/lib/types';

interface SavedJob {
  id?: string;
  url?: string;
  jd_path?: string;
  company?: string;
  role?: string;
  location?: string;
  posted?: string;
  band?: Band;
  score?: number;
  fit?: number;
  saved_at?: string;
}

// Fit meter helpers (mirror the Board) — colour ramp + segment snapping.
function fitColor(fit: number): { color: string; glow: string } {
  if (fit >= 9) return { color: '#FFCB6B', glow: 'rgba(255,203,107,0.45)' };
  if (fit >= 8) return { color: '#F2B33D', glow: 'rgba(242,179,61,0.4)' };
  if (fit >= 7) return { color: '#C9923A', glow: 'rgba(201,146,58,0.35)' };
  return { color: '#C9A86A', glow: 'rgba(201,168,106,0.3)' };
}
function snapPct(fit: number, segCount = 13): number {
  const raw = Math.max(0, Math.min(10, fit)) * 10;
  return Math.round((Math.round((raw / 100) * segCount) / segCount) * 1000) / 10;
}
// Saved jobs may carry fit on the 0–10 Board scale or as 0–100 — normalise to 0–10.
function fitOn10(f: number): number {
  if (!Number.isFinite(f)) return 0;
  return f > 10 ? f / 10 : f;
}

export default function SavedPage() {
  const [jobs, setJobs] = useState<SavedJob[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const { toasts, push, dismiss } = useToasts();
  const { markApplied, dialog: appliedDialog } = useMarkApplied(push);

  const load = useCallback(async () => {
    const r = await api<{ ok: boolean; saved?: SavedJob[]; error?: string }>('/api/save');
    if (r.ok && Array.isArray(r.saved)) setJobs(r.saved);
    else { push(r.error || 'could not read saved jobs', 'err'); setJobs([]); }
  }, [push]);
  useEffect(() => { load(); }, [load]);

  const enqueue = useCallback(async (kind: string, job: SavedJob) => {
    if (IS_PUBLIC) { openForkGate(); return; }
    const args = { url: job.url, jd_path: job.jd_path, company: job.company, role: job.role };
    const r = await api<{ ok: boolean; error?: string }>('/api/queue', {
      method: 'POST', body: JSON.stringify({ kind, args }),
    });
    if (r.ok) push(`${kind} queued — run /cos ui in your AI agent to process`, 'ok');
    else push(r.error || 'could not queue', 'err');
  }, [push]);

  const remove = useCallback(async (job: SavedJob) => {
    if (IS_PUBLIC) { openForkGate(); return; }
    const r = await api<{ ok: boolean; error?: string }>('/api/save', {
      method: 'POST', body: JSON.stringify({ action: 'remove', url: job.url, id: job.id }),
    });
    if (r.ok) { push('removed from saved', 'info'); load(); }
    else push(r.error || 'could not remove', 'err');
  }, [push, load]);

  return (
    <div className="app">
      <TopBar onToast={push} />
      <div className="page-scroll" style={{ gridRow: '2 / -1' }}>
        <div className="page">
          <div className="page__h">Saved</div>
          <div className="page__lead">
            Your bookmarked jobs. Click the ☆ on a job in the <a href="/" style={{ color: 'var(--signal)' }}>Board</a> to add one here.
            Build a CV + cover letter for every saved job at once with <code>/cos saved build-all</code> in your AI agent.
          </div>

          {jobs === null ? (
            <div className="placeholder">loading…</div>
          ) : jobs.length === 0 ? (
            <div className="placeholder">
              <b>No saved jobs yet.</b>
              <div className="hint">Open a role on the Board and click <b>☆ save</b> to shortlist it for later.</div>
            </div>
          ) : (
            <div className="saved-list">
              {jobs.map((job, i) => {
                const f10 = fitOn10(job.fit ?? (job.score != null ? job.score * 10 : 0));
                const { color, glow } = fitColor(f10);
                const fitVars = { '--fit-color': color, '--fit-glow': glow } as CSSProperties;
                return (
                  <div className="saved-card" key={job.id || job.url || i}>
                    <div
                      className="saved-card__main"
                      onClick={() => setSel(i)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(i); } }}
                      title="Click for full details"
                    >
                      <div className="saved-card__role">{job.role || 'Untitled role'}</div>
                      <div className="saved-card__meta dim">
                        {job.company || '—'}{job.location ? ` · ${job.location}` : ''}{job.posted ? ` · ${job.posted}` : ''}
                      </div>
                      <div className="saved-card__fit" style={fitVars}>
                        <span className="sig sig--big" aria-hidden>
                          <span className="sig-fill" style={{ '--fit-pct': `${snapPct(f10)}%` } as CSSProperties} />
                        </span>
                        <span className="saved-card__score">
                          {Math.round(f10 * 10)}<span className="saved-card__scorelbl"> fit</span>
                        </span>
                        {job.band && <BandStars band={job.band} />}
                      </div>
                    </div>
                    <div className="saved-card__actions">
                      {job.url && (
                        <a className="btn btn--ghost" href={job.url} target="_blank" rel="noreferrer">Open ↗</a>
                      )}
                      <button className="btn btn--primary" onClick={() => enqueue('build-cv', job)}>Build CV</button>
                      <button className="btn" onClick={() => enqueue('build-cl', job)}>Build CL</button>
                      <button
                        className="btn btn--ghost btn--icon btn--danger"
                        onClick={() => remove(job)}
                        title="Remove from saved"
                        aria-label="Remove from saved"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {sel != null && jobs && jobs[sel] && (
        <div
          className="saved-modal"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}
        >
          <div className="saved-modal__panel">
            <DetailDrawer
              row={{ ...jobs[sel], fit: jobs[sel].fit ?? (jobs[sel].score != null ? jobs[sel].score * 10 : 0) } as unknown as BoardRow}
              today={today}
              onClose={() => setSel(null)}
              onEnqueue={(kind) => { const j = jobs[sel]; if (j) enqueue(kind, j); }}
              onMarkApplied={() => { const j = jobs[sel]; if (j) markApplied(j); }}
              saved
              savedCount={jobs.length}
              onToggleSave={() => { const j = jobs[sel]; setSel(null); if (j) remove(j); }}
              inline
            />
          </div>
        </div>
      )}
      {appliedDialog}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
