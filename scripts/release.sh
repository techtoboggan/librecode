#!/usr/bin/env bash
# scripts/release.sh — Prepare and tag a LibreCode release.
#
# Usage:
#   scripts/release.sh 1.0.0-preview.2
#
# What it does:
#   1. Bumps the version in all package.json files and Cargo.toml
#   2. Runs bun install to update bun.lock with the new @librecode/i18n version
#   3. Commits everything
#   4. Tags the commit
#   5. Reminds you to push i18n and providers tags first
#
# Does NOT push automatically — review the commit, then push manually.

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: scripts/release.sh <version>  (e.g. 1.0.0-preview.2)"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Verify clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

echo "→ Bumping version to $VERSION in all package.json files..."
for pkg in \
  packages/librecode/package.json \
  packages/app/package.json \
  packages/desktop/package.json \
  packages/sdk/js/package.json \
  packages/ui/package.json \
  packages/util/package.json \
  packages/plugin/package.json; do
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
    p.version = '$VERSION';
    fs.writeFileSync('$pkg', JSON.stringify(p, null, 2) + '\n');
  "
  echo "  ✓ $pkg"
done

echo "→ Bumping Cargo.toml..."
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" packages/desktop/src-tauri/Cargo.toml
echo "  ✓ packages/desktop/src-tauri/Cargo.toml"

echo "→ Running bun install to update bun.lock..."
bun install
echo "  ✓ bun.lock updated"

echo "→ Staging all changes..."
git add \
  packages/librecode/package.json \
  packages/app/package.json \
  packages/desktop/package.json \
  packages/sdk/js/package.json \
  packages/ui/package.json \
  packages/util/package.json \
  packages/plugin/package.json \
  packages/desktop/src-tauri/Cargo.toml \
  bun.lock

echo "→ Committing..."
git commit -m "chore: bump version to $VERSION"

echo "→ Tagging v$VERSION..."
git tag "v$VERSION"

echo ""
echo "✅ Done. Before pushing the main repo tag, make sure:"
echo ""
echo "   1. librecode-i18n is tagged and @librecode/i18n@$VERSION is on npm:"
echo "      cd ../librecode-i18n && git tag v$VERSION && git push && git push --tags"
echo "      npm view @librecode/i18n@$VERSION version  # wait until this returns"
echo ""
echo "   2. librecode-3rdparty-providers is tagged:"
echo "      cd ../librecode-3rdparty-providers && git tag v$VERSION && git push --tags"
echo ""
echo "   3. Then push the main repo:"
echo "      git push && git push --tags"
