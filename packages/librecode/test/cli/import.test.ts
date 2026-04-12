import { expect, test } from "bun:test"
import {
  parseShareUrl,
  type ShareData,
  shouldAttachShareAuthHeaders,
  transformShareData,
} from "../../src/cli/cmd/import"

// parseShareUrl tests
test("parses valid share URLs", () => {
  expect(parseShareUrl("https://opncd.ai/share/Jsj3hNIW")).toBe("Jsj3hNIW")
  expect(parseShareUrl("https://custom.example.com/share/abc123")).toBe("abc123")
  expect(parseShareUrl("http://localhost:3000/share/test_id-123")).toBe("test_id-123")
})

test("rejects invalid URLs", () => {
  expect(parseShareUrl("https://opncd.ai/s/Jsj3hNIW")).toBeNull() // legacy format
  expect(parseShareUrl("https://opncd.ai/share/")).toBeNull()
  expect(parseShareUrl("https://opncd.ai/share/id/extra")).toBeNull()
  expect(parseShareUrl("not-a-url")).toBeNull()
})

test("only attaches share auth headers for same-origin URLs", () => {
  expect(shouldAttachShareAuthHeaders("https://control.example.com/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("https://other.example.com/share/abc", "https://control.example.com")).toBe(false)
  expect(shouldAttachShareAuthHeaders("https://control.example.com:443/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("not-a-url", "https://control.example.com")).toBe(false)
})

// transformShareData tests
test("transforms share data to storage format", () => {
  const data: ShareData[] = [
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    { type: "session", data: { id: "sess-1", title: "Test" } as any },
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    { type: "message", data: { id: "msg-1", sessionID: "sess-1" } as any },
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    { type: "part", data: { id: "part-1", messageID: "msg-1" } as any },
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    { type: "part", data: { id: "part-2", messageID: "msg-1" } as any },
  ]

  // biome-ignore lint/style/noNonNullAssertion: test asserts result is non-null
  const result = transformShareData(data)!

  expect(result.info.id).toBe("sess-1")
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0].parts).toHaveLength(2)
})

test("returns null for invalid share data", () => {
  expect(transformShareData([])).toBeNull()
  // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
  expect(transformShareData([{ type: "message", data: {} as any }])).toBeNull()
  // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
  expect(transformShareData([{ type: "session", data: { id: "s" } as any }])).toBeNull() // no messages
})
