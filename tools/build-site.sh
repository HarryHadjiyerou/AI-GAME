#!/usr/bin/env bash
# Package the deployable site as a zip — for drag-and-drop hosts like Netlify
# Drop, or anywhere else that wants static files and nothing else.
#
# index.html is placed at the archive ROOT on purpose: hosts that unpack a zip
# look for it there, and a single wrapping folder is the usual reason a drag
# and drop deploy comes back as a 404.
#
# Verify the result actually stands alone:
#   AVES_ROOT=$(mktemp -d) ... unzip there ... then
#   AVES_ROOT=<that dir> node tools/smoke.mjs hawk
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/aves-site.zip}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp "$ROOT/index.html" "$STAGE/"
cp -r "$ROOT/styles" "$ROOT/src" "$STAGE/"
cp "$ROOT/docs/ASSETS.md" "$STAGE/ASSETS.md"

rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" . -x '.*' )
echo "$OUT  ($(du -h "$OUT" | cut -f1))"
