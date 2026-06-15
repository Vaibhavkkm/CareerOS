'use client';
import { useCallback, useRef, useState } from 'react';
import { api } from './util';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

// ── types ─────────────────────────────────────────────────────────────
interface Extracted {
  full_name: string; email: string; phone: string;
  location: string; country: string; city: string;
  linkedin: string; github: string; portfolio_url: string;
  current_title: string; suggested_roles: string[];
  visa_status: string; years_experience: string;
}

interface ProfileForm {
  full_name: string; email: string; phone: string;
  location: string; country: string; city: string;
  linkedin: string; github: string; portfolio_url: string;
  target_roles_raw: string;   // newline-separated
  visa_status: string; comp_target: string; comp_min: string;
  comp_currency: string; location_flexibility: string; cv_template: string;
}

const EMPTY_FORM: ProfileForm = {
  full_name: '', email: '', phone: '', location: '', country: '', city: '',
  linkedin: '', github: '', portfolio_url: '', target_roles_raw: '',
  visa_status: '', comp_target: '', comp_min: '', comp_currency: 'USD',
  location_flexibility: '', cv_template: 'classic',
};

const ACCEPT = '.pdf,.docx,.doc,.rtf,.html,.htm,.odt,.txt,.md,.markdown,.tex';

// ── field wrapper ─────────────────────────────────────────────────────
function F({ label, help, auto, children }: {
  label: string; help?: string; auto?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label">
        {label}
        {auto && <span className="wizard__autobadge">auto-filled</span>}
        {help && <span className="field__help">{help}</span>}
      </label>
      {children}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────
export function OnboardWizard({ hasProfile, hasMaster, onDone }: {
  hasProfile: boolean; hasMaster: boolean; onDone?: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'form' | 'confirm'>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [autoFields, setAutoFields] = useState<Set<string>>(new Set());
  const [parsedText, setParsedText] = useState('');
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setField = (k: keyof ProfileForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setAutoFields((s) => { const n = new Set(s); n.delete(k); return n; });
    };

  // Apply extracted fields — mark as auto-filled, don't overwrite user edits
  const applyExtracted = useCallback((ex: Extracted, isFirstLoad: boolean) => {
    const filled = new Set<string>();
    setForm((prev) => {
      const next = { ...prev };
      const pairs: [keyof ProfileForm, string][] = [
        ['full_name', ex.full_name], ['email', ex.email], ['phone', ex.phone],
        ['location', ex.location], ['country', ex.country], ['city', ex.city],
        ['linkedin', ex.linkedin], ['github', ex.github],
        ['portfolio_url', ex.portfolio_url], ['visa_status', ex.visa_status],
      ];
      for (const [k, v] of pairs) {
        if (v && (isFirstLoad || !prev[k])) { next[k] = v; filled.add(k); }
      }
      // Target roles from suggested_roles
      if (ex.suggested_roles?.length && (isFirstLoad || !prev.target_roles_raw)) {
        next.target_roles_raw = ex.suggested_roles.join('\n');
        filled.add('target_roles_raw');
      }
      return next;
    });
    setAutoFields((s) => new Set([...s, ...filled]));
  }, []);

  // ── Step 1: upload + parse + extract ─────────────────────────────────
  const onPick = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list).slice(0, 6));
    setErr(null);
  };

  const upload = useCallback(async () => {
    if (IS_PUBLIC) { openForkGate(); return; }
    if (!files.length) { setErr('Choose at least one CV file.'); return; }
    setUploading(true); setErr(null);
    try {
      // 1. Upload files
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('mode', 'merge');
      const upRes = await fetch('/api/upload-cv', { method: 'POST', body: fd });
      const upData = await upRes.json();
      if (!upData.ok) { setErr(upData.error || 'Upload failed.'); return; }

      // 2. Parse CVs (zero-token, fast)
      const parseRes = await api<{ ok: boolean; text?: string; error?: string }>(
        '/api/onboard/parse', { method: 'POST', body: JSON.stringify({ dir: upData.dir }) }
      );
      if (!parseRes?.ok || !parseRes.text) {
        setErr(parseRes?.error || 'Parsing failed — check that parse-cv.mjs can read your file type.');
        return;
      }
      setParsedText(parseRes.text);
      setUploading(false);

      // 3. Extract fields via LLM (or regex fallback) — async, non-blocking for UX
      setExtracting(true);
      setStep('form');   // advance immediately so user sees the form loading
      const exRes = await api<{ ok: boolean; extracted?: Extracted }>(
        '/api/onboard/extract', { method: 'POST', body: JSON.stringify({ text: parseRes.text }) }
      );
      if (exRes?.ok && exRes.extracted) {
        applyExtracted(exRes.extracted, true);
      }
    } catch (e) {
      setErr((e as Error).message || 'Upload error');
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  }, [files, applyExtracted]);

  // ── Step 3: save ──────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!form.full_name.trim()) { setErr('Name is required.'); return; }
    if (!form.target_roles_raw.trim()) { setErr('Enter at least one target role.'); return; }
    if (!parsedText) { setErr('No parsed CV text — go back and upload your CV first.'); return; }
    setSaving(true); setErr(null);
    // __EXISTING_MASTER__ sentinel means "don't overwrite the existing cv.master.md"
    try {
      const r = await api<{ ok: boolean; error?: string }>(
        '/api/onboard/confirm',
        { method: 'POST', body: JSON.stringify({ profile: form, parsedText }) }
      );
      if (r?.ok) { setSaved(true); onDone?.(); }
      else setErr(r?.error || 'Save failed.');
    } catch (e) {
      setErr((e as Error).message || 'Network error');
    } finally {
      setSaving(false);
    }
  }, [form, parsedText, onDone]);

  // ── render: done ──────────────────────────────────────────────────────
  if (saved) {
    return (
      <div className="wizard__done">
        <div className="wizard__done-icon">✓</div>
        <div className="wizard__done-title">Profile saved</div>
        <p className="wizard__done-body">
          <code>data/profile.yml</code> and <code>data/cv.master.md</code> written.<br />
          Run <code>npm run start</code> then use the board — evaluate jobs and build tailored CVs from the browser.
        </p>
        <a href="/" className="btn btn--primary">Go to board →</a>
      </div>
    );
  }

  return (
    <div className="wizard">
      {/* step indicator */}
      <div className="wizard__steps">
        {(['upload', 'form', 'confirm'] as const).map((s, i) => (
          <div key={s} className={`wizard__step ${step === s ? 'is-active' : (step === 'confirm' || (step === 'form' && s === 'upload')) ? 'is-done' : ''}`}>
            <span className="wizard__stepnum">{i + 1}</span>
            <span className="wizard__steplabel">{{ upload: 'Upload CV', form: 'Review & edit', confirm: 'Confirm' }[s]}</span>
          </div>
        ))}
      </div>

      {/* ── Step 1: Upload ─────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="wizard__panel">
          <div className="page__lead">
            Drop in your CV(s). CareerOS reads them for facts, pre-fills your profile, and you just review.
            Multiple files welcome — old CV, academic, different region — each holds facts the others miss.
          </div>
          <div
            className={`upload__drop ${dragging ? 'is-dragover' : ''}`}
            style={{ marginTop: 20 }}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); onPick(e.dataTransfer.files); }}
            role="button"
            tabIndex={0}
            aria-label="Click or drag CV files here"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          >
            <input ref={inputRef} type="file" multiple accept={ACCEPT}
              onChange={(e) => onPick(e.target.files)} style={{ display: 'none' }} />
            <div className="upload__dropinner">
              <b>Click or drag your CV file(s) here</b>
              <span className="faint">PDF · Word · RTF · HTML · txt · md (up to 6 files)</span>
            </div>
          </div>
          {files.length > 0 && (
            <ul className="upload__list">
              {files.map((f, idx) => (
                <li key={f.name}>
                  <span className="upload__name">{f.name}</span>
                  <span className="faint">{(f.size / 1024).toFixed(0)} KB</span>
                  <button
                    className="btn btn--ghost"
                    style={{ padding: '2px 6px', fontSize: 'var(--fs-micro)', minWidth: 0 }}
                    onClick={() => setFiles((ff) => ff.filter((_, j) => j !== idx))}
                    aria-label={`Remove ${f.name}`}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {err && <div className="upload__status err">{err}</div>}
          <div className="wizard__actions">
            <button className="btn btn--primary" disabled={uploading || !files.length} onClick={upload}>
              {uploading ? 'Uploading & parsing…' : `Upload ${files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'CVs'} & auto-fill →`}
            </button>
            {(hasProfile && hasMaster) && (
              <button className="btn btn--ghost" onClick={() => {
                if (!parsedText) setParsedText('__EXISTING_MASTER__');
                setStep('form');
              }}>
                Skip — edit existing profile
              </button>
            )}
          </div>
          <div className="note" style={{ marginTop: 14 }}>
            Files stay on your machine. Nothing sent to any server.
          </div>
        </div>
      )}

      {/* ── Step 2: Review & edit ──────────────────────────────────── */}
      {step === 'form' && (
        <div className="wizard__panel">
          {extracting ? (
            <div className="wizard__extracting">
              <span className="wizard__spinner" />
              Extracting your profile from CV — fields will fill in shortly…
            </div>
          ) : (
            parsedText && (
              <div className="wizard__parsedok">
                CV parsed · fields auto-filled below. Review and adjust anything that looks wrong.
              </div>
            )
          )}

          <div className="wizard__section">Your details</div>
          <div className="wizard__grid">
            <F label="Full name *" auto={autoFields.has('full_name')}>
              <input className="input" value={form.full_name} onChange={setField('full_name')} placeholder="Jane Smith" />
            </F>
            <F label="Email" auto={autoFields.has('email')}>
              <input className="input" type="email" value={form.email} onChange={setField('email')} placeholder="jane@example.com" />
            </F>
            <F label="Phone" auto={autoFields.has('phone')}>
              <input className="input" value={form.phone} onChange={setField('phone')} placeholder="+1 555 000 0000" />
            </F>
            <F label="Location" help="city, country" auto={autoFields.has('location')}>
              <input className="input" value={form.location} onChange={setField('location')} placeholder="San Francisco, USA" />
            </F>
            <F label="Country" auto={autoFields.has('country')}>
              <input className="input" value={form.country} onChange={setField('country')} placeholder="USA" />
            </F>
            <F label="City" auto={autoFields.has('city')}>
              <input className="input" value={form.city} onChange={setField('city')} placeholder="San Francisco" />
            </F>
            <F label="LinkedIn" auto={autoFields.has('linkedin')}>
              <input className="input" value={form.linkedin} onChange={setField('linkedin')} placeholder="linkedin.com/in/yourname" />
            </F>
            <F label="GitHub" auto={autoFields.has('github')}>
              <input className="input" value={form.github} onChange={setField('github')} placeholder="github.com/yourname" />
            </F>
            <F label="Portfolio / website" auto={autoFields.has('portfolio_url')}>
              <input className="input" value={form.portfolio_url} onChange={setField('portfolio_url')} placeholder="https://yoursite.com" />
            </F>
          </div>

          <div className="wizard__section">What you're looking for</div>
          <F label="Target roles *" help="one per line — edit the suggestions below" auto={autoFields.has('target_roles_raw')}>
            <textarea className="input wizard__textarea" rows={5}
              value={form.target_roles_raw} onChange={setField('target_roles_raw')}
              placeholder={"Software Engineer\nBackend Engineer\nStaff Engineer"} />
          </F>
          <div className="wizard__grid">
            <F label="Visa / work status" auto={autoFields.has('visa_status')}>
              <input className="input" value={form.visa_status} onChange={setField('visa_status')} placeholder="EU citizen / H1B / etc." />
            </F>
            <F label="Location flexibility">
              <input className="input" value={form.location_flexibility} onChange={setField('location_flexibility')} placeholder="Remote OK / NYC metro only" />
            </F>
          </div>

          <div className="wizard__section">Compensation <span className="field__help">never shown externally</span></div>
          <div className="wizard__grid">
            <F label="Target range">
              <input className="input" value={form.comp_target} onChange={setField('comp_target')} placeholder="120k–150k" />
            </F>
            <F label="Minimum walkaway">
              <input className="input" value={form.comp_min} onChange={setField('comp_min')} placeholder="100k" />
            </F>
            <F label="Currency">
              <select className="input" value={form.comp_currency} onChange={setField('comp_currency')}>
                {['USD','EUR','GBP','CAD','AUD','INR','SGD','CHF'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </F>
          </div>

          <div className="wizard__section">CV preferences</div>
          <F label="CV template">
            <select className="input" value={form.cv_template} onChange={setField('cv_template')}>
              <option value="classic">Classic (default — ATS-safe)</option>
              <option value="modern">Modern (subtle colour accent)</option>
              <option value="academic">Academic (publications-first)</option>
              <option value="compact">Compact (dense, 1-page)</option>
            </select>
          </F>

          {err && <div className="upload__status err" style={{ marginTop: 12 }}>{err}</div>}

          <div className="wizard__actions">
            <button className="btn btn--ghost" onClick={() => setStep('upload')}>← back</button>
            <button className="btn btn--primary" disabled={extracting} onClick={() => { setErr(null); setStep('confirm'); }}>
              {extracting ? 'Extracting…' : 'Review & save →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Confirm ───────────────────────────────────────── */}
      {step === 'confirm' && (
        <div className="wizard__panel">
          <div className="wizard__confirm-block">
            <div className="wizard__confirm-label">Will write <code>data/profile.yml</code></div>
            <table className="wizard__summary">
              <tbody>
                {([
                  ['Name', form.full_name], ['Email', form.email], ['Phone', form.phone],
                  ['Location', form.location], ['LinkedIn', form.linkedin], ['GitHub', form.github],
                  ['Target roles', form.target_roles_raw.split('\n').filter(Boolean).join(' · ')],
                  ['Visa status', form.visa_status], ['Comp target', form.comp_target],
                  ['Comp min', form.comp_min], ['Currency', form.comp_currency],
                  ['Location flex', form.location_flexibility], ['CV template', form.cv_template],
                ] as [string, string][]).filter(([, v]) => v).map(([k, v]) => (
                  <tr key={k}><td className="wizard__sumkey">{k}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="wizard__confirm-block">
            <div className="wizard__confirm-label">Will write <code>data/cv.master.md</code></div>
            {parsedText === '__EXISTING_MASTER__' ? (
              <div className="faint">Existing cv.master.md will be kept (no new CV uploaded)</div>
            ) : parsedText ? (
              <pre className="wizard__cvpreview">
                {parsedText.slice(0, 800)}{parsedText.length > 800 ? '\n… (truncated for display)' : ''}
              </pre>
            ) : (
              <div className="faint">No parsed CV — go back and upload your CV.</div>
            )}
          </div>

          {err && <div className="upload__status err" style={{ marginTop: 12 }}>{err}</div>}
          <div className="wizard__actions">
            <button className="btn btn--ghost" onClick={() => setStep('form')}>← edit details</button>
            <button className="btn btn--primary" disabled={saving || !parsedText || parsedText === ''} onClick={save}>
              {saving ? 'Saving…' : 'Save profile →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
