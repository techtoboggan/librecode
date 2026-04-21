/**
 * Permission Service
 *
 * Manages tool execution permissions with a pending request queue.
 * Supports allow/deny/ask rules with wildcard pattern matching.
 *
 * Migrated from Effect-ts to plain async per ADR-001.
 */

import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import * as Audit from "./audit"
import { PermissionID } from "./schema"

const log = Log.create({ service: "permission" })

// ── Schemas ──

export const Action = z.enum(["allow", "deny", "ask"]).meta({
  ref: "PermissionAction",
})
export type Action = z.infer<typeof Action>

export const Rule = z
  .object({
    permission: z.string(),
    pattern: z.string(),
    action: Action,
  })
  .meta({
    ref: "PermissionRule",
  })
export type Rule = z.infer<typeof Rule>

export const Ruleset = Rule.array().meta({
  ref: "PermissionRuleset",
})
export type Ruleset = z.infer<typeof Ruleset>

export const Request = z
  .object({
    id: PermissionID.zod,
    sessionID: SessionID.zod,
    permission: z.string(),
    patterns: z.string().array(),
    metadata: z.record(z.string(), z.any()),
    always: z.string().array(),
    tool: z
      .object({
        messageID: MessageID.zod,
        callID: z.string(),
      })
      .optional(),
  })
  .meta({
    ref: "PermissionRequest",
  })
export type Request = z.infer<typeof Request>

// "session" is the third tier requested for MCP-app permissions: stores
// the grant in-memory keyed by sessionID, so it persists for the rest
// of this session but does not leak across sessions or restarts.
export const Reply = z.enum(["once", "session", "always", "reject"])
export type Reply = z.infer<typeof Reply>

export const Approval = z.object({
  projectID: z.string(),
  patterns: z.string().array(),
})

export const Event = {
  Asked: BusEvent.define("permission.asked", Request),
  Replied: BusEvent.define(
    "permission.replied",
    z.object({
      sessionID: SessionID.zod,
      requestID: PermissionID.zod,
      reply: Reply,
    }),
  ),
}

// ── Error types ──

export class RejectedError extends Error {
  override readonly name = "PermissionRejectedError"
  constructor() {
    super("The user rejected permission to use this specific tool call.")
  }
}

export class CorrectedError extends Error {
  override readonly name = "PermissionCorrectedError"
  readonly feedback: string
  constructor(opts: { feedback: string }) {
    super(`The user rejected permission to use this specific tool call with the following feedback: ${opts.feedback}`)
    this.feedback = opts.feedback
  }
}

export class DeniedError extends Error {
  override readonly name = "PermissionDeniedError"
  readonly ruleset: unknown
  constructor(opts: { ruleset: unknown }) {
    super(
      `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(opts.ruleset)}`,
    )
    this.ruleset = opts.ruleset
  }
}

export type PermissionError = DeniedError | RejectedError | CorrectedError

// ── Schemas for ask/reply inputs ──

export const AskInput = Request.partial({ id: true }).extend({
  ruleset: Ruleset,
})

export const ReplyInput = z.object({
  requestID: PermissionID.zod,
  reply: Reply,
  message: z.string().optional(),
})

// ── Service implementation ──

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface PendingEntry {
  info: Request
  deferred: Deferred<void>
}

interface State {
  pending: Map<PermissionID, PendingEntry>
  approved: Ruleset
  // Session-scoped grants from "session" replies. Map<sessionID, Ruleset>.
  // Never persisted; cleared on session teardown / instance restart.
  sessionApproved: Map<SessionID, Ruleset>
}

const state = Instance.state(() => {
  const row = Database.use((db) =>
    db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Instance.project.id)).get(),
  )
  return {
    pending: new Map<PermissionID, PendingEntry>(),
    approved: (row?.data ?? []) as Ruleset,
    sessionApproved: new Map<SessionID, Ruleset>(),
  } satisfies State
})

