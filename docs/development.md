# Local Development Guide

> Run LibreCode locally without installing anything system-wide.
> All deps via Nix. All dev data isolated to `.dev/` in the project root.

---

## Prerequisites

**Nix** — the only prerequisite. Everything else comes from the Nix dev shell.

```bash
# Install Nix (one-time, works on any Linux distro + macOS)
scripts/dev-setup.sh --deps
```

This installs the [Determinate Systems Nix installer](https://github.com/DeterminateSystems/nix-installer)
which provides `nix develop` with proper `/nix/store` support. It works on
Fedora, Ubuntu, Arch, NixOS, macOS — any system.

> **Note:** Distro-packaged nix (e.g., Fedora `nix-core`) uses a broken chroot
> store that doesn't support `nix develop`. Use the official installer instead.

---

## Quick Start

```bash
# 1. Enter dev shell (provides bun, node, ripgrep, and everything else)
nix develop              # CLI development
nix develop .#desktop    # Desktop development (+ Rust, GTK, WebKit)

# 2. Set up isolated dev environment (data in .dev/, not ~/.local/share)
source scripts/dev-setup.sh

# 3. Install JS dependencies
bun install

# 4. Run
bun run dev              # CLI
bun run dev:desktop      # Desktop (Tauri)
bun run dev:web          # Web UI only
```

That's it. No `sudo dnf install`, no `apt-get`, no Rust installer, no version
managers. Nix provides everything reproducibly.

---

## What the Nix Shells Provide

### `nix develop` (CLI development)

- Bun 1.3.x
- Node.js 20
- ripgrep
- pkg-config
- OpenSSL
- Git

### `nix develop .#desktop` (Desktop development)

Everything from the CLI shell, plus:

- Rust toolchain (rustc, cargo)
- cargo-tauri CLI
- GTK 4
- WebKit2GTK 4.1
- libsoup 3
- librsvg 2
- libappindicator
- GStreamer (+ base/good/bad plugins)
- D-Bus
- glib-networking

No system packages needed — Nix provides all libraries isolated in `/nix/store`.

---

## Dev Environment Isolation

`source scripts/dev-setup.sh` redirects all XDG directories to `.dev/`:

```
.dev/
  data/librecode/        # Database, logs, binary cache
  config/librecode/      # Config files (librecode.json)
  cache/librecode/       # Model cache
  state/librecode/       # State data
```

- **Your real `~/.local/share/librecode/` is never touched**
- Separate database: `.dev/data/librecode/librecode.db`
- Clean up everything: `scripts/dev-setup.sh --clean`

---

## Day-to-Day Workflow

```bash
# Terminal 1: Enter shell + setup (once per terminal session)
nix develop .#desktop
source scripts/dev-setup.sh

# Then iterate:
bun run dev:desktop        # Run desktop app
# Ctrl+C, make changes, run again

# Run tests
cd packages/opencode
bun test --timeout 30000

# Run linter
bun run lint
```

---

## Configuration

### Dev config file

After running `source scripts/dev-setup.sh`, create:

```bash
mkdir -p .dev/config/librecode
cat > .dev/config/librecode/librecode.jsonc << 'EOF'
{
  // Dev-specific config
  "provider": {
    "anthropic": {
      "models": {
        "claude-sonnet-4-5": {}
      }
    }
  }
}
EOF
```

### Provider API keys

Set in your shell (NOT in config files):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

---

## Testing

```bash
# From packages/opencode (the core package)
bun test --timeout 30000          # All tests
bun test test/session/             # Test a directory
bun test --coverage               # With coverage report

# Other packages
cd packages/util && bun test
cd packages/plugin && bun test
cd packages/app && bun run test:unit

# E2E tests (needs Playwright)
cd packages/app && bun run test:e2e
```

---

## Troubleshooting

### "nix develop" doesn't work

If you get chroot store errors, you have the distro-packaged nix. Remove it and
use the official installer:

```bash
# Fedora
sudo dnf remove nix-core nix-libs
# Then
scripts/dev-setup.sh --deps
```

### "source scripts/dev-setup.sh" closes my terminal

This was fixed — make sure you have the latest version (the script detects
`source` vs direct execution and disables strict mode when sourced).

### "No models available"

Dev mode disables model fetching. Set a provider API key or point to a
local snapshot: `LIBRECODE_MODELS_PATH=test/tool/fixtures/models-api.json`

### "Database locked"

Only one CLI instance can write at a time. Kill backgrounds:
`pkill -f "bun.*librecode"`

### "ENOENT: rg not found"

You're not in the Nix dev shell. Run `nix develop` first.

---

## Native Deps (without Nix)

If you really can't use Nix, there's a native fallback:

```bash
scripts/dev-setup.sh --deps native
```

This auto-detects your package manager (dnf, apt, pacman, zypper, apk) and
prints the install commands. But you'll need to manage Rust, bun, and system
library versions yourself. Nix is strongly preferred.
