import { describe, expect, test } from "bun:test"
import { diagnose } from "../../src/mcp/diagnostics"

describe("MCP diagnostics", () => {
  test("classifies auth errors", () => {
    const result = diagnose("my-server", new Error("Unauthorized (401)"))
    expect(result.category).toBe("auth")
    expect(result.suggestions[0]).toContain("librecode mcp auth")
  })

  test("classifies dynamic registration errors", () => {
    const result = diagnose("my-server", new Error("Dynamic client_registration not supported"))
    expect(result.category).toBe("auth")
    expect(result.suggestions[0]).toContain("doesn't support dynamic client registration")
  })

  test("classifies connection refused (remote)", () => {
    const result = diagnose("api-server", new Error("ECONNREFUSED 127.0.0.1:8080"), {
      type: "remote",
      url: "http://localhost:8080",
    })
    expect(result.category).toBe("connection")
    expect(result.summary).toContain("Cannot reach")
    expect(result.suggestions.some((s) => s.toLowerCase().includes("verify"))).toBe(true)
  })

  test("classifies connection refused (local)", () => {
    const result = diagnose("local-server", new Error("ECONNREFUSED"), {
      type: "local",
      command: ["npx", "my-mcp-server"],
    })
    expect(result.category).toBe("connection")
    expect(result.suggestions[0]).toContain("crashed")
  })

  test("classifies timeout errors", () => {
    const result = diagnose("slow-server", new Error("Operation timed out after 30000ms"))
    expect(result.category).toBe("timeout")
    expect(result.suggestions).toEqual(expect.arrayContaining([expect.stringContaining("timeout")]))
  })

  test("classifies command not found", () => {
    const result = diagnose("missing-server", new Error("ENOENT: spawn uvx"), {
      type: "local",
      command: ["uvx", "my-server"],
    })
    expect(result.category).toBe("process")
    expect(result.summary).toContain("Command not found")
  })

  test("classifies permission denied", () => {
    const result = diagnose("perm-server", new Error("EACCES: permission denied"))
    expect(result.category).toBe("process")
    expect(result.suggestions[0]).toContain("permissions")
  })

  test("classifies protocol errors", () => {
    const result = diagnose("bad-server", new Error("Unexpected token < in JSON"))
    expect(result.category).toBe("protocol")
  })

  test("classifies config errors", () => {
    const result = diagnose("bad-config", new Error("Invalid URL: not-a-url"))
    expect(result.category).toBe("config")
  })

  test("falls back to unknown for unrecognized errors", () => {
    const result = diagnose("mystery-server", new Error("Something completely unexpected"))
    expect(result.category).toBe("unknown")
    expect(result.suggestions[0]).toContain("librecode mcp debug")
  })

  test("handles non-Error objects", () => {
    const result = diagnose("weird-server", "string error")
    expect(result.category).toBe("unknown")
    expect(result.detail).toBe("string error")
  })
})
