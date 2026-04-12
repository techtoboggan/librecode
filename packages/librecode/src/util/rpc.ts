type Definition = {
  // biome-ignore lint/suspicious/noExplicitAny: RPC definition requires dynamic method signatures
  [method: string]: (input: any) => any
}

function handleRpcMessage(
  parsed: { type: string; id?: number; result?: unknown; event?: string; data?: unknown },
  pending: Map<number, (result: unknown) => void>,
  listeners: Map<string, Set<(data: unknown) => void>>,
): void {
  if (parsed.type === "rpc.result" && parsed.id !== undefined) {
    const resolve = pending.get(parsed.id)
    if (resolve) {
      resolve(parsed.result)
      pending.delete(parsed.id)
    }
  }
  if (parsed.type === "rpc.event" && parsed.event !== undefined) {
    const handlers = listeners.get(parsed.event)
    if (handlers) {
      for (const handler of handlers) {
        handler(parsed.data)
      }
    }
  }
}

function rpcListen(rpc: Definition) {
  // biome-ignore lint/suspicious/noGlobalAssign: intentional Web Worker global onmessage assignment
  onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.request") {
      const result = await rpc[parsed.method](parsed.input)
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    }
  }
}

function rpcEmit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

function rpcClient<T extends Definition>(target: {
  postMessage: (data: string) => undefined | null
  // biome-ignore lint/suspicious/noExplicitAny: MessageEvent type parameter requires any
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  // biome-ignore lint/suspicious/noExplicitAny: RPC pending/listener maps require dynamic types
  const pending = new Map<number, (result: any) => void>()
  // biome-ignore lint/suspicious/noExplicitAny: RPC pending/listener maps require dynamic types
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  target.onmessage = async (evt) => {
    handleRpcMessage(JSON.parse(evt.data), pending, listeners)
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve) => {
        pending.set(requestId, resolve)
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
      })
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers?.delete(handler)
      }
    },
  }
}

export const Rpc = {
  listen: rpcListen,
  emit: rpcEmit,
  client: rpcClient,
} as const
