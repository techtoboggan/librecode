import { describe, expect, test } from "bun:test"
import {
  getToolCapabilities,
  getToolRisk,
  isReadOnly,
  TOOL_CAPABILITIES,
  TOOL_DEPENDENCIES,
} from "../../src/tool/capability-registry"

describe("TOOL_CAPABILITIES", () => {
  test("every built-in tool has capabilities declared", () => {
    const expectedTools = [
      "read",
      "glob",
      "list",
      "grep",
      "codesearch",
      "lsp",
      "edit",
      "write",
      "multiedit",
      "apply_patch",
      "bash",
      "webfetch",
      "websearch",
      "plan_enter",
      "plan_exit",
      "question",
      "todowrite",
      "todoread",
      "invalid",
      "task",
      "skill",
      "batch",
    ]
    for (const tool of expectedTools) {
      expect(TOOL_CAPABILITIES[tool]).toBeDefined()
    }
  })

  test("file readers are read-only", () => {
    for (const tool of ["read", "glob", "list", "grep", "codesearch"]) {
      const caps = TOOL_CAPABILITIES[tool]
      expect(caps.writes).toEqual([])
      expect(caps.sideEffects).toBe(false)
      expect(caps.risk).toBe("low")
    }
  })

  test("file writers have filesystem writes", () => {
    for (const tool of ["edit", "write", "multiedit", "apply_patch"]) {
      const caps = TOOL_CAPABILITIES[tool]
      expect(caps.writes).toContain("filesystem")
      expect(caps.sideEffects).toBe(true)
      expect(caps.risk).toBe("medium")
    }
  })

  test("bash is high risk with code execution", () => {
    const caps = TOOL_CAPABILITIES.bash
    expect(caps.executesCode).toBe(true)
    expect(caps.risk).toBe("high")
    expect(caps.sideEffects).toBe(true)
  })

  test("pure tools have no capabilities", () => {
    for (const tool of ["plan_enter", "plan_exit", "question", "todowrite", "todoread"]) {
      const caps = TOOL_CAPABILITIES[tool]
      expect(caps.reads).toEqual([])
      expect(caps.writes).toEqual([])
      expect(caps.sideEffects).toBe(false)
      expect(caps.risk).toBe("low")
    }
  })
})

describe("TOOL_DEPENDENCIES", () => {
  test("grep requires ripgrep", () => {
    const deps = TOOL_DEPENDENCIES.grep
    expect(deps?.binaries).toContain("rg")
  })

  test("bash requires shell", () => {
    const deps = TOOL_DEPENDENCIES.bash
    expect(deps?.runtime?.shell).toBe(true)
  })
})

describe("helper functions", () => {
  test("isReadOnly returns true for readers", () => {
    expect(isReadOnly("read")).toBe(true)
    expect(isReadOnly("glob")).toBe(true)
    expect(isReadOnly("grep")).toBe(true)
  })

  test("isReadOnly returns false for writers", () => {
    expect(isReadOnly("edit")).toBe(false)
    expect(isReadOnly("bash")).toBe(false)
    expect(isReadOnly("task")).toBe(false)
  })

  test("getToolRisk returns correct levels", () => {
    expect(getToolRisk("read")).toBe("low")
    expect(getToolRisk("edit")).toBe("medium")
    expect(getToolRisk("bash")).toBe("high")
    expect(getToolRisk("unknown-tool")).toBe("medium") // default
  })

  test("getToolCapabilities returns undefined for unknown tools", () => {
    expect(getToolCapabilities("nonexistent")).toBeUndefined()
  })
})
