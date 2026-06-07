/**
 * Telemetry broker (Phase 55B, ADR-0011) — shapes host bus events into
 * per-app telemetry channels and posts them to a subscribing app iframe as
 * `mcp-app-channel` envelopes.
 *
 * Additive for H0: this runs ALONGSIDE the legacy event forwarder
 * (events.ts) and is started only for apps that request channels. Phase 55B
 * (H1) retires the hardcoded forwarder and migrates the builtins onto channels.
 *
 * Security (ADR-0011 §4): the shaping functions emit derived/aggregated values
 * only — task content + status, agent phase + relative path, cumulative cost +
 * token counts. Never file contents, full tool args, or message bodies. The
 * shaping functions are pure + exported so the redaction is unit-tested.
 */

import {
  type AgentEntry,
  type AgentsSnapshot,
  CHANNELS,
  CHANNEL_MESSAGE_TYPE,
  type ChannelMessage,
  type ChannelName,
  type CostSnapshot,
  type TaskItem,
  type TasksSnapshot,
} from "./channels"

type PostTarget = { postMessage: (message: unknown, targetOrigin: string) => void } | null | undefined
type BusEvent = { type?: unknown; properties?: unknown }

// ─── Pure shaping (unit-tested; redaction lives here) ────────────────────────

export function shapeTasks(todos: ReadonlyArray<{ content: string; status: string; priority: string }>): TasksSnapshot {
  const items: TaskItem[] = todos.map((t) => ({
    content: String(t.content ?? ""),
    status: normalizeTaskStatus(t.status),
    priority: normalizePriority(t.priority),
  }))
  const cleared = items.filter((t) => t.status === "completed" || t.status === "cancelled").length
  return { items, cleared, total: items.length }
}

function normalizeTaskStatus(s: unknown): TaskItem["status"] {
  return s === "in_progress" || s === "completed" || s === "cancelled" ? s : "pending"
}
function normalizePriority(p: unknown): TaskItem["priority"] {
  return p === "high" || p === "low" ? p : "medium"
}

export function shapeAgents(
  agents: Readonly<
    Record<string, { agentID?: string; phase?: string; tool?: string; file?: string; updatedAt?: number }>
  >,
): AgentsSnapshot {
  const list: AgentEntry[] = Object.entries(agents ?? {}).map(([id, a]) => ({
    agentID: String(a?.agentID ?? id),
    phase: String(a?.phase ?? "idle"),
    tool: a?.tool ? String(a.tool) : undefined,
    file: a?.file ? String(a.file) : undefined, // relative path only — never contents
    at: typeof a?.updatedAt === "number" ? a.updatedAt : 0,
  }))
  return { agents: list }
}

