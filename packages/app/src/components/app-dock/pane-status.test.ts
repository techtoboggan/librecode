/**
 * Pure pane-status helpers — Phase 47.
 *
 * No Solid context imports; no DOM. All logic is pure function calls.
 */
import { describe, expect, test } from "bun:test"
import { deriveStatus, statusDotClass, type PaneStatusKind } from "./pane-status"

const BUILTIN_APP = { server: "__builtin__" }
const MCP_APP = { server: "fake-server" }

// ── deriveStatus ──────────────────────────────────────────────────────────────

describe("deriveStatus — built-in apps", () => {
  test("built-in always returns connected regardless of mcp map", () => {
    const status = deriveStatus(BUILTIN_APP, {})
    expect(status.kind).toBe("connected")
    expect(status.label).toBe("Connected (built-in)")
    expect(status.recoverable).toBe(false)
  })

  test("built-in returns connected even when map has unrelated entries", () => {
    const status = deriveStatus(BUILTIN_APP, { other: { status: "failed", error: "x" } })
    expect(status.kind).toBe("connected")
  })
})

describe("deriveStatus — missing entry", () => {
  test("missing mcp map entry returns connecting", () => {
    const status = deriveStatus(MCP_APP, {})
    expect(status.kind).toBe("connecting")
    expect(status.label).toBe("Connecting…")
    expect(status.recoverable).toBe(false)
  })

  test("explicit undefined value in map returns connecting", () => {
    const status = deriveStatus(MCP_APP, { "fake-server": undefined })
    expect(status.kind).toBe("connecting")
  })
})

describe("deriveStatus — connected", () => {
  test("connected status maps correctly", () => {
    const status = deriveStatus(MCP_APP, { "fake-server": { status: "connected" } })
    expect(status.kind).toBe("connected")
    expect(status.label).toBe("Connected")
    expect(status.recoverable).toBe(false)
  })
})

describe("deriveStatus — failed", () => {
  test("failed with error string produces label and error field", () => {
    const status = deriveStatus(MCP_APP, { "fake-server": { status: "failed", error: "ECONNREFUSED" } })
    expect(status.kind).toBe("failed")
    expect(status.label).toBe("Failed: ECONNREFUSED")
    expect(status.error).toBe("ECONNREFUSED")
    expect(status.recoverable).toBe(true)
  })

  test("failed without error string produces fallback label", () => {
    const status = deriveStatus(MCP_APP, { "fake-server": { status: "failed" } })
    expect(status.kind).toBe("failed")
    expect(status.label).toBe("Failed")
    expect(status.error).toBeUndefined()
    expect(status.recoverable).toBe(true)
  })

  test("needs_client_registration maps to failed kind with recoverable=true", () => {
    const status = deriveStatus(MCP_APP, {
      "fake-server": { status: "needs_client_registration", error: "no client_id" },
    })
    expect(status.kind).toBe("failed")
    expect(status.label).toBe("Client registration required")
    expect(status.error).toBe("no client_id")
    expect(status.recoverable).toBe(true)
  })
})

describe("deriveStatus — needs_auth", () => {
  test("needs_auth maps correctly and is recoverable", () => {
    const status = deriveStatus(MCP_APP, { "fake-server": { status: "needs_auth" } })
    expect(status.kind).toBe("needs_auth")
    expect(status.label).toBe("Needs authentication")
    expect(status.recoverable).toBe(true)
  })
})

describe("deriveStatus — disabled", () => {
  test("disabled maps correctly and is not recoverable", () => {
    const status = deriveStatus(MCP_APP, { "fake-server": { status: "disabled" } })
    expect(status.kind).toBe("disabled")
    expect(status.label).toBe("Disabled")
    expect(status.recoverable).toBe(false)
  })
})

describe("deriveStatus — unknown status", () => {
  test("unknown status value falls through to disabled with diagnostic label", () => {
    const status = deriveStatus(MCP_APP, { "fake-server": { status: "something_new" } })
    expect(status.kind).toBe("disabled")
    expect(status.label).toBe("Unknown status: something_new")
    expect(status.recoverable).toBe(false)
  })
})

// ── statusDotClass ─────────────────────────────────────────────────────────────

describe("statusDotClass", () => {
  const cases: [PaneStatusKind, string][] = [
    ["connected", "bg-green-500"],
    ["connecting", "bg-yellow-500 animate-pulse"],
    ["failed", "bg-red-500"],
    ["needs_auth", "bg-amber-500"],
    ["disabled", "bg-text-weaker"],
  ]

  for (const [kind, expected] of cases) {
    test(`${kind} returns "${expected}"`, () => {
      expect(statusDotClass(kind)).toBe(expected)
    })
  }
})
