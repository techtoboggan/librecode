import z from "zod"
import { Bus } from "@/bus"
import { Snapshot, type SnapshotFileDiff } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Session } from "."
import type { MessageV2 } from "./message-v2"
import { MessageID, SessionID } from "./schema"

function unquoteOctalEscape(body: string, i: number): { byte: number; advance: number } {
  const chunk = body.slice(i + 1, i + 4)
  const match = chunk.match(/^[0-7]{1,3}/)
  if (!match) return { byte: body[i + 1]?.charCodeAt(0), advance: 1 }
  return { byte: parseInt(match[0], 8), advance: match[0].length }
}

function unquoteSimpleEscape(next: string): string | undefined {
  if (next === "n") return "\n"
  if (next === "r") return "\r"
  if (next === "t") return "\t"
  if (next === "b") return "\b"
  if (next === "f") return "\f"
  if (next === "v") return "\v"
  if (next === "\\" || next === '"') return next
  return undefined
}

function processBackslashEscape(body: string, i: number, bytes: number[]): number {
  const next = body[i + 1]
  if (!next) {
    bytes.push("\\".charCodeAt(0))
    return i
  }

  if (next >= "0" && next <= "7") {
    const { byte, advance } = unquoteOctalEscape(body, i)
    bytes.push(byte)
    return i + advance
  }

  const escaped = unquoteSimpleEscape(next)
  bytes.push((escaped ?? next).charCodeAt(0))
  return i + 1
}

function unquoteGitPath(input: string): string {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }
    i = processBackslashEscape(body, i, bytes)
  }

  return Buffer.from(bytes).toString()
}

const sessionSummarySummarize = fn(
  z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod,
  }),
  async (input) => {
    const all = await Session.messages({ sessionID: input.sessionID })
    await Promise.all([
      summarizeSession({ sessionID: input.sessionID, messages: all }),
      summarizeMessage({ messageID: input.messageID, messages: all }),
    ])
  },
)

async function summarizeSession(input: { sessionID: SessionID; messages: MessageV2.WithParts[] }) {
  const diffs = await sessionSummaryComputeDiff({ messages: input.messages })
  await Session.setSummary({
    sessionID: input.sessionID,
    summary: {
      additions: diffs.reduce((sum, x) => sum + x.additions, 0),
      deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
      files: diffs.length,
    },
  })
  await Storage.write(["session_diff", input.sessionID], diffs)
  Bus.publish(Session.Event.Diff, {
    sessionID: input.sessionID,
    diff: diffs,
  })
}

async function summarizeMessage(input: { messageID: string; messages: MessageV2.WithParts[] }) {
  const messages = input.messages.filter(
    (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
  )
  // biome-ignore lint/style/noNonNullAssertion: filter above guarantees the message exists
  const msgWithParts = messages.find((m) => m.info.id === input.messageID)!
  const userMsg = msgWithParts.info as MessageV2.User
  const diffs = await sessionSummaryComputeDiff({ messages })
  userMsg.summary = {
    ...userMsg.summary,
    diffs,
  }
  await Session.updateMessage(userMsg)
}

const sessionSummaryDiff = fn(
  z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod.optional(),
  }),
  async (input) => {
    const diffs = await Storage.read<SnapshotFileDiff[]>(["session_diff", input.sessionID]).catch(() => [])
    const next = diffs.map((item) => {
      const file = unquoteGitPath(item.file)
      if (file === item.file) return item
      return {
        ...item,
        file,
      }
    })
    const changed = next.some((item, i) => item.file !== diffs[i]?.file)
    if (changed) Storage.write(["session_diff", input.sessionID], next).catch(() => {})
    return next
  },
)

function findSnapshotFrom(messages: MessageV2.WithParts[]): string | undefined {
  for (const item of messages) {
    for (const part of item.parts) {
      if (part.type === "step-start" && part.snapshot) return part.snapshot
    }
  }
  return undefined
}

function findSnapshotTo(messages: MessageV2.WithParts[]): string | undefined {
  let to: string | undefined
  for (const item of messages) {
    for (const part of item.parts) {
      if (part.type === "step-finish" && part.snapshot) {
        to = part.snapshot
      }
    }
  }
  return to
}

async function sessionSummaryComputeDiff(input: { messages: MessageV2.WithParts[] }): Promise<SnapshotFileDiff[]> {
  const from = findSnapshotFrom(input.messages)
  const to = findSnapshotTo(input.messages)
  if (from && to) return Snapshot.diffFull(from, to)
  return []
}

export const SessionSummary = {
  summarize: sessionSummarySummarize,
  diff: sessionSummaryDiff,
  computeDiff: sessionSummaryComputeDiff,
} as const
