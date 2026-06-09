'use client';
import { useCallback, useEffect, useRef } from 'react';
import type { QueueRequest } from '@/lib/types';
import { api } from './util';
import { Toaster, useToasts } from './Toast';
import { IS_PUBLIC } from '@/lib/public';

// Global, app-wide watcher: polls the agent queue and NOTIFIES when a task the user
// triggered from the website FINISHES — a toast on the dashboard plus an OS desktop
// notification (if the user allowed it). It is mounted once in the root layout, so
// the notification fires on whatever page the user is on (or even another tab).
//
// This is the "how do I know when it's ready?" half of the web↔agent handshake: the
// browser has no LLM, so the in-session /cos agent does the work and flips the
// request's status; this component watches that flip (queued/claimed → done/failed)
// and tells the user, without them having to stare at the terminal.

const LABELS: Record<string, string> = {
  evaluate: 'Job evaluation',
  'build-cv': 'CV build',
  'build-cl': 'Cover letter',
  apply: 'Application answers',
  hunt: 'Job hunt',
  onboard: 'CV onboarding',
};

function label(req: QueueRequest): string {
  if (req.kind === 'command') {
    const cmd = (req.args as { cmd?: string })?.cmd;
    return cmd ? cmd.replace(/-/g, ' ') : 'command';
  }
  return LABELS[req.kind] || req.kind;
}

export function QueueWatcher() {
  const { toasts, push, dismiss } = useToasts();
  // Last seen status per request id — so we only fire on a TRANSITION, not every poll.
  const seen = useRef<Map<string, string>>(new Map());
  const primed = useRef(false);

  // Ask for desktop-notification permission once (best-effort; a no-op if the user
  // already decided or the API is unavailable).
  useEffect(() => {
    if (IS_PUBLIC) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const notify = useCallback(
    (req: QueueRequest) => {
      const done = req.status === 'done';
      const title = `${label(req)} ${done ? 'complete' : 'failed'}`;
      const body = done
        ? resultHint(req)
        : (req.error || 'see Claude Code for details');
      push(`${title} — ${body}`, done ? 'ok' : 'err', 8000);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(`CareerOS · ${title}`, { body, tag: `careeros-${req.id}`, icon: '/icon.svg' });
        } catch {
          /* some environments throw on construct — the toast already covered it */
        }
      }
    },
    [push],
  );

  const load = useCallback(async () => {
    const r = await api<{ ok: boolean; requests?: QueueRequest[] }>('/api/queue');
    if (!r || !Array.isArray(r.requests)) return;
    const prev = seen.current;
    const next = new Map<string, string>();
    for (const req of r.requests) {
      next.set(req.id, req.status);
      const was = prev.get(req.id);
      // Fire only on a real transition INTO a terminal state. `primed` skips the
      // very first poll so we don't announce tasks that finished before the page
      // even loaded.
      if (primed.current && was && was !== req.status && (req.status === 'done' || req.status === 'failed')) {
        notify(req);
      }
    }
    seen.current = next;
    primed.current = true;
  }, [notify]);

  useEffect(() => {
    if (IS_PUBLIC) return;
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  return <Toaster toasts={toasts} onDismiss={dismiss} />;
}

// A short, human hint about what landed, pulled from the request result if present.
function resultHint(req: QueueRequest): string {
  const r = req.result as Record<string, unknown> | null;
  if (r && typeof r === 'object') {
    if (typeof r.pdf === 'string') return `PDF ready: ${String(r.pdf).split('/').pop()}`;
    if (typeof r.report === 'string') return `report: ${String(r.report).split('/').pop()}`;
    if (typeof r.notes === 'string' && r.notes) return String(r.notes);
  }
  if (req.kind === 'onboard') return 'master CV updated — refresh the board';
  if (req.kind === 'hunt') return 'new matches on your board';
  return 'done — check the board';
}
