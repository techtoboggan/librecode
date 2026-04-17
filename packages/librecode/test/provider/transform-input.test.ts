import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import {
  filterAnthropicEmptyMessages,
  filterUnsupportedPart,
  isMistralModel,
  mimeToModality,
  normalizeInterleavedReasoning,
  normalizeMistralMessages,
  remapProviderOptionsKeys,
  sanitizeClaudeToolCallIds,
} from "../../src/provider/transform-input"
import type { Provider } from "../../src/provider/provider"

// ---------------------------------------------------------------------------
// Helper to build a minimal Provider.Model for tests
// ---------------------------------------------------------------------------

function makeModel(overrides: Partial<Provider.Model["capabilities"]["input"]> = {}): Provider.Model {
  return {
    id: "test/model" as Provider.Model["id"],
    providerID: "test" as Provider.Model["providerID"],
    api: { id: "test-model", url: "https://example.com", npm: "test" },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: true,
        video: false,
        pdf: false,
        ...overrides,
      },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
  } as unknown as Provider.Model
}

// ---------------------------------------------------------------------------
// mimeToModality
// ---------------------------------------------------------------------------

describe("mimeToModality", () => {
  test("maps image/ prefix to image", () => {
    expect(mimeToModality("image/png")).toBe("image")
    expect(mimeToModality("image/jpeg")).toBe("image")
    expect(mimeToModality("image/webp")).toBe("image")
  })

  test("maps audio/ prefix to audio", () => {
    expect(mimeToModality("audio/mp3")).toBe("audio")
    expect(mimeToModality("audio/wav")).toBe("audio")
  })

  test("maps video/ prefix to video", () => {
    expect(mimeToModality("video/mp4")).toBe("video")
  })

  test("maps application/pdf to pdf", () => {
    expect(mimeToModality("application/pdf")).toBe("pdf")
  })

  test("returns undefined for unknown types", () => {
    expect(mimeToModality("application/json")).toBeUndefined()
    expect(mimeToModality("text/plain")).toBeUndefined()
    expect(mimeToModality("")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// filterAnthropicEmptyMessages
// ---------------------------------------------------------------------------

describe("filterAnthropicEmptyMessages", () => {
  test("removes messages with empty string content", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "" },
      { role: "user", content: "hello" },
    ]
    const result = filterAnthropicEmptyMessages(msgs)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("hello")
  })

  test("keeps messages with non-empty string content", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hello" }]
    expect(filterAnthropicEmptyMessages(msgs)).toHaveLength(1)
  })

  test("removes array parts with empty text", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "non-empty" },
        ],
      },
    ]
    const result = filterAnthropicEmptyMessages(msgs)
    expect(result).toHaveLength(1)
    const content = result[0].content as Array<{ type: string; text: string }>
    expect(content).toHaveLength(1)
    expect(content[0].text).toBe("non-empty")
  })

  test("removes message entirely when all array parts are empty", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
      },
    ]
    const result = filterAnthropicEmptyMessages(msgs)
    expect(result).toHaveLength(0)
  })

  test("keeps reasoning parts that are empty text filtered out", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "answer" },
        ],
      },
    ]
    const result = filterAnthropicEmptyMessages(msgs)
    const content = result[0].content as Array<{ type: string; text: string }>
    // empty reasoning should be filtered
    expect(content.some((p) => p.type === "reasoning")).toBe(false)
    expect(content.some((p) => p.type === "text")).toBe(true)
  })

  test("passes through messages with non-array non-string content unchanged", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const result = filterAnthropicEmptyMessages(msgs)
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// sanitizeClaudeToolCallIds
// ---------------------------------------------------------------------------

describe("sanitizeClaudeToolCallIds", () => {
  test("replaces invalid characters in tool-call ids", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    const msg = {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call.id:123/test", toolName: "foo", input: {} }],
    } as any as ModelMessage
    const result = sanitizeClaudeToolCallIds(msg)
    const part = (result.content as Array<{ toolCallId: string }>)[0]
    expect(part.toolCallId).toBe("call_id_123_test")
  })

  test("replaces invalid characters in tool-result ids", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    const msg = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "result.id:456", toolName: "foo", input: {}, output: "ok" }],
    } as any as ModelMessage
    const result = sanitizeClaudeToolCallIds(msg)
    const part = (result.content as Array<{ toolCallId: string }>)[0]
    expect(part.toolCallId).toBe("result_id_456")
  })

  test("leaves valid ids unchanged", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    const msg = {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "valid_id-123", toolName: "foo", input: {} }],
    } as any as ModelMessage
    const result = sanitizeClaudeToolCallIds(msg)
    const part = (result.content as Array<{ toolCallId: string }>)[0]
    expect(part.toolCallId).toBe("valid_id-123")
  })

  test("returns non-array content messages unchanged", () => {
    const msg: ModelMessage = { role: "user", content: "hello" }
    const result = sanitizeClaudeToolCallIds(msg)
    expect(result.content).toBe("hello")
  })

  test("does not modify user messages", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    const msg = {
      role: "user",
      content: [{ type: "tool-result", toolCallId: "some.id", toolName: "foo", input: {}, output: "ok" }],
    } as any as ModelMessage
    const result = sanitizeClaudeToolCallIds(msg)
    // user role should not be modified
    const part = (result.content as Array<{ toolCallId: string }>)[0]
    expect(part.toolCallId).toBe("some.id")
  })
})

