'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { QueueRequest } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { Toaster, useToasts } from '@/components/Toast';
import { api } from '@/components/util';
import './hunt.css';

// recency value (passed to the engine) -> segment label
const RECENCY: { val: string; label: string }[] = [
  { val: '1', label: '24h' },
  { val: '3', label: '3d' },
  { val: '7', label: '7d' },
  { val: '', label: 'Any' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');

function argstr(a: Record<string, unknown>): string {
  const p: string[] = [];
  for (const [k, v] of Object.entries(a || {})) {
    if (v == null || v === '') continue;
    p.push(`${k}=${v}`);
  }
  return p.join('  ·  ') || 'from profile';
}

const BoltIcon = () => (
  <svg viewBox="0 0 24 24" width="27" height="27" fill="currentColor" aria-hidden><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
);
const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
);

export default function HuntPage() {
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [recent, setRecent] = useState('7');
  const [hunts, setHunts] = useState<QueueRequest[]>([]);
  const [armed, setArmed] = useState(false);
  const [booted, setBooted] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const loadHunts = useCallback(async () => {
    const r = await api<{ ok: boolean; requests?: QueueRequest[] }>('/api/queue');
    if (r && Array.isArray(r.requests)) {
      setHunts(r.requests.filter((x) => x.kind === 'hunt').reverse().slice(0, 8));
    }
  }, []);

  useEffect(() => {
    loadHunts();
    const t = setInterval(loadHunts, 4000);
    return () => clearInterval(t);
  }, [loadHunts]);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setBooted(true)));
    const t = setTimeout(() => setBootDone(true), 1400);
    return () => { cancelAnimationFrame(id); clearTimeout(t); };
  }, []);

  // the signature moment: "arm" the source scope while the hunt is dispatched
  const armScope = useCallback(() => {
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(false), 1800);
  }, []);

  const enqueueHunt = useCallback(
    async (args: Record<string, unknown>) => {
      armScope();
      const r = await api<{ ok: boolean; error?: string }>('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ kind: 'hunt', args }),
      });
      if (r.ok) push('hunt queued — run /cos hunt (or /cos ui) in your AI agent to fetch live', 'ok');
      else push(r.error || 'could not queue hunt', 'err');
      loadHunts();
    },
    [push, loadHunts, armScope],
  );

  const dispatchAuto = () => enqueueHunt({ recent: Number(recent) || 7 });
  const dispatchTargeted = () => {
    const args: Record<string, unknown> = {};
    if (role.trim()) args.query = role.trim();
    if (location.trim()) args.location = location.trim();
    if (recent) args.recent = Number(recent) || 7;
    enqueueHunt(args);
    setRole('');
    setLocation('');
  };

  const queued = hunts.filter((h) => h.status === 'queued').length;
  const claimed = hunts.filter((h) => h.status === 'claimed').length;
  const done = hunts.filter((h) => h.status === 'done').length;

  const SRCS = ['Indeed', 'Dice', 'ATS'];

  return (
    <div className={`app hunt${booted ? ' booted' : ''}${bootDone ? ' boot-done' : ''}`}>
      <TopBar onToast={push} />

      <div className="page-scroll">
        <div className="console">
          {/* ---- head ---- */}
          <div className="head">
            <div className="reveal" style={{ '--rd': '.05s' } as CSSProperties}>
              <div className="eyebrow"><span className="ring" /> Agent dispatch</div>
              <h1 className="title">Hunt</h1>
              <p className="lead">
                Pull fresh openings from multiple portals and rank them against your CV. The agent reads your{' '}
                <b>profile</b> (target roles, locations, seniority), searches Indeed, Dice, and your tracked ATS
                companies, then drops the matches on your Board.
              </p>
            </div>
            <div className="live reveal" style={{ '--rd': '.12s' } as CSSProperties}>
              <span className="live__lamp"><i /> Live</span>
              <span className="live__src">agent online · /cos hunt</span>
            </div>
          </div>

          {/* ---- protocol ---- */}
          <div className="protocol reveal" style={{ '--rd': '.18s' } as CSSProperties}>
            <p>Job-board search runs inside your AI agent. The connectors are <b>agent-only</b> by design. Queue a hunt here, then run <code className="cmd">/cos hunt</code> (or <code className="cmd">/cos ui</code>) to execute it live.</p>
            <p><b>Nothing gets applied.</b> You review every match on your Board first, and always verify details with the employer before you apply.</p>
          </div>

          <div className="hgrid">
            {/* ---- compose ---- */}
            <section aria-label="Compose a hunt">
              <article className="hero reveal" style={{ '--rd': '.22s' } as CSSProperties}>
                <div className="bolt"><BoltIcon /></div>
                <div>
                  <div className="hero__eyebrow">Fast path</div>
                  <h2>Auto-hunt from your profile</h2>
                  <p>Uses your saved target roles, locations, and seniority. The quickest way to refresh your Board with fresh, ranked matches.</p>
                  <button className="btn btn--primary" onClick={dispatchAuto}>
                    <ArrowIcon /> Arm and dispatch
                  </button>
                </div>
              </article>

              <div className="or reveal" style={{ '--rd': '.28s' } as CSSProperties}><span>Or target a specific search</span></div>

              <div className="compose reveal" style={{ '--rd': '.32s' } as CSSProperties}>
                <div className="field">
                  <label className="field__label" htmlFor="role">Role / keywords</label>
                  <div className="field__input">
                    <span className="p">›</span>
                    <input id="role" type="text" placeholder="Blank uses your profile roles" autoComplete="off"
                      value={role} onChange={(e) => setRole(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') dispatchTargeted(); }} />
                  </div>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="loc">Location</label>
                  <div className="field__input">
                    <span className="p">›</span>
                    <input id="loc" type="text" placeholder="Blank uses your profile location, or type remote" autoComplete="off"
                      value={location} onChange={(e) => setLocation(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') dispatchTargeted(); }} />
                  </div>
                </div>
                <div className="field">
                  <span className="field__label">Posted within</span>
                  <div className="segment" role="group" aria-label="Posted within">
                    {RECENCY.map((r) => (
                      <button key={r.label} type="button" className={`seg${recent === r.val ? ' is-active' : ''}`} onClick={() => setRecent(r.val)}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="btn btn--ghost btn--block" onClick={dispatchTargeted}>
                  <SearchIcon /> Queue hunt
                </button>
              </div>
            </section>

            {/* ---- agent status ---- */}
            <aside className="reveal" style={{ '--rd': '.26s' } as CSSProperties} aria-label="Agent status">
              <div className="queue3">
                <div className="q q--queued"><div className="q__num">{pad2(queued)}</div><div className="q__lbl">Queued</div></div>
                <div className="q q--claimed"><div className="q__num">{pad2(claimed)}</div><div className="q__lbl">Claimed</div></div>
                <div className="q q--done"><div className="q__num">{pad2(done)}</div><div className="q__lbl">Done</div></div>
              </div>

              <section className="panel">
                <div className="panel__head">
                  <div className="panel__label"><span>◎</span> Source scope</div>
                  <div className="panel__meta">{armed ? 'scanning' : 'agent sweep'}</div>
                </div>
                <div className="srcs">
                  {SRCS.map((s) => (
                    <div className={`src${armed ? ' is-armed' : ''}`} key={s}>
                      <div className="src__name">{s}</div>
                      <div className="src__track"><div className="src__sweep" /></div>
                      <div className="src__state">{armed ? 'scanning' : 'standby'}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel__head">
                  <div className="panel__label"><span>▦</span> Recent hunts</div>
                  <div className="panel__meta"><b>{pad2(hunts.length)}</b> logged</div>
                </div>
                <div className="hunts__body">
                  {hunts.length === 0 ? (
                    <div className="empty">No hunts queued yet.<br /><b>Arm one and it lands here.</b></div>
                  ) : (
                    hunts.map((h) => (
                      <div className="hrow" key={h.id}>
                        <div>
                          <div className="hrow__sum">{argstr(h.args)}</div>
                          <div className="hrow__time">run <code className="cmd">/cos hunt</code> to execute</div>
                        </div>
                        <span className={`pill pill--${h.status}`}><i />{h.status}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>

      <div className="statusline">
        <span>auto-fetch openings matched to <b>your profile</b></span>
        <div className="statusline__right"><span>indeed · dice · ats</span></div>
      </div>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
