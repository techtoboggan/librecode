import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

describe("tool.registry", () => {
  test("loads tools from .librecode/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const librecodeDir = path.join(dir, ".librecode")
        await fs.mkdir(librecodeDir, { recursive: true })

        const toolDir = path.join(librecodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools from .librecode/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const librecodeDir = path.join(dir, ".librecode")
        await fs.mkdir(librecodeDir, { recursive: true })

        const toolsDir = path.join(librecodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("named export (non-default) gets prefixed id", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const librecodeDir = path.join(dir, ".librecode")
        await fs.mkdir(librecodeDir, { recursive: true })

        const toolDir = path.join(librecodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "mymod.ts"),
          [
            "export const myTool = {",
            "  description: 'a named export tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'named result'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        // Named non-default export should be prefixed with namespace: "mymod_myTool"
        expect(ids).toContain("mymod_myTool")
      },
    })
  })

  test("fromPlugin tool executes and returns output", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const librecodeDir = path.join(dir, ".librecode")
        await fs.mkdir(librecodeDir, { recursive: true })

        const toolDir = path.join(librecodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "greet.ts"),
          [
            "export default {",
            "  description: 'greeting tool',",
            "  args: { name: { type: 'string' } },",
            "  execute: async ({ name }) => {",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional JS source code string
            "    return `hello ${name}`",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(
          { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4o") },
          undefined,
        )
        const greetTool = tools.find((t) => t.id === "greet")
        expect(greetTool).toBeDefined()
        expect(greetTool?.description).toBe("greeting tool")

        const ctx = {
          sessionID: "s1" as never,
          messageID: "m1" as never,
          agent: "test",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }
        const result = await greetTool?.execute({ name: "world" }, ctx)
        expect((result as { output: unknown }).output).toContain("hello world")
      },
    })
  })

  test("registryTools includes standard tools", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(
          { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-3-5-sonnet-20241022") },
          undefined,
        )
        const ids = tools.map((t) => t.id)
        expect(ids).toContain("invalid")
        expect(ids).toContain("bash")
        expect(ids).toContain("read")
        expect(ids).toContain("edit")
        expect(ids).toContain("write")
        // apply_patch should NOT be in non-GPT models
        expect(ids).not.toContain("apply_patch")
      },
    })
  })

  test("registryTools uses apply_patch for GPT models", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(
          { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
          undefined,
        )
        const ids = tools.map((t) => t.id)
        expect(ids).toContain("apply_patch")
        // edit/write should not be present when apply_patch is used
        expect(ids).not.toContain("edit")
        expect(ids).not.toContain("write")
      },
    })
  })

  test("websearch and codesearch excluded when EXA flag is off", async () => {
    const prev = process.env.LIBRECODE_ENABLE_EXA
    delete process.env.LIBRECODE_ENABLE_EXA
    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.tools(
            { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-3-5-sonnet-20241022") },
            undefined,
          )
          const ids = tools.map((t) => t.id)
          expect(ids).not.toContain("websearch")
          expect(ids).not.toContain("codesearch")
        },
      })
    } finally {
      if (prev === undefined) delete process.env.LIBRECODE_ENABLE_EXA
      else process.env.LIBRECODE_ENABLE_EXA = prev
    }
  })

  test("registryRegister replaces an existing custom tool", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const librecodeDir = path.join(dir, ".librecode")
        await fs.mkdir(librecodeDir, { recursive: true })
        const toolDir = path.join(librecodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })
        await Bun.write(
          path.join(toolDir, "ping.ts"),
          [
            "export default {",
            "  description: 'ping v1',",
            "  args: {},",
            "  execute: async () => 'pong',",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Ensure the tool is loaded first
        const before = await ToolRegistry.ids()
        expect(before).toContain("ping")

        // Register a replacement with the same id
        await ToolRegistry.register({
          id: "ping",
          init: async () => ({
            description: "ping v2",
            parameters: (await import("zod")).default.object({}),
            execute: async () => ({ title: "ping", output: "pong-v2", metadata: {} }),
          }),
        })

        const tools = await ToolRegistry.tools(
          { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-3-5-sonnet-20241022") },
          undefined,
        )
        const pingTool = tools.find((t) => t.id === "ping")
        expect(pingTool?.description).toBe("ping v2")
      },
    })
  })

  // Skipped: requires npm network access to install cowsay at runtime.
  // TODO: mock BunProc.install for isolated testing
  test.skip("loads tools with external dependencies without crashing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const librecodeDir = path.join(dir, ".librecode")
        await fs.mkdir(librecodeDir, { recursive: true })

        const toolsDir = path.join(librecodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(librecodeDir, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@librecode/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        )

        await Bun.write(
          path.join(toolsDir, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("cowsay")
      },
    })
  })
})
