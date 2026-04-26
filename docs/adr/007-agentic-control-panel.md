# ADR-007: Agentic Control Panel

**Status:** Accepted
**Date:** 2026-04-25
**Decision:** Add an in-app surface that lists and (eventually edits)
the four primitive types LibreCode composes — Agents, Skills,
Plugins, Tools — plus a pluggable importer that pulls curated
skill/agent packs from public git repos directly into the user's
config dir.

---

## Context

LibreCode has four extension points an end-user might want to
inspect, configure, or extend:

1. **Agents** — `~/.config/librecode/librecode.jsonc` `[agent.<name>]`
   blocks (config-driven), or v0.9.74 onward
   `~/.config/librecode/agents/<name>.md` files (frontmatter-driven).
2. **Skills** — `SKILL.md` files discovered across multiple roots
   (`~/.config/librecode/skills/`, project `.librecode/skills/`,
   `~/.claude/skills/`, `~/.agents/skills/`).
3. **Plugins** — npm modules or local file:// paths listed in
   librecode.jsonc; loaded into-process.
4. **Tools** — built-ins (`bash`, `read`, `edit`, …) plus
   `<config>/tools/*.{js,ts}` files plus plugin-contributed tools.

Before this release, none of these were surfaced in the UI. Users
discovered what was loaded by reading source code or scrolling
through long shell tab-completions. The user described the desired
surface as "kind of like callbacks to Windows XP control panel" —
sections for each primitive, with a clear "what's installed and
where did it come from" view.

The ecosystem also has thriving public libraries of skills + agents
designed for Claude Code that work without modification on any host
that respects the SKILL.md frontmatter format. The biggest is
[obra/superpowers](https://github.com/obra/superpowers) (167k stars,
MIT-licensed). Importing from these unlocks ~14 well-tuned skills
on first install.

## Decision

Ship a "Control Panel" section in the existing settings dialog with
four tabs (Agents, Skills, Plugins, Tools) backed by a new
`/control-panel/*` API surface. Skills tab gets an "Import" button
that pulls from a curated catalog of public git repos.

### Read-only first

v0.9.74 ships **list-only** views — no inline editing. Editing
agents and config still happens in librecode.jsonc; editing imported
skills/agents happens by editing the files in
`~/.config/librecode/{skills,agents}/imported/<source>/`. Inline
editing lands in v0.9.75+ once the read path is proven and we know
which fields users actually want to edit.

Rationale: inline editing of an agent (mode, model, prompt,
permissions) is a meaningful UX investment. Shipping the read views
first lets users discover what they have and gives us telemetry on
which sections need editing UX before we build it.

### Frontmatter format unchanged

Skill files imported from upstream use the existing SKILL.md
frontmatter (`name` + `description` + markdown body). Agents use
the same frontmatter shape for consistency:

```markdown
---
name: code-reviewer
description: Review uncommitted changes for security + correctness
mode: subagent # optional, defaults to subagent for files
model: anthropic/claude-opus-4-7 # optional, "providerID/modelID"
---

You are a code reviewer. Be thorough.
```

This is identical to Superpowers' `agents/code-reviewer.md`, so
imports are 1:1 file copies — no format translation. Future
upstream skill packs that adopt this convention work
out-of-the-box.

### Curated importer, not arbitrary URLs

The catalog is a hand-maintained list in
`packages/librecode/src/importer/sources.ts`. Adding a source is a
one-entry append — id, repo, license, description, content paths.
We deliberately don't accept arbitrary git URLs because:

1. **Safety** — code from a random URL runs on the user's machine.
   Curation gives us a moment to flag obviously-malicious or
   unmaintained sources.
2. **Layout assumptions** — the importer expects `skills/<name>/SKILL.md`
   and/or `agents/<name>.md`. Each source declares its own paths;
   arbitrary repos would need a discovery/spec step we haven't built.
3. **License hygiene** — the catalog records each source's license
   so the dialog can surface it. Arbitrary URLs would drop this
   visibility.

A future "custom source" affordance (paste a git URL, decide where
its files live) is a v0.10+ conversation once curated imports prove
the UX.

### Per-source namespacing on disk

Imports land at:

```
~/.config/librecode/skills/imported/<source>/<skill-name>/SKILL.md
~/.config/librecode/agents/imported/<source>/<agent>.md
~/.cache/librecode/imports/<source>/   # git clone
```

Two reasons:

1. **Collision-proofing** — Superpowers ships a `code-reviewer`
   agent; another source could too. Without namespacing, the
   second import overwrites the first silently.
