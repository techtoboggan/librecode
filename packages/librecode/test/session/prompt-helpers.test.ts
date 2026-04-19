import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { collectPendingTasks, scanMessages, updateScanState } from "../../src/session/prompt"
import type { ScanResult } from "../../src/session/prompt-schema"

// Unit tests for the pure scan helpers in session/prompt.ts. The outer
// prompt/loop functions require a running Instance + provider and are
// covered by integration tests; these pin the backwards-scan logic.

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let seq = 0
function userMsg(overrides: Partial<MessageV2.User> = {}, parts: MessageV2.Part[] = []): MessageV2.WithParts {
  seq++
  return {
    info: {
      id: `msg-${String(seq).padStart(3, "0")}` as never,
      role: "user" as const,
      sessionID: "ses-t" as never,
      time: { created: 0 },
      ...overrides,
    },
    parts,
  } as unknown as MessageV2.WithParts
}

function assistantMsg(overrides: Partial<MessageV2.Assistant> = {}, parts: MessageV2.Part[] = []): MessageV2.WithParts {
  seq++
  return {
    info: {
      id: `msg-${String(seq).padStart(3, "0")}` as never,
      role: "assistant" as const,
      sessionID: "ses-t" as never,
      time: { created: 0 },
      mode: "build",
      modelID: "m" as never,
      providerID: "p" as never,
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      summary: false,
      ...overrides,
    },
    parts,
  } as unknown as MessageV2.WithParts
}

function compactionPart(): MessageV2.Part {
  return { type: "compaction" } as MessageV2.Part
}

function subtaskPart(): MessageV2.Part {
  return { type: "subtask" } as MessageV2.Part
}

// ─── collectPendingTasks ─────────────────────────────────────────────────────

describe("collectPendingTasks", () => {
  test("returns only compaction + subtask parts", () => {
    const msg = userMsg({}, [
      { type: "text", text: "hi" } as MessageV2.Part,
      compactionPart(),
      { type: "tool" } as MessageV2.Part,
      subtaskPart(),
    ])
    const out = collectPendingTasks(msg)
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.type).sort()).toEqual(["compaction", "subtask"])
  })

  test("returns empty array when no pending tasks", () => {
    const msg = userMsg({}, [{ type: "text", text: "hi" } as MessageV2.Part])
    expect(collectPendingTasks(msg)).toEqual([])
  })

  test("works on empty parts", () => {
    expect(collectPendingTasks(userMsg({}, []))).toEqual([])
  })
})

// ─── updateScanState ─────────────────────────────────────────────────────────

describe("updateScanState", () => {
  test("sets lastUser on first user message", () => {
    const acc: Omit<ScanResult, "tasks"> = { lastUser: undefined, lastAssistant: undefined, lastFinished: undefined }
    const msg = userMsg()
    updateScanState(msg, acc)
    expect(acc.lastUser?.id).toBe(msg.info.id)
  })

  test("does not overwrite existing lastUser", () => {
    const existing = userMsg()
    const acc: Omit<ScanResult, "tasks"> = {
      lastUser: existing.info as MessageV2.User,
      lastAssistant: undefined,
      lastFinished: undefined,
    }
    const newer = userMsg()
    updateScanState(newer, acc)
    expect(acc.lastUser?.id).toBe(existing.info.id) // unchanged
  })

  test("sets lastAssistant on first assistant message", () => {
    const acc: Omit<ScanResult, "tasks"> = { lastUser: undefined, lastAssistant: undefined, lastFinished: undefined }
    const msg = assistantMsg()
    updateScanState(msg, acc)
    expect(acc.lastAssistant?.id).toBe(msg.info.id)
  })

  test("sets lastFinished only for assistant with finish timestamp", () => {
    const acc: Omit<ScanResult, "tasks"> = { lastUser: undefined, lastAssistant: undefined, lastFinished: undefined }
    const unfinished = assistantMsg()
    updateScanState(unfinished, acc)
    expect(acc.lastFinished).toBeUndefined()
    const finished = assistantMsg({ finish: { type: "stop", time: 123 } as never })
    updateScanState(finished, acc)
    expect(acc.lastFinished?.id).toBe(finished.info.id)
  })

  test("independent roles don't interfere", () => {
    const acc: Omit<ScanResult, "tasks"> = { lastUser: undefined, lastAssistant: undefined, lastFinished: undefined }
    const user = userMsg()
    const ast = assistantMsg({ finish: { type: "stop", time: 1 } as never })
    updateScanState(user, acc)
    updateScanState(ast, acc)
    expect(acc.lastUser?.id).toBe(user.info.id)
    expect(acc.lastAssistant?.id).toBe(ast.info.id)
    expect(acc.lastFinished?.id).toBe(ast.info.id)
  })
})

// ─── scanMessages ────────────────────────────────────────────────────────────

describe("scanMessages", () => {
  test("empty list → empty result", () => {
    const out = scanMessages([])
    expect(out).toEqual({
      lastUser: undefined,
      lastAssistant: undefined,
      lastFinished: undefined,
      tasks: [],
    })
  })

  test("finds most recent user, assistant, finished in one pass", () => {
    // Chronological order: user1, ast-unfinished, user2, ast-finished
    const user1 = userMsg()
    const astUnfinished = assistantMsg()
    const user2 = userMsg()
    const astFinished = assistantMsg({ finish: { type: "stop", time: 100 } as never })
    const out = scanMessages([user1, astUnfinished, user2, astFinished])
    expect(out.lastUser?.id).toBe(user2.info.id) // most recent user
    expect(out.lastAssistant?.id).toBe(astFinished.info.id) // most recent
    expect(out.lastFinished?.id).toBe(astFinished.info.id)
  })

  test("early exit when both lastUser + lastFinished are set", () => {
    // If a recent pass finds both, older messages should be ignored for tasks
    const olderSubtask = userMsg({}, [subtaskPart()])
    const user = userMsg()
    const astFinished = assistantMsg({ finish: { type: "stop", time: 10 } as never })
    const out = scanMessages([olderSubtask, user, astFinished])
    // Once lastUser + lastFinished are set via the break, earlier tasks
    // should NOT be collected
    expect(out.tasks).toEqual([])
  })

  test("collects pending tasks when no finished assistant", () => {
    // No lastFinished → tasks should be collected from all messages
    const msg1 = userMsg({}, [compactionPart()])
    const msg2 = userMsg({}, [subtaskPart()])
    const out = scanMessages([msg1, msg2])
    expect(out.lastFinished).toBeUndefined()
    expect(out.tasks.length).toBe(2)
  })

  test("sets lastAssistant even for unfinished assistants", () => {
    const user = userMsg()
    const ast = assistantMsg() // no finish
    const out = scanMessages([user, ast])
    expect(out.lastAssistant?.id).toBe(ast.info.id)
    expect(out.lastFinished).toBeUndefined()
  })
})