// ---------------------------------------------------------------------------
// isMistralModel
// ---------------------------------------------------------------------------

describe("isMistralModel", () => {
  test("returns true for mistral providerID", () => {
    const model = makeModel()
    ;(model as unknown as { providerID: string }).providerID = "mistral"
    expect(isMistralModel(model)).toBe(true)
  })

  test("returns true when api.id contains mistral", () => {
    const model = makeModel()
    ;(model as unknown as { api: { id: string; url: string; npm: string } }).api = {
      id: "mistral-large",
      url: "https://api.mistral.ai",
      npm: "mistral",
    }
    expect(isMistralModel(model)).toBe(true)
  })

  test("returns true when api.id contains devstral", () => {
    const model = makeModel()
    ;(model as unknown as { api: { id: string; url: string; npm: string } }).api = {
      id: "devstral-small",
      url: "https://api.mistral.ai",
      npm: "mistral",
    }
    expect(isMistralModel(model)).toBe(true)
  })

  test("returns false for non-mistral model", () => {
    expect(isMistralModel(makeModel())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// normalizeMistralMessages
// ---------------------------------------------------------------------------

describe("normalizeMistralMessages", () => {
  test("normalizes tool-call ids to 9 alphanumeric chars", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-abc-123-xyz", toolName: "foo", input: {} }],
      },
    ] as any as ModelMessage[]
    const result = normalizeMistralMessages(msgs)
    const part = (result[0].content as Array<{ toolCallId: string }>)[0]
    expect(part.toolCallId).toMatch(/^[a-zA-Z0-9]{9}$/)
  })

  test("pads short ids to 9 chars with zeros", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    const msgs = [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "ab", toolName: "foo", input: {} }] },
    ] as any as ModelMessage[]
    const result = normalizeMistralMessages(msgs)
    const part = (result[0].content as Array<{ toolCallId: string }>)[0]
    expect(part.toolCallId).toHaveLength(9)
    expect(part.toolCallId).toBe("ab0000000")
  })

  test("inserts assistant bridge message between tool and user messages", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    const msgs = [
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "abc123xyz", toolName: "foo", input: {}, output: "result" }],
      },
      { role: "user", content: "next" },
    ] as any as ModelMessage[]
    const result = normalizeMistralMessages(msgs)
    expect(result).toHaveLength(3)
    expect(result[1].role).toBe("assistant")
    expect((result[1].content as Array<{ text: string }>)[0].text).toBe("Done.")
    expect(result[2].role).toBe("user")
  })

  test("does not insert bridge when tool is not followed by user", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with minimal shape
    const msgs = [
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "abc123xyz", toolName: "foo", input: {}, output: "result" }],
      },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ] as any as ModelMessage[]
    const result = normalizeMistralMessages(msgs)
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// normalizeInterleavedReasoning
// ---------------------------------------------------------------------------

describe("normalizeInterleavedReasoning", () => {
  test("moves reasoning content into providerOptions under given field", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking..." },
          { type: "text", text: "answer" },
        ],
      },
    ]
    const result = normalizeInterleavedReasoning(msgs, "reasoning_content")
    const msg = result[0]
    const opts = msg.providerOptions as Record<string, Record<string, unknown>>
    expect(opts.openaiCompatible.reasoning_content).toBe("thinking...")
    // reasoning part should be removed from content
    const content = msg.content as Array<{ type: string }>
    expect(content.some((p) => p.type === "reasoning")).toBe(false)
  })

  test("removes reasoning part even when text is empty", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "reply" },
        ],
      },
    ]
    const result = normalizeInterleavedReasoning(msgs, "thinking_field")
    const content = result[0].content as Array<{ type: string }>
    expect(content.every((p) => p.type !== "reasoning")).toBe(true)
  })

  test("passes through non-assistant messages unchanged", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hello" }]
    const result = normalizeInterleavedReasoning(msgs, "reasoning_content")
    expect(result[0]).toEqual(msgs[0])
  })

  test("passes through assistant messages with no reasoning", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "just text" }],
      },
    ]
    const result = normalizeInterleavedReasoning(msgs, "reasoning_content")
    // No providerOptions added when no reasoning
    const msg = result[0]
    const content = msg.content as Array<{ type: string; text: string }>
    expect(content[0].text).toBe("just text")
  })

  test("merges with existing providerOptions", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "out" },
        ],
        providerOptions: { openaiCompatible: { existing_key: "val" } },
      },
    ]
    const result = normalizeInterleavedReasoning(msgs, "reasoning_content")
    const opts = result[0].providerOptions as Record<string, Record<string, unknown>>
    expect(opts.openaiCompatible.existing_key).toBe("val")
    expect(opts.openaiCompatible.reasoning_content).toBe("think")
  })
})

