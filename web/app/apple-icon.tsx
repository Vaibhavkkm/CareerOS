import { ImageResponse } from 'next/og';

// iOS home-screen icon (180×180) — the brand 'C' + amber accent, so "Add to Home
// Screen" shows the mark instead of a blurry screenshot.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <div style={{ color: '#fafafa', fontSize: 116, fontWeight: 800 }}>C</div>
        <div style={{ position: 'absolute', bottom: 36, width: 64, height: 8, background: '#d8b24a' }} />
      </div>
    ),
    { ...size },
  );
}
