#!/usr/bin/env bash
set -euo pipefail

INDEX_NAME="${FILECOIN_DOCS_QMD_INDEX_NAME:-filecoin}"
INDEX_URL="${FILECOIN_DOCS_QMD_INDEX_URL:-https://bafybeid7e7ol5ixossv4bzbbcvuvubz57sf2dwoolw6adzguyx2o4bj6o4.pinmeapi.com/ipfs/bafybeid7e7ol5ixossv4bzbbcvuvubz57sf2dwoolw6adzguyx2o4bj6o4/index.sqlite.zst}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/qmd"
DB="$CACHE_DIR/$INDEX_NAME.sqlite"
TMP="$DB.tmp"

if ! command -v zstd >/dev/null 2>&1; then
  echo "error: zstd is required" >&2
  exit 1
fi

mkdir -p "$CACHE_DIR"
trap 'rm -f "$TMP"' EXIT

curl -fsSL "$INDEX_URL" | zstd -q -dc -o "$TMP"
mv "$TMP" "$DB"

echo "Installed: $DB"
echo "Run: qmd --index $INDEX_NAME search \"storage provider\""
echo "Run: qmd --index $INDEX_NAME query \"how does lotus handle deal onboarding\""
