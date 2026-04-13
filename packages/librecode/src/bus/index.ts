import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { BusEvent, type BusEventDefinition } from "./bus-event"
import { GlobalBus } from "./global"

const log = Log.create({ service: "bus" })
// biome-ignore lint/suspicious/noExplicitAny: subscriber callbacks accept specific types via generic constraints
type Subscription = (event: any) => void

const InstanceDisposed = BusEvent.define(
  "server.instance.disposed",
  z.object({
    directory: z.string(),
  }),
)

const state = Instance.state(
  () => {
    const subscriptions = new Map<string, Subscription[]>()

    return {
      subscriptions,
    }
  },
  async (entry) => {
    const wildcard = entry.subscriptions.get("*")
    if (!wildcard) return
    const event = {
      type: InstanceDisposed.type,
      properties: {
        directory: Instance.directory,
      },
    }
    for (const sub of [...wildcard]) {
      sub(event)
    }
  },
)

async function busPublish<Definition extends BusEventDefinition>(
  def: Definition,
  properties: z.output<Definition["properties"]>,
) {
  const payload = {
    type: def.type,
    properties,
  }
  log.info("publishing", {
    type: def.type,
  })
  const pending = []
  for (const key of [def.type, "*"]) {
    const match = state().subscriptions.get(key)
    for (const sub of match ?? []) {
      pending.push(sub(payload))
    }
  }
  GlobalBus.emit("event", {
    directory: Instance.directory,
    payload,
  })
  return Promise.all(pending)
}

function busSubscribe<Definition extends BusEventDefinition>(
  def: Definition,
  callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
) {
  return raw(def.type, callback)
}

function busOnce<Definition extends BusEventDefinition>(
  def: Definition,
  callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => "done" | undefined,
) {
  const unsub = busSubscribe(def, (event) => {
    if (callback(event)) unsub()
  })
}

// biome-ignore lint/suspicious/noExplicitAny: subscriber callbacks accept specific types via generic constraints
function busSubscribeAll(callback: (event: any) => void) {
  return raw("*", callback)
}

// biome-ignore lint/suspicious/noExplicitAny: subscribe callbacks accept typed events via generic constraints
function raw(type: string, callback: (event: any) => void) {
  log.info("subscribing", { type })
  const subscriptions = state().subscriptions
  const match = subscriptions.get(type) ?? []
  match.push(callback)
  subscriptions.set(type, match)

  return () => {
    log.info("unsubscribing", { type })
    const match = subscriptions.get(type)
    if (!match) return
    const index = match.indexOf(callback)
    if (index === -1) return
    match.splice(index, 1)
  }
}

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Bus {
  // (no types to export — all runtime values)
}

export const Bus = {
  InstanceDisposed,
  publish: busPublish,
  subscribe: busSubscribe,
  once: busOnce,
  subscribeAll: busSubscribeAll,
} as const
