import { createEffect, createSignal, onCleanup } from "solid-js"
import type { SessionStatus } from "@librecode/sdk/v2/client"

export type StallState = "idle" | "streaming" | "stalled"

/**
 * Creates a reactive stall detector for LLM streaming sessions.
 *
 * Transitions:
 *   idle → streaming    when session status becomes "busy"
 *   streaming → stalled when no heartbeat() call arrives within `thresholdMs`
 *   stalled → streaming when heartbeat() is called again
 *   * → idle            when session status becomes "idle"
 *
 * Usage:
 *   const { state, heartbeat, elapsed } = createStallDetector(status, { thresholdMs: 30_000 })
 *   // call heartbeat() on every message.part.delta event
 */
export function createStallDetector(status: () => SessionStatus, options: { thresholdMs?: number } = {}) {
  const threshold = options.thresholdMs ?? 30_000
  const [state, setState] = createSignal<StallState>("idle")
  const [lastBeat, setLastBeat] = createSignal(Date.now())
  const [elapsed, setElapsed] = createSignal(0)

  let timer: ReturnType<typeof setInterval> | undefined

  function heartbeat() {
    setLastBeat(Date.now())
    if (state() === "stalled") setState("streaming")
  }

  function startTimer() {
    stopTimer()
    timer = setInterval(() => {
      const ms = Date.now() - lastBeat()
      setElapsed(ms)
      if (ms >= threshold && state() === "streaming") {
        setState("stalled")
      }
    }, 1_000)
  }

  function stopTimer() {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
    setElapsed(0)
  }

  createEffect(() => {
    const s = status()
    if (s.type === "busy" || s.type === "retry") {
      setState("streaming")
      setLastBeat(Date.now())
      startTimer()
    } else {
      setState("idle")
      stopTimer()
    }
  })

  onCleanup(stopTimer)

  return { state, heartbeat, elapsed } as const
}
