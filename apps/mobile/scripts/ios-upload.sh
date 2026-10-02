#!/usr/bin/env bash
# altool SALE CON 0 aunque la subida falle (medido en Proflores 2026-08-18): se grep-ea la salida.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IPA="$DIR/build/export/Pickler.ipa"
_k="${ASC_KEY_ID-}"; _i="${ASC_ISSUER_ID-}"
if [ -f "$DIR/.env.asc" ]; then set -a; . "$DIR/.env.asc"; set +a; fi
[ -n "$_k" ] && ASC_KEY_ID="$_k"; [ -n "$_i" ] && ASC_ISSUER_ID="$_i"
: "${ASC_KEY_ID:?}"; : "${ASC_ISSUER_ID:?}"
[ -f "$IPA" ] || { echo "❌ no existe $IPA — corre scripts/ios-archive.sh"; exit 1; }

OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT
set +e
xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1 | tee "$OUT"
set -e
if grep -qiE "UPLOAD FAILED|ERROR ITMS|Validation failed" "$OUT"; then
  echo "❌ la subida FALLÓ (altool salió con 0 de todos modos)."; exit 1
fi
echo "✓ subida aceptada"
