'use client';
import type { ReactElement } from 'react';

interface P {
  size?: number;
}
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.25,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconScan = ({ size = 14 }: P): ReactElement => (
  <svg {...base(size)}>
    <path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2" />
    <path d="M2 8h12" />
  </svg>
);

export const IconHunt = ({ size = 14 }: P): ReactElement => (
  <svg {...base(size)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </svg>
);

export const IconRefresh = ({ size = 14 }: P): ReactElement => (
  <svg {...base(size)}>
    <path d="M13.5 7a5.5 5.5 0 1 0-1.2 4.3" />
    <path d="M13.5 3v4h-4" />
  </svg>
);

export const IconGlobe = ({ size = 14 }: P): ReactElement => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c1.8 1.6 2.8 3.8 2.8 6S9.8 12.4 8 14M8 2C6.2 3.6 5.2 5.8 5.2 8S6.2 12.4 8 14" />
  </svg>
);

export const IconClose = ({ size = 14 }: P): ReactElement => (
  <svg {...base(size)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const IconExternal = ({ size = 13 }: P): ReactElement => (
  <svg {...base(size)}>
    <path d="M6 3H3v10h10v-3" />
    <path d="M9 3h4v4M13 3 7 9" />
  </svg>
);

export const IconDoc = ({ size = 13 }: P): ReactElement => (
  <svg {...base(size)}>
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3M6 8h4M6 11h4" />
  </svg>
);

export const IconBolt = ({ size = 13 }: P): ReactElement => (
  <svg {...base(size)}>
    <path d="M8.5 2 4 9h3l-.5 5L11 7H8z" />
  </svg>
);

export const IconPulse = ({ size = 13 }: P): ReactElement => (
  <svg {...base(size)}>
    <path d="M2 8h3l1.5-4 3 8L13 8h1" />
  </svg>
);

export const IconChevron = ({ size = 13 }: P): ReactElement => (
  <svg {...base(size)}>
    <path d="M6 4l4 4-4 4" />
  </svg>
);
