/**
 * Telemetry channels — typed real-time data sources an MCP app can consume
 * (Phase 55B, ADR-0011). Each channel has a `snapshot` (initial state) and
 * `delta` (incremental update) shape. The host broker (telemetry-broker.ts)
 * shapes bus events into these and posts them to subscribing app iframes as
 * `{ type: "mcp-app-channel", channel, kind, payload, seq }` envelopes.
 *
 * H0 scope: 3 derived channels (tasks, agents, cost) sourced from existing bus
 * events. Payloads are derived/aggregated ONLY — no file contents, tool args,
 * message bodies, or secrets (ADR-0011 §4).
 *
 * NOTE (H0): these live in the app frontend for now. Phase 55E (H1) extracts
 * them to `@librecode/sdk/hud` so third-party app authors can type against the
 * same contract. Keep the shapes additive-only so that move is non-breaking.
 */

import { z } from "zod"

// ─── tasks (from `todo.updated`) ─────────────────────────────────────────────
export const TaskItem = z.object({
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]),
})
export type TaskItem = z.infer<typeof TaskItem>

export const TasksSnapshot = z.object({
  items: z.array(TaskItem),
  cleared: z.number(), // completed + cancelled
  total: z.number(),
})
export type TasksSnapshot = z.infer<typeof TasksSnapshot>
// todo.updated always carries the full list, so a delta is the same shape.
export const TasksDelta = TasksSnapshot
export type TasksDelta = TasksSnapshot

// ─── agents (from `activity.updated` → agents) ───────────────────────────────
export const AgentEntry = z.object({
  agentID: z.string(),
  phase: z.string(),
  tool: z.string().optional(),
  file: z.string().optional(), // relative path only (no contents)
  at: z.number(),
})
export type AgentEntry = z.infer<typeof AgentEntry>

export const AgentsSnapshot = z.object({ agents: z.array(AgentEntry) })
export type AgentsSnapshot = z.infer<typeof AgentsSnapshot>
export const AgentsDelta = AgentsSnapshot
export type AgentsDelta = AgentsSnapshot

// ─── cost (from `message.updated` cost/tokens) ───────────────────────────────
export const CostSnapshot = z.object({
  usd: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  messages: z.number(),
})
export type CostSnapshot = z.infer<typeof CostSnapshot>
// cumulative; the broker recomputes + sends the whole figure (throttled).
export const CostDelta = CostSnapshot
export type CostDelta = CostSnapshot

// ─── registry ────────────────────────────────────────────────────────────────
export const CHANNEL_NAMES = ["tasks", "agents", "cost"] as const
export type ChannelName = (typeof CHANNEL_NAMES)[number]

export interface ChannelDef {
  /** Min ms between delta posts (trailing throttle/coalesce). */
  throttleMs: number
  snapshot: z.ZodTypeAny
  delta: z.ZodTypeAny
}

export const CHANNELS: Record<ChannelName, ChannelDef> = {
  tasks: { throttleMs: 0, snapshot: TasksSnapshot, delta: TasksDelta },
  agents: { throttleMs: 150, snapshot: AgentsSnapshot, delta: AgentsDelta },
  cost: { throttleMs: 250, snapshot: CostSnapshot, delta: CostDelta },
}

export function isChannelName(value: unknown): value is ChannelName {
  return typeof value === "string" && (CHANNEL_NAMES as readonly string[]).includes(value)
}

/** The host→app envelope. `seq` is per-channel monotonic so apps detect gaps. */
export const CHANNEL_MESSAGE_TYPE = "mcp-app-channel" as const
export interface ChannelMessage {
  type: typeof CHANNEL_MESSAGE_TYPE
  channel: ChannelName
  kind: "snapshot" | "delta"
  payload: unknown
  seq: number
}
