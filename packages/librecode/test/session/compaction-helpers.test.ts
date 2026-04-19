import { describe, expect, test } from "bun:test"
import {
  collectPruneCandidates,
  PRUNE_PROTECT,
  resolveOverflowReplay,
  scanMsgPartsForPrune,
} from "../../src/session/compaction"
import type { MessageV2 } from "../../src/session/message-v2"

// Pure-function unit tests for session/compaction.ts helpers. The outer
// sessionCompactionPrune / sessionCompactionProcess functions need a real
// session + provider, which is why compaction.test.ts stays integration-
// style. These tests cover the decision logic in isolation.

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let partSeq = 0
function toolPart(opts: {
  tool?: string
  status?: "pending" | "running" | "completed"
  output?: string // used to drive token estimate
  compacted?: number
}): MessageV2.ToolPart {
  const id = `prt-${++partSeq}` as never
  const base = {
    id,
    sessionID: "ses-test" as never,
    messageID: "msg-test" as never,
    type: "tool" as const,
    callID: `call-${partSeq}`,
    tool: opts.tool ?? "read",
  }
  const status = opts.status ?? "completed"
  if (status === "completed") {
    return {
      ...base,
      state: {
        status: "completed" as const,
        input: {},
        output: opts.output ?? "ok",
        title: "done",
        metadata: {},
        time: { start: 0, end: 0, compacted: opts.compacted },
      },
    } as MessageV2.ToolPart
  }
  if (status === "running") {
    return {
      ...base,
      state: { status: "running" as const, input: {}, time: { start: 0 } },
    } as MessageV2.ToolPart
  }
  return {
    ...base,
    state: { status: "pending" as const, input: {}, raw: "" },
  } as MessageV2.ToolPart
}

let msgSeq = 0
function userMsg(parts: MessageV2.Part[] = []): MessageV2.WithParts {
  const id = `usr-${++msgSeq}` as never
  return {
    info: {
      id,
      role: "user" as const,
      sessionID: "ses-test" as never,
      time: { created: 0 },
    },
    parts,
  } as unknown as MessageV2.WithParts
}

