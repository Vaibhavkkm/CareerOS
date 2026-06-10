import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app shells out to the repo's zero-token scripts at runtime (child
  // processes) — there is nothing from outside web/ to transpile or bundle.
  reactStrictMode: true,
  // The repo root has its own package-lock (the engine); without this Next
  // infers the workspace root from it and warns. web/ is self-contained.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // Lint is run separately; never let a style nit block the local control panel.
  eslint: { ignoreDuringBuilds: true },
  // Local-only tool: don't ship a powered-by header.
  poweredByHeader: false,
};

export default nextConfig;
