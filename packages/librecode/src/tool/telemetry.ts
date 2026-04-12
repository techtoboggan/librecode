/**
 * Tool Execution Telemetry
 *
 * Captures timing, input/output size, and tool metadata for each execution.
 * Emitted via Bus events for observability dashboards and debugging.
 */

import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"
import { getToolRisk } from "./capability-registry"

const log = Log.create({ service: "tool.telemetry" })

export const ToolExecutionEvent = BusEvent.define(
  "tool.executed",
  z.object({
    toolID: z.string(),
    callID: z.string().optional(),
    sessionID: z.string(),
    agent: z.string(),
    risk: z.enum(["low", "medium", "high"]),
    duration: z.number(),
    inputSize: z.number(),
    outputSize: z.number(),
    truncated: z.boolean(),
    success: z.boolean(),
    error: z.string().optional(),
  }),
)

export type ToolExecutionData = z.infer<typeof ToolExecutionEvent.properties>

/**
 * Wrap a tool execute function with telemetry collection.
 * Returns the same result, but emits timing/size events.
 */
export function withTelemetry<TArgs, TResult extends { output: string; metadata: Record<string, unknown> }>(
  toolID: string,
  execute: (args: TArgs, ctx: { sessionID: string; agent: string; callID?: string }) => Promise<TResult>,
): (args: TArgs, ctx: { sessionID: string; agent: string; callID?: string }) => Promise<TResult> {
  return async (args, ctx) => {
    const start = performance.now()
    const inputSize = JSON.stringify(args).length

    try {
      const result = await execute(args, ctx)
      const duration = Math.round(performance.now() - start)
      const outputSize = result.output.length

      const data: ToolExecutionData = {
        toolID,
        callID: ctx.callID,
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        risk: getToolRisk(toolID),
        duration,
        inputSize,
        outputSize,
        truncated: Boolean(result.metadata.truncated),
        success: true,
      }

      log.info("tool executed", { toolID, duration, inputSize, outputSize })

      void Bus.publish(ToolExecutionEvent, data).catch(() => {})

      return result
    } catch (e) {
      const duration = Math.round(performance.now() - start)
      const error = e instanceof Error ? e.message : String(e)

      log.warn("tool execution failed", { toolID, duration, error })

      void Bus.publish(ToolExecutionEvent, {
        toolID,
        callID: ctx.callID,
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        risk: getToolRisk(toolID),
        duration,
        inputSize,
        outputSize: 0,
        truncated: false,
        success: false,
        error,
      }).catch(() => {})

      throw e
    }
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

/**
 * Format a byte size to a human-readable string.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
