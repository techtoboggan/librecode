import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { resolveProcessResult, type StreamState } from "../../src/session/processor"

// Unit tests for the processor's decision helpers. The full dispatch
// loop requires a real Session + provider stream and is covered by
// integration tests; this file pins the pure transition logic.

function emptyState(overrides: Partial<StreamState> = {}): StreamState {
  return {
    toolcalls: {},
    snapshot: undefined,
    blocked: false,
    needsCompaction: false,
    currentText: undefined,
    reasoningMap: {},
    shouldBreak: false,
    ...overrides,
  }
}

function assistantMsg(overrides: Partial<MessageV2.Assistant> = {}): MessageV2.Assistant {
  return {
    id: "ast-test" as never,
    role: "assistant" as const,
    sessionID: "ses-test" as never,
    mode: "build",
    path: { cwd: "/", root: "/" },
    providerID: "p" as never,
    modelID: "m" as never,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0 },
    summary: false,
    ...overrides,
  } as unknown as MessageV2.Assistant
}

describe("resolveProcessResult", () => {
  test("clean state → continue", () => {
    expect(resolveProcessResult(emptyState(), assistantMsg())).toBe("continue")
  })

  test("needsCompaction wins — returns 'compact'", () => {
    // Even if blocked or errored, compaction takes priority because
    // we need to run compaction before we can take any other action.
    const state = emptyState({ needsCompaction: true, blocked: true })
    const msg = assistantMsg({ error: { name: "AssistantError" as never, data: {} } })
    expect(resolveProcessResult(state, msg)).toBe("compact")
  })

  test("blocked → stop", () => {
    const state = emptyState({ blocked: true })
    expect(resolveProcessResult(state, assistantMsg())).toBe("stop")
  })

  test("assistant error → stop (but only if not blocked/compaction)", () => {
    const msg = assistantMsg({ error: { name: "ProviderError" as never, data: {} } })
    expect(resolveProcessResult(emptyState(), msg)).toBe("stop")
  })

  test("error AND compaction → compact wins", () => {
    const state = emptyState({ needsCompaction: true })
    const msg = assistantMsg({ error: { name: "X" as never, data: {} } })
    expect(resolveProcessResult(state, msg)).toBe("compact")
  })

  test("blocked AND compaction → compact wins", () => {
    const state = emptyState({ needsCompaction: true, blocked: true })
    expect(resolveProcessResult(state, assistantMsg())).toBe("compact")
  })

  test("shouldBreak + currentText + reasoning do not affect the result", () => {
    const state = emptyState({
      shouldBreak: true,
      currentText: { type: "text", text: "hi" } as MessageV2.TextPart,
      reasoningMap: { r1: { type: "reasoning" } as MessageV2.ReasoningPart },
    })
    // None of these are in the decision — still 'continue'
    expect(resolveProcessResult(state, assistantMsg())).toBe("continue")
  })
})
