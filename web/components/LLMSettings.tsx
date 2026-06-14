'use client';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './util';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

type Provider = 'claude-cli' | 'ollama' | 'openai-compat';

interface Config {
  provider: Provider;
  model: string;
  endpoint: string;
  apiKey: string;
  pollIntervalMs: number;
  _apiKeySet?: boolean;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  'claude-cli': 'Claude Code CLI (default)',
  'ollama': 'Ollama (local)',
  'openai-compat': 'OpenAI-compatible API',
};

const MODEL_PLACEHOLDERS: Record<Provider, string> = {
  'claude-cli': 'leave blank — uses Claude Code default',
  'ollama': 'e.g. llama3.2, qwen2.5:14b, mistral, gemma3:12b',
  'openai-compat': 'e.g. meta-llama/llama-3.2-3b-instruct:free',
};

const ENDPOINT_PLACEHOLDERS: Record<Provider, string> = {
  'claude-cli': 'not used',
  'ollama': 'http://localhost:11434',
  'openai-compat': 'https://openrouter.ai/api  or  https://api.groq.com/openai',
};

const ENDPOINT_HELP: Record<Provider, string> = {
  'claude-cli': '',
  'ollama': 'Default: http://localhost:11434 — change only if non-standard port',
  'openai-compat': 'OpenRouter · Groq · Together.ai · LM Studio (http://localhost:1234)',
};

const KEY_HELP: Record<Provider, string> = {
  'claude-cli': '',
  'ollama': 'Not needed for Ollama',
  'openai-compat': 'Your OpenRouter / Groq / Together.ai API key',
};

const POLL_OPTIONS = [
  { label: '5 s', value: 5000 },
  { label: '15 s', value: 15000 },
  { label: '30 s', value: 30000 },
  { label: '60 s', value: 60000 },
];

export function LLMSettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<Config>({
    provider: 'claude-cli', model: '', endpoint: '', apiKey: '', pollIntervalMs: 15000,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [exists, setExists] = useState(false);

  useEffect(() => {
    api<{ ok: boolean; config: Config; exists: boolean }>('/api/config').then((r) => {
      if (r?.ok) {
        setCfg({ ...r.config, apiKey: '' }); // don't pre-fill masked key
        setExists(r.exists);
      }
      setLoading(false);
    });
  }, []);

  const set = (k: keyof Config) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setCfg((c) => ({ ...c, [k]: k === 'pollIntervalMs' ? Number(v) : v }));
    if (k === 'apiKey') setKeyTouched(true);
    setSaved(false);
  };

  const setProvider = (p: Provider) => {
    setCfg((c) => ({ ...c, provider: p, model: '', endpoint: '', apiKey: '' }));
    setKeyTouched(false);
    setSaved(false);
  };

  const save = useCallback(async () => {
    if (IS_PUBLIC) { openForkGate(); return; }
    setSaving(true); setErr(null);
    const payload = {
      ...cfg,
      // If key field is empty and config already exists, preserve existing key
      apiKey: keyTouched ? cfg.apiKey : '__keep__',
    };
    const r = await api<{ ok: boolean; error?: string }>('/api/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (r?.ok) { setSaved(true); setExists(true); setKeyTouched(false); }
    else setErr(r?.error || 'Save failed');
  }, [cfg, keyTouched]);

  const showEndpoint = cfg.provider !== 'claude-cli';
  const showKey = cfg.provider === 'openai-compat';
  const showModel = cfg.provider !== 'claude-cli';

  const modal = (
    <div className="modal" role="dialog" aria-modal="true" aria-label="LLM settings">
      <div className="modal__card llmsettings" style={{ width: 'min(520px, 94vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s4)' }}>
          <div className="modal__h" style={{ margin: 0 }}>LLM Provider</div>
          <button className="btn btn--ghost" style={{ padding: '2px 8px' }} onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="faint">Loading…</div>
        ) : (
          <>
            <div style={{ marginBottom: 'var(--s4)' }}>
              <div className="field__label" style={{ marginBottom: 6 }}>Provider</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(['claude-cli', 'ollama', 'openai-compat'] as Provider[]).map((p) => (
                  <label
                    key={p}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      border: `1px solid ${cfg.provider === p ? 'var(--signal)' : 'var(--hairline-2)'}`,
                      background: cfg.provider === p ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.06)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer', fontSize: 'var(--fs-data)',
                      boxShadow: cfg.provider === p ? '0 0 0 1px rgba(129,140,248,0.3)' : 'none',
                      transition: 'background 0.12s ease, border-color 0.12s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={p}
                      checked={cfg.provider === p}
                      onChange={() => setProvider(p)}
                      style={{ accentColor: 'var(--signal)' }}
                    />
                    <span style={{ flex: 1 }}>{PROVIDER_LABELS[p]}</span>
                    {p === 'claude-cli' && <span className="pill">no setup</span>}
                    {p === 'ollama' && <span className="pill">local</span>}
                    {p === 'openai-compat' && <span className="pill">cloud / local</span>}
                  </label>
                ))}
              </div>
            </div>

            {showModel && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 'var(--s3)' }}>
                <label className="field__label">
                  Model
                  <span className="field__help">{cfg.provider === 'ollama' ? 'must be pulled via ollama pull' : 'model ID from provider'}</span>
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={cfg.model}
                  onChange={set('model')}
                  placeholder={MODEL_PLACEHOLDERS[cfg.provider]}
                  spellCheck={false}
                />
              </div>
            )}

            {showEndpoint && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 'var(--s3)' }}>
                <label className="field__label">
                  Endpoint
                  {ENDPOINT_HELP[cfg.provider] && (
                    <span className="field__help">{ENDPOINT_HELP[cfg.provider]}</span>
                  )}
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={cfg.endpoint}
                  onChange={set('endpoint')}
                  placeholder={ENDPOINT_PLACEHOLDERS[cfg.provider]}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            )}

            {showKey && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 'var(--s3)' }}>
                <label className="field__label">
                  API Key
                  <span className="field__help">{KEY_HELP[cfg.provider]}</span>
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  type="password"
                  value={cfg.apiKey}
                  onChange={set('apiKey')}
                  placeholder={exists && !keyTouched ? '•••• (saved — leave blank to keep)' : 'sk-...'}
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 'var(--s5)' }}>
              <label className="field__label">
                Daemon poll interval
                <span className="field__help">how often queue is checked</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {POLL_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    className={`seg__btn${cfg.pollIntervalMs === o.value ? ' seg__btn--on' : ''}`}
                    onClick={() => { setCfg((c) => ({ ...c, pollIntervalMs: o.value })); setSaved(false); }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {err && <div className="upload__status err" style={{ marginBottom: 'var(--s3)' }}>{err}</div>}

            <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end', alignItems: 'center' }}>
              {saved && <span style={{ color: 'var(--positive)', fontSize: 'var(--fs-data)' }}>Saved ✓ — restart daemon to apply</span>}
              <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn--primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save config'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}
