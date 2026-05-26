/**
 * Unit tests for the "View as graph" button logic (Phase 46).
 *
 * DOM rendering is not available in bun test (Solid's server-side build
 * blocks client-only APIs). Tests import no Solid context hooks; they
 * mirror the pure reactive logic from ActivityTab using standalone functions,
 * matching the pattern established by start-menu.test.tsx (Phase 45) and
 * dock.test.tsx (Phase 42).
 *
 *   1. `dockEnabled` predicate — gates Show wrapper and onAdd guard.
 *   2. `isGraphInDock` predicate — gates disabled state and "In dock" label.
 *   3. `openActivityGraph` handler — add + toggle behaviour.
 *
 * Interactive behaviour (button renders, click fires, label toggles) is
 * covered by the Playwright E2E suite in packages/app/e2e/app-dock.spec.ts
 * (Phase 46 scenarios).
 */
import { describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { addEntry, defaultDockState, toggleVisibility } from "@/components/app-dock/state"
import { BUILTIN_URI_ACTIVITY_GRAPH } from "@/components/mcp-app-panel/seed"
import type { DockState } from "@/components/app-dock/types"
import type { McpAppResource } from "@/components/mcp-app-panel/types"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GRAPH_APP: McpAppResource = {
  server: "__builtin__",
  name: "Activity Graph",
  uri: BUILTIN_URI_ACTIVITY_GRAPH,
}

// ─── Mirror predicates ────────────────────────────────────────────────────────
//
// These replicate the inline accessors in ActivityTab without importing
// Solid context hooks (useSync, useContext) which are unavailable in the
// server-side bun test build.

function dockEnabledPredicate(config: unknown): boolean {
  return (config as { experimental?: { app_dock?: boolean } } | undefined)?.experimental?.app_dock === true
}

function isGraphInDockPredicate(enabled: boolean, entries: Array<{ uri: string }>): boolean {
  return enabled && entries.some((e) => e.uri === BUILTIN_URI_ACTIVITY_GRAPH)
}

/** Mirrors `openActivityGraph` from activity-grid.tsx (same logic, no Solid imports). */
function openActivityGraphMirror(
  ctx: { add: (app: McpAppResource) => void; toggle: () => void; state: () => { visibility: string } },
  isInDock: boolean,
): void {
  if (!isInDock) {
    ctx.add({
      server: "__builtin__",
      name: "Activity Graph",
      uri: BUILTIN_URI_ACTIVITY_GRAPH,
      description: "Live visualization of file edits and agent activity",
    })
  }
  if (ctx.state().visibility === "hidden") ctx.toggle()
}

// ─── dockEnabled ─────────────────────────────────────────────────────────────

describe("dockEnabled predicate", () => {
  test("false when config is undefined", () => {
    expect(dockEnabledPredicate(undefined)).toBe(false)
  })

  test("false when experimental.app_dock is false", () => {
    expect(dockEnabledPredicate({ experimental: { app_dock: false } })).toBe(false)
  })

  test("false when experimental key is absent", () => {
    expect(dockEnabledPredicate({})).toBe(false)
  })

  test("true when experimental.app_dock is true", () => {
    expect(dockEnabledPredicate({ experimental: { app_dock: true } })).toBe(true)
  })
})

// ─── isGraphInDock ────────────────────────────────────────────────────────────

describe("isGraphInDock predicate", () => {
  test("false when dock is disabled (graph in entries but flag off)", () => {
    const state = addEntry(defaultDockState(), { uri: GRAPH_APP.uri, app: GRAPH_APP })
    expect(isGraphInDockPredicate(false, state.entries)).toBe(false)
  })

  test("false when dock enabled but graph not in entries", () => {
    expect(isGraphInDockPredicate(true, defaultDockState().entries)).toBe(false)
  })

  test("true when dock enabled and graph URI is present in entries", () => {
    const state = addEntry(defaultDockState(), { uri: GRAPH_APP.uri, app: GRAPH_APP })
    expect(isGraphInDockPredicate(true, state.entries)).toBe(true)
  })

  test("reflects reactive store mutations inside createRoot", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<DockState>(defaultDockState())
      expect(isGraphInDockPredicate(true, (store as DockState).entries)).toBe(false)
      setStore(addEntry(store as DockState, { uri: GRAPH_APP.uri, app: GRAPH_APP }))
      expect(isGraphInDockPredicate(true, (store as DockState).entries)).toBe(true)
      dispose()
    })
  })
})

