import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ForkGateHost } from '@/components/ForkGate';

const SITE_URL = 'https://careeros.vaibhavkkm.com';
const DESCRIPTION =
  'CareerOS learns how you write from your own CV and cover letter, then tailors new ATS-safe CV + cover-letter PDFs to any job — and ranks live openings by how well they fit you. Agent-native: runs locally inside your own AI coding agent (Claude Code, Cursor, Codex, Gemini CLI, …) — no server, no API key.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'CareerOS — tailored CVs & cover letters + a CV-ranked job board',
    template: '%s · CareerOS',
  },
  description: DESCRIPTION,
  applicationName: 'CareerOS',
  authors: [{ name: 'VaibhavKKM', url: 'https://www.vaibhavkkm.com' }],
  creator: 'VaibhavKKM',
  keywords: [
    'CareerOS', 'CV', 'resume', 'cover letter', 'ATS', 'applicant tracking system',
    'job search', 'job board', 'LaTeX', 'AI agent', 'Claude Code', 'Cursor', 'Codex', 'Gemini CLI', 'AI resume', 'tailored resume',
  ],
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'CareerOS',
    title: 'CareerOS — tailored CVs & cover letters + a CV-ranked job board',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CareerOS — tailored CVs & cover letters + a CV-ranked job board',
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <ForkGateHost />
      </body>
    </html>
  );
}
