/**
 * v0.9.52 — persistence regression tests for the approved ruleset.
 *
 * Pre-v0.9.52, `s.approved` was hydrated from the DB at instance init
 * but every mutation (including "Always allow" replies) was in-memory
 * only. This file locks in the writeback so a fresh Instance.provide
 * on the same directory sees the rules that were written in the
 * previous run.
 */
import { expect, test } from "bun:test"
import * as S from "../../src/permission/service"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { permissionScope } from "../../src/server/routes/session/mcp-apps"
import { tmpdir } from "../fixture/fixture"

async function waitForPending(count: number) {
  for (let i = 0; i < 20; i++) {
    const list = await S.list()
    if (list.length === count) return list
    await Bun.sleep(0)
  }
  return S.list()
}

test("setApprovedRuleset round-trips through the DB", async () => {
  // git:true so each test gets a unique project_id (tests without git
  // share ProjectID.global and leak rules across tests).
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      S.setApprovedRuleset([
        { permission: "mcp-app:acme:get_forecast", pattern: "ui://acme/weather", action: "allow" },
        { permission: "mcp-app:other:ping", pattern: "ui://other/x", action: "deny" },
      ])
      await Instance.dispose()
    },
  })

  // A second Instance.provide on the same directory now hits init
  // fresh (previous in-memory state was disposed) — if persistence
  // works, it sees the rules we just wrote.
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const rules = S.listApproved()
      expect(rules.length).toBe(2)
      expect(rules[0].permission).toBe("mcp-app:acme:get_forecast")
      expect(rules[1].action).toBe("deny")
    },
  })
})

test("'Always allow' reply persists — the existing bug is fixed", async () => {
  // git:true so each test gets a unique project_id (tests without git
  // share ProjectID.global and leak rules across tests).
  await using tmp = await tmpdir({ git: true })
  const scope = permissionScope("acme", "ui://acme/weather", "get_forecast")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = SessionID.descending()
      const first = S.ask({
        sessionID,
        permission: scope.permission,
        patterns: [scope.pattern],
        always: [scope.pattern],
        metadata: {},
        ruleset: [],
      })
      const [pending] = await waitForPending(1)
      await S.reply({ requestID: pending.id, reply: "always" })
      await first
      await Instance.dispose()
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const rules = S.listApproved()
      expect(rules).toContainEqual({
        permission: scope.permission,
        pattern: scope.pattern,
        action: "allow",
      })

      // And re-asking in a brand-new session should auto-allow (no
      // prompt appears), because the rule loaded from DB matched.
      const sessionID = SessionID.descending()
      const repeat = S.ask({
        sessionID,
        permission: scope.permission,
        patterns: [scope.pattern],
        always: [scope.pattern],
        metadata: {},
        ruleset: [],
      })
      await repeat
      expect((await S.list()).length).toBe(0)
    },
  })
})

test("deleteApprovedRule removes a single rule and persists the deletion", async () => {
  // git:true so each test gets a unique project_id (tests without git
  // share ProjectID.global and leak rules across tests).
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      S.setApprovedRuleset([
        { permission: "mcp-app:acme:a", pattern: "ui://acme/a", action: "allow" },
        { permission: "mcp-app:acme:b", pattern: "ui://acme/b", action: "allow" },
      ])
      const removed = S.deleteApprovedRule("mcp-app:acme:a", "ui://acme/a")
      expect(removed).toBe(1)
      expect(S.listApproved().length).toBe(1)
      expect(S.listApproved()[0].permission).toBe("mcp-app:acme:b")
      await Instance.dispose()
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const rules = S.listApproved()
      expect(rules.length).toBe(1)
      expect(rules[0].permission).toBe("mcp-app:acme:b")
    },
  })
})

test("deleteApprovedRule returns 0 when no rule matches (no-op, no write)", async () => {
  // git:true so each test gets a unique project_id (tests without git
  // share ProjectID.global and leak rules across tests).
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      S.setApprovedRuleset([{ permission: "mcp-app:x:y", pattern: "ui://x/y", action: "allow" }])
      const removed = S.deleteApprovedRule("mcp-app:nope:nope", "ui://nope/nope")
      expect(removed).toBe(0)
      expect(S.listApproved().length).toBe(1)
    },
  })
})