2. **Removability** — `DELETE /control-panel/import` wipes the
   `<source>/` subtree cleanly. A flat layout would force us to
   track which files came from which source in a separate manifest.

The skill loader's existing `**/SKILL.md` glob picks up the nested
files automatically. The new agent loader uses the same recursive
glob, so the layout works without further wiring.

## Non-goals

- **Not a full marketplace.** mcpappfoundry.app remains the
  marketplace surface for MCP apps. The Control Panel is for skills,
  agents, plugins, and tools — primitives that compose into agentic
  workflows, not standalone apps.
- **Not editing arbitrary fields.** Mode/model/prompt for agents
  and disable toggles for plugins are the most likely v0.9.75
  additions. Editing tool permissions or plugin code stays out of
  scope — those need code review, not a UI form.
- **Not in its own MCP app yet.** The user explicitly wants this
  in-repo for now with the eventual extraction in mind. Component
  boundaries (separate `settings-control-panel.tsx` + client
  module + server route module) make extraction mechanical when
  the time comes.

## Architecture

```
┌─────────────────────────────────┐
│ dialog-settings.tsx (UI shell)  │
│   ├─ Tabs.Trigger "agents"      │   "Control Panel" section
│   ├─ Tabs.Trigger "skills"      │   in the existing settings
│   ├─ Tabs.Trigger "plugins"     │   dialog (not a new route)
│   └─ Tabs.Trigger "tools"       │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ settings-control-panel.tsx      │
│   ├─ <SettingsAgents />         │   List + section grouping
│   ├─ <SettingsSkills />         │   Import button → ImportDialog
│   ├─ <SettingsPlugins />        │
│   ├─ <SettingsTools />          │
│   └─ <ImportDialog />           │   Source catalog + run/remove
└────────────┬────────────────────┘
             │
             ▼ (HTTP via globalSDK.fetch)
┌─────────────────────────────────┐
│ server/routes/control-panel.ts  │
│   GET  /control-panel/agents    │   Pure delegations to existing
│   GET  /control-panel/skills    │   Agent.list / Skill.all /
│   GET  /control-panel/plugins   │   Plugin.list / ToolRegistry.descriptions
│   GET  /control-panel/tools     │
│   GET  /control-panel/import-sources
│   POST /control-panel/import
│   DELETE /control-panel/import
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ importer/                       │
│   sources.ts → catalog          │   3 seed sources:
│   index.ts   → runImport,       │   superpowers, superpowers-chrome,
│                removeImport     │   anthropic-skills
└─────────────────────────────────┘

agent.ts gains `loadMarkdownAgents()` so file-based agents from
~/.config/librecode/agents/**/*.md are discovered alongside the
existing config-defined agents.
```

## Consequences

**Good:**

- One discoverable place for users to see what's loaded across all
  four primitive types.
- Imports unlock ~14 well-tuned skills on first run (Superpowers
  v5.0.7 ships brainstorming, TDD, debugging, code review, etc.).
- File-based agents bring LibreCode in line with how every other
  Claude-ecosystem tool (Claude Code, Cursor, OpenCode) ships
  agents — drop a markdown file, get an agent.
- The importer is generic — adding the next curated source is one
  table entry, not a new code path.

**Bad:**

- Read-only views invite "where do I edit this?" questions in the
  short term. The hint copy under each section title points users
  at the right config file, but the experience isn't as good as a
  proper edit form.
- Curated catalog limits which sources users can pull from.
  Mitigated by the cheap "add a source" path (one PR to
  `sources.ts`).

**Neutral:**

- One dialog tab section that's now logically distinct from the
  existing "Server" section (Providers, Models, MCP Apps). Settings
  dialog is getting busy — extracting Control Panel into its own
  route or its own MCP app is a real option for v0.10.
- The importer requires `git` on the user's PATH. macOS / Linux
  installs cover this implicitly; Windows users may need to install
  Git for Windows. Worth a docs callout when Windows shipping
  becomes urgent.

## Known sources at launch

| ID                   | Repo                    | License | Contents       |
| -------------------- | ----------------------- | ------- | -------------- |
| `superpowers`        | obra/superpowers        | MIT     | skills, agents |
| `superpowers-chrome` | obra/superpowers-chrome | MIT     | skills         |
| `anthropic-skills`   | anthropics/skills       | MIT     | skills         |

Adding a fourth: append to `IMPORT_SOURCES` in `sources.ts`. The
catalog test asserts every entry has the fields the UI expects, so
a malformed addition fails CI before it ships.
