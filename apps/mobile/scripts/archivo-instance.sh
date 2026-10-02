#!/usr/bin/env bash
# Genera assets/fonts/ArchivoPickler-Bold.ttf: Archivo (OFL, google/fonts) instanciado a wdth 112 / wght 700,
# el `font-variation-settings:'wdth' 112` del Handoff (spec mobile-light D4). RN no garantiza ejes variables en iOS.
# Uso: scripts/archivo-instance.sh <directorio-temporal>
set -euo pipefail
TMP="${1:?directorio temporal}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/fonts/ArchivoPickler-Bold.ttf"
mkdir -p "$TMP" "$(dirname "$OUT")"
python3 -m venv "$TMP/ftvenv"
"$TMP/ftvenv/bin/pip" install -q fonttools
curl -sSfL -o "$TMP/Archivo-VF.ttf" "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf"
"$TMP/ftvenv/bin/fonttools" varLib.instancer "$TMP/Archivo-VF.ttf" wdth=112 wght=700 -o "$TMP/Archivo-112-Bold.ttf"
"$TMP/ftvenv/bin/python" - "$TMP/Archivo-112-Bold.ttf" "$OUT" <<'PY'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
n = f["name"]
for nid, val in [(1, "Archivo Pickler"), (2, "Bold"), (4, "Archivo Pickler Bold"), (6, "ArchivoPickler-Bold"), (16, "Archivo Pickler"), (17, "Bold")]:
    n.setName(val, nid, 3, 1, 0x409)
f.save(sys.argv[2])
print("ok", sys.argv[2], "fvar" in f, f["hmtx"]["H"][0])
PY
