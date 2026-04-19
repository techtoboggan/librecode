#!/usr/bin/env bash
# scripts/generate-sboms.sh — Emit CycloneDX SBOMs for the JS and Rust dep
# graphs. Output: sbom-npm.json + sbom-rust.json at the repo root.
#
# OWASP A08 (Software and Data Integrity Failures). SBOMs let a consumer
# (or a security scanner) enumerate every dependency that shipped in a
# release without having to reverse-engineer the bundle.
#
# Usage:
#   scripts/generate-sboms.sh           # local run
#   scripts/generate-sboms.sh --ci      # CI run (expects tools pre-installed)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CI_MODE=0
if [[ "${1:-}" == "--ci" ]]; then
  CI_MODE=1
fi

echo "→ Generating JS/TS SBOM via @cyclonedx/cdxgen..."
if ! command -v node &>/dev/null; then
  echo "node is required"
  exit 1
fi

# @cyclonedx/cdxgen natively supports bun workspaces (unlike cyclonedx-npm
# which needs a standard node_modules + package-lock.json tree and bails on
# bun.lock). It reads the workspace graph directly and emits CycloneDX JSON.
#
# --type js  — scan the JS/TS workspace
# --no-auto-compositions — keep the SBOM self-contained (no network lookups)
# --spec-version 1.5 — CycloneDX 1.5
npx -y "@cyclonedx/cdxgen@^11" -t js --spec-version 1.5 -o sbom-npm.json .
echo "  ✓ sbom-npm.json"

echo "→ Generating Rust SBOM via cargo-cyclonedx..."
if ! command -v cargo-cyclonedx &>/dev/null; then
  if [[ $CI_MODE -eq 1 ]]; then
    echo "cargo-cyclonedx not on PATH; CI must install it first"
    exit 1
  fi
  echo "  installing cargo-cyclonedx..."
  cargo install cargo-cyclonedx --locked
fi

pushd packages/desktop/src-tauri >/dev/null
cargo cyclonedx --format json --override-filename ../../../sbom-rust
popd >/dev/null
# cargo-cyclonedx appends .cdx.json when using --override-filename; normalise:
if [[ -f sbom-rust.cdx.json ]]; then
  mv sbom-rust.cdx.json sbom-rust.json
fi
echo "  ✓ sbom-rust.json"

echo ""
echo "✅ SBOMs generated:"
ls -lh sbom-npm.json sbom-rust.json 2>&1 | awk '{print "   " $0}'
