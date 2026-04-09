# Local Development Guide

> Run LibreCode locally without installing anything system-wide.
> All dev data goes to `.dev/` in the project root — completely isolated.

---

## Quick Start

```bash
# 1. Install system dependencies (auto-detects distro: Fedora, Ubuntu, Arch, openSUSE, Alpine)
scripts/dev-setup.sh --deps          # Desktop (Tauri) deps — includes CLI deps
scripts/dev-setup.sh --deps cli      # CLI-only deps (lighter)

# 2. Install JS dependencies
bun install

# 3. Set up isolated dev environment (data in .dev/, not ~/.local/share)
source scripts/dev-setup.sh

# 4. Run (pick one)
bun run dev              # CLI only
bun run dev:desktop      # Desktop app (Tauri)
bun run dev:web          # Web UI only
```

---

## Dev Environment Isolation

Running `source scripts/dev-setup.sh` redirects all XDG directories to `.dev/`:

```
.dev/
  data/librecode/        # Database, logs, binary cache
  config/librecode/      # Config files (librecode.json)
  cache/librecode/       # Model cache, etc.
  state/librecode/       # State data
```

This means:
- **No touching `~/.local/share/librecode/`** — your real data is safe
- **Separate database** — dev SQLite at `.dev/data/librecode/librecode.db`
- **Separate config** — put dev config at `.dev/config/librecode/librecode.json`
- **Cleanable** — `scripts/dev-setup.sh --clean` removes everything

### Manual isolation (without the script)

```bash
export XDG_DATA_HOME="$(pwd)/.dev/data"
export XDG_CONFIG_HOME="$(pwd)/.dev/config"
export XDG_CACHE_HOME="$(pwd)/.dev/cache"
export XDG_STATE_HOME="$(pwd)/.dev/state"
```

---

## Three Dev Modes

### CLI Development (fastest)

```bash
source scripts/dev-setup.sh
cd packages/opencode
bun run dev
```

Runs TypeScript directly via Bun — no compilation step. Hot-reload on save.

### Desktop Development (Tauri)

Requires Rust toolchain + GTK/WebKit system libraries.

```bash
# Install all deps (auto-detects: Fedora, Ubuntu, Arch, openSUSE, Alpine)
scripts/dev-setup.sh --deps desktop

# Set up isolated dev environment
source scripts/dev-setup.sh

# Install JS deps and run
bun install
bun run dev:desktop
```

The `--deps desktop` command installs:
- System libraries: GTK4, WebKit2GTK 4.1, libsoup3, librsvg2, libappindicator, GStreamer, D-Bus, OpenSSL
- Rust toolchain (via rustup, if not installed)
- cargo-tauri CLI (via cargo install, if not installed)
- CLI deps: ripgrep, bun, pkg-config, git

**Nix alternative** (if you have a working Nix install):
```bash
nix develop .#desktop    # Provides everything in one shell
```

**Manual installation** (if your distro isn't auto-detected):
See the required libraries in `scripts/dev-setup.sh` or `nix/desktop.nix`.

The desktop dev flow:
1. `predev.ts` builds the CLI binary as a sidecar
2. Vite starts the frontend on `:1420`
3. Tauri opens a window pointing to Vite
4. Hot-reload: frontend changes reload instantly, Rust changes trigger recompile

### Web UI Only (no backend)

```bash
cd packages/app
bun run dev    # Starts on http://localhost:3000
```

Frontend only — needs a separate CLI/Desktop instance running for the backend API.

---

## Configuration

### Dev config file

Create `.dev/config/librecode/librecode.jsonc` (after running dev-setup.sh):

```jsonc
{
  // Use a specific provider for dev
  "provider": {
    "anthropic": {
      "models": {
        "claude-sonnet-4-5": {}
      }
    }
  }
}
```

### Provider API keys

Set in your shell (NOT in config files):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

Or use `librecode auth <provider>` to set up OAuth.

### Useful env vars for dev

```bash
LIBRECODE_DISABLE_AUTOUPDATE=true     # Don't check for updates
LIBRECODE_DISABLE_MODELS_FETCH=true   # Don't fetch models.dev snapshot
LIBRECODE_DISABLE_TERMINAL_TITLE=true # Don't change terminal title
LIBRECODE_EXPERIMENTAL=true           # Enable all experimental features
```

(All three are set automatically by `dev-setup.sh`)

---

## Testing

```bash
# Run all tests (from packages/opencode)
cd packages/opencode
bun test --timeout 30000

# Run a specific test file
bun test test/session/agent-loop.test.ts

# Run tests with coverage
bun test --timeout 30000 --coverage

# Run util tests
cd packages/util && bun test

# Run plugin tests
cd packages/plugin && bun test

# Run app unit tests
cd packages/app && bun run test:unit

# Run E2E tests (needs Playwright)
cd packages/app && bun run test:e2e
```

### Test isolation

Tests automatically use isolated temp directories via `test/preload.ts`:
- Temp XDG dirs in `/tmp/`
- API keys cleared
- No network calls
- Database cleaned up after each test

---

## Nix Dev Shells

```bash
# CLI-only development (bun + node + ripgrep)
nix develop

# Full desktop development (+ Rust + GTK + WebKit)
nix develop .#desktop
```

Both shells include `bun`, `nodejs`, `pkg-config`, `openssl`, `git`, `ripgrep`.
The `desktop` shell adds `rustc`, `cargo`, `cargo-tauri`, and all Linux GUI libraries.

---

## Troubleshooting

### "No models available"
Set `LIBRECODE_DISABLE_MODELS_FETCH=true` and configure a provider with an API key.
Or point to a local models snapshot: `LIBRECODE_MODELS_PATH=test/tool/fixtures/models-api.json`

### "Database locked"
Only one CLI instance can write to the database at a time. Kill any background
instances: `pkill -f "bun.*librecode"`

### Tauri build fails with missing libraries
Use `nix develop .#desktop` for the complete dependency set.
Or install the system packages listed above for your distro.

### "ENOENT: rg not found"
Install ripgrep: `sudo dnf install ripgrep` or `sudo apt install ripgrep`
Or use the Nix dev shell which includes it.

### Tests fail with "No context found for instance"
This means a test is trying to use `Bus.publish` outside of `Instance.provide()`.
Wrap your test in: `await Instance.provide({ directory: tmp.path, fn: async () => { ... } })`
