/**
 * Pure tests for the v0.9.46 ui/message char-limit + summarisation
 * helpers. The full handler integration is covered by the
 * ./mcp-app-message-handler.test.ts file (separate so the helpers
 * test stays import-cycle-free).
 */
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_MCP_MESSAGE_CHAR_LIMIT,
  type McpContentBlock,
  summarizeMessageText,
  validateMessageContent,
} from "./mcp-app-message"

describe("DEFAULT_MCP_MESSAGE_CHAR_LIMIT", () => {
  test("default is 8000 (per the v0.9.46 user decision)", () => {
    expect(DEFAULT_MCP_MESSAGE_CHAR_LIMIT).toBe(8000)
  })
})

describe("summarizeMessageText", () => {
  test("concatenates text blocks with newlines", () => {
    expect(
      summarizeMessageText([
        { type: "text", text: "Hello" },
        { type: "text", text: "world" },
      ]),
    ).toBe("Hello\nworld")
  })

  test("includes embedded resource text", () => {
    expect(
      summarizeMessageText([
        { type: "text", text: "Header" },
        { type: "resource", resource: { uri: "lctest://x", text: "body" } },
      ]),
    ).toBe("Header\nbody")
  })

  test("ignores image / audio / resource_link blocks (no inline text to summarise)", () => {
    expect(
      summarizeMessageText([
        { type: "image", data: "..." },
        { type: "audio", data: "..." },
        { type: "resource_link", uri: "https://example.com" },
      ]),
    ).toBe("")
  })

  test("empty array → empty string", () => {
    expect(summarizeMessageText([])).toBe("")
  })
})

describe("validateMessageContent", () => {
  test("empty content array → reject", () => {
    const v = validateMessageContent([], DEFAULT_MCP_MESSAGE_CHAR_LIMIT)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain("empty")
  })

  test("text within limit → accept, returns concatenated text", () => {
    const v = validateMessageContent([{ type: "text", text: "hello" }], 100)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.text).toBe("hello")
  })

  test("text over limit → reject with length detail", () => {
    const long = "a".repeat(150)
    const v = validateMessageContent([{ type: "text", text: long }], 100)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toContain("char limit")
      expect(v.reason).toContain("150")
      expect(v.reason).toContain("100")
    }
  })

  test("text exactly at limit → accept", () => {
    const v = validateMessageContent([{ type: "text", text: "a".repeat(100) }], 100)
    expect(v.ok).toBe(true)
  })

  test("only image blocks → accept (no text required when media is present)", () => {
    const v = validateMessageContent([{ type: "image", data: "..." }] as McpContentBlock[], 100)
    expect(v.ok).toBe(true)
  })

  test("only resource_link → accept", () => {
    const v = validateMessageContent([{ type: "resource_link", uri: "https://example.com" }], 100)
    expect(v.ok).toBe(true)
  })

  test("limit of 0 disables the cap", () => {
    const v = validateMessageContent([{ type: "text", text: "a".repeat(50_000) }], 0)
    expect(v.ok).toBe(true)
  })
})
