#!/usr/bin/env bun
/**
 * Minimal MCP server fixture for the LibreCode external-app discovery test.
 *
 * Speaks MCP over stdio. Exposes:
 *   - One ui:// resource at `ui://lc-test/hello` with the
 *     `text/html;profile=mcp-app` mime type, returning a deterministic
 *     marker string the e2e + unit tests assert against.
 *   - One tool `echo` (used in Track 3 for tool-proxying coverage).
 *
 * Run as a subprocess from the test:
 *   { type: "local", command: ["bun", "<this file>"] }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import z from "zod"

export const TEST_APP_URI = "ui://lc-test/hello"
export const TEST_APP_MARKER = "LIBRECODE_TEST_APP_MARKER_8b3f"
export const TEST_APP_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>LC Test App</title></head>
<body>
  <main id="${TEST_APP_MARKER}">${TEST_APP_MARKER} ready</main>
  <script>
    // Tell the host we're ready, same protocol the built-ins use.
    if (window.parent !== window) window.parent.postMessage({ type: "mcp-app-ready" }, "*");
  </script>
</body>
</html>`

const server = new McpServer({
  name: "lc-test-app-server",
  version: "1.0.0",
})

server.registerResource(
  "test-hello-app",
  TEST_APP_URI,
  {
    title: "LC Test App",
    description: "Fixture app for LibreCode external-MCP discovery tests",
    mimeType: "text/html;profile=mcp-app",
    // ADR-005: per-resource manifest. The integration test asserts that
    // calls to "echo" are allowed (in this list) and calls to "denied" are
    // rejected by the host gate.
    _meta: { ui: { allowedTools: ["echo"] } },
  },
  async () => ({
    contents: [
      {
        uri: TEST_APP_URI,
        mimeType: "text/html;profile=mcp-app",
        text: TEST_APP_HTML,
      },
    ],
  }),
)

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Returns the provided text verbatim — used by Track 3 to verify app→host tool proxying.",
    inputSchema: {
      text: z.string().describe("Text to echo back"),
    },
  },
  async ({ text }) => ({ content: [{ type: "text" as const, text: text ?? "" }] }),
)

// ─── Track 4 fixtures (read-only proxies) ────────────────────────────────────

export const TEST_TEXT_RESOURCE_URI = "lctest://docs/readme"
export const TEST_TEXT_RESOURCE_MARKER = "LIBRECODE_TEST_RESOURCE_MARKER_9c2f"

server.registerResource(
  "test-readme",
  TEST_TEXT_RESOURCE_URI,
  {
    title: "Test README",
    description: "Plain-text resource used by the Track 4 read-only proxy test.",
    mimeType: "text/plain",
  },
  async () => ({
    contents: [{ uri: TEST_TEXT_RESOURCE_URI, mimeType: "text/plain", text: TEST_TEXT_RESOURCE_MARKER }],
  }),
)

server.registerPrompt(
  "test-greet",
  {
    title: "Greet",
    description: "Fixture prompt used by the Track 4 prompts/list proxy test.",
    argsSchema: { name: z.string().optional() },
  },
  ({ name }) => ({
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: `Greet ${name ?? "world"}.` },
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
