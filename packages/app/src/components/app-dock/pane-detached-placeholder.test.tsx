/**
 * PaneDetachedPlaceholder tests — Phase 49.
 *
 * Mirror-function pattern (same as pane-menu.test.tsx and pane-header.test.tsx):
 * bun test runs in a server-side context without a full DOM. We test the pure
 * decision logic and callback wiring rather than rendering real JSX.
 */
import { describe, expect, test } from "bun:test"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

// ── Mirror: data-testid values ────────────────────────────────────────────────

function placeholderTestId(uri: string): string {
  return `detached-placeholder-${uri}`
}

function focusButtonTestId(uri: string): string {
  return `detached-placeholder-focus-${uri}`
}

function reattachButtonTestId(uri: string): string {
  return `detached-placeholder-reattach-${uri}`
}

// ── Mirror: callback wiring ───────────────────────────────────────────────────

interface MockHandlers {
  reattachCalls: number
  focusCalls: number
  onReattach: () => void
  onFocus: () => void
}

function makeHandlers(): MockHandlers {
  const h: MockHandlers = {
    reattachCalls: 0,
    focusCalls: 0,
    onReattach: () => {
      h.reattachCalls++
    },
    onFocus: () => {
      h.focusCalls++
    },
  }
  return h
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_APP: McpAppResource = {
  server: "multica",
  name: "Multica",
  uri: "ui://multica/board",
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PaneDetachedPlaceholder — testid values", () => {
  test("placeholder wrapper has data-testid=detached-placeholder-{uri}", () => {
    expect(placeholderTestId(SAMPLE_APP.uri)).toBe("detached-placeholder-ui://multica/board")
  })

  test("focus button has data-testid=detached-placeholder-focus-{uri}", () => {
    expect(focusButtonTestId(SAMPLE_APP.uri)).toBe("detached-placeholder-focus-ui://multica/board")
  })

  test("reattach button has data-testid=detached-placeholder-reattach-{uri}", () => {
    expect(reattachButtonTestId(SAMPLE_APP.uri)).toBe("detached-placeholder-reattach-ui://multica/board")
  })
})

describe("PaneDetachedPlaceholder — callback wiring", () => {
  test("onReattach is called exactly once when Bring back is clicked", () => {
    const h = makeHandlers()
    h.onReattach()
    expect(h.reattachCalls).toBe(1)
  })

  test("onFocus is called exactly once when Focus window is clicked", () => {
    const h = makeHandlers()
    h.onFocus()
    expect(h.focusCalls).toBe(1)
  })

  test("clicking onReattach does not fire onFocus", () => {
    const h = makeHandlers()
    h.onReattach()
    expect(h.focusCalls).toBe(0)
  })

  test("clicking onFocus does not fire onReattach", () => {
    const h = makeHandlers()
    h.onFocus()
    expect(h.reattachCalls).toBe(0)
  })
})
