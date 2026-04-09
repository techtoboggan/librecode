import { describe, expect, test } from "bun:test"
import {
  InstructionCompiler,
  estimateTokens,
  formatCompiled,
  TIER_PRIORITY,
} from "../../src/session/instruction-compiler"

describe("InstructionCompiler", () => {
  test("adds and compiles entries in priority order", () => {
    const compiler = new InstructionCompiler()

    compiler.add("user instructions", "user", { type: "file", path: "~/.config/librecode/CLAUDE.md" })
    compiler.add("system prompt", "system", { type: "provider", name: "anthropic" })
    compiler.add("project readme", "project", { type: "file", path: "/repo/CLAUDE.md" })

    const result = compiler.compile()

    expect(result.sections).toHaveLength(3)
    // System should be first (highest priority)
    expect(result.sections[0].tier).toBe("system")
    // Then project
    expect(result.sections[1].tier).toBe("project")
    // Then user
    expect(result.sections[2].tier).toBe("user")
  })

  test("deduplicates identical content", () => {
    const compiler = new InstructionCompiler()

    compiler.add("same content", "project", { type: "file", path: "/a/CLAUDE.md" })
    compiler.add("same content", "user", { type: "file", path: "/b/CLAUDE.md" })

    const result = compiler.compile()
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].tier).toBe("project") // first one wins
  })

  test("deduplicates by source path", () => {
    const compiler = new InstructionCompiler()

    compiler.add("content v1", "project", { type: "file", path: "/repo/CLAUDE.md" })
    compiler.add("content v2", "project", { type: "file", path: "/repo/CLAUDE.md" })

    const result = compiler.compile()
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].content).toBe("content v1") // first wins
  })

  test("enforces total token budget", () => {
    const compiler = new InstructionCompiler()

    compiler.add("a".repeat(400), "system", { type: "provider", name: "base" }) // ~100 tokens
    compiler.add("b".repeat(400), "project", { type: "file", path: "/repo/CLAUDE.md" }) // ~100 tokens
    compiler.add("c".repeat(400), "user", { type: "file", path: "~/config" }) // ~100 tokens

    const result = compiler.compile({ maxTokens: 200 })

    expect(result.sections).toHaveLength(2) // system + project fit, user dropped
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0].tier).toBe("user")
  })

  test("enforces per-tier budget", () => {
    const compiler = new InstructionCompiler()

    compiler.add("a".repeat(200), "project", { type: "file", path: "/a/CLAUDE.md" }) // ~50 tokens
    compiler.add("b".repeat(200), "project", { type: "file", path: "/b/CLAUDE.md" }) // ~50 tokens
    compiler.add("c".repeat(200), "project", { type: "file", path: "/c/CLAUDE.md" }) // ~50 tokens

    const result = compiler.compile({ tierBudgets: { project: 100 } })

    expect(result.sections).toHaveLength(2) // first two fit
    expect(result.dropped).toHaveLength(1)
  })

  test("tracks token count", () => {
    const compiler = new InstructionCompiler()

    compiler.add("hello world", "system", { type: "provider", name: "test" })

    const result = compiler.compile()
    expect(result.totalTokens).toBe(estimateTokens("hello world"))
    expect(result.totalTokens).toBeGreaterThan(0)
  })

  test("tracks sources", () => {
    const compiler = new InstructionCompiler()

    compiler.add("system", "system", { type: "provider", name: "anthropic" })
    compiler.add("project", "project", { type: "file", path: "/repo/CLAUDE.md" })

    const result = compiler.compile()
    expect(result.sources).toHaveLength(2)
    expect(result.sources[0].type).toBe("provider")
    expect(result.sources[1].type).toBe("file")
  })

  test("calculates budget utilization", () => {
    const compiler = new InstructionCompiler()
    compiler.add("x".repeat(100), "system", { type: "provider", name: "test" })

    const result = compiler.compile({ maxTokens: 100 })
    expect(result.budgetUsed).toBeGreaterThan(0)
    expect(result.budgetUsed).toBeLessThanOrEqual(100)
  })

  test("addAll adds multiple entries", () => {
    const compiler = new InstructionCompiler()

    compiler.addAll([
      { content: "one", tier: "system", source: { type: "provider", name: "a" } },
      { content: "two", tier: "project", source: { type: "file", path: "/b" } },
    ])

    const result = compiler.compile()
    expect(result.sections).toHaveLength(2)
  })

  test("format instructions preserve insertion order within same tier", () => {
    const compiler = new InstructionCompiler()

    compiler.add("first project", "project", { type: "file", path: "/a" })
    compiler.add("second project", "project", { type: "file", path: "/b" })
    compiler.add("third project", "project", { type: "file", path: "/c" })

    const result = compiler.compile()
    expect(result.sections.map((s) => s.content)).toEqual(["first project", "second project", "third project"])
  })
})

describe("estimateTokens", () => {
  test("estimates 4 chars per token", () => {
    expect(estimateTokens("1234")).toBe(1)
    expect(estimateTokens("12345678")).toBe(2)
    expect(estimateTokens("")).toBe(0)
  })

  test("rounds up", () => {
    expect(estimateTokens("12345")).toBe(2) // 5/4 = 1.25, ceil = 2
  })
})

describe("TIER_PRIORITY", () => {
  test("system is highest priority", () => {
    expect(TIER_PRIORITY["system"]).toBeGreaterThan(TIER_PRIORITY["agent"])
    expect(TIER_PRIORITY["system"]).toBeGreaterThan(TIER_PRIORITY["project"])
    expect(TIER_PRIORITY["system"]).toBeGreaterThan(TIER_PRIORITY["user"])
  })

  test("format is higher than project", () => {
    expect(TIER_PRIORITY["format"]).toBeGreaterThan(TIER_PRIORITY["project"])
  })

  test("user is lowest non-contextual", () => {
    expect(TIER_PRIORITY["user"]).toBeGreaterThan(TIER_PRIORITY["contextual"])
  })
})

describe("formatCompiled", () => {
  test("produces readable output", () => {
    const compiler = new InstructionCompiler()
    compiler.add("system prompt", "system", { type: "provider", name: "anthropic" })
    compiler.add("project config", "project", { type: "file", path: "/repo/CLAUDE.md" })

    const result = compiler.compile({ maxTokens: 10000 })
    const formatted = formatCompiled(result)

    expect(formatted).toContain("Compiled 2 instruction sections")
    expect(formatted).toContain("system")
    expect(formatted).toContain("project")
    expect(formatted).toContain("anthropic")
    expect(formatted).toContain("/repo/CLAUDE.md")
  })
})
