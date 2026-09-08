#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing & building frontend"
npm --prefix frontend install
npm --prefix frontend run build

echo "==> Copying frontend dist into backend/public/"
rm -rf backend/public
mkdir -p backend/public
cp -R frontend/dist/. backend/public/

echo "==> Installing backend"
npm --prefix backend install

echo "==> Build ready (API will serve backend/public)"
