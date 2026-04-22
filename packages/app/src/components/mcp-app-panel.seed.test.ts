import { describe, expect, test, mock } from "bun:test"
import {
  BUILTIN_URI_ACTIVITY_GRAPH,
  BUILTIN_URI_SESSION_STATS,
  SEEDABLE_BUILTIN_URIS,
  buildActivitySeedPayload,
  buildStatsSeedPayload,
  createReadyHandler,
  seedForSession,
} from "./mcp-app-panel"

describe("buildActivitySeedPayload", () => {
  test("shapes the payload the fs-activity-graph iframe listens for", () => {
    const out = buildActivitySeedPayload(
      "ses_abc",
      {
        files: { "src/a.ts": { path: "src/a.ts", kind: "read", updatedAt: 1 } },
        agents: { main: { agentID: "main", phase: "tool", updatedAt: 1 } },
      },
      1_700_000_000,
    )
    expect(out.type).toBe("activity.updated")
    expect(out.properties.sessionID).toBe("ses_abc")
    expect(out.properties.files["src/a.ts"]).toBeDefined()
    expect(out.properties.agents.main).toBeDefined()
    expect(out.properties.updatedAt).toBe(1_700_000_000)
  })

  test("defaults updatedAt to Date.now() when omitted", () => {
    const before = Date.now()
    const out = buildActivitySeedPayload("ses_x", { files: {}, agents: {} })
    const after = Date.now()
    expect(out.properties.updatedAt).toBeGreaterThanOrEqual(before)
    expect(out.properties.updatedAt).toBeLessThanOrEqual(after)
  })
})

describe("buildStatsSeedPayload", () => {
  test("emits one entry per message, in order, with defaults for missing fields", () => {
    const parts = {
      m1: [
        { type: "tool", tool: "read" },
        { type: "step-finish", cost: 0.01 },
      ],
      m2: [{ type: "text", text: "hi" }],
    }
    const out = buildStatsSeedPayload(
      [
        { id: "m1", role: "assistant", cost: 0.01, tokens: { input: 100, output: 20 } },
        { id: "m2", role: "user" },
      ],
      (id) => parts[id as keyof typeof parts],
    )

    expect(out.type).toBe("session.stats")
    expect(out.messages).toHaveLength(2)
    expect(out.messages[0].role).toBe("assistant")
    expect(out.messages[0].cost).toBe(0.01)
    expect(out.messages[0].parts).toHaveLength(2)
    expect(out.messages[1].role).toBe("user")
    // user message has no cost/tokens — defaults applied, not throwing
    expect(out.messages[1].cost).toBe(0)
    expect(out.messages[1].tokens).toEqual({})
    expect(out.messages[1].parts).toHaveLength(1)
  })

  test("tolerates missing parts lookup (returns empty array)", () => {
    const out = buildStatsSeedPayload([{ id: "m1", role: "assistant" }], () => undefined)
    expect(out.messages[0].parts).toEqual([])
  })

  test("empty message list still produces a valid payload", () => {
    const out = buildStatsSeedPayload([], () => [])
    expect(out).toEqual({ type: "session.stats", messages: [] })
  })
})

describe("SEEDABLE_BUILTIN_URIS", () => {
  test("contains the two URIs that have seed implementations", () => {
    expect(SEEDABLE_BUILTIN_URIS.has(BUILTIN_URI_ACTIVITY_GRAPH)).toBe(true)
    expect(SEEDABLE_BUILTIN_URIS.has(BUILTIN_URI_SESSION_STATS)).toBe(true)
    expect(SEEDABLE_BUILTIN_URIS.size).toBe(2)
  })
})