/** Cumulative cost across messages, keyed by message id so re-emits replace. */
export function createCostAccumulator() {
  const perMessage = new Map<string, { usd: number; tokensIn: number; tokensOut: number }>()
  return {
    ingest(info: { id?: unknown; cost?: unknown; tokens?: { input?: unknown; output?: unknown } } | undefined): void {
      if (!info || typeof info.id !== "string") return
      perMessage.set(info.id, {
        usd: num(info.cost),
        tokensIn: num(info.tokens?.input),
        tokensOut: num(info.tokens?.output),
      })
    },
    snapshot(): CostSnapshot {
      let usd = 0
      let tokensIn = 0
      let tokensOut = 0
      for (const m of perMessage.values()) {
        usd += m.usd
        tokensIn += m.tokensIn
        tokensOut += m.tokensOut
      }
      return { usd, tokensIn, tokensOut, messages: perMessage.size }
    },
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

// ─── Broker ──────────────────────────────────────────────────────────────────

export interface TelemetryBrokerOptions {
  channels: ChannelName[]
  sessionID: () => string | undefined
  listen: (cb: (e: { name: string; details: unknown }) => void) => () => void
  getTarget: () => PostTarget
  /** Fetch the activity seed (for the `agents` snapshot). */
  fetchActivity: (sessionID: string) => Promise<{ agents?: Record<string, unknown> } | undefined>
  /** Fetch the stats seed (for the `cost` snapshot). */
  fetchStats: (sessionID: string) => Promise<{ messages?: Array<unknown> } | undefined>
}

/**
 * Start the broker. Subscribes to the bus immediately (buffering internal
 * state) and delivers snapshots when the app posts `mcp-app-ready`. Returns an
 * unsubscribe that tears down the bus listener, the ready listener, and any
 * pending throttle timers.
 */
export function createTelemetryBroker(opts: TelemetryBrokerOptions): () => void {
  const wanted = new Set(opts.channels)
  const seq: Record<string, number> = {}
  const pending: Record<string, ReturnType<typeof setTimeout> | undefined> = {}
  const cost = createCostAccumulator()
  let lastTodos: TasksSnapshot = { items: [], cleared: 0, total: 0 }
  let lastAgents: AgentsSnapshot = { agents: [] }
  let ready = false
  let disposed = false

  function send(channel: ChannelName, kind: ChannelMessage["kind"], payload: unknown): void {
    const target = opts.getTarget()
    if (!target) return
    seq[channel] = (seq[channel] ?? 0) + 1
    const msg: ChannelMessage = { type: CHANNEL_MESSAGE_TYPE, channel, kind, payload, seq: seq[channel] }
    try {
      target.postMessage(msg, "*")
    } catch {
      // iframe may be detached mid-render
    }
  }

  /** Trailing-throttle a delta so high-frequency channels stay bounded. */
  function sendDelta(channel: ChannelName, payload: () => unknown): void {
    if (!ready || !wanted.has(channel)) return
    const ms = CHANNELS[channel].throttleMs
    if (ms <= 0) {
      send(channel, "delta", payload())
      return
    }
    if (pending[channel]) return // a trailing post is already scheduled
    pending[channel] = setTimeout(() => {
      pending[channel] = undefined
      if (!disposed) send(channel, "delta", payload())
    }, ms)
  }

  function matchesSession(props: unknown): boolean {
    const want = opts.sessionID()
    if (!want) return true
    const sid = (props as { sessionID?: unknown })?.sessionID
    return typeof sid !== "string" || sid === want
  }

  const unlisten = opts.listen((e) => {
    const ev = e.details as BusEvent
    const props = ev?.properties
    switch (ev?.type) {
      case "todo.updated": {
        if (!matchesSession(props)) return
        const todos = (props as { todos?: unknown })?.todos
        lastTodos = shapeTasks(Array.isArray(todos) ? (todos as never[]) : [])
        sendDelta("tasks", () => lastTodos)
        break
      }
      case "activity.updated": {
        if (!matchesSession(props)) return
        const agents = (props as { agents?: Record<string, never> })?.agents ?? {}
        lastAgents = shapeAgents(agents)
        sendDelta("agents", () => lastAgents)
        break
      }
      case "message.updated": {
        const info = (props as { info?: { sessionID?: unknown } })?.info
        if (info && !matchesSession(info)) return
        cost.ingest(info as never)
        sendDelta("cost", () => cost.snapshot())
        break
      }
    }
  })

  // Deliver snapshots when the app signals it's listening.
  const onReady = async (e: MessageEvent) => {
    if (e.source !== opts.getTarget()) return
    if ((e.data as { type?: unknown })?.type !== "mcp-app-ready") return
    if (ready) return
    ready = true
    const sid = opts.sessionID()
    // Seed agents + cost from the REST snapshots (todos arrive via the bus).
    if (sid && wanted.has("agents")) {
      const activity = await opts.fetchActivity(sid).catch(() => undefined)
      if (activity?.agents) lastAgents = shapeAgents(activity.agents as never)
    }
    if (sid && wanted.has("cost")) {
      const stats = await opts.fetchStats(sid).catch(() => undefined)
      for (const m of stats?.messages ?? []) cost.ingest(m as never)
    }
    if (disposed) return
    if (wanted.has("tasks")) send("tasks", "snapshot", lastTodos)
    if (wanted.has("agents")) send("agents", "snapshot", lastAgents)
    if (wanted.has("cost")) send("cost", "snapshot", cost.snapshot())
  }
  window.addEventListener("message", onReady)

  return () => {
    disposed = true
    unlisten()
    window.removeEventListener("message", onReady)
    for (const t of Object.values(pending)) if (t) clearTimeout(t)
  }
}
