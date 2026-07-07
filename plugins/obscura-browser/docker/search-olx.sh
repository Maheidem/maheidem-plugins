#!/usr/bin/env bash
# Search OLX through the stealth Obscura build and print the results as text.
# Usage:  ./search-olx.sh "mini pc ryzen"
# No running container needed — spins a throwaway stealth browser per call.
set -euo pipefail

QUERY="${*:-mini pc ryzen}"
IMAGE="obscura-stealth:local"

# URL-encode spaces (enough for typical search terms).
ENC="${QUERY// /%20}"
URL="https://www.olx.com.br/brasil?q=${ENC}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not found. Build it first:" >&2
  echo "  docker build -t $IMAGE \"$(dirname "$0")\"" >&2
  exit 1
fi

echo "# Searching OLX for: ${QUERY}" >&2
docker run --rm "$IMAGE" fetch --stealth --dump text "$URL" 2>/dev/null \
  | grep -iE 'resultados|R\$' \
  | sed '/^[[:space:]]*$/d'