// ---------------------------------------------------------------------------
// filterUnsupportedPart
// ---------------------------------------------------------------------------

describe("filterUnsupportedPart", () => {
  test("passes through text parts unchanged", () => {
    const model = makeModel()
    const part = { type: "text" as const, text: "hello" }
    expect(filterUnsupportedPart(part, model)).toEqual(part)
  })

  test("passes through image when model supports images", () => {
    const model = makeModel({ image: true })
    const part = { type: "image" as const, image: new URL("data:image/png;base64,abc") }
    const result = filterUnsupportedPart(part, model)
    expect(result.type).toBe("image")
  })

  test("returns error text when model does not support image", () => {
    const model = makeModel({ image: false })
    const part = { type: "image" as const, image: new URL("data:image/png;base64,abc") }
    const result = filterUnsupportedPart(part, model)
    expect(result.type).toBe("text")
    expect((result as { text: string }).text).toContain("does not support")
    expect((result as { text: string }).text).toContain("image")
  })

  test("returns error text for empty base64 image", () => {
    const model = makeModel({ image: true })
    const part = { type: "image" as const, image: new URL("data:image/png;base64,") }
    const result = filterUnsupportedPart(part, model)
    expect(result.type).toBe("text")
    expect((result as { text: string }).text).toContain("empty or corrupted")
  })

  test("returns error text when model does not support pdf", () => {
    const model = makeModel({ pdf: false })
    const part = {
      type: "file" as const,
      data: new URL("data:application/pdf;base64,abc"),
      mediaType: "application/pdf",
      filename: "doc.pdf",
    }
    const result = filterUnsupportedPart(part, model)
    expect(result.type).toBe("text")
    expect((result as { text: string }).text).toContain('"doc.pdf"')
  })

  test("passes through file when model supports pdf", () => {
    const model = makeModel({ pdf: true })
    const part = {
      type: "file" as const,
      data: new URL("data:application/pdf;base64,abc"),
      mediaType: "application/pdf",
      filename: "doc.pdf",
    }
    const result = filterUnsupportedPart(part, model)
    expect(result.type).toBe("file")
  })

  test("passes through file with unsupported mime (no modality)", () => {
    const model = makeModel()
    const part = {
      type: "file" as const,
      data: new URL("data:application/zip;base64,abc"),
      mediaType: "application/zip",
    }
    const result = filterUnsupportedPart(part, model)
    expect(result.type).toBe("file")
  })
})

// ---------------------------------------------------------------------------
// remapProviderOptionsKeys
// ---------------------------------------------------------------------------

describe("remapProviderOptionsKeys", () => {
  test("renames key in message-level providerOptions", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: "hello",
        providerOptions: { oldKey: { value: 1 } },
      },
    ]
    const result = remapProviderOptionsKeys(msgs, "oldKey", "newKey")
    expect((result[0].providerOptions as Record<string, unknown>).newKey).toEqual({ value: 1 })
    expect((result[0].providerOptions as Record<string, unknown>).oldKey).toBeUndefined()
  })

  test("renames key in content part providerOptions", () => {
    // biome-ignore lint/suspicious/noExplicitAny: test data with extra providerOptions field
    const msgs = [
      { role: "assistant", content: [{ type: "text", text: "hi", providerOptions: { fromKey: "val" } }] },
    ] as any as ModelMessage[]
    const result = remapProviderOptionsKeys(msgs, "fromKey", "toKey")
    const part = (result[0].content as Array<{ providerOptions: Record<string, unknown> }>)[0]
    expect(part.providerOptions.toKey).toBe("val")
    expect(part.providerOptions.fromKey).toBeUndefined()
  })

  test("leaves messages without the fromKey unchanged", () => {
    // biome-ignore lint/suspicious/noExplicitAny: providerOptions value is string for test simplicity
    const msgs = [{ role: "user", content: "hi", providerOptions: { otherKey: "value" } }] as any as ModelMessage[]
    const result = remapProviderOptionsKeys(msgs, "missingKey", "newKey")
    expect((result[0].providerOptions as Record<string, unknown>).otherKey).toBe("value")
    expect((result[0].providerOptions as Record<string, unknown>).newKey).toBeUndefined()
  })

  test("leaves messages without providerOptions unchanged", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hi" }]
    const result = remapProviderOptionsKeys(msgs, "from", "to")
    expect(result[0].providerOptions).toBeUndefined()
  })
})
