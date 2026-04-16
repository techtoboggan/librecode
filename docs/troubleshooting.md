# Troubleshooting

Common problems installing and running LibreCode, and how to fix them.

## Install

### The one-line installer fails to download

```
error: download failed: https://github.com/techtoboggan/librecode/releases/...
```

The installer resolves the latest release tag by following the redirect on
`/releases/latest`. If you're behind a proxy that blocks HTTP 302s, set
`LIBRECODE_VERSION` explicitly:

```bash
LIBRECODE_VERSION=v1.0.0-preview.1 curl -fsSL https://raw.githubusercontent.com/techtoboggan/librecode/main/scripts/install.sh | sh
```

### macOS "cannot be opened because the developer cannot be verified"

The v1.0.0-preview.1 macOS `.app` bundle is unsigned. Either:

1. Right-click the app → **Open** → **Open** (one-time bypass), or
2. `xattr -d com.apple.quarantine /Applications/LibreCode.app` from Terminal

A signed + notarized build will follow once an Apple Developer account is set up.

### Linux desktop app: blank window / WebKitGTK compositing issues

Some compositors (certain Wayland + NVIDIA combinations) break WebKitGTK
rendering. Workaround:

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 librecode-desktop
```

If you installed the Flatpak, this is set automatically.

### `librecode: command not found` after install

The installer drops the binary in `$HOME/.local/bin` (Unix) or
`%LOCALAPPDATA%\LibreCode` (Windows). Ensure that's on your `PATH`:

```bash
# Bash / Zsh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

# Fish
fish_add_path $HOME/.local/bin
```

## Providers

### "Provider not configured" on first run

LibreCode ships with zero pre-configured providers. Configure one:

- **Local models (recommended)**: install [Ollama](https://ollama.com/), then
  run `librecode` — LibreCode auto-detects running Ollama.
- **Cloud providers**: `librecode auth login` and pick from the list, or edit
  `.librecode/config.json` directly.

See [docs/providers.md](providers.md) for adding a community provider plugin.

### `@librecode/provider-*` package fails to install

The 3rd-party provider packages use OIDC trusted-publisher authentication on
npm. If you see an install error, make sure your npm registry isn't pinned to
an outdated mirror. Try:

```bash
npm install --registry https://registry.npmjs.org/ @librecode/provider-anthropic
```

## MCP servers

### MCP app panel says "No MCP Apps connected"

MCP Apps require the connected server to expose a resource with MIME type
`text/html;profile=mcp-app` via `listResources`. Check the server's
capabilities with:

```bash
librecode mcp list
librecode mcp resources <server-name>
```

If your server exposes tools but not `ui://` resources, it appears in
**Tools** but not the **Apps** sidebar tab. That's expected.

### Port preview tabs don't appear

The port preview auto-detects strings like `http://localhost:PORT`, `Listening
on :PORT`, and common Vite/Next.js/Express patterns in bash tool output. If
your dev server uses a non-standard format, LibreCode won't see the port.
Workaround: `echo "Listening on :3000"` before starting your server, or open
the preview manually via the sidebar.

## Development

### `bun install` fails with `EACCES`

Make sure you're not running as root. LibreCode's dev scripts assume user
install. If `~/.bun` has wrong ownership from an earlier root install:

```bash
sudo chown -R "$USER" ~/.bun
```

### `bun run typecheck` is slow on the first run

The monorepo uses Turbo. First run is a full typecheck (~30s); subsequent runs
are cached (<300ms). If the cache isn't hitting, check `.turbo/` isn't
`.gitignore`'d out by accident and that you're running from the repo root.

### Tests fail with "Instance not provided"

You're probably running a test that requires the `Instance.provide(...)`
wrapper. All tests that touch the filesystem or instance state need:

```ts
await Instance.provide({ directory: tmp.path, fn: async () => { ... } })
```

See the existing tests in `packages/librecode/test/` for patterns.

## Getting more help

- File an issue: <https://github.com/techtoboggan/librecode/issues>
- Read the [architecture overview](architecture.md) if your problem looks like
  a design question
- Check [PLAN.md](../PLAN.md) to see if your issue is a known limitation
  tracked in the roadmap
