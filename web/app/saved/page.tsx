'use client';
import { useCallback, useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { BandStars } from '@/components/BandStars';
import { Toaster, useToasts } from '@/components/Toast';
import { api } from '@/components/util';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

interface SavedJob {
  id?: string;
  url?: string;
  jd_path?: string;
  company?: string;
  role?: string;
  location?: string;
  posted?: string;
  band?: string;
  score?: number;
  fit?: number;
  saved_at?: string;
}

export default function SavedPage() {
  const [jobs, setJobs] = useState<SavedJob[] | null>(null);
  const { toasts, push, dismiss } = useToasts();

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {jobs.map((job, i) => (
                <div
                  key={job.id || job.url || i}
                  style={{
                    border: '1px solid var(--hairline)', borderRadius: 'var(--r-control, 6px)',
                    padding: '12px 14px', background: 'var(--bg-raised)',
                    display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{job.role || 'Untitled role'}</div>
                    <div className="dim" style={{ fontSize: 13 }}>
                      {job.company || '—'}{job.location ? ` · ${job.location}` : ''}{job.posted ? ` · ${job.posted}` : ''}
                    </div>
                  </div>
                  {job.band && <div style={{ flex: '0 0 auto' }}><BandStars band={job.band} /></div>}
                  <div style={{ display: 'flex', gap: 8, flex: '0 0 auto', flexWrap: 'wrap' }}>
                    {job.url && (
                      <a className="btn btn--ghost" href={job.url} target="_blank" rel="noreferrer">Open ↗</a>
                    )}
                    <button className="btn btn--primary" onClick={() => enqueue('build-cv', job)}>Build CV</button>
                    <button className="btn" onClick={() => enqueue('build-cl', job)}>Build CL</button>
                    <button className="btn btn--ghost" onClick={() => remove(job)} title="Remove from saved">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
