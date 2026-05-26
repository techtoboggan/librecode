# Local Development Guide

> Run LibreCode locally without installing anything globally.
> All dev data isolated to `.dev/` in the project root.

---

## Quick Start

```bash
# 1. Install system dependencies (auto-detects distro)
scripts/dev-setup.sh --deps          # Desktop deps (includes CLI deps)
scripts/dev-setup.sh --deps cli      # CLI-only deps (lighter)

# 2. Set up isolated dev environment
source scripts/dev-setup.sh

# 3. Install JS dependencies
bun install

# 4. Run
bun run dev              # CLI
bun run dev:desktop      # Desktop (Tauri)
bun run dev:web          # Web UI only
```

Supported distros: Fedora, Ubuntu/Debian, Arch, openSUSE, Alpine.

---

## What `--deps` Installs

### CLI deps (`--deps cli`)

- bun (JS runtime)
- ripgrep (file search)
- pkg-config, openssl-dev, git

### Desktop deps (`--deps` or `--deps desktop`)

Everything from CLI, plus:

- Rust toolchain (via rustup)
- cargo-tauri CLI
- GTK 3 + 4, WebKit2GTK 4.1, libsoup 3
- librsvg 2, libappindicator 3
- GStreamer + base plugins, D-Bus

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
# Start of each session
source scripts/dev-setup.sh

# Iterate
bun run dev:desktop        # Run desktop app
# Ctrl+C, make changes, run again

# Run tests
cd packages/librecode
bun test --timeout 30000

# Run linter
bun run lint
```

---

## Configuration

### Dev config file

After `source scripts/dev-setup.sh`:

```bash
mkdir -p .dev/config/librecode
cat > .dev/config/librecode/librecode.jsonc << 'EOF'
{
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

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

---

## Testing

LibreCode uses a three-layer testing architecture (ADR-010). Run the
appropriate layer depending on what changed.

### Layer 1 — Unit tests (fast, ~2s)

```bash
cd packages/librecode
bun test --timeout 30000           # All CLI tests
bun test test/session/             # Subset by directory
bun test --coverage                # With line coverage

cd packages/util && bun test       # Util tests
cd packages/plugin && bun test     # Plugin tests
cd packages/app && bun run test:unit  # App unit tests
```

### Layer 2 — Web preview smoke (manual, ~15–30s)

Driven by the `Claude_Preview` MCP tools. See
`docs/plans/preview-smoke-template.md` for the full procedure. Required
for all UI-visible changes.

Key rules (v0.9.97+):

- Always resize to 1280×800 desktop viewport before any assertion.
- Always screenshot at baseline + each visible state change.

### Layer 3 — Tauri E2E (Playwright)

```bash
# Browser mode: headless Chromium + mocked Tauri IPC (~30s, CI gate)
bun --cwd packages/app run test:e2e:tauri:browser

# Tauri mode: real native webview via socket bridge (~3-5min, pre-release)
bun --cwd packages/app run test:e2e:tauri:tauri

# View last Playwright report
bun --cwd packages/app run test:e2e:report
```

Browser mode requires the Vite dev server to be running (port 3000).
In CI, Playwright's `webServer` config starts it automatically.
In development, start it first: `bun --cwd packages/app run dev`.

See `docs/adr/0010-test-architecture.md` for which layer to use and
`docs/plans/preview-smoke-template.md` for Layer 2 procedure.

---

## Nix (Optional)

Nix flake is provided for packaging and CI, but is **not required** for development. The `--deps` script handles everything.

If you want to use Nix:

```bash
nix develop              # CLI shell
nix develop .#desktop    # Desktop shell (may have glibc issues on newer distros)
```

> **Note:** Nix dev shells may not work on bleeding-edge distros (Fedora 44+)
> due to glibc version mismatches in the Nix-provided linker.

---

## Troubleshooting

### "No models available"

Set `LIBRECODE_DISABLE_MODELS_FETCH=true` and configure a provider API key.

### "Database locked"

Kill background instances: `pkill -f "bun.*librecode"`

### "ENOENT: rg not found"

Install ripgrep: `sudo dnf install ripgrep` / `sudo apt install ripgrep`

### EGL/Wayland crash

Force X11: `OC_FORCE_X11=1 bun run dev:desktop`

### "source scripts/dev-setup.sh" does nothing

Make sure you're using `source` (not `./scripts/dev-setup.sh` which runs in a subshell).