describe("createReadyHandler", () => {
  // A sentinel the handler compares `e.source` against. Using a distinct
  // object in tests isolates us from the real window so we can verify the
  // handler properly ignores events from other frames / posts.
  const contentWindow = { __iframe: true } as object

  function setup(uri: string, sessionID: string | undefined) {
    const seedActivity = mock<(id: string) => Promise<void>>(async () => {})
    const seedStats = mock<(id: string) => void>(() => {})
    const handler = createReadyHandler({ uri, sessionID, contentWindow, seedActivity, seedStats })
    return { handler, seedActivity, seedStats }
  }

  test("activity-graph URI: fires seedActivity, ignores seedStats", () => {
    const { handler, seedActivity, seedStats } = setup(BUILTIN_URI_ACTIVITY_GRAPH, "ses_a")
    handler({ source: contentWindow, data: { type: "mcp-app-ready" } })
    expect(seedActivity).toHaveBeenCalledTimes(1)
    expect(seedActivity.mock.calls[0][0]).toBe("ses_a")
    expect(seedStats).toHaveBeenCalledTimes(0)
  })

  test("session-stats URI: fires seedStats, ignores seedActivity", () => {
    const { handler, seedActivity, seedStats } = setup(BUILTIN_URI_SESSION_STATS, "ses_b")
    handler({ source: contentWindow, data: { type: "mcp-app-ready" } })
    expect(seedStats).toHaveBeenCalledTimes(1)
    expect(seedStats.mock.calls[0][0]).toBe("ses_b")
    expect(seedActivity).toHaveBeenCalledTimes(0)
  })

  test("seeds exactly once per session — second mcp-app-ready for the same session is ignored", () => {
    // v0.9.56 — the dedup key is (sessionID) not (iframe lifetime) so a
    // buggy app that spams ready for the same session still only seeds
    // once, but switching sessions correctly re-seeds.
    const { handler, seedActivity } = setup(BUILTIN_URI_ACTIVITY_GRAPH, "ses_c")
    handler({ source: contentWindow, data: { type: "mcp-app-ready" } })
    handler({ source: contentWindow, data: { type: "mcp-app-ready" } })
    handler({ source: contentWindow, data: { type: "mcp-app-ready" } })
    expect(seedActivity).toHaveBeenCalledTimes(1)
  })

  test("ignores events from a different source (another iframe / same origin)", () => {
    const { handler, seedActivity } = setup(BUILTIN_URI_ACTIVITY_GRAPH, "ses_d")
    const otherWindow = { __iframe: "other" }
    handler({ source: otherWindow, data: { type: "mcp-app-ready" } })
    expect(seedActivity).toHaveBeenCalledTimes(0)
  })

  test("ignores messages with the wrong type (not `mcp-app-ready`)", () => {
    const { handler, seedActivity } = setup(BUILTIN_URI_ACTIVITY_GRAPH, "ses_e")
    handler({ source: contentWindow, data: { type: "activity.updated" } })
    handler({ source: contentWindow, data: "string payload" })
    handler({ source: contentWindow, data: undefined })
    expect(seedActivity).toHaveBeenCalledTimes(0)
  })

  test("with no sessionID: ready fires, nothing seeds, fire-once state NOT consumed (fix for empty session stats)", () => {
    // v0.9.56 — previously we set `seeded = true` even when sessionID
    // was undefined, which meant a user who pinned the app before
    // entering a session would never get a seed once they did. Now
    // the dedup is keyed by sessionID, so a future ready from the
    // same iframe (which in practice only happens via our
    // `seedForSession` re-seed path) will seed correctly.
    const { handler, seedActivity, seedStats } = setup(BUILTIN_URI_ACTIVITY_GRAPH, undefined)
    handler({ source: contentWindow, data: { type: "mcp-app-ready" } })
    expect(seedActivity).toHaveBeenCalledTimes(0)
    expect(seedStats).toHaveBeenCalledTimes(0)
  })

  test("non-builtin URI: ready fires, but no seed runs (third-party apps bring their own data)", () => {
    const { handler, seedActivity, seedStats } = setup("ui://acme/custom-app", "ses_f")
    handler({ source: contentWindow, data: { type: "mcp-app-ready" } })
    expect(seedActivity).toHaveBeenCalledTimes(0)
    expect(seedStats).toHaveBeenCalledTimes(0)
  })

  test("new sessionID after a previous ready: handler re-seeds for the new session", () => {
    // v0.9.56 — users who navigate between sessions while an MCP app
    // pane is open need the pane to reflect each new session. The
    // handler uses options.sessionID (a live accessor), so re-issuing
    // the ready after the id changed should produce a second seed.
    const seedActivity = mock<(id: string) => Promise<void>>(async () => {})
    const seedStats = mock<(id: string) => void>(() => {})
    const options = {
      uri: BUILTIN_URI_ACTIVITY_GRAPH,
      sessionID: "ses_a" as string | undefined,
      contentWindow,
      seedActivity,
      seedStats,
    }
    const handler = createReadyHandler(options)
    handler({ source: contentWindow, data: { type: "mcp-app-ready" } })
    expect(seedActivity).toHaveBeenCalledTimes(1)
    expect(seedActivity.mock.calls[0][0]).toBe("ses_a")

    // User navigates to a different session; build a fresh handler
    // the way the createEffect does when props.sessionID changes.
    const handler2 = createReadyHandler({ ...options, sessionID: "ses_b" })
    handler2({ source: contentWindow, data: { type: "mcp-app-ready" } })
    expect(seedActivity).toHaveBeenCalledTimes(2)
    expect(seedActivity.mock.calls[1][0]).toBe("ses_b")
  })
})

describe("seedForSession", () => {
  test("activity-graph URI: runs seedActivity with the given session id", () => {
    const seedActivity = mock<(id: string) => Promise<void>>(async () => {})
    const seedStats = mock<(id: string) => void>(() => {})
    seedForSession({ uri: BUILTIN_URI_ACTIVITY_GRAPH, sessionID: "ses_x", seedActivity, seedStats })
    expect(seedActivity).toHaveBeenCalledTimes(1)
    expect(seedActivity.mock.calls[0][0]).toBe("ses_x")
    expect(seedStats).toHaveBeenCalledTimes(0)
  })

  test("session-stats URI: runs seedStats", () => {
    const seedActivity = mock<(id: string) => Promise<void>>(async () => {})
    const seedStats = mock<(id: string) => void>(() => {})
    seedForSession({ uri: BUILTIN_URI_SESSION_STATS, sessionID: "ses_y", seedActivity, seedStats })
    expect(seedStats).toHaveBeenCalledTimes(1)
    expect(seedStats.mock.calls[0][0]).toBe("ses_y")
  })

  test("non-builtin URI: nothing fires", () => {
    const seedActivity = mock<(id: string) => Promise<void>>(async () => {})
    const seedStats = mock<(id: string) => void>(() => {})
    seedForSession({ uri: "ui://acme/other", sessionID: "ses_z", seedActivity, seedStats })
    expect(seedActivity).toHaveBeenCalledTimes(0)
    expect(seedStats).toHaveBeenCalledTimes(0)
  })
})
