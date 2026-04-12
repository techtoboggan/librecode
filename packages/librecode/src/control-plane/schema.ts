import type z from "zod"
import { Identifier } from "@/id/id"
import type { Brand } from "@/util/brand"

export type WorkspaceID = Brand<string, "WorkspaceID">
export const WorkspaceID = {
  make: (id: string) => id as WorkspaceID,
  ascending: (id?: string) => Identifier.ascending("workspace", id) as WorkspaceID,
  zod: Identifier.schema("workspace") as unknown as z.ZodType<WorkspaceID>,
}
