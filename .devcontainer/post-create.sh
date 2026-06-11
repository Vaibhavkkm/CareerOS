#!/usr/bin/env bash
# CareerOS devcontainer bootstrap — everything a fresh user needs to reach
# their first PDF. Each step degrades gracefully; doctor reports what's missing.
set -x

sudo apt-get update -y
# poppler-utils → pdftotext (ATS check + reading uploaded PDF CVs)
# tectonic     → the LaTeX engine (in Debian/Ubuntu repos; fallback hint if absent)
sudo apt-get install -y --no-install-recommends poppler-utils
sudo apt-get install -y --no-install-recommends tectonic \
  || echo "tectonic not in apt — install manually: https://tectonic-typesetting.github.io/install.html"

npm install
(cd web && npm install)

# Optional multi-board fetch sidecar (python-jobspy); fine if it fails.
npm run jobspy:install || echo "jobspy sidecar optional — skipped"

node scripts/doctor.mjs --fix || true
