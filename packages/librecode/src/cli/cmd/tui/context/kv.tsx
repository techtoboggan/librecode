import path from "node:path"
import { createSignal, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { createSimpleContext } from "./helper"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, any>>()
    const filePath = path.join(Global.Path.state, "kv.json")

    Filesystem.readJson<Record<string, unknown>>(filePath)
      .then((x) => {
        setStore(x as Record<string, never>)
      })
      .catch(() => {})
      .finally(() => {
        setReady(true)
      })

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          () => result.get(name),
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get(key: string, defaultValue?: any) {
        return store[key] ?? defaultValue
      },
      set(key: string, value: any) {
        setStore(key, value)
        Filesystem.writeJson(filePath, store)
      },
    }
    return result
  },
})
