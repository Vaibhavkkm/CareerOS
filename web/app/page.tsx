'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BoardResponse, BoardRow } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { FilterBar, extractUrl, type Filters, type FetchRecentOpts, COUNTRIES, fetchBoards } from '@/components/FilterBar';
import { BoardTable } from '@/components/BoardTable';
import { DetailDrawer } from '@/components/DetailDrawer';
import { CommandPalette, type Command } from '@/components/CommandPalette';
import { Toaster, useToasts } from '@/components/Toast';
import { useMarkApplied } from '@/components/useMarkApplied';
import { api } from '@/components/util';
import { IS_PUBLIC, openForkGate } from '@/lib/public';

// ── Step 5: useCountUp hook ─────────────────────────────────────────────────
// rAF lerp from previous value to target, eased ease-out-cubic, tabular-nums.
// Respects prefers-reduced-motion by snapping instantly.
function useCountUp(target: number, ms = 550): number {
  const [value, setValue] = useState(target);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(target);
  const prefersReduced =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  useEffect(() => {
    if (prefersReduced) { setValue(target); return; }
    const from = fromRef.current;
    if (from === target) return;
    startRef.current = null;
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);

    const animate = (ts: number) => {
      if (startRef.current == null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / ms);
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(from + (target - from) * eased);
      setValue(current);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        fromRef.current = target;
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => { if (frameRef.current != null) cancelAnimationFrame(frameRef.current); };
  }, [target, ms, prefersReduced]);

  // sync from on unmount so next run starts from the right place
  useEffect(() => { fromRef.current = value; });

  return value;
}

