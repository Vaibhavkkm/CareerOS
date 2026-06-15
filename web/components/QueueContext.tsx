'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { QueueRequest } from '@/lib/types';
import { api } from '@/components/util';
import { IS_PUBLIC } from '@/lib/public';

interface QueueContextValue {
  requests: QueueRequest[];
  reload: () => void;
}

export const QueueContext = createContext<QueueContextValue>({ requests: [], reload: () => {} });

export function QueueProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<QueueRequest[]>([]);
  const load = useCallback(async () => {
    const r = await api<{ ok: boolean; requests?: QueueRequest[] }>('/api/queue');
    if (r && Array.isArray(r.requests)) setRequests(r.requests);
  }, []);
  useEffect(() => {
    if (IS_PUBLIC) return;
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  return <QueueContext.Provider value={{ requests, reload: load }}>{children}</QueueContext.Provider>;
}

export const useQueue = () => useContext(QueueContext);
