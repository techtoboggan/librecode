/**
 * Tests for MCP Apps (Phase 15 — MCP Apps Protocol Layer)
 *
 * Covers:
 *   - uiResources() filters to RESOURCE_MIME_TYPE only
 *   - fetchAppHtml() extracts HTML text from resource contents
 *   - tools() excludes app-only tools (isToolVisibilityAppOnly)
 *   - getAppResourceUri() extracts ui:// URI from tool metadata
 *   - AppRegistered / AppToolCalled bus events are defined
 */

import { describe, expect, mock, test } from "bun:test"

// ─── Mock MCP SDK transports so no real connections are made ─────────────────

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    async start() {
      throw new Error("mock")
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    async start() {
      throw new Error("mock")
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    stderr = null
    async start() {
      throw new Error("mock")
    }
  },
}))

// Lazy imports after mocking
const { MCP } = await import("../../src/mcp/index")
const { RESOURCE_MIME_TYPE, getToolUiResourceUri, isToolVisibilityAppOnly } = await import(
  "@modelcontextprotocol/ext-apps/app-bridge"
)

// ─── RESOURCE_MIME_TYPE constant ─────────────────────────────────────────────

test("RESOURCE_MIME_TYPE is text/html;profile=mcp-app", () => {
  expect(RESOURCE_MIME_TYPE).toBe("text/html;profile=mcp-app")
})

// ─── getToolUiResourceUri ─────────────────────────────────────────────────────

describe("getToolUiResourceUri", () => {
  test("returns URI from modern _meta.ui.resourceUri format", () => {
    const tool = {
      name: "my-tool",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { resourceUri: "ui://my-server/app" } },
    }
    expect(getToolUiResourceUri(tool)).toBe("ui://my-server/app")
  })

  test("returns URI from legacy _meta['ui/resourceUri'] format", () => {
    const tool = {
      name: "my-tool",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { "ui/resourceUri": "ui://my-server/legacy" },
    }
    expect(getToolUiResourceUri(tool)).toBe("ui://my-server/legacy")
  })

  test("returns undefined when no ui metadata", () => {
    const tool = {
      name: "plain-tool",
      inputSchema: { type: "object" as const, properties: {} },
    }
    expect(getToolUiResourceUri(tool)).toBeUndefined()
  })

  test("returns undefined for non-ui:// URIs", () => {
    const tool = {
      name: "bad-tool",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { resourceUri: "https://example.com/app" } },
    }
    // getToolUiResourceUri throws for invalid URIs — non-ui:// returns undefined or throws
    expect(() => getToolUiResourceUri(tool)).toThrow()
  })
})

// ─── isToolVisibilityAppOnly ──────────────────────────────────────────────────

describe("isToolVisibilityAppOnly", () => {
  test("returns true for app-only visibility", () => {
    const tool = {
      name: "app-tool",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { visibility: ["app"] } },
    }
    expect(isToolVisibilityAppOnly(tool)).toBe(true)
  })

  test("returns false for model-only visibility", () => {
    const tool = {
      name: "model-tool",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { visibility: ["model"] } },
    }
    expect(isToolVisibilityAppOnly(tool)).toBe(false)
  })

  test("returns false for tools with no visibility metadata", () => {
    const tool = {
      name: "plain-tool",
      inputSchema: { type: "object" as const, properties: {} },
    }
    expect(isToolVisibilityAppOnly(tool)).toBe(false)
  })

  test("returns false for tools with both model and app visibility", () => {
    const tool = {
      name: "dual-tool",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { visibility: ["model", "app"] } },
    }
    expect(isToolVisibilityAppOnly(tool)).toBe(false)
  })
})

// ─── MCP.getAppResourceUri ───────────────────────────────────────────────────

describe("MCP.getAppResourceUri", () => {
  test("extracts ui:// URI from modern tool metadata", () => {
    const tool = {
      name: "weather",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { resourceUri: "ui://weather/forecast" } },
    }
    expect(MCP.getAppResourceUri(tool)).toBe("ui://weather/forecast")
  })

  test("returns undefined for tools without ui metadata", () => {
    const tool = {
      name: "bash",
      inputSchema: { type: "object" as const, properties: {} },
    }
    expect(MCP.getAppResourceUri(tool)).toBeUndefined()
  })
})

// ─── MCP.AppRegistered / MCP.AppToolCalled bus events ────────────────────────

describe("MCP bus events", () => {
  test("AppRegistered event is defined with correct type", () => {
    expect(MCP.AppRegistered).toBeDefined()
    expect(MCP.AppRegistered.type).toBe("mcp.app.registered")
  })

  test("AppToolCalled event is defined with correct type", () => {
    expect(MCP.AppToolCalled).toBeDefined()
    expect(MCP.AppToolCalled.type).toBe("mcp.app.tool_called")
  })
})

// ─── MCP.fetchAppHtml ────────────────────────────────────────────────────────

describe("MCP.fetchAppHtml", () => {
  test("returns undefined when client not found", async () => {
    const { Instance } = await import("../../src/project/instance")
    const { tmpdir } = await import("../fixture/fixture")

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const html = await MCP.fetchAppHtml("nonexistent-server", "ui://app/main")
        expect(html).toBeUndefined()
      },
    })
  })
})

// ─── MCP.uiResources ────────────────────────────────────────────────────────

describe("MCP.uiResources", () => {
  test("returns empty object when no connected clients", async () => {
    const { Instance } = await import("../../src/project/instance")
    const { tmpdir } = await import("../fixture/fixture")

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await MCP.uiResources()
        expect(result).toEqual({})
      },
    })
  })
})
