/**
 * Question Service
 *
 * Manages interactive questions posed to the user during tool execution.
 * Maintains a pending queue of unanswered questions with deferred resolution.
 *
 * Migrated from Effect-ts to plain async per ADR-001.
 */

import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID } from "@/session/schema"
import { Log } from "@/util/log"
import z from "zod"
import { QuestionID } from "./schema"

const log = Log.create({ service: "question" })

// ── Schemas ──

export const Option = z
  .object({
    label: z.string().describe("Display text (1-5 words, concise)"),
    description: z.string().describe("Explanation of choice"),
  })
  .meta({ ref: "QuestionOption" })
export type Option = z.infer<typeof Option>

export const Info = z
  .object({
    question: z.string().describe("Complete question"),
    header: z.string().describe("Very short label (max 30 chars)"),
    options: z.array(Option).describe("Available choices"),
    multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
    custom: z.boolean().optional().describe("Allow typing a custom answer (default: true)"),
  })
  .meta({ ref: "QuestionInfo" })
export type Info = z.infer<typeof Info>

export const Request = z
  .object({
    id: QuestionID.zod,
    sessionID: SessionID.zod,
    questions: z.array(Info).describe("Questions to ask"),
    tool: z
      .object({
        messageID: MessageID.zod,
        callID: z.string(),
      })
      .optional(),
  })
  .meta({ ref: "QuestionRequest" })
export type Request = z.infer<typeof Request>

export const Answer = z.array(z.string()).meta({ ref: "QuestionAnswer" })
export type Answer = z.infer<typeof Answer>

export const Reply = z.object({
  answers: z.array(Answer).describe("User answers in order of questions (each answer is an array of selected labels)"),
})
export type Reply = z.infer<typeof Reply>

export const Event = {
  Asked: BusEvent.define("question.asked", Request),
  Replied: BusEvent.define(
    "question.replied",
    z.object({
      sessionID: SessionID.zod,
      requestID: QuestionID.zod,
      answers: z.array(Answer),
    }),
  ),
  Rejected: BusEvent.define(
    "question.rejected",
    z.object({
      sessionID: SessionID.zod,
      requestID: QuestionID.zod,
    }),
  ),
}

export class RejectedError extends Error {
  override readonly name = "QuestionRejectedError"
  constructor() {
    super("The user dismissed this question")
  }
}

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
  deferred: Deferred<Answer[]>
}

const pending = new Map<QuestionID, PendingEntry>()

export async function ask(input: {
  sessionID: SessionID
  questions: Info[]
  tool?: { messageID: MessageID; callID: string }
}): Promise<Answer[]> {
  const id = QuestionID.ascending()
  log.info("asking", { id, questions: input.questions.length })

  const deferred = createDeferred<Answer[]>()
  const info: Request = {
    id,
    sessionID: input.sessionID,
    questions: input.questions,
    tool: input.tool,
  }
  pending.set(id, { info, deferred })
  Bus.publish(Event.Asked, info)

  try {
    return await deferred.promise
  } finally {
    pending.delete(id)
  }
}

export async function reply(input: { requestID: QuestionID; answers: Answer[] }): Promise<void> {
  const existing = pending.get(input.requestID)
  if (!existing) {
    log.warn("reply for unknown request", { requestID: input.requestID })
    return
  }
  pending.delete(input.requestID)
  log.info("replied", { requestID: input.requestID, answers: input.answers })
  Bus.publish(Event.Replied, {
    sessionID: existing.info.sessionID,
    requestID: existing.info.id,
    answers: input.answers,
  })
  existing.deferred.resolve(input.answers)
}

export async function reject(requestID: QuestionID): Promise<void> {
  const existing = pending.get(requestID)
  if (!existing) {
    log.warn("reject for unknown request", { requestID })
    return
  }
  pending.delete(requestID)
  log.info("rejected", { requestID })
  Bus.publish(Event.Rejected, {
    sessionID: existing.info.sessionID,
    requestID: existing.info.id,
  })
  existing.deferred.reject(new RejectedError())
}

export async function list(): Promise<Request[]> {
  return Array.from(pending.values(), (x) => x.info)
}
