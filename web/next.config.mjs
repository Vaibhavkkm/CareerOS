/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app shells out to the repo's zero-token scripts at runtime (child
  // processes) — there is nothing from outside web/ to transpile or bundle.
  reactStrictMode: true,
  // Lint is run separately; never let a style nit block the local control panel.
  eslint: { ignoreDuringBuilds: true },
  // Local-only tool: don't ship a powered-by header.
  poweredByHeader: false,
};

export default nextConfig;
