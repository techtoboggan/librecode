import type { ZodType } from "zod"
import z from "zod"
import { Log } from "../util/log"

const _busEventLog = Log.create({ service: "event" })

function busEventDefine<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
  const result = {
    type,
    properties,
  }
  busEventRegistry.set(type, result)
  return result
}

export type BusEventDefinition = ReturnType<typeof busEventDefine>

const busEventRegistry = new Map<string, BusEventDefinition>()

function busEventPayloads() {
  return z
    .discriminatedUnion(
      "type",
      busEventRegistry
        .entries()
        .map(([type, def]) => {
          return z
            .object({
              type: z.literal(type),
              properties: def.properties,
            })
            .meta({
              ref: `Event.${def.type}`,
            })
        })
        // biome-ignore lint/suspicious/noExplicitAny: Zod union requires array of schemas typed as any
        .toArray() as any,
    )
    .meta({
      ref: "Event",
    })
}

export const BusEvent = {
  define: busEventDefine,
  payloads: busEventPayloads,
} as const
