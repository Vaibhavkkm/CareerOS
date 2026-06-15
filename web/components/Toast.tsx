'use client';
import { useCallback, useState } from 'react';

export type ToastKind = 'ok' | 'err' | 'info';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: string;
  leaving?: boolean;
}

let counter = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = 'info', ttl = 4600) => {
    const id = ++counter;
    setToasts((t) => [...t, { id, kind, msg }]);
    if (ttl > 0) {
      // Step 7: mark leaving first (exit animation), then remove
      setTimeout(() => {
        setToasts((t) => t.map((x) => x.id === id ? { ...x, leaving: true } : x));
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 240);
      }, ttl);
    }
    return id;
  }, []);
  const dismiss = useCallback((id: number) => {
    // Step 7: animate out before removing
    setToasts((t) => t.map((x) => x.id === id ? { ...x, leaving: true } : x));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 240);
  }, []);
  return { toasts, push, dismiss };
}

// Step 6: single Toaster with aria-live regions for ok/info and assertive for err.
// Step 9: the Toaster is lifted to each page so there is only one host per page.
export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss?: (id: number) => void }) {
  const okInfoToasts = toasts.filter((t) => t.kind !== 'err');
  const errToasts = toasts.filter((t) => t.kind === 'err');
  return (
    <>
      {/* Polite region for ok/info toasts */}
      <div className="toaster" role="status" aria-live="polite" aria-atomic="false">
        {okInfoToasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast--${t.kind}${t.leaving ? ' toast--leaving' : ''}`}
            onClick={() => onDismiss?.(t.id)}
            title="Click to dismiss"
          >
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      {/* Assertive region for errors — announced immediately */}
      {errToasts.length > 0 && (
        <div
          className="toaster"
          role="alert"
          aria-live="assertive"
          aria-atomic="false"
          style={{ marginTop: errToasts.length > 0 ? `calc(${okInfoToasts.length} * (10px + 12px + 8px + 8px))` : 0 }}
        >
          {errToasts.map((t) => (
            <div
              key={t.id}
              className={`toast toast--${t.kind}${t.leaving ? ' toast--leaving' : ''}`}
              onClick={() => onDismiss?.(t.id)}
              title="Click to dismiss"
            >
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
