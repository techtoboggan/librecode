import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import {
  parseMcpContent,
  parseMcpResourceContent,
  wrapQueuedUserMessages,
  wrapTextPart,
} from "../../src/session/prompt-builder"
import type { McpParsedOutput, McpToolContent } from "../../src/session/prompt-schema"

// Unit tests for pure helpers in prompt-builder.ts. The full prompt
// assembly flow requires a running Instance + provider and is covered
// by integration tests; these cover the data transforms.

// ─── parseMcpContent / parseMcpResourceContent ───────────────────────────────

describe("parseMcpContent", () => {
  test("text-only content → text parts, no attachments", () => {
    const out = parseMcpContent([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ])
    expect(out.textParts).toEqual(["hello", "world"])
    expect(out.attachments).toEqual([])
  })

  test("image content → data URL attachment", () => {
    const out = parseMcpContent([{ type: "image", mimeType: "image/png", data: "AAAA" }])
    expect(out.textParts).toEqual([])
    expect(out.attachments).toHaveLength(1)
    expect(out.attachments[0]).toMatchObject({
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,AAAA",
    })
  })

  test("resource with text → added to textParts", () => {
    const out = parseMcpContent([
      {
        type: "resource",
        resource: { text: "resource text", uri: "file:///foo" },
      },
    ])
    expect(out.textParts).toEqual(["resource text"])
    expect(out.attachments).toEqual([])
  })

  test("resource with blob → added as attachment with data URL", () => {
    const out = parseMcpContent([
      {
        type: "resource",
        resource: { blob: "QUJD", mimeType: "application/pdf", uri: "file:///a.pdf" },
      },
    ])
    expect(out.textParts).toEqual([])
    expect(out.attachments).toHaveLength(1)
    expect(out.attachments[0]).toMatchObject({
      type: "file",
      mime: "application/pdf",
      url: "data:application/pdf;base64,QUJD",
      filename: "file:///a.pdf",
    })
  })

  test("resource with blob and no mimeType defaults to application/octet-stream", () => {
    const out = parseMcpContent([{ type: "resource", resource: { blob: "X", uri: "file:///bin" } }])
    expect(out.attachments[0]).toMatchObject({
      mime: "application/octet-stream",
      url: "data:application/octet-stream;base64,X",
    })
  })

  test("mixed content preserves order in respective buckets", () => {
    const content: McpToolContent[] = [
      { type: "text", text: "A" },
      { type: "image", mimeType: "image/jpeg", data: "i1" },
      { type: "text", text: "B" },
      { type: "image", mimeType: "image/gif", data: "i2" },
    ]
    const out = parseMcpContent(content)
    expect(out.textParts).toEqual(["A", "B"])
    expect(out.attachments.map((a) => a.mime)).toEqual(["image/jpeg", "image/gif"])
  })

  test("empty content → empty output", () => {
    const out = parseMcpContent([])
    expect(out).toEqual({ textParts: [], attachments: [] })
  })
})

describe("parseMcpResourceContent (direct)", () => {
  test("mutates the provided out parameter (not returns)", () => {
    const out: McpParsedOutput = { textParts: [], attachments: [] }
    parseMcpResourceContent({ type: "resource", resource: { text: "T", uri: "file:///x" } }, out)
    expect(out.textParts).toEqual(["T"])
  })
})

// ─── wrapTextPart / wrapQueuedUserMessages ───────────────────────────────────

function textPart(text: string, flags: Partial<{ ignored: boolean; synthetic: boolean }> = {}): MessageV2.Part {
  return { type: "text" as const, text, ...flags } as MessageV2.Part
}

describe("wrapTextPart", () => {
  test("wraps a text part with system-reminder markers", () => {
    const part = textPart("please fix bug")
    wrapTextPart(part)
    if (part.type !== "text") throw new Error("expected text")
    expect(part.text).toContain("<system-reminder>")
    expect(part.text).toContain("please fix bug")
    expect(part.text).toContain("</system-reminder>")
  })

  test("ignored parts are skipped", () => {
    const part = textPart("noise", { ignored: true })
    wrapTextPart(part)
    if (part.type !== "text") throw new Error("expected text")
    expect(part.text).toBe("noise") // unchanged
  })

  test("synthetic parts are skipped", () => {
    const part = textPart("auto", { synthetic: true })
    wrapTextPart(part)
    if (part.type !== "text") throw new Error("expected text")
    expect(part.text).toBe("auto")
  })

  test("empty/whitespace-only text is skipped", () => {
    const part = textPart("   \n  ")
    wrapTextPart(part)
    if (part.type !== "text") throw new Error("expected text")
    expect(part.text).toBe("   \n  ") // unchanged
  })

  test("non-text parts are no-ops", () => {
    const part = { type: "tool" } as MessageV2.Part
    wrapTextPart(part)
    // No assertion needed — just verifying no throw
  })
})

describe("wrapQueuedUserMessages", () => {
  test("wraps user messages AFTER lastFinished.id", () => {
    // MessageV2 IDs are lexicographically-sortable ulids. The function
    // uses string comparison (msg.id <= lastFinished.id), so we use
    // lexically-monotonic 'a'-'c' prefixes to simulate ascending ids.
    const lastFinished = { id: "msg-b" as never, role: "assistant" } as unknown as MessageV2.Assistant
    const msgs = [
      { info: { id: "msg-a" as never, role: "user" }, parts: [textPart("old, before lastFinished")] },
      { info: { id: "msg-c" as never, role: "user" }, parts: [textPart("new, queued after lastFinished")] },
    ] as unknown as MessageV2.WithParts[]
    wrapQueuedUserMessages(msgs, lastFinished)
    // msg-a <= msg-b → unchanged
    const m0 = msgs[0]?.parts[0]
    if (m0?.type === "text") expect(m0.text).toBe("old, before lastFinished")
    // msg-c > msg-b → wrapped
    const m1 = msgs[1]?.parts[0]
    if (m1?.type === "text") expect(m1.text).toContain("<system-reminder>")
  })

  test("skips assistant messages", () => {
    const lastFinished = { id: "msg-a" as never, role: "assistant" } as unknown as MessageV2.Assistant
    const msgs = [
      { info: { id: "msg-z" as never, role: "assistant" }, parts: [textPart("response")] },
    ] as unknown as MessageV2.WithParts[]
    wrapQueuedUserMessages(msgs, lastFinished)
    const p = msgs[0]?.parts[0]
    if (p?.type === "text") expect(p.text).toBe("response") // unchanged
  })
})
