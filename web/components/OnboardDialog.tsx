'use client';
import { useRef, useState } from 'react';

// Upload-your-own CV(s) + cover letter → queue an `onboard` request for the /cos
// agent. The files never leave this machine: they land in data/ui/uploads/ and
// the agent learns the user's facts + voice from them (modes/onboard.md), after
// which "fetch recent" / "refresh" pull jobs ranked against THIS CV.
//
// Multiple CVs are welcome — many people keep several (technical, academic, an
// older one, a different region). The agent merges them into one richer master
// (union + dedup, conflicts surfaced for approval — never fabricated).

const ACCEPT = '.pdf,.docx,.doc,.txt,.md,.tex,.rtf';
const ALLOWED = new Set(['pdf', 'docx', 'doc', 'txt', 'md', 'tex', 'rtf']);
const extOk = (name: string) => ALLOWED.has((name.split('.').pop() || '').toLowerCase());

export function OnboardDialog({
  onClose,
  onQueued,
}: {
  onClose: () => void;
  onQueued: (msg: string) => void;
}) {
  const [cvs, setCvs] = useState<File[]>([]);
  const [cl, setCl] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const cvInputRef = useRef<HTMLInputElement>(null);

  // Add CV files, ignoring non-CV types and de-duping by name+size.
  const addCvs = (files: FileList | File[] | null) => {
    if (!files) return;
    const incoming = Array.from(files).filter((f) => extOk(f.name));
    if (!incoming.length) return;
    setCvs((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
    setError('');
  };
  const removeCv = (i: number) => setCvs((prev) => prev.filter((_, j) => j !== i));

  const submit = async () => {
    if (!cvs.length && !cl) {
      setError('attach at least one CV (the cover letter is optional but teaches your voice)');
      return;
    }
    setBusy(true);
    setError('');
    const form = new FormData();
    for (const f of cvs) form.append('cv', f); // multiple CVs → repeated `cv` field
    if (cl) form.append('cl', cl);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const j = await res.json();
      if (j && j.ok) {
        const n = cvs.length;
        onQueued(
          `${n ? `${n} CV${n === 1 ? '' : 's'}` : 'Cover letter'}${cl && n ? ' + cover letter' : ''}` +
            ' uploaded & onboarding queued — run /cos ui in your AI agent to learn from them',
        );
        onClose();
      } else {
        setError((j && j.error) || 'upload failed');
      }
    } catch {
      setError('upload failed — is the local engine running?');
    }
    setBusy(false);
  };

  return (
    <div
      className="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal__card">
        <div className="modal__h">Upload your CV(s) &amp; cover letter</div>
        <div className="modal__p">
          CareerOS learns your facts and writing voice from <b>your own documents</b> — they stay on this
          machine (saved to <code>data/ui/uploads/</code>, git-ignored). Drop <b>one or several CVs</b> (they get
          merged into one richer master). After uploading, run <b>/cos ui</b> in your AI agent to onboard; then{' '}
          <b>fetch recent</b> pulls jobs matched to <i>your</i> CV.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '14px 0' }}>
          {/* ── CV drop zone (multiple) ───────────────────────────── */}
          <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="field__label">your CV(s) — one or more (required)</span>
            <div
              role="button"
              tabIndex={0}
              onClick={() => !busy && cvInputRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !busy) cvInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy) addCvs(e.dataTransfer.files);
              }}
              style={{
                border: `1.5px dashed ${dragging ? 'var(--gold)' : 'var(--hairline)'}`,
                borderRadius: 'var(--r-control, 6px)',
                background: dragging ? 'var(--bg-row-hover)' : 'var(--bg-raised)',
                color: dragging ? 'var(--gold)' : 'var(--fg-dim)',
                padding: '18px 12px',
                textAlign: 'center',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 12,
                transition: 'border-color .15s, background .15s, color .15s',
              }}
            >
              {dragging ? 'drop your CV files…' : 'drag CV files here, or click to browse (you can pick several)'}
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>pdf · docx · txt · md · tex — max 15 MB each</div>
            </div>
            <input
              ref={cvInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => {
                addCvs(e.target.files);
                e.target.value = ''; // allow re-picking the same file
              }}
              disabled={busy}
              style={{ display: 'none' }}
            />
            {cvs.length > 0 && (
              <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cvs.map((f, i) => (
                  <li
                    key={`${f.name}:${f.size}:${i}`}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      fontSize: 12, padding: '4px 8px',
                      background: 'var(--bg-row)', borderRadius: 'var(--r-chip, 4px)',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name} <span className="dim">· {(f.size / 1024).toFixed(0)} KB</span>
                    </span>
                    <button
                      onClick={() => removeCv(i)}
                      disabled={busy}
                      aria-label={`remove ${f.name}`}
                      style={{ background: 'none', border: 'none', color: 'var(--fg-dim)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2 }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── cover letter (single, optional) ───────────────────── */}
          <label className="field" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <span className="field__label">a cover letter you wrote (optional)</span>
            <input
              className="input"
              type="file"
              accept={ACCEPT}
              onChange={(e) => setCl(e.target.files?.[0] || null)}
              disabled={busy}
              style={{ height: 'auto', padding: 8 }}
            />
            <span className="dim" style={{ fontSize: 11 }}>
              {cl ? cl.name : 'any past one works — it teaches your prose voice'}
            </span>
          </label>
        </div>

        {error && (
          <div className="modal__p" style={{ color: 'var(--negative)' }}>
            {error}
          </div>
        )}
        <div className="modal__row">
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || (!cvs.length && !cl)}>
            {busy ? 'uploading…' : 'upload & queue onboarding'}
          </button>
        </div>
      </div>
    </div>
  );
}
