#!/usr/bin/env bash
# Build a Docker image for the Wojakcoin-themed frontend (required for W address UI; stock mempool/frontend is Bitcoin-only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cp "$ROOT/production/mempool-frontend-config.wojakcoin.json" "$ROOT/frontend/mempool-frontend-config.json"
docker build -f "$ROOT/docker/frontend/Dockerfile" -t wojak-mempool-frontend:latest "$ROOT/frontend"
echo "Image: wojak-mempool-frontend:latest — set docker-compose web.image to this tag."
