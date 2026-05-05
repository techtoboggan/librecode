/**
 * Initial-snapshot forwarding into MCP App iframes.
 *
 * Built-in apps (Activity Graph, Session Stats) only listen for
 * incremental events. On a fresh mount they would sit on an empty
 * placeholder until a tool call happens, so the panel posts a one-off
 * snapshot the first time the iframe signals `mcp-app-ready`. This
 * module owns the pure shape + the ready-handler factory so the panel
 * just supplies the seeders.
 */

/** Built-in URI → seed responsibility map. Exported for test coverage. */
export const BUILTIN_URI_ACTIVITY_GRAPH = "ui://builtin/activity-graph"
export const BUILTIN_URI_SESSION_STATS = "ui://builtin/session-stats"

export const SEEDABLE_BUILTIN_URIS = new Set<string>([BUILTIN_URI_ACTIVITY_GRAPH, BUILTIN_URI_SESSION_STATS])

/** Pure: shape the `activity.updated` seed payload for an iframe. */
export function buildActivitySeedPayload(
  sessionID: string,
  activity: { files: Record<string, unknown>; agents: Record<string, unknown> },
  now: number = Date.now(),
) {
  return {
    type: "activity.updated" as const,
    properties: {
      sessionID,
      files: activity.files,
      agents: activity.agents,
      updatedAt: now,
    },
  }
}

type SeedMessage = { role: string; cost: number; tokens: unknown; parts: unknown[] }

/**
 * Pure: shape the `session.stats` seed payload. Accepts raw message + part
 * lookups so tests don't need to stand up a whole sync context.
 */
export function buildStatsSeedPayload(
  messages: ReadonlyArray<{ id: string; role: string; cost?: number; tokens?: unknown }>,
  getParts: (messageID: string) => unknown[] | undefined,
): { type: "session.stats"; messages: SeedMessage[] } {
  return {
    type: "session.stats",
    messages: messages.map((m) => ({
      role: m.role,
      cost: m.cost ?? 0,
      tokens: m.tokens ?? {},
      parts: getParts(m.id) ?? [],
    })),
  }
}

/**
 * Build the `mcp-app-ready` listener used to seed a freshly-mounted app
 * iframe. v0.9.56 — the "seeded" flag is now keyed by sessionID so a
 * late-arriving session (common when the user pins an app before
 * entering a session) still seeds once the id appears. Re-entering the
 * same session does not re-seed; switching to a different session
 * does.
 */
export function createReadyHandler(options: {
  /** URI of the app being hosted — used to pick which seed to run. */
  uri: string
  /** Current session id; without one, no seeding happens. */
  sessionID: string | undefined
  /** The iframe's contentWindow — events with a different `source` are ignored. */
  contentWindow: unknown
  /** Run the activity-graph seed (async fetch + post). */
  seedActivity: (sessionID: string) => Promise<void>
  /** Run the session-stats seed (synchronous). */
  seedStats: (sessionID: string) => void | Promise<void>
}) {
  let seededSession: string | undefined
  return (e: { data?: unknown; source?: unknown }) => {
    if (e.source !== options.contentWindow) return
    const data = e.data as { type?: string } | undefined
    if (!data || data.type !== "mcp-app-ready") return
    const sessionID = options.sessionID
    if (!sessionID) return
    if (seededSession === sessionID) return
    seededSession = sessionID
    if (options.uri === BUILTIN_URI_ACTIVITY_GRAPH) void options.seedActivity(sessionID)
    else if (options.uri === BUILTIN_URI_SESSION_STATS) void options.seedStats(sessionID)
  }
}

/**
 * v0.9.56 — proactively seed an iframe when the sessionID becomes
 * available after the iframe was already mounted. Apps post
 * `mcp-app-ready` once on load; without this, a user who pins the app
 * *before* entering a session would never see any data because the
 * ready signal already fired (when sessionID was undefined) and the
 * iframe has no reason to post ready again.
 */
export function seedForSession(options: {
  uri: string
  sessionID: string
  seedActivity: (sessionID: string) => Promise<void>
  seedStats: (sessionID: string) => void | Promise<void>
}): void {
  if (options.uri === BUILTIN_URI_ACTIVITY_GRAPH) void options.seedActivity(options.sessionID)
  else if (options.uri === BUILTIN_URI_SESSION_STATS) void options.seedStats(options.sessionID)
}
