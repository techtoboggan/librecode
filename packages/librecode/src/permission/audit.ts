/**
 * Permission Audit Log
 *
 * Records all permission decisions for observability and compliance.
 * Entries are written to a structured log file and emitted via Bus events.
 *
 * Each entry captures: who asked, what tool, what risk level, what was decided,
 * and what patterns were involved.
 */

import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import type { SessionID } from "@/session/schema"
import { getToolCapabilities, getToolRisk } from "@/tool/capability-registry"
import { Log } from "@/util/log"

const log = Log.create({ service: "permission.audit" })

// ── Audit event schemas ──

export const AuditEntry = z.object({
  timestamp: z.number(),
  sessionID: z.string(),
  type: z.enum(["asked", "auto_approved", "replied", "denied"]),
  permission: z.string(),
  patterns: z.array(z.string()),
  tool: z
    .object({
      messageID: z.string(),
      callID: z.string(),
    })
    .optional(),
  agent: z.string().optional(),
  risk: z.enum(["low", "medium", "high"]),
  capabilities: z
    .object({
      reads: z.array(z.string()),
      writes: z.array(z.string()),
      sideEffects: z.boolean(),
      executesCode: z.boolean().optional(),
    })
    .optional(),
  reply: z.enum(["once", "session", "always", "reject"]).optional(),
  reason: z.string().optional(),
})
export type AuditEntry = z.infer<typeof AuditEntry>

export const Event = {
  Logged: BusEvent.define("permission.audit", AuditEntry),
}

// ── Audit functions ──

export function logAsked(input: {
  sessionID: SessionID
  permission: string
  patterns: string[]
  tool?: { messageID: string; callID: string }
  agent?: string
}): void {
  const risk = getToolRisk(input.permission)
  const capabilities = getToolCapabilities(input.permission)

  const entry: AuditEntry = {
    timestamp: Date.now(),
    sessionID: input.sessionID,
    type: "asked",
    permission: input.permission,
    patterns: input.patterns,
    tool: input.tool,
    agent: input.agent,
    risk,
    capabilities: capabilities
      ? {
          reads: [...capabilities.reads],
          writes: [...capabilities.writes],
          sideEffects: capabilities.sideEffects,
          executesCode: capabilities.executesCode,
        }
      : undefined,
  }

  log.info("permission asked", entry)
  Bus.publish(Event.Logged, entry)
}

export function logAutoApproved(input: {
  sessionID: SessionID
  permission: string
  patterns: string[]
  reason: string
  agent?: string
}): void {
  const entry: AuditEntry = {
    timestamp: Date.now(),
    sessionID: input.sessionID,
    type: "auto_approved",
    permission: input.permission,
    patterns: input.patterns,
    risk: getToolRisk(input.permission),
    reason: input.reason,
    agent: input.agent,
  }

  log.info("permission auto-approved", entry)
  Bus.publish(Event.Logged, entry)
}

export function logReplied(input: {
  sessionID: SessionID
  permission: string
  patterns: string[]
  reply: "once" | "session" | "always" | "reject"
  agent?: string
}): void {
  const entry: AuditEntry = {
    timestamp: Date.now(),
    sessionID: input.sessionID,
    type: "replied",
    permission: input.permission,
    patterns: input.patterns,
    risk: getToolRisk(input.permission),
    reply: input.reply,
    agent: input.agent,
  }

  log.info("permission replied", entry)
  Bus.publish(Event.Logged, entry)
}

export function logDenied(input: {
  sessionID: SessionID
  permission: string
  patterns: string[]
  reason: string
  agent?: string
}): void {
  const entry: AuditEntry = {
    timestamp: Date.now(),
    sessionID: input.sessionID,
    type: "denied",
    permission: input.permission,
    patterns: input.patterns,
    risk: getToolRisk(input.permission),
    reason: input.reason,
    agent: input.agent,
  }

  log.warn("permission denied", entry)
  Bus.publish(Event.Logged, entry)
}
