#!/usr/bin/env bash
#
# LibreCode Development Environment Setup
#
# Creates an isolated dev environment that doesn't touch your real
# config/data directories. Everything goes to .dev/ in the project root.
#
# Usage:
#   source scripts/dev-setup.sh          # Sets env vars for current shell
#   scripts/dev-setup.sh --info          # Show current dev env paths
#   scripts/dev-setup.sh --clean         # Remove dev data
#   scripts/dev-setup.sh --deps          # Install system dependencies
#   scripts/dev-setup.sh --deps cli      # Install CLI-only dependencies
#   scripts/dev-setup.sh --deps desktop  # Install desktop (Tauri) dependencies
#

# Detect if we're being sourced or executed
_LC_SOURCED=0
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  _LC_SOURCED=1
fi

# Only use strict mode when executed directly (not sourced)
if [[ "$_LC_SOURCED" -eq 0 ]]; then
  set -euo pipefail
fi

# Resolve paths
if [[ "$_LC_SOURCED" -eq 1 ]]; then
  _LC_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  _LC_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
fi
_LC_PROJECT_ROOT="$(cd "$_LC_SCRIPT_DIR/.." && pwd)"
_LC_DEV_DIR="$_LC_PROJECT_ROOT/.dev"

# ── Dependency installation ──

_lc_install_deps_cli() {
  echo "Installing CLI dependencies..."
  echo ""

  if command -v dnf &>/dev/null; then
    echo "Detected Fedora/RHEL (dnf)"
    sudo dnf install -y ripgrep openssl-devel pkg-config git
  elif command -v apt &>/dev/null; then
    echo "Detected Debian/Ubuntu (apt)"
    sudo apt install -y ripgrep libssl-dev pkg-config git
  elif command -v pacman &>/dev/null; then
    echo "Detected Arch (pacman)"
    sudo pacman -S --needed ripgrep openssl pkg-config git
  elif command -v zypper &>/dev/null; then
    echo "Detected openSUSE (zypper)"
    sudo zypper install -y ripgrep libopenssl-devel pkg-config git
  elif command -v apk &>/dev/null; then
    echo "Detected Alpine (apk)"
    sudo apk add ripgrep openssl-dev pkgconfig git
  else
    echo "Unsupported package manager. Install manually:"
    echo "  ripgrep, openssl (dev headers), pkg-config, git"
    return 1
  fi

  # Bun
  if ! command -v bun &>/dev/null; then
    echo ""
    echo "Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi

  echo ""
  echo "CLI dependencies installed."
}

_lc_install_deps_desktop() {
  _lc_install_deps_cli

  echo ""
  echo "Installing desktop (Tauri) dependencies..."
  echo ""

  if command -v dnf &>/dev/null; then
    echo "Detected Fedora/RHEL (dnf)"
    sudo dnf install -y \
      gtk4-devel gtk3-devel \
      webkit2gtk4.1-devel \
      libsoup3-devel \
      librsvg2-devel \
      libappindicator-gtk3-devel \
      gstreamer1-devel \
      gstreamer1-plugins-base-devel \
      dbus-devel
  elif command -v apt &>/dev/null; then
    echo "Detected Debian/Ubuntu (apt)"
    sudo apt install -y \
      libgtk-4-dev libgtk-3-dev \
      libwebkit2gtk-4.1-dev \
      libsoup-3.0-dev \
      librsvg2-dev \
      libappindicator3-dev \
      libssl-dev \
      libgstreamer1.0-dev \
      libgstreamer-plugins-base1.0-dev \
      libdbus-1-dev
  elif command -v pacman &>/dev/null; then
    echo "Detected Arch (pacman)"
    sudo pacman -S --needed \
      gtk4 gtk3 webkit2gtk-4.1 libsoup3 librsvg libappindicator-gtk3 \
      gstreamer gst-plugins-base gst-plugins-good dbus openssl
  elif command -v zypper &>/dev/null; then
    echo "Detected openSUSE (zypper)"
    sudo zypper install -y \
      gtk4-devel gtk3-devel webkit2gtk4.1-devel libsoup3-devel \
      librsvg-devel libappindicator3-devel \
      gstreamer-devel gstreamer-plugins-base-devel \
      dbus-1-devel libopenssl-devel
  else
    echo "Unsupported package manager. You need:"
    echo "  GTK 3+4, WebKit2GTK 4.1, libsoup 3, librsvg 2"
    echo "  libappindicator 3, GStreamer + base plugins, D-Bus, OpenSSL"
    echo "  Plus: Rust toolchain, cargo-tauri"
    return 1
  fi

  # Rust
  if ! command -v rustc &>/dev/null; then
    echo ""
    echo "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
  fi

  # Tauri CLI
  if ! command -v cargo-tauri &>/dev/null; then
    echo ""
    echo "Installing cargo-tauri..."
    cargo install tauri-cli --version "^2"
  fi

  echo ""
  echo "Desktop dependencies installed."
  echo "  bun:         $(bun --version 2>/dev/null || echo 'not found')"
  echo "  rustc:       $(rustc --version 2>/dev/null || echo 'not found')"
  echo "  cargo-tauri: $(cargo tauri --version 2>/dev/null || echo 'not found')"
}

