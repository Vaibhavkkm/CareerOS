'use client';
import { useEffect, useRef, useState } from 'react';

// Step 10: inline SVG check icon — matches Icons.tsx style (16×16 viewBox, stroke only)
const CheckIcon = () => (
  <svg
    width={10}
    height={10}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3 8l3 3 7-7" />
  </svg>
);

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
                {/* Step 10: SVG check icon instead of ✓ text; ms__lab gets min-width:0 + ellipsis in CSS */}
                <span className="ms__box" aria-hidden>
                  <CheckIcon />
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
