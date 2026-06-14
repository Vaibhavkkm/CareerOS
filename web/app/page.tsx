'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardResponse } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { FilterBar, type Filters, type FetchRecentOpts, COUNTRIES } from '@/components/FilterBar';
import { BoardTable } from '@/components/BoardTable';
import { DetailDrawer } from '@/components/DetailDrawer';
import { CommandPalette, type Command } from '@/components/CommandPalette';
import { Toaster, useToasts } from '@/components/Toast';
import { api } from '@/components/util';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

export default function BoardPage() {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [filters, setFilters] = useState<Filters>({ min: '', recent: '' });
  // Where to fetch from — drives JobSpy country_indeed + location. Lifted here (not
  // inside FilterBar) so refresh, the command palette, and the fetch button all act
  // on the same selection.
  const [place, setPlace] = useState<FetchRecentOpts>({ countries: ['Luxembourg'], city: '', jobTypes: [] });
  const [drawer, setDrawer] = useState<number>(-1);
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState(false);
  // Saved/bookmarked jobs — a set of saved URLs (for ★ state) + the total count.
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [savedCount, setSavedCount] = useState(0);
  const { toasts, push, dismiss } = useToasts();

  // Monotonic sequence so out-of-order /api/board responses can't clobber fresh
  // data: only the most recently STARTED load is allowed to apply its result.
  const loadSeq = useRef(0);

  const load = useCallback(
    async (f: Filters, opts: { pin?: string } = {}) => {
      const seq = ++loadSeq.current;
      setBusy(true);
      // Close the drawer first: it's keyed by row INDEX, and a reload re-filters +
      // re-sorts rows, so the same index could otherwise point at a different job.
      setDrawer(-1);
      const qs = new URLSearchParams();
      if (f.min) qs.set('min', f.min);
      if (f.recent) qs.set('recent', f.recent);
      // Country / city / type filter the BOARD too (not just the next fetch). These
      // are multi-select: a comma-separated list matches ANY (empty = all / any).
      if (place.countries.length) qs.set('country', place.countries.join(','));
      if (place.city.trim()) qs.set('city', place.city.trim());
      if (place.jobTypes.length) qs.set('type', place.jobTypes.join(','));
      // Pin a just-fetched posting to the top so it's findable, not buried by rank.
      if (opts.pin) qs.set('pin', opts.pin);
      const r = await api<BoardResponse>(`/api/board?${qs.toString()}`);
      if (seq !== loadSeq.current) return; // a newer load started — discard this stale result
      setBusy(false);
      if (!r.ok) {
        push(r.error || 'could not load board', 'err');
        setBoard({ ok: false, today: '', count: 0, rows: [] });
        return;
      }
      setBoard(r);
      // The pinned posting is forced to row 0 by the engine — surface it: jump the
      // board to the top and open its detail drawer so the user sees what they fetched.
      if (opts.pin && r.rows?.[0] && (r.rows[0].pinned || r.rows[0].url === opts.pin)) {
        setDrawer(0);
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [push, place],
  );

  // ── saved jobs (bookmark shortlist) ──
  const loadSaved = useCallback(async () => {
    if (IS_PUBLIC) return;
    const r = await api<{ ok: boolean; count?: number; saved?: { url?: string }[] }>('/api/save');
    if (r.ok) {
      setSavedUrls(new Set((r.saved || []).map((s) => s.url).filter((u): u is string => !!u)));
      setSavedCount(r.count ?? (r.saved || []).length);
    }
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  // Toggle save for a board row. Optimistic, then re-syncs from the engine.
  const toggleSave = useCallback(
    async (row: { url?: string; jd_path?: string; company?: string; role?: string; location?: string; posted?: string; band?: string; score?: number }) => {
      if (IS_PUBLIC) { openForkGate(); return; }
      const isSaved = !!row.url && savedUrls.has(row.url);
      const r = await api<{ ok: boolean; count?: number; error?: string }>('/api/save', {
        method: 'POST',
        body: JSON.stringify(isSaved ? { action: 'remove', url: row.url } : { action: 'add', job: row }),
      });
      if (r.ok) {
        push(isSaved ? 'removed from saved' : 'saved — build all later with /cos saved build-all', isSaved ? 'info' : 'ok');
        loadSaved();
      } else {
        push(r.error || 'could not update saved', 'err');
      }
    },
    [savedUrls, push, loadSaved],
  );

  // Debounced so changing the country/type dropdowns OR typing a city re-filters the
  // board without firing a request on every keystroke. `load` closes over `place`,
  // so it re-runs whenever the filters or the place selection change.
  useEffect(() => {
    const t = setTimeout(() => load(filters), 200);
    return () => clearTimeout(t);
  }, [filters, load]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === 'Escape') {
        // Layered close: if the command palette is open (it sits ON TOP), Escape
        // dismisses just the palette; only if it was already closed does Escape
        // close the detail drawer. A single Escape shouldn't nuke both.
        let paletteWasOpen = false;
        setPalette((p) => { paletteWasOpen = p; return false; });
        if (!paletteWasOpen) setDrawer(-1);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const rows = board?.rows || [];
  const today = board?.today || new Date().toISOString().slice(0, 10);

  const enqueue = useCallback(
    async (kind: string, args: Record<string, unknown>) => {
      if (IS_PUBLIC) { openForkGate(); return; }
      const r = await api<{ ok: boolean; error?: string }>('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ kind, args }),
      });
      if (r.ok) push(`${kind} queued — run /cos ui in your AI agent to process`, 'ok');
      else push(r.error || 'could not queue', 'err');
    },
    [push],
  );

  const scan = useCallback(async () => {
    if (IS_PUBLIC) { openForkGate(); return; }
    setBusy(true);
    push('scanning tracked portals…', 'info');
    const r = await api<{ ok: boolean; counts?: { added?: number }; error?: string }>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setBusy(false);
    if (r.ok) {
      push(`scan complete · ${r.counts?.added ?? 0} new`, 'ok');
      load(filters);
    } else {
      push(r.error || 'scan failed', 'err');
    }
  }, [filters, load, push]);

  const fetchUrl = useCallback(
    async (url: string) => {
      if (IS_PUBLIC) { openForkGate(); return; }
      setBusy(true);
      push('fetching posting…', 'info');
      const r = await api<{ ok: boolean; error?: string; needs_agent_fetch?: boolean; posting?: { url?: string; role?: string } }>('/api/fetch-jd', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      setBusy(false);
      if (r.ok) {
        // Pin by the URL that actually lands on the board row (fetch-jd may canonicalize
        // it), falling back to what the user pasted.
        const savedUrl = r.posting?.url || url;
        push('posting saved — pinned to the top of the board', 'ok');
        load(filters, { pin: savedUrl });
      } else if (r.needs_agent_fetch) {
        // Bot-protected / JS-rendered page: plain HTTP can't get it, but the agent's
        // own fetch tools can — queue it instead of dead-ending on an error.
        const q = await api<{ ok: boolean; error?: string }>('/api/queue', {
          method: 'POST',
          body: JSON.stringify({ kind: 'fetch-jd', args: { url } }),
        });
        if (q.ok) push('site blocks robots — queued for your agent: run /cos ui to fetch it', 'info');
        else push(r.error || 'fetch failed', 'err');
      } else {
        push(r.error || 'fetch failed', 'err');
      }
    },
    [filters, load, push],
  );

  // Live multi-board fetch (Indeed/ZipRecruiter/Google) via the jobspy sidecar.
  // Search terms come from the profile's CV-derived target roles (the sidecar's
  // default), so everything fetched is matched to the user's CV. `recent` (days)
  // bounds how far back we pull; '' means no cap (recent + older).
  // One fetch round-trip for a single country/city. Kept separate so the
  // "All countries" path can call it per-country without re-rendering between each.
  const postFetch = useCallback(
    (country: string, city: string, recent: string, jobType: string) =>
      api<{ ok: boolean; counts?: { added?: number }; received?: number; error?: string }>(
        '/api/fetch-recent',
        { method: 'POST', body: JSON.stringify({ country, city, recent: recent || undefined, jobType: jobType || undefined }) },
      ),
    [],
  );

  const runFetch = useCallback(
    async (opts: FetchRecentOpts, recent: string) => {
      if (IS_PUBLIC) { openForkGate(); return; }
      setBusy(true);
      // Country is multi-select: empty = ALL markets, else the ticked subset. A type
      // fetch can target one JobSpy job_type; with several (or none) ticked we fetch
      // ANY type and let the board's type filter narrow the view.
      const sweep = opts.countries.length === 0 ? COUNTRIES : opts.countries;
      const jobType = opts.jobTypes.length === 1 ? opts.jobTypes[0] : '';

      // 2+ countries → ONE server request that fetches each country's boards with
      // bounded concurrency, dedups, and persists in a SINGLE ingest (no ledger race;
      // a job seen in several countries is added once). City is ignored for a sweep.
      if (sweep.length > 1) {
        const scope = opts.countries.length === 0 ? `all ${COUNTRIES.length} countries` : `${sweep.length} countries`;
        push(`fetching CV-matched jobs · ${scope} in one sweep (may take a few minutes)…`, 'info');
        const r = await api<{
          ok: boolean; received?: number; counts?: { added?: number }; failed?: number;
          perCountry?: { country: string; ok: boolean; received?: number; error?: string }[]; error?: string;
        }>('/api/fetch-recent', {
          method: 'POST',
          body: JSON.stringify({ countries: sweep, recent: recent || undefined, jobType: jobType || undefined }),
        });
        setBusy(false);
        if (r.ok) {
          const totalNew = r.counts?.added ?? 0;
          const failed = r.failed ?? 0;
          for (const c of r.perCountry || []) {
            if (!c.ok) push(`${c.country} · ${c.error || 'fetch failed'}`, 'err');
          }
          push(
            `${scope} done · ${totalNew} new on board (${r.received ?? 0} seen)${failed ? ` · ${failed} failed` : ''}`,
            totalNew ? 'ok' : 'info',
          );
          load(filters);
        } else {
          push(r.error || 'fetch failed', 'err');
        }
        return;
      }

      const country = sweep[0];
      const typeLabel = jobType ? ` · ${jobType}` : '';
      const where = [opts.city.trim(), country].filter(Boolean).join(', ');
      push(`fetching CV-matched jobs · ${where || 'profile default'}${typeLabel}…`, 'info');
      const r = await postFetch(country, opts.city.trim(), recent, jobType);
      setBusy(false);
      if (r.ok) {
        push(`fetched ${r.received ?? 0} · ${r.counts?.added ?? 0} new on board`, 'ok');
        load(filters);
      } else {
        push(r.error || 'fetch failed', 'err');
      }
    },
    [filters, load, push, postFetch],
  );

  // "Fetch recent" honors the board's "posted" window as the fetch cap.
  const fetchRecent = useCallback(
    (opts: FetchRecentOpts) => runFetch(opts, filters.recent),
    [runFetch, filters.recent],
  );
  // "Refresh" pulls ALL CV-matched jobs (recent + older) for the selected
  // country/city, then re-ranks — this is what the refresh button now does.
  const refresh = useCallback(() => runFetch(place, ''), [runFetch, place]);

  const commands: Command[] = useMemo(
    () => [
      { id: 'refresh', label: 'Refresh — fetch all CV-matched jobs + re-rank', hint: 'R', run: refresh },
      { id: 'rerank', label: 'Re-rank board only (no fetch)', run: () => load(filters) },
      { id: 'fetch-recent', label: 'Fetch recent jobs — Indeed / ZipRecruiter / Google', run: () => fetchRecent(place) },
      { id: 'scan', label: 'Scan ATS portals', run: scan },
      { id: 'hunt', label: 'Hunt — auto-fetch jobs from my profile', hint: 'go', run: () => (window.location.href = '/hunt') },
      { id: 'pipeline', label: 'Open pipeline', run: () => (window.location.href = '/pipeline') },
      { id: 'strong', label: 'Filter: Strong and above', run: () => setFilters((f) => ({ ...f, min: 'Strong' })) },
      { id: 'recent7', label: 'Filter: posted within 7 days', run: () => setFilters((f) => ({ ...f, recent: '7' })) },
      { id: 'clear', label: 'Filter: clear all', run: () => setFilters({ min: '', recent: '' }) },
    ],
    [filters, load, scan, fetchRecent, refresh, place],
  );

  const strongest = rows.filter((r) => r.band === 'STRONGEST').length;
  const veryStrongPlus = rows.filter((r) => r.band === 'STRONGEST' || r.band === 'Very strong').length;

  return (
    <div className="app">
      <TopBar />
      <div className="statusline">
        <span>
          <b>{board?.count ?? rows.length}</b> openings
          {board && board.count > rows.length ? <span className="dim"> · top {rows.length} shown</span> : null}
        </span>
        <span className="sep">·</span>
        <span>
          <b>{strongest}</b> strongest
        </span>
        <span className="sep">·</span>
        <span>
          <b>{veryStrongPlus}</b> very&nbsp;strong+
        </span>
        <div className="statusline__right">
          <span className="live">
            <span className={`live__dot ${busy ? 'is-stale' : ''}`} /> {busy ? 'working' : 'live'}
          </span>
          <span>{today}</span>
        </div>
      </div>
      <main className="main">
        <h1 className="sr-only">CareerOS — CV-ranked job board</h1>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          place={place}
          onPlaceChange={setPlace}
          onRefresh={refresh}
          onScan={scan}
          onFetchUrl={fetchUrl}
          onFetchRecent={fetchRecent}
          busy={busy}
        />
        {!board ? (
          <div className="placeholder">loading board…</div>
        ) : rows.length === 0 ? (
          <div className="placeholder">
            <b>No openings on the board yet.</b>
            <div className="hint">
              New here? Upload your CV &amp; cover letter with <b>⤴ my CV/CL</b> (top right) so the board ranks
              jobs by your profile. Then auto-fetch roles from the{' '}
              <a href="/hunt" style={{ color: 'var(--signal)' }}>
                Hunt
              </a>{' '}
              tab, run <b>scan</b> for your tracked companies, or paste a job URL above.
            </div>
          </div>
        ) : (
          <BoardTable rows={rows} today={today} selected={drawer} onSelect={(i) => setDrawer(i)} showCountry={place.countries.length !== 1} />
        )}
      </main>
      {drawer >= 0 && rows[drawer] && (
        <DetailDrawer
          row={rows[drawer]}
          today={today}
          onClose={() => setDrawer(-1)}
          onEnqueue={enqueue}
          saved={!!rows[drawer].url && savedUrls.has(rows[drawer].url)}
          savedCount={savedCount}
          onToggleSave={() => toggleSave(rows[drawer])}
        />
      )}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
