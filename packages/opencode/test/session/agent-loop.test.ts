import { describe, expect, test } from "bun:test"
import { AgentLoopTracker, isValidTransition, VALID_TRANSITIONS } from "../../src/session/agent-loop"
import { SessionID } from "../../src/session/schema"

describe("AgentLoopTracker", () => {
  test("starts in initialize state", () => {
    const tracker = new AgentLoopTracker(SessionID.make("test"), "build")
    expect(tracker.current().type).toBe("initialize")
    expect(tracker.currentStep()).toBe(0)
  })

  test("tracks state transitions", () => {
    const tracker = new AgentLoopTracker(SessionID.make("test"), "build")
    tracker.transition({ type: "route" })
    expect(tracker.current().type).toBe("route")

    tracker.transition({ type: "process", step: 1 })
    expect(tracker.current().type).toBe("process")
    expect(tracker.currentStep()).toBe(1)
  })

  test("tracks tool calls", () => {
    const tracker = new AgentLoopTracker(SessionID.make("test"), "build")
    tracker.recordToolCall()
    tracker.recordToolCall()
    tracker.recordToolCall()
    // No public getter for toolCalls, but emitEnd will include it
    // Just verify it doesn't throw
  })

  test("handles full lifecycle", () => {
    const tracker = new AgentLoopTracker(SessionID.make("test"), "build")
    tracker.emitStart("gpt-4", "openai")
    tracker.transition({ type: "route" })
    tracker.transition({ type: "process", step: 1 })
    tracker.recordToolCall()
    tracker.transition({ type: "initialize" })
    tracker.transition({ type: "route" })
    tracker.transition({ type: "process", step: 2 })
    tracker.transition({ type: "exit", reason: "complete" })
    tracker.emitEnd("complete")
    expect(tracker.current().type).toBe("exit")
  })
})

describe("isValidTransition", () => {
  test("initialize can go to route or exit", () => {
    expect(isValidTransition("initialize", "route")).toBe(true)
    expect(isValidTransition("initialize", "exit")).toBe(true)
    expect(isValidTransition("initialize", "process")).toBe(false)
  })

  test("route can go to subtask, compaction, process, or exit", () => {
    expect(isValidTransition("route", "subtask")).toBe(true)
    expect(isValidTransition("route", "compaction")).toBe(true)
    expect(isValidTransition("route", "process")).toBe(true)
    expect(isValidTransition("route", "exit")).toBe(true)
    expect(isValidTransition("route", "initialize")).toBe(false)
  })

  test("subtask always goes back to initialize", () => {
    expect(isValidTransition("subtask", "initialize")).toBe(true)
    expect(isValidTransition("subtask", "exit")).toBe(false)
  })

  test("compaction goes to initialize or exit", () => {
    expect(isValidTransition("compaction", "initialize")).toBe(true)
    expect(isValidTransition("compaction", "exit")).toBe(true)
    expect(isValidTransition("compaction", "process")).toBe(false)
  })

  test("process goes to initialize or exit", () => {
    expect(isValidTransition("process", "initialize")).toBe(true)
    expect(isValidTransition("process", "exit")).toBe(true)
    expect(isValidTransition("process", "subtask")).toBe(false)
  })

  test("exit is terminal", () => {
    expect(isValidTransition("exit", "initialize")).toBe(false)
    expect(isValidTransition("exit", "route")).toBe(false)
  })

  test("unknown states return false", () => {
    expect(isValidTransition("nonexistent", "route")).toBe(false)
  })
})

describe("VALID_TRANSITIONS", () => {
  test("all states are accounted for", () => {
    const states = ["initialize", "route", "subtask", "compaction", "process", "exit"]
    for (const state of states) {
      expect(VALID_TRANSITIONS[state]).toBeDefined()
    }
  })

  test("exit has no transitions", () => {
    expect(VALID_TRANSITIONS["exit"]).toEqual([])
  })
})
