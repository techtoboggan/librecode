/**
 * v0.9.74 — Curated import sources for the Agentic Control Panel.
 *
 * Each source describes a public git repository that ships a known
 * layout we can map onto LibreCode's primitives:
 *
 *   skills/<name>/SKILL.md     → ~/.config/librecode/skills/<name>/SKILL.md
 *   agents/<name>.md           → ~/.config/librecode/agents/<name>.md
 *
 * SKILL.md format already matches LibreCode's existing skill loader
 * (yaml frontmatter `name` + `description` + markdown body) so skills
 * are a 1:1 file copy with no transformation needed. Agents use the
 * same frontmatter shape and a new markdown-agent loader added in
 * v0.9.74 that mirrors the skill loader.
 *
 * The first two sources are obra/superpowers and
 * obra/superpowers-chrome — MIT-licensed Claude Code skill packs the
 * user wanted as the seed set. Adding more sources is a one-entry
 * append; the importer is generic over any source matching this shape.
 */

export interface ImportSource {
  /** Stable identifier used in API requests / config records. */
  id: string
  /** Human-readable name shown in the import dialog. */
  name: string
  /** Owner/repo on GitHub. */
  repo: string
  /** Branch to clone (defaults to `main` if omitted). */
  branch?: string
  /** Marketing description shown in the dialog. */
  description: string
  /** SPDX license identifier — surfaced in the dialog so users see what they're importing. */
  license: string
  /** Author/maintainer name (display only). */
  author: string
  /** Repository URL for the "view source" link. */
  homepage: string
  /** Subdirectories within the repo we know how to map. */
  contents: ImportContents
}

export interface ImportContents {
  /** Path relative to repo root containing `<name>/SKILL.md` directories. */
  skills?: string
  /** Path relative to repo root containing `<name>.md` agent files. */
  agents?: string
}

/**
 * Built-in catalog. Order is the order shown in the UI — featured
 * sources first. Adding a new source: copy an entry, change
 * id/repo/description, set the contents.skills / contents.agents
 * paths to wherever that repo puts them.
 */
export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: "superpowers",
    name: "Superpowers",
    repo: "obra/superpowers",
    description:
      "Jesse Vincent's agentic skills framework — TDD, debugging, code review, brainstorming, " +
      "subagent orchestration, git worktrees, and more. The 167k-star reference for Claude Code skills.",
    license: "MIT",
    author: "Jesse Vincent",
    homepage: "https://github.com/obra/superpowers",
    contents: {
      skills: "skills",
      agents: "agents",
    },
  },
  {
    id: "superpowers-chrome",
    name: "Superpowers Chrome",
    repo: "obra/superpowers-chrome",
    description:
      "Direct Chrome browser control for agents via DevTools Protocol — zero dependencies, " +
      "companion plugin to Superpowers.",
    license: "MIT",
    author: "Jesse Vincent",
    homepage: "https://github.com/obra/superpowers-chrome",
    contents: {
      skills: "skills",
    },
  },
  {
    id: "anthropic-skills",
    name: "Anthropic Skills Library",
    repo: "anthropics/skills",
    description:
      "Anthropic's official skills library — Cloudflare, browser automation, finance workflows, " +
      "file format helpers (xlsx, pdf, pptx). Curated by Anthropic.",
    license: "MIT",
    author: "Anthropic",
    homepage: "https://github.com/anthropics/skills",
    contents: {
      skills: "skills",
    },
  },
]

/** Look up a source by id. Returns undefined for unknown ids. */
export function findSource(id: string): ImportSource | undefined {
  return IMPORT_SOURCES.find((s) => s.id === id)
}
