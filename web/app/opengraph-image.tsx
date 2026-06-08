import { ImageResponse } from 'next/og';

// Link-preview card (1200×630) for careeros.vaibhavkkm.com — Next wires this into
// both the OpenGraph and Twitter image tags automatically.
export const runtime = 'edge';
export const alt = 'CareerOS — AI-tailored CVs and a CV-ranked job board';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#000000',
          color: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 104, fontWeight: 800, letterSpacing: '0.04em' }}>
          <span>CAREER</span>
          <span style={{ color: '#8c8c8c' }}>OS</span>
          <span style={{ width: 26, height: 92, background: '#d8b24a', marginLeft: 18 }} />
        </div>
        <div style={{ marginTop: 36, fontSize: 40, color: '#b0b0b0', lineHeight: 1.35, maxWidth: 1000 }}>
          Tailored, ATS-safe CVs &amp; cover letters that learn your voice — plus a job board ranked to your CV.
        </div>
        <div style={{ display: 'flex', marginTop: 56, fontSize: 28, color: '#d8b24a', letterSpacing: '0.08em' }}>
          careeros.vaibhavkkm.com
        </div>
      </div>
    ),
    { ...size },
  );
}
