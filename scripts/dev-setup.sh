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
#   scripts/dev-setup.sh --deps          # Install deps via Nix (recommended)
#   scripts/dev-setup.sh --deps native   # Install deps via native pkg manager
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

# ── Nix-based dependency installation (recommended) ──

_lc_has_official_nix() {
  # Official Nix installs to /nix/store with a daemon
  [ -d "/nix/store" ] && [ -f "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh" ]
}

_lc_has_distro_nix() {
  # Distro-packaged nix (Fedora nix-core, etc.) uses chroot store
  [ -f "/usr/bin/nix" ] && [ -d "$HOME/.local/share/nix/root" ] && ! _lc_has_official_nix
}

_lc_remove_distro_nix() {
  echo "Detected distro-packaged Nix (uses chroot store, breaks 'nix develop')."
  echo "Removing it to make way for the official installer..."
  echo ""

  if command -v dnf &>/dev/null; then
    sudo dnf remove -y nix-core nix-libs 2>/dev/null || true
  elif command -v apt &>/dev/null; then
    sudo apt remove -y nix nix-bin 2>/dev/null || true
  elif command -v pacman &>/dev/null; then
    sudo pacman -R --noconfirm nix 2>/dev/null || true
  elif command -v zypper &>/dev/null; then
    sudo zypper remove -y nix 2>/dev/null || true
  fi

  # Clean up chroot store
  rm -rf "$HOME/.local/share/nix" 2>/dev/null || true

  # Remove from hash table so bash finds the new one
  hash -r 2>/dev/null || true

  echo "Distro nix removed."
}

_lc_install_nix() {
  # Already have a working official Nix?
  if _lc_has_official_nix; then
    echo "Nix is already installed (official installer)."
    # Source the profile in case it's not in this shell
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh 2>/dev/null || true
    return 0
  fi

  # Have a broken distro-packaged nix? Remove it first.
  if _lc_has_distro_nix; then
    _lc_remove_distro_nix
  elif command -v nix &>/dev/null; then
    # Some other nix exists — check if it works
    if nix store info &>/dev/null 2>&1 && [ -d "/nix/store" ]; then
      echo "Nix is already installed and working."
      return 0
    else
      echo "Found nix but it doesn't appear to work correctly."
      echo "Proceeding with official installer (will take precedence via PATH)."
    fi
  fi

  echo ""
  echo "Installing Nix (Determinate Systems installer)..."
  echo "This provides reproducible, cross-platform dev environments."
  echo ""

  if ! command -v curl &>/dev/null; then
    echo "curl is required. Install curl first, then re-run."
    return 1
  fi

  curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

  # Source the profile so nix is available in this shell
  if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
  fi

  echo ""
  echo "Nix installed successfully."
  echo "If 'nix' isn't found, restart your shell."
}

_lc_install_deps_nix() {
  # Ensure Nix is installed
  if ! command -v nix &>/dev/null; then
    _lc_install_nix || return 1
    # Source the nix profile
    if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
      . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
    fi
  fi

  echo ""
  echo "Nix is ready. Use one of these dev shells:"
  echo ""
  echo "  nix develop              # CLI development (bun, node, ripgrep)"
  echo "  nix develop .#desktop    # Desktop development (+ Rust, GTK, WebKit)"
  echo ""
  echo "Then inside the shell:"
  echo "  source scripts/dev-setup.sh"
  echo "  bun install"
  echo "  bun run dev              # or bun run dev:desktop"
}

# ── Native package manager installation (fallback) ──

_lc_install_deps_native() {
  echo "Installing dependencies via native package manager..."
  echo "(Prefer 'scripts/dev-setup.sh --deps' for Nix-based cross-platform setup)"
  echo ""

  # CLI deps
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
    echo "Unsupported package manager. Install manually: ripgrep, openssl-dev, pkg-config, git"
    return 1
  fi

  # Bun
  if ! command -v bun &>/dev/null; then
    echo "Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi

  echo ""
  echo "CLI dependencies installed."
  echo ""
  echo "For desktop (Tauri) development, also install:"

  if command -v dnf &>/dev/null; then
    echo "  sudo dnf install gtk4-devel webkit2gtk4.1-devel libsoup3-devel \\"
    echo "    librsvg2-devel libappindicator-gtk3-devel gstreamer1-devel \\"
    echo "    gstreamer1-plugins-base-devel dbus-devel"
  elif command -v apt &>/dev/null; then
    echo "  sudo apt install libgtk-4-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev \\"
    echo "    librsvg2-dev libappindicator3-dev libgstreamer1.0-dev \\"
    echo "    libgstreamer-plugins-base1.0-dev libdbus-1-dev"
  elif command -v pacman &>/dev/null; then
    echo "  sudo pacman -S gtk4 webkit2gtk-4.1 libsoup3 librsvg \\"
    echo "    libappindicator-gtk3 gstreamer gst-plugins-base dbus"
  else
    echo "  GTK4, WebKit2GTK 4.1, libsoup 3, librsvg 2, GStreamer, D-Bus"
  fi

  echo ""
  echo "Plus Rust and Tauri CLI:"
  echo '  curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh'
  echo '  cargo install tauri-cli --version "^2"'
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
    case "${2:-nix}" in
      nix)    _lc_install_deps_nix ;;
      native) _lc_install_deps_native ;;
      *)      echo "Usage: $0 --deps [nix|native]"; exit 1 ;;
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
echo "Clean up: scripts/dev-setup.sh --clean"

# Clean up internal variables
unset _LC_SOURCED _LC_SCRIPT_DIR _LC_PROJECT_ROOT _LC_DEV_DIR
