import type z from "zod"
import { Identifier } from "@/id/id"
import type { Brand } from "@/util/brand"

export type PtyID = Brand<string, "PtyID">
export const PtyID = {
  make: (id: string) => id as PtyID,
  ascending: (id?: string) => Identifier.ascending("pty", id) as PtyID,
  zod: Identifier.schema("pty") as unknown as z.ZodType<PtyID>,
}
