import { describe, expect, test } from "bun:test"
import { ExportedSession, EXPORT_VERSION } from "../../src/session/export"

describe("session export format", () => {
  test("ExportedSession schema validates correct data", () => {
    const data = {
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      session: {
        id: "session_123",
        title: "Test session",
        directory: "/tmp/test",
        time: { created: Date.now(), updated: Date.now() },
      },
      messages: [
        {
          id: "msg_1",
          role: "user" as const,
          time: { created: Date.now() },
          parts: [
            {
              id: "part_1",
              type: "text",
              data: { text: "Hello", type: "text" },
            },
          ],
        },
        {
          id: "msg_2",
          role: "assistant" as const,
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
          cost: 0.01,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now(), completed: Date.now() },
          parts: [
            {
              id: "part_2",
              type: "text",
              data: { text: "Hi there", type: "text" },
            },
          ],
        },
      ],
      metadata: {
        messageCount: 2,
        partCount: 2,
      },
    }

    const result = ExportedSession.safeParse(data)
    expect(result.success).toBe(true)
  })

  test("ExportedSession rejects invalid version", () => {
    const data = {
      version: "not a number",
      exportedAt: Date.now(),
      session: {
        id: "s1",
        title: "t",
        directory: "/",
        time: { created: 0, updated: 0 },
      },
      messages: [],
    }

    const result = ExportedSession.safeParse(data)
    expect(result.success).toBe(false)
  })

  test("EXPORT_VERSION is 1", () => {
    expect(EXPORT_VERSION).toBe(1)
  })
})