export async function ask(input: z.infer<typeof AskInput>): Promise<void> {
  const s = state()
  const { ruleset, ...request } = input
  // Session-scoped grants are checked alongside project-wide rules; they
  // come last so they take precedence (last-match-wins). This is what
  // makes "Allow for this session" stick for the rest of the conversation.
  const sessionRuleset = s.sessionApproved.get(request.sessionID) ?? []
  let pending = false

  for (const pattern of request.patterns) {
    const rule = evaluate(request.permission, pattern, ruleset, s.approved, sessionRuleset)
    log.info("evaluated", { permission: request.permission, pattern, action: rule })
    if (rule.action === "deny") {
      Audit.logDenied({
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        reason: `Rule matched: ${rule.permission}/${rule.pattern} → deny`,
      })
      throw new DeniedError({
        ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
      })
    }
    if (rule.action === "allow") continue
    pending = true
  }

  if (!pending) {
    Audit.logAutoApproved({
      sessionID: request.sessionID,
      permission: request.permission,
      patterns: request.patterns,
      reason: "All patterns matched allow rules",
    })
    return
  }

  const id = request.id ?? PermissionID.ascending()
  const info: Request = { id, ...request }
  log.info("asking", { id, permission: info.permission, patterns: info.patterns })
  Audit.logAsked({
    sessionID: info.sessionID,
    permission: info.permission,
    patterns: info.patterns,
    tool: info.tool,
  })

  const deferred = createDeferred<void>()
  s.pending.set(id, { info, deferred })
  void Bus.publish(Event.Asked, info)

  try {
    return await deferred.promise
  } finally {
    s.pending.delete(id)
  }
}

function rejectSessionPending(s: State, sessionID: SessionID): void {
  for (const [id, item] of s.pending.entries()) {
    if (item.info.sessionID !== sessionID) continue
    s.pending.delete(id)
    void Bus.publish(Event.Replied, {
      sessionID: item.info.sessionID,
      requestID: item.info.id,
      reply: "reject",
    })
    item.deferred.reject(new RejectedError())
  }
}

/**
 * Add the just-replied request's patterns to either the persistent or
 * session-scoped allow list, then resolve any other pending requests in
 * the same session that those new rules cover.
 *
 * `scope: "always"` writes to s.approved (project-wide, persisted).
 * `scope: "session"` writes to s.sessionApproved (sessionID-keyed,
 * in-memory only).
 */
function approveMatchingPending(s: State, existing: PendingEntry, scope: "always" | "session"): void {
  const patterns = existing.info.always.length > 0 ? existing.info.always : existing.info.patterns
  if (scope === "always") {
    for (const pattern of patterns) {
      s.approved.push({ permission: existing.info.permission, pattern, action: "allow" })
    }
  } else {
    let bucket = s.sessionApproved.get(existing.info.sessionID)
    if (!bucket) {
      bucket = []
      s.sessionApproved.set(existing.info.sessionID, bucket)
    }
    for (const pattern of patterns) {
      bucket.push({ permission: existing.info.permission, pattern, action: "allow" })
    }
  }

  const sessionRuleset = s.sessionApproved.get(existing.info.sessionID) ?? []
  for (const [id, item] of s.pending.entries()) {
    if (item.info.sessionID !== existing.info.sessionID) continue
    const allAllowed = item.info.patterns.every(
      (pattern) => evaluate(item.info.permission, pattern, s.approved, sessionRuleset).action === "allow",
    )
    if (!allAllowed) continue
    s.pending.delete(id)
    void Bus.publish(Event.Replied, {
      sessionID: item.info.sessionID,
      requestID: item.info.id,
      reply: scope,
    })
    item.deferred.resolve(undefined)
  }
}

export async function reply(input: z.infer<typeof ReplyInput>): Promise<void> {
  const s = state()
  const existing = s.pending.get(input.requestID)
  if (!existing) return

  s.pending.delete(input.requestID)
  void Bus.publish(Event.Replied, {
    sessionID: existing.info.sessionID,
    requestID: existing.info.id,
    reply: input.reply,
  })
  Audit.logReplied({
    sessionID: existing.info.sessionID,
    permission: existing.info.permission,
    patterns: existing.info.patterns,
    reply: input.reply,
  })

  if (input.reply === "reject") {
    existing.deferred.reject(input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError())
    rejectSessionPending(s, existing.info.sessionID)
    return
  }

  existing.deferred.resolve(undefined)
  if (input.reply === "once") return
  // "always" persists to the project ruleset; "session" stays in-memory
  // for the lifetime of this session (and unblocks any other queued
  // requests in the same session that match the new grant).
  approveMatchingPending(s, existing, input.reply)
}

/**
 * Drop all session-scoped grants for a given session id. Called when a
 * session ends, is reverted, or the user explicitly disconnects an
 * MCP app from that session.
 */
export function dropSessionApprovals(sessionID: SessionID): void {
  state().sessionApproved.delete(sessionID)
}

export async function list(): Promise<Request[]> {
  const s = state()
  return Array.from(s.pending.values(), (item) => item.info)
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  const merged = rulesets.flat()
  log.info("evaluate", { permission, pattern, ruleset: merged })
  const match = merged.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
