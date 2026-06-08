'use client';
import type { Band } from '@/lib/types';
import { bandClass } from './util';

// The band as a small colored dot + label, colored by the band ramp. (The ★ glyphs
// were redundant with the label, which already reads STRONG / VERY STRONG / etc.)
export function BandStars({ band, showLabel = true }: { band: Band; showLabel?: boolean }) {
  return (
    <span className={`stars ${bandClass(band)}`}>
      <span className="stars__dot" aria-hidden />
      {showLabel && <span className="stars__label">{band}</span>}
    </span>
  );
}
