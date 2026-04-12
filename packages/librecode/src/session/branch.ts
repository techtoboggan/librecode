/**
 * Session Branching
 *
 * Enables forking a session at a specific message to try different approaches
 * without losing the original conversation history.
 *
 * A branch creates a new session with:
 * - parent_id pointing to the original session
 * - Copies of all messages up to the fork point
 * - New IDs for all copied messages and parts
 * - Independent message history from the fork point onward
 *
 * ## Usage
 *
 * ```typescript
 * // Fork from the latest message
 * const forked = await SessionBranch.fork({ sessionID: "original" })
 *
 * // Fork from a specific message
 * const forked = await SessionBranch.fork({
 *   sessionID: "original",
 *   atMessageID: "msg_123", // include this message and all before it
 * })
 * ```
 */

import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { type SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Session } from "."

const log = Log.create({ service: "session.branch" })

export const BranchEvent = BusEvent.define(
  "session.branched",
  z.object({
    originalSessionID: z.string(),
    newSessionID: z.string(),
    forkMessageID: z.string().optional(),
    messagesCopied: z.number(),
  }),
)

export interface ForkOptions {
  /** The session to fork from */
  sessionID: SessionID

  /** Fork at this message (include it and all before). If omitted, forks from latest. */
  atMessageID?: MessageID

  /** Title for the new session. If omitted, appends "(branch)" to original title. */
  title?: string
}

export interface ForkResult {
  /** The new session ID */
  sessionID: SessionID

  /** Number of messages copied */
  messagesCopied: number

  /** Number of parts copied */
  partsCopied: number
}

function sliceMessagesToFork(
  stream: MessageV2.WithParts[],
  atMessageID: MessageID | undefined,
  sessionID: SessionID,
): MessageV2.WithParts[] {
  if (!atMessageID) return stream
  const cutoffIndex = stream.findIndex((m) => m.info.id === atMessageID)
  if (cutoffIndex === -1) throw new Error(`Message ${atMessageID} not found in session ${sessionID}`)
  return stream.slice(0, cutoffIndex + 1)
}

async function copyMessagesToSession(
  messages: MessageV2.WithParts[],
  newSessionID: SessionID,
): Promise<{ partsCopied: number }> {
  const messageIDMap = new Map<MessageID, MessageID>()
  let partsCopied = 0

  for (const msg of messages) {
    const newMessageID = MessageID.ascending()
    messageIDMap.set(msg.info.id, newMessageID)

    const newInfo: Record<string, unknown> = { ...msg.info, id: newMessageID, sessionID: newSessionID }

    // If assistant message has parentID, remap it
    if (msg.info.role === "assistant" && "parentID" in msg.info && msg.info.parentID) {
      const mappedParent = messageIDMap.get(msg.info.parentID as MessageID)
      if (mappedParent) newInfo.parentID = mappedParent
    }

    await Session.updateMessage(newInfo as Parameters<typeof Session.updateMessage>[0])

    for (const part of msg.parts) {
      await Session.updatePart({ ...part, id: PartID.ascending(), messageID: newMessageID, sessionID: newSessionID })
      partsCopied++
    }
  }

  return { partsCopied }
}

/**
 * Fork a session at a specific point, creating a new independent branch.
 */
export async function fork(options: ForkOptions): Promise<ForkResult> {
  const original = await Session.get(options.sessionID)
  const messages: MessageV2.WithParts[] = []
  for await (const msg of MessageV2.stream(options.sessionID)) messages.push(msg)
  const messagesToCopy = sliceMessagesToFork(messages, options.atMessageID, options.sessionID)

  const title = options.title ?? `${original.title} (branch)`
  const newSession = await Session.create({ title, parentID: options.sessionID })

  const { partsCopied } = await copyMessagesToSession(messagesToCopy, newSession.id)

  log.info("session forked", {
    original: options.sessionID,
    new: newSession.id,
    messages: messagesToCopy.length,
    parts: partsCopied,
  })

  void Bus.publish(BranchEvent, {
    originalSessionID: options.sessionID,
    newSessionID: newSession.id,
    forkMessageID: options.atMessageID,
    messagesCopied: messagesToCopy.length,
  }).catch(() => {})

  return {
    sessionID: newSession.id,
    messagesCopied: messagesToCopy.length,
    partsCopied,
  }
}

/**
 * List all branches of a session (sessions with this one as parent).
 */
export async function branches(sessionID: SessionID): Promise<Session.Info[]> {
  const all = [...Session.list()]
  return all.filter((s) => s.parentID === sessionID)
}

/**
 * Get the branch ancestry of a session (walk parent_id up to root).
 */
export async function ancestry(sessionID: SessionID): Promise<SessionID[]> {
  const result: SessionID[] = [sessionID]
  let current = await Session.get(sessionID)

  while (current.parentID) {
    result.push(current.parentID)
    try {
      current = await Session.get(current.parentID)
    } catch {
      break // parent deleted
    }
  }

  return result.reverse() // root first
}
