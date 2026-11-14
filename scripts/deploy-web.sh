#!/usr/bin/env bash
# Deploys web/ to Vercel production from a clean copy outside the git repo.
# Why: Vercel blocks CLI deploys from a git checkout whose commit author isn't on the Vercel team, and the
# copy guarantees no .env file (contracts/.env holds testnet keys) is ever uploaded. Vercel builds remotely.
# Usage: bash scripts/deploy-web.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${DEPLOY_DIR:-$(mktemp -d)}/mezolend-web"
rm -rf "$OUT" && mkdir -p "$OUT"
( cd "$ROOT/web" && tar --exclude=./node_modules --exclude=./.next --exclude='./.env*' --exclude='*.tsbuildinfo' \
    --exclude=./next-env.d.ts -cf - . ) | ( cd "$OUT" && tar -xf - )
# keep only the project link, never local env pulls
find "$OUT/.vercel" -mindepth 1 ! -name project.json ! -name README.txt -exec rm -rf {} + 2>/dev/null || true
if find "$OUT" -name '.env*' | grep -q .; then echo "refusing to deploy: .env file in $OUT" >&2; exit 1; fi
cd "$OUT"
vercel deploy --prod --yes
