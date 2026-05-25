/**
 * Phase 47 — MCP.reconnect() tests.
 *
 * Covers:
 *   - Throws for a server name not in config.
 *   - Resolves (status update, no throw) for a configured server.
 *
 * Transport mocks live in this file to avoid leaking into sibling tests
 * (bun's mock.module() is process-global, so each test file gets its own process).
 */
import { describe, expect, mock, test } from "bun:test"

// Stub transports so no real connections are attempted
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    async start() {
      throw new Error("mock-streamable-http")
    }
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    async start() {
      throw new Error("mock-sse")
    }
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    stderr = null
    async start() {
      throw new Error("mock-stdio")
    }
    async close() {}
  },
}))

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

describe("MCP.reconnect", () => {
  test("throws for a server not in config", async () => {
    await using workspace = await tmpdir()
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        await expect(MCP.reconnect("nonexistent-server")).rejects.toThrow(
          'No stored config for MCP server "nonexistent-server"',
        )
      },
    })
  })

  test("resolves without throwing for a configured server (connection may fail, status updated)", async () => {
    await using workspace = await tmpdir({
      config: {
        mcp: {
          "test-server": {
            type: "local",
            command: ["echo", "fake-mcp-server"],
          },
        },
      },
    })
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        // Should not throw even when the actual connect fails (status updated to "failed")
        await expect(MCP.reconnect("test-server")).resolves.toBeUndefined()
      },
    })
  })
})
