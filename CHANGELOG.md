# Changelog

All notable changes to LibreCode are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-preview.1] — 2026-04-15

First public preview of LibreCode — a local-first AI coding agent forked from
[opencode v1.2.27](https://github.com/anomalyco/opencode/tree/v1.2.27). This
preview is feature-complete against the v1.0 roadmap; the `-preview.1` tag
exists to buffer in bug reports before a `1.0.0` stable cut.

### Added

- **MCP Apps host** — first-class support for MCP servers that expose UI
  resources via `ui://` URIs. Apps render in a sandboxed iframe inside the
  desktop side panel with a JSON-RPC postMessage bridge to the host (Phase
  15/16). Individual apps are pinnable as dedicated sidebar tabs (Phase 21).
- **Activity visualization** — real-time spatial view of agent file and tool
  activity. Desktop: Canvas-based grid with per-file color coding. TUI:
  character-cell grid overlay toggled with `<leader>v` (Phase 17/19).
- **Port preview panel** — auto-detects dev-server ports from bash tool output
  (`http://localhost:PORT`, `Listening on :PORT`, Vite/Next/Express patterns)
  and opens an embedded `<iframe>` preview tab (Phase 21).
- **TUI Activity View** — character-cell grid with agent status bar and
  recent-file activity indicators, toggled via keybind (Phase 19).
- **Desktop app** — Tauri-based, Solid.js UI; full macOS/Linux/Windows
  support with unified sidebar, file tree, terminal, and session timeline
  (Phase 4).
- **Brand assets** — LC monogram, full logo lockups (dark/light), Tater
  mascot, favicon set, Tauri app icons across dev/beta/prod channels (Phase
  12).
- **i18n package** — `@librecode/i18n` on npm, 18 locales across app/ui/desktop
  (Phase 11).
- **3rd-party providers** — `@librecode/provider-anthropic`,
  `@librecode/provider-openai`, `@librecode/provider-openrouter`, and the
  `@librecode/provider-bundle` meta-package on npm (Phase 7).
- **Community provider ecosystem** — plugin system for adding providers
  without modifying the core; documented in `docs/providers.md`.
- **Distribution channels**:
  - Flatpak manifest (`com.librecode.desktop`, GNOME Platform 47)
  - AUR PKGBUILD (`packaging/PKGBUILD`)
  - COPR spec (`packages/rpm/librecode.spec`)
  - Nix flake (`nix run github:techtoboggan/librecode`)
  - Homebrew formula (`contrib/homebrew/librecode.rb`) — macOS + Linux
  - Universal installer: `scripts/install.sh` (Unix), `scripts/install.ps1` (Windows)
  - AppImage (Linux desktop)
- **Config JSON schema** — `schema/config.json` published as a GitHub-hosted
  schema for editor autocomplete. Use via:
  ```json
  {
    "$schema": "https://raw.githubusercontent.com/techtoboggan/librecode/main/schema/config.json"
  }
  ```
- **Core providers** — Anthropic (direct + Vertex + Bedrock), OpenAI,
  OpenRouter, Google (Gemini + Vertex), xAI, Mistral, Groq, DeepInfra,
  Cerebras, Cohere, Together, Perplexity, Vercel, GitLab, LiteLLM, Ollama,
  Amazon Bedrock, Azure (Phase 6).

### Changed

- Removed Effect-ts entirely — all services are now plain async/await (ADR-001).
- Namespace exports → module exports across `MessageV2`, `Provider`, `Session`,
  `SessionPrompt`.
- **Linted to zero warnings** — `bunx biome lint` returns 0 (down from 1,933).
- **Test suite**: 1,607 passing, 0 failing. Test files: 123. Coverage:
  packages/util 99%, packages/librecode 73%.
- **Complexity cap**: max cyclomatic complexity 12 per function, enforced.
- **Agent prompt rebrand**: all system prompt templates identify the agent as
  "LibreCode" and point users to the
  `techtoboggan/librecode` repository for issues and docs.
- **Nix dev shell**: upgraded from `nodejs_20` → `nodejs_24` (GitHub Actions
  Node 20 deprecation coming June 2026).

### Removed

- **opncd.ai share feature** — removed entirely. LibreCode is local-first;
  sharing sessions to external services is out of scope.
- **Auto-update on Linux** — Linux desktop users should install and update via
  their distribution package manager (RPM/COPR, AUR, Nix, Flatpak). Tauri
  updater remains enabled on macOS and Windows.

### Security

- **Symlink escape**: `Filesystem.contains()` now resolves symlinks before
  containment checks. Previously, a symlink inside a project could point
  outside and bypass the boundary check.
- **Windows cross-drive containment**: paths on different drive letters are
  correctly rejected (previously a lexical comparison could allow cross-drive
  bypass).
- **SSRF fix** in `/provider/scan` — arbitrary URL scanning restricted.
- **Token redaction** — partial access tokens are now redacted from log output
  (`mcp/helpers.ts`).

### Known Limitations

- **macOS DMG** is unsigned and unnotarized for this preview (no Apple
  Developer account yet). Users will see a "downloaded from the internet"
  warning on first launch. A signed `.dmg` will follow in a patch release.
- **Intel macOS** is not included in the CLI release — the macos-13 GitHub
  runner has poor availability. Intel Mac users can install via Homebrew
  (Rosetta 2) or the Linux-x64 tarball with Rosetta.
- **`th` and `tr` desktop locales** — Thai and Turkish translations for the
  desktop app are stubs in this preview; full translations will follow.

### Upgrade Notes

- Rename any `$schema` in existing `.librecode/config.json` files to point
  at the new stable schema URL (shown above).
- The old opncd.ai `share` field in config is removed. Configs still
  referencing it will fail the strict schema validation — remove the field.

---

## Before 1.0.0-preview.1

LibreCode is a fork of opencode v1.2.27. Pre-preview development happened in
21 numbered phases (0–21) tracked in [PLAN.md](PLAN.md). Highlights from
that work, included in this preview:

- Effect-ts removal, namespace-to-module migration (Phase 0–2)
- Desktop app + Tauri integration (Phase 4)
- Provider plugin system + loader extraction (Phase 6)
- npm package publication (Phase 7, 11)
- Brand redesign + Tater mascot (Phase 12)
- Zero lint warnings (Phase 13)
- Security hardening (Phase 14)
- MCP Apps host (Phase 15/16)
- Activity visualization (Phase 17)
- opncd.ai removal (Phase 18)
- TUI Activity View (Phase 19)
- Coverage push (Phase 20)
- MCP App pinning + Port preview (Phase 21)

See [PLAN.md](PLAN.md) for the full change history.
