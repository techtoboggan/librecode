/**
 * Tests for the session-scoped grant tier added in v0.9.42 to support
 * MCP-app permission prompts (ADR-005 §2 + the user's three-tier
 * decision: once / this-session / always).
 */
import { expect, test } from "bun:test"
import * as S from "../../src/permission/service"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import { permissionScope } from "../../src/server/routes/session/mcp-apps"

async function waitForPending(count: number) {
  for (let i = 0; i < 20; i++) {
    const list = await S.list()
    if (list.length === count) return list
    await Bun.sleep(0)
  }
  return S.list()
}

test("session-tier reply allows the same permission+pattern again in the same session — without prompting", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = SessionID.descending()
      const scope = permissionScope("acme", "ui://acme/weather", "get_forecast")

      // First call: no rules, no session grant → should prompt.
      const first = S.ask({
        sessionID,
        permission: scope.permission,
        patterns: [scope.pattern],
        always: [scope.pattern],
        metadata: {},
        ruleset: [],
      })
      const [pending] = await waitForPending(1)
      expect(pending.permission).toBe(scope.permission)

      // Reply "session" — grants for this session only.
      await S.reply({ requestID: pending.id, reply: "session" })
      await first

      // Second call (same session, same scope): MUST be auto-allowed
      // by the session grant — no new pending request.
      const second = S.ask({
        sessionID,
        permission: scope.permission,
        patterns: [scope.pattern],
        always: [scope.pattern],
        metadata: {},
        ruleset: [],
      })
      await second
      expect((await S.list()).length).toBe(0)
    },
  })
})

test("session grants do NOT leak across sessions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionA = SessionID.descending()
      const sessionB = SessionID.descending()
      const scope = permissionScope("acme", "ui://acme/weather", "get_forecast")

      const aFirst = S.ask({
        sessionID: sessionA,
        permission: scope.permission,
        patterns: [scope.pattern],
        always: [scope.pattern],
        metadata: {},
        ruleset: [],
      })
      const [pendingA] = await waitForPending(1)
      await S.reply({ requestID: pendingA.id, reply: "session" })
      await aFirst

      // Session B asks the same scope — must prompt (session A's grant
      // is scoped to session A only).
      const bFirst = S.ask({
        sessionID: sessionB,
        permission: scope.permission,
        patterns: [scope.pattern],
        always: [scope.pattern],
        metadata: {},
        ruleset: [],
      })
      const [pendingB] = await waitForPending(1)
      expect(pendingB.sessionID).toBe(sessionB)
      await S.reply({ requestID: pendingB.id, reply: "reject" })
      await bFirst.catch(() => {}) // expected: rejected
    },
  })
})

test("dropSessionApprovals revokes mid-session — next call prompts again", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = SessionID.descending()
      const scope = permissionScope("acme", "ui://acme/weather", "get_forecast")

      const first = S.ask({
        sessionID,
        permission: scope.permission,
        patterns: [scope.pattern],
        always: [scope.pattern],
        metadata: {},
        ruleset: [],
      })
      const [pending] = await waitForPending(1)
      await S.reply({ requestID: pending.id, reply: "session" })
      await first

      // Revoke this session's grants (e.g. user disconnected the app).
      S.dropSessionApprovals(sessionID)

      // Next call must prompt again.
      const second = S.ask({
        sessionID,
        permission: scope.permission,
        patterns: [scope.pattern],
        always: [scope.pattern],
        metadata: {},
        ruleset: [],
      })
      const [pendingAgain] = await waitForPending(1)
      expect(pendingAgain.permission).toBe(scope.permission)
      await S.reply({ requestID: pendingAgain.id, reply: "reject" })
      await second.catch(() => {})
    },
  })
})

test("permissionScope builds the canonical permission/pattern shape", () => {
  const scope = permissionScope("acme-weather", "ui://acme/weather", "get_forecast")
  expect(scope.permission).toBe("mcp-app:acme-weather:get_forecast")
  expect(scope.pattern).toBe("ui://acme/weather")
})
