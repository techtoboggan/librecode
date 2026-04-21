/**
 * Unit coverage for the v0.9.45 ui/request-display-mode resolver.
 *
 * Per ADR-005 §5 + the v0.9.45 implementation:
 *   - "fullscreen" supported (returns "fullscreen")
 *   - "pip" not supported (defer; returns the current mode unchanged)
 *   - Anything else returns the current mode (per spec we don't error)
 */
import { describe, expect, test } from "bun:test"
import { HOST_AVAILABLE_DISPLAY_MODES, type HostDisplayMode, resolveDisplayModeRequest } from "./mcp-app-display-mode"

describe("HOST_AVAILABLE_DISPLAY_MODES", () => {
  test("inline + fullscreen, pip explicitly excluded (deferred per ADR-005)", () => {
    expect([...HOST_AVAILABLE_DISPLAY_MODES]).toEqual(["inline", "fullscreen"])
  })
})

describe("resolveDisplayModeRequest", () => {
  test("inline → inline", () => {
    expect(resolveDisplayModeRequest("inline", "fullscreen")).toBe("inline")
  })

  test("fullscreen → fullscreen", () => {
    expect(resolveDisplayModeRequest("fullscreen", "inline")).toBe("fullscreen")
  })

  test("pip → keeps current (unsupported, no error per spec)", () => {
    const current: HostDisplayMode = "inline"
    expect(resolveDisplayModeRequest("pip", current)).toBe(current)
  })

  test("garbage values keep current too", () => {
    expect(resolveDisplayModeRequest("nonsense", "inline")).toBe("inline")
    expect(resolveDisplayModeRequest("", "fullscreen")).toBe("fullscreen")
  })
})
