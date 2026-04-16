#!/usr/bin/env bash
# LibreCode universal installer
#
#   curl -fsSL https://raw.githubusercontent.com/techtoboggan/librecode/main/scripts/install.sh | sh
#
# Options (via env vars):
#   LIBRECODE_VERSION  — install a specific version (e.g. v1.0.0-preview.1)
#   LIBRECODE_INSTALL_DIR — override the install destination (default: $HOME/.local/bin)
#   LIBRECODE_NO_PATH_HINT=1 — suppress the PATH-update hint at the end
#
# Behavior:
#   1. Detects OS (linux, darwin) and arch (x64, arm64).
#   2. Fetches the latest release (or $LIBRECODE_VERSION) from GitHub.
#   3. Downloads the matching tarball + SHA256SUMS.
#   4. Verifies the sha256 checksum.
#   5. Extracts `librecode` into $LIBRECODE_INSTALL_DIR.
#   6. Prints next-step hint.
#
# Does NOT require sudo. Installs to user home by default.
set -euo pipefail

REPO="techtoboggan/librecode"
INSTALL_DIR="${LIBRECODE_INSTALL_DIR:-${HOME}/.local/bin}"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

# ─── Detect OS + arch ───────────────────────────────────────────────────────
detect_platform() {
  local os arch
  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    *)       die "unsupported OS: $(uname -s). Use the MSI installer on Windows." ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) die "unsupported arch: $(uname -m)" ;;
  esac

  echo "${os}-${arch}"
}

# ─── Resolve version ────────────────────────────────────────────────────────
resolve_version() {
  if [[ -n "${LIBRECODE_VERSION:-}" ]]; then
    echo "${LIBRECODE_VERSION}"
    return
  fi
  # GitHub redirects /releases/latest to the most recent stable release URL,
  # whose path ends in the tag name.
  local url
  url=$(curl -fsSL -o /dev/null -w '%{url_effective}' \
    "https://github.com/${REPO}/releases/latest") || die "failed to resolve latest release"
  echo "${url##*/}"
}

# ─── Download + verify + extract ────────────────────────────────────────────
install_librecode() {
  local version="$1" platform="$2"
  local tarball="librecode-${platform}.tar.gz"
  local base="https://github.com/${REPO}/releases/download/${version}"
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "${tmp}"' RETURN

  info "Downloading ${tarball}…"
  curl -fsSL "${base}/${tarball}" -o "${tmp}/${tarball}" \
    || die "download failed: ${base}/${tarball}"

  info "Verifying checksum…"
  if curl -fsSL "${base}/SHA256SUMS" -o "${tmp}/SHA256SUMS"; then
    local expected actual
    expected=$(awk -v f="${tarball}" '$2 == f || $2 == "*"f {print $1}' "${tmp}/SHA256SUMS")
    actual=$(sha256sum "${tmp}/${tarball}" | awk '{print $1}')
    if [[ -z "${expected}" ]]; then
      info "Warning: no entry for ${tarball} in SHA256SUMS — skipping verification"
    elif [[ "${expected}" != "${actual}" ]]; then
      die "checksum mismatch for ${tarball}: expected ${expected}, got ${actual}"
    fi
  else
    info "Warning: SHA256SUMS not available — skipping verification"
  fi

  info "Installing to ${INSTALL_DIR}…"
  mkdir -p "${INSTALL_DIR}"
  tar -xzf "${tmp}/${tarball}" -C "${tmp}"
  # The tarball contains just the binary in its bin/ root; fall back to a find
  local bin
  bin=$(find "${tmp}" -type f -name "librecode" -perm -u+x 2>/dev/null | head -1)
  [[ -n "${bin}" ]] || die "no librecode binary in ${tarball}"
  install -Dm755 "${bin}" "${INSTALL_DIR}/librecode"
  info "Installed $(${INSTALL_DIR}/librecode --version 2>/dev/null || echo librecode)"
}

# ─── PATH hint ──────────────────────────────────────────────────────────────
maybe_path_hint() {
  [[ "${LIBRECODE_NO_PATH_HINT:-}" == "1" ]] && return
  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      echo
      echo "Add ${INSTALL_DIR} to your PATH to use librecode:"
      echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
      echo
      echo "Bash/Zsh: append the line above to your ~/.bashrc or ~/.zshrc"
      echo "Fish:     fish_add_path '${INSTALL_DIR}'"
      ;;
  esac
}

main() {
  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v tar >/dev/null 2>&1 || die "tar is required"

  local platform version
  platform=$(detect_platform)
  version=$(resolve_version)
  info "Platform: ${platform}"
  info "Version:  ${version}"

  install_librecode "${version}" "${platform}"
  maybe_path_hint
  info "Done. Run 'librecode --help' to get started."
}

main "$@"
