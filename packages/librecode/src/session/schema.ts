import type z from "zod"
import { Identifier } from "@/id/id"
import type { Brand } from "@/util/brand"

export type SessionID = Brand<string, "SessionID">
export const SessionID = {
  make: (id: string) => id as SessionID,
  descending: (id?: string) => Identifier.descending("session", id) as SessionID,
  zod: Identifier.schema("session") as unknown as z.ZodType<SessionID>,
}

export type MessageID = Brand<string, "MessageID">
export const MessageID = {
  make: (id: string) => id as MessageID,
  ascending: (id?: string) => Identifier.ascending("message", id) as MessageID,
  zod: Identifier.schema("message") as unknown as z.ZodType<MessageID>,
}

export type PartID = Brand<string, "PartID">
export const PartID = {
  make: (id: string) => id as PartID,
  ascending: (id?: string) => Identifier.ascending("part", id) as PartID,
  zod: Identifier.schema("part") as unknown as z.ZodType<PartID>,
}
