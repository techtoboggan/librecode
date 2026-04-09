#!/usr/bin/env bash
#
# LibreCode Development Environment Setup
#
# Creates an isolated dev environment that doesn't touch your real
# config/data directories. Everything goes to .dev/ in the project root.
#
# Usage:
#   source scripts/dev-setup.sh     # Sets env vars for current shell
#   scripts/dev-setup.sh --info     # Show current dev env paths
#   scripts/dev-setup.sh --clean    # Remove dev data
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_DIR="$PROJECT_ROOT/.dev"

case "${1:-}" in
  --clean)
    echo "Removing dev environment at $DEV_DIR"
    rm -rf "$DEV_DIR"
    echo "Done."
    exit 0
    ;;
  --info)
    echo "Dev environment:"
    echo "  XDG_DATA_HOME:   ${XDG_DATA_HOME:-~/.local/share}"
    echo "  XDG_CONFIG_HOME: ${XDG_CONFIG_HOME:-~/.config}"
    echo "  XDG_CACHE_HOME:  ${XDG_CACHE_HOME:-~/.cache}"
    echo "  XDG_STATE_HOME:  ${XDG_STATE_HOME:-~/.local/state}"
    echo ""
    echo "  Database: ${XDG_DATA_HOME:-~/.local/share}/librecode/librecode.db"
    echo "  Config:   ${XDG_CONFIG_HOME:-~/.config}/librecode/librecode.json"
    echo "  Logs:     ${XDG_DATA_HOME:-~/.local/share}/librecode/log/"
    exit 0
    ;;
esac

# Create isolated directories
mkdir -p "$DEV_DIR/data" "$DEV_DIR/config" "$DEV_DIR/cache" "$DEV_DIR/state"

# Override XDG paths to isolate from real user data
export XDG_DATA_HOME="$DEV_DIR/data"
export XDG_CONFIG_HOME="$DEV_DIR/config"
export XDG_CACHE_HOME="$DEV_DIR/cache"
export XDG_STATE_HOME="$DEV_DIR/state"

# Disable features that don't make sense in dev
export LIBRECODE_DISABLE_AUTOUPDATE=true
export LIBRECODE_DISABLE_MODELS_FETCH=true
export LIBRECODE_DISABLE_TERMINAL_TITLE=true

# Add bun to PATH if installed in user home
if [ -d "$HOME/.bun/bin" ]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi

echo "LibreCode dev environment ready"
echo ""
echo "  Data:   $DEV_DIR/data/librecode/"
echo "  Config: $DEV_DIR/config/librecode/"
echo "  Cache:  $DEV_DIR/cache/librecode/"
echo "  DB:     $DEV_DIR/data/librecode/librecode.db"
echo ""
echo "Commands:"
echo "  bun run dev                    # CLI"
echo "  bun run dev:desktop            # Desktop (Tauri)"
echo "  bun run dev:web                # Web UI only"
echo "  bun test                       # Run tests"
echo ""
echo "Clean up: scripts/dev-setup.sh --clean"
