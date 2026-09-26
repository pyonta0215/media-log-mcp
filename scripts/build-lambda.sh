#!/bin/sh
# Lambda に載せるファイルだけを dist/ に集める。
# SAM CLI は .samignore を読まないため、CodeUri にリポジトリ直下を指定すると
# .git/ や samconfig.toml(秘匿パスの実値)までパッケージに入ってしまう。それを避けるための専用ディレクトリ。
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
cp lambda.mjs app.mjs mcp-server.mjs package.json package-lock.json dist/
cp -R lib dist/lib
(cd dist && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
echo "built dist/ ($(du -sh dist | cut -f1))"
