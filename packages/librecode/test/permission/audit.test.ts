import { describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import * as Audit from "../../src/permission/audit"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("permission audit logging", () => {
  const sessionID = SessionID.make("audit-test-session")

  test("logAsked emits audit event with capability data", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Audit.AuditEntry[] = []
        const unsub = Bus.subscribe(Audit.Event.Logged, (event) => {
          events.push(event.properties)
        })

        Audit.logAsked({
          sessionID,
          permission: "bash",
          patterns: ["rm -rf /"],
        })

        expect(events).toHaveLength(1)
        expect(events[0].type).toBe("asked")
        expect(events[0].permission).toBe("bash")
        expect(events[0].risk).toBe("high")
        expect(events[0].capabilities?.executesCode).toBe(true)
        expect(events[0].capabilities?.sideEffects).toBe(true)

        unsub()
      },
    })
  })

  test("logAutoApproved emits with reason", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Audit.AuditEntry[] = []
        const unsub = Bus.subscribe(Audit.Event.Logged, (event) => {
          events.push(event.properties)
        })

        Audit.logAutoApproved({
          sessionID,
          permission: "read",
          patterns: ["src/index.ts"],
          reason: "All patterns matched allow rules",
        })

        expect(events).toHaveLength(1)
        expect(events[0].type).toBe("auto_approved")
        expect(events[0].risk).toBe("low")
        expect(events[0].reason).toBe("All patterns matched allow rules")

        unsub()
      },
    })
  })

  test("logReplied captures reply type", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Audit.AuditEntry[] = []
        const unsub = Bus.subscribe(Audit.Event.Logged, (event) => {
          events.push(event.properties)
        })

        Audit.logReplied({
          sessionID,
          permission: "edit",
          patterns: ["src/foo.ts"],
          reply: "always",
        })

        expect(events).toHaveLength(1)
        expect(events[0].type).toBe("replied")
        expect(events[0].reply).toBe("always")
        expect(events[0].risk).toBe("medium")

        unsub()
      },
    })
  })

  test("logDenied captures denial reason", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Audit.AuditEntry[] = []
        const unsub = Bus.subscribe(Audit.Event.Logged, (event) => {
          events.push(event.properties)
        })

        Audit.logDenied({
          sessionID,
          permission: "bash",
          patterns: ["sudo rm"],
          reason: "Rule matched: bash/sudo* → deny",
        })

        expect(events).toHaveLength(1)
        expect(events[0].type).toBe("denied")
        expect(events[0].risk).toBe("high")
        expect(events[0].reason).toContain("sudo")

        unsub()
      },
    })
  })

  test("read-only tools get low risk in audit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Audit.AuditEntry[] = []
        const unsub = Bus.subscribe(Audit.Event.Logged, (event) => {
          events.push(event.properties)
        })

        Audit.logAsked({
          sessionID,
          permission: "read",
          patterns: ["README.md"],
        })

        expect(events[0].risk).toBe("low")
        expect(events[0].capabilities?.sideEffects).toBe(false)

        unsub()
      },
    })
  })
})
