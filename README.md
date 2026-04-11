<p align="center">
  <img src="assets/brand/logo-dark.svg" alt="LibreCode" width="400">
</p>

<h3 align="center">Run AI coding agents locally.</h3>

<p align="center">
  Local-first agentic coding assistant for the terminal and desktop.<br>
  No account required. No cloud dependency. Your models, your machine.
</p>

<p align="center">
  <a href="https://github.com/techtoboggan/librecode/actions/workflows/ci.yml"><img src="https://github.com/techtoboggan/librecode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/techtoboggan/librecode/releases"><img src="https://img.shields.io/github/v/release/techtoboggan/librecode?color=0D9488&label=release" alt="Release"></a>
  <a href="https://www.npmjs.com/package/@librecode/plugin"><img src="https://img.shields.io/npm/v/@librecode/plugin?color=0D9488&label=plugin" alt="npm"></a>
  <a href="https://github.com/techtoboggan/librecode/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-0D9488" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://librecode.app">Downloads</a> &bull;
  <a href="https://librecode.io">Website</a> &bull;
  <a href="https://github.com/techtoboggan/librecode/blob/main/docs/providers.md">Provider Guide</a> &bull;
  <a href="https://github.com/techtoboggan/librecode/blob/main/PLAN.md">Roadmap</a>
</p>

---

## Quick Start

```bash
# 1. Install Ollama (or any local model server)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

# 2. Install LibreCode
# Fedora/RHEL
sudo dnf copr enable techtoboggan/librecode && sudo dnf install librecode
# Arch
yay -S librecode
# Nix
nix run github:techtoboggan/librecode

# 3. Start coding
librecode
```

LibreCode auto-discovers Ollama, LiteLLM, vLLM, and other local model servers. No API keys needed for local models.

## What is LibreCode?

LibreCode is an agentic coding assistant that understands your codebase and helps you build software faster. It runs in your terminal or as a desktop app.

**Local-first by design:**

- **Auto-discovers local servers** &mdash; Ollama, LiteLLM, vLLM, llama.cpp on known ports
- **No account required** &mdash; works entirely offline with local models
- **Cloud when you want it** &mdash; connect Anthropic, OpenAI, or any provider via plugins
- **Community provider ecosystem** &mdash; install only the providers you need via npm

**Why this fork?**

LibreCode is a fork of [opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27), rebuilt with:

- **Local-first architecture** &mdash; local model servers are primary, cloud is optional
- **Proper Linux packaging** &mdash; COPR, AUR, Nix flake
- **Modular provider system** &mdash; core ships lean, community maintains cloud providers
- **Clean codebase** &mdash; Effect-ts removed, namespaces migrated, 1358 tests passing

## Providers

LibreCode ships with built-in support for local model servers and enterprise providers:

| Provider | Type | Default Port |
|----------|------|-------------|
| **Ollama** | Local | 11434 |
| **LiteLLM** | Local proxy | 4000 |
| **Amazon Bedrock** | Enterprise | &mdash; |
| **Azure OpenAI** | Enterprise | &mdash; |

Cloud providers (Anthropic, OpenAI, OpenRouter, etc.) are available as community plugins. Add them to `.librecode/librecode.json`:

```json
{
  "plugin": ["@librecode/provider-anthropic@latest"]
}
```

Or install the bundle for all cloud providers at once:

```json
{
  "plugin": ["@librecode/provider-bundle@latest"]
}
```

**Available provider plugins:**

| Package | Provider |
|---------|----------|
| [`@librecode/provider-anthropic`](https://www.npmjs.com/package/@librecode/provider-anthropic) | Anthropic (Claude) |
| [`@librecode/provider-openai`](https://www.npmjs.com/package/@librecode/provider-openai) | OpenAI |
| [`@librecode/provider-openrouter`](https://www.npmjs.com/package/@librecode/provider-openrouter) | OpenRouter |
| [`@librecode/provider-bundle`](https://www.npmjs.com/package/@librecode/provider-bundle) | All of the above |

See the [Provider Guide](docs/providers.md) for adding new providers or writing your own.

## Install

### Package managers

```bash
# Fedora/RHEL (COPR)
sudo dnf copr enable techtoboggan/librecode
sudo dnf install librecode

# Arch (AUR)
yay -S librecode

# Nix
nix run github:techtoboggan/librecode
```

### From source

```bash
git clone https://github.com/techtoboggan/librecode.git
cd librecode
scripts/dev-setup.sh --deps    # Auto-detects your distro
source scripts/dev-setup.sh    # Isolated dev environment
bun install
bun run dev
```

### Desktop app

Download from [librecode.app](https://librecode.app) or build locally:

```bash
scripts/dev-setup.sh --deps    # Installs Rust + GTK + WebKit
source scripts/dev-setup.sh
bun install
bun run dev:desktop
```

## Development

```bash
source scripts/dev-setup.sh    # Isolated dev data in .dev/
bun run dev                    # CLI
bun run dev:desktop            # Desktop (Tauri)
bun run typecheck              # Type checking
bun test --timeout 30000       # Tests (1358 passing)
bun run lint                   # Biome linter
```

See [docs/development.md](docs/development.md) for the full guide.

## Architecture

TypeScript monorepo using Bun runtime, Solid.js UI, Tauri desktop.

```
packages/
  librecode/    Core CLI agent
  desktop/      Tauri desktop app (Rust + Solid.js)
  app/          Shared UI application
  ui/           Component library
  sdk/          TypeScript SDK  →  @librecode/sdk on npm
  plugin/       Plugin API      →  @librecode/plugin on npm
  util/         Shared utilities
  script/       Build tooling
```

**Community packages** (separate repo: [librecode-3rdparty-providers](https://github.com/techtoboggan/librecode-3rdparty-providers)):
`@librecode/provider-anthropic` · `@librecode/provider-openai` · `@librecode/provider-openrouter` · `@librecode/provider-bundle`

## Contributing

- [docs/development.md](docs/development.md) &mdash; Local dev setup
- [docs/architecture.md](docs/architecture.md) &mdash; System architecture
- [docs/providers.md](docs/providers.md) &mdash; Adding new providers
- [PLAN.md](PLAN.md) &mdash; Roadmap
- [CLAUDE.md](CLAUDE.md) &mdash; Coding standards

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/techtoboggan">techtoboggan</a>. Local models first.</sub>
</p>