# ── Command handling ──

case "${1:-}" in
  --clean)
    echo "Removing dev environment at $_LC_DEV_DIR"
    rm -rf "$_LC_DEV_DIR"
    echo "Done."
    if [[ "$_LC_SOURCED" -eq 0 ]]; then exit 0; fi
    return 0 2>/dev/null || true
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
    if [[ "$_LC_SOURCED" -eq 0 ]]; then exit 0; fi
    return 0 2>/dev/null || true
    ;;
  --deps)
    case "${2:-desktop}" in
      cli)     _lc_install_deps_cli ;;
      desktop) _lc_install_deps_desktop ;;
      *)       echo "Usage: $0 --deps [cli|desktop]"; exit 1 ;;
    esac
    if [[ "$_LC_SOURCED" -eq 0 ]]; then exit 0; fi
    return 0 2>/dev/null || true
    ;;
esac

# ── Environment setup (when sourced) ──

# Create isolated directories
mkdir -p "$_LC_DEV_DIR/data" "$_LC_DEV_DIR/config" "$_LC_DEV_DIR/cache" "$_LC_DEV_DIR/state"

# Override XDG paths to isolate from real user data
export XDG_DATA_HOME="$_LC_DEV_DIR/data"
export XDG_CONFIG_HOME="$_LC_DEV_DIR/config"
export XDG_CACHE_HOME="$_LC_DEV_DIR/cache"
export XDG_STATE_HOME="$_LC_DEV_DIR/state"

# Disable features that don't make sense in dev
export LIBRECODE_DISABLE_AUTOUPDATE=true
export LIBRECODE_DISABLE_MODELS_FETCH=true
export LIBRECODE_DISABLE_TERMINAL_TITLE=true

# Add bun to PATH if installed in user home
if [ -d "$HOME/.bun/bin" ]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Add cargo to PATH if installed
if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

echo "LibreCode dev environment ready"
echo ""
echo "  Data:   $_LC_DEV_DIR/data/librecode/"
echo "  Config: $_LC_DEV_DIR/config/librecode/"
echo "  Cache:  $_LC_DEV_DIR/cache/librecode/"
echo "  DB:     $_LC_DEV_DIR/data/librecode/librecode.db"
echo ""
echo "Commands:"
echo "  bun run dev                    # CLI"
echo "  bun run dev:desktop            # Desktop (Tauri)"
echo "  bun run dev:web                # Web UI only"
echo "  bun test                       # Run tests"
echo ""
echo "First time? Run: scripts/dev-setup.sh --deps"
echo "Clean up:        scripts/dev-setup.sh --clean"

# Clean up internal variables
unset _LC_SOURCED _LC_SCRIPT_DIR _LC_PROJECT_ROOT _LC_DEV_DIR
