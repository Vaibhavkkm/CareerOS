'use client';
import { useCallback, useEffect, useState } from 'react';
import type { QueueRequest } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { Toaster, useToasts } from '@/components/Toast';
import { api } from '@/components/util';
import { IconHunt, IconBolt } from '@/components/Icons';

const RECENCY: [string, string][] = [
  ['1', '24h'],
  ['3', '3d'],
  ['7', '7d'],
  ['', 'any'],
];

function argstr(a: Record<string, unknown>): string {
  const p: string[] = [];
  for (const [k, v] of Object.entries(a || {})) {
    if (v == null || v === '') continue;
    p.push(`${k}=${v}`);
  }
  return p.join('  ') || 'from profile';
}

export default function HuntPage() {
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [recent, setRecent] = useState('7');
  const [hunts, setHunts] = useState<QueueRequest[]>([]);
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

  const enqueueHunt = useCallback(
    async (args: Record<string, unknown>) => {
      const r = await api<{ ok: boolean; error?: string }>('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ kind: 'hunt', args }),
      });
      if (r.ok) push('hunt queued — run /cos hunt (or /cos ui) in your AI agent to fetch live', 'ok');
      else push(r.error || 'could not queue hunt', 'err');
      loadHunts();
    },
    [push, loadHunts],
  );

  // Step 10: stat bar values for Hunt
  const queued = hunts.filter((h) => h.status === 'queued').length;
  const claimed = hunts.filter((h) => h.status === 'claimed').length;
  const done = hunts.filter((h) => h.status === 'done').length;

  return (
    // Step 10: same 5-row shell
    <div className="app">
      {/* Row 1: top bar */}
      <TopBar onToast={push} />

      {/* Row 2: stat bar — Hunt: queued / claimed / done */}
      <div className="statbar">
        <div className="statbar__stat">
          <span className="statbar__num">{queued}</span>
          <span className="statbar__label">queued</span>
        </div>
        <div className="statbar__sep" />
        <div className="statbar__stat">
          <span className="statbar__num">{claimed}</span>
          <span className="statbar__label">claimed</span>
        </div>
        <div className="statbar__sep" />
        <div className="statbar__stat">
          <span className="statbar__num">{done}</span>
          <span className="statbar__label">done</span>
        </div>
        <div className="statbar__right">
          <span className="live">
            <span className="live__dot" />
            live
          </span>
        </div>
      </div>

      {/* Row 3: empty filter bar row (no filters on hunt) */}
      <div style={{ height: 0, borderBottom: '1px solid var(--hair)', background: 'var(--bg)' }} />

      {/* Row 4: scrollable content */}
      <div className="page-scroll">
        <div className="page">
          <div className="page__h">Hunt</div>
          <div className="page__lead">
            Pull fresh openings from multiple portals and rank them against your CV. The agent reads your{' '}
            <b>profile</b> (target roles, locations, seniority) and searches Indeed, Dice, and your tracked ATS
            companies — the matches land on your Board.
          </div>
          <div className="note">
            Job-board search runs in your AI agent (the connectors are agent-only, by design). Queue a hunt here,
            then run <b>/cos hunt</b> (or <b>/cos ui</b>) to execute it live. Nothing is applied — you review the
            matches on the Board. AI-assisted search: verify details with the employer before applying.
          </div>

          <button
            className="btn btn--primary"
            style={{ padding: '11px 18px', marginBottom: 28 }}
            onClick={() => enqueueHunt({ recent: Number(recent) || 7 })}
          >
            <IconBolt /> auto-hunt from my profile
          </button>

          <div className="section__h" style={{ maxWidth: 540 }}>
            or target a specific search
          </div>
          <form
            className="huntform"
            onSubmit={(e) => {
              e.preventDefault();
              const args: Record<string, unknown> = {};
              if (role.trim()) args.query = role.trim();
              if (location.trim()) args.location = location.trim();
              if (recent) args.recent = Number(recent) || 7;
              enqueueHunt(args);
            }}
          >
            <div className="huntfield">
              <label>role / keywords</label>
              <input
                className="input"
                placeholder="(blank = use my profile roles)"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
            <div className="huntfield">
              <label>location</label>
              <input
                className="input"
                placeholder="(blank = use my profile location) · or &quot;remote&quot;"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="huntfield">
              <label>posted within</label>
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                {RECENCY.map(([v, l]) => (
                  <button
                    type="button"
                    key={l}
                    className={`seg__btn ${recent === v ? 'seg__btn--on' : ''}`}
                    onClick={() => setRecent(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn" type="submit">
              <IconHunt /> queue hunt
            </button>
          </form>

          <div className="section" style={{ maxWidth: 640, marginTop: 32 }}>
            <div className="section__h">Recent hunts</div>
            {hunts.length === 0 ? (
              <div className="faint">none yet</div>
            ) : (
              hunts.map((h) => (
                <div className="qrow" key={h.id}>
                  <span className="qrow__kind">hunt</span>
                  <span className={`pill pill--${h.status}`}>{h.status}</span>
                  <span className="qrow__args">{argstr(h.args)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Row 5: bottom status line */}
      <div className="statusline">
        <span>auto-fetch openings matched to <b>your profile</b></span>
        <div className="statusline__right">
          <span>indeed · dice · ats</span>
        </div>
      </div>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
