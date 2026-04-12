import type z from "zod"
import { Identifier } from "@/id/id"
import type { Brand } from "@/util/brand"

export type ToolID = Brand<string, "ToolID">
export const ToolID = {
  make: (id: string) => id as ToolID,
  ascending: (id?: string) => Identifier.ascending("tool", id) as ToolID,
  zod: Identifier.schema("tool") as unknown as z.ZodType<ToolID>,
}
