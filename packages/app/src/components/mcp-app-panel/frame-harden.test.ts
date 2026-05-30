/**
 * Regression (v0.10.15) — the dock crash was @kobalte/utils focus helpers
 * descending into our null-origin sandboxed MCP iframe via
 * `iframe.contentDocument.body`, which THROWS a SecurityError in WebKitGTK
 * (Tauri's real webview) but silently returns null in Chromium. That asymmetry
 * is why every Chromium-based test layer passed while the real desktop dock
 * never rendered.
 *
 * These tests exercise the REAL Kobalte functions (getAllTabbableIn,
 * getActiveElement) with an iframe whose `contentDocument` getter THROWS —
 * faithfully simulating WebKitGTK in happy-dom/Chromium — and prove:
 *   1. without the fix, Kobalte's walk throws (reproduces the crash), and
 *   2. hardenSandboxedFrame() makes contentDocument return null, so Kobalte
 *      short-circuits and the walk completes without throwing.
 */

import { describe, expect, test, beforeEach } from "bun:test"
import { getAllTabbableIn, getActiveElement } from "@kobalte/utils"
import { hardenSandboxedFrame } from "./frame-harden"

// Simulate WebKitGTK: reading contentDocument on a null-origin sandboxed frame
// throws a SecurityError. (happy-dom/Chromium would otherwise return a real or
// null document and never reproduce the bug.) Made configurable so the fix's
// own-property redefine can shadow it — exactly as it shadows the native
// prototype getter on a real element.
function makeWebKitSandboxedIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe")
  Object.defineProperty(iframe, "contentDocument", {
    configurable: true,
    get() {
      throw new Error(
        "Sandbox access violation: Blocked a frame at 'tauri://localhost' from accessing a frame at 'null'.",
      )
    },
  })
  return iframe
}

describe("hardenSandboxedFrame", () => {
  test("makes contentDocument return null instead of throwing (WebKit parity with Chromium)", () => {
    const iframe = makeWebKitSandboxedIframe()
    expect(() => iframe.contentDocument).toThrow() // precondition: reproduces the WebKit crash
    hardenSandboxedFrame(iframe)
    expect(iframe.contentDocument).toBeNull() // fix: null, no throw
  })

  test("is idempotent", () => {
    const iframe = makeWebKitSandboxedIframe()
    hardenSandboxedFrame(iframe)
    hardenSandboxedFrame(iframe)
    expect(iframe.contentDocument).toBeNull()
  })
})

describe("real @kobalte/utils focus walk over a sandboxed iframe", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  test("getAllTabbableIn no longer throws after hardening (the dock crash path)", () => {
    const button = document.createElement("button")
    document.body.appendChild(button)
    const iframe = makeWebKitSandboxedIframe()
    document.body.appendChild(iframe)

    // Reproduce the crash: Kobalte descends into the frame and the throwing
    // contentDocument getter blows up the whole walk.
    expect(() => getAllTabbableIn(document.body, false)).toThrow()

    // Apply the fix; Kobalte's `isFrame(el) && el.contentDocument` guard now
    // sees null and skips the descent — the walk completes.
    hardenSandboxedFrame(iframe)
    expect(() => getAllTabbableIn(document.body, false)).not.toThrow()
  })

  test("getActiveElement no longer throws when the sandboxed iframe is active", () => {
    const iframe = makeWebKitSandboxedIframe()
    document.body.appendChild(iframe)
    // Force Kobalte's `isFrame(activeElement) && activeElement.contentDocument`
    // branch by making our throwing iframe the document's active element.
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => iframe })

    expect(() => getActiveElement(document.body)).toThrow()

    hardenSandboxedFrame(iframe)
    expect(() => getActiveElement(document.body)).not.toThrow()
  })
})
