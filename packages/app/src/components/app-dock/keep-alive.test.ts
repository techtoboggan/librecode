/**
 * Phase 50b — keep-alive decision helper tests.
 *
 * shouldKeepIframeAlive determines whether a pane's iframe stays
 * mounted on collapse. Three signals: built-in server, observed
 * state-relay traffic, user alwaysLoaded config flag.
 *
 * readAlwaysLoaded / buildAlwaysLoadedMap are pure accessor helpers.
 */
import { describe, expect, test } from "bun:test"
import { shouldKeepIframeAlive, readAlwaysLoaded, buildAlwaysLoadedMap } from "./keep-alive"
import type { DockEntry } from "./types"

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<Pick<DockEntry, "uri" | "app">> = {}): Pick<DockEntry, "uri" | "app"> {
  return {
    uri: overrides.uri ?? "ui://example/app",
    app: overrides.app ?? {
      server: "example-server",
      name: "Example App",
      uri: overrides.uri ?? "ui://example/app",
    },
  }
}

const BUILTIN_ENTRY = makeEntry({
  uri: "ui://builtin/session-stats",
  app: { server: "__builtin__", name: "Session Stats", uri: "ui://builtin/session-stats" },
})

const THIRD_PARTY_ENTRY = makeEntry({
  uri: "ui://acme/notes",
  app: { server: "acme-server", name: "Notes", uri: "ui://acme/notes" },
})

const EMPTY_RELAY = new Set<string>()
const EMPTY_CONFIG = {}

// ── shouldKeepIframeAlive ─────────────────────────────────────────────────────

describe("shouldKeepIframeAlive — built-in signal", () => {
  test("built-in app → true regardless of observed/config", () => {
    expect(shouldKeepIframeAlive(BUILTIN_ENTRY, EMPTY_RELAY, EMPTY_CONFIG)).toBe(true)
  })

  test("built-in app → true even when relay set is empty", () => {
    expect(shouldKeepIframeAlive(BUILTIN_ENTRY, new Set(), {})).toBe(true)
  })

  test("built-in app → true even when config has alwaysLoaded false", () => {
    const config = {
      alwaysLoadedByUri: new Map([[BUILTIN_ENTRY.uri, false]]),
    }
    expect(shouldKeepIframeAlive(BUILTIN_ENTRY, EMPTY_RELAY, config)).toBe(true)
  })
})

describe("shouldKeepIframeAlive — observed relay signal", () => {
  test("observed state-relay traffic → true even if config absent", () => {
    const relay = new Set([THIRD_PARTY_ENTRY.uri])
    expect(shouldKeepIframeAlive(THIRD_PARTY_ENTRY, relay, EMPTY_CONFIG)).toBe(true)
  })

  test("observed traffic for a different URI → does not affect this app", () => {
    const relay = new Set(["ui://other/app"])
    expect(shouldKeepIframeAlive(THIRD_PARTY_ENTRY, relay, EMPTY_CONFIG)).toBe(false)
  })
})

describe("shouldKeepIframeAlive — user config signal", () => {
  test("config alwaysLoaded:true → true", () => {
    const config = { alwaysLoadedByUri: new Map([[THIRD_PARTY_ENTRY.uri, true]]) }
    expect(shouldKeepIframeAlive(THIRD_PARTY_ENTRY, EMPTY_RELAY, config)).toBe(true)
  })

  test("config alwaysLoaded:false → does not enable keep-alive", () => {
    const config = { alwaysLoadedByUri: new Map([[THIRD_PARTY_ENTRY.uri, false]]) }
    expect(shouldKeepIframeAlive(THIRD_PARTY_ENTRY, EMPTY_RELAY, config)).toBe(false)
  })

  test("config map absent → no keep-alive from config signal", () => {
    expect(shouldKeepIframeAlive(THIRD_PARTY_ENTRY, EMPTY_RELAY, {})).toBe(false)
  })
})

describe("shouldKeepIframeAlive — all signals false", () => {
  test("non-builtin + no relay + no config → false", () => {
    expect(shouldKeepIframeAlive(THIRD_PARTY_ENTRY, EMPTY_RELAY, EMPTY_CONFIG)).toBe(false)
  })
})

// ── readAlwaysLoaded ───────────────────────────────────────────────────────────

describe("readAlwaysLoaded", () => {
  test("returns undefined when config tree absent", () => {
    expect(readAlwaysLoaded(undefined, "ui://any/uri")).toBeUndefined()
  })

  test("returns undefined when URI is not in config", () => {
    expect(readAlwaysLoaded({}, "ui://any/uri")).toBeUndefined()
  })

  test("returns true when alwaysLoaded is true", () => {
    expect(readAlwaysLoaded({ "ui://app": { alwaysLoaded: true } }, "ui://app")).toBe(true)
  })

  test("returns false when alwaysLoaded is false", () => {
    expect(readAlwaysLoaded({ "ui://app": { alwaysLoaded: false } }, "ui://app")).toBe(false)
  })

  test("returns undefined when alwaysLoaded property is absent", () => {
    expect(readAlwaysLoaded({ "ui://app": {} }, "ui://app")).toBeUndefined()
  })
})

// ── buildAlwaysLoadedMap ───────────────────────────────────────────────────────

describe("buildAlwaysLoadedMap", () => {
  test("returns empty map when config is undefined", () => {
    const m = buildAlwaysLoadedMap(undefined)
    expect(m.size).toBe(0)
  })

  test("returns empty map when config is empty object", () => {
    const m = buildAlwaysLoadedMap({})
    expect(m.size).toBe(0)
  })

  test("maps true values into the result", () => {
    const m = buildAlwaysLoadedMap({ "ui://app": { alwaysLoaded: true } })
    expect(m.get("ui://app")).toBe(true)
  })

  test("maps false values into the result", () => {
    const m = buildAlwaysLoadedMap({ "ui://app": { alwaysLoaded: false } })
    expect(m.get("ui://app")).toBe(false)
  })

  test("skips entries without alwaysLoaded boolean", () => {
    const m = buildAlwaysLoadedMap({ "ui://app": {} })
    expect(m.has("ui://app")).toBe(false)
  })

  test("handles multiple entries correctly", () => {
    const m = buildAlwaysLoadedMap({
      "ui://a": { alwaysLoaded: true },
      "ui://b": { alwaysLoaded: false },
      "ui://c": {},
    })
    expect(m.get("ui://a")).toBe(true)
    expect(m.get("ui://b")).toBe(false)
    expect(m.has("ui://c")).toBe(false)
    expect(m.size).toBe(2)
  })
})
