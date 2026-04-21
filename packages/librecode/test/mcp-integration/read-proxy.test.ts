/**
 * Integration test for the MCP-app read-only proxies (Track 4 / v0.9.41).
 *
 * Spawns the fixture server, registers it via MCP.add, then exercises
 * the four primitives the proxy routes call:
 *   - listResourcesForServer
 *   - readResource (host-side primitive used by the resources/read route)
 *   - listResourceTemplatesForServer
 *   - listPromptsForServer
 *
 * Lives in test/mcp-integration/ to avoid the bun-mock leakage from the
 * sibling test/mcp/ files (apps.test.ts + oauth-auto-connect.test.ts
 * stub the SDK stdio/Client modules globally).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { MCP } from "../../src/mcp"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { TEST_TEXT_RESOURCE_MARKER, TEST_TEXT_RESOURCE_URI } from "../fixtures/mcp-apps/test-app-server"

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

describe("MCP app read-only proxies", () => {
  test("list + read + templates + prompts all return data from the live server", async () => {
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        await MCP.add(SERVER_NAME, { type: "local", command: ["bun", FIXTURE_SCRIPT] })

        // listResourcesForServer surfaces both the ui:// app resource
        // and the plain text resource the fixture registers.
        const list = await MCP.listResourcesForServer(SERVER_NAME)
        expect(list).toBeDefined()
        const uris = list?.resources.map((r) => r.uri) ?? []
        expect(uris).toContain(TEST_TEXT_RESOURCE_URI)

        // readResource on a known URI returns the verbatim marker.
        const read = (await MCP.readResource(SERVER_NAME, TEST_TEXT_RESOURCE_URI)) as
          | { contents: Array<{ text?: string }> }
          | undefined
        expect(read).toBeDefined()
        const text = read?.contents.map((c) => c.text ?? "").join("") ?? ""
        expect(text).toBe(TEST_TEXT_RESOURCE_MARKER)

        // listResourceTemplatesForServer is connected even if the fixture
        // doesn't currently register templates — assert the primitive
        // returns a result (not undefined → server is reachable).
        const templates = await MCP.listResourceTemplatesForServer(SERVER_NAME)
        expect(templates).toBeDefined()
        expect(Array.isArray(templates?.resourceTemplates)).toBe(true)

        // listPromptsForServer surfaces the registered prompt.
        const prompts = await MCP.listPromptsForServer(SERVER_NAME)
        expect(prompts).toBeDefined()
        const promptNames = prompts?.prompts.map((p) => p.name) ?? []
        expect(promptNames).toContain("test-greet")
      },
    })
  }, 30_000)
})
