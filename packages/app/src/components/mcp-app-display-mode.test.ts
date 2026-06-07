/**
 * Unit coverage for the ui/request-display-mode resolver.
 *
 * Supported modes: "inline", "fullscreen", and "overlay" (Phase 55A / ADR-0011).
 *   - Supported requests win.
 *   - "pip" still not supported (deferred per ADR-005 §5) → keeps current.
 *   - Anything else returns the current mode (per spec we don't error).
 */
import { describe, expect, test } from "bun:test"
import { HOST_AVAILABLE_DISPLAY_MODES, type HostDisplayMode, resolveDisplayModeRequest } from "./mcp-app-display-mode"

describe("HOST_AVAILABLE_DISPLAY_MODES", () => {
  test("inline + fullscreen + overlay; pip still excluded (deferred per ADR-005)", () => {
    expect([...HOST_AVAILABLE_DISPLAY_MODES]).toEqual(["inline", "fullscreen", "overlay"])
  })
})

describe("resolveDisplayModeRequest", () => {
  test("inline → inline", () => {
    expect(resolveDisplayModeRequest("inline", "fullscreen")).toBe("inline")
  })

  test("fullscreen → fullscreen", () => {
    expect(resolveDisplayModeRequest("fullscreen", "inline")).toBe("fullscreen")
  })

  test("overlay → overlay (Phase 55A)", () => {
    expect(resolveDisplayModeRequest("overlay", "inline")).toBe("overlay")
    expect(resolveDisplayModeRequest("overlay", "fullscreen")).toBe("overlay")
  })

  test("can return from overlay back to inline/fullscreen", () => {
    expect(resolveDisplayModeRequest("inline", "overlay")).toBe("inline")
    expect(resolveDisplayModeRequest("fullscreen", "overlay")).toBe("fullscreen")
  })

  test("pip → keeps current (unsupported, no error per spec)", () => {
    const current: HostDisplayMode = "overlay"
    expect(resolveDisplayModeRequest("pip", current)).toBe(current)
  })

  test("garbage values keep current too", () => {
    expect(resolveDisplayModeRequest("nonsense", "inline")).toBe("inline")
    expect(resolveDisplayModeRequest("", "overlay")).toBe("overlay")
  })
})
