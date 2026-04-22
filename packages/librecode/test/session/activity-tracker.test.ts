import { describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { File as FileModule } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { ActivityTracker } from "../../src/session/activity-tracker"
import { TransitionEvent } from "../../src/session/agent-loop"
import { MessageV2 } from "../../src/session/message-v2"
import { tmpdir } from "../fixture/fixture"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeToolPart(
  tool: string,
  status: "pending" | "running" | "completed",
  sessionID: string,
  messageID: string,
  input: Record<string, unknown> = {},
) {
  const base = {
    id: `part-${Math.random().toString(36).slice(2)}` as never,
    sessionID: sessionID as never,
    messageID: messageID as never,
    type: "tool" as const,
    callID: `call-${Math.random().toString(36).slice(2)}`,
    tool,
  }
  if (status === "pending") {
    return { ...base, state: { status: "pending" as const, input, raw: "" } }
  }
  if (status === "running") {
    return { ...base, state: { status: "running" as const, input, time: { start: Date.now() } } }
  }
  return {
    ...base,
    state: {
      status: "completed" as const,
      input,
      output: "ok",
      title: "done",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  }
}

/**
 * Initialise the ActivityTracker's Instance.state singleton, which registers
 * bus subscriptions. Must be called inside an Instance.provide context before
 * any bus events are published.
 */
async function initTracker() {
  await ActivityTracker.get("__init__" as never)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ActivityTracker.get", () => {
  test("returns empty session for unknown sessionID", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ActivityTracker.get("session-unknown" as never)
        expect(result.sessionID).toBe("session-unknown")
        expect(result.files).toEqual({})
        expect(result.agents).toEqual({})
      },
    })
  })
})

describe("ActivityTracker via bus events — PartUpdated", () => {
  test("read tool: classifies as 'read' and extracts filePath", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-read-1"
        const mid = "msg-read-1"
        const part = makeToolPart("read", "running", sid, mid, { filePath: "/tmp/foo.ts" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.files["/tmp/foo.ts"]).toBeDefined()
        expect(activity.files["/tmp/foo.ts"]?.kind).toBe("read")
        expect(activity.agents[mid]).toBeDefined()
        expect(activity.agents[mid]?.tool).toBe("read")
        expect(activity.agents[mid]?.file).toBe("/tmp/foo.ts")
      },
    })
  })

  test("write tool: classifies as 'write' and extracts path", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-write-1"
        const mid = "msg-write-1"
        const part = makeToolPart("edit", "running", sid, mid, { filePath: "/tmp/bar.ts" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.files["/tmp/bar.ts"]?.kind).toBe("write")
      },
    })
  })

  test("shell tool (bash): classifies as 'shell', no file entry", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-shell-1"
        const mid = "msg-shell-1"
        const part = makeToolPart("bash", "running", sid, mid, { command: "ls" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        // no file (bash has no filePath input), agent entry should exist
        expect(Object.keys(activity.files)).toHaveLength(0)
        expect(activity.agents[mid]?.tool).toBe("bash")
        expect(activity.agents[mid]?.phase).toBe("running")
      },
    })
  })

  test("search tool (websearch): classifies as 'search', no file entry", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-search-1"
        const mid = "msg-search-1"
        const part = makeToolPart("websearch", "running", sid, mid, { query: "test" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(Object.keys(activity.files)).toHaveLength(0)
        expect(activity.agents[mid]?.tool).toBe("websearch")
      },
    })
  })

  test("webfetch: classifies as 'search'", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-webfetch-1"
        const mid = "msg-webfetch-1"
        const part = makeToolPart("webfetch", "running", sid, mid, { url: "https://example.com" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.agents[mid]?.tool).toBe("webfetch")
        expect(Object.keys(activity.files)).toHaveLength(0)
      },
    })
  })

  test("unknown tool: classifies as 'other', no file entry even with filePath", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-other-1"
        const mid = "msg-other-1"
        // 'other' kind tools with a filePath don't get a files entry (kind === "other")
        const part = makeToolPart("unknown_tool", "running", sid, mid, { filePath: "/tmp/x.ts" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        // kind is "other" so no file entry
        expect(Object.keys(activity.files)).toHaveLength(0)
        expect(activity.agents[mid]?.tool).toBe("unknown_tool")
      },
    })
  })

  test("completed tool: file kind keeps the tool's classified colour (regressed in v0.9.58, fixed v0.9.59)", async () => {
    // Fast tools like `read` finish in milliseconds — the old behaviour
    // flipped to "idle" on completion, which meant the Activity Graph
    // iframe never saw a coloured node for these tools. The iframe
    // fades nodes via alpha against `age`, so the colour can stay put
    // without leaving stale-looking state.
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-complete-1"
        const mid = "msg-complete-1"
        const part = makeToolPart("read", "completed", sid, mid, { filePath: "/tmp/done.ts" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.files["/tmp/done.ts"]?.kind).toBe("read")
      },
    })
  })

  test("fileFromInput: uses 'path' key if 'filePath' is absent", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-path-key-1"
        const mid = "msg-path-key-1"
        const part = makeToolPart("glob", "running", sid, mid, { path: "/tmp/glob-path.ts" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.files["/tmp/glob-path.ts"]).toBeDefined()
        expect(activity.files["/tmp/glob-path.ts"]?.kind).toBe("read")
      },
    })
  })

  test("fileFromInput: uses 'file_path' key as fallback", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-file-path-key-1"
        const mid = "msg-file-path-key-1"
        const part = makeToolPart("write", "running", sid, mid, { file_path: "/tmp/write-path.ts" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.files["/tmp/write-path.ts"]).toBeDefined()
        expect(activity.files["/tmp/write-path.ts"]?.kind).toBe("write")
      },
    })
  })

  test("multiple tools: all tools supported (lsp, codesearch, multiedit, apply_patch)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-multi-tools"
        const tools = ["lsp", "codesearch", "multiedit", "apply_patch"] as const
        for (const tool of tools) {
          const mid = `msg-${tool}`
          const part = makeToolPart(tool, "running", sid, mid, { filePath: `/tmp/${tool}.ts` })
          await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })
        }
        const activity = await ActivityTracker.get(sid as never)
        // lsp and codesearch are READ_TOOLS, multiedit and apply_patch are WRITE_TOOLS
        expect(activity.files["/tmp/lsp.ts"]?.kind).toBe("read")
        expect(activity.files["/tmp/codesearch.ts"]?.kind).toBe("read")
        expect(activity.files["/tmp/multiedit.ts"]?.kind).toBe("write")
        expect(activity.files["/tmp/apply_patch.ts"]?.kind).toBe("write")
      },
    })
  })

  test("agent entry uses messageID as agentID", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-agentid-1"
        const mid = "my-custom-message-id"
        const part = makeToolPart("bash", "running", sid, mid, {})
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.agents["my-custom-message-id"]).toBeDefined()
        expect(activity.agents["my-custom-message-id"]?.agentID).toBe("my-custom-message-id")
      },
    })
  })

  test("non-tool parts are ignored", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-text-part"
        const textPart = {
          id: "part-text-1" as never,
          sessionID: sid as never,
          messageID: "msg-text-1" as never,
          type: "text" as const,
          text: "hello world",
        }
        await Bus.publish(MessageV2.Event.PartUpdated, { part: textPart as never })

        const activity = await ActivityTracker.get(sid as never)
        expect(Object.keys(activity.files)).toHaveLength(0)
        expect(Object.keys(activity.agents)).toHaveLength(0)
      },
    })
  })
})

