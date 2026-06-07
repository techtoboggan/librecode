import { describe, expect, test } from "bun:test"
import { getBuiltinAppHtml, listBuiltinApps } from "../../src/mcp/builtin-apps"

describe("builtin apps registry", () => {
  test("listBuiltinApps returns activity graph, session stats, and mission hud", () => {
    const apps = listBuiltinApps()
    expect(apps.length).toBeGreaterThanOrEqual(3)

    const names = apps.map((a) => a.name)
    expect(names).toContain("Activity Graph")
    expect(names).toContain("Session Stats")
    expect(names).toContain("Mission HUD")
  })

  test("all builtin apps have required fields", () => {
    for (const app of listBuiltinApps()) {
      expect(app.server).toBe("__builtin__")
      expect(app.uri).toStartWith("ui://builtin/")
      expect(app.name.length).toBeGreaterThan(0)
      expect(app.mimeType).toBe("text/html;profile=mcp-app")
      expect(app.builtin).toBe(true)
    }
  })

  test("getBuiltinAppHtml returns HTML for valid URIs", () => {
    const html = getBuiltinAppHtml("ui://builtin/activity-graph")
    expect(html).toBeDefined()
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("Activity Graph")
  })

  test("getBuiltinAppHtml returns HTML for session stats", () => {
    const html = getBuiltinAppHtml("ui://builtin/session-stats")
    expect(html).toBeDefined()
    expect(html).toContain("Session Stats")
  })

  test("getBuiltinAppHtml returns the Mission HUD (consumes telemetry channels)", () => {
    const html = getBuiltinAppHtml("ui://builtin/mission-hud")
    expect(html).toBeDefined()
    expect(html).toContain("Mission HUD")
    // It must listen for the channel envelope + be able to request overlay.
    expect(html).toContain("mcp-app-channel")
    expect(html).toContain("mcp-app-display-mode")
  })

  test("getBuiltinAppHtml returns undefined for unknown URIs", () => {
    expect(getBuiltinAppHtml("ui://builtin/nonexistent")).toBeUndefined()
    expect(getBuiltinAppHtml("ui://other/app")).toBeUndefined()
  })
})
