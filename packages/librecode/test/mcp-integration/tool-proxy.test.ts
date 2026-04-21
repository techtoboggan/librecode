/**
 * Integration test for the MCP app tool-proxying path (ADR-005).
 *
 * Spawns the same fixture server used by external-apps.test.ts (it
 * advertises a `ui://lc-test/hello` resource with `_meta.ui.allowedTools:
 * ["echo"]` and an `echo` tool). Then exercises the host's manifest gate
 * + actual MCP roundtrip via MCP.appAllowedTools + MCP.callServerTool —
 * the same primitives the /session/:id/mcp-apps/tool server route calls.
 *
 * Lives in test/mcp-integration/ for the same reason external-apps.test.ts
 * does: sibling test/mcp/ files install bun module mocks on the SDK
 * stdio/Client modules that leak across files in one `bun test` run.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { MCP } from "../../src/mcp"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { TEST_APP_URI } from "../fixtures/mcp-apps/test-app-server"

const FIXTURE_SCRIPT = path.join(import.meta.dir, "..", "fixtures", "mcp-apps", "test-app-server.ts")
const SERVER_NAME = "lc-test-app"

let workspace: Awaited<ReturnType<typeof tmpdir>>

beforeAll(async () => {
  workspace = await tmpdir()
})

afterAll(async () => {
  await MCP.disconnect(SERVER_NAME).catch(() => {})
  await workspace?.[Symbol.asyncDispose]()
})

describe("MCP app tool proxying — manifest + transport", () => {
  test("manifest is read from _meta.ui.allowedTools, callServerTool delivers result", async () => {
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        await MCP.add(SERVER_NAME, { type: "local", command: ["bun", FIXTURE_SCRIPT] })

        // Manifest enforcement — the fixture allows only "echo".
        const allowed = await MCP.appAllowedTools(SERVER_NAME, TEST_APP_URI)
        expect(allowed).toEqual(["echo"])

        // Real call goes through MCP, hits the fixture's echo tool, returns
        // the content verbatim.
        const result = await MCP.callServerTool(SERVER_NAME, "echo", { text: "platform-test-ping" })
        expect(result.isError).toBeFalsy()
        // Result content is `{type: "text", text: "..."}` from the fixture.
        const text = result.content
          .filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
          .map((c) => c.text)
          .join("")
        expect(text).toBe("platform-test-ping")

        // Calling a tool not on the manifest still goes through (this layer
        // is unchecked — gating is the route's job). Exists to confirm the
        // call mechanism itself works for any tool the server exposes.
        // We don't have a "denied" tool on the fixture; instead we confirm
        // the gate logic separately in test/server/mcp-apps-tool.test.ts.
      },
    })
  }, 30_000)
})
