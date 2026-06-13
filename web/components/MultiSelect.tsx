'use client';
import { useEffect, useRef, useState } from 'react';

// A compact multi-select: a button showing the current selection that opens a
// checkbox panel. Empty selection means "all / any" (no filter). Used for the
// Country and Type board filters so several can be ticked at once.
export function MultiSelect({
  options,
  selected,
  onChange,
  emptyLabel = 'Any',
  width = 170,
  disabled,
  ariaLabel,
}: {
  options: [string, string][]; // [value, label]
  selected: string[];
  onChange: (vals: string[]) => void;
  emptyLabel?: string;
  width?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
        return;
      }
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onDoc);
    };
  }, [open]);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? options.find((o) => o[0] === selected[0])?.[1] || selected[0]
        : `${selected.length} selected`;

  return (
    <div className="ms" ref={ref}>
      <button
        type="button"
        className="input ms__btn"
        style={{ width }}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={selected.length > 1 ? selected.join(', ') : undefined}
      >
        <span className="ms__summary">{summary}</span>
        <span className="ms__caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="ms__panel" role="listbox" aria-multiselectable>
          <div className="ms__head">
            <span className="ms__count">{selected.length ? `${selected.length} selected` : emptyLabel}</span>
            {selected.length > 0 && (
              <button type="button" className="ms__clear" onClick={() => onChange([])}>
                clear
              </button>
            )}
          </div>
          {options.map(([val, lab]) => {
            const on = selected.includes(val);
            return (
              <label key={val || '_'} className={`ms__opt ${on ? 'is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(val)} />
                <span className="ms__box" aria-hidden>
                  {on ? '✓' : ''}
                </span>
                <span className="ms__lab">{lab}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
