import type z from "zod"

import type { Brand } from "@/util/brand"
import { Identifier } from "@/id/id"

export type PermissionID = Brand<string, "PermissionID">
export const PermissionID = {
  make: (id: string) => id as PermissionID,
  ascending: (id?: string) => Identifier.ascending("permission", id) as PermissionID,
  zod: Identifier.schema("permission") as unknown as z.ZodType<PermissionID>,
}
