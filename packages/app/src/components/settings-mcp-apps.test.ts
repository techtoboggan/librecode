/**
 * Pure unit tests for the v0.9.48 SettingsMcpApps helpers. The full
 * dialog render is exercised via Playwright (covered separately).
 */
import { describe, expect, test } from "bun:test"
import { groupByServer } from "./settings-mcp-apps"

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
