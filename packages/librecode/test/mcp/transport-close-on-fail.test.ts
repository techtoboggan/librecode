/**
 * Phase 39 / upstream #19200 — regression test for the close-on-fail fix.
 *
 * When an MCP connect attempt fails (timeout, transport error, etc.) the
 * code in `src/mcp/index.ts` MUST call `transport.close()` before
 * surfacing the failure. Without it, stdio leaves orphan child processes
 * around and remote leaks the underlying HTTP socket. The original
 * upstream bug let long-running sessions accumulate dozens of zombie
 * processes if MCP servers were flaky.
 *
 * This file stubs the SDK transports with a class that counts `close()`
 * calls. After driving `MCP.add()` against a deliberately-failing
 * server, the assertion is that `close()` ran for every failed
 * transport attempt. Lives in its own file so its mock.module() calls
 * don't leak into sibling tests (bun's mock.module is process-global).
 */
import { afterAll, describe, expect, mock, test } from "bun:test"

// Counters that survive across module loads (we read them after the
// system-under-test executes). Keeping them at module scope here means
// every transport instance shares the same state — simpler than
// per-instance tracking and adequate for a regression test.
const closeCalls = {
  streamableHttp: 0,
  sse: 0,
  stdio: 0,
}

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    async start() {
      throw new Error("simulated streamable-http connect failure")
    }
    async close() {
      closeCalls.streamableHttp += 1
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    async start() {
      throw new Error("simulated sse connect failure")
    }
    async close() {
      closeCalls.sse += 1
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    stderr = null
    async start() {
      throw new Error("simulated stdio connect failure")
    }
    async close() {
      closeCalls.stdio += 1
    }
  },
}))

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

afterAll(async () => {
  await MCP.disconnect("test-server").catch(() => {})
})

describe("Phase 39 — MCP transport close on connect failure", () => {
  test("remote: both transports get close() when each fails to connect", async () => {
    closeCalls.streamableHttp = 0
    closeCalls.sse = 0
    await using workspace = await tmpdir()
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        // Remote MCP — the connect path tries StreamableHTTP then SSE.
        // Both stubs throw on start(); the close-on-fail fix must run
        // close() exactly once per failed transport, leaking zero sockets.
        const result = await MCP.add("test-server", {
          type: "remote",
          url: "http://localhost:9999",
          oauth: false,
        })
        expect(result.status).toBeDefined()
      },
    })
    expect(closeCalls.streamableHttp).toBe(1)
    expect(closeCalls.sse).toBe(1)
  })

  test("local: stdio transport gets close() when connect fails (no zombie)", async () => {
    closeCalls.stdio = 0
    await using workspace = await tmpdir()
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        const result = await MCP.add("test-server-local", {
          type: "local",
          command: ["bun", "doesnt-exist.ts"],
        })
        expect(result.status).toBeDefined()
      },
    })
    // Without the close-on-fail fix, the StdioClientTransport's spawned
    // child process would stay alive — close() sends SIGTERM and reaps it.
    expect(closeCalls.stdio).toBe(1)
  })
})
