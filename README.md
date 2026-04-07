# LibreCode

AI-powered development tool. Fork of [opencode](https://github.com/anomalyco/opencode) v1.2.27.

## Why fork?

- Proper Linux packaging (COPR, AUR, Nix) instead of static deb/rpm downloads
- Cleaner codebase with a formalized agentic SDLC pattern
- Rebuilt CI/CD from scratch
- Community-driven development

## Install

### Nix (flake)

```bash
nix run github:techtoboggan/librecode
```

### From source

```bash
git clone https://github.com/techtoboggan/librecode.git
cd librecode
bun install
cd packages/opencode
bun run dev
```

## Development

```bash
# Dev shell (Nix)
nix develop

# Or manually
bun install
bun run dev           # CLI
bun run dev:desktop   # Desktop app
bun run typecheck     # Type checking
bun run test          # Tests
```

## Architecture

Monorepo with these packages:

| Package | Description |
|---------|-------------|
| `packages/opencode` | Core CLI agent |
| `packages/desktop` | Tauri desktop app |
| `packages/app` | Shared UI application (Solid.js) |
| `packages/ui` | Component library |
| `packages/sdk` | TypeScript SDK |
| `packages/util` | Shared utilities |
| `packages/plugin` | Plugin system |
| `packages/script` | Build scripts |

## License

MIT - see [LICENSE](LICENSE)
