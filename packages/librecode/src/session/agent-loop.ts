/**
 * Agent Loop State Machine
 *
 * Formalizes the implicit agent loop in prompt.ts as an explicit state machine.
 * See ADR-003 for the full design rationale.
 *
 * The loop processes user messages through these states:
 *
 *   INITIALIZE → ROUTE → { SUBTASK | COMPACTION | PROCESS } → ... → EXIT
 *
 * Each state handler returns the next state, making transitions explicit.
 * State transition events are emitted for observability.
 */

import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"
import z from "zod"
import type { SessionID } from "./schema"

const log = Log.create({ service: "agent-loop" })

// ── State types ──

export type AgentState =
  | { type: "initialize" }
  | { type: "route" }
  | { type: "subtask"; taskAgent: string; taskPrompt: string }
  | { type: "compaction"; auto: boolean }
  | { type: "process"; step: number }
  | { type: "exit"; reason: ExitReason }

export type ExitReason =
  | "complete" // Model finished naturally (no more tool calls)
  | "abort" // User cancelled via AbortController
  | "error" // Unrecoverable error (API failure, invalid model, etc.)
  | "structured_output" // JSON schema result captured
  | "compaction_failed" // Context still too large after compaction attempt
  | "blocked" // Permission denied and continue_loop_on_deny is false
  | "max_steps" // Hit the maximum step limit

// ── Transition events ──

export const TransitionEvent = BusEvent.define(
  "agent.loop.transition",
  z.object({
    sessionID: z.string(),
    from: z.string(),
    to: z.string(),
    step: z.number(),
    reason: z.string().optional(),
    duration: z.number().optional(),
  }),
)

export const LoopStartEvent = BusEvent.define(
  "agent.loop.start",
  z.object({
    sessionID: z.string(),
    agent: z.string(),
    modelID: z.string(),
    providerID: z.string(),
  }),
)

export const LoopEndEvent = BusEvent.define(
  "agent.loop.end",
  z.object({
    sessionID: z.string(),
    reason: z.string(),
    steps: z.number(),
    duration: z.number(),
    toolCalls: z.number(),
  }),
)

// ── State tracker ──

/**
 * Tracks the current state of an agent loop for a session.
 * Used for observability — the actual loop logic stays in prompt.ts.
 */
export class AgentLoopTracker {
  private state: AgentState = { type: "initialize" }
  private step = 0
  private toolCalls = 0
  private startTime = performance.now()
  private lastTransition = performance.now()

  constructor(
    private sessionID: SessionID,
    private agent: string,
  ) {}

  /** Get the current state */
  current(): AgentState {
    return this.state
  }

  /** Get the current step number */
  currentStep(): number {
    return this.step
  }

  /** Record a state transition */
  transition(to: AgentState, reason?: string): void {
    const from = this.state
    const now = performance.now()
    const duration = Math.round(now - this.lastTransition)

    log.info("state transition", {
      sessionID: this.sessionID,
      from: from.type,
      to: to.type,
      step: this.step,
      reason,
      duration,
    })

    this.state = to
    this.lastTransition = now

    if (to.type === "process") {
      this.step = to.step
    }

    void Bus.publish(TransitionEvent, {
      sessionID: this.sessionID,
      from: from.type,
      to: to.type,
      step: this.step,
      reason,
      duration,
    }).catch(() => {})
  }

  /** Record a tool call within the current step */
  recordToolCall(): void {
    this.toolCalls++
  }

  /** Emit the loop start event */
  emitStart(modelID: string, providerID: string): void {
    void Bus.publish(LoopStartEvent, {
      sessionID: this.sessionID,
      agent: this.agent,
      modelID,
      providerID,
    }).catch(() => {})
  }

  /** Emit the loop end event */
  emitEnd(reason: ExitReason): void {
    const duration = Math.round(performance.now() - this.startTime)

    log.info("loop ended", {
      sessionID: this.sessionID,
      reason,
      steps: this.step,
      duration,
      toolCalls: this.toolCalls,
    })

    void Bus.publish(LoopEndEvent, {
      sessionID: this.sessionID,
      reason,
      steps: this.step,
      duration,
      toolCalls: this.toolCalls,
    }).catch(() => {})
  }
}

// ── Valid transitions (for documentation and future validation) ──

export const VALID_TRANSITIONS: Record<string, string[]> = {
  initialize: ["route", "exit"],
  route: ["subtask", "compaction", "process", "exit"],
  subtask: ["initialize"],
  compaction: ["initialize", "exit"],
  process: ["initialize", "exit"],
  exit: [], // terminal state
}

/**
 * Check if a transition is valid per the state machine definition.
 */
export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}
