/**
 * v0.9.74 — file-based agent discovery from
 * `~/.config/librecode/agents/**\/*.md`.
 *
 * The pure `parseModelString` helper has full coverage; the
 * filesystem walk + frontmatter parsing is exercised against a
 * temp config dir so we know the loader interacts with real fs
 * entries (this is how it'll behave with imported Superpowers
 * agents/code-reviewer.md etc.).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadMarkdownAgents, parseModelString } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"

let configDir: string
const envBackup = { ...process.env }

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), "librecode-md-agents-"))
  // The agent loader keys off Global.Path.config (XDG_CONFIG_HOME).
  // Override XDG_CONFIG_HOME to point at our temp dir; Global.Path
  // composes `<XDG_CONFIG_HOME>/librecode` so we have to nest.
  const xdg = await fs.mkdtemp(path.join(os.tmpdir(), "librecode-md-xdg-"))
  await fs.mkdir(path.join(xdg, "librecode", "agents"), { recursive: true })
  process.env.XDG_CONFIG_HOME = xdg
  configDir = path.join(xdg, "librecode", "agents")
})

afterEach(async () => {
  process.env = { ...envBackup }
  await fs.rm(configDir, { recursive: true, force: true })
})

describe("parseModelString", () => {
  test("splits providerID/modelID at the first slash", () => {
    const result = parseModelString("anthropic/claude-opus-4-7")
    expect(String(result?.providerID)).toBe("anthropic")
    expect(String(result?.modelID)).toBe("claude-opus-4-7")
  })

  test("preserves additional slashes in the modelID half (e.g. openrouter routes)", () => {
    const result = parseModelString("openrouter/anthropic/claude-opus-4-7")
    expect(String(result?.providerID)).toBe("openrouter")
    expect(String(result?.modelID)).toBe("anthropic/claude-opus-4-7")
  })

  test("returns undefined for non-strings", () => {
    expect(parseModelString(undefined)).toBeUndefined()
    expect(parseModelString(null)).toBeUndefined()
    expect(parseModelString(42)).toBeUndefined()
    expect(parseModelString({})).toBeUndefined()
  })

  test("returns undefined when there's no slash", () => {
    expect(parseModelString("claude-opus")).toBeUndefined()
  })

  test("returns undefined when slash is at start (empty providerID)", () => {
    expect(parseModelString("/claude-opus")).toBeUndefined()
  })

  test("returns undefined when slash is at end (empty modelID)", () => {
    expect(parseModelString("anthropic/")).toBeUndefined()
  })
})

describe("loadMarkdownAgents", () => {
  const defaults: PermissionNext.Ruleset = []
  const user: PermissionNext.Ruleset = []

  test("loads a single markdown agent with name + description + body", async () => {
    await fs.writeFile(
      path.join(configDir, "code-reviewer.md"),
      `---
name: code-reviewer
description: Review uncommitted changes for security + correctness
---

You are a code reviewer. Be thorough.`,
      "utf8",
    )
    const agents = await loadMarkdownAgents(defaults, user, [configDir])
    const cr = agents.find((a) => a.name === "code-reviewer")
    expect(cr).toBeDefined()
    expect(cr?.description).toBe("Review uncommitted changes for security + correctness")
    expect(cr?.prompt).toContain("You are a code reviewer")
    // File-based agents default to subagent so they don't clash with
    // the user's primary unless explicitly requested.
    expect(cr?.mode).toBe("subagent")
    expect(cr?.native).toBe(false)
  })

  test("respects an explicit mode override in frontmatter", async () => {
    await fs.writeFile(
      path.join(configDir, "primary-thing.md"),
      `---
name: primary-thing
description: A primary agent
mode: primary
---
body`,
      "utf8",
    )
    const agents = await loadMarkdownAgents(defaults, user, [configDir])
    const a = agents.find((x) => x.name === "primary-thing")
    expect(a?.mode).toBe("primary")
  })

  test("parses model string into the structured shape", async () => {
    await fs.writeFile(
      path.join(configDir, "with-model.md"),
      `---
name: with-model
description: x
model: anthropic/claude-opus-4-7
---
body`,
      "utf8",
    )
    const agents = await loadMarkdownAgents(defaults, user, [configDir])
    const a = agents.find((x) => x.name === "with-model")
    expect(String(a?.model?.providerID)).toBe("anthropic")
    expect(String(a?.model?.modelID)).toBe("claude-opus-4-7")
  })

  test("falls back to filename when frontmatter has no name", async () => {
    await fs.writeFile(
      path.join(configDir, "no-name-key.md"),
      `---
description: anonymous
---
body`,
      "utf8",
    )
    const agents = await loadMarkdownAgents(defaults, user, [configDir])
    const a = agents.find((x) => x.name === "no-name-key")
    expect(a).toBeDefined()
  })

  test("dedupes by name when multiple files declare the same agent", async () => {
    await fs.writeFile(path.join(configDir, "dup1.md"), `---\nname: shared\ndescription: a\n---\nA`, "utf8")
    await fs.writeFile(path.join(configDir, "dup2.md"), `---\nname: shared\ndescription: b\n---\nB`, "utf8")
    const agents = await loadMarkdownAgents(defaults, user, [configDir])
    const matches = agents.filter((a) => a.name === "shared")
    expect(matches.length).toBe(1)
  })

  test("returns [] when the agents dir doesn't exist (fresh install)", async () => {
    await fs.rm(configDir, { recursive: true, force: true })
    const agents = await loadMarkdownAgents(defaults, user, [configDir])
    expect(agents).toEqual([])
  })

  test("recurses into subdirectories (matches imported/<source>/ layout)", async () => {
    const sub = path.join(configDir, "imported", "superpowers")
    await fs.mkdir(sub, { recursive: true })
    await fs.writeFile(
      path.join(sub, "code-reviewer.md"),
      `---\nname: code-reviewer\ndescription: x\n---\nbody`,
      "utf8",
    )
    const agents = await loadMarkdownAgents(defaults, user, [configDir])
    expect(agents.find((a) => a.name === "code-reviewer")).toBeDefined()
  })
})
