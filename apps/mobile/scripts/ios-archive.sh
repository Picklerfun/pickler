#!/usr/bin/env bash
# Archive + export del .ipa. Lecciones heredadas de Proflores (2026-08-18):
# clean archive siempre; verificar identidad Apple Distribution ANTES de archivar.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

_k="${ASC_KEY_ID-}"; _i="${ASC_ISSUER_ID-}"
if [ -f .env.asc ]; then set -a; . ./.env.asc; set +a; fi
[ -n "$_k" ] && ASC_KEY_ID="$_k"; [ -n "$_i" ] && ASC_ISSUER_ID="$_i"
: "${ASC_KEY_ID:?falta ASC_KEY_ID — ver .env.asc}"
: "${ASC_ISSUER_ID:?falta ASC_ISSUER_ID — ver .env.asc}"
KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
[ -f "$KEY_PATH" ] || { echo "❌ no existe $KEY_PATH"; exit 1; }

if ! security find-identity -v -p codesigning | grep -q "Apple Distribution"; then
  echo "❌ no hay identidad 'Apple Distribution' en el llavero; App Store Connect rechazará el .ipa."
  echo "   Xcode → Settings → Accounts → Manage Certificates → + → Apple Distribution."
  exit 1
fi

rm -rf build
npx expo prebuild --platform ios --clean

xcodebuild -workspace ios/Pickler.xcworkspace -scheme Pickler \
  -destination 'generic/platform=iOS' \
  -archivePath build/Pickler.xcarchive \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  DEVELOPMENT_TEAM=2PBQJ37Q8W \
  clean archive

xcodebuild -exportArchive \
  -archivePath build/Pickler.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo "✓ $DIR/build/export/Pickler.ipa"
