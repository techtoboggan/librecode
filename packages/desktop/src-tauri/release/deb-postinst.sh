#!/bin/sh
# Post-install script for the librecode-desktop .deb package.
#
# Tauri's externalBin mechanism ships the CLI sidecar at
# /usr/bin/librecode-cli. Create a /usr/bin/librecode symlink so users
# can run `librecode ...` from their terminal without installing a
# separate package. Skip the symlink if /usr/bin/librecode already
# exists (another install path — Homebrew Linux, install.sh, separate
# librecode .deb from a future apt repo).

set -e

SRC=/usr/bin/librecode-cli
LINK=/usr/bin/librecode

if [ -e "$SRC" ] && [ ! -e "$LINK" ]; then
  ln -sf "$SRC" "$LINK"
fi

exit 0
