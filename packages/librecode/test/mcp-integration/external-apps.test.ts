/**
 * Integration test that spawns a real MCP server subprocess. Lives outside
 * `test/mcp/` deliberately — sibling tests in that directory install
 * `mock.module(...)` shims on the MCP SDK's stdio + Client modules that
 * leak across files in a single `bun test` run, breaking real-transport
 * tests when they sort after a mocking sibling. Keeping this in its own
 * directory means the unmocked path is exercised cleanly.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge"
import { MCP } from "../../src/mcp"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { TEST_APP_MARKER, TEST_APP_URI } from "../fixtures/mcp-apps/test-app-server"

const FIXTURE_SCRIPT = path.join(import.meta.dir, "..", "fixtures", "mcp-apps", "test-app-server.ts")
const SERVER_NAME = "lc-test-app"

let workspace: Awaited<ReturnType<typeof tmpdir>>

beforeAll(async () => {
  workspace = await tmpdir()
})

afterAll(async () => {
  // Best-effort: disconnect the test MCP client so the subprocess exits and
  // the temp directory teardown isn't blocked by lingering stdio handles.
  await MCP.disconnect(SERVER_NAME).catch(() => {})
  await workspace?.[Symbol.asyncDispose]()
})

/**
 * End-to-end coverage for external MCP servers exposing `ui://` resources.
 * The fixture script in `test/fixtures/mcp-apps/test-app-server.ts` is a
 * real MCP server speaking stdio; we register it through the same
 * MCP.add path the production config loader uses, then assert that:
 *
 *   1. uiResources() picks up the test app
 *   2. fetchAppHtml() returns the verbatim HTML
 *
 * Before this test, the only coverage for `ui://` discovery was the
 * built-in registry — so a regression in the external-server path could
 * have shipped silently. This is the canary.
 */
describe("external MCP server with ui:// resource", () => {
  test("uiResources() discovers and fetchAppHtml() returns the resource", async () => {
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        const result = await MCP.add(SERVER_NAME, {
          type: "local",
          command: ["bun", FIXTURE_SCRIPT],
        })

        // status may be a single Status or a Record<string, Status> depending
        // on add() shape — both are acceptable indicators of "connected".
        expect(result.status).toBeDefined()

        const all = await MCP.uiResources()
        const keys = Object.keys(all)
        expect(keys.length).toBeGreaterThanOrEqual(1)

        // Find our resource — keyed by `${server}_${resource-name}` in the
        // current implementation. We don't depend on the exact key shape;
        // we look for the entry whose uri matches.
        const entry = Object.values(all).find((r) => r.uri === TEST_APP_URI)
        expect(entry).toBeDefined()
        expect(entry?.client).toBe(SERVER_NAME)
        expect(entry?.mimeType).toBe(RESOURCE_MIME_TYPE)

        const html = await MCP.fetchAppHtml(SERVER_NAME, TEST_APP_URI)
        expect(html).toBeDefined()
        // The fixture embeds a deterministic marker that lets us prove the
        // bytes are the same ones the server returned, not a stub.
        expect(html).toContain(TEST_APP_MARKER)
        expect(html).toContain("<!doctype html>")
      },
    })
  }, 30_000)
})