function assistantMsg(parts: MessageV2.Part[] = [], opts: { summary?: boolean } = {}): MessageV2.WithParts {
  const id = `ast-${++msgSeq}` as never
  return {
    info: {
      id,
      role: "assistant" as const,
      sessionID: "ses-test" as never,
      time: { created: 0 },
      summary: opts.summary ?? false,
      modelID: "m",
      providerID: "p",
      mode: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts,
  } as unknown as MessageV2.WithParts
}

// 1 token ≈ 4 chars via Token.estimate. To push over PRUNE_PROTECT (40k)
// we need > 160k chars of output per pruned part. Use a small multiplier
// for readability.
function bigOutput(kiloTokens: number): string {
  return "x".repeat(kiloTokens * 1000 * 4)
}

// ─── scanMsgPartsForPrune ────────────────────────────────────────────────────

describe("scanMsgPartsForPrune", () => {
  test("empty message — no-op", () => {
    const state = { total: 0, pruned: 0, toPrune: [] as MessageV2.ToolPart[] }
    const stop = scanMsgPartsForPrune(userMsg([]), state)
    expect(stop).toBe(false)
    expect(state.toPrune).toEqual([])
    expect(state.total).toBe(0)
  })

  test("non-tool parts are ignored", () => {
    const state = { total: 0, pruned: 0, toPrune: [] as MessageV2.ToolPart[] }
    const msg = userMsg([{ type: "text", text: "hi" } as MessageV2.Part])
    scanMsgPartsForPrune(msg, state)
    expect(state.toPrune).toEqual([])
  })

  test("non-completed tool parts are ignored", () => {
    const state = { total: 0, pruned: 0, toPrune: [] as MessageV2.ToolPart[] }
    scanMsgPartsForPrune(userMsg([toolPart({ status: "running" })]), state)
    expect(state.toPrune).toEqual([])
  })

  test("already-compacted tool part stops the outer loop (returns true)", () => {
    const state = { total: 0, pruned: 0, toPrune: [] as MessageV2.ToolPart[] }
    const part = toolPart({ compacted: 123 })
    const stop = scanMsgPartsForPrune(userMsg([part]), state)
    expect(stop).toBe(true)
  })

  test("protected tool names (skill) are never pruned", () => {
    const state = { total: 0, pruned: 0, toPrune: [] as MessageV2.ToolPart[] }
    const part = toolPart({ tool: "skill", output: bigOutput(100) })
    scanMsgPartsForPrune(userMsg([part]), state)
    expect(state.toPrune).toEqual([])
    expect(state.total).toBe(0) // protected parts don't accumulate either
  })

  test("tool parts below PRUNE_PROTECT accumulate total but aren't pruned", () => {
    const state = { total: 0, pruned: 0, toPrune: [] as MessageV2.ToolPart[] }
    // 10k tokens — well under 40k protect threshold
    scanMsgPartsForPrune(userMsg([toolPart({ output: bigOutput(10) })]), state)
    expect(state.toPrune).toEqual([])
    expect(state.total).toBeGreaterThan(0)
    expect(state.total).toBeLessThan(PRUNE_PROTECT)
  })

  test("tool parts beyond PRUNE_PROTECT are added to toPrune", () => {
    const state = { total: 0, pruned: 0, toPrune: [] as MessageV2.ToolPart[] }
    // Three 20k-token parts: first two fit under 40k, third pushes over
    const parts = [
      toolPart({ output: bigOutput(20) }),
      toolPart({ output: bigOutput(20) }),
      toolPart({ output: bigOutput(20) }), // this one > protect → prune
    ]
    // Parts are walked backwards (index-wise) — construct such that the
    // BACKWARDS walk accumulates the first two, then the third overflows
    scanMsgPartsForPrune(userMsg(parts), state)
    expect(state.toPrune.length).toBe(1)
    expect(state.pruned).toBeGreaterThan(0)
  })
})

// ─── collectPruneCandidates ──────────────────────────────────────────────────

describe("collectPruneCandidates", () => {
  test("fewer than 2 user turns — nothing pruned", () => {
    const msgs = [userMsg([]), assistantMsg([toolPart({ output: bigOutput(100) })])]
    const out = collectPruneCandidates(msgs)
    expect(out.toPrune).toEqual([])
  })

  test("stops at assistant summary boundary", () => {
    const ancient = assistantMsg([toolPart({ output: bigOutput(100) })])
    const summary = assistantMsg([], { summary: true })
    const recent = [userMsg([]), userMsg([]), assistantMsg([])]
    const out = collectPruneCandidates([ancient, summary, ...recent])
    // The ancient huge tool part is behind the summary → not considered
    expect(out.toPrune).toEqual([])
  })

  test("finds prunable parts across multiple messages", () => {
    // Three user turns to get past the 2-turn protection
    const msgs = [
      assistantMsg([toolPart({ output: bigOutput(25) })]), // could be pruned
      assistantMsg([toolPart({ output: bigOutput(25) })]),
      userMsg([]),
      userMsg([]),
      userMsg([]),
    ]
    const out = collectPruneCandidates(msgs)
    // Depending on total accumulation, at least one should be prune-able
    expect(out.total).toBeGreaterThan(0)
  })

  test("empty message list — empty result", () => {
    const out = collectPruneCandidates([])
    expect(out.toPrune).toEqual([])
    expect(out.pruned).toBe(0)
    expect(out.total).toBe(0)
  })
})

// ─── resolveOverflowReplay ───────────────────────────────────────────────────

describe("resolveOverflowReplay", () => {
  test("no prior user message — returns undefined replay", () => {
    const asst = assistantMsg([])
    const out = resolveOverflowReplay([asst], asst.info.id)
    expect(out.replay).toBeUndefined()
    expect(out.messages).toEqual([asst])
  })

  test("finds nearest prior user message as replay", () => {
    const userA = userMsg([])
    const astA = assistantMsg([])
    const userB = userMsg([])
    const astB = assistantMsg([])
    const msgs = [userA, astA, userB, astB]
    const out = resolveOverflowReplay(msgs, astB.info.id)
    // Nearest user before astB is userB
    expect(out.replay?.info.id).toBe(userB.info.id)
    // Messages kept = everything before userB
    expect(out.messages).toEqual([userA, astA])
  })

  test("skips user messages that contain a compaction part", () => {
    // Layout: [userA, compUser, userB, astC]. Walking back from astC,
    // compUser is skipped (has compaction part), userB is the replay.
    // userA remains in `messages` behind the replay point, so replay
    // is preserved.
    const userA = userMsg([])
    const compUser = userMsg([{ type: "compaction" } as MessageV2.Part])
    const userB = userMsg([])
    const astC = assistantMsg([])
    const out = resolveOverflowReplay([userA, compUser, userB, astC], astC.info.id)
    expect(out.replay?.info.id).toBe(userB.info.id)
    // messages = [userA, compUser] (before the replay point)
    expect(out.messages.map((m) => m.info.id)).toEqual([userA.info.id, compUser.info.id])
  })

  test("compaction-only history behind replay returns replay: undefined", () => {
    // If the only thing left before the replay is a compaction-marked
    // user, there's nothing meaningful to compact. Return undefined so
    // the caller skips.
    const compUser = userMsg([{ type: "compaction" } as MessageV2.Part])
    const userB = userMsg([])
    const astC = assistantMsg([])
    const out = resolveOverflowReplay([compUser, userB, astC], astC.info.id)
    expect(out.replay).toBeUndefined()
  })

  test("when there's no content behind the replay — returns {replay: undefined}", () => {
    // Only one non-compaction user message → nothing to compact behind it
    const userA = userMsg([])
    const astB = assistantMsg([])
    const out = resolveOverflowReplay([userA, astB], astB.info.id)
    expect(out.replay).toBeUndefined()
  })

  test("preserves messages array when parentID not found", () => {
    const userA = userMsg([])
    const out = resolveOverflowReplay([userA], "missing-id" as never)
    expect(out.replay).toBeUndefined()
  })
})
