import type z from "zod"
import { Identifier } from "@/id/id"
import type { Brand } from "@/util/brand"

export type QuestionID = Brand<string, "QuestionID">
export const QuestionID = {
  make: (id: string) => id as QuestionID,
  ascending: (id?: string) => Identifier.ascending("question", id) as QuestionID,
  zod: Identifier.schema("question") as unknown as z.ZodType<QuestionID>,
}
