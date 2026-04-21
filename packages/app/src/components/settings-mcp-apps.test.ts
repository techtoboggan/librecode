/**
 * Pure unit tests for the v0.9.48 SettingsMcpApps helpers. The full
 * dialog render is exercised via Playwright (covered separately).
 */
import { describe, expect, test } from "bun:test"
import {
  formatLastUsed,
  groupByServer,
  latestLastUsed,
  type PermissionRule,
  rulesForServer,
  toolFromPermission,
  totalCalls,
  type UsageEntry,
} from "./settings-mcp-apps-helpers"

describe("groupByServer", () => {
  test("groups apps with the same server name into a single bucket", () => {
    const grouped = groupByServer([
      { server: "acme", name: "Weather", uri: "ui://acme/weather" },
      { server: "acme", name: "Map", uri: "ui://acme/map" },
      { server: "other", name: "Notes", uri: "ui://other/notes" },
    ])
    expect(grouped.size).toBe(2)
    expect(grouped.get("acme")?.length).toBe(2)
    expect(grouped.get("other")?.length).toBe(1)
  })

  test("preserves insertion order for both servers and apps", () => {
    const grouped = groupByServer([
      { server: "z", name: "Zed", uri: "ui://z/a" },
      { server: "a", name: "Apex", uri: "ui://a/a" },
      { server: "z", name: "Zen", uri: "ui://z/b" },
    ])
    expect([...grouped.keys()]).toEqual(["z", "a"])
    expect(grouped.get("z")?.map((x) => x.name)).toEqual(["Zed", "Zen"])
  })

  test("empty input → empty map", () => {
    expect(groupByServer([]).size).toBe(0)
  })
})

function entry(partial: Partial<UsageEntry> = {}): UsageEntry {
  return {
    sessionID: "ses_a",
    server: "acme",
    permission: "mcp-app:acme:echo",
    tool: "echo",
    lastUsedAt: 1_700_000_000_000,
    callsInSession: 1,
    ...partial,
  }
}

describe("totalCalls", () => {
  test("sums callsInSession across entries", () => {
    expect(totalCalls([entry({ callsInSession: 2 }), entry({ callsInSession: 5 })])).toBe(7)
  })

  test("empty list → 0", () => {
    expect(totalCalls([])).toBe(0)
  })
})

describe("latestLastUsed", () => {
  test("returns the max lastUsedAt across entries", () => {
    expect(
      latestLastUsed([entry({ lastUsedAt: 1000 }), entry({ lastUsedAt: 5000 }), entry({ lastUsedAt: 2000 })]),
    ).toBe(5000)
  })

  test("empty list → undefined", () => {
    expect(latestLastUsed([])).toBeUndefined()
  })
})

describe("formatLastUsed", () => {
  const now = 1_700_000_000_000

  test("under 10s → 'just now'", () => {
    expect(formatLastUsed(now - 500, now)).toBe("just now")
    expect(formatLastUsed(now - 9_999, now)).toBe("just now")
  })

  test("seconds bucket", () => {
    expect(formatLastUsed(now - 15_000, now)).toBe("15s ago")
    expect(formatLastUsed(now - 59_999, now)).toBe("59s ago")
  })

  test("minutes bucket", () => {
    expect(formatLastUsed(now - 3 * 60_000, now)).toBe("3m ago")
  })

  test("hours bucket", () => {
    expect(formatLastUsed(now - 5 * 3_600_000, now)).toBe("5h ago")
  })

  test("days bucket", () => {
    expect(formatLastUsed(now - 2 * 86_400_000, now)).toBe("2d ago")
  })

  test("future timestamps don't return negative deltas", () => {
    // Clock skew or reordering could theoretically hand us a ts > now.
    // We clamp to 0 so we never show "-5s ago".
    expect(formatLastUsed(now + 10_000, now)).toBe("just now")
  })
})

describe("rulesForServer", () => {
  const ruleset: PermissionRule[] = [
    { permission: "mcp-app:acme:echo", pattern: "ui://acme/echo", action: "allow" },
    { permission: "mcp-app:acme:weather", pattern: "ui://acme/w", action: "deny" },
    { permission: "mcp-app:other:x", pattern: "ui://other/x", action: "allow" },
    { permission: "edit", pattern: "**/*.ts", action: "allow" },
  ]

  test("filters to just this server's mcp-app rules", () => {
    const rules = rulesForServer(ruleset, "acme")
    expect(rules.length).toBe(2)
    expect(rules.every((r) => r.permission.startsWith("mcp-app:acme:"))).toBe(true)
  })

  test("returns [] when server has no rules", () => {
    expect(rulesForServer(ruleset, "nope")).toEqual([])
  })

  test("does not leak rules from similarly-named servers", () => {
    const rules = rulesForServer(
      [
        { permission: "mcp-app:acme:x", pattern: "*", action: "allow" },
        { permission: "mcp-app:acme-weather:x", pattern: "*", action: "allow" },
      ],
      "acme",
    )
    expect(rules.length).toBe(1)
    expect(rules[0].permission).toBe("mcp-app:acme:x")
  })
})

describe("toolFromPermission", () => {
  test("extracts the tool segment from mcp-app:<server>:<tool>", () => {
    expect(toolFromPermission("mcp-app:acme:get_forecast")).toBe("get_forecast")
  })

  test("passes through non-mcp-app permissions unchanged", () => {
    expect(toolFromPermission("edit")).toBe("edit")
    expect(toolFromPermission("bash")).toBe("bash")
  })

  test("handles permissions whose tool segment itself contains colons", () => {
    expect(toolFromPermission("mcp-app:acme:nested:tool")).toBe("nested:tool")
  })
})
