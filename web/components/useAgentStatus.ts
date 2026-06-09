'use client';
import { useEffect, useState } from 'react';
import { api } from './util';
import { IS_PUBLIC } from '@/lib/public';

// Polls /api/agent-status so the UI can tell the user whether a `/cos ui watch`
// agent is live (clicking an action runs it automatically in their terminal) or
// not (it just queues for a manual /cos ui). No API key — pure heartbeat reflection.
export function useAgentStatus(intervalMs = 5000): { watching: boolean; loaded: boolean } {
  const [watching, setWatching] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (IS_PUBLIC) { setLoaded(true); return; }
    let alive = true;
    const tick = async () => {
      const r = await api<{ ok: boolean; watching?: boolean }>('/api/agent-status');
      if (!alive) return;
      setWatching(!!r?.watching);
      setLoaded(true);
    };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);

  return { watching, loaded };
}
