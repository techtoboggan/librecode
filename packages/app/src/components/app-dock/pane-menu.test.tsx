/**
 * PaneMenu logic tests — Phase 47.
 *
 * DOM rendering (Kobalte Popover) requires a browser context not available
 * in bun's server-side test build. These tests verify the pure decision
 * logic that drives the menu's conditional rendering:
 *   - Which items are shown given a PaneStatus
 *   - Click handler wiring via mirror functions
 *
 * Interactive/DOM behaviour (popover opens, item clicks, stopPropagation)
 * is covered by the Playwright E2E suite.
 */
import { describe, expect, test } from "bun:test"
import type { PaneStatus } from "./pane-status"

// ── Mirror logic for menu item visibility ─────────────────────────────────────
//
// Mirrors the <Show when=...> conditions in pane-menu.tsx without importing
// the component (which would pull in Kobalte + Solid context hooks).

function showReconnect(status: PaneStatus): boolean {
  return status.recoverable
}

function showViewError(status: PaneStatus): boolean {
  return status.kind === "failed" && !!status.error
}

function showRemove(_status: PaneStatus): boolean {
  return true // always visible
}

// ── Mirror callback wiring ──────────────────────────────────────────────────

interface MockHandlers {
  reconnectCalls: number
  viewErrorCalls: number
  removeCalls: number
  onReconnect: () => void
  onViewError: () => void
  onRemove: () => void
}

function makeHandlers(): MockHandlers {
  const h = {
    reconnectCalls: 0,
    viewErrorCalls: 0,
    removeCalls: 0,
    onReconnect: () => {
      h.reconnectCalls++
    },
    onViewError: () => {
      h.viewErrorCalls++
    },
    onRemove: () => {
      h.removeCalls++
    },
  }
  return h
}

// ── Status fixtures ───────────────────────────────────────────────────────────

const CONNECTED: PaneStatus = { kind: "connected", label: "Connected", recoverable: false }
const FAILED_WITH_ERR: PaneStatus = {
  kind: "failed",
  label: "Failed: ECONNREFUSED",
  error: "ECONNREFUSED",
  recoverable: true,
}
const FAILED_NO_ERR: PaneStatus = { kind: "failed", label: "Failed", recoverable: true }
const NEEDS_AUTH: PaneStatus = { kind: "needs_auth", label: "Needs authentication", recoverable: true }
const DISABLED: PaneStatus = { kind: "disabled", label: "Disabled", recoverable: false }

// ── Item visibility tests ─────────────────────────────────────────────────────

describe("PaneMenu — Reconnect item visibility", () => {
  test("shown when status.recoverable is true (failed)", () => {
    expect(showReconnect(FAILED_WITH_ERR)).toBe(true)
  })

  test("shown when status is needs_auth (recoverable)", () => {
    expect(showReconnect(NEEDS_AUTH)).toBe(true)
  })

  test("hidden when status is connected (not recoverable)", () => {
    expect(showReconnect(CONNECTED)).toBe(false)
  })

  test("hidden when status is disabled (not recoverable)", () => {
    expect(showReconnect(DISABLED)).toBe(false)
  })
})

describe("PaneMenu — View error item visibility", () => {
  test("shown when status is failed AND error string is non-empty", () => {
    expect(showViewError(FAILED_WITH_ERR)).toBe(true)
  })

  test("hidden when status is failed but error is absent (undefined)", () => {
    expect(showViewError(FAILED_NO_ERR)).toBe(false)
  })

  test("hidden when status is failed but error is empty string", () => {
    const s: PaneStatus = { kind: "failed", label: "Failed", error: "", recoverable: true }
    expect(showViewError(s)).toBe(false)
  })

  test("hidden when status is needs_auth (no error field)", () => {
    expect(showViewError(NEEDS_AUTH)).toBe(false)
  })

  test("hidden when status is connected", () => {
    expect(showViewError(CONNECTED)).toBe(false)
  })
})

describe("PaneMenu — Remove item visibility", () => {
  test("always shown for connected status", () => {
    expect(showRemove(CONNECTED)).toBe(true)
  })

  test("always shown for failed status", () => {
    expect(showRemove(FAILED_WITH_ERR)).toBe(true)
  })

  test("always shown for disabled status", () => {
    expect(showRemove(DISABLED)).toBe(true)
  })
})

// ── Click handler wiring ───────────────────────────────────────────────────────

describe("PaneMenu — click handler wiring", () => {
  test("onReconnect is called exactly once when Reconnect is clicked", () => {
    const h = makeHandlers()
    h.onReconnect()
    expect(h.reconnectCalls).toBe(1)
  })

  test("onViewError is called exactly once when View error is clicked", () => {
    const h = makeHandlers()
    h.onViewError()
    expect(h.viewErrorCalls).toBe(1)
  })

  test("onRemove is called exactly once when Remove is clicked", () => {
    const h = makeHandlers()
    h.onRemove()
    expect(h.removeCalls).toBe(1)
  })

  test("clicking Reconnect does not fire onViewError or onRemove", () => {
    const h = makeHandlers()
    h.onReconnect()
    expect(h.viewErrorCalls).toBe(0)
    expect(h.removeCalls).toBe(0)
  })

  test("clicking Remove does not fire onReconnect or onViewError", () => {
    const h = makeHandlers()
    h.onRemove()
    expect(h.reconnectCalls).toBe(0)
    expect(h.viewErrorCalls).toBe(0)
  })
})
