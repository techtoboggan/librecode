import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Tooltip } from "@librecode/ui/tooltip"
import type { EventActivityUpdated, EventMessagePartDelta } from "@librecode/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { formatTokens } from "@/utils/format-tokens"
import { createStallDetector } from "@/utils/stall-detector"

/**
 * Real-time streaming indicator in the session header.
 *
 * v0.9.58 — always visible, not just during active streaming. Before
 * this change, the indicator was wrapped in `<Show when={working()}>`
 * which hid it the instant a turn finished; users who wanted to see
 * the last turn's cost/tokens had to open Settings → MCP Apps →
 * Session Stats. Now the pill stays in the header with three
 * click-cycleable views:
 *
 *   - `last` (default): most recent assistant turn's input/output.
 *     During an active turn this shows the live delta counter.
 *   - `total`: session-wide accumulated tokens across every
 *     assistant turn so far.
 *   - `rate`: average output tokens/second across timed turns.
 *
 * The dot colour still reflects liveness: green+pulse while
 * streaming, amber when stalled (>30s since last delta), grey when
 * idle. The click affects only the numeric display — the dot and
 * phase label aren't user-toggleable.
 */
export function StreamingIndicator() {
  const { params } = useSessionLayout()
  const sync = useSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const sessionID = createMemo(() => params.id ?? "")
  const status = createMemo(() => sync.data.session_status[sessionID()] ?? { type: "idle" as const })
  const working = createMemo(() => status().type !== "idle")

  // Track current agent phase from activity events
  const [phase, setPhase] = createSignal("")
  const [currentTool, setCurrentTool] = createSignal("")
  const [deltaCount, setDeltaCount] = createSignal(0)

  // Per-session turn history for the session-total and avg-rate views.
  // Populated from `message.part.updated` events for step-finish parts
  // — one entry per assistant turn, aggregated across its steps.
  interface TurnStat {
    messageID: string
    input: number
    output: number
    cost: number
    /** First-delta → last-delta elapsed time, in ms. 0 when we don't have timing for this turn. */
    elapsedMs: number
  }
  const [turns, setTurns] = createStore<Record<string, TurnStat>>({})
  const [turnTimingStart, setTurnTimingStart] = createStore<Record<string, number>>({})

  // Stall detection
  const stall = createStallDetector(status, { thresholdMs: 30_000 })

  // Display-mode toggle. Cycles on click of the numeric section.
  type View = "last" | "total" | "rate"
  const [view, setView] = createSignal<View>("last")
  const cycleView = () => {
    setView((v) => (v === "last" ? "total" : v === "total" ? "rate" : "last"))
  }

  createEffect(() => {
    const sid = sessionID()
    if (!sid) return

    const unsub = globalSDK.event.listen((e) => {
      const event = e.details

      if (event.type === "message.part.delta") {
        const delta = event as EventMessagePartDelta
        if (delta.properties.sessionID !== sid) return
        stall.heartbeat()
        setDeltaCount((c) => c + 1)
        // First delta of a turn marks the clock start for tok/s.
        const mid = delta.properties.messageID
        if (mid && turnTimingStart[mid] === undefined) {
          setTurnTimingStart(mid, Date.now())
        }
      }

      if (event.type === "activity.updated") {
        const activity = (event as EventActivityUpdated).properties
        if (activity.sessionID !== sid) return
        const agents = Object.values(activity.agents)
        if (agents.length > 0) {
          const latest = agents.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
          setPhase(latest.phase)
          setCurrentTool(latest.tool ?? "")
        }
      }

      // Roll up per-turn token totals from step-finish parts. `latest
      // wins` on re-fires so repeated `message.part.updated` events
      // for the same step don't over-count — same dedup pattern the
      // session-stats reducer uses.
      if (event.type === "message.part.updated") {
        const payload = (event as { properties?: { part?: unknown } }).properties
        const part = payload?.part as
          | { type: string; id: string; messageID: string; cost?: number; tokens?: { input?: number; output?: number } }
          | undefined
        if (!part || part.type !== "step-finish") return
        if (!part.messageID) return
        const mid = part.messageID
        const now = Date.now()
        const start = turnTimingStart[mid] ?? now
        setTurns(
          produce((draft) => {
            const existing = draft[mid] ?? { messageID: mid, input: 0, output: 0, cost: 0, elapsedMs: 0 }
            existing.input = part.tokens?.input ?? existing.input
            existing.output = part.tokens?.output ?? existing.output
            existing.cost = part.cost ?? existing.cost
            existing.elapsedMs = Math.max(existing.elapsedMs, now - start)
            draft[mid] = existing
          }),
        )
      }
    })
    onCleanup(unsub)
  })

  // Reset the live counters (but NOT the per-turn history) when the
  // session goes idle. The pill stays visible with the last turn's
  // totals or the session-wide roll-up, depending on `view`.
  createEffect(() => {
    if (!working()) {
      setDeltaCount(0)
      setPhase("")
      setCurrentTool("")
    }
  })

  // Last-turn numbers — prefer the latest assistant message's settled
  // totals from sync (canonical once the turn finishes); fall back to
  // our live roll-up for in-flight turns.
  const lastTurn = createMemo(() => {
    const messages = sync.data.message[sessionID()] ?? []
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue
      return { input: msg.tokens.input, output: msg.tokens.output }
    }
    // In-flight first turn — no assistant message yet, but we may
    // have a live `turns` entry keyed by the streaming message id.
    const liveEntries = Object.values(turns)
    if (liveEntries.length > 0) {
      const last = liveEntries[liveEntries.length - 1]
      return { input: last.input, output: last.output }
    }
    return { input: 0, output: 0 }
  })

  const sessionTotals = createMemo(() => {
    const messages = sync.data.message[sessionID()] ?? []
    let input = 0
    let output = 0
    for (const msg of messages) {
      if (msg.role !== "assistant") continue
      input += msg.tokens.input
      output += msg.tokens.output
    }
    // Add any in-flight turn not yet in sync.
    for (const t of Object.values(turns)) {
      const already = messages.some((m) => m.id === t.messageID)
      if (already) continue
      input += t.input
      output += t.output
    }
    return { input, output }
  })

  const avgRate = createMemo(() => {
    const entries = Object.values(turns).filter((t) => t.elapsedMs > 0 && t.output > 0)
    if (entries.length === 0) return 0
    const totalOut = entries.reduce((s, e) => s + e.output, 0)
    const totalMs = entries.reduce((s, e) => s + e.elapsedMs, 0)
    return totalMs > 0 ? (totalOut / totalMs) * 1000 : 0
  })

  const phaseLabel = createMemo(() => {
    const p = phase()
    if (!p || p === "exit") return ""
    const tool = currentTool()
    if (tool) return tool
    if (p === "thinking") return language.t("session.streaming.thinking") ?? "thinking"
    if (p === "tool_use") return language.t("session.streaming.toolUse") ?? "using tool"
    return p
  })

  const dotColor = createMemo((): string => {
    const s = stall.state()
    if (s === "stalled") return "bg-amber-500"
    if (s === "streaming") return "bg-emerald-500"
    return "bg-zinc-500"
  })

  const elapsedLabel = createMemo(() => {
    const ms = stall.elapsed()
    if (ms < 1_000) return ""
    const s = Math.floor(ms / 1_000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m${s % 60}s`
  })

  const numericLabel = createMemo(() => {
    const v = view()
    if (v === "rate") {
      const r = avgRate()
      return r > 0 ? `${r.toFixed(1)} tok/s` : "— tok/s"
    }
    const t = v === "total" ? sessionTotals() : lastTurn()
    return `${formatTokens(t.input)}↑ ${formatTokens(t.output)}↓`
  })

  const viewHint = createMemo(() => {
    const v = view()
    if (v === "last") return "Last turn · click for session total"
    if (v === "total") return "Session total · click for avg tok/s"
    return "Avg output tok/s · click for last turn"
  })

  const tooltipContent = createMemo(() => {
    const parts: string[] = []
    const s = stall.state()
    if (s === "stalled") parts.push(`⚠ No response for ${elapsedLabel()}`)
    else if (s === "streaming") parts.push("● Streaming")
    else parts.push("○ Idle")
    parts.push(viewHint())
    const last = lastTurn()
    if (last.input > 0 || last.output > 0) {
      parts.push(`Last: ${formatTokens(last.input)} in · ${formatTokens(last.output)} out`)
    }
    const totals = sessionTotals()
    if (totals.input > 0 || totals.output > 0) {
      parts.push(`Session: ${formatTokens(totals.input)} in · ${formatTokens(totals.output)} out`)
    }
    const r = avgRate()
    if (r > 0) parts.push(`Rate: ${r.toFixed(1)} tok/s`)
    if (deltaCount() > 0) parts.push(`${deltaCount()} chunks received`)
    return parts.join("\n")
  })

  const idle = createMemo(() => !working())
  const hasAnyNumbers = createMemo(() => {
    const t = lastTurn()
    return t.input > 0 || t.output > 0 || sessionTotals().input > 0 || sessionTotals().output > 0
  })

  return (
    <Show when={sessionID()}>
      <Tooltip value={tooltipContent()} placement="bottom">
        <button
          type="button"
          onClick={cycleView}
          class="flex items-center gap-1.5 px-2 h-6 rounded-md border border-border-weak-base bg-surface-panel text-12-regular transition-opacity hover:border-border-strong-base"
          classList={{
            "text-text-weak": !idle(),
            "text-text-weaker opacity-70 hover:opacity-100": idle(),
          }}
          aria-label={`Streaming stats — ${viewHint()}`}
          data-view={view()}
          data-idle={idle()}
        >
          <span
            class="size-2 rounded-full shrink-0"
            classList={{
              [dotColor()]: true,
              "animate-pulse": stall.state() === "streaming",
            }}
          />
          <Show when={phaseLabel()}>
            <span class="truncate max-w-[120px]">{phaseLabel()}</span>
          </Show>
          <Show when={elapsedLabel() && stall.state() === "stalled"}>
            <span class="text-amber-500 tabular-nums">{elapsedLabel()}</span>
          </Show>
          <Show
            when={hasAnyNumbers() || view() === "rate"}
            fallback={<span class="tabular-nums text-text-weaker">—↑ —↓</span>}
          >
            <span class="tabular-nums">{numericLabel()}</span>
          </Show>
        </button>
      </Tooltip>
    </Show>
  )
}