// ─── openActivityGraph handler ───────────────────────────────────────────────

describe("openActivityGraph handler", () => {
  function makeCtx(visibility: "hidden" | "visible" = "visible") {
    const add = mock((_app: McpAppResource) => {})
    const toggle = mock(() => {})
    return { ctx: { add, toggle, state: () => ({ visibility }) }, add, toggle }
  }

  test("adds Activity Graph with correct URI when not in dock", () => {
    const { ctx, add } = makeCtx()
    openActivityGraphMirror(ctx, false)
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0].uri).toBe(BUILTIN_URI_ACTIVITY_GRAPH)
    expect(add.mock.calls[0][0].server).toBe("__builtin__")
    expect(add.mock.calls[0][0].name).toBe("Activity Graph")
  })

  test("no double-add: skips add when graph is already in dock", () => {
    const { ctx, add, toggle } = makeCtx()
    openActivityGraphMirror(ctx, true)
    expect(add).not.toHaveBeenCalled()
    expect(toggle).not.toHaveBeenCalled()
  })

  test("toggles dock to visible when hidden and adding graph", () => {
    const { ctx, add, toggle } = makeCtx("hidden")
    openActivityGraphMirror(ctx, false)
    expect(add).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  test("does not toggle when dock is already visible", () => {
    const { ctx, add, toggle } = makeCtx("visible")
    openActivityGraphMirror(ctx, false)
    expect(add).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
  })

  test("toggleVisibility state contract: default is visible (v0.9.91), toggle flips to hidden", () => {
    // defaultDockState().visibility === "visible" as of v0.9.91, so toggling
    // once gives "hidden". Confirms the state helper that dockCtx.toggle()
    // calls works as expected in both directions.
    expect(defaultDockState().visibility).toBe("visible")
    const hidden = toggleVisibility(defaultDockState())
    expect(hidden.visibility).toBe("hidden")
    const backToVisible = toggleVisibility(hidden)
    expect(backToVisible.visibility).toBe("visible")
  })
})

// ─── fetchActivity auth — v0.9.94 hotfix regression coverage ──────────────────
//
// Mirrors the `fetchActivity` helper in activity-grid.tsx. The pre-hotfix
// version called the global `fetch` directly, which on Tauri production
// builds returned 401 (LIBRECODE_SERVER_PASSWORD gate) — surfaced to users
// as "TypeError: Load failed" via the CORS error wrapper. The fix accepts
// a FetchLike (typically `globalSDK.fetch` which injects Basic Auth).

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

async function fetchActivityMirror(
  fetchFn: FetchLike,
  baseUrl: string,
  directory: string,
  sessionID: string,
): Promise<{ files: Record<string, unknown>; agents: Record<string, unknown> }> {
  const url = new URL(`${baseUrl}/session/${sessionID}/activity`)
  url.searchParams.set("directory", directory)
  const res = await fetchFn(url.toString())
  if (!res.ok) throw new Error(`activity fetch failed: ${res.status}`)
  return res.json() as Promise<{ files: Record<string, unknown>; agents: Record<string, unknown> }>
}

describe("fetchActivity auth wiring (v0.9.94 hotfix)", () => {
  test("passes the provided fetchFn (not raw global fetch) — Bug 2", async () => {
    const calls: Array<string> = []
    const fakeFetch: FetchLike = async (input) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ files: {}, agents: {} }), { status: 200 })
    }
    await fetchActivityMirror(fakeFetch, "http://127.0.0.1:43749", "/home/u/proj", "ses_abc")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("/session/ses_abc/activity")
    expect(calls[0]).toContain("directory=%2Fhome%2Fu%2Fproj")
  })

  test("throws when the auth-aware fetch returns 401 (no silent swallow)", async () => {
    const fakeFetch: FetchLike = async () => new Response("Unauthorized", { status: 401 })
    await expect(fetchActivityMirror(fakeFetch, "http://127.0.0.1:43749", "/home/u/proj", "ses_abc")).rejects.toThrow(
      "activity fetch failed: 401",
    )
  })

  test("returns parsed JSON shape on success", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response(JSON.stringify({ files: { a: 1 }, agents: { b: 2 } }), { status: 200 })
    const result = await fetchActivityMirror(fakeFetch, "http://127.0.0.1:43749", "/p", "ses_x")
    expect(result.files).toEqual({ a: 1 })
    expect(result.agents).toEqual({ b: 2 })
  })
})