// Free-text board search: every space-separated term must appear somewhere in the
// row (company, role, skills you have/lack, location, source, language, band).
function rowMatches(r: BoardRow, q: string): boolean {
  const hay = [
    r.company, r.role, r.location, r.source, r.url, r.languages, r.experience, r.band,
    ...(r.have || []), ...(r.gap || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((term) => hay.includes(term));
}

// Cross-reference the board against the pipeline tracker so already-applied roles get
// a badge. Status rank: only applied (20) or further gets a badge.
const APPLIED_RANK: Record<string, number> = { evaluated: 10, applied: 20, responded: 30, interview: 40, offer: 50 };
const APPLIED_LABEL: Record<string, string> = { applied: 'Applied', responded: 'Responded', interview: 'Interview', offer: 'Offer' };
const normKey = (s?: string): string => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export default function BoardPage() {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [filters, setFilters] = useState<Filters>({ min: '', recent: '' });
  const [search, setSearch] = useState('');
  const [drawerW, setDrawerW] = useState<number | null>(null); // px; null = CSS default (resizable)
  const [chromeOpen, setChromeOpen] = useState(true); // show/hide the stat bar + filter bar
  const [place, setPlace] = useState<FetchRecentOpts>({ countries: ['Luxembourg'], city: '', jobTypes: [] });
  const [drawer, setDrawer] = useState<number>(-1);
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState(false);
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [savedCount, setSavedCount] = useState(0);
  const { toasts, push, dismiss } = useToasts();
  const { markApplied, dialog: appliedDialog } = useMarkApplied(push);

  // Step 1: flag set true after FIRST successful board load — gates stagger replay.
  const [boardEntered, setBoardEntered] = useState(false);

  const loadSeq = useRef(0);

  const load = useCallback(
    async (f: Filters, opts: { pin?: string } = {}) => {
      const seq = ++loadSeq.current;
      setBusy(true);
      setDrawer(-1);
      const qs = new URLSearchParams();
      if (f.min) qs.set('min', f.min);
      if (f.recent) qs.set('recent', f.recent);
      if (place.countries.length) qs.set('country', place.countries.join(','));
      if (place.city.trim()) qs.set('city', place.city.trim());
      if (place.jobTypes.length) qs.set('type', place.jobTypes.join(','));
      if (opts.pin) qs.set('pin', opts.pin);
      const r = await api<BoardResponse>(`/api/board?${qs.toString()}`);
      if (seq !== loadSeq.current) return;
      setBusy(false);
      if (!r.ok) {
        push(r.error || 'could not load board', 'err');
        setBoard({ ok: false, today: '', count: 0, rows: [] });
        return;
      }
      setBoard(r);
      // Step 1: mark entered so stagger doesn't replay on re-filters
      setBoardEntered(true);
      if (opts.pin && r.rows?.[0] && (r.rows[0].pinned || r.rows[0].url === opts.pin)) {
        setDrawer(0);
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [push, place],
  );

  const loadSaved = useCallback(async () => {
    if (IS_PUBLIC) return;
    const r = await api<{ ok: boolean; count?: number; saved?: { url?: string }[] }>('/api/save');
    if (r.ok) {
      setSavedUrls(new Set((r.saved || []).map((s) => s.url).filter((u): u is string => !!u)));
      setSavedCount(r.count ?? (r.saved || []).length);
    }
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  // Which board rows are already in the pipeline (applied+) → keyed by url and company|role.
  const [appliedMap, setAppliedMap] = useState<Record<string, string>>({});
  const loadApplied = useCallback(async () => {
    if (IS_PUBLIC) return;
    const r = await api<{ ok: boolean; records?: { url?: string; company?: string; role?: string; status?: string }[] }>('/api/tracker');
    if (!r.ok || !Array.isArray(r.records)) return;
    const map: Record<string, string> = {};
    for (const rec of r.records) {
      if ((APPLIED_RANK[rec.status || ''] ?? 0) < 20) continue; // applied or further only
      const label = APPLIED_LABEL[rec.status || ''] || 'Applied';
      if (rec.url) map[`u:${normKey(rec.url)}`] = label;
      if (rec.company && rec.role) map[`cr:${normKey(rec.company)}|${normKey(rec.role)}`] = label;
    }
    setAppliedMap(map);
  }, []);
  // Refresh on mount and whenever the board reloads (covers marking a role applied then re-ranking).
  useEffect(() => { loadApplied(); }, [loadApplied, board]);

  const appliedLabelFor = useCallback((row: BoardRow): string | null => {
    if (row.url && appliedMap[`u:${normKey(row.url)}`]) return appliedMap[`u:${normKey(row.url)}`];
    if (row.company && row.role) return appliedMap[`cr:${normKey(row.company)}|${normKey(row.role)}`] || null;
    return null;
  }, [appliedMap]);

  // Opening the detail pane re-flows the board column (it narrows), which otherwise
  // makes the board scroll region jump to the top. Capture the scroll on click and
  // restore it across the open re-render(s) so clicking a row keeps your place.
  const boardPaneRef = useRef<HTMLDivElement | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const selectRow = useCallback((i: number) => {
    pendingScroll.current = boardPaneRef.current?.scrollTop ?? null;
    setDrawer(i);
  }, []);
  useLayoutEffect(() => {
    if (pendingScroll.current != null && boardPaneRef.current) {
      boardPaneRef.current.scrollTop = pendingScroll.current;
      if (drawerW != null) pendingScroll.current = null; // cleared once the pane width is seeded (reflow settled)
    }
  }, [drawer, drawerW]);

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

  useEffect(() => {
    const t = setTimeout(() => load(filters), 200);
    return () => clearTimeout(t);
  }, [filters, load]);

  // Give the drawer a concrete starting width when it opens (so the resize handle
  // has a position). Double-clicking the handle resets to null → this re-seeds it.
  useEffect(() => {
    if (drawer >= 0 && drawerW == null && typeof window !== 'undefined') {
      setDrawerW(Math.min(460, Math.round(window.innerWidth * 0.38)));
    }
  }, [drawer, drawerW]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === 'Escape') {
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

  // Client-side free-text search over the loaded board. If the text is actually a job
  // URL we DON'T filter (it can't match a row) — the box doubles as a fetch omnibox
  // (FilterBar fetches it on Enter). The drawer indexes into the VISIBLE rows, so
  // changing the search resets the open drawer (handled in onSearch).
  const urlInSearch = extractUrl(search);
  const q = urlInSearch ? '' : search.trim();
  const visibleRows = useMemo(() => (q ? rows.filter((r) => rowMatches(r, q)) : rows), [rows, q]);
  const onSearch = useCallback((s: string) => { setSearch(s); setDrawer(-1); }, []);

  // Drag the detail pane's left edge to resize its width (desktop inline pane).
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = drawerW ?? Math.min(460, window.innerWidth * 0.38);
    const onMove = (ev: PointerEvent) => {
      const max = Math.min(window.innerWidth - 360, 980); // keep the board at least 360px
      setDrawerW(Math.min(max, Math.max(340, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [drawerW]);

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
        const savedUrl = r.posting?.url || url;
        push('posting saved — pinned to the top of the board', 'ok');
        load(filters, { pin: savedUrl });
      } else if (r.needs_agent_fetch) {
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

  const postFetch = useCallback(
    (country: string, city: string, recent: string, jobType: string, boards: string) =>
      api<{ ok: boolean; counts?: { added?: number }; received?: number; error?: string }>(
        '/api/fetch-recent',
        { method: 'POST', body: JSON.stringify({ country, city, recent: recent || undefined, jobType: jobType || undefined, boards }) },
      ),
    [],
  );

  const runFetch = useCallback(
    async (opts: FetchRecentOpts, recent: string) => {
      if (IS_PUBLIC) { openForkGate(); return; }
      setBusy(true);
      const sweep = opts.countries.length === 0 ? COUNTRIES : opts.countries;
      const jobType = opts.jobTypes.length === 1 ? opts.jobTypes[0] : '';
      const boards = fetchBoards();

      if (sweep.length > 1) {
        const scope = opts.countries.length === 0 ? `all ${COUNTRIES.length} countries` : `${sweep.length} countries`;
        push(`fetching CV-matched jobs · ${scope} in one sweep (may take a few minutes)…`, 'info');
        const r = await api<{
          ok: boolean; received?: number; counts?: { added?: number }; failed?: number;
          perCountry?: { country: string; ok: boolean; received?: number; error?: string }[]; error?: string;
        }>('/api/fetch-recent', {
          method: 'POST',
          body: JSON.stringify({ countries: sweep, recent: recent || undefined, jobType: jobType || undefined, boards }),
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
      const r = await postFetch(country, opts.city.trim(), recent, jobType, boards);
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

  const fetchRecent = useCallback(
    (opts: FetchRecentOpts) => runFetch(opts, filters.recent),
    [runFetch, filters.recent],
  );
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

  // Step 3: compute stat bar values
  const strongest = rows.filter((r) => r.band === 'STRONGEST').length;
  const veryStrongPlus = rows.filter((r) => r.band === 'STRONGEST' || r.band === 'Very strong').length;
  const totalCount = board?.count ?? rows.length;

  // Step 5: count-up animated values
  const animTotal = useCountUp(totalCount);
  const animStrongest = useCountUp(strongest);
  const animVSP = useCountUp(veryStrongPlus);

  return (
    <div className="app">
      {/* Row 1: top bar — pass push so OnboardDialog toasts flow to the single host */}
      <TopBar onToast={push} />

      {/* Row 2: stat bar (collapsible — the toggle also hides the filter bar) */}
      <div className="statbar">
        {chromeOpen ? (
          <>
            <div className="statbar__stat">
              <span className="statbar__num">{animTotal}</span>
              <span className="statbar__label">openings</span>
            </div>
            <div className="statbar__sep" />
            <div className="statbar__stat">
              <span className="statbar__num">{animStrongest}</span>
              <span className="statbar__label">strongest</span>
            </div>
            <div className="statbar__sep" />
            <div className="statbar__stat">
              <span className="statbar__num">{animVSP}</span>
              <span className="statbar__label">very strong+</span>
            </div>
          </>
        ) : (
          <div className="statbar__stat">
            <span className="statbar__label">
              {totalCount} openings · {strongest} strongest · {veryStrongPlus} very strong+ · filters hidden
            </span>
          </div>
        )}
        <div className="statbar__right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="live">
            <span className={`live__dot ${busy ? 'is-stale' : ''}`} />
            {busy ? 'working' : 'live'}
          </span>
          <button
            onClick={() => setChromeOpen((o) => !o)}
            title={chromeOpen ? 'Hide the stats + filter bar' : 'Show the stats + filter bar'}
            aria-expanded={chromeOpen}
            style={{
              background: 'none', border: '1px solid var(--hairline)', borderRadius: 'var(--r-control, 6px)',
              color: 'var(--fg-dim)', cursor: 'pointer', fontSize: 11, padding: '2px 8px',
              textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
            }}
          >
            {chromeOpen ? '⌃ hide' : '⌄ filters'}
          </button>
        </div>
      </div>

      {/* Row 3: filter bar. Kept as a (possibly empty) grid child even when collapsed
          so hiding it doesn't shift the board out of its 1fr row. */}
      <div>
        {chromeOpen && (
          <FilterBar
            filters={filters}
            onChange={setFilters}
            search={search}
            onSearchChange={onSearch}
            place={place}
            onPlaceChange={setPlace}
            onRefresh={refresh}
            onScan={scan}
            onFetchUrl={fetchUrl}
            onFetchRecent={fetchRecent}
            busy={busy}
          />
        )}
      </div>

      {/* Row 4: workspace — board is full-width until a role is clicked, then the
          detail pane docks in on the right (desktop) / slides over (mobile). */}
      <div
        className={`workspace${drawer >= 0 && visibleRows[drawer] ? ' workspace--detail' : ''}`}
        style={{
          gridRow: '4 / -1', // absorb the removed status-line row so there's no empty strip
          ...(drawer >= 0 && visibleRows[drawer]
            ? { position: 'relative', ...(drawerW ? { gridTemplateColumns: `1fr ${drawerW}px` } : {}) }
            : {}),
        }}
      >
        {/* Left: board list */}
        <div className="board-pane" ref={boardPaneRef}>
          <h1 className="sr-only">CareerOS — CV-ranked job board</h1>
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
          ) : visibleRows.length === 0 ? (
            <div className="placeholder">
              <b>No jobs match “{q}”.</b>
              <div className="hint">
                Searching {rows.length} loaded opening{rows.length === 1 ? '' : 's'} by company, role, skill or
                location. <button className="btn btn--ghost" onClick={() => onSearch('')}>clear search</button>
              </div>
            </div>
          ) : (
            <BoardTable
              rows={visibleRows}
              today={today}
              selected={drawer}
              onSelect={selectRow}
              showCountry={place.countries.length !== 1}
              entered={boardEntered}
              appliedLabelFor={appliedLabelFor}
            />
          )}
        </div>

        {/* Right: inline detail pane — only mounted once a role is clicked, so the
            board uses the full width by default (desktop only; mobile uses .drawer). */}
        {/* Drag this edge to resize the drawer; double-click to reset to default */}
        {drawer >= 0 && visibleRows[drawer] && drawerW != null && (
          <div
            onPointerDown={startResize}
            onDoubleClick={() => setDrawerW(null)}
            title="Drag to resize · double-click to reset"
            aria-label="Resize panel"
            role="separator"
            style={{
              position: 'absolute', top: 0, bottom: 0, right: drawerW - 3, width: 7,
              cursor: 'col-resize', zIndex: 20, borderLeft: '2px solid var(--hairline)',
            }}
          />
        )}
        {drawer >= 0 && visibleRows[drawer] && (
          <div className="detail-pane">
            <DetailDrawer
              row={visibleRows[drawer]}
              today={today}
              onClose={() => setDrawer(-1)}
              onEnqueue={enqueue}
              onMarkApplied={() => markApplied(visibleRows[drawer])}
              saved={!!visibleRows[drawer].url && savedUrls.has(visibleRows[drawer].url!)}
              savedCount={savedCount}
              onToggleSave={() => toggleSave(visibleRows[drawer])}
              inline
            />
          </div>
        )}
      </div>

      {/* Mobile slide-over (detail-pane is hidden on mobile, drawer is shown) */}
      {drawer >= 0 && visibleRows[drawer] && (
        <DetailDrawer
          row={visibleRows[drawer]}
          today={today}
          onClose={() => setDrawer(-1)}
          onEnqueue={enqueue}
          onMarkApplied={() => markApplied(visibleRows[drawer])}
          saved={!!visibleRows[drawer].url && savedUrls.has(visibleRows[drawer].url!)}
          savedCount={savedCount}
          onToggleSave={() => toggleSave(visibleRows[drawer])}
          inline={false}
        />
      )}

      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {appliedDialog}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
