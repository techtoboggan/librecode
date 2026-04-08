import { describe, expect, test } from "bun:test"
import { tool } from "../src/tool"
import { z } from "zod"

describe("tool", () => {
  test("defines a tool with description, args, and execute", () => {
    const myTool = tool({
      description: "A test tool",
      args: {
        input: z.string(),
        count: z.number().optional(),
      },
      execute: async (args) => {
        return `processed: ${args.input}`
      },
    })

    expect(myTool.description).toBe("A test tool")
    expect(myTool.args).toBeDefined()
    expect(myTool.execute).toBeInstanceOf(Function)
  })

  test("execute receives validated args", async () => {
    const echo = tool({
      description: "Echo tool",
      args: {
        message: z.string(),
      },
      execute: async (args) => {
        return args.message
      },
    })

    const ctx = {
      sessionID: "test-session",
      messageID: "test-msg",
      agent: "test-agent",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    const result = await echo.execute({ message: "hello" }, ctx)
    expect(result).toBe("hello")
  })

  test("exposes zod as tool.schema", () => {
    expect(tool.schema).toBe(z)
    expect(tool.schema.string).toBeDefined()
    expect(tool.schema.number).toBeDefined()
  })
})
