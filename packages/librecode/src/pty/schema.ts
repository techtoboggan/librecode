import z from "zod"

import type { Brand } from "@/util/brand"
import { Identifier } from "@/id/id"

export type PtyID = Brand<string, "PtyID">
export const PtyID = {
  make: (id: string) => id as PtyID,
  ascending: (id?: string) => Identifier.ascending("pty", id) as PtyID,
  zod: Identifier.schema("pty") as unknown as z.ZodType<PtyID>,
}
