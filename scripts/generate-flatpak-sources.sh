#!/usr/bin/env bash
# generate-flatpak-sources.sh
#
# Generates `packages/desktop/flatpak/cargo-sources.json` from the current
# `Cargo.lock`. Downloads flatpak-cargo-generator.py on demand — no system-level
# install needed beyond python3 + the `aiohttp` + `tomlkit` packages.
#
# Usage (from repo root):
#   ./scripts/generate-flatpak-sources.sh
#
# Prereqs:
#   python3 -m pip install --user aiohttp tomlkit
#
# Output:
#   packages/desktop/flatpak/cargo-sources.json
#
# Run this whenever Cargo.lock changes (rust deps updated, desktop binary
# version bumped, etc.). The generated file is committed to the repo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARGO_LOCK="${REPO_ROOT}/packages/desktop/src-tauri/Cargo.lock"
OUTPUT="${REPO_ROOT}/packages/desktop/flatpak/cargo-sources.json"
GENERATOR_URL="https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/master/cargo/flatpak-cargo-generator.py"

if [[ ! -f "${CARGO_LOCK}" ]]; then
  echo "error: ${CARGO_LOCK} not found" >&2
  exit 1
fi

# Verify python and required modules
if ! python3 -c "import aiohttp, tomlkit" 2>/dev/null; then
  echo "error: python3 missing 'aiohttp' and/or 'tomlkit' modules" >&2
  echo "install with: python3 -m pip install --user aiohttp tomlkit" >&2
  exit 1
fi

# Download generator if not already cached
GENERATOR_CACHE="$(mktemp -d)/flatpak-cargo-generator.py"
trap 'rm -rf "$(dirname "${GENERATOR_CACHE}")"' EXIT

echo "Fetching flatpak-cargo-generator.py…"
if ! curl -fsSL "${GENERATOR_URL}" -o "${GENERATOR_CACHE}"; then
  echo "error: failed to download ${GENERATOR_URL}" >&2
  exit 1
fi

echo "Generating ${OUTPUT}…"
python3 "${GENERATOR_CACHE}" "${CARGO_LOCK}" -o "${OUTPUT}"

if [[ -f "${OUTPUT}" ]]; then
  entries=$(python3 -c "import json; print(len(json.load(open('${OUTPUT}'))))")
  size=$(stat -c%s "${OUTPUT}")
  echo "Success: ${entries} cargo entries, $((size / 1024)) KB"
else
  echo "error: generator did not produce ${OUTPUT}" >&2
  exit 1
fi
