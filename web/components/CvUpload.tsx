'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueRequest } from '@/lib/types';
import { api } from '@/components/util';
import { openForkGate, IS_PUBLIC } from '@/lib/public';

const ACCEPT = '.pdf,.docx,.doc,.rtf,.html,.htm,.odt,.txt,.md,.markdown,.tex';

// CV upload widget: sends one or more CV files to /api/upload-cv, which saves them
// under data/ui/uploads/ and queues an `onboard` request. The browser has no LLM —
// the actual parse + merge into the master CV happens when the user runs /cos ui (or
// /cos onboard) in Claude Code. This component just hands the files off + reflects
// the queued status live.
export function CvUpload() {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ msg: string; kind: 'ok' | 'err' | 'muted' } | null>(null);
  const [recent, setRecent] = useState<QueueRequest[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadRecent = useCallback(async () => {
    const r = await api<{ ok: boolean; requests?: QueueRequest[] }>('/api/queue');
    if (r && Array.isArray(r.requests)) {
      setRecent(r.requests.filter((x) => x.kind === 'onboard').reverse().slice(0, 6));
    }
  }, []);

  useEffect(() => {
    loadRecent();
    const t = setInterval(loadRecent, 4000);
    return () => clearInterval(t);
  }, [loadRecent]);

  const onPick = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list).slice(0, 6));
    setStatus(null);
  };

  const upload = useCallback(async () => {
    if (IS_PUBLIC) { openForkGate(); return; }
    if (!files.length) { setStatus({ msg: 'Choose at least one CV file.', kind: 'err' }); return; }
    setBusy(true);
    setStatus({ msg: 'Uploading…', kind: 'muted' });
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('mode', mode);
      // Raw fetch (NOT the JSON api() helper) — this is multipart/form-data.
      const res = await fetch('/api/upload-cv', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) {
        setStatus({ msg: data.message || 'Uploaded. Run /cos ui in Claude Code.', kind: 'ok' });
        setFiles([]);
        if (inputRef.current) inputRef.current.value = '';
        loadRecent();
      } else {
        if (data.gated) openForkGate({ error: String(data.error || '') });
        setStatus({ msg: data.error || 'Upload failed.', kind: 'err' });
      }
    } catch {
      setStatus({ msg: 'Network error — is the panel running?', kind: 'err' });
    } finally {
      setBusy(false);
    }
  }, [files, mode, loadRecent]);

  return (
    <div className="upload">
      <label className="upload__drop">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={(e) => onPick(e.target.files)}
          style={{ display: 'none' }}
        />
        <div className="upload__dropinner">
          <b>Click to choose your CV file(s)</b>
          <span className="faint">PDF · Word · RTF · HTML · txt · md — add several to build a richer master</span>
        </div>
      </label>

      {files.length > 0 && (
        <ul className="upload__list">
          {files.map((f) => (
            <li key={f.name}>
              <span className="upload__name">{f.name}</span>
              <span className="faint">{(f.size / 1024).toFixed(0)} KB</span>
            </li>
          ))}
        </ul>
      )}

      <div className="upload__row">
        <div className="seg">
          <button type="button" className={`seg__btn ${mode === 'merge' ? 'seg__btn--on' : ''}`} onClick={() => setMode('merge')}>
            merge into master
          </button>
          <button type="button" className={`seg__btn ${mode === 'replace' ? 'seg__btn--on' : ''}`} onClick={() => setMode('replace')}>
            replace master
          </button>
        </div>
        <button className="btn btn--primary" disabled={busy || !files.length} onClick={upload}>
          {busy ? 'uploading…' : `upload ${files.length || ''} CV${files.length === 1 ? '' : 's'}`.trim()}
        </button>
      </div>

      {status && <div className={`upload__status ${status.kind === 'ok' ? 'ok' : status.kind === 'err' ? 'err' : 'faint'}`}>{status.msg}</div>}

      <div className="note" style={{ marginTop: 18 }}>
        The browser has no AI — your files are saved locally and <b>queued</b>. Run{' '}
        <b>/cos ui</b> (or <b>/cos onboard</b>) in Claude Code to parse and {mode === 'replace' ? 'rebuild' : 'merge them into'} your
        master CV. Nothing is uploaded to any server; the panel runs on your machine and only writes under <code>data/ui/</code>.
      </div>

      {recent.length > 0 && (
        <div className="section" style={{ marginTop: 22 }}>
          <div className="section__h">Recent uploads</div>
          {recent.map((r) => (
            <div className="qrow" key={r.id}>
              <span className="qrow__kind">onboard</span>
              <span className={`pill pill--${r.status}`}>{r.status}</span>
              <span className="qrow__args">
                {String((r.args as { files?: string[] }).files?.length ?? 0)} file(s) · {String((r.args as { mode?: string }).mode ?? 'merge')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
