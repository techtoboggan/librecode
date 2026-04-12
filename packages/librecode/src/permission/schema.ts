import type z from "zod"
import { Identifier } from "@/id/id"
import type { Brand } from "@/util/brand"

export type PermissionID = Brand<string, "PermissionID">
export const PermissionID = {
  make: (id: string) => id as PermissionID,
  ascending: (id?: string) => Identifier.ascending("permission", id) as PermissionID,
  zod: Identifier.schema("permission") as unknown as z.ZodType<PermissionID>,
}
