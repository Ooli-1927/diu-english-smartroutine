#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing & building web"
npm --prefix smartroutine-web install
npm --prefix smartroutine-web run build

echo "==> Copying web dist into API public/"
rm -rf smartroutine-api/public
mkdir -p smartroutine-api/public
cp -R smartroutine-web/dist/. smartroutine-api/public/

echo "==> Installing API"
npm --prefix smartroutine-api install

echo "==> Build ready (API will serve smartroutine-api/public)"
