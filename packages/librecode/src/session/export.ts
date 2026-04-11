/**
 * Session Export/Import
 *
 * Provides a standard JSON format for exporting and importing sessions,
 * enabling session sharing, backup, and cross-instance transfer.
 *
 * Export format is versioned for forward compatibility.
 */

import z from "zod"
import { Log } from "@/util/log"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Session } from "."

const log = Log.create({ service: "session.export" })

// ── Export format ──

export const EXPORT_VERSION = 1

export const ExportedMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  agent: z.string().optional(),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
  time: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
  cost: z.number().optional(),
  tokens: z
    .object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({ read: z.number(), write: z.number() }),
    })
    .optional(),
  parts: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
})
export type ExportedMessage = z.infer<typeof ExportedMessage>

export const ExportedSession = z.object({
  version: z.number(),
  exportedAt: z.number(),
  session: z.object({
    id: z.string(),
    title: z.string(),
    directory: z.string(),
    parentID: z.string().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  }),
  messages: z.array(ExportedMessage),
  metadata: z
    .object({
      exportedBy: z.string().optional(),
      messageCount: z.number(),
      partCount: z.number(),
    })
    .optional(),
})
export type ExportedSession = z.infer<typeof ExportedSession>

// ── Export ──

/**
 * Export a session to the standard JSON format.
 */
export async function exportSession(sessionID: SessionID): Promise<ExportedSession> {
  const session = await Session.get(sessionID)
  const stream = await MessageV2.stream({ sessionID })

  const messages: ExportedMessage[] = []
  let partCount = 0

  for (const msg of stream) {
    const exported: ExportedMessage = {
      id: msg.info.id,
      role: msg.info.role,
      time: {
        created: msg.info.time.created,
        completed: msg.info.role === "assistant" ? (msg.info as any).time?.completed : undefined,
      },
    }

    if (msg.info.role === "user") {
      const user = msg.info as any
      exported.agent = user.agent
      exported.model = user.model
    } else if (msg.info.role === "assistant") {
      const assistant = msg.info as any
      exported.agent = assistant.agent
      exported.model = assistant.modelID ? { providerID: assistant.providerID, modelID: assistant.modelID } : undefined
      exported.cost = assistant.cost
      exported.tokens = assistant.tokens
    }

    exported.parts = msg.parts.map((part) => {
      partCount++
      const { id, sessionID: _sid, messageID: _mid, ...rest } = part as any
      return {
        id,
        type: part.type,
        data: rest,
      }
    })

    messages.push(exported)
  }

  log.info("exported session", { sessionID, messages: messages.length, parts: partCount })

  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    session: {
      id: session.id,
      title: session.title,
      directory: session.directory,
      parentID: session.parentID ?? undefined,
      time: {
        created: session.time.created,
        updated: session.time.updated,
      },
    },
    messages,
    metadata: {
      messageCount: messages.length,
      partCount,
    },
  }
}

/**
 * Export a session to a JSON string.
 */
export async function exportSessionJSON(sessionID: SessionID, pretty = true): Promise<string> {
  const data = await exportSession(sessionID)
  return JSON.stringify(data, null, pretty ? 2 : undefined)
}
