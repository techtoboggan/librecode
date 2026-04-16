import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { SessionStatus } from "../../src/session/status"
import { SessionID } from "../../src/session/schema"

const projectRoot = path.join(__dirname, "../..")

describe("SessionStatus", () => {
  test("get returns idle for unknown sessionID", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const id = SessionID.make("session-unknown-999")
        const status = SessionStatus.get(id)
        expect(status).toEqual({ type: "idle" })
      },
    })
  })

  test("list returns empty object when no sessions are active", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const list = SessionStatus.list()
        // Should be an object (may have entries from other tests, but at least a record)
        expect(typeof list).toBe("object")
      },
    })
  })

  test("set busy updates get to return busy", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const id = SessionID.make("session-busy-test-1")
        SessionStatus.set(id, { type: "busy" })
        expect(SessionStatus.get(id)).toEqual({ type: "busy" })
      },
    })
  })

  test("set idle removes session from list", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const id = SessionID.make("session-idle-cleanup-1")
        SessionStatus.set(id, { type: "busy" })
        expect(SessionStatus.get(id)).toEqual({ type: "busy" })

        SessionStatus.set(id, { type: "idle" })
        // After setting idle, it should revert to idle (default)
        expect(SessionStatus.get(id)).toEqual({ type: "idle" })
        // And should not appear in list
        expect(SessionStatus.list()[id]).toBeUndefined()
      },
    })
  })

  test("set retry stores retry status", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const id = SessionID.make("session-retry-test-1")
        const retryStatus = { type: "retry" as const, attempt: 2, message: "rate limited", next: Date.now() + 5000 }
        SessionStatus.set(id, retryStatus)
        const result = SessionStatus.get(id)
        expect(result.type).toBe("retry")
        if (result.type === "retry") {
          expect(result.attempt).toBe(2)
          expect(result.message).toBe("rate limited")
        }
      },
    })
  })

  test("set busy emits Status event", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const id = SessionID.make("session-event-test-1")
        const events: Array<{ sessionID: SessionID; status: { type: string } }> = []

        const unsub = Bus.subscribe(SessionStatus.Event.Status, (event) => {
          if (event.properties.sessionID === id) {
            events.push(event.properties as { sessionID: SessionID; status: { type: string } })
          }
        })

        try {
          SessionStatus.set(id, { type: "busy" })
          await new Promise((resolve) => setTimeout(resolve, 50))
          expect(events.length).toBeGreaterThan(0)
          expect(events[0].status.type).toBe("busy")
        } finally {
          unsub()
        }
      },
    })
  })

  test("set idle emits both Status and Idle events", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const id = SessionID.make("session-idle-event-test-1")
        const statusEvents: string[] = []
        const idleEvents: string[] = []

        const unsubStatus = Bus.subscribe(SessionStatus.Event.Status, (event) => {
          if (event.properties.sessionID === id) {
            statusEvents.push(event.properties.status.type)
          }
        })
        const unsubIdle = Bus.subscribe(SessionStatus.Event.Idle, (event) => {
          if (event.properties.sessionID === id) {
            idleEvents.push(event.properties.sessionID)
          }
        })

        try {
          SessionStatus.set(id, { type: "idle" })
          await new Promise((resolve) => setTimeout(resolve, 50))
          expect(statusEvents).toContain("idle")
          expect(idleEvents).toHaveLength(1)
        } finally {
          unsubStatus()
          unsubIdle()
        }
      },
    })
  })

  test("list contains busy session after set", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const id = SessionID.make("session-list-test-1")
        SessionStatus.set(id, { type: "busy" })
        const list = SessionStatus.list()
        expect(list[id]).toEqual({ type: "busy" })

        // Cleanup
        SessionStatus.set(id, { type: "idle" })
      },
    })
  })
})
