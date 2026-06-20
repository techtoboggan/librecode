import { describe, expect, test } from "bun:test"
import { shouldShowInnerHeader, showFullInnerChrome } from "./chrome"

// Regression: the McpAppPanel inner header used to render unconditionally,
// duplicating the dock's PaneHeader title. These predicates gate it so the
// title only appears where there's no PaneHeader (detached / fullscreen).

describe("showFullInnerChrome — title + dot + Disconnect visibility", () => {
  test("detached (not embedded) → always full chrome, regardless of mode", () => {
    expect(showFullInnerChrome(false, "inline")).toBe(true)
    expect(showFullInnerChrome(undefined, "inline")).toBe(true)
    expect(showFullInnerChrome(false, "fullscreen")).toBe(true)
  })

  test("embedded + inline (in the dock) → suppressed (PaneHeader shows it)", () => {
    expect(showFullInnerChrome(true, "inline")).toBe(false)
  })

  test("embedded + fullscreen/overlay → full chrome (escapes the dock)", () => {
    expect(showFullInnerChrome(true, "fullscreen")).toBe(true)
    expect(showFullInnerChrome(true, "overlay")).toBe(true)
  })
})

describe("shouldShowInnerHeader — whether the inner header renders at all", () => {
  test("no iframe content yet → never renders", () => {
    expect(shouldShowInnerHeader({ embedded: true, displayMode: "inline", overlayCapable: true, hasDoc: false })).toBe(
      false,
    )
    expect(
      shouldShowInnerHeader({ embedded: false, displayMode: "inline", overlayCapable: false, hasDoc: false }),
    ).toBe(false)
  })

  test("dock-inline, not overlay-capable → hidden (the de-dup case, e.g. Activity Graph)", () => {
    expect(shouldShowInnerHeader({ embedded: true, displayMode: "inline", overlayCapable: false, hasDoc: true })).toBe(
      false,
    )
  })

  test("dock-inline, overlay-capable → shown as an action-only bar (Mission HUD ⤢ Overlay)", () => {
    expect(shouldShowInnerHeader({ embedded: true, displayMode: "inline", overlayCapable: true, hasDoc: true })).toBe(
      true,
    )
  })

  test("dock-fullscreen → shown (needs the Exit button)", () => {
    expect(
      shouldShowInnerHeader({ embedded: true, displayMode: "fullscreen", overlayCapable: false, hasDoc: true }),
    ).toBe(true)
  })

  test("detached (not embedded) inline → shown (only chrome there)", () => {
    expect(shouldShowInnerHeader({ embedded: false, displayMode: "inline", overlayCapable: false, hasDoc: true })).toBe(
      true,
    )
  })
})
