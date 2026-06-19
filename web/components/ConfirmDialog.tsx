'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<Element | null>(null);
  // Hold the latest onCancel so the mount-only effect never re-runs (and steals
  // focus) just because the parent re-renders with a fresh inline callback.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Self-contained dialog semantics so a confirm can safely open ON TOP of another
  // focus-trapping surface (e.g. the board's mobile job drawer). We listen in the
  // CAPTURE phase and stopPropagation Tab/Escape, so this runs BEFORE — and shields
  // the event from — any ancestor window/document keydown handler (the drawer's own
  // trap + Escape-to-close, the board page's Escape-to-close). Without this, Tab is
  // pinned behind the modal and Escape closes the drawer instead of the dialog.
  useEffect(() => {
    prevFocusRef.current = document.activeElement;

    const focusables = () =>
      Array.from(
        cardRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    // Focus the first control (cancel) so a stray Enter can't confirm a Class-A action.
    const t = setTimeout(() => focusables()[0]?.focus(), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      e.stopPropagation(); // keep the wrap inside this modal; don't leak to the drawer trap
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true); // capture phase

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      (prevFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal__card" ref={cardRef} role="dialog" aria-modal="true">
        <div className="modal__h">{title}</div>
        <div className="modal__p">{body}</div>
        <div className="modal__row">
          <button className="btn btn--ghost" onClick={onCancel}>
            cancel
          </button>
          <button className="btn btn--primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
