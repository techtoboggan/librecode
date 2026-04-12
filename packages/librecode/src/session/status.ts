import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { SessionID } from "./schema"

const SessionStatusInfo = z
  .union([
    z.object({
      type: z.literal("idle"),
    }),
    z.object({
      type: z.literal("retry"),
      attempt: z.number(),
      message: z.string(),
      next: z.number(),
    }),
    z.object({
      type: z.literal("busy"),
    }),
  ])
  .meta({
    ref: "SessionStatus",
  })
export type SessionStatusInfo = z.infer<typeof SessionStatusInfo>

const sessionStatusEvent = {
  Status: BusEvent.define(
    "session.status",
    z.object({
      sessionID: SessionID.zod,
      status: SessionStatusInfo,
    }),
  ),
  // deprecated
  Idle: BusEvent.define(
    "session.idle",
    z.object({
      sessionID: SessionID.zod,
    }),
  ),
}

const sessionStatusState = Instance.state(() => {
  const data: Record<string, SessionStatusInfo> = {}
  return data
})

function sessionStatusGet(sessionID: SessionID): SessionStatusInfo {
  return (
    sessionStatusState()[sessionID] ?? {
      type: "idle",
    }
  )
}

function sessionStatusList(): Record<string, SessionStatusInfo> {
  return sessionStatusState()
}

function sessionStatusSet(sessionID: SessionID, status: SessionStatusInfo): void {
  Bus.publish(sessionStatusEvent.Status, {
    sessionID,
    status,
  })
  if (status.type === "idle") {
    // deprecated
    Bus.publish(sessionStatusEvent.Idle, {
      sessionID,
    })
    delete sessionStatusState()[sessionID]
    return
  }
  sessionStatusState()[sessionID] = status
}

export const SessionStatus = {
  Info: SessionStatusInfo,
  Event: sessionStatusEvent,
  get: sessionStatusGet,
  list: sessionStatusList,
  set: sessionStatusSet,
} as const
