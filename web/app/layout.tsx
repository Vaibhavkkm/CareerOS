import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ForkGateHost } from '@/components/ForkGate';

export const metadata: Metadata = {
  title: 'CareerOS',
  description: 'CareerOS — local control panel for your CV + cover-letter pipeline.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ForkGateHost />
      </body>
    </html>
  );
}
