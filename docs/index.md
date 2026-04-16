# LibreCode Documentation

This directory holds developer-facing documentation for contributing to and
understanding LibreCode. User-facing install/usage docs live in the
[README](../README.md) and [CHANGELOG](../CHANGELOG.md).

## Table of contents

### Getting started

- [**README**](../README.md) — install, quick-start, package manager matrix
- [**troubleshooting.md**](troubleshooting.md) — common install + runtime issues
- [**development.md**](development.md) — local dev environment, monorepo layout, build scripts
- [**releasing.md**](releasing.md) — how to cut a release across all three repos
- [**CHANGELOG**](../CHANGELOG.md) — release notes

### Architecture

- [**architecture.md**](architecture.md) — system overview: CLI, TUI, desktop, agent loop, storage
- [**providers.md**](providers.md) — adding a community provider plugin (npm-published)
- [**quality-baseline.md**](quality-baseline.md) — test coverage baselines, lint budgets, complexity caps

### Decision records

- [**adr/0001-effect-ts-removal.md**](adr/0001-effect-ts-removal.md) — why Effect-ts was removed
- [**adr/0002-storage-drizzle.md**](adr/0002-storage-drizzle.md) — SQLite + Drizzle ORM choice
- [**adr/0003-agent-loop.md**](adr/0003-agent-loop.md) — loop state machine design
- [**adr/0004-auth-prompts.md**](adr/0004-auth-prompts.md) — provider auth UX patterns

### Roadmap

- [**PLAN.md**](../PLAN.md) — all numbered phases (0–22) with status

### Configuration reference

- [**schema/config.json**](../schema/config.json) — JSON Schema for `.librecode/config.json`
- Add this to your config for editor autocomplete:
  ```json
  { "$schema": "https://raw.githubusercontent.com/techtoboggan/librecode/main/schema/config.json" }
  ```

### Project conventions

- [**../CLAUDE.md**](../CLAUDE.md) — coding standards for AI coding agents contributing to this repo
- [**../AGENTS.md**](../AGENTS.md) — if present, additional agent guidance
