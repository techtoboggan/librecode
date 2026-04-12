import type z from "zod"

import type { Brand } from "@/util/brand"
import { Identifier } from "@/id/id"

export type ToolID = Brand<string, "ToolID">
export const ToolID = {
  make: (id: string) => id as ToolID,
  ascending: (id?: string) => Identifier.ascending("tool", id) as ToolID,
  zod: Identifier.schema("tool") as unknown as z.ZodType<ToolID>,
}
