import { describe, expect, test } from "bun:test"
import { InvalidTool } from "../../src/tool/invalid"

describe("InvalidTool", () => {
  test("has id 'invalid'", () => {
    expect(InvalidTool.id).toBe("invalid")
  })

  test("init returns a description and parameters schema", async () => {
    const tool = await InvalidTool.init()
    expect(typeof tool.description).toBe("string")
    expect(tool.parameters).toBeDefined()
  })

  test("execute returns an output message with the error text", async () => {
    const tool = await InvalidTool.init()
    const ctx = {
      sessionID: "s1" as never,
      messageID: "m1" as never,
      agent: "test",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      ask: async () => {},
    }
    const result = await tool.execute({ tool: "my_tool", error: "bad args" }, ctx)
    expect(result.title).toBe("Invalid Tool")
    expect(result.output).toContain("bad args")
    expect(result.metadata).toBeDefined()
  })

  test("execute includes the error message verbatim", async () => {
    const tool = await InvalidTool.init()
    const ctx = {
      sessionID: "s1" as never,
      messageID: "m1" as never,
      agent: "test",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      ask: async () => {},
    }
    const specificError = "Expected string, received number at path .foo"
    const result = await tool.execute({ tool: "edit", error: specificError }, ctx)
    expect(result.output).toContain(specificError)
  })
})
