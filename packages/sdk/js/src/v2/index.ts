export * from "./client.js"
export * from "./server.js"

import { createLibrecodeClient } from "./client.js"
import { createLibrecodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createLibrecode(options?: ServerOptions) {
  const server = await createLibrecodeServer({
    ...options,
  })

  const client = createLibrecodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
