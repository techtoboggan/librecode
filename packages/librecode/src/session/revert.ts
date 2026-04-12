import z from "zod"
import { Storage } from "@/storage/storage"
import { Bus } from "../bus"
import { Snapshot, type SnapshotPatch } from "../snapshot"
import { Database, eq } from "../storage/db"
import { Log } from "../util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageTable, PartTable } from "./session.sql"
import { SessionSummary } from "./summary"

const revertLog = Log.create({ service: "session.revert" })

export const SessionRevertInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod,
  partID: PartID.zod.optional(),
})
export type SessionRevertInput = z.infer<typeof SessionRevertInput>

type RevertState = {
  revert: Session.Info["revert"]
  patches: SnapshotPatch[]
  lastUser: MessageV2.User | undefined
}

type PartScanState = {
  revert: Session.Info["revert"]
  patches: SnapshotPatch[]
}

function isRevertTrigger(msg: MessageV2.WithParts, part: MessageV2.Part, input: SessionRevertInput): boolean {
  return (msg.info.id === input.messageID && !input.partID) || part.id === input.partID
}

function buildRevertForPart(
  msg: MessageV2.WithParts,
  remaining: MessageV2.Part[],
  lastUser: MessageV2.User | undefined,
  input: SessionRevertInput,
): Session.Info["revert"] {
  const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
  return {
    messageID: !partID && lastUser ? lastUser.id : msg.info.id,
    partID,
  }
}

function scanMsgParts(
  msg: MessageV2.WithParts,
  input: SessionRevertInput,
  lastUser: MessageV2.User | undefined,
  state: PartScanState,
): void {
  const remaining: MessageV2.Part[] = []
  for (const part of msg.parts) {
    if (state.revert) {
      if (part.type === "patch") state.patches.push(part)
      continue
    }
    if (isRevertTrigger(msg, part, input)) {
      state.revert = buildRevertForPart(msg, remaining, lastUser, input)
    }
    remaining.push(part)
  }
}

function buildRevertState(all: MessageV2.WithParts[], input: SessionRevertInput): RevertState {
  let lastUser: MessageV2.User | undefined
  const state: PartScanState = { revert: undefined, patches: [] }

  for (const msg of all) {
    if (msg.info.role === "user") lastUser = msg.info
    scanMsgParts(msg, input, lastUser, state)
  }

  return { revert: state.revert, patches: state.patches, lastUser }
}

async function applyRevertAndComputeDiff(
  input: SessionRevertInput,
  session: Session.Info,
  all: MessageV2.WithParts[],
  revert: NonNullable<Session.Info["revert"]>,
  patches: SnapshotPatch[],
): Promise<Session.Info> {
  revert.snapshot = session.revert?.snapshot ?? (await Snapshot.track())
  await Snapshot.revert(patches)
  if (revert.snapshot) revert.diff = await Snapshot.diff(revert.snapshot)

  const rangeMessages = all.filter((msg) => msg.info.id >= revert.messageID)
  const diffs = await SessionSummary.computeDiff({ messages: rangeMessages })
  await Storage.write(["session_diff", input.sessionID], diffs)
  Bus.publish(Session.Event.Diff, {
    sessionID: input.sessionID,
    diff: diffs,
  })
  return Session.setRevert({
    sessionID: input.sessionID,
    revert,
    summary: {
      additions: diffs.reduce((sum, x) => sum + x.additions, 0),
      deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
      files: diffs.length,
    },
  })
}

async function sessionRevertRevert(input: SessionRevertInput): Promise<Session.Info> {
  SessionPrompt.assertNotBusy(input.sessionID)
  const all = await Session.messages({ sessionID: input.sessionID })
  const session = await Session.get(input.sessionID)
  const { revert: revertTarget, patches } = buildRevertState(all, input)

  if (revertTarget) {
    const freshSession = await Session.get(input.sessionID)
    return applyRevertAndComputeDiff(input, freshSession, all, revertTarget, patches)
  }
  return session
}

async function sessionRevertUnrevert(input: { sessionID: SessionID }): Promise<Session.Info> {
  revertLog.info("unreverting", input)
  SessionPrompt.assertNotBusy(input.sessionID)
  const session = await Session.get(input.sessionID)
  if (!session.revert) return session
  if (session.revert.snapshot) await Snapshot.restore(session.revert.snapshot)
  return Session.clearRevert(input.sessionID)
}

async function removeMessages(sessionID: SessionID, remove: MessageV2.WithParts[]): Promise<void> {
  for (const msg of remove) {
    Database.use((db) => db.delete(MessageTable).where(eq(MessageTable.id, msg.info.id)).run())
    await Bus.publish(MessageV2.Event.Removed, { sessionID, messageID: msg.info.id })
  }
}

async function trimTargetParts(sessionID: SessionID, target: MessageV2.WithParts, partID: string): Promise<void> {
  const removeStart = target.parts.findIndex((part) => part.id === partID)
  if (removeStart < 0) return
  const preserveParts = target.parts.slice(0, removeStart)
  const removeParts = target.parts.slice(removeStart)
  target.parts = preserveParts
  for (const part of removeParts) {
    Database.use((db) => db.delete(PartTable).where(eq(PartTable.id, part.id)).run())
    await Bus.publish(MessageV2.Event.PartRemoved, {
      sessionID,
      messageID: target.info.id,
      partID: part.id,
    })
  }
}

function partitionMessages(
  msgs: MessageV2.WithParts[],
  messageID: string,
  hasPartID: boolean,
): { preserve: MessageV2.WithParts[]; remove: MessageV2.WithParts[]; target: MessageV2.WithParts | undefined } {
  const preserve: MessageV2.WithParts[] = []
  const remove: MessageV2.WithParts[] = []
  let target: MessageV2.WithParts | undefined

  for (const msg of msgs) {
    if (msg.info.id < messageID) {
      preserve.push(msg)
    } else if (msg.info.id > messageID) {
      remove.push(msg)
    } else if (hasPartID) {
      preserve.push(msg)
      target = msg
    } else {
      remove.push(msg)
    }
  }

  return { preserve, remove, target }
}

async function sessionRevertCleanup(session: Session.Info): Promise<void> {
  if (!session.revert) return
  const sessionID = session.id
  const msgs = await Session.messages({ sessionID })
  const messageID = session.revert.messageID
  const { remove, target } = partitionMessages(msgs, messageID, !!session.revert.partID)

  await removeMessages(sessionID, remove)

  if (session.revert.partID && target) {
    await trimTargetParts(sessionID, target, session.revert.partID)
  }

  await Session.clearRevert(sessionID)
}

export const SessionRevert = {
  RevertInput: SessionRevertInput,
  revert: sessionRevertRevert,
  unrevert: sessionRevertUnrevert,
  cleanup: sessionRevertCleanup,
} as const
