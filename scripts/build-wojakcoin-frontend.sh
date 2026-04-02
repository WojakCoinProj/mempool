#!/usr/bin/env bash
# Build the browser bundle with Wojakcoin branding, address regex, and NATIVE_ASSET_SYMBOL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
cp "$ROOT/production/mempool-frontend-config.wojakcoin.json" mempool-frontend-config.json
npm ci
npm run build
echo "Built static site at frontend/dist/mempool — configure nginx or use docker/frontend."
