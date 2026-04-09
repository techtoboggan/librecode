import z from "zod"

import type { Brand } from "@/util/brand"

export type ProjectID = Brand<string, "ProjectID">
export const ProjectID = {
  global: "global" as ProjectID,
  make: (id: string) => id as ProjectID,
  zod: z.string() as unknown as z.ZodType<ProjectID>,
}
