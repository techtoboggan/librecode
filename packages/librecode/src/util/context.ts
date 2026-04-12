import { AsyncLocalStorage } from "node:async_hooks"

class ContextNotFound extends Error {
  constructor(public override readonly name: string) {
    super(`No context found for ${name}`)
  }
}

function contextCreate<T>(name: string) {
  const storage = new AsyncLocalStorage<T>()
  return {
    use() {
      const result = storage.getStore()
      if (!result) {
        throw new ContextNotFound(name)
      }
      return result
    },
    provide<R>(value: T, fn: () => R) {
      return storage.run(value, fn)
    },
  }
}

export const Context = {
  NotFound: ContextNotFound,
  create: contextCreate,
} as const

// biome-ignore lint/style/noNamespace: type companion for declaration merging
export declare namespace Context {
  type NotFound = ContextNotFound
}
