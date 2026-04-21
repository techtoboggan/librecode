/**
 * Tests for the v0.9.47 in-memory MCP app-context store (ADR-005 §7).
 *
 * Covers: replace-on-write, per-app cap, per-session cap, fork copy,
 * delimited prompt segment shape, clear, and the per-session zeroing
 * behaviour when the last entry is removed.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  PER_APP_CONTEXT_CHAR_CAP,
  PER_SESSION_CONTEXT_CHAR_CAP,
  appContextSegments,
  clearAppContext,
  clearSessionAppContexts,
  forkContexts,
  getAllAppContexts,
  setAppContext,
  totalContextChars,
} from "../../src/mcp/app-context"
import { SessionID } from "../../src/session/schema"

const A = SessionID.descending()
const B = SessionID.descending()

afterEach(() => {
  clearSessionAppContexts(A)
  clearSessionAppContexts(B)
})

describe("setAppContext", () => {
  test("creates an entry then replaces on subsequent write", () => {
    const r1 = setAppContext({ sessionID: A, server: "acme", uri: "ui://x", content: "first" })
    expect(r1.ok).toBe(true)
    const r2 = setAppContext({ sessionID: A, server: "acme", uri: "ui://x", content: "second" })
    expect(r2.ok).toBe(true)
    const all = getAllAppContexts(A)
    expect(all.length).toBe(1)
    expect(all[0].content).toBe("second")
  })

  test("per-app cap rejects oversized content", () => {
    const big = "a".repeat(PER_APP_CONTEXT_CHAR_CAP + 1)
    const r = setAppContext({ sessionID: A, server: "acme", uri: "ui://x", content: big })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain("Per-app context cap")
      expect(r.reason).toContain(String(PER_APP_CONTEXT_CHAR_CAP))
    }
  })

  test("per-session cap rejects when total would exceed", () => {
    // Two apps, each just under the per-app cap, would together
    // exceed the per-session cap.
    const halfCap = Math.floor(PER_APP_CONTEXT_CHAR_CAP * 0.99)
    setAppContext({ sessionID: A, server: "a1", uri: "ui://x", content: "a".repeat(halfCap) })
    setAppContext({ sessionID: A, server: "a2", uri: "ui://x", content: "b".repeat(halfCap) })
    setAppContext({ sessionID: A, server: "a3", uri: "ui://x", content: "c".repeat(halfCap) })
    setAppContext({ sessionID: A, server: "a4", uri: "ui://x", content: "d".repeat(halfCap) })
    setAppContext({ sessionID: A, server: "a5", uri: "ui://x", content: "e".repeat(halfCap) })
    // 5 * 0.99 cap = ~4.95 cap units = ~198k chars — under the 200k
    // total cap. Adding one more should breach.
    const breach = setAppContext({ sessionID: A, server: "a6", uri: "ui://x", content: "f".repeat(halfCap) })
    expect(breach.ok).toBe(false)
    if (!breach.ok) expect(breach.reason).toContain("Total context cap")
  })

  test("per-session cap accounts for the previous entry being replaced (no double-count)", () => {
    // Setting a server-uri that already exists should NOT count both
    // the old and new content against the cap — replace, not stack.
    // Use the largest entry that still fits under the per-app cap.
    const big = "a".repeat(PER_APP_CONTEXT_CHAR_CAP)
    setAppContext({ sessionID: A, server: "acme", uri: "ui://x", content: big })
    // Replacing with another big entry should succeed because the
    // previous one is dropped from the total.
    const replace = setAppContext({ sessionID: A, server: "acme", uri: "ui://x", content: big })
    expect(replace.ok).toBe(true)
    expect(totalContextChars(A)).toBe(big.length)
  })
})

describe("clearAppContext + clearSessionAppContexts", () => {
  test("clearAppContext removes a single entry, leaves siblings", () => {
    setAppContext({ sessionID: A, server: "a1", uri: "ui://x", content: "1" })
    setAppContext({ sessionID: A, server: "a2", uri: "ui://x", content: "2" })
    clearAppContext(A, "a1", "ui://x")
    const remaining = getAllAppContexts(A)
    expect(remaining.length).toBe(1)
    expect(remaining[0].server).toBe("a2")
  })

  test("clearAppContext on the last entry deletes the session bucket entirely", () => {
    setAppContext({ sessionID: A, server: "a1", uri: "ui://x", content: "1" })
    clearAppContext(A, "a1", "ui://x")
    expect(getAllAppContexts(A)).toEqual([])
    expect(totalContextChars(A)).toBe(0)
  })

  test("clearSessionAppContexts wipes everything for the session", () => {
    setAppContext({ sessionID: A, server: "a1", uri: "ui://x", content: "1" })
    setAppContext({ sessionID: A, server: "a2", uri: "ui://y", content: "2" })
    clearSessionAppContexts(A)
    expect(getAllAppContexts(A)).toEqual([])
  })
})

describe("forkContexts", () => {
  test("copies entries to the new session, leaves original intact", () => {
    setAppContext({ sessionID: A, server: "acme", uri: "ui://x", content: "hello" })
    forkContexts(A, B)
    expect(getAllAppContexts(B).map((e) => e.content)).toEqual(["hello"])
    // Original still intact.
    expect(getAllAppContexts(A).map((e) => e.content)).toEqual(["hello"])
  })

  test("changes to the original after fork don't leak into the fork", () => {
    setAppContext({ sessionID: A, server: "acme", uri: "ui://x", content: "v1" })
    forkContexts(A, B)
    setAppContext({ sessionID: A, server: "acme", uri: "ui://x", content: "v2" })
    expect(getAllAppContexts(A)[0].content).toBe("v2")
    expect(getAllAppContexts(B)[0].content).toBe("v1")
  })

  test("forking an empty session is a no-op", () => {
    forkContexts(A, B)
    expect(getAllAppContexts(B)).toEqual([])
  })
})

describe("appContextSegments", () => {
  test("emits one delimited segment per entry with server + uri attrs", () => {
    const segs = appContextSegments([
      { server: "acme", uri: "ui://acme/weather", content: "sunny", updatedAt: 1 },
      { server: "other", uri: "ui://other/x", content: "data", updatedAt: 2 },
    ])
    expect(segs[0]).toContain('server="acme"')
    expect(segs[0]).toContain('uri="ui://acme/weather"')
    expect(segs[0]).toContain("sunny")
    expect(segs[0]).toContain("</mcp-app>")
    expect(segs[1]).toContain('server="other"')
  })

  test("escapes attribute quotes so an evil server name can't break out", () => {
    const segs = appContextSegments([{ server: 'evil"server', uri: 'ui://evil"x', content: "x", updatedAt: 1 }])
    expect(segs[0]).toContain("&quot;")
    expect(segs[0]).not.toContain('"server"')
  })

  test("structuredContent wins over content when present (JSON encoded)", () => {
    const segs = appContextSegments([
      {
        server: "acme",
        uri: "ui://x",
        content: "ignored",
        structuredContent: { score: 42 },
        updatedAt: 1,
      },
    ])
    expect(segs[0]).toContain('{"score":42}')
    expect(segs[0]).not.toContain("ignored")
  })

  test("empty input → empty array", () => {
    expect(appContextSegments([])).toEqual([])
  })
})
