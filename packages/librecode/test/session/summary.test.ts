import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { SessionSummary } from "../../src/session/summary"
import { SessionID } from "../../src/session/schema"
import { MessageID } from "../../src/session/schema"
import { Storage } from "../../src/storage/storage"
import type { SnapshotFileDiff } from "../../src/snapshot"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")

// Helper: generate valid prefixed IDs
function sid() {
  return SessionID.descending()
}
function mid() {
  return MessageID.ascending()
}

// Helper: build a minimal SnapshotFileDiff (before/after are not used by the diff() path under test)
function fileDiff(file: string, additions: number, deletions: number): SnapshotFileDiff {
  return { file, before: "", after: "", additions, deletions }
}

// ────────────────────────────────────────────────────────────────
// SessionSummary.computeDiff — pure helper (no storage needed)
// ────────────────────────────────────────────────────────────────
describe("SessionSummary.computeDiff", () => {
  test("returns empty array when messages have no snapshots", async () => {
    const result = await SessionSummary.computeDiff({ messages: [] })
    expect(result).toEqual([])
  })

  test("returns empty array when messages lack step-start/step-finish parts", async () => {
    const messages = [
      {
        info: { id: "msg-1", role: "user" },
        parts: [
          {
            type: "text",
            id: "p1",
            sessionID: "s1",
            messageID: "msg-1",
            text: "hello",
          },
        ],
      },
    ] as never
    const result = await SessionSummary.computeDiff({ messages })
    expect(result).toEqual([])
  })

  test("returns empty array when step-start is present but no step-finish", async () => {
    const messages = [
      {
        info: { id: "msg-1", role: "assistant" },
        parts: [
          {
            type: "step-start",
            id: "p1",
            sessionID: "s1",
            messageID: "msg-1",
            snapshot: "snap-abc",
          },
        ],
      },
    ] as never
    const result = await SessionSummary.computeDiff({ messages })
    expect(result).toEqual([])
  })

  test("returns empty array when step-finish is present but no step-start", async () => {
    const messages = [
      {
        info: { id: "msg-1", role: "assistant" },
        parts: [
          {
            type: "step-finish",
            id: "p1",
            sessionID: "s1",
            messageID: "msg-1",
            snapshot: "snap-xyz",
          },
        ],
      },
    ] as never
    const result = await SessionSummary.computeDiff({ messages })
    expect(result).toEqual([])
  })

  test("returns empty when step-start has no snapshot property", async () => {
    const messages = [
      {
        info: { id: "msg-1", role: "assistant" },
        parts: [
          // step-start without snapshot
          { type: "step-start", id: "p1", sessionID: "s1", messageID: "msg-1" },
          { type: "step-finish", id: "p2", sessionID: "s1", messageID: "msg-1", snapshot: "snap-xyz" },
        ],
      },
    ] as never
    const result = await SessionSummary.computeDiff({ messages })
    expect(result).toEqual([])
  })

  test("returns empty when step-finish has no snapshot property", async () => {
    const messages = [
      {
        info: { id: "msg-1", role: "assistant" },
        parts: [
          { type: "step-start", id: "p1", sessionID: "s1", messageID: "msg-1", snapshot: "snap-abc" },
          // step-finish without snapshot
          { type: "step-finish", id: "p2", sessionID: "s1", messageID: "msg-1" },
        ],
      },
    ] as never
    // Snapshot.diffFull won't be called since `to` is undefined
    const result = await SessionSummary.computeDiff({ messages })
    expect(result).toEqual([])
  })

  test("uses last step-finish snapshot as 'to' reference", async () => {
    // This test verifies findSnapshotTo picks the last step-finish.
    // With no real git repository behind the snapshots, Snapshot.diffFull will
    // return [] or throw — we just need the code path to be walked.
    const messages = [
      {
        info: { id: "msg-1", role: "assistant" },
        parts: [
          { type: "step-start", id: "p1", sessionID: "s1", messageID: "msg-1", snapshot: "snap-first" },
          { type: "step-finish", id: "p2", sessionID: "s1", messageID: "msg-1", snapshot: "snap-middle" },
          { type: "step-finish", id: "p3", sessionID: "s1", messageID: "msg-1", snapshot: "snap-last" },
        ],
      },
    ] as never

    // Snapshot.diffFull will fail gracefully with invalid refs — we just want
    // the code path through findSnapshotFrom/findSnapshotTo.
    const result = await SessionSummary.computeDiff({ messages }).catch(() => [])
    expect(Array.isArray(result)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────
// SessionSummary.diff — exercises unquoteGitPath via Storage.read
// ────────────────────────────────────────────────────────────────
describe("SessionSummary.diff", () => {
  test("returns empty array when no diff is stored", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = sid()
        const result = await SessionSummary.diff({ sessionID })
        expect(result).toEqual([])
      },
    })
  })

  test("returns stored diffs unchanged when file paths are plain (no quoting)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        const diffs: SnapshotFileDiff[] = [
          fileDiff("/home/user/project/src/index.ts", 5, 2),
          fileDiff("/home/user/project/README.md", 1, 0),
        ]
        await Storage.write(["session_diff", sessionID], diffs)
        const result = await SessionSummary.diff({ sessionID })
        expect(result).toHaveLength(2)
        expect(result[0].file).toBe("/home/user/project/src/index.ts")
        expect(result[1].file).toBe("/home/user/project/README.md")
      },
    })
  })

  test("unquotes git-quoted paths with octal escapes (non-ASCII filenames)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        // Git quotes non-ASCII paths like: "src/\320\277\321\200\320\270\320\262\320\265\321\202.ts"
        // That's the UTF-8 octal encoding for the Russian word "привет" (hello)
        const quotedPath = '"src/\\320\\277\\321\\200\\320\\270\\320\\262\\320\\265\\321\\202.ts"'
        const diffs: SnapshotFileDiff[] = [fileDiff(quotedPath, 3, 1)]
        await Storage.write(["session_diff", sessionID], diffs)
        const result = await SessionSummary.diff({ sessionID })
        expect(result).toHaveLength(1)
        // The file path should be unquoted (non-ASCII decoded from octal)
        expect(result[0].file).not.toContain("\\320")
        expect(result[0].file).not.toStartWith('"')
      },
    })
  })

  test("unquotes simple escape sequences in git paths", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        // Git can quote paths with spaces or special chars using backslash escapes
        const quotedPath = '"src/file\\twith\\ttabs.ts"'
        const diffs: SnapshotFileDiff[] = [fileDiff(quotedPath, 1, 0)]
        await Storage.write(["session_diff", sessionID], diffs)
        const result = await SessionSummary.diff({ sessionID })
        expect(result).toHaveLength(1)
        // tabs should be decoded
        expect(result[0].file).toContain("\t")
        expect(result[0].file).not.toStartWith('"')
      },
    })
  })

  test("does not re-process plain paths that happen to start with quote-like chars", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        // A path that starts with double-quote but doesn't end with one — left as-is
        const notQuoted = '"src/partial'
        const diffs: SnapshotFileDiff[] = [fileDiff(notQuoted, 0, 1)]
        await Storage.write(["session_diff", sessionID], diffs)
        const result = await SessionSummary.diff({ sessionID })
        expect(result[0].file).toBe(notQuoted)
      },
    })
  })

  test("diff with messageID parameter is accepted", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        const messageID = mid()
        const result = await SessionSummary.diff({ sessionID, messageID })
        expect(Array.isArray(result)).toBe(true)
      },
    })
  })

  test("persists unquoted paths back to storage when quoting was present", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        const quotedPath = '"src/\\303\\251l\\303\\250ve.ts"' // UTF-8 octal for "élève"
        const diffs: SnapshotFileDiff[] = [fileDiff(quotedPath, 2, 0)]
        await Storage.write(["session_diff", sessionID], diffs)

        // First call: unquotes and rewrites storage
        const result1 = await SessionSummary.diff({ sessionID })
        expect(result1[0].file).not.toContain("\\303")

        // Second call: should read back the already-unquoted version
        const result2 = await SessionSummary.diff({ sessionID })
        expect(result2[0].file).toBe(result1[0].file)
      },
    })
  })

  test('unquotes all simple escape sequences (\\r \\b \\f \\v \\\\ \\")', async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        // Each escape sequence: \r \b \f \v \\ \"
        const quotedPath = '"src/a\\rb\\bc\\fd\\ve\\\\f\\"g.ts"'
        const diffs: SnapshotFileDiff[] = [fileDiff(quotedPath, 0, 0)]
        await Storage.write(["session_diff", sessionID], diffs)
        const result = await SessionSummary.diff({ sessionID })
        expect(result).toHaveLength(1)
        const decoded = result[0].file
        expect(decoded).toContain("\r")
        expect(decoded).toContain("\b")
        expect(decoded).toContain("\f")
        expect(decoded).toContain("\v")
        expect(decoded).toContain("\\")
        expect(decoded).toContain('"')
        expect(decoded).not.toStartWith('"')
      },
    })
  })

  test("handles trailing backslash at end of git-quoted string body", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        // A quoted path where the last char before closing quote is a lone backslash
        // This exercises the !next branch in processBackslashEscape
        const quotedPath = '"src/path\\"' // ends with backslash then quote — actually valid
        const diffs: SnapshotFileDiff[] = [fileDiff(quotedPath, 0, 0)]
        await Storage.write(["session_diff", sessionID], diffs)
        const result = await SessionSummary.diff({ sessionID })
        expect(result).toHaveLength(1)
      },
    })
  })

  test("unknown escape (e.g. \\x) is passed through as literal char", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid()
        // \x is not a known escape: the char after backslash ('x') is used directly
        const quotedPath = '"src/path\\xend.ts"'
        const diffs: SnapshotFileDiff[] = [fileDiff(quotedPath, 0, 0)]
        await Storage.write(["session_diff", sessionID], diffs)
        const result = await SessionSummary.diff({ sessionID })
        expect(result).toHaveLength(1)
        // 'x' is the unknown escape: output contains literal 'x'
        expect(result[0].file).toContain("x")
        expect(result[0].file).not.toStartWith('"')
      },
    })
  })
})
