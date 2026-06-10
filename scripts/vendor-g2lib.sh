#!/usr/bin/env bash
# Vendort g2lib aus sirlensalot/g2fx (BSD-3-Clause) ins Backend.
# Pinne einen Commit, sobald ein stabiler Stand gefunden ist (g2fx ist WIP!).
set -euo pipefail
cd "$(dirname "$0")/.."

G2FX_REF="${1:-main}"
TMP=$(mktemp -d)
git clone --depth 1 --branch "$G2FX_REF" https://github.com/sirlensalot/g2fx "$TMP/g2fx"

mkdir -p backend/src/main/java/org/g2fx
cp -r "$TMP/g2fx/src/main/java/org/g2fx/g2lib" backend/src/main/java/org/g2fx/
# Moduldefinitionen/Testdaten (YAML) — vom Frontend als JSON ausgeliefert
mkdir -p backend/src/main/resources/g2data
cp -r "$TMP/g2fx/data/." backend/src/main/resources/g2data/ 2>/dev/null || true
cp "$TMP/g2fx/LICENSE" backend/src/main/java/org/g2fx/LICENSE-g2fx

rm -rf "$TMP"
echo "g2lib vendored (ref: $G2FX_REF)."
echo "Nächste Schritte: build.gradle.kts -> usb4java/jackson-yaml einkommentieren, Toolchain prüfen (g2fx nutzt Java 24)."
