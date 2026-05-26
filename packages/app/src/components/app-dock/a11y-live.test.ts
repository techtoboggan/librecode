import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"

/**
 * Tests for the polite live-region announcer.
 *
 * bun 1.3.11 does not expose mock.timers, so we use real setTimeout
 * via awaited delays (>= 20ms) to advance past the 16ms gate.
 * Phase 50.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("createLiveAnnouncer", () => {
  test("announce('foo') starts with empty message, sets it after the delay", async () => {
    const { createLiveAnnouncer } = await import("./a11y-live")
    await createRoot(async (dispose) => {
      const { announce, message } = createLiveAnnouncer()

      // Before any call, message is empty string
      expect(message()).toBe("")

      announce("Pane A collapsed")
      // Immediately after call the signal was first cleared to ""
      expect(message()).toBe("")

      // Wait past the 16ms delay
      await delay(30)
      expect(message()).toBe("Pane A collapsed")

      dispose()
    })
  })

  test("calling announce twice with the same string still updates message (clear-then-set)", async () => {
    const { createLiveAnnouncer } = await import("./a11y-live")
    await createRoot(async (dispose) => {
      const { announce, message } = createLiveAnnouncer()

      // First call
      announce("Pane B expanded")
      await delay(30)
      expect(message()).toBe("Pane B expanded")

      // Second call with the same string — clears first so SR re-announces
      announce("Pane B expanded")
      // Cleared immediately
      expect(message()).toBe("")
      // Set again after delay
      await delay(30)
      expect(message()).toBe("Pane B expanded")

      dispose()
    })
  })

  test("a later announce cancels the pending earlier one", async () => {
    const { createLiveAnnouncer } = await import("./a11y-live")
    await createRoot(async (dispose) => {
      const { announce, message } = createLiveAnnouncer()

      announce("first")
      // Before 16ms fires, override with second message
      announce("second")

      await delay(30)
      // Only the second message should land
      expect(message()).toBe("second")

      dispose()
    })
  })
})
