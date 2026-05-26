/**
 * Tests for createStateRelay — Phase 50b additions.
 *
 * Original state-relay logic is integration-tested via mcp-app-panel.test.ts.
 * These tests focus on the Phase 50b onSaveObserved callback:
 *   - Save message triggers the callback.
 *   - Load message does NOT trigger the callback (only save counts).
 *   - No callback provided: existing save behaviour unchanged.
 *   - Callback receives no arguments (it's a notification, not data).
 */
import { describe, expect, mock, test } from "bun:test"
import { createStateRelay } from "./state-relay"

// ── Mock fetch helpers ────────────────────────────────────────────────────────

function makeFetch(ok = true): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ state: null }),
      text: async () => "error",
    }) as Response
}

// ── Mock window pair ──────────────────────────────────────────────────────────

interface MockWindowPair {
  source: Window
  handler: ReturnType<typeof createStateRelay>
}

function makeWindowPair(opts?: { onSaveObserved?: () => void }): MockWindowPair {
  // We use the real window as both source and contentWindow for simplicity.
  // The handler checks `e.source === options.contentWindow`.
  const contentWindow = window
  const handler = createStateRelay({
    server: "test-server",
    uri: "ui://test/app",
    fetchFn: makeFetch(),
    baseUrl: "http://localhost:4096",
    contentWindow,
    onSaveObserved: opts?.onSaveObserved,
  })
  return { source: contentWindow, handler }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createStateRelay — onSaveObserved callback (Phase 50b)", () => {
  test("save message triggers onSaveObserved callback", async () => {
    const cb = mock<() => void>()
    const { source, handler } = makeWindowPair({ onSaveObserved: cb })

    await handler({ data: { type: "mcp-app-state:save", requestID: "r1", state: { x: 1 } }, source })

    // queueMicrotask schedules the callback; flush by waiting a tick.
    await new Promise((r) => setTimeout(r, 0))
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test("load message does NOT trigger onSaveObserved", async () => {
    const cb = mock<() => void>()
    const { source, handler } = makeWindowPair({ onSaveObserved: cb })

    await handler({ data: { type: "mcp-app-state:load", requestID: "r1" }, source })

    await new Promise((r) => setTimeout(r, 0))
    expect(cb).toHaveBeenCalledTimes(0)
  })

  test("no callback provided: save message handled without error", async () => {
    const { source, handler } = makeWindowPair() // no onSaveObserved

    await expect(
      handler({ data: { type: "mcp-app-state:save", requestID: "r1", state: null }, source }),
    ).resolves.toBeUndefined()
  })

  test("save from a different source window is ignored (no callback)", async () => {
    const cb = mock<() => void>()
    const { handler } = makeWindowPair({ onSaveObserved: cb })

    // source is undefined — different from contentWindow (which is `window`)
    await handler({ data: { type: "mcp-app-state:save", requestID: "r1", state: null }, source: undefined })

    await new Promise((r) => setTimeout(r, 0))
    expect(cb).toHaveBeenCalledTimes(0)
  })

  test("multiple save messages each trigger the callback once", async () => {
    const cb = mock<() => void>()
    const { source, handler } = makeWindowPair({ onSaveObserved: cb })

    await handler({ data: { type: "mcp-app-state:save", requestID: "r1", state: null }, source })
    await handler({ data: { type: "mcp-app-state:save", requestID: "r2", state: null }, source })

    await new Promise((r) => setTimeout(r, 0))
    expect(cb).toHaveBeenCalledTimes(2)
  })
})
