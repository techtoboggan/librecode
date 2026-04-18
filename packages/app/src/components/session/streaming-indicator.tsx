import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Tooltip } from "@librecode/ui/tooltip"
import type { EventActivityUpdated, EventMessagePartDelta } from "@librecode/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { formatTokens } from "@/utils/format-tokens"
import { createStallDetector } from "@/utils/stall-detector"

/**
 * Real-time streaming indicator showing:
 * - Pulsing dot: green (streaming), amber (stalled), red (error)
 * - Current agent phase label
 * - Token I/O counter (accumulated from step-finish parts)
 * - Elapsed time since last activity
 *
 * Mounts in the session header right portal area.
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

  // Stall detection
  const stall = createStallDetector(status, { thresholdMs: 30_000 })

  // Listen for SSE events
  createEffect(() => {
    const sid = sessionID()
    if (!sid) return

    const unsub = globalSDK.event.listen((e) => {
      const event = e.details

      // Track streaming deltas for liveness
      if (event.type === "message.part.delta") {
        const delta = event as EventMessagePartDelta
        if (delta.properties.sessionID !== sid) return
        stall.heartbeat()
        setDeltaCount((c) => c + 1)
      }

      // Track agent phase from activity updates
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
    })
    onCleanup(unsub)
  })

  // Reset counters when session goes idle
  createEffect(() => {
    if (!working()) {
      setDeltaCount(0)
      setPhase("")
      setCurrentTool("")
    }
  })

  // Token counts from the last assistant message
  const tokens = createMemo(() => {
    const messages = sync.data.message[sessionID()] ?? []
    let input = 0
    let output = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue
      input = msg.tokens.input
      output = msg.tokens.output
      break
    }
    return { input, output }
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

  const tooltipContent = createMemo(() => {
    const s = stall.state()
    const t = tokens()
    const parts: string[] = []
    if (s === "stalled") parts.push("⚠ No response for " + elapsedLabel())
    if (s === "streaming") parts.push("● Streaming")
    if (t.input > 0 || t.output > 0) {
      parts.push(`↑ ${formatTokens(t.input)} in  ↓ ${formatTokens(t.output)} out`)
    }
    if (deltaCount() > 0) parts.push(`${deltaCount()} chunks received`)
    return parts.join("\n") || "Idle"
  })

  return (
    <Show when={working()}>
      <Tooltip value={tooltipContent()} placement="bottom">
        <div class="flex items-center gap-1.5 px-2 h-6 rounded-md border border-border-weak-base bg-surface-panel text-12-regular text-text-weak cursor-default select-none">
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
          <Show when={tokens().input > 0 || tokens().output > 0}>
            <span class="tabular-nums text-text-weaker">
              {formatTokens(tokens().input)}↑ {formatTokens(tokens().output)}↓
            </span>
          </Show>
        </div>
      </Tooltip>
    </Show>
  )
}