describe("ActivityTracker via bus events — FileEdited", () => {
  test("file.edited event creates a write entry in existing sessions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-file-edited-1"
        const mid = "msg-fe-1"
        // First create a session via PartUpdated
        const part = makeToolPart("bash", "running", sid, mid, {})
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        // Now emit a file.edited event
        await Bus.publish(FileModule.Event.Edited, { file: "/tmp/edited.ts" })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.files["/tmp/edited.ts"]).toBeDefined()
        expect(activity.files["/tmp/edited.ts"]?.kind).toBe("write")
        expect(activity.files["/tmp/edited.ts"]?.tool).toBe("edit")
      },
    })
  })
})

describe("ActivityTracker via bus events — TransitionEvent", () => {
  test("agent transition updates phase", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-transition-1"
        await Bus.publish(TransitionEvent, {
          sessionID: sid,
          from: "initialize",
          to: "process",
          step: 1,
        })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.agents.main).toBeDefined()
        expect(activity.agents.main?.phase).toBe("process")
      },
    })
  })

  test("transition to 'exit' keeps file kinds (iframe fades via age-based alpha)", async () => {
    // v0.9.59 — previously this flipped every file to "idle" on exit.
    // The Activity Graph fades old nodes via alpha already, so
    // keeping the classified kind lets the colour trail stay
    // visible after a turn ends instead of snapping to grey.
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-exit-1"
        const mid = "msg-exit-1"
        const part = makeToolPart("edit", "running", sid, mid, { filePath: "/tmp/exiting.ts" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        let activity = await ActivityTracker.get(sid as never)
        expect(activity.files["/tmp/exiting.ts"]?.kind).toBe("write")

        await Bus.publish(TransitionEvent, {
          sessionID: sid,
          from: "process",
          to: "exit",
          step: 5,
        })

        activity = await ActivityTracker.get(sid as never)
        expect(activity.files["/tmp/exiting.ts"]?.kind).toBe("write")
        expect(activity.agents.main?.phase).toBe("exit")
      },
    })
  })

  test("transition preserves existing agent data (spread merge)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-spread-1"
        // First set up an agent via PartUpdated
        const mid = "msg-spread-1"
        const part = makeToolPart("read", "running", sid, mid, { filePath: "/tmp/spread.ts" })
        await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })

        // Now transition — main agent should get phase updated
        await Bus.publish(TransitionEvent, {
          sessionID: sid,
          from: "initialize",
          to: "route",
          step: 0,
        })

        const activity = await ActivityTracker.get(sid as never)
        expect(activity.agents.main?.phase).toBe("route")
      },
    })
  })
})

describe("ActivityTracker — Updated bus event", () => {
  test("Updated event is emitted when PartUpdated fires", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await initTracker()
        const sid = "sess-updated-evt"
        const mid = "msg-updated-evt"
        const received: string[] = []
        const unsub = Bus.subscribe(ActivityTracker.Updated, (ev) => {
          received.push(ev.properties.sessionID)
        })

        try {
          const part = makeToolPart("bash", "running", sid, mid, {})
          await Bus.publish(MessageV2.Event.PartUpdated, { part: part as never })
          // Allow microtasks to settle
          await new Promise((r) => setTimeout(r, 0))
          expect(received).toContain(sid)
        } finally {
          unsub()
        }
      },
    })
  })
})
