/**
 * Phase 52 Sub-B — tests for the tauri-mock Platform helper.
 *
 * Verifies that createMockPlatform and makePlatformModule work correctly
 * so consumers can rely on them without re-reading the implementation.
 *
 * Why these tests exist: the helper is used across multiple test files;
 * if its API or defaults regress, every test using it would break in
 * confusing ways. Testing the helper directly localises the failure to
 * tauri-mock.test.ts and makes the root cause obvious.
 */

import { describe, expect, test } from "bun:test"
import { createMockPlatform, makePlatformModule } from "./tauri-mock"

describe("createMockPlatform — defaults", () => {
  test("defaults to platform: 'desktop' so desktop-branch code runs in tests", () => {
    const mock = createMockPlatform()
    expect(mock.platform).toBe("desktop")
  })

  test("all Phase 49 Tauri window methods are no-ops by default (return resolved Promises)", async () => {
    const mock = createMockPlatform()
    // These MUST return Promises; await confirms they don't throw
    await expect(mock.openDetachedWindow!({ server: "s", uri: "u", appName: "a", dir: "/" })).resolves.toBeUndefined()
    await expect(mock.closeDetachedWindow!({ server: "s", uri: "u" })).resolves.toBeUndefined()
    await expect(mock.focusDetachedWindow!({ server: "s", uri: "u" })).resolves.toBeUndefined()
  })

  test("overrides replace defaults — spy on openDetachedWindow calls", async () => {
    const calls: Array<{ server: string; uri: string }> = []
    const mock = createMockPlatform({
      openDetachedWindow: async (opts) => {
        calls.push({ server: opts.server, uri: opts.uri })
      },
    })
    await mock.openDetachedWindow!({ server: "multica", uri: "ui://multica/board", appName: "Multica", dir: "/" })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ server: "multica", uri: "ui://multica/board" })
  })
})

describe("makePlatformModule", () => {
  test("returns a factory whose usePlatform() returns a valid Platform object", () => {
    const factory = makePlatformModule()
    const mod = factory()
    const platform = mod.usePlatform()
    expect(platform.platform).toBe("desktop")
    expect(typeof platform.openLink).toBe("function")
  })

  test("overrides flow through to the returned Platform", () => {
    const factory = makePlatformModule({ platform: "web" })
    const platform = factory().usePlatform()
    expect(platform.platform).toBe("web")
  })
})
