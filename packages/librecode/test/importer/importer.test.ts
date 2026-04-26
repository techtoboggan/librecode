/**
 * v0.9.74 — Agentic Control Panel importer tests.
 *
 * Network paths (`runImport`'s `git clone` step) aren't exercised
 * here — they require live network and would fight CI. Instead:
 *
 *   - The pure `extractFrontmatterName` helper has full coverage
 *     since it runs on every imported file and is the format-bridge
 *     between SKILL.md (yaml frontmatter) and our internal record.
 *   - The catalog (`sources.ts`) is asserted to never silently
 *     drop a source — `findSource` round-trips every entry.
 *   - `destDirFor` produces stable, namespaced paths so two
 *     sources can't write into each other's slot.
 *
 * The end-to-end clone+copy path is covered by manual smoke testing
 * + the route-level integration test in `control-panel.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { destDirFor, extractFrontmatterName } from "../../src/importer"
import { findSource, IMPORT_SOURCES } from "../../src/importer/sources"

describe("extractFrontmatterName", () => {
  test("pulls a bare unquoted name", () => {
    expect(extractFrontmatterName("---\nname: brainstorming\ndescription: x\n---\nbody")).toBe("brainstorming")
  })

  test("strips double quotes", () => {
    expect(extractFrontmatterName('---\nname: "code-reviewer"\ndescription: x\n---\nbody')).toBe("code-reviewer")
  })

  test("strips single quotes", () => {
    expect(extractFrontmatterName("---\nname: 'tdd'\ndescription: x\n---\nbody")).toBe("tdd")
  })

  test("returns undefined when no frontmatter delimiter", () => {
    expect(extractFrontmatterName("# Just a heading\nname: not-frontmatter")).toBeUndefined()
  })

  test("returns undefined when frontmatter has no closing ---", () => {
    expect(extractFrontmatterName("---\nname: dangling\n")).toBeUndefined()
  })

  test("returns undefined when frontmatter has no name key", () => {
    expect(extractFrontmatterName("---\ndescription: x\n---\nbody")).toBeUndefined()
  })

  test("returns undefined when name is empty", () => {
    expect(extractFrontmatterName("---\nname: \ndescription: x\n---\nbody")).toBeUndefined()
    expect(extractFrontmatterName('---\nname: ""\n---\n')).toBeUndefined()
  })

  test("ignores comment lines and blank lines in frontmatter", () => {
    expect(extractFrontmatterName("---\n# this is a comment\n\nname: with-comments\ndescription: x\n---\nbody")).toBe(
      "with-comments",
    )
  })

  test("first 'name:' wins when there are multiple (matches yaml semantics)", () => {
    // yaml would actually error or take the last; for our line-by-line
    // parser the first wins. Document the behaviour.
    expect(extractFrontmatterName("---\nname: first\nname: second\n---\nbody")).toBe("first")
  })

  test("ignores keys that contain 'name' as a substring", () => {
    expect(extractFrontmatterName("---\nfilename: nope\nrealname: also-nope\n---\nbody")).toBeUndefined()
  })

  test("preserves hyphens, underscores, and dots in names", () => {
    expect(extractFrontmatterName("---\nname: foo.bar_baz-qux\n---\n")).toBe("foo.bar_baz-qux")
  })
})

describe("IMPORT_SOURCES catalog", () => {
  test("every source has the fields the UI expects", () => {
    for (const s of IMPORT_SOURCES) {
      expect(s.id).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(s.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
      expect(s.description).toBeTruthy()
      expect(s.license).toBeTruthy()
      expect(s.author).toBeTruthy()
      expect(s.homepage).toMatch(/^https?:\/\//)
      // At least one content slot — empty sources serve no purpose.
      expect(s.contents.skills || s.contents.agents).toBeTruthy()
    }
  })

  test("source ids are unique (catalog can't ship a collision)", () => {
    const ids = new Set(IMPORT_SOURCES.map((s) => s.id))
    expect(ids.size).toBe(IMPORT_SOURCES.length)
  })

  test("findSource round-trips every catalog entry", () => {
    for (const s of IMPORT_SOURCES) {
      expect(findSource(s.id)).toEqual(s)
    }
  })

  test("findSource returns undefined for unknown id", () => {
    expect(findSource("nope")).toBeUndefined()
    expect(findSource("")).toBeUndefined()
  })

  test("the seed catalog includes the user's three target sources", () => {
    // Locking in the v0.9.74 launch contents — adding more is fine,
    // dropping any of these is a regression.
    expect(IMPORT_SOURCES.find((s) => s.id === "superpowers")).toBeDefined()
    expect(IMPORT_SOURCES.find((s) => s.id === "superpowers-chrome")).toBeDefined()
    expect(IMPORT_SOURCES.find((s) => s.id === "anthropic-skills")).toBeDefined()
  })
})

describe("destDirFor", () => {
  test("namespaces by source so two sources can't collide on a same-named skill", () => {
    const a = destDirFor("superpowers", "skills")
    const b = destDirFor("anthropic-skills", "skills")
    expect(a).not.toBe(b)
    expect(a.endsWith("skills/imported/superpowers")).toBe(true)
    expect(b.endsWith("skills/imported/anthropic-skills")).toBe(true)
  })

  test("skills and agents land in different subtrees", () => {
    const skills = destDirFor("superpowers", "skills")
    const agents = destDirFor("superpowers", "agents")
    expect(skills).not.toBe(agents)
    expect(skills.includes("/skills/")).toBe(true)
    expect(agents.includes("/agents/")).toBe(true)
  })
})
