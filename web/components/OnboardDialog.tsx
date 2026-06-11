'use client';
import { useState } from 'react';

// Upload-your-own CV + cover letter → queue an `onboard` request for the /cos
// agent. The files never leave this machine: they land in data/ui/uploads/ and
// the agent learns the user's facts + voice from them (modes/onboard.md), after
// which "fetch recent" / "refresh" pull jobs ranked against THIS CV.
export function OnboardDialog({
  onClose,
  onQueued,
}: {
  onClose: () => void;
  onQueued: (msg: string) => void;
}) {
  const [cv, setCv] = useState<File | null>(null);
  const [cl, setCl] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!cv && !cl) {
      setError('attach at least your CV (the cover letter is optional but teaches your voice)');
      return;
    }
    setBusy(true);
    setError('');
    const form = new FormData();
    if (cv) form.append('cv', cv);
    if (cl) form.append('cl', cl);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const j = await res.json();
      if (j && j.ok) {
        onQueued('CV/CL uploaded & onboarding queued — run /cos ui in your AI agent to learn from them');
        onClose();
      } else {
        setError((j && j.error) || 'upload failed');
      }
    } catch {
      setError('upload failed — is the local engine running?');
    }
    setBusy(false);
  };

  const fileRow = (
    label: string,
    hint: string,
    file: File | null,
    set: (f: File | null) => void,
  ) => (
    <label className="field" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <span className="field__label">{label}</span>
      <input
        className="input"
        type="file"
        accept=".pdf,.docx,.doc,.txt,.md,.tex,.rtf"
        onChange={(e) => set(e.target.files?.[0] || null)}
        disabled={busy}
        style={{ height: 'auto', padding: 8 }}
      />
      <span className="dim" style={{ fontSize: 11 }}>{file ? file.name : hint}</span>
    </label>
  );

  return (
    <div
      className="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal__card">
        <div className="modal__h">Upload your CV &amp; cover letter</div>
        <div className="modal__p">
          CareerOS learns your facts and writing voice from <b>your own documents</b> — they stay on this
          machine (saved to <code>data/ui/uploads/</code>, git-ignored). After uploading, run <b>/cos ui</b> in
          your AI agent to onboard; then <b>fetch recent</b> pulls jobs matched to <i>your</i> CV.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '14px 0' }}>
          {fileRow('your CV (required)', 'pdf · docx · txt · md · tex — max 15 MB', cv, setCv)}
          {fileRow('a cover letter you wrote (optional)', 'any past one works — it teaches your prose voice', cl, setCl)}
        </div>
        {error && (
          <div className="modal__p" style={{ color: 'var(--err, #ff6b6b)' }}>
            {error}
          </div>
        )}
        <div className="modal__row">
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || (!cv && !cl)}>
            {busy ? 'uploading…' : 'upload & queue onboarding'}
          </button>
        </div>
      </div>
    </div>
  );
}
