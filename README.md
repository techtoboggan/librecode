<p align="center">
  <img src="assets/brand/logo-dark.svg" alt="LibreCode" width="400">
</p>

<h3 align="center">Free Software. Modern Code.</h3>

<p align="center">
  AI-powered development tool for the terminal, desktop, and beyond.
</p>

<p align="center">
  <a href="https://github.com/techtoboggan/librecode/actions/workflows/ci.yml"><img src="https://github.com/techtoboggan/librecode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/techtoboggan/librecode/releases"><img src="https://img.shields.io/github/v/release/techtoboggan/librecode?color=0D9488&label=release" alt="Release"></a>
  <a href="https://github.com/techtoboggan/librecode/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-0D9488" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://librecode.app">Downloads</a> &bull;
  <a href="https://librecode.io">Website</a> &bull;
  <a href="https://github.com/techtoboggan/librecode/blob/main/PLAN.md">Roadmap</a>
</p>

---

<p align="center">
  <img src="assets/mascot/tater.svg" alt="Tater - LibreCode mascot" width="180">
</p>

## What is LibreCode?

LibreCode is an agentic coding assistant that lives in your terminal. It connects to LLM providers (Anthropic, OpenAI, Google, local models, and more), understands your codebase, and helps you build software faster.

**Why does this fork exist?**

- **Proper Linux packaging** &mdash; COPR, AUR, Nix flake. Not just static `.deb`/`.rpm` downloads.
- **Formalized agentic SDLC** &mdash; a clean, well-structured agent loop instead of spaghetti.
- **Community-first** &mdash; rebuilt CI/CD, stripped vendor lock-in, open development.

## Install

### Quick install

```bash
# Nix (recommended)
nix run github:techtoboggan/librecode

# Fedora/RHEL (COPR)
sudo dnf copr enable techtoboggan/librecode
sudo dnf install librecode

# Arch (AUR)
yay -S librecode
```

### From source

```bash
git clone https://github.com/techtoboggan/librecode.git
cd librecode

# Install Nix if you don't have it (one-time)
scripts/dev-setup.sh --deps

# Enter dev shell + isolated environment
nix develop                   # CLI dev (or nix develop .#desktop for Tauri)
source scripts/dev-setup.sh   # Isolates data to .dev/
bun install
bun run dev
```

### Desktop app

Download from [librecode.app](https://librecode.app) or build locally:

```bash
nix develop .#desktop         # Provides Rust + GTK + WebKit + everything
source scripts/dev-setup.sh
bun install
bun run dev:desktop
```

## Development

All development uses [Nix](https://nixos.org/) for reproducible dependencies.
No `sudo apt install`, no version managers, no "works on my machine."

```bash
nix develop              # CLI dev shell
nix develop .#desktop    # Desktop dev shell (+ Rust, GTK, WebKit)
source scripts/dev-setup.sh   # Isolate dev data to .dev/
bun run dev              # Run CLI
bun run dev:desktop      # Run desktop app
bun run typecheck        # Type checking
bun run test             # Tests
bun run lint             # Biome linter
```

See [docs/development.md](docs/development.md) for the full guide.

## Architecture

```
librecode/
  packages/
    opencode/     Core CLI agent (TypeScript, Effect-ts, Bun)
    desktop/      Tauri desktop app (Rust + Solid.js)
    app/          Shared UI application
    ui/           Component library
    sdk/          TypeScript SDK
    util/         Shared utilities
    plugin/       Plugin system
    script/       Build tooling
  sites/
    app/          librecode.app - download hub
    io/           librecode.io - project website
  packaging/
    PKGBUILD          AUR package
    librecode.spec.in RPM spec for COPR
  nix/
    opencode.nix  Nix derivation
    desktop.nix   Desktop derivation
```

## Contributing

- [docs/development.md](docs/development.md) — Local dev setup (isolated environment, Nix shells, deps)
- [docs/architecture.md](docs/architecture.md) — System architecture (agent loop, providers, tools, permissions)
- [PLAN.md](PLAN.md) — Roadmap and refactoring priorities
- [CLAUDE.md](CLAUDE.md) — Coding standards and migration playbooks

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built with care by <a href="https://github.com/techtoboggan">techtoboggan</a> and Tater the winged monkey.</sub>
</p>
